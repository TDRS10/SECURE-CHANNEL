try {
    const webpush = require('web-push');
    console.log('web-push loads OK');
    const k = webpush.generateVAPIDKeys();
    console.log('VAPID keys generated OK, publicKey length:', k.publicKey.length);
} catch (e) {
    console.log('FAILED:', e.message);
}
