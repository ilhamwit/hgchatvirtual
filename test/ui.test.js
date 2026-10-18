// EPIC-008: WhatsApp Agent menu wiring. There is no browser in CI, so this
// checks the static contract between index.html and app.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const SUBMENUS = [['connect', 'Koneksikan WA'], ['groups', 'Pilih Group'], ['inbox', 'Inbox'], ['summary', 'Summary Chating']];

test('sidebar has the WhatsApp Agent group with its four submenus, in order', () => {
  assert.match(html, /id="waGroup"[^>]*onclick="toggleWaMenu\(\)"[\s\S]*?WhatsApp Agent/);
  const order = [...html.matchAll(/data-wa="(\w+)" onclick="openWaPage\('(\w+)'\)">[\s\S]*?<\/span>([^<]+)<\/div>/g)]
    .map((m) => [m[1], m[3].trim(), m[1] === m[2]]);
  assert.deepStrictEqual(order, SUBMENUS.map(([k, label]) => [k, label, true]));
  assert.ok(html.indexOf('id="waGroup"') < html.indexOf('<div class="sb-label">Tools</div>'), 'above Tools');
});

test('every submenu has a page definition in app.js', () => {
  for (const [key, label] of SUBMENUS) {
    assert.match(js, new RegExp(`\\b${key}:\\s*\\{ title: '${label}'`), key);
  }
});

test('the page container lives in .main next to the chat, hidden at start', () => {
  const main = html.slice(html.indexOf('<div class="main">'));
  assert.ok(main.indexOf('class="chat"') < main.indexOf('id="waView"'));
  assert.match(html, /<div class="wa-view hidden" id="waView">/);
  for (const id of ['waTitle', 'waCardTitle', 'waDesc', 'waIcon']) assert.match(html, new RegExp(`id="${id}"`));
});

test('chat navigation closes a WhatsApp page; reload on #wa-<page> reopens it', () => {
  assert.match(js, /function navClick\(el\) \{\n  showChatView\(\);/);
  assert.match(js, /function switchAgent\(id\) \{[\s\S]{0,120}showChatView\(\);/);
  assert.match(js, /\.then\(\(\) => switchAgent\('dave'\)\)\.then\(openWaFromHash\)/);
  for (const fn of ['toggleWaMenu', 'openWaPage', 'showChatView', 'openWaFromHash']) {
    assert.match(js, new RegExp(`function ${fn}\\(`), fn);
  }
});
