// ===== SUPABASE CLIENT INITIALIZATION =====
const SUPABASE_URL = 'https://hedywkwmgkvojujvczqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlZHl3a3dtZ2t2b2p1anZjenFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2Mzg0OTMsImV4cCI6MjA3MjIxNDQ5M30.WdGHwr40REynSkC3T3t2nB97FsAH3M0NOE9gv_bLQA8';

// Verify Supabase SDK loaded
if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
    console.error('Supabase SDK failed to load');
    document.addEventListener('DOMContentLoaded', () => {
        const msg = document.getElementById('authMessage');
        if (msg) {
            msg.className = 'auth-message error';
            msg.textContent = 'App failed to load. Please refresh the page.';
            msg.style.display = 'block';
        }
    });
}

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== AUTHENTICATION =====
let currentUser = null;

// --- Core Auth Functions ---

async function checkAuth() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
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
    } catch (err) {
        console.error('Auth check failed:', err);
        showLoginScreen();
    }
}

function showLoginScreen() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
}

async function showMainApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';

    // Load profile from profiles table
    await loadUserProfile();

    const userName = currentProfile?.display_name ||
                     currentUser?.user_metadata?.full_name ||
                     currentUser?.email?.split('@')[0] ||
                     'User';
    console.log('Logged in as:', userName);

    // Auto-fill the "Added by" field
    const addedByField = document.getElementById('addedBy');
    if (addedByField) {
        addedByField.value = userName;
    }

    // Set avatar initial in header
    updateAvatarInitials(userName);
}

async function handleLogout() {
    const { error } = await supabaseClient.auth.signOut();
    if (!error) {
        currentUser = null;
        showLoginScreen();
    }
}

// --- Auth UI Helpers ---

function showAuthMode(mode) {
    const signInTab = document.getElementById('signInTab');
    const createAccountTab = document.getElementById('createAccountTab');
    const signInForm = document.getElementById('signInForm');
    const createAccountForm = document.getElementById('createAccountForm');

    clearAuthMessage();

    if (mode === 'signin') {
        signInTab.classList.add('active');
        createAccountTab.classList.remove('active');
        signInForm.style.display = 'flex';
        createAccountForm.style.display = 'none';
    } else {
        signInTab.classList.remove('active');
        createAccountTab.classList.add('active');
        signInForm.style.display = 'none';
        createAccountForm.style.display = 'flex';
    }
}

function showAuthError(message) {
    const el = document.getElementById('authMessage');
    el.className = 'auth-message error';
    el.textContent = message;
    el.style.display = 'block';
}

function showAuthSuccess(message) {
    const el = document.getElementById('authMessage');
    el.className = 'auth-message success';
    el.textContent = message;
    el.style.display = 'block';
}

function showAuthInfo(message) {
    const el = document.getElementById('authMessage');
    el.className = 'auth-message info';
    el.textContent = message;
    el.style.display = 'block';
}

function clearAuthMessage() {
    const el = document.getElementById('authMessage');
    if (el) el.style.display = 'none';
}

function setButtonLoading(btn, loadingText) {
    if (!btn) return;
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="auth-spinner"></span> ' + loadingText;
}

function resetButton(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || 'Submit';
}

function resetGoogleButton(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = '<svg class="google-icon" width="18" height="18" viewBox="0 0 18 18">' +
        '<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>' +
        '<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>' +
        '<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>' +
        '<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>' +
        '</svg> Continue with Google';
}

// --- Google OAuth ---

async function handleGoogleLogin() {
    try {
        const btn = document.getElementById('googleAuthBtn');
        setButtonLoading(btn, 'Connecting...');
        clearAuthMessage();

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.href.split('?')[0].split('#')[0]
            }
        });

        if (error) {
            showAuthError('Google sign-in failed: ' + error.message);
            resetGoogleButton(btn);
        }
    } catch (err) {
        console.error('Google login error:', err);
        showAuthError('Unable to connect to Google. Please try again.');
        resetGoogleButton(document.getElementById('googleAuthBtn'));
    }
}

