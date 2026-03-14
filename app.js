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
const ODIN_HQ_USER_ID = 'fec29546-cabd-44c7-96c9-4dfa6e952e93';

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
    // Explicitly hide bottom tab bar (position:fixed can persist in iOS Safari
    // even when the parent has display:none)
    var tabBar = document.querySelector('.bottom-tab-bar');
    if (tabBar) tabBar.style.display = 'none';
    // Close auth modal if open (e.g. after sign-out)
    var modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
}

async function showMainApp() {
    // ── Fix 5: Reset stale state from any previous session ──
    allDiscoveries = [];
    endorsementsCache = {};
    friendsCache = [];
    pendingFriendRequests = [];
    outgoingFriendRequests = new Set();
    blockedUsersCache = [];
    isFirstMessage = true;
    sessionMessages = [];
    translationCache = {};
    // Clear chat UI — remove dynamic messages only; preserve the static .welcome div
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer) {
        chatContainer.querySelectorAll('.message').forEach(m => m.remove());
        const welcome = chatContainer.querySelector('.welcome');
        if (welcome) welcome.style.display = '';
    }
    // Clear recently viewed and onboarding state whenever the user changes
    // (includes new registrations where prevUserId is null)
    const prevUserId = localStorage.getItem('odin_last_user_id');
    const thisUserId = currentUser ? currentUser.id : null;
    if (thisUserId && prevUserId !== thisUserId) {
        localStorage.removeItem('recentlyViewed');
        localStorage.removeItem('onboarding_welcome_dismissed');
        localStorage.removeItem('empty_friends_dismissed');
    }
    if (thisUserId) localStorage.setItem('odin_last_user_id', thisUserId);

    // Hide landing page and close auth modal
    document.getElementById('loginScreen').style.display = 'none';
    var authModal = document.getElementById('authModal');
    if (authModal) authModal.classList.remove('open');
    document.body.style.overflow = '';
    document.getElementById('mainApp').style.display = 'block';
    // Restore bottom tab bar in case it was hidden on logout
    var tabBar = document.querySelector('.bottom-tab-bar');
    if (tabBar) tabBar.style.display = '';

    // Load profile from profiles table
    await loadUserProfile();

    // Initialise language (autodetect or load from profile)
    await initUserLanguage();

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
    await loadPendingFriendRequests();

    // Pre-load discoveries so search results can match IDs
    loadDiscoveries();
    loadBlockedUsers();

    // Auto-connect with Odin HQ for new users
    autoFriendOdinHQ();

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
        outgoingFriendRequests = new Set();
        blockedUsersCache = [];
        // Privacy: wipe ALL client state on logout.
        // localStorage is a shared unprotected store — clear it completely
        // so nothing from this session survives to the next user of this browser.
        localStorage.clear();
        showLoginScreen();
    }
}

// --- Delete Account ---

function confirmDeleteAccount() {
    const overlay = document.getElementById('deleteConfirmOverlay');
    const input = document.getElementById('deleteConfirmInput');
    const msg = document.getElementById('deleteAccountMsg');
    if (!overlay) return;
    if (input) input.value = '';
    if (msg) msg.style.display = 'none';
    overlay.style.display = 'flex';
}

function cancelDeleteAccount() {
    const overlay = document.getElementById('deleteConfirmOverlay');
    if (overlay) overlay.style.display = 'none';
}

async function executeDeleteAccount() {
    const input = document.getElementById('deleteConfirmInput');
    const btn = document.getElementById('deleteConfirmBtn');
    const msg = document.getElementById('deleteAccountMsg');

    if (!input || input.value.trim().toUpperCase() !== 'DELETE') {
        if (msg) { msg.textContent = 'Please type DELETE to confirm.'; msg.style.display = 'block'; }
        return;
    }

    if (!currentUser) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }
    if (msg) msg.style.display = 'none';

    try {
        const uid = currentUser.id;

        // Anonymise knowledge_items — keep content for the community (Google Maps model).
        // Strip identity so nothing traces back to the deleted user.
        await supabaseClient
            .from('knowledge_items')
            .update({ added_by: null, added_by_name: 'Deleted User' })
            .eq('added_by', uid);

        // Remove their personal saves (endorsements were private bookmarks)
        await supabaseClient.from('endorsements').delete().eq('user_id', uid);

        // Remove from all friend circles
        await supabaseClient.from('friendships').delete().or(`requester_id.eq.${uid},receiver_id.eq.${uid}`);

        // Clear notifications — both received (user_id) and sent (actor_id).
        // actor_id has a FK to auth.users so both must be gone before auth deletion.
        await supabaseClient.from('notifications').delete().eq('user_id', uid);
        await supabaseClient.from('notifications').delete().eq('actor_id', uid);
        await supabaseClient.from('profiles').delete().eq('id', uid);

        // Call n8n to delete the Supabase Auth record server-side.
        // Must await BEFORE signOut() — signing out invalidates the session
        // and the webhook would arrive with a dead token.
        try {
            await fetch(DELETE_ACCOUNT_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: uid })
            });
        } catch (webhookErr) {
            console.warn('Auth deletion webhook failed (non-critical):', webhookErr);
        }

        stopNotifPolling();
        await supabaseClient.auth.signOut();

        currentUser = null;
        currentProfile = null;
        friendsCache = [];
        pendingFriendRequests = [];
        outgoingFriendRequests = new Set();
        blockedUsersCache = [];
        localStorage.clear();

        // Show landing page, then display confirmation message
        showLoginScreen();
        const overlay = document.getElementById('deleteConfirmOverlay');
        if (overlay) overlay.style.display = 'none';
        showToast('Your account has been deleted.', 4000);
    } catch (err) {
        console.error('Delete account error:', err);
        if (msg) { msg.textContent = 'Something went wrong. Please try again.'; msg.style.display = 'block'; }
        if (btn) { btn.disabled = false; btn.textContent = 'Delete Forever'; }
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
        // Always clear form so no stale/pre-filled data appears
        createAccountForm.reset();
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
            // ── Fix 1: Show a proper welcome/confirmation screen ──
            showRegistrationSuccess(name, email);
            resetButton(btn);
        }
    } catch (err) {
        console.error('Sign up error:', err);
        showAuthError('An unexpected error occurred. Please try again.');
        resetButton(btn);
    }
}

// --- Registration Success Screen ---

function showRegistrationSuccess(name, email) {
    // Swap the modal inner content to a success state
    const inner = document.querySelector('.auth-modal-inner');
    if (!inner) return;
    const firstName = name ? name.split(' ')[0] : 'there';
    inner.innerHTML = `
        <div class="reg-success-screen">
            <div class="reg-success-icon">✉️</div>
            <h2 class="reg-success-title">You're in, ${escapeHtml(firstName)}!</h2>
            <p class="reg-success-body">
                We've sent a confirmation link to<br>
                <strong>${escapeHtml(email)}</strong>
            </p>
            <p class="reg-success-hint">
                Click the link in that email to activate your account, then come back here and sign in.
            </p>
            <div class="reg-success-privacy">
                Your data is private by default — only visible to friends you choose.
            </div>
            <button class="reg-success-btn" onclick="regSuccessToSignIn()">Go to Sign In</button>
        </div>
    `;
}

