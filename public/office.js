/* ── Virtual Office (EPIC-018) ──────────────────────────────────────────
   A 3D office drawn with CSS 3D transforms only (no WebGL, no library):
   each piece of furniture is a box of five faces, people are billboards that
   always face the camera. Every agent sits at a desk; clicking the agent, the
   desk, or the agent's chip opens the chat with that agent. Drag to turn the
   room, scroll or pinch to zoom.

   World units are CSS pixels on the floor plane: x → right, y → toward the
   front of the room, z → up. The back wall is y = 0, the left wall x = 0. */

const VO = {
  W: 1100, D: 820, H: 240,          // room size
  rz: 40, rx: 58, zoom: 1,          // camera: turn, tilt, zoom
  timer: null, onResize: null,
  ptr: new Map(), drag: null, dragged: false, pinch: null,
};
const VO_LIMITS = { rz: [8, 82], rx: [40, 70], zoom: [0.55, 2.4] };
const VO_COLOR = { dave: '#C9A84C', jaden: '#E07A5F', joel: '#3B82F6', dylan: '#10B981', nana: '#A855F7' };
const VO_FALLBACK = ['#C9A84C', '#E07A5F', '#3B82F6', '#10B981', '#A855F7', '#F59E0B'];
// Desk slots, in AGENTS order: two rows facing the back wall.
const VO_SLOTS = [{ x: 120, y: 236 }, { x: 390, y: 236 }, { x: 660, y: 236 }, { x: 120, y: 500 }, { x: 390, y: 500 }, { x: 660, y: 500 }];

const voColor = (a, i) => VO_COLOR[a.id] || VO_FALLBACK[i % VO_FALLBACK.length];

/* ── Primitives (HTML strings) ── */

// A solid box: top + four sides, shaded from one colour (--c); --t overrides the top.
function voBox(x, y, z, w, d, h, c, cls = '', top = '') {
  return `<div class="vo-b${cls ? ' ' + cls : ''}" style="left:${x}px;top:${y}px;width:${w}px;height:${d}px;transform:translateZ(${z}px);--c:${c}${top ? ';--t:' + top : ''}">`
    + `<i class="vo-t" style="transform:translateZ(${h}px)"></i>`
    + `<i class="vo-f" style="top:${d - h}px;width:${w}px;height:${h}px"></i>`
    + `<i class="vo-k" style="top:${-h}px;width:${w}px;height:${h}px"></i>`
    + `<i class="vo-r" style="left:${w}px;width:${h}px;height:${d}px"></i>`
    + `<i class="vo-l" style="width:${h}px;height:${d}px"></i></div>`;
}
// A flat upright panel in the plane y = const, facing the front of the room.
function voPanel(x, y, z, w, h, cls, inner = '') {
  return `<div class="vo-p ${cls}" style="left:${x}px;top:${y - h}px;width:${w}px;height:${h}px;transform:translateZ(${z}px) rotateX(-90deg)">${inner}</div>`;
}
// A flat piece lying on the floor (or any height).
function voFlat(x, y, z, w, d, cls, inner = '') {
  return `<div class="vo-flat ${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${d}px;transform:translateZ(${z}px)">${inner}</div>`;
}
// A billboard standing at (x, y, z) that always faces the camera.
function voSprite(x, y, z, w, h, cls, inner = '', attrs = '') {
  return `<div class="vo-sp ${cls}" style="left:${x - w / 2}px;top:${y - h}px;width:${w}px;height:${h}px;transform:translateZ(${z}px) rotateZ(calc(var(--rz) * -1)) rotateX(calc(var(--rx) * -1))"${attrs}>${inner}</div>`;
}
function voPlant(x, y, size = 1) {
  const p = Math.round(26 * size), h = Math.round(30 * size);
  return voFlat(x - 8, y - 4, 0.5, p + 16, p + 12, 'vo-shadow')
    + voBox(x, y, 0, p, p, h, '#C9734E', '', '#7A4A33')
    + voSprite(x + p / 2, y + p / 2, h - 6, Math.round(70 * size), Math.round(84 * size), 'vo-leaves');
}

/* ── The room ── */

function voDaypart() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
  return h >= 6 && h < 16 ? 'day' : h >= 16 && h < 19 ? 'dusk' : 'night';
}

