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

// ===== FOUNDING MEMBERS ACCOUNT =====
const VOUCH_HQ_USER_ID = 'fec29546-cabd-44c7-96c9-4dfa6e952e93';

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
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('mainApp').style.display = 'none';
    // Close auth modal if open (e.g. after sign-out)
    var modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
}

async function showMainApp() {
    // Hide landing page and close auth modal
    document.getElementById('loginScreen').style.display = 'none';
    var authModal = document.getElementById('authModal');
    if (authModal) authModal.classList.remove('open');
    document.body.style.overflow = '';
    document.getElementById('mainApp').style.display = 'block';

    // Load profile from profiles table
    await loadUserProfile();

    const userName = currentProfile?.display_name ||
                     currentUser?.user_metadata?.full_name ||
                     currentUser?.email?.split('@')[0] ||
                     'User';
    console.log('Logged in as:', userName, '| User ID:', currentUser.id);

    // Auto-fill the "Added by" field
    const addedByField = document.getElementById('addedBy');
    if (addedByField) {
        addedByField.value = userName;
    }

    // Set avatar initial in header
    updateAvatarInitials(userName);

    // Start notification polling
    startNotifPolling();

    // Load friends first, then discoveries (discoveries filter by friends)
    await loadFriends();
    loadPendingFriendRequests();

    // Pre-load discoveries so search results can match IDs
    if (allDiscoveries.length === 0) {
        loadDiscoveries();
    }
    loadBlockedUsers();

    // Auto-connect with Vouch HQ for new users
    autoFriendVouchHQ();

    // Show onboarding banner for new users
    checkOnboardingBanner();

    // Navigate to home so header and layout match the Home tab state
    showHome();
}

async function handleLogout() {
    stopNotifPolling();
    const { error } = await supabaseClient.auth.signOut();
    if (!error) {
        currentUser = null;
        currentProfile = null;
        friendsCache = [];
        pendingFriendRequests = [];
        blockedUsersCache = [];
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
        // Only show main app if we're on the login screen (not during token refresh)
        if (document.getElementById('loginScreen').style.display !== 'none') {
            showMainApp();
        }
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

// ===== FRIENDS NETWORK =====
let friendsCache = [];           // Array: { out_friendship_id, out_user_id, out_email, out_display_name, out_avatar_url }
let pendingFriendRequests = [];  // Array: { out_id, out_requester_id, out_requester_name, ... }
let blockedUsersCache = [];      // Array: { out_blocked_user_id, out_display_name }

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
    // Update tab bar avatar
    const tabAvatar = document.getElementById('tabAvatarInitial');
    if (tabAvatar) tabAvatar.textContent = initial;
}

function toggleProfileEdit(show) {
    document.getElementById('profileViewMode').style.display = show ? 'none' : 'block';
    document.getElementById('profileEditMode').style.display = show ? 'block' : 'none';
}

async function loadProfilePage() {
    if (!currentUser || !currentProfile) return;

    // Load notifications list first, then mark as read
    await loadNotifications();

    // Auto-clear notification dot when user opens profile
    try {
        await supabaseClient.rpc('mark_all_notifications_read', { p_user_id: currentUser.id });
    } catch (e) { /* silently ignore */ }
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';

    // Always reset to view mode
    toggleProfileEdit(false);

    const name = currentProfile.display_name || '';
    const nameEl = document.getElementById('profileDisplayName');
    nameEl.textContent = name;
    nameEl.style.color = '#7B2D45';
    document.getElementById('profileEmail').textContent = currentUser.email || '';
    document.getElementById('profileNameInput').value = name;
    document.getElementById('profileBioInput').value = currentProfile.bio || '';

    // Show bio in view mode
    const bioDisplay = document.getElementById('profileBioDisplay');
    if (bioDisplay) {
        bioDisplay.textContent = currentProfile.bio || '';
        bioDisplay.style.display = currentProfile.bio ? 'block' : 'none';
    }

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

    // Load friends network display
    await loadPendingFriendRequests();
    updateFriendsDisplay();
}

async function loadMyEndorsements() {
    const container = document.getElementById('myEndorsementsList');
    if (!container || !currentUser) return;

    try {
        // Get saved/bookmarked items from Supabase (unified endorsements)
        const { data, error } = await supabaseClient
            .from('endorsements')
            .select('item_id, created_at')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });

        const endorsedIds = (data || []).map(e => e.item_id);

        if (endorsedIds.length === 0) {
            container.innerHTML = '<p class="my-endorsements-empty">No saves yet. Bookmark discoveries you like!</p>';
            return;
        }

        // Fetch the actual items
        const { data: items } = await supabaseClient
            .from('knowledge_items')
            .select('id, title, photo_url, added_by_name, type')
            .in('id', endorsedIds);

        if (!items || items.length === 0) {
            container.innerHTML = '<p class="my-endorsements-empty">No saves yet.</p>';
            return;
        }

        // Maintain order from endorsements (most recent first)
        const itemMap = {};
        items.forEach(i => { itemMap[i.id] = i; });
        const sorted = endorsedIds.map(id => itemMap[id]).filter(Boolean);

        container.innerHTML = sorted.map(item => {
            const photo = item.photo_url
                ? `<img src="${escapeHtml(item.photo_url)}">`
                : `<span class="my-endorse-placeholder">${getCategoryEmoji(item.type)}</span>`;
            return `<div class="my-endorse-card" onclick="goToEndorsedItem('${item.id}')">
                <div class="my-endorse-card-photo">${photo}</div>
                <div class="my-endorse-card-title">${escapeHtml(item.title)}</div>
            </div>`;
        }).join('');
        // Update scroll arrows after render
        updateProfileSavesArrows();
        container.removeEventListener('scroll', updateProfileSavesArrows);
        container.addEventListener('scroll', updateProfileSavesArrows);
    } catch (err) {
        console.error('Error loading my endorsements:', err);
    }
}

function scrollProfileSaves(dir) {
    const el = document.getElementById('myEndorsementsList');
    if (el) el.scrollBy({ left: dir * 200, behavior: 'smooth' });
}

function updateProfileSavesArrows() {
    const el = document.getElementById('myEndorsementsList');
    const left = document.getElementById('psSaveLeft');
    const right = document.getElementById('psSaveRight');
    if (!el || !left || !right) return;
    left.style.display = el.scrollLeft > 4 ? 'flex' : 'none';
    right.style.display = el.scrollLeft < el.scrollWidth - el.clientWidth - 4 ? 'flex' : 'none';
}

function goToEndorsedItem(itemId) {
    setMode('discover');
    // Wait for discoveries to load, then open the drawer
    setTimeout(() => {
        const index = filteredDiscoveries.findIndex(d => d.id === itemId);
        if (index >= 0) {
            // Track recently viewed
            var item = filteredDiscoveries[index];
            if (typeof trackRecentlyViewed === 'function' && item) {
                trackRecentlyViewed({ id: item.id, title: item.title, photo_url: item.photo_url, type: item.type });
            }
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
        const nameElSave = document.getElementById('profileDisplayName');
        nameElSave.textContent = newName;
        nameElSave.style.color = '#7B2D45';
        updateAvatarInitials(newName);

        // Update bio display
        const bioDisplay = document.getElementById('profileBioDisplay');
        if (bioDisplay) {
            bioDisplay.textContent = newBio || '';
            bioDisplay.style.display = newBio ? 'block' : 'none';
        }

        // Update "Added by" field too
        const addedByField = document.getElementById('addedBy');
        if (addedByField) addedByField.value = newName;

        // Collapse back to view mode
        toggleProfileEdit(false);
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
            // Milestone: first endorsement
            if (!localStorage.getItem('milestone_first_endorse')) {
                localStorage.setItem('milestone_first_endorse', 'true');
                setTimeout(() => showToast('Your friends will see you endorsed this!'), 300);
            }
        }
    }

    endorsementsCache[itemId] = cached;

    // Update UI
    updateEndorsementUI(itemId);
}

function updateEndorsementUI(itemId) {
    const cached = endorsementsCache[itemId] || { count: 0, userEndorsed: false };
    const friendCount = getFriendSaveCount(itemId);

    // Update card overlay buttons
    document.querySelectorAll(`.react-btn[data-endorse-id="${itemId}"]`).forEach(btn => {
        btn.classList.toggle('endorsed', cached.userEndorsed);
        const svg = btn.querySelector('.bookmark-icon');
        if (svg) {
            svg.setAttribute('fill', cached.userEndorsed ? '#ffffff' : 'none');
            svg.setAttribute('stroke', cached.userEndorsed ? '#ffffff' : '#5a5a5a');
        }
        const countEl = btn.querySelector('.react-count');
        if (countEl) countEl.textContent = friendCount > 0 ? friendCount : '';
    });

    // Update drawer bookmark button
    document.querySelectorAll(`.drawer-bookmark-btn[data-endorse-id="${itemId}"]`).forEach(btn => {
        btn.classList.toggle('active', cached.userEndorsed);
        const label = btn.querySelector('.drawer-bookmark-label');
        if (label) label.textContent = cached.userEndorsed ? 'Saved' : 'Save';
        const svg = btn.querySelector('.bookmark-icon-lg');
        if (svg) svg.setAttribute('fill', cached.userEndorsed ? '#7B2D45' : 'none');
    });
}

function buildEndorseButton(itemId) {
    const cached = endorsementsCache[itemId] || { count: 0, userEndorsed: false };
    const activeClass = cached.userEndorsed ? ' endorsed' : '';
    const friendCount = getFriendSaveCount(itemId);
    const countHtml = friendCount > 0 ? `<span class="react-count">${friendCount}</span>` : '';

    return `<button class="react-btn${activeClass}" data-endorse-id="${itemId}" onclick="toggleEndorsement('${itemId}', event)" title="Save">
        <svg class="bookmark-icon" width="16" height="16" viewBox="0 0 24 24" fill="${cached.userEndorsed ? '#ffffff' : 'none'}" stroke="${cached.userEndorsed ? '#ffffff' : '#5a5a5a'}" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>${countHtml}
    </button>`;
}

// Returns save count filtered to friends + self only (new users see 0)
function getFriendSaveCount(itemId) {
    const cached = endorsementsCache[itemId];
    if (!cached || !cached.ids) return 0;
    const friendIds = new Set(friendsCache.map(f => f.out_user_id));
    if (currentUser) friendIds.add(currentUser.id);
    return cached.ids.filter(id => friendIds.has(id)).length;
}

// ===== SAVE (Bookmark) - now unified with endorsements =====
function isItemSaved(itemId) {
    const cached = endorsementsCache[itemId];
    return cached ? cached.userEndorsed : false;
}

function toggleSaveItem(itemId, event) {
    // Redirect to unified bookmark (endorsement)
    toggleEndorsement(itemId, event);
}

function buildEndorseSection(itemId) {
    const cached = endorsementsCache[itemId] || { count: 0, names: [], ids: [], userEndorsed: false };
    const bookmarkActive = cached.userEndorsed ? ' active' : '';
    const fillColor = cached.userEndorsed ? '#7B2D45' : 'none';
    const strokeColor = '#7B2D45';

    // Only show names and count of friends + self (not global)
    const friendIds = new Set(friendsCache.map(f => f.out_user_id));
    if (currentUser) friendIds.add(currentUser.id);
    const friendNames = [];
    (cached.ids || []).forEach((id, i) => {
        if (friendIds.has(id) && cached.names[i]) {
            friendNames.push(cached.names[i]);
        }
    });

    let namesText = '';
    const friendCount = friendNames.length;
    if (friendCount > 0) {
        const displayNames = friendNames.slice(0, 3);
        if (friendCount <= 3) {
            namesText = displayNames.join(', ') + ' saved this';
        } else {
            namesText = displayNames.join(', ') + ` and ${friendCount - 3} others saved this`;
        }
    }

    return `<div class="drawer-reactions">
        <div class="drawer-bookmark-row">
            <button class="drawer-bookmark-btn${bookmarkActive}" data-endorse-id="${itemId}" onclick="toggleEndorsement('${itemId}', event)">
                <svg class="bookmark-icon-lg" width="22" height="22" viewBox="0 0 24 24" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                <span class="drawer-bookmark-label">${cached.userEndorsed ? 'Saved' : 'Save'}</span>
                ${friendCount > 0 ? `<span class="drawer-bookmark-count">${friendCount}</span>` : ''}
            </button>
        </div>
        ${namesText ? `<div class="endorse-names">${escapeHtml(namesText)}</div>` : ''}
    </div>`;
}

// ===== FRIENDS NETWORK FUNCTIONS =====

function isFriend(userId) {
    if (!userId || !currentUser) return false;
    if (userId === currentUser.id) return true; // always see your own content
    if (isBlocked(userId)) return false;
    return friendsCache.some(f => f.out_user_id === userId);
}

function isBlocked(userId) {
    if (!userId) return false;
    return blockedUsersCache.some(b => b.out_blocked_user_id === userId);
}

async function loadFriends() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient.rpc('get_friends_list', {
            p_user_id: currentUser.id
        });
        if (error) {
            console.error('Error loading friends:', error);
            friendsCache = [];
            return;
        }
        friendsCache = data || [];
        console.log('Friends loaded:', friendsCache.length);
    } catch (err) {
        console.error('Error in loadFriends:', err);
        friendsCache = [];
    }
}