function regSuccessToSignIn() {
    // Restore the normal modal content by reloading the auth modal
    const authModal = document.getElementById('authModal');
    if (authModal) {
        authModal.classList.remove('open');
        // Brief pause then reopen on sign-in tab
        setTimeout(() => {
            // Re-render modal to sign-in state — reset inner HTML via showAuthMode
            location.reload(); // simplest reliable reset; auth state is unchanged
        }, 100);
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
let friendsCache = [];              // Array: { out_friendship_id, out_user_id, out_email, out_display_name, out_avatar_url }
let pendingFriendRequests = [];     // Array: { out_id, out_requester_id, out_requester_name, ... } — INCOMING only
let outgoingFriendRequests = new Set(); // Set of receiver UUIDs you've sent requests to this session
let blockedUsersCache = [];         // Array: { out_blocked_user_id, out_display_name }

async function loadUserProfile() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (error && error.code === 'PGRST116') {
            // No profile row = fresh account (or auth user survived a prior deletion).
            // Scrub ALL residual data for this UUID so the new session starts clean.
            const uid = currentUser.id;
            await Promise.all([
                supabaseClient.from('notifications').delete().eq('user_id', uid),
                supabaseClient.from('notifications').delete().eq('actor_id', uid),
                supabaseClient.from('friendships').delete().or(`requester_id.eq.${uid},receiver_id.eq.${uid}`),
                supabaseClient.from('endorsements').delete().eq('user_id', uid)
            ]);

            const fallbackName = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User';
            const { data: newProfile, error: insertError } = await supabaseClient
                .from('profiles')
                .insert({
                    id: uid,
                    email: currentUser.email,
                    name: fallbackName,
                    display_name: fallbackName,
                    avatar_url: currentUser.user_metadata?.avatar_url || null,
                    family_id: '37ae9f84-2d1d-4930-9765-f6f8991ae053',
                    role: 'member'
                })
                .select()
                .single();

            if (newProfile) {
                currentProfile = newProfile;
            } else {
                // Insert failed — use a minimal in-memory profile so the UI
                // doesn't stay frozen on "Loading..."
                console.warn('Profile insert failed:', insertError);
                currentProfile = {
                    id: uid,
                    email: currentUser.email,
                    display_name: fallbackName,
                    name: fallbackName,
                    avatar_url: currentUser.user_metadata?.avatar_url || null
                };
            }
        } else if (data) {
            currentProfile = data;
        }
    } catch (err) {
        console.error('Error loading profile:', err);
        // Last-resort fallback so the UI never stays on "Loading..."
        if (!currentProfile && currentUser) {
            currentProfile = {
                id: currentUser.id,
                email: currentUser.email,
                display_name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
                name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User'
            };
        }
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
    if (!currentUser) return;
    // If profile still not loaded, try once more before giving up
    if (!currentProfile) await loadUserProfile();
    if (!currentProfile) return;

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

        const { count: friendsCount } = await supabaseClient
            .from('friendships')
            .select('*', { count: 'exact', head: true })
            .or(`requester_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
            .eq('status', 'accepted');
        document.getElementById('profilePeopleCount').textContent = friendsCount || 0;
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
        // Run both queries in parallel: items I endorsed + items I added
        const [endorseRes, addedRes] = await Promise.all([
            supabaseClient
                .from('endorsements')
                .select('item_id, created_at')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false }),
            supabaseClient
                .from('knowledge_items')
                .select('id, title, photo_url, added_by_name, type, created_at')
                .eq('added_by', currentUser.id)
                .order('created_at', { ascending: false })
        ]);

        const endorsedIds = ((endorseRes.data || []).map(e => e.item_id));
        const addedItems  = addedRes.data || [];

        // Merge: endorsed IDs union added IDs (deduped), items I added go first if not already endorsed
        const addedIds = addedItems.map(i => i.id);
        const allIds = [...new Set([...endorsedIds, ...addedIds])];

        if (allIds.length === 0) {
            container.innerHTML = '<p class="my-endorsements-empty">No saves yet. Bookmark discoveries you like!</p>';
            return;
        }

        // Fetch full items for endorsed ones we don't already have from addedRes
        const missingIds = endorsedIds.filter(id => !addedIds.includes(id));
        let fetchedItems = [...addedItems];
        if (missingIds.length > 0) {
            const { data: more } = await supabaseClient
                .from('knowledge_items')
                .select('id, title, photo_url, added_by_name, type, created_at')
                .in('id', missingIds);
            if (more) fetchedItems = [...fetchedItems, ...more];
        }

        if (fetchedItems.length === 0) {
            container.innerHTML = '<p class="my-endorsements-empty">No saves yet.</p>';
            return;
        }

        // Build map and sort by allIds order (endorsements most recent first, then adds)
        const itemMap = {};
        fetchedItems.forEach(i => { itemMap[i.id] = i; });
        const sorted = allIds.map(id => itemMap[id]).filter(Boolean);

        container.innerHTML = sorted.map(item => {
            const _emoji = getCategoryEmoji(item.type);
            const isMyAdd = item.added_by_name && addedIds.includes(item.id);
            const photo = item.photo_url
                ? `<img src="${escapeHtml(item.photo_url)}" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span class=\\'my-endorse-placeholder\\'>${_emoji}</span>')">`
                : `<span class="my-endorse-placeholder">${_emoji}</span>`;
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
        // Endorse — if the item is private, save privately too
        const item = allDiscoveries.find(d => d.id === itemId);
        const saveVisibility = (item && item.visibility === 'private') ? 'private' : 'friends';
        const { error } = await supabaseClient
            .from('endorsements')
            .insert({ user_id: currentUser.id, item_id: itemId, visibility: saveVisibility });

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

    const friendCount = friendNames.length;

    // Build stacked avatar initials (up to 3)
    let avatarsHtml = '';
    if (friendCount > 0) {
        const avatarNames = friendNames.slice(0, 3);
        avatarsHtml = `<div class="endorse-avatars">${avatarNames.map(n => `<div class="endorse-avatar-chip">${n.charAt(0).toUpperCase()}</div>`).join('')}</div>`;
    }

    // Build "Saved by X and N others" sentence
    let savedByText = '';
    if (friendCount > 0) {
        const first = friendNames[0];
        if (friendCount === 1) {
            savedByText = `Saved by <strong>${escapeHtml(first)}</strong>`;
        } else if (friendCount === 2) {
            savedByText = `Saved by <strong>${escapeHtml(first)}</strong> and <strong>${escapeHtml(friendNames[1])}</strong>`;
        } else {
            savedByText = `Saved by <strong>${escapeHtml(first)}</strong> and ${friendCount - 1} others`;
        }
    }

    return `<div class="drawer-reactions">
        <div class="drawer-save-row">
            ${avatarsHtml}
            <div class="drawer-save-right">
                ${savedByText ? `<div class="endorse-names">${savedByText}</div>` : ''}
                <button class="drawer-bookmark-btn${bookmarkActive}" data-endorse-id="${itemId}" onclick="toggleEndorsement('${itemId}', event)">
                    <svg class="bookmark-icon-lg" width="16" height="16" viewBox="0 0 24 24" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2.2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    <span class="drawer-bookmark-label">${cached.userEndorsed ? 'Saved' : 'Save'}</span>
                </button>
            </div>
        </div>
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
        // Direct query — bypasses the RPC and reads the table directly.
        // Fetches rows where I am the receiver and status is still pending,
        // then joins profiles to get the requester's display name + avatar.
        const { data, error } = await supabaseClient
            .from('friendships')
            .select(`
                id,
                requester_id,
                created_at,
                profiles!friendships_requester_id_fkey (
                    display_name,
                    avatar_url,
                    email
                )
            `)
            .eq('receiver_id', currentUser.id)
            .eq('status', 'pending');

        if (error) {
            console.error('Error loading pending requests:', error);
            pendingFriendRequests = [];
            return;
        }

        // Normalise into the shape the rest of the UI expects:
        // { out_id, out_requester_id, out_requester_name, out_avatar_url, out_created_at }
        pendingFriendRequests = (data || []).map(row => ({
            out_id:             row.id,
            out_requester_id:   row.requester_id,
            out_requester_name: row.profiles?.display_name || row.profiles?.email || 'Someone',
            out_avatar_url:     row.profiles?.avatar_url || null,
            out_created_at:     row.created_at
        }));

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
                const isPending = pendingFriendRequests.some(r => r.out_requester_id === profile.out_id)
                               || outgoingFriendRequests.has(profile.out_id);

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
        // Direct insert — bypasses the RPC which was auto-accepting instead of setting status='pending'
        const { error } = await supabaseClient
            .from('friendships')
            .insert({
                requester_id: currentUser.id,
                receiver_id: receiverId,
                status: 'pending'
            });

        if (error) {
            console.error('Error sending friend request:', error);
            // Handle duplicate (request already exists)
            if (error.code === '23505') {
                if (btn) { btn.textContent = 'Pending'; btn.classList.add('sent'); }
                outgoingFriendRequests.add(receiverId);
            } else {
                if (btn) { btn.disabled = false; btn.textContent = 'Add Friend'; }
            }
            return;
        }

        // Track outgoing so "Pending" shows if they search again this session
        outgoingFriendRequests.add(receiverId);

        // Insert a notification so the receiver sees it in their notifications panel
        // (previously the RPC did this internally — now we do it explicitly)
        const senderName = currentProfile?.display_name || currentUser.email?.split('@')[0] || 'Someone';
        await supabaseClient
            .from('notifications')
            .insert({
                user_id:  receiverId,
                actor_id: currentUser.id,
                type:     'friend_request',
                message:  `${senderName} sent you a friend request`
            });

        if (btn) { btn.textContent = 'Pending'; btn.classList.add('sent'); }
        showToast('Friend request sent!');

        // Clear search bar and hide results after a short delay
        setTimeout(() => {
            const searchInput = document.getElementById('friendSearchInput');
            const resultsDiv = document.getElementById('friendSearchResults');
            if (searchInput) searchInput.value = '';
            if (resultsDiv) { resultsDiv.innerHTML = ''; resultsDiv.style.display = 'none'; }
        }, 800);

    } catch (err) {
        console.error('Error in handleSendFriendRequest:', err);
        if (btn) { btn.disabled = false; btn.textContent = 'Add Friend'; }
    }
}

async function handleAcceptFriendRequest(friendshipId) {
    try {
        // Direct update — set status to accepted
        const { error } = await supabaseClient
            .from('friendships')
            .update({ status: 'accepted', updated_at: new Date().toISOString() })
            .eq('id', friendshipId)
            .eq('receiver_id', currentUser.id); // safety: only receiver can accept

        if (error) {
            console.error('Error accepting friend request:', error);
            return;
        }

        // Notify the requester that their request was accepted
        const accepterName = currentProfile?.display_name || currentUser.email?.split('@')[0] || 'Someone';

        // Look up requester_id from the friendship row we just updated
        const { data: friendship } = await supabaseClient
            .from('friendships')
            .select('requester_id')
            .eq('id', friendshipId)
            .single();

        if (friendship?.requester_id) {
            await supabaseClient
                .from('notifications')
                .insert({
                    user_id:  friendship.requester_id,
                    actor_id: currentUser.id,
                    type:     'friend_accepted',
                    message:  `${accepterName} accepted your friend request`
                });
        }

        await loadFriends();
        await loadPendingFriendRequests();
        updateFriendsDisplay();
        checkUnreadNotifications();
        // Milestone: first friend accepted
        if (!localStorage.getItem('milestone_first_friend')) {
            localStorage.setItem('milestone_first_friend', 'true');
            setTimeout(() => showToast('You can now see each other\'s personal stories!'), 300);
        }
    } catch (err) {
        console.error('Error in handleAcceptFriendRequest:', err);
    }
}

async function handleRejectFriendRequest(friendshipId) {
    try {
        // Direct delete — remove the pending row entirely
        const { error } = await supabaseClient
            .from('friendships')
            .delete()
            .eq('id', friendshipId)
            .eq('receiver_id', currentUser.id); // safety: only receiver can reject

        if (error) {
            console.error('Error rejecting friend request:', error);
            return;
        }

        await loadPendingFriendRequests();
        updateFriendsDisplay();
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

function renderNotesSection(itemId, notes, trustLevel) {
    // Extended circle: comments are hidden — identity must not travel more than one hop
    if (trustLevel === TRUST.EXTENDED) {
        return `<div class="community-notes community-notes--hidden" id="communityNotes">
            <div class="extended-circle-notice">
                💬 Comments are only visible between direct friends.
                <br><span class="extended-circle-notice-sub">Add this place to connect with the people who saved it.</span>
            </div>
        </div>`;
    }

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

    const commentCount = notes.length;
    const commentLabel = commentCount > 0 ? `Comments · ${commentCount}` : 'Comments';

    return `<div class="community-notes" id="communityNotes">
        <button class="community-notes-toggle" onclick="toggleCommentsSection(this)" aria-expanded="false">
            <span class="community-notes-label">${commentLabel}</span>
            <svg class="comments-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="community-notes-body" id="communityNotesBody" style="display:none;">
            <div class="notes-list" id="notesList">${notesList || '<div class="notes-empty">No comments yet — be the first.</div>'}</div>
            <div class="note-input-wrap">
                <textarea class="note-input" id="noteInput" placeholder="Add a comment..." maxlength="500" rows="2"></textarea>
                <button class="note-submit-btn" onclick="submitNote('${itemId}')">Post</button>
            </div>
        </div>
    </div>`;
}

function toggleCommentsSection(btn) {
    const body = document.getElementById('communityNotesBody');
    if (!body) return;
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', !isOpen);
    body.style.display = isOpen ? 'none' : 'block';
    btn.classList.toggle('expanded', !isOpen);
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
const _NOTIFS_CLEARED_KEY = 'odin_notifs_cleared_at';
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
    loadPendingFriendRequests().then(updateFriendsDisplay);
    // Then poll every 30 seconds — refresh both notification badge AND pending friend requests
    if (notifPollInterval) clearInterval(notifPollInterval);
    notifPollInterval = setInterval(() => {
        checkUnreadNotifications();
        loadPendingFriendRequests().then(updateFriendsDisplay);
    }, 30000);
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
        // Use localStorage first (fast), fall back to DB-persisted timestamp (cross-device)
        const localClearedAt = localStorage.getItem(_NOTIFS_CLEARED_KEY);
        const dbClearedAt = currentProfile?.notifs_cleared_at
            ? new Date(currentProfile.notifs_cleared_at).getTime().toString()
            : null;
        const clearedAt = localClearedAt || dbClearedAt;
        let filtered = data || [];
        if (clearedAt) {
            const clearedDate = new Date(parseInt(clearedAt));
            filtered = filtered.filter(n => new Date(n.out_created_at) > clearedDate);
        }

        if (filtered.length === 0) {
            section.style.display = 'none';
            container.innerHTML = '';
            // User has seen the notifications panel — mark as viewed so badge clears
            localStorage.setItem(_NOTIFS_CLEARED_KEY, Date.now().toString());
            const badge = document.getElementById('notifBadge');
            if (badge) badge.style.display = 'none';
            return;
        }

        // User is now viewing notifications — update clearedAt so badge resets after this view
        // The badge will only reappear for notifications created AFTER this timestamp
        localStorage.setItem(_NOTIFS_CLEARED_KEY, Date.now().toString());
        const badge = document.getElementById('notifBadge');
        if (badge) badge.style.display = 'none';

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

    // Persist cleared timestamp to profile so it survives across devices/sessions
    try {
        await supabaseClient.from('profiles')
            .update({ notifs_cleared_at: new Date().toISOString() })
            .eq('id', currentUser.id);
        // Keep currentProfile in sync so loadNotifications() can use it without refetch
        if (currentProfile) currentProfile.notifs_cleared_at = new Date().toISOString();
    } catch (e) { console.error('Error persisting notifs_cleared_at:', e); }

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
            const emoji = getCategoryEmoji(v.type);
            const photo = v.photo_url
                ? `<img src="${escapeHtml(v.photo_url)}" alt="" onerror="this.style.display='none';this.parentElement.innerHTML='<span class=\\'rv-placeholder\\'>${emoji}</span>'">`
                : `<span class="rv-placeholder">${emoji}</span>`;
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
const OG_FETCH_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/og-fetch';
const DELETE_ACCOUNT_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/delete-account';

// ── LANGUAGE SYSTEM ──────────────────────────────────────────────
// ISO 639-1 code of the user's preferred display/translation language.
// Loaded from Supabase profiles.preferred_language on login,
// with browser locale as the autodetect fallback.
let userPreferredLanguage = 'en';

const LANG_LABELS = {
    en: 'EN', 'zh-TW': '繁中', 'zh-CN': '简中', ja: '日本語', ko: '한국어',
    es: 'ES', fr: 'FR', ar: 'AR', hi: 'HI',
    pt: 'PT', de: 'DE', id: 'ID', th: 'TH'
};

/** Call once after profile is loaded. Autodetects from browser if not set. */
async function initUserLanguage() {
    // 1. Try profile setting from Supabase
    const saved = currentProfile?.preferred_language;
    if (saved && LANG_LABELS[saved]) {
        userPreferredLanguage = saved;
        _applyLangLabel(saved);
        return;
    }
    // 2. Autodetect from browser
    const rawBrowserLang = (navigator.language || 'en').toLowerCase();
    // Map browser zh variants to our split keys
    let browserLang;
    if (rawBrowserLang.startsWith('zh')) {
        browserLang = (rawBrowserLang.includes('tw') || rawBrowserLang.includes('hk') || rawBrowserLang.includes('mo')) ? 'zh-TW' : 'zh-CN';
    } else {
        browserLang = rawBrowserLang.split('-')[0];
    }
    const detected = LANG_LABELS[browserLang] ? browserLang : 'en';
    userPreferredLanguage = detected;
    _applyLangLabel(detected);
    // 3. Save autodetected value back to profile (fire-and-forget)
    if (currentUser) {
        supabaseClient.from('profiles')
            .update({ preferred_language: detected })
            .eq('id', currentUser.id)
            .then(() => {});
    }
}

/** Saves the chosen language to Supabase and updates the UI label. */
async function setPreferredLanguage(lang) {
    userPreferredLanguage = lang;
    _applyLangLabel(lang);
    _closeLangPicker();
    // Persist to profile
    if (currentUser) {
        await supabaseClient.from('profiles')
            .update({ preferred_language: lang })
            .eq('id', currentUser.id);
        if (currentProfile) currentProfile.preferred_language = lang;
    }
}

function _applyLangLabel(lang) {
    const el = document.getElementById('headerLangLabel');
    if (el) el.textContent = (LANG_LABELS[lang] || lang.toUpperCase()).substring(0, 5);
    // Highlight active in dropdown
    document.querySelectorAll('.lang-picker-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
}

function toggleLangPicker(e) {
    if (e) e.stopPropagation();
    const dd = document.getElementById('langPickerDropdown');
    if (!dd) return;
    const isOpen = dd.classList.contains('open');
    _closeLangPicker();
    if (!isOpen) dd.classList.add('open');
}

function _closeLangPicker() {
    const dd = document.getElementById('langPickerDropdown');
    if (dd) dd.classList.remove('open');
}

// Close picker when clicking outside
document.addEventListener('click', function(e) {
    const wrap = document.getElementById('headerLangWrap');
    if (wrap && !wrap.contains(e.target)) _closeLangPicker();
});
// ─────────────────────────────────────────────────────────────────

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

// Translate by item object directly — works for search results AND home feed cards
async function translateItem(item, targetLang) {
    const cacheKey = (item.id || item.title || '') + '_' + targetLang;
    if (translationCache[cacheKey]) return translationCache[cacheKey];

    const texts = {};
    // Never translate title — keep original always
    if (item.description) texts.description = item.description;
    // Only include personal note if user has permission (is a friend)
    const note = getPersonalNoteGlobal(item);
    if (note && typeof isFriend === 'function' && isFriend(item.added_by)) texts.personal_note = note;

    if (Object.keys(texts).length === 0) return {};

    const resp = await fetch(TRANSLATE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, target_language: targetLang })
    });
    if (!resp.ok) throw new Error('Translation request failed: ' + resp.status);
    const data = await resp.json();
    // Workflow returns { success: true, translated: {...} }
    const translated = data.translated || data;
    translationCache[cacheKey] = translated;
    return translated;
}

// Legacy wrapper — keeps search result cards (which use idx) working
async function translateResultFields(idx, targetLang) {
    const r = currentResults[idx];
    if (!r) return {};
    return translateItem(r, targetLang);
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
    const state = btn.dataset.state;

    // Always use preferred language; fall back to query language if set
    const targetLang = userPreferredLanguage || item._queryLanguage || 'en';
    const langLabel = (typeof LANG_LABELS !== 'undefined' && LANG_LABELS[targetLang]) || targetLang.toUpperCase();

    if (state === 'original') {
        btn.textContent = 'Translating...';
        btn.disabled = true;
        try {
            // translateItem works for ALL drawer items — search results AND home feed cards
            const translated = await translateItem(item, targetLang);
            const descEl = document.querySelector('.drawer-description');
            const storyEl = document.querySelector('.drawer-story-text');

            // Show translation BELOW the original — never replace it
            if (descEl && translated.description) {
                // Remove any previous translation block first
                const prev = descEl.parentNode.querySelector('.drawer-translation-block');
                if (prev) prev.remove();
                const block = document.createElement('div');
                block.className = 'drawer-translation-block';
                block.innerHTML = `<div class="drawer-translation-label">${langLabel}</div>`
                    + `<p class="drawer-translation-text">${escapeHtml(translated.description)}</p>`;
                descEl.insertAdjacentElement('afterend', block);
            }
            const canSeeStory = typeof isFriend === 'function' && isFriend(item.added_by);
            if (storyEl && translated.personal_note && canSeeStory) {
                const prevStory = storyEl.parentNode.querySelector('.drawer-translation-block');
                if (prevStory) prevStory.remove();
                const block = document.createElement('div');
                block.className = 'drawer-translation-block';
                block.innerHTML = `<div class="drawer-translation-label">${langLabel}</div>`
                    + `<p class="drawer-translation-text">${escapeHtml(translated.personal_note)}</p>`;
                storyEl.insertAdjacentElement('afterend', block);
            }
            btn.dataset.state = 'translated';
            btn.textContent = 'Hide translation';
        } catch (e) {
            console.error('Drawer translation error:', e);
            btn.textContent = 'Translation failed — retry';
            btn.dataset.state = 'original';
        }
        btn.disabled = false;
    } else {
        // Remove translation blocks — originals stay untouched
        document.querySelectorAll('.drawer-translation-block').forEach(function(el) { el.remove(); });
        btn.dataset.state = 'original';
        btn.textContent = `Translate to ${langLabel} 🌐`;
    }
}

// ── Translate button on inline result cards (top picks + compact cards) ──
async function toggleCardTranslate(btn, idx) {
    const r = currentResults[idx];
    if (!r) return;
    const state = btn.dataset.state;
    const card  = btn.closest('.top-pick-card, .compact-card');

    if (state === 'original') {
        btn.textContent = 'Translating...';
        btn.disabled = true;
        try {
            const targetLang = userPreferredLanguage || r._queryLanguage || 'zh-TW';
            const translated = await translateItem(r, targetLang);

            // Top-pick: update the reason text span
            const reasonSpan = card && card.querySelector('.top-pick-reason-text');
            if (reasonSpan && (translated.personal_note || translated.description)) {
                if (!reasonSpan.dataset.original) reasonSpan.dataset.original = reasonSpan.textContent;
                reasonSpan.textContent = (translated.personal_note || translated.description).substring(0, 100) + ((translated.personal_note || translated.description).length > 100 ? '...' : '');
            }

            // Compact: update snippet div
            const snippetEl = card && card.querySelector('.compact-snippet');
            if (snippetEl && (translated.personal_note || translated.description)) {
                if (!snippetEl.dataset.original) snippetEl.dataset.original = snippetEl.textContent;
                snippetEl.textContent = (translated.personal_note || translated.description).substring(0, 60) + ((translated.personal_note || translated.description).length > 60 ? '...' : '');
            }

            btn.dataset.state = 'translated';
            btn.textContent = 'Show original';
            btn.disabled = false;
        } catch(e) {
            btn.textContent = 'Translate 🌐';
            btn.dataset.state = 'original';
            btn.disabled = false;
        }
    } else {
        // Restore originals
        const reasonSpan = card && card.querySelector('.top-pick-reason-text');
        if (reasonSpan && reasonSpan.dataset.original) reasonSpan.textContent = reasonSpan.dataset.original;
        const snippetEl = card && card.querySelector('.compact-snippet');
        if (snippetEl && snippetEl.dataset.original) snippetEl.textContent = snippetEl.dataset.original;
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
    // Language button only shows on profile page — always hide it on home
    var langWrap = document.getElementById('headerLangWrap');
    if (langWrap) langWrap.style.display = 'none';
    updateTabBar('home');
}

// ── Discover pill management — show Discover|Map toggle in header when on Discover ──
function showDiscoverPill(show) {
    var homePills     = document.getElementById('headerModePills');
    var discoverPills = document.getElementById('headerDiscoverPills');
    if (homePills)     homePills.style.display     = show ? 'none' : '';
    if (discoverPills) discoverPills.style.display  = show ? ''     : 'none';
}

// ── Switch between Discover collections and Map ──
var discoverViewMode = 'collections';
var discoverMapInitialized = false;

function syncToggleButtons(view) {
    // Sync header pill buttons
    var discBtns = [document.getElementById('hdrPillDiscover')];
    var mapBtns  = [document.getElementById('hdrPillMap')];
    discBtns.forEach(function(b){ if (b) b.classList.toggle('active', view === 'collections'); });
    mapBtns.forEach(function(b){  if (b) b.classList.toggle('active', view === 'map'); });
}

function switchDiscoverView(view) {
    discoverViewMode = view;
    var collScreen = document.getElementById('discoverCollections');
    var mapScreen  = document.getElementById('discoverMapView');

    syncToggleButtons(view);

    if (view === 'collections') {
        document.body.classList.remove('map-view-open');
        // Clear all JS-set heights so the collections view scrolls normally
        var contentEl = document.querySelector('.content');
        var discoverModeEl = document.getElementById('discoverMode');
        if (contentEl)      contentEl.style.height      = '';
        if (discoverModeEl) discoverModeEl.style.height = '';
        if (collScreen) collScreen.style.display = '';
        if (mapScreen)  mapScreen.style.display  = 'none';
    } else {
        document.body.classList.add('map-view-open');
        if (collScreen) collScreen.style.display = 'none';
        if (mapScreen)  mapScreen.style.display  = '';

        // Set explicit pixel height so Leaflet works on all browsers incl. iOS Safari
        setMapScreenHeight();

        var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        if (!discoverMapInitialized) {
            // Map doesn't exist yet — initialise it
            var delay = isIOS ? 400 : 100;
            setTimeout(function() {
                window.scrollTo(0, 0);
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;

                setMapScreenHeight();
                initDiscoverMap();
                if (isIOS) {
                    setTimeout(function(){ if (discoverMap) { setMapScreenHeight(); discoverMap.invalidateSize(); } }, 400);
                    setTimeout(function(){ if (discoverMap) { setMapScreenHeight(); discoverMap.invalidateSize(); } }, 900);
                    setTimeout(function(){ if (discoverMap) discoverMap.invalidateSize(); }, 1500);
                } else {
                    setTimeout(function(){ if (discoverMap) discoverMap.invalidateSize(); }, 600);
                }
            }, delay);
            discoverMapInitialized = true;
        } else if (discoverMap) {
            // Map already exists — just fix its size
            setTimeout(function(){ if (discoverMap) { setMapScreenHeight(); discoverMap.invalidateSize(); } }, 150);
            setTimeout(function(){ if (discoverMap) discoverMap.invalidateSize(); }, 400);
        } else {
            discoverMapInitialized = false;
            switchDiscoverView('map');
        }
    }
}

function setMapScreenHeight() {
    var header  = document.querySelector('.header');
    var tabBar  = document.querySelector('.bottom-tab-bar');
    var headerH = header ? header.offsetHeight : 56;
    var tabH    = tabBar ? tabBar.offsetHeight  : 65;

    // iOS Safari: use visualViewport.height for the actual visible area
    // (window.innerHeight can include the address bar)
    var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    var h = vh - headerH - tabH;
    if (h < 100) h = vh * 0.6; // fallback

    // Set explicit pixel height on EVERY element in the chain.
    // On iOS Safari, flex:1 / height:100% chains collapse to 0 unless each
    // ancestor has an explicit pixel height.
    var contentEl      = document.querySelector('.content');
    var discoverModeEl = document.getElementById('discoverMode');
    var mapView        = document.getElementById('discoverMapView');
    var inner          = document.querySelector('.dmap-inner');
    var area           = document.querySelector('.dmap-area');
    var mapEl          = document.getElementById('discoverMap');

    var contentH = vh - headerH;   // .content sits below the header
    if (contentEl)      contentEl.style.height      = contentH + 'px';
    if (discoverModeEl) discoverModeEl.style.height = h + 'px';
    if (mapView)        mapView.style.height        = h + 'px';
    if (inner)          inner.style.height          = h + 'px';
    if (area)           area.style.height           = h + 'px';
    if (mapEl)          mapEl.style.height          = h + 'px';

    // Leaflet redraws for the new size
    if (discoverMap) setTimeout(function(){ discoverMap.invalidateSize(); }, 50);
}

// Re-compute on window resize / orientation change / iOS Safari viewport resize
window.addEventListener('resize',            function(){ if (discoverViewMode === 'map') setMapScreenHeight(); });
window.addEventListener('orientationchange', function(){ setTimeout(function(){ if (discoverViewMode === 'map') setMapScreenHeight(); }, 200); });
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function(){ if (discoverViewMode === 'map') setMapScreenHeight(); });
}

// Custom zoom functions (replaces Leaflet's built-in control)
function zoomMapIn()  { if (discoverMap) discoverMap.zoomIn(); }
function zoomMapOut() { if (discoverMap) discoverMap.zoomOut(); }

// ── Collection grouping ──
var collectionGrouping = 'friend'; // 'friend' | 'category'

function setCollectionGrouping(type) {
    collectionGrouping = type;
    document.getElementById('dcGroupFriend').classList.toggle('active', type === 'friend');
    document.getElementById('dcGroupCat').classList.toggle('active', type === 'category');
    buildCollectionCards();
}

// Colour palette for avatars / category dots
var COLL_COLOURS = ['#7B2D45','#3D6B8C','#4A7A5C','#A0682A','#8B5E72','#5A6BAD','#6BAD5A'];
function strColour(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
    return COLL_COLOURS[Math.abs(h) % COLL_COLOURS.length];
}

var CATEGORY_EMOJI = { place:'🍽️', product:'📦', service:'🔧', advice:'💡', book:'📚', experience:'✨' };

function buildCollectionCards() {
    var grid = document.getElementById('dcCollectionsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!allDiscoveries || allDiscoveries.length === 0) {
        grid.innerHTML = '<div style="color:var(--text-secondary);font-size:14px;padding:20px 0;">No discoveries yet. Add some!</div>';
        return;
    }

    // Group — normalise category keys to avoid "service" vs "Service" duplicates
    function normaliseKey(raw) {
        if (!raw) return 'Other';
        var s = raw.trim().toLowerCase();
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    var groups = {};
    allDiscoveries.forEach(function(item) {
        var key;
        if (item._trust_level === TRUST.EXTENDED) {
            // Extended circle items always go into their own group regardless of grouping mode
            key = 'Extended Circle';
        } else if (collectionGrouping === 'friend') {
            key = item.added_by_name || 'Unknown';
        } else {
            key = normaliseKey(item.category || item.type || 'Other');
        }
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    });

    var entries = Object.entries(groups).sort(function(a,b){ return b[1].length - a[1].length; });

    entries.forEach(function(entry, i) {
        var groupName = entry[0];
        var items     = entry[1];
        var featured  = (i === 0);

        // Pick cover image from first item with a photo
        var coverItem = items.find(function(it){ return it.photo_url; });
        var coverHtml = coverItem
            ? '<img class="dc-coll-img" src="' + escapeHtml(coverItem.photo_url) + '" alt="' + escapeHtml(groupName) + '" loading="lazy">'
            : '<div class="dc-coll-placeholder">' + (CATEGORY_EMOJI[groupName.toLowerCase()] || '📍') + '</div>';

        // Avatars — extended circle group gets a fixed blue anonymous avatar
        var avHtml;
        if (groupName === 'Extended Circle') {
            avHtml = '<div class="dc-coll-av dc-coll-av--extended">🔵</div>';
        } else {
            var avatarSet = {};
            items.forEach(function(it) {
                var avKey = collectionGrouping === 'friend'
                    ? (it.category || it.type || 'other')
                    : (it.added_by_name || '?');
                avatarSet[avKey] = true;
            });
            avHtml = Object.keys(avatarSet).slice(0, 3).map(function(k) {
                var init = k.charAt(0).toUpperCase();
                var col  = strColour(k);
                return '<div class="dc-coll-av" style="background:' + col + ';">' + init + '</div>';
            }).join('');
        }

        var label = items.length + ' ' + (items.length === 1 ? 'item' : 'items');

        var card = document.createElement('div');
        card.className = 'dc-coll-card' + (featured ? ' featured' : '');
        card.style.animationDelay = (i * 55) + 'ms';
        card.innerHTML =
            coverHtml +
            '<div class="dc-coll-overlay">' +
                '<div class="dc-coll-title">' + escapeHtml(groupName) + '</div>' +
                '<div class="dc-coll-meta">' +
                    '<div class="dc-coll-avatars">' + avHtml + '</div>' +
                    '<div class="dc-coll-count">' + label + '</div>' +
                '</div>' +
            '</div>';

        card.onclick = function() { openCollection(groupName, items); };
        grid.appendChild(card);
    });
}

// When a collection card is tapped, show filtered grid
function openCollection(groupName, items) {
    filteredDiscoveries = items;
    displayedCount = 0;

    // Hide the circle section header and collection grid
    var circleHeader = document.getElementById('dcCircleHeader');
    var collGrid     = document.getElementById('dcCollectionsGrid');
    if (circleHeader) circleHeader.style.display = 'none';
    if (collGrid)     collGrid.style.display     = 'none';

    document.getElementById('dcAllItemsSection').style.display = '';
    document.getElementById('dcAllItemsTitle').textContent = groupName;
    renderGrid();
}

function showAllCollections() {
    // Restore the circle section header and collection grid
    var circleHeader = document.getElementById('dcCircleHeader');
    var collGrid     = document.getElementById('dcCollectionsGrid');
    if (circleHeader) circleHeader.style.display = '';
    if (collGrid)     collGrid.style.display     = '';

    document.getElementById('dcAllItemsSection').style.display = 'none';
    filteredDiscoveries = allDiscoveries ? allDiscoveries.slice() : [];

    // Clear inline search/filter state when returning to collections
    var searchInput = document.getElementById('discoverSearch');
    if (searchInput && searchInput.value) searchInput.value = '';
    filters.searchText = '';
    filters.users = [];
    filters.distances = [];
    document.querySelectorAll('.dc-dist-pill').forEach(function(p) { p.classList.remove('active'); });
    if (typeof buildFriendsRow === 'function') buildFriendsRow();
}

// ── Locate me button ──
function locateOnMap() {
    var btn = document.getElementById('dmapLocateBtn');
    if (!navigator.geolocation) return;
    if (btn) btn.classList.add('locating');
    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            userLocation.latitude  = lat;
            userLocation.longitude = lng;
            userLocation.available = true;
            if (discoverMap) {
                discoverMap.setView([lat, lng], 15, { animate: true });
                if (userLocMarker) userLocMarker.setLatLng([lat, lng]);
            }
            if (btn) btn.classList.remove('locating');
        },
        function() {
            if (btn) btn.classList.remove('locating');
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

var userLocMarker = null;

function setMode(mode) {
    document.getElementById('homePage').classList.add('hidden');
    document.getElementById('searchMode').classList.add('hidden');
    document.getElementById('discoverMode').classList.add('hidden');
    document.getElementById('inputMode').classList.add('hidden');
    document.getElementById('profileMode').classList.add('hidden');
    var savedEl = document.getElementById('savedMode');
    if (savedEl) savedEl.classList.add('hidden');

    // Show/hide the Discover|Map pill in header
    showDiscoverPill(mode === 'discover');
    // Show language button only on profile page
    var langWrap = document.getElementById('headerLangWrap');
    if (langWrap) langWrap.style.display = (mode === 'profile') ? '' : 'none';
    // Clean up map state when leaving Discover
    if (mode !== 'discover') {
        document.body.classList.remove('map-view-open');
        discoverMapInitialized = false; // force re-init next time
        if (discoverMap) { discoverMap.remove(); discoverMap = null; }
        userLocMarker = null; // stale reference — will be recreated on next init
        // Clear JS-set heights that were applied for the map view
        var _contentEl = document.querySelector('.content');
        var _discoverEl = document.getElementById('discoverMode');
        if (_contentEl) _contentEl.style.height = '';
        if (_discoverEl) _discoverEl.style.height = '';
    }
    // Always scroll to top when switching modes
    window.scrollTo(0, 0);
    var contentEl = document.querySelector('.content');
    if (contentEl) contentEl.scrollTop = 0;

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
        // Always start on Collections sub-view when entering Discover
        switchDiscoverView('collections');
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
            showDistanceRow();
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
    // Reset inline UI
    document.querySelectorAll('.dc-dist-pill').forEach(function(p) { p.classList.remove('active'); });
    buildFriendsRow();
    // Restore collections view
    var ch  = document.getElementById('dcCircleHeader');
    var cg  = document.getElementById('dcCollectionsGrid');
    var ais = document.getElementById('dcAllItemsSection');
    if (ch)  ch.style.display  = '';
    if (cg)  cg.style.display  = '';
    if (ais) ais.style.display = 'none';
}

function applyFilters() {
    closeFilterModal();
    filterAndRender();
}

function handleSearchInput() {
    var text = document.getElementById('discoverSearch').value.trim();
    filters.searchText = text.toLowerCase();

    var ch  = document.getElementById('dcCircleHeader');
    var cg  = document.getElementById('dcCollectionsGrid');
    var ais = document.getElementById('dcAllItemsSection');
    var ait = document.getElementById('dcAllItemsTitle');
    var bb  = ais ? ais.querySelector('.dc-back-btn') : null;

    if (text) {
        // Show flat results grid, hide collections
        if (ch)  ch.style.display  = 'none';
        if (cg)  cg.style.display  = 'none';
        if (ais) ais.style.display = '';
        if (bb)  bb.style.display  = 'none';
    } else if (filters.users.length === 0 && filters.distances.length === 0) {
        // No inline filters — restore collections
        if (ch)  ch.style.display  = '';
        if (cg)  cg.style.display  = '';
        if (ais) ais.style.display = 'none';
        if (bb)  bb.style.display  = '';
    }

    filterAndRender();

    // Update results count in title
    if (text && ait) {
        ait.textContent = filteredDiscoveries.length + ' result' + (filteredDiscoveries.length !== 1 ? 's' : '');
    }
}

function searchFromDiscover() {
    const query = document.getElementById('discoverSearch').value.trim();
    if (!query) return;
    setMode('search');
    document.getElementById('messageInput').value = query;
    sendMessage();
}

// ── Discover page: friends filter bubbles ──

// Sentinel value used to filter extended circle items via the friends row
var EXTENDED_CIRCLE_FILTER_KEY = '__extended_circle__';

function buildFriendsRow() {
    var row = document.getElementById('dcFriendsRow');
    if (!row) return;
    if (!friendsCache || friendsCache.length === 0) { row.style.display = 'none'; return; }
    row.style.display = '';

    var html = '';

    // Check if any extended circle items exist in the feed
    var hasExtended = allDiscoveries.some(function(d) { return d._trust_level === TRUST.EXTENDED; });
    if (hasExtended) {
        var extActive = filters.users.includes(EXTENDED_CIRCLE_FILTER_KEY);
        html += '<button class="dc-friend-bubble dc-friend-bubble--extended' + (extActive ? ' active' : '') + '" onclick="toggleFriendFilter(\'' + EXTENDED_CIRCLE_FILTER_KEY + '\')">'
            + '<div class="dc-friend-initial dc-friend-initial--extended">🔵</div>'
            + '<span class="dc-friend-name">Circle</span>'
            + '</button>';
    }

    friendsCache.forEach(function(f) {
        var name = f.out_display_name || 'Unknown';
        var firstName = name.split(' ')[0];
        var initial = name.charAt(0).toUpperCase();
        var color = strColour(name);
        var isActive = filters.users.includes(name);

        var avatar = f.out_avatar_url
            ? '<img src="' + escapeHtml(f.out_avatar_url) + '" class="dc-friend-img" alt="' + escapeHtml(firstName) + '">'
            : '<div class="dc-friend-initial" style="background:' + color + ';">' + initial + '</div>';

        html += '<button class="dc-friend-bubble' + (isActive ? ' active' : '') + '" onclick="toggleFriendFilter(\'' + escapeHtml(name).replace(/'/g, "\\'") + '\')">'
            + avatar
            + '<span class="dc-friend-name">' + escapeHtml(firstName) + '</span>'
            + '</button>';
    });
    row.innerHTML = html;
}

function toggleFriendFilter(name) {
    var idx = filters.users.indexOf(name);
    if (idx >= 0) {
        filters.users.splice(idx, 1);
    } else {
        filters.users.push(name);
    }
    buildFriendsRow();

    // Toggle between flat grid and collections based on active inline filters
    var hasInline = !!(filters.searchText || filters.users.length > 0 || filters.distances.length > 0);
    var ch  = document.getElementById('dcCircleHeader');
    var cg  = document.getElementById('dcCollectionsGrid');
    var ais = document.getElementById('dcAllItemsSection');
    var ait = document.getElementById('dcAllItemsTitle');
    var bb  = ais ? ais.querySelector('.dc-back-btn') : null;

    if (hasInline) {
        if (ch)  ch.style.display  = 'none';
        if (cg)  cg.style.display  = 'none';
        if (ais) ais.style.display = '';
        if (bb)  bb.style.display  = 'none';
    } else {
        if (ch)  ch.style.display  = '';
        if (cg)  cg.style.display  = '';
        if (ais) ais.style.display = 'none';
        if (bb)  bb.style.display  = '';
    }

    filterAndRender();
    if (hasInline && ait) {
        ait.textContent = filteredDiscoveries.length + ' result' + (filteredDiscoveries.length !== 1 ? 's' : '');
    }
    updateFilterState();
}

// ── Discover page: distance quick pills ──

function toggleDistancePill(el, dist) {
    var idx = filters.distances.indexOf(dist);
    if (idx >= 0) {
        filters.distances = [];
        el.classList.remove('active');
    } else {
        filters.distances = [dist];
        document.querySelectorAll('.dc-dist-pill').forEach(function(p) { p.classList.remove('active'); });
        el.classList.add('active');
    }

    // Toggle flat grid vs collections
    var hasInline = !!(filters.searchText || filters.users.length > 0 || filters.distances.length > 0);
    var ch  = document.getElementById('dcCircleHeader');
    var cg  = document.getElementById('dcCollectionsGrid');
    var ais = document.getElementById('dcAllItemsSection');
    var ait = document.getElementById('dcAllItemsTitle');
    var bb  = ais ? ais.querySelector('.dc-back-btn') : null;

    if (hasInline) {
        if (ch)  ch.style.display  = 'none';
        if (cg)  cg.style.display  = 'none';
        if (ais) ais.style.display = '';
        if (bb)  bb.style.display  = 'none';
    } else {
        if (ch)  ch.style.display  = '';
        if (cg)  cg.style.display  = '';
        if (ais) ais.style.display = 'none';
        if (bb)  bb.style.display  = '';
    }

    filterAndRender();
    if (hasInline && ait) {
        ait.textContent = filteredDiscoveries.length + ' result' + (filteredDiscoveries.length !== 1 ? 's' : '');
    }
    updateFilterState();
}

function showDistanceRow() {
    var row = document.getElementById('dcDistanceRow');
    if (row && userLocation && userLocation.available) {
        row.style.display = '';
    }
}

// ── Discover page: count badges on category chips ──

function updateDiscoverCounts() {
    if (!allDiscoveries) return;
    var counts = { all: allDiscoveries.length, place: 0, product: 0, service: 0, advice: 0 };
    allDiscoveries.forEach(function(d) {
        var t = (d.type || '').toLowerCase();
        if (counts.hasOwnProperty(t)) counts[t]++;
    });
    var ids = { all: 'dcCountAll', place: 'dcCountPlace', product: 'dcCountProduct', service: 'dcCountService', advice: 'dcCountAdvice' };
    Object.keys(ids).forEach(function(k) {
        var el = document.getElementById(ids[k]);
        if (el) el.textContent = counts[k] > 0 ? counts[k] : '';
    });
}

function filterAndRender() {
    filteredDiscoveries = allDiscoveries.filter(item => {
        if (filters.categories.length > 0 && !filters.categories.includes(item.type)) return false;
        if (filters.users.length > 0) {
            const wantsExtended = filters.users.includes(EXTENDED_CIRCLE_FILTER_KEY);
            const isExtended = item._trust_level === TRUST.EXTENDED;
            // Extended circle filter: if sentinel selected, match FOF items
            // Named friend filters: match by added_by_name (excludes FOF items since they have no name)
            const namedFilters = filters.users.filter(u => u !== EXTENDED_CIRCLE_FILTER_KEY);
            const matchesNamed = namedFilters.length > 0 && namedFilters.includes(item.added_by_name);
            const matchesExtended = wantsExtended && isExtended;
            if (!matchesNamed && !matchesExtended) return false;
        }
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
    filters.users.forEach(user => {
        const label = user === EXTENDED_CIRCLE_FILTER_KEY ? '🔵 Extended Circle' : escapeHtml(user);
        html += `<span class="active-filter-chip">${label} <span class="active-filter-remove" onclick="removeActiveFilter('user', '${escapeHtml(user)}')">×</span></span>`;
    });
    if (filters.endorsed) html += `<span class="active-filter-chip">My Saves <span class="active-filter-remove" onclick="removeActiveFilter('endorsed', '')">×</span></span>`;
    filters.distances.forEach(dist => html += `<span class="active-filter-chip">&lt; ${dist}km <span class="active-filter-remove" onclick="removeActiveFilter('distance', '${dist}')">×</span></span>`);
    bar.innerHTML = html;
}

function removeActiveFilter(type, value) {
    if (type === 'category') {
        filters.categories = filters.categories.filter(c => c !== value);
        var catEl = document.getElementById('cat-' + value);
        if (catEl) catEl.checked = false;
    } else if (type === 'user') {
        filters.users = filters.users.filter(u => u !== value);
        var userEl = document.getElementById('user-' + value);
        if (userEl) userEl.checked = false;
        buildFriendsRow();
    } else if (type === 'endorsed') {
        filters.endorsed = false;
        const cb = document.getElementById('endorsed-mine');
        if (cb) cb.checked = false;
    } else if (type === 'distance') {
        filters.distances = filters.distances.filter(d => d != value);
        var distEl = document.getElementById('dist-' + value);
        if (distEl) distEl.checked = false;
        // Reset distance pills UI
        document.querySelectorAll('.dc-dist-pill').forEach(function(p) {
            p.classList.toggle('active', filters.distances.includes(Number(p.dataset.dist)));
        });
    }
    updateFilterState();
    filterAndRender();

    // If no inline filters remain, restore collections
    var hasInline = !!(filters.searchText || filters.users.length > 0 || filters.distances.length > 0);
    if (!hasInline) {
        var ch  = document.getElementById('dcCircleHeader');
        var cg  = document.getElementById('dcCollectionsGrid');
        var ais = document.getElementById('dcAllItemsSection');
        var bb  = ais ? ais.querySelector('.dc-back-btn') : null;
        if (ch)  ch.style.display  = '';
        if (cg)  cg.style.display  = '';
        if (ais) ais.style.display = 'none';
        if (bb)  bb.style.display  = '';
    }
}

// ── Odin Trust Layers ────────────────────────────────────────
// Trust level constants used throughout the app
const TRUST = { PRIVATE: 'private', FRIENDS: 'friends', EXTENDED: 'extended_circle' };

// Anonymise an extended-circle item so identity never travels more than one hop.
// Keeps: title, photo_url, address, latitude, longitude, description,
//        type, category, feed_card_summary, save_count, created_at, id
// Strips: added_by, added_by_name, personal_note / metadata notes, comments
function anonymiseForExtendedCircle(item) {
    return Object.assign({}, item, {
        _trust_level: TRUST.EXTENDED,
        added_by:      null,
        added_by_name: 'Someone in your circle',
        // Wipe any personal note stored in metadata or top-level field
        personal_note: null,
        metadata: item.metadata
            ? (() => { try { const m = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata; delete m.personal_note; return m; } catch(e) { return {}; } })()
            : null,
        // Comments are hidden — flagged so the drawer can suppress them
        _hide_comments: true,
    });
}

async function loadDiscoveries() {
    try {
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 180);

        // ── Tier 1 & 2: Own items + direct-friend items ──────────
        const response = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_items?select=*&order=created_at.desc`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });

        let data = await response.json();
        data = data.filter(item => new Date(item.created_at) >= twoWeeksAgo);

        const friendIds = new Set(friendsCache.map(f => f.out_user_id));
        if (currentUser) friendIds.add(currentUser.id);

        // Keep own items + direct-friend items only (Private + Friends tiers)
        data = data.filter(item => item.added_by && friendIds.has(item.added_by));

        // Hide private items — only the owner sees their own private items
        data = data.filter(item => {
            if (item.visibility === TRUST.PRIVATE) {
                return currentUser && item.added_by === currentUser.id;
            }
            return true; // 'friends' visibility passes through
        });

        // Tag direct-friend items with trust level
        data = data.map(item => {
            if (!item._trust_level) {
                item._trust_level = (item.added_by === currentUser?.id)
                    ? TRUST.PRIVATE  // own items (private or friends)
                    : TRUST.FRIENDS;
            }
            return item;
        });

        // ── Tier 3: Extended Circle (real friend-of-friend via trust_connections) ──
        // Uses the get_extended_circle_item_ids RPC which does a proper 2-hop join
        // on trust_connections: my friends → their friends → their 'friends'-visibility items.
        // Identity is stripped before any item reaches the client.
        let extendedItems = [];
        if (friendsCache.length > 0) {
            try {
                const { data: fofRows, error: fofError } = await supabaseClient.rpc(
                    'get_extended_circle_item_ids',
                    { p_user_id: currentUser.id }
                );

                if (fofError) {
                    console.warn('Extended circle RPC error (non-critical):', fofError.message);
                } else if (fofRows && fofRows.length > 0) {
                    // Build a set of FOF item IDs returned by the server
                    const fofItemIds = fofRows.map(r => r.item_id);
                    const seenIds = new Set(data.map(i => i.id));

                    // Fetch only the specific items the server confirmed are FOF-eligible
                    // We filter out any IDs already shown in the direct-friends feed
                    const eligibleIds = fofItemIds.filter(id => !seenIds.has(id));

                    if (eligibleIds.length > 0) {
                        // Fetch full item details for eligible IDs in one batched query
                        const { data: extData, error: extFetchError } = await supabaseClient
                            .from('knowledge_items')
                            .select('id, title, photo_url, address, latitude, longitude, description, type, category, feed_card_summary, created_at, added_by, visibility')
                            .in('id', eligibleIds)
                            .gte('created_at', twoWeeksAgo.toISOString())
                            .order('created_at', { ascending: false });

                        if (extFetchError) {
                            console.warn('Extended circle item fetch error (non-critical):', extFetchError.message);
                        } else if (extData && extData.length > 0) {
                            // Anonymise every item — identity never travels more than one hop
                            extendedItems = extData.map(anonymiseForExtendedCircle);
                        }
                    }
                }
            } catch (extErr) {
                console.warn('Extended circle fetch failed (non-critical):', extErr);
            }
        }

        // Merge: friends feed first, then extended circle items
        let combined = [...data, ...extendedItems];

        // Hide discoveries from blocked users (apply to all tiers)
        if (blockedUsersCache.length > 0) {
            const blockedIds = new Set(blockedUsersCache.map(b => b.out_blocked_user_id));
            // For extended circle items, added_by is already null — they pass through safely
            combined = combined.filter(item => !item.added_by || !blockedIds.has(item.added_by));
        }

        if (userLocation.available) {
            combined = combined.map(item => {
                if (item.latitude && item.longitude) {
                    item.distance_km = calculateDistance(userLocation.latitude, userLocation.longitude, item.latitude, item.longitude);
                }
                return item;
            });
        }

        allDiscoveries = combined;
        await loadEndorsementsForItems(combined);
        populateFilters();
        filterAndRender();
        renderRecentlyViewed();
        buildCollectionCards();
        buildFriendsRow();
        updateDiscoverCounts();
        showDistanceRow();
        // Refresh map panel list if map is already open
        if (discoverViewMode === 'map' && discoverMap) buildMapPanelList();
    } catch (error) {
        console.error('Error loading discoveries:', error);
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

    // ── Odin Trust Layer: determine what this viewer can see ──
    const isExtendedCircle = item._trust_level === TRUST.EXTENDED;

    // Privacy: only show personal note snippet to direct friends; hide for extended circle
    let snippet = '';
    let snippetHtml = '';
    if (isExtendedCircle) {
        // Extended circle: description only, no personal stories
        if (item.description) {
            snippet = item.description;
            snippetHtml = `<div class="discovery-card-snippet">${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>`;
        }
    } else if (note && isFriend(item.added_by)) {
        snippet = note;
        snippetHtml = `<div class="discovery-card-snippet">💭 ${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>`;
    } else if (note && !isFriend(item.added_by)) {
        snippetHtml = `<div class="discovery-card-snippet privacy-teaser-card">🔒 Connect to see their story</div>`;
    } else if (item.description) {
        snippet = item.description;
        snippetHtml = `<div class="discovery-card-snippet">${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>`;
    }

    let tagsHtml = '<div class="discovery-card-tags">';
    if (item.visibility === TRUST.PRIVATE) tagsHtml += `<span class="private-badge">Private</span>`;
    if (distText) tagsHtml += `<span class="discovery-tag discovery-tag-distance">📍 ${distText}</span>`;
    if (isExtendedCircle) {
        // Extended circle: blue badge + total save count (no identity)
        const totalSaves = (endorsementsCache[item.id] || {}).count || 0;
        const saveLabel = totalSaves > 0 ? ` · ${totalSaves} save${totalSaves !== 1 ? 's' : ''}` : '';
        tagsHtml += `<span class="discovery-tag discovery-tag-person extended-circle-badge">🔵 Extended circle${saveLabel}</span>`;
    } else if (item.added_by_name) {
        tagsHtml += `<span class="discovery-tag discovery-tag-person">${escapeHtml(item.added_by_name)}</span>`;
    }
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

// Category → colour mapping for map pins
var CAT_COLOURS = {
    place: '#C4693A', food: '#C4693A', restaurant: '#C4693A',
    service: '#3D6B8C', services: '#3D6B8C',
    beauty: '#8B5E72',
    health: '#7B2D45',
    education: '#4A7A5C',
    home: '#A0682A',
    product: '#5A6BAD', products: '#5A6BAD',
    advice: '#6BAD5A'
};
function catColour(cat) {
    return CAT_COLOURS[(cat||'').toLowerCase()] || '#7B2D45';
}

var dmapMarkers = []; // { item, marker }

function buildMapPanelList() {
    var list = document.getElementById('dmapPanelList');
    var countEl = document.getElementById('dmapPanelCount');
    if (!list) return;
    var located = (filteredDiscoveries || allDiscoveries || []).filter(function(d){ return d.latitude && d.longitude; });
    if (countEl) countEl.textContent = located.length + ' place' + (located.length !== 1 ? 's' : '') + ' nearby';
    list.innerHTML = '';
    located.forEach(function(d, i) {
        var col = catColour(d.category || d.type);
        var distText = d.distance_km ? (d.distance_km < 1 ? Math.round(d.distance_km*1000)+'m' : d.distance_km.toFixed(1)+'km') : '';
        var item = document.createElement('div');
        item.className = 'dmap-panel-item';
        item.id = 'dpi-' + i;
        var piByText = d._trust_level === TRUST.EXTENDED
            ? '🔵 Extended circle'
            : ('by ' + escapeHtml(d.added_by_name || '?'));
        item.innerHTML =
            '<div class="dmap-pi-dot" style="background:' + col + ';"></div>' +
            '<div class="dmap-pi-info">' +
                '<div class="dmap-pi-name">' + escapeHtml(d.title) + '</div>' +
                '<div class="dmap-pi-meta">' + piByText + ' &middot; ' + escapeHtml(d.category || '') + '</div>' +
            '</div>' +
            '<div class="dmap-pi-right">' +
                '<div class="dmap-pi-dist">' + distText + '</div>' +
            '</div>';
        item.onclick = (function(idx){ return function(){ focusMapItem(idx); }; })(i);
        list.appendChild(item);
    });
}

function buildMapCardStrip() {
    var strip = document.getElementById('dmapCardsStrip');
    if (!strip) return;
    var located = (filteredDiscoveries || allDiscoveries || []).filter(function(d){ return d.latitude && d.longitude; });
    strip.innerHTML = '';
    located.forEach(function(d, i) {
        var col = catColour(d.category || d.type);
        var isExtCard = d._trust_level === TRUST.EXTENDED;
        var avInit = isExtCard ? '🔵' : (d.added_by_name || '?').charAt(0).toUpperCase();
        var avCol  = isExtCard ? '#3b82f6' : strColour(d.added_by_name || '?');
        var avStyle = isExtCard ? 'background:' + avCol + ';font-size:12px;' : 'background:' + avCol + ';';
        var byText = isExtCard
            ? '<strong>Extended circle</strong>'
            : 'by <strong>' + escapeHtml(d.added_by_name || '?') + '</strong>';
        var totalSaves = isExtCard ? ((endorsementsCache[d.id] || {}).count || 0) : (d.endorsement_count || 1);
        var distText = d.distance_km ? (d.distance_km < 1 ? Math.round(d.distance_km*1000)+'m' : d.distance_km.toFixed(1)+'km') : '';
        var card = document.createElement('div');
        card.className = 'dmap-card';
        card.id = 'dmc-' + i;
        card.innerHTML =
            '<div class="dmc-header">' +
                '<div class="dmc-dot" style="background:' + col + ';"></div>' +
                '<div class="dmc-name">' + escapeHtml(d.title) + '</div>' +
                '<div class="dmc-dist">' + distText + '</div>' +
            '</div>' +
            '<div class="dmc-by">' +
                '<div class="dmc-avatar" style="' + avStyle + '">' + avInit + '</div>' +
                '<div class="dmc-by-text">' + byText + '</div>' +
            '</div>' +
            '<div class="dmc-odin-row">' +
                '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                totalSaves + ' save' + (totalSaves !== 1 ? 's' : '') +
            '</div>';
        card.onclick = (function(idx){ return function(){ focusMapItem(idx); }; })(i);
        strip.appendChild(card);
    });
}

function focusMapItem(idx) {
    // Activate card strip
    document.querySelectorAll('.dmap-card').forEach(function(c){ c.classList.remove('active-card'); });
    var card = document.getElementById('dmc-' + idx);
    if (card) { card.classList.add('active-card'); card.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' }); }
    // Activate panel item
    document.querySelectorAll('.dmap-panel-item').forEach(function(i){ i.classList.remove('active-item'); });
    var pItem = document.getElementById('dpi-' + idx);
    if (pItem) { pItem.classList.add('active-item'); pItem.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
    // Pan map to exact center, then open popup (autoPan disabled on popup so it won't fight setView)
    var m = dmapMarkers[idx];
    if (m && discoverMap) {
        discoverMap.setView([m.lat, m.lng], 16, { animate: true });
        setTimeout(function(){ if (m.marker) m.marker.openPopup(); }, 350);
    }
}

// Opens the full detail drawer from a map popup "View" button
function openMapItemDrawer(idx) {
    var m = dmapMarkers[idx];
    if (m && m.data) openItemDrawer(m.data);
}

function filterMapList(query) {
    var q = query.toLowerCase().trim();
    var count = 0;

    dmapMarkers.forEach(function(m, idx) {
        var title = (m.data.title || '').toLowerCase();
        var cat   = (m.data.category || m.data.type || '').toLowerCase();
        var by    = (m.data.added_by_name || '').toLowerCase();
        var match = !q || title.includes(q) || cat.includes(q) || by.includes(q);

        // Show/hide panel item
        var pi = document.getElementById('dpi-' + idx);
        if (pi) pi.style.display = match ? '' : 'none';

        // Show/hide card strip card
        var card = document.getElementById('dmc-' + idx);
        if (card) card.style.display = match ? '' : 'none';

        // Show/hide map marker
        if (discoverMap) {
            if (match) {
                if (!discoverMap.hasLayer(m.marker)) m.marker.addTo(discoverMap);
                count++;
            } else {
                if (discoverMap.hasLayer(m.marker)) discoverMap.removeLayer(m.marker);
            }
        }
    });

    // Update count label
    var countEl = document.getElementById('dmapPanelCount');
    if (countEl) countEl.textContent = (q ? count : dmapMarkers.length) + ' place' + ((q ? count : dmapMarkers.length) !== 1 ? 's' : '') + (q ? ' found' : ' nearby');
}

// Rebuild panel list and card strip sorted by distance from (lat, lng).
// Called after async geolocation resolves so the lists update in place.
function rebuildMapListsSorted(userLat, userLng) {
    if (!dmapMarkers || dmapMarkers.length === 0) return;
    // Re-sort dmapMarkers by distance
    dmapMarkers.forEach(function(m) {
        m.dist = calculateDistance(userLat, userLng, m.lat, m.lng);
        m.data.distance_km = m.dist;
    });
    dmapMarkers.sort(function(a, b) { return a.dist - b.dist; });

    var list  = document.getElementById('dmapPanelList');
    var strip = document.getElementById('dmapCardsStrip');
    var countEl = document.getElementById('dmapPanelCount');
    if (list)  list.innerHTML  = '';
    if (strip) strip.innerHTML = '';

    dmapMarkers.forEach(function(m, idx) {
        var d = m.data;
        var col = catColour(d.category || d.type);
        var distText = m.dist < 1 ? Math.round(m.dist * 1000) + 'm' : m.dist.toFixed(1) + 'km';

        // Rebind click with new index
        m.marker.off('click');
        (function(i){ m.marker.on('click', function(){ focusMapItem(i); }); })(idx);

        if (list) {
            var pi = document.createElement('div');
            pi.className = 'dmap-panel-item';
            pi.id = 'dpi-' + idx;
            pi.innerHTML =
                '<div class="dmap-pi-dot" style="background:' + col + ';"></div>' +
                '<div class="dmap-pi-info">' +
                    '<div class="dmap-pi-name">' + escapeHtml(d.title) + '</div>' +
                    '<div class="dmap-pi-meta">by <strong>' + escapeHtml(d.added_by_name || '?') + '</strong>&nbsp;&middot;&nbsp;' + escapeHtml(d.category || '') + '</div>' +
                '</div>' +
                '<div class="dmap-pi-right"><div class="dmap-pi-dist">' + distText + '</div></div>';
            (function(i){ pi.onclick = function(){ focusMapItem(i); }; })(idx);
            list.appendChild(pi);
        }
        if (strip) {
            var avInit = (d.added_by_name || '?').charAt(0).toUpperCase();
            var avCol  = strColour(d.added_by_name || '?');
            var card = document.createElement('div');
            card.className = 'dmap-card';
            card.id = 'dmc-' + idx;
            card.innerHTML =
                '<div class="dmc-header">' +
                    '<div class="dmc-dot" style="background:' + col + ';"></div>' +
                    '<div class="dmc-name">' + escapeHtml(d.title) + '</div>' +
                    '<div class="dmc-dist">' + distText + '</div>' +
                '</div>' +
                '<div class="dmc-by">' +
                    '<div class="dmc-avatar" style="background:' + avCol + ';">' + avInit + '</div>' +
                    '<div class="dmc-by-text">by <strong>' + escapeHtml(d.added_by_name || '?') + '</strong></div>' +
                '</div>' +
                '<div class="dmc-odin-row">' +
                    '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                    (d.endorsement_count || 1) + ' save' + ((d.endorsement_count || 1) !== 1 ? 's' : '') +
                '</div>';
            (function(i){ card.onclick = function(){ focusMapItem(i); }; })(idx);
            strip.appendChild(card);
        }
    });
    if (countEl) countEl.textContent = dmapMarkers.length + ' place' + (dmapMarkers.length !== 1 ? 's' : '') + ' nearby';
}

function initDiscoverMap() {
    var mapEl = document.getElementById('discoverMap');
    if (!mapEl) return;
    if (discoverMap) { try { discoverMap.remove(); } catch(e) {} discoverMap = null; }
    // Belt-and-suspenders: clear any stale Leaflet marker on the container.
    if (mapEl._leaflet_id !== undefined) {
        mapEl._leaflet_id = undefined;
        mapEl.innerHTML = '';
    }

    // Apply height before Leaflet reads container size
    setMapScreenHeight();

    var source = (filteredDiscoveries && filteredDiscoveries.length > 0) ? filteredDiscoveries : allDiscoveries;
    // Pre-filter AND pre-parse so indices are consistent everywhere
    var located = (source || []).reduce(function(acc, d) {
        var lat = parseFloat(d.latitude);
        var lng = parseFloat(d.longitude);
        // Skip null-island (0,0) — result of failed geocoding
        if (!isNaN(lat) && !isNaN(lng) && (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01)) acc.push({ data: d, lat: lat, lng: lng });
        return acc;
    }, []);

    // Compute distances and sort closest-first if user location is available
    if (userLocation.available) {
        located.forEach(function(entry) {
            entry.dist = calculateDistance(userLocation.latitude, userLocation.longitude, entry.lat, entry.lng);
            entry.data.distance_km = entry.dist;
        });
        located.sort(function(a, b) { return a.dist - b.dist; });
    }

    try {
        discoverMap = L.map('discoverMap', { zoomControl: false });
    } catch(e) {
        return;
    }

    // CartoDB Positron — clean minimal tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(discoverMap);

    // User location dot
    if (userLocation.available) {
        userLocMarker = L.circleMarker([userLocation.latitude, userLocation.longitude], {
            radius: 8, color: 'white', weight: 3, fillColor: '#2979FF', fillOpacity: 1
        }).addTo(discoverMap).bindTooltip('You are here', { direction: 'top' });
    }

    var bounds = [];
    dmapMarkers = [];

    // Clear panel + strip before rebuilding inline
    var _list  = document.getElementById('dmapPanelList');
    var _strip = document.getElementById('dmapCardsStrip');
    if (_list)  _list.innerHTML  = '';
    if (_strip) _strip.innerHTML = '';

    // Build markers — index matches located[] exactly (no skips)
    located.forEach(function(entry, idx) {
        var d   = entry.data;
        var lat = entry.lat;
        var lng = entry.lng;
        bounds.push([lat, lng]);

        var col        = catColour(d.category || d.type);
        var catInitial = (d.category || 'P').charAt(0).toUpperCase();
        var avInit     = (d.added_by_name || '?').charAt(0).toUpperCase();
        var avCol      = strColour(d.added_by_name || '?');
        var distText   = d.distance_km
            ? (d.distance_km < 1 ? Math.round(d.distance_km * 1000) + 'm' : d.distance_km.toFixed(1) + 'km')
            : '';

        var pinHtml = '<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:' + col + ';display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(42,30,20,0.28);border:2.5px solid rgba(250,246,238,0.92);"><span style="transform:rotate(45deg);font-size:10px;font-weight:700;color:white;font-family:Inter,sans-serif;line-height:1;">' + catInitial + '</span></div>';
        var icon = L.divIcon({ html: pinHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -34] });

        var popHtml =
            '<div class="odin-pop">' +
                '<div class="odin-pop-cat">' +
                    '<div class="odin-pop-dot" style="background:' + col + ';"></div>' +
                    '<span class="odin-pop-label" style="color:' + col + ';">' + escapeHtml(d.category || '') + '</span>' +
                '</div>' +
                '<div class="odin-pop-name">' + escapeHtml(d.title) + '</div>' +
                '<div class="odin-pop-by">' +
                    '<div class="odin-pop-av" style="background:' + avCol + ';">' + avInit + '</div>' +
                    '<div class="odin-pop-by-text">by <strong>' + escapeHtml(d.added_by_name || '?') + '</strong></div>' +
                '</div>' +
                '<button class="odin-pop-view" onclick="openMapItemDrawer(' + idx + ')">View details ›</button>' +
            '</div>';

        var marker = L.marker([lat, lng], { icon: icon })
            .addTo(discoverMap)
            .bindPopup(popHtml, { maxWidth: 240, autoPan: false });

        // Desktop: hover opens popup preview; Click: pan + highlight only (popup opens via Leaflet default)
        (function(i){
            marker.on('mouseover', function(){ this.openPopup(); });
            marker.on('click', function(){ focusMapItem(i); });
        })(idx);
        dmapMarkers.push({ lat: lat, lng: lng, marker: marker, data: d });

        // ── Build panel item inline (same loop = guaranteed index match) ──
        var list  = document.getElementById('dmapPanelList');
        if (list) {
            var pi = document.createElement('div');
            pi.className = 'dmap-panel-item';
            pi.id = 'dpi-' + idx;
            pi.innerHTML =
                '<div class="dmap-pi-dot" style="background:' + col + ';"></div>' +
                '<div class="dmap-pi-info">' +
                    '<div class="dmap-pi-name">' + escapeHtml(d.title) + '</div>' +
                    '<div class="dmap-pi-meta">by <strong>' + escapeHtml(d.added_by_name || '?') + '</strong>&nbsp;&middot;&nbsp;' + escapeHtml(d.category || '') + '</div>' +
                '</div>' +
                '<div class="dmap-pi-right">' +
                    '<div class="dmap-pi-dist">' + distText + '</div>' +
                '</div>';
            (function(i){ pi.onclick = function(){ focusMapItem(i); }; })(idx);
            list.appendChild(pi);
        }

        // ── Build card strip item inline ──
        var strip = document.getElementById('dmapCardsStrip');
        if (strip) {
            var card = document.createElement('div');
            card.className = 'dmap-card';
            card.id = 'dmc-' + idx;
            card.innerHTML =
                '<div class="dmc-header">' +
                    '<div class="dmc-dot" style="background:' + col + ';"></div>' +
                    '<div class="dmc-name">' + escapeHtml(d.title) + '</div>' +
                    '<div class="dmc-dist">' + distText + '</div>' +
                '</div>' +
                '<div class="dmc-by">' +
                    '<div class="dmc-avatar" style="background:' + avCol + ';">' + avInit + '</div>' +
                    '<div class="dmc-by-text">by <strong>' + escapeHtml(d.added_by_name || '?') + '</strong></div>' +
                '</div>' +
                '<div class="dmc-odin-row">' +
                    '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                    (d.endorsement_count || 1) + ' save' + ((d.endorsement_count || 1) !== 1 ? 's' : '') +
                '</div>';
            (function(i){ card.onclick = function(){ focusMapItem(i); }; })(idx);
            strip.appendChild(card);
        }
    });

    // Update panel count
    var countEl = document.getElementById('dmapPanelCount');
    if (countEl) countEl.textContent = located.length + ' place' + (located.length !== 1 ? 's' : '') + ' nearby';

    // Update panel count
    // ── Centre on user location; fall back to fitBounds ──
    function centreOnUser(lat, lng) {
        discoverMap.setView([lat, lng], 14, { animate: false });
        // Add / update the blue "you are here" dot
        if (userLocMarker) {
            userLocMarker.setLatLng([lat, lng]);
        } else {
            userLocMarker = L.circleMarker([lat, lng], {
                radius: 8, color: 'white', weight: 3, fillColor: '#2979FF', fillOpacity: 1
            }).addTo(discoverMap).bindTooltip('You are here', { direction: 'top' });
        }
    }

    // Always set an initial view so Leaflet renders tiles immediately.
    if (userLocation.available) {
        centreOnUser(userLocation.latitude, userLocation.longitude);
    } else if (bounds.length > 0) {
        discoverMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        // Sanity check — if still too zoomed out (bad coords pulled bounds wide), reset to Auckland
        if (discoverMap.getZoom() < 9) {
            discoverMap.setView([-36.8485, 174.7633], 12, { animate: false });
        }
    } else {
        discoverMap.setView([-36.8485, 174.7633], 12, { animate: false });
    }

    if (userLocation.available) {
        // Already handled above — nothing more to do
    } else if (navigator.geolocation) {
        // Request GPS; re-centre when we get it
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                userLocation.latitude  = pos.coords.latitude;
                userLocation.longitude = pos.coords.longitude;
                userLocation.available = true;
                centreOnUser(userLocation.latitude, userLocation.longitude);
                // Re-sort panel + card lists by distance now that we have location
                rebuildMapListsSorted(userLocation.latitude, userLocation.longitude);
            },
            function() {
                // GPS denied/failed — keep whatever view is already set
            },
            { timeout: 6000, enableHighAccuracy: true }
        );
    }

    // Force Leaflet to redraw after layout settles
    setTimeout(function(){ if (discoverMap) discoverMap.invalidateSize(); }, 150);
    setTimeout(function(){ if (discoverMap) discoverMap.invalidateSize(); }, 500);
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

    // ── Odin Trust Layer ──────────────────────────────────────
    const trustLevel = item._trust_level || TRUST.FRIENDS;
    const isExtendedCircle = trustLevel === TRUST.EXTENDED;
    const isOwner = currentUser && (item.added_by === currentUser.id);
    let html = '';

    // === HERO PHOTO ===
    if (item.photo_url) {
        html += `<div class="drawer-hero" onclick="event.stopPropagation(); openLightbox('${escapeHtml(item.photo_url)}');">
            <img src="${escapeHtml(item.photo_url)}">
            <div class="drawer-hero-fade"></div>
        </div>`;
    }

    // === TITLE + EDIT ===
    html += `<div class="drawer-body">`;
    html += `<div class="drawer-title-row"><h1 class="drawer-title">${escapeHtml(item.title)}</h1>`;
    if (isOwner) {
        html += `<button class="drawer-edit-btn" onclick="enterEditMode()" title="Edit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7B2D45" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
    }
    html += `</div>`;

    // === META LINE (inline) ===
    let metaParts = [];
    if (item.distance_km) {
        const dist = item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km';
        metaParts.push(`<span class="drawer-meta-dist">${dist} away</span>`);
    }
    if (isExtendedCircle) {
        // Extended Circle: hide real identity — show anonymous signal only
        metaParts.push(`<span class="drawer-meta-by extended-circle-anon">🔵 Someone in your circle</span>`);
    } else {
        metaParts.push(`<span class="drawer-meta-by">${escapeHtml(item.added_by_name || 'Community Member')}</span>`);
    }
    html += `<div class="drawer-meta-line">${metaParts.join('<span class="drawer-meta-dot">·</span>')}</div>`;

    // Extract personal note from multiple possible fields
    let note = null;
    if (!isExtendedCircle) {
        // Only attempt to read personal note for Private/Friends tiers
        if (item.PersonalNote) note = item.PersonalNote;
        else if (item.personal_note) note = item.personal_note;
        else if (item.metadata) {
            try {
                const meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
                note = meta.personal_note;
            } catch (e) {}
        }
    }

    // === THE WORD (pull-quote style) ===
    if (isExtendedCircle) {
        html += `<div class="drawer-quote drawer-quote-extended">
            <div class="drawer-quote-label">The Word</div>
            <div class="drawer-quote-text drawer-story-text">🔒 Connect to see their take</div>
        </div>`;
    } else if (note) {
        if (isFriend(item.added_by)) {
            html += `<div class="drawer-quote">
                <div class="drawer-quote-label">The Word</div>
                <div class="drawer-quote-text drawer-story-text">${escapeHtml(note)}</div>
            </div>`;
            // Translate button — inside the quote block, subtle
            if (userPreferredLanguage && userPreferredLanguage !== 'en') {
                html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">🌐 Translate to ${(LANG_LABELS[userPreferredLanguage] || userPreferredLanguage)}</button>`;
            } else if (item._queryLanguage && item._queryLanguage !== 'en') {
                html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">🌐 Translate</button>`;
            }
        } else {
            html += `<div class="drawer-quote drawer-quote-locked">
                <div class="drawer-quote-label">The Word</div>
                <div class="drawer-quote-text drawer-story-text">Connect with ${escapeHtml(item.added_by_name || 'them')} to see their take</div>
            </div>`;
        }
    } else if (item.description) {
        // Fallback: show description as "The Word" if no personal note
        html += `<div class="drawer-quote">
            <div class="drawer-quote-label">The Word</div>
            <div class="drawer-quote-text drawer-story-text">${escapeHtml(item.description)}</div>
        </div>`;
        if (userPreferredLanguage && userPreferredLanguage !== 'en') {
            html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">🌐 Translate to ${(LANG_LABELS[userPreferredLanguage] || userPreferredLanguage)}</button>`;
        } else if (item._queryLanguage && item._queryLanguage !== 'en') {
            html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">🌐 Translate</button>`;
        }
    }

    // === QUICK ACTIONS (compact pills — visible to all tiers) ===
    let url = null;
    if (item.URL) {
        if (Array.isArray(item.URL) && item.URL.length > 0) url = item.URL[0];
        else if (typeof item.URL === 'string' && item.URL.startsWith('http')) url = item.URL;
    }
    if (!url && item.url) url = item.url;
    if (!url && item.website) url = item.website;

    if (url || item.address) {
        const itemType = (item.type || item.category || '').toLowerCase();
        const isPlace = itemType === 'place' || (!itemType && item.address);
        // Primary = Directions for places, Website for products/services
        html += '<div class="drawer-quick-actions">';
        if (item.address) {
            html += `<div class="drawer-address-line"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escapeHtml(item.address)}</div>`;
        }
        html += '<div class="drawer-action-btns">';
        if (isPlace) {
            // Place: Directions = primary, Website = secondary
            if (item.address) {
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
                html += `<button class="drawer-btn-primary" onclick="window.open('${mapsUrl}', '_blank')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg> Directions</button>`;
            }
            if (url) html += `<button class="drawer-btn-secondary" onclick="window.open('${escapeHtml(url)}', '_blank')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Website</button>`;
        } else {
            // Product/Service: Website = primary, Directions = secondary
            if (url) html += `<button class="drawer-btn-primary" onclick="window.open('${escapeHtml(url)}', '_blank')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Website</button>`;
            if (item.address) {
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
                html += `<button class="drawer-btn-secondary" onclick="window.open('${mapsUrl}', '_blank')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg> Directions</button>`;
            }
        }
        html += '</div></div>';
    }

    // === SOCIAL: Save + Friends ===
    if (item.id) {
        currentDrawerItemId = item.id;
        html += `<div class="drawer-social">
            ${buildEndorseSection(item.id)}
            <div class="drawer-comments" id="communityNotesContainer"><div class="notes-loading">Loading comments...</div></div>
        </div>`;
    }

    html += `</div>`; // close .drawer-body

    document.getElementById('drawerContent').innerHTML = html;
    document.getElementById('drawerBackdrop').classList.add('active');
    document.getElementById('detailDrawer').classList.add('open');

    // Load community notes asynchronously (extended circle sees locked message)
    if (item.id) {
        if (isExtendedCircle) {
            const container = document.getElementById('communityNotesContainer');
            if (container) container.innerHTML = renderNotesSection(item.id, [], TRUST.EXTENDED);
        } else {
            loadNotesForItem(item.id).then(notes => {
                const container = document.getElementById('communityNotesContainer');
                if (container) {
                    container.innerHTML = renderNotesSection(item.id, notes, trustLevel);
                }
            });
        }
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
        html += `<div class="drawer-hero"><img src="${escapeHtml(item.photo_url)}"></div>`;
    }

    html += `<div class="drawer-body"><div class="edit-form" id="drawerEditForm">
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

        <div class="visibility-group" style="margin-top: 8px;">
            <div class="visibility-label-row">
                <span class="visibility-section-label">VISIBILITY</span>
            </div>
            <div class="privacy-toggle-row" onclick="togglePrivacy('editPrivateToggle')">
                <div class="visibility-status">
                    <span class="visibility-icon" id="editPrivateToggleIcon">${item.visibility === 'private' ? '🔒' : '👥'}</span>
                    <div class="visibility-info">
                        <span class="visibility-title" id="editPrivateToggleTitle">${item.visibility === 'private' ? 'Only you' : 'Friends'}</span>
                        <span class="visibility-desc" id="editPrivateToggleDesc">${item.visibility === 'private' ? 'Hidden from everyone else' : 'Your connections can see this'}</span>
                    </div>
                </div>
                <div class="privacy-toggle-track ${item.visibility === 'private' ? 'active' : ''}" id="editPrivateToggleTrack">
                    <div class="privacy-toggle-knob"></div>
                </div>
            </div>
        </div>
        <input type="hidden" id="editPrivateToggle" value="${item.visibility === 'private' ? 'true' : 'false'}">

        <div class="edit-actions">
            <button class="edit-cancel-btn" onclick="openItemDrawer(currentDrawerItem)">Cancel</button>
            <button class="edit-save-btn" id="editSaveBtn" onclick="saveItemEdit('${item.id}')">Save Changes</button>
        </div>
        <div id="editMessage"></div>

        <div class="edit-delete-zone">
            <button class="edit-delete-btn" onclick="confirmDeleteItem('${item.id}')">Delete this item</button>
        </div>
        <div class="edit-delete-confirm hidden" id="deleteItemConfirm_${item.id}">
            <p class="edit-delete-warning" id="deleteItemWarning_${item.id}">Loading...</p>
            <div class="edit-delete-confirm-actions">
                <button class="edit-delete-cancel-btn" onclick="cancelDeleteItem('${item.id}')">Keep it</button>
                <button class="edit-delete-go-btn" id="deleteItemGoBtn_${item.id}" onclick="executeDeleteItem('${item.id}')">Yes, delete</button>
            </div>
        </div>
    </div></div>`;

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
    const newVisibility = document.getElementById('editPrivateToggle').value === 'true' ? 'private' : 'friends';

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
            personal_note: newNote || null,
            visibility: newVisibility
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

