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
let ME = null;   // { username, displayName, role } of whoever is logged in
async function loadMe() {
  try {
    const res = await fetch('/api/me');
    if (res.status === 401) { location.href = '/login'; return; }
    if (!res.ok) return;
    const me = await res.json();
    ME = me;
    document.getElementById('sbUname').textContent = me.displayName;
    document.getElementById('sbUstatus').textContent = (me.role === 'admin' ? 'Admin · ' : '') + 'Profil & notifikasi';
  } catch (e) { /* offline: keep the placeholder */ }
}

async function logout() {
  try { await fetch('/logout', { method: 'POST' }); } finally { location.href = '/login'; }
}

const meReady = loadMe();

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
// One conversation (session) = one agent + one Hermes session. An agent can
// have many; the history panel lists the selected agent's sessions (EPIC-011).
let convs = [];             // the user's conversations incl. archived, newest first
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
    const data = await api('GET', '/api/conversations?archived=1');
    convs = data.conversations;
    for (const c of convs) { if (c.pending) pending[c.id] = true; else delete pending[c.id]; }
  } catch (e) { showToast('⚠️ Gagal memuat riwayat: ' + e.message); }
  renderHistoryPanel();
}

function convIdFor(agentId) {
  if (agentId in activeConv) return activeConv[agentId];
  const latest = convs.find(c => c.agentId === agentId && !c.archived);
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

let histShowArchived = false;

function histCard(c) {
  const last = c.lastMessage;
  const prefix = !last ? '' : last.role==='user' ? 'Anda: ' : last.role==='error' ? '⚠️ ' : '';
  const on = activeConv[current.id]===c.id;
  return `<div class="hist-item${on?' on':''}${c.archived?' arch':''}" data-id="${c.id}" onclick="openConversation('${c.agentId}','${c.id}')" oncontextmenu="histMenu(event,'${c.id}')">
      <div class="hist-info">
        <div class="hist-row1"><span class="hist-name">${pending[c.id]?'<span class="hist-busy" title="Agent sedang menjawab"></span>':''}${escapeHtml(truncate(c.title || 'Sesi tanpa judul', 60))}</span><span class="hist-time">${fmtTime(c.updatedAt)}</span></div>
        <div class="hist-preview">${last ? escapeHtml(prefix+truncate(last.content || (last.role==='user' ? '📎 Lampiran' : ''),70)) : '<i>Belum ada pesan</i>'}</div>
      </div>
      <button class="hist-more" type="button" title="Menu sesi" aria-label="Menu sesi" onclick="event.stopPropagation();histMenu(event,'${c.id}')">⋯</button>
    </div>`;
}

// The selected agent's sessions; archived ones in their own section.
function renderHistoryPanel() {
  const body = document.getElementById('histBody');
  if(!body) return;
  const label = document.getElementById('skAgent');
  if (label) label.textContent = '· ' + current.name;
  const mine = convs.filter(c => c.agentId === current.id);
  const active = mine.filter(c => !c.archived && (c.lastMessage || activeConv[current.id] === c.id));
  const archived = mine.filter(c => c.archived);
  let html = active.length ? active.map(histCard).join('') : `<div class="hist-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C9C9D6" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <p>Belum ada sesi dengan ${escapeHtml(current.name)}.<br>Tulis pesan untuk memulai, atau tekan + untuk sesi baru.</p>
    </div>`;
  if (archived.length) {
    html += `<button type="button" class="hist-arch-toggle" onclick="histShowArchived=!histShowArchived;renderHistoryPanel()">
        ${histShowArchived ? '▾' : '▸'} Arsip <span>${archived.length}</span></button>`;
    if (histShowArchived) html += archived.map(histCard).join('');
  }
  body.innerHTML = html;
  updateArchBanner();
}

function updateArchBanner() {
  const el = document.getElementById('archBanner');
  if (!el) return;
  const c = convs.find(x => x.id === activeConv[current.id]);
  el.classList.toggle('hidden', !(c && c.archived));
}

/* ── Session menu: right-click a card, or its ⋯ button (EPIC-011) ── */
function histMenu(ev, id) {
  ev.preventDefault();
  const c = convs.find(x => x.id === id);
  if (!c) return;
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = `
    <button type="button" role="menuitem" onclick="closeCtx();renameConv('${id}')">✏️ Ganti nama</button>
    <button type="button" role="menuitem" onclick="closeCtx();setArchived('${id}', ${!c.archived})">${c.archived ? '📤 Keluarkan dari arsip' : '🗄️ Arsipkan'}</button>
    <div class="ctx-sep"></div>
    <button type="button" role="menuitem" class="danger" onclick="closeCtx();deleteConv('${id}')">🗑️ Hapus</button>`;
  menu.classList.remove('hidden');
  const r = ev.currentTarget && ev.type === 'click' ? ev.currentTarget.getBoundingClientRect() : null;
  let x = r ? r.right - menu.offsetWidth : ev.clientX;
  let y = r ? r.bottom + 4 : ev.clientY;
  x = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8));
  y = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8));
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  menu.querySelector('button').focus();
}
function closeCtx() { document.getElementById('ctxMenu').classList.add('hidden'); }
document.addEventListener('click', (e) => { if (!e.target.closest('#ctxMenu') && !e.target.closest('.hist-more')) closeCtx(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); });
window.addEventListener('blur', closeCtx);
window.addEventListener('resize', closeCtx);

// Rename in place: the title becomes an input; Enter or leaving it saves.
function renameConv(id) {
  const card = document.querySelector(`.hist-item[data-id="${id}"] .hist-name`);
  const c = convs.find(x => x.id === id);
  if (!card || !c) return;
  card.innerHTML = `<input class="hist-rename" maxlength="80" value="${escapeAttr(c.title || '')}" placeholder="Nama sesi">`;
  const input = card.querySelector('input');
  input.onclick = (e) => e.stopPropagation();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const title = input.value.trim();
    if (save && title && title !== c.title) {
      try { const r = await api('PATCH', '/api/conversations/' + id, { title }); Object.assign(c, r.conversation); }
      catch (e) { showToast('⚠️ Gagal mengganti nama: ' + e.message); }
    }
    renderHistoryPanel();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
  input.focus(); input.select();
}

async function setArchived(id, archived) {
  if (!id) return;
  try {
    const r = await api('PATCH', '/api/conversations/' + id, { archived });
    const c = convs.find(x => x.id === id);
    if (c) Object.assign(c, r.conversation);
    if (archived) histShowArchived = histShowArchived || false;
    showToast(archived ? 'Sesi diarsipkan' : 'Sesi dikeluarkan dari arsip');
  } catch (e) { showToast('⚠️ ' + e.message); }
  renderHistoryPanel();
}

async function deleteConv(id) {
  const c = convs.find(x => x.id === id);
  if (!c) return;
  if (pending[id]) { showToast('⏳ Agent masih menjawab di sesi ini'); return; }
  const ok = await confirmDialog(`Hapus sesi “${truncate(c.title || 'Sesi tanpa judul', 50)}”?`, 'Semua pesan di sesi ini akan dihapus permanen dan tidak bisa dikembalikan.', 'Hapus');
  if (!ok) return;
  try { await api('DELETE', '/api/conversations/' + id); }
  catch (e) { showToast('⚠️ Gagal menghapus: ' + e.message); return; }
  convs = convs.filter(x => x.id !== id);
  if (activeConv[c.agentId] === id) {
    delete activeConv[c.agentId];
    if (current.id === c.agentId) loadHistoryView(c.agentId);
  }
  renderHistoryPanel();
  showToast('Sesi dihapus');
}

