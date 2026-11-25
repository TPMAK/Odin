// "Open in Google Maps" for a private list (Nov 2026).
// Turns the places in one of the caller's lists into a Google Maps shortlist link:
//   https://www.google.com/maps/@?api=1&map_action=shortlist&place_ids=ID1,ID2,...
//
// Trust rules:
// - Reads the list and its items with the CALLER's own token, so Supabase RLS decides
//   what they can see (lists are owner-only; items follow knowledge_items visibility).
//   This function never sees anything the caller can't already see in Odin.
// - Only the place name + address/coords go to Google, to look up a Place ID.
//   Notes, who saved it, and photos never leave Odin.
//
// Google cost: Text Search (New) with field mask "places.id" only is the
// "Text Search Essentials (IDs Only)" SKU. Needs env var GOOGLE_PLACES_API_KEY on Vercel.

const SUPABASE_URL = 'https://hedywkwmgkvojujvczqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlZHl3a3dtZ2t2b2p1anZjenFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2Mzg0OTMsImV4cCI6MjA3MjIxNDQ5M30.WdGHwr40REynSkC3T3t2nB97FsAH3M0NOE9gv_bLQA8';

const MAX_PLACES = 60;          // ~27 chars per id; keeps the link under Google's 2,048-char limit
const MAX_URL_LEN = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlaceLike(it) {
  const hasAddr = typeof it.address === 'string' && it.address.trim().length > 0;
  const hasPin = it.latitude != null && it.longitude != null;
  return hasAddr || hasPin;
}

async function sb(path, token) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token }
  });
  if (r.status === 401 || r.status === 403) { const e = new Error('unauthorized'); e.code = 401; throw e; }
  if (!r.ok) throw new Error('supabase ' + r.status);
  return r.json();
}

async function findPlaceId(it, key) {
  const name = String(it.place_name || it.title || '').trim();
  const addr = String(it.address || '').trim();
  const textQuery = [name, addr].filter(Boolean).join(', ').slice(0, 300);
  if (!textQuery) return null;
  const body = { textQuery, pageSize: 1 };
  if (it.latitude != null && it.longitude != null) {
    body.locationBias = { circle: { center: { latitude: Number(it.latitude), longitude: Number(it.longitude) }, radius: 500 } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!r.ok) return null;
    const j = await r.json();
    const id = j && Array.isArray(j.places) && j.places[0] && j.places[0].id;
    return (typeof id === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(id)) ? id : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const collectionId = String((body && body.collection_id) || '');
  if (!token || token === SUPABASE_KEY) return res.status(401).json({ error: 'sign_in_required' });
  if (!UUID_RE.test(collectionId)) return res.status(400).json({ error: 'bad_list' });

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(503).json({ error: 'not_configured' });

  try {
    // 1. The list's item ids — owner-only RLS on collection_items.
    const rows = await sb('collection_items?select=item_id,added_at&collection_id=eq.' + collectionId + '&order=added_at.desc', token);
    const ids = (rows || []).map(r => r.item_id).filter(id => UUID_RE.test(String(id)));
    if (!ids.length) return res.status(200).json({ url: null, sent: 0, places: 0, total: 0, skipped: [] });

    // 2. The items themselves — knowledge_items RLS decides what the caller can see.
    const items = await sb('knowledge_items?select=id,place_name,title,address,latitude,longitude&id=in.(' + ids.join(',') + ')', token);
    const byId = {};
    (items || []).forEach(it => { byId[it.id] = it; });
    const visible = ids.map(id => byId[id]).filter(Boolean);
    const places = visible.filter(isPlaceLike).slice(0, MAX_PLACES);

    // 3. Look up Place IDs (in parallel, ID-only field mask).
    const found = await Promise.all(places.map(it => findPlaceId(it, key)));
    const placeIds = [];
    const skipped = [];
    places.forEach((it, i) => {
      const id = found[i];
      if (id && !placeIds.includes(id)) placeIds.push(id);
      else if (!id) skipped.push(String(it.place_name || it.title || 'Untitled'));
    });

    // 4. Build the shortlist link, trimming if it would pass Google's URL limit.
    const base = 'https://www.google.com/maps/@?api=1&map_action=shortlist&place_ids=';
    let url = null;
    let sent = 0;
    if (placeIds.length) {
      const use = [];
      for (const id of placeIds) {
        if ((base + use.concat(id).join(',')).length > MAX_URL_LEN) break;
        use.push(id);
      }
      sent = use.length;
      url = base + use.join(',');
    }
    return res.status(200).json({ url, sent, places: places.length, total: visible.length, skipped });
  } catch (e) {
    if (e && e.code === 401) return res.status(401).json({ error: 'sign_in_required' });
    return res.status(502).json({ error: 'lookup_failed' });
  }
};
