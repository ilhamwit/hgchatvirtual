// EPIC-008: WhatsApp sidebar wiring. There is no browser in CI, so this
// checks the static contract between index.html and app.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
// The owner's order (2026-10-18): no dropdown, no Inbox.
const ITEMS = [['groups', 'Pilih Group', 'waGroupsPage'], ['summary', 'Summary Chat', 'waSummaryPage'], ['connect', 'Koneksikan WA', 'waConnect']];

test('sidebar shows the WhatsApp items directly, in order, above Tools', () => {
  const section = html.slice(html.indexOf('<div class="sb-label">WhatsApp</div>'), html.indexOf('<div class="sb-label">Tools</div>'));
  assert.ok(section.length > 0, 'WhatsApp section exists above Tools');
  const order = [...section.matchAll(/<div class="nav-item" data-wa="(\w+)" onclick="openWaPage\('(\w+)'\)">[\s\S]*?<\/span>\s*([^<]+?)\s*<\/div>/g)]
    .map((m) => [m[1], m[3], m[1] === m[2]]);
  assert.deepStrictEqual(order, ITEMS.map(([k, label]) => [k, label, true]));
  assert.doesNotMatch(html + js, /toggleWaMenu|waSub|nav-group|data-wa="inbox"/, 'no dropdown, no Inbox');
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
  assert.match(html, /<span class="wa-crumb" id="waCrumb">WhatsApp<\/span>/);
});