function voDesk(a, i) {
  const { x, y } = VO_SLOTS[i];
  const c = voColor(a, i);
  const lines = Array.from({ length: 7 }, (_, k) => `<b style="width:${30 + ((k * 37 + i * 13) % 55)}%"></b>`).join('');
  return `<div class="vo-desk" data-agent="${escapeAttr(a.id)}" style="--ac:${c}" onclick="voPick('${escapeAttr(a.id)}')" onmouseenter="voHover('${escapeAttr(a.id)}',true)" onmouseleave="voHover('${escapeAttr(a.id)}',false)">`
    + voFlat(x - 14, y - 8, 0.6, 218, 200, 'vo-shadow')
    + voFlat(x + 40, y + 96, 0.8, 110, 110, 'vo-ring')
    // desk: two side panels, drawer unit, top
    + voBox(x + 4, y + 6, 0, 8, 74, 70, '#CFC8BC')
    + voBox(x + 178, y + 6, 0, 8, 74, 70, '#CFC8BC')
    + voBox(x + 132, y + 10, 0, 42, 66, 58, '#E4DED3')
    + voBox(x, y, 70, 190, 86, 6, '#F3EFE8', '', '#FAF8F4')
    // monitor: foot, arm, screen with the agent's work on it
    + voBox(x + 82, y + 10, 76, 26, 16, 2, '#2C2F37')
    + voBox(x + 92, y + 14, 78, 6, 6, 26, '#3A3D46')
    + voBox(x + 46, y + 10, 98, 98, 6, 58, '#1E2027')
    + voPanel(x + 49, y + 16.6, 101, 92, 52, 'vo-screen', `<span class="vo-scr-h">${escapeHtml(a.name)}</span>${lines}<em></em>`)
    // keyboard, mouse, mug, notes
    + voBox(x + 60, y + 40, 76, 64, 18, 3, '#D9D9E1', '', '#ECECF2')
    + voBox(x + 134, y + 44, 76, 9, 13, 3, '#D9D9E1')
    + voBox(x + 18, y + 22, 76, 13, 13, 15, c)
    + voFlat(x + 16, y + 52, 76.6, 30, 22, 'vo-notes')
    // chair
    + voBox(x + 91, y + 128, 0, 8, 8, 40, '#55585F')
    + voFlat(x + 70, y + 110, 0.7, 50, 48, 'vo-chairbase')
    + voBox(x + 70, y + 108, 40, 50, 46, 8, '#30343E')
    + voBox(x + 70, y + 150, 46, 50, 8, 62, '#30343E')
    // the agent: torso in the agent's colour, face as a billboard
    + voBox(x + 78, y + 116, 48, 34, 24, 42, c, 'vo-body')
    + voBox(x + 72, y + 120, 66, 8, 18, 20, c, 'vo-body')
    + voBox(x + 110, y + 120, 66, 8, 18, 20, c, 'vo-body')
    + voSprite(x + 95, y + 128, 88, 64, 64, 'vo-head', `<span class="vo-head-in"><img src="${a.img}" alt=""></span>`)
    + voSprite(x + 95, y + 128, 160, 120, 26, 'vo-name', `<span>${escapeHtml(a.name)}</span>`)
    + voSprite(x + 95, y + 128, 190, 170, 30, 'vo-bubble', '<span>✍️ sedang membalas…</span>')
    + '</div>';
}

