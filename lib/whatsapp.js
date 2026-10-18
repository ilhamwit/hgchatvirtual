// Connect or change the WhatsApp number of the Hermes gateway (EPIC-008 T-042).
//
// The web side only *pairs*; it never stops, starts or reconfigures Hermes:
//   1. Run the Hermes bridge in pairing mode (`bridge.js --pair-only
//      --pair-json`, the same mechanism the Hermes dashboard uses) against a
//      staging session dir. The live number keeps working meanwhile. Its JSON
//      events give the QR and, once scanned, the new account.
//   2. A finished pairing is left at <session>.pending. The page then shows
//      the one command that installs it: `bash scripts/wa-apply.sh`, run by a
//      person in a terminal (swap + Hermes restart + rollback live there).
// One pairing at a time; a QR left unscanned expires after 3 minutes.
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');

const PAIR_TIMEOUT_MS = 3 * 60 * 1000;
const ACTIVE = new Set(['starting', 'waiting', 'scanned']);

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

// "6281234567890:12@s.whatsapp.net" -> "6281234567890" (same rule as Hermes).
function phoneFromId(id) {
  const digits = String(id || '').split('@')[0].split(':')[0].replace(/\D+/g, '');
  return digits || null;
}

function readAccount(sessionDir) {
  try {
    const me = JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8')).me || {};
    return me.id ? { id: me.id, phone: phoneFromId(me.id), name: me.name || null } : null;
  } catch (e) {
    return null;
  }
}

// Hermes ships its own Node under ~/.hermes/tools/node-<version>-<arch>/.
function findHermesNode(hermesDir) {
  try {
    const tools = path.join(hermesDir, 'tools');
    const dirs = fs.readdirSync(tools).filter((d) => d.startsWith('node-')).sort().reverse();
    for (const d of dirs) {
      const bin = path.join(tools, d, 'bin', 'node');
      if (fs.existsSync(bin)) return bin;
    }
  } catch (e) { /* fall back below */ }
  return process.execPath;
}

function configFromEnv(env = process.env) {
  const hermesDir = env.CHAT_HERMES_HOME || path.join(os.homedir(), '.hermes');
  const bridgeDir = env.CHAT_WA_BRIDGE_DIR || path.join(hermesDir, 'hermes-agent', 'scripts', 'whatsapp-bridge');
  const sessionDir = env.CHAT_WA_SESSION_DIR || path.join(hermesDir, 'whatsapp', 'session');
  return {
    sessionDir,
    pendingDir: sessionDir + '.pending',
    bridgeDir,
    bridgeScript: env.CHAT_WA_BRIDGE_SCRIPT || path.join(bridgeDir, 'bridge.js'),
    nodeBin: env.CHAT_WA_NODE || findHermesNode(hermesDir),
    bridgeUrl: env.CHAT_WA_BRIDGE_URL || 'http://127.0.0.1:3010',
    profile: env.CHAT_WA_PROFILE || 'default'
  };
}

async function bridgeStatus(bridgeUrl) {
  try {
    const r = await fetch(bridgeUrl + '/health', { signal: AbortSignal.timeout(2000) });
    const j = await r.json();
    return j.status === 'connected' ? 'connected' : 'disconnected';
  } catch (e) {
    return 'unreachable';
  }
}