// --- Email/Password Sign In ---

async function handleEmailSignIn(event) {
    event.preventDefault();
    clearAuthMessage();

    const email = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    const btn = document.getElementById('signInBtn');

    if (!email || !password) {
        showAuthError('Please enter both email and password.');
        return;
    }

    setButtonLoading(btn, 'Signing in...');

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            if (error.message.includes('Invalid login credentials')) {
                showAuthError('Incorrect email or password. Please try again.');
            } else if (error.message.includes('Email not confirmed')) {
                showAuthInfo('Please check your email and confirm your account before signing in.');
            } else {
                showAuthError(error.message);
            }
            resetButton(btn);
            return;
        }

        currentUser = data.user;
        showMainApp();
    } catch (err) {
        console.error('Sign in error:', err);
        showAuthError('An unexpected error occurred. Please try again.');
        resetButton(btn);
    }
}

// --- Email/Password Sign Up ---

async function handleEmailSignUp(event) {
    event.preventDefault();
    clearAuthMessage();

    const name = document.getElementById('signUpName').value.trim();
    const email = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;
    const passwordConfirm = document.getElementById('signUpPasswordConfirm').value;
    const btn = document.getElementById('signUpBtn');

    if (!name) { showAuthError('Please enter your name.'); return; }
    if (!email) { showAuthError('Please enter your email address.'); return; }
    if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }
    if (password !== passwordConfirm) {
        showAuthError('Passwords do not match.');
        document.getElementById('signUpPasswordConfirm').classList.add('field-error');
        return;
    }

    setButtonLoading(btn, 'Creating account...');

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: { full_name: name },
                emailRedirectTo: window.location.href.split('?')[0].split('#')[0]
            }
        });

        if (error) {
            if (error.message.includes('already registered')) {
                showAuthError('An account with this email already exists. Please sign in instead.');
            } else {
                showAuthError(error.message);
            }
            resetButton(btn);
            return;
        }

        if (data.user && data.user.identities && data.user.identities.length === 0) {
            showAuthError('An account with this email already exists. Please sign in instead.');
            resetButton(btn);
            return;
        }

        if (data.session) {
            currentUser = data.user;
            showMainApp();
        } else {
            showAuthSuccess('Account created! Please check your email to confirm your account, then sign in.');
            resetButton(btn);
            setTimeout(() => showAuthMode('signin'), 3000);
        }
    } catch (err) {
        console.error('Sign up error:', err);
        showAuthError('An unexpected error occurred. Please try again.');
        resetButton(btn);
    }
}

// --- Password Reset ---

async function handleForgotPassword() {
    const email = document.getElementById('signInEmail').value.trim();

    if (!email) {
        showAuthInfo('Enter your email address above, then click "Forgot password?" again.');
        document.getElementById('signInEmail').focus();
        return;
    }

    clearAuthMessage();

    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.href.split('?')[0].split('#')[0]
        });

        if (error) {
            showAuthError(error.message);
            return;
        }

        showAuthSuccess('Password reset email sent! Please check your inbox.');
    } catch (err) {
        console.error('Password reset error:', err);
        showAuthError('Unable to send reset email. Please try again.');
    }
}

// --- Auth State Listener ---

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
        currentUser = session.user;
        showMainApp();
    } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        showLoginScreen();
    }
});

// Clear field-error styling when user types
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('field-error')) {
        e.target.classList.remove('field-error');
    }
});

// Check auth on page load
checkAuth();

// ===== END AUTHENTICATION =====

// ===== PROFILE MANAGEMENT =====
let currentProfile = null;