// ===== DELETE ITEM =====

async function confirmDeleteItem(itemId) {
    const confirmEl = document.getElementById(`deleteItemConfirm_${itemId}`);
    const warningEl = document.getElementById(`deleteItemWarning_${itemId}`);

    // If the confirm panel elements aren't in the DOM (e.g. not in edit mode),
    // fall back to a simple native confirm dialog
    if (!confirmEl || !warningEl) {
        const proceed = window.confirm('Are you sure you want to permanently delete this item? This cannot be undone.');
        if (proceed) executeDeleteItem(itemId);
        return;
    }

    // Show the inline confirmation panel
    confirmEl.classList.remove('hidden');

    // Scroll the confirm section into view so users can see it on small screens
    confirmEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Count how many OTHER users have saved (endorsed) this item
    try {
        const { data, error } = await supabaseClient
            .from('endorsements')
            .select('user_id')
            .eq('item_id', itemId)
            .neq('user_id', currentUser.id);

        const count = (!error && data) ? data.length : 0;
        if (count > 0) {
            warningEl.textContent = `⚠️ ${count} friend${count === 1 ? '' : 's'} ha${count === 1 ? 's' : 've'} also saved this. Deleting will remove it for everyone.`;
        } else {
            warningEl.textContent = '🗑️ No one else has saved this. It will be permanently deleted.';
        }
    } catch (e) {
        warningEl.textContent = '⚠️ This will permanently delete the item for everyone.';
    }
}

