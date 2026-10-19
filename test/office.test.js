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

test('Aurix stands at the meeting table; clicking opens the WhatsApp group reader', () => {
  const html = load(AG).voScene();
  assert.ok(html.includes('<div class="vo-desk vo-aurix" data-agent="aurix"'), 'Aurix is in the room');
  assert.ok(html.includes('onclick="voPickAurix()"'));
  assert.ok(html.includes('<img src="/assets/agents/aurix-full.png" alt="Aurix">'));
  // Upright standee (turns around the vertical axis only), so it never leans into the table.
  assert.ok(html.includes('rotateZ(calc(var(--rz) * -1)) rotateX(-90deg)"><img src="/assets/agents/aurix-full.png"'));
  assert.match(src, /api\('GET', '\/api\/wa\/groups'\)/, 'same read-only archive as Pilih Group');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'agents', 'aurix.jpg')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'agents', 'aurix-full.png')));
});

// EPIC-018 T-113: three.js scene, vendored and pinned, CSS room as the fallback.
test('three.js office: vendored three 0.170.0 via the import map, loaded lazily, CSS fallback kept', () => {
  const pub = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.match(html, /<script type="importmap">\{ "imports": \{ "three": "\/vendor\/three\/three\.module\.min\.js", "three\/addons\/": "\/vendor\/three\/addons\/" \} \}<\/script>/);
  for (const f of ['three.module.min.js', 'addons/controls/OrbitControls.js', 'addons/geometries/RoundedBoxGeometry.js', 'addons/environments/RoomEnvironment.js', 'addons/renderers/CSS2DRenderer.js', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(pub, 'vendor', 'three', f)), f);
  }
  assert.match(fs.readFileSync(path.join(pub, 'vendor', 'README.txt'), 'utf8'), /three\.js 0\.170\.0/);
  assert.match(src, /import\('\/office3d\.js'\)/, 'lazy: only when the office opens');
  assert.match(src, /if \(!voWebGL\(\)\) \{ voMountCss\(stage\); return; \}/, 'no WebGL: the CSS room');
  const three = fs.readFileSync(path.join(pub, 'office3d.js'), 'utf8');
  assert.match(three, /^export \{ mount \};$/m);
  for (const api of ['setState(', 'setHot(', 'say(', 'turn(', 'zoom(', 'focus,', 'dispose()']) assert.ok(three.includes(api), api);
  assert.ok(!/https?:\/\//.test(three.replace(/\/\/[^\n]*/g, '')), 'no network URLs in the scene code');
});

test('3D office: one black suit for everyone, meeting chairs face the table, room details', () => {
  const three = fs.readFileSync(path.join(__dirname, '..', 'public', 'office3d.js'), 'utf8');
  assert.match(three, /const shirt = M\.suit;/, 'jacket and sleeves are the shared black suit');
  assert.match(three, /suit: std\('suit', \{ color: '#17181C'/);
  assert.match(three, /tie: std\('tie', \{ color: '#0B0B0D'/);
  assert.match(three, /meetChair\(3\.57 \+ dx, 0\.55, Math\.PI\); meetChair\(3\.57 \+ dx, 2\.17, 0\);/, 'backrests away from the table');
  for (const bit of ['window blinds', 'lounge corner', 'presentation TV', 'water dispenser', 'printer on a low cabinet', 'air conditioner', 'framed art', 'acoustic privacy panel']) assert.ok(three.includes(bit), bit);
});

test('Aurix under control: click him, then the floor; A* around furniture, smooth walk, Esc lets go', () => {
  const three = fs.readFileSync(path.join(__dirname, '..', 'public', 'office3d.js'), 'utf8');
  assert.match(three, /if \(id === 'aurix'\) \{ selectAurix\(!aurixSel\); return; \}/, 'clicking Aurix toggles control');
  assert.match(three, /if \(aurixSel\) \{ const q = ray\.ray\.intersectPlane\(floorPlane, new THREE\.Vector3\(\)\); if \(q\) walkTo\(q\); \}/, 'then the floor');
  assert.match(three, /function findPath\(si, sj, ti, tj\) \{   \/\/ A\*/);
  assert.match(three, /new THREE\.CatmullRomCurve3\(pts, false, 'centripetal', 0\.5\)/, 'rounded corners');
  assert.match(three, /walk\.v = walk\.v < vTarget \? Math\.min\(vTarget, walk\.v \+ 2\.6 \* dt\) : vTarget;   \/\/ ease in/);
  assert.match(three, /legs\[0\]\.rotation\.x = Math\.sin\(walkPhase\)/, 'legs swing while walking');
  assert.match(three, /localStorage\.setItem\(POS_KEY/, 'remembers where he stands');
  assert.match(src, /if \(VO\.three && VO\.three\.isAurixSelected\(\)\) \{ VO\.three\.aurixSelect\(false\); return; \}/, 'Esc lets go first');
  assert.match(src, /id="voAurixBar"/);
});