function voScene() {
  const { W, D, H } = VO;
  const [hh, mm] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
  const clock = { h: (hh % 12) * 30 + mm * 0.5, m: mm * 6 };
  const books = [];
  const bookColors = ['#B4463A', '#2F6F9F', '#C9A84C', '#3E7D5A', '#6B4FA0', '#D07A3A', '#334155'];
  for (let s = 0; s < 3; s++) {
    let y = 612;
    for (let b = 0; b < 7; b++) {
      const d = 14 + ((s * 7 + b) * 5) % 9, h = 30 + ((s * 3 + b * 7) % 4) * 6;
      books.push(voBox(10, y, 16 + s * 56, 30, d, h, bookColors[(s * 2 + b) % bookColors.length]));
      y += d + 3;
    }
  }
  const leds = Array.from({ length: 6 }, (_, r) => `<div class="vo-rack-row"><i></i><i></i><i></i><span></span></div>`).join('');
  const chairsAround = [[812, 452], [880, 452], [948, 452], [812, 604], [880, 604], [948, 604]]
    .map(([cx, cy], k) => voBox(cx, cy, 0, 44, 40, 34, '#475066', '', '#56607A') + voBox(cx, k < 3 ? cy - 8 : cy + 40, 30, 44, 8, 40, '#475066'))
    .join('');
  return voFlat(0, 0, 0, W, D, 'vo-floor')
    + voFlat(0, 0, 0.3, W, D, 'vo-light')
    // walls with baseboards
    + voBox(-16, -16, 0, W + 16, 16, H, '#ECE7DE', 'vo-wall', '#D9D2C4')
    + voBox(-16, 0, 0, 16, D, H, '#E4DED2', 'vo-wall', '#D9D2C4')
    + voBox(0, 0, 0, W, 4, 10, '#BDB4A5')
    + voBox(0, 4, 0, 4, D - 4, 10, '#BDB4A5')
    // windows along the back wall
    + voPanel(96, 1, 64, 540, 138, 'vo-window', '<i></i><i></i><i></i><i></i>')
    + voBox(90, 0, 58, 552, 10, 6, '#F7F4EE')
    // logo, clock
    + voPanel(752, 1, 150, 270, 58, 'vo-logo', '<img src="/assets/hg-logo.png" alt=""><span><b>HG</b> Virtual Office</span>')
    + voPanel(690, 1, 162, 40, 40, 'vo-clock', `<i class="h" style="transform:rotate(${clock.h}deg)"></i><i class="m" style="transform:rotate(${clock.m}deg)"></i>`)
    // server rack (Hermes) in the back-left corner
    + voFlat(0, 22, 0.5, 90, 100, 'vo-shadow')
    + voBox(6, 26, 0, 66, 80, 178, '#262932', '', '#30343F')
    + voPanel(12, 106.6, 14, 54, 156, 'vo-rack', `<span class="vo-rack-l">HERMES</span>${leds}`)
    // coffee corner along the back wall
    + voBox(846, 4, 0, 236, 66, 90, '#7B5B40', '', '#EDE8E0')
    + voPanel(852, 70.6, 10, 224, 70, 'vo-cabinet', '<i></i><i></i><i></i>')
    + voBox(872, 14, 90, 48, 40, 58, '#2A2B31', '', '#3A3B42')
    + voPanel(878, 54.6, 112, 36, 22, 'vo-machine', '<i></i>')
    + voBox(932, 30, 90, 12, 12, 14, '#F5F5F5') + voBox(950, 34, 90, 12, 12, 14, '#C9A84C')
    + voBox(990, 16, 90, 70, 34, 4, '#D8D2C8')
    + voSprite(1040, 36, 90, 46, 56, 'vo-leaves sm')
    // task board on the left wall, sticky notes in three columns
    + voBox(0, 300, 86, 5, 230, 118, '#F8F8FA', '', '#E7E7EC')
    + voBox(0, 296, 82, 7, 238, 4, '#9CA3AF') + voBox(0, 296, 204, 7, 238, 4, '#9CA3AF')
    + [[318, 178, '#FDE68A'], [318, 150, '#BFDBFE'], [318, 122, '#FDE68A'], [390, 178, '#FBCFE8'], [390, 150, '#BBF7D0'],
       [462, 178, '#BBF7D0'], [462, 150, '#BBF7D0'], [462, 122, '#FDE68A'], [346, 100, '#FECACA']]
      .map(([ny, nz, nc]) => voBox(5, ny, nz, 3, 26, 22, nc)).join('')
    + voBox(5, 372, 96, 2, 1, 104, '#D1D5DB') + voBox(5, 444, 96, 2, 1, 104, '#D1D5DB')
    // bookshelf against the left wall
    + voFlat(0, 596, 0.5, 70, 190, 'vo-shadow')
    + voBox(4, 600, 0, 48, 176, 184, '#7A5A3C', '', '#8A6A4A')
    + voBox(4, 600, 70, 48, 176, 4, '#6A4C30') + voBox(4, 600, 126, 48, 176, 4, '#6A4C30')
    + books.join('')
    // meeting corner: rug, table, chairs, laptop, screen
    + voFlat(748, 392, 0.4, 330, 300, 'vo-rug')
    + voFlat(800, 486, 0.6, 210, 120, 'vo-shadow')
    + voBox(900, 522, 0, 14, 14, 68, '#4A4E57')
    + voBox(862, 584, 0, 90, 10, 4, '#4A4E57')
    + voBox(800, 488, 68, 214, 116, 7, '#E9E3D9', '', '#F6F2EC')
    + chairsAround
    + voBox(880, 520, 75, 46, 32, 2, '#B9BCC6')
    + voBox(880, 518, 77, 46, 2, 28, '#2F323A')
    + voBox(1060, 470, 0, 10, 10, 120, '#4A4E57')
    + voBox(1032, 452, 120, 66, 46, 3, '#2F323A')
    // plants
    + voPlant(1046, 300) + voPlant(1046, 730, 1.15) + voPlant(18, 330, 0.9) + voPlant(560, 760, 1.05)
    // the team
    + AGENTS.slice(0, VO_SLOTS.length).map(voDesk).join('');
}