async function loadUserProfile() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (error && error.code === 'PGRST116') {
            // Profile doesn't exist yet, create it
            const fallbackName = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User';
            const { data: newProfile } = await supabaseClient
                .from('profiles')
                .insert({
                    id: currentUser.id,
                    email: currentUser.email,
                    name: fallbackName,
                    display_name: fallbackName,
                    avatar_url: currentUser.user_metadata?.avatar_url || null,
                    family_id: '37ae9f84-2d1d-4930-9765-f6f8991ae053',
                    role: 'member'
                })
                .select()
                .single();
            currentProfile = newProfile;
        } else if (data) {
            currentProfile = data;
        }
    } catch (err) {
        console.error('Error loading profile:', err);
    }
}

function updateAvatarInitials(name) {
    const initial = (name || '?').charAt(0).toUpperCase();
    const headerAvatar = document.getElementById('profileAvatarInitial');
    if (headerAvatar) headerAvatar.textContent = initial;
}

async function loadProfilePage() {
    if (!currentUser || !currentProfile) return;

    const name = currentProfile.display_name || '';
    document.getElementById('profileDisplayName').textContent = name;
    document.getElementById('profileEmail').textContent = currentUser.email || '';
    document.getElementById('profileNameInput').value = name;
    document.getElementById('profileBioInput').value = currentProfile.bio || '';

    const largeInitial = document.getElementById('profileAvatarLargeInitial');
    if (largeInitial) largeInitial.textContent = (name || '?').charAt(0).toUpperCase();

    // Load stats
    try {
        const { count: discoveryCount } = await supabaseClient
            .from('knowledge_items')
            .select('*', { count: 'exact', head: true })
            .eq('added_by', currentUser.id);
        document.getElementById('profileDiscoveryCount').textContent = discoveryCount || 0;

        const { count: endorsementCount } = await supabaseClient
            .from('endorsements')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', currentUser.id);
        document.getElementById('profileEndorsementCount').textContent = endorsementCount || 0;
    } catch (err) {
        console.error('Error loading profile stats:', err);
    }

    // Load endorsed items
    await loadMyEndorsements();
}

