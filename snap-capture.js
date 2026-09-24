// ===== SNAP & SAY CAPTURE (staging prototype) =====
// Photo + optional voice note -> n8n "snap-identify" suggests what it is ->
// person confirms or edits -> saved through the normal CAPTURE_WEBHOOK.
// Loaded after app.js; relies on its globals (currentUser, currentProfile,
// userPreferredLanguage, CAPTURE_WEBHOOK, showToast, setMode, escapeHtml).

(function () {
    const SNAP_IDENTIFY_WEBHOOK = 'https://stanmak.app.n8n.cloud/webhook/snap-identify';
    const MAX_RECORD_SECONDS = 30;
    const IDENTIFY_TIMEOUT_MS = 45000;

    // ── Copy (EN / 繁中 / 简中) ─────────────────────────────────
    const STRINGS = {
        en: {
            heroTitle: 'Snap & say',
            heroSub: 'Take a photo and say why you like it. Odin fills in the rest.',
            voiceTitle: 'Why is it good?',
            voiceSub: 'Say it like you would to a friend. Optional.',
            langs: 'Speak in 廣東話 · English · 普通話',
            tapToTalk: 'Tap to talk',
            listening: 'Listening… tap to stop',
            recorded: 'Voice note recorded',
            reRecord: 'Record again',
            skip: 'Skip, just the photo',
            next: 'Next',
            micBlocked: "Can't use the microphone here. You can type your note on the next screen.",
            working: 'Odin is working it out',
            stepPhoto: 'Reading the photo',
            stepNearby: 'Checking what’s nearby',
            stepVoice: 'Writing up your note',
            confirmTitle: 'Is this right?',
            confirmUnsure: 'Which one is it?',
            nameLabel: 'Name',
            fromPhoto: 'from photo',
            placeLabel: 'Place',
            notThisPlace: 'Not this place?',
            noneOfThese: 'None of these',
            noPlace: 'No place attached',
            noteLabel: 'Your note',
            fromVoice: 'from your voice',
            notePlaceholder: 'One line for your circle. What makes it good?',
            visLabel: 'Who can see it',
            onlyMe: 'Only me',
            friends: 'Friends',
            save: 'Save',
            cancel: 'Cancel',
            needName: 'Give it a name so your circle can recognise it.',
            needNote: 'Add a few words. Even one line helps your circle.',
            identifyFailed: "Odin couldn't work this one out. Fill in the name and save.",
            saved: 'Saved: ',
            saveFailed: 'Save failed. Your entry was not stored. Please try again.',
            saveOffline: 'Save failed. Check your connection and try again.',
            loginFirst: 'Please log in first.',
            away: 'm away',
            noVoiceText: "Couldn't catch your voice note. Type a line here instead.",
            saving: 'Saving…',
            savedTitle: 'Saved',
            savedSub: 'Your circle can find it now.',
            tryAgain: 'Try again'
        },
        'zh-TW': {
            heroTitle: '拍照＋講一句',
            heroSub: '影張相，講吓點解鍾意。其餘交畀 Odin。',
            voiceTitle: '好喺邊度？',
            voiceSub: '好似同朋友講咁講就得。可以略過。',
            langs: '可以講 廣東話 · English · 普通話',
            tapToTalk: '撳一下開始講',
            listening: '收緊音… 撳一下停',
            recorded: '已錄好語音',
            reRecord: '重新錄',
            skip: '略過，只要相',
            next: '下一步',
            micBlocked: '呢度用唔到咪高峰。下一步可以打字寫低。',
            working: 'Odin 分析緊',
            stepPhoto: '睇緊張相',
            stepNearby: '搵緊附近地方',
            stepVoice: '整理緊你嘅說話',
            confirmTitle: '係咪呢個？',
            confirmUnsure: '係邊一間？',
            nameLabel: '名稱',
            fromPhoto: '由相片讀出',
            placeLabel: '地點',
            notThisPlace: '唔係呢度？',
            noneOfThese: '都唔係',
            noPlace: '唔加地點',
            noteLabel: '你嘅推介',
            fromVoice: '由你把聲整理',
            notePlaceholder: '一句話話畀朋友知，好喺邊度？',
            visLabel: '邊個睇到',
            onlyMe: '只有我',
            friends: '朋友',
            save: '儲存',
            cancel: '取消',
            needName: '改個名，等朋友認得。',
            needNote: '寫多幾隻字，一句都好。',
            identifyFailed: 'Odin 認唔出呢個，請填名稱再儲存。',
            saved: '已儲存：',
            saveFailed: '儲存失敗，未有記錄，請再試。',
            saveOffline: '儲存失敗，請檢查網絡再試。',
            loginFirst: '請先登入。',
            away: '米',
            noVoiceText: '聽唔清楚你把聲，請喺度打一句。',
            saving: '儲存緊…',
            savedTitle: '已儲存',
            savedSub: '朋友而家搵得到。',
            tryAgain: '再試'
        },
        'zh-CN': {
            heroTitle: '拍照＋说一句',
            heroSub: '拍张照，说说为什么喜欢。其余交给 Odin。',
            voiceTitle: '好在哪里？',
            voiceSub: '像跟朋友说话一样就行。可以跳过。',
            langs: '可以说 普通话 · 廣東話 · English',
            tapToTalk: '点一下开始说',
            listening: '正在录音… 点一下停止',
            recorded: '已录好语音',
            reRecord: '重新录',
            skip: '跳过，只要照片',
            next: '下一步',
            micBlocked: '这里无法使用麦克风。下一步可以打字。',
            working: 'Odin 正在分析',
            stepPhoto: '正在看照片',
            stepNearby: '正在找附近地点',
            stepVoice: '正在整理你的话',
            confirmTitle: '是这个吗？',
            confirmUnsure: '是哪一家？',
            nameLabel: '名称',
            fromPhoto: '从照片识别',
            placeLabel: '地点',
            notThisPlace: '不是这里？',
            noneOfThese: '都不是',
            noPlace: '不加地点',
            noteLabel: '你的推荐',
            fromVoice: '根据你的语音整理',
            notePlaceholder: '一句话告诉朋友，好在哪里？',
            visLabel: '谁能看到',
            onlyMe: '仅自己',
            friends: '朋友',
            save: '保存',
            cancel: '取消',
            needName: '起个名字，方便朋友认出来。',
            needNote: '多写几个字，一句也好。',
            identifyFailed: 'Odin 没能识别，请填写名称后保存。',
            saved: '已保存：',
            saveFailed: '保存失败，未记录，请重试。',
            saveOffline: '保存失败，请检查网络后重试。',
            loginFirst: '请先登录。',
            away: '米',
            noVoiceText: '没听清你的语音，请在这里打一句。',
            saving: '正在保存…',
            savedTitle: '已保存',
            savedSub: '朋友现在可以找到了。',
            tryAgain: '重试'
        }
    };
    function lang() {
        const l = (typeof userPreferredLanguage !== 'undefined' && userPreferredLanguage) || 'en';
        return STRINGS[l] ? l : 'en';
    }
    function t(key) { return STRINGS[lang()][key] || STRINGS.en[key] || key; }
    function esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function toast(msg, ms) { if (typeof showToast === 'function') showToast(msg, ms || 4500); }

    // ── State ───────────────────────────────────────────────────
    const state = {
        photoB64: null, photoUrl: null,
        coords: null,
        audioB64: null, audioMime: null, recordSecs: 0,
        recorder: null, stream: null, chunks: [], timer: null,
        suggestion: null, chosenPlace: null, visibility: 'private'
    };

    function resetState() {
        stopRecording(true);
        if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
        Object.assign(state, {
            photoB64: null, photoUrl: null, coords: null,
            audioB64: null, audioMime: null, recordSecs: 0,
            recorder: null, stream: null, chunks: [], timer: null,
            suggestion: null, chosenPlace: null, visibility: 'private', hadVoice: false
        });
    }

    // ── Styles (injected; no styles.css changes) ────────────────
    function injectStyles() {
        if (document.getElementById('snapCaptureStyles')) return;
        const s = document.createElement('style');
        s.id = 'snapCaptureStyles';
        s.textContent = `
        .snap-hero { width: 100%; border: 0; text-align: left; cursor: pointer; background: var(--wb); color: #fff;
            border-radius: 18px; padding: 16px; display: flex; gap: 14px; align-items: center; margin: 4px 0 18px; font-family: inherit; }
        .snap-hero-ic { width: 46px; height: 46px; border-radius: 13px; background: rgba(255,255,255,.16); display: grid; place-items: center; flex: none; }
        .snap-hero strong { display: block; font-size: 17px; }
        .snap-hero span { display: block; font-size: 13px; opacity: .88; line-height: 1.4; margin-top: 2px; }
        .snap-ov { position: fixed; inset: 0; z-index: 10050; background: var(--bg); display: flex; flex-direction: column;
            padding-bottom: env(safe-area-inset-bottom, 0px); overflow-y: auto; }
        .snap-ov.hidden { display: none; }
        .snap-photo { position: relative; height: 34vh; min-height: 180px; background: #1a130d; flex: none; }
        .snap-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .snap-close { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 12px); left: 12px; width: 36px; height: 36px;
            border-radius: 50%; border: 0; background: rgba(20,14,10,.55); color: #fff; font-size: 20px; cursor: pointer; }
        .snap-body { flex: 1; background: var(--bg); border-radius: 22px 22px 0 0; margin-top: -22px; position: relative;
            padding: 20px 20px 24px; display: flex; flex-direction: column; gap: 14px; }
        .snap-h { font-family: 'DM Serif Display', Georgia, serif; font-size: 24px; margin: 0; color: var(--ink); font-weight: 400; }
        .snap-sub { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
        .snap-mic-wrap { display: grid; justify-items: center; gap: 10px; padding: 8px 0 4px; }
        .snap-mic { width: 96px; height: 96px; border-radius: 50%; border: 0; background: var(--wb); color: #fff; display: grid;
            place-items: center; cursor: pointer; position: relative; box-shadow: 0 6px 20px rgba(123,45,69,.3); }
        .snap-mic.rec::before { content: ''; position: absolute; inset: -10px; border-radius: 50%; border: 3px solid var(--wb);
            opacity: .45; animation: snapPulse 1.2s ease-out infinite; }
        @keyframes snapPulse { 0% { transform: scale(.9); opacity: .55; } 100% { transform: scale(1.28); opacity: 0; } }
        .snap-mic-label { font-size: 15px; font-weight: 600; color: var(--ink); }
        .snap-langs { font-size: 12px; color: var(--muted); background: var(--surface); border: 1px solid var(--border);
            border-radius: 999px; padding: 6px 12px; }
        .snap-timer { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--wb); font-weight: 600; min-height: 18px; }
        .snap-rec-done { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 14px; color: var(--ink); }
        .snap-rec-done button { background: none; border: 0; color: var(--wb); font: 600 14px inherit; text-decoration: underline; cursor: pointer; }
        .snap-msg { font-size: 13px; color: var(--muted); text-align: center; line-height: 1.45; }
        .snap-actions { display: flex; gap: 10px; margin-top: auto; }
        .snap-btn { flex: 1; font: 600 15px 'Inter', sans-serif; padding: 14px; border-radius: 14px; border: 1px solid var(--border);
            background: var(--surface); color: var(--ink); cursor: pointer; }
        .snap-btn.primary { background: var(--wb); border-color: var(--wb); color: #fff; }
        .snap-btn[disabled] { opacity: .45; cursor: default; }
        .snap-steps { display: grid; gap: 10px; font-size: 14px; color: var(--muted); padding: 6px 0; }
        .snap-steps div { display: flex; align-items: center; gap: 10px; }
        .snap-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--wb); border-right-color: transparent;
            animation: snapSpin .8s linear infinite; flex: none; }
        @keyframes snapSpin { to { transform: rotate(360deg); } }
        .snap-field { display: grid; gap: 6px; }
        .snap-field label, .snap-field .snap-lbl { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
        .snap-tag { text-transform: none; letter-spacing: 0; color: var(--wb); font-weight: 600; margin-left: 4px; }
        .snap-field input, .snap-field textarea { font: 400 15px 'Inter', sans-serif; padding: 11px 12px; border-radius: 12px;
            border: 1px solid var(--border); background: var(--surface); color: var(--ink); width: 100%; resize: vertical; box-sizing: border-box; }
        .snap-field input.err, .snap-field textarea.err { border-color: var(--wb); box-shadow: 0 0 0 2px rgba(123,45,69,.15); }
        .snap-place { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px;
            display: flex; justify-content: space-between; gap: 10px; align-items: center; font-size: 14px; color: var(--ink); }
        .snap-place small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
        .snap-link { background: none; border: 0; color: var(--wb); font: 600 13px 'Inter', sans-serif; cursor: pointer; padding: 0; white-space: nowrap; }
        .snap-alts { display: grid; gap: 6px; }
        .snap-alts button { text-align: left; font: 500 14px 'Inter', sans-serif; padding: 10px 12px; border-radius: 12px;
            border: 1px solid var(--border); background: var(--bg); color: var(--ink); cursor: pointer; display: flex; justify-content: space-between; gap: 8px; }
        .snap-alts button small { color: var(--muted); white-space: nowrap; }
        .snap-reason { font-size: 12px; color: var(--muted); line-height: 1.4; }
        .snap-pills { display: flex; gap: 8px; }
        .snap-pill { font: 600 13px 'Inter', sans-serif; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--border);
            background: var(--surface); color: var(--ink); cursor: pointer; }
        .snap-pill.on { background: var(--wb); border-color: var(--wb); color: #fff; }
        #appToast { z-index: 10060; }
        .snap-err { font-size: 13px; color: var(--wb); font-weight: 500; }
        .snap-hint { font-size: 13px; color: var(--muted); }
        .snap-done { flex: 1; display: grid; place-items: center; text-align: center; gap: 10px; padding: 40px 20px; }
        .snap-done-ic { width: 72px; height: 72px; border-radius: 50%; background: var(--wb); color: #fff; display: grid; place-items: center; font-size: 36px; margin: 0 auto; }
        .snap-done h2 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 28px; margin: 0; color: var(--ink); }
        .snap-done p { margin: 0; color: var(--muted); font-size: 15px; }
        .snap-ov button:focus-visible { outline: 2px solid var(--wb); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .snap-mic.rec::before, .snap-spin { animation: none; } }
        `;
        document.head.appendChild(s);
    }

    // ── Overlay shell ───────────────────────────────────────────
    let ov = null;
    function ensureOverlay() {
        if (ov) return ov;
        ov = document.createElement('div');
        ov.id = 'snapOverlay';
        ov.className = 'snap-ov hidden';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        document.body.appendChild(ov);
        return ov;
    }
    function openOverlay() { ensureOverlay().classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
    function closeOverlay() {
        if (ov) { ov.classList.add('hidden'); ov.innerHTML = ''; }
        document.body.style.overflow = '';
        resetState();
    }
    function photoHeader() {
        return `<div class="snap-photo"><img src="${state.photoUrl}" alt="">
            <button type="button" class="snap-close" id="snapClose" aria-label="${esc(t('cancel'))}">×</button></div>`;
    }
    function wireClose() {
        const c = document.getElementById('snapClose');
        if (c) c.onclick = closeOverlay;
    }

    // ── Step 0: camera + location ───────────────────────────────
    function startSnap() {
        if (typeof currentUser === 'undefined' || !currentUser) { toast(t('loginFirst')); return; }
        resetState();
        // Ask for location now so it is ready by the time the photo is taken.
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => { state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
                () => { state.coords = null; },
                { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
            );
        }
        const input = document.getElementById('snapPhotoInput');
        if (input) { input.value = ''; input.click(); }
    }

    function compressPhoto(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = reject;
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
                    resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function onPhotoChosen(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        state.photoUrl = URL.createObjectURL(file);
        openOverlay();
        renderVoiceStep();
        try {
            state.photoB64 = await compressPhoto(file);
        } catch (err) {
            console.error('Snap: photo compress failed', err);
            closeOverlay();
            toast(t('identifyFailed'));
        }
    }

    // ── Step 1: voice note (optional, but front and centre) ────
    const MIC_SVG = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';
    const STOP_SVG = '<svg width="30" height="30" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="#fff"/></svg>';

    function canRecord() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    }

    function renderVoiceStep(message) {
        const recorded = !!state.audioB64;
        const micArea = canRecord() && !message
            ? `<div class="snap-mic-wrap">
                    <button type="button" class="snap-mic" id="snapMic" aria-label="${esc(t('tapToTalk'))}">${MIC_SVG}</button>
                    <div class="snap-mic-label" id="snapMicLabel">${esc(t('tapToTalk'))}</div>
                    <div class="snap-timer" id="snapTimer"></div>
                    <div class="snap-langs">${esc(t('langs'))}</div>
               </div>`
            : `<p class="snap-msg">${esc(message || t('micBlocked'))}</p>`;
        const doneArea = recorded
            ? `<div class="snap-rec-done">✓ ${esc(t('recorded'))} (0:${String(state.recordSecs).padStart(2, '0')})
                   <button type="button" id="snapReRecord">${esc(t('reRecord'))}</button></div>`
            : '';
        ov.innerHTML = photoHeader() + `
            <div class="snap-body">
                <div>
                    <h2 class="snap-h">${esc(t('voiceTitle'))}</h2>
                    <p class="snap-sub">${esc(t('voiceSub'))}</p>
                </div>
                ${recorded ? doneArea : micArea}
                <div class="snap-actions">
                    <button type="button" class="snap-btn" id="snapSkip">${esc(t('skip'))}</button>
                    <button type="button" class="snap-btn primary" id="snapNext" ${recorded ? '' : 'disabled'}>${esc(t('next'))}</button>
                </div>
            </div>`;
        wireClose();
        const mic = document.getElementById('snapMic');
        if (mic) mic.onclick = () => (state.recorder ? stopRecording() : startRecording());
        const again = document.getElementById('snapReRecord');
        if (again) again.onclick = () => { state.audioB64 = null; state.recordSecs = 0; renderVoiceStep(); };
        document.getElementById('snapSkip').onclick = () => { stopRecording(true); state.audioB64 = null; identify(); };
        document.getElementById('snapNext').onclick = () => identify();
    }

    function pickMime() {
        const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
        for (const m of options) { if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; }
        return '';
    }

    async function startRecording() {
        try {
            state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.warn('Snap: mic unavailable', err);
            renderVoiceStep(t('micBlocked'));
            return;
        }
        const mime = pickMime();
        state.chunks = [];
        state.recorder = mime ? new MediaRecorder(state.stream, { mimeType: mime }) : new MediaRecorder(state.stream);
        state.recorder.ondataavailable = ev => { if (ev.data && ev.data.size) state.chunks.push(ev.data); };
        state.recorder.onstop = onRecordingStopped;
        state.recorder.start();
        state.recordSecs = 0;
        const mic = document.getElementById('snapMic');
        const label = document.getElementById('snapMicLabel');
        const timer = document.getElementById('snapTimer');
        if (mic) { mic.classList.add('rec'); mic.innerHTML = STOP_SVG; }
        if (label) label.textContent = t('listening');
        state.timer = setInterval(() => {
            state.recordSecs += 1;
            if (timer) timer.textContent = `0:${String(state.recordSecs).padStart(2, '0')} / 0:${MAX_RECORD_SECONDS}`;
            if (state.recordSecs >= MAX_RECORD_SECONDS) stopRecording();
        }, 1000);
    }

    function stopRecording(discard) {
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
        const rec = state.recorder;
        state.recorder = null;
        if (rec && rec.state !== 'inactive') {
            if (discard) rec.onstop = null;
            rec.stop();
        }
        if (state.stream) { state.stream.getTracks().forEach(tr => tr.stop()); state.stream = null; }
    }

    function onRecordingStopped() {
        const type = (state.chunks[0] && state.chunks[0].type) || pickMime() || 'audio/webm';
        const blob = new Blob(state.chunks, { type });
        state.chunks = [];
        if (!blob.size || state.recordSecs < 1) { renderVoiceStep(); return; }
        const reader = new FileReader();
        reader.onload = () => {
            state.audioB64 = String(reader.result).split(',')[1] || null;
            state.audioMime = type;
            renderVoiceStep();
        };
        reader.readAsDataURL(blob);
    }

    // ── Step 2: ask n8n what it is ──────────────────────────────
    function renderWorking() {
        ov.innerHTML = photoHeader() + `
            <div class="snap-body">
                <h2 class="snap-h">${esc(t('working'))}</h2>
                <div class="snap-steps">
                    <div><span class="snap-spin"></span>${esc(t('stepPhoto'))}</div>
                    <div><span class="snap-spin"></span>${esc(t('stepNearby'))}</div>
                    ${state.audioB64 ? `<div><span class="snap-spin"></span>${esc(t('stepVoice'))}</div>` : ''}
                </div>
            </div>`;
        wireClose();
    }

    async function waitForPhoto() {
        for (let i = 0; i < 50 && !state.photoB64; i++) await new Promise(r => setTimeout(r, 100));
        return state.photoB64;
    }

    async function identify() {
        state.hadVoice = !!state.audioB64;
        renderWorking();
        const photo = await waitForPhoto();
        if (!photo) { closeOverlay(); toast(t('identifyFailed')); return; }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);
        let data = null;
        try {
            const resp = await fetch(SNAP_IDENTIFY_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    photo,
                    audio: state.audioB64,
                    audio_mime: state.audioMime,
                    lat: state.coords ? state.coords.lat : null,
                    lng: state.coords ? state.coords.lng : null,
                    ui_language: lang()
                }),
                signal: controller.signal
            });
            data = resp.ok ? await resp.json() : null;
            if (Array.isArray(data)) data = data[0];
        } catch (err) {
            console.warn('Snap: identify failed', err);
        } finally {
            clearTimeout(timeout);
        }
        if (!ov || ov.classList.contains('hidden')) return; // closed while waiting
        if (!data || !data.suggestion) {
            toast(t('identifyFailed'), 5000);
            data = { suggestion: { category: 'place', confidence: 'low', name: '', place: null, alternatives: [], note: '' }, transcript: '' };
        }
        state.suggestion = data.suggestion;
        state.suggestion._transcript = data.transcript || '';
        state.chosenPlace = data.suggestion.place || null;
        renderConfirm(!data.suggestion.place && (data.suggestion.alternatives || []).length > 0);
    }

    // ── Step 3: confirm before saving ───────────────────────────
    function distanceText(p) {
        return (p && p.distance != null) ? `${p.distance} ${t('away')}` : '';
    }

    function renderConfirm(showAlts) {
        const s = state.suggestion;
        const unsure = !state.chosenPlace && (s.alternatives || []).length > 0;
        const place = state.chosenPlace;
        const alts = (s.alternatives || []).filter(a => !place || a.name !== place.name);
        const isPlace = s.category === 'place';
        const nameVal = document.getElementById('snapName') ? document.getElementById('snapName').value : (s.name || '');
        const noteVal = document.getElementById('snapNote') ? document.getElementById('snapNote').value : (s.note || s._transcript || '');

        const placeBlock = !isPlace ? '' : `
            <div class="snap-field">
                <span class="snap-lbl">${esc(t('placeLabel'))}</span>
                ${place ? `<div class="snap-place"><div>${esc(place.name)}<small>${esc(place.address || '')}${place.address && distanceText(place) ? ' · ' : ''}${esc(distanceText(place))}</small></div>
                    ${alts.length ? `<button type="button" class="snap-link" id="snapShowAlts">${esc(t('notThisPlace'))}</button>` : ''}</div>`
                    : `<div class="snap-place"><div>${esc(t('noPlace'))}</div></div>`}
                ${(showAlts || unsure) && alts.length ? `<div class="snap-alts">
                    ${alts.map((a, i) => `<button type="button" data-alt="${i}">${esc(a.name)}<small>${esc(distanceText(a))}</small></button>`).join('')}
                    ${place ? `<button type="button" data-alt="none">${esc(t('noneOfThese'))}</button>` : ''}
                </div>` : ''}
                ${s.reason ? `<div class="snap-reason">${esc(s.reason)}</div>` : ''}
            </div>`;

        ov.innerHTML = photoHeader() + `
            <div class="snap-body">
                <h2 class="snap-h">${esc(unsure ? t('confirmUnsure') : t('confirmTitle'))}</h2>
                <div class="snap-field">
                    <label for="snapName">${esc(t('nameLabel'))}${s.name ? `<span class="snap-tag">${esc(t('fromPhoto'))}</span>` : ''}</label>
                    <input id="snapName" type="text" maxlength="120" value="${esc(nameVal)}">
                    <div class="snap-err" id="snapNameErr" hidden></div>
                </div>
                ${placeBlock}
                <div class="snap-field">
                    <label for="snapNote">${esc(t('noteLabel'))}${s.note ? `<span class="snap-tag">${esc(t('fromVoice'))}</span>` : ''}</label>
                    <textarea id="snapNote" rows="3" maxlength="1000" placeholder="${esc(t('notePlaceholder'))}">${esc(noteVal)}</textarea>
                    ${state.hadVoice && !noteVal ? `<div class="snap-hint">${esc(t('noVoiceText'))}</div>` : ''}
                    <div class="snap-err" id="snapNoteErr" hidden></div>
                </div>
                <div class="snap-field">
                    <span class="snap-lbl">${esc(t('visLabel'))}</span>
                    <div class="snap-pills">
                        <button type="button" class="snap-pill ${state.visibility === 'private' ? 'on' : ''}" data-vis="private">${esc(t('onlyMe'))}</button>
                        <button type="button" class="snap-pill ${state.visibility === 'friends' ? 'on' : ''}" data-vis="friends">${esc(t('friends'))}</button>
                    </div>
                </div>
                <div class="snap-actions">
                    <button type="button" class="snap-btn" id="snapCancel">${esc(t('cancel'))}</button>
                    <button type="button" class="snap-btn primary" id="snapSave">${esc(t('save'))}</button>
                </div>
            </div>`;
        wireClose();

        const showBtn = document.getElementById('snapShowAlts');
        if (showBtn) showBtn.onclick = () => renderConfirm(true);
        ov.querySelectorAll('[data-alt]').forEach(b => {
            b.onclick = () => {
                const nameEl = document.getElementById('snapName');
                const prevName = state.chosenPlace ? state.chosenPlace.name : s.name;
                if (b.dataset.alt === 'none') {
                    state.chosenPlace = null;
                    s.alternatives = [];
                } else {
                    const pick = alts[Number(b.dataset.alt)];
                    if (state.chosenPlace) s.alternatives = [state.chosenPlace].concat((s.alternatives || []).filter(a => a.name !== pick.name));
                    state.chosenPlace = pick;
                    // Follow the pick unless the person already typed their own name.
                    if (nameEl && (!nameEl.value.trim() || nameEl.value.trim() === prevName)) nameEl.value = pick.name;
                }
                renderConfirm(false);
            };
        });
        ov.querySelectorAll('[data-vis]').forEach(b => {
            b.onclick = () => {
                state.visibility = b.dataset.vis;
                ov.querySelectorAll('[data-vis]').forEach(x => x.classList.toggle('on', x === b));
            };
        });
        document.getElementById('snapCancel').onclick = closeOverlay;
        document.getElementById('snapSave').onclick = save;
    }

    // Errors show inside the Snap screen, next to the field (a toast would sit behind it).
    function flagField(el, msg) {
        const err = document.getElementById(el.id + 'Err');
        if (err) { err.textContent = msg; err.hidden = false; }
        el.classList.add('err');
        el.focus();
        el.addEventListener('input', () => { el.classList.remove('err'); if (err) err.hidden = true; }, { once: true });
    }

    function renderSaving(name) {
        ov.innerHTML = `<div class="snap-done"><div><span class="snap-spin" style="width:28px;height:28px;display:inline-block"></span>
            <h2>${esc(t('saving'))}</h2><p>${esc(name)}</p></div></div>`;
    }

    function renderSaved(name) {
        ov.innerHTML = `<div class="snap-done"><div>
            <div class="snap-done-ic">✓</div>
            <h2>${esc(t('savedTitle'))}</h2>
            <p><strong>${esc(name)}</strong></p>
            <p>${esc(t('savedSub'))}</p></div></div>`;
    }

    function renderSaveFailed(msg, payload) {
        ov.innerHTML = `<div class="snap-done"><div>
            <h2>${esc(msg)}</h2>
            <div class="snap-actions" style="margin-top:20px">
                <button type="button" class="snap-btn" id="snapFailClose">${esc(t('cancel'))}</button>
                <button type="button" class="snap-btn primary" id="snapRetry">${esc(t('tryAgain'))}</button>
            </div></div></div>`;
        document.getElementById('snapFailClose').onclick = closeOverlay;
        document.getElementById('snapRetry').onclick = () => sendCapture(payload);
    }

    function finishSaved(name) {
        renderSaved(name);
        setTimeout(() => {
            closeOverlay();
            try { if (typeof setMode === 'function') setMode('discover'); } catch (_) {}
        }, 1600);
    }

    async function sendCapture(payload) {
        const name = payload.place_name;
        renderSaving(name);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        try {
            const resp = await fetch(CAPTURE_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            if (!resp.ok) { renderSaveFailed(t('saveFailed'), payload); return; }
            let data = null;
            try { data = await resp.json(); } catch (_) { /* non-JSON ok */ }
            if (data && data.success === false) { renderSaveFailed(t('saveFailed'), payload); return; }
            finishSaved(name);
        } catch (err) {
            if (err && err.name === 'AbortError') {
                // Still processing on the server: treat as saved, like the main form does.
                finishSaved(name);
                return;
            }
            console.error('Snap: save failed', err);
            renderSaveFailed(t('saveOffline'), payload);
        } finally {
            clearTimeout(timeout);
        }
    }

    // ── Step 4: save via the existing capture pipeline ─────────
    async function save() {
        const nameEl = document.getElementById('snapName');
        const noteEl = document.getElementById('snapNote');
        const name = nameEl.value.trim();
        const note = noteEl.value.trim();
        if (!name) { flagField(nameEl, t('needName')); return; }
        if (note.length < 5) { flagField(noteEl, t('needNote')); return; }

        const place = state.chosenPlace;
        const payload = {
            capture_mode: 'photo',
            personalNote: note,
            description: note,
            photos: [state.photoB64],
            photoFilenames: ['snap.jpg'],
            photo: state.photoB64,
            photoFilename: 'snap.jpg',
            url: null,
            ogImageUrl: null,
            address: place ? (place.address || null) : null,
            user_latitude: state.coords ? state.coords.lat : null,
            user_longitude: state.coords ? state.coords.lng : null,
            UserID: currentUser.id,
            familyId: (currentProfile && currentProfile.family_id) || '37ae9f84-2d1d-4930-9765-f6f8991ae053',
            addedBy: (currentProfile && currentProfile.display_name) || (currentUser.user_metadata && currentUser.user_metadata.full_name) || (currentUser.email || '').split('@')[0] || 'User',
            visibility: state.visibility === 'private' ? 'only_me' : state.visibility,
            place_name: name,
            language: (currentProfile && currentProfile.language) || 'en'
        };

        sendCapture(payload);
    }

    // ── Wire up ─────────────────────────────────────────────────
    function applyHeroCopy() {
        const title = document.getElementById('snapHeroTitle');
        const sub = document.getElementById('snapHeroSub');
        if (title) title.textContent = t('heroTitle');
        if (sub) sub.textContent = t('heroSub');
    }

    function init() {
        injectStyles();
        const btn = document.getElementById('snapHeroBtn');
        const input = document.getElementById('snapPhotoInput');
        if (!btn || !input) return;
        btn.addEventListener('click', () => { applyHeroCopy(); startSnap(); });
        input.addEventListener('change', onPhotoChosen);
        applyHeroCopy();
        document.getElementById('addTab')?.addEventListener('click', applyHeroCopy);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
