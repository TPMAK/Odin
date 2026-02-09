// ===== SUPABASE CLIENT INITIALIZATION =====
const SUPABASE_URL = 'https://hedywkwmgkvojujvczqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlZHl3a3dtZ2t2b2p1anZjenFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2Mzg0OTMsImV4cCI6MjA3MjIxNDQ5M30.WdGHwr40REynSkC3T3t2nB97FsAH3M0NOE9gv_bLQA8';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== OAUTH AUTHENTICATION =====
let currentUser = null;

async function checkAuth() {
    // Check for OAuth callback
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
        console.error('Auth error:', error);
        showLoginScreen();
        return;
    }
    
    if (session) {
        currentUser = session.user;
        showMainApp();
    } else {
        showLoginScreen();
    }
}

function showLoginScreen() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
}

function showMainApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    
    // Update UI with user name if available
    const userName = currentUser?.user_metadata?.full_name || 
                     currentUser?.email?.split('@')[0] || 
                     'User';
    console.log('Logged in as:', userName);
}

async function handleGoogleLogin() {
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin
        }
    });
    
    if (error) {
        document.getElementById('loginError').style.display = 'block';
        document.getElementById('loginError').textContent = 'Login failed: ' + error.message;
    }
}

async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (!error) {
        currentUser = null;
        showLoginScreen();
    }
}

// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
        currentUser = session.user;
        showMainApp();
    } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        showLoginScreen();
    }
});

// Check auth on page load
checkAuth();

// ===== END OAUTH AUTHENTICATION =====

// ===== APP CONFIGURATION =====
const SEARCH_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/search123';
const CAPTURE_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/capture';

let userLocation = { latitude: null, longitude: null, available: false };
let allDiscoveries = [];
let filteredDiscoveries = [];
let displayedCount = 0;
let discoverMap = null;
let searchMap = null;
let mapVisible = { discover: false, search: false };
const LOAD_INCREMENT = 12;

let filters = { categories: [], users: [], distances: [], searchText: '' };
let isFirstMessage = true;
let currentResults = [];
let currentSessionId = generateSessionId();
let sessionMessages = [];

// Initialize app
initApp();
initLocation();
loadRecentSearches();

function initApp() {
    const hasVisited = localStorage.getItem('hasVisited');

    if (!hasVisited) {
        showLanding();
    } else {
        showHome();
    }
}

function showLanding() {
    document.getElementById('landingPage').classList.remove('hidden');
    document.getElementById('homePage').classList.add('hidden');
    document.getElementById('searchMode').classList.add('hidden');
    document.getElementById('discoverMode').classList.add('hidden');
    document.getElementById('inputMode').classList.add('hidden');
    document.getElementById('inputArea').classList.add('hidden');
    updateTabBar('home');
    loadDiscoveryCount();
}

function showHome() {
    document.getElementById('landingPage').classList.add('hidden');
    document.getElementById('homePage').classList.remove('hidden');
    document.getElementById('searchMode').classList.add('hidden');
    document.getElementById('discoverMode').classList.add('hidden');
    document.getElementById('inputMode').classList.add('hidden');
    document.getElementById('inputArea').classList.add('hidden');
    updateTabBar('home');
}

function fromLanding(mode) {
    localStorage.setItem('hasVisited', 'true');
    setMode(mode);
}

