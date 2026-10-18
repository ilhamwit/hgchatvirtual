#!/usr/bin/env node
// Account admin for Chat Center (EPIC-001 T-010). Works on the same SQLite
// file as the server (CHAT_DB_PATH, default data/chat-center.db), and the
// running server sees changes immediately.
//
// Passwords are never taken as arguments (they would land in shell history):
// they are prompted for with echo off, or read from the first line of stdin.
const { openDb } = require('../lib/db');
const os = require('os');
const auth = require('../lib/auth');
const audit = require('../lib/audit');

const USAGE = `Usage: node scripts/users.js <command> [args]

  add <username> [--name "Display Name"] [--admin]   create a user (prompts for password)
  reset-password <username>                          set a new password, ends their sessions
  disable <username>                                 block login and end all sessions
  enable <username>                                  allow login again
  revoke-sessions <username>                         log the user out everywhere
  list                                               show all users
  audit [N]                                          show the last N audit events (default 30)

Database: CHAT_DB_PATH or data/chat-center.db. Pipe a password on stdin to skip the prompt.`;

function parseFlags(args) {
  const out = { positional: [], name: null, admin: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--admin') out.admin = true;
    else if (args[i] === '--name') out.name = args[++i];
    else if (args[i].startsWith('--')) throw new Error(`unknown option ${args[i]}`);
    else out.positional.push(args[i]);
  }
  return out;
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
        stderr.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        stdin.setRawMode(false); stderr.write('\n');
        reject(new Error('cancelled'));
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function readStdinLine() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { data += d; });
    process.stdin.on('end', () => resolve(data.split(/\r?\n/)[0]));
  });
}

async function askPassword() {
  if (!process.stdin.isTTY) return readStdinLine();
  const first = await promptHidden(`New password (min ${auth.MIN_PASSWORD} chars): `);
  auth.validatePassword(first);
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new Error('passwords do not match');
  return first;
}

const fmtTime = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '-');

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') { console.log(USAGE); return 0; }
  const flags = parseFlags(rest);
  const [username] = flags.positional;
  const needUser = () => { if (!username) throw new Error(`${command} needs a <username>`); };
  const db = openDb();
  // Every account change is attributed to the OS user who ran the command.
  const log = (event, detail) => audit.record(db, { event, username, ip: 'cli', detail: 'by ' + os.userInfo().username + (detail ? ', ' + detail : '') });

  switch (command) {
    case 'add': {
      needUser();
      const user = await auth.createUser(db, {
        username, displayName: flags.name || username,
        password: await askPassword(), role: flags.admin ? 'admin' : 'member'
      });
      log('user_added', user.role);
      console.log(`created ${user.role} "${user.username}" (${user.displayName})`);
      break;
    }
    case 'reset-password':
      needUser();
      await auth.setPassword(db, username, await askPassword());
      log('password_reset');
      console.log(`password changed for "${username}"; their sessions were ended`);
      break;
    case 'disable':
      needUser();
      auth.setDisabled(db, username, true);
      log('user_disabled');
      console.log(`disabled "${username}" and ended their sessions`);
      break;
    case 'enable':
      needUser();
      auth.setDisabled(db, username, false);
      log('user_enabled');
      console.log(`enabled "${username}"`);
      break;
    case 'revoke-sessions': {
      needUser();
      const user = auth.getUserByUsername(db, username);
      if (!user) throw new Error(`no user "${username}"`);
      const n = auth.revokeUserSessions(db, user.id);
      log('sessions_revoked', n + ' session(s)');
      console.log(`ended ${n} session(s) for "${username}"`);
      break;
    }
    case 'list': {
      const users = auth.listUsers(db);
      if (!users.length) { console.log('no users yet — add one: node scripts/users.js add <username> --admin'); break; }
      const rows = users.map((u) => [u.username, u.displayName, u.role, u.disabled ? 'disabled' : 'active',
        String(u.activeSessions), fmtTime(u.lastSeen)]);
      const head = ['USERNAME', 'NAME', 'ROLE', 'STATUS', 'SESSIONS', 'LAST SEEN (UTC)'];
      const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
      for (const r of [head, ...rows]) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '));
      break;
    }
    case 'audit': {
      const n = Math.min(Math.max(parseInt(username || '30', 10) || 30, 1), 1000);
      const rows = audit.recent(db, n).reverse();
      if (!rows.length) { console.log('no audit events yet'); break; }
      for (const r of rows) {
        console.log([fmtTime(r.at), r.event.padEnd(16), (r.username || '-').padEnd(12), (r.ip || '-').padEnd(15), r.detail || ''].join('  '));
      }
      break;
    }
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => { console.error('error: ' + err.message); process.exit(1); }
);