async function loadPendingFriendRequests() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient.rpc('get_pending_friend_requests', {
            p_user_id: currentUser.id
        });
        if (error) {
            console.error('Error loading pending requests:', error);
            pendingFriendRequests = [];
            return;
        }
        pendingFriendRequests = data || [];
    } catch (err) {
        console.error('Error in loadPendingFriendRequests:', err);
        pendingFriendRequests = [];
    }
}

async function loadBlockedUsers() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient.rpc('get_blocked_users', {
            p_user_id: currentUser.id
        });
        if (error) {
            console.error('Error loading blocked users:', error);
            blockedUsersCache = [];
            return;
        }
        blockedUsersCache = data || [];
    } catch (err) {
        console.error('Error in loadBlockedUsers:', err);
        blockedUsersCache = [];
    }
}

async function handleRemoveFriend(friendshipId, friendName) {
    if (!confirm(`Remove ${friendName} from your friends?`)) return;
    try {
        const { data, error } = await supabaseClient.rpc('remove_friend', {
            p_friendship_id: friendshipId
        });
        if (error) {
            console.error('Error removing friend:', error);
            showToast('Could not remove friend. Try again.');
            return;
        }
        showToast(`${friendName} removed from friends`);
        await loadFriends();
        updateFriendsDisplay();
    } catch (err) {
        console.error('Error in handleRemoveFriend:', err);
    }
}

async function handleBlockUser(userId, userName) {
    if (!confirm(`Block ${userName}? They won't be able to see your content or find you.`)) return;
    try {
        const { data, error } = await supabaseClient.rpc('block_user', {
            p_blocked_user_id: userId
        });
        if (error) {
            console.error('Error blocking user:', error);
            showToast('Could not block user. Try again.');
            return;
        }
        showToast(`${userName} has been blocked`);
        await Promise.all([loadFriends(), loadBlockedUsers()]);
        updateFriendsDisplay();
    } catch (err) {
        console.error('Error in handleBlockUser:', err);
    }
}

async function searchProfiles(query) {
    if (!query || query.length < 2) return [];
    try {
        const { data, error } = await supabaseClient.rpc('search_profiles', {
            p_search_query: query
        });
        if (error) {
            console.error('Error searching profiles:', error);
            return [];
        }
        return data || [];
    } catch (err) {
        console.error('Error in searchProfiles:', err);
        return [];
    }
}

let friendSearchTimeout;
async function handleFriendSearchInput(event) {
    const query = event.target.value.trim();
    const resultsDiv = document.getElementById('friendSearchResults');
    clearTimeout(friendSearchTimeout);

    if (query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }

    friendSearchTimeout = setTimeout(async () => {
        const results = await searchProfiles(query);

        if (results.length === 0) {
            resultsDiv.innerHTML = '<div class="friend-search-empty">No results found</div>';
        } else {
            let html = '';
            for (const profile of results) {
                const initial = (profile.out_display_name || '?').charAt(0).toUpperCase();
                const alreadyFriend = isFriend(profile.out_id);
                const isPending = pendingFriendRequests.some(r => r.out_requester_id === profile.out_id);

                let statusHtml = '';
                if (alreadyFriend) {
                    statusHtml = '<span class="search-result-status added">Friends</span>';
                } else if (isPending) {
                    statusHtml = '<span class="search-result-status pending">Pending</span>';
                } else {
                    statusHtml = `<div class="search-result-action"><button class="add-friend-btn" onclick="event.stopPropagation(); handleSendFriendRequest('${profile.out_id}', this)">Add Friend</button></div>`;
                }

                html += `<div class="search-result-item">
                    <div class="search-result-avatar">${initial}</div>
                    <div class="search-result-info">
                        <div class="search-result-name">${escapeHtml(profile.out_display_name || 'Unknown')}</div>
                        <div class="search-result-email">${escapeHtml(profile.out_email || '')}</div>
                    </div>
                    ${statusHtml}
                </div>`;
            }
            resultsDiv.innerHTML = html;
        }
        resultsDiv.style.display = 'block';
    }, 300);
}

async function handleSendFriendRequest(receiverId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
        const { data, error } = await supabaseClient.rpc('send_friend_request', {
            p_receiver_id: receiverId
        });
        if (error) {
            console.error('Error sending friend request:', error);
            if (btn) { btn.disabled = false; btn.textContent = 'Add Friend'; }
            return;
        }
        if (data && data.length > 0 && data[0].out_success) {
            // Check if this was auto-accepted (Founding Members)
            if (receiverId === VOUCH_HQ_USER_ID) {
                if (btn) { btn.textContent = 'Added!'; btn.classList.add('sent'); }
                showToast('Founding Members added! Their discoveries are now visible.');
                await loadFriends();
                await loadPendingRequests();
                renderFriendsUI();
            } else {
                if (btn) { btn.textContent = 'Sent!'; btn.classList.add('sent'); }
                showToast('Friend request sent!');
            }
            // Clear search bar and hide results after a short delay
            setTimeout(() => {
                const searchInput = document.getElementById('friendSearchInput');
                const resultsDiv = document.getElementById('friendSearchResults');
                if (searchInput) searchInput.value = '';
                if (resultsDiv) { resultsDiv.innerHTML = ''; resultsDiv.style.display = 'none'; }
            }, 800);
        } else {
            const msg = data?.[0]?.out_message || 'Could not send request';
            if (btn) { btn.disabled = false; btn.textContent = msg; }
        }
    } catch (err) {
        console.error('Error in handleSendFriendRequest:', err);
        if (btn) { btn.disabled = false; btn.textContent = 'Add Friend'; }
    }
}

async function handleAcceptFriendRequest(friendshipId) {
    try {
        const { data, error } = await supabaseClient.rpc('accept_friend_request', {
            p_friendship_id: friendshipId
        });
        if (error) {
            console.error('Error accepting friend request:', error);
            return;
        }
        if (data && data.length > 0 && data[0].out_success) {
            await loadFriends();
            await loadPendingFriendRequests();
            updateFriendsDisplay();
            checkUnreadNotifications();
            // Milestone: first friend accepted
            if (!localStorage.getItem('milestone_first_friend')) {
                localStorage.setItem('milestone_first_friend', 'true');
                setTimeout(() => showToast('You can now see each other\'s personal stories!'), 300);
            }
        }
    } catch (err) {
        console.error('Error in handleAcceptFriendRequest:', err);
    }
}

async function handleRejectFriendRequest(friendshipId) {
    try {
        const { data, error } = await supabaseClient.rpc('reject_friend_request', {
            p_friendship_id: friendshipId
        });
        if (error) {
            console.error('Error rejecting friend request:', error);
            return;
        }
        if (data && data.length > 0 && data[0].out_success) {
            await loadPendingFriendRequests();
            updateFriendsDisplay();
        }
    } catch (err) {
        console.error('Error in handleRejectFriendRequest:', err);
    }
}

function updateFriendsDisplay() {
    const requestsContainer = document.getElementById('pendingRequestsContainer');
    const friendsContainer = document.getElementById('friendsListContainer');
    const emptyState = document.getElementById('friendsEmptyState');
    if (!requestsContainer || !friendsContainer) return;

    const hasPending = pendingFriendRequests.length > 0;
    const hasFriends = friendsCache.length > 0;

    requestsContainer.style.display = hasPending ? 'block' : 'none';
    friendsContainer.style.display = hasFriends ? 'block' : 'none';
    if (emptyState) emptyState.style.display = (!hasPending && !hasFriends) ? 'block' : 'none';

    // Render pending requests
    if (hasPending) {
        const list = document.getElementById('pendingRequestsList');
        if (list) {
            list.innerHTML = pendingFriendRequests.map(req => {
                const initial = (req.out_requester_name || '?').charAt(0).toUpperCase();
                const timeAgo = getTimeAgo(req.out_created_at);
                return `<div class="friend-request-card">
                    <div class="friend-request-avatar">${initial}</div>
                    <div class="friend-request-info">
                        <div class="friend-request-name">${escapeHtml(req.out_requester_name || 'Unknown')}</div>
                        <div class="friend-request-time">${timeAgo}</div>
                    </div>
                    <div class="friend-request-actions">
                        <button class="accept-btn" onclick="handleAcceptFriendRequest('${req.out_id}')">Accept</button>
                        <button class="reject-btn" onclick="handleRejectFriendRequest('${req.out_id}')">Reject</button>
                    </div>
                </div>`;
            }).join('');
        }
    }

    // Render friends list
    if (hasFriends) {
        const list = document.getElementById('friendsList');
        if (list) {
            list.innerHTML = friendsCache.filter(f => f.out_display_name).map(f => {
                const initial = (f.out_display_name || '?').charAt(0).toUpperCase();
                const fId = f.out_friendship_id || '';
                const fName = escapeHtml(f.out_display_name || 'Unknown');
                const uId = f.out_user_id || '';
                return `<div class="friend-card" onclick="openFriendProfile('${uId}', '${fName}')">
                    <div class="friend-card-menu-btn" onclick="event.stopPropagation(); toggleFriendMenu('${fId}')">&#8942;</div>
                    <div class="friend-card-menu" id="friendMenu_${fId}" style="display:none;">
                        <button onclick="event.stopPropagation(); handleRemoveFriend('${fId}', '${fName}')">Remove</button>
                        <button onclick="event.stopPropagation(); handleBlockUser('${uId}', '${fName}')">Block</button>
                    </div>
                    <div class="friend-card-avatar">${initial}</div>
                    <div class="friend-card-info">
                        <div class="friend-card-name">${fName}</div>
                        <div class="friend-card-common" id="commonSaves_${uId}"></div>
                    </div>
                </div>`;
            }).join('');
            // Fetch common saves counts in background
            loadCommonSavesCounts();
        }
    }
}

