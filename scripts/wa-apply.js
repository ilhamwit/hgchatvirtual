#!/usr/bin/env node
// Installs the WhatsApp number scanned on the "Koneksikan WA" page
// (EPIC-008 T-042). Run by a person in a terminal — the web app never stops
// or restarts Hermes itself.
//
//   bash scripts/wa-apply.sh          show old/new number, ask, then apply
//   bash scripts/wa-apply.sh --yes    apply without asking
//
// Steps: stop hermes-gateway → move the live session to <session>.bak-<time>
// → move <session>.pending into place → start hermes-gateway → wait until the
// bridge is connected as the new account. If anything after the stop fails,
// the old session is put back and Hermes is started again.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { configFromEnv, readAccount, bridgeStatus } = require('../lib/whatsapp');

const CONNECT_TIMEOUT_MS = Number(process.env.CHAT_WA_CONNECT_TIMEOUT_MS || 90000);
const STOP_CMD = process.env.CHAT_WA_STOP_CMD || 'systemctl --user stop hermes-gateway';
const START_CMD = process.env.CHAT_WA_START_CMD || 'systemctl --user start hermes-gateway';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const show = (a) => (a ? `+${a.phone}${a.name ? ` (${a.name})` : ''}` : '(tidak ada)');

function run(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', cmd], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`"${cmd}" gagal (kode ${code})`))));
  });
}

// No answer (closed stdin, Ctrl-D) counts as "no".
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.on('close', () => { if (!answered) { process.stdout.write('\n'); resolve(''); } });
    rl.question(question, (a) => { answered = true; rl.close(); resolve(a.trim().toLowerCase()); });
  });
}

function audit(event, detail) {
  try {
    const { openDb } = require('../lib/db');
    const db = openDb();
    require('../lib/audit').record(db, { event, username: os.userInfo().username, ip: 'cli', detail });
    db.close();
  } catch (e) {
    console.warn('(audit log tidak tertulis: ' + e.message + ')');
  }
}

async function waitFor(cfg, id) {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const live = readAccount(cfg.sessionDir);
    if (live && live.id === id && (await bridgeStatus(cfg.bridgeUrl)) === 'connected') return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function main(argv) {
  const cfg = configFromEnv();
  const pending = readAccount(cfg.pendingDir);
  const live = readAccount(cfg.sessionDir);
  if (!pending) {
    console.log('Tidak ada nomor baru yang menunggu dipasang.');
    console.log('Buka HG Chat → WhatsApp Agent → Koneksikan WA, lalu scan QR-nya dulu.');
    return 1;
  }
  console.log(`Nomor sekarang : ${show(live)}`);
  console.log(`Nomor baru     : ${show(pending)}`);
  if (live && live.id === pending.id) {
    fs.rmSync(cfg.pendingDir, { recursive: true, force: true });
    console.log('Nomor baru sama dengan yang sedang aktif — tidak ada yang diubah.');
    return 0;
  }
  if (!argv.includes('--yes')) {
    const a = await ask('Pasang nomor baru? Hermes akan restart (WhatsApp & Telegram terputus ±10–20 detik) [y/N] ');
    if (a !== 'y' && a !== 'ya' && a !== 'yes') { console.log('Dibatalkan. Tidak ada yang diubah.'); return 1; }
  }

  const backup = `${cfg.sessionDir}.bak-${stamp()}`;
  let stopped = false;
  let swapped = false;
  try {
    console.log('\n==> Menghentikan hermes-gateway');
    await run(STOP_CMD);
    stopped = true;
    console.log('==> Mengganti sesi WhatsApp (lama disimpan di ' + path.basename(backup) + ')');
    if (fs.existsSync(cfg.sessionDir)) fs.renameSync(cfg.sessionDir, backup);
    fs.renameSync(cfg.pendingDir, cfg.sessionDir);
    fs.chmodSync(cfg.sessionDir, 0o700);
    swapped = true;
    console.log('==> Menyalakan hermes-gateway');
    await run(START_CMD);
    console.log(`==> Menunggu bridge tersambung sebagai ${show(pending)} (maks ${Math.round(CONNECT_TIMEOUT_MS / 1000)} dtk)`);
    if (!(await waitFor(cfg, pending.id))) throw new Error('bridge tidak tersambung dengan nomor baru');
  } catch (err) {
    console.error(`\nGAGAL: ${err.message}`);
    if (stopped) {
      try {
        if (swapped) {
          await run(STOP_CMD).catch(() => {});
          fs.renameSync(cfg.sessionDir, `${cfg.sessionDir}.failed-${stamp()}`);
          if (fs.existsSync(backup)) fs.renameSync(backup, cfg.sessionDir);
        }
        await run(START_CMD);
        console.error('Nomor lama dipulihkan dan hermes-gateway dinyalakan lagi.');
      } catch (e2) {
        console.error('PERHATIAN: pemulihan juga gagal (' + e2.message + '). Periksa: systemctl --user status hermes-gateway');
      }
    }
    audit('wa_apply_failed', err.message);
    return 2;
  }
  audit('wa_number_changed', `${show(live)} -> ${show(pending)}; backup ${path.basename(backup)}`);
  console.log(`\nOK — WhatsApp Hermes sekarang memakai ${show(pending)}.`);
  console.log(`Sesi lama: ${backup}`);
  console.log('Jangan lupa hapus perangkat "Hermes Agent" dari Perangkat Tertaut di HP nomor lama.');
  return 0;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
  console.error('wa-apply error: ' + err.message);
  process.exit(1);
});