async function loadMyEndorsements() {
    const container = document.getElementById('myEndorsementsList');
    if (!container || !currentUser) return;

    try {
        const { data, error } = await supabaseClient
            .from('endorsements')
            .select('item_id, created_at')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error || !data || data.length === 0) {
            container.innerHTML = '<p class="my-endorsements-empty">No +1s yet. Explore and +1 discoveries you love!</p>';
            return;
        }

        // Fetch the actual items
        const itemIds = data.map(e => e.item_id);
        const { data: items } = await supabaseClient
            .from('knowledge_items')
            .select('id, title, photo_url, added_by_name, type')
            .in('id', itemIds);

        if (!items || items.length === 0) {
            container.innerHTML = '<p class="my-endorsements-empty">No endorsements yet.</p>';
            return;
        }

        // Sort items in same order as endorsements (most recent first)
        const itemMap = {};
        items.forEach(i => { itemMap[i.id] = i; });
        const sorted = data.map(e => itemMap[e.item_id]).filter(Boolean);

        container.innerHTML = sorted.map(item => {
            const photo = item.photo_url
                ? `<img src="${escapeHtml(item.photo_url)}">`
                : '<span class="my-endorse-placeholder">📍</span>';
            return `<div class="my-endorse-item" onclick="goToEndorsedItem('${item.id}')">
                <div class="my-endorse-photo">${photo}</div>
                <div class="my-endorse-info">
                    <div class="my-endorse-title">${escapeHtml(item.title)}</div>
                    <div class="my-endorse-meta">${escapeHtml(item.added_by_name || '')} · ${item.type || ''}</div>
                </div>
                <span class="my-endorse-star">+1</span>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('Error loading my endorsements:', err);
    }
}

function goToEndorsedItem(itemId) {
    setMode('discover');
    // Wait for discoveries to load, then open the drawer
    setTimeout(() => {
        const index = filteredDiscoveries.findIndex(d => d.id === itemId);
        if (index >= 0) {
            showDrawer(index);
        }
    }, 1000);
}

async function saveProfile(event) {
    event.preventDefault();
    const btn = document.getElementById('saveProfileBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const newName = document.getElementById('profileNameInput').value.trim();
    const newBio = document.getElementById('profileBioInput').value.trim();

    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .update({
                name: newName,
                display_name: newName,
                bio: newBio || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', currentUser.id)
            .select()
            .single();

        if (error) throw error;

        currentProfile = data;
        document.getElementById('profileDisplayName').textContent = newName;
        updateAvatarInitials(newName);

        // Update "Added by" field too
        const addedByField = document.getElementById('addedBy');
        if (addedByField) addedByField.value = newName;

        document.getElementById('profileMessage').innerHTML = '<div class="success-msg">Profile saved!</div>';
        setTimeout(() => { document.getElementById('profileMessage').innerHTML = ''; }, 2000);
    } catch (err) {
        console.error('Error saving profile:', err);
        document.getElementById('profileMessage').innerHTML = '<div class="error-msg">Error saving profile</div>';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Profile';
    }
}

// ===== ENDORSEMENT SYSTEM =====
let endorsementsCache = {}; // { item_id: { count, names, ids, userEndorsed } }

async function loadEndorsementsForItems(items) {
    if (!currentUser || !items || items.length === 0) return;

    const itemIds = items.map(i => i.id).filter(Boolean);
    if (itemIds.length === 0) return;

    try {
        const { data, error } = await supabaseClient.rpc('get_endorsements_for_items', {
            p_item_ids: itemIds
        });

        if (error) {
            console.error('Error loading endorsements:', error);
            // Initialize defaults when RPC unavailable (e.g. before SQL is run)
            itemIds.forEach(id => {
                endorsementsCache[id] = { count: 0, names: [], ids: [], userEndorsed: false };
            });
            return;
        }

        // Reset cache for these items
        itemIds.forEach(id => {
            endorsementsCache[id] = { count: 0, names: [], ids: [], userEndorsed: false };
        });

        if (data) {
            data.forEach(row => {
                endorsementsCache[row.out_item_id] = {
                    count: row.out_count,
                    names: row.out_names || [],
                    ids: row.out_ids || [],
                    userEndorsed: (row.out_ids || []).includes(currentUser.id)
                };
            });
        }
    } catch (err) {
        console.error('Error in loadEndorsementsForItems:', err);
    }
}

async function toggleEndorsement(itemId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!currentUser) return;

    const cached = endorsementsCache[itemId] || { count: 0, names: [], ids: [], userEndorsed: false };

    if (cached.userEndorsed) {
        // Un-endorse
        const { error } = await supabaseClient
            .from('endorsements')
            .delete()
            .eq('user_id', currentUser.id)
            .eq('item_id', itemId);

        if (!error) {
            cached.count = Math.max(0, cached.count - 1);
            cached.userEndorsed = false;
            cached.ids = cached.ids.filter(id => id !== currentUser.id);
            const myName = currentProfile?.display_name || currentUser.user_metadata?.full_name || 'You';
            cached.names = cached.names.filter(n => n !== myName);
        }
    } else {
        // Endorse
        const { error } = await supabaseClient
            .from('endorsements')
            .insert({ user_id: currentUser.id, item_id: itemId });

        if (!error) {
            cached.count += 1;
            cached.userEndorsed = true;
            cached.ids.push(currentUser.id);
            const myName = currentProfile?.display_name || currentUser.user_metadata?.full_name || 'You';
            cached.names.push(myName);
        }
    }

    endorsementsCache[itemId] = cached;

    // Update UI
    updateEndorsementUI(itemId);
}

function updateEndorsementUI(itemId) {
    const cached = endorsementsCache[itemId] || { count: 0, userEndorsed: false };

    // Update all buttons with this item ID
    document.querySelectorAll(`[data-endorse-id="${itemId}"]`).forEach(btn => {
        btn.classList.toggle('endorsed', cached.userEndorsed);
        // Update count badge
        const countEl = btn.querySelector('.plus-one-count') || btn.querySelector('.drawer-plus-one-count');
        if (countEl) countEl.textContent = cached.count > 0 ? cached.count : '';
        // Update drawer button text
        const textEl = btn.querySelector('.drawer-plus-one-text');
        if (textEl) textEl.textContent = cached.userEndorsed ? "+1'd" : '+1';
    });
}

function buildEndorseButton(itemId) {
    const cached = endorsementsCache[itemId] || { count: 0, userEndorsed: false };
    const activeClass = cached.userEndorsed ? ' endorsed' : '';
    const countText = cached.count > 0 ? cached.count : '';

    return `<button class="plus-one-btn${activeClass}" data-endorse-id="${itemId}" onclick="toggleEndorsement('${itemId}', event)" title="+1 this discovery">
        <span class="plus-one-label">+1</span>${countText ? `<span class="plus-one-count">${countText}</span>` : ''}
    </button>`;
}

function buildEndorseSection(itemId) {
    const cached = endorsementsCache[itemId] || { count: 0, names: [], userEndorsed: false };
    const activeClass = cached.userEndorsed ? ' endorsed' : '';

    let namesText = '';
    if (cached.count > 0) {
        const displayNames = cached.names.slice(0, 3);
        if (cached.count <= 3) {
            namesText = displayNames.join(', ') + ' +1\'d this';
        } else {
            namesText = displayNames.join(', ') + ` and ${cached.count - 3} more +1'd this`;
        }
    }

    return `<div class="drawer-endorse-section">
        <button class="drawer-plus-one-btn${activeClass}" data-endorse-id="${itemId}" onclick="toggleEndorsement('${itemId}', event)">
            <span class="drawer-plus-one-text">${cached.userEndorsed ? "+1'd" : '+1'}</span>
            ${cached.count > 0 ? `<span class="drawer-plus-one-count">${cached.count}</span>` : ''}
        </button>
        ${namesText ? `<div class="endorse-names">${escapeHtml(namesText)}</div>` : ''}
    </div>`;
}

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

