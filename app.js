// ===== INVITE TOKEN — save immediately on every page load =====
// Must run BEFORE any auth check so the token survives whether the user
// is a brand-new visitor, mid-OAuth-redirect, or an already-logged-in user
// who opened a friend's invite link.
(function _captureInviteToken() {
    try {
        const t = new URLSearchParams(window.location.search).get('token');
        if (t) {
            sessionStorage.setItem('odin_invite_token', t);
            localStorage.setItem('odin_invite_token', t);
        }
    } catch (e) { /* storage unavailable — safe to ignore */ }
})();

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

    // Load friends first, then discoveries (discoveries filter by friends)
    await loadFriends();
    await Promise.all([loadPendingFriendRequests(), loadOutgoingFriendRequests()]);

    // Start notification polling AFTER initial load to avoid duplicate RPC calls
    startNotifPolling();

    // Pre-seed endorsements cache with current user's own saves
    // so the save button shows correctly before RPC fires
    loadMyOwnSavedIds();

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

        // ── Preserve invite token across OAuth redirect ──
        // Google OAuth strips all URL params on redirect back.
        // Save the token to sessionStorage NOW so we can read it
        // after the redirect completes in checkOnboardingBanner().
        const urlParams = new URLSearchParams(window.location.search);
        const inviteToken = urlParams.get('token');
        if (inviteToken) {
            // Save to BOTH storages — sessionStorage can be wiped by Google OAuth
            // redirect (new tab, domain handoff). localStorage survives the round-trip.
            sessionStorage.setItem('odin_invite_token', inviteToken);
            localStorage.setItem('odin_invite_token', inviteToken);
        }

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

    // ── Preserve invite token across email-confirm redirect ──
    // The confirmation link takes the user away from the page; localStorage
    // survives that round-trip so we can process the invite after they return.
    const urlParamsSignUp = new URLSearchParams(window.location.search);
    const inviteTokenSignUp = urlParamsSignUp.get('token');
    if (inviteTokenSignUp) {
        sessionStorage.setItem('odin_invite_token', inviteTokenSignUp);
        localStorage.setItem('odin_invite_token', inviteTokenSignUp);
    }

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
            // NOTE: localStorage already has the invite token saved (from handleEmailSignUp),
            // so it will survive this reload and be picked up by checkOnboardingBanner.
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
let outgoingPendingRequests = [];       // Array: { out_id, out_receiver_id, out_receiver_name, out_avatar_url, out_created_at }
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
            // Sync notifs_cleared_at from profile to localStorage so the filter
            // stays consistent across devices and fresh sessions.
            if (data.notifs_cleared_at) {
                const profileTs = new Date(data.notifs_cleared_at).getTime();
                const localTs = parseInt(localStorage.getItem(_NOTIFS_CLEARED_KEY) || '0');
                // Use whichever is more recent
                if (profileTs > localTs) {
                    localStorage.setItem(_NOTIFS_CLEARED_KEY, profileTs.toString());
                }
            } else {
                // Profile has no cleared timestamp — remove stale local one so
                // notifications aren't permanently hidden after e.g. a DB reset.
                localStorage.removeItem(_NOTIFS_CLEARED_KEY);
            }
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

    // Notifications now live in the drawer — not on the profile page

    // Always reset to view mode
    toggleProfileEdit(false);

    const name = currentProfile.display_name || '';
    const nameEl = document.getElementById('profileDisplayName');
    nameEl.textContent = name;
    nameEl.style.color = '#7B2D45';

    // Update the profile page-level heading with the user's name
    var profilePageNameEl = document.getElementById('profilePageName');
    if (profilePageNameEl) profilePageNameEl.textContent = name || 'Your Profile';
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

    // Load friends network display (incoming + outgoing pending, then render)
    await Promise.all([loadPendingFriendRequests(), loadOutgoingFriendRequests()]);
    updateFriendsDisplay();

    // Populate Airbnb-style profile boxes
    populateProfileBoxes();
}

function populateProfileBoxes() {
    if (!currentUser) return;

    // Box 1: My Saves — pull thumbnails from the already-rendered cards
    const savesBox = document.getElementById('profileBoxSavesThumbs');
    if (savesBox) {
        const cards = document.querySelectorAll('#myEndorsementsList .my-endorse-card');
        if (cards.length > 0) {
            const thumbs = Array.from(cards).slice(0, 3).map((card, i) => {
                const img = card.querySelector('img');
                const emoji = card.querySelector('.my-endorse-placeholder');
                if (img) {
                    return `<div class="pbox-thumb" style="transform:rotate(${[-8,4,-2][i]}deg) translate(${['-18px, 4px','8px, -4px','-4px, 8px'][i]});z-index:${i+1}"><img src="${img.src}" alt=""></div>`;
                } else if (emoji) {
                    return `<div class="pbox-thumb pbox-thumb-emoji" style="transform:rotate(${[-8,4,-2][i]}deg) translate(${['-18px, 4px','8px, -4px','-4px, 8px'][i]});z-index:${i+1}">${emoji.textContent}</div>`;
                }
                return '';
            }).filter(Boolean).join('');
            if (thumbs) savesBox.innerHTML = thumbs;
        }
    }

    // Box 2: Your Circle — avatars from friendsCache
    const circleBox = document.getElementById('profileBoxCircleAvatars');
    if (circleBox && typeof friendsCache !== 'undefined' && friendsCache.length > 0) {
        const shown = friendsCache.slice(0, 3);
        const transforms = [
            'translate(-22px, 0)',
            'translate(4px, -8px)',
            'translate(24px, 6px)'
        ];
        circleBox.innerHTML = shown.map((f, i) => {
            const name = f.out_display_name || f.out_email || '?';
            const initial = name.charAt(0).toUpperCase();
            const col = strColour(name);
            return `<div class="pbox-avatar" style="background:${col};transform:${transforms[i]};z-index:${i+1}">${initial}</div>`;
        }).join('');
    }
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

        // Backfill all historical items so "Added by" always shows the latest name
        await supabaseClient
            .from('knowledge_items')
            .update({ added_by_name: newName })
            .eq('added_by', currentUser.id);

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

// Pre-seed the endorsements cache with the current user's own saved item IDs.
// Called once at login so save buttons show the correct saved state immediately,
// even before per-page RPC calls have run.
async function loadMyOwnSavedIds() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('endorsements')
            .select('item_id')
            .eq('user_id', currentUser.id);
        if (error) { console.error('loadMyOwnSavedIds error:', error); return; }
        (data || []).forEach(row => {
            if (!endorsementsCache[row.item_id]) {
                endorsementsCache[row.item_id] = { count: 1, names: [], ids: [currentUser.id], userEndorsed: true };
            } else {
                // Only patch userEndorsed — don't overwrite richer data already there
                endorsementsCache[row.item_id].userEndorsed = true;
                if (!endorsementsCache[row.item_id].ids.includes(currentUser.id)) {
                    endorsementsCache[row.item_id].ids.push(currentUser.id);
                    endorsementsCache[row.item_id].count = Math.max(endorsementsCache[row.item_id].count, 1);
                }
            }
        });
        console.log('Own saves pre-seeded:', (data || []).length);
    } catch (err) {
        console.error('loadMyOwnSavedIds exception:', err);
    }
}

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
            // Initialize defaults — preserve userEndorsed if pre-seeded from own saves
            itemIds.forEach(id => {
                const existing = endorsementsCache[id];
                endorsementsCache[id] = { count: 0, names: [], ids: [], userEndorsed: existing?.userEndorsed || false };
            });
            return;
        }

        // Reset cache for these items — preserve userEndorsed from own-saves pre-seed
        itemIds.forEach(id => {
            const existing = endorsementsCache[id];
            endorsementsCache[id] = { count: 0, names: [], ids: [], userEndorsed: existing?.userEndorsed || false };
        });

        if (data) {
            data.forEach(row => {
                // RPC returns: item_id, count, names, user_ids
                const ids = row.user_ids || row.out_ids || [];
                const itemId = row.item_id || row.out_item_id;
                endorsementsCache[itemId] = {
                    count: row.count ?? row.out_count ?? 0,
                    names: row.names || row.out_names || [],
                    ids: ids,
                    userEndorsed: ids.includes(currentUser.id)
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

        // 409 = already exists in DB (saved in a previous session) — treat as success
        const isSuccess = !error || error.code === '23505' || (error.status || error.code) === 409;
        if (isSuccess) {
            if (!cached.userEndorsed) {
                cached.count += 1;
                cached.userEndorsed = true;
                if (!cached.ids.includes(currentUser.id)) cached.ids.push(currentUser.id);
                const myName = currentProfile?.display_name || currentUser.user_metadata?.full_name || 'You';
                if (!cached.names.includes(myName)) cached.names.push(myName);
            }
            // Motivational save toast — random variant, shows every time
            const _toastVariants = (name) => [
                `${name} will see you loved this too.`,
                `Nice taste. ${name} is going to feel seen.`,
                `You just made ${name}'s find worth even more.`
            ];
            const _adderName = item?.added_by_name
                ? item.added_by_name.split(' ')[0]
                : 'Your friend';
            const _variants = _toastVariants(_adderName);
            const _msg = _variants[Math.floor(Math.random() * _variants.length)];
            setTimeout(() => showToast(_msg), 300);

            // Notify item owner that someone saved their item
            const _ownerId = item?.added_by;
            if (_ownerId && _ownerId !== currentUser.id) {
                const _saverName = currentProfile?.display_name || currentUser.user_metadata?.full_name || 'Someone';
                try {
                    await supabaseClient.from('notifications').insert({
                        user_id:  _ownerId,
                        actor_id: currentUser.id,
                        type:     'endorsement',
                        item_id:  itemId,
                        message:  `${_saverName} saved your item`
                    });
                } catch (_notifErr) {
                    console.warn('Could not send save notification:', _notifErr);
                }
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
        const displayCount = friendCount > 0 ? friendCount : (cached.userEndorsed ? 1 : 0);
        if (countEl) {
            countEl.textContent = displayCount > 0 ? displayCount : '';
        } else if (displayCount > 0) {
            // No count element yet — inject one
            const newCount = document.createElement('span');
            newCount.className = 'react-count';
            newCount.textContent = displayCount;
            btn.appendChild(newCount);
        }
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
    // Show count if friends saved it, or show 1 if current user has saved it (solo pilot mode)
    const displayCount = friendCount > 0 ? friendCount : (cached.userEndorsed ? 1 : 0);
    const countHtml = displayCount > 0 ? `<span class="react-count">${displayCount}</span>` : '';

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

    // Social proof (avatars + "Saved by") now lives in drawer-attribution block.
    // This section renders the Save button only.

    // One-time contact CTA per item
    const _ctaKey = `odin_contact_cta_${itemId}`;
    const _myName = currentProfile?.display_name || (currentUser?.user_metadata?.full_name) || '';
    const _ctaFriendName = cached.names.find(n => n !== _myName);
    let _contactHtml = '';
    if (_ctaFriendName && !localStorage.getItem(_ctaKey)) {
        localStorage.setItem(_ctaKey, '1');
        const _firstName = (_ctaFriendName.split(' ')[0] || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
        _contactHtml = `
        <div class="drawer-contact-cta">
            <span class="drawer-contact-icon">💬</span>
            <div class="drawer-contact-body">
                <span class="drawer-contact-text">Want to know more? Ask ${_firstName} — they're just a message away.</span>
            </div>
            <span class="drawer-contact-dismiss" onclick="this.closest('.drawer-contact-cta').remove()">&#x2715;</span>
        </div>`;
    }

    return `<div class="drawer-reactions">
        <div class="drawer-save-row">
            <div class="drawer-save-right">
                <button class="drawer-bookmark-btn${bookmarkActive}" data-endorse-id="${itemId}" onclick="toggleEndorsement('${itemId}', event)">
                    <svg class="bookmark-icon-lg" width="16" height="16" viewBox="0 0 24 24" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2.2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    <span class="drawer-bookmark-label">${cached.userEndorsed ? 'Saved' : 'Save'}</span>
                </button>
            </div>
        </div>
        ${_contactHtml}
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
        // Uses SECURITY DEFINER RPC so profiles join works even with restrictive RLS
        const { data, error } = await supabaseClient.rpc(
            'get_pending_friend_requests_with_profiles',
            { p_user_id: currentUser.id }
        );
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

async function loadOutgoingFriendRequests() {
    if (!currentUser) return;
    try {
        // Uses SECURITY DEFINER RPC so profiles join works even with restrictive RLS
        const { data, error } = await supabaseClient.rpc(
            'get_outgoing_friend_requests_with_profiles',
            { p_user_id: currentUser.id }
        );
        if (error) {
            console.error('Error loading outgoing friend requests:', error);
            outgoingFriendRequests = new Set();
            outgoingPendingRequests = [];
            return;
        }
        outgoingPendingRequests = data || [];
        outgoingFriendRequests = new Set((data || []).map(r => r.out_receiver_id));
    } catch (err) {
        console.error('Error in loadOutgoingFriendRequests:', err);
        outgoingPendingRequests = [];
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
                // isPending if: I sent to them (outgoing) OR they sent to me (incoming/pending)
                const isPending = outgoingFriendRequests.has(profile.out_id)
                               || pendingFriendRequests.some(r => r.out_requester_id === profile.out_id);

                let statusHtml = '';
                if (alreadyFriend) {
                    statusHtml = '<span class="search-result-status added">Friends</span>';
                } else if (isPending) {
                    statusHtml = '<span class="search-result-status pending">Pending</span>';
                } else {
                    statusHtml = `<div class="search-result-action"><button class="add-friend-btn" onclick="event.stopPropagation(); handleSendFriendRequest('${profile.out_id}', '${escapeHtml(profile.out_display_name || '')}', this)">Add Friend</button></div>`;
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

async function handleSendFriendRequest(receiverId, receiverName, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
        // Check if they already sent us a request — if so, auto-accept it instead of creating a duplicate
        const incomingRequest = pendingFriendRequests.find(r => r.out_requester_id === receiverId);
        if (incomingRequest) {
            await handleAcceptFriendRequest(incomingRequest.out_id);
            if (btn) { btn.textContent = 'Friends!'; btn.classList.add('sent'); }
            return;
        }

        // Direct insert
        const { data: insertData, error } = await supabaseClient
            .from('friendships')
            .insert({
                requester_id: currentUser.id,
                receiver_id: receiverId,
                status: 'pending'
            })
            .select('id')
            .single();

        if (error) {
            console.error('Error sending friend request:', error);
            // Duplicate key — a row already exists (edge case: they sent request in another session)
            if (error.code === '23505') {
                // Reload pending to pick up their request and show correct state
                await loadPendingFriendRequests();
                const nowIncoming = pendingFriendRequests.find(r => r.out_requester_id === receiverId);
                if (nowIncoming) {
                    await handleAcceptFriendRequest(nowIncoming.out_id);
                    if (btn) { btn.textContent = 'Friends!'; btn.classList.add('sent'); }
                } else {
                    if (btn) { btn.textContent = 'Pending'; btn.classList.add('sent'); }
                    outgoingFriendRequests.add(receiverId);
                    updateFriendsDisplay();
                }
            } else {
                if (btn) { btn.disabled = false; btn.textContent = 'Add Friend'; }
            }
            return;
        }

        // Track outgoing locally so "Pending" shows immediately in search and friends list
        outgoingFriendRequests.add(receiverId);
        outgoingPendingRequests.push({
            out_id:            insertData?.id || null,
            out_receiver_id:   receiverId,
            out_receiver_name: receiverName || 'Someone',
            out_avatar_url:    null,
            out_created_at:    new Date().toISOString()
        });
        updateFriendsDisplay();

        // Notify receiver via SECURITY DEFINER RPC (bypasses RLS on notifications table)
        const senderName = currentProfile?.display_name || currentUser.email?.split('@')[0] || 'Someone';
        try {
            await supabaseClient.rpc('notify_friend_request', {
                p_receiver_id: receiverId,
                p_actor_id:    currentUser.id,
                p_message:     `${senderName} sent you a friend request`
            });
        } catch (notifErr) {
            console.warn('Could not send friend request notification:', notifErr);
        }

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

async function handleCancelFriendRequest(friendshipId) {
    const card = document.querySelector(`[data-cancel-id="${friendshipId}"]`);
    if (card) { card.style.opacity = '0.5'; card.style.pointerEvents = 'none'; }
    try {
        // RPC atomically deletes the friendship AND the receiver's notification
        const { error } = await supabaseClient.rpc('cancel_friend_request', {
            p_friendship_id: friendshipId
        });

        if (error) {
            console.error('Error cancelling friend request:', error);
            if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
            showToast('Could not cancel request. Try again.');
            return;
        }

        // Remove from local state immediately — no refetch needed
        outgoingPendingRequests = outgoingPendingRequests.filter(r => r.out_id !== friendshipId);
        outgoingFriendRequests = new Set(outgoingPendingRequests.map(r => r.out_receiver_id));
        updateFriendsDisplay();
        showToast('Request cancelled');
    } catch (err) {
        console.error('Error in handleCancelFriendRequest:', err);
        if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
    }
}

function updateFriendsDisplay() {
    const requestsContainer = document.getElementById('pendingRequestsContainer');
    const sentContainer = document.getElementById('sentRequestsContainer');
    const friendsContainer = document.getElementById('friendsListContainer');
    const emptyState = document.getElementById('friendsEmptyState');
    if (!requestsContainer || !friendsContainer) return;

    const hasPending = pendingFriendRequests.length > 0;
    const hasSent = outgoingPendingRequests.length > 0;
    const hasFriends = friendsCache.length > 0;

    requestsContainer.style.display = hasPending ? 'block' : 'none';
    if (sentContainer) sentContainer.style.display = hasSent ? 'block' : 'none';
    friendsContainer.style.display = hasFriends ? 'block' : 'none';
    if (emptyState) emptyState.style.display = (!hasPending && !hasSent && !hasFriends) ? 'block' : 'none';

    // Render pending requests (incoming)
    if (hasPending) {
        const list = document.getElementById('pendingRequestsList');
        if (list) {
            list.innerHTML = pendingFriendRequests.map(req => {
                const initial = (req.out_requester_name || '?').charAt(0).toUpperCase();
                const timeAgo = getTimeAgo(req.out_created_at);
                const emailLine = req.out_email
                    ? `<div class="friend-request-email">${escapeHtml(req.out_email)}</div>`
                    : '';
                return `<div class="friend-request-card">
                    <div class="friend-request-avatar">${initial}</div>
                    <div class="friend-request-info">
                        <div class="friend-request-name">${escapeHtml(req.out_requester_name || 'Unknown')}</div>
                        ${emailLine}
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

    // Render sent (outgoing pending) requests
    if (hasSent) {
        const sentList = document.getElementById('sentRequestsList');
        if (sentList) {
            sentList.innerHTML = outgoingPendingRequests.map(req => {
                const initial = (req.out_receiver_name || '?').charAt(0).toUpperCase();
                const emailLine = req.out_email
                    ? `<div class="friend-request-email">${escapeHtml(req.out_email)}</div>`
                    : '';
                return `<div class="friend-request-card" data-cancel-id="${req.out_id}">
                    <div class="friend-request-avatar">${initial}</div>
                    <div class="friend-request-info">
                        <div class="friend-request-name">${escapeHtml(req.out_receiver_name || 'Unknown')}</div>
                        ${emailLine}
                        <div class="friend-request-time">Request sent · awaiting response</div>
                    </div>
                    <div class="friend-request-actions">
                        <button class="reject-btn" onclick="handleCancelFriendRequest('${req.out_id}')">Cancel</button>
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

// In-memory cache of the last successfully fetched notifications.
// openNotifDrawer uses this so it never makes a second concurrent RPC call.
let _notifCache = null;

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
            p_limit: 20
        });
        if (error) {
            if (badge) badge.style.display = 'none';
            return;
        }
        const clearedAt = localStorage.getItem(_NOTIFS_CLEARED_KEY);
        let filtered = data || [];
        if (clearedAt) {
            const clearedDate = new Date(parseInt(clearedAt));
            filtered = filtered.filter(n => new Date(n.created_at) > clearedDate);
        }
        // Update cache so loadNotifications() can render instantly without a new RPC
        _notifCache = filtered;
        let hasVisible = filtered.length > 0;
        if (badge) badge.style.display = hasVisible ? 'block' : 'none';
    } catch (err) {
        console.error('Error in checkUnreadNotifications:', err);
        if (badge) badge.style.display = 'none';
    }
}

function startNotifPolling() {
    // Initial check — friend requests already loaded by init, just check notif badge
    checkUnreadNotifications();
    // Poll every 30 seconds — refresh badge, incoming AND outgoing pending friend requests
    if (notifPollInterval) clearInterval(notifPollInterval);
    notifPollInterval = setInterval(() => {
        checkUnreadNotifications();
        Promise.all([loadPendingFriendRequests(), loadOutgoingFriendRequests()]).then(updateFriendsDisplay);
    }, 30000);
}

function stopNotifPolling() {
    if (notifPollInterval) {
        clearInterval(notifPollInterval);
        notifPollInterval = null;
    }
}

function _renderNotifications(filtered) {
    const container = document.getElementById('notifItems');
    const emptyEl = document.getElementById('notifEmpty');
    const drawerList = document.getElementById('notifDrawerItems');
    const drawerEmpty = document.getElementById('notifDrawerEmpty');

    if (filtered.length === 0) {
        if (container) container.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        if (drawerList) drawerList.innerHTML = '';
        if (drawerEmpty) drawerEmpty.style.display = 'block';
        const badge = document.getElementById('notifBadge');
        if (badge) badge.style.display = 'none';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (drawerEmpty) drawerEmpty.style.display = 'none';

    const html = filtered.map(n => {
        let icon;
        if (n.type === 'endorsement') {
            icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
        } else if (n.type === 'friend_request') {
            icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;
        } else if (n.type === 'friend_accepted') {
            icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`;
        } else {
            icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        }
        const timeAgo = getTimeAgo(n.created_at);
        const unreadClass = n.read ? '' : ' unread';
        const clickAction = (n.type === 'friend_request' || n.type === 'friend_accepted')
            ? `handleFriendNotifClick('${n.id}')`
            : `handleNotifClick('${n.id}', '${n.item_id || ''}')`;

        return `<div class="notif-item${unreadClass}" id="notif-${n.id}" onclick="${clickAction}">
            <div class="notif-icon">${icon}</div>
            <div class="notif-body">
                <div class="notif-message">${escapeHtml(n.message)}</div>
                <div class="notif-time">${timeAgo}</div>
            </div>
            <button class="notif-delete" onclick="event.stopPropagation(); deleteNotification('${n.id}')" aria-label="Delete notification">&times;</button>
        </div>`;
    }).join('');

    if (container) container.innerHTML = html;
    if (drawerList) drawerList.innerHTML = html;
}

async function loadNotifications() {
    if (!currentUser) return;

    // If we have cached data, render immediately (no network call).
    // The 30s poll and checkUnreadNotifications keep the cache fresh.
    if (_notifCache) {
        _renderNotifications(_notifCache);
        return;
    }

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
            filtered = filtered.filter(n => new Date(n.created_at) > clearedDate);
        }

        _notifCache = filtered;
        _renderNotifications(filtered);
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

    // Show empty state if last notification deleted
    setTimeout(() => {
        const container = document.getElementById('notifItems');
        if (container && container.children.length === 0) {
            const emptyEl = document.getElementById('notifEmpty');
            if (emptyEl) emptyEl.style.display = 'block';
            const badge = document.getElementById('notifBadge');
            if (badge) badge.style.display = 'none';
        }
    }, 250);
}

async function clearAllNotifications() {
    if (!currentUser) return;
    // Store the cleared timestamp permanently — any notification created
    // before this time will never be shown again, even if the DB delete fails
    localStorage.setItem(_NOTIFS_CLEARED_KEY, (Date.now() + 1).toString());
    _notifCache = []; // Clear cache so next poll fetches fresh
    const container = document.getElementById('notifItems');

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
        const emptyEl = document.getElementById('notifEmpty');
        if (emptyEl) emptyEl.style.display = 'block';
    }, 300);

    // Clear badge
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
}

async function handleNotifClick(notifId, itemId) {
    // Close drawer first
    closeNotifDrawer();

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
    // Close drawer first
    closeNotifDrawer();
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
        let viewed = JSON.parse(localStorage.getItem('odin_recently_viewed') || '[]');
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
        localStorage.setItem('odin_recently_viewed', JSON.stringify(viewed));
    } catch (e) { /* ignore storage errors */ }
}

function renderRecentlyViewed() {
    const section = document.getElementById('recentlyViewedSection');
    const row = document.getElementById('recentlyViewedRow');
    if (!section || !row) return;

    try {
        const viewed = JSON.parse(localStorage.getItem('odin_recently_viewed') || '[]');
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
        let viewed = JSON.parse(localStorage.getItem('odin_recently_viewed') || '[]');
        viewed = viewed.filter(v => v.id !== itemId);
        localStorage.setItem('odin_recently_viewed', JSON.stringify(viewed));
        renderRecentlyViewed();
    } catch (e) { /* ignore */ }
}

function getCategoryEmoji(type) {
    const map = { place: '📍', product: '🛍️', service: '🔧', advice: '💡' };
    return map[type] || '📍';
}

// ===== APP CONFIGURATION =====
const SEARCH_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/search123';
const CAPTURE_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/capture-staging'; // STAGING — points at Odin — Discovery Capture (STAGING). Revert to /webhook/capture before merging to main.
const TRANSLATE_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/translate-card';
const OG_FETCH_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/og-fetch';
const DELETE_ACCOUNT_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/delete-account';
const FEEDBACK_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/search-feedback';

// ===== SEARCH EVENT / FEEDBACK LOOP =====
// Client-generated UUID v4 for each search, sent as search_event_id in the
// search request body AND used as the row PK for public.search_events.
// This lets the frontend log feedback (thumbs, click, save) against the
// search without waiting for a server round-trip.
let currentSearchEventId = null;
// Ordered list of item ids as shown in the last result render — position is
// this array's index when logging feedback events.
let currentResultPositions = [];
// Which items have already received thumbs feedback this session, keyed by
// `${search_event_id}:${item_id}` to avoid double-logging.
const feedbackSent = new Set();

function uuidv4() {
    // Prefer the native crypto UUID if available (all modern browsers).
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try { return crypto.randomUUID(); } catch (e) { /* fall through */ }
    }
    // Fallback — RFC 4122 v4 from crypto.getRandomValues.
    const b = new Uint8Array(16);
    (crypto && crypto.getRandomValues ? crypto : { getRandomValues: (a) => { for (let i=0;i<a.length;i++) a[i]=Math.floor(Math.random()*256); return a; } }).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2,'0'));
    return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
}