test('chat navigation closes a WhatsApp page; reload on #wa-<page> reopens it', () => {
  assert.match(js, /function navClick\(el\) \{\n  showChatView\(\);/);
  assert.match(js, /function switchAgent\(id\) \{[\s\S]{0,120}showChatView\(\);/);
  assert.match(js, /\.then\(\(\) => switchAgent\('dave'\)\)\.then\(openWaFromHash\)/);
  for (const fn of ['openWaPage', 'showChatView', 'openWaFromHash']) {
    assert.match(js, new RegExp(`function ${fn}\\(`), fn);
  }
});

// EPIC-009: the Schedule item opens Jadwal & Meeting (calendar + events).
test('sidebar Schedule opens Jadwal & Meeting at #schedule', () => {
  assert.match(html, /<div class="nav-item" data-wa="schedule" onclick="openWaPage\('schedule'\)">[\s\S]*?<\/span>\s*Schedule\s*<\/div>/);
  assert.match(js, /\bschedule: \{ title: 'Jadwal & Meeting', crumb: 'Schedule', hash: 'schedule' \}/);
  assert.match(js, /\bschedule: \{ el: 'schedulePage', open: schOpen, close: schClose \}/);
  assert.match(html, /<div class="wa-page wa-full hidden" id="schedulePage">/);
  assert.match(html, /id="waCrumb"/);
  assert.doesNotMatch(js, /\/api\/schedule\/jobs/, 'the cron page is gone');
});

test('nothing is sent to a group without the confirm step', () => {
  // The only call to .../send is schSend(), reached from the "Ya, kirim sekarang" button.
  assert.deepStrictEqual(js.match(/\/send`\)/g), ['/send`)']);
  assert.match(js, /onclick="schSend\(\)">Ya, kirim sekarang<\/button>/);
  assert.strictEqual((js.match(/schSend\(\)/g) || []).length, 2, 'defined once, called once');
});

// EPIC-010: Task Focus opens my focus / team board; the badge is real.
test('sidebar Task Focus opens #tasks with a real badge', () => {
  assert.match(html, /<div class="nav-item" data-wa="tasks" onclick="openWaPage\('tasks'\)">[\s\S]*?<\/span>\s*Task Focus <span class="nb hidden" id="tfBadge"><\/span>\s*<\/div>/);
  assert.match(js, /\btasks: \{ title: 'Fokus saya', crumb: 'Task Focus', hash: 'tasks' \}/);
  assert.match(js, /\btasks: \{ el: 'tasksPage', open: tfOpen, close: tfClose \}/);
  assert.match(html, /<div class="wa-page wa-full hidden" id="tasksPage">/);
  assert.match(js, /api\('GET', '\/api\/tasks\/summary'\)/);
  assert.doesNotMatch(html, /Chat &amp; Discussion <span class="nb">3<\/span>/, 'no made-up unread count');
  assert.match(html, /Chat &amp; Discussion <span class="nb hidden" id="dsBadge"><\/span>/, 'a real one instead (EPIC-012)');
});

// EPIC-011: sessions per agent with a right-click menu; files open in a viewer.
test('history is per agent with a session menu; attachments open in the viewer', () => {
  assert.match(js, /const mine = convs\.filter\(c => c\.agentId === current\.id\);/);
  assert.match(js, /oncontextmenu="histMenu\(event,'\$\{c\.id\}'\)"/);
  for (const action of ['renameConv', 'setArchived', 'deleteConv']) assert.match(js, new RegExp(`onclick="closeCtx\\(\\);${action}\\(`), action);
  assert.match(js, /await confirmDialog\(/, 'delete asks first');
  assert.match(js, /'\/api\/files\/' \+ encodeURIComponent/);
  for (const id of ['ctxMenu', 'confirmBox', 'fileViewer', 'archBanner', 'skAgent']) assert.match(html, new RegExp(`id="${id}"`), id);
});

// EPIC-012: Chat & Discussion is the team room, live over one SSE stream.
test('Chat & Discussion opens #discuss and listens to /api/stream', () => {
  assert.match(html, /<div class="nav-item" data-wa="discuss" onclick="openWaPage\('discuss'\)">/);
  assert.match(js, /\bdiscuss: \{ title: 'Diskusi tim', crumb: 'Chat & Discussion', hash: 'discuss' \}/);
  assert.match(js, /\bdiscuss: \{ el: 'discussPage', open: dsOpen, close: dsClose \}/);
  assert.match(html, /<div class="wa-page wa-full hidden" id="discussPage">/);
  assert.match(js, /new EventSource\('\/api\/stream'\)/);
  assert.match(js, /meReady\.then\(\(\) => \{ dsConnect\(\); dsRefreshSoon\(\); \}\);/, 'the badge is live on every page');
});

// EPIC-012 stage 2: agents in discussions, summaries, message -> task / event.
test('discussion stage 2 is wired: @agents, Ringkas, task and event from a message', () => {
  assert.match(js, /\.\.\.AGENTS\.filter\(\(a\) => match\(a\.id, a\.name\)\)/, 'agents are suggested after @');
  assert.match(js, /ev\.type === 'typing'/);
  assert.match(js, /onclick="dsSummary\(\)"/);
  assert.match(js, /api\('POST', `\/api\/rooms\/\$\{ds\.cur\.id\}\/summary`/);
  assert.match(js, /onclick="dsToTask\(\$\{m\.id\}\)"/);
  assert.match(js, /onclick="dsToEvent\(\$\{m\.id\}\)"/);
  assert.match(js, /if \(schPrefill\) schNew\(\);/, 'Schedule opens the form prefilled');
});

// EPIC-012 stage 3: notifications and the profile page.
test('notifications: browser on mention/DM, tab title, profile from the sidebar user', () => {
  assert.match(js, /if \(ev\.type === 'message'\) dsNotify\(ev\);/);
  assert.match(js, /new Notification\(title, /);
  assert.match(js, /document\.title = \(unread \? /);
  assert.match(html, /<div class="sb-user" onclick="openWaPage\('profile'\)"/);
  assert.match(js, /\bprofile: \{ el: 'profilePage', open: pfOpen, close: pfClose \}/);
  assert.match(js, /onclick="logout\(\)">Keluar<\/button>/, 'logout moved into the profile page');
  assert.match(html, /id="profilePage"/);
});

// EPIC-013: admins manage API keys on the profile page.
test('Integrasi API card is admin-only and shows a new key once', () => {
  assert.match(js, /st\.tab === 'keys' \? `<div class="wa-box"><h3>🔌 Integrasi API<\/h3>\$\{pfKeysHtml\(\)\}/, 'lives on the Settings page (EPIC-014)');
  assert.match(js, /api\('POST', '\/api\/integrations\/keys'/);
  assert.match(js, /tidak akan ditampilkan lagi/);
  assert.match(js, /Dibuat lewat WhatsApp/);
});

// EPIC-014: Settings is a real page for admins; own password on the profile.
test('Settings opens #settings; team accounts, keys and system; own password on Profil', () => {
  assert.match(html, /<div class="nav-item" data-wa="settings" onclick="openWaPage\('settings'\)">/);
  assert.match(js, /\bsettings: \{ title: 'Pengaturan tim', crumb: 'Settings', hash: 'settings' \}/);
  assert.match(js, /\bsettings: \{ el: 'settingsPage', open: stOpen, close: stClose \}/);
  assert.match(html, /id="settingsPage"/);
  for (const p of ['/api/settings/users', '/api/settings/status', '/api/profile/password']) assert.ok(js.includes(p), p);
  assert.match(js, /if \(!ME \|\| ME\.role !== 'admin'\) \{/, 'members get a notice, not the page');
  assert.strictEqual((html.match(/onclick="navClick\(this\)"/g) || []).length, 0, 'no decorative menu items are left');
});

// EPIC-015: Reports is a real page with a real badge.
test('Reports opens #reports with a live unread badge', () => {
  assert.match(html, /<div class="nav-item" data-wa="reports" onclick="openWaPage\('reports'\)">[\s\S]*?Reports <span class="nb hidden" id="rpBadge"><\/span>/);
  assert.doesNotMatch(html, /<span class="nb gray">5<\/span>/, 'the made-up 5 is gone');
  assert.match(js, /\breports: \{ title: 'Laporan', crumb: 'Reports', hash: 'reports' \}/);
  assert.match(js, /\breports: \{ el: 'reportsPage', open: rpOpen, close: rpClose \}/);
  assert.match(html, /<div class="wa-page wa-full hidden" id="reportsPage">/);
  assert.match(js, /api\('GET', '\/api\/reports\/unread'\)/);
  for (const k of ['performance', 'automation']) {
    assert.match(html, new RegExp(`data-wa="${k}" onclick="openWaPage\\('${k}'\\)"`), k);
    assert.match(js, new RegExp(`\\b${k}: \\{ el: '${k}Page', open: \\(\\) => soonOpen\\('${k}'\\)`), k + ' is a coming-soon page');
  }
});

// EPIC-016: the voice button and the full-screen call view.
test('voice mode: header button, full-screen view, vendored LiveKit client loaded lazily', () => {
  assert.match(html, /<button class="ch-act voice" id="voiceBtn" type="button" onclick="voiceStart\(\)"/);
  assert.match(html, /<div class="vc hidden" id="voiceView" role="dialog"/);
  assert.match(js, /s\.src = '\/vendor\/livekit-client\.umd\.min\.js'/);
  assert.match(js, /api\('POST', '\/api\/voice\/session', \{ agentId: agent\.id \}\)/);
  assert.match(js, /registerTextStreamHandler\('lk\.transcription'/, 'captions from LiveKit transcriptions');
  assert.match(js, /refreshConvs\(\)\.then\(\(\) => openConversation\(agentId, id\)\)/, 'the transcript is the chat afterwards');
});

test('voice mode: WhatsApp-call style controls (round mute, red hang-up, call clock)', () => {
  assert.match(js, /class="vc-btn mic\$\{vc\.muted \? ' muted' : ''\}" onclick="voiceMute\(\)" aria-pressed=/);
  assert.match(js, /class="vc-btn end" onclick="voiceEnd\(\)" aria-label="Akhiri panggilan"/);
  assert.match(js, /hangup: '<svg/);
  assert.match(js, /clearInterval\(vc\.timer\); vc\.timer = null; vc\.startedAt = 0;/, 'the clock stops when the call ends');
  assert.match(css, /\.vc-btn\.end\{background:#EA0038;\}/);
  assert.match(css, /\.vc-btn\{width:64px;height:64px;border-radius:50%;/);
});

// Mobile layout: drawer menu, floating history, list → detail pages.
test('mobile: menu drawer, history panel, list/detail pages, no iOS input zoom', () => {
  assert.match(html, /<button class="tb-nav" id="navBtn" type="button" onclick="toggleNav\(\)" aria-label="Buka menu"/);
  assert.match(html, /<div class="nav-scrim" id="navScrim" onclick="toggleNav\(false\)"><\/div>/);
  assert.match(html, /class="sk-close" type="button" onclick="toggleSockets\(\)"/);
  assert.match(css, /body\.nav-open \.sidebar\{transform:none;/);
  assert.match(css, /@media \(min-width:761px\) and \(max-width:1100px\)\{/, 'tablet: the history floats');
  assert.match(css, /input:not\(\[type=checkbox\]\):not\(\[type=radio\]\):not\(\[type=range\]\),select,textarea\{font-size:16px !important;\}/);
  for (const page of ['discussPage', 'waGroupsPage', 'reportsPage']) {
    assert.match(js, new RegExp(`mDetail\\('${page}', true\\)`), page + ' opens its detail');
    assert.match(js, new RegExp(`M_BACK\\("mDetail\\('${page}', false\\)"\\)`), page + ' has a back button');
    assert.match(css, new RegExp(`#${page}\\.m-detail`), page + ' hides the list while a detail is open');
  }
  assert.match(js, /if \(historyFloats\(\)\) toggleSockets\(false\);/, 'picking a session closes the floating history');
  const login = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');
  assert.match(login, /\.login-card\{width:calc\(100% - 32px\);/);
});

// EPIC-018: Virtual Office under the agents list.
test('virtual office: menu under the agents, page slot, registry, script', () => {
  assert.match(html, /<div id="sbAgents"><\/div>\s*<div class="nav-item" data-wa="office" onclick="openWaPage\('office'\)">/);
  assert.match(html, /<div class="wa-page vo-page hidden" id="officePage"><\/div>/);
  assert.match(html, /<script src="\/app\.js"><\/script>\s*<script src="\/office\.js"><\/script>/);
  assert.match(js, /office: \{ title: 'Virtual Office', crumb: 'Agents', hash: 'office' \}/);
  assert.match(js, /office: \{ el: 'officePage', open: \(\) => voOpen\(\), close: \(\) => voClose\(\) \}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.vo \*\{animation:none !important;\}\}/);
  assert.match(css, /\.vo\.chatting \.vo-stage\{right:400px;\}/, 'the chat panel sits beside the room');
});

// An inline handler looks names up on its form first: an element whose id is
// a function's name shadows that function (the office send button and task
// comments were broken this way). No id may equal a function name.
test('no element id shadows a function name', () => {
  const office = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.js'), 'utf8');
  const fns = new Set([...(js + office).matchAll(/(?:^|\s)(?:async )?function ([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  const ids = new Set([...(html + js + office).matchAll(/id="([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  // Badges are only touched from scripts, never from an inline handler inside a form.
  const clash = [...ids].filter((i) => fns.has(i) && !['rpBadge', 'tfBadge'].includes(i));
  assert.deepStrictEqual(clash, []);
});

test('WhatsApp groups: admins can take a group off the list (Pilih Group and Aurix)', () => {
  assert.match(js, /\$\{waCanHide\(\) \? `<button class="wa-btn ghost wag-hide" type="button" onclick="waHideCurrent\(\)"/);
  assert.match(js, /<input type="checkbox" id="waPurge"> Hapus juga riwayat pesannya dari Chat Center \(permanen\)/);
  const office = fs.readFileSync(path.join(__dirname, '..', 'public', 'office.js'), 'utf8');
  assert.match(office, /id="voWaHideBtn" onclick="voWaHide\(\)"/);
});