/* ── Page ── */

function voOpen() {
  voClose();
  const el = document.getElementById('officePage');
  const chips = AGENTS.slice(0, VO_SLOTS.length).map((a, i) => `<button type="button" class="vo-chip" data-agent="${escapeAttr(a.id)}" style="--ac:${voColor(a, i)}" onclick="voPick('${escapeAttr(a.id)}')" onmouseenter="voHover('${escapeAttr(a.id)}',true)" onmouseleave="voHover('${escapeAttr(a.id)}',false)" onfocus="voHover('${escapeAttr(a.id)}',true)" onblur="voHover('${escapeAttr(a.id)}',false)">
      <img src="${a.img}" alt=""><span><b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.role)}</small></span><i class="vo-dot"></i></button>`).join('');
  el.innerHTML = `<div class="vo vo-${voDaypart()}">
    <div class="vo-stage" id="voStage"><div class="vo-cam" id="voCam"><div class="vo-world" id="voWorld">${voScene()}</div></div></div>
    <div class="vo-hud">
      <div class="vo-title"><b>Virtual Office</b><span>Klik agent di mejanya untuk mulai chat · geser untuk memutar ruangan</span></div>
      <div class="vo-ctl" role="group" aria-label="Kamera">
        <button type="button" onclick="voTurn(-12)" title="Putar ke kiri" aria-label="Putar ke kiri">⟲</button>
        <button type="button" onclick="voTurn(12)" title="Putar ke kanan" aria-label="Putar ke kanan">⟳</button>
        <button type="button" onclick="voZoom(1.15)" title="Perbesar" aria-label="Perbesar">＋</button>
        <button type="button" onclick="voZoom(1 / 1.15)" title="Perkecil" aria-label="Perkecil">－</button>
        <button type="button" onclick="voReset()" title="Tampilan awal" aria-label="Tampilan awal">⌂</button>
      </div>
    </div>
    <div class="vo-card hidden" id="voCard"></div>
    <div class="vo-chips">${chips}</div>
  </div>`;
  const stage = document.getElementById('voStage');
  stage.addEventListener('pointerdown', voDown);
  stage.addEventListener('pointermove', voMove);
  stage.addEventListener('pointerup', voUp);
  stage.addEventListener('pointercancel', voUp);
  stage.addEventListener('wheel', voWheel, { passive: false });
  stage.addEventListener('click', (e) => { if (VO.dragged) { e.stopPropagation(); e.preventDefault(); VO.dragged = false; } }, true);
  VO.onResize = () => voApply();
  window.addEventListener('resize', VO.onResize);
  voApply();
  voStatus();
  VO.timer = setInterval(voStatus, 1500);
}

function voClose() {
  clearInterval(VO.timer); VO.timer = null;
  if (VO.onResize) window.removeEventListener('resize', VO.onResize);
  VO.onResize = null; VO.ptr.clear(); VO.drag = null; VO.pinch = null;
}

function voPick(id) {
  if (VO.dragged) return;
  switchAgent(id);
}