// A small yes/no dialog; resolves true on the confirm button.
function confirmDialog(title, text, okLabel) {
  const box = document.getElementById('confirmBox');
  box.innerHTML = `<div class="cfm-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>
      <div class="cfm-actions"><button type="button" class="cfm-no">Batal</button><button type="button" class="cfm-yes">${escapeHtml(okLabel)}</button></div></div>`;
  box.classList.remove('hidden');
  return new Promise((resolve) => {
    const end = (v) => { box.classList.add('hidden'); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') end(false); };
    box.querySelector('.cfm-no').onclick = () => end(false);
    box.querySelector('.cfm-yes').onclick = () => end(true);
    box.onclick = (e) => { if (e.target === box) end(false); };
    document.addEventListener('keydown', key);
    box.querySelector('.cfm-no').focus();
  });
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
  updateArchBanner();
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

/* ── Attachments in messages + the file viewer (EPIC-011) ─────
   Images show as thumbnails; any attachment opens in a popup, like WhatsApp:
   images (← → between them), PDF in the browser's viewer, text/CSV/JSON/
   Markdown read in place. Office files and HEIC can only be downloaded. The
   server only serves files from the user's own messages (/api/files/…). */
const FV_IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const FV_TEXT = ['txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'log', 'ini', 'conf'];
const FV_LABEL = { pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', ppt: 'PowerPoint', pptx: 'PowerPoint', odt: 'Dokumen', ods: 'Spreadsheet', rtf: 'Dokumen', heic: 'Foto HEIC' };
const fileExt = (n) => (String(n).match(/\.([A-Za-z0-9]{1,8})$/) || [, ''])[1].toLowerCase();
const fileUrl = (a, dl) => '/api/files/' + encodeURIComponent(String(a.path).split('/').pop()) + (dl ? '?download=1' : '');

function renderMsgAtt(att) {
  if(!att || !att.length) return '';
  const imgs = att.filter(a => a.path && FV_IMAGE.includes(fileExt(a.path)));
  const rest = att.filter(a => !imgs.includes(a));
  const data = (a) => `data-file="${escapeAttr(String(a.path).split('/').pop())}" data-name="${escapeAttr(a.name)}" data-size="${Number(a.size) || 0}"`;
  return '<div class="msg-att">' +
    imgs.map(a => `<button type="button" class="mt-img" ${data(a)} onclick="openFile(this)" title="${escapeAttr(a.name)}"><img src="${fileUrl(a)}" alt="${escapeAttr(a.name)}" loading="lazy" onerror="fileImgRetry(this)"></button>`).join('') +
    rest.map(a => a.path
      ? `<button type="button" class="mt-chip mt-open" ${data(a)} onclick="openFile(this)" title="Buka ${escapeAttr(a.name)}">${FILE_ICON}<span class="mt-name">${escapeHtml(a.name)}</span><span class="mt-ext">${escapeHtml((FV_LABEL[fileExt(a.path)] || fileExt(a.path)).toUpperCase())}</span></button>`
      : `<span class="mt-chip" title="${escapeAttr(a.name)}">${FILE_ICON}<span class="mt-name">${escapeHtml(a.name)}</span></span>`).join('') +
    '</div>';
}

// A just-sent image may be asked for a moment before the server has stored
// the message: try again a few times.
function fileImgRetry(img) {
  const n = Number(img.dataset.tries || 0);
  if (n >= 4) { img.closest('.mt-img').classList.add('broken'); return; }
  img.dataset.tries = n + 1;
  setTimeout(() => { img.src = img.src.split('?')[0] + '?r=' + (n + 1); }, 700 * (n + 1));
}

const fv = { list: [], i: 0 };
function openFile(el) {
  const area = el.closest('#msgArea, .ds-msgs, .ds-thread-list');
  const ext = fileExt(el.dataset.file);
  // Images: browse every image in this chat, like a gallery.
  fv.list = FV_IMAGE.includes(ext) && area ? [...area.querySelectorAll('.mt-img')] : [el];
  fv.i = Math.max(0, fv.list.indexOf(el));
  fvShow();
}

async function fvShow() {
  const el = fv.list[fv.i];
  const a = { path: el.dataset.file, name: el.dataset.name, size: Number(el.dataset.size) };
  const ext = fileExt(a.path);
  const url = fileUrl(a);
  const box = document.getElementById('fileViewer');
  const nav = fv.list.length > 1
    ? `<button type="button" class="fv-nav prev" onclick="fvStep(-1)" aria-label="Sebelumnya"${fv.i ? '' : ' disabled'}>‹</button><button type="button" class="fv-nav next" onclick="fvStep(1)" aria-label="Berikutnya"${fv.i < fv.list.length - 1 ? '' : ' disabled'}>›</button>` : '';
  let body;
  if (FV_IMAGE.includes(ext)) body = `<img class="fv-img" src="${url}" alt="${escapeAttr(a.name)}">`;
  else if (ext === 'pdf') body = `<iframe class="fv-pdf" src="${url}" title="${escapeAttr(a.name)}"></iframe>`;
  else if (FV_TEXT.includes(ext)) body = '<div class="fv-doc"><div class="wa-msg"><span class="wa-spin"></span>Membuka file…</div></div>';
  else body = `<div class="fv-none"><div class="fv-none-ic">${escapeHtml((FV_LABEL[ext] || ext || 'File').toUpperCase())}</div>
      <b>${escapeHtml(a.name)}</b><p>Pratinjau belum tersedia untuk file ${escapeHtml(FV_LABEL[ext] || '.' + ext)}. Unduh untuk membukanya di aplikasi Anda.</p>
      <a class="wa-btn primary" href="${fileUrl(a, true)}">Unduh file</a></div>`;
  box.innerHTML = `<div class="fv-bar">
      <div class="fv-title"><b>${escapeHtml(a.name)}</b><span>${escapeHtml([fmtSize(a.size), (FV_LABEL[ext] || ext).toUpperCase(), fv.list.length > 1 ? (fv.i + 1) + ' dari ' + fv.list.length : ''].filter(Boolean).join(' · '))}</span></div>
      <a class="fv-btn" href="${fileUrl(a, true)}" title="Unduh"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Unduh</a>
      <button type="button" class="fv-btn" onclick="closeFile()" title="Tutup (Esc)" aria-label="Tutup">✕</button>
    </div>
    <div class="fv-body" onclick="if(event.target===this)closeFile()">${body}${nav}</div>`;
  box.classList.remove('hidden');
  if (!FV_TEXT.includes(ext)) return;
  const doc = box.querySelector('.fv-doc');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status === 404 ? 'file tidak ditemukan' : 'HTTP ' + res.status);
    let text = await res.text();
    const cut = text.length > 300000;
    if (cut) text = text.slice(0, 300000);
    if (fv.list[fv.i] !== el) return;
    let html;
    if (ext === 'md') html = `<div class="fv-md">${formatMsg(text)}</div>`;
    else if (ext === 'csv' || ext === 'tsv') html = fvTable(text, ext === 'tsv' ? '\t' : null);
    else if (ext === 'json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* show as is */ } html = `<pre>${escapeHtml(text)}</pre>`; }
    else html = `<pre>${escapeHtml(text)}</pre>`;
    doc.innerHTML = html + (cut ? '<div class="fv-cut">File terlalu panjang — hanya bagian awal yang ditampilkan. Unduh untuk melihat semuanya.</div>' : '');
  } catch (e) {
    doc.innerHTML = `<div class="wa-msg err">Gagal membuka file: ${escapeHtml(e.message)}</div>`;
  }
}

// CSV/TSV as a table (first 500 rows). Quoted fields are respected.
function fvTable(text, sep) {
  if (!sep) { const first = text.split('\n', 1)[0]; sep = (first.split(';').length > first.split(',').length) ? ';' : ','; }
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length && rows.length < 501; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return '<div class="wa-msg">File kosong.</div>';
  const [head, ...body] = rows;
  return `<div class="fv-table"><table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${body.slice(0, 499).map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function fvStep(d) { const j = fv.i + d; if (j >= 0 && j < fv.list.length) { fv.i = j; fvShow(); } }
function closeFile() { const box = document.getElementById('fileViewer'); box.classList.add('hidden'); box.innerHTML = ''; }
document.addEventListener('keydown', (e) => {
  if (document.getElementById('fileViewer').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeFile();
  else if (e.key === 'ArrowLeft') fvStep(-1);
  else if (e.key === 'ArrowRight') fvStep(1);
});

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
  connect: { title: 'Koneksikan WA' },
  // Not WhatsApp, but the same full-width page slot (EPIC-009).
  schedule: { title: 'Jadwal & Meeting', crumb: 'Schedule', hash: 'schedule' },
  tasks: { title: 'Fokus saya', crumb: 'Task Focus', hash: 'tasks' },
  discuss: { title: 'Diskusi tim', crumb: 'Chat & Discussion', hash: 'discuss' },
  profile: { title: 'Profil & notifikasi', crumb: 'Akun', hash: 'profile' }
};
const pageHash = (key) => '#' + (WA_PAGES[key].hash || 'wa-' + key);
let waPage = null;

function openWaPage(key) {
  const page = WA_PAGES[key];
  if (!page) return;
  waPage = key;
  closeDrop();
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('on', n.dataset.wa === key));
  document.getElementById('waTitle').textContent = page.title;
  document.getElementById('waCrumb').textContent = page.crumb || 'WhatsApp';
  document.getElementById('socketsPanel').classList.add('hidden');
  document.querySelector('.chat').classList.add('hidden');
  document.getElementById('waView').classList.remove('hidden');
  closeWaPages();
  for (const [k, p] of Object.entries(WA_IMPL)) document.getElementById(p.el).classList.toggle('hidden', k !== key);
  WA_IMPL[key].open();
  if (location.hash !== pageHash(key)) history.replaceState(null, '', pageHash(key));
}

function showChatView() {
  if (!waPage) return;
  waPage = null;
  closeWaPages();
  document.getElementById('waView').classList.add('hidden');
  document.getElementById('socketsPanel').classList.remove('hidden');
  document.querySelector('.chat').classList.remove('hidden');
  document.querySelectorAll('.nav-item[data-wa]').forEach(n => n.classList.remove('on'));
  if (pageFromHash()) history.replaceState(null, '', location.pathname + location.search);
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
      </div>
      <div class="was-actions">
        <div class="was-chips" role="group" aria-label="Rentang cepat">
          <button type="button" data-days="1" onclick="waQuickRange(1)">Hari ini</button>
          <button type="button" data-days="7" onclick="waQuickRange(7)">7 hari</button>
          <button type="button" data-days="30" onclick="waQuickRange(30)">30 hari</button>
        </div>
        <div class="was-go"><span class="was-by">Diringkas oleh <b>Aurix</b></span>
          <button class="wa-btn primary" type="button" id="wasGo" onclick="waCreateSummary()">Buat ringkasan</button></div>
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

// Summaries are written by Aurix (a Hermes profile that is not in AGENTS).
function waAgentName(id) {
  const a = AGENTS.find((x) => x.id === id);
  return a ? a.name : String(id || '').charAt(0).toUpperCase() + String(id || '').slice(1);
}

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
      to: document.getElementById('wasTo').value
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

/* ── Schedule: Jadwal & Meeting (EPIC-009) ─────────────
   A month calendar on the left, a panel on the right: upcoming events, the
   event form, or one event (agenda by Aurix → checked → "Kirim ke grup" →
   reminders). Dates and times are WIB, as the server stores them. */
const sch = { y: 0, m: 0, events: [], upcoming: [], groups: null, options: null, panel: 'upcoming', cur: null, editing: null, agendaEdit: false, confirm: null, poll: null };
const SCH_DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const SCH_MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const SCH_DURATIONS = [[15, '15 menit'], [30, '30 menit'], [45, '45 menit'], [60, '1 jam'], [90, '1,5 jam'], [120, '2 jam'], [180, '3 jam'], [240, '4 jam'], [480, 'Seharian (8 jam)']];
const SCH_STATUS = { draft: ['warn', 'Draf — belum dikirim'], sent: ['ok', 'Terkirim ke grup'], cancelled: ['bad', 'Dibatalkan'] };
const schPad = (n) => String(n).padStart(2, '0');
const schToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const schIso = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() + '-' + schPad(t.getUTCMonth() + 1) + '-' + schPad(t.getUTCDate()); };
const schClock = (t) => String(t).replace(':', '.');
const schWibStamp = (ms) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

// WhatsApp formatting, as the group will see it: *tebal*, _miring_, ~coret~.
function schWa(text) {
  return escapeHtml(String(text || ''))
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/gm, '$1<b>$2</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/gm, '$1<i>$2</i>')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/gm, '$1<s>$2</s>');
}

function schStopPoll() { clearTimeout(sch.poll); sch.poll = null; }
function schClose() { schStopPoll(); sch.cur = null; sch.confirm = null; }

async function schOpen() {
  schStopPoll();
  const [y, m] = schToday().split('-').map(Number);
  if (!sch.y) { sch.y = y; sch.m = m; }
  sch.panel = 'upcoming'; sch.cur = null; sch.confirm = null;
  const el = document.getElementById('schedulePage');
  el.innerHTML = `<div class="sc-cal"><div class="sc-cal-head">
        <button class="sc-nav" type="button" onclick="schMonth(-1)" aria-label="Bulan sebelumnya">‹</button>
        <div class="sc-month" id="scMonth"></div>
        <button class="sc-nav" type="button" onclick="schMonth(1)" aria-label="Bulan berikutnya">›</button>
        <button class="wa-btn ghost sc-today" type="button" onclick="schMonth(0)">Hari ini</button>
        <button class="wa-btn primary sc-new" type="button" onclick="schNew()">+ Buat acara</button>
      </div>
      <div class="sc-grid-head">${SCH_DAYS.map((d) => `<div>${d}</div>`).join('')}</div>
      <div class="sc-grid" id="scGrid"></div>
    </div>
    <div class="sc-panel" id="scPanel"><div class="wa-msg"><span class="wa-spin"></span>Memuat jadwal…</div></div>`;
  try {
    const [opts] = await Promise.all([api('GET', '/api/events/options'), schLoad()]);
    sch.options = opts;
  } catch (e) {
    if (waPage === 'schedule') document.getElementById('scPanel').innerHTML = `<div class="wa-msg err">Gagal memuat jadwal: ${escapeHtml(e.message)}</div>`;
    return;
  }
  if (waPage !== 'schedule') return;
  schRenderPanel();
  if (schPrefill) schNew();
  // Groups come from the WhatsApp archive (and may look names up): not awaited.
  api('GET', '/api/wa/groups').then((r) => { sch.groups = r.groups; if (sch.panel === 'form') schRenderPanel(); }).catch(() => { sch.groups = []; });
}

async function schLoad() {
  const from = schIso(sch.y, sch.m, 1);
  const to = schIso(sch.y, sch.m + 1, 1);
  const [month, up] = await Promise.all([api('GET', `/api/events?from=${from}&to=${to}`), api('GET', '/api/events?upcoming=1')]);
  sch.events = month.events;
  sch.upcoming = up.events;
  if (waPage === 'schedule') schRenderCal();
}

function schMonth(step) {
  if (step === 0) { const [y, m] = schToday().split('-').map(Number); sch.y = y; sch.m = m; }
  else { const t = new Date(Date.UTC(sch.y, sch.m - 1 + step, 1)); sch.y = t.getUTCFullYear(); sch.m = t.getUTCMonth() + 1; }
  schRenderCal();
  schLoad().catch((e) => showToast('Gagal memuat bulan: ' + e.message));
}

function schRenderCal() {
  document.getElementById('scMonth').textContent = SCH_MONTHS[sch.m - 1] + ' ' + sch.y;
  const first = new Date(Date.UTC(sch.y, sch.m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;                        // Monday first
  const days = new Date(Date.UTC(sch.y, sch.m, 0)).getUTCDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  const today = schToday();
  const byDay = {};
  for (const e of sch.events) (byDay[e.date] = byDay[e.date] || []).push(e);
  let html = '';
  for (let i = 0; i < cells; i++) {
    const iso = schIso(sch.y, sch.m, i - lead + 1);
    const inMonth = i >= lead && i < lead + days;
    const evs = byDay[iso] || [];
    const chips = evs.slice(0, 3).map((e) => `<button type="button" class="sc-chip ${e.status}${sch.cur && sch.cur.event.id === e.id ? ' on' : ''}" onclick="event.stopPropagation();schShow(${e.id})" title="${escapeAttr(e.title)}"><span>${schClock(e.time)}</span> ${escapeHtml(e.title)}</button>`).join('');
    const more = evs.length > 3 ? `<button type="button" class="sc-more" onclick="event.stopPropagation();schDay('${iso}')">+${evs.length - 3} lagi</button>` : '';
    html += `<div class="sc-day${inMonth ? '' : ' out'}${iso === today ? ' today' : ''}${iso < today ? ' past' : ''}" onclick="schDayClick('${iso}')">
      <div class="sc-num">${Number(iso.slice(8))}</div>${chips}${more}</div>`;
  }
  document.getElementById('scGrid').innerHTML = html;
}

// An empty spot on a day: a new event on that date (not in the past).
function schDayClick(iso) {
  if (iso < schToday()) { schDay(iso); return; }
  schNew(iso);
}
function schDay(iso) {
  const evs = sch.events.filter((e) => e.date === iso);
  if (evs.length === 1) { schShow(evs[0].id); return; }
  schStopPoll();
  sch.panel = 'day'; sch.dayIso = iso; sch.cur = null;
  schRenderPanel();
}

function schRenderPanel() {
  const el = document.getElementById('scPanel');
  if (!el) return;
  if (sch.panel === 'form') el.innerHTML = schFormHtml();
  else if (sch.panel === 'event' && sch.cur) el.innerHTML = schEventHtml(sch.cur);
  else if (sch.panel === 'day') {
    const evs = sch.events.filter((e) => e.date === sch.dayIso);
    el.innerHTML = `<div class="sc-ph"><h3>${escapeHtml(waDay(sch.dayIso + 'T12:00:00+07:00'))}</h3><button class="wa-btn ghost" type="button" onclick="schShowUpcoming()">Tutup</button></div>
      ${evs.length ? evs.map(schCardHtml).join('') : '<div class="wa-msg">Tidak ada acara di tanggal ini.</div>'}`;
  } else {
    el.innerHTML = `<div class="sc-ph"><h3>Acara mendatang</h3></div>
      ${sch.upcoming.length ? sch.upcoming.map(schCardHtml).join('') : `<div class="sc-empty">
        <div class="sc-empty-ic">🗓</div><b>Belum ada acara</b>
        <p>Tulis agendanya, kapan dan di mana. Aurix akan menyusun agenda meeting, lalu bot bisa mengirimkannya ke grup WhatsApp beserta pengingat.</p>
        <button class="wa-btn primary" type="button" onclick="schNew()">+ Buat acara</button></div>`}`;
  }
}

function schShowUpcoming() { schStopPoll(); sch.panel = 'upcoming'; sch.cur = null; schRenderCal(); schRenderPanel(); }

function schCardHtml(e) {
  const d = new Date(e.date + 'T12:00:00+07:00');
  return `<button type="button" class="sc-card ${e.status}" onclick="schShow(${e.id})">
      <div class="sc-date"><b>${Number(e.date.slice(8))}</b><span>${SCH_MONTHS[d.getUTCMonth()].slice(0, 3)}</span></div>
      <div class="sc-card-body"><div class="sc-card-title">${escapeHtml(e.title)}</div>
        <div class="sc-card-meta">${schClock(e.time)} WIB${e.location ? ' · ' + escapeHtml(e.location) : ''}</div>
        <span class="wa-pill ${SCH_STATUS[e.status][0]}">${e.status === 'sent' ? 'Terkirim' : e.status === 'draft' ? 'Draf' : 'Dibatalkan'}</span></div>
    </button>`;
}

/* ── Form: create / edit ── */
let schPrefill = null;   // { title, notes } from a discussion message (EPIC-012)
function schNew(date) {
  schStopPoll();
  const today = schToday();
  const pre = schPrefill || {};
  schPrefill = null;
  sch.panel = 'form'; sch.cur = null;
  sch.editing = { id: null, title: pre.title || '', date: date && date >= today ? date : today, time: '10:00', durationMin: 60, location: '', attendees: '', notes: pre.notes || '', groups: [], reminders: (sch.options && sch.options.defaultReminders) || ['d1', 'm60'] };
  schRenderCal(); schRenderPanel();
  setTimeout(() => { const t = document.getElementById('scTitle'); if (t) t.focus(); }, 0);
}
function schEdit() {
  const e = sch.cur.event;
  schStopPoll();
  sch.panel = 'form';
  sch.editing = { id: e.id, title: e.title, date: e.date, time: e.time, durationMin: e.durationMin, location: e.location || '', attendees: e.attendees || '', notes: e.notes || '', groups: e.groups.map((g) => g.id), reminders: e.reminders, sent: e.status === 'sent' };
  schRenderPanel();
}

function schFormHtml() {
  const f = sch.editing;
  const durs = SCH_DURATIONS.some(([v]) => v === f.durationMin) ? SCH_DURATIONS : [...SCH_DURATIONS, [f.durationMin, f.durationMin + ' menit']];
  const groups = sch.groups === null ? '<div class="wa-msg"><span class="wa-spin"></span>Memuat grup…</div>'
    : sch.groups.length ? sch.groups.map((g) => `<label class="sc-check"><input type="checkbox" name="scGroup" value="${escapeAttr(g.id)}"${f.groups.includes(g.id) ? ' checked' : ''}> ${escapeHtml(waGroupName(g))}</label>`).join('')
      : '<div class="wa-msg">Belum ada grup. Grup muncul setelah bot menerima pesan di grup itu (lihat Pilih Group).</div>';
  const rems = ((sch.options && sch.options.reminders) || []).map((r) => `<button type="button" class="${f.reminders.includes(r.key) ? 'on' : ''}" data-key="${r.key}" onclick="this.classList.toggle('on')">${escapeHtml(r.label)}</button>`).join('');
  return `<div class="sc-ph"><h3>${f.id ? 'Ubah acara' : 'Buat acara'}</h3><button class="wa-btn ghost" type="button" onclick="${f.id ? `schShow(${f.id})` : 'schShowUpcoming()'}">Batal</button></div>
    <form class="sc-form" onsubmit="event.preventDefault();schSave()">
      <label>Agenda / judul acara<input id="scTitle" maxlength="200" required placeholder="mis. Rapat evaluasi penjualan Q4" value="${escapeAttr(f.title)}"></label>
      <div class="sc-row3">
        <label>Tanggal<input type="date" id="scDate" required value="${f.date}"${f.id ? '' : ` min="${schToday()}"`}></label>
        <label>Jam (WIB)<input type="time" id="scTime" required value="${f.time}"></label>
        <label>Durasi<select id="scDur">${durs.map(([v, l]) => `<option value="${v}"${v === f.durationMin ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label>Lokasi<input id="scLoc" maxlength="300" placeholder="Ruang rapat, alamat, atau link Zoom/Meet" value="${escapeAttr(f.location)}"></label>
      <label><span>Peserta <span class="sc-opt">(opsional)</span></span><input id="scWho" maxlength="500" placeholder="mis. Irfan, Cahyo, tim marketing" value="${escapeAttr(f.attendees)}"></label>
      <label><span>Catatan untuk agent <span class="sc-opt">(opsional)</span></span><textarea id="scNotes" maxlength="2000" rows="3" placeholder="Poin yang ingin dibahas, target meeting, dll.">${escapeHtml(f.notes)}</textarea></label>
      <div class="sc-field"><div class="sc-label">Kirim ke grup WhatsApp</div><div class="sc-groups">${groups}</div></div>
      <div class="sc-field"><div class="sc-label">Pengingat ke grup</div><div class="was-chips sc-rems" id="scRems">${rems}</div></div>
      <div class="sc-form-foot">
        <span class="sc-hint">${f.id ? (f.sent ? 'Pengingat yang belum terkirim ikut menyesuaikan.' : 'Belum ada yang dikirim ke grup.') : 'Aurix menyusun agendanya; Anda cek dulu sebelum dikirim.'}</span>
        <button class="wa-btn primary" type="submit" id="scSave">${f.id ? 'Simpan' : 'Simpan & susun agenda'}</button>
      </div>
    </form>`;
}

async function schSave() {
  const f = sch.editing;
  const body = {
    title: document.getElementById('scTitle').value, date: document.getElementById('scDate').value, time: document.getElementById('scTime').value,
    durationMin: Number(document.getElementById('scDur').value), location: document.getElementById('scLoc').value,
    attendees: document.getElementById('scWho').value, notes: document.getElementById('scNotes').value,
    reminders: [...document.querySelectorAll('#scRems button.on')].map((b) => b.dataset.key)
  };
  // Keep the chosen groups if the list could not load.
  if (sch.groups && sch.groups.length) body.groups = [...document.querySelectorAll('input[name="scGroup"]:checked')].map((i) => i.value);
  else if (!f.id) body.groups = [];
  const btn = document.getElementById('scSave');
  btn.disabled = true;
  try {
    const out = f.id ? await api('PATCH', '/api/events/' + f.id, body) : await api('POST', '/api/events', body);
    sch.cur = out; sch.panel = 'event'; sch.agendaEdit = false; sch.confirm = null;
    const [y, m] = out.event.date.split('-').map(Number);
    sch.y = y; sch.m = m;
    await schLoad();
    schRenderPanel(); schPollIfNeeded();
    showToast(f.id ? 'Acara disimpan' : 'Acara dibuat — Aurix sedang menyusun agenda');
  } catch (e) {
    btn.disabled = false;
    showToast(e.message);
  }
}

/* ── One event ── */
async function schShow(id) {
  schStopPoll();
  sch.panel = 'event'; sch.agendaEdit = false; sch.confirm = null;
  try { sch.cur = await api('GET', '/api/events/' + id); }
  catch (e) { showToast('Gagal memuat acara: ' + e.message); return; }
  if (waPage !== 'schedule' || sch.panel !== 'event') return;
  schRenderCal(); schRenderPanel(); schPollIfNeeded();
}

// While Aurix writes, or the bot is still sending, refresh the panel.
function schPollIfNeeded() {
  schStopPoll();
  const c = sch.cur;
  if (!c) return;
  const busy = c.event.agendaStatus === 'running' || c.messages.some((m) => m.status === 'pending' && m.dueAt <= Date.now() + 60000);
  if (!busy) return;
  sch.poll = setTimeout(async () => {
    if (waPage !== 'schedule' || sch.panel !== 'event' || !sch.cur || sch.cur.event.id !== c.event.id) return;
    try {
      const fresh = await api('GET', '/api/events/' + c.event.id);
      if (sch.panel !== 'event' || !sch.cur || sch.cur.event.id !== c.event.id) return;
      // Don't redraw over a half-typed agenda edit.
      if (!sch.agendaEdit) { sch.cur = fresh; schRenderPanel(); }
      if (c.event.agendaStatus === 'running' && fresh.event.agendaStatus !== 'running') schLoad().catch(() => {});
    } catch (e) { /* try again next round */ }
    schPollIfNeeded();
  }, 2500);
}

function schEventHtml({ event: e, messages }) {
  const [cls, label] = SCH_STATUS[e.status];
  const live = e.status !== 'cancelled';
  const remLabels = ((sch.options && sch.options.reminders) || []).filter((r) => e.reminders.includes(r.key)).map((r) => r.label);
  const facts = [
    ['🗓', escapeHtml(e.when)],
    e.location ? ['📍', linkify(escapeHtml(e.location))] : null,
    e.attendees ? ['👥', escapeHtml(e.attendees)] : null,
    e.notes ? ['📝', escapeHtml(e.notes)] : null
  ].filter(Boolean).map(([i, t]) => `<div class="sc-fact"><span>${i}</span><div>${t}</div></div>`).join('');

  let agenda;
  if (e.agendaStatus === 'running') {
    agenda = '<div class="sc-agenda-wait"><span class="wa-spin"></span>Aurix sedang menyusun agenda… biasanya kurang dari satu menit.</div>';
  } else if (e.agendaStatus === 'error') {
    agenda = `<div class="wa-msg err">Agenda gagal disusun: ${escapeHtml(e.agendaError || '')}</div>
      <div class="sc-actions"><button class="wa-btn primary" type="button" onclick="schRewrite()">Coba lagi</button></div>`;
  } else if (sch.agendaEdit) {
    agenda = `<textarea class="sc-agenda-edit" id="scAgenda" maxlength="4000" rows="14">${escapeHtml(e.agenda || '')}</textarea>
      <div class="sc-hint">Format WhatsApp: *tebal*, _miring_, ~coret~.</div>
      <div class="sc-actions"><button class="wa-btn ghost" type="button" onclick="sch.agendaEdit=false;schRenderPanel();schPollIfNeeded()">Batal</button>
        <button class="wa-btn primary" type="button" onclick="schSaveAgenda()">Simpan agenda</button></div>`;
  } else {
    agenda = `${e.agendaStale && live ? '<div class="sc-stale">Detail acara berubah setelah agenda disusun. <button type="button" onclick="schRewrite()">Susun ulang</button></div>' : ''}
      <div class="sc-bubble">${linkify(schWa(e.agenda))}<div class="sc-bubble-by">Pratinjau di WhatsApp</div></div>
      ${live ? `<div class="sc-actions"><button class="wa-btn ghost" type="button" onclick="sch.agendaEdit=true;schStopPoll();schRenderPanel()">Ubah teks</button>
        <button class="wa-btn ghost" type="button" onclick="schRewrite()">Susun ulang oleh Aurix</button></div>` : ''}`;
  }

  const ready = e.agendaStatus === 'done' && !sch.agendaEdit;
  const groupNames = e.groups.map((g) => escapeHtml(g.name || g.id)).join(', ');
  let send = '';
  if (live) {
    const planned = `<div class="sc-plan"><div><span>Grup</span><b>${groupNames || '<i>belum dipilih</i>'}</b></div>
        <div><span>Pengingat</span><b>${remLabels.length ? escapeHtml(remLabels.join(', ')) : 'tidak ada'}</b></div></div>`;
    if (sch.confirm === 'send') {
      send = `${planned}<div class="sc-confirm"><p>Bot akan mengirim agenda di atas ke <b>${e.groups.length} grup</b> sekarang${remLabels.length ? ', lalu pengingat sesuai jadwal' : ''}.</p>
        <div class="sc-actions"><button class="wa-btn ghost" type="button" onclick="sch.confirm=null;schRenderPanel()">Batal</button>
        <button class="wa-btn primary" type="button" id="scSendGo" onclick="schSend()">Ya, kirim sekarang</button></div></div>`;
    } else {
      const why = !e.groups.length ? 'Pilih grup dulu lewat "Ubah".' : !ready ? 'Tunggu agenda siap.' : '';
      send = `${planned}<div class="sc-actions">${why ? `<span class="sc-hint">${why}</span>` : ''}
        <button class="wa-btn primary" type="button" onclick="sch.confirm='send';schRenderPanel()"${why ? ' disabled' : ''}>${e.status === 'sent' ? 'Kirim ulang ke grup' : 'Kirim ke grup'}</button></div>`;
    }
  }

  const KIND = { agenda: '📋 Agenda', cancel: '❌ Pembatalan' };
  const MSG = { sent: ['ok', 'Terkirim'], error: ['bad', 'Gagal'], skipped: ['warn', 'Dilewati'] };
  const rows = messages.map((m) => {
    const [mc, ml] = m.status === 'pending' ? (m.attempts ? ['warn', 'Mencoba ulang'] : ['wait', m.dueAt <= Date.now() ? 'Mengirim…' : 'Terjadwal']) : MSG[m.status];
    return `<tr><td>${escapeHtml(m.kind === 'reminder' ? '⏰ ' + (m.reminderLabel || 'Pengingat') : KIND[m.kind])}</td>
      <td>${escapeHtml(m.groupName || m.chatId)}</td><td>${escapeHtml(schWibStamp(m.sentAt || m.dueAt))}</td>
      <td><span class="wa-pill ${mc}">${ml}</span>${m.error && m.status !== 'sent' ? `<div class="sc-err">${escapeHtml(m.error)}</div>` : ''}</td></tr>`;
  }).join('');
  const log = messages.length ? `<div class="sc-sec"><div class="sc-sec-h">Pengiriman bot</div>
      <table class="sc-msgs"><thead><tr><th>Pesan</th><th>Grup</th><th>Waktu</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';

  let manage = '';
  if (sch.confirm === 'cancel') {
    manage = `<div class="sc-confirm"><p>Batalkan acara ini? Pengingat yang belum terkirim dihentikan.</p><div class="sc-actions">
      <button class="wa-btn ghost" type="button" onclick="sch.confirm=null;schRenderPanel()">Kembali</button>
      ${e.status === 'sent' ? '<button class="wa-btn ghost" type="button" onclick="schCancel(false)">Batalkan tanpa kabar</button><button class="wa-btn danger" type="button" onclick="schCancel(true)">Batalkan & kabari grup</button>'
        : '<button class="wa-btn danger" type="button" onclick="schCancel(false)">Ya, batalkan</button>'}</div></div>`;
  } else if (sch.confirm === 'delete') {
    manage = `<div class="sc-confirm"><p>Hapus acara ini? Belum ada yang dikirim ke grup.</p><div class="sc-actions">
      <button class="wa-btn ghost" type="button" onclick="sch.confirm=null;schRenderPanel()">Kembali</button>
      <button class="wa-btn danger" type="button" onclick="schDelete()">Ya, hapus</button></div></div>`;
  } else if (live) {
    manage = `<div class="sc-actions sc-manage"><button class="wa-btn ghost" type="button" onclick="schEdit()">Ubah</button>
      ${e.status === 'sent' ? '<button class="wa-btn ghost" type="button" onclick="sch.confirm=\'cancel\';schRenderPanel()">Batalkan acara</button>'
        : '<button class="wa-btn ghost" type="button" onclick="sch.confirm=\'delete\';schRenderPanel()">Hapus</button>'}</div>`;
  } else {
    manage = `<div class="sc-actions sc-manage"><button class="wa-btn ghost" type="button" onclick="sch.confirm='delete';schRenderPanel()">Hapus dari kalender</button></div>`;
  }

  return `<div class="sc-ph"><button class="sc-back" type="button" onclick="schShowUpcoming()">‹ Semua acara</button></div>
    <div class="sc-ev-head"><h2>${escapeHtml(e.title)}</h2><span class="wa-pill ${cls}">${label}</span></div>
    <div class="sc-facts">${facts}</div>
    ${e.source === 'whatsapp' ? `<div class="sc-src">💬 Dibuat lewat WhatsApp${e.autoSend ? ' · dikirim otomatis begitu agenda siap' : ''}</div>` : ''}
    <div class="sc-by">Dibuat oleh ${escapeHtml(e.createdBy || '—')}${e.sentAt ? ` · dikirim oleh ${escapeHtml(e.sentBy || '—')}, ${escapeHtml(schWibStamp(e.sentAt))}` : ''}</div>
    ${manage}
    <div class="sc-sec"><div class="sc-sec-h">Agenda meeting <span>disusun Aurix</span></div>${agenda}</div>
    ${live ? `<div class="sc-sec"><div class="sc-sec-h">Kirim ke grup WhatsApp</div>${send}</div>` : ''}
    ${log}`;
}

async function schAct(fn, okMsg) {
  try {
    sch.cur = await fn();
    sch.confirm = null;
    if (okMsg) showToast(okMsg);
  } catch (e) { showToast(e.message); }
  schRenderPanel(); schPollIfNeeded();
  schLoad().catch(() => {});
}
function schRewrite() { sch.agendaEdit = false; return schAct(() => api('POST', `/api/events/${sch.cur.event.id}/agenda`), 'Aurix menyusun ulang agenda'); }
function schSaveAgenda() {
  const text = document.getElementById('scAgenda').value;
  sch.agendaEdit = false;
  return schAct(() => api('PUT', `/api/events/${sch.cur.event.id}/agenda`, { agenda: text }), 'Agenda disimpan');
}
function schSend() {
  const b = document.getElementById('scSendGo');
  if (b) b.disabled = true;
  return schAct(() => api('POST', `/api/events/${sch.cur.event.id}/send`), 'Agenda dikirim ke grup');
}
function schCancel(notify) { return schAct(() => api('POST', `/api/events/${sch.cur.event.id}/cancel`, { notify }), notify ? 'Acara dibatalkan, grup dikabari' : 'Acara dibatalkan'); }
async function schDelete() {
  try { await api('DELETE', '/api/events/' + sch.cur.event.id); }
  catch (e) { showToast(e.message); return; }
  showToast('Acara dihapus');
  sch.panel = 'upcoming'; sch.cur = null; sch.confirm = null;
  await schLoad().catch(() => {});
  schRenderPanel();
}

/* ── Task Focus (EPIC-010) ─────────────
   "Fokus saya": my open tasks grouped by due date (WIB). "Papan tim": every
   task in three columns, filterable per person, drag to change status. The
   panel on the right shows one task: fields, comments and its history. */
const tf = { view: 'focus', who: '', tasks: [], people: [], cur: null, confirm: false };
const TF_STATUS = { todo: 'Belum', doing: 'Dikerjakan', done: 'Selesai' };
const TF_PRIO = { high: 'Tinggi', normal: 'Normal', low: 'Rendah' };
const TF_COLORS = ['#C9A84C', '#2563EB', '#16A34A', '#DB2777', '#7C3AED', '#EA580C', '#0891B2'];
const tfToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const tfDays = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 86400000);
const tfMine = (t) => t.assignee && ME && t.assignee.username === ME.username;
function tfInitials(p) { return p ? p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : '?'; }
function tfColor(p) { if (!p) return '#C9C9D6'; let h = 0; for (const c of p.username) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TF_COLORS[h % TF_COLORS.length]; }
function tfAvatar(p) { return `<span class="tf-avi" style="background:${tfColor(p)}" title="${escapeAttr(p ? p.name : 'Belum ada penanggung jawab')}">${escapeHtml(tfInitials(p))}</span>`; }

// "Terlambat 2 hari", "Hari ini", "Besok", "Rab, 22 Okt".
function tfDue(t) {
  if (!t.dueDate) return null;
  const d = tfDays(tfToday(), t.dueDate);
  if (t.status !== 'done' && d < 0) return { cls: 'late', text: d === -1 ? 'Terlambat 1 hari' : `Terlambat ${-d} hari` };
  if (d === 0) return { cls: 'today', text: 'Hari ini' };
  if (d === 1) return { cls: 'soon', text: 'Besok' };
  return { cls: '', text: new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(t.dueDate + 'T00:00:00Z')) };
}

async function tfOpen() {
  const el = document.getElementById('tasksPage');
  el.innerHTML = `<div class="tf-main">
      <div class="tf-head">
        <div class="tf-tabs" role="tablist">
          <button type="button" data-v="focus" onclick="tfView('focus')">Fokus saya</button>
          <button type="button" data-v="board" onclick="tfView('board')">Papan tim</button>
        </div>
        <select class="tf-who hidden" id="tfWho" onchange="tf.who=this.value;tfLoad()" aria-label="Tampilkan tugas milik"></select>
      </div>
      <form class="tf-add" onsubmit="event.preventDefault();tfAdd()">
        <span class="tf-add-plus">+</span>
        <input id="tfNew" maxlength="300" placeholder="Tambah tugas… lalu tekan Enter" autocomplete="off">
        <select id="tfNewWho" aria-label="Penanggung jawab"></select>
        <input type="date" id="tfNewDue" aria-label="Tenggat">
        <button class="wa-btn primary" type="submit">Tambah</button>
      </form>
      <div class="tf-body" id="tfBody"><div class="wa-msg"><span class="wa-spin"></span>Memuat tugas…</div></div>
    </div>
    <div class="tf-panel" id="tfPanel"></div>`;
  await meReady;
  try { tf.people = (await api('GET', '/api/tasks/people')).people; } catch (e) { tf.people = []; }
  if (waPage !== 'tasks') return;
  const me = ME && tf.people.find((p) => p.username === ME.username);
  document.getElementById('tfNewWho').innerHTML = tf.people.map((p) => `<option value="${escapeAttr(p.username)}"${me && p.id === me.id ? ' selected' : ''}>${escapeHtml(me && p.id === me.id ? 'Saya' : p.name)}</option>`).join('');
  document.getElementById('tfWho').innerHTML = '<option value="">Semua orang</option>' +
    tf.people.map((p) => `<option value="${escapeAttr(p.username)}">${escapeHtml(p.name)}</option>`).join('') + '<option value="-">Belum ada penanggung jawab</option>';
  tf.cur = null; tf.confirm = false;
  tfView(tf.view);
}
function tfClose() { tf.cur = null; }

function tfView(v) {
  tf.view = v;
  document.querySelectorAll('.tf-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  document.getElementById('tfWho').classList.toggle('hidden', v !== 'board');
  document.getElementById('waTitle').textContent = v === 'board' ? 'Papan tim' : 'Fokus saya';
  tfLoad();
}

async function tfLoad() {
  const q = tf.view === 'focus' ? '?mine=1' : tf.who ? '?assignee=' + encodeURIComponent(tf.who) : '';
  try { tf.tasks = (await api('GET', '/api/tasks' + q)).tasks; }
  catch (e) { document.getElementById('tfBody').innerHTML = `<div class="wa-msg err">Gagal memuat tugas: ${escapeHtml(e.message)}</div>`; return; }
  if (waPage !== 'tasks') return;
  tfRender();
  if (!tf.cur) tfRenderPanel();
}

function tfRender() {
  const body = document.getElementById('tfBody');
  body.innerHTML = tf.view === 'board' ? tfBoardHtml() : tfFocusHtml();
}

function tfRowHtml(t, { showWho } = {}) {
  const due = tfDue(t);
  const meta = [
    due ? `<span class="tf-due ${due.cls}">${escapeHtml(due.text)}</span>` : '',
    t.status === 'doing' ? '<span class="tf-doing">Dikerjakan</span>' : '',
    t.priority === 'high' ? '<span class="tf-prio">● Prioritas tinggi</span>' : '',
    t.comments ? `<span class="tf-cm">💬 ${t.comments}</span>` : ''
  ].filter(Boolean).join('');
  return `<div class="tf-row${t.status === 'done' ? ' done' : ''}${tf.cur && tf.cur.task.id === t.id ? ' on' : ''}" onclick="tfShow(${t.id})">
      <button type="button" class="tf-check" onclick="event.stopPropagation();tfToggle(${t.id})" aria-label="${t.status === 'done' ? 'Tandai belum selesai' : 'Tandai selesai'}">${t.status === 'done' ? '✓' : ''}</button>
      <div class="tf-row-main"><div class="tf-title">${escapeHtml(t.title)}</div>${meta ? `<div class="tf-meta">${meta}</div>` : ''}</div>
      ${showWho || !tfMine(t) ? tfAvatar(t.assignee) : ''}
    </div>`;
}

function tfFocusHtml() {
  const today = tfToday();
  const groups = [['late', 'Terlambat'], ['today', 'Hari ini'], ['week', '7 hari ke depan'], ['later', 'Nanti'], ['none', 'Tanpa tenggat']];
  const bucket = { late: [], today: [], week: [], later: [], none: [], done: [] };
  for (const t of tf.tasks) {
    if (t.status === 'done') {
      if (t.doneAt && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(t.doneAt) === today) bucket.done.push(t);
      continue;
    }
    if (!t.dueDate) { bucket.none.push(t); continue; }
    const d = tfDays(today, t.dueDate);
    bucket[d < 0 ? 'late' : d === 0 ? 'today' : d <= 7 ? 'week' : 'later'].push(t);
  }
  const open = groups.reduce((n, [k]) => n + bucket[k].length, 0);
  if (!open && !bucket.done.length) {
    return `<div class="tf-empty"><div class="tf-empty-ic">✓</div><b>Tidak ada tugas untuk Anda</b>
      <p>Tambahkan tugas di kolom atas, atau lihat <a href="#tasks" onclick="event.preventDefault();tfView('board')">Papan tim</a>.</p></div>`;
  }
  let html = groups.filter(([k]) => bucket[k].length).map(([k, label]) => `<div class="tf-group ${k}">
      <div class="tf-group-h">${label} <span>${bucket[k].length}</span></div>${bucket[k].map((t) => tfRowHtml(t)).join('')}</div>`).join('');
  if (!open) html += '<div class="tf-allclear">🎉 Semua tugas Anda sudah selesai.</div>';
  if (bucket.done.length) {
    html += `<details class="tf-group done"><summary class="tf-group-h">Selesai hari ini <span>${bucket.done.length}</span></summary>${bucket.done.map((t) => tfRowHtml(t)).join('')}</details>`;
  }
  return html;
}

function tfBoardHtml() {
  const cols = Object.entries(TF_STATUS).map(([s, label]) => {
    const items = tf.tasks.filter((t) => t.status === s);
    return `<div class="tf-col" data-status="${s}" ondragover="event.preventDefault();this.classList.add('drop')" ondragleave="this.classList.remove('drop')" ondrop="tfDrop(event,'${s}')">
        <div class="tf-col-h"><span class="tf-dot ${s}"></span>${label} <span>${items.length}</span></div>
        <div class="tf-col-body">${items.map((t) => {
          const due = tfDue(t);
          return `<div class="tf-card${tf.cur && tf.cur.task.id === t.id ? ' on' : ''}" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${t.id}')" onclick="tfShow(${t.id})">
            <div class="tf-card-top"><div class="tf-title">${escapeHtml(t.title)}</div>${tfAvatar(t.assignee)}</div>
            ${due || t.priority === 'high' || t.comments ? `<div class="tf-card-foot">${due ? `<span class="tf-due ${due.cls}">${escapeHtml(due.text)}</span>` : ''}
              ${t.priority === 'high' ? '<span class="tf-prio">● Tinggi</span>' : ''}${t.comments ? `<span class="tf-cm">💬 ${t.comments}</span>` : ''}</div>` : ''}
          </div>`;
        }).join('') || '<div class="tf-col-empty">Kosong</div>'}</div>
      </div>`;
  }).join('');
  return `<div class="tf-board">${cols}</div><div class="tf-hint">Seret kartu ke kolom lain untuk mengubah status. Tugas selesai tampil selama 14 hari.</div>`;
}

async function tfDrop(ev, status) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drop');
  const id = Number(ev.dataTransfer.getData('text/plain'));
  const t = tf.tasks.find((x) => x.id === id);
  if (!t || t.status === status) return;
  await tfPatch(id, { status }, status === 'done' ? 'Tugas selesai' : 'Status: ' + TF_STATUS[status]);
}

async function tfAdd() {
  const input = document.getElementById('tfNew');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  const body = { title, assignee: document.getElementById('tfNewWho').value || null };
  const due = document.getElementById('tfNewDue').value;
  if (due) body.dueDate = due;
  try {
    const out = await api('POST', '/api/tasks', body);
    input.value = ''; document.getElementById('tfNewDue').value = '';
    showToast(tfMine(out.task) || tf.view === 'board' ? 'Tugas ditambahkan' : `Tugas ditambahkan untuk ${out.task.assignee ? out.task.assignee.name : 'tim'}`);
    await tfLoad();
    tfBadge();
  } catch (e) { showToast(e.message); }
  input.focus();
}

async function tfToggle(id) {
  const t = tf.tasks.find((x) => x.id === id) || (tf.cur && tf.cur.task.id === id && tf.cur.task);
  if (!t) return;
  await tfPatch(id, { status: t.status === 'done' ? 'todo' : 'done' }, t.status === 'done' ? 'Tugas dibuka lagi' : 'Tugas selesai ✓');
}

// One change to a task, then refresh what shows it.
async function tfPatch(id, body, okMsg) {
  try {
    const out = await api('PATCH', '/api/tasks/' + id, body);
    if (tf.cur && tf.cur.task.id === id) { tf.cur = out; tfRenderPanel(); }
    if (okMsg) showToast(okMsg);
  } catch (e) { showToast(e.message); if (tf.cur && tf.cur.task.id === id) tfRenderPanel(); }
  await tfLoad();
  tfBadge();
}

/* ── One task ── */
async function tfShow(id) {
  try { tf.cur = await api('GET', '/api/tasks/' + id); }
  catch (e) { showToast('Gagal memuat tugas: ' + e.message); return; }
  tf.confirm = false;
  tfRender(); tfRenderPanel();
}
function tfHide() { tf.cur = null; tf.confirm = false; tfRender(); tfRenderPanel(); }

function tfRenderPanel() {
  const el = document.getElementById('tfPanel');
  if (!el) return;
  if (!tf.cur) {
    const mine = tf.view === 'focus' ? tf.tasks : tf.tasks.filter(tfMine);
    const today = tfToday();
    const open = mine.filter((t) => t.status !== 'done');
    const late = open.filter((t) => t.dueDate && t.dueDate < today).length;
    const now = open.filter((t) => t.dueDate === today).length;
    const doing = open.filter((t) => t.status === 'doing').length;
    el.innerHTML = `<div class="tf-hello"><div class="tf-hello-day">${escapeHtml(waDay(today + 'T12:00:00+07:00'))}</div>
        <h3>Halo${ME ? ', ' + escapeHtml(ME.displayName.split(' ')[0]) : ''} 👋</h3>
        <div class="tf-stats">
          <div class="${late ? 'late' : ''}"><b>${late}</b><span>Terlambat</span></div>
          <div><b>${now}</b><span>Hari ini</span></div>
          <div><b>${doing}</b><span>Dikerjakan</span></div>
        </div>
        <p class="tf-tip">${tf.view === 'focus' ? 'Ini tugas yang ditugaskan ke Anda. Klik tugas untuk melihat detail, komentar, dan riwayatnya.' : 'Seluruh tugas tim. Pilih orang di atas untuk melihat tugas satu orang.'}</p></div>`;
    return;
  }
  const { task: t, activity } = tf.cur;
  const canDelete = ME && ((t.createdBy && t.createdBy.username === ME.username) || ME.role === 'admin');
  const people = '<option value="">— Belum ada —</option>' + tf.people.map((p) => `<option value="${escapeAttr(p.username)}"${t.assignee && t.assignee.id === p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  const feed = activity.map((a) => a.kind === 'comment'
    ? `<div class="tf-comment"><div class="tf-comment-h"><b>${escapeHtml(a.by)}</b><span>${escapeHtml(schWibStamp(a.at))}</span></div><div class="tf-comment-b">${linkify(escapeHtml(a.body))}</div></div>`
    : `<div class="tf-hist"><b>${escapeHtml(a.by)}</b> ${escapeHtml(a.body)} · ${escapeHtml(schWibStamp(a.at))}</div>`).join('');
  el.innerHTML = `<div class="sc-ph"><button class="sc-back" type="button" onclick="tfHide()">‹ Tutup</button></div>
    <div class="tf-d-title"><button type="button" class="tf-check big${t.status === 'done' ? ' checked' : ''}" onclick="tfToggle(${t.id})" aria-label="Tandai selesai">${t.status === 'done' ? '✓' : ''}</button>
      <textarea id="tfTitle" rows="1" maxlength="300" onchange="tfPatch(${t.id},{title:this.value})">${escapeHtml(t.title)}</textarea></div>
    <div class="tf-seg">${Object.entries(TF_STATUS).map(([s, l]) => `<button type="button" class="${t.status === s ? 'on ' + s : ''}" onclick="tfPatch(${t.id},{status:'${s}'})">${l}</button>`).join('')}</div>
    <div class="tf-fields">
      <label class="tf-wide">Penanggung jawab<select onchange="tfPatch(${t.id},{assignee:this.value||null})">${people}</select></label>
      <label>Tenggat<input type="date" value="${t.dueDate || ''}" onchange="tfPatch(${t.id},{dueDate:this.value||null})"></label>
      <label>Prioritas<select onchange="tfPatch(${t.id},{priority:this.value})">${Object.entries(TF_PRIO).map(([k, l]) => `<option value="${k}"${t.priority === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="tf-notes">Catatan<textarea rows="4" maxlength="4000" placeholder="Detail, link, atau langkah-langkah…" onchange="tfPatch(${t.id},{notes:this.value})">${escapeHtml(t.notes || '')}</textarea></label>
    <div class="sc-by">Dibuat oleh ${escapeHtml(t.createdBy ? t.createdBy.name : '—')}, ${escapeHtml(schWibStamp(t.createdAt))}${t.doneAt ? ` · selesai oleh ${escapeHtml(t.doneBy ? t.doneBy.name : '—')}, ${escapeHtml(schWibStamp(t.doneAt))}` : ''}</div>
    <div class="sc-sec"><div class="sc-sec-h">Komentar & riwayat</div>
      <div class="tf-feed">${feed}</div>
      <form class="tf-cform" onsubmit="event.preventDefault();tfComment(${t.id})">
        <textarea id="tfComment" rows="2" maxlength="2000" placeholder="Tulis komentar…" onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();tfComment(${t.id})}"></textarea>
        <button class="wa-btn primary" type="submit">Kirim</button>
      </form></div>
    ${canDelete ? (tf.confirm ? `<div class="sc-confirm"><p>Hapus tugas ini beserta komentarnya?</p><div class="sc-actions">
        <button class="wa-btn ghost" type="button" onclick="tf.confirm=false;tfRenderPanel()">Kembali</button>
        <button class="wa-btn danger" type="button" onclick="tfDelete(${t.id})">Ya, hapus</button></div></div>`
      : `<div class="sc-actions sc-manage"><button class="wa-btn ghost" type="button" onclick="tf.confirm=true;tfRenderPanel()">Hapus tugas</button></div>`) : ''}`;
  const ta = document.getElementById('tfTitle');
  ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
  const feedEl = el.querySelector('.tf-feed');
  if (feedEl) feedEl.scrollTop = feedEl.scrollHeight;
}

async function tfComment(id) {
  const box = document.getElementById('tfComment');
  const text = box.value.trim();
  if (!text) return;
  try { tf.cur = await api('POST', `/api/tasks/${id}/comments`, { body: text }); }
  catch (e) { showToast(e.message); return; }
  tfRenderPanel();
  tfLoad();
}

async function tfDelete(id) {
  try { await api('DELETE', '/api/tasks/' + id); }
  catch (e) { showToast(e.message); return; }
  showToast('Tugas dihapus');
  tf.cur = null; tf.confirm = false;
  await tfLoad(); tfRenderPanel(); tfBadge();
}

// Sidebar badge: my tasks that are late or due today.
async function tfBadge() {
  const b = document.getElementById('tfBadge');
  if (!b) return;
  try {
    const s = await api('GET', '/api/tasks/summary');
    const n = s.overdue + s.dueToday;
    b.textContent = n;
    b.classList.toggle('hidden', !n);
    b.classList.toggle('late', s.overdue > 0);
    b.title = `${s.overdue} terlambat, ${s.dueToday} hari ini`;
  } catch (e) { /* keep the last value */ }
}
tfBadge();
setInterval(tfBadge, 5 * 60 * 1000);

/* ── Chat & Discussion (EPIC-012) ─────────────
   Team channels (open to everyone) and direct messages, live over one
   Server-Sent Events stream that is open on every page (it also drives the
   sidebar badge). Threads open in a panel on the right. */
const ds = { rooms: [], people: [], online: new Set(), cur: null, msgs: [], hasMore: false, thread: null, threadMsgs: [], staged: { main: [], thread: [] }, es: null, refreshT: null, typing: new Map() };
// Agents can be called into a discussion (@dave); Aurix writes summaries.
const dsAgent = (id) => AGENTS.find((a) => a.id === id) || { id, name: id.charAt(0).toUpperCase() + id.slice(1), role: 'Agent', img: null };
function dsAgentAvatar(id, size) { const a = dsAgent(id); return a.img ? `<img class="ds-avi ds-agent-img${size ? ' ' + size : ''}" src="${a.img}" alt="${escapeAttr(a.name)}">` : `<span class="ds-avi ds-agent-ini${size ? ' ' + size : ''}">${escapeHtml(a.name.slice(0, 2).toUpperCase())}</span>`; }
const dsWho = (m) => (m.agent ? 'a:' + m.agent : 'u:' + (m.author ? m.author.id : '-'));
const dsMe = () => ME && ME.username;
const dsRoom = (id) => ds.rooms.find((r) => r.id === id);
const dsRoomName = (r) => (r.kind === 'dm' ? (r.with ? r.with.name : 'Pesan langsung') : '#' + r.name);
function dsAvatar(p, size) { return `<span class="ds-avi${size ? ' ' + size : ''}" style="background:${tfColor(p)}">${escapeHtml(tfInitials(p))}</span>`; }

// ── the live stream (all pages) ──
function dsConnect() {
  if (ds.es || typeof EventSource === 'undefined') return;
  ds.es = new EventSource('/api/stream');
  ds.es.onmessage = (e) => { let ev; try { ev = JSON.parse(e.data); } catch (x) { return; } dsEvent(ev); };
  // The browser reconnects by itself; after a gap, catch up.
  ds.es.onopen = () => dsRefreshSoon();
}

function dsEvent(ev) {
  if (ev.type === 'message') dsNotify(ev);
  if (ev.type === 'hello' || ev.type === 'presence') { ds.online = new Set(ev.online); if (waPage === 'discuss') { dsRenderSide(); dsRenderHead(); } return; }
  if (ev.type === 'typing') {
    const key = ev.roomId + ':' + ev.parentId;
    const set = ds.typing.get(key) || new Set();
    if (ev.on) set.add(ev.agentId); else set.delete(ev.agentId);
    if (set.size) ds.typing.set(key, set); else ds.typing.delete(key);
    if (waPage === 'discuss' && ds.cur && ds.cur.id === ev.roomId) { dsRenderMsgs(dsNearBottom()); if (ds.thread && ds.thread.id === ev.parentId) dsRenderThread(true); }
    return;
  }
  const here = waPage === 'discuss' && ds.cur && ev.roomId === ds.cur.id;
  if ((ev.type === 'message' || ev.type === 'edit' || ev.type === 'delete') && here) {
    const m = ev.message;
    if (!m.parentId) dsUpsert(ds.msgs, m, ev.type === 'message');
    else if (ev.parent) dsUpsert(ds.msgs, ev.parent, false);
    if (ds.thread && (m.parentId === ds.thread.id || m.id === ds.thread.id)) {
      if (m.id === ds.thread.id) ds.thread = m; else dsUpsert(ds.threadMsgs, m, ev.type === 'message');
      dsRenderThread(m.parentId === ds.thread.id && ev.type === 'message');
    }
    dsRenderMsgs(ev.type === 'message' && !m.parentId && dsNearBottom());
    if (ev.type === 'message' && document.visibilityState === 'visible') dsMarkRead();
  }
  dsRefreshSoon();
}
function dsUpsert(list, m, append) {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = m; else if (append) list.push(m);
}

// Counts and the room list, at most every 300 ms.
function dsRefreshSoon() {
  clearTimeout(ds.refreshT);
  ds.refreshT = setTimeout(async () => {
    try {
      if (waPage === 'discuss') {
        const r = await api('GET', '/api/rooms');
        ds.rooms = r.rooms; ds.people = r.people; ds.online = new Set(r.online);
        dsRenderSide(); dsRenderHead();
        dsBadgeSet(ds.rooms.reduce((t, x) => ({ unread: t.unread + x.unread, mentions: t.mentions + x.mentions }), { unread: 0, mentions: 0 }));
      } else dsBadgeSet(await api('GET', '/api/rooms/unread'));
    } catch (e) { /* next event tries again */ }
  }, 300);
}
function dsBadgeSet({ unread, mentions }) {
  const b = document.getElementById('dsBadge');
  if (!b) return;
  b.textContent = mentions ? '@' + (unread > 99 ? '99+' : unread) : (unread > 99 ? '99+' : unread);
  b.classList.toggle('hidden', !unread);
  b.classList.toggle('late', mentions > 0);
  b.title = `${unread} pesan belum dibaca${mentions ? `, ${mentions} menyebut Anda` : ''}`;
  document.title = (unread ? `(${unread > 99 ? '99+' : unread}) ` : '') + BASE_TITLE;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && waPage === 'discuss' && ds.cur) dsMarkRead(); });

// ── page ──
async function dsOpen() {
  await meReady;
  const el = document.getElementById('discussPage');
  el.innerHTML = `<div class="ds-side" id="dsSide"><div class="wa-msg"><span class="wa-spin"></span>Memuat…</div></div>
    <div class="ds-main">
      <div class="ds-head" id="dsHead"></div>
      <div class="ds-msgs" id="dsMsgs"></div>
      ${dsComposerHtml('main')}
    </div>
    <div class="ds-thread hidden" id="dsThread"></div>`;
  try {
    const r = await api('GET', '/api/rooms');
    ds.rooms = r.rooms; ds.people = r.people; ds.online = new Set(r.online);
  } catch (e) { document.getElementById('dsSide').innerHTML = `<div class="wa-msg err">${escapeHtml(e.message)}</div>`; return; }
  if (waPage !== 'discuss') return;
  let last = null;
  try { last = Number(localStorage.getItem('ds.room')); } catch (e) { /* private mode */ }
  const first = dsRoom(last) || ds.rooms.find((x) => x.name === 'umum') || ds.rooms[0];
  dsRenderSide();
  if (first) dsShowRoom(first.id);
}
function dsClose() { ds.cur = null; ds.thread = null; }

function dsRenderSide() {
  const el = document.getElementById('dsSide');
  if (!el) return;
  const count = (r) => (r && r.unread ? `<span class="ds-count${r.mentions ? ' at' : ''}">${r.mentions ? '@' : ''}${r.unread}</span>` : '');
  const channels = ds.rooms.filter((r) => r.kind === 'channel').map((r) =>
    `<button type="button" class="ds-item${ds.cur && ds.cur.id === r.id ? ' on' : ''}${r.unread ? ' unread' : ''}" onclick="dsShowRoom(${r.id})"><span class="ds-hash">#</span><span class="ds-item-name">${escapeHtml(r.name)}</span>${count(r)}</button>`).join('');
  const dms = ds.people.filter((p) => p.username !== dsMe()).map((p) => {
    const r = ds.rooms.find((x) => x.kind === 'dm' && x.with && x.with.username === p.username);
    return `<button type="button" class="ds-item${r && ds.cur && ds.cur.id === r.id ? ' on' : ''}${r && r.unread ? ' unread' : ''}" onclick="dsOpenDm('${escapeAttr(p.username)}')">
      <span class="ds-pp">${dsAvatar(p, 'sm')}<span class="ds-dot${ds.online.has(p.username) ? ' on' : ''}"></span></span><span class="ds-item-name">${escapeHtml(p.name)}</span>${count(r)}</button>`;
  }).join('');
  let dismissed = false;
  try { dismissed = localStorage.getItem('notify.asked') === '1'; } catch (e) { /* private mode */ }
  const ask = notifSupported() && Notification.permission === 'default' && !dismissed
    ? `<div class="ds-notif">🔔 Dapat notifikasi saat Anda disebut atau menerima DM?<div><button type="button" class="wa-btn primary" onclick="enableBrowserNotify()">Aktifkan</button>
        <button type="button" class="wa-btn ghost" onclick="try{localStorage.setItem('notify.asked','1')}catch(e){};dsRenderSide()">Nanti</button></div></div>` : '';
  el.innerHTML = ask + `<div class="ds-side-h">Channel <button type="button" onclick="dsNewChannel()" title="Buat channel" aria-label="Buat channel">+</button></div>${channels}
    <div class="ds-side-h">Pesan langsung</div>${dms || '<div class="ds-none">Belum ada anggota lain.</div>'}`;
}

function dsRenderHead() {
  const el = document.getElementById('dsHead');
  if (!el || !ds.cur) return;
  const r = dsRoom(ds.cur.id) || ds.cur;
  if (r.kind === 'dm') {
    const on = r.with && ds.online.has(r.with.username);
    el.innerHTML = `${dsAvatar(r.with)}<div class="ds-head-t"><b>${escapeHtml(r.with ? r.with.name : '')}</b><span>${on ? '<i class="ds-dot on"></i> Online' : 'Offline'} · pesan langsung, hanya kalian berdua</span></div>`;
  } else {
    el.innerHTML = `<div class="ds-head-t"><b># ${escapeHtml(r.name)}</b>
      <button type="button" class="ds-topic" onclick="dsEditTopic()" title="Ubah topik">${r.topic ? escapeHtml(r.topic) : '<i>Tambahkan topik…</i>'}</button></div>
      <span class="ds-head-n">${ds.online.size} online</span>`;
  }
  el.insertAdjacentHTML('beforeend', '<button type="button" class="ds-sum-btn" onclick="dsSummary()" title="Ringkas diskusi oleh Aurix">✨ Ringkas</button>');
}

async function dsShowRoom(id) {
  ds.cur = dsRoom(id) || { id };
  ds.thread = null;
  document.getElementById('dsThread').classList.add('hidden');
  try { localStorage.setItem('ds.room', id); } catch (e) { /* private mode */ }
  dsRenderSide(); dsRenderHead();
  const box = document.getElementById('dsMsgs');
  box.innerHTML = '<div class="wa-msg"><span class="wa-spin"></span>Memuat pesan…</div>';
  try {
    const r = await api('GET', `/api/rooms/${id}/messages`);
    if (!ds.cur || ds.cur.id !== id) return;
    ds.msgs = r.messages; ds.hasMore = r.hasMore;
  } catch (e) { box.innerHTML = `<div class="wa-msg err">${escapeHtml(e.message)}</div>`; return; }
  dsRenderMsgs(true);
  dsMarkRead();
  const ta = document.getElementById('dsTa-main');
  if (ta) { ta.placeholder = 'Tulis pesan ke ' + dsRoomName(ds.cur) + '… (@ untuk menyebut)'; ta.focus(); }
}

async function dsOpenDm(username) {
  try { const r = await api('POST', '/api/rooms/dm', { username }); if (!dsRoom(r.room.id)) ds.rooms.push(r.room); dsShowRoom(r.room.id); }
  catch (e) { showToast(e.message); }
}

let dsReadT = null;
function dsMarkRead() {
  clearTimeout(dsReadT);
  const id = ds.cur && ds.cur.id;
  dsReadT = setTimeout(() => { if (id) api('POST', `/api/rooms/${id}/read`, {}).then(() => dsRefreshSoon()).catch(() => {}); }, 400);
}

function dsNearBottom() { const b = document.getElementById('dsMsgs'); return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 120; }

// @username of a team member -> highlighted (and stronger when it is me).
function dsMentions(html) {
  const names = new Set(ds.people.map((p) => p.username.toLowerCase()));
  const agents = new Set(AGENTS.map((a) => a.id));
  return html.replace(/(^|[\s(>])@([a-z0-9._-]{2,32})/gi, (m, pre, n) => {
    const k = n.toLowerCase();
    if (agents.has(k)) return `${pre}<span class="ds-at agent">@${n}</span>`;
    return names.has(k) ? `${pre}<span class="ds-at${k === (dsMe() || '').toLowerCase() ? ' me' : ''}">@${n}</span>` : m;
  });
}
function dsTypingHtml(roomId, parentId, inThread) {
  const set = ds.typing.get(roomId + ':' + parentId);
  if (!set || !set.size) return '';
  const names = [...set].map((id) => dsAgent(id).name).join(', ');
  return `<div class="ds-typing">${[...set].map((id) => dsAgentAvatar(id, 'sm')).join('')}<span class="ds-typing-dots"><i></i><i></i><i></i></span>${escapeHtml(names)} sedang menulis jawaban${inThread ? '' : ' di thread'}…</div>`;
}

function dsMsgHtml(m, prev, inThread) {
  const day = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(t);
  const sep = !prev || day(prev.createdAt) !== day(m.createdAt) ? `<div class="ds-day"><span>${escapeHtml(waDay(m.createdAt))}</span></div>` : '';
  const cont = !sep && prev && dsWho(prev) === dsWho(m) && m.createdAt - prev.createdAt < 5 * 60000 && !prev.deleted;
  const mine = !m.agent && m.author && m.author.username === dsMe();
  const body = m.deleted ? '<div class="ds-text del">Pesan ini dihapus</div>'
    : (m.body ? `<div class="ds-text" id="dsText-${m.id}">${dsMentions(formatMsg(m.body))}</div>` : '') + renderMsgAtt(m.attachments);
  const replies = !inThread && m.replies ? `<button type="button" class="ds-replies" onclick="dsOpenThread(${m.id})">💬 ${m.replies} balasan<span> · terakhir ${escapeHtml(waClock(m.lastReplyAt))}</span></button>` : '';
  const typing = !inThread && !m.parentId && ds.cur ? dsTypingHtml(ds.cur.id, m.id, false) : '';
  const acts = m.deleted ? '' : `<div class="ds-acts">
      ${inThread ? '' : `<button type="button" onclick="dsOpenThread(${m.id})" title="Balas di thread">💬</button>`}
      <button type="button" onclick="dsToTask(${m.id})" title="Jadikan tugas">✅</button>
      <button type="button" onclick="dsToEvent(${m.id})" title="Buat acara">🗓️</button>
      ${mine ? `<button type="button" onclick="dsEdit(${m.id})" title="Ubah">✏️</button><button type="button" onclick="dsDelete(${m.id})" title="Hapus">🗑️</button>` : ''}</div>`;
  const who = m.agent ? `<b>${escapeHtml(dsAgent(m.agent).name)}</b><em class="ds-tag">Agent</em>` : `<b>${escapeHtml(m.author ? m.author.name : 'Pengguna terhapus')}</b>`;
  return `${sep}<div class="ds-msg${cont ? ' cont' : ''}${m.agent ? ' agent' : ''}${m.mentions && m.mentions.includes(dsMe()) ? ' mention' : ''}" data-id="${m.id}">
      <div class="ds-gut">${cont ? `<span class="ds-hover-time">${escapeHtml(waClock(m.createdAt))}</span>` : m.agent ? dsAgentAvatar(m.agent) : dsAvatar(m.author)}</div>
      <div class="ds-body">${cont ? '' : `<div class="ds-meta">${who}<span>${escapeHtml(waClock(m.createdAt))}</span></div>`}
        ${body}${m.editedAt && !m.deleted ? '<span class="ds-edited">(diedit)</span>' : ''}${replies}${typing}</div>${acts}
    </div>`;
}

function dsRenderMsgs(scroll) {
  const box = document.getElementById('dsMsgs');
  if (!box) return;
  const keep = box.scrollHeight - box.scrollTop;
  const intro = ds.cur && !ds.hasMore ? `<div class="ds-intro"><b>${escapeHtml(dsRoomName(dsRoom(ds.cur.id) || ds.cur))}</b><p>${(dsRoom(ds.cur.id) || {}).kind === 'dm' ? 'Awal pesan langsung kalian. Hanya kalian berdua yang bisa melihatnya.' : 'Awal channel ini. Semua anggota tim bisa membaca dan menulis di sini.'}</p></div>` : '';
  box.innerHTML = (ds.hasMore ? '<button type="button" class="ds-more" onclick="dsLoadOlder()">Muat pesan sebelumnya</button>' : intro) +
    (ds.msgs.length ? ds.msgs.map((m, i) => dsMsgHtml(m, ds.msgs[i - 1], false)).join('') : '<div class="ds-empty">Belum ada pesan. Mulai diskusi di bawah.</div>');
  if (scroll === true) box.scrollTop = box.scrollHeight;
  else if (scroll === 'keep') box.scrollTop = box.scrollHeight - keep;
}

async function dsLoadOlder() {
  if (!ds.msgs.length) return;
  try {
    const r = await api('GET', `/api/rooms/${ds.cur.id}/messages?before=${ds.msgs[0].id}`);
    ds.msgs = r.messages.concat(ds.msgs); ds.hasMore = r.hasMore;
    dsRenderMsgs('keep');
  } catch (e) { showToast(e.message); }
}

// ── thread ──
async function dsOpenThread(id) {
  const panel = document.getElementById('dsThread');
  panel.classList.remove('hidden');
  panel.innerHTML = '<div class="wa-msg"><span class="wa-spin"></span>Memuat thread…</div>';
  try {
    const r = await api('GET', `/api/rooms/${ds.cur.id}/messages?parent=${id}`);
    ds.thread = r.parent; ds.threadMsgs = r.messages;
  } catch (e) { panel.innerHTML = `<div class="wa-msg err">${escapeHtml(e.message)}</div>`; return; }
  ds.staged.thread = [];
  dsRenderThread(true, true);
}
function dsRenderThread(scroll, rebuild) {
  const panel = document.getElementById('dsThread');
  if (!panel || !ds.thread) return;
  const list = `<div class="ds-thread-parent">${dsMsgHtml(ds.thread, null, true)}</div>
    <div class="ds-thread-n">${ds.threadMsgs.filter((m) => !m.deleted).length} balasan</div>
    ${ds.threadMsgs.map((m, i) => dsMsgHtml(m, ds.threadMsgs[i - 1], true)).join('')}${dsTypingHtml(ds.cur.id, ds.thread.id, true)}`;
  if (rebuild || !panel.querySelector('.ds-thread-list')) {
    panel.innerHTML = `<div class="ds-thread-h"><b>Thread</b><span>${escapeHtml(dsRoomName(dsRoom(ds.cur.id) || ds.cur))}</span>
        <button type="button" onclick="dsCloseThread()" aria-label="Tutup thread">✕</button></div>
      <div class="ds-thread-list">${list}</div>${dsComposerHtml('thread')}`;
    document.getElementById('dsTa-thread').focus();
  } else panel.querySelector('.ds-thread-list').innerHTML = list;
  const l = panel.querySelector('.ds-thread-list');
  if (scroll) l.scrollTop = l.scrollHeight;
}
function dsCloseThread() { ds.thread = null; document.getElementById('dsThread').classList.add('hidden'); }

// ── composer (main and thread) ──
function dsComposerHtml(w) {
  return `<div class="ds-compose" id="dsCompose-${w}">
      <div class="ds-att-row" id="dsAtt-${w}"></div>
      <div class="ds-compose-row">
        <button type="button" class="ds-attach" onclick="document.getElementById('dsFile-${w}').click()" title="Lampirkan file" aria-label="Lampirkan file">📎</button>
        <input type="file" id="dsFile-${w}" multiple hidden onchange="dsPick('${w}', this)">
        <textarea id="dsTa-${w}" rows="1" placeholder="${w === 'thread' ? 'Balas di thread…' : 'Tulis pesan…'}" oninput="dsInput('${w}', this)" onkeydown="dsKey(event,'${w}')"></textarea>
        <button type="button" class="ds-send" onclick="dsSend('${w}')" title="Kirim (Enter)" aria-label="Kirim">${SEND_ICON}</button>
      </div>
      <div class="ds-suggest hidden" id="dsSug-${w}"></div>
    </div>`;
}

function dsPick(w, input) {
  const files = [...input.files];
  input.value = '';
  for (const f of files) {
    const item = { id: 'ds' + (++stagedSeq), name: f.name, size: f.size, status: 'up', path: null, error: null };
    ds.staged[w].push(item);
    if (f.size > MAX_ATTACH_BYTES) { item.status = 'err'; item.error = 'Lebih dari ' + Math.round(MAX_ATTACH_BYTES / 1048576) + ' MB'; continue; }
    fetch('/upload', { method: 'POST', headers: { 'X-Upload-Name': encodeURIComponent(f.name), 'Content-Type': f.type || 'application/octet-stream' }, body: f })
      .then(async (res) => { const d = await res.json().catch(() => ({})); if (!res.ok || !d.path) throw new Error(d.error || 'Upload gagal'); item.status = 'ok'; item.path = d.path; item.size = d.size; })
      .catch((e) => { item.status = 'err'; item.error = e.message; })
      .finally(() => dsRenderAtt(w));
  }
  dsRenderAtt(w);
}
function dsRenderAtt(w) {
  const row = document.getElementById('dsAtt-' + w);
  if (!row) return;
  row.innerHTML = ds.staged[w].map((s) => `<span class="ds-chip ${s.status}" title="${escapeAttr(s.error || s.name)}">${s.status === 'up' ? '<span class="wa-spin"></span>' : FILE_ICON}
      <span>${escapeHtml(s.name)}</span><button type="button" onclick="dsUnstage('${w}','${s.id}')" aria-label="Hapus lampiran">×</button></span>`).join('');
}
function dsUnstage(w, id) { ds.staged[w] = ds.staged[w].filter((s) => s.id !== id); dsRenderAtt(w); }

async function dsSend(w) {
  const ta = document.getElementById('dsTa-' + w);
  const body = ta.value.trim();
  const items = ds.staged[w];
  if (items.some((s) => s.status === 'up')) { showToast('⏳ Lampiran masih diunggah'); return; }
  const att = items.filter((s) => s.status === 'ok').map((s) => ({ name: s.name, size: s.size, path: s.path }));
  if (!body && !att.length) return;
  const roomId = ds.cur.id;
  const parentId = w === 'thread' && ds.thread ? ds.thread.id : undefined;
  ta.value = ''; dsAutosize(ta); ds.staged[w] = []; dsRenderAtt(w); dsHideSuggest(w);
  try {
    const r = await api('POST', `/api/rooms/${roomId}/messages`, { body, attachments: att, parentId });
    // The stream brings it too; drawing now keeps the sender's view instant.
    if (ds.cur && ds.cur.id === roomId) {
      if (!parentId) { dsUpsert(ds.msgs, r.message, true); dsRenderMsgs(true); }
      else if (ds.thread && ds.thread.id === parentId) { dsUpsert(ds.threadMsgs, r.message, true); dsRenderThread(true); }
    }
  } catch (e) {
    showToast('⚠️ Pesan tidak terkirim: ' + e.message);
    ta.value = body; dsAutosize(ta);
  }
}

function dsAutosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }

// @ suggestions: the word being typed before the caret.
function dsInput(w, ta) {
  dsAutosize(ta);
  const before = ta.value.slice(0, ta.selectionStart);
  const m = before.match(/(^|\s)@([a-z0-9._-]*)$/i);
  const box = document.getElementById('dsSug-' + w);
  if (!m) { dsHideSuggest(w); return; }
  const q = m[2].toLowerCase();
  const match = (u, n) => u.toLowerCase().startsWith(q) || n.toLowerCase().split(/\s+/).some((x) => x.startsWith(q));
  const hits = [
    ...ds.people.filter((p) => p.username !== dsMe() && match(p.username, p.name)).map((p) => ({ u: p.username, html: `${dsAvatar(p, 'sm')}<b>${escapeHtml(p.name)}</b><span>@${escapeHtml(p.username)}</span>` })),
    ...AGENTS.filter((a) => match(a.id, a.name)).map((a) => ({ u: a.id, html: `${dsAgentAvatar(a.id, 'sm')}<b>${escapeHtml(a.name)}</b><span>Agent · ${escapeHtml(a.role)}</span>` }))
  ].slice(0, 8);
  if (!hits.length) { dsHideSuggest(w); return; }
  box.innerHTML = hits.map((h, i) => `<button type="button" class="${i ? '' : 'on'}" onmousedown="event.preventDefault();dsPickMention('${w}','${escapeAttr(h.u)}')">${h.html}</button>`).join('');
  box.classList.remove('hidden');
}
function dsHideSuggest(w) { const b = document.getElementById('dsSug-' + w); if (b) b.classList.add('hidden'); }
function dsPickMention(w, username) {
  const ta = document.getElementById('dsTa-' + w);
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos).replace(/@([a-z0-9._-]*)$/i, '@' + username + ' ');
  ta.value = before + ta.value.slice(pos);
  ta.selectionStart = ta.selectionEnd = before.length;
  dsHideSuggest(w); ta.focus();
}
function dsKey(e, w) {
  const box = document.getElementById('dsSug-' + w);
  if (box && !box.classList.contains('hidden')) {
    const items = [...box.querySelectorAll('button')];
    const i = items.findIndex((b) => b.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items.forEach((b, k) => b.classList.toggle('on', k === j));
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); items[Math.max(0, i)].dispatchEvent(new MouseEvent('mousedown')); return; }
    if (e.key === 'Escape') { dsHideSuggest(w); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dsSend(w); }
}

// ── edit / delete own messages ──
function dsFind(id) { return ds.msgs.find((m) => m.id === id) || ds.threadMsgs.find((m) => m.id === id) || (ds.thread && ds.thread.id === id ? ds.thread : null); }
function dsEdit(id) {
  const m = dsFind(id);
  const el = document.querySelector(`.ds-msg[data-id="${id}"] .ds-body`);
  if (!m || !el) return;
  const old = el.innerHTML;
  el.innerHTML = `<textarea class="ds-edit" rows="2">${escapeHtml(m.body)}</textarea>
    <div class="ds-edit-acts"><span>Enter simpan · Esc batal</span><button type="button" class="wa-btn ghost">Batal</button><button type="button" class="wa-btn primary">Simpan</button></div>`;
  const ta = el.querySelector('textarea');
  dsAutosize(ta); ta.focus(); ta.selectionStart = ta.value.length;
  const cancel = () => { el.innerHTML = old; };
  const save = async () => {
    try { await api('PATCH', '/api/room-messages/' + id, { body: ta.value }); }   // the stream redraws it
    catch (e) { showToast(e.message); cancel(); }
  };
  ta.oninput = () => dsAutosize(ta);
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } else if (e.key === 'Escape') cancel(); };
  const [b1, b2] = el.querySelectorAll('.ds-edit-acts button');
  b1.onclick = cancel; b2.onclick = save;
}
async function dsDelete(id) {
  if (!(await confirmDialog('Hapus pesan ini?', 'Pesan akan tampil sebagai "Pesan ini dihapus" untuk semua orang.', 'Hapus'))) return;
  try { await api('DELETE', '/api/room-messages/' + id); } catch (e) { showToast(e.message); }
}

// ── channel: create, topic ──
function dsNewChannel() {
  const box = document.getElementById('confirmBox');
  box.innerHTML = `<form class="cfm-card" onsubmit="event.preventDefault();dsCreateChannel(this)">
      <h3>Buat channel</h3><p>Channel terbuka untuk seluruh tim.</p>
      <label class="ds-field">Nama<input name="name" maxlength="40" required placeholder="mis. proyek-website" autocomplete="off"></label>
      <label class="ds-field">Topik <span>(opsional)</span><input name="topic" maxlength="200" placeholder="Untuk apa channel ini?"></label>
      <div class="cfm-actions"><button type="button" class="cfm-no" onclick="document.getElementById('confirmBox').classList.add('hidden')">Batal</button><button type="submit" class="cfm-yes ok">Buat</button></div></form>`;
  box.classList.remove('hidden');
  box.onclick = (e) => { if (e.target === box) box.classList.add('hidden'); };
  box.querySelector('input').focus();
}
async function dsCreateChannel(form) {
  try {
    const r = await api('POST', '/api/rooms', { name: form.name.value, topic: form.topic.value });
    document.getElementById('confirmBox').classList.add('hidden');
    ds.rooms.push(r.room);
    dsShowRoom(r.room.id);
  } catch (e) { showToast(e.message); }
}
async function dsEditTopic() {
  const r = dsRoom(ds.cur.id);
  const el = document.querySelector('#dsHead .ds-topic');
  if (!r || !el) return;
  el.outerHTML = `<input class="ds-topic-in" maxlength="200" value="${escapeAttr(r.topic || '')}" placeholder="Topik channel">`;
  const input = document.querySelector('#dsHead .ds-topic-in');
  input.focus();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    if (save && input.value.trim() !== (r.topic || '')) {
      try { await api('PATCH', '/api/rooms/' + r.id, { topic: input.value }); r.topic = input.value.trim() || null; } catch (e) { showToast(e.message); }
    }
    dsRenderHead();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
}

// ── "Ringkas diskusi" by Aurix ──
let dsSumPoll = null;
function dsSummary() {
  const box = document.getElementById('confirmBox');
  const r = dsRoom(ds.cur.id) || ds.cur;
  box.innerHTML = `<div class="cfm-card ds-sum"><h3>✨ Ringkas ${escapeHtml(dsRoomName(r))}</h3>
      <p>Aurix membaca diskusi (termasuk thread) dan merangkum topik, keputusan, dan tindak lanjut. Hasilnya hanya untuk Anda, kecuali Anda bagikan.</p>
      <div class="was-chips ds-sum-range">${[[1, '24 jam'], [7, '7 hari'], [30, '30 hari']].map(([d, l]) => `<button type="button" onclick="dsSummaryRun(${d})">${l}</button>`).join('')}</div>
      <div id="dsSumOut"></div>
      <div class="cfm-actions"><button type="button" class="cfm-no" onclick="dsSummaryClose()">Tutup</button></div></div>`;
  box.classList.remove('hidden');
  box.onclick = (e) => { if (e.target === box) dsSummaryClose(); };
}
function dsSummaryClose() { clearTimeout(dsSumPoll); document.getElementById('confirmBox').classList.add('hidden'); }
async function dsSummaryRun(days) {
  const out = document.getElementById('dsSumOut');
  document.querySelectorAll('.ds-sum-range button').forEach((b, i) => b.classList.toggle('on', [1, 7, 30][i] === days));
  out.innerHTML = '<div class="ds-sum-wait"><span class="wa-spin"></span>Aurix sedang membaca diskusi…</div>';
  let job;
  try { job = (await api('POST', `/api/rooms/${ds.cur.id}/summary`, { days })).summary; }
  catch (e) { out.innerHTML = `<div class="wa-msg err">${escapeHtml(e.message)}</div>`; return; }
  const poll = async () => {
    try { job = (await api('GET', '/api/room-summaries/' + job.id)).summary; } catch (e) { out.innerHTML = `<div class="wa-msg err">${escapeHtml(e.message)}</div>`; return; }
    if (!document.getElementById('dsSumOut')) return;
    if (job.status === 'running') { dsSumPoll = setTimeout(poll, 2000); return; }
    out.innerHTML = job.status === 'error' ? `<div class="wa-msg err">Gagal meringkas: ${escapeHtml(job.error || '')}</div>`
      : `<div class="ds-sum-res"><div class="ds-sum-meta">${escapeHtml(job.label)} · ${job.count} pesan · oleh Aurix</div><div class="was-result">${formatMsg(job.content)}</div>
         <div class="sc-actions"><button type="button" class="wa-btn ghost" onclick="navigator.clipboard.writeText(${escapeAttr(JSON.stringify(job.content))}).then(()=>showToast('Disalin'))">Salin</button>
         <button type="button" class="wa-btn primary" id="dsSumShare" onclick="dsSummaryShare('${job.id}')">Bagikan ke ${escapeHtml(dsRoomName(dsRoom(ds.cur.id) || ds.cur))}</button></div></div>`;
  };
  dsSumPoll = setTimeout(poll, 1500);
}
async function dsSummaryShare(id) {
  const b = document.getElementById('dsSumShare'); if (b) b.disabled = true;
  try { await api('POST', `/api/room-summaries/${id}/share`); dsSummaryClose(); showToast('Ringkasan dibagikan'); }
  catch (e) { showToast(e.message); if (b) b.disabled = false; }
}

// ── a message → a task (Task Focus) or an event (Schedule) ──
function dsPlain(text) { return String(text || '').replace(/[*_~`#>]/g, '').replace(/\s+/g, ' ').trim(); }
// A title from a message: its first line, at most 120 characters.
function dsTitle(text) {
  const line = dsPlain(String(text || '').split('\n')[0]);
  return line.length > 120 ? line.slice(0, 117).replace(/\s+\S*$/, '') + '…' : line;
}
function dsSourceNote(m) {
  const r = dsRoom(ds.cur.id) || ds.cur;
  const who = m.agent ? dsAgent(m.agent).name : (m.author ? m.author.name : '—');
  return `Dari ${dsRoomName(r)} — ${who}, ${schWibStamp(m.createdAt)}:\n${String(m.body).replace(/\*\*|__|`/g, '')}`;
}
async function dsToTask(id) {
  const m = dsFind(id);
  if (!m) return;
  if (!tf.people.length) { try { tf.people = (await api('GET', '/api/tasks/people')).people; } catch (e) { /* the select stays empty */ } }
  const mentioned = (m.mentions || []).find((u) => u !== dsMe());
  const who = mentioned || dsMe();
  const box = document.getElementById('confirmBox');
  box.innerHTML = `<form class="cfm-card" onsubmit="event.preventDefault();dsSaveTask(this, ${id})">
      <h3>✅ Jadikan tugas</h3><p>Masuk ke Task Focus, dengan isi pesan sebagai catatan.</p>
      <label class="ds-field">Judul tugas<input name="title" maxlength="300" required value="${escapeAttr(dsTitle(m.body))}"></label>
      <div class="ds-row2">
        <label class="ds-field">Penanggung jawab<select name="assignee">${tf.people.map((p) => `<option value="${escapeAttr(p.username)}"${p.username === who ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>
        <label class="ds-field">Tenggat <span>(opsional)</span><input type="date" name="due"></label>
      </div>
      <div class="cfm-actions"><button type="button" class="cfm-no" onclick="document.getElementById('confirmBox').classList.add('hidden')">Batal</button><button type="submit" class="cfm-yes ok">Buat tugas</button></div></form>`;
  box.classList.remove('hidden');
  box.onclick = (e) => { if (e.target === box) box.classList.add('hidden'); };
  box.querySelector('input').select();
}
async function dsSaveTask(form, id) {
  const m = dsFind(id);
  try {
    const r = await api('POST', '/api/tasks', { title: form.title.value, assignee: form.assignee.value, dueDate: form.due.value || null, notes: m ? dsSourceNote(m) : null });
    document.getElementById('confirmBox').classList.add('hidden');
    showToast(`Tugas dibuat untuk ${r.task.assignee ? r.task.assignee.name : 'tim'} — lihat di Task Focus`);
    tfBadge();
  } catch (e) { showToast(e.message); }
}
function dsToEvent(id) {
  const m = dsFind(id);
  if (!m) return;
  schPrefill = { title: dsTitle(m.body), notes: dsSourceNote(m).slice(0, 2000) };
  openWaPage('schedule');
}

meReady.then(() => { dsConnect(); dsRefreshSoon(); });

/* ── Notifications (EPIC-012 stage 3) ─────────────
   Browser: a desktop notification for a mention, a DM or an agent's answer
   while a Chat Center tab is open (but not looking at that conversation),
   and the unread count in the tab title. WhatsApp: set up on the profile
   page; the server sends it when such a message stays unread. */
const NOTIF_KEY = 'notify.browser';
const BASE_TITLE = document.title;
const notifSupported = () => 'Notification' in window;
function browserNotifyOn() {
  if (!notifSupported() || Notification.permission !== 'granted') return false;
  try { return localStorage.getItem(NOTIF_KEY) !== 'off'; } catch (e) { return true; }
}
function setBrowserNotify(on) { try { localStorage.setItem(NOTIF_KEY, on ? 'on' : 'off'); } catch (e) { /* private mode */ } }
async function enableBrowserNotify() {
  if (!notifSupported()) { showToast('Browser ini tidak mendukung notifikasi'); return false; }
  const p = await Notification.requestPermission();
  if (p === 'granted') { setBrowserNotify(true); showToast('🔔 Notifikasi browser aktif'); }
  else showToast('Notifikasi ditolak — izinkan lewat ikon gembok di address bar');
  if (waPage === 'discuss') dsRenderSide();
  if (waPage === 'profile') pfRender();
  return p === 'granted';
}

function dsNotify(ev) {
  const m = ev.message;
  if (!m || m.deleted || !browserNotifyOn()) return;
  const me = dsMe();
  if (!m.agent && m.author && m.author.username === me) return;
  const dm = ev.room && ev.room.kind === 'dm';
  const mentioned = (m.mentions || []).includes(me);
  if (!dm && !mentioned) return;
  const viewing = document.visibilityState === 'visible' && waPage === 'discuss' && ds.cur && ds.cur.id === ev.roomId &&
    (!m.parentId || (ds.thread && ds.thread.id === m.parentId));
  if (viewing) return;
  const who = m.agent ? dsAgent(m.agent).name : (m.author ? m.author.name : 'Seseorang');
  const where = dm ? 'pesan langsung' : '#' + (ev.room ? ev.room.name : '');
  const title = m.agent ? `${who} menjawab Anda` : dm ? `Pesan dari ${who}` : `${who} menyebut Anda di ${where}`;
  const text = String(m.body || '').replace(/[*_~`#>]/g, '').replace(/\s+/g, ' ').trim() || (m.attachments && m.attachments.length ? '📎 Lampiran' : '');
  try {
    const n = new Notification(title, { body: text.slice(0, 160), tag: 'hg-' + m.id, icon: '/assets/hg-logo.png' });
    n.onclick = () => { window.focus(); dsGoTo(ev.roomId, m.parentId); n.close(); };
  } catch (e) { /* some browsers only allow notifications from a service worker */ }
  dsDing();
}

// A short soft chime, no audio file needed.
function dsDing() {
  try {
    const ctx = dsDing.ctx || (dsDing.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.36);
  } catch (e) { /* no sound */ }
}

// Open a room (and thread) from a notification, whatever page is showing.
async function dsGoTo(roomId, parentId) {
  try { localStorage.setItem('ds.room', roomId); } catch (e) { /* private mode */ }
  if (waPage !== 'discuss') { openWaPage('discuss'); for (let i = 0; i < 40 && !(ds.cur && ds.cur.id === roomId && ds.msgs.length); i++) await wait(100); }
  else if (!ds.cur || ds.cur.id !== roomId) await dsShowRoom(roomId);
  if (parentId) dsOpenThread(parentId);
}

/* ── Profil & notifikasi (EPIC-012 T-075/T-076) ── */
const pf = { profile: null, changing: false, keys: undefined, scopes: null, newKey: null };
async function pfOpen() {
  await meReady;
  document.getElementById('profilePage').innerHTML = '<div class="wa-grid"><div class="wa-box"><div class="wa-msg"><span class="wa-spin"></span>Memuat profil…</div></div></div>';
  try { pf.profile = (await api('GET', '/api/profile')).profile; } catch (e) { pf.profile = null; showToast(e.message); }
  pf.changing = false; pf.keys = undefined; pf.newKey = null;
  if (waPage === 'profile') pfRender();
}
function pfClose() {}

function pfRender() {
  const el = document.getElementById('profilePage');
  if (!el) return;
  const p = pf.profile;
  const perm = notifSupported() ? Notification.permission : 'unsupported';
  const browser = perm === 'granted'
    ? `<div class="pf-row"><label class="pf-switch"><input type="checkbox" ${browserNotifyOn() ? 'checked' : ''} onchange="setBrowserNotify(this.checked);pfRender()"><span></span></label>
        <div><b>Notifikasi browser ${browserNotifyOn() ? 'aktif' : 'mati'}</b><div class="wa-sub">Untuk browser ini saja. Muncul saat tab Chat Center terbuka, walau di belakang.</div></div>
        <button class="wa-btn ghost" type="button" onclick="pfTestBrowser()">Tes</button></div>`
    : perm === 'denied' ? '<div class="wa-msg">Notifikasi diblokir di browser ini. Izinkan lewat ikon gembok di address bar, lalu muat ulang halaman.</div>'
      : perm === 'unsupported' ? '<div class="wa-msg">Browser ini tidak mendukung notifikasi.</div>'
        : `<div class="pf-row"><div><b>Belum aktif</b><div class="wa-sub">Browser akan meminta izin sekali.</div></div><button class="wa-btn primary" type="button" onclick="enableBrowserNotify()">🔔 Aktifkan</button></div>`;

  let wa;
  if (!p) wa = '<div class="wa-msg err">Gagal memuat pengaturan.</div>';
  else if (p.pending && !p.wa || (p.pending && pf.changing)) {
    wa = `<form class="pf-code" onsubmit="event.preventDefault();pfVerify(this)">
        <div class="wa-sub">Kode 6 angka dikirim bot ke <b>${escapeHtml(p.pending.number)}</b>. Berlaku 10 menit.</div>
        <div class="pf-inline"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required>
          <button class="wa-btn primary" type="submit">Verifikasi</button>
          <button class="wa-btn ghost" type="button" onclick="pf.profile.pending=null;pf.changing=true;pfRender()">Ganti nomor</button></div></form>`;
  } else if (!p.wa || pf.changing) {
    wa = `<form class="pf-code" onsubmit="event.preventDefault();pfRequest(this)">
        <div class="wa-sub">Nomor WhatsApp pribadi Anda. Bot (Rederp) akan mengirim kode verifikasi ke nomor ini.</div>
        <div class="pf-inline"><input name="number" inputmode="tel" placeholder="0812 3456 7890" required>
          <button class="wa-btn primary" type="submit" id="pfSend">Kirim kode</button>
          ${p.wa ? '<button class="wa-btn ghost" type="button" onclick="pf.changing=false;pfRender()">Batal</button>' : ''}</div></form>`;
  } else {
    wa = `<div class="pf-row"><div><b>${escapeHtml(p.wa.number)}</b> <span class="wa-pill ok">Terverifikasi</span></div>
        <button class="wa-btn ghost" type="button" onclick="pf.changing=true;pfRender()">Ganti</button>
        <button class="wa-btn ghost" type="button" onclick="pfRemove()">Hapus</button></div>
      <div class="pf-settings">
        <div class="pf-row"><label class="pf-switch"><input type="checkbox" id="pfOn" ${p.notifyWa ? 'checked' : ''} onchange="pfSave()"><span></span></label>
          <div><b>Kirim notifikasi WhatsApp</b><div class="wa-sub">Saat Anda di-@sebut, menerima DM, atau agent menjawab Anda — hanya jika belum dibaca.</div></div></div>
        <label class="pf-field">Tunggu sebelum mengirim
          <select id="pfDelay" onchange="pfSave()">${p.delays.map((d) => `<option value="${d}"${d === p.delayMin ? ' selected' : ''}>${d ? d + ' menit' : 'Langsung'}</option>`).join('')}</select></label>
        <div class="pf-field">Jam tenang (ditahan sampai pagi)
          <div class="pf-inline"><input type="time" id="pfQs" value="${p.quietStart}" onchange="pfSave()"><span>sampai</span><input type="time" id="pfQe" value="${p.quietEnd}" onchange="pfSave()"></div></div>
        <div class="pf-row"><div class="wa-sub">Saat Chat Center sedang terbuka di browser, WhatsApp menunggu sampai 30 menit. Beberapa notifikasi digabung jadi satu pesan. Membalas pesan bot tidak sampai ke Chat Center.</div>
          <button class="wa-btn ghost" type="button" onclick="pfTestWa(this)">Kirim pesan tes</button></div>
      </div>`;
  }
  el.innerHTML = `<div class="wa-grid">
      <div class="wa-box pf-me">${ME ? dsAvatar({ username: ME.username, name: ME.displayName }) : ''}<div><b>${escapeHtml(ME ? ME.displayName : '')}</b>
        <div class="wa-sub">@${escapeHtml(ME ? ME.username : '')}${ME && ME.role === 'admin' ? ' · Admin' : ''}</div></div>
        <button class="wa-btn ghost" type="button" onclick="logout()">Keluar</button></div>
      <div class="wa-box"><h3>🔔 Notifikasi browser</h3>${browser}</div>
      <div class="wa-box"><h3>💬 Notifikasi WhatsApp</h3>${wa}</div>
      ${ME && ME.role === 'admin' ? `<div class="wa-box" id="pfKeys"><h3>🔌 Integrasi API <span class="pf-admin">Admin</span></h3>${pfKeysHtml()}</div>` : ''}
    </div>`;
}

/* ── Integrasi API (EPIC-013): API keys for the WhatsApp agent etc. — admins ── */
async function pfLoadKeys() {
  try { const r = await api('GET', '/api/integrations/keys'); pf.keys = r.keys; pf.scopes = r.scopes; } catch (e) { pf.keys = null; }
  const box = document.getElementById('pfKeys');
  if (box) box.innerHTML = `<h3>🔌 Integrasi API <span class="pf-admin">Admin</span></h3>${pfKeysHtml()}`;
}
function pfKeysHtml() {
  if (pf.keys === undefined) { setTimeout(pfLoadKeys, 0); return '<div class="wa-msg"><span class="wa-spin"></span>Memuat…</div>'; }
  if (pf.keys === null) return '<div class="wa-msg err">Gagal memuat API key.</div>';
  const fresh = pf.newKey ? `<div class="pf-newkey"><b>Salin key ini sekarang — tidak akan ditampilkan lagi.</b>
      <div class="pf-inline"><code>${escapeHtml(pf.newKey)}</code><button class="wa-btn primary" type="button" onclick="navigator.clipboard.writeText('${escapeAttr(pf.newKey)}').then(()=>showToast('Key disalin'))">Salin</button>
      <button class="wa-btn ghost" type="button" onclick="pf.newKey=null;pfLoadKeys()">Sudah disimpan</button></div>
      <div class="wa-sub">Pasang ke agent WhatsApp dengan: <code>bash scripts/install-hermes-skill.sh</code> lalu tempel key ini saat diminta.</div></div>` : '';
  const rows = pf.keys.map((k) => `<tr class="${k.revokedAt ? 'revoked' : ''}"><td><b>${escapeHtml(k.name)}</b><div class="wa-sub"><code>${escapeHtml(k.prefix)}…</code></div></td>
      <td>${k.scopes.map((sc) => `<span class="pf-scope">${escapeHtml((pf.scopes && pf.scopes[sc]) || sc)}</span>`).join(' ')}</td>
      <td>${k.lastUsedAt ? escapeHtml(schWibStamp(k.lastUsedAt)) : '<span class="wa-sub">belum dipakai</span>'}</td>
      <td>${k.revokedAt ? '<span class="wa-pill bad">Dicabut</span>' : `<button class="wa-btn ghost" type="button" onclick="pfRevokeKey(${k.id}, '${escapeAttr(k.name)}')">Cabut</button>`}</td></tr>`).join('');
  return `${fresh}<p class="wa-sub">Untuk sistem lain yang memanggil Chat Center — misalnya agent WhatsApp (Rederp) yang membuat jadwal. Setiap pemakaian tercatat di audit log.</p>
    ${pf.keys.length ? `<table class="pf-keys"><thead><tr><th>Nama</th><th>Izin</th><th>Terakhir dipakai</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    <form class="pf-keyform" onsubmit="event.preventDefault();pfCreateKey(this)">
      <input name="name" maxlength="60" placeholder="Nama key, mis. Rederp (WhatsApp)" required>
      ${Object.entries(pf.scopes || {}).map(([sc, label]) => `<label class="pf-check"><input type="checkbox" name="scope" value="${sc}" checked> ${escapeHtml(label)}</label>`).join('')}
      <button class="wa-btn primary" type="submit">Buat API key</button></form>`;
}
async function pfCreateKey(form) {
  const scopes = [...form.querySelectorAll('input[name=scope]:checked')].map((i) => i.value);
  try { const r = await api('POST', '/api/integrations/keys', { name: form.name.value, scopes }); pf.newKey = r.key; }
  catch (e) { showToast(e.message); return; }
  pfLoadKeys();
}
async function pfRevokeKey(id, name) {
  if (!(await confirmDialog(`Cabut key "${name}"?`, 'Sistem yang memakai key ini langsung tidak bisa mengakses Chat Center lagi.', 'Cabut'))) return;
  try { await api('DELETE', '/api/integrations/keys/' + id); showToast('Key dicabut'); } catch (e) { showToast(e.message); }
  pfLoadKeys();
}

async function pfRequest(form) {
  const b = document.getElementById('pfSend'); b.disabled = true;
  try { pf.profile = (await api('POST', '/api/profile/wa', { number: form.number.value })).profile; pf.changing = true; showToast('Kode dikirim lewat WhatsApp'); }
  catch (e) { showToast(e.message); b.disabled = false; return; }
  pfRender();
  const c = document.querySelector('#profilePage input[name=code]'); if (c) c.focus();
}
async function pfVerify(form) {
  try { pf.profile = (await api('POST', '/api/profile/wa/verify', { code: form.code.value })).profile; pf.changing = false; showToast('✅ Nomor WhatsApp terverifikasi'); }
  catch (e) { showToast(e.message); return; }
  pfRender();
}
async function pfRemove() {
  if (!(await confirmDialog('Hapus nomor WhatsApp?', 'Anda tidak akan menerima notifikasi WhatsApp lagi sampai menambahkan nomor baru.', 'Hapus'))) return;
  try { pf.profile = (await api('DELETE', '/api/profile/wa')).profile; } catch (e) { showToast(e.message); }
  pfRender();
}
async function pfSave() {
  try {
    pf.profile = (await api('PATCH', '/api/profile', {
      notifyWa: document.getElementById('pfOn').checked, delayMin: Number(document.getElementById('pfDelay').value),
      quietStart: document.getElementById('pfQs').value, quietEnd: document.getElementById('pfQe').value
    })).profile;
    showToast('Pengaturan disimpan');
  } catch (e) { showToast(e.message); }
  pfRender();
}
async function pfTestWa(b) {
  b.disabled = true;
  try { await api('POST', '/api/profile/wa/test'); showToast('Pesan tes dikirim — cek WhatsApp Anda'); } catch (e) { showToast(e.message); }
  b.disabled = false;
}
function pfTestBrowser() {
  try { new Notification('HG Chat — tes notifikasi', { body: 'Beginilah tampilan notifikasi saat Anda disebut atau menerima DM.', icon: '/assets/hg-logo.png' }); dsDing(); }
  catch (e) { showToast('Browser ini menolak notifikasi dari halaman'); }
}

/* ── Page registry: one container per WhatsApp page ── */
const WA_IMPL = {
  connect: { el: 'waConnect', open: waConnectOpen, close: waConnectClose },
  groups: { el: 'waGroupsPage', open: waGroupsOpen, close: waGroupsClose },
  summary: { el: 'waSummaryPage', open: waSummaryOpen, close: waSummaryClose },
  schedule: { el: 'schedulePage', open: schOpen, close: schClose },
  tasks: { el: 'tasksPage', open: tfOpen, close: tfClose },
  discuss: { el: 'discussPage', open: dsOpen, close: dsClose },
  profile: { el: 'profilePage', open: pfOpen, close: pfClose }
};
function closeWaPages() { for (const p of Object.values(WA_IMPL)) p.close(); }

// A reload on #wa-groups, #schedule (etc.) reopens that page.
function pageFromHash() { return Object.keys(WA_PAGES).find((k) => pageHash(k) === location.hash) || null; }
function openWaFromHash() {
  const key = pageFromHash();
  if (key) openWaPage(key);
}

// Back/forward or an edited address: follow the hash.
window.addEventListener('hashchange', () => {
  if (pageFromHash()) openWaFromHash();
  else showChatView();
});

renderDrop();renderSb();
refreshConvs().then(() => switchAgent('dave')).then(openWaFromHash).then(importOldHistory);
