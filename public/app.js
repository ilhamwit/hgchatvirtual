// ─── Server API ───────────────
// The browser never talks to the agents' backend (Hermes). It calls /api/..., and the
// server stores every message and asks the agent on the user's behalf.
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('Sesi berakhir — silakan login ulang.'); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON (e.g. a proxy error page) */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ── SESSION ─────────────────────────────── */
// The server checked the login before serving this page; this only shows who
// is signed in and wires up logout.
async function loadMe() {
  try {
    const res = await fetch('/api/me');
    if (res.status === 401) { location.href = '/login'; return; }
    if (!res.ok) return;
    const me = await res.json();
    document.getElementById('sbUname').textContent = me.displayName;
    document.getElementById('sbUstatus').textContent = (me.role === 'admin' ? 'Admin · ' : '') + 'Keluar';
  } catch (e) { /* offline: keep the placeholder */ }
}

async function logout() {
  try { await fetch('/logout', { method: 'POST' }); } finally { location.href = '/login'; }
}

loadMe();

/* ── AGENTS ─────────────────────────────── */
const IMGS = {
  dave: "/assets/agents/dave.jpg",
  jaden: "/assets/agents/jaden.jpg",
  joel: "/assets/agents/joel.jpg",
  dylan: "/assets/agents/dylan.jpg",
  nana: "/assets/agents/nana.jpg",
};

const AGENTS = [
  { id:'dave', name:'Dave', role:'Operations', img:IMGS.dave, greet:"Hi! I'm Dave.", sub:'Your dedicated Relationship Manager, ready to help.' },
  { id:'jaden', name:'Jaden', role:'People', img:IMGS.jaden, greet:"Hey there! I'm Jaden.", sub:'Client Success is my mission — how can I assist?' },
  { id:'joel', name:'Joel', role:'Technology', img:IMGS.joel, greet:"I'm Joel. Let's get strategic.", sub:'Data-driven insights for smarter decisions.' },
  { id:'dylan', name:'Dylan', role:'Data', img:IMGS.dylan, greet:"Hi! Dylan here 😊", sub:'Making every interaction count — what do you need?' },
  { id:'nana', name:'Nana', role:'Finance', img:IMGS.nana, greet:"Hi, I'm Nana! ✨", sub:'Growing business together — how can I help?' }
];

let current = AGENTS[0];
let sockOpen = true;
let dropOpen = false;

function switchAgent(id) {
  const a = AGENTS.find(x=>x.id===id);
  if(!a) return;
  showChatView();
  current = a;
  document.getElementById('selImg').src = a.img;
  document.getElementById('selName').textContent = a.name;
  document.getElementById('chAviImg').src = a.img;
  document.getElementById('chName').textContent = a.name;
  document.getElementById('chRole').textContent = a.role + ' · Online';
  document.getElementById('wcPhoto').src = a.img;
  document.getElementById('wcTitle').textContent = a.greet;
  document.getElementById('wcSub').textContent = a.sub;
  loadHistoryView(a.id);
  renderDrop(); renderSb(); renderHistoryPanel(); closeDrop();
}

function toggleDrop() { dropOpen=!dropOpen; renderDrop(); }
function closeDrop() { dropOpen=false; document.getElementById('agentDrop').classList.remove('open'); }

function renderDrop() {
  const dd=document.getElementById('agentDrop');
  dd.innerHTML='<div class="drop-label">Switch Agent</div>';
  AGENTS.forEach(a=>{
    const d=document.createElement('div');
    d.className='drop-agent'+(a.id===current.id?' sel':'');
    d.onclick=()=>switchAgent(a.id);
    d.innerHTML=`<div class="drop-avi"><img src="${a.img}" alt="${a.name}"></div><div class="drop-info"><div class="drop-name">${a.name}</div><div class="drop-role">${a.role}</div></div><div class="drop-check">${a.id===current.id?'<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':''}</div>`;
    dd.appendChild(d);
  });
  dd.classList.toggle('open',dropOpen);
}

function renderSb() {
  const c=document.getElementById('sbAgents');
  c.innerHTML='';
  AGENTS.forEach(a=>{
    const d=document.createElement('div');
    d.className='sb-agent-item'+(a.id===current.id?' on':'');
    d.onclick=()=>switchAgent(a.id);
    d.innerHTML=`<div class="sb-agent-avi"><img src="${a.img}" alt="${a.name}"></div>${a.name}${a.id===current.id?'<span class="sb-online"></span>':''}`;
    c.appendChild(d);
  });
}

document.addEventListener('click',e=>{
  if(!e.target.closest('#agentSel')&&!e.target.closest('#agentDrop')) closeDrop();
});

function toggleSockets() {
  sockOpen=!sockOpen;
  document.getElementById('socketsPanel').classList.toggle('closed',!sockOpen);
  document.getElementById('sockToggleBtn').classList.toggle('on',sockOpen);
}

function navClick(el) {
  showChatView();
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('on'));
  el.classList.add('on');
}

function setTab(btn) {
  document.querySelectorAll('.tb-tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

function now() { return new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}); }

// ─── Natural message formatting (safe: escapes HTML first) ───
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Only http(s) and same-origin paths become links — never javascript:/data:.
const SAFE_URL = /^(?:https?:\/\/|\/)[^\s"'<>]+$/;
function anchor(url, label) {
  if(!SAFE_URL.test(url)) return label;
  return '<a href="'+escapeAttr(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>';
}

// Linkify, but never inside an inline <code> span.
function linkify(s) {
  return s.split(/(<code>[\s\S]*?<\/code>)/).map((part,i)=>{
    if(i % 2) return part;                                  // the <code> chunks
    // An unsafe or malformed target leaves the raw markdown alone rather than
    // silently eating the brackets.
    part = part.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g,
      (m,label,url)=>SAFE_URL.test(url) ? anchor(url,label) : m);
    part = part.replace(/(^|[\s(])(https?:\/\/[^\s"'<>]+)/g, (m,pre,url)=>{
      const tail = url.match(/[.,;:!?)\]}]+$/);             // keep trailing punctuation out of the href
      const clean = tail ? url.slice(0, -tail[0].length) : url;
      return pre + anchor(clean, clean) + (tail ? tail[0] : '');
    });
    return part;
  }).join('');
}

function renderCode(b) {
  const cls = b.lang ? ' class="lang-'+escapeAttr(b.lang)+'"' : '';
  return '<pre><code'+cls+'>'+escapeHtml(b.code)+'</code></pre>';
}