async function loadDiscoveryCount() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_items?select=id`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const data = await response.json();
        document.getElementById('landingDiscoveryCount').textContent = data.length;
    } catch (error) {
        console.error('Error loading count:', error);
    }
}

function setMode(mode) {
    document.getElementById('landingPage').classList.add('hidden');
    document.getElementById('homePage').classList.add('hidden');
    document.getElementById('searchMode').classList.add('hidden');
    document.getElementById('discoverMode').classList.add('hidden');
    document.getElementById('inputMode').classList.add('hidden');

    if (mode === 'home') {
        showHome();
    } else if (mode === 'search') {
        document.getElementById('searchMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.remove('hidden');
    } else if (mode === 'discover') {
        document.getElementById('discoverMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
        loadDiscoveries();
    } else if (mode === 'input') {
        document.getElementById('inputMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
    }

    updateTabBar(mode);
}

function updateTabBar(mode) {
    document.getElementById('homeTab').classList.remove('active');
    document.getElementById('searchTab').classList.remove('active');
    document.getElementById('discoverTab').classList.remove('active');
    document.getElementById('addTab').classList.remove('active');

    if (mode === 'home') document.getElementById('homeTab').classList.add('active');
    else if (mode === 'search') document.getElementById('searchTab').classList.add('active');
    else if (mode === 'discover') document.getElementById('discoverTab').classList.add('active');
    else if (mode === 'input') document.getElementById('addTab').classList.add('active');
}

function initLocation() {
    const indicator = document.getElementById('locationIndicator');

    if (!navigator.geolocation) {
        indicator.textContent = '📍 Not supported';
        indicator.className = 'location-indicator error';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            userLocation.latitude = position.coords.latitude;
            userLocation.longitude = position.coords.longitude;
            userLocation.available = true;
            indicator.textContent = '📍 Location on';
            indicator.className = 'location-indicator active';
        },
        (error) => {
            indicator.textContent = '📍 Location off';
            indicator.className = 'location-indicator error';
        }
    );
}

function toggleMap(type) {
    mapVisible[type] = !mapVisible[type];
    const btn = document.getElementById('mapToggleBtn');
    const text = document.getElementById('mapToggleText');

    if (type === 'discover') {
        const container = document.getElementById('discoverMapContainer');
        container.classList.toggle('hidden', !mapVisible[type]);
        btn.classList.toggle('collapsed', !mapVisible[type]);
        text.textContent = mapVisible[type] ? 'Hide Map' : 'Show Map';

        if (mapVisible[type] && !discoverMap) {
            setTimeout(() => initDiscoverMap(), 100);
        }
    }
}

function openLightbox(photoUrl) {
    document.getElementById('lightboxImg').src = photoUrl;
    document.getElementById('photoLightbox').classList.add('active');
}

function closeLightbox() {
    document.getElementById('photoLightbox').classList.remove('active');
}

function openFilterModal() {
    document.getElementById('filterBackdrop').classList.add('active');
    document.getElementById('filterModal').classList.add('active');
}

function closeFilterModal() {
    document.getElementById('filterBackdrop').classList.remove('active');
    document.getElementById('filterModal').classList.remove('active');
}

function toggleSection(section) {
    document.getElementById(section + 'Section').classList.toggle('expanded');
}

function populateFilters() {
    const categories = ['place', 'product', 'service', 'advice'];
    document.getElementById('categoryOptions').innerHTML = categories.map(cat => `
        <div class="filter-option">
            <input type="checkbox" id="cat-${cat}" value="${cat}" onchange="updateFilterState()">
            <label for="cat-${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</label>
        </div>
    `).join('');

    const users = [...new Set(allDiscoveries.map(d => d.added_by_name).filter(Boolean))];
    document.getElementById('userOptions').innerHTML = users.map(user => `
        <div class="filter-option">
            <input type="checkbox" id="user-${user}" value="${user}" onchange="updateFilterState()">
            <label for="user-${user}">${escapeHtml(user)}</label>
        </div>
    `).join('');

    const distances = ['1', '5', '10', '20'];
    document.getElementById('distanceOptions').innerHTML = distances.map(dist => `
        <div class="filter-option">
            <input type="checkbox" id="dist-${dist}" value="${dist}" onchange="updateFilterState()">
            <label for="dist-${dist}">Within ${dist}km</label>
        </div>
    `).join('');
}

function updateFilterState() {
    filters.categories = Array.from(document.querySelectorAll('#categoryOptions input:checked')).map(cb => cb.value);
    filters.users = Array.from(document.querySelectorAll('#userOptions input:checked')).map(cb => cb.value);
    filters.distances = Array.from(document.querySelectorAll('#distanceOptions input:checked')).map(cb => parseFloat(cb.value));

    const count = filters.categories.length + filters.users.length + filters.distances.length;
    const badge = document.getElementById('filterBadge');
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function clearFilters() {
    filters = { categories: [], users: [], distances: [], searchText: '' };
    document.querySelectorAll('.filter-option input').forEach(cb => cb.checked = false);
    document.getElementById('discoverSearch').value = '';
    updateFilterState();
}

function applyFilters() {
    closeFilterModal();
    filterAndRender();
}

function handleSearchInput() {
    filters.searchText = document.getElementById('discoverSearch').value.trim().toLowerCase();
    if (filters.searchText) saveRecentSearch(filters.searchText);
    filterAndRender();
}

function searchFromDiscover() {
    const query = document.getElementById('discoverSearch').value.trim();
    if (!query) return;
    setMode('search');
    document.getElementById('messageInput').value = query;
    sendMessage();
}

function filterAndRender() {
    filteredDiscoveries = allDiscoveries.filter(item => {
        if (filters.categories.length > 0 && !filters.categories.includes(item.type)) return false;
        if (filters.users.length > 0 && !filters.users.includes(item.added_by_name)) return false;
        if (filters.distances.length > 0 && userLocation.available) {
            if (!item.distance_km) return false;
            const maxDist = Math.max(...filters.distances);
            if (item.distance_km > maxDist) return false;
        }
        if (filters.searchText) {
            const text = filters.searchText;
            const title = (item.title || '').toLowerCase();
            const desc = (item.description || '').toLowerCase();
            if (!title.includes(text) && !desc.includes(text)) return false;
        }
        return true;
    });

    updateActiveFiltersBar();
    displayedCount = 0;
    renderGrid();
}

function updateActiveFiltersBar() {
    const bar = document.getElementById('activeFiltersBar');
    let html = '';
    filters.categories.forEach(cat => html += `<span class="active-filter-chip">${cat} <span class="active-filter-remove" onclick="removeActiveFilter('category', '${cat}')">×</span></span>`);
    filters.users.forEach(user => html += `<span class="active-filter-chip">${escapeHtml(user)} <span class="active-filter-remove" onclick="removeActiveFilter('user', '${escapeHtml(user)}')">×</span></span>`);
    filters.distances.forEach(dist => html += `<span class="active-filter-chip">&lt; ${dist}km <span class="active-filter-remove" onclick="removeActiveFilter('distance', '${dist}')">×</span></span>`);
    bar.innerHTML = html;
}

function removeActiveFilter(type, value) {
    if (type === 'category') {
        filters.categories = filters.categories.filter(c => c !== value);
        document.getElementById('cat-' + value).checked = false;
    } else if (type === 'user') {
        filters.users = filters.users.filter(u => u !== value);
        document.getElementById('user-' + value).checked = false;
    } else if (type === 'distance') {
        filters.distances = filters.distances.filter(d => d != value);
        document.getElementById('dist-' + value).checked = false;
    }
    updateFilterState();
    filterAndRender();
}

async function loadDiscoveries() {
    try {
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 180);

        const response = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_items?select=*&order=created_at.desc`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });

        let data = await response.json();
        data = data.filter(item => new Date(item.created_at) >= twoWeeksAgo);

        if (userLocation.available) {
            data = data.map(item => {
                if (item.latitude && item.longitude) {
                    item.distance_km = calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude);
                }
                return item;
            });
        }

        allDiscoveries = data;
        populateFilters();
        filterAndRender();
    } catch (error) {
        console.error('Error:', error);
    }
}

