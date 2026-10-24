// Service Worker — Secure Channel
const CACHE = 'secure-channel-v1';
const ASSETS = ['/', '/index.html', '/style.css', '/script.js', '/manifest.json'];

// Install: cache app shell
self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch: network-first for navigation & API, cache fallback for shell
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.mode === 'navigate') {
        e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
        return;
    }
    if (url.origin !== location.origin) return; // let CDN/socket.io pass through
    e.respondWith(
        fetch(e.request)
            .then((res) => {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(e.request, copy));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});

// ---- Push Notifications (admin -> user) ----
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) {}
    event.waitUntil(
        self.registration.showNotification(data.title || '🔐 القناة الآمنة', {
            body: data.body || 'لديك تحديث جديد',
            icon: data.icon || undefined,
            badge: data.badge || undefined,
            data: { url: data.url || '/' },
            vibrate: [100, 50, 100]
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const client of list) {
                if ('focus' in client) return client.focus();
            }
            return clients.openWindow(target);
        })
    );
});

// ---- Periodic Background Sync: keep location updating when browser wakes us ----
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'location-sync') {
        event.waitUntil(
            (async () => {
                // Ask any open client to send a fresh location fix
                const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
                all.forEach((c) => c.postMessage({ type: 'SEND_LOCATION_NOW' }));
            })()
        );
    }
});