function cancelDeleteItem(itemId) {
    const confirmEl = document.getElementById(`deleteItemConfirm_${itemId}`);
    if (confirmEl) confirmEl.classList.add('hidden');
}

async function executeDeleteItem(itemId) {
    const btn = document.getElementById(`deleteItemGoBtn_${itemId}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }

    try {
        // Delete all endorsements for this item first (foreign key safety)
        await supabaseClient.from('endorsements').delete().eq('item_id', itemId);
        // Delete the item itself
        await supabaseClient.from('knowledge_items').delete().eq('id', itemId).eq('added_by', currentUser.id);

        // Remove from local cache
        allDiscoveries = allDiscoveries.filter(d => d.id !== itemId);
        delete endorsementsCache[itemId];

        // Close the drawer
        closeDrawer();
        showToast('Item deleted.');

        // Refresh discover view if open
        filterAndRender();
    } catch (err) {
        console.error('Delete item error:', err);
        if (btn) { btn.disabled = false; btn.textContent = 'Yes, delete'; }
        showToast('Could not delete. Please try again.');
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
    const trustLevel = currentDrawerItem?._trust_level || TRUST.FRIENDS;
    loadNotesForItem(itemId).then(notes => {
        const container = document.getElementById('communityNotesContainer');
        if (container) container.innerHTML = renderNotesSection(itemId, notes, trustLevel);
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
        const trustLevel = currentDrawerItem?._trust_level || TRUST.FRIENDS;
        const container = document.getElementById('communityNotesContainer');
        if (container) container.innerHTML = renderNotesSection(itemId, notes, trustLevel);
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

// ── Progressive search status messages ──
let _searchMsgTimer = null;
const _searchMessages = [
    { delay: 3000,  text: 'Looking through your network...' },
    { delay: 6000,  text: 'Digging a bit deeper...' },
    { delay: 9000,  text: 'Almost there...' },
    { delay: 12000, text: 'Tidying up results...' }
];
const _searchMessagesAlt = [
    { delay: 3000,  text: 'Scanning your friends\' picks...' },
    { delay: 6000,  text: 'Your friends have a lot to say...' },
    { delay: 9000,  text: 'Narrowing it down...' },
    { delay: 12000, text: 'Putting it all together...' }
];

function startSearchMessages() {
    stopSearchMessages();
    const msgs = Math.random() < 0.5 ? _searchMessages : _searchMessagesAlt;
    const timers = [];
    msgs.forEach(m => {
        const t = setTimeout(() => {
            const el = document.querySelector('#typing .search-status-text');
            if (el) {
                el.style.opacity = '0';
                setTimeout(() => { el.textContent = m.text; el.style.opacity = '1'; }, 200);
            }
        }, m.delay);
        timers.push(t);
    });
    _searchMsgTimer = timers;
}

function stopSearchMessages() {
    if (_searchMsgTimer) {
        _searchMsgTimer.forEach(t => clearTimeout(t));
        _searchMsgTimer = null;
    }
}

function sendMessage(text) {
    const input = document.getElementById('messageInput');
    const query = text || input.value.trim();
    if (!query) return;

    // Reset translation cache for new search
    translationCache = {};

    // Save to recent searches history
    if (typeof saveRecentSearch === 'function') saveRecentSearch(query);

    if (isFirstMessage) {
        const welcomeEl = document.querySelector('#chatContainer .welcome');
        if (welcomeEl) welcomeEl.style.display = 'none';
        isFirstMessage = false;
        // Stop animated placeholder when user sends first message
        if (typeof stopSearchPlaceholder === 'function') stopSearchPlaceholder();
    }

    const container = document.getElementById('chatContainer');
    container.innerHTML += `<div class="message message-user"><div class="message-bubble">${escapeHtml(query)}</div></div>`;
    container.innerHTML += `<div class="message message-assistant" id="typing"><div class="typing-indicator"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span class="search-status-text">Searching...</span></div></div>`;
    container.scrollTop = container.scrollHeight;
    startSearchMessages();
    input.value = '';

    sessionMessages.push({
        role: 'user',
        content: query,
        timestamp: Date.now()
    });

    // Build the set of user IDs whose items are allowed in search results:
    //   - the current user (own items, all visibility)
    //   - direct friends (friends-visibility items)
    // Extended circle items are anonymised after results return — we include
    // their IDs in a separate list so n8n can optionally surface them too,
    // but NEVER include private items from non-friends.
    const directFriendIds = friendsCache.map(f => f.out_user_id).filter(Boolean);
    const allowedUserIds   = currentUser
        ? [currentUser.id, ...directFriendIds]
        : [];

    const body = {
        query,
        session_id: currentSessionId,
        conversation_history: sessionMessages,
        user_id: currentUser ? currentUser.id : null,
        // Visibility filter context sent to n8n so the semantic search
        // only runs against the corpus this user is allowed to see.
        allowed_user_ids: allowedUserIds,   // search ONLY these users' items
        friend_ids: directFriendIds,        // subset: direct friends (for note visibility)
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
    .then(async (rawData) => {
        // n8n sometimes wraps the response in an array — unwrap it
        const data = Array.isArray(rawData) ? rawData[0] : rawData;
        stopSearchMessages();
        const typingEl = document.getElementById('typing');
        if (typingEl) typingEl.remove();
        if (data.results && data.results.length > 0) {
            currentResults = data.results;
            const queryLanguage = data.query_language || 'en';

            // Tag each result with the query language for translation toggle
            currentResults.forEach(r => { r._queryLanguage = queryLanguage; });

            // ── Odin Trust Layer: search result filtering ─────────
            // Build lookup sets for fast membership checks
            const selfId       = currentUser ? currentUser.id : null;
            const friendIdSet  = new Set(friendsCache.map(f => f.out_user_id).filter(Boolean));
            const allowedIdSet = new Set(selfId ? [selfId, ...friendIdSet] : [...friendIdSet]);

            // Match and enrich search results from allDiscoveries
            currentResults.forEach(r => {
                const match = (r.id && allDiscoveries.find(d => d.id === r.id))
                    || allDiscoveries.find(d => d.title === r.title);
                if (match) {
                    // Preserve search-specific fields before merging
                    const relevance_reason = r.relevance_reason;
                    const distance_km      = r.distance_km || match.distance_km;
                    const _queryLanguage   = r._queryLanguage;
                    const combined_score   = r.combined_score;
                    const relevance_score  = r.relevance_score;
                    Object.assign(r, match);
                    r.relevance_reason = relevance_reason;
                    if (distance_km) r.distance_km = distance_km;
                    r._queryLanguage   = _queryLanguage;
                    r.combined_score   = combined_score;
                    r.relevance_score  = relevance_score;
                }
            });

            // ── Hard privacy filter ───────────────────────────────
            // Allowed: own items, direct friends' non-private, FOF 'friends'-visibility items
            // FOF items come back from RPC with trust_level='extended_circle' + added_by=null
            const fofIdSet = new Set(
                allDiscoveries
                    .filter(d => d._trust_level === TRUST.EXTENDED)
                    .map(d => d.id)
            );
            currentResults = currentResults.filter(r => {
                if (!r.id) return false;
                // RPC-anonymised FOF: added_by is null, trust_level is extended_circle
                if (!r.added_by && r.trust_level === 'extended_circle') return true;
                const owner = r.added_by;
                if (!owner) return allDiscoveries.some(d => d.id === r.id);
                // Private items: only visible to the owner
                if (r.visibility === TRUST.PRIVATE && owner !== selfId) return false;
                // Direct friends: allowed if not private
                if (allowedIdSet.has(owner)) return true;
                // FOF: allowed if RPC tagged it as extended_circle
                if (r.trust_level === 'extended_circle') return true;
                // FOF from feed cache
                if (fofIdSet.has(r.id)) return true;
                return false;
            });

            // ── Anonymise extended circle items ──────────────────
            // Sets _trust_level, clears identity fields, hides comments
            currentResults = currentResults.map(r => {
                if (r.trust_level === 'extended_circle' || r._trust_level === TRUST.EXTENDED) {
                    return anonymiseForExtendedCircle(r);
                }
                return r;
            });

            // Relevance check — trust results if score meets threshold
            const topScore = currentResults.length > 0 ? (currentResults[0].combined_score || 0) : 0;
            // Signal 2 — safety net: if every result title appears in _debug.dropped_titles,
            // the AI explicitly rejected everything (catches the Merge Response fallback bug).
            const debugDropped = (data._debug && data._debug.dropped_titles) || [];
            const allResultsDropped = currentResults.length > 0
                && currentResults.every(r => debugDropped.includes(r.title));
            const hasRelevantResults = currentResults.length > 0
                && (topScore >= RELEVANCE_THRESHOLD || currentResults.length === 1)
                && !allResultsDropped;

            // Load endorsements for search results
            await loadEndorsementsForItems(currentResults);

            const getPersonalNote = getPersonalNoteGlobal;

            const formatDistance = (km) => {
                if (!km) return '';
                return km < 1 ? Math.round(km * 1000) + 'm' : km.toFixed(1) + 'km';
            };

            const buildTopPick = (r, idx) => {
                const isExt    = r._trust_level === TRUST.EXTENDED;
                const photo    = r.photo_url ? `<img src="${escapeHtml(r.photo_url)}" onerror="this.outerHTML='<span style=\\'font-size:32px;color:#d1d5db\\'>📍</span>'">` : '<span style="font-size:32px;color:#d1d5db">📍</span>';
                const rawNote  = isExt ? null : getPersonalNote(r);
                const canSeeNote = rawNote && isFriend(r.added_by || r.added_by_name);
                const distText = formatDistance(r.distance_km);
                // Extended circle: description only (no personal notes, no friend attribution)
                const snippet      = isExt
                    ? (r.description || r.relevance_reason || '')
                    : (canSeeNote ? rawNote : (r.relevance_reason || r.description || ''));
                const snippetLabel = isExt
                    ? '💡 Why this matches'
                    : (canSeeNote ? '💭 Friend says' : '💡 Why this matches');
                const byLine = isExt
                    ? '<span class="meta-tag meta-added-by extended-circle-badge">🔵 Extended circle</span>'
                    : (r.added_by_name ? `<span class="meta-tag meta-added-by">by ${escapeHtml(r.added_by_name)}</span>` : '');

                return `
                    <div class="top-pick-card" onclick="showSearchDrawer(${idx})">
                        <span class="top-pick-badge">Top Pick</span>
                        <div class="top-pick-photo">${photo}</div>
                        <div class="top-pick-content">
                            <div class="top-pick-title">${escapeHtml(r.title)}</div>
                            <div class="top-pick-meta">
                                ${distText ? `<span class="meta-tag meta-distance">📍 ${distText}</span>` : ''}
                                ${byLine}
                            </div>
                            ${snippet ? `
                                <div class="top-pick-reason">
                                    <div class="top-pick-reason-label">${snippetLabel}</div>
                                    <span class="top-pick-reason-text" data-original="${escapeHtml(snippet).substring(0, 100)}${snippet.length > 100 ? '...' : ''}">${escapeHtml(snippet).substring(0, 100)}${snippet.length > 100 ? '...' : ''}</span>
                                </div>
                            ` : ''}
                            <button class="card-translate-btn" data-idx="${idx}" data-state="original" onclick="event.stopPropagation(); toggleCardTranslate(this, ${idx})">Translate 🌐</button>
                        </div>
                    </div>
                `;
            };

            const buildCompactCard = (r, idx) => {
                const isExt  = r._trust_level === TRUST.EXTENDED;
                const photo  = r.photo_url
                    ? `<img src="${escapeHtml(r.photo_url)}" onerror="this.outerHTML='<span class=\\'compact-photo-placeholder\\'>📍</span>'">`
                    : '<span class="compact-photo-placeholder">📍</span>';
                const rawNote    = isExt ? null : getPersonalNote(r);
                const canSeeNote = rawNote && isFriend(r.added_by);
                const distText   = formatDistance(r.distance_km);
                const snippet    = isExt
                    ? (r.description || r.relevance_reason || '')
                    : (canSeeNote ? rawNote : (r.relevance_reason || r.description || ''));
                const snippetIcon = (!isExt && canSeeNote) ? '💭' : '';
                const byLine = isExt
                    ? '<span class="extended-circle-badge" style="font-size:11px;">🔵 Extended circle</span>'
                    : (r.added_by_name ? `<span>• ${escapeHtml(r.added_by_name)}</span>` : '');

                return `
                    <div class="compact-card" onclick="showSearchDrawer(${idx})">
                        <div class="compact-photo">${photo}</div>
                        <div class="compact-title">${escapeHtml(r.title)}</div>
                        <div class="compact-meta">
                            ${distText ? `<span>📍 ${distText}</span>` : ''}
                            ${byLine}
                        </div>
                        ${snippet ? `<div class="compact-snippet" data-original="${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}">${snippetIcon ? snippetIcon + ' ' : ''}${escapeHtml(snippet).substring(0, 60)}${snippet.length > 60 ? '...' : ''}</div>` : ''}
                        <button class="card-translate-btn compact-translate-btn" data-idx="${idx}" data-state="original" onclick="event.stopPropagation(); toggleCardTranslate(this, ${idx})">Translate 🌐</button>
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
                // ── No relevant match — honest message + CTA only ──
                // Only show n8n's suggested_results if explicitly provided (semantically related).
                // Never show random cards — that's misleading when someone asks for Mongolian food.
                const buildSuggestionPreview = () => {
                    const hasSuggested = data.suggested_results && data.suggested_results.length > 0;
                    if (!hasSuggested) return '';

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

                    return window._searchPreviewItems.map((item, idx) => {
                        const photo = item.photo_url
                            ? `<img src="${escapeHtml(item.photo_url)}">`
                            : '<span class="compact-photo-placeholder">📍</span>';
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
                                    <span class="results-header-title">Closest matches in your network</span>
                                </div>
                                <div class="more-options-wrapper">
                                    <div class="more-options-scroll">${previewCards}</div>
                                </div>
                            </div>
                        </div>` : ''}
                    </div>`;

                container.innerHTML += noMatchHtml;

                // Layer 2 — show outside-network teaser if DB has related results
                if (otherResults.length > 0) {
                    const teaserHtml = `
                        <div class="message message-assistant">
                            <div class="message-content" style="color:#888;font-size:0.9em;">
                                👥 People outside your network saved something similar:
                            </div>
                            <div class="results-section">
                                <div class="more-options-scroll">
                                    ${otherResults.slice(0, 3).map(r => `
                                        <div class="compact-card" style="opacity:0.8;">
                                            <div class="compact-photo">📍</div>
                                            <div class="compact-title">${escapeHtml(r.title)}</div>
                                            <div class="compact-meta">${escapeHtml(r.type || '')}</div>
                                            <div class="compact-snippet" style="color:#aaa;font-style:italic;">
                                                🔒 Add friends to see their stories
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>`;
                    container.innerHTML += teaserHtml;
                }

                container.scrollTop = container.scrollHeight;

                sessionMessages.push({
                    role: 'assistant',
                    content: `No relevant results for "${query}"`,
                    timestamp: Date.now()
                });
            }

        } else {
            // 0 results returned by n8n — honest message only, no random cards
            container.innerHTML += `
                <div class="message message-assistant">
                    <div class="message-content">
                        <strong>Nothing found for "${escapeHtml(query)}" in your network yet.</strong><br>
                        ${allDiscoveries.length > 0
                            ? "Your friends haven't saved anything matching that — yet. Be the first to add it! 👇"
                            : "Your network is empty. Invite friends to start building your shared discovery list! 🤝"}
                    </div>
                    ${allDiscoveries.length > 0 ? `
                    <div style="padding: 8px 0;">
                        <button class="drawer-bookmark-btn active" style="margin:0 0 12px 0;" onclick="setMode('input')">
                            ＋ Add a recommendation
                        </button>
                    </div>` : ''}
                </div>`;

            sessionMessages.push({
                role: 'assistant',
                content: 'No results found',
                timestamp: Date.now()
            });
        }
        container.scrollTop = container.scrollHeight;
    })
    .catch(() => {
        stopSearchMessages();
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

    // Surgically remove message divs — preserves the static .welcome DOM
    container.querySelectorAll('.message').forEach(function(m) { m.remove(); });
    const welcome = container.querySelector('.welcome');
    if (welcome) welcome.style.display = '';

    isFirstMessage = true;
    currentResults = [];
    document.getElementById('messageInput').value = '';
    // Refresh search greeting after session reset
    if (typeof updateSearchGreeting === 'function') updateSearchGreeting();
    // Always restore suggestion chips when starting a new session
    var chipsEl = document.getElementById('searchSuggestions');
    if (chipsEl) chipsEl.style.display = '';
    // Restart animated placeholder
    if (typeof startSearchPlaceholder === 'function') setTimeout(startSearchPlaceholder, 80);
    // Refresh recent searches display
    if (typeof renderRecentSearches === 'function') renderRecentSearches();
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

function togglePrivacy(inputId) {
    const input  = document.getElementById(inputId);
    const track  = document.getElementById(inputId + 'Track');
    const icon   = document.getElementById(inputId + 'Icon');
    const title  = document.getElementById(inputId + 'Title');
    const desc   = document.getElementById(inputId + 'Desc');

    // Toggle: track.active = Friends ON, track no-active = private
    const isShared = input.value === 'false';   // currently shared with friends?
    const goPrivate = isShared;                 // flip to private

    input.value = goPrivate ? 'true' : 'false';
    track.classList.toggle('active', !goPrivate); // active = Friends ON

    // Update visibility status labels
    if (icon)  icon.textContent  = goPrivate ? '🔒' : '👥';
    if (title) title.textContent = goPrivate ? 'Only you' : 'Friends';
    if (desc)  desc.textContent  = goPrivate ? 'Hidden from everyone else' : 'Your connections can see this';
}

// ===== CAPTURE: VISIBILITY SELECTOR =====
function selectVisibility(el) {
    document.querySelectorAll('.vis-option').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    const val = el.dataset.value; // 'private' | 'friends'
    const hidden   = document.getElementById('privateToggle');
    const visField = document.getElementById('visibilityValue');
    const hint     = document.getElementById('visHint');
    if (hidden)   hidden.value   = val === 'private' ? 'true' : 'false';
    if (visField) visField.value = val;
    if (hint) {
        hint.textContent = val === 'private'
            ? 'Saved privately — only you can see this. Change to Friends when you\'re ready to share.'
            : 'Your friends can see this. They can save and comment on it.';
    }
}

// ===== CAPTURE: ROTATING PLACEHOLDER =====
const TAKE_PLACEHOLDERS = {
    place: [
        'Best tonkotsu in town — ask for the spicy option, go after 7pm',
        'Hidden gem — order the daily special, park on the side street',
        'Worth the drive — take a friend, skip the mains, just do dessert',
        'Go on a weekday morning, half the crowd and twice the vibe',
    ],
    product: [
        'Been using this for 6 months — worth every cent, way better than the Amazon version',
        'Game changer — replaced three other things I used to buy separately',
        'Bought it twice already. The second one was for my mum.',
        'Sounds gimmicky but actually works — give it two weeks',
    ],
    service: [
        'Fixed my back in 3 sessions — ask for the deep tissue, not the relaxation',
        'Best in town, book 2 weeks out or you won\'t get in',
        'Ask for Michelle specifically — she actually listens',
        'Don\'t go on price alone, this one is actually worth paying for',
    ],
    advice: [
        'Changed how I think about mornings — chapter 3 is the one, read it twice',
        'Sent this to five people already. Everyone came back saying thank you.',
        'Skip the intro, start at chapter 2 — trust me',
        'One idea from this paid for itself ten times over',
    ],
};
let _takePlaceholderTimer = null;
let _takePlaceholderIdx = {};

function startTakePlaceholder(category) {
    if (_takePlaceholderTimer) clearInterval(_takePlaceholderTimer);
    const textarea = document.getElementById('personalNote');
    if (!textarea) return;
    const pool = TAKE_PLACEHOLDERS[category] || TAKE_PLACEHOLDERS.place;
    if (!_takePlaceholderIdx[category]) _takePlaceholderIdx[category] = 0;
    textarea.placeholder = pool[_takePlaceholderIdx[category] % pool.length];
    _takePlaceholderTimer = setInterval(() => {
        if (document.activeElement === textarea) return; // don't rotate while typing
        _takePlaceholderIdx[category] = ((_takePlaceholderIdx[category] || 0) + 1) % pool.length;
        textarea.placeholder = pool[_takePlaceholderIdx[category]];
    }, 5000);
}

// ===== CAPTURE: CLEAR FORM =====
function clearCaptureForm() {
    document.getElementById('addForm').reset();
    document.getElementById('url').value = '';
    document.getElementById('userLat').value = '';
    document.getElementById('userLng').value = '';
    document.getElementById('locationStatus').textContent = '';
    const urlStatus = document.getElementById('urlFetchStatus');
    if (urlStatus) urlStatus.textContent = '';
    document.getElementById('formMessage').innerHTML = '';
    const dd = document.getElementById('addressDropdown');
    if (dd) { dd.classList.add('hidden'); dd.innerHTML = ''; }
    resetOGFetchState();
    // Reset category pills
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    const defaultPill = document.querySelector('.category-pill[data-value="place"]');
    if (defaultPill) defaultPill.classList.add('active');
    document.getElementById('category').value = 'place';
    // Reset address label hint
    const addressLabel = document.getElementById('addressLabel');
    if (addressLabel) addressLabel.textContent = '— recommended for places';
    // Reset photo
    document.getElementById('photoPreview').style.display = 'none';
    const uploadZone = document.getElementById('photoUploadZone');
    if (uploadZone) uploadZone.style.display = 'flex';
    // Show URL hint
    const heroHint = document.getElementById('urlHeroHint');
    if (heroHint) heroHint.style.display = 'flex';
    // Reset visibility selector to private (default)
    document.querySelectorAll('.vis-option').forEach(o => o.classList.remove('active'));
    const defaultVis = document.querySelector('.vis-option[data-value="private"]');
    if (defaultVis) defaultVis.classList.add('active');
    const privInput = document.getElementById('privateToggle');
    const visField  = document.getElementById('visibilityValue');
    if (privInput) privInput.value = 'true';
    if (visField)  visField.value  = 'private';
    // Reset address field visibility
    const addressGroup = document.querySelector('.address-group');
    if (addressGroup) addressGroup.style.display = '';
    // Reset Your Take rotating placeholder to Place default
    startTakePlaceholder('place');
}

// ===== CAPTURE: LOCATION PREFILL =====
function prefillCaptureLocation() {
    const addressField = document.getElementById('address');
    const locStatus = document.getElementById('locationStatus');
    const latField = document.getElementById('userLat');
    const lngField = document.getElementById('userLng');

    if (!navigator.geolocation) return;
    if (addressField && addressField.value.trim()) return; // don't overwrite if already filled

    if (locStatus) locStatus.textContent = '📍 Detecting location...';

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (latField) latField.value = lat;
        if (lngField) lngField.value = lng;

        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
                { headers: { 'Accept-Language': 'en' } }
            );
            const data = await res.json();
            const a = data.address || {};
            const parts = [
                a.road,
                a.suburb || a.neighbourhood,
                a.city || a.town || a.village,
                a.country
            ].filter(Boolean);
            const formatted = parts.join(', ');
            if (formatted && addressField && !addressField.value.trim()) {
                addressField.value = formatted;
            }
            if (locStatus) locStatus.textContent = '';
        } catch (e) {
            if (locStatus) locStatus.textContent = '';
        }
    }, () => {
        if (locStatus) locStatus.textContent = '';
    }, { timeout: 8000 });
}

// ===== CAPTURE: ADDRESS AUTOCOMPLETE =====
(function initAddressAutocomplete() {
    let debounceTimer = null;
    let focusedIndex = -1;

    function getOptions() {
        return document.querySelectorAll('#addressDropdown .address-option');
    }

    function showDropdown(items) {
        const dd = document.getElementById('addressDropdown');
        if (!dd) return;
        if (!items.length) { hideDropdown(); return; }

        dd.innerHTML = items.map((item, i) => {
            const nameParts = item.display_name.split(',');
            const main = nameParts.slice(0, 2).join(',').trim();
            const sub  = nameParts.slice(2).join(',').trim();
            return `<div class="address-option" data-index="${i}" data-lat="${item.lat}" data-lng="${item.lon}" data-full="${escapeHtml(item.display_name)}">
                <div class="address-option-main">${escapeHtml(main)}</div>
                ${sub ? `<div class="address-option-sub">${escapeHtml(sub)}</div>` : ''}
            </div>`;
        }).join('');

        dd.classList.remove('hidden');
        focusedIndex = -1;

        dd.querySelectorAll('.address-option').forEach(opt => {
            opt.addEventListener('mousedown', (e) => {
                e.preventDefault(); // prevent blur firing first
                selectOption(opt);
            });
        });
    }

    function hideDropdown() {
        const dd = document.getElementById('addressDropdown');
        if (dd) { dd.classList.add('hidden'); dd.innerHTML = ''; }
        focusedIndex = -1;
    }

    function selectOption(opt) {
        const address = document.getElementById('address');
        const latField = document.getElementById('userLat');
        const lngField = document.getElementById('userLng');
        if (address) address.value = opt.dataset.full;
        if (latField) latField.value = opt.dataset.lat;
        if (lngField) lngField.value = opt.dataset.lng;
        hideDropdown();
    }

    async function searchAddress(query) {
        const dd = document.getElementById('addressDropdown');
        if (!query || query.length < 3) { hideDropdown(); return; }

        // Show searching indicator
        if (dd) {
            dd.innerHTML = '<div class="address-searching">Searching...</div>';
            dd.classList.remove('hidden');
        }

        // Auckland bounding box (fallback when no GPS)
        // SW: -37.05, 174.55 — NE: -36.65, 175.00
        const AKL_VIEWBOX = '174.55,-36.65,175.00,-37.05';

        // Prefer user's GPS if available, else default to Auckland
        const lat = document.getElementById('userLat')?.value;
        const lng = document.getElementById('userLng')?.value;
        let viewboxParam = '';
        if (lat && lng) {
            const delta = 0.15; // ~15km radius bias around user
            viewboxParam = `&viewbox=${+lng - delta},${+lat + delta},${+lng + delta},${+lat - delta}&bounded=0`;
        } else {
            // Default bias: Auckland viewbox, not bounded so suburb names still work
            viewboxParam = `&viewbox=${AKL_VIEWBOX}&bounded=0`;
        }

        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=8&countrycodes=nz${viewboxParam}`,
                { headers: { 'Accept-Language': 'en' } }
            );
            const results = await res.json();

            // Sort: Auckland/NZ results first, then everything else
            results.sort((a, b) => {
                const aIsAkl = (a.display_name || '').toLowerCase().includes('auckland');
                const bIsAkl = (b.display_name || '').toLowerCase().includes('auckland');
                if (aIsAkl && !bIsAkl) return -1;
                if (!aIsAkl && bIsAkl) return 1;
                return 0;
            });

            showDropdown(results.slice(0, 5));
        } catch (e) {
            hideDropdown();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Start rotating placeholder for default category (place)
        startTakePlaceholder('place');

        const addressInput = document.getElementById('address');
        if (!addressInput) return;

        addressInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => searchAddress(addressInput.value.trim()), 350);
        });

        addressInput.addEventListener('keydown', (e) => {
            const options = getOptions();
            if (!options.length) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusedIndex = Math.min(focusedIndex + 1, options.length - 1);
                options.forEach((o, i) => o.classList.toggle('focused', i === focusedIndex));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                focusedIndex = Math.max(focusedIndex - 1, 0);
                options.forEach((o, i) => o.classList.toggle('focused', i === focusedIndex));
            } else if (e.key === 'Enter' && focusedIndex >= 0) {
                e.preventDefault();
                selectOption(options[focusedIndex]);
            } else if (e.key === 'Escape') {
                hideDropdown();
            }
        });

        addressInput.addEventListener('blur', () => {
            // Small delay so mousedown on option fires first
            setTimeout(hideDropdown, 150);
        });

        // Close dropdown if user clicks outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#address') && !e.target.closest('#addressDropdown')) {
                hideDropdown();
            }
        });
    });
})();

