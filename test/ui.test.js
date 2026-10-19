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