// QR text -> SVG, using the encoder that ships with the Hermes bridge
// (qrcode-terminal). Returns null if it is not available.
function qrSvg(text, bridgeDir) {
  let QRCode, Level;
  try {
    const base = path.join(bridgeDir, 'node_modules', 'qrcode-terminal', 'vendor', 'QRCode');
    QRCode = require(base);
    Level = require(path.join(base, 'QRErrorCorrectLevel'));
  } catch (e) {
    return null;
  }
  const qr = new QRCode(-1, Level.L);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet},${r + quiet}h1v1h-1z`;
  }
  const size = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function createWhatsApp(options = {}) {
  const cfg = { ...configFromEnv(), ...options };
  const onEvent = options.onEvent || (() => {});
  const timeoutMs = options.pairTimeoutMs || PAIR_TIMEOUT_MS;
  let state = { status: 'idle' };

  // Staging dirs from a pairing that was interrupted by a restart are ours
  // and useless now (Hermes never reads <session>.pairing-*).
  try {
    const dir = path.dirname(cfg.sessionDir);
    const prefix = path.basename(cfg.sessionDir) + '.pairing-';
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(prefix)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  } catch (e) { /* session dir not created yet */ }
  let proc = null;
  let timer = null;

  const set = (patch) => { state = { ...state, ...patch }; };
  const removeDir = (dir) => { if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } };

  function stopProcess() {
    clearTimeout(timer);
    timer = null;
    const p = proc;
    proc = null;
    if (p && p.exitCode === null) {
      try { process.kill(-p.pid, 'SIGTERM'); } catch (e) { try { p.kill('SIGTERM'); } catch (e2) { /* gone */ } }
    }
  }

  function fail(message) {
    set({ status: 'error', error: message, qr: null, finishedAt: Date.now() });
    onEvent('wa_pair_failed', state.startedBy, message);
  }

  // Pairing finished and the bridge saved its credentials: park them as the
  // pending session for scripts/wa-apply.sh.
  function finishPaired(staging) {
    const account = readAccount(staging);
    if (!account) {
      removeDir(staging);
      return fail('Pairing selesai tetapi kredensial baru tidak tersimpan. Coba lagi.');
    }
    removeDir(cfg.pendingDir); // a newer scan replaces an older, unapplied one
    fs.renameSync(staging, cfg.pendingDir);
    fs.chmodSync(cfg.pendingDir, 0o700);
    set({ status: 'ready', qr: null, account: { phone: account.phone, name: account.name }, finishedAt: Date.now() });
    onEvent('wa_pair_scanned', state.startedBy, account.phone || account.id);
  }

  function start(by) {
    if (ACTIVE.has(state.status)) throw Object.assign(new Error('pairing sedang berjalan'), { status: 409 });
    if (!fs.existsSync(cfg.bridgeScript)) {
      throw Object.assign(new Error('bridge WhatsApp Hermes tidak ditemukan: ' + cfg.bridgeScript), { status: 500 });
    }
    const staging = `${cfg.sessionDir}.pairing-${stamp()}`;
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    state = { status: 'starting', startedBy: by, startedAt: Date.now(), staging, qr: null, qrAt: null, account: null, error: null };
    onEvent('wa_pair_started', by, null);

    const mine = spawn(cfg.nodeBin, [cfg.bridgeScript, '--pair-only', '--pair-json', '--session', staging], {
      cwd: path.dirname(cfg.bridgeScript), // the bridge resolves its node_modules from here
      env: {
        PATH: path.dirname(cfg.nodeBin) + ':' + (process.env.PATH || '/usr/bin:/bin'),
        HOME: os.homedir(),
        WHATSAPP_MODE: 'bot',
        WHATSAPP_DM_POLICY: 'pairing'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    proc = mine;
    readline.createInterface({ input: mine.stdout }).on('line', (line) => {
      if (proc !== mine) return;
      let ev;
      try { ev = JSON.parse(line); } catch (e) { return; }
      if (ev.event === 'qr' && ev.qr) set({ status: 'waiting', qr: String(ev.qr), qrAt: Date.now(), error: null });
      else if (ev.event === 'connected') set({ status: 'scanned' });
      else if (ev.event === 'error') set({ pairError: String(ev.error || 'pairing gagal') });
    });
    mine.stderr.on('data', () => { /* Baileys logs; not needed */ });
    mine.on('error', (err) => {
      if (proc !== mine) return;
      stopProcess();
      removeDir(staging);
      fail('Gagal menjalankan bridge: ' + err.message);
    });
    mine.on('exit', (code) => {
      if (proc !== mine) return;
      proc = null;
      clearTimeout(timer);
      if (state.status === 'scanned') return finishPaired(staging);
      if (!ACTIVE.has(state.status)) return; // cancelled or expired already
      removeDir(staging);
      fail(state.pairError ? `Pairing gagal: ${state.pairError}` : `Proses pairing berhenti sebelum selesai (kode ${code}).`);
    });
    timer = setTimeout(() => {
      if (proc !== mine || state.status === 'scanned') return;
      stopProcess();
      removeDir(staging);
      set({ status: 'expired', qr: null, error: 'QR tidak dipindai dalam 3 menit.', finishedAt: Date.now() });
      onEvent('wa_pair_cancelled', state.startedBy, 'expired');
    }, timeoutMs);
    return publicState();
  }

  function cancel(by) {
    if (state.status === 'scanned') {
      throw Object.assign(new Error('QR sudah dipindai; kredensial sedang disimpan'), { status: 409 });
    }
    if (!ACTIVE.has(state.status)) return publicState();
    stopProcess();
    removeDir(state.staging);
    set({ status: 'cancelled', qr: null, finishedAt: Date.now() });
    onEvent('wa_pair_cancelled', by, null);
    return publicState();
  }

  function publicState() {
    const s = state;
    return {
      status: s.status,
      startedBy: s.startedBy || null,
      startedAt: s.startedAt || null,
      finishedAt: s.finishedAt || null,
      account: s.account || null,
      error: s.error || null,
      qrSvg: s.status === 'waiting' && s.qr ? qrSvg(s.qr, cfg.bridgeDir) : null,
      qrAt: s.status === 'waiting' ? s.qrAt : null
    };
  }

  async function status() {
    const live = readAccount(cfg.sessionDir);
    const pending = readAccount(cfg.pendingDir);
    return {
      bridge: await bridgeStatus(cfg.bridgeUrl),
      account: live && { phone: live.phone, name: live.name },
      // A scanned number waiting for `bash scripts/wa-apply.sh` (survives restarts).
      pending: pending && { phone: pending.phone, name: pending.name },
      applyCommand: 'bash "' + path.resolve(__dirname, '..', 'scripts', 'wa-apply.sh') + '"',
      profile: cfg.profile,
      pairing: publicState()
    };
  }

  return { start, cancel, status, shutdown: stopProcess, config: cfg };
}

module.exports = { createWhatsApp, phoneFromId, readAccount, qrSvg, configFromEnv, bridgeStatus, findHermesNode };