let filters = { categories: [], users: [], distances: [], endorsed: false, searchText: '' };
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
    document.getElementById('profileMode').classList.add('hidden');
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
    document.getElementById('profileMode').classList.add('hidden');
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
    document.getElementById('profileMode').classList.add('hidden');

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
    } else if (mode === 'profile') {
        document.getElementById('profileMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
        loadProfilePage();
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
    filters.endorsed = document.getElementById('endorsed-mine')?.checked || false;

    const count = filters.categories.length + filters.users.length + filters.distances.length + (filters.endorsed ? 1 : 0);
    const badge = document.getElementById('filterBadge');
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function clearFilters() {
    filters = { categories: [], users: [], distances: [], endorsed: false, searchText: '' };
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
        if (filters.endorsed) {
            const cached = endorsementsCache[item.id];
            if (!cached || !cached.userEndorsed) return false;
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
    if (filters.endorsed) html += `<span class="active-filter-chip">My +1s <span class="active-filter-remove" onclick="removeActiveFilter('endorsed', '')">×</span></span>`;
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
    } else if (type === 'endorsed') {
        filters.endorsed = false;
        const cb = document.getElementById('endorsed-mine');
        if (cb) cb.checked = false;
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
        await loadEndorsementsForItems(data);
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

    const endorseBtn = item.id ? buildEndorseButton(item.id) : '';

    card.innerHTML = `
        <div class="discovery-card-photo">${photo}${endorseBtn}</div>
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

    if (item.id) html += buildEndorseSection(item.id);

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

    if (item.id) html += buildEndorseSection(item.id);

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
    .then(async (data) => {
        document.getElementById('typing').remove();
        if (data.results && data.results.length > 0) {
            currentResults = data.results;
            // Load endorsements for search results
            await loadEndorsementsForItems(currentResults);

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
        addedBy: currentProfile?.display_name || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
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