function voHover(id, on) {
  document.querySelectorAll(`#officePage [data-agent="${CSS.escape(id)}"]`).forEach((n) => n.classList.toggle('hot', on));
  const card = document.getElementById('voCard');
  if (!card) return;
  const a = AGENTS.find((x) => x.id === id);
  if (!on || !a) { card.classList.add('hidden'); return; }
  const busy = voBusy(id);
  const last = convs.filter((c) => c.agentId === id).sort((p, q) => (q.updatedAt || 0) - (p.updatedAt || 0))[0];
  card.innerHTML = `<img src="${a.img}" alt=""><div><b>${escapeHtml(a.name)}</b><span>${escapeHtml(a.role)}</span>
    <small>${busy ? '✍️ Sedang membalas pesan Anda' : last ? 'Chat terakhir ' + escapeHtml(fmtTime(last.updatedAt)) : 'Belum pernah chat'}</small><em>Klik untuk chat →</em></div>`;
  card.style.setProperty('--ac', VO_COLOR[id] || 'var(--gold)');
  card.classList.remove('hidden');
}

// An agent is busy while one of your conversations with it is waiting for a reply.
function voBusy(id) { return convs.some((c) => c.agentId === id && pending[c.id]); }
function voStatus() {
  if (waPage !== 'office') return;
  for (const a of AGENTS) {
    const busy = voBusy(a.id);
    document.querySelectorAll(`#officePage [data-agent="${CSS.escape(a.id)}"]`).forEach((n) => n.classList.toggle('busy', busy));
  }
}

/* ── Camera ── */

const voClamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
function voApply() {
  const stage = document.getElementById('voStage');
  const world = document.getElementById('voWorld');
  const cam = document.getElementById('voCam');
  if (!stage || !world || !cam) return;
  // A phone shows the room larger (the far wall corners may crop); pinch to see more.
  const narrow = stage.clientWidth < 600;
  const fit = narrow ? Math.min(stage.clientWidth / 1120, stage.clientHeight / 980) : Math.min(stage.clientWidth / 1560, stage.clientHeight / 1080);
  world.style.setProperty('--rz', VO.rz + 'deg');
  world.style.setProperty('--rx', VO.rx + 'deg');
  world.style.width = VO.W + 'px'; world.style.height = VO.D + 'px';
  world.style.left = -VO.W / 2 + 'px'; world.style.top = -VO.D / 2 + 'px';
  cam.style.transform = `translateY(${Math.round(stage.clientHeight * 0.01)}px) scale(${(fit * VO.zoom).toFixed(3)})`;
}
function voTurn(d) { VO.rz = voClamp(VO.rz + d, VO_LIMITS.rz); voApply(); }
function voZoom(f) { VO.zoom = voClamp(VO.zoom * f, VO_LIMITS.zoom); voApply(); }
function voReset() { VO.rz = 40; VO.rx = 58; VO.zoom = 1; voApply(); }

function voDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  VO.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
  VO.dragged = false;
  if (VO.ptr.size === 1) VO.drag = { x: e.clientX, y: e.clientY, rz: VO.rz, rx: VO.rx, moved: 0 };
  if (VO.ptr.size === 2) { const [p, q] = [...VO.ptr.values()]; VO.pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), zoom: VO.zoom }; }
}
function voMove(e) {
  if (!VO.ptr.has(e.pointerId)) return;
  VO.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (VO.ptr.size >= 2 && VO.pinch) {
    const [p, q] = [...VO.ptr.values()];
    VO.zoom = voClamp(VO.pinch.zoom * Math.hypot(p.x - q.x, p.y - q.y) / (VO.pinch.d || 1), VO_LIMITS.zoom);
    VO.dragged = true; voApply(); return;
  }
  const d = VO.drag;
  if (!d) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
  if (d.moved < 6) return;
  if (!VO.dragged) { VO.dragged = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* already released */ } }
  VO.rz = voClamp(d.rz - dx * 0.22, VO_LIMITS.rz);
  VO.rx = voClamp(d.rx - dy * 0.12, VO_LIMITS.rx);
  voApply();
}
function voUp(e) {
  VO.ptr.delete(e.pointerId);
  if (VO.ptr.size < 2) VO.pinch = null;
  if (VO.ptr.size === 0) VO.drag = null;
  // A click right after a drag is swallowed once (see the capture listener).
  if (VO.dragged) setTimeout(() => { VO.dragged = false; }, 0);
}
function voWheel(e) {
  e.preventDefault();
  voZoom(Math.exp(-e.deltaY * 0.0015));
}