async function loadCommonSavesCounts() {
    if (!currentUser || friendsCache.length === 0) return;
    try {
        // Get current user's endorsed item IDs
        const { data: myEndorsements } = await supabaseClient
            .from('endorsements')
            .select('item_id')
            .eq('user_id', currentUser.id);

        if (!myEndorsements || myEndorsements.length === 0) return;
        const myItemIds = new Set(myEndorsements.map(e => e.item_id));

        // For each friend, get their endorsed item IDs and count overlap
        const friendIds = friendsCache.map(f => f.out_user_id).filter(Boolean);
        const { data: friendEndorsements } = await supabaseClient
            .from('endorsements')
            .select('user_id, item_id')
            .in('user_id', friendIds);

        if (!friendEndorsements) return;

        // Group by friend and count common
        const commonCounts = {};
        friendEndorsements.forEach(e => {
            if (myItemIds.has(e.item_id)) {
                commonCounts[e.user_id] = (commonCounts[e.user_id] || 0) + 1;
            }
        });

        // Update DOM
        Object.entries(commonCounts).forEach(([userId, count]) => {
            const el = document.getElementById('commonSaves_' + userId);
            if (el && count > 0) {
                el.textContent = count + (count === 1 ? ' save in common' : ' saves in common');
            }
        });
    } catch (err) {
        console.error('Error loading common saves:', err);
    }
}

function toggleFriendMenu(friendshipId) {
    // Close all other menus first
    document.querySelectorAll('.friend-card-menu').forEach(m => {
        if (m.id !== 'friendMenu_' + friendshipId) m.style.display = 'none';
    });
    const menu = document.getElementById('friendMenu_' + friendshipId);
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

// Close friend menus when clicking elsewhere
document.addEventListener('click', () => {
    document.querySelectorAll('.friend-card-menu').forEach(m => m.style.display = 'none');
});

// ===== FRIEND PROFILE DRAWER =====
async function openFriendProfile(userId, displayName) {
    const drawer = document.getElementById('friendProfileDrawer');
    const backdrop = document.getElementById('friendDrawerBackdrop');
    const content = document.getElementById('friendDrawerContent');
    if (!drawer || !content) return;

    const initial = (displayName || '?').charAt(0).toUpperCase();

    content.innerHTML = `
        <div class="friend-profile-header">
            <div class="friend-profile-avatar">${initial}</div>
            <h2 class="friend-profile-name">${escapeHtml(displayName)}</h2>
        </div>
        <div class="friend-profile-loading">Loading discoveries...</div>
    `;

    backdrop.classList.add('active');
    drawer.classList.add('open');

    try {
        // Fetch items added by this friend + common saves in parallel
        const [itemsResult, friendEndorsementsResult, myEndorsementsResult] = await Promise.all([
            supabaseClient
                .from('knowledge_items')
                .select('*')
                .eq('added_by', userId)
                .order('created_at', { ascending: false })
                .limit(50),
            supabaseClient
                .from('endorsements')
                .select('item_id')
                .eq('user_id', userId),
            supabaseClient
                .from('endorsements')
                .select('item_id')
                .eq('user_id', currentUser.id)
        ]);

        if (itemsResult.error) throw itemsResult.error;

        const items = itemsResult.data || [];

        // Find common saves
        const friendItemIds = new Set((friendEndorsementsResult.data || []).map(e => e.item_id));
        const myItemIds = (myEndorsementsResult.data || []).map(e => e.item_id);
        const commonItemIds = myItemIds.filter(id => friendItemIds.has(id));

        // Build common saves section
        let commonHtml = '';
        if (commonItemIds.length > 0) {
            // Fetch the common items details
            const { data: commonItems } = await supabaseClient
                .from('knowledge_items')
                .select('id, title, type, photo_url')
                .in('id', commonItemIds)
                .limit(20);

            if (commonItems && commonItems.length > 0) {
                commonHtml = `<div class="friend-common-section">
                    <div class="friend-common-header">${commonItems.length} save${commonItems.length !== 1 ? 's' : ''} in common</div>
                    <div class="friend-common-list">`;
                commonItems.forEach(ci => {
                    const emoji = getCategoryEmoji(ci.type);
                    const thumb = ci.photo_url
                        ? `<img src="${escapeHtml(ci.photo_url)}" class="friend-common-thumb">`
                        : `<span class="friend-common-emoji">${emoji}</span>`;
                    commonHtml += `<div class="friend-common-chip" onclick="closeFriendDrawer(); setTimeout(() => { const idx = allDiscoveries.findIndex(d => d.id === '${ci.id}'); if (idx >= 0) showDrawer(idx); else openItemDrawer(${JSON.stringify(ci).replace(/'/g, "\\'")}); }, 300);">
                        ${thumb}<span class="friend-common-name">${escapeHtml(ci.title)}</span>
                    </div>`;
                });
                commonHtml += '</div></div>';
            }
        }

        let itemsHtml = '';
        if (items.length === 0) {
            itemsHtml = '';
        } else {
            let listCards = '';
            items.forEach(item => {
                const photo = item.photo_url
                    ? `<img src="${escapeHtml(item.photo_url)}" class="friend-item-photo">`
                    : `<div class="friend-item-photo-placeholder">📍</div>`;
                const typeTag = item.type ? `<span class="friend-item-type">${escapeHtml(item.type)}</span>` : '';
                const desc = item.description ? escapeHtml(item.description).substring(0, 80) + (item.description.length > 80 ? '...' : '') : '';

                listCards += `<div class="friend-item-card" onclick="closeFriendDrawer(); setTimeout(() => { const idx = allDiscoveries.findIndex(d => d.id === '${item.id}'); if (idx >= 0) showDrawer(idx); else openItemDrawer(${JSON.stringify(item).replace(/'/g, "\\'")}); }, 300);">
                    <div class="friend-item-photo-wrap">${photo}</div>
                    <div class="friend-item-info">
                        <div class="friend-item-title">${escapeHtml(item.title)}</div>
                        ${desc ? `<div class="friend-item-desc">${desc}</div>` : ''}
                        ${typeTag}
                    </div>
                </div>`;
            });
            itemsHtml = `<div class="friend-discoveries-toggle">
                <button class="friend-show-discoveries-btn" onclick="this.parentElement.nextElementSibling.style.display='block'; this.parentElement.style.display='none';">
                    Show their ${items.length} discovery${items.length !== 1 ? 'ies' : ''}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
            </div>
            <div class="friend-discoveries-content" style="display:none;">
                <div class="friend-profile-count">${items.length} discovery${items.length !== 1 ? 'ies' : ''}</div>
                <div class="friend-profile-list">${listCards}</div>
            </div>`;
        }

        content.innerHTML = `
            <div class="friend-profile-header">
                <div class="friend-profile-avatar">${initial}</div>
                <h2 class="friend-profile-name">${escapeHtml(displayName)}</h2>
            </div>
            ${commonHtml}
            ${itemsHtml}
        `;
    } catch (err) {
        console.error('Error loading friend profile:', err);
        content.innerHTML += '<div class="friend-profile-empty">Error loading discoveries</div>';
    }
}

function closeFriendDrawer() {
    document.getElementById('friendProfileDrawer').classList.remove('open');
    document.getElementById('friendDrawerBackdrop').classList.remove('active');
}

// ===== COMMUNITY NOTES =====
let currentDrawerItemId = null;

async function loadNotesForItem(itemId) {
    if (!itemId) return [];
    try {
        const { data, error } = await supabaseClient.rpc('get_notes_for_item', {
            p_item_id: itemId
        });
        if (error) {
            console.error('Error loading notes:', error);
            return [];
        }
        return data || [];
    } catch (err) {
        console.error('Error in loadNotesForItem:', err);
        return [];
    }
}

function renderNotesSection(itemId, notes) {
    const notesList = notes.map(n => {
        const initial = (n.out_user_name || '?').charAt(0).toUpperCase();
        const timeAgo = getTimeAgo(n.out_created_at);
        const isOwn = currentUser && n.out_user_id === currentUser.id;
        const editBtn = isOwn ? `<button class="note-edit" onclick="startEditNote('${n.out_id}', '${itemId}', \`${escapeHtml(n.out_note_text).replace(/`/g, '\\`')}\`)" title="Edit">✏️</button>` : '';
        const deleteBtn = isOwn ? `<button class="note-delete" onclick="deleteNote('${n.out_id}', '${itemId}', event)" title="Delete">×</button>` : '';
        return `<div class="note-item" data-note-id="${n.out_id}">
            <div class="note-avatar">${initial}</div>
            <div class="note-body">
                <div class="note-header">
                    <span class="note-author">${escapeHtml(n.out_user_name)}</span>
                    <span class="note-time">${timeAgo}</span>
                    ${editBtn}${deleteBtn}
                </div>
                <div class="note-text">${escapeHtml(n.out_note_text)}</div>
            </div>
        </div>`;
    }).join('');

    return `<div class="community-notes" id="communityNotes">
        <div class="community-notes-label">Comments</div>
        <div class="notes-list" id="notesList">${notesList || '<div class="notes-empty">No comments yet. Be the first!</div>'}</div>
        <div class="note-input-wrap">
            <textarea class="note-input" id="noteInput" placeholder="Leave a comment..." maxlength="500" rows="2"></textarea>
            <button class="note-submit-btn" onclick="submitNote('${itemId}')">Post</button>
        </div>
    </div>`;
}

