// EPIC-000 T-004: server.js must refuse to start with missing or invalid
// config, and start normally in explicit dev mode.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');

const SERVER = path.join(__dirname, '..', 'server.js');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Runs server.js with exactly `env` (plus PATH/HOME) and resolves with its exit
// code and output, or with { listening: true } once it prints its banner.
function run(env) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-center-test-'));
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, HOME: home, CHAT_MEDIA_DIR: home, ...env }
  });
  let out = '';
  let done = false;
  let timer;
  return new Promise((resolve) => {
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      fs.rmSync(home, { recursive: true, force: true });
      resolve({ ...result, out });
    };
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('server running')) finish({ listening: true });
    });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => finish({ code }));
    timer = setTimeout(() => finish({ timeout: true }), 5000);
  });
}

const PROD_ENV = { GATEWAY_TOKEN: 'test-token', CHAT_USER: 'u', CHAT_PASS: 'p', CHAT_SECRET: 's' };

test('refuses to start without required env and names the missing variables', async () => {
  const r = await run({ CHAT_PORT: String(await freePort()) });
  assert.strictEqual(r.code, 1);
  for (const k of ['GATEWAY_TOKEN', 'CHAT_USER', 'CHAT_PASS', 'CHAT_SECRET']) assert.match(r.out, new RegExp(k));
});

test('names only the variable that is missing', async () => {
  const { GATEWAY_TOKEN, ...rest } = PROD_ENV;
  const r = await run({ ...rest, CHAT_PORT: String(await freePort()) });
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /missing required env GATEWAY_TOKEN /);
});

test('rejects a non-numeric port', async () => {
  const r = await run({ ...PROD_ENV, CHAT_PORT: 'eighty' });
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /CHAT_PORT must be an integer/);
});

test('starts with complete production env', async () => {
  const r = await run({ ...PROD_ENV, CHAT_PORT: String(await freePort()) });
  assert.ok(r.listening, r.out);
});

test('starts in CHAT_DEV=1 mode with nothing else set', async () => {
  const r = await run({ CHAT_DEV: '1', CHAT_PORT: String(await freePort()) });
  assert.ok(r.listening, r.out);
});