// Fire-and-forget feedback logger. Never blocks UI; swallows errors.
// action: 'search_helpful' | 'search_unhelpful' (search-level)
//       | 'click' | 'save' (item-level, reserved for future use)
function logSearchFeedback(action, itemId, extraMeta) {
    if (!currentSearchEventId || !action) return;
    // Dedupe per (event, action) so a single search can't double-log Yes/No.
    const key = `${currentSearchEventId}:${action}:${itemId || ''}`;
    if (feedbackSent.has(key)) return;
    feedbackSent.add(key);

    const body = {
        search_event_id: currentSearchEventId,
        item_id: itemId || null,
        position: null,
        action,
        user_id: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null,
        metadata: Object.assign({
            ts: new Date().toISOString(),
            lang: (typeof userPreferredLanguage !== 'undefined' ? userPreferredLanguage : 'en')
        }, extraMeta || {})
    };
    try {
        fetch(FEEDBACK_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true
        }).catch(() => {});
    } catch (e) { /* non-fatal */ }
}

// Called from the single "Was this helpful?" bar under each result set.
// `helpful` is true for Yes, false for No. Replaces the bar with a thank-you.
window.onSearchHelpful = function(btn, helpful) {
    try {
        const bar = btn.closest('.search-helpful-bar');
        logSearchFeedback(helpful ? 'search_helpful' : 'search_unhelpful', null, {
            query: (typeof sessionMessages !== 'undefined' && sessionMessages.length)
                ? (sessionMessages[sessionMessages.length - 2] || {}).content || null
                : null
        });
        if (bar) {
            bar.innerHTML = '<span class="search-helpful-thanks">Thanks for the feedback.</span>';
        }
    } catch (e) { /* non-fatal */ }
};

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

// Translate icon — Lucide "Languages", used everywhere instead of 🌐 emoji
const TRANSLATE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';

/** Call once after profile is loaded. Autodetects from browser if not set. */
async function initUserLanguage() {
    // 1. Try profile setting from Supabase
    const saved = currentProfile?.preferred_language;
    if (saved && LANG_LABELS[saved]) {
        userPreferredLanguage = saved;
        _applyLangLabel(saved);
        return;
    }
    // 1b. Fallback: try localStorage (persists across reloads even before Supabase loads)
    const lsSaved = localStorage.getItem('preferredLanguage');
    if (lsSaved && LANG_LABELS[lsSaved]) {
        userPreferredLanguage = lsSaved;
        _applyLangLabel(lsSaved);
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
    const label = (LANG_LABELS[lang] || lang.toUpperCase()).substring(0, 5);
    // Update header language button (shown on profile page header)
    const el = document.getElementById('headerLangLabel');
    if (el) el.textContent = label;
    // Update profile settings row value (the language button in profile page)
    const profileEl = document.getElementById('profileLangValue');
    if (profileEl) profileEl.textContent = label;
    // Persist to localStorage so it survives page reload
    localStorage.setItem('preferredLanguage', lang);
    // Highlight active in dropdown
    document.querySelectorAll('.lang-picker-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    // Highlight active in lang drawer
    document.querySelectorAll('.lang-drawer-item').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.lang === lang);
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

// Search v4 (sort-not-filter): the LLM groups results into top_picks + more_options.
// We no longer apply a relevance threshold on the frontend — anything the backend returns is shown.
// Kept as a deprecated constant for any legacy code path that still references it.
const RELEVANCE_THRESHOLD = 0; // deprecated — search v4 groups in backend

let userLocation = { latitude: null, longitude: null, available: false };
let locationPromise = null; // resolves once, shared by all callers

// ── Geolocation (awaitable) ────────────────────────────────────────────────
// Fires on page load AND on first user gesture (whichever succeeds first).
// Silent page-load calls often fail without a user gesture on iOS/Safari,
// so we retry on gesture. Search awaits this with a short timeout.
function requestLocation() {
    if (userLocation.available) return Promise.resolve(userLocation);
    if (locationPromise) return locationPromise;
    if (!navigator.geolocation) {
        locationPromise = Promise.resolve(userLocation);
        return locationPromise;
    }
    locationPromise = new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                userLocation.latitude  = pos.coords.latitude;
                userLocation.longitude = pos.coords.longitude;
                userLocation.available = true;
                console.log('📍 Location ready:', userLocation.latitude, userLocation.longitude);
                resolve(userLocation);
            },
            function(err) {
                console.log('📍 Location unavailable:', err.message);
                // Reset so a future gesture-driven call can retry
                locationPromise = null;
                resolve(userLocation);
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
    });
    return locationPromise;
}

// Fire once on app load (may fail silently on iOS without gesture)
requestLocation();

// Retry on first user gesture — this usually succeeds where page-load failed
(function armGestureRetry() {
    const tryAgain = () => {
        if (!userLocation.available) {
            locationPromise = null;
            requestLocation();
        }
        window.removeEventListener('pointerdown', tryAgain);
        window.removeEventListener('keydown', tryAgain);
    };
    window.addEventListener('pointerdown', tryAgain, { once: true });
    window.addEventListener('keydown', tryAgain, { once: true });
})();

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
        btn.innerHTML = 'Translate ' + TRANSLATE_ICON;
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
        btn.classList.add('translate-loading');
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
        btn.classList.remove('translate-loading');
        btn.disabled = false;
    } else {
        // Remove translation blocks — originals stay untouched
        document.querySelectorAll('.drawer-translation-block').forEach(function(el) { el.remove(); });
        btn.dataset.state = 'original';
        btn.innerHTML = 'Translate to ' + langLabel + ' ' + TRANSLATE_ICON;
    }
}

// ── Translate button on Home + Discover feed cards ──
async function toggleFeedCardTranslate(btn) {
    const itemId = btn.dataset.itemId;
    if (!itemId) return;
    const item = (typeof allDiscoveries !== 'undefined' && allDiscoveries.find(d => d.id === itemId))
        || (typeof currentResults !== 'undefined' && currentResults.find(r => r.id === itemId))
        || null;
    if (!item) { btn.innerHTML = TRANSLATE_ICON; return; }

    const state = btn.dataset.state;
    const targetLang = userPreferredLanguage || 'en';
    const card = btn.closest('.hf-card');

    if (state === 'original') {
        btn.classList.add('translate-loading');
        btn.disabled = true;
        try {
            const translated = await translateItem(item, targetLang);
            const wordEl = card && card.querySelector('.hf-card-word');
            if (wordEl && (translated.personal_note || translated.description)) {
                const prev = card.querySelector('.feed-card-translation');
                if (prev) prev.remove();
                const span = document.createElement('div');
                span.className = 'feed-card-translation';
                span.textContent = (translated.personal_note || translated.description || '').split(/\s+/).slice(0, 10).join(' ') + '…';
                wordEl.insertAdjacentElement('afterend', span);
            }
            btn.dataset.state = 'translated';
            btn.innerHTML = '✕ ' + TRANSLATE_ICON;
        } catch (e) {
            btn.innerHTML = TRANSLATE_ICON;
        }
        btn.classList.remove('translate-loading');
        btn.disabled = false;
    } else {
        const prev = card && card.querySelector('.feed-card-translation');
        if (prev) prev.remove();
        btn.dataset.state = 'original';
        btn.innerHTML = TRANSLATE_ICON;
    }
}

// ── Translate button on inline result cards (top picks + compact cards) ──
async function toggleCardTranslate(btn, idx) {
    const r = currentResults[idx];
    if (!r) return;
    const state = btn.dataset.state;
    const card  = btn.closest('.top-pick-card, .compact-card');

    if (state === 'original') {
        btn.classList.add('translate-loading');
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
        } catch(e) {
            btn.innerHTML = 'Translate ' + TRANSLATE_ICON;
            btn.dataset.state = 'original';
        }
        btn.classList.remove('translate-loading');
        btn.disabled = false;
    } else {
        // Restore originals
        const reasonSpan = card && card.querySelector('.top-pick-reason-text');
        if (reasonSpan && reasonSpan.dataset.original) reasonSpan.textContent = reasonSpan.dataset.original;
        const snippetEl = card && card.querySelector('.compact-snippet');
        if (snippetEl && snippetEl.dataset.original) snippetEl.textContent = snippetEl.dataset.original;
        btn.dataset.state = 'original';
        btn.innerHTML = 'Translate ' + TRANSLATE_ICON;
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
    var stepBar = document.getElementById('addStepSticky');
    if (stepBar) stepBar.classList.add('hidden');
    document.body.classList.remove('add-tab-open');
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
    // Sync the inline Map toggle button in the Discover headline row
    var mapBtn = document.getElementById('dcMapToggleBtn');
    if (mapBtn) {
        if (view === 'map') {
            mapBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> List';
            mapBtn.onclick = function() { switchDiscoverView('collections'); };
            mapBtn.classList.add('active');
        } else {
            mapBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg> Map';
            mapBtn.onclick = function() { switchDiscoverView('map'); };
            mapBtn.classList.remove('active');
        }
    }
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
        // Hide preview card when leaving map view
        dismissMapPreview();
        // Reset search nudge counter so it can show again next visit
        _dmapSearchCount = 0;
        _dmapSearchBannerShown = false;
        dismissAISearchNudge();
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
            // Map already exists — fix its size and re-add any missing markers
            setTimeout(function(){
                if (discoverMap) {
                    setMapScreenHeight();
                    discoverMap.invalidateSize();
                    // Re-add markers that may have been dropped when map was hidden
                    if (dmapMarkers && dmapMarkers.length > 0) {
                        dmapMarkers.forEach(function(m) {
                            if (m.marker && !discoverMap.hasLayer(m.marker)) {
                                m.marker.addTo(discoverMap);
                            }
                        });
                    }
                }
            }, 150);
            setTimeout(function(){ if (discoverMap) discoverMap.invalidateSize(); }, 400);
            if (isIOS) {
                setTimeout(function(){ if (discoverMap) discoverMap.invalidateSize(); }, 800);
            }
        } else {
            discoverMapInitialized = false;
            switchDiscoverView('map');
        }
    }
}