async function submitNote(itemId) {
    if (!currentUser || !itemId) return;
    const input = document.getElementById('noteInput');
    const text = input.value.trim();
    if (!text) return;
    if (text.length > 500) {
        alert('Note must be 500 characters or less');
        return;
    }

    const userName = currentProfile?.display_name || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User';

    try {
        const { error } = await supabaseClient
            .from('item_notes')
            .insert({
                item_id: itemId,
                user_id: currentUser.id,
                user_name: userName,
                note_text: text
            });

        if (error) {
            console.error('Error submitting note:', error);
            alert('Failed to post note. Please try again.');
            return;
        }

        // Clear input and reload notes
        input.value = '';
        const notes = await loadNotesForItem(itemId);
        const notesList = document.getElementById('notesList');
        if (notesList) {
            notesList.innerHTML = notes.map(n => {
                const initial = (n.out_user_name || '?').charAt(0).toUpperCase();
                const timeAgo = getTimeAgo(n.out_created_at);
                const isOwn = currentUser && n.out_user_id === currentUser.id;
                const deleteBtn = isOwn ? `<button class="note-delete" onclick="deleteNote('${n.out_id}', '${itemId}', event)" title="Delete">×</button>` : '';
                return `<div class="note-item">
                    <div class="note-avatar">${initial}</div>
                    <div class="note-body">
                        <div class="note-header">
                            <span class="note-author">${escapeHtml(n.out_user_name)}</span>
                            <span class="note-time">${timeAgo}</span>
                            ${deleteBtn}
                        </div>
                        <div class="note-text">${escapeHtml(n.out_note_text)}</div>
                    </div>
                </div>`;
            }).join('') || '<div class="notes-empty">No notes yet. Be the first to share!</div>';
        }
    } catch (err) {
        console.error('Error in submitNote:', err);
    }
}

async function deleteNote(noteId, itemId, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    if (!currentUser) return;

    try {
        const { error } = await supabaseClient
            .from('item_notes')
            .delete()
            .eq('id', noteId)
            .eq('user_id', currentUser.id);

        if (!error) {
            // Reload notes
            const notes = await loadNotesForItem(itemId);
            const notesList = document.getElementById('notesList');
            if (notesList) {
                notesList.innerHTML = notes.map(n => {
                    const initial = (n.out_user_name || '?').charAt(0).toUpperCase();
                    const timeAgo = getTimeAgo(n.out_created_at);
                    const isOwn = currentUser && n.out_user_id === currentUser.id;
                    const deleteBtn = isOwn ? `<button class="note-delete" onclick="deleteNote('${n.out_id}', '${itemId}', event)" title="Delete">×</button>` : '';
                    return `<div class="note-item">
                        <div class="note-avatar">${initial}</div>
                        <div class="note-body">
                            <div class="note-header">
                                <span class="note-author">${escapeHtml(n.out_user_name)}</span>
                                <span class="note-time">${timeAgo}</span>
                                ${deleteBtn}
                            </div>
                            <div class="note-text">${escapeHtml(n.out_note_text)}</div>
                        </div>
                    </div>`;
                }).join('') || '<div class="notes-empty">No notes yet. Be the first to share!</div>';
            }
        }
    } catch (err) {
        console.error('Error deleting note:', err);
    }
}

function getTimeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks < 4) return `${diffWeeks}w ago`;
    return date.toLocaleDateString();
}

// ===== NOTIFICATIONS =====
let notifPollInterval = null;
const _NOTIFS_CLEARED_KEY = 'vouch_notifs_cleared_at';
// We store a timestamp in localStorage when user clears all notifications.
// Any notification created BEFORE this timestamp is permanently hidden,
// even if the Supabase delete didn't fully propagate.

async function checkUnreadNotifications() {
    const badge = document.getElementById('notifBadge');
    if (!currentUser) {
        if (badge) badge.style.display = 'none';
        return;
    }
    try {
        // Fetch actual notifications to check if any exist after clearedAt
        const { data, error } = await supabaseClient.rpc('get_user_notifications', {
            p_user_id: currentUser.id,
            p_limit: 1
        });
        if (error) {
            if (badge) badge.style.display = 'none';
            return;
        }
        const clearedAt = localStorage.getItem(_NOTIFS_CLEARED_KEY);
        let hasVisible = false;
        if (data && data.length > 0) {
            if (clearedAt) {
                // Only count notifications created AFTER the clear timestamp
                hasVisible = data.some(n => new Date(n.out_created_at) > new Date(parseInt(clearedAt)));
            } else {
                hasVisible = true;
            }
        }
        if (badge) badge.style.display = hasVisible ? 'block' : 'none';
    } catch (err) {
        console.error('Error in checkUnreadNotifications:', err);
        if (badge) badge.style.display = 'none';
    }
}

function startNotifPolling() {
    // Check immediately
    checkUnreadNotifications();
    // Then poll every 30 seconds
    if (notifPollInterval) clearInterval(notifPollInterval);
    notifPollInterval = setInterval(checkUnreadNotifications, 30000);
}

function stopNotifPolling() {
    if (notifPollInterval) {
        clearInterval(notifPollInterval);
        notifPollInterval = null;
    }
}