function renderGrid() {
    const grid = document.getElementById('discoverGrid');
    grid.innerHTML = '';

    if (filteredDiscoveries.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-title">No discoveries found</div><div class="empty-state-text">Try adjusting your filters</div><button class="empty-state-btn" onclick="setMode(\'input\')">Add Discovery</button></div>';
        return;
    }

    const toDisplay = filteredDiscoveries.slice(0, displayedCount + LOAD_INCREMENT);
    toDisplay.forEach((item, i) => grid.appendChild(createCard(item, i)));
    displayedCount = toDisplay.length;

    document.getElementById('loadMoreContainer').classList.toggle('hidden', displayedCount >= filteredDiscoveries.length);

    if (mapVisible.discover) {
        setTimeout(() => initDiscoverMap(), 100);
    }
}

function createCard(item, index) {
    const card = document.createElement('div');
    card.className = 'discovery-card';
    card.onclick = () => showDrawer(index);

    const photo = item.photo_url
        ? `<img src="${escapeHtml(item.photo_url)}">`
        : '<span class="discovery-card-photo-placeholder">📍</span>';

    const distText = item.distance_km
        ? (item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km')
        : '';

    let note = null;
    if (item.PersonalNote) note = item.PersonalNote;
    else if (item.personal_note) note = item.personal_note;
    else if (item.metadata) {
        try {
            const meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
            note = meta.personal_note;
        } catch (e) {}
    }

    const daysAgo = Math.floor((new Date() - new Date(item.created_at)) / (1000 * 60 * 60 * 24));
    const dateText = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d' : `${daysAgo}d`;

    const snippet = note || item.description || '';
    const snippetHtml = snippet
        ? `<div class="discovery-card-snippet">${note ? '💭 ' : ''}${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>`
        : '';

    let tagsHtml = '<div class="discovery-card-tags">';
    if (distText) tagsHtml += `<span class="discovery-tag discovery-tag-distance">📍 ${distText}</span>`;
    if (item.added_by_name) tagsHtml += `<span class="discovery-tag discovery-tag-person">${escapeHtml(item.added_by_name)}</span>`;
    tagsHtml += `<span class="discovery-tag discovery-tag-time">${dateText}</span>`;
    tagsHtml += '</div>';

    card.innerHTML = `
        <div class="discovery-card-photo">${photo}</div>
        <div class="discovery-card-content">
            <div class="discovery-card-title">${escapeHtml(item.title)}</div>
            ${tagsHtml}
            ${snippetHtml}
        </div>
    `;
    return card;
}

function loadMore() {
    renderGrid();
}

function initDiscoverMap() {
    const mapEl = document.getElementById('discoverMap');
    if (discoverMap) discoverMap.remove();

    const located = filteredDiscoveries
        .map((d, index) => ({ ...d, originalIndex: index }))
        .filter(d => d.latitude && d.longitude);

    if (located.length === 0) return;

    discoverMap = L.map('discoverMap');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(discoverMap);

    const bounds = [];
    located.forEach((d) => {
        const lat = parseFloat(d.latitude);
        const lng = parseFloat(d.longitude);
        if (isNaN(lat) || isNaN(lng)) return;
        bounds.push([lat, lng]);

        L.marker([lat, lng])
            .addTo(discoverMap)
            .bindTooltip(`<strong>${escapeHtml(d.title)}</strong>`)
            .on('click', () => showDrawer(d.originalIndex));
    });

    if (userLocation.available) {
        L.circleMarker([userLocation.latitude, userLocation.longitude], {
            radius: 8, fillColor: '#059669', color: '#fff', weight: 2, fillOpacity: 0.8
        }).addTo(discoverMap).bindTooltip('You are here');
        bounds.push([userLocation.latitude, userLocation.longitude]);
    }

    if (bounds.length > 0) discoverMap.fitBounds(bounds, { padding: [30, 30] });
}

function showDrawer(index) {
    const item = filteredDiscoveries[index] || currentResults[index];
    if (!item) return;

    let html = '';
    if (item.photo_url) {
        html += `<div class="drawer-photo" onclick="event.stopPropagation(); openLightbox('${escapeHtml(item.photo_url)}');"><img src="${escapeHtml(item.photo_url)}"></div>`;
    }
    html += `<h1 class="drawer-title">${escapeHtml(item.title)}</h1><div class="drawer-meta">`;
    if (item.distance_km) {
        const dist = item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km';
        html += `<span class="drawer-distance">${dist}</span>`;
    }
    if (item.added_by_name) html += `<span class="drawer-added-by">Added by ${escapeHtml(item.added_by_name)}</span>`;
    html += '</div>';

    let note = null;
    if (item.PersonalNote) note = item.PersonalNote;
    else if (item.personal_note) note = item.personal_note;
    else if (item.metadata) {
        try {
            const meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
            note = meta.personal_note;
        } catch (e) {}
    }

    if (note) html += `<div class="drawer-story"><div class="drawer-story-label">Personal Story</div><div class="drawer-story-text">${escapeHtml(note)}</div></div>`;
    if (item.description) html += `<div class="drawer-description">${escapeHtml(item.description)}</div>`;
    if (item.address) html += `<div class="drawer-address">${escapeHtml(item.address)}</div>`;

    let url = null;
    if (item.URL) {
        if (Array.isArray(item.URL) && item.URL.length > 0) url = item.URL[0];
        else if (typeof item.URL === 'string' && item.URL.startsWith('http')) url = item.URL;
    } else if (item.url) {
        url = item.url;
    }

    if (url || item.address) {
        html += '<div class="drawer-actions">';
        if (url) html += `<button class="drawer-btn drawer-btn-primary" onclick="window.open('${escapeHtml(url)}', '_blank')">Visit Website</button>`;
        if (item.address) {
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
            html += `<button class="drawer-btn drawer-btn-secondary" onclick="window.open('${mapsUrl}', '_blank')">Open in Google Maps</button>`;
        }
        html += '</div>';
    }

    document.getElementById('drawerContent').innerHTML = html;
    document.getElementById('drawerBackdrop').classList.add('active');
    document.getElementById('detailDrawer').classList.add('open');
}

function showSearchDrawer(index) {
    const item = currentResults[index];
    if (!item) return;

    let html = '';
    if (item.photo_url) {
        html += `<div class="drawer-photo" onclick="event.stopPropagation(); openLightbox('${escapeHtml(item.photo_url)}');"><img src="${escapeHtml(item.photo_url)}"></div>`;
    }
    html += `<h1 class="drawer-title">${escapeHtml(item.title)}</h1><div class="drawer-meta">`;
    if (item.distance_km) {
        const dist = item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km';
        html += `<span class="drawer-distance">${dist}</span>`;
    }
    if (item.added_by_name) html += `<span class="drawer-added-by">Added by ${escapeHtml(item.added_by_name)}</span>`;
    html += '</div>';

    let note = item.PersonalNote || item.personal_note || (item.metadata?.personal_note);
    if (note) html += `<div class="drawer-story"><div class="drawer-story-label">Personal Story</div><div class="drawer-story-text">${escapeHtml(note)}</div></div>`;
    if (item.description) html += `<div class="drawer-description">${escapeHtml(item.description)}</div>`;
    if (item.address) html += `<div class="drawer-address">${escapeHtml(item.address)}</div>`;

    let url = item.URL?.[0] || item.url;
    if (url || item.address) {
        html += '<div class="drawer-actions">';
        if (url) html += `<button class="drawer-btn drawer-btn-primary" onclick="window.open('${escapeHtml(url)}', '_blank')">Visit Website</button>`;
        if (item.address) {
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
            html += `<button class="drawer-btn drawer-btn-secondary" onclick="window.open('${mapsUrl}', '_blank')">Open in Google Maps</button>`;
        }
        html += '</div>';
    }

    document.getElementById('drawerContent').innerHTML = html;
    document.getElementById('drawerBackdrop').classList.add('active');
    document.getElementById('detailDrawer').classList.add('open');
}

function closeDrawer() {
    document.getElementById('detailDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('active');
}

function sendMessage(text) {
    const input = document.getElementById('messageInput');
    const query = text || input.value.trim();
    if (!query) return;

    if (isFirstMessage) {
        document.querySelector('.welcome').style.display = 'none';
        isFirstMessage = false;
    }

    const container = document.getElementById('chatContainer');
    container.innerHTML += `<div class="message message-user"><div class="message-bubble">${escapeHtml(query)}</div></div>`;
    container.innerHTML += `<div class="message message-assistant" id="typing"><div class="typing-indicator"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>`;
    container.scrollTop = container.scrollHeight;
    input.value = '';

    sessionMessages.push({
        role: 'user',
        content: query,
        timestamp: Date.now()
    });

    saveRecentSearch(query);

    const body = {
        query,
        session_id: currentSessionId,
        conversation_history: sessionMessages
    };
    if (userLocation.available) {
        body.user_latitude = userLocation.latitude;
        body.user_longitude = userLocation.longitude;
    }

    fetch(SEARCH_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(r => r.json())
    .then(data => {
        document.getElementById('typing').remove();
        if (data.results && data.results.length > 0) {
            currentResults = data.results;

            const getPersonalNote = (r) => {
                if (r.PersonalNote) return r.PersonalNote;
                if (r.personal_note) return r.personal_note;
                if (r.metadata) {
                    try {
                        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
                        return meta.personal_note;
                    } catch (e) {}
                }
                return null;
            };

            const formatDistance = (km) => {
                if (!km) return '';
                return km < 1 ? Math.round(km * 1000) + 'm' : km.toFixed(1) + 'km';
            };

            const buildTopPick = (r, idx) => {
                const photo = r.photo_url ? `<img src="${escapeHtml(r.photo_url)}">` : '<span style="font-size:32px;color:#d1d5db">📍</span>';
                const note = getPersonalNote(r);
                const distText = formatDistance(r.distance_km);
                const snippet = note || r.relevance_reason || r.description || '';

                return `
                    <div class="top-pick-card" onclick="showSearchDrawer(${idx})">
                        <span class="top-pick-badge">🔥 Top Pick</span>
                        <div class="top-pick-photo">${photo}</div>
                        <div class="top-pick-content">
                            <div class="top-pick-title">${escapeHtml(r.title)}</div>
                            <div class="top-pick-meta">
                                ${distText ? `<span class="meta-tag meta-distance">📍 ${distText}</span>` : ''}
                                ${r.added_by_name ? `<span class="meta-tag meta-added-by">by ${escapeHtml(r.added_by_name)}</span>` : ''}
                            </div>
                            ${snippet ? `
                                <div class="top-pick-reason">
                                    <div class="top-pick-reason-label">${note ? '💭 Friend says' : '💡 Why this matches'}</div>
                                    ${escapeHtml(snippet).substring(0, 100)}${snippet.length > 100 ? '...' : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            };

            const buildCompactCard = (r, idx) => {
                const photo = r.photo_url
                    ? `<img src="${escapeHtml(r.photo_url)}">`
                    : '<span class="compact-photo-placeholder">📍</span>';
                const note = getPersonalNote(r);
                const distText = formatDistance(r.distance_km);
                const snippet = note || r.relevance_reason || r.description || '';

                return `
                    <div class="compact-card" onclick="showSearchDrawer(${idx})">
                        <div class="compact-photo">${photo}</div>
                        <div class="compact-title">${escapeHtml(r.title)}</div>
                        <div class="compact-meta">
                            ${distText ? `<span>📍 ${distText}</span>` : ''}
                            ${r.added_by_name ? `<span>• ${escapeHtml(r.added_by_name)}</span>` : ''}
                        </div>
                        ${snippet ? `<div class="compact-snippet">${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>` : ''}
                    </div>
                `;
            };

            let html = `<div class="message message-assistant"><div class="message-content">Found ${data.results.length} discoveries:</div><div class="results-section">`;

            const topPickCount = data.results.length === 1 ? 1 : Math.min(2, data.results.length);
            html += `
                <div class="top-picks-section">
                    <div class="results-header">
                        <span class="results-header-icon">⭐</span>
                        <span class="results-header-title">Top Picks For You</span>
                    </div>
            `;

            for (let i = 0; i < topPickCount; i++) {
                html += buildTopPick(data.results[i], i);
            }
            html += '</div>';

            const moreResults = data.results.slice(topPickCount);
            const initialShowCount = 4;
            const visibleMore = moreResults.slice(0, initialShowCount);
            const hiddenMore = moreResults.slice(initialShowCount);

            if (moreResults.length > 0) {
                html += `
                    <div class="more-options-section">
                        <div class="results-header">
                            <span class="results-header-icon">✨</span>
                            <span class="results-header-title">More Great Options</span>
                            <span class="results-header-count">${moreResults.length} more</span>
                        </div>
                        <div class="more-options-grid" id="moreOptionsGrid">
                `;

                visibleMore.forEach((r, i) => {
                    html += buildCompactCard(r, i + topPickCount);
                });

                html += '</div>';

                if (hiddenMore.length > 0) {
                    html += `<div class="more-options-grid hidden-results" id="hiddenResults" style="display:none;margin-top:12px;">`;
                    hiddenMore.forEach((r, i) => {
                        html += buildCompactCard(r, i + topPickCount + initialShowCount);
                    });
                    html += '</div>';
                    html += `<button class="show-more-btn" onclick="toggleMoreResults(this)">Show ${hiddenMore.length} more results</button>`;
                }

                html += '</div>';
            }

            html += '</div>';

            const mapId = 'searchMap_' + Date.now();
            html += `</div><div class="search-map-container">
                <div id="${mapId}" style="width:100%;height:100%;"></div>
            </div>`;

            container.innerHTML += html;
            container.scrollTop = container.scrollHeight;
            setTimeout(() => initSearchMap(mapId, currentResults), 100);

            sessionMessages.push({
                role: 'assistant',
                content: `Found ${data.results.length} results`,
                results: data.results.map(r => ({ title: r.title, id: r.id })),
                timestamp: Date.now()
            });

        } else {
            const responseText = data.text || 'No results';
            container.innerHTML += `<div class="message message-assistant"><div class="message-content">${escapeHtml(responseText)}</div></div>`;

            sessionMessages.push({
                role: 'assistant',
                content: responseText,
                timestamp: Date.now()
            });
        }
        container.scrollTop = container.scrollHeight;
    })
    .catch(() => {
        document.getElementById('typing').remove();
        container.innerHTML += `<div class="message message-assistant"><div class="message-content">Error searching</div></div>`;
    });
}

function initSearchMap(mapId, results) {
    const mapEl = document.getElementById(mapId);
    if (!mapEl) return;

    const located = results.filter(r => r.latitude && r.longitude);
    if (located.length === 0) return;

    searchMap = L.map(mapId);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(searchMap);

    const bounds = [];
    located.forEach((r, i) => {
        const lat = parseFloat(r.latitude);
        const lng = parseFloat(r.longitude);
        if (isNaN(lat) || isNaN(lng)) return;
        bounds.push([lat, lng]);
        L.marker([lat, lng]).addTo(searchMap).bindTooltip(`<strong>${escapeHtml(r.title)}</strong>`).on('click', () => showSearchDrawer(i));
    });

    if (userLocation.available) {
        L.circleMarker([userLocation.latitude, userLocation.longitude], {
            radius: 8, fillColor: '#059669', color: '#fff', weight: 2, fillOpacity: 0.8
        }).addTo(searchMap).bindTooltip('You are here');
        bounds.push([userLocation.latitude, userLocation.longitude]);
    }

    if (bounds.length > 0) searchMap.fitBounds(bounds, { padding: [30, 30] });
}

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function startNewSession() {
    currentSessionId = generateSessionId();
    sessionMessages = [];

    const container = document.getElementById('chatContainer');
    container.innerHTML = `
        <div class="welcome">
            <h2>What are you looking for?</h2>
            <p>Search your friends' best discoveries</p>
            <div class="suggestions">
                <span class="suggestion-chip" onclick="sendMessage('Good coffee shop for working')">Good coffee shop for working</span>
                <span class="suggestion-chip" onclick="sendMessage('Good Italian restaurant')">Good Italian restaurant</span>
                <span class="suggestion-chip" onclick="sendMessage('where is the place we went for sushi near Mission Bay last time')">where is the place we went for sushi near Mission Bay last time</span>
                <span class="suggestion-chip" onclick="sendMessage('同啲小朋友去邊度好？')">同啲小朋友去邊度好？</span>
                <span class="suggestion-chip" onclick="sendMessage('上次Sunny講過食船麵嗰間嘢喺邊？')">上次Sunny講過食船麵嗰間嘢喺邊？</span>
                <span class="suggestion-chip" onclick="sendMessage('Stanley話係Queenstown邊度買生日蛋糕？')">Stanley話係Queenstown邊度買生日蛋糕？</span>
            </div>
        </div>
    `;

    isFirstMessage = true;
    currentResults = [];
    document.getElementById('messageInput').value = '';
    console.log('New session started:', currentSessionId);
}

async function submitDiscovery(e) {
    e.preventDefault();
    
    if (!currentUser) {
        alert('Please login first');
        return;
    }
    
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    let photoBase64 = null;
    const photoFile = document.getElementById('photo').files[0];
    if (photoFile) {
        photoBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(photoFile);
        });
    }

    const payload = {
        title: document.getElementById('title').value.trim(),
        description: document.getElementById('description').value.trim(),
        personalNote: document.getElementById('personalNote').value.trim() || null,
        type: document.getElementById('category').value,
        addedBy: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
        address: document.getElementById('address').value.trim() || null,
        url: document.getElementById('url').value.trim() || null,
        UserID: currentUser.id,
        familyId: '37ae9f84-2d1d-4930-9765-f6f8991ae053',
        photo: photoBase64,
        photoFilename: photoFile ? photoFile.name : null
    };

    try {
        const res = await fetch(CAPTURE_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            document.getElementById('formMessage').innerHTML = '<div class="success-msg">Discovery saved!</div>';
            document.getElementById('addForm').reset();
            setTimeout(() => setMode('discover'), 2000);
        } else {
            throw new Error('Failed');
        }
    } catch (err) {
        document.getElementById('formMessage').innerHTML = `<div class="error-msg">Error: ${err.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Discovery';
    }
}

document.getElementById('photo').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('previewImg').src = e.target.result;
            document.getElementById('photoPreview').style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
});

function saveRecentSearch(query) {
    try {
        let searches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
        searches = [query, ...searches.filter(s => s !== query)].slice(0, 5);
        localStorage.setItem('recentSearches', JSON.stringify(searches));
        loadRecentSearches();
    } catch (e) {}
}

function loadRecentSearches() {
    try {
        const searches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
        document.getElementById('recentSearches').innerHTML = searches.map(s =>
            `<span class="recent-search-chip" onclick="applyRecentSearch('${escapeHtml(s)}')">${escapeHtml(s)}</span>`
        ).join('');
    } catch (e) {}
}

function applyRecentSearch(query) {
    document.getElementById('discoverSearch').value = query;
    handleSearchInput();
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

function toggleMoreResults(btn) {
    const hidden = document.getElementById('hiddenResults');
    if (hidden) {
        if (hidden.style.display === 'none') {
            hidden.style.display = 'grid';
            btn.textContent = 'Show less';
        } else {
            hidden.style.display = 'none';
            const count = hidden.querySelectorAll('.compact-card').length;
            btn.textContent = `Show ${count} more results`;
        }
    }
}