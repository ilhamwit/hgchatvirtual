// EPIC-008: WhatsApp sidebar wiring. There is no browser in CI, so this
// checks the static contract between index.html and app.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
// The owner's order (2026-10-18): no dropdown, no Inbox.
const ITEMS = [['groups', 'Pilih Group', 'waGroupsPage'], ['summary', 'Summary Chat', 'waSummaryPage'], ['connect', 'Koneksikan WA', 'waConnect']];

test('sidebar shows the WhatsApp items directly, in order, above Tools', () => {
  const section = html.slice(html.indexOf('<div class="sb-label">WhatsApp</div>'), html.indexOf('<div class="sb-label">Tools</div>'));
  assert.ok(section.length > 0, 'WhatsApp section exists above Tools');
  const order = [...section.matchAll(/<div class="nav-item" data-wa="(\w+)" onclick="openWaPage\('(\w+)'\)">[\s\S]*?<\/span>\s*([^<]+?)\s*<\/div>/g)]
    .map((m) => [m[1], m[3], m[1] === m[2]]);
  assert.deepStrictEqual(order, ITEMS.map(([k, label]) => [k, label, true]));
  assert.doesNotMatch(html + js, /toggleWaMenu|waSub|nav-group|data-wa="inbox"|Segera hadir/, 'no dropdown, no Inbox, no placeholder');
});

test('every item has a title and a page container wired in app.js', () => {
  for (const [key, label, el] of ITEMS) {
    assert.match(js, new RegExp(`\\b${key}: \\{ title: '${label}' \\}`), key);
    assert.match(js, new RegExp(`\\b${key}: \\{ el: '${el}', open: \\w+, close: \\w+ \\}`), key);
    assert.match(html, new RegExp(`id="${el}"`), el);
  }
});

test('the WhatsApp view lives in .main next to the chat, hidden at start', () => {
  const main = html.slice(html.indexOf('<div class="main">'));
  assert.ok(main.indexOf('class="chat"') < main.indexOf('id="waView"'));
  assert.match(html, /<div class="wa-view hidden" id="waView">/);
  assert.match(html, /<span class="wa-crumb">WhatsApp<\/span>/);
});

test('chat navigation closes a WhatsApp page; reload on #wa-<page> reopens it', () => {
  assert.match(js, /function navClick\(el\) \{\n  showChatView\(\);/);
  assert.match(js, /function switchAgent\(id\) \{[\s\S]{0,120}showChatView\(\);/);
  assert.match(js, /\.then\(\(\) => switchAgent\('dave'\)\)\.then\(openWaFromHash\)/);
  for (const fn of ['openWaPage', 'showChatView', 'openWaFromHash']) {
    assert.match(js, new RegExp(`function ${fn}\\(`), fn);
  }
});