// ===== CAPTURE: URL OG PREFILL =====
async function fetchAndPrefillOG(url) {
    if (!url || !url.startsWith('http')) return;

    const titleField = document.getElementById('title');
    // personalNote is now the single user-facing field (merged with description)
    const descField = document.getElementById('personalNote');
    const ogLoading = document.getElementById('ogLoading');
    const ogCard = document.getElementById('ogPreviewCard');
    const heroHint = document.getElementById('urlHeroHint');

    // Show loading shimmer, hide hint
    if (ogLoading) ogLoading.classList.remove('hidden');
    if (ogCard) ogCard.classList.add('hidden');
    if (heroHint) heroHint.style.display = 'none';

    try {
        let og = {};

        // YouTube videos only — oEmbed works for /watch?v= and youtu.be/ links
        const isYouTubeVideo = /youtube\.com\/watch\?|youtu\.be\//i.test(url);

        if (isYouTubeVideo) {
            const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
            if (res.ok) {
                const data = await res.json();
                og.title = data.title || '';
                og.description = data.author_name ? `Video by ${data.author_name}` : '';
                og.image = data.thumbnail_url || '';
            }
        } else {
            // Everything else — route through n8n
            const res = await fetch(OG_FETCH_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (res.ok) og = await res.json();
        }

        // Fill form fields if empty
        if (og.title && titleField && !titleField.value.trim()) {
            titleField.value = og.title;
        }
        if (og.description && descField && !descField.value.trim()) {
            descField.value = og.description;
        }

        // Auto-fill address if returned (e.g. from Google Maps)
        const addressField = document.getElementById('address');
        if (og.address && addressField && !addressField.value.trim()) {
            addressField.value = og.address;
        }
        // Auto-fill lat/lng if returned
        if (og.lat && og.lng) {
            const latField = document.getElementById('userLat');
            const lngField = document.getElementById('userLng');
            if (latField) latField.value = og.lat;
            if (lngField) lngField.value = og.lng;
            const locStatus = document.getElementById('locationStatus');
            if (locStatus) locStatus.textContent = 'Location detected from link';
        }

        // Auto-select category for Google Maps links (uses category from Places API)
        if (og.source === 'googlemaps') {
            const cat = og.category || 'place';
            document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
            const targetPill = document.querySelector(`.category-pill[data-value="${cat}"]`);
            if (targetPill) targetPill.classList.add('active');
            document.getElementById('category').value = cat;
        }

        // Preload OG image into the photo section (if no user photo already)
        if (og.image) {
            const photoFile = document.getElementById('photo');
            const hasUserPhoto = photoFile && photoFile.files && photoFile.files.length > 0;
            if (!hasUserPhoto) {
                preloadOGPhoto(og.image);
            }
        }

        // Show OG preview card
        if (og.title && ogCard) {
            const ogImg = document.getElementById('ogPreviewImg');
            const ogTitle = document.getElementById('ogPreviewTitle');
            const ogDesc = document.getElementById('ogPreviewDesc');
            const ogUrl = document.getElementById('ogPreviewUrl');

            if (og.image && ogImg) {
                ogImg.src = og.image;
                ogImg.style.display = 'block';
            } else if (ogImg) {
                ogImg.style.display = 'none';
            }
            if (ogTitle) ogTitle.textContent = og.title;
            if (ogDesc) {
                // Show rating inline if available from Google Places
                let descText = og.description || '';
                if (og.rating && !descText.includes('⭐')) {
                    descText = `⭐ ${og.rating}` + (og.rating_count ? ` (${og.rating_count} reviews)` : '') + (descText ? ' · ' + descText : '');
                }
                ogDesc.textContent = descText;
            }
            if (ogUrl) {
                if (og.site_name) {
                    ogUrl.textContent = og.site_name;
                } else {
                    try { ogUrl.textContent = new URL(url).hostname; } catch(e) { ogUrl.textContent = url; }
                }
            }
            ogCard.classList.remove('hidden');
        }

        // Hide loading
        if (ogLoading) ogLoading.classList.add('hidden');

    } catch (e) {
        if (ogLoading) ogLoading.classList.add('hidden');
        if (heroHint) heroHint.style.display = 'flex';
    }
}

function clearOGPreview() {
    const ogCard = document.getElementById('ogPreviewCard');
    const heroHint = document.getElementById('urlHeroHint');
    if (ogCard) ogCard.classList.add('hidden');
    if (heroHint) heroHint.style.display = 'flex';
}

// ===== PHOTO: OG image preload & controls =====
let _photoSource = 'none'; // 'none' | 'og' | 'user'

function preloadOGPhoto(imageUrl) {
    const preview = document.getElementById('photoPreview');
    const previewImg = document.getElementById('previewImg');
    const uploadZone = document.getElementById('photoUploadZone');
    const badge = document.getElementById('photoSourceBadge');
    const ogUrlField = document.getElementById('ogImageUrl');

    if (!preview || !previewImg) return;

    previewImg.src = imageUrl;
    preview.style.display = 'block';
    if (uploadZone) uploadZone.style.display = 'none';
    if (badge) { badge.textContent = 'From link'; badge.style.display = 'block'; }
    if (ogUrlField) ogUrlField.value = imageUrl;
    _photoSource = 'og';
}

function replacePhoto() {
    document.getElementById('photo').click();
}

function removePhoto() {
    const preview = document.getElementById('photoPreview');
    const previewImg = document.getElementById('previewImg');
    const uploadZone = document.getElementById('photoUploadZone');
    const badge = document.getElementById('photoSourceBadge');
    const ogUrlField = document.getElementById('ogImageUrl');
    const photoInput = document.getElementById('photo');

    if (preview) preview.style.display = 'none';
    if (previewImg) previewImg.src = '';
    if (uploadZone) uploadZone.style.display = 'flex';
    if (badge) badge.style.display = 'none';
    if (ogUrlField) ogUrlField.value = '';
    if (photoInput) photoInput.value = '';
    _photoSource = 'none';
}

// Track last fetched URL at module level so clearCaptureForm can reset it
let _lastOGFetchedUrl = '';

function resetOGFetchState() {
    _lastOGFetchedUrl = '';
    clearOGPreview();
}

// Attach URL paste/blur/input listener once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url');
    if (!urlInput) return;

    const triggerOGFetch = () => {
        const val = urlInput.value.trim();
        if (val && val !== _lastOGFetchedUrl && val.startsWith('http')) {
            _lastOGFetchedUrl = val;
            fetchAndPrefillOG(val);
        }
    };

    urlInput.addEventListener('paste', () => {
        // paste fires before value updates, so wait one tick
        setTimeout(triggerOGFetch, 100);
    });
    urlInput.addEventListener('blur', triggerOGFetch);
    // Also trigger on Enter key in the URL field
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); triggerOGFetch(); }
    });
});

