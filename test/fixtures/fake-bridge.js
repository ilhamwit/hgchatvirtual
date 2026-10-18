// Stand-in for Hermes' `bridge.js --pair-only --pair-json --session DIR`.
// Its behaviour comes from a "fake-mode" file next to the session dir,
// because the pairing process gets a scrubbed environment:
//   scan  — QR, then "connected", writes creds.json, exits 0
//   wait  — QR, then stays up until killed
//   fail  — error event, exits 1
const fs = require('fs');
const path = require('path');
const session = process.argv[process.argv.indexOf('--session') + 1];
let mode = 'scan';
try { mode = fs.readFileSync(path.join(path.dirname(session), 'fake-mode'), 'utf8').trim(); } catch (e) { /* default */ }
const emit = (ev) => process.stdout.write(JSON.stringify({ ts: Date.now(), ...ev }) + '\n');
emit({ event: 'started', session });
if (mode === 'fail') { emit({ event: 'error', error: 'logged_out', reason: 401 }); process.exit(1); }
emit({ event: 'qr', qr: '2@fake-qr-payload,abc,def' });
if (mode === 'wait') setInterval(() => {}, 1000);
if (mode === 'scan') {
  setTimeout(() => {
    const user = { id: '628111222333:5@s.whatsapp.net', name: 'Bot Baru' };
    fs.mkdirSync(session, { recursive: true });
    fs.writeFileSync(path.join(session, 'creds.json'), JSON.stringify({ me: user }));
    emit({ event: 'connected', user });
    setTimeout(() => process.exit(0), 100);
  }, 300);
}
