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
function renderBlock(lines) {
  if(!lines.length) return '';
  const t = findTable(lines);
  if(t) {
    return para(lines.slice(0, t.start)) +
      renderTable(lines.slice(t.start, t.end)) +
      renderBlock(lines.slice(t.end));
  }
  if(lines.every(l=>/^\s*[-•]\s+/.test(l))) {
    return '<ul>'+lines.map(l=>'<li>'+l.replace(/^\s*[-•]\s+/,'')+'</li>').join('')+'</ul>';
  }
  if(lines.every(l=>/^\s*\d+[.)]\s+/.test(l))) {
    return '<ol>'+lines.map(l=>'<li>'+l.replace(/^\s*\d+[.)]\s+/,'')+'</li>').join('')+'</ol>';
  }
  return para(lines);
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
renderDrop();renderSb();
refreshConvs().then(() => switchAgent('dave')).then(importOldHistory);
