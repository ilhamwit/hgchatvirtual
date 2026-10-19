'use strict';
// EPIC-018: the Virtual Office scene (public/office.js) rendered in a sandbox.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.js'), 'utf8');
function load(agents) {
  const ctx = {
    AGENTS: agents,
    escapeHtml: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    escapeAttr: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    Date, Math, Number, Array, String, Object,
    formatMsg: (t) => '<p>' + String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) + '</p>',
    fmtTime: () => '10.00', now: () => '10.00', renderMsgAtt: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}
const AG = ['dave', 'jaden', 'joel', 'dylan', 'nana'].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), role: 'Peran', img: `/assets/${id}.png` }));

test('every agent gets a desk that opens its chat, with its own colour', () => {
  const html = load(AG).voScene();
  for (const a of AG) {
    assert.ok(html.includes(`<div class="vo-desk" data-agent="${a.id}"`), a.id + ' desk');
    assert.ok(html.includes(`onclick="voPick('${a.id}')"`), a.id + ' click');
    assert.ok(html.includes(`<img src="${a.img}"`), a.id + ' face');
  }
  assert.strictEqual((html.match(/class="vo-desk"/g) || []).length, 5);
  assert.ok(html.includes('--ac:#3B82F6'), 'Joel is blue');
});

test('names are escaped and extra agents beyond the desks are left out', () => {
  const many = [...AG, { id: 'x6', name: '<b>Six</b>', role: 'r', img: '/a.png' }, { id: 'x7', name: 'Seven', role: 'r', img: '/b.png' }];
  const html = load(many).voScene();
  assert.ok(!html.includes('<b>Six</b>'), 'escaped');
  assert.ok(html.includes('&#60;b&#62;Six'), 'shown escaped');
  assert.ok(!html.includes('data-agent="x7"'), 'only six desk slots');
});

test('a box has five faces and a billboard undoes the camera rotation', () => {
  const ctx = load(AG);
  const box = ctx.voBox(10, 20, 30, 40, 50, 60, '#123456');
  assert.strictEqual((box.match(/<i class="vo-[tfkrl]"/g) || []).length, 5);
  assert.ok(box.includes('transform:translateZ(30px)') && box.includes('transform:translateZ(60px)'));
  assert.ok(ctx.voSprite(0, 0, 0, 10, 10, 'x').includes('rotateZ(calc(var(--rz) * -1)) rotateX(calc(var(--rx) * -1))'));
});

test('chat in the office: clicking an agent opens the panel here, messages are escaped', () => {
  assert.match(src, /function voPick\(id\) \{\n  if \(VO\.dragged\) return;\n  voChatOpen\(id\);\n\}/, 'no page switch');
  const ctx = load(AG);
  vm.runInContext("VO.chat = { agentId: 'joel', convId: 'c1', seq: 1 };", ctx);
  const mine = ctx.voMsgHtml({ role: 'user', content: '<img src=x onerror=alert(1)>\nbaris dua' });
  assert.ok(!mine.includes('<img src=x'), 'user text escaped');
  assert.ok(mine.includes('<br>baris dua'), 'line breaks kept');
  assert.ok(ctx.voMsgHtml({ role: 'assistant', content: 'hai' }).includes('<img src="/assets/joel.png"'), 'agent face on replies');
  assert.ok(ctx.voMsgHtml({ role: 'error', content: '<b>x</b>' }).includes('class="vo-mb err">⚠️ &#60;b&#62;'), 'errors escaped');
});