async function loadNotifications() {
    if (!currentUser) return;
    const container = document.getElementById('notifItems');
    const section = document.getElementById('notificationsList');
    if (!container || !section) return;

    try {
        const { data, error } = await supabaseClient.rpc('get_user_notifications', {
            p_user_id: currentUser.id,
            p_limit: 20
        });

        if (error) {
            console.error('Error loading notifications:', error);
            return;
        }

        // Filter out notifications created before the last "Clear all"
        const clearedAt = localStorage.getItem(_NOTIFS_CLEARED_KEY);
        let filtered = data || [];
        if (clearedAt) {
            const clearedDate = new Date(parseInt(clearedAt));
            filtered = filtered.filter(n => new Date(n.out_created_at) > clearedDate);
        }

        if (filtered.length === 0) {
            section.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        section.style.display = 'block';
        container.innerHTML = filtered.map(n => {
            let icon = '📝';
            if (n.out_type === 'endorsement') icon = '🙌';
            else if (n.out_type === 'friend_request') icon = '🤝';
            else if (n.out_type === 'friend_accepted') icon = '🎉';
            const timeAgo = getTimeAgo(n.out_created_at);
            const unreadClass = n.out_read ? '' : ' unread';

            // Friend notifications click → go to profile (friend requests section)
            const clickAction = (n.out_type === 'friend_request' || n.out_type === 'friend_accepted')
                ? `handleFriendNotifClick('${n.out_id}')`
                : `handleNotifClick('${n.out_id}', '${n.out_item_id || ''}')`;

            return `<div class="notif-item${unreadClass}" id="notif-${n.out_id}" onclick="${clickAction}">
                <div class="notif-icon">${icon}</div>
                <div class="notif-body">
                    <div class="notif-message">${escapeHtml(n.out_message)}</div>
                    <div class="notif-time">${timeAgo}</div>
                </div>
                <button class="notif-delete" onclick="event.stopPropagation(); deleteNotification('${n.out_id}')" aria-label="Delete notification">&times;</button>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('Error in loadNotifications:', err);
    }
}

async function deleteNotification(notifId) {
    // Remove from DOM immediately
    const el = document.getElementById('notif-' + notifId);
    if (el) {
        el.style.transition = 'opacity 0.2s, transform 0.2s';
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        setTimeout(() => el.remove(), 200);
    }

    // Delete from Supabase
    try {
        await supabaseClient.from('notifications').delete().eq('id', notifId);
    } catch (e) { console.error('Error deleting notification:', e); }

    // Hide section if empty; store cleared timestamp when last one deleted
    setTimeout(() => {
        const container = document.getElementById('notifItems');
        const section = document.getElementById('notificationsList');
        if (container && section && container.children.length === 0) {
            section.style.display = 'none';
            localStorage.setItem(_NOTIFS_CLEARED_KEY, Date.now().toString());
            // Also hide the badge dot
            const badge = document.getElementById('notifBadge');
            if (badge) badge.style.display = 'none';
        }
    }, 250);
}

async function clearAllNotifications() {
    if (!currentUser) return;
    // Store the cleared timestamp permanently — any notification created
    // before this time will never be shown again, even if the DB delete fails
    localStorage.setItem(_NOTIFS_CLEARED_KEY, Date.now().toString());
    const container = document.getElementById('notifItems');
    const section = document.getElementById('notificationsList');

    // Fade out all items
    if (container) {
        Array.from(container.children).forEach((el, i) => {
            el.style.transition = 'opacity 0.2s ' + (i * 0.04) + 's';
            el.style.opacity = '0';
        });
    }

    // Delete all from Supabase (best effort — client-side filter is the safety net)
    try {
        await supabaseClient.from('notifications').delete().eq('user_id', currentUser.id);
    } catch (e) { console.error('Error clearing notifications:', e); }

    setTimeout(() => {
        if (container) container.innerHTML = '';
        if (section) section.style.display = 'none';
    }, 300);

    // Clear badge
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
}

async function handleNotifClick(notifId, itemId) {
    // Mark as read
    try {
        await supabaseClient.rpc('mark_notification_read', {
            p_notification_id: notifId
        });
    } catch (e) { /* ignore */ }

    // Update badge
    checkUnreadNotifications();

    // Open the item if we have an ID
    if (itemId) {
        // Find item in allDiscoveries
        const item = allDiscoveries.find(d => d.id === itemId);
        if (item) {
            openItemDrawer(item);
        } else {
            // Try loading from Supabase directly
            try {
                const { data } = await supabaseClient
                    .from('knowledge_items')
                    .select('*')
                    .eq('id', itemId)
                    .single();
                if (data) openItemDrawer(data);
            } catch (e) { /* ignore */ }
        }
    }
}

async function markAllNotifsRead() {
    if (!currentUser) return;
    try {
        await supabaseClient.rpc('mark_all_notifications_read', {
            p_user_id: currentUser.id
        });
        checkUnreadNotifications();
        // Refresh the list
        loadNotifications();
    } catch (e) { console.error('Error marking all read:', e); }
}

async function handleFriendNotifClick(notifId) {
    // Mark as read
    try {
        await supabaseClient.rpc('mark_notification_read', { p_notification_id: notifId });
    } catch (e) { /* ignore */ }
    checkUnreadNotifications();
    // Navigate to profile page where friend requests are visible
    setMode('profile');
}

// ===== RECENTLY VIEWED =====
function trackRecentlyViewed(item) {
    if (!item || !item.id) return;
    try {
        let viewed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
        // Remove if already exists
        viewed = viewed.filter(v => v.id !== item.id);
        // Add to front
        viewed.unshift({
            id: item.id,
            title: item.title,
            photo_url: item.photo_url || null,
            type: item.type || ''
        });
        // Keep max 10
        viewed = viewed.slice(0, 10);
        localStorage.setItem('recentlyViewed', JSON.stringify(viewed));
    } catch (e) { /* ignore storage errors */ }
}

function renderRecentlyViewed() {
    const section = document.getElementById('recentlyViewedSection');
    const row = document.getElementById('recentlyViewedRow');
    if (!section || !row) return;

    try {
        const viewed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
        if (viewed.length === 0) {
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        row.innerHTML = viewed.map(v => {
            const photo = v.photo_url
                ? `<img src="${escapeHtml(v.photo_url)}" alt="">`
                : `<span class="rv-placeholder">${getCategoryEmoji(v.type)}</span>`;
            return `<div class="rv-item" title="${escapeHtml(v.title)}">
                <div class="rv-thumb-wrap">
                    <div class="rv-thumb" onclick="openRecentlyViewed('${v.id}')">${photo}</div>
                    <button class="rv-remove" onclick="event.stopPropagation(); removeRecentlyViewed('${v.id}')">×</button>
                </div>
                <div class="rv-label" onclick="openRecentlyViewed('${v.id}')">${escapeHtml(v.title.length > 12 ? v.title.slice(0,11) + '…' : v.title)}</div>
            </div>`;
        }).join('');
    } catch (e) {
        section.style.display = 'none';
    }
}

function openRecentlyViewed(itemId) {
    const idx = filteredDiscoveries.findIndex(d => d.id === itemId);
    if (idx >= 0) {
        showDrawer(idx);
    } else {
        // Item might not be in filtered list, search all
        const allIdx = allDiscoveries.findIndex(d => d.id === itemId);
        if (allIdx >= 0) {
            filteredDiscoveries = [allDiscoveries[allIdx]];
            showDrawer(0);
        }
    }
}

function removeRecentlyViewed(itemId) {
    try {
        let viewed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
        viewed = viewed.filter(v => v.id !== itemId);
        localStorage.setItem('recentlyViewed', JSON.stringify(viewed));
        renderRecentlyViewed();
    } catch (e) { /* ignore */ }
}

function getCategoryEmoji(type) {
    const map = { place: '📍', product: '🛍️', service: '🔧', advice: '💡' };
    return map[type] || '📍';
}

// ===== APP CONFIGURATION =====
const SEARCH_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/search123';
const CAPTURE_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/capture';
const TRANSLATE_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/translate-card';

// Minimum relevance score for a result to be shown as a real match.
// Below this = honest "nothing found" state + suggestions instead.
const RELEVANCE_THRESHOLD = 0.28;

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

// ===== TRANSLATION SUPPORT =====
let translationCache = {};

function getPersonalNoteGlobal(r) {
    if (r.PersonalNote) return r.PersonalNote;
    if (r.personal_note) return r.personal_note;
    if (r.metadata) {
        try {
            const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
            return meta.personal_note;
        } catch (e) {}
    }
    return null;
}

async function translateResultFields(idx, targetLang) {
    if (translationCache[idx]) return translationCache[idx];

    const r = currentResults[idx];
    const texts = {};
    // Never translate title — keep original always
    if (r.description) texts.description = r.description;
    // Only include personal note for translation if user has permission
    const note = getPersonalNoteGlobal(r);
    if (note && isFriend(r.added_by)) texts.personal_note = note;

    const resp = await fetch(TRANSLATE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, target_language: targetLang })
    });
    const data = await resp.json();
    // Handle both formats: { translated: {...} } from n8n webhook or flat { title, description, ... }
    const translated = data.translated || data;
    translationCache[idx] = translated;
    return translated;
}

function updateCardContent(card, r, showTranslated, translated) {
    const titleEl = card.querySelector('.top-pick-title');
    const reasonEl = card.querySelector('.top-pick-reason');
    if (showTranslated && translated) {
        // Title always stays original — never translate
        if (reasonEl) {
            const label = reasonEl.querySelector('.top-pick-reason-label');
            const labelHtml = label ? label.outerHTML : '';
            const text = translated.personal_note || translated.description || '';
            reasonEl.innerHTML = labelHtml + escapeHtml(text).substring(0, 100) + (text.length > 100 ? '...' : '');
        }
    } else {
        if (titleEl) titleEl.textContent = r.title;
        if (reasonEl) {
            const label = reasonEl.querySelector('.top-pick-reason-label');
            const labelHtml = label ? label.outerHTML : '';
            const rawNote = getPersonalNoteGlobal(r);
            const canSeeNote = rawNote && typeof isFriend === 'function' && isFriend(r.added_by || r.added_by_name);
            const snippet = canSeeNote ? rawNote : (r.relevance_reason || r.description || '');
            reasonEl.innerHTML = labelHtml + escapeHtml(snippet).substring(0, 100) + (snippet.length > 100 ? '...' : '');
        }
    }
}

async function toggleLang(btn, idx) {
    const r = currentResults[idx];
    const card = btn.closest('.top-pick-card');
    const state = btn.dataset.state;

    if (state === 'translated') {
        btn.dataset.state = 'original';
        btn.textContent = 'Translate 🌐';
        updateCardContent(card, r, false);
    } else {
        btn.textContent = 'Translating...';
        btn.disabled = true;
        try {
            const translated = await translateResultFields(idx, r._queryLanguage);
            updateCardContent(card, r, true, translated);
            btn.dataset.state = 'translated';
            btn.textContent = 'Show original';
        } catch (e) {
            btn.textContent = 'Translation failed — retry';
        }
        btn.disabled = false;
    }
}

async function toggleDrawerLang(btn) {
    const item = currentDrawerItem;
    if (!item) return;
    const idx = currentResults.indexOf(item);
    const state = btn.dataset.state;

    if (state === 'original') {
        btn.textContent = 'Translating...';
        btn.disabled = true;
        try {
            const translated = await translateResultFields(idx, item._queryLanguage);
            // Title always stays original — only translate description + personal note
            const descEl = document.querySelector('.drawer-description');
            const storyEl = document.querySelector('.drawer-story-text');
            if (descEl && translated.description) descEl.textContent = translated.description;
            // Only show translated personal note if user has permission (is a friend)
            const canSeeStory = isFriend(item.added_by);
            if (storyEl && translated.personal_note && canSeeStory) storyEl.textContent = translated.personal_note;
            btn.dataset.state = 'translated';
            btn.textContent = 'Show original';
        } catch (e) {
            btn.textContent = 'Translation failed — retry';
        }
        btn.disabled = false;
    } else {
        // Revert description + personal note to original (title never changes)
        const descEl = document.querySelector('.drawer-description');
        const storyEl = document.querySelector('.drawer-story-text');
        if (descEl) descEl.textContent = item.description || '';
        const note = getPersonalNoteGlobal(item);
        const canSeeStory = isFriend(item.added_by);
        if (storyEl && note && canSeeStory) storyEl.textContent = note;
        btn.dataset.state = 'original';
        btn.textContent = 'Translate 🌐';
    }
}

// Initialize app
initApp();
initLocation();

function initApp() {
    showHome();
}

function showHome() {
    document.getElementById('homePage').classList.remove('hidden');
    document.getElementById('searchMode').classList.add('hidden');
    document.getElementById('discoverMode').classList.add('hidden');
    document.getElementById('inputMode').classList.add('hidden');
    document.getElementById('profileMode').classList.add('hidden');
    var savedEl = document.getElementById('savedMode');
    if (savedEl) savedEl.classList.add('hidden');
    document.getElementById('inputArea').classList.add('hidden');
    updateTabBar('home');
}

function setMode(mode) {
    document.getElementById('homePage').classList.add('hidden');
    document.getElementById('searchMode').classList.add('hidden');
    document.getElementById('discoverMode').classList.add('hidden');
    document.getElementById('inputMode').classList.add('hidden');
    document.getElementById('profileMode').classList.add('hidden');
    var savedEl = document.getElementById('savedMode');
    if (savedEl) savedEl.classList.add('hidden');

    if (mode === 'home') {
        showHome();
        loadNotifications();
    } else if (mode === 'search') {
        document.getElementById('searchMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.remove('hidden');
        if (typeof updateSearchLocBtn === 'function') updateSearchLocBtn();
    } else if (mode === 'discover') {
        document.getElementById('discoverMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
        loadDiscoveries();
    } else if (mode === 'saved') {
        if (savedEl) savedEl.classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
        loadSavedPage();
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
    document.getElementById('discoverTab').classList.remove('active');
    var searchTab = document.getElementById('searchTab');
    if (searchTab) searchTab.classList.remove('active');
    document.getElementById('addTab').classList.remove('active');
    document.getElementById('profileTab').classList.remove('active');

    if (mode === 'home') document.getElementById('homeTab').classList.add('active');
    else if (mode === 'search') { if (searchTab) searchTab.classList.add('active'); }
    else if (mode === 'discover') document.getElementById('discoverTab').classList.add('active');
    else if (mode === 'saved') document.getElementById('profileTab').classList.add('active');
    else if (mode === 'input') document.getElementById('addTab').classList.add('active');
    else if (mode === 'profile') document.getElementById('profileTab').classList.add('active');
}

function initLocation() {
    // locationIndicator element was replaced by the home-loc-pill; guard against null
    const indicator = document.getElementById('locationIndicator');

    if (!navigator.geolocation) {
        if (indicator) { indicator.textContent = '📍 Not supported'; indicator.className = 'location-indicator error'; }
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            userLocation.latitude = position.coords.latitude;
            userLocation.longitude = position.coords.longitude;
            userLocation.available = true;
            if (indicator) { indicator.textContent = '📍 Location on'; indicator.className = 'location-indicator active'; }
        },
        (error) => {
            if (indicator) { indicator.textContent = '📍 Location off'; indicator.className = 'location-indicator error'; }
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
            const isEndorsed = cached && cached.userEndorsed;
            const isSaved = isItemSaved(item.id);
            if (!isEndorsed && !isSaved) return false;
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
    if (filters.endorsed) html += `<span class="active-filter-chip">My Saves <span class="active-filter-remove" onclick="removeActiveFilter('endorsed', '')">×</span></span>`;
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

        // Only show items from the user's friends (and their own items)
        const friendIds = new Set(friendsCache.map(f => f.out_user_id));
        if (currentUser) friendIds.add(currentUser.id);
        data = data.filter(item => item.added_by && friendIds.has(item.added_by));

        // Hide discoveries from blocked users
        if (blockedUsersCache.length > 0) {
            const blockedIds = new Set(blockedUsersCache.map(b => b.out_blocked_user_id));
            data = data.filter(item => !item.added_by || !blockedIds.has(item.added_by));
        }

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
        renderRecentlyViewed();
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

    // Privacy: only show personal note snippet to friends
    let snippet = '';
    let snippetHtml = '';
    if (note && isFriend(item.added_by)) {
        snippet = note;
        snippetHtml = `<div class="discovery-card-snippet">💭 ${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>`;
    } else if (note && !isFriend(item.added_by)) {
        snippetHtml = `<div class="discovery-card-snippet privacy-teaser-card">🔒 Connect to see their story</div>`;
    } else if (item.description) {
        snippet = item.description;
        snippetHtml = `<div class="discovery-card-snippet">${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>`;
    }

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
    openItemDrawer(item);
}

function openItemDrawer(item) {
    currentDrawerItem = item; // Store reference for edit mode
    // Track recently viewed
    trackRecentlyViewed(item);

    let html = '';
    if (item.photo_url) {
        html += `<div class="drawer-photo" onclick="event.stopPropagation(); openLightbox('${escapeHtml(item.photo_url)}');"><img src="${escapeHtml(item.photo_url)}"></div>`;
    }
    // Check if current user owns this item
    const isOwner = currentUser && (item.added_by === currentUser.id);

    html += `<div class="drawer-title-row"><h1 class="drawer-title">${escapeHtml(item.title)}</h1>`;
    if (isOwner) {
        html += `<button class="drawer-edit-btn" onclick="enterEditMode()" title="Edit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7B2D45" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
    }
    html += `</div><div class="drawer-meta">`;
    if (item.distance_km) {
        const dist = item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km';
        html += `<span class="drawer-distance">${dist}</span>`;
    }
    html += `<span class="drawer-added-by">Added by ${escapeHtml(item.added_by_name || 'Community Member')}</span>`;
    html += '</div>';

    // Extract personal note from multiple possible fields
    let note = null;
    if (item.PersonalNote) note = item.PersonalNote;
    else if (item.personal_note) note = item.personal_note;
    else if (item.metadata) {
        try {
            const meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
            note = meta.personal_note;
        } catch (e) {}
    }

    // === SECTION 1: Personal Story (friends-only) ===
    if (note) {
        if (isFriend(item.added_by)) {
            html += `<div class="drawer-story"><div class="drawer-story-label">Personal Story</div><div class="drawer-story-text">${escapeHtml(note)}</div></div>`;
        } else {
            html += `<div class="drawer-story privacy-teaser"><div class="drawer-story-label">Personal Story</div><div class="drawer-story-text">Connect with ${escapeHtml(item.added_by_name || 'them')} to see their personal story</div></div>`;
        }
    }

    // === SECTION 2: Practical Info (description, address, actions) ===
    if (item.description) html += `<div class="drawer-description">${escapeHtml(item.description)}</div>`;

    // Language toggle for non-English queries — under description, above address
    if (item._queryLanguage && item._queryLanguage !== 'en') {
        html += `<button class="lang-toggle-btn drawer-lang-toggle" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">Translate 🌐</button>`;
    }

    if (item.address) html += `<div class="drawer-address">${escapeHtml(item.address)}</div>`;

    // Extract URL from multiple possible fields
    let url = null;
    if (item.URL) {
        if (Array.isArray(item.URL) && item.URL.length > 0) url = item.URL[0];
        else if (typeof item.URL === 'string' && item.URL.startsWith('http')) url = item.URL;
    }
    if (!url && item.url) url = item.url;
    if (!url && item.website) url = item.website;

    if (url || item.address) {
        html += '<div class="drawer-actions">';
        if (url) html += `<button class="drawer-btn drawer-btn-primary" onclick="window.open('${escapeHtml(url)}', '_blank')">Visit Website</button>`;
        if (item.address) {
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
            html += `<button class="drawer-btn drawer-btn-secondary" onclick="window.open('${mapsUrl}', '_blank')">Open in Google Maps</button>`;
        }
        html += '</div>';
    }

    // === SECTION 3: You + Friends (collapsible — reactions + community notes) ===
    if (item.id) {
        currentDrawerItemId = item.id;
        html += `<div class="friends-section">
            <div class="friends-section-toggle" onclick="toggleFriendsSection()">
                <span class="friends-section-title">You + Friends</span>
                <span class="friends-section-arrow" id="friendsSectionArrow">▼</span>
            </div>
            <div class="friends-section-body" id="friendsSectionBody">
                ${buildEndorseSection(item.id)}
                <div id="communityNotesContainer"><div class="notes-loading">Loading notes...</div></div>
            </div>
        </div>`;
    }

    document.getElementById('drawerContent').innerHTML = html;
    document.getElementById('drawerBackdrop').classList.add('active');
    document.getElementById('detailDrawer').classList.add('open');

    // Load community notes asynchronously
    if (item.id) {
        loadNotesForItem(item.id).then(notes => {
            const container = document.getElementById('communityNotesContainer');
            if (container) {
                container.innerHTML = renderNotesSection(item.id, notes);
            }
        });
    }
}

function showSearchDrawer(index) {
    const item = currentResults[index];
    if (!item) return;
    openItemDrawer(item);
}

let currentDrawerItem = null; // Track the item currently open in drawer

function closeDrawer() {
    document.getElementById('detailDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('active');
    currentDrawerItem = null;
}

// ===== EDIT DISCOVERY IN DRAWER =====
function enterEditMode() {
    const item = currentDrawerItem;
    if (!item || !currentUser || item.added_by !== currentUser.id) return;

    // Extract personal note
    let note = item.PersonalNote || item.personal_note || '';
    if (!note && item.metadata) {
        try {
            const meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
            note = meta.personal_note || '';
        } catch (e) {}
    }

    // Extract URL
    let url = '';
    if (item.URL) {
        if (Array.isArray(item.URL) && item.URL.length > 0) url = item.URL[0];
        else if (typeof item.URL === 'string') url = item.URL;
    }
    if (!url && item.url) url = item.url;
    if (!url && item.website) url = item.website || '';

    const categories = ['place', 'product', 'service', 'advice'];
    const currentType = (item.type || 'place').toLowerCase();
    const categoryOptions = categories.map(c =>
        `<option value="${c}"${c === currentType ? ' selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
    ).join('');

    let html = '';
    if (item.photo_url) {
        html += `<div class="drawer-photo"><img src="${escapeHtml(item.photo_url)}"></div>`;
    }

    html += `<div class="edit-form" id="drawerEditForm">
        <label class="edit-label">Title</label>
        <input class="edit-input" id="editTitle" value="${escapeHtml(item.title)}" maxlength="200">

        <label class="edit-label">Description</label>
        <textarea class="edit-textarea" id="editDescription" rows="3" maxlength="1000">${escapeHtml(item.description || '')}</textarea>

        <label class="edit-label">Personal Note</label>
        <textarea class="edit-textarea" id="editNote" rows="2" maxlength="500">${escapeHtml(note)}</textarea>

        <label class="edit-label">Category</label>
        <select class="edit-select" id="editCategory">${categoryOptions}</select>

        <label class="edit-label">Address</label>
        <input class="edit-input" id="editAddress" value="${escapeHtml(item.address || '')}">

        <label class="edit-label">URL</label>
        <input class="edit-input" id="editUrl" value="${escapeHtml(url)}">

        <div class="edit-actions">
            <button class="edit-cancel-btn" onclick="openItemDrawer(currentDrawerItem)">Cancel</button>
            <button class="edit-save-btn" id="editSaveBtn" onclick="saveItemEdit('${item.id}')">Save Changes</button>
        </div>
        <div id="editMessage"></div>
    </div>`;

    document.getElementById('drawerContent').innerHTML = html;
}

async function saveItemEdit(itemId) {
    const item = currentDrawerItem;
    if (!item || !currentUser) return;

    const btn = document.getElementById('editSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const newTitle = document.getElementById('editTitle').value.trim();
    const newDescription = document.getElementById('editDescription').value.trim();
    const newNote = document.getElementById('editNote').value.trim();
    const newCategory = document.getElementById('editCategory').value;
    const newAddress = document.getElementById('editAddress').value.trim();
    const newUrl = document.getElementById('editUrl').value.trim();

    if (!newTitle) {
        document.getElementById('editMessage').innerHTML = '<div class="error-msg">Title is required</div>';
        btn.disabled = false;
        btn.textContent = 'Save Changes';
        return;
    }

    // Check if title or description changed significantly (for re-embedding)
    const oldText = (item.title + ' ' + (item.description || '')).toLowerCase().trim();
    const newText = (newTitle + ' ' + newDescription).toLowerCase().trim();
    const needsReEmbed = oldText !== newText;

    try {
        // Update in Supabase
        const updateData = {
            title: newTitle,
            description: newDescription || null,
            type: newCategory,
            address: newAddress || null,
            URL: newUrl ? [newUrl] : [],
            personal_note: newNote || null
        };

        // Also update metadata.personal_note
        let meta = {};
        if (item.metadata) {
            try {
                meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : { ...item.metadata };
            } catch (e) {}
        }
        meta.personal_note = newNote || null;
        updateData.metadata = meta;

        const { error } = await supabaseClient
            .from('knowledge_items')
            .update(updateData)
            .eq('id', itemId)
            .eq('added_by', currentUser.id);

        if (error) {
            throw new Error(error.message);
        }

        // Update local caches
        Object.assign(item, updateData);
        item.PersonalNote = newNote || null;
        item.personal_note = newNote || null;

        const idx = allDiscoveries.findIndex(d => d.id === itemId);
        if (idx >= 0) Object.assign(allDiscoveries[idx], updateData);

        // If title/description changed, trigger re-embedding via capture webhook
        if (needsReEmbed) {
            console.log('Title/description changed — triggering re-embedding...');
            // Fire-and-forget re-embed call
            fetch(CAPTURE_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_embedding',
                    itemId: itemId,
                    title: newTitle,
                    description: newDescription,
                    personalNote: newNote || null,
                    type: newCategory,
                    UserID: currentUser.id
                })
            }).catch(err => console.warn('Re-embed request failed (non-critical):', err));
        }

        showToast('Discovery updated!');
        // Re-open drawer with updated item
        openItemDrawer(item);

    } catch (err) {
        console.error('Edit save error:', err);
        document.getElementById('editMessage').innerHTML = `<div class="error-msg">Error: ${err.message}</div>`;
        btn.disabled = false;
        btn.textContent = 'Save Changes';
    }
}

// ===== EDIT COMMENT (inline) =====
function startEditNote(noteId, itemId, currentText) {
    const noteEl = document.querySelector(`[data-note-id="${noteId}"] .note-text`);
    if (!noteEl) return;
    noteEl.innerHTML = `<textarea class="note-edit-input" id="noteEdit_${noteId}" maxlength="500" rows="2">${escapeHtml(currentText)}</textarea>
        <div class="note-edit-actions">
            <button class="note-edit-cancel" onclick="cancelEditNote('${noteId}', '${itemId}')">Cancel</button>
            <button class="note-edit-save" onclick="saveEditNote('${noteId}', '${itemId}')">Save</button>
        </div>`;
}

function cancelEditNote(noteId, itemId) {
    // Reload notes to restore original
    loadNotesForItem(itemId).then(notes => {
        const container = document.getElementById('communityNotesContainer');
        if (container) container.innerHTML = renderNotesSection(itemId, notes);
    });
}

async function saveEditNote(noteId, itemId) {
    const input = document.getElementById('noteEdit_' + noteId);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    try {
        const { error } = await supabaseClient
            .from('item_notes')
            .update({ note_text: text })
            .eq('id', noteId)
            .eq('user_id', currentUser.id);

        if (error) throw error;

        const notes = await loadNotesForItem(itemId);
        const container = document.getElementById('communityNotesContainer');
        if (container) container.innerHTML = renderNotesSection(itemId, notes);
        showToast('Comment updated!');
    } catch (err) {
        console.error('Error editing note:', err);
    }
}

function toggleFriendsSection() {
    const body = document.getElementById('friendsSectionBody');
    const arrow = document.getElementById('friendsSectionArrow');
    if (!body) return;
    const isOpen = !body.classList.contains('collapsed');
    if (isOpen) {
        body.classList.add('collapsed');
        if (arrow) arrow.textContent = '▶';
    } else {
        body.classList.remove('collapsed');
        if (arrow) arrow.textContent = '▼';
    }
}

function sendMessage(text) {
    const input = document.getElementById('messageInput');
    const query = text || input.value.trim();
    if (!query) return;

    // Reset translation cache for new search
    translationCache = {};

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

    const body = {
        query,
        session_id: currentSessionId,
        conversation_history: sessionMessages,
        user_id: currentUser ? currentUser.id : null
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
            const queryLanguage = data.query_language || 'en';

            // Tag each result with the query language for translation toggle
            currentResults.forEach(r => { r._queryLanguage = queryLanguage; });

            // Match and enrich search results from allDiscoveries (friends + self only)
            currentResults.forEach(r => {
                // Find match by id first, then fall back to title
                const match = (r.id && allDiscoveries.find(d => d.id === r.id))
                    || allDiscoveries.find(d => d.title === r.title);
                if (match) {
                    // Preserve search-specific fields before merging
                    const relevance_reason = r.relevance_reason;
                    const distance_km = r.distance_km || match.distance_km;
                    const _queryLanguage = r._queryLanguage;
                    const combined_score = r.combined_score;
                    const relevance_score = r.relevance_score;
                    // Merge full Supabase data (adds added_by, personal_note, photo_url etc.)
                    Object.assign(r, match);
                    r.relevance_reason = relevance_reason;
                    if (distance_km) r.distance_km = distance_km;
                    r._queryLanguage = _queryLanguage;
                    r.combined_score = combined_score;
                    r.relevance_score = relevance_score;
                }
            });

            // Filter to friends + self only — no strangers in search results
            currentResults = currentResults.filter(r =>
                r.id && allDiscoveries.find(d => d.id === r.id)
            );

            // Check if top result meets relevance threshold.
            // Signal 1 — drop ratio: if n8n found items but AI dropped most, nothing truly matched.
            const topScore = currentResults.length > 0 ? (currentResults[0].combined_score || 0) : 0;
            const dropRatio = (data.original_count > 3)
                ? ((data.original_count - data.filtered_count) / data.original_count)
                : 0;
            // Signal 2 — safety net: if every result title appears in _debug.dropped_titles,
            // the AI explicitly rejected everything (catches the Merge Response fallback bug).
            const debugDropped = (data._debug && data._debug.dropped_titles) || [];
            const allResultsDropped = currentResults.length > 0
                && currentResults.every(r => debugDropped.includes(r.title));
            const hasRelevantResults = currentResults.length > 0
                && topScore >= RELEVANCE_THRESHOLD
                && dropRatio < 0.7
                && !allResultsDropped;

            // Load endorsements for search results
            await loadEndorsementsForItems(currentResults);

            const getPersonalNote = getPersonalNoteGlobal;

            const formatDistance = (km) => {
                if (!km) return '';
                return km < 1 ? Math.round(km * 1000) + 'm' : km.toFixed(1) + 'km';
            };

            const buildTopPick = (r, idx) => {
                const photo = r.photo_url ? `<img src="${escapeHtml(r.photo_url)}">` : '<span style="font-size:32px;color:#d1d5db">📍</span>';
                const rawNote = getPersonalNote(r);
                const canSeeNote = rawNote && isFriend(r.added_by || r.added_by_name);
                const distText = formatDistance(r.distance_km);
                const snippet = canSeeNote ? rawNote : (r.relevance_reason || r.description || '');
                const snippetLabel = canSeeNote ? '💭 Friend says' : '💡 Why this matches';
                const needsToggle = r._queryLanguage && r._queryLanguage !== 'en';

                return `
                    <div class="top-pick-card" onclick="showSearchDrawer(${idx})">
                        <span class="top-pick-badge">Top Pick</span>
                        <div class="top-pick-photo">${photo}</div>
                        <div class="top-pick-content">
                            <div class="top-pick-title">${escapeHtml(r.title)}</div>
                            <div class="top-pick-meta">
                                ${distText ? `<span class="meta-tag meta-distance">📍 ${distText}</span>` : ''}
                                ${r.added_by_name ? `<span class="meta-tag meta-added-by">by ${escapeHtml(r.added_by_name)}</span>` : ''}
                            </div>
                            ${snippet ? `
                                <div class="top-pick-reason">
                                    <div class="top-pick-reason-label">${snippetLabel}</div>
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
                const rawNote = getPersonalNote(r);
                const canSeeNote = rawNote && isFriend(r.added_by);
                const distText = formatDistance(r.distance_km);
                const snippet = canSeeNote ? rawNote : (r.relevance_reason || r.description || '');
                const snippetIcon = canSeeNote ? '💭' : '';

                return `
                    <div class="compact-card" onclick="showSearchDrawer(${idx})">
                        <div class="compact-photo">${photo}</div>
                        <div class="compact-title">${escapeHtml(r.title)}</div>
                        <div class="compact-meta">
                            ${distText ? `<span>📍 ${distText}</span>` : ''}
                            ${r.added_by_name ? `<span>• ${escapeHtml(r.added_by_name)}</span>` : ''}
                        </div>
                        ${snippet ? `<div class="compact-snippet">${snippetIcon ? snippetIcon + ' ' : ''}${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>` : ''}
                    </div>
                `;
            };

            if (hasRelevantResults) {
                // ── Good matches found — show normal results ──
                let html = `<div class="message message-assistant"><div class="message-content">Found ${currentResults.length} discoveries:</div><div class="results-section">`;

                const topPickCount = currentResults.length === 1 ? 1 : Math.min(2, currentResults.length);
                html += `
                    <div class="top-picks-section">
                        <div class="results-header">
                            <span class="results-header-title">Top Picks For You</span>
                        </div>
                `;

                for (let i = 0; i < topPickCount; i++) {
                    html += buildTopPick(currentResults[i], i);
                }
                html += '</div>';

                const moreResults = currentResults.slice(topPickCount);
                if (moreResults.length > 0) {
                    const scrollId = 'moreScroll_' + Date.now();
                    html += `
                        <div class="more-options-section">
                            <div class="results-header">
                                <span class="results-header-title">More Great Options</span>
                                <span class="results-header-count">${moreResults.length} more</span>
                            </div>
                            <div class="more-options-wrapper">
                                <button class="scroll-arrow scroll-arrow-left" onclick="scrollMoreOptions('${scrollId}',-1)" aria-label="Scroll left">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                                </button>
                                <div class="more-options-scroll" id="${scrollId}">
                    `;
                    moreResults.forEach((r, i) => {
                        html += buildCompactCard(r, i + topPickCount);
                    });
                    html += `</div>
                                <button class="scroll-arrow scroll-arrow-right" onclick="scrollMoreOptions('${scrollId}',1)" aria-label="Scroll right">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                                </button>
                            </div>
                        </div>`;
                }

                html += '</div></div>';
                container.innerHTML += html;
                container.scrollTop = container.scrollHeight;
                var moreScroll = container.querySelector('.more-options-scroll');
                if (moreScroll && moreScroll.id) {
                    setTimeout(function() { updateScrollArrows(moreScroll.id); }, 150);
                    moreScroll.addEventListener('scroll', function() { updateScrollArrows(moreScroll.id); });
                }

                sessionMessages.push({
                    role: 'assistant',
                    content: `Found ${currentResults.length} results`,
                    results: currentResults.map(r => ({ title: r.title, id: r.id })),
                    timestamp: Date.now()
                });

            } else {
                // ── No relevant match — honest message + suggestions + CTA ──
                const buildSuggestionPreview = () => {
                    // Prefer n8n's suggested_results (semantically closest, nearby, with relevance_reason)
                    // Fall back to random allDiscoveries only if nothing nearby was returned
                    const hasSuggested = data.suggested_results && data.suggested_results.length > 0;

                    if (hasSuggested) {
                        // Enrich with full Supabase data (photo, added_by etc.) via allDiscoveries match
                        window._searchPreviewItems = data.suggested_results.map(r => {
                            const match = allDiscoveries.find(d => d.id === r.id || d.title === r.title);
                            if (match) {
                                const relevance_reason = r.relevance_reason;
                                const distance_km = r.distance_km || match.distance_km;
                                return Object.assign({}, match, { relevance_reason, distance_km });
                            }
                            return r;
                        });
                    } else if (allDiscoveries.length > 0) {
                        const shuffled = [...allDiscoveries].sort(() => Math.random() - 0.5);
                        window._searchPreviewItems = shuffled.slice(0, 4);
                    } else {
                        return '';
                    }

                    return window._searchPreviewItems.map((item, idx) => {
                        const photo = item.photo_url
                            ? `<img src="${escapeHtml(item.photo_url)}">`
                            : '<span class="compact-photo-placeholder">📍</span>';
                        // Show relevance_reason if available (from n8n), else fall back to description
                        const snippet = item.relevance_reason || item.description || '';
                        const dist = item.distance_km
                            ? (item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km')
                            : '';
                        return `
                            <div class="compact-card" onclick="openItemDrawer(window._searchPreviewItems[${idx}])">
                                <div class="compact-photo">${photo}</div>
                                <div class="compact-title">${escapeHtml(item.title)}</div>
                                <div class="compact-meta">
                                    ${dist ? `<span>📍 ${dist}</span>` : ''}
                                    ${item.added_by_name ? `<span>• ${escapeHtml(item.added_by_name)}</span>` : ''}
                                </div>
                                ${snippet ? `<div class="compact-snippet">💡 ${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>` : ''}
                            </div>`;
                    }).join('');
                };

                const previewCards = buildSuggestionPreview();
                const noMatchHtml = `
                    <div class="message message-assistant">
                        <div class="message-content">
                            <strong>Nothing found for "${escapeHtml(query)}" in your network yet.</strong><br>
                            Your friends haven't saved anything matching that — yet. Be the first to add it! 👇
                        </div>
                        <div style="padding: 8px 0;">
                            <button class="drawer-bookmark-btn active" style="margin:0 0 12px 0;" onclick="setMode('input')">
                                ＋ Add a recommendation
                            </button>
                        </div>
                        ${previewCards ? `
                        <div class="results-section">
                            <div class="more-options-section">
                                <div class="results-header">
                                    <span class="results-header-title">Meanwhile, from your network</span>
                                </div>
                                <div class="more-options-wrapper">
                                    <div class="more-options-scroll">${previewCards}</div>
                                </div>
                            </div>
                        </div>` : ''}
                    </div>`;

                container.innerHTML += noMatchHtml;
                container.scrollTop = container.scrollHeight;

                sessionMessages.push({
                    role: 'assistant',
                    content: `No relevant results for "${query}"`,
                    timestamp: Date.now()
                });
            }

        } else {
            // 0 results — show friendly fallback with preview from friends' network
            if (allDiscoveries.length > 0) {
                // Pick up to 4 random items from friends' discoveries
                const shuffled = [...allDiscoveries].sort(() => Math.random() - 0.5);
                const preview = shuffled.slice(0, 4);
                // Store for onclick access
                window._searchPreviewItems = preview;

                const formatDistance = (km) => {
                    if (!km) return '';
                    return km < 1 ? Math.round(km * 1000) + 'm' : km.toFixed(1) + 'km';
                };

                let previewCards = preview.map((item, idx) => {
                    const photo = item.photo_url
                        ? `<img src="${escapeHtml(item.photo_url)}">`
                        : '<span class="compact-photo-placeholder">📍</span>';
                    const distText = formatDistance(item.distance_km);
                    const snippet = item.description || '';
                    return `
                        <div class="compact-card" onclick="openItemDrawer(window._searchPreviewItems[${idx}])">
                            <div class="compact-photo">${photo}</div>
                            <div class="compact-title">${escapeHtml(item.title)}</div>
                            <div class="compact-meta">
                                ${distText ? `<span>📍 ${distText}</span>` : ''}
                                ${item.added_by_name ? `<span>• ${escapeHtml(item.added_by_name)}</span>` : ''}
                            </div>
                            ${snippet ? `<div class="compact-snippet">💡 ${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>` : ''}
                        </div>`;
                }).join('');

                const noResultHtml = `
                    <div class="message message-assistant">
                        <div class="message-content">
                            <strong>Nothing found for "${escapeHtml(query)}" in your network yet.</strong><br>
                            Be the first to add it! 👇
                        </div>
                        <div style="padding: 8px 0;">
                            <button class="drawer-bookmark-btn active" style="margin:0 0 12px 0;" onclick="setMode('input')">
                                ＋ Add a recommendation
                            </button>
                        </div>
                        <div class="results-section">
                            <div class="more-options-section">
                                <div class="results-header">
                                    <span class="results-header-title">From Your Network</span>
                                </div>
                                <div class="more-options-wrapper">
                                    <div class="more-options-scroll">${previewCards}</div>
                                </div>
                            </div>
                        </div>
                    </div>`;
                container.innerHTML += noResultHtml;
            } else {
                // New user — no friends yet
                container.innerHTML += `
                    <div class="message message-assistant">
                        <div class="message-content">Nothing found yet — your network is empty. Invite friends to start building your shared discovery list! 🤝</div>
                    </div>`;
            }

            sessionMessages.push({
                role: 'assistant',
                content: 'No results found',
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

// ===== SCROLL ARROWS FOR MORE OPTIONS =====
function scrollMoreOptions(scrollId, direction) {
    var el = document.getElementById(scrollId);
    if (!el) return;
    var cardWidth = 192; // 180px card + 12px gap
    el.scrollBy({ left: direction * cardWidth * 2, behavior: 'smooth' });
    // Update arrow visibility after scroll
    setTimeout(function() { updateScrollArrows(scrollId); }, 350);
}

function updateScrollArrows(scrollId) {
    var el = document.getElementById(scrollId);
    if (!el) return;
    var wrapper = el.parentElement;
    if (!wrapper) return;
    var leftBtn = wrapper.querySelector('.scroll-arrow-left');
    var rightBtn = wrapper.querySelector('.scroll-arrow-right');
    if (leftBtn) leftBtn.style.opacity = el.scrollLeft <= 5 ? '0' : '1';
    if (leftBtn) leftBtn.style.pointerEvents = el.scrollLeft <= 5 ? 'none' : 'auto';
    if (rightBtn) {
        var atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 5;
        rightBtn.style.opacity = atEnd ? '0' : '1';
        rightBtn.style.pointerEvents = atEnd ? 'none' : 'auto';
    }
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
    // Refresh search greeting after session reset
    if (typeof updateSearchGreeting === 'function') updateSearchGreeting();
    // Hide suggestion chips in Focus mode
    if (typeof getHomeStyle === 'function' && getHomeStyle() === 'launcher') {
        var chipsEl = container.querySelector('.suggestions');
        if (chipsEl) chipsEl.style.display = 'none';
    }
    console.log('New session started:', currentSessionId);
}

// ===== SEARCH RESULTS BOTTOM SHEET =====
function openSearchSheet() {
    const sheet = document.getElementById('searchBottomSheet');
    const backdrop = document.getElementById('searchSheetBackdrop');
    if (!sheet || !backdrop) return;
    backdrop.classList.add('active');
    // Start half-open, user can drag/click to full
    sheet.classList.remove('full-open');
    sheet.classList.add('half-open');
}

function closeSearchSheet() {
    const sheet = document.getElementById('searchBottomSheet');
    const backdrop = document.getElementById('searchSheetBackdrop');
    if (sheet) {
        sheet.classList.remove('half-open', 'full-open');
    }
    if (backdrop) backdrop.classList.remove('active');
}

function toggleSearchSheet() {
    const sheet = document.getElementById('searchBottomSheet');
    if (!sheet) return;
    if (sheet.classList.contains('half-open')) {
        sheet.classList.remove('half-open');
        sheet.classList.add('full-open');
    } else if (sheet.classList.contains('full-open')) {
        sheet.classList.remove('full-open');
        sheet.classList.add('half-open');
    }
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
        familyId: currentProfile?.family_id || '37ae9f84-2d1d-4930-9765-f6f8991ae053',
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

// ===== SAVED PAGE =====
async function loadSavedPage() {
    const list = document.getElementById('savedItemsList');
    if (!list || !currentUser) return;
    list.innerHTML = '<div class="activity-empty">Loading saves...</div>';
    try {
        const { data } = await supabaseClient
            .from('endorsements')
            .select('item_id')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });
        const endorsedIds = (data || []).map(e => e.item_id);
        const allIds = [...new Set(endorsedIds)];
        if (allIds.length === 0) {
            list.innerHTML = '<div class="activity-empty">No saves yet. Discover and save items you love!</div>';
            return;
        }
        const { data: items } = await supabaseClient
            .from('knowledge_items')
            .select('*')
            .in('id', allIds);
        if (!items || items.length === 0) {
            list.innerHTML = '<div class="activity-empty">No saves yet.</div>';
            return;
        }
        if (userLocation.available) {
            items.forEach(item => {
                if (item.latitude && item.longitude) {
                    item.distance_km = calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude);
                }
            });
        }
        list.innerHTML = items.map((item, idx) => {
            const photo = item.photo_url
                ? `<div class="saved-item-photo"><img src="${escapeHtml(item.photo_url)}"></div>`
                : `<div class="saved-item-photo saved-item-placeholder">${getCategoryEmoji(item.type)}</div>`;
            const distText = item.distance_km
                ? (item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km')
                : '';
            return `<div class="saved-item-card" onclick="openItemDrawer(savedPageItems[${idx}])">
                ${photo}
                <div class="saved-item-content">
                    <div class="saved-item-title">${escapeHtml(item.title)}</div>
                    <div class="saved-item-meta">
                        ${item.added_by_name ? '<span>Added by ' + escapeHtml(item.added_by_name) + '</span>' : ''}
                        ${distText ? '<span>' + distText + '</span>' : ''}
                    </div>
                    ${item.description ? '<div class="saved-item-desc">' + escapeHtml(item.description).substring(0, 80) + (item.description.length > 80 ? '...' : '') + '</div>' : ''}
                </div>
                <button class="saved-item-remove" onclick="event.stopPropagation(); removeSavedItem('${item.id}')" title="Remove">&times;</button>
            </div>`;
        }).join('');
        window.savedPageItems = items;
    } catch (err) {
        console.error('Saved page error:', err);
        list.innerHTML = '<div class="activity-empty">Error loading saves</div>';
    }
}

async function removeSavedItem(itemId) {
    try {
        if (currentUser) {
            await supabaseClient.from('endorsements').delete().eq('user_id', currentUser.id).eq('item_id', itemId);
            // Update local cache
            if (endorsementsCache[itemId]) {
                endorsementsCache[itemId].userEndorsed = false;
                endorsementsCache[itemId].count = Math.max(0, endorsementsCache[itemId].count - 1);
            }
        }
        loadSavedPage();
        showToast('Removed from saves');
    } catch (err) {
        console.error('Remove saved error:', err);
    }
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, duration = 3000) {
    // Remove any existing toast
    const existing = document.getElementById('appToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'app-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}


// ===== ONBOARDING =====

// Disabled: Let users manually add Founding Members to learn the Add Friend flow
async function autoFriendVouchHQ() {
    return; // Skip auto-connect — users add Founding Members manually
    if (currentUser.id === VOUCH_HQ_USER_ID) return; // Don't friend yourself

    // Check if already friends with Vouch HQ
    const alreadyFriend = friendsCache.some(f => f.out_user_id === VOUCH_HQ_USER_ID);
    if (alreadyFriend) return;

    // Check if there's already a pending request
    const alreadyPending = pendingFriendRequests.some(r =>
        r.out_requester_id === VOUCH_HQ_USER_ID
    );
    if (alreadyPending) return;

    // Check localStorage to avoid repeated attempts
    if (localStorage.getItem('vouch_hq_connected')) return;

    try {
        // Insert friendship directly (both directions accepted)
        const { error } = await supabaseClient.rpc('send_friend_request', {
            p_requester_id: VOUCH_HQ_USER_ID,
            p_receiver_id: currentUser.id
        });

        if (!error) {
            // Auto-accept it
            // Reload pending to find the request
            const { data: pending } = await supabaseClient.rpc('get_pending_friend_requests', {
                p_user_id: currentUser.id
            });
            const hqRequest = (pending || []).find(r => r.out_requester_id === VOUCH_HQ_USER_ID);
            if (hqRequest) {
                await supabaseClient.rpc('accept_friend_request', {
                    p_friendship_id: hqRequest.out_id,
                    p_user_id: currentUser.id
                });
            }
            localStorage.setItem('vouch_hq_connected', 'true');
            // Reload friends list
            await loadFriends();
            console.log('Auto-connected with Vouch HQ');
        }
    } catch (err) {
        console.warn('Auto-friend Vouch HQ failed (non-critical):', err);
    }
}

function checkOnboardingBanner() {
    const banner = document.getElementById('onboardingBanner');
    if (!banner) return;

    // Don't show if already dismissed
    if (localStorage.getItem('onboarding_welcome_dismissed')) {
        banner.style.display = 'none';
        return;
    }

    // Show if user has no friends (excluding Vouch HQ) and no endorsements
    const realFriends = friendsCache.filter(f => f.out_user_id !== VOUCH_HQ_USER_ID);
    const hasNoRealFriends = realFriends.length === 0;
    const hasNoEndorsements = Object.values(endorsementsCache || {}).every(e => !e.userEndorsed);

    if (hasNoRealFriends && hasNoEndorsements) {
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
    }
}

function dismissOnboarding() {
    localStorage.setItem('onboarding_welcome_dismissed', 'true');
    const banner = document.getElementById('onboardingBanner');
    if (banner) {
        banner.style.opacity = '0';
        setTimeout(() => { banner.style.display = 'none'; }, 300);
    }
}

function goToFindFriends() {
    dismissOnboarding();
    setMode('profile');
    // Scroll to and focus the friend search input after a short delay
    setTimeout(() => {
        const input = document.getElementById('friendSearchInput');
        if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input.focus();
        }
    }, 400);
}

function dismissEmptyFriends() {
    localStorage.setItem('empty_friends_dismissed', 'true');
    const el = document.getElementById('homeEmptyFriends');
    if (el) {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s';
        setTimeout(() => { el.style.display = 'none'; }, 300);
    }
}