function setMapScreenHeight() {
    var tabBar = document.querySelector('.bottom-tab-bar');
    // dmap-topbar is now display:none — floating bar is inside map area, not a layout row
    var tabH   = tabBar ? tabBar.offsetHeight : 0;

    // iOS Safari: use visualViewport.height for the actual visible area
    var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;

    // Map screen is position:fixed top:0 bottom:0 — it covers full viewport.
    // The only thing taking space below the map on mobile is the bottom tab bar,
    // but since discover-map-screen is fixed and covers it, h = full vh.
    var h = vh;
    if (h < 100) h = vh; // safety

    // Set explicit pixel height on EVERY element in the chain.
    // On iOS Safari, flex:1 / height:100% chains collapse unless ancestors have pixel heights.
    var contentEl      = document.querySelector('.content');
    var discoverModeEl = document.getElementById('discoverMode');
    var mapView        = document.getElementById('discoverMapView');
    var inner          = document.querySelector('.dmap-inner');
    var area           = document.querySelector('.dmap-area');
    var mapEl          = document.getElementById('discoverMap');

    if (contentEl)      contentEl.style.height      = vh + 'px';
    if (discoverModeEl) discoverModeEl.style.height = vh + 'px';
    if (mapView)        mapView.style.height        = vh + 'px';
    if (inner)          inner.style.height          = vh + 'px';
    if (area)           area.style.height           = vh + 'px';
    if (mapEl)          mapEl.style.height          = vh + 'px';

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
    // If the new section tabs are present, delegate to the active section instead
    var activeTab = document.querySelector('.dc-stab.active');
    if (activeTab) {
        if (typeof setDiscoverSection === 'function') {
            setDiscoverSection(activeTab, activeTab.dataset.section || 'trending');
        }
        return;
    }

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

    // Hide the circle section header, collection grid, and distance row
    var circleHeader = document.getElementById('dcCircleHeader');
    var collGrid     = document.getElementById('dcCollectionsGrid');
    var distRow      = document.getElementById('dcDistanceRow');
    if (circleHeader) circleHeader.style.display = 'none';
    if (collGrid)     collGrid.style.display     = 'none';
    if (distRow)      distRow.style.display      = 'none';

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

// Track active mode for pull-to-refresh
var _currentMode = 'home';

function setMode(mode) {
    var _prevMode = _currentMode;
    _currentMode = mode;
    document.getElementById('homePage').classList.add('hidden');
    document.getElementById('searchMode').classList.add('hidden');
    document.getElementById('discoverMode').classList.add('hidden');
    document.getElementById('inputMode').classList.add('hidden');
    document.getElementById('profileMode').classList.add('hidden');
    var savedEl = document.getElementById('savedMode');
    if (savedEl) savedEl.classList.add('hidden');
    // Always hide step bar; re-shown below if mode === 'input'
    var stepBar = document.getElementById('addStepSticky');
    if (stepBar) stepBar.classList.add('hidden');
    document.body.classList.remove('add-tab-open');

    // Show header only on Home page, hide on all other pages
    var headerEl = document.querySelector('.header');
    if (headerEl) headerEl.style.display = (mode === 'home') ? '' : 'none';
    // Toggle body class so non-home pages get safe-area top padding
    document.body.classList.toggle('no-header', mode !== 'home');

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
    } else if (mode === 'discover') {
        document.getElementById('discoverMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
        // Always start on Collections sub-view when entering Discover
        switchDiscoverView('collections');
        // Only reload if not already loaded — avoids wiping allDiscoveries
        // before friendsCache is ready when user navigates quickly
        if (!allDiscoveries || allDiscoveries.length === 0) loadDiscoveries();
        if (typeof initDiscoverGreeting === 'function') initDiscoverGreeting();
    } else if (mode === 'saved') {
        if (savedEl) savedEl.classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
        loadSavedPage();
    } else if (mode === 'input') {
        document.getElementById('inputMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
        // Show step bar (fixed to top — never scrolls)
        var stepBar = document.getElementById('addStepSticky');
        if (stepBar) stepBar.classList.remove('hidden');
        document.body.classList.add('add-tab-open');
        if (typeof _startPhraseRotation === 'function') _startPhraseRotation('addSubtitle', 'add', 7000);
        // Only reset when arriving from a different page. Re-tapping Add while
        // already on the Add page must not wipe the "Found a link" banner.
        if (_prevMode !== 'input') _resetAddState();
        updateAddStep(1);
        // _checkClipboardForUrl() skips iOS — the system Paste banner cannot be suppressed.
    } else if (mode === 'profile') {
        document.getElementById('profileMode').classList.remove('hidden');
        document.getElementById('inputArea').classList.add('hidden');
        loadProfilePage();
        if (typeof _startPhraseRotation === 'function') _startPhraseRotation('profilePageSubtitle', 'profile', 7000);
    }

    updateTabBar(mode);
    showCoachMark(mode);
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
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
    // Sync map topbar filter badge
    const mapBadge = document.getElementById('dmapFilterBadge');
    if (mapBadge) {
        if (count > 0) {
            mapBadge.textContent = count;
            mapBadge.style.display = 'flex';
        } else {
            mapBadge.style.display = 'none';
        }
    }
}

function clearFilters() {
    filters = { categories: [], users: [], distances: [], endorsed: false, searchText: '' };
    document.querySelectorAll('.filter-option input').forEach(cb => cb.checked = false);
    var dsEl = document.getElementById('discoverSearch');
    if (dsEl) dsEl.value = '';
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
    // If in map view, re-render map with all data
    if (discoverViewMode === 'map') {
        closeFilterModal();
        filterAndRender();
        discoverMapInitialized = false;
        if (discoverMap) { try { discoverMap.remove(); } catch(e) {} discoverMap = null; }
        userLocMarker = null;
        setTimeout(function() {
            setMapScreenHeight();
            initDiscoverMap();
        }, 100);
    }
}

function applyFilters() {
    closeFilterModal();
    filterAndRender();
    // If we're in map view, re-init the map with the newly filtered data
    if (discoverViewMode === 'map') {
        discoverMapInitialized = false;
        if (discoverMap) { try { discoverMap.remove(); } catch(e) {} discoverMap = null; }
        userLocMarker = null;
        setTimeout(function() {
            setMapScreenHeight();
            initDiscoverMap();
        }, 100);
    }
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
    // Only show distance row when 'Near me' chip is active
    var row = document.getElementById('dcDistanceRow');
    var activeChip = document.querySelector('.dc-stab.active');
    var isNearby = activeChip && activeChip.dataset.section === 'nearby';
    if (row && userLocation && userLocation.available && isNearby) {
        row.style.display = 'flex';
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
const TRUST = {
    OWN:      'own',             // _trust_level: my own items (any visibility setting)
    PRIVATE:  'private',         // item.visibility value — "Only me"
    FRIENDS:  'friends',         // item.visibility value + _trust_level for friend items
    EXTENDED: 'extended_circle'  // _trust_level for save-inheritance / FOF items
};

// Anonymise an extended-circle item so identity never travels more than one hop.
// Keeps: title, photo_url, address, latitude, longitude, description,
//        type, category, feed_card_summary, save_count, created_at, id
// Strips: added_by, added_by_name, personal_note / metadata notes, comments
// viaFriendName: the direct friend who saved the item (Save Inheritance only).
//   For true FOF (trust_connections path) this is null — no name shown.
function anonymiseForExtendedCircle(item, viaFriendName) {
    return Object.assign({}, item, {
        _trust_level: TRUST.EXTENDED,
        added_by:      null,
        added_by_name: 'Someone in your circle',
        // _via_friend_name: name of the direct friend whose save surfaced this item.
        // Used to render "Via [Name]" on feed card and result card.
        _via_friend_name: viaFriendName || null,
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
                    ? TRUST.OWN    // own items — visibility setting is separate
                    : TRUST.FRIENDS;
            }
            return item;
        });

        // ── Tier 2b: Save-inheritance — items saved by direct friends ──
        // Friends saved items from their own circle; we see them anonymously.
        // Requires SECURITY DEFINER RPC because endorsements table is RLS-protected.
        if (friendsCache.length > 0) {
            try {
                const { data: savedRows, error: savedErr } = await supabaseClient.rpc(
                    'get_friend_saved_item_ids',
                    { p_user_id: currentUser.id }
                );
                if (savedErr) {
                    console.warn('Save-inheritance RPC error (non-critical):', savedErr.message);
                } else if (savedRows && savedRows.length > 0) {
                    const seenIds = new Set(data.map(i => i.id));
                    // Build a lookup: item_id → saver_name (from updated RPC)
                    const saverByItemId = {};
                    savedRows.forEach(r => {
                        if (!saverByItemId[r.item_id]) saverByItemId[r.item_id] = r.saver_name || null;
                    });
                    const inheritedIds = savedRows
                        .map(r => r.item_id)
                        .filter(id => !seenIds.has(id));

                    if (inheritedIds.length > 0) {
                        // Fetch full item details — use anon key like Tier 1/2 above
                        const inheritedResp = await fetch(
                            `${SUPABASE_URL}/rest/v1/knowledge_items?select=*&id=in.(${inheritedIds.join(',')})&order=created_at.desc`,
                            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
                        );
                        const inheritedData = await inheritedResp.json();
                        if (Array.isArray(inheritedData) && inheritedData.length > 0) {
                            // Anonymise — strip original adder identity (save-inheritance rule)
                            // Pass the friend's name who made the save so "Via [Name]" renders
                            const anonymised = inheritedData.map(item =>
                                anonymiseForExtendedCircle(item, saverByItemId[item.id] || null)
                            );
                            data = [...data, ...anonymised];
                        }
                    }
                }
            } catch (savedErr) {
                console.warn('Save-inheritance fetch failed (non-critical):', savedErr);
            }
        }

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
    toDisplay.forEach((item, i) => {
        try {
            grid.appendChild(createCard(item, i));
        } catch (err) {
            console.warn('Card render error (skipped):', item?.title, err);
        }
    });
    displayedCount = toDisplay.length;

    document.getElementById('loadMoreContainer').classList.toggle('hidden', displayedCount >= filteredDiscoveries.length);

    if (mapVisible.discover) {
        setTimeout(() => initDiscoverMap(), 100);
    }
}

function createCard(item, index) {
    const card = document.createElement('div');
    card.className = 'hf-card dc-grid-card';
    card.onclick = () => showDrawer(index);

    // ── Photo / placeholder ──
    const mediaSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>';
    const mediaHtml = item.photo_url
        ? `<img class="hf-card-img" src="${escapeHtml(item.photo_url)}" alt="" loading="lazy">`
        : `<div class="hf-card-placeholder">${mediaSVG}</div>`;

    // ── Distance chip ──
    const distText = item.distance_km
        ? (item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km')
        : '';
    const distChip = distText ? `<span class="hf-card-dist">${distText}</span>` : '';

    // ── Category chip ──
    const catLabel = item.category
        ? item.category.charAt(0).toUpperCase() + item.category.slice(1)
        : (item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : '');
    const catChip = catLabel ? `<span class="hf-card-cat">${escapeHtml(catLabel)}</span>` : '';

    // ── Odin Trust Layer — declared early so isOwner is available for privateChip ──
    const isOwner           = currentUser && item.added_by === currentUser.id;
    const isSaveInheritance = item._trust_level === TRUST.EXTENDED && item._via_friend_name;
    const isExtendedCircle  = item._trust_level === TRUST.EXTENDED;

    // ── Private chip — only shown to the owner for their own private items ──
    const privateChip = (item.visibility === TRUST.PRIVATE && isOwner)
        ? `<span class="hf-card-private">Private</span>` : '';

    // ── Resolve personal note ──
    let note = null;
    if (item.PersonalNote) note = item.PersonalNote;
    else if (item.personal_note) note = item.personal_note;
    else if (item.metadata) {
        try {
            const meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
            note = meta.personal_note;
        } catch (e) {}
    }

    // ── DISCOVER CARD LAYOUT ──
    // 1. Lead with person — avatar + "Added by [Name]" (prominent first line)
    // 2. The Word — 10-word truncated personal note (privacy-gated)
    // 3. Title
    // 4. Chips row
    // 5. Save count (popularity signal for Discover)

    // ── 1. Person header — who added this ──
    let adderName, adderAvatarCol, adderInitial;
    if (isSaveInheritance) {
        adderName = item._via_friend_name || 'Your circle';
    } else if (isOwner) {
        adderName = currentProfile?.display_name || 'You';
    } else if (!isExtendedCircle) {
        adderName = item.added_by_name || 'Friend';
    } else {
        adderName = 'Someone in your circle';
    }
    adderInitial = (adderName || '?').charAt(0).toUpperCase();
    adderAvatarCol = strColour(adderName || '?');

    const adderAvatarHtml = `<div class="hf-card-avatar dc-adder-avatar" style="background:${adderAvatarCol};">${adderInitial}</div>`;
    const adderLabel = isSaveInheritance
        ? `Via ${escapeHtml(item._via_friend_name)}`
        : isOwner
            ? 'Added by you'
            : `Added by ${escapeHtml(adderName)}`;

    const personHeaderHtml = `
        <div class="hf-card-person-header">
            ${adderAvatarHtml}
            <span class="hf-card-person-name">${adderLabel}</span>
        </div>`;

    // ── 2. The Word — 10-word truncated personal note (privacy-gated) ──
    // Friends see the note; extended circle sees a prompt to connect
    let wordHtml = '';
    if (!isExtendedCircle && note) {
        // Direct friend or owner — can see the note
        const words = note.trim().split(/\s+/);
        const truncated = words.slice(0, 10).join(' ') + (words.length > 10 ? '…' : '');
        wordHtml = `<div class="hf-card-word"><em>${escapeHtml(truncated)}</em></div>`;
    } else if (isExtendedCircle) {
        // Preserve existing privacy gate
        wordHtml = `<div class="hf-card-word hf-card-word--gated">Connect to see their story</div>`;
    }
    // If no note at all and not extended circle, fall back silently (no word line shown)

    // ── 3. Save count — popularity signal for Discover ──
    const cachedEndorse = endorsementsCache[item.id] || { count: 0, names: [], ids: [] };
    const friendIdSet = new Set(friendsCache.map(f => f.out_user_id));
    if (currentUser) friendIdSet.add(currentUser.id);
    const circleCount = (cachedEndorse.ids || []).filter(id => friendIdSet.has(id)).length;
    // Show circle save count (adder counts as 1)
    const totalSaves = Math.max(circleCount, 1);
    const saveCountLabel = totalSaves === 1 ? '1 save in your circle' : `${totalSaves} saves in your circle`;
    const saveCountHtml = `<div class="hf-card-save-count">${saveCountLabel}</div>`;

    // ── DISCOVER card order: Title → The Word → chips → Added by → [divider] → saves + translate ──
    const _dcTranslateLabel = userPreferredLanguage && userPreferredLanguage !== 'en'
        ? 'Translate to ' + (LANG_LABELS[userPreferredLanguage] || userPreferredLanguage) + ' ' + TRANSLATE_ICON
        : TRANSLATE_ICON;
    card.innerHTML = `
        <div class="hf-card-media-wrap">${mediaHtml}</div>
        <div class="hf-card-body">
            <div class="hf-card-title">${escapeHtml(item.title)}</div>
            ${wordHtml}
            <div class="hf-card-chips-row">${catChip}${distChip}${privateChip}</div>
            <div class="hf-card-adder">
                ${adderAvatarHtml}
                <span class="hf-card-person-name">${adderLabel}</span>
            </div>
            <div class="hf-card-by">
                <span class="hf-card-save-count">${saveCountLabel}</span>
                <button class="feed-card-translate-btn" data-item-id="${escapeHtml(item.id||'')}" data-state="original" onclick="event.stopPropagation(); toggleFeedCardTranslate(this)">${_dcTranslateLabel}</button>
            </div>
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
        var catLabel = d.category || d.type || '';
        var distKm = d.distance_km;
        var distText = distKm ? (distKm < 1 ? Math.round(distKm*1000)+'m' : distKm.toFixed(1)+'km') : '';
        var avInit = (d.added_by_name || '?').charAt(0).toUpperCase();
        var avCol = strColour ? strColour(d.added_by_name || '?') : '#7B2D45';
        var saveCount = (endorsementsCache[d.id] || {}).count || d.saves_count || 0;
        var savesLabel = saveCount === 1 ? '1 in your circle saved this' : saveCount + ' in your circle saved this';
        var imgUrl = d.image_url || d.thumbnail_url || d.photo_url || '';
        var noteText = d.notes || d.description || d.note || '';

        var distHtml = distText
            ? '<span class="dmap-prev-badge">' +
                '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                distText + '</span>'
            : '';
        var catHtml = catLabel
            ? '<span class="dmap-prev-badge">' +
                '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + col + ';flex-shrink:0;"></span>' +
                escapeHtml(catLabel) + '</span>'
            : '';
        var imgHtml = imgUrl
            ? '<img src="' + escapeHtml(imgUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;">'
            : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;">' +
                ({'Place':'📍','Food':'🍽','Café':'☕','Service':'🏥','Advice':'💡','Product':'📦'}[catLabel] || '📍') +
              '</div>';

        var card = document.createElement('div');
        card.className = 'dmap-panel-card';
        card.id = 'dpi-' + i;
        card.innerHTML =
            '<div class="dmap-panel-card-img">' + imgHtml + '</div>' +
            '<div class="dmap-panel-card-body">' +
                '<div class="dmap-panel-card-title">' + escapeHtml(d.title) + '</div>' +
                (noteText ? '<div class="dmap-panel-card-note">' + escapeHtml(noteText) + '</div>' : '') +
                '<div class="dmap-prev-badges" style="margin-top:5px;">' + catHtml + distHtml + '</div>' +
                '<div class="dmap-panel-card-saves">' +
                    '<div class="dmap-prev-av" style="background:' + avCol + ';">' + avInit + '</div>' +
                    '<span>' + escapeHtml(savesLabel) + '</span>' +
                '</div>' +
            '</div>';
        card.onclick = (function(idx){ return function(){ focusMapItem(idx); }; })(i);
        list.appendChild(card);
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
        var totalSaves = (endorsementsCache[d.id] || {}).count || d.saves_count || 0;
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

// Track which item is currently previewed
var dmapActivePreviewIdx = null;

function focusMapItem(idx) {
    // Highlight active panel card (desktop) — works for both .dmap-panel-card and .dmap-panel-item
    document.querySelectorAll('.dmap-panel-card, .dmap-panel-item').forEach(function(el){ el.classList.remove('active-item'); });
    var pItem = document.getElementById('dpi-' + idx);
    if (pItem) { pItem.classList.add('active-item'); pItem.scrollIntoView({ behavior:'smooth', block:'nearest' }); }

    // Highlight active pin — bounce it slightly and bring to front
    dmapMarkers.forEach(function(m, i) {
        if (m.marker && m.marker._icon) {
            m.marker._icon.style.opacity = i === idx ? '1' : '0.5';
            m.marker._icon.style.zIndex  = i === idx ? '1000' : '';
        }
    });

    // Pan map and open popup
    var m = dmapMarkers[idx];
    if (m && discoverMap) {
        discoverMap.setView([m.lat, m.lng], 16, { animate: true });
        setTimeout(function(){ if (m.marker) m.marker.openPopup(); }, 350);
    }

    // Show bottom preview card (mobile)
    showMapPreviewCard(idx);
}

function showMapPreviewCard(idx) {
    var m = dmapMarkers[idx];
    if (!m || !m.data) return;
    var d = m.data;
    dmapActivePreviewIdx = idx;

    // Title
    var titleEl = document.getElementById('dmapPrevTitle');
    if (titleEl) titleEl.textContent = d.title || '';

    // Note/description
    var noteEl = document.getElementById('dmapPrevNote');
    if (noteEl) noteEl.textContent = d.notes || d.description || d.note || '';

    // Type badge — coloured dot + category label
    var typeEl = document.getElementById('dmapPrevType');
    if (typeEl) {
        var catLabel = d.category || d.type || '';
        var catCol = catColour ? catColour(catLabel) : '#7B2D45';
        typeEl.innerHTML = catLabel
            ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + catCol + ';flex-shrink:0;"></span>' + escapeHtml(catLabel)
            : '';
        typeEl.style.display = catLabel ? '' : 'none';
    }

    // Distance badge — SVG pin icon, no emoji
    var distEl = document.getElementById('dmapPrevDist');
    if (distEl) {
        var distKm = d.distance_km;
        var distText = distKm
            ? (distKm < 1 ? Math.round(distKm * 1000) + 'm' : distKm.toFixed(1) + 'km')
            : '';
        if (distText) {
            distEl.innerHTML =
                '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                distText;
            distEl.style.display = '';
        } else {
            distEl.innerHTML = '';
            distEl.style.display = 'none';
        }
    }

    // Image
    var imgEl = document.getElementById('dmapPrevImg');
    var placeholderEl = document.getElementById('dmapPrevImgPlaceholder');
    if (imgEl && placeholderEl) {
        var imgUrl = d.image_url || d.thumbnail_url || d.photo_url || '';
        if (imgUrl) {
            imgEl.src = imgUrl;
            imgEl.style.display = 'block';
            placeholderEl.style.display = 'none';
        } else {
            imgEl.style.display = 'none';
            placeholderEl.style.display = 'flex';
            // Category emoji fallback
            var catEmoji = { 'Place': '📍', 'Food': '🍽', 'Café': '☕', 'Service': '🏥', 'Advice': '💡', 'Product': '📦' };
            placeholderEl.textContent = catEmoji[d.category] || catEmoji[d.type] || '📍';
        }
    }

    // Circle saves — show added_by avatar + save count
    var avStack = document.getElementById('dmapPrevAvStack');
    var savesText = document.getElementById('dmapPrevSavesText');
    var savesRow = document.getElementById('dmapPrevSaves');
    if (avStack && savesText) {
        var avInit = (d.added_by_name || '?').charAt(0).toUpperCase();
        var avCol = strColour ? strColour(d.added_by_name || '?') : '#7B2D45';
        var saveCount = (endorsementsCache[d.id] || {}).count || d.saves_count || 0;
        avStack.innerHTML = '<div class="dmap-prev-av" style="background:' + avCol + ';">' + avInit + '</div>';
        savesText.textContent = saveCount === 1
            ? '1 in your circle saved this'
            : saveCount + ' in your circle saved this';
        if (savesRow) savesRow.style.display = 'flex';
    }

    // Show the wrap with slide-up animation
    var wrap = document.getElementById('dmapPreviewWrap');
    if (wrap) {
        wrap.style.display = 'block';
        // Re-trigger animation
        wrap.style.animation = 'none';
        wrap.offsetHeight; // reflow
        wrap.style.animation = '';
    }
}

function dismissMapPreview() {
    var wrap = document.getElementById('dmapPreviewWrap');
    if (wrap) wrap.style.display = 'none';
    dmapActivePreviewIdx = null;
    // Deactivate panel cards
    document.querySelectorAll('.dmap-panel-card, .dmap-panel-item').forEach(function(el){ el.classList.remove('active-item'); });
    // Reset all pin opacity
    dmapMarkers.forEach(function(m) {
        if (m.marker && m.marker._icon) {
            m.marker._icon.style.opacity = '1';
            m.marker._icon.style.zIndex  = '';
        }
    });
}

function dmapPreviewOpen() {
    if (dmapActivePreviewIdx === null) return;
    var m = dmapMarkers[dmapActivePreviewIdx];
    if (m && m.data) openItemDrawer(m.data);
}

// Opens the full detail drawer from a map popup "View" button
function openMapItemDrawer(idx) {
    var m = dmapMarkers[idx];
    if (m && m.data) openItemDrawer(m.data);
}

var _dmapSearchCount = 0;
var _dmapSearchBannerShown = false;

function filterMapList(query) {
    var q = query.toLowerCase().trim();
    var count = 0;

    // Track search attempts and show AI search nudge banner after 2 searches
    if (q.length > 1) {
        _dmapSearchCount++;
        if (_dmapSearchCount >= 2 && !_dmapSearchBannerShown) {
            _dmapSearchBannerShown = true;
            setTimeout(function() { showAISearchNudge(); }, 600);
        }
    }

    dmapMarkers.forEach(function(m, idx) {
        var d = m.data;
        var title   = (d.title || '').toLowerCase();
        var cat     = (d.category || d.type || '').toLowerCase();
        var by      = (d.added_by_name || '').toLowerCase();
        var notes   = (d.notes || d.personal_note || d.note || '').toLowerCase();
        var desc    = (d.description || '').toLowerCase();
        var tags    = (d.tags || '').toLowerCase();
        var address = (d.address || d.location || '').toLowerCase();
        var url     = (d.url || d.link || '').toLowerCase();
        var match = !q || title.includes(q) || cat.includes(q) || by.includes(q)
                      || notes.includes(q) || desc.includes(q) || tags.includes(q)
                      || address.includes(q) || url.includes(q);

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
                // If the currently previewed card's pin is filtered out, dismiss the card
                if (dmapActivePreviewIdx === idx) dismissMapPreview();
            }
        }
    });

    // Update count label
    var countEl = document.getElementById('dmapPanelCount');
    if (countEl) countEl.textContent = (q ? count : dmapMarkers.length) + ' place' + ((q ? count : dmapMarkers.length) !== 1 ? 's' : '') + (q ? ' found' : ' nearby');
}

function showAISearchNudge() {
    var existing = document.getElementById('aiSearchNudge');
    if (existing) return;
    var banner = document.createElement('div');
    banner.id = 'aiSearchNudge';
    banner.className = 'ai-search-nudge';
    banner.innerHTML =
        '<div class="ai-search-nudge-inner">' +
            '<span class="ai-search-nudge-icon">✦</span>' +
            '<span class="ai-search-nudge-text">Can\'t find what you\'re looking for? Try our <strong>AI Search</strong> page</span>' +
            '<button class="ai-search-nudge-go" onclick="setMode(\'search\');dismissAISearchNudge();">Search →</button>' +
            '<button class="ai-search-nudge-close" onclick="dismissAISearchNudge()" aria-label="Dismiss">✕</button>' +
        '</div>';
    // Insert into the dmap-float-search area (mobile) or dmap-panel-search (desktop)
    var target = document.querySelector('.dmap-float-search') || document.querySelector('.dmap-panel-search');
    if (target && target.parentNode) {
        target.parentNode.insertBefore(banner, target.nextSibling);
    } else {
        var area = document.getElementById('discoverMap');
        if (area && area.parentNode) area.parentNode.insertBefore(banner, area);
    }
    // Animate in
    requestAnimationFrame(function() { banner.classList.add('ai-search-nudge-visible'); });
    // Auto-dismiss after 12 seconds
    setTimeout(function() { dismissAISearchNudge(); }, 12000);
}

function dismissAISearchNudge() {
    var banner = document.getElementById('aiSearchNudge');
    if (!banner) return;
    banner.classList.remove('ai-search-nudge-visible');
    setTimeout(function() { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 320);
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
            var catLabel = d.category || d.type || '';
            var avInit2 = (d.added_by_name || '?').charAt(0).toUpperCase();
            var avCol2 = strColour ? strColour(d.added_by_name || '?') : '#7B2D45';
            var saveCount2 = (endorsementsCache[d.id] || {}).count || d.saves_count || 0;
            var savesLabel2 = saveCount2 === 1 ? '1 in your circle saved this' : saveCount2 + ' in your circle saved this';
            var imgUrl2 = d.image_url || d.thumbnail_url || d.photo_url || '';
            var noteText2 = d.notes || d.description || d.note || '';
            var distHtml2 = distText
                ? '<span class="dmap-prev-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' + distText + '</span>'
                : '';
            var catHtml2 = catLabel
                ? '<span class="dmap-prev-badge"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + col + ';flex-shrink:0;"></span>' + escapeHtml(catLabel) + '</span>'
                : '';
            var imgHtml2 = imgUrl2
                ? '<img src="' + escapeHtml(imgUrl2) + '" alt="" style="width:100%;height:100%;object-fit:cover;">'
                : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;">' +
                    ({'Place':'📍','Food':'🍽','Café':'☕','Service':'🏥','Advice':'💡','Product':'📦'}[catLabel] || '📍') + '</div>';
            var card2 = document.createElement('div');
            card2.className = 'dmap-panel-card';
            card2.id = 'dpi-' + idx;
            card2.innerHTML =
                '<div class="dmap-panel-card-img">' + imgHtml2 + '</div>' +
                '<div class="dmap-panel-card-body">' +
                    '<div class="dmap-panel-card-title">' + escapeHtml(d.title) + '</div>' +
                    (noteText2 ? '<div class="dmap-panel-card-note">' + escapeHtml(noteText2) + '</div>' : '') +
                    '<div class="dmap-prev-badges" style="margin-top:5px;">' + catHtml2 + distHtml2 + '</div>' +
                    '<div class="dmap-panel-card-saves">' +
                        '<div class="dmap-prev-av" style="background:' + avCol2 + ';">' + avInit2 + '</div>' +
                        '<span>' + escapeHtml(savesLabel2) + '</span>' +
                    '</div>' +
                '</div>';
            (function(i){ card2.onclick = function(){ focusMapItem(i); }; })(idx);
            list.appendChild(card2);
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

    // Use filtered data only if the user has actively applied filters; otherwise show everything
    var hasActiveFilters = filters.categories.length > 0 || filters.users.length > 0 ||
                           filters.distances.length > 0 || filters.endorsed ||
                           (filters.searchText && filters.searchText.length > 0);
    var source = (hasActiveFilters && filteredDiscoveries && filteredDiscoveries.length > 0)
        ? filteredDiscoveries
        : allDiscoveries;
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
        var catInitial = (d.category || d.type || 'P').charAt(0).toUpperCase();
        var avInit     = (d.added_by_name || '?').charAt(0).toUpperCase();
        var avCol      = strColour(d.added_by_name || '?');
        var distText   = d.distance_km
            ? (d.distance_km < 1 ? Math.round(d.distance_km * 1000) + 'm' : d.distance_km.toFixed(1) + 'km')
            : '';

        var pinHtml = '<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:' + col + ';display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(42,30,20,0.28);border:2.5px solid rgba(250,246,238,0.92);"><span style="transform:rotate(45deg);font-size:10px;font-weight:700;color:white;font-family:Inter,sans-serif;line-height:1;">' + catInitial + '</span></div>';
        var icon = L.divIcon({ html: pinHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -34] });

        var saveCount  = (endorsementsCache[d.id] || {}).count || d.saves_count || 0;
        var savesLabel = saveCount === 1 ? '1 save' : saveCount + ' saves';
        var distChip   = distText
            ? '<span class="odin-pop-chip odin-pop-dist-chip">' + distText + '</span>'
            : '';
        var popHtml =
            '<div class="odin-pop">' +
                '<div class="odin-pop-name">' + escapeHtml(d.title) + '</div>' +
                '<div class="odin-pop-by">' +
                    '<div class="odin-pop-av" style="background:' + avCol + ';">' + avInit + '</div>' +
                    '<div class="odin-pop-by-text">by <strong>' + escapeHtml(d.added_by_name || '?') + '</strong></div>' +
                '</div>' +
                '<div class="odin-pop-saves">' +
                    '<span>' + escapeHtml(savesLabel) + '</span>' +
                    distChip +
                '</div>' +
                '<div class="odin-pop-tap-hint" onclick="openMapItemDrawer(' + idx + ')">Tap to view details &rsaquo;</div>' +
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

        // ── Build panel preview card inline (same loop = guaranteed index match) ──
        var list  = document.getElementById('dmapPanelList');
        if (list) {
            var pCatLabel = d.category || d.type || '';
            var pAvInit = (d.added_by_name || '?').charAt(0).toUpperCase();
            var pAvCol = strColour ? strColour(d.added_by_name || '?') : '#7B2D45';
            var pSaveCount = (endorsementsCache[d.id] || {}).count || d.saves_count || 0;
            var pSavesLabel = pSaveCount === 1 ? '1 in your circle saved this' : pSaveCount + ' in your circle saved this';
            var pImgUrl = d.image_url || d.thumbnail_url || d.photo_url || '';
            var pNote = d.notes || d.description || d.note || '';
            var pDistHtml = distText
                ? '<span class="dmap-prev-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' + distText + '</span>'
                : '';
            var pCatHtml = pCatLabel
                ? '<span class="dmap-prev-badge"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + col + ';flex-shrink:0;"></span>' + escapeHtml(pCatLabel) + '</span>'
                : '';
            var pImgHtml = pImgUrl
                ? '<img src="' + escapeHtml(pImgUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;">'
                : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;">' +
                    ({'Place':'📍','Food':'🍽','Café':'☕','Service':'🏥','Advice':'💡','Product':'📦'}[pCatLabel] || '📍') + '</div>';
            var pc = document.createElement('div');
            pc.className = 'dmap-panel-card';
            pc.id = 'dpi-' + idx;
            pc.innerHTML =
                '<div class="dmap-panel-card-img">' + pImgHtml + '</div>' +
                '<div class="dmap-panel-card-body">' +
                    '<div class="dmap-panel-card-title">' + escapeHtml(d.title) + '</div>' +
                    (pNote ? '<div class="dmap-panel-card-note">' + escapeHtml(pNote) + '</div>' : '') +
                    '<div class="dmap-prev-badges" style="margin-top:5px;">' + pCatHtml + pDistHtml + '</div>' +
                    '<div class="dmap-panel-card-saves">' +
                        '<div class="dmap-prev-av" style="background:' + pAvCol + ';">' + pAvInit + '</div>' +
                        '<span>' + escapeHtml(pSavesLabel) + '</span>' +
                    '</div>' +
                '</div>';
            (function(i){ pc.onclick = function(){ focusMapItem(i); }; })(idx);
            list.appendChild(pc);
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
                    ((endorsementsCache[d.id] || {}).count || d.saves_count || 0) + ' save' + (((endorsementsCache[d.id] || {}).count || d.saves_count || 0) !== 1 ? 's' : '') +
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
    const trustLevel        = item._trust_level || TRUST.FRIENDS;
    const isSaveInheritance = trustLevel === TRUST.EXTENDED && item._via_friend_name;
    const isExtendedCircle  = trustLevel === TRUST.EXTENDED;
    const isOwner           = currentUser && (item.added_by === currentUser.id);
    const isDirectFriend    = !isOwner && !isExtendedCircle && isFriend(item.added_by);
    let html = '';

    // === HERO PHOTO ===
    if (item.photo_url) {
        html += `<div class="drawer-hero" onclick="event.stopPropagation(); openLightbox('${escapeHtml(item.photo_url)}');">
            <img src="${escapeHtml(item.photo_url)}">
            <div class="drawer-hero-fade"></div>
        </div>`;
    }

    html += `<div class="drawer-body">`;

    // === TITLE + address + distance + edit ===
    const distText = item.distance_km
        ? (item.distance_km < 1 ? Math.round(item.distance_km * 1000) + 'm' : item.distance_km.toFixed(1) + 'km')
        : '';
    // v4: drawer heading uses feed_card_summary (canonical display name).
    // title fallback for legacy rows that haven't been re-captured yet.
    const drawerDisplayName = item.feed_card_summary || item.title || 'Untitled';
    html += `<div class="drawer-title-row"><h1 class="drawer-title">${escapeHtml(drawerDisplayName)}</h1>`;
    if (isOwner) {
        html += `<button class="drawer-edit-btn" onclick="enterEditMode()" title="Edit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7B2D45" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
    }
    html += `</div>`;

    // Sub-line: address only (distance lives in the chips row)
    let subParts = [];
    if (item.address) subParts.push(`<span class="drawer-meta-address">${escapeHtml(item.address)}</span>`);
    if (subParts.length) {
        html += `<div class="drawer-meta-line">${subParts.join('<span class="drawer-meta-dot"> · </span>')}</div>`;
    }

    // ── Drawer chips: category + private ──
    const drawerCatLabel = item.category
        ? item.category.charAt(0).toUpperCase() + item.category.slice(1)
        : (item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : '');
    const drawerCatChip     = drawerCatLabel ? `<span class="hf-card-cat">${drawerCatLabel}</span>` : '';
    const drawerPrivateChip = (item.visibility === TRUST.PRIVATE && isOwner)
        ? `<span class="hf-card-private">Private</span>` : '';
    const drawerDistChip    = distText ? `<span class="hf-card-dist">${distText}</span>` : '';
    if (drawerCatChip || drawerPrivateChip || drawerDistChip) {
        html += `<div class="hf-card-chips-row drawer-chips">${drawerCatChip}${drawerDistChip}${drawerPrivateChip}</div>`;
    }

    // Circle trust signal — shown below address for non-owner items
    if (isSaveInheritance) {
        html += `<div class="drawer-circle-signal"><span class="rc-via-dot">&#9679;</span> Via ${escapeHtml(item._via_friend_name)}</div>`;
    } else if (isExtendedCircle) {
        html += `<div class="drawer-circle-signal"><span class="rc-circle-dot">&#9679;</span> Someone in your circle</div>`;
    }
    // isDirectFriend: attribution shown in footer — removed duplicate here

    // === Extract personal note ===
    let note = null;
    if (!isExtendedCircle) {
        if (item.PersonalNote) note = item.PersonalNote;
        else if (item.personal_note) note = item.personal_note;
        else if (item.metadata) {
            try {
                const meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
                note = meta.personal_note;
            } catch (e) {}
        }
    }

    // === THE WORD / What's this about ===
    // THE WORD  = own save or direct friend with personal note (warm styled, italic, quoted)
    // What's this about = no personal note — shows feed_card_summary or description (plain, neutral)
    // Helper: build translate button label
    const _translateBtnLabel = userPreferredLanguage && userPreferredLanguage !== 'en'
        ? 'Translate to ' + (LANG_LABELS[userPreferredLanguage] || userPreferredLanguage) + ' ' + TRANSLATE_ICON
        : 'Translate ' + TRANSLATE_ICON;

    if (isOwner && note) {
        // Scenario 1: own save with note
        html += `<div class="drawer-quote">
            <div class="drawer-quote-label">THE WORD</div>
            <div class="drawer-quote-text drawer-story-text">${escapeHtml(note)}</div>
        </div>`;
        html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">${_translateBtnLabel}</button>`;

    } else if (isDirectFriend && note) {
        // Scenario 2: direct friend with personal note
        html += `<div class="drawer-quote">
            <div class="drawer-quote-label">THE WORD</div>
            <div class="drawer-quote-text drawer-story-text">${escapeHtml(note)}</div>
        </div>`;
        html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">${_translateBtnLabel}</button>`;

    } else if (isDirectFriend && !note) {
        // Scenario 3: direct friend, no personal note — show summary in neutral style
        const summary = item.feed_card_summary || item.description || '';
        if (summary) {
            html += `<div class="drawer-summary-block">
                <div class="drawer-summary-label">What&rsquo;s this about</div>
                <div class="drawer-summary-text drawer-story-text">${escapeHtml(summary)}</div>
            </div>`;
        }
        html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">${_translateBtnLabel}</button>`;

    } else if (isSaveInheritance || isExtendedCircle) {
        // Scenario 4: Save Inheritance — show feed_card_summary only, no personal note
        const summary = item.feed_card_summary || item.description || '';
        if (summary) {
            html += `<div class="drawer-summary-block">
                <div class="drawer-summary-label">What&rsquo;s this about</div>
                <div class="drawer-summary-text drawer-story-text">${escapeHtml(summary)}</div>
            </div>`;
        }
        html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">${_translateBtnLabel}</button>`;

    } else if (isOwner && !note && item.description) {
        // Own save, no note — show description as fallback in neutral style
        html += `<div class="drawer-summary-block">
            <div class="drawer-summary-label">What&rsquo;s this about</div>
            <div class="drawer-summary-text drawer-story-text">${escapeHtml(item.description)}</div>
        </div>`;
        html += `<button class="drawer-translate-btn" data-state="original" onclick="event.stopPropagation(); toggleDrawerLang(this)">${_translateBtnLabel}</button>`;
    }

    // === QUICK ACTIONS (Directions + Website buttons) ===
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
        html += '<div class="drawer-quick-actions"><div class="drawer-action-btns">';
        if (isPlace) {
            if (item.address) {
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
                html += `<button class="drawer-btn-primary" onclick="window.open('${mapsUrl}', '_blank')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg> Directions</button>`;
            }
            if (url) html += `<button class="drawer-btn-secondary" onclick="window.open('${escapeHtml(url)}', '_blank')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Website</button>`;
        } else {
            if (url) html += `<button class="drawer-btn-primary" onclick="window.open('${escapeHtml(url)}', '_blank')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Website</button>`;
            if (item.address) {
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`;
                html += `<button class="drawer-btn-secondary" onclick="window.open('${mapsUrl}', '_blank')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg> Directions</button>`;
            }
        }
        html += '</div></div>';
    }

    // === FOOTER: saved-by attribution + Ask CTA + Save button ===
    if (item.id) {
        const friendName    = item.added_by_name ? escapeHtml(item.added_by_name) : 'Friend';
        const viaName       = item._via_friend_name ? escapeHtml(item._via_friend_name) : null;
        const friendInitial = item.added_by_name ? item.added_by_name.charAt(0).toUpperCase() : '?';
        const viaInitial    = item._via_friend_name ? item._via_friend_name.charAt(0).toUpperCase() : '?';

        // Build avatar circle helper
        const makeAvatar = (initial, name) => {
            const col = typeof strColour === 'function' ? strColour(name || initial) : '#7B2D45';
            return `<span class="drawer-saver-avatar" style="background:${col};">${initial}</span>`;
        };

        // Build mini stacked avatar for saves-by row
        const makeMiniAv = (initial, name) => {
            const col = typeof strColour === 'function' ? strColour(name || initial) : '#7B2D45';
            return `<span class="drawer-save-av" style="background:${col};">${initial}</span>`;
        };

        // Saves-by row — built from endorsementsCache once loaded; placeholder until then
        const savesCount = item.saves_count || item.endorsements || 0;
        const savesByHtml = ''; // populated async after endorsements load (see below)

        // Save button — rendered inline, patched async once endorsement state loads
        const _cached0 = endorsementsCache[item.id] || { userEndorsed: false };
        const _bActive = _cached0.userEndorsed ? ' active' : '';
        const _bFill   = _cached0.userEndorsed ? '#7B2D45' : 'none';
        const saveBtnHtml = `<button class="drawer-bookmark-btn${_bActive}" id="drawerSaveBtn" data-endorse-id="${item.id}" onclick="toggleEndorsement('${item.id}', event)">
            <svg class="bookmark-icon-lg" width="16" height="16" viewBox="0 0 24 24" fill="${_bFill}" stroke="#7B2D45" stroke-width="2.2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span class="drawer-bookmark-label">${_cached0.userEndorsed ? 'Saved' : 'Save'}</span>
        </button>`;

        let footerHtml = '';
        if (isOwner) {
            const myName = currentProfile?.display_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'You';
            const myInit = myName !== 'You' ? myName.charAt(0).toUpperCase() : (currentUser?.email ? currentUser.email.charAt(0).toUpperCase() : 'Y');
            const myCol  = typeof strColour === 'function' ? strColour(myName) : '#7B2D45';
            footerHtml = `<div class="drawer-attribution">
                <div class="drawer-attr-row">
                    <div class="drawer-attr-avatar" style="background:${myCol};">${myInit}</div>
                    <div class="drawer-attr-info">
                        <div class="drawer-attr-name">You added this</div>
                        <div class="drawer-attr-sub">Added this to Odin</div>
                    </div>
                    ${saveBtnHtml}
                </div>
                <div class="drawer-attr-saves" id="drawerAttrSaves" style="display:none;"></div>
            </div>`;
        } else if (isSaveInheritance && viaName) {
            const viaCol = typeof strColour === 'function' ? strColour(viaName) : '#7B2D45';
            const savesLabel = savesCount > 1 ? `Saved by ${savesCount} people in your circle` : 'Saved in your circle';
            footerHtml = `<div class="drawer-attribution">
                <div class="drawer-attr-row">
                    <div class="drawer-attr-avatar" style="background:${viaCol};">${viaInitial}</div>
                    <div class="drawer-attr-info">
                        <div class="drawer-attr-name">Via ${viaName}</div>
                        <div class="drawer-attr-sub">${savesLabel}</div>
                    </div>
                    ${saveBtnHtml}
                </div>
            </div>`;
        } else if (isDirectFriend) {
            const friendCol = typeof strColour === 'function' ? strColour(friendName) : '#7B2D45';
            footerHtml = `<div class="drawer-attribution">
                <div class="drawer-attr-row">
                    <div class="drawer-attr-avatar" style="background:${friendCol};">${friendInitial}</div>
                    <div class="drawer-attr-info">
                        <div class="drawer-attr-name">${friendName}</div>
                        <div class="drawer-attr-sub">Added this to Odin</div>
                    </div>
                    ${saveBtnHtml}
                </div>
                <div class="drawer-attr-saves" id="drawerAttrSaves" style="display:none;"></div>
            </div>`;
        }

        // "Ask [Name] about this" — only for Scenario 3 (direct friend, no personal note)
        let askCtaHtml = '';
        if (isDirectFriend && !note && item.added_by_name) {
            const encodedName = encodeURIComponent(item.added_by_name);
            askCtaHtml = `<button class="drawer-ask-btn" onclick="event.stopPropagation(); openAskFriendChat('${encodedName}', '${escapeHtml(item.title)}')">Ask ${friendName} about this</button>`;
        }

        currentDrawerItemId = item.id;
        html += `<div class="drawer-social">
            ${footerHtml}
            ${askCtaHtml}
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

    // Re-fetch endorsement state for this item to ensure save button is accurate
    // (the cache may be stale if the user saved on a previous visit)
    if (item.id && currentUser) {
        loadEndorsementsForItems([item]).then(() => {
            // Only update if this drawer is still open for the same item
            if (currentDrawerItem && currentDrawerItem.id === item.id) {
                updateEndorsementUI(item.id);
                // Patch inline save button state
                const saveBtn = document.getElementById('drawerSaveBtn');
                if (saveBtn) {
                    const c = endorsementsCache[item.id] || { userEndorsed: false };
                    saveBtn.className = 'drawer-bookmark-btn' + (c.userEndorsed ? ' active' : '');
                    const svg = saveBtn.querySelector('svg');
                    if (svg) svg.setAttribute('fill', c.userEndorsed ? '#7B2D45' : 'none');
                    const lbl = saveBtn.querySelector('.drawer-bookmark-label');
                    if (lbl) lbl.textContent = c.userEndorsed ? 'Saved' : 'Save';
                }
                // Patch saves-by row in attribution block now that we have real names
                const savesSlot = document.getElementById('drawerAttrSaves');
                if (savesSlot && (isOwner || isDirectFriend)) {
                    const cached = endorsementsCache[item.id] || { names: [], ids: [] };
                    const friendIds = new Set(friendsCache.map(f => f.out_user_id));
                    if (currentUser) friendIds.add(currentUser.id);
                    // Exclude the item adder from "also saved by"
                    const adderName = isOwner
                        ? (currentProfile?.display_name || currentUser?.user_metadata?.full_name || '')
                        : (item.added_by_name || '');
                    const otherSavers = [];
                    (cached.ids || []).forEach((id, i) => {
                        if (friendIds.has(id) && cached.names[i] && cached.names[i] !== adderName) {
                            otherSavers.push(cached.names[i]);
                        }
                    });
                    if (otherSavers.length > 0) {
                        const avatarsHtml = otherSavers.slice(0, 3).map(n => {
                            const col = typeof strColour === 'function' ? strColour(n) : '#5A8A6A';
                            return `<span class="drawer-save-av" style="background:${col};">${n.charAt(0).toUpperCase()}</span>`;
                        }).join('');
                        const label = otherSavers.length === 1
                            ? `Also saved by <strong>${escapeHtml(otherSavers[0])}</strong> in your circle`
                            : `Also saved by <strong>${escapeHtml(otherSavers[0])}</strong> &amp; ${otherSavers.length - 1} other${otherSavers.length > 2 ? 's' : ''} in your circle`;
                        savesSlot.innerHTML = `<div class="drawer-save-avatars">${avatarsHtml}</div><span style="margin-left:4px;">${label}</span>`;
                        savesSlot.style.display = 'flex';
                    }
                }
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
function previewEditPhoto(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('editPhotoPreview');
        if (preview.tagName === 'IMG') {
            preview.src = e.target.result;
        } else {
            // Replace placeholder div with img
            const img = document.createElement('img');
            img.src = e.target.result;
            img.id = 'editPhotoPreview';
            preview.parentNode.replaceChild(img, preview);
        }
    };
    reader.readAsDataURL(file);
}

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

    // Photo section with change option
    html += `<div class="drawer-hero edit-photo-wrap" id="editPhotoWrap">`;
    if (item.photo_url) {
        html += `<img src="${escapeHtml(item.photo_url)}" id="editPhotoPreview">`;
    } else {
        html += `<div class="edit-photo-placeholder" id="editPhotoPreview">📷</div>`;
    }
    html += `<label class="edit-photo-btn" for="editPhotoInput">Change Photo</label>
        <input type="file" id="editPhotoInput" accept="image/*" style="display:none" onchange="previewEditPhoto(this)">
        <input type="hidden" id="editPhotoFile">
    </div>`;

    html += `<div class="drawer-body"><div class="edit-form" id="drawerEditForm">
        <label class="edit-label">Title</label>
        <input class="edit-input" id="editTitle" value="${escapeHtml(item.title)}" maxlength="200">

        <label class="edit-label">Personal Note</label>
        <textarea class="edit-textarea" id="editNote" rows="2" maxlength="500">${escapeHtml(note)}</textarea>

        <label class="edit-label">Category</label>
        <select class="edit-select" id="editCategory">${categoryOptions}</select>

        <label class="edit-label">Address</label>
        <input class="edit-input" id="editAddress" value="${escapeHtml(item.address || '')}">

        <label class="edit-label">URL</label>
        <input class="edit-input" id="editUrl" value="${escapeHtml(url)}">

        <div class="form-group visibility-group" style="margin-top: 8px;">
            <label class="field-label-inline">Who can see this</label>
            <div class="vis-selector" id="editVisSelector">
                <button type="button" class="vis-option${item.visibility === 'private' ? ' active' : ''}" data-value="private" onclick="selectEditVisibility(this)">
                    <span class="vis-label">Only me</span>
                </button>
                <button type="button" class="vis-option${item.visibility !== 'private' ? ' active' : ''}" data-value="friends" onclick="selectEditVisibility(this)">
                    <span class="vis-label">Friends</span>
                </button>
            </div>
            <p class="vis-hint" id="editVisHint">${item.visibility === 'private' ? 'Saved privately — only you can see this.' : 'Your connections can see this.'}</p>
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
    const newNote = document.getElementById('editNote').value.trim();
    const newCategory = document.getElementById('editCategory').value;
    const newAddress = document.getElementById('editAddress').value.trim();
    const newUrl = document.getElementById('editUrl').value.trim();
    const newVisibility = document.getElementById('editPrivateToggle').value === 'true' ? 'only_me' : 'friends';

    if (!newTitle) {
        document.getElementById('editMessage').innerHTML = '<div class="error-msg">Title is required</div>';
        btn.disabled = false;
        btn.textContent = 'Save Changes';
        return;
    }

    // Check if title changed significantly (for re-embedding)
    const oldText = item.title.toLowerCase().trim();
    const newText = newTitle.toLowerCase().trim();
    const needsReEmbed = oldText !== newText;

    // Handle photo upload if a new file was selected
    let newPhotoUrl = item.photo_url || null;
    const photoInput = document.getElementById('editPhotoInput');
    if (photoInput && photoInput.files && photoInput.files[0]) {
        try {
            btn.textContent = 'Uploading photo...';
            const file = photoInput.files[0];
            const ext = file.name.split('.').pop();
            const filePath = `${currentUser.id}/${itemId}_${Date.now()}.${ext}`;
            const { data: uploadData, error: uploadError } = await supabaseClient
                .storage.from('recommendation-photos')
                .upload(filePath, file, { upsert: true });
            if (uploadError) throw new Error('Photo upload failed: ' + uploadError.message);
            const { data: urlData } = supabaseClient
                .storage.from('recommendation-photos')
                .getPublicUrl(filePath);
            newPhotoUrl = urlData.publicUrl;
        } catch (photoErr) {
            document.getElementById('editMessage').innerHTML = `<div class="error-msg">${photoErr.message}</div>`;
            btn.disabled = false;
            btn.textContent = 'Save Changes';
            return;
        }
    }

    try {
        // Update in Supabase
        const updateData = {
            title: newTitle,
            photo_url: newPhotoUrl,
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
                    personalNote: newNote || null,
                    type: newCategory,
                    UserID: currentUser.id
                })
            }).catch(err => console.warn('Re-embed request failed (non-critical):', err));
        }

        showToast('Discovery updated!');
        // Refresh the feed so visibility changes (e.g. Friends → Private) apply cleanly
        await loadDiscoveries();
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

        // Clean up from "Continue Exploring" (recently viewed)
        removeRecentlyViewed(itemId);

        // Clean up from home saves list (DOM)
        const homeSaveRow = document.querySelector('#homeSavesList .hsl-row[onclick*="' + itemId + '"]');
        if (homeSaveRow) {
            homeSaveRow.remove();
            const list = document.getElementById('homeSavesList');
            if (list && !list.querySelector('.hsl-row')) {
                const section = document.getElementById('homeSavesSection');
                if (section) section.style.display = 'none';
            }
        }

        // Clean up from profile My Saves (DOM)
        const profileSaveCard = document.querySelector('#myEndorsementsList .my-endorse-card[onclick*="' + itemId + '"]');
        if (profileSaveCard) profileSaveCard.remove();

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

async function sendMessage(text) {
    const input = document.getElementById('messageInput');
    const query = text || input.value.trim();
    if (!query) return;

    // Reset translation cache for new search
    translationCache = {};

    // Wait up to 2s for location on first search. If it resolves, great.
    // If not (denied/slow), request proceeds with null — n8n's anchorless
    // cluster filter handles the "no coords" case.
    if (!userLocation.available) {
        try {
            await Promise.race([
                requestLocation(),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        } catch (e) { /* non-fatal */ }
    }

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

    // Generate a fresh search_event_id for this search. n8n uses this as
    // the PK on search_events, and the frontend uses it to attach feedback.
    currentSearchEventId = uuidv4();
    currentResultPositions = [];

    const body = {
        query,
        session_id: currentSessionId,
        conversation_history: sessionMessages,
        user_id: currentUser ? currentUser.id : null,
        // Client-supplied search event id — server writes it as the row PK.
        search_event_id: currentSearchEventId,
        // Visibility filter context sent to n8n so the semantic search
        // only runs against the corpus this user is allowed to see.
        allowed_user_ids: allowedUserIds,   // search ONLY these users' items
        friend_ids: directFriendIds,        // subset: direct friends (for note visibility)
        // Always send coordinates — null is handled gracefully by n8n.
        // Silent geolocation on app load means these are usually populated
        // before the first search. Proximity ranking depends on these being present.
        user_latitude:  userLocation.latitude  ?? null,
        user_longitude: userLocation.longitude ?? null,
    };

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
        // Search v4 response shape: { top_picks: [], more_options: [], results: [] (legacy alias) }
        // Always prefer the structured arrays. Fall back to data.results for old responses.
        const v4TopPicks = Array.isArray(data.top_picks) ? data.top_picks : [];
        const v4MoreOptions = Array.isArray(data.more_options) ? data.more_options : [];
        const v4Combined = (v4TopPicks.length || v4MoreOptions.length)
            ? [...v4TopPicks, ...v4MoreOptions]
            : (Array.isArray(data.results) ? data.results : []);

        if (v4Combined.length > 0) {
            currentResults = v4Combined;
            // Tag each item with which group it came from, so the renderer can place it.
            const topPickIds = new Set(v4TopPicks.map(r => r.id));
            currentResults.forEach(r => { r._isTopPick = topPickIds.has(r.id); });
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

            // Search v4: trust whatever the backend returns. No threshold, no drop check.
            // Backend already groups items into top_picks + more_options.
            const hasRelevantResults = currentResults.length > 0;

            // Record the display order of result ids for feedback logging.
            // Thumbs / click handlers look up the item by index into this array.
            currentResultPositions = currentResults.map(r => r.id || null);

            // Load endorsements for search results
            await loadEndorsementsForItems(currentResults);

            const getPersonalNote = getPersonalNoteGlobal;

            const formatDistance = (km) => {
                if (!km) return '';
                return km < 1 ? Math.round(km * 1000) + 'm' : km.toFixed(1) + 'km';
            };

            // Helper: circle save count from endorsementsCache
            const getCircleSaveCount = (r) => {
                const enc = endorsementsCache[r.id] || { count: 0, ids: [] };
                const friendIdSet = new Set(friendsCache.map(f => f.out_user_id));
                if (currentUser) friendIdSet.add(currentUser.id);
                const n = Math.max((enc.ids || []).filter(id => friendIdSet.has(id)).length, 1);
                return n === 1 ? '1 save' : `${n} saves`;
            };

            const buildTopPick = (r, idx) => {
                const isExt    = r._trust_level === TRUST.EXTENDED;
                const photo    = r.photo_url ? `<img src="${escapeHtml(r.photo_url)}" onerror="this.outerHTML='<span style=\\'font-size:32px;color:#d1d5db\\'>📍</span>'">` : '<span style="font-size:32px;color:#d1d5db">📍</span>';
                const rawNote  = isExt ? null : getPersonalNote(r);
                const canSeeNote = rawNote && isFriend(r.added_by || r.added_by_name);
                const distText = formatDistance(r.distance_km);
                const snippet      = isExt
                    ? (r.description || r.relevance_reason || '')
                    : (canSeeNote ? rawNote : (r.relevance_reason || r.description || ''));
                const snippetLabel = isExt
                    ? 'Why this matches'
                    : (canSeeNote ? 'Friend says' : 'Why this matches');
                const byLine = isExt
                    ? '<span class="meta-tag meta-added-by extended-circle-badge">🔵 Extended circle</span>'
                    : (r.added_by_name ? `<span class="meta-tag meta-added-by">by ${escapeHtml(r.added_by_name)}</span>` : '');
                const saveLabel = getCircleSaveCount(r);

                // v4: prefer feed_card_summary as display name, title is fallback for old rows
                const displayName = r.feed_card_summary || r.title || 'Untitled';
                return `
                    <div class="top-pick-card" onclick="showSearchDrawer(${idx})">
                        <span class="top-pick-badge">Top Pick</span>
                        <div class="top-pick-photo">${photo}</div>
                        <div class="top-pick-content">
                            <div class="top-pick-title">${escapeHtml(displayName)}</div>
                            <div class="top-pick-meta">${byLine}</div>
                            ${snippet ? `
                                <div class="top-pick-reason">
                                    <div class="top-pick-reason-label">${snippetLabel}</div>
                                    <span class="top-pick-reason-text" data-original="${escapeHtml(snippet).substring(0, 100)}${snippet.length > 100 ? '...' : ''}">${escapeHtml(snippet).substring(0, 100)}${snippet.length > 100 ? '...' : ''}</span>
                                </div>
                            ` : ''}
                            <div class="top-pick-footer">
                                <span class="result-save-count">${saveLabel}</span>
                                ${distText ? `<span class="result-save-count" style="color:#7a6550;">${distText}</span>` : ''}
                                <button class="card-translate-btn" data-idx="${idx}" data-state="original" onclick="event.stopPropagation(); toggleCardTranslate(this, ${idx})">${'Translate ' + TRANSLATE_ICON}</button>
                            </div>
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
                const saveLabel = getCircleSaveCount(r);

                // ── Category chip (same style as Discover card) ──
                const catLabel = r.category
                    ? r.category.charAt(0).toUpperCase() + r.category.slice(1)
                    : (r.type ? r.type.charAt(0).toUpperCase() + r.type.slice(1) : '');
                const catChip = catLabel ? `<span class="hf-card-cat">${catLabel}</span>` : '';
                const distChip = distText ? `<span class="hf-card-dist">${distText}</span>` : '';
                const privateChip = (r.visibility === 'private' && currentUser && r.added_by === currentUser.id)
                    ? `<span class="hf-card-private">Private</span>` : '';

                // ── Adder avatar + name row (same style as Discover card) ──
                let adderRow = '';
                if (isExt) {
                    adderRow = `<div class="cc-adder-row"><span class="cc-adder-name">🔵 Extended circle</span></div>`;
                } else if (r.added_by_name) {
                    const initial = r.added_by_name.charAt(0).toUpperCase();
                    const avatarCol = typeof strColour === 'function' ? strColour(r.added_by_name) : '#7B2D45';
                    adderRow = `<div class="cc-adder-row">
                        <div class="cc-adder-avatar" style="background:${avatarCol};">${initial}</div>
                        <span class="cc-adder-name">Added by ${escapeHtml(r.added_by_name)}</span>
                    </div>`;
                }

                // v4: prefer feed_card_summary as display name, title is fallback for old rows
                const displayName = r.feed_card_summary || r.title || 'Untitled';
                return `
                    <div class="compact-card" onclick="showSearchDrawer(${idx})">
                        <div class="compact-photo">${photo}</div>
                        <div class="compact-title">${escapeHtml(displayName)}</div>
                        ${snippet ? `<div class="compact-snippet">${escapeHtml(snippet).substring(0, 55)}${snippet.length > 55 ? '…' : ''}</div>` : ''}
                        <div class="hf-card-chips-row cc-chips-row">${catChip}${distChip}${privateChip}</div>
                        ${adderRow}
                        <div class="cc-saves-row">
                            <span class="hf-card-save-count">${saveLabel}</span>
                            <button class="card-translate-btn compact-translate-btn" data-idx="${idx}" data-state="original" onclick="event.stopPropagation(); toggleCardTranslate(this, ${idx})">${'Translate ' + TRANSLATE_ICON}</button>
                        </div>
                    </div>
                `;
            };

            if (hasRelevantResults) {
                // ── Good matches found — show normal results ──
                // v4: if backend grouped into top_picks + more_options, respect that.
                // Else fall back to the old "first 2 = top picks" heuristic.
                const v4Grouped = currentResults.some(r => r._isTopPick);
                const topPickItems = v4Grouped
                    ? currentResults.filter(r => r._isTopPick)
                    : currentResults.slice(0, currentResults.length === 1 ? 1 : 2);
                const moreResults = v4Grouped
                    ? currentResults.filter(r => !r._isTopPick)
                    : currentResults.slice(topPickItems.length);

                const headerText = data.text && data.text.length
                    ? data.text
                    : `Found ${currentResults.length} ${currentResults.length === 1 ? 'discovery' : 'discoveries'}:`;
                let html = `<div class="message message-assistant"><div class="message-content">${escapeHtml(headerText)}</div><div class="results-section">`;

                html += `
                    <div class="top-picks-section">
                        <div class="results-header">
                            <span class="results-header-title">Top Picks For You</span>
                        </div>
                `;

                for (let i = 0; i < topPickItems.length; i++) {
                    html += buildTopPick(topPickItems[i], i);
                }
                html += '</div>';

                const topPickCount = topPickItems.length;
                if (moreResults.length > 0) {
                    const scrollId = 'moreScroll_' + Date.now();
                    html += `
                        <div class="more-options-section">
                            <div class="results-header">
                                <span class="results-header-title">More Great Options</span>
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

                // ── Map — only when ≥2 results have valid coordinates ──
                const locatedResults = currentResults.filter(r => {
                    const lat = parseFloat(r.latitude), lng = parseFloat(r.longitude);
                    return !isNaN(lat) && !isNaN(lng) && (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01);
                });
                const mapId = 'searchMap_' + Date.now();
                if (locatedResults.length >= 2) {
                    html += `<div class="search-map-container"><div id="${mapId}" style="width:100%;height:100%;"></div></div>`;
                }

                html += '</div>';
                // Single search-level feedback bar. One tap per search.
                html += `
                    <div class="search-helpful-bar" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-top:10px;border-top:1px solid #efe7d8;font-size:13px;color:#6b5a45;">
                        <span>Was this helpful?</span>
                        <button type="button" onclick="onSearchHelpful(this, true)" style="background:#fff;border:1px solid #d9cdb5;border-radius:14px;padding:4px 12px;cursor:pointer;font-size:13px;color:#3d2f1c;">Yes</button>
                        <button type="button" onclick="onSearchHelpful(this, false)" style="background:#fff;border:1px solid #d9cdb5;border-radius:14px;padding:4px 12px;cursor:pointer;font-size:13px;color:#3d2f1c;">No</button>
                    </div>`;
                html += '</div>';
                container.innerHTML += html;
                container.scrollTop = container.scrollHeight;
                var moreScroll = container.querySelector('.more-options-scroll');
                if (moreScroll && moreScroll.id) {
                    setTimeout(function() { updateScrollArrows(moreScroll.id); }, 150);
                    moreScroll.addEventListener('scroll', function() { updateScrollArrows(moreScroll.id); });
                }

                if (locatedResults.length >= 2) {
                    setTimeout(function() { initSearchMap(mapId, currentResults); }, 100);
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
                        const previewName = item.feed_card_summary || item.title || 'Untitled';
                        return `
                            <div class="compact-card" onclick="openItemDrawer(window._searchPreviewItems[${idx}])">
                                <div class="compact-photo">${photo}</div>
                                <div class="compact-title">${escapeHtml(previewName)}</div>
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
                        <div class="search-helpful-bar" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-top:10px;border-top:1px solid #efe7d8;font-size:13px;color:#6b5a45;">
                            <span>Was this helpful?</span>
                            <button type="button" onclick="onSearchHelpful(this, true)" style="background:#fff;border:1px solid #d9cdb5;border-radius:14px;padding:4px 12px;cursor:pointer;font-size:13px;color:#3d2f1c;">Yes</button>
                            <button type="button" onclick="onSearchHelpful(this, false)" style="background:#fff;border:1px solid #d9cdb5;border-radius:14px;padding:4px 12px;cursor:pointer;font-size:13px;color:#3d2f1c;">No</button>
                        </div>
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
                    <div class="search-helpful-bar" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-top:10px;border-top:1px solid #efe7d8;font-size:13px;color:#6b5a45;">
                        <span>Was this helpful?</span>
                        <button type="button" onclick="onSearchHelpful(this, true)" style="background:#fff;border:1px solid #d9cdb5;border-radius:14px;padding:4px 12px;cursor:pointer;font-size:13px;color:#3d2f1c;">Yes</button>
                        <button type="button" onclick="onSearchHelpful(this, false)" style="background:#fff;border:1px solid #d9cdb5;border-radius:14px;padding:4px 12px;cursor:pointer;font-size:13px;color:#3d2f1c;">No</button>
                    </div>
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
    var mapEl = document.getElementById(mapId);
    if (!mapEl) return;

    // Destroy any previous instance
    if (searchMap) { try { searchMap.remove(); } catch(e) {} searchMap = null; }
    if (mapEl._leaflet_id !== undefined) { mapEl._leaflet_id = undefined; mapEl.innerHTML = ''; }

    // Pre-filter results with valid coordinates (skip null-island)
    var located = results.reduce(function(acc, r, originalIdx) {
        var lat = parseFloat(r.latitude);
        var lng = parseFloat(r.longitude);
        if (!isNaN(lat) && !isNaN(lng) && (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01)) {
            acc.push({ r: r, lat: lat, lng: lng, originalIdx: originalIdx });
        }
        return acc;
    }, []);
    if (located.length < 2) return;

    try {
        searchMap = L.map(mapId, { zoomControl: false });
    } catch(e) { return; }

    // Same CartoDB Positron tiles as Discover map
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(searchMap);

    // User location dot — same style as Discover
    if (userLocation.available) {
        L.circleMarker([userLocation.latitude, userLocation.longitude], {
            radius: 8, color: 'white', weight: 3, fillColor: '#2979FF', fillOpacity: 1
        }).addTo(searchMap).bindTooltip('You are here', { direction: 'top' });
    }

    var bounds = [];
    located.forEach(function(entry, listIdx) {
        var r   = entry.r;
        var lat = entry.lat;
        var lng = entry.lng;
        var oi  = entry.originalIdx;
        bounds.push([lat, lng]);

        var col    = typeof catColour === 'function' ? catColour(r.category || r.type) : '#7B2D45';
        var avInit = (r.added_by_name || '?').charAt(0).toUpperCase();
        var avCol  = typeof strColour === 'function' ? strColour(r.added_by_name || '?') : '#7B2D45';
        var num    = listIdx + 1;

        // Numbered teardrop pin — same shape as Discover, number instead of category initial
        var pinHtml = '<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:' + col + ';display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(42,30,20,0.28);border:2.5px solid rgba(250,246,238,0.92);"><span style="transform:rotate(45deg);font-size:11px;font-weight:700;color:white;font-family:Inter,sans-serif;line-height:1;">' + num + '</span></div>';
        var icon = L.divIcon({ html: pinHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -34] });

        // Popup — title → added by → saves → distance
        var distText = r.distance_km
            ? (r.distance_km < 1 ? Math.round(r.distance_km * 1000) + 'm' : r.distance_km.toFixed(1) + 'km')
            : '';
        var encR     = (typeof endorsementsCache !== 'undefined' && endorsementsCache[r.id]) ? endorsementsCache[r.id] : { count: 0, ids: [] };
        var fSet     = new Set((typeof friendsCache !== 'undefined' ? friendsCache : []).map(function(f){ return f.out_user_id; }));
        if (typeof currentUser !== 'undefined' && currentUser) fSet.add(currentUser.id);
        var saveN    = Math.max(((encR.ids || []).filter(function(id){ return fSet.has(id); }).length), 1);
        var savesText = saveN === 1 ? '1 save' : saveN + ' saves';
        var distChipS = distText
            ? '<span class="odin-pop-dist-chip">' + distText + '</span>'
            : '';
        var popHtml =
            '<div class="odin-pop" style="cursor:pointer;" onclick="showSearchDrawer(' + oi + ')">' +
                '<div class="odin-pop-name">' + escapeHtml(r.title) + '</div>' +
                '<div class="odin-pop-by">' +
                    '<div class="odin-pop-av" style="background:' + avCol + ';">' + avInit + '</div>' +
                    '<div class="odin-pop-by-text">by <strong>' + escapeHtml(r.added_by_name || '?') + '</strong></div>' +
                '</div>' +
                '<div class="odin-pop-saves"><span>' + escapeHtml(savesText) + '</span>' + distChipS + '</div>' +
                '<div class="odin-pop-tap-hint">Tap to view details &rsaquo;</div>' +
            '</div>';

        var marker = L.marker([lat, lng], { icon: icon })
            .addTo(searchMap)
            .bindPopup(popHtml, { maxWidth: 240, autoPan: false });

        marker.on('mouseover', function() { this.openPopup(); });
        marker.on('click', function() { this.openPopup(); });
    });

    if (bounds.length > 0) searchMap.fitBounds(bounds, { padding: [36, 36] });

    // Fix size after render (same pattern as Discover)
    setTimeout(function() { if (searchMap) searchMap.invalidateSize(); }, 200);
    setTimeout(function() { if (searchMap) searchMap.invalidateSize(); }, 600);

    // Inject locate button
    setTimeout(function() {
        var cont = document.getElementById(mapId);
        if (!cont || cont.querySelector('.smap-controls')) return;
        var ctrl = document.createElement('div');
        ctrl.className = 'smap-controls';
        ctrl.innerHTML =
            '<button class="dmap-ctrl-btn dmap-locate-btn" onclick="locateOnSearchMap(this)" title="My location">' +
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>' +
            '</button>';
        cont.appendChild(ctrl);
    }, 400);
}

function locateOnSearchMap(btn) {
    if (!navigator.geolocation || !searchMap) return;
    if (btn) btn.classList.add('locating');
    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            userLocation.latitude  = lat;
            userLocation.longitude = lng;
            userLocation.available = true;
            searchMap.setView([lat, lng], 14, { animate: true });
            if (btn) btn.classList.remove('locating');
        },
        function() { if (btn) btn.classList.remove('locating'); },
        { enableHighAccuracy: true, timeout: 8000 }
    );
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

// ===== EDIT: VISIBILITY SELECTOR (two-button, mirrors Add page) =====
function selectEditVisibility(el) {
    document.querySelectorAll('#editVisSelector .vis-option').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    const val = el.dataset.value; // 'private' | 'friends'
    const input = document.getElementById('editPrivateToggle');
    const hint  = document.getElementById('editVisHint');
    if (input) input.value = val === 'private' ? 'true' : 'false';
    if (hint)  hint.textContent = val === 'private'
        ? 'Saved privately — only you can see this.'
        : 'Your connections can see this.';
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
        if (val === 'private') {
            hint.textContent = 'Saved privately — only you can see this. Change to Friends when you\'re ready to share.';
            hint.classList.remove('vis-hint--friends');
        } else {
            hint.innerHTML = '✦ Your friends can save this — and their circle will see it was saved, but not who added it. Your knowledge travels further, anonymously.';
            hint.classList.add('vis-hint--friends');
        }
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
    // Reset unified photo sub-step
    removeUnifiedPhoto();
    // Hide photo pick zone
    const photoPickZone = document.getElementById('photoPickZone');
    if (photoPickZone) photoPickZone.classList.add('hidden');
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
    // Hide clear-prefill button and reset textarea heights
    const clearPrefillBtn = document.getElementById('clearPrefillBtn');
    if (clearPrefillBtn) clearPrefillBtn.classList.add('hidden');
    const titleTA = document.getElementById('title');
    if (titleTA) { titleTA.style.height = '44px'; }
    const takeTA = document.getElementById('personalNote');
    if (takeTA) { takeTA.style.height = '120px'; }
    // Reset progressive steps
    // Reset all UI state (cards, URL bar, banner, steps, overlay)
    _resetAddState();
    // Clear photo opt link input
    // legacy photo opt link removed
    const heroFilled = null;
    const heroZone = null;
    if (heroFilled) heroFilled.classList.add('hidden');
    if (heroZone) heroZone.classList.remove('hidden');
}

// ===== ENTRY CHIPS =====
let _lastOGFetchedUrl = ''; // declared here so clipboard handler can access it

// Resets UI state on every Add tab entry — hides URL bar, photo section,
// clears active card, hides banner. Does NOT clear form field values.
function _resetAddState() {
    // Deactivate all entry cards
    document.querySelectorAll('.entry-card').forEach(el => el.classList.remove('active'));
    try { localStorage.removeItem('odin_entry_chip'); } catch(e) {}
    // Hide URL bar and photo section — both start hidden until a card is chosen
    const urlHeroBar = document.getElementById('urlHeroBar');
    if (urlHeroBar) urlHeroBar.classList.add('hidden');
    // Hide clipboard banner
    const clipBanner = document.getElementById('clipDetectBanner');
    if (clipBanner) clipBanner.classList.add('hidden');
    // Hide any leftover paste overlay
    const pasteOverlay = document.getElementById('pasteOverlay');
    if (pasteOverlay) pasteOverlay.remove();
    // Collapse progressive form steps
    _resetSteps();
    // Reset step indicator back to Step 1
    updateAddStep(1);
    // Reset OG fetch dedup guard
    _lastOGFetchedUrl = '';
}

var selectEntryChip = function(chip) {
    // Update active state
    document.querySelectorAll('.entry-card').forEach(el => el.classList.remove('active'));
    const activeChip = document.querySelector(`.entry-card[data-chip="${chip}"]`);
    if (activeChip) activeChip.classList.add('active');
    // Persist selection
    try { localStorage.setItem('odin_entry_chip', chip); } catch(e) {}

    // Show relevant Step 1 zone for each chip
    const urlHeroBar = document.getElementById('urlHeroBar');
    const photoPickZone = document.getElementById('photoPickZone');
    if (chip === 'link') {
        if (urlHeroBar) urlHeroBar.classList.remove('hidden');
        if (photoPickZone) photoPickZone.classList.add('hidden');
    } else if (chip === 'photo') {
        if (urlHeroBar) urlHeroBar.classList.add('hidden');
        if (photoPickZone) photoPickZone.classList.remove('hidden');
    } else {
        if (urlHeroBar) urlHeroBar.classList.add('hidden');
        if (photoPickZone) photoPickZone.classList.add('hidden');
    }

    // Chip-specific: handle URL input focus, location prefill
    if (chip === 'link') {
        const urlInput = document.getElementById('url');
        if (urlInput) setTimeout(() => urlInput.focus(), 50);
        var _iosDevice = /iP(hone|ad|od)/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
        var pasteBtn = document.getElementById('iosPasteBtn');
        if (_iosDevice) {
            if (pasteBtn) {
                pasteBtn.classList.remove('hidden');
                pasteBtn.onclick = function() {
                    if (!navigator.clipboard || !navigator.clipboard.readText) return;
                    navigator.clipboard.readText()
                        .then(function(text) {
                            if (!text) return;
                            var trimmed = text.trim();
                            if (!urlInput) return;
                            urlInput.value = trimmed;
                            urlInput.focus();
                            pasteBtn.classList.add('hidden');
                            if (/^https?:\/\//i.test(trimmed)) {
                                _lastOGFetchedUrl = trimmed;
                                fetchAndPrefillOG(trimmed);
                            }
                        })
                        .catch(function() {});
                };
            }
        } else {
            if (pasteBtn) pasteBtn.classList.add('hidden');
            if (urlInput && !urlInput.value && navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText()
                    .then(function(text) {
                        if (!text) return;
                        var trimmed = text.trim();
                        if (!/^https?:\/\//i.test(trimmed)) return;
                        _showClipBanner(trimmed);
                    })
                    .catch(function() {});
            }
        }
    } else if (chip === 'here') {
        prefillCaptureLocation();
    }

    // Photo chip: don't advance yet — wait for photo upload
    // Link chip: don't advance yet — wait for OG fetch
    // Here / Type: advance to step 2 (title) immediately
    if (chip === 'here' || chip === 'type') {
        setTimeout(() => {
            _revealWizardStep('wStep2');
            updateAddStep(2);
            const titleField = document.getElementById('title');
            if (titleField) titleField.focus();
        }, 200);
    }
}

function _restoreEntryChip() {
    try {
        const saved = localStorage.getItem('odin_entry_chip');
        if (saved) {
            document.querySelectorAll('.entry-card').forEach(el => el.classList.remove('active'));
            const chip = document.querySelector(`.entry-card[data-chip="${saved}"]`);
            if (chip) chip.classList.add('active');
            const urlHeroBar = document.getElementById('urlHeroBar');
            const photoPickZone = document.getElementById('photoPickZone');
            if (saved === 'link') {
                if (urlHeroBar) urlHeroBar.classList.remove('hidden');
                if (photoPickZone) photoPickZone.classList.add('hidden');
            } else if (saved === 'photo') {
                if (urlHeroBar) urlHeroBar.classList.add('hidden');
                if (photoPickZone) photoPickZone.classList.remove('hidden');
            } else {
                if (urlHeroBar) urlHeroBar.classList.add('hidden');
                if (photoPickZone) photoPickZone.classList.add('hidden');
            }
        }
    } catch(e) {}
}

// Show the "Found a link" banner for a given URL string
function _showClipBanner(trimmed) {
    var banner = document.getElementById('clipDetectBanner');
    var urlEl = document.getElementById('clipDetectUrl');
    var useBtn = document.getElementById('clipDetectUse');
    var dismissBtn = document.getElementById('clipDetectDismiss');
    if (!banner || !urlEl) return;
    var display = trimmed.replace(/^https?:\/\/(www\.)?/, '');
    if (display.length > 40) display = display.substring(0, 40) + '…';
    urlEl.textContent = display;
    banner.classList.remove('hidden');
    var iosHintEl = document.getElementById('iosLinkHint');
    if (iosHintEl) iosHintEl.classList.add('hidden');
    var iosPasteBtn = document.getElementById('iosPasteBtn');
    if (iosPasteBtn) iosPasteBtn.classList.add('hidden');
    if (useBtn) {
        useBtn.onclick = function() {
            banner.classList.add('hidden');
            selectEntryChip('link');
            var urlInput = document.getElementById('url');
            if (urlInput) urlInput.value = trimmed;
            _lastOGFetchedUrl = trimmed;
            fetchAndPrefillOG(trimmed);
        };
    }
    if (dismissBtn) {
        dismissBtn.onclick = function() { banner.classList.add('hidden'); };
    }
}

function _checkClipboardForUrl() {
    // iOS always shows a system "Paste" confirmation banner for any clipboard read.
    // Skip readText() on iOS — the document-level paste listener handles it instead.
    if (/iP(hone|ad|od)/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) return;
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    navigator.clipboard.readText()
        .then(function(text) {
            if (!text) return;
            var trimmed = text.trim();
            if (!/^https?:\/\//i.test(trimmed)) return;
            _showClipBanner(trimmed);
        })
        .catch(function() {
            // Clipboard permission denied — silent fail
        });
}

function handlePhotoOptLink(val) {
    const trimmed = (val || '').trim();
    if (/^https?:\/\//i.test(trimmed)) {
        // Prefill title/desc but do NOT replace the photo
        fetchAndPrefillOG(trimmed);
    }
}

// ===== PROGRESSIVE STEP REVEAL =====
// ── ADD STEP INDICATOR ──────────────────────────────────────────
// Steps: 1=How, 2=Details, 3=Your Note, 4=Save
// Steps < n get a checkmark (done); step n gets active style; steps > n are muted
const _STEP_ICONS = [
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
];
const _STEP_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function updateAddStep(n) {
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById('addStep' + i);
        if (!el) continue;
        const circle = el.querySelector('.add-step-circle');
        if (i < n) {
            // Completed — green check
            el.classList.add('active');
            el.classList.add('done');
            if (circle) circle.innerHTML = _STEP_CHECK;
        } else if (i === n) {
            // Current — active colour, original icon
            el.classList.add('active');
            el.classList.remove('done');
            if (circle) circle.innerHTML = _STEP_ICONS[i - 1];
        } else {
            // Future — muted
            el.classList.remove('active');
            el.classList.remove('done');
            if (circle) circle.innerHTML = _STEP_ICONS[i - 1];
        }
    }
}

// Reveal a wizard section with fade-in and scroll
function _revealWizardStep(id) {
    const el = document.getElementById(id);
    if (!el || !el.classList.contains('step-hidden')) return;
    el.classList.remove('step-hidden');
    el.classList.add('step-reveal');
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

// Sub-step reveal helper — reveals a sub-step within wStep2
function _revealSubStep(id) {
    const el = document.getElementById(id);
    if (!el || !el.classList.contains('step-hidden')) return;
    el.classList.remove('step-hidden');
    el.classList.add('step-reveal');
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

// Reveal category pills after title is interacted with
let _categoryRevealed = false;
function _onTitleInteract() {
    if (_categoryRevealed) return;
    _categoryRevealed = true;
    _revealSubStep('subCategory');
    updateAddStep(2);
}

// Reveal Your Note after category is selected
let _noteRevealed = false;
function _revealNoteStep() {
    if (_noteRevealed) return;
    _noteRevealed = true;
    _revealSubStep('subNote');
    updateAddStep(3);
    setTimeout(() => {
        const takeField = document.getElementById('personalNote');
        if (takeField) {
            takeField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            takeField.focus();
        }
    }, 200);
}

// Reveal address (if place/service) + privacy + save after note is written
let _privacyRevealed = false;
function _revealPrivacyStep() {
    if (_privacyRevealed) return;
    const takeVal = document.getElementById('personalNote').value.trim();
    if (!takeVal) return; // need at least something
    _privacyRevealed = true;
    // Show address if category is place or service
    const cat = document.getElementById('category').value;
    if (cat === 'place' || cat === 'service') {
        _revealSubStep('subAddress');
    }
    _revealSubStep('subPhoto');
    _revealSubStep('subPrivacy');
    updateAddStep(4);
    setTimeout(() => {
        const saveBtn = document.getElementById('submitBtn');
        if (saveBtn) saveBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 200);
}

// Legacy wizardAdvance — still called by old "Next" buttons if any remain
function wizardAdvance(toStep) {
    // No-op — progressive sub-steps handle everything now
}

function _revealStep(id) {
    const el = document.getElementById(id);
    if (!el || !el.classList.contains('step-hidden')) return;
    el.classList.remove('step-hidden');
    el.classList.add('step-reveal');
    // Scroll to newly revealed section smoothly
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function _resetSteps() {
    // Reset wizard step 2 back to hidden; step 1 (How) always stays visible
    ['wStep2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('step-hidden');
            el.classList.remove('step-reveal');
        }
    });
    // Reset all sub-steps within step 2
    ['subCategory', 'subNote', 'subAddress', 'subPhoto', 'subPrivacy'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('step-hidden');
            el.classList.remove('step-reveal');
        }
    });
    // Reset sub-step progression flags
    _categoryRevealed = false;
    _noteRevealed = false;
    _privacyRevealed = false;
    // Reset autofill hint and clear button (leftover from link flow)
    const _afHint = document.getElementById('titleAutofillHint');
    if (_afHint) _afHint.classList.add('hidden');
    const _cpBtn = document.getElementById('clearPrefillBtn');
    if (_cpBtn) _cpBtn.classList.add('hidden');
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

/// ===== CAPTURE: URL OG PREFILL =====
let _ogFetchInFlight = false;
async function fetchAndPrefillOG(url) {
    if (!url || !url.startsWith('http')) return;
    if (_ogFetchInFlight) return;  // iOS duplicate-call guard
    _ogFetchInFlight = true;
    // Mark entry type as link for submit logic
    try { localStorage.setItem('odin_entry_chip', 'link'); } catch(e) {}

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
        const didFillTitle = !!(og.title && titleField && !titleField.value.trim());
        if (didFillTitle) {
            titleField.value = og.title;
            if (titleField._autoGrow) titleField._autoGrow();
        }
        // Always open Details after fetch so user can see/fill the name field
        _openDetailsAfterOG(didFillTitle);
        // Never auto-fill "Your Take" — it's the user's personal voice, not OG copy.
        // og.description is kept in memory for the preview card only.

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
        // Auto-infer category from URL domain if not already set by user
        const _inferCategory = (u) => {
            const h = (() => { try { return new URL(u).hostname.replace('www.',''); } catch(e) { return ''; } })();
            const SERVICE_DOMAINS = [
                'coursera.org','udemy.com','linkedin.com','skillshare.com','masterclass.com',
                'duolingo.com','khanacademy.org','edx.org','pluralsight.com','figma.com',
                'notion.so','slack.com','dropbox.com','spotify.com','netflix.com','airbnb.com',
                'booking.com','tripadvisor.com','uber.com','lyft.com','doordash.com',
                'fiverr.com','upwork.com','canva.com','squarespace.com','wix.com'
            ];
            const PRODUCT_DOMAINS = [
                'amazon.com','amazon.com.au','ebay.com','etsy.com','shopify.com',
                'apple.com','bestbuy.com','target.com','walmart.com','ikea.com',
                'asos.com','theiconic.com.au','trademe.co.nz','mighty ape.co.nz'
            ];
            if (SERVICE_DOMAINS.some(d => h.includes(d))) return 'service';
            if (PRODUCT_DOMAINS.some(d => h.includes(d))) return 'product';
            return null;
        };

        if (og.source === 'googlemaps') {
            const cat = og.category || 'place';
            document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
            const targetPill = document.querySelector(`.category-pill[data-value="${cat}"]`);
            if (targetPill) targetPill.classList.add('active');
            document.getElementById('category').value = cat;
            startTakePlaceholder(cat);
        } else {
            // Only infer if user hasn't already picked a non-default category
            const currentCat = document.getElementById('category').value;
            if (currentCat === 'place') {
                const inferred = _inferCategory(url);
                if (inferred) {
                    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
                    const targetPill = document.querySelector(`.category-pill[data-value="${inferred}"]`);
                    if (targetPill) targetPill.classList.add('active');
                    document.getElementById('category').value = inferred;
                    startTakePlaceholder(inferred);
                    // Hide address field — inferred category is not a place
                    const addressGroup = document.querySelector('.address-group');
                    if (addressGroup) addressGroup.style.display = 'none';
                }
            }
        }

        // Preload OG image into the photo section (if no user photo already)
        if (og.image) {
            const photoFileG = document.getElementById('photoGallery');
            const photoFileC = document.getElementById('photoCamera');
            const hasUserPhoto = (photoFileG && photoFileG.files && photoFileG.files.length > 0) ||
                                 (photoFileC && photoFileC.files && photoFileC.files.length > 0);
            if (!hasUserPhoto) {
                preloadOGPhoto(og.image);
            }
        }

        // Show "Clear prefill" button once fields are populated
        const clearPrefillBtn = document.getElementById('clearPrefillBtn');
        if (clearPrefillBtn && (og.title || og.description)) {
            clearPrefillBtn.classList.remove('hidden');
        }

        // Auto-grow title textarea if value was set programmatically
        const titleTA = document.getElementById('title');
        if (titleTA && titleTA._autoGrow) titleTA._autoGrow();

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

        // Show subPhoto step — photo row appears for all chips in step 2
        // (OG image pre-loaded if available)
        if (og.image) {
            // OG image: reveal subPhoto with the image preloaded
            preloadOGPhoto(og.image);
        }
        _revealSubStep('subPhoto');

        // OG fetch complete — reveal Step 2 with title, then auto-reveal category
        // since OG data already auto-detected it.
        _revealWizardStep('wStep2');
        updateAddStep(2);

        // Auto-reveal category since OG pre-filled title
        setTimeout(() => {
            _onTitleInteract(); // reveals category
            // OG auto-selected category — reveal note after a beat so user sees the category first
            setTimeout(() => _revealNoteStep(), 600);
        }, 200);

        // Focus title field so user can review/edit the auto-filled name.
        setTimeout(() => {
            const titleField = document.getElementById('title');
            if (titleField) {
                titleField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                titleField.focus();
            }
        }, 300);

    } catch (e) {
        if (ogLoading) ogLoading.classList.add('hidden');
        if (heroHint) heroHint.style.display = 'flex';
        // On error still reveal Step 2 so user can continue manually
        _revealWizardStep('wStep2');
        updateAddStep(2);
        // Still show subPhoto step so user can add a photo manually
        _revealSubStep('subPhoto');
    } finally {
        _ogFetchInFlight = false;  // always release lock when done
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
    // Load an OG image into the unified photo sub-step
    const img = document.getElementById('subPhotoImg');
    const preview = document.getElementById('subPhotoPreview');
    const empty = document.getElementById('subPhotoEmpty');
    const badge = document.getElementById('subPhotoBadge');
    const ogUrlField = document.getElementById('ogImageUrl');

    if (!img) return;

    img.src = imageUrl;
    if (preview) preview.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (badge) badge.textContent = 'From link';
    // Reveal the subPhoto sub-step (it may be hidden if OG fetch ran before _revealPrivacyStep)
    _revealSubStep('subPhoto');
    if (ogUrlField) ogUrlField.value = imageUrl;
    _photoSource = 'og';
}

function removePhoto() {
    removeUnifiedPhoto();
}

function removeUnifiedPhoto() {
    const img = document.getElementById('subPhotoImg');
    const preview = document.getElementById('subPhotoPreview');
    const empty = document.getElementById('subPhotoEmpty');
    const ogUrlField = document.getElementById('ogImageUrl');
    const photoGallery = document.getElementById('photoGallery');
    const photoCamera = document.getElementById('photoCamera');
    if (img) img.src = '';
    if (preview) preview.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    if (ogUrlField) ogUrlField.value = '';
    if (photoGallery) photoGallery.value = '';
    if (photoCamera) photoCamera.value = '';
    _photoSource = 'none';
}

function resetOGFetchState() {
    _lastOGFetchedUrl = '';
    _ogFetchInFlight = false;
    clearOGPreview();
}


// Attach URL paste/blur/input listener once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Page-level paste listener: if the user pastes a URL anywhere on the Add
    // page, show the "Found a link" banner. This is the primary detection path
    // on iOS (where readText() is blocked) and a nice fallback everywhere else.
    document.addEventListener('paste', function(e) {
        if (_currentMode !== 'input') return;
        var text = (e.clipboardData || window.clipboardData || '').getData('text');
        if (!text) return;
        var trimmed = text.trim();
        if (!/^https?:\/\//i.test(trimmed)) return;
        _showClipBanner(trimmed);
    });

    const urlInput = document.getElementById('url');
    if (!urlInput) return;

    const triggerOGFetch = () => {
        const val = urlInput.value.trim();
        if (val && val !== _lastOGFetchedUrl && val.startsWith('http')) {
            _lastOGFetchedUrl = val;
            selectEntryChip('link'); // highlight Link chip whenever a URL is entered
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

    // iOS-safe auto-grow helper
    // Setting height:'auto' doesn't trigger reflow on iOS Safari.
    // Setting to '0px' first forces a layout recalc, then scrollHeight is correct.
    function initAutoGrow(el, minHeight) {
        if (!el) return;
        const grow = () => {
            el.style.height = '0px';
            el.style.height = Math.max(el.scrollHeight, minHeight) + 'px';
        };
        el.addEventListener('input', grow);
        el.addEventListener('focus', grow);
        el._autoGrow = grow;
        grow(); // initial size
    }

    initAutoGrow(document.getElementById('title'), 44);
    initAutoGrow(document.getElementById('personalNote'), 120);

    // ── Progressive sub-step reveals ──
    // Title input → reveal category pills
    const titleEl = document.getElementById('title');
    if (titleEl) {
        titleEl.addEventListener('input', _onTitleInteract);
        titleEl.addEventListener('focus', _onTitleInteract);
    }

    // Note input → reveal address + privacy + save
    const noteEl = document.getElementById('personalNote');
    if (noteEl) {
        noteEl.addEventListener('input', _revealPrivacyStep);
    }
});


// ===== DETAILS SECTION TOGGLE =====
// Details is now wizard step 3 — always visible when reached. No-op kept for safety.
function toggleDetails() {}

// Show autofill hint after OG fills title (Details is now wizard step 3, always revealed on Next)
function _openDetailsAfterOG(hasTitle) {
    const hint = document.getElementById('titleAutofillHint');
    if (hint) {
        if (hasTitle) hint.classList.remove('hidden');
        else hint.classList.add('hidden');
    }
}

// ===== CLEAR TITLE ONLY =====
// The "Clear" button lives inside Details next to the title field.
// It only clears the title — Your Take, photo, and URL are preserved.
function clearPrefillFields() {
    const titleField = document.getElementById('title');
    if (titleField) {
        titleField.value = '';
        if (titleField._autoGrow) titleField._autoGrow();
        titleField.focus();
    }
    // Hide the clear button and autofill hint
    const clearBtn = document.getElementById('clearPrefillBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    const titleHint = document.getElementById('titleAutofillHint');
    if (titleHint) titleHint.classList.add('hidden');
}

var submitDiscovery = async function(e) {
    e.preventDefault();

    if (!currentUser) {
        alert('Please login first');
        return;
    }

    // Auto-generate title if empty — no prompt shown, just silent fallback
    const titleField = document.getElementById('title');
    let titleVal = titleField ? titleField.value.trim() : '';
    if (!titleVal) {
        let chipType = '';
        try { chipType = localStorage.getItem('odin_entry_chip') || ''; } catch(e) {}
        // If user uploaded a photo, auto-detect
        if (!chipType && _photoSource === 'user') chipType = 'photo';
        if (chipType === 'photo') {
            // "Photo — 5 Apr 2026"
            const now = new Date();
            const day = now.getDate();
            const mon = now.toLocaleString('en-NZ', { month: 'short' });
            const yr  = now.getFullYear();
            titleVal = `Photo \u2014 ${day} ${mon} ${yr}`;
        } else if (chipType === 'type') {
            // First 6 words of Your Take
            const takeText = document.getElementById('personalNote').value.trim();
            const words = takeText.split(/\s+/).slice(0, 6).join(' ');
            if (words) {
                titleVal = words + (takeText.split(/\s+/).length > 6 ? '\u2026' : '');
            }
        }
        // If still empty (link/here with no OG title), highlight the title field
        if (!titleVal) {
            if (titleField) {
                titleField.focus();
                titleField.style.borderColor = '#7B2D45';
                setTimeout(() => { titleField.style.borderColor = ''; }, 2500);
            }
            document.getElementById('submitBtn').disabled = false;
            return;
        }
        // Write the generated title back into the field so it's picked up by the payload
        if (titleField) titleField.value = titleVal;
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
    const _pgEl = document.getElementById('photoGallery');
    const _pcEl = document.getElementById('photoCamera');
    const photoFile = (_pgEl && _pgEl.files && _pgEl.files[0]) || (_pcEl && _pcEl.files && _pcEl.files[0]) || null;
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
        user_latitude: document.getElementById('userLat').value ? parseFloat(document.getElementById('userLat').value) : null,
        user_longitude: document.getElementById('userLng').value ? parseFloat(document.getElementById('userLng').value) : null,
        UserID: currentUser.id,
        familyId: currentProfile?.family_id || '37ae9f84-2d1d-4930-9765-f6f8991ae053',
        photo: photoBase64,
        photoFilename: photoFile ? photoFile.name : null,
        ogImageUrl: (!photoBase64 && _photoSource === 'og') ? (document.getElementById('ogImageUrl')?.value || null) : null,
        visibility: visibilityVal === 'private' ? 'only_me' : visibilityVal
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
    // Hide autofill hint on successful save
    const _titleHint = document.getElementById('titleAutofillHint');
    if (_titleHint) _titleHint.classList.add('hidden');

    btn.disabled = false;

    // Navigate away after a brief moment
    setTimeout(() => {
        overlay.classList.add('hidden');
        setMode('discover');
    }, 1500);

    // Send to backend in the background — now with failure feedback
    fetch(CAPTURE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(async (resp) => {
        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            console.error('Save failed — HTTP', resp.status, errText);
            showToast('Save failed — please try again. Your entry was not stored.', 6000);
            return;
        }
        try {
            const data = await resp.json();
            if (!data || data.success === false) {
                showToast('Save failed — please try again. Your entry was not stored.', 6000);
            }
        } catch (e) {
            // Non-JSON response but status was OK — treat as success
        }
    }).catch(err => {
        console.error('Background save failed:', err);
        showToast('Save failed — please check your connection and try again.', 6000);
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

    // Reveal Your Note sub-step after category is selected
    _revealNoteStep();

    // Show/hide address field based on category
    const addressGroup = document.querySelector('.address-group');
    const addressLabel = document.getElementById('addressLabel');

    if (val === 'place') {
        if (addressGroup) addressGroup.style.display = '';
        if (addressLabel) addressLabel.textContent = '— recommended for places';
    } else if (val === 'service') {
        if (addressGroup) addressGroup.style.display = '';
        if (addressLabel) addressLabel.textContent = '— optional for services';
    } else {
        if (addressGroup) addressGroup.style.display = 'none';
        // Clear address when hidden
        const addrInput = document.getElementById('address');
        if (addrInput) addrInput.value = '';
    }
}

function _handlePhotoChange(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            // Show preview in unified subPhoto component
            const img = document.getElementById('subPhotoImg');
            const preview = document.getElementById('subPhotoPreview');
            const empty = document.getElementById('subPhotoEmpty');
            const badge = document.getElementById('subPhotoBadge');
            if (img) img.src = ev.target.result;
            if (preview) preview.style.display = 'flex';
            if (empty) empty.style.display = 'none';
            if (badge) badge.textContent = 'Your photo';

            // Mark as user photo, clear any OG image URL
            _photoSource = 'user';
            const ogUrlField = document.getElementById('ogImageUrl');
            if (ogUrlField) ogUrlField.value = '';

            // For Photo chip: reveal Step 2 so user can name it + pick category
            const activeChip = document.querySelector('.entry-card.active')?.dataset?.chip;
            if (activeChip === 'photo') {
                _revealWizardStep('wStep2');
                _revealSubStep('subPhoto'); // ensure photo row visible
                updateAddStep(2);
                setTimeout(() => {
                    const titleField = document.getElementById('title');
                    if (titleField) {
                        titleField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        titleField.focus();
                    }
                }, 300);
            } else {
                // Non-photo chips: subPhoto is already visible from _revealPrivacyStep,
                // but if user picks a photo via gallery/camera label, just update the preview
                // (no step change needed)
            }
        };
        reader.readAsDataURL(file);
    }
}
document.getElementById('photoGallery').addEventListener('change', _handlePhotoChange);
document.getElementById('photoCamera').addEventListener('change', _handlePhotoChange);

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
function showToast(message, duration = 4500) {
    // Remove any existing toast
    const existing = document.getElementById('appToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'app-toast';
    toast.innerHTML = `
        <span class="app-toast-text">${message}</span>
        <span class="app-toast-dismiss" onclick="this.closest('#appToast').remove()">&#x2715;</span>
    `;
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

// ══════════════════════════════════════════════════════════
// INVITE LINK SYSTEM
// Profile tab → "Generate invite link" → share via WhatsApp/iMessage
// When new user signs up via link → friend request sent to inviter
// March 2026
// ══════════════════════════════════════════════════════════

async function generateInviteLink() {
    if (!currentUser) return;

    const btn = document.getElementById('inviteLinkBtn');
    const result = document.getElementById('inviteLinkResult');
    const urlEl = document.getElementById('inviteLinkUrl');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    try {
        // Generate a random token — 12 chars, URL-safe
        const token = Array.from(crypto.getRandomValues(new Uint8Array(9)))
            .map(b => b.toString(36).padStart(2, '0'))
            .join('')
            .slice(0, 12);

        // Save to Supabase invitations table
        const { error } = await supabaseClient
            .from('invitations')
            .insert({
                token: token,
                inviter_id: currentUser.id
            });

        if (error) throw error;

        // Build the shareable URL
        const baseUrl = window.location.href.split('?')[0].split('#')[0];
        const inviteUrl = `${baseUrl}?token=${token}`;

        // Display it
        if (urlEl) urlEl.textContent = inviteUrl;
        if (result) result.style.display = 'block';
        if (btn) { btn.textContent = 'Generate new link'; btn.disabled = false; }

    } catch (err) {
        console.error('Failed to generate invite link:', err);
        if (btn) { btn.textContent = 'Try again'; btn.disabled = false; }
    }
}

function copyInviteLink() {
    const urlEl = document.getElementById('inviteLinkUrl');
    const copyBtn = document.getElementById('inviteLinkCopy');
    if (!urlEl) return;

    const url = urlEl.textContent.trim();
    navigator.clipboard.writeText(url).then(() => {
        if (copyBtn) {
            copyBtn.textContent = 'Copied!';
            copyBtn.style.background = '#2A6B3C';
            setTimeout(() => {
                copyBtn.textContent = 'Copy';
                copyBtn.style.background = '';
            }, 2000);
        }
    }).catch(() => {
        // Fallback for older browsers / non-HTTPS
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (copyBtn) {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        }
    });
}

// ══════════════════════════════════════════════════════════
// ONBOARDING FLOW — 4-step, fires once on first login
// Trigger: profiles.onboarding_completed_at === null
// March 2026
// ══════════════════════════════════════════════════════════

// Stores the invite token read from the URL (survives OAuth redirect via sessionStorage)
let _onbInviteToken = null;
let _onbInviterData = null; // { id, display_name }

// ── Silent invite processing for returning users ──
// Called when a user who already completed onboarding opens an invite link.
// Looks up the token, sends a friend request to the inviter, marks token used.
// No UI shown — happens invisibly in the background.
async function _processInviteTokenSilently(token) {
    if (!currentUser || !token) return;
    try {
        // Use SECURITY DEFINER RPC — bypasses RLS so any authenticated user
        // can look up the inviter even if they have no friends yet.
        const inviter = await _lookupInviterProfile(token);

        if (!inviter) {
            // Token invalid, already used, or own link — clear storage
            sessionStorage.removeItem('odin_invite_token');
            localStorage.removeItem('odin_invite_token');
            return;
        }

        const inv = { inviter_id: inviter.id };

        // Check not already friends (accepted)
        const alreadyFriends = friendsCache.some(f => f.out_user_id === inv.inviter_id);
        if (alreadyFriends) {
            sessionStorage.removeItem('odin_invite_token');
            localStorage.removeItem('odin_invite_token');
            return;
        }

        // Check not already a pending request in either direction
        const alreadyPendingOut = outgoingFriendRequests.has(inv.inviter_id);
        const alreadyPendingIn  = pendingFriendRequests.some(r => r.out_requester_id === inv.inviter_id);
        if (alreadyPendingOut || alreadyPendingIn) {
            sessionStorage.removeItem('odin_invite_token');
            localStorage.removeItem('odin_invite_token');
            return;
        }

        // Send pending friend request: current user → inviter
        const { error: friendErr } = await supabaseClient
            .from('friendships')
            .insert({ requester_id: currentUser.id, receiver_id: inv.inviter_id, status: 'pending' });

        if (!friendErr) {
            // Notify the inviter
            const senderName = currentProfile?.display_name || currentUser.email?.split('@')[0] || 'Someone';
            const inviterName = inviter.display_name || 'them';

            await supabaseClient.rpc('notify_friend_request', {
                p_receiver_id: inv.inviter_id,
                p_actor_id:    currentUser.id,
                p_message:     `${senderName} accepted your invite and wants to connect on Odin.`
            });

            // Mark token used
            await supabaseClient
                .from('invitations')
                .update({ used: true })
                .eq('token', token);

            // Refresh so the profile page shows the new outgoing request immediately
            await Promise.all([loadPendingFriendRequests(), loadOutgoingFriendRequests()]);

            // Let the user know a friend request was sent on their behalf
            showToast(`Friend request sent to ${inviterName}! Check your profile for updates.`, 5000);
        } else if (friendErr.code === '23505') {
            // Duplicate — request already exists, just mark token used cleanly
            await supabaseClient
                .from('invitations')
                .update({ used: true })
                .eq('token', token);
        }

        sessionStorage.removeItem('odin_invite_token');
        localStorage.removeItem('odin_invite_token');
    } catch (err) {
        console.warn('Silent invite processing failed (non-critical):', err);
    }
}

// ── Invite helper: look up inviter via SECURITY DEFINER RPC ──
// Uses get_inviter_profile() which bypasses profiles RLS so a brand-new
// user (no friends yet) can still see the inviter's name.
// Returns { id, display_name } or null if token invalid/used/own link.
async function _lookupInviterProfile(token) {
    if (!token) return null;
    try {
        const { data, error } = await supabaseClient
            .rpc('get_inviter_profile', { p_token: token });
        if (error || !data || data.length === 0) return null;
        const row = data[0];
        return { id: row.inviter_id, display_name: row.display_name };
    } catch (e) {
        console.warn('_lookupInviterProfile failed:', e);
        return null;
    }
}

// ── Invite helper: populate the Step 2 "X invited you" UI ──
function _populateStep2UI(inviter) {
    const nameSpan   = document.getElementById('onbInviterName');
    const initSpan   = document.getElementById('onbInviterInitial');
    const connectBtn = document.getElementById('onbConnectBtn');
    if (nameSpan)   nameSpan.textContent   = inviter.display_name || 'Someone';
    if (initSpan)   initSpan.textContent   = (inviter.display_name || '?')[0].toUpperCase();
    if (connectBtn) connectBtn.textContent = `Connect with ${(inviter.display_name || 'them').split(' ')[0]} →`;
}

// ── Coach Marks ──
const COACH_MARKS = {
    home:     "Your feed — recommendations from people you trust.",
    discover: "Browse what your circle saved. Tap the map icon to explore nearby.",
    search:   "Ask it like you'd ask a friend.",
    input:    "Save something great — your circle will thank you.",
    profile:  "Your Knowledge Base — everything your network knows."
};

let _coachMarkTimer = null;

function showCoachMark(mode) {
    const key = `odin_coach_${mode}`;
    if (localStorage.getItem(key)) return;         // already seen
    const text = COACH_MARKS[mode];
    if (!text) return;

    const el = document.getElementById('coachMark');
    const textEl = document.getElementById('coachMarkText');
    if (!el || !textEl) return;

    localStorage.setItem(key, '1');                // mark as seen immediately
    textEl.textContent = text;
    el.style.display = 'block';

    if (_coachMarkTimer) clearTimeout(_coachMarkTimer);
    _coachMarkTimer = setTimeout(dismissCoachMark, 4000);
}

function dismissCoachMark() {
    const el = document.getElementById('coachMark');
    if (el) el.style.display = 'none';
    if (_coachMarkTimer) { clearTimeout(_coachMarkTimer); _coachMarkTimer = null; }
}

async function checkOnboardingBanner() {
    // ── Legacy banner: always hide (replaced by new flow) ──
    const legacyBanner = document.getElementById('onboardingBanner');
    if (legacyBanner) legacyBanner.style.display = 'none';

    // ── New flow: check onboarding_completed_at in profiles ──
    if (!currentProfile) return;

    // Read invite token — sessionStorage first, fall back to localStorage
    // (Google OAuth redirect can wipe sessionStorage on some browsers/devices)
    _onbInviteToken = sessionStorage.getItem('odin_invite_token')
                   || localStorage.getItem('odin_invite_token') || null;

    // Returning user: skip onboarding UI BUT show Step 2 if there's a valid token
    if (currentProfile.onboarding_completed_at) {
        if (_onbInviteToken) {
            const inviter = await _lookupInviterProfile(_onbInviteToken);
            if (inviter) {
                _onbInviterData = inviter;
                _populateStep2UI(inviter);
                onbGoStep(2);
                return;
            }
            // Token invalid/used — process silently and move on
            await _processInviteTokenSilently(_onbInviteToken);
        }
        return;
    }

    // Populate step 1 user name
    const nameEl = document.getElementById('onbUserName');
    if (nameEl) {
        const firstName = (currentProfile.display_name || '').split(' ')[0] || 'friend';
        nameEl.textContent = firstName;
    }

    // If we have a token, look up the inviter before showing step 2
    if (_onbInviteToken) {
        const inviter = await _lookupInviterProfile(_onbInviteToken);
        if (inviter) {
            _onbInviterData = inviter;
            _populateStep2UI(inviter);
        } else {
            // Token invalid or already used — clear it
            _onbInviteToken = null;
            sessionStorage.removeItem('odin_invite_token');
            localStorage.removeItem('odin_invite_token');
        }
    }

    // Show the overlay and start at step 1
    onbGoStep(1);
}

async function onbGoStep(step) {
    const overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return;

    // Step 2: if inviter data isn't loaded yet but we have a token, look it up now.
    // This handles the race where the user clicks "Let's go →" before the async
    // token lookup in checkOnboardingBanner has finished.
    if (step === 2 && !_onbInviterData) {
        const token = _onbInviteToken
                   || sessionStorage.getItem('odin_invite_token')
                   || localStorage.getItem('odin_invite_token');
        if (token) {
            const inviter = await _lookupInviterProfile(token);
            if (inviter) {
                _onbInviterData = inviter;
                _onbInviteToken = token;
                _populateStep2UI(inviter);
            }
        }
        // If still no inviter data after lookup, skip step 2
        if (!_onbInviterData) {
            onbGoStep(3);
            return;
        }
    }

    overlay.style.display = 'flex';

    // Hide all steps, show the requested one
    [1,2,3,4].forEach(n => {
        const el = document.getElementById(`onbStep${n}`);
        if (el) el.style.display = n === step ? 'flex' : 'none';
    });
}

async function onbAcceptInvite() {
    if (!_onbInviterData || !currentUser) {
        onbGoStep(3);
        return;
    }

    const btn = document.getElementById('onbConnectBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending request...'; }

    try {
        // Send a PENDING friend request to the inviter.
        // Status = 'pending' so the inviter sees it in their Requests tab
        // and gets a notification — matching the normal friendship flow.
        // new user = requester, inviter = receiver
        const { error: friendErr } = await supabaseClient
            .from('friendships')
            .insert({
                requester_id: currentUser.id,
                receiver_id: _onbInviterData.id,
                status: 'pending'
            });

        const succeeded = !friendErr || friendErr.code === '23505'; // success or already exists

        if (!friendErr) {
            // Notify the inviter via the existing secure RPC
            const newUserName = currentProfile?.display_name ||
                                currentUser?.user_metadata?.full_name ||
                                currentUser?.email?.split('@')[0] || 'Someone';
            await supabaseClient.rpc('notify_friend_request', {
                p_receiver_id: _onbInviterData.id,
                p_actor_id:    currentUser.id,
                p_message:     `${newUserName} accepted your invite and wants to connect on Odin.`
            });
        } else if (!succeeded) {
            console.warn('Friend request insert failed:', friendErr);
        }

        if (succeeded) {
            // Mark invite token as used
            if (_onbInviteToken) {
                await supabaseClient
                    .from('invitations')
                    .update({ used: true })
                    .eq('token', _onbInviteToken);
                sessionStorage.removeItem('odin_invite_token');
                localStorage.removeItem('odin_invite_token');
            }

            // Refresh pending requests so the profile page shows the new outgoing request
            await Promise.all([loadPendingFriendRequests(), loadOutgoingFriendRequests()]);

            if (btn) btn.textContent = 'Request sent ✓';
        } else {
            if (btn) btn.textContent = 'Could not send — skip';
        }
    } catch (err) {
        console.warn('Auto-connect on invite failed:', err);
        if (btn) btn.textContent = 'Could not send — skip';
    }

    // Short pause so user sees the confirmation, then move on.
    // For returning users (onboarding already done) just close the overlay.
    // For new users, advance to Step 3 (Add first item).
    setTimeout(() => {
        if (currentProfile && currentProfile.onboarding_completed_at) {
            onbComplete(); // just close
        } else {
            onbGoStep(3);
        }
    }, 1000);
}

// Called by "Skip for now" on Step 2.
// Returning users (onboarding already done) just close the modal.
// New users proceed to Step 3 (Add first item).
function onbSkipInvite() {
    // Clear the pending token so it doesn't re-trigger
    sessionStorage.removeItem('odin_invite_token');
    localStorage.removeItem('odin_invite_token');
    _onbInviteToken = null;
    _onbInviterData = null;

    if (currentProfile && currentProfile.onboarding_completed_at) {
        onbComplete();
    } else {
        onbGoStep(3);
    }
}

function onbGoAdd() {
    // Mode name is 'input' (not 'add') — matches setMode() in app
    onbComplete();
    setTimeout(() => setMode('input'), 300);
}

function onbGoSearch() {
    // Mode name is 'search', input element is 'messageInput'
    onbComplete();
    setTimeout(() => {
        setMode('search');
        const searchInput = document.getElementById('messageInput');
        if (searchInput) searchInput.focus();
    }, 300);
}

async function onbComplete() {
    // Hide overlay
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s ease';
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.opacity = '';
            overlay.style.transition = '';
        }, 300);
    }

    // Persist completion to Supabase — fires once, never again
    if (currentUser) {
        try {
            await supabaseClient
                .from('profiles')
                .update({ onboarding_completed_at: new Date().toISOString() })
                .eq('id', currentUser.id);
            // Update local cache so we don't re-trigger
            if (currentProfile) currentProfile.onboarding_completed_at = new Date().toISOString();
        } catch (err) {
            console.warn('Could not save onboarding completion:', err);
        }
    }

    // Also set localStorage as quick-check fallback
    localStorage.setItem('onboarding_welcome_dismissed', 'true');
}

// Legacy stubs — kept so any old HTML onclick references don't break
function dismissOnboarding() { onbComplete(); }
function handleOnbOverlayClick(e) {}

function goToFindFriends() {
    onbComplete();
    setMode('profile');
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

// ===== PULL-TO-REFRESH =====
(function initPullToRefresh() {
    var PTR_THRESHOLD = 65;   // px drag needed to trigger refresh
    var PTR_MAX      = 90;    // max drag distance (visual clamp)

    var touchStartY  = 0;
    var pulling      = false;
    var refreshing   = false;

    // Create indicator element
    var indicator = document.createElement('div');
    indicator.id  = 'ptrIndicator';
    indicator.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'right:0',
        'z-index:9999',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'height:0',
        'overflow:hidden',
        'transition:height 0.2s ease',
        'background:transparent',
        'pointer-events:none'
    ].join(';');

    indicator.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;' +
        'background:var(--surface,#fff);border-radius:20px;' +
        'padding:6px 14px;box-shadow:0 2px 8px rgba(0,0,0,0.12);' +
        'font-family:\'DM Sans\',sans-serif;font-size:13px;color:var(--text-secondary,#888);">' +
        '<svg id="ptrSpinner" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
        'stroke="#7B2D45" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="1 4 1 10 7 10"/>' +
        '<path d="M3.51 15a9 9 0 1 0 .49-4.5"/>' +
        '</svg>' +
        '<span id="ptrLabel">Pull to refresh</span>' +
        '</div>';

    document.addEventListener('DOMContentLoaded', function() {
        document.body.appendChild(indicator);
    });

    function isRefreshableMode() {
        return _currentMode === 'home' ||
               _currentMode === 'discover' ||
               _currentMode === 'profile';
    }

    function getScrollTop() {
        var content = document.querySelector('.content');
        if (content) return content.scrollTop;
        return window.scrollY || document.documentElement.scrollTop;
    }

    function setIndicatorHeight(px) {
        indicator.style.height = px + 'px';
    }

    function setIndicatorLabel(text) {
        var label = document.getElementById('ptrLabel');
        if (label) label.textContent = text;
    }

    function spinIndicator(spin) {
        var svg = document.getElementById('ptrSpinner');
        if (!svg) return;
        if (spin) {
            svg.style.animation = 'ptrSpin 0.7s linear infinite';
        } else {
            svg.style.animation = '';
        }
    }

    async function triggerRefresh() {
        if (refreshing) return;
        refreshing = true;
        setIndicatorHeight(PTR_THRESHOLD);
        setIndicatorLabel('Refreshing…');
        spinIndicator(true);

        try {
            if (_currentMode === 'home') {
                await loadFriends();
                loadDiscoveries();
            } else if (_currentMode === 'discover') {
                allDiscoveries = [];
                await loadDiscoveries();
            } else if (_currentMode === 'profile') {
                await loadProfilePage();
            }
        } catch(e) {
            console.warn('Pull-to-refresh error:', e);
        }

        spinIndicator(false);
        setIndicatorLabel('Pull to refresh');
        setIndicatorHeight(0);
        refreshing = false;
    }

    document.addEventListener('touchstart', function(e) {
        if (!isRefreshableMode()) return;
        if (getScrollTop() > 0) return;
        touchStartY = e.touches[0].clientY;
        pulling = true;
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
        if (!pulling || refreshing) return;
        var delta = e.touches[0].clientY - touchStartY;
        if (delta <= 0) { pulling = false; setIndicatorHeight(0); return; }
        var clamped = Math.min(delta * 0.5, PTR_MAX);
        setIndicatorHeight(clamped);
        setIndicatorLabel(clamped >= PTR_THRESHOLD * 0.5 ? 'Release to refresh' : 'Pull to refresh');
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (!pulling || refreshing) return;
        pulling = false;
        var currentH = parseFloat(indicator.style.height) || 0;
        if (currentH >= PTR_THRESHOLD * 0.5) {
            triggerRefresh();
        } else {
            setIndicatorHeight(0);
        }
    }, { passive: true });

    // Inject keyframe animation for spinner
    var style = document.createElement('style');
    style.textContent = '@keyframes ptrSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
})();

// ===== NOTIFICATION DRAWER =====
// openNotifDrawer / closeNotifDrawer are defined in index.html inline script
// using the profile-drawer / is-open CSS pattern. This block just ensures
// loadNotifications() is called on open so notifDrawerItems is populated.
// ============================================================
// ===== NEW CAPTURE FLOW (Apr 2026 redesign) =================
// ============================================================
// Driven by body.odin-newcapture. The 4 modes (photo/link/here/type)
// each go straight to: Note -> (conditional address) -> Privacy -> Save.
// Title and category are no longer user-facing; backend resolves them.
// ============================================================
(function odinNewCaptureFlow() {
    if (!document.body || !document.body.classList.contains('odin-newcapture')) {
        // Defer until DOMContentLoaded if body not ready yet
        document.addEventListener('DOMContentLoaded', odinNewCaptureFlow);
        return;
    }

    let _captureMode = null; // 'photo' | 'link' | 'here' | 'type'
    window._odinGetCaptureMode = () => _captureMode;
    window._odinSetCaptureMode = (m) => { _captureMode = m; };

    // ---- Address reveal helpers (Photo + Type modes) ----------
    function _ensureLocReveal(labelText) {
        // Inject a small "Show / Add location" link below the note field
        // that, on click, reveals the existing #subAddress block.
        let host = document.getElementById('ncLocRevealHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'ncLocRevealHost';
            const noteWrap = document.getElementById('subNote');
            if (noteWrap) noteWrap.appendChild(host);
        }
        host.innerHTML = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nc-loc-reveal';
        btn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
            '<span>' + labelText + '</span>';
        btn.onclick = function() {
            const sub = document.getElementById('subAddress');
            if (sub) {
                sub.classList.remove('step-hidden');
                sub.classList.add('step-reveal');
            }
            host.style.display = 'none';
            // For Photo mode, prefer geolocation pre-fill; for Type mode, just reveal manual
            if (_captureMode === 'photo') {
                try { prefillCaptureLocation(); } catch(e) {}
            }
            setTimeout(() => {
                const inp = document.getElementById('address');
                if (inp) inp.focus();
            }, 100);
        };
        host.style.display = '';
        host.appendChild(btn);
    }

    function _hideLocReveal() {
        const host = document.getElementById('ncLocRevealHost');
        if (host) host.style.display = 'none';
    }

    // ---- Geo chip for "I'm here" mode --------------------------
    function _showGeoChip(addressText) {
        const sub = document.getElementById('subAddress');
        if (!sub) return;
        let chip = document.getElementById('ncGeoChip');
        if (!chip) {
            chip = document.createElement('div');
            chip.id = 'ncGeoChip';
            chip.className = 'nc-geo-chip';
            sub.insertBefore(chip, sub.firstChild);
        }
        chip.innerHTML = '<span>📍 Your location</span>' +
            '<button type="button" class="nc-geo-edit">Edit</button>';
        chip.querySelector('.nc-geo-edit').onclick = function() {
            const inp = document.getElementById('address');
            if (inp) { inp.removeAttribute('readonly'); inp.focus(); inp.select(); }
            chip.remove();
        };
        const inp = document.getElementById('address');
        if (inp && addressText) inp.value = addressText;
        if (inp) inp.setAttribute('readonly', 'true');
    }

    function _hideGeoChip() {
        const chip = document.getElementById('ncGeoChip');
        if (chip) chip.remove();
        const inp = document.getElementById('address');
        if (inp) inp.removeAttribute('readonly');
    }

    // ---- Mode-specific address visibility ----------------------
    function _applyModeAddressUI(mode) {
        const subAddress = document.getElementById('subAddress');
        _hideLocReveal();
        _hideGeoChip();

        if (mode === 'photo') {
            // Hidden by default — show "Show location" link under note
            if (subAddress) { subAddress.classList.add('step-hidden'); subAddress.classList.remove('step-reveal'); }
            _ensureLocReveal('Show location');
        } else if (mode === 'link') {
            // No address UI at all — backend infers from OG
            if (subAddress) { subAddress.classList.add('step-hidden'); subAddress.classList.remove('step-reveal'); }
        } else if (mode === 'here') {
            // Always visible, geolocation requested immediately
            if (subAddress) { subAddress.classList.remove('step-hidden'); subAddress.classList.add('step-reveal'); }
            _requestHereGeo();
        } else if (mode === 'type') {
            // Hidden by default — show "+ Add location" link
            if (subAddress) { subAddress.classList.add('step-hidden'); subAddress.classList.remove('step-reveal'); }
            _ensureLocReveal('+ Add location');
        }
    }

    function _requestHereGeo() {
        if (!navigator.geolocation) {
            // No geo at all — fall back to manual input visible
            return;
        }
        const locStatus = document.getElementById('locationStatus');
        if (locStatus) locStatus.textContent = '📍 Detecting location...';
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            const latField = document.getElementById('userLat');
            const lngField = document.getElementById('userLng');
            if (latField) latField.value = lat;
            if (lngField) lngField.value = lng;
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
                    { headers: { 'Accept-Language': 'en' } }
                );
                const data = await res.json();
                const a = data.address || {};
                const parts = [a.road, a.suburb || a.neighbourhood, a.city || a.town || a.village, a.country].filter(Boolean);
                const formatted = parts.join(', ');
                _showGeoChip(formatted);
            } catch (e) {
                _showGeoChip('Current location');
            }
            if (locStatus) locStatus.textContent = '';
        }, () => {
            // Permission denied — leave manual address input visible (no chip)
            if (locStatus) locStatus.textContent = '';
        }, { timeout: 8000 });
    }

    // ---- Override the entry-chip selection ---------------------
    const _origSelectEntryChip = window.selectEntryChip;
    window.selectEntryChip = function(chip) {
        _captureMode = chip;
        try { localStorage.setItem('odin_entry_chip', chip); } catch(e) {}

        // Visual active state on the cards
        document.querySelectorAll('.entry-card').forEach(el => el.classList.remove('active'));
        const activeChip = document.querySelector(`.entry-card[data-chip="${chip}"]`);
        if (activeChip) activeChip.classList.add('active');

        // Show/hide step 1 zones (URL bar / photo picker) — same as before
        const urlHeroBar = document.getElementById('urlHeroBar');
        const photoPickZone = document.getElementById('photoPickZone');
        if (chip === 'link') {
            if (urlHeroBar) urlHeroBar.classList.remove('hidden');
            if (photoPickZone) photoPickZone.classList.add('hidden');
            const urlInput = document.getElementById('url');
            if (urlInput) setTimeout(() => urlInput.focus(), 50);
        } else if (chip === 'photo') {
            if (urlHeroBar) urlHeroBar.classList.add('hidden');
            if (photoPickZone) photoPickZone.classList.remove('hidden');
        } else {
            if (urlHeroBar) urlHeroBar.classList.add('hidden');
            if (photoPickZone) photoPickZone.classList.add('hidden');
        }

        // Reveal wStep2 + skip title/category — go straight to Note
        const wStep2 = document.getElementById('wStep2');
        if (wStep2) {
            wStep2.classList.remove('step-hidden');
            wStep2.classList.add('step-reveal');
        }
        const subNote = document.getElementById('subNote');
        if (subNote) {
            subNote.classList.remove('step-hidden');
            subNote.classList.add('step-reveal');
        }
        const subPrivacy = document.getElementById('subPrivacy');
        if (subPrivacy) {
            subPrivacy.classList.remove('step-hidden');
            subPrivacy.classList.add('step-reveal');
        }
        const subPhoto = document.getElementById('subPhoto');
        if (subPhoto && chip !== 'link') {
            subPhoto.classList.remove('step-hidden');
            subPhoto.classList.add('step-reveal');
        }

        // Default privacy = Only me (re-assert in case user toggled before)
        const privInput = document.getElementById('privateToggle');
        const visField = document.getElementById('visibilityValue');
        if (privInput) privInput.value = 'true';
        if (visField) visField.value = 'private';
        document.querySelectorAll('.vis-option').forEach(el => el.classList.remove('active'));
        const privPill = document.querySelector('.vis-option[data-value="private"]');
        if (privPill) privPill.classList.add('active');

        // Apply mode-specific address UI
        _applyModeAddressUI(chip);

        // Focus the note for fast typing (except photo/link where user has another action first)
        if (chip === 'here' || chip === 'type') {
            setTimeout(() => {
                const note = document.getElementById('personalNote');
                if (note) note.focus();
            }, 200);
        }

        // Update step indicator
        if (typeof updateAddStep === 'function') updateAddStep(2);
    };

    // ---- Validate + inject capture_mode on submit --------------
    const _origSubmit = window.submitDiscovery;
    window.submitDiscovery = async function(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!currentUser) { alert('Please login first'); return; }

        // Resolve mode (fall back to localStorage / 'type')
        if (!_captureMode) {
            try { _captureMode = localStorage.getItem('odin_entry_chip') || 'type'; } catch(_) { _captureMode = 'type'; }
        }
        let mode = _captureMode;

        // Note: required, min 10 chars
        const noteEl = document.getElementById('personalNote');
        const note = (noteEl?.value || '').trim();
        if (note.length < 5) {
            if (noteEl) {
                noteEl.focus();
                noteEl.style.borderColor = '#7B2D45';
                noteEl.style.boxShadow = '0 0 0 2px rgba(123,45,69,0.15)';
                noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (typeof showToast === 'function') {
                showToast('Add a few more words — even one line helps your circle.', 4000);
            }
            const formMsg = document.getElementById('formMessage');
            if (formMsg) formMsg.innerHTML =
                '<p style="color:#7B2D45;font-size:13px;margin:0 0 8px;">Add a few more words — even one line helps your circle.</p>';
            setTimeout(() => {
                if (noteEl) { noteEl.style.borderColor = ''; noteEl.style.boxShadow = ''; }
            }, 2500);
            return;
        }
        const formMsg = document.getElementById('formMessage');
        if (formMsg) formMsg.innerHTML = '';

        // "I'm here" with no address + no manual entry -> soft-fallback to 'type' mode
        const addrVal = (document.getElementById('address')?.value || '').trim();
        if (mode === 'here' && !addrVal) {
            mode = 'type';
            _captureMode = 'type';
            try { localStorage.setItem('odin_entry_chip', 'type'); } catch(_) {}
            if (typeof showToast === 'function') {
                showToast('Saved without location — geo unavailable.', 4000);
            }
        }

        // Title is no longer user-facing — backend resolves it.
        // Force the field empty so the legacy auto-generate path doesn't fire either way.
        const titleField = document.getElementById('title');
        if (titleField) titleField.value = '';

        // Read + compress photo (kept inline so we can shape the payload here)
        let photoBase64 = null;
        const _pgEl = document.getElementById('photoGallery');
        const _pcEl = document.getElementById('photoCamera');
        const photoFile = (_pgEl && _pgEl.files && _pgEl.files[0]) || (_pcEl && _pcEl.files && _pcEl.files[0]) || null;
        if (photoFile) {
            photoBase64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        const MAX = 1200;
                        let w = img.width, h = img.height;
                        if (w > MAX || h > MAX) {
                            if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
                            else        { w = Math.round(w * MAX / h); h = MAX; }
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                        resolve(dataUrl.split(',')[1]);
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(photoFile);
            });
        }

        const visibilityVal = document.getElementById('visibilityValue')?.value || 'private';
        const ogImageUrlEl = document.getElementById('ogImageUrl');
        const _photoSrcGlobal = (typeof _photoSource !== 'undefined') ? _photoSource : null;

        const payload = {
            capture_mode: mode,                                  // NEW
            personalNote: note,                                  // required
            description: note,                                   // back-compat for n8n nodes still reading description
            photo: photoBase64,
            photoFilename: photoFile ? photoFile.name : null,
            url: (document.getElementById('url')?.value || '').trim() || null,
            ogImageUrl: (!photoBase64 && _photoSrcGlobal === 'og') ? (ogImageUrlEl?.value || null) : null,
            address: addrVal || null,
            user_latitude: document.getElementById('userLat')?.value ? parseFloat(document.getElementById('userLat').value) : null,
            user_longitude: document.getElementById('userLng')?.value ? parseFloat(document.getElementById('userLng').value) : null,
            UserID: currentUser.id,
            familyId: currentProfile?.family_id || '37ae9f84-2d1d-4930-9765-f6f8991ae053',
            addedBy: currentProfile?.display_name || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
            visibility: visibilityVal === 'private' ? 'only_me' : visibilityVal,
            language: (currentProfile?.language || 'en')
            // INTENTIONALLY OMITTED: title, type — backend Resolve Title & Type node handles both
        };

        // Show success overlay immediately
        const overlay = document.getElementById('saveSuccessOverlay');
        const overlayBody = document.querySelector('#saveSuccessOverlay .save-success-content p');
        if (overlayBody) overlayBody.textContent = 'Your discovery has been added';
        if (overlay) overlay.classList.remove('hidden');

        // Reset form (preserve mode reset behaviour)
        const addForm = document.getElementById('addForm');
        if (addForm) addForm.reset();
        const urlEl = document.getElementById('url');
        if (urlEl) urlEl.value = '';
        try { resetOGFetchState && resetOGFetchState(); } catch(_) {}
        try { removePhoto && removePhoto(); } catch(_) {}
        // Reset hidden category (backend ignores it but keep DOM consistent)
        const catSel = document.getElementById('category');
        if (catSel) catSel.value = 'place';
        // Reset our flow state
        _captureMode = null;
        try { localStorage.removeItem('odin_entry_chip'); } catch(_) {}
        _hideLocReveal();
        _hideGeoChip();

        setTimeout(() => {
            if (overlay) overlay.classList.add('hidden');
            try { setMode('discover'); } catch(_) {}
        }, 1500);

        // Background POST
        try {
            const resp = await fetch(CAPTURE_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                console.error('Save failed — HTTP', resp.status, errText);
                if (typeof showToast === 'function') showToast('Save failed — please try again. Your entry was not stored.', 6000);
                return;
            }
            try {
                const data = await resp.json();
                if (data && data.success === false) {
                    if (typeof showToast === 'function') showToast('Save failed — please try again. Your entry was not stored.', 6000);
                }
            } catch (_) { /* non-JSON ok */ }
        } catch (err) {
            console.error('Background save failed:', err);
            if (typeof showToast === 'function') showToast('Save failed — please check your connection and try again.', 6000);
        }
    };

    // Re-init address autocomplete when address field becomes visible again.
    // The existing autocomplete attaches once on DOMContentLoaded — show/hide
    // doesn't break it because the input element itself isn't re-created.
    // Nothing to do here, but if an issue surfaces during staging QA this is the spot.
})();