// A pipe table is a |---|---| separator line with a header row above it. The
// table rarely starts the block — agents routinely write a lead-in sentence on
// the line before it — so look for the separator anywhere, not just line two.
function sepLine(l) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
}
function findTable(lines) {
  for(let i=1;i<lines.length;i++) {
    if(sepLine(lines[i]) && lines[i-1].includes('|')) {
      let end=i+1;
      while(end<lines.length && lines[end].includes('|')) end++;
      return { start:i-1, end };
    }
  }
  return null;
}
function splitRow(l) {
  return l.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim());
}
function para(lines) { return lines.length ? '<p>'+lines.join('<br>')+'</p>' : ''; }

// Splits a block into the prose, the table, and whatever follows it.
const MD_UL = /^\s*[-•*]\s+/;
const MD_OL = /^\s*\d+[.)]\s+/;

// Lines of one block, in order: "#…" headings, runs of list items, and the
// rest as paragraphs — so "## Title" directly followed by "- item" lines
// (how agents write summaries) renders as a heading plus a list.
function renderBlock(lines) {
  if(!lines.length) return '';
  const t = findTable(lines);
  if(t) {
    return renderBlock(lines.slice(0, t.start)) +
      renderTable(lines.slice(t.start, t.end)) +
      renderBlock(lines.slice(t.end));
  }
  let html = '';
  let run = [];
  let kind = null;
  const flush = () => {
    if(!run.length) return;
    if(kind === 'ul') html += '<ul>'+run.map(l=>'<li>'+l.replace(MD_UL,'')+'</li>').join('')+'</ul>';
    else if(kind === 'ol') html += '<ol>'+run.map(l=>'<li>'+l.replace(MD_OL,'')+'</li>').join('')+'</ol>';
    else html += para(run);
    run = [];
    kind = null;
  };
  for(const l of lines) {
    const h = l.match(/^\s*(#{1,4})\s+(.+)$/);
    if(h) {
      flush();
      const level = h[1].length + 1;                        // "#" -> h2 … "####" -> h5
      html += `<h${level} class="md-h">${h[2]}</h${level}>`;
      continue;
    }
    const k = MD_UL.test(l) ? 'ul' : MD_OL.test(l) ? 'ol' : 'p';
    if(k !== kind) flush();
    kind = k;
    run.push(l);
  }
  flush();
  return html;
}

function renderTable(lines) {
  const head = splitRow(lines[0]);
  const body = lines.slice(2).filter(l=>l.includes('|')).map(splitRow);
  let h = '<div class="tbl-wrap"><table><thead><tr>' +
    head.map(c=>'<th>'+c+'</th>').join('') + '</tr></thead>';
  if(body.length) {
    h += '<tbody>' + body.map(r=>'<tr>' +
      head.map((_,i)=>'<td>'+(r[i]||'')+'</td>').join('') + '</tr>').join('') + '</tbody>';
  }
  return h + '</table></div>';
}

function formatMsg(text) {
  // Fenced code comes out first, before escaping or any inline pass, so the
  // backticks and asterisks inside it survive untouched.
  const codes = [];
  let s = String(text == null ? '' : text).replace(
    /```([A-Za-z0-9_+#.-]*)[ \t]*\r?\n?([\s\S]*?)```/g,
    (m, lang, code) => {
      codes.push({ lang: lang || '', code: code.replace(/\r?\n$/, '') });
      return '\u0000CODE' + (codes.length - 1) + '\u0000';
    }
  );
  s = escapeHtml(s).trim();
  s = s.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
  s = linkify(s);
  const blocks = s.split(/\n{2,}/);
  const html = blocks.map(block=>{
    const lines = block.split('\n').filter(l=>l.trim()!=='');
    if(!lines.length) return '';
    const solo = block.trim().match(/^\u0000CODE(\d+)\u0000$/);
    if(solo) return renderCode(codes[+solo[1]]);
    return renderBlock(lines);
  }).join('');
  // Any fence that sat mid-paragraph still needs swapping back in.
  return html.replace(/\u0000CODE(\d+)\u0000/g, (m,i)=>renderCode(codes[+i]));
}

// ─── Conversations (stored on the server, per user) ───
// One conversation = one agent + one Hermes session. Each agent shows one
// conversation at a time; "Chat baru" starts a fresh one.
let convs = [];             // the user's non-archived conversations, newest first
const activeConv = {};      // agentId -> conversation id on screen (null = new chat)
const pending = {};         // conversation id -> true while the agent is answering
let viewSeq = 0;            // bumps on every switch so late responses don't draw over

function fmtTime(ms) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

async function refreshConvs() {
  try {
    const data = await api('GET', '/api/conversations');
    convs = data.conversations;
    for (const c of convs) { if (c.pending) pending[c.id] = true; else delete pending[c.id]; }
  } catch (e) { showToast('⚠️ Gagal memuat riwayat: ' + e.message); }
  renderHistoryPanel();
}

function convIdFor(agentId) {
  if (agentId in activeConv) return activeConv[agentId];
  const latest = convs.find(c => c.agentId === agentId);
  activeConv[agentId] = latest ? latest.id : null;
  return activeConv[agentId];
}

// Draws one message. Messages are always drawn for the conversation on screen.
function addMsg(role, text, opts) {
  const o = opts || {};
  const agent = o.agent || current;
  const time = o.time || now();
  const area=document.getElementById('msgArea');
  const row=document.createElement('div');
  row.className='msg-row'+(role==='u'?' u':'');
  const html = formatMsg(text) + renderMsgAtt(o.att);
  if(role==='u') {
    row.innerHTML=`<div class="msg-avi u"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="msg-col"><div class="msg-bubble">${html}</div><div class="msg-time">${time}</div></div>`;
  } else {
    row.innerHTML=`<div class="msg-avi"><img src="${agent.img}" alt="${escapeAttr(agent.name)}"></div><div class="msg-col"><div class="msg-bubble">${html}</div><div class="msg-time">${time}</div></div>`;
  }
  const typ = document.getElementById('typRow');
  if(typ) area.insertBefore(row, typ); else area.appendChild(row);
  area.scrollTop=area.scrollHeight;
}

// A failed turn is stored as an error message. Only the latest one gets a
// retry button: retrying re-asks the last question without storing it twice.
function addErrorMsg(agent, detail, opts) {
  const o = opts || {};
  const area=document.getElementById('msgArea');
  const row=document.createElement('div');
  row.className='msg-row err';
  const retry = o.retry ? `<button class="err-retry" onclick="retryMsg(this)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>Coba lagi</button>` : '';
  row.innerHTML=`<div class="msg-avi"><img src="${agent.img}" alt="${escapeAttr(agent.name)}"></div><div class="msg-col"><div class="msg-bubble err-bubble"><div class="err-head"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Pesan tidak terkirim</div><div class="err-detail">${escapeHtml(detail)}</div>${retry}</div><div class="msg-time">${o.time || now()}</div></div>`;
  area.appendChild(row);
  area.scrollTop=area.scrollHeight;
}

function drawStored(m, agent, isLast) {
  const time = fmtTime(m.createdAt);
  if (m.role === 'user') addMsg('u', m.content, { agent, att: m.attachments, time });
  else if (m.role === 'assistant') addMsg('a', m.content, { agent, time });
  else addErrorMsg(agent, m.content, { retry: isLast, time });
}

async function retryMsg(btn) {
  const agent = current;
  const convId = activeConv[agent.id];
  if (!convId || pending[convId]) return;
  const row = btn.closest('.msg-row');
  if (row) row.remove();
  await runTurn(agent, convId, () => api('POST', '/api/conversations/' + convId + '/retry'));
}

function truncate(s,n) { s=s.replace(/\s+/g,' ').trim(); return s.length>n ? s.slice(0,n-1)+'…' : s; }

function renderHistoryPanel() {
  const body = document.getElementById('histBody');
  if(!body) return;
  const items = convs.filter(c => c.lastMessage && AGENTS.some(a => a.id === c.agentId));
  if(!items.length) {
    body.innerHTML = `<div class="hist-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C9C9D6" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <p>Belum ada riwayat percakapan.<br>Mulai chat dengan salah satu agent.</p>
    </div>`;
    return;
  }
  body.innerHTML = items.map(c=>{
    const agent = AGENTS.find(a => a.id === c.agentId);
    const last = c.lastMessage;
    const prefix = last.role==='user' ? 'Anda: ' : last.role==='error' ? '⚠️ ' : '';
    const on = agent.id===current.id && activeConv[agent.id]===c.id;
    const busy = pending[c.id] ? ' · …' : '';
    return `<div class="hist-item${on?' on':''}" onclick="openConversation('${agent.id}','${c.id}')">
      <div class="hist-avi"><img src="${agent.img}" alt="${agent.name}"></div>
      <div class="hist-info">
        <div class="hist-row1"><span class="hist-name">${agent.name}${busy}</span><span class="hist-time">${fmtTime(c.updatedAt)}</span></div>
        <div class="hist-preview"><b>${escapeHtml(truncate(c.title || 'Tanpa judul', 40))}</b><br>${escapeHtml(prefix+truncate(last.content,54))}</div>
      </div>
    </div>`;
  }).join('');
}

function openConversation(agentId, convId) {
  activeConv[agentId] = convId;
  switchAgent(agentId);
}

function newChat() {
  activeConv[current.id] = null;
  switchAgent(current.id);
  document.getElementById('chatTa').focus();
}

function showWelcome(show) {
  document.getElementById('viewWelcome').classList.toggle('hidden', !show);
  document.getElementById('viewChat').classList.toggle('hidden', show);
}

async function loadHistoryView(agentId) {
  const agent = AGENTS.find(a=>a.id===agentId) || current;
  const convId = convIdFor(agentId);
  const seq = ++viewSeq;
  document.getElementById('msgArea').innerHTML='';
  updateSendBtn();
  if (!convId) { showWelcome(true); return; }
  showWelcome(false);
  let data;
  try {
    data = await api('GET', '/api/conversations/' + convId + '/messages');
  } catch (e) {
    if (seq !== viewSeq) return;
    if (e.status === 404) { activeConv[agentId] = null; showWelcome(true); return; }
    addErrorMsg(agent, 'Gagal memuat percakapan: ' + e.message);
    return;
  }
  if (seq !== viewSeq) return;
  document.getElementById('msgArea').innerHTML='';
  if (!data.messages.length && !data.pending) { showWelcome(true); return; }
  data.messages.forEach((m, i) => drawStored(m, agent, i === data.messages.length - 1 && !data.pending));
  if (data.pending) { pending[convId] = true; showTyping(); pollUntilDone(convId); }
  else delete pending[convId];
  updateSendBtn();
}

function showTyping() {
  if(document.getElementById('typRow')) return;
  const area=document.getElementById('msgArea');
  const row=document.createElement('div');
  row.className='typing-row';row.id='typRow';
  row.innerHTML=`<div class="msg-avi"><img src="${current.img}" alt="${escapeAttr(current.name)}"></div><div class="typing-bubble"><div class="t-dot"></div><div class="t-dot"></div><div class="t-dot"></div></div>`;
  area.appendChild(row);area.scrollTop=area.scrollHeight;
}

function removeTyping() { const el=document.getElementById('typRow'); if(el) el.remove(); }

/* ── ATTACHMENTS ──────────────────────────────
   Files are uploaded to /upload the moment they are picked; the server drops
   them in the agents' inbound-media folder and hands back an absolute path.
   On send, those paths are prefixed to the message so the agent can open them
   with its own filesystem tools — the same handoff the Telegram channel uses. */
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const FILE_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const WARN_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
const X_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

let staged = [];
let stagedSeq = 0;

function fmtSize(n) {
  if(!(n >= 0)) return '';
  if(n < 1024) return n + ' B';
  if(n < 1024*1024) return (n/1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n/1048576).toFixed(1) + ' MB';
}

function pickFiles() {
  if(pending[current.id]) { showToast('⏳ ' + current.name + ' masih memproses pesan sebelumnya'); return; }
  document.getElementById('fileInput').click();
}

function onFilesPicked(input) {
  const files = [...input.files];
  input.value = '';   // so re-picking the same file still fires onchange
  files.forEach(f=>{
    const item = { id:'at'+(++stagedSeq), name:f.name, size:f.size, status:'up', path:null, error:null };
    staged.push(item);
    if(f.size > MAX_ATTACH_BYTES) {
      item.status='err';
      item.error='Lebih dari ' + Math.round(MAX_ATTACH_BYTES/1048576) + ' MB';
      renderAttRow();
      return;
    }
    renderAttRow();
    uploadOne(item, f);
  });
}

async function uploadOne(item, file) {
  try {
    const res = await fetch('/upload', {
      method:'POST',
      headers: {
        // encoded, because a header cannot carry non-ASCII filenames
        'X-Upload-Name': encodeURIComponent(file.name),
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    });
    let data = {};
    try { data = await res.json(); } catch(e) { /* non-JSON body */ }
    if(res.status === 401) throw new Error('Sesi berakhir — login ulang lalu coba lagi');
    if(!res.ok) throw new Error(data.error || ('Upload gagal (' + res.status + ')'));
    if(!data.path) throw new Error('Server tidak mengembalikan path file');
    item.status='ok'; item.path=data.path; item.size=data.size;
  } catch(err) {
    item.status='err';
    item.error=(err && err.message) || 'Upload gagal';
  }
  renderAttRow();
}

function removeAtt(id) {
  staged = staged.filter(s=>s.id !== id);
  renderAttRow();
}

function renderAttRow() {
  const row=document.getElementById('attRow');
  if(!row) return;
  row.classList.toggle('on', staged.length > 0);
  row.innerHTML = staged.map(s=>{
    const lead = s.status==='up' ? '<span class="att-spin"></span>'
      : '<span class="att-ico">' + (s.status==='err' ? WARN_ICON : FILE_ICON) + '</span>';
    const meta = s.status==='err' ? escapeHtml(s.error || 'gagal')
      : s.status==='up' ? 'mengunggah…' : fmtSize(s.size);
    return '<span class="att-chip' + (s.status==='err' ? ' err' : '') + '" title="' + escapeAttr(s.name) + '">' +
      lead + '<span class="att-name">' + escapeHtml(s.name) + '</span>' +
      '<span class="att-size">' + meta + '</span>' +
      '<button class="att-x" type="button" title="Hapus" onclick="removeAtt(\'' + s.id + '\')">' + X_ICON + '</button></span>';
  }).join('');
}

function renderMsgAtt(att) {
  if(!att || !att.length) return '';
  return '<div class="msg-att">' + att.map(a=>
    '<span class="mt-chip" title="' + escapeAttr(a.path || a.name) + '">' + FILE_ICON +
    '<span class="mt-name">' + escapeHtml(a.name) + '</span></span>'
  ).join('') + '</div>';
}

const SEND_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
const STOP_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

function busyHere() { const id = activeConv[current.id]; return !!(id && pending[id]); }

function updateSendBtn() {
  const btn=document.getElementById('sendBtn');
  if(!btn) return;
  const busy=busyHere();
  btn.classList.toggle('stop',busy);
  btn.title=busy?'Hentikan':'Kirim';
  btn.setAttribute('aria-label',btn.title);
  btn.innerHTML=busy?STOP_ICON:SEND_ICON;
  btn.onclick=busy?stopCurrent:sendMsg;
  btn.disabled=false;
}

// Asks the server to cancel the running turn; the pending request then comes
// back with a stored "Dihentikan." error.
function stopCurrent() {
  const id = activeConv[current.id];
  if (id && pending[id]) api('POST', '/api/conversations/' + id + '/stop').catch(() => {});
}

const onScreen = (agent, convId) => agent.id === current.id && activeConv[agent.id] === convId;

// If the request itself is lost (Cloudflare cuts at ~100 s, network blips),
// the server still finishes the turn and stores the reply: poll until it has.
const polling = {};
async function pollUntilDone(convId) {
  if (polling[convId]) return;
  polling[convId] = true;
  try {
    for (;;) {
      await wait(3000);
      let data;
      try { data = await api('GET', '/api/conversations/' + convId); } catch (e) { if (e.status === 404) break; continue; }
      if (!data.conversation.pending) break;
    }
  } finally {
    delete polling[convId];
    delete pending[convId];
  }
  await refreshConvs();
  const agent = current;
  if (activeConv[agent.id] === convId) loadHistoryView(agent.id);
  updateSendBtn();
}

// Runs one server turn (send or retry) and draws its reply.
async function runTurn(agent, convId, request) {
  pending[convId] = true;
  if (onScreen(agent, convId)) showTyping();
  updateSendBtn();
  renderHistoryPanel();
  try {
    const data = await request();
    delete pending[convId];
    if (onScreen(agent, convId)) {
      removeTyping();
      const r = data.reply;
      if (r.role === 'assistant') addMsg('a', r.content, { agent, time: fmtTime(r.createdAt) });
      else addErrorMsg(agent, r.content, { retry: true, time: fmtTime(r.createdAt) });
    } else if (data.reply.role === 'assistant') {
      showToast('💬 ' + agent.name + ' sudah membalas');
    }
  } catch (err) {
    if (err.status === 409) {
      showToast('⏳ ' + agent.name + ' masih memproses pesan sebelumnya');
      pollUntilDone(convId);
    } else if (err.status === 400 || err.status === 404) {
      delete pending[convId];
      if (onScreen(agent, convId)) { removeTyping(); addErrorMsg(agent, err.message); }
    } else {
      // Lost connection or proxy timeout: the turn may still be running.
      pollUntilDone(convId);
      return;
    }
  }
  updateSendBtn();
  refreshConvs();
}

async function sendMsg() {
  const ta=document.getElementById('chatTa');
  const text=ta.value.trim();
  const ready=staged.filter(s=>s.status==='ok');
  const failed=staged.filter(s=>s.status==='err');
  if(staged.some(s=>s.status==='up')) { showToast('⏳ Lampiran masih diunggah'); return; }
  if(!text && !ready.length) return;
  const agent=current;
  if(busyHere()) { showToast('⏳ ' + agent.name + ' masih memproses pesan sebelumnya'); return; }
  if(failed.length) showToast('⚠️ ' + failed.length + ' lampiran gagal diunggah — tidak dikirim');

  let convId = activeConv[agent.id];
  if (!convId) {
    try {
      const data = await api('POST', '/api/conversations', { agentId: agent.id });
      convId = data.conversation.id;
      activeConv[agent.id] = convId;
      convs.unshift(data.conversation);
    } catch (e) { showToast('⚠️ Gagal membuat percakapan: ' + e.message); return; }
  }

  // The agent reads attachments off disk; the server checks these are uploads.
  const att=ready.map(s=>({name:s.name,size:s.size,path:s.path}));
  showWelcome(false);
  addMsg('u',text,{agent,att});
  ta.value='';resize(ta);
  staged=[]; renderAttRow();
  runTurn(agent, convId, () => api('POST', '/api/conversations/' + convId + '/messages', { text, attachments: att }));
}

function quickSend(t) {
  if(busyHere()) { showToast('⏳ ' + current.name + ' masih memproses pesan sebelumnya'); return; }
  document.getElementById('chatTa').value=t; sendMsg();
}

/* ── ONE-TIME IMPORT OF BROWSER HISTORY ─────────
   Before EPIC-002 history lived in this browser's localStorage. Move it to the
   account of whoever logs in here first; the server ignores a repeat import. */
const OLD_HISTORY_KEY = 'cc_chat_history_v1';
async function importOldHistory() {
  let old = null;
  try { old = JSON.parse(localStorage.getItem(OLD_HISTORY_KEY) || 'null'); } catch (e) { return; }
  if (!old || typeof old !== 'object' || !Object.keys(old).length) return;
  try {
    const r = await api('POST', '/api/import', { history: old });
    if (r.imported + r.skipped > 0) {
      localStorage.removeItem(OLD_HISTORY_KEY);
      if (r.imported) showToast('📥 ' + r.messages + ' pesan lama dari browser ini dipindahkan ke akun Anda');
      await refreshConvs();
    }
  } catch (e) { /* keep the local copy; try again on the next load */ }
}

function handleKey(e) { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();} }
function resize(el) { el.style.height='auto';el.style.height=Math.min(el.scrollHeight,110)+'px'; }
function wait(ms) { return new Promise(r=>setTimeout(r,ms)); }
function showToast(msg) {
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}

// INIT APP
/* ── WHATSAPP (EPIC-008) ─────────────
   Plain sidebar items. A page replaces the history panel + chat; any chat
   navigation brings them back. */
const WA_PAGES = {
  groups: { title: 'Pilih Group' },
  summary: { title: 'Summary Chat' },
  connect: { title: 'Koneksikan WA' }
};
let waPage = null;

function openWaPage(key) {
  const page = WA_PAGES[key];
  if (!page) return;
  waPage = key;
  closeDrop();
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('on', n.dataset.wa === key));
  document.getElementById('waTitle').textContent = page.title;
  document.getElementById('socketsPanel').classList.add('hidden');
  document.querySelector('.chat').classList.add('hidden');
  document.getElementById('waView').classList.remove('hidden');
  closeWaPages();
  for (const [k, p] of Object.entries(WA_IMPL)) document.getElementById(p.el).classList.toggle('hidden', k !== key);
  WA_IMPL[key].open();
  if (location.hash !== '#wa-' + key) history.replaceState(null, '', '#wa-' + key);
}

function showChatView() {
  if (!waPage) return;
  waPage = null;
  closeWaPages();
  document.getElementById('waView').classList.add('hidden');
  document.getElementById('socketsPanel').classList.remove('hidden');
  document.querySelector('.chat').classList.remove('hidden');
  document.querySelectorAll('.nav-item[data-wa]').forEach(n => n.classList.remove('on'));
  if (location.hash.startsWith('#wa-')) history.replaceState(null, '', location.pathname + location.search);
}

/* ── Koneksikan WA (EPIC-008 T-042) ───────
   Shows the number Hermes uses, and pairs a new one by QR. Installing the new
   number restarts Hermes, so that last step is a command a person runs:
   the page shows it once a QR has been scanned. */
let waTimer = null;
let waBusy = false;
const WA_LIVE = new Set(['starting', 'waiting', 'scanned']);

// "6281299990000" -> "+62 812-9999-0000" (Indonesian grouping: 3-4-rest).
function waPhone(p) {
  if (!p) return '—';
  const d = String(p);
  if (!d.startsWith('62')) return '+' + d;
  const rest = d.slice(2);
  return '+62 ' + [rest.slice(0, 3), rest.slice(3, 7), rest.slice(7)].filter(Boolean).join('-');
}

function waConnectOpen() {
  waConnectClose();
  const tick = async () => {
    let s = null;
    try { s = await api('GET', '/api/wa/status'); } catch (e) { s = { error: e.message }; }
    if (waPage !== 'connect') return;
    renderWaConnect(s);
    const fast = s && s.pairing && WA_LIVE.has(s.pairing.status);
    waTimer = setTimeout(tick, fast ? 2000 : 10000);
  };
  tick();
}

function waConnectClose() {
  clearTimeout(waTimer);
  waTimer = null;
}

async function waAction(method) {
  if (waBusy) return;
  waBusy = true;
  try { await api(method, '/api/wa/pair'); }
  catch (e) { showToast('⚠️ ' + e.message); }
  finally { waBusy = false; waConnectOpen(); }
}

function copyWaCmd(btn) {
  const text = btn.parentElement.querySelector('code').textContent;
  const done = () => { btn.textContent = 'Tersalin'; setTimeout(() => { btn.textContent = 'Salin'; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
}

function renderWaConnect(s) {
  const el = document.getElementById('waConnect');
  if (!s || s.error) {
    el.innerHTML = `<div class="wa-grid"><div class="wa-box"><div class="wa-msg err">Gagal memuat status WhatsApp: ${escapeHtml((s && s.error) || 'tidak ada respons')}</div></div></div>`;
    return;
  }
  const p = s.pairing || { status: 'idle' };
  const pill = s.bridge === 'connected' ? '<span class="wa-pill ok">Terhubung</span>'
    : s.bridge === 'disconnected' ? '<span class="wa-pill warn">Terputus</span>'
    : '<span class="wa-pill bad">Bridge tidak merespons</span>';
  const live = s.account
    ? `<div><div class="wa-num">${escapeHtml(waPhone(s.account.phone))}</div><div class="wa-sub">${escapeHtml(s.account.name || 'Tanpa nama')} · profil Hermes <b>${escapeHtml(s.profile)}</b></div></div>`
    : '<div><div class="wa-num">Belum ada nomor</div><div class="wa-sub">Hermes belum terhubung ke WhatsApp mana pun.</div></div>';

  let ready = '';
  if (s.pending) {
    ready = `<div class="wa-box wa-ready"><h3>Nomor baru siap dipasang</h3>
      <div class="wa-num">${escapeHtml(waPhone(s.pending.phone))}</div>
      <div class="wa-sub">${escapeHtml(s.pending.name || 'Tanpa nama')}</div>
      <p class="wa-msg" style="margin:12px 0 0">Langkah terakhir dijalankan di terminal server karena me-restart Hermes (WhatsApp &amp; Telegram terputus ±10–20 detik). Nomor lama tetap aktif sampai perintah ini dijalankan:</p>
      <div class="wa-cmd"><code>${escapeHtml(s.applyCommand)}</code><button type="button" onclick="copyWaCmd(this)">Salin</button></div></div>`;
  }

  let pair;
  if (p.status === 'starting') {
    pair = `<div class="wa-msg"><span class="wa-spin"></span>Menyiapkan QR…</div>`;
  } else if (p.status === 'waiting') {
    pair = `<div class="wa-pair"><div class="wa-qr">${p.qrSvg || '<span class="wa-msg err">QR tidak bisa digambar</span>'}</div>
      <ol class="wa-steps"><li>Buka <b>WhatsApp</b> di HP nomor yang ingin dipakai.</li><li>Ketuk <b>⋮ / Setelan → Perangkat tertaut</b>.</li><li>Ketuk <b>Tautkan perangkat</b>, lalu arahkan kamera ke QR ini.</li>
      <li style="list-style:none;margin-left:-18px" class="wa-hint">QR diperbarui otomatis ±20 detik sekali dan kedaluwarsa setelah 3 menit. Dimulai oleh ${escapeHtml(p.startedBy || '-')}.</li></ol></div>`;
  } else if (p.status === 'scanned') {
    pair = `<div class="wa-msg"><span class="wa-spin"></span>QR terpindai — menyimpan kredensial…</div>`;
  } else {
    const note = p.status === 'error' ? `<div class="wa-msg err" style="margin-bottom:12px">${escapeHtml(p.error)}</div>`
      : p.status === 'expired' ? '<div class="wa-msg" style="margin-bottom:12px">QR kedaluwarsa. Mulai lagi bila perlu.</div>'
      : p.status === 'cancelled' ? '<div class="wa-msg" style="margin-bottom:12px">Pairing dibatalkan. Nomor lama tidak berubah.</div>' : '';
    pair = note + `<p class="wa-msg" style="margin:0 0 12px">Nomor yang aktif tetap melayani selama proses ini. Setelah QR dipindai, nomor baru baru dipasang lewat satu perintah di terminal.</p>
      <button class="wa-btn primary" type="button" onclick="waAction('POST')">${s.account || s.pending ? 'Scan QR nomor baru' : 'Hubungkan WhatsApp'}</button>`;
  }
  const cancel = WA_LIVE.has(p.status) && p.status !== 'scanned'
    ? '<button class="wa-btn ghost" type="button" style="margin-top:14px" onclick="waAction(\'DELETE\')">Batal</button>' : '';

  el.innerHTML = `<div class="wa-grid">
    <div class="wa-box"><h3>Nomor WhatsApp Hermes</h3><div class="wa-row">${live}<div style="margin-left:auto">${pill}</div></div></div>
    ${ready}
    <div class="wa-box"><h3>${s.account ? 'Ganti nomor' : 'Hubungkan nomor'}</h3>${pair}${cancel}</div>
  </div>`;
}

/* ── Shared helpers for the group pages ── */
const WA_AVATAR_COLORS = ['#C9A84C', '#2563EB', '#16A34A', '#7C3AED', '#EA580C', '#0891B2', '#DB2777', '#4B5563'];
function waColor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return WA_AVATAR_COLORS[h % WA_AVATAR_COLORS.length]; }
function waGroupName(g) { return g.name || ('Grup ' + String(g.id).replace(/@.*/, '').slice(-6)); }
function waDay(ts) { return new Date(ts).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function waClock(ts) { return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); }
function waIsoDay(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
const WA_LIMITS_NOTE = 'Dari arsip grup bot Hermes (pesan anggota) dan sesi Hermes (balasan bot): riwayat ada sejak arsip aktif, media hanya berupa label.';

/* ── Pilih Group (EPIC-008 T-043): groups the bot is in, read-only chat ── */
const waG = { groups: [], current: null, messages: [], hasMore: false, timer: null };

function waGroupsOpen() {
  waGroupsClose();
  const el = document.getElementById('waGroupsPage');
  el.innerHTML = `<div class="wag-list"><div class="wag-list-head">Grup WhatsApp <button class="wa-btn ghost" type="button" style="padding:5px 10px" onclick="waGroupsRefresh(true)">Muat ulang</button></div>
    <div class="wag-note">${WA_LIMITS_NOTE}</div><div class="wag-items" id="wagItems"><div class="wag-empty">Memuat…</div></div></div>
    <div class="wag-chat" id="wagChat"><div class="wag-empty">Pilih grup di sebelah kiri untuk membaca percakapannya.</div></div>`;
  waG.current = null;
  waGroupsRefresh(true);
  waG.timer = setInterval(() => waGroupsRefresh(false), 15000);
}

function waGroupsClose() { clearInterval(waG.timer); waG.timer = null; }

async function waGroupsRefresh(showErrors) {
  try {
    waG.groups = (await api('GET', '/api/wa/groups')).groups;
  } catch (e) {
    if (showErrors) document.getElementById('wagItems').innerHTML = `<div class="wag-empty">Gagal memuat grup: ${escapeHtml(e.message)}</div>`;
    return;
  }
  if (waPage !== 'groups') return;
  renderWaGroupList();
  if (waG.current) waLoadMessages(false);
}

function renderWaGroupList() {
  const el = document.getElementById('wagItems');
  if (!el) return;
  if (!waG.groups.length) {
    el.innerHTML = '<div class="wag-empty">Belum ada pesan grup di arsip. Grup muncul setelah ada pesan pertama sejak arsip aktif.</div>';
    return;
  }
  el.innerHTML = waG.groups.map((g) => {
    const name = waGroupName(g);
    const last = g.last ? escapeHtml(g.last.sender + ': ' + g.last.text) : '';
    return `<div class="wag-item${waG.current === g.id ? ' on' : ''}" onclick="waOpenGroup('${escapeAttr(g.id)}')">
      <div class="wag-avi" style="background:${waColor(g.id)}">${escapeHtml(name.charAt(0).toUpperCase())}</div>
      <div class="wag-info"><div class="wag-row1"><span class="wag-name">${escapeHtml(name)}</span><span class="wag-time">${fmtTime(g.lastTs)}</span></div>
      <div class="wag-meta">${g.participants ? g.participants + ' anggota · ' : ''}${g.messageCount} pesan</div>
      <div class="wag-prev">${last}</div></div></div>`;
  }).join('');
}

function waOpenGroup(id) {
  waG.current = id;
  waG.messages = [];
  renderWaGroupList();
  waLoadMessages(true);
}

// fresh=true: first page of a newly opened group. false: periodic refresh.
// Refresh button: pull new messages and the group list now.
async function waRefreshNow() {
  const btn = document.getElementById('wagRefresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Memuat…'; }
  try {
    await waGroupsRefresh(true);
    if (waG.current) await waLoadMessages(false, true);
  } finally {
    const b = document.getElementById('wagRefresh');
    if (b) { b.disabled = false; b.textContent = '↻ Refresh'; }
  }
}

// force: re-draw even when nothing new arrived (so "Diperbarui" moves on).
async function waLoadMessages(fresh, force) {
  const id = waG.current;
  let data;
  try { data = await api('GET', '/api/wa/groups/' + encodeURIComponent(id) + '/messages?limit=150'); }
  catch (e) { if (fresh) document.getElementById('wagChat').innerHTML = `<div class="wag-empty">Gagal memuat pesan: ${escapeHtml(e.message)}</div>`; return; }
  if (waG.current !== id || waPage !== 'groups') return;
  const newest = waG.messages.length ? waG.messages[waG.messages.length - 1].id : 0;
  const latest = data.messages.length ? data.messages[data.messages.length - 1].id : 0;
  waG.updatedAt = Date.now();
  if (!fresh && !force && latest === newest) {
    const u = document.getElementById('wagUpdated');
    if (u) u.textContent = 'Diperbarui ' + waClock(waG.updatedAt);
    return;
  }
  const box = document.getElementById('wagMsgs');
  const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  waG.messages = data.messages;
  waG.hasMore = data.hasMore;
  renderWaChat(data.group, fresh || atBottom ? 'bottom' : 'keep');
}

async function waLoadOlder() {
  const id = waG.current;
  if (!waG.messages.length) return;
  const data = await api('GET', '/api/wa/groups/' + encodeURIComponent(id) + '/messages?limit=150&before=' + waG.messages[0].id);
  if (waG.current !== id) return;
  const box = document.getElementById('wagMsgs');
  const fromBottom = box.scrollHeight - box.scrollTop;
  waG.messages = data.messages.concat(waG.messages);
  waG.hasMore = data.hasMore;
  renderWaChat(data.group, 'none');
  const nb = document.getElementById('wagMsgs');
  nb.scrollTop = nb.scrollHeight - fromBottom;
}

function renderWaChat(group, scroll) {
  const g = waG.groups.find((x) => x.id === group.id) || group;
  let day = '';
  const rows = waG.messages.map((m) => {
    const d = waDay(m.ts);
    const sep = d !== day ? `<div class="wag-day">${escapeHtml(d)}</div>` : '';
    day = d;
    const media = m.media ? `<span class="wag-media">${escapeHtml(m.media)}</span>${m.body ? ' ' : ''}` : '';
    // The bot's own replies sit on the right, like your own messages in WhatsApp.
    const who = m.fromMe ? `${escapeHtml(m.sender)} · bot` : escapeHtml(m.sender);
    return sep + `<div class="wag-msg${m.fromMe ? ' me' : ''}"><div class="wag-from" style="color:${m.fromMe ? '#15803D' : waColor(m.sender)}">${who}</div>
      <div class="wag-text">${media}${linkify(escapeHtml(m.body || ''))}</div><div class="wag-at">${waClock(m.ts)}</div></div>`;
  }).join('');
  const box = document.getElementById('wagMsgs');
  const keep = box ? box.scrollTop : 0;
  document.getElementById('wagChat').innerHTML = `<div class="wag-chat-head"><div class="wag-avi" style="background:${waColor(g.id)}">${escapeHtml(waGroupName(g).charAt(0).toUpperCase())}</div>
      <div><div class="wag-chat-title">${escapeHtml(waGroupName(g))}</div><div class="wag-chat-sub">${g.participants ? g.participants + ' anggota · ' : ''}${waG.messages.length} pesan dimuat</div></div>
      <span class="wag-ro">Hanya baca</span>
      <span class="wag-upd" id="wagUpdated">${waG.updatedAt ? 'Diperbarui ' + waClock(waG.updatedAt) : ''}</span>
      <button class="wa-btn ghost wag-refresh" type="button" id="wagRefresh" onclick="waRefreshNow()" title="Ambil pesan baru">↻ Refresh</button></div>
    <div class="wag-msgs" id="wagMsgs">${waG.hasMore ? '<button class="wa-btn ghost wag-more" type="button" onclick="waLoadOlder()">Muat pesan lebih lama</button>' : ''}${rows}</div>`;
  const nb = document.getElementById('wagMsgs');
  if (scroll === 'bottom') nb.scrollTop = nb.scrollHeight;
  else if (scroll === 'keep') nb.scrollTop = keep;
}

/* ── Summary Chat (EPIC-008 T-045): summarize a group over a date range ── */
const waS = { groups: [], current: null, timer: null };

async function waSummaryOpen() {
  waSummaryClose();
  const el = document.getElementById('waSummaryPage');
  el.innerHTML = '<div class="wa-grid"><div class="wa-box"><div class="wa-msg"><span class="wa-spin"></span>Memuat grup…</div></div></div>';
  try { waS.groups = (await api('GET', '/api/wa/groups')).groups; }
  catch (e) { el.innerHTML = `<div class="wa-grid"><div class="wa-box"><div class="wa-msg err">Gagal memuat grup: ${escapeHtml(e.message)}</div></div></div>`; return; }
  if (waPage !== 'summary') return;
  if (!waS.groups.length) {
    el.innerHTML = '<div class="wa-grid"><div class="wa-box"><h3>Buat ringkasan percakapan grup</h3><div class="wa-msg">Belum ada grup di arsip. Grup muncul setelah ada pesan pertama sejak arsip aktif.</div></div></div>';
    return;
  }
  const today = waIsoDay(new Date());
  const opts = waS.groups.map((g) => `<option value="${escapeAttr(g.id)}">${escapeHtml(waGroupName(g))}</option>`).join('');
  const agentOpts = AGENTS.map((a) => `<option value="${a.id}"${a.id === 'dave' ? ' selected' : ''}>${escapeHtml(a.name)} — ${escapeHtml(a.role)}</option>`).join('');
  el.innerHTML = `<div class="wa-grid">
    <div class="wa-box">
      <h3>Buat ringkasan percakapan grup</h3>
      <div class="was-form">
        <label class="was-wide">Grup
          <select id="wasGroup" onchange="waSummaryGroupChanged()">${opts}</select>
          <span class="was-sub" id="wasGroupInfo"></span>
        </label>
        <label>Dari<input type="date" id="wasFrom" max="${today}" onchange="waMarkRange()"></label>
        <label>Sampai<input type="date" id="wasTo" value="${today}" max="${today}" onchange="waMarkRange()"></label>
        <label>Agent<select id="wasAgent">${agentOpts}</select></label>
      </div>
      <div class="was-actions">
        <div class="was-chips" role="group" aria-label="Rentang cepat">
          <button type="button" data-days="1" onclick="waQuickRange(1)">Hari ini</button>
          <button type="button" data-days="7" onclick="waQuickRange(7)">7 hari</button>
          <button type="button" data-days="30" onclick="waQuickRange(30)">30 hari</button>
        </div>
        <button class="wa-btn primary" type="button" id="wasGo" onclick="waCreateSummary()">Buat ringkasan</button>
      </div>
      <p class="was-note">${escapeHtml(WA_LIMITS_NOTE)}</p>
    </div>
    <div class="wa-box hidden" id="wasResultBox">
      <div class="was-res-head"><h3>Hasil ringkasan</h3>
        <button class="wa-btn ghost" type="button" id="wasCopy" onclick="waCopySummary()">Salin</button>
        <button class="wa-btn ghost" type="button" onclick="waCloseSummary()">Tutup</button></div>
      <div id="wasResult"></div>
    </div>
    <div class="wa-box"><h3>Riwayat ringkasan</h3><div class="was-hist" id="wasHist"><div class="wa-msg">—</div></div></div>
  </div>`;
  waQuickRange(7);
  waSummaryGroupChanged();
}

function waSummaryClose() { clearTimeout(waS.timer); waS.timer = null; }

// "Hari ini" / "7 hari" / "30 hari": both ends inclusive, ending today.
function waQuickRange(days) {
  const from = new Date(); from.setDate(from.getDate() - (days - 1));
  document.getElementById('wasFrom').value = waIsoDay(from);
  document.getElementById('wasTo').value = waIsoDay(new Date());
  waMarkRange();
}

// Highlights the quick-range chip that matches the chosen dates, if any.
function waMarkRange() {
  const from = document.getElementById('wasFrom').value;
  const to = document.getElementById('wasTo').value;
  const today = waIsoDay(new Date());
  document.querySelectorAll('.was-chips button').forEach((b) => {
    const d = new Date(); d.setDate(d.getDate() - (Number(b.dataset.days) - 1));
    b.classList.toggle('on', to === today && from === waIsoDay(d));
  });
}

function waSummaryGroupChanged() {
  const g = waS.groups.find((x) => x.id === document.getElementById('wasGroup').value);
  document.getElementById('wasGroupInfo').textContent = g
    ? `${g.messageCount} pesan · data sejak ${new Date(g.firstTs).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`
      + (g.participants ? ` · ${g.participants} anggota` : '')
    : '';
  waLoadSummaryHistory();
}

const WA_STATUS = {
  done: ['ok', 'Selesai'], running: ['run', 'Diproses'], error: ['bad', 'Gagal']
};

function waAgentName(id) { return (AGENTS.find((a) => a.id === id) || { name: id }).name; }

async function waLoadSummaryHistory() {
  const chatId = document.getElementById('wasGroup').value;
  let list = [];
  try { list = (await api('GET', '/api/wa/summaries?chatId=' + encodeURIComponent(chatId))).summaries; } catch (e) { /* keep empty */ }
  if (waPage !== 'summary' || document.getElementById('wasGroup').value !== chatId) return;
  const el = document.getElementById('wasHist');
  if (!list.length) { el.innerHTML = '<div class="was-empty">Belum ada ringkasan untuk grup ini.</div>'; return; }
  el.innerHTML = list.map((s) => {
    const [cls, label] = WA_STATUS[s.status] || ['bad', s.status];
    const range = s.from === s.to ? s.from : `${s.from} → ${s.to}`;
    return `<button type="button" class="was-h${waS.current === s.id ? ' on' : ''}" onclick="waShowSummary(${s.id})">
      <span class="was-h-main"><b>${escapeHtml(range)}</b>
        <span class="was-h-meta">${s.messageCount} pesan · ${escapeHtml(waAgentName(s.agentId))} · oleh ${escapeHtml(s.by || '-')} · ${fmtTime(s.createdAt)}</span></span>
      <span class="was-pill ${cls}">${label}</span><span class="was-chev" aria-hidden="true">›</span></button>`;
  }).join('');
}

async function waCreateSummary() {
  const btn = document.getElementById('wasGo');
  btn.disabled = true;
  btn.textContent = 'Mengirim…';
  try {
    const r = await api('POST', '/api/wa/summaries', {
      chatId: document.getElementById('wasGroup').value,
      from: document.getElementById('wasFrom').value,
      to: document.getElementById('wasTo').value,
      agentId: document.getElementById('wasAgent').value
    });
    waShowSummary(r.summary.id);
    waLoadSummaryHistory();
  } catch (e) {
    showToast('⚠️ ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buat ringkasan';
  }
}

async function waShowSummary(id) {
  waSummaryClose();
  waS.current = id;
  let s;
  try { s = (await api('GET', '/api/wa/summaries/' + id)).summary; } catch (e) { showToast('⚠️ ' + e.message); return; }
  if (waPage !== 'summary' || waS.current !== id) return;
  waS.shown = s;
  const box = document.getElementById('wasResultBox');
  box.classList.remove('hidden');
  const g = waS.groups.find((x) => x.id === s.chatId);
  const agent = waAgentName(s.agentId);
  const [cls, label] = WA_STATUS[s.status] || ['bad', s.status];
  const range = s.from === s.to ? s.from : `${s.from} → ${s.to}`;
  const meta = `<div class="was-meta"><span class="was-pill ${cls}">${label}</span>
    <span>${escapeHtml(g ? waGroupName(g) : s.chatId)} · ${escapeHtml(range)} · ${s.messageCount} pesan · ${escapeHtml(agent)} · oleh ${escapeHtml(s.by || '-')}</span></div>`;
  const body = s.status === 'done' ? `<div class="was-result">${formatMsg(s.content)}</div>`
    : s.status === 'running' ? `<div class="wa-msg"><span class="wa-spin"></span>${escapeHtml(agent)} sedang meringkas ${s.messageCount} pesan…</div>`
    : `<div class="wa-msg err">${escapeHtml(s.error || 'Gagal, alasan tidak diketahui.')}</div>`;
  document.getElementById('wasResult').innerHTML = meta + body;
  document.getElementById('wasCopy').classList.toggle('hidden', s.status !== 'done');
  document.querySelectorAll('.was-h').forEach((n) => n.classList.remove('on'));
  if (s.status === 'running') waS.timer = setTimeout(() => waShowSummary(id), 3000);
  else waLoadSummaryHistory();
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function waCopySummary() {
  const s = waS.shown;
  if (!s || !s.content || !navigator.clipboard) return;
  navigator.clipboard.writeText(s.content).then(() => showToast('📋 Ringkasan disalin'), () => {});
}

function waCloseSummary() {
  waSummaryClose();
  waS.current = null;
  document.getElementById('wasResultBox').classList.add('hidden');
  document.querySelectorAll('.was-h').forEach((n) => n.classList.remove('on'));
}

/* ── Page registry: one container per WhatsApp page ── */
const WA_IMPL = {
  connect: { el: 'waConnect', open: waConnectOpen, close: waConnectClose },
  groups: { el: 'waGroupsPage', open: waGroupsOpen, close: waGroupsClose },
  summary: { el: 'waSummaryPage', open: waSummaryOpen, close: waSummaryClose }
};
function closeWaPages() { for (const p of Object.values(WA_IMPL)) p.close(); }

// A reload on #wa-groups (etc.) reopens that page.
function openWaFromHash() {
  const m = location.hash.match(/^#wa-(\w+)$/);
  if (m && WA_PAGES[m[1]]) openWaPage(m[1]);
}

// Back/forward or an edited address: follow the hash.
window.addEventListener('hashchange', () => {
  if (/^#wa-\w+$/.test(location.hash)) openWaFromHash();
  else showChatView();
});

renderDrop();renderSb();
refreshConvs().then(() => switchAgent('dave')).then(openWaFromHash).then(importOldHistory);
