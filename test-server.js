// Foreground test: start server, verify endpoints, print results, exit.
const { spawn } = require('child_process');
const http = require('http');

const child = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: '3001' },
    stdio: ['ignore', 'inherit', 'inherit']
});
child.on('error', (e) => console.log('[spawn error]', e.message));

function get(path) {
    return new Promise((resolve) => {
        http.get({ host: '127.0.0.1', port: 3001, path }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve(`${path} -> ${res.statusCode} ${body.slice(0, 80).replace(/\n/g, ' ')}`));
        }).on('error', (e) => resolve(`${path} -> ERR ${e.message}`));
    });
}

(async () => {
    await new Promise(r => setTimeout(r, 3000));
    console.log(await get('/health'));
    console.log(await get('/push-public-key'));
    console.log(await get('/manifest.json'));
    console.log(await get('/sw.js'));
    child.kill();
})();
