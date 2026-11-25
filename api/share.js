// Per-item link preview for WhatsApp / iMessage / Messenger.
// Chat apps read the <meta> tags; people are sent straight on to share.html.
// Any failure falls back to the plain share.html link, so sharing never breaks.
// Privacy: only the item title and photo go in the preview. No note, no names,
// because a preview can be forwarded into groups the sharer never chose.
const SUPABASE_URL = 'https://hedywkwmgkvojujvczqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlZHl3a3dtZ2t2b2p1anZjenFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2Mzg0OTMsImV4cCI6MjA3MjIxNDQ5M30.WdGHwr40REynSkC3T3t2nB97FsAH3M0NOE9gv_bLQA8';

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = async (req, res) => {
  const token = String((req.query && req.query.token) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'www.join-odin.com';
  const origin = 'https://' + host;
  const target = origin + '/share.html' + (token ? '?token=' + encodeURIComponent(token) : '');

  let title = 'A friend shared something with you on Odin';
  let image = origin + '/icon-512.png';
  let hasPhoto = false;
  try {
    if (token) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_share_preview', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_token: token }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      const rows = r.ok ? await r.json() : [];
      const p = Array.isArray(rows) ? rows[0] : null;
      if (p && p.item_title) title = p.item_title + ' · shared with you on Odin';
      if (p && p.item_photo_url && p.item_photo_url.startsWith(SUPABASE_URL + '/')) { image = p.item_photo_url; hasPhoto = true; }
    }
  } catch (e) { /* fall back to the generic preview */ }

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="Odin is a private discovery network. By invite only.">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(target)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
${hasPhoto ? '' : '<meta property="og:image:width" content="512"><meta property="og:image:height" content="512">'}
<meta name="twitter:card" content="${hasPhoto ? 'summary_large_image' : 'summary'}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body><a href="${esc(target)}">Open on Odin</a></body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(html);
};
