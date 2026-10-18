// Test helpers: throwaway databases and server.js processes on free ports.
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const { openDb } = require('../lib/db');
const auth = require('../lib/auth');

const SERVER = path.join(__dirname, '..', 'server.js');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chat-center-test-'));
}

// Creates a database file with the given users ({ username, password, ... }).
async function seedDb(file, users = []) {
  const db = openDb(file);
  for (const u of users) await auth.createUser(db, u);
  db.close();
  return file;
}

// Runs server.js with exactly `env` (plus PATH/HOME/media dir). Resolves once it
// is listening ({ listening, port, stop, out }) or once it exits ({ code, out }).
// The database always defaults to a temp file: tests run in the production
// folder, and the default data/chat-center.db there is the real one.
function runServer(env, { timeoutMs = 5000 } = {}) {
  const home = tempDir();
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, HOME: home, CHAT_MEDIA_DIR: home, CHAT_DB_PATH: path.join(home, 'test.db'), ...env }
  });
  let out = '';
  let done = false;
  let timer;
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  }).finally(() => fs.rmSync(home, { recursive: true, force: true }));

  return new Promise((resolve) => {
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...result, get out() { return out; }, stop });
    };
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('server running')) finish({ listening: true, port: Number(env.CHAT_PORT) });
    });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => finish({ code }));
    timer = setTimeout(() => finish({ timeout: true }), timeoutMs);
  });
}

// Starts a production-mode server over a seeded database.
async function startServer(users, extraEnv = {}) {
  const dir = tempDir();
  const dbPath = await seedDb(path.join(dir, 'test.db'), users);
  const port = await freePort();
  const srv = await runServer({ GATEWAY_TOKEN: 'test-token', CHAT_DB_PATH: dbPath, CHAT_PORT: String(port), ...extraEnv });
  if (!srv.listening) throw new Error('server did not start:\n' + srv.out);
  const base = `http://127.0.0.1:${port}`;
  return {
    base, dbPath,
    stop: async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); },
    request: (p, opts = {}) => fetch(base + p, { redirect: 'manual', ...opts }),
    async login(username, password, headers = {}) {
      const res = await fetch(base + '/login', {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ username, password })
      });
      const setCookie = res.headers.get('set-cookie') || '';
      return { res, cookie: setCookie.split(';')[0] };
    }
  };
}

module.exports = { freePort, tempDir, seedDb, runServer, startServer };