async function submitDiscovery(e) {
    e.preventDefault();

    if (!currentUser) {
        alert('Please login first');
        return;
    }

    // Validate "Your take" — required but no asterisk shown
    const takeVal = document.getElementById('personalNote').value.trim();
    if (!takeVal) {
        const textarea = document.getElementById('personalNote');
        textarea.focus();
        textarea.style.borderColor = '#7B2D45';
        textarea.style.boxShadow = '0 0 0 2px rgba(123,45,69,0.15)';
        const formMsg = document.getElementById('formMessage');
        if (formMsg) {
            formMsg.innerHTML = '<p style="color:#7B2D45;font-size:13px;margin:0 0 8px;">Tell your circle why it\'s worth it — even one line helps.</p>';
        }
        setTimeout(() => {
            textarea.style.borderColor = '';
            textarea.style.boxShadow = '';
        }, 2500);
        document.getElementById('submitBtn').disabled = false;
        return;
    }
    // Clear any validation state
    const formMsg = document.getElementById('formMessage');
    if (formMsg) formMsg.innerHTML = '';

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;

    // Read + compress photo BEFORE showing success
    let photoBase64 = null;
    const photoFile = document.getElementById('photo').files[0];
    if (photoFile) {
        photoBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // Resize to max 1200px on longest side
                    const MAX = 1200;
                    let w = img.width, h = img.height;
                    if (w > MAX || h > MAX) {
                        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
                        else        { w = Math.round(w * MAX / h); h = MAX; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    // Export as JPEG at 82% quality — well under Supabase's limit
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                    resolve(dataUrl.split(',')[1]);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(photoFile);
        });
    }

    const visibilityVal = document.getElementById('visibilityValue')?.value || 'private';
    const isPrivate = visibilityVal === 'private';

    // personalNote is now the single user-facing field (merged with description)
    const yourTake = document.getElementById('personalNote').value.trim();

    const payload = {
        title: document.getElementById('title').value.trim(),
        description: yourTake,        // feeds AI Enhance enrichment
        personalNote: yourTake || null, // feeds embedding + social display
        type: document.getElementById('category').value,
        addedBy: currentProfile?.display_name || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
        address: document.getElementById('address').value.trim() || null,
        url: document.getElementById('url').value.trim() || null,
        userLat: document.getElementById('userLat').value || null,
        userLng: document.getElementById('userLng').value || null,
        UserID: currentUser.id,
        familyId: currentProfile?.family_id || '37ae9f84-2d1d-4930-9765-f6f8991ae053',
        photo: photoBase64,
        photoFilename: photoFile ? photoFile.name : null,
        ogImageUrl: (!photoBase64 && _photoSource === 'og') ? (document.getElementById('ogImageUrl')?.value || null) : null,
        visibility: visibilityVal
    };

    // Post-save nudge: if note is thin, show a gentle prompt in the overlay
    const isThinNote = takeVal.length < 30;
    const overlayBody = document.querySelector('#saveSuccessOverlay .save-success-content p');
    if (overlayBody) {
        overlayBody.innerHTML = isThinNote
            ? 'Saved! <span style="display:block;font-size:12px;color:#9CA3AF;margin-top:4px;">Next time, add one more detail — your circle will love you for it.</span>'
            : 'Your discovery has been added';
    }

    // Show instant "Saved!" overlay immediately
    const overlay = document.getElementById('saveSuccessOverlay');
    overlay.classList.remove('hidden');
    document.getElementById('addForm').reset();
    // Reset URL field (outside form) and OG preview
    document.getElementById('url').value = '';
    resetOGFetchState();
    // Reset photo preview
    removePhoto();
    // Reset category pills to default
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    const defaultPill = document.querySelector('.category-pill[data-value="place"]');
    if (defaultPill) defaultPill.classList.add('active');
    document.getElementById('category').value = 'place';
    // Show URL hint again
    const heroHint = document.getElementById('urlHeroHint');
    if (heroHint) heroHint.style.display = 'flex';

    btn.disabled = false;

    // Navigate away after a brief moment
    setTimeout(() => {
        overlay.classList.add('hidden');
        setMode('discover');
    }, 1500);

    // Send to backend in the background (fire-and-forget)
    fetch(CAPTURE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(err => {
        console.error('Background save failed:', err);
        // Optionally show a subtle toast later if needed
    });
}

// Category pill selector
function selectCategory(el) {
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    const val = el.dataset.value;
    document.getElementById('category').value = val;

    // Category-aware rotating placeholders
    startTakePlaceholder(val);

    // Show/hide address field based on category
    const addressGroup = document.querySelector('.address-group');
    if (addressGroup) {
        if (val === 'place') {
            addressGroup.style.display = '';
        } else {
            addressGroup.style.display = 'none';
            // Clear address when hidden
            const addrInput = document.getElementById('address');
            if (addrInput) addrInput.value = '';
        }
    }

    // Update address label hint based on category
    const addressLabel = document.getElementById('addressLabel');
    if (addressLabel) {
        addressLabel.textContent = '— recommended for places';
    }
}

document.getElementById('photo').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('previewImg').src = ev.target.result;
            document.getElementById('photoPreview').style.display = 'block';
            const uploadZone = document.getElementById('photoUploadZone');
            if (uploadZone) uploadZone.style.display = 'none';
            // Mark as user photo, clear OG image, update badge
            _photoSource = 'user';
            const ogUrlField = document.getElementById('ogImageUrl');
            if (ogUrlField) ogUrlField.value = '';
            const badge = document.getElementById('photoSourceBadge');
            if (badge) { badge.textContent = 'Your photo'; badge.style.display = 'block'; }
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
async function autoFriendOdinHQ() {
    return; // Skip auto-connect — users add Founding Members manually
    if (currentUser.id === ODIN_HQ_USER_ID) return; // Don't friend yourself

    // Check if already friends with Odin HQ
    const alreadyFriend = friendsCache.some(f => f.out_user_id === ODIN_HQ_USER_ID);
    if (alreadyFriend) return;

    // Check if there's already a pending request
    const alreadyPending = pendingFriendRequests.some(r =>
        r.out_requester_id === ODIN_HQ_USER_ID
    );
    if (alreadyPending) return;

    // Check localStorage to avoid repeated attempts
    if (localStorage.getItem('odin_hq_connected')) return;

    try {
        // Insert friendship directly (both directions accepted)
        const { error } = await supabaseClient.rpc('send_friend_request', {
            p_requester_id: ODIN_HQ_USER_ID,
            p_receiver_id: currentUser.id
        });

        if (!error) {
            // Auto-accept it
            // Reload pending to find the request
            const { data: pending } = await supabaseClient.rpc('get_pending_friend_requests', {
                p_user_id: currentUser.id
            });
            const hqRequest = (pending || []).find(r => r.out_requester_id === ODIN_HQ_USER_ID);
            if (hqRequest) {
                await supabaseClient.rpc('accept_friend_request', {
                    p_friendship_id: hqRequest.out_id,
                    p_user_id: currentUser.id
                });
            }
            localStorage.setItem('odin_hq_connected', 'true');
            // Reload friends list
            await loadFriends();
            console.log('Auto-connected with Odin HQ');
        }
    } catch (err) {
        console.warn('Auto-friend Odin HQ failed (non-critical):', err);
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

    // Show if user has no friends (excluding Odin HQ) and no endorsements
    const realFriends = friendsCache.filter(f => f.out_user_id !== ODIN_HQ_USER_ID);
    const hasNoRealFriends = realFriends.length === 0;
    const hasNoEndorsements = Object.values(endorsementsCache || {}).every(e => !e.userEndorsed);

    if (hasNoRealFriends && hasNoEndorsements) {
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

function dismissOnboarding() {
    localStorage.setItem('onboarding_welcome_dismissed', 'true');
    const banner = document.getElementById('onboardingBanner');
    if (banner) {
        banner.style.opacity = '0';
        setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = ''; }, 300);
    }
}

function handleOnbOverlayClick(e) {
    // Dismiss when clicking the backdrop (not the card itself)
    if (e.target === document.getElementById('onboardingBanner')) {
        dismissOnboarding();
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