/* ── Virtual Office in three.js (EPIC-018 T-113) ────────────────────────
   A realistic, lit office: PBR materials, the sun coming in through the
   window opening, soft shadows, procedural textures (wood floor, rug, screens,
   board, sky), people seated at their desks who type while they answer, and
   Aurix the WhatsApp robot at the meeting table. office.js stays in charge of
   the chat panel and statuses; this module only draws and reports clicks.

   Units are metres. x → right, y → up, z → toward the front of the room.
   The back wall is z = Z0, the left wall x = X0; the open sides face the camera. */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const W = 8.4, D = 13, H = 3;   // the HG office: long wall 13 m, window wall 8.4 m
const X0 = -W / 2, Z0 = -D / 2;
const DESK_TOP = 0.75;
// Desk centres, in AGENTS order (the same layout as the CSS office).
const AURIX_AT = [-3.1, -3.0];   // by the CCTV wall, watching the WhatsApp groups
const HOME = { az: 0.78, polar: 0.97, target: new THREE.Vector3(-0.2, 0.4, 0.1) };
const LOOKS = {
  dave: { hair: '#2A1E17', skin: '#E2B793', style: 'short' },
  jaden: { hair: '#17110E', skin: '#E8C19E', style: 'swept' },
  joel: { hair: '#21170F', skin: '#D9AC86', style: 'short' },
  dylan: { hair: '#3A2A1E', skin: '#E9C6A3', style: 'curly' },
  nana: { hair: '#D8B377', skin: '#F0D2B8', style: 'long' },
};

/* ── small helpers ── */

function rng(seed) { // mulberry32: stable "random" detail
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function mount(stage, opts) {
  const { agents, aurix, onPick, onHover, daypart = 'day', mobile = false } = opts;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  /* renderer, scene, camera */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);   // the page's backdrop shows around the room
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = daypart === 'night' ? 1.05 : 1.0;
  renderer.domElement.className = 'vo3-canvas';
  stage.appendChild(renderer.domElement);
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const el = renderer.domElement;
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'vo3-labels';
  stage.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = keep(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = daypart === 'night' ? 0.18 : 0.42;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.08, enablePan: false, rotateSpeed: 0.55, zoomSpeed: 0.8,
    minDistance: 6, maxDistance: 38, minPolarAngle: 0.42, maxPolarAngle: 1.28,
    // stay on the open side of the room: the walls never come between camera and desks
    minAzimuthAngle: 0.06, maxAzimuthAngle: 1.5,
  });
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  /* ── textures ── */
  function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANISO;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return keep(t);
  }
  const woodTex = canvasTex(1024, 1024, (g, w, h) => {
    const r = rng(7);
    const rows = 8, rh = h / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * 400;
      while (x < w) {
        const len = 300 + r() * 420;
        const l = 52 + r() * 10, s = 38 + r() * 12, hue = 28 + r() * 8;
        g.fillStyle = `hsl(${hue},${s}%,${l}%)`;
        g.fillRect(x, i * rh, len, rh);
        // grain
        for (let k = 0; k < 26; k++) {
          g.strokeStyle = `rgba(${90 + r() * 40},${55 + r() * 25},${25 + r() * 15},${0.05 + r() * 0.08})`;
          g.lineWidth = 0.6 + r() * 1.4;
          const y0 = i * rh + r() * rh;
          g.beginPath(); g.moveTo(x, y0);
          g.bezierCurveTo(x + len * 0.3, y0 + (r() - 0.5) * 10, x + len * 0.7, y0 + (r() - 0.5) * 10, x + len, y0 + (r() - 0.5) * 6);
          g.stroke();
        }
        g.fillStyle = 'rgba(55,32,14,.55)'; g.fillRect(x, i * rh, 2, rh);
        x += len;
      }
      g.fillStyle = 'rgba(55,32,14,.5)'; g.fillRect(0, i * rh, w, 2);
    }
  }, { repeat: [W / 1.7, D / 1.7] });

  const rugTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#26404D'; g.fillRect(0, 0, w, h);
    for (let i = -w; i < w * 2; i += 22) { g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 9; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); }
    g.strokeStyle = '#1C313C'; g.lineWidth = 34; g.strokeRect(17, 17, w - 34, h - 34);
    g.strokeStyle = '#C9A84C'; g.lineWidth = 4; g.strokeRect(46, 46, w - 92, h - 92);
    // a little wool noise
    const r = rng(3);
    for (let k = 0; k < 9000; k++) { g.fillStyle = `rgba(255,255,255,${r() * 0.035})`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
  });

  function skyTex() {
    return canvasTex(1024, 512, (g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      if (daypart === 'night') { sky.addColorStop(0, '#060A1C'); sky.addColorStop(1, '#1D2747'); }
      else if (daypart === 'dusk') { sky.addColorStop(0, '#F08A55'); sky.addColorStop(0.55, '#F6C28E'); sky.addColorStop(1, '#F7E0C0'); }
      else { sky.addColorStop(0, '#7FBDEB'); sky.addColorStop(0.6, '#CDE7F8'); sky.addColorStop(1, '#EEF6FB'); }
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      const r = rng(11);
      if (daypart === 'day') for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(255,255,255,.7)'; const cx = r() * w, cy = 40 + r() * 140; for (let j = 0; j < 5; j++) { g.beginPath(); g.arc(cx + j * 26, cy + (j % 2) * 8, 22 + r() * 14, 0, Math.PI * 2); g.fill(); } }
      // two layers of buildings
      for (const [base, col, n] of [[0.42, daypart === 'night' ? '#141B31' : daypart === 'dusk' ? '#8C6F7C' : '#A9BCD2', 22], [0.55, daypart === 'night' ? '#0E1426' : daypart === 'dusk' ? '#6B5464' : '#8EA4BF', 16]]) {
        let x = -20;
        while (x < w) {
          const bw = 40 + r() * 70, bh = h * (base * (0.5 + r()));
          g.fillStyle = col; g.fillRect(x, h - bh, bw, bh);
          if (daypart !== 'day') for (let yy = h - bh + 10; yy < h - 8; yy += 14) for (let xx = x + 6; xx < x + bw - 6; xx += 11) if (r() < (daypart === 'night' ? 0.45 : 0.12)) { g.fillStyle = 'rgba(255,214,140,.85)'; g.fillRect(xx, yy, 5, 7); }
          x += bw + r() * 6;
        }
      }
    });
  }

  const AGENT_SCREEN = {
    dave: (g, w, h, c) => { // checklist + progress
      const r = rng(1);
      for (let i = 0; i < 6; i++) { const y = 70 + i * 36; g.strokeStyle = c; g.lineWidth = 3; g.strokeRect(24, y, 20, 20); if (i < 4) { g.beginPath(); g.moveTo(28, y + 10); g.lineTo(33, y + 16); g.lineTo(41, y + 4); g.stroke(); } g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(56, y + 6, 150 + r() * 200, 8); }
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(24, h - 40, w - 48, 14); g.fillStyle = c; g.fillRect(24, h - 40, (w - 48) * 0.66, 14);
    },
    jaden: (g, w, h, c) => { // people cards
      for (let i = 0; i < 6; i++) { const x = 24 + (i % 3) * 160, y = 70 + Math.floor(i / 3) * 110; g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x, y, 146, 96); g.fillStyle = c; g.beginPath(); g.arc(x + 30, y + 32, 18, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x + 58, y + 22, 70, 8); g.fillRect(x + 58, y + 38, 50, 6); g.fillRect(x + 14, y + 66, 116, 6); }
    },
    joel: (g, w, h) => { // code
      const r = rng(5); const cols = ['#C792EA', '#82AAFF', '#C3E88D', '#F78C6C', '#89DDFF', 'rgba(255,255,255,.6)'];
      for (let i = 0; i < 11; i++) { let x = 24 + (i % 4 === 0 ? 0 : 22 * (1 + (i % 3))); const y = 68 + i * 22; g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(6, y, 10, 8); for (let k = 0; k < 3 + r() * 3; k++) { const lw = 20 + r() * 70; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, y, lw, 8); x += lw + 8; } }
    },
    dylan: (g, w, h, c) => { // charts
      const r = rng(9); g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 1;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(24, 90 + i * 50); g.lineTo(w - 24, 90 + i * 50); g.stroke(); }
      for (let i = 0; i < 9; i++) { const bh = 30 + r() * 140; g.fillStyle = i % 3 ? c : '#FBBF24'; g.fillRect(36 + i * 50, 240 - bh, 30, bh); }
      g.strokeStyle = '#F472B6'; g.lineWidth = 4; g.beginPath(); for (let i = 0; i < 10; i++) { const x = 36 + i * 48, y = 120 + Math.sin(i * 0.9) * 40; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    },
    nana: (g, w, h, c) => { // finance table + pie
      const r = rng(13);
      for (let i = 0; i < 8; i++) { const y = 70 + i * 26; g.fillStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.1)'; g.fillRect(20, y, 290, 22); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(28, y + 8, 80, 6); g.fillStyle = i % 3 ? '#86EFAC' : '#FCA5A5'; g.fillRect(220, y + 8, 40 + r() * 40, 6); }
      let a = -Math.PI / 2; for (const [p, col] of [[0.42, c], [0.28, '#FBBF24'], [0.18, '#60A5FA'], [0.12, '#F472B6']]) { g.fillStyle = col; g.beginPath(); g.moveTo(410, 160); g.arc(410, 160, 70, a, a + p * Math.PI * 2); g.fill(); a += p * Math.PI * 2; }
    },
  };
  function screenTex(agent) {
    return canvasTex(512, 300, (g, w, h) => {
      g.fillStyle = '#0D1017'; g.fillRect(0, 0, w, h);
      g.fillStyle = agent.color; g.fillRect(0, 0, w, 44);
      g.fillStyle = '#0D1017'; g.font = 'bold 22px Inter, Arial, sans-serif'; g.fillText(agent.name.toUpperCase() + ' · ' + agent.role, 18, 30);
      (AGENT_SCREEN[agent.id] || AGENT_SCREEN.joel)(g, w, h, agent.color);
    });
  }
  const boardTex = canvasTex(1024, 640, (g, w, h) => {
    g.fillStyle = '#FBFBFD'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3A3A52'; g.font = 'bold 34px Inter, Arial, sans-serif';
    ['Rencana', 'Dikerjakan', 'Selesai'].forEach((t, i) => { g.fillText(t, 40 + i * 330, 60); g.fillStyle = '#D6D6E0'; g.fillRect(330 + i * 330, 20, 3, h - 40); g.fillStyle = '#3A3A52'; });
    const notes = [['#FDE68A', 0, 0], ['#BFDBFE', 0, 1], ['#FBCFE8', 0, 2], ['#BBF7D0', 1, 0], ['#FDE68A', 1, 1], ['#BBF7D0', 2, 0], ['#BBF7D0', 2, 1], ['#FECACA', 2, 2], ['#BFDBFE', 1, 2]];
    const r = rng(17);
    for (const [col, cx, cy] of notes) {
      const x = 40 + cx * 330 + r() * 30, y = 95 + cy * 170 + r() * 14;
      g.save(); g.translate(x + 120, y + 70); g.rotate((r() - 0.5) * 0.08); g.translate(-x - 120, -y - 70);
      g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x + 5, y + 6, 240, 140);
      g.fillStyle = col; g.fillRect(x, y, 240, 140);
      g.fillStyle = 'rgba(40,40,60,.55)'; for (let k = 0; k < 3; k++) g.fillRect(x + 18, y + 30 + k * 30, 120 + r() * 90, 8);
      g.restore();
    }
  });
  const logoTex = canvasTex(1024, 220, (g, w, h) => {
    g.fillStyle = '#16171D'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#C9A84C'; g.font = '800 110px Inter, Arial, sans-serif'; g.fillText('HG', 200, 150);
    g.fillStyle = '#F4F1EA'; g.font = '600 74px Inter, Arial, sans-serif'; g.fillText('Virtual Office', 390, 145);
  });
  const logoImg = new Image();
  logoImg.onload = () => { const g = logoTex.image.getContext('2d'); g.drawImage(logoImg, 60, 40, 130, 130); logoTex.needsUpdate = true; };
  logoImg.src = '/assets/hg-logo.png';
  const clockTex = canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2F323A';
    for (let i = 0; i < 12; i++) { g.save(); g.translate(w / 2, w / 2); g.rotate(i * Math.PI / 6); g.fillRect(-3, -w / 2 + 16, 6, i % 3 ? 14 : 24); g.restore(); }
  });
  const keysTex = canvasTex(256, 80, (g, w, h) => {
    g.fillStyle = '#D9DAE0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#F6F6F9'; for (let r0 = 0; r0 < 4; r0++) for (let c0 = 0; c0 < 14; c0++) g.fillRect(4 + c0 * 18, 4 + r0 * 19, 15, 15);
  });
  const rackTex = canvasTex(256, 640, (g, w, h) => {
    g.fillStyle = '#121419'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#C9A84C'; g.font = 'bold 30px Inter, Arial, sans-serif'; g.fillText('HERMES', 62, 48);
    for (let i = 0; i < 9; i++) { g.fillStyle = '#23262E'; g.fillRect(16, 74 + i * 62, w - 32, 50); g.fillStyle = '#353943'; for (let k = 0; k < 10; k++) g.fillRect(90 + k * 14, 92 + i * 62, 8, 16); }
  });

  /* ── materials ── */
  const mats = {};
  const std = (key, o) => mats[key] || (mats[key] = keep(new THREE.MeshStandardMaterial(o)));
  const M = {
    floor: std('floor', { map: woodTex, roughness: 0.58, metalness: 0 }),
    wall: std('wall', { color: daypart === 'night' ? '#C9C3B8' : '#EEE9E0', roughness: 0.93 }),
    wallTop: std('wallTop', { color: '#D7CFC1', roughness: 0.9 }),
    base: std('base', { color: '#BEB5A6', roughness: 0.7 }),
    white: std('white', { color: '#F4F2EE', roughness: 0.45 }),
    oak: std('oak', { color: '#C8A27A', roughness: 0.5, map: woodTex }),
    metalDark: std('metalDark', { color: '#2C2F36', roughness: 0.35, metalness: 0.7 }),
    chrome: std('chrome', { color: '#C9CDD4', roughness: 0.18, metalness: 1 }),
    black: std('black', { color: '#16171C', roughness: 0.35, metalness: 0.2 }),
    fabric: std('fabric', { color: '#2F343F', roughness: 0.92 }),
    fabricMeet: std('fabricMeet', { color: '#46506A', roughness: 0.9 }),
    frame: std('frame', { color: '#F7F6F3', roughness: 0.35, metalness: 0.1 }),
    rug: std('rug', { map: rugTex, roughness: 1 }),
    pot: std('pot', { color: '#C46E4A', roughness: 0.8 }),
    soil: std('soil', { color: '#3B2A1E', roughness: 1 }),
    quartz: std('quartz', { color: '#EFECE6', roughness: 0.25 }),
    walnut: std('walnut', { color: '#6E4C33', roughness: 0.55 }),
    pants: std('pants', { color: '#2A2D35', roughness: 0.85 }),
    shoe: std('shoe', { color: '#121214', roughness: 0.25, metalness: 0.1 }),
    sole: std('sole', { color: '#3A2A20', roughness: 0.6 }),
    suit: std('suit', { color: '#17181C', roughness: 0.62 }),
    suitPants: std('suitPants', { color: '#141519', roughness: 0.66 }),
    lapel: std('lapel', { color: '#202127', roughness: 0.4 }),
    shirtWhite: std('shirtWhite', { color: '#F5F5F2', roughness: 0.7 }),
    tie: std('tie', { color: '#0B0B0D', roughness: 0.3, metalness: 0.15 }),
    gold: std('gold', { color: '#D4AF5A', roughness: 0.28, metalness: 1 }),
    keys: std('keys', { map: keysTex, roughness: 0.6 }),
    panelFabric: std('panelFabric', { color: '#59616E', roughness: 0.95 }),
    deskMat: std('deskMat', { color: '#24272E', roughness: 0.85 }),
    binMesh: std('binMesh', { color: '#3A3D45', roughness: 0.5, metalness: 0.4 }),
    sofa: std('sofa', { color: '#8E8478', roughness: 0.95 }),
    cushion: std('cushion', { color: '#A39886', roughness: 0.95 }),
    leather: std('leather', { color: '#6B4A35', roughness: 0.45 }),
  };
  const glass = keep(new THREE.MeshPhysicalMaterial({ color: '#DDEBF3', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.2 }));

  /* ── geometry helpers ── */
  const geos = new Map();
  const rgeo = (w, h, d, r) => { const k = `${w}|${h}|${d}|${r}`; if (!geos.has(k)) geos.set(k, keep(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999))); return geos.get(k); };
  const shadow = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };
  function box(w, h, d, mat, x, y, z, r = 0.01, parent = scene) {
    const m = shadow(new THREE.Mesh(r > 0 ? rgeo(w, h, d, r) : keep(new THREE.BoxGeometry(w, h, d)), mat));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  function cyl(rt, rb, h, mat, x, y, z, seg = 24, parent = scene) {
    const m = shadow(new THREE.Mesh(keep(new THREE.CylinderGeometry(rt, rb, h, seg)), mat));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  function sphere(r, mat, x, y, z, parent = scene, seg = 24) {
    const m = shadow(new THREE.Mesh(keep(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7))), mat));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  const UP = new THREE.Vector3(0, 1, 0);
  function limb(a, b, r, mat, parent) { // a capsule from point a to point b
    const dir = b.clone().sub(a); const len = dir.length();
    const m = shadow(new THREE.Mesh(keep(new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 0.6), 6, 14)), mat));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    parent.add(m); return m;
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  /* ── the HG office, from the owner's photos (docs/epics/EPIC-018) ──
     Left wall: TV between lit display shelves over a credenza, a double door at
     the back, fluted wood at the front. Back wall: bamboo relief, fridge, CCTV
     video wall over a credenza, floor-to-ceiling windows with tree sheers.
     Polished light marble floor. Zones: the conference table facing the TV
     (the agents work here), the lounge (three recliners around a glass chess
     table), the executive desk in front of the windows. */
  const marbleTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#DCD5CA'; g.fillRect(0, 0, w, h);
    const r = rng(61);
    for (let k = 0; k < 170; k++) { g.fillStyle = `rgba(${190 + r() * 40},${180 + r() * 35},${166 + r() * 30},${0.05 + r() * 0.07})`; g.beginPath(); g.ellipse(r() * w, r() * h, 40 + r() * 150, 20 + r() * 60, r() * Math.PI, 0, Math.PI * 2); g.fill(); }
    for (let k = 0; k < 28; k++) { g.strokeStyle = `rgba(${120 + r() * 40},${112 + r() * 30},${100 + r() * 30},${0.08 + r() * 0.14})`; g.lineWidth = 0.6 + r() * 1.8; let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k2 = 0; k2 < 7; k2++) { x += (r() - 0.3) * 150; y += (r() - 0.5) * 90; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = 'rgba(150,140,128,.6)'; g.fillRect(0, 0, w, 2); g.fillRect(0, h / 2, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w / 2, 0, 2, h);
  }, { repeat: [W / 2.4, D / 2.4] });   // 1.2 m tiles
  const flutedTex = canvasTex(512, 512, (g, w, h) => {
    const n = 18, fw = w / n;
    for (let i = 0; i < n; i++) { const gr = g.createLinearGradient(i * fw, 0, (i + 1) * fw, 0); gr.addColorStop(0, '#24180F'); gr.addColorStop(0.45, '#6E4C34'); gr.addColorStop(0.72, '#4A3222'); gr.addColorStop(1, '#1C120B'); g.fillStyle = gr; g.fillRect(i * fw, 0, fw, h); }
    const r = rng(71); for (let k = 0; k < 420; k++) { g.fillStyle = `rgba(255,220,180,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 1, 6 + r() * 30); }
  }, { repeat: [3, 1] });
  const bambooTex = canvasTex(1024, 640, (g, w, h) => {
    g.fillStyle = '#D9CCB2'; g.fillRect(0, 0, w, h);
    const r = rng(81);
    for (let k = 0; k < 14; k++) {
      const x = 30 + k * 72 + (r() - 0.5) * 30, sw = 9 + r() * 10;
      g.fillStyle = `rgba(${150 + r() * 30},${118 + r() * 20},${70 + r() * 20},.75)`; g.fillRect(x, 0, sw, h);
      for (let y = 40 + r() * 60; y < h; y += 90 + r() * 50) { g.fillStyle = 'rgba(110,82,45,.8)'; g.fillRect(x - 2, y, sw + 4, 4); }
      for (let l = 0; l < 4; l++) { g.strokeStyle = 'rgba(130,100,55,.55)'; g.lineWidth = 3; g.beginPath(); const ly = r() * h, dir = r() < 0.5 ? -1 : 1; g.moveTo(x + sw / 2, ly); g.quadraticCurveTo(x + dir * 40, ly + 10, x + dir * 70, ly + 40); g.stroke(); }
    }
  });
  function cctvTex(seed) {
    return canvasTex(512, 288, (g, w, h) => {
      g.fillStyle = '#0B0D12'; g.fillRect(0, 0, w, h);
      const r = rng(seed), cols = 6, rows = 4, cw = w / cols, ch = h / rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = i * cw + 2, y = j * ch + 2, base = 120 + r() * 70;
        g.fillStyle = `rgb(${base},${base + 6},${base + 18})`; g.fillRect(x, y, cw - 4, ch - 4);
        for (let k = 0; k < 5; k++) { const sh = 60 + r() * 120; g.fillStyle = `rgba(${sh},${sh},${sh + 20},.7)`; g.fillRect(x + r() * (cw - 20), y + r() * (ch - 18), 8 + r() * 30, 6 + r() * 20); }
        g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '9px Arial'; g.fillText('CAM ' + (j * cols + i + 1), x + 3, y + 10);
      }
    });
  }
  const sheerTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#F4F2EC'; g.fillRect(0, 0, w, h);
    const r = rng(91);
    for (let k = 0; k < 9; k++) {
      let x = r() * w, y = h; g.strokeStyle = `rgba(110,105,95,${0.35 + r() * 0.25})`; g.lineWidth = 4 + r() * 5;
      g.beginPath(); g.moveTo(x, y); for (let s2 = 0; s2 < 8; s2++) { x += (r() - 0.5) * 40; y -= h / 8; g.lineTo(x, y); } g.stroke();
      for (let b = 0; b < 6; b++) { g.lineWidth = 1.5; g.beginPath(); const bx = x + (r() - 0.5) * 60, by = r() * h; g.moveTo(bx, by); g.lineTo(bx + (r() - 0.5) * 80, by - r() * 60); g.stroke(); }
    }
  });
  const chessTex = canvasTex(256, 256, (g, w) => { const c = w / 8; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#2B2B2B' : '#E8E2D4'; g.fillRect(i * c, j * c, c, c); } });
  const veneerTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#C9AE88'; g.fillRect(0, 0, w, h);
    const r = rng(101);
    for (let k = 0; k < 220; k++) { g.strokeStyle = `rgba(${120 + r() * 50},${90 + r() * 40},${55 + r() * 30},${0.08 + r() * 0.12})`; g.lineWidth = 1 + r() * 2; const y = r() * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w / 2, y + 60); g.lineTo(w, y); g.stroke(); }
  }, { repeat: [2, 2] });
  const ebonyTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4A4744'; g.fillRect(0, 0, w, h);
    const r = rng(111);
    for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(${200 + r() * 40},${195 + r() * 40},${185 + r() * 40},${0.05 + r() * 0.12})`; g.fillRect(0, r() * h, w, 0.6 + r() * 1.6); }
  }, { repeat: [2, 1] });
  Object.assign(M, {
    floor: std('marble', { map: marbleTex, roughness: 0.16, metalness: 0, envMapIntensity: 1.1 }),
    wall: std('wallHG', { color: daypart === 'night' ? '#A09587' : '#BCAF9F', roughness: 0.92 }),
    charcoal: std('charcoal', { color: '#3A3A3D', roughness: 0.85 }),
    fluted: std('fluted', { map: flutedTex, roughness: 0.45 }),
    walnutDark: std('walnutDark', { color: '#3A281C', roughness: 0.45 }),
    lacquer: std('lacquer', { color: '#151517', roughness: 0.22, metalness: 0.2 }),
    bamboo: std('bamboo', { map: bambooTex, roughness: 0.6, metalness: 0.15 }),
    veneer: std('veneer', { map: veneerTex, roughness: 0.32 }),
    ebony: std('ebony', { map: ebonyTex, roughness: 0.33 }),
    taupe: std('taupe', { color: '#C2B2A0', roughness: 0.95 }),
    taupeDark: std('taupeDark', { color: '#A89887', roughness: 0.95 }),
    meshBlack: std('meshBlack', { color: '#1A1B1F', roughness: 0.75 }),
    frameWhite: std('frameWhite', { color: '#EDEDEA', roughness: 0.35 }),
    cream: std('cream', { color: '#EFE6D6', roughness: 0.7 }),
    alu: std('alu', { color: '#1E1F23', roughness: 0.35, metalness: 0.8 }),
    bronze: std('bronze', { color: '#7A5634', roughness: 0.3, metalness: 0.9 }),
    steel: std('steel', { color: '#B9BCC2', roughness: 0.25, metalness: 0.95 }),
  });
  const leds = [];
  const mugMat = (c) => std('mug' + c, { color: c, roughness: 0.35 });
  const glassClear = keep(new THREE.MeshPhysicalMaterial({ color: '#E8F0F2', roughness: 0.04, transparent: true, opacity: 0.22, envMapIntensity: 1.4 }));
  const ledMat = keep(new THREE.MeshStandardMaterial({ color: '#111', emissive: '#FFD9A3', emissiveIntensity: daypart === 'night' ? 2.4 : 1.6 }));

  /* floor and walls (layout: the owner's "hgfix" plan) */
  const floor = shadow(new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), M.floor), false, true);
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const plinth = box(W + 0.5, 0.14, D + 0.5, M.charcoal, 0, -0.071, 0, 0.03); plinth.castShadow = false;
  // back wall: floor-to-ceiling windows almost all the way across
  const WIN = { x0: X0 + 0.25, x1: X0 + W - 0.6, y0: 0.06, y1: 2.8 };
  const wallShape = new THREE.Shape();
  wallShape.moveTo(X0 - 0.2, 0); wallShape.lineTo(X0 + W + 0.2, 0); wallShape.lineTo(X0 + W + 0.2, H); wallShape.lineTo(X0 - 0.2, H); wallShape.lineTo(X0 - 0.2, 0);
  const hole = new THREE.Path();
  hole.moveTo(WIN.x0, WIN.y0); hole.lineTo(WIN.x1, WIN.y0); hole.lineTo(WIN.x1, WIN.y1); hole.lineTo(WIN.x0, WIN.y1); hole.lineTo(WIN.x0, WIN.y0);
  wallShape.holes.push(hole);
  const backWall = shadow(new THREE.Mesh(keep(new THREE.ExtrudeGeometry(wallShape, { depth: 0.2, bevelEnabled: false })), M.wall));
  backWall.position.z = Z0 - 0.2; scene.add(backWall);
  box(0.2, H, D + 0.2, M.wall, X0 - 0.1, H / 2, 0.1, 0);                         // the long wall (left)
  box(W + 0.4, 0.07, 0.3, M.charcoal, 0, H + 0.035, Z0 - 0.1, 0);
  box(0.3, 0.07, D + 0.4, M.charcoal, X0 - 0.1, H + 0.035, 0.1, 0);
  // front: the fluted-wood wall, cut down low so the room stays in view
  box(W + 0.4, 0.62, 0.2, M.fluted, 0, 0.31, D / 2 + 0.1, 0.02);
  box(W + 0.4, 0.04, 0.24, M.charcoal, 0, 0.64, D / 2 + 0.1, 0.01);
  // right: low wall with the glass entrance door
  const DOOR = { z0: 2.35, z1: 3.65 };
  box(0.2, 0.62, DOOR.z0 + D / 2 + 0.2, M.charcoal, W / 2 + 0.1, 0.31, (DOOR.z0 - D / 2 - 0.2) / 2, 0.02);
  box(0.2, 0.62, D / 2 + 0.2 - DOOR.z1, M.charcoal, W / 2 + 0.1, 0.31, (DOOR.z1 + D / 2 + 0.2) / 2, 0.02);
  // the glass door, cut at the same height as the wall (a section, like the plan)
  for (const z of [DOOR.z0, DOOR.z1, (DOOR.z0 + DOOR.z1) / 2]) box(0.12, 0.62, 0.06, M.alu, W / 2 + 0.1, 0.31, z, 0.01);
  for (const z of [DOOR.z0 + 0.33, DOOR.z1 - 0.33]) { const gl = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.6, 0.6)), glassClear); gl.rotation.y = Math.PI / 2; gl.position.set(W / 2 + 0.12, 0.31, z); scene.add(gl); box(0.03, 0.3, 0.03, M.steel, W / 2 + 0.04, 0.35, z + (z < (DOOR.z0 + DOOR.z1) / 2 ? 0.22 : -0.22), 0.01); }
  // back-right: a pillar with an Iron Man on a pedestal
  box(0.6, H, 0.6, M.wall, X0 + W - 0.3, H / 2, Z0 + 0.3, 0.01);
  const ironMan = (x, z, y0, s, ry) => {
    const im = new THREE.Group(); im.position.set(x, y0, z); im.scale.setScalar(s); im.rotation.y = ry; scene.add(im);
    const red = std('imRed', { color: '#A3121A', roughness: 0.25, metalness: 0.75 }), gold = M.gold;
    for (const sx of [-1, 1]) { box(0.07, 0.22, 0.08, red, sx * 0.06, 0.11, 0, 0.03, im); box(0.06, 0.2, 0.07, gold, sx * 0.06, 0.32, 0, 0.03, im); box(0.06, 0.24, 0.06, red, sx * 0.16, 0.5, 0, 0.025, im); sphere(0.045, red, sx * 0.16, 0.62, 0, im, 12); }
    box(0.22, 0.24, 0.12, red, 0, 0.53, 0, 0.05, im); box(0.12, 0.1, 0.02, gold, 0, 0.42, 0.06, 0.01, im);
    sphere(0.025, std('arc', { color: '#111', emissive: '#7DD3FC', emissiveIntensity: 3 }), 0, 0.57, 0.062, im, 10);
    const hd = sphere(0.075, red, 0, 0.72, 0, im, 16); hd.scale.set(0.9, 1.1, 1);
    box(0.08, 0.07, 0.02, gold, 0, 0.71, 0.065, 0.01, im);
    return im;
  };
  box(0.42, 0.9, 0.42, M.lacquer, X0 + W - 0.85, 0.45, Z0 + 0.85, 0.02);
  ironMan(X0 + W - 0.85, Z0 + 0.85, 0.9, 1.0, -0.6);

  /* the long wall, back to front: CCTV wall, frosted glass, switch panel, double door, TV between display shelves */
  const tm = new THREE.Matrix4();
  // CCTV video wall over a credenza (with the printer)
  const CCTV = { z0: Z0 + 0.3, z1: Z0 + 2.65 };
  const cczc = (CCTV.z0 + CCTV.z1) / 2, ccl = CCTV.z1 - CCTV.z0;
  box(0.52, 0.75, ccl, M.walnutDark, X0 + 0.27, 0.375, cczc, 0.02);
  box(0.54, 0.03, ccl + 0.02, M.lacquer, X0 + 0.27, 0.765, cczc, 0.006);
  for (let i = 0; i < 4; i++) box(0.012, 0.6, ccl / 4 - 0.04, std('weave', { color: '#2E2119', roughness: 0.7 }), X0 + 0.535, 0.38, CCTV.z0 + (i + 0.5) * ccl / 4, 0.004);
  box(0.38, 0.3, 0.46, M.black, X0 + 0.3, 0.93, CCTV.z0 + 0.4, 0.02);                    // printer
  box(0.14, 0.004, 0.3, M.shirtWhite, X0 + 0.48, 1.085, CCTV.z0 + 0.4, 0.001);
  box(0.16, 0.1, 0.24, M.steel, X0 + 0.3, 0.83, cczc, 0.01);
  cyl(0.06, 0.07, 0.12, std('lampCream', { color: '#F3E9D6', emissive: '#FFE2B5', emissiveIntensity: 0.6 }), X0 + 0.3, 0.84, CCTV.z1 - 0.35, 20);
  for (let k = 0; k < 6; k++) box(0.06, 0.06 + (k % 3) * 0.04, 0.06, std('trinket' + (k % 3), { color: ['#B91C1C', '#2563EB', '#D4AF5A'][k % 3], roughness: 0.4 }), X0 + 0.25, 0.81 + (k % 3) * 0.02, cczc + 0.25 + k * 0.1, 0.01);
  let cam = 1;
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const z = cczc - 0.82 + col * 0.82, y = 1.58 + row * 0.5;
    box(0.05, 0.47, 0.8, M.black, X0 + 0.03, y, z, 0.006);
    const scr = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.76, 0.43)), keep(new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: cctvTex(130 + cam++), emissiveIntensity: 0.8 })));
    scr.rotation.y = Math.PI / 2; scr.position.set(X0 + 0.057, y, z); scene.add(scr);
  }
  // frosted glass panel (cool blue, lit from behind)
  const GL = { z0: CCTV.z1 + 0.15, z1: CCTV.z1 + 1.05 };
  box(0.06, 2.5, GL.z1 - GL.z0 + 0.08, M.alu, X0 + 0.02, 1.25, (GL.z0 + GL.z1) / 2, 0.005);
  const frost = new THREE.Mesh(keep(new THREE.PlaneGeometry(GL.z1 - GL.z0, 2.4)), keep(new THREE.MeshStandardMaterial({ color: '#9FD3DE', roughness: 0.3, emissive: '#7CC6D6', emissiveIntensity: 0.35 })));
  frost.rotation.y = Math.PI / 2; frost.position.set(X0 + 0.06, 1.25, (GL.z0 + GL.z1) / 2); scene.add(frost);
  // switch panel with the clock above it
  const SW = { z: GL.z1 + 0.5 };
  for (let k = 0; k < 3; k++) box(0.015, 0.09, 0.09, M.white, X0 + 0.01, 1.2, SW.z - 0.12 + k * 0.12, 0.004);
  const clock = new THREE.Group(); clock.position.set(X0 + 0.03, 2.3, SW.z); clock.rotation.y = Math.PI / 2; scene.add(clock);
  const face = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 40)), [M.black, keep(new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.3 })), M.black]);
  face.rotation.x = Math.PI / 2; face.rotation.y = Math.PI / 2; clock.add(face);
  const hHand = new THREE.Group(), mHand = new THREE.Group(); hHand.position.z = mHand.position.z = 0.03; clock.add(hHand, mHand);
  box(0.016, 0.085, 0.008, M.black, 0, 0.038, 0, 0.004, hHand);
  box(0.012, 0.125, 0.008, M.black, 0, 0.058, 0.006, 0.004, mHand);
  // double wood door with the HG logo above
  const DR = { z0: SW.z + 0.45, z1: SW.z + 1.75 };
  box(0.08, 2.45, DR.z1 - DR.z0 + 0.12, M.charcoal, X0 + 0.01, 1.22, (DR.z0 + DR.z1) / 2, 0.005);
  for (const k of [0, 1]) {
    const zc = DR.z0 + (k + 0.5) * (DR.z1 - DR.z0) / 2;
    box(0.06, 2.35, (DR.z1 - DR.z0) / 2 - 0.02, M.walnut, X0 + 0.05, 1.18, zc, 0.01);
    box(0.03, 0.9, 0.02, M.steel, X0 + 0.095, 1.15, (DR.z0 + DR.z1) / 2 + (k ? 0.06 : -0.06), 0.006);
  }
  box(0.05, 0.36, 1.5, M.black, X0 + 0.03, 2.66, (DR.z0 + DR.z1) / 2, 0.012);
  const logo = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.44, 0.32)), keep(new THREE.MeshStandardMaterial({ map: logoTex, roughness: 0.4, emissive: '#ffffff', emissiveMap: logoTex, emissiveIntensity: 0.25 })));
  logo.rotation.y = Math.PI / 2; logo.position.set(X0 + 0.056, 2.66, (DR.z0 + DR.z1) / 2); scene.add(logo);
  // TV between lit display shelves, credenza under the TV
  const TVZ = { z0: DR.z1 + 0.2, z1: D / 2 - 0.15 };
  const TVC = (TVZ.z0 + TVZ.z1) / 2;
  box(0.06, 2.8, TVZ.z1 - TVZ.z0, M.walnutDark, X0 + 0.03, 1.4, TVC, 0.01);
  const tvScreen = keep(new THREE.MeshPhysicalMaterial({ color: '#08090B', roughness: 0.08, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 }));
  box(0.07, 1.3, 2.3, M.black, X0 + 0.11, 1.62, TVC, 0.015);
  const tvp = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.22, 1.22)), tvScreen); tvp.rotation.y = Math.PI / 2; tvp.position.set(X0 + 0.148, 1.62, TVC); scene.add(tvp);
  box(0.5, 0.5, 2.4, M.lacquer, X0 + 0.31, 0.26, TVC, 0.02);
  box(0.51, 0.012, 2.41, M.gold, X0 + 0.31, 0.515, TVC, 0.003);
  box(0.04, 0.16, 0.22, M.white, X0 + 0.3, 0.6, TVC + 0.85, 0.006);
  box(0.03, 0.24, 0.18, M.gold, X0 + 0.27, 0.64, TVC + 1.05, 0.006);
  sphere(0.1, M.steel, X0 + 0.33, 0.62, TVC - 0.9, scene, 20).scale.set(1, 1.1, 0.95);
  const figCols = ['#B91C1C', '#D4AF5A', '#2563EB', '#16A34A', '#F59E0B', '#E5E7EB', '#7C3AED', '#111827', '#DC2626', '#0EA5E9'].map((c) => new THREE.Color(c));
  const figs = new THREE.InstancedMesh(keep(new THREE.CapsuleGeometry(0.035, 0.06, 4, 8)), keep(new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2 })), 220);
  figs.castShadow = true; let nf = 0; const rf = rng(121);
  function shelves(z0, z1) {   // a lit display cabinet with collectibles
    const zc = (z0 + z1) / 2, len = z1 - z0;
    for (const z of [z0, zc, z1]) box(0.36, 2.7, 0.04, M.walnutDark, X0 + 0.22, 1.35, z, 0.006);
    for (let k = 0; k < 6; k++) {
      const y = 0.08 + k * 0.5;
      box(0.36, 0.03, len, M.walnutDark, X0 + 0.22, y, zc, 0.004);
      if (k) { const strip = new THREE.Mesh(keep(new THREE.BoxGeometry(0.02, 0.008, len - 0.08)), ledMat); strip.position.set(X0 + 0.36, y - 0.02, zc); scene.add(strip); }
      if (k < 5) for (let f = 0; f < 7 && nf < 220; f++) {
        const z = z0 + 0.08 + rf() * (len - 0.16), sc = 0.8 + rf() * 1.2;
        tm.compose(V(X0 + 0.2, y + 0.015 + 0.07 * sc, z), new THREE.Quaternion(), V(sc, sc, sc));
        figs.setMatrixAt(nf, tm); figs.setColorAt(nf, figCols[Math.floor(rf() * figCols.length)]); nf++;
      }
    }
  }
  shelves(TVZ.z0, TVC - 1.2); shelves(TVC + 1.2, TVZ.z1);
  for (const y of [2.55, 2.12]) box(0.36, 0.03, 2.4, M.walnutDark, X0 + 0.22, y, TVC, 0.004);   // shelves over the TV
  figs.count = nf; scene.add(figs);
  const plane = new THREE.Group(); plane.position.set(X0 + 0.2, 2.62, TVZ.z0 + 0.5); scene.add(plane);
  box(0.04, 0.04, 0.36, M.white, 0, 0, 0, 0.015, plane); box(0.36, 0.008, 0.08, M.white, 0, 0, 0.02, 0.003, plane);

  // windows: black mullions, sheer tree blinds, the city behind
  const winW = WIN.x1 - WIN.x0, winH = WIN.y1 - WIN.y0, winCx = (WIN.x0 + WIN.x1) / 2, winCy = (WIN.y0 + WIN.y1) / 2;
  const panes = 7;
  for (let i = 0; i <= panes; i++) box(0.05, winH, 0.12, M.alu, WIN.x0 + (winW * i) / panes, winCy, Z0 - 0.06, 0.006);
  box(winW + 0.05, 0.05, 0.12, M.alu, winCx, WIN.y1, Z0 - 0.06, 0.006);
  const pane = new THREE.Mesh(keep(new THREE.PlaneGeometry(winW, winH)), glass); pane.position.set(winCx, winCy, Z0 - 0.1); scene.add(pane);
  const sheerMat = keep(new THREE.MeshStandardMaterial({ map: sheerTex, transparent: true, opacity: 0.66, roughness: 0.9, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: sheerTex, emissiveIntensity: daypart === 'night' ? 0.05 : 0.35 }));
  for (let i = 0; i < panes; i++) { const sh = new THREE.Mesh(keep(new THREE.PlaneGeometry(winW / panes - 0.06, winH - 0.3)), sheerMat); sh.position.set(WIN.x0 + (i + 0.5) * winW / panes, winCy + 0.12, Z0 + 0.03); scene.add(sh); }
  box(winW + 0.1, 0.09, 0.1, M.alu, winCx, WIN.y1 - 0.02, Z0 + 0.05, 0.01);
  const skyMat = keep(new THREE.MeshBasicMaterial({ map: skyTex(), toneMapped: false }));
  const sky = new THREE.Mesh(keep(new THREE.PlaneGeometry(winW + 0.3, 2.6)), skyMat); sky.position.set(winCx, 1.3, Z0 - 0.6); scene.add(sky);

  /* conference table in front of the TV, pendant ring above it */
  const CT = { x: X0 + 0.95 + 1.95, z: TVC, len: 3.9, wid: 1.2 };
  const tShape = new THREE.Shape();
  { const L = CT.len / 2, Wd = CT.wid / 2, rr = 0.4;
    tShape.moveTo(-L + rr, -Wd); tShape.quadraticCurveTo(0, -Wd - 0.08, L - rr, -Wd); tShape.quadraticCurveTo(L, -Wd, L, -Wd + rr);
    tShape.lineTo(L, Wd - rr); tShape.quadraticCurveTo(L, Wd, L - rr, Wd); tShape.quadraticCurveTo(0, Wd + 0.08, -L + rr, Wd);
    tShape.quadraticCurveTo(-L, Wd, -L, Wd - rr); tShape.lineTo(-L, -Wd + rr); tShape.quadraticCurveTo(-L, -Wd, -L + rr, -Wd); }
  const ctop = shadow(new THREE.Mesh(keep(new THREE.ExtrudeGeometry(tShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 2, curveSegments: 24 })), M.ebony));
  ctop.rotation.x = -Math.PI / 2; ctop.position.set(CT.x, DESK_TOP - 0.05, CT.z); scene.add(ctop);
  for (const dx of [-0.6, 0.6]) box(0.5, 0.006, 0.1, M.black, CT.x + dx, DESK_TOP + 0.002, CT.z, 0.002);
  for (const dx of [-1.0, 1.0]) { const leg = cyl(0.34, 0.22, DESK_TOP - 0.06, std('pedestal', { color: '#1B1A19', roughness: 0.4 }), CT.x + dx, (DESK_TOP - 0.06) / 2, CT.z, 4); leg.rotation.y = Math.PI / 4; leg.scale.set(1, 1, 0.55); }
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 12)), keep(new THREE.MeshPhysicalMaterial({ color: '#CFE8F5', roughness: 0.05, transparent: true, opacity: 0.6 }))); b.position.set(CT.x - 0.15 + i * 0.07, DESK_TOP + 0.1, CT.z - 0.1); scene.add(b); cyl(0.032, 0.032, 0.02, std('cap', { color: '#2563EB' }), CT.x - 0.15 + i * 0.07, DESK_TOP + 0.21, CT.z - 0.1, 10); }
  box(0.24, 0.1, 0.12, M.white, CT.x + 0.3, DESK_TOP + 0.05, CT.z + 0.12, 0.02);
  box(0.2, 0.09, 0.14, std('greenBox', { color: '#84CC16', roughness: 0.3 }), CT.x - 0.35, DESK_TOP + 0.045, CT.z + 0.12, 0.02);
  cyl(0.07, 0.075, 0.025, M.black, CT.x + 0.7, DESK_TOP + 0.013, CT.z, 24);
  const ringOut = new THREE.Shape(); { const a = 1.3, b = 0.42, rr = 0.28; ringOut.moveTo(-a + rr, -b); ringOut.lineTo(a - rr, -b); ringOut.quadraticCurveTo(a, -b, a, -b + rr); ringOut.lineTo(a, b - rr); ringOut.quadraticCurveTo(a, b, a - rr, b); ringOut.lineTo(-a + rr, b); ringOut.quadraticCurveTo(-a, b, -a, b - rr); ringOut.lineTo(-a, -b + rr); ringOut.quadraticCurveTo(-a, -b, -a + rr, -b); }
  const ringIn = new THREE.Path(); { const a = 1.24, b = 0.36, rr = 0.23; ringIn.moveTo(-a + rr, -b); ringIn.lineTo(a - rr, -b); ringIn.quadraticCurveTo(a, -b, a, -b + rr); ringIn.lineTo(a, b - rr); ringIn.quadraticCurveTo(a, b, a - rr, b); ringIn.lineTo(-a + rr, b); ringIn.quadraticCurveTo(-a, b, -a, b - rr); ringIn.lineTo(-a, -b + rr); ringIn.quadraticCurveTo(-a, -b, -a + rr, -b); }
  ringOut.holes.push(ringIn);
  const pendant = shadow(new THREE.Mesh(keep(new THREE.ExtrudeGeometry(ringOut, { depth: 0.07, bevelEnabled: false, curveSegments: 16 })), M.alu), true, false);
  pendant.rotation.x = -Math.PI / 2; pendant.position.set(CT.x, 2.32, CT.z); scene.add(pendant);
  const pLed = new THREE.Mesh(keep(new THREE.ShapeGeometry(ringOut, 16)), keep(new THREE.MeshBasicMaterial({ color: '#FFF1D6', toneMapped: false, side: THREE.DoubleSide })));
  pLed.rotation.x = -Math.PI / 2; pLed.position.set(CT.x, 2.318, CT.z); scene.add(pLed);
  for (const [wx, wz] of [[-0.9, -0.3], [0.9, -0.3], [-0.9, 0.3], [0.9, 0.3]]) cyl(0.003, 0.003, H - 2.39, M.steel, CT.x + wx, 2.39 + (H - 2.39) / 2, CT.z + wz, 4);
  const pendantLight = new THREE.PointLight('#FFE6C4', daypart === 'night' ? 7 : 4, 6, 2); pendantLight.position.set(CT.x, 2.1, CT.z); scene.add(pendantLight);
  function meshChair(x, z, facing, white = false) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = facing; scene.add(g);
    officeChairStyled(g, white);
    return g;
  }

  // an office chair in the photo's style: mesh back, armrests, chrome star base
  function officeChairStyled(g, white = false, headrest = false) {
    const frame = white ? M.frameWhite : M.black;
    box(0.5, 0.08, 0.48, M.meshBlack, 0, 0.47, 0, 0.035, g);
    box(0.5, 0.64, 0.06, M.meshBlack, 0, 0.86, 0.25, 0.04, g);
    box(0.54, 0.7, 0.03, frame, 0, 0.86, 0.285, 0.015, g);
    if (headrest || white) box(0.34, 0.18, 0.07, M.meshBlack, 0, 1.3, 0.27, 0.04, g);
    for (const sx of [-1, 1]) { box(0.06, 0.04, 0.3, frame, sx * 0.28, 0.67, 0.02, 0.015, g); box(0.03, 0.18, 0.03, frame, sx * 0.28, 0.57, 0.08, 0.01, g); }
    cyl(0.025, 0.025, 0.36, M.chrome, 0, 0.27, 0.02, 12, g);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, leg = box(0.3, 0.03, 0.04, M.chrome, Math.cos(a) * 0.15, 0.06, 0.02 + Math.sin(a) * 0.15, 0.01, g);
      leg.rotation.y = -a;
      sphere(0.028, M.black, Math.cos(a) * 0.29, 0.028, 0.02 + Math.sin(a) * 0.29, g, 10);
    }
  }
  function officeChair(g) {
    box(0.5, 0.08, 0.48, M.fabric, 0, 0.47, 0, 0.035, g);
    box(0.48, 0.58, 0.07, M.fabric, 0, 0.84, 0.25, 0.035, g);
    box(0.06, 0.04, 0.3, M.black, -0.27, 0.66, 0.02, 0.015, g); box(0.06, 0.04, 0.3, M.black, 0.27, 0.66, 0.02, 0.015, g);
    box(0.03, 0.18, 0.03, M.black, -0.27, 0.57, 0.08, 0.01, g); box(0.03, 0.18, 0.03, M.black, 0.27, 0.57, 0.08, 0.01, g);
    cyl(0.025, 0.025, 0.36, M.chrome, 0, 0.27, 0.02, 12, g);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, leg = box(0.3, 0.03, 0.04, M.black, Math.cos(a) * 0.15, 0.06, 0.02 + Math.sin(a) * 0.15, 0.01, g);
      leg.rotation.y = -a;
      sphere(0.028, M.black, Math.cos(a) * 0.29, 0.028, 0.02 + Math.sin(a) * 0.29, g, 10);
    }
  }

  function plant(x, z, s = 1, seed = 1) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
    cyl(0.17, 0.13, 0.36, M.pot, 0, 0.18, 0, 24, g);
    cyl(0.155, 0.155, 0.02, M.soil, 0, 0.35, 0, 24, g);
    const r = rng(seed);
    const leafMats = ['#4E9F5D', '#3F8A4F', '#5DAE69', '#357A44'].map((c) => std('leaf' + c, { color: c, roughness: 0.75, flatShading: true }));
    for (let i = 0; i < 9; i++) {
      const m = shadow(new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.13 + r() * 0.07, 1)), leafMats[i % 4]));
      const a = r() * Math.PI * 2, rad = r() * 0.16;
      m.position.set(Math.cos(a) * rad, 0.52 + r() * 0.45, Math.sin(a) * rad);
      m.scale.set(1, 0.8 + r() * 0.4, 1); g.add(m);
    }
    return g;
  }
  // Everyone wears the same black business suit: white shirt, black tie; the
  // agent's colour shows only in a small lapel pin (and the name tag, ring, mug).
  function person(g, look, accent) {
    const skin = std('skin' + look.skin, { color: look.skin, roughness: 0.6 });
    const hair = std('hair' + look.hair, { color: look.hair, roughness: 0.75 });
    const shirt = M.suit;   // the jacket and sleeves
    const body = new THREE.Group(); g.add(body);
    // legs: thighs on the seat, shins down to the floor (seated, facing -z)
    for (const sx of [-0.1, 0.1]) {
      limb(V(sx, 0.57, 0.02), V(sx, 0.58, -0.36), 0.075, M.suitPants, body);
      limb(V(sx, 0.56, -0.38), V(sx, 0.1, -0.4), 0.064, M.suitPants, body);
      box(0.11, 0.07, 0.26, M.shoe, sx, 0.035, -0.45, 0.03, body);
      box(0.112, 0.012, 0.262, M.sole, sx, 0.006, -0.45, 0.004, body);
    }
    box(0.36, 0.14, 0.3, M.suitPants, 0, 0.58, 0.02, 0.06, body);
    const torso = new THREE.Group(); torso.position.set(0, 0.62, 0.04); torso.rotation.x = -0.1; body.add(torso);
    const chest = shadow(new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.17, 0.26, 8, 18)), shirt));
    chest.scale.set(1.12, 1, 0.72); chest.position.y = 0.3; torso.add(chest);
    cyl(0.05, 0.055, 0.08, skin, 0, 0.6, 0, 14, torso);
    cyl(0.058, 0.062, 0.05, M.shirtWhite, 0, 0.57, 0, 16, torso);                  // shirt collar
    // shirt V, tie, lapels, pocket square, buttons and the agent-colour pin (front is -z)
    const vee = new THREE.Shape(); vee.moveTo(-0.075, 0.565); vee.lineTo(0.075, 0.565); vee.lineTo(0, 0.36); vee.lineTo(-0.075, 0.565);
    const shirtV = new THREE.Mesh(keep(new THREE.ShapeGeometry(vee)), M.shirtWhite); shirtV.position.z = -0.124; shirtV.rotation.y = Math.PI; torso.add(shirtV);
    box(0.032, 0.17, 0.012, M.tie, 0, 0.455, -0.13, 0.004, torso);
    box(0.036, 0.03, 0.016, M.tie, 0, 0.545, -0.128, 0.006, torso);
    for (const lx of [-1, 1]) { const lap = box(0.04, 0.2, 0.01, M.lapel, lx * 0.055, 0.47, -0.128, 0.004, torso); lap.rotation.z = lx * 0.38; }
    box(0.045, 0.016, 0.01, M.shirtWhite, -0.095, 0.48, -0.122, 0.003, torso);
    for (const by of [0.33, 0.27]) sphere(0.008, M.black, 0, by, -0.126, torso, 8);
    sphere(0.009, std('pin' + accent, { color: accent, roughness: 0.3, metalness: 0.6 }), 0.095, 0.5, -0.124, torso, 10);
    const head = new THREE.Group(); head.position.set(0, 0.74, -0.01); torso.add(head);
    sphere(0.112, skin, 0, 0, 0, head, 28).scale.set(0.95, 1.08, 1);
    sphere(0.02, skin, -0.105, -0.005, 0.0, head, 10); sphere(0.02, skin, 0.105, -0.005, 0.0, head, 10); // ears
    const faceDark = std('faceDark', { color: '#2A1D17', roughness: 0.5 });
    for (const ex of [-0.04, 0.04]) {
      sphere(0.013, faceDark, ex, 0.02, -0.103, head, 10);                         // eyes
      box(0.035, 0.008, 0.01, hair, ex, 0.052, -0.103, 0.003, head);               // brows
    }
    sphere(0.016, skin, 0, -0.005, -0.115, head, 10);                              // nose
    box(0.04, 0.007, 0.01, std('lips', { color: '#B5725E', roughness: 0.6 }), 0, -0.05, -0.104, 0.003, head);
    // hair
    const cap = shadow(new THREE.Mesh(keep(new THREE.SphereGeometry(0.12, 28, 18, 0, Math.PI * 2, 0, look.style === 'long' ? 1.9 : 1.55)), hair));
    cap.position.set(0, 0.015, 0.012); cap.rotation.x = -0.35; head.add(cap);
    if (look.style === 'curly') for (let i = 0; i < 9; i++) sphere(0.04, hair, Math.cos(i * 0.7) * 0.08, 0.08 + (i % 3) * 0.01, Math.sin(i * 0.7) * 0.06 + 0.02, head, 10);
    if (look.style === 'swept') { const s = sphere(0.06, hair, -0.03, 0.1, -0.06, head, 14); s.scale.set(1.6, 0.6, 1); }
    if (look.style === 'long') { const b = shadow(new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.1, 0.22, 6, 14)), hair)); b.position.set(0, -0.12, 0.06); b.scale.set(1.15, 1, 0.55); head.add(b); }
    // arms: shoulder → elbow (fixed), elbow → hand on a pivot that types
    const arms = [];
    for (const sx of [-1, 1]) {
      const sh = V(sx * 0.21, 0.5, 0.0), el = V(sx * 0.24, 0.22, -0.16);
      limb(sh, el, 0.05, shirt, torso);
      sphere(0.06, shirt, sh.x, sh.y, sh.z, torso, 14);
      const pivot = new THREE.Group(); pivot.position.copy(el); torso.add(pivot);
      const hand = V(-sx * 0.1, -0.06, -0.32);
      limb(V(0, 0, 0), hand, 0.045, shirt, pivot);
      sphere(0.047, M.shirtWhite, hand.x * 0.94, hand.y * 0.94, hand.z * 0.94, pivot, 12);   // shirt cuff
      sphere(0.043, skin, hand.x, hand.y, hand.z - 0.025, pivot, 12);
      arms.push(pivot);
    }
    return { body, torso, head, arms };
  }

  // ten seats, five a side; the agents sit in the middle (back side faces the camera)
  const SEATS = [];
  const seatXs = [-1.6, -0.8, 0, 0.8, 1.6].map((d) => CT.x + d);
  for (const x of seatXs) SEATS.push([x, CT.z - 1.02, Math.PI]);
  for (const x of seatXs) SEATS.push([x, CT.z + 1.02, 0]);
  const SEAT_ORDER = [1, 2, 3, 6, 7, 0, 4, 5, 8, 9];
  const taken = new Set();
  agents.slice(0, SEAT_ORDER.length).forEach((a, i) => taken.add(SEAT_ORDER[i]));
  SEATS.forEach(([x, z, f], k) => { if (!taken.has(k)) meshChair(x, z, f); });
  meshChair(CT.x + CT.len / 2 + 0.42, CT.z, Math.PI / 2, true);              // the white chair at the head, facing the table

  /* lounge in the middle: a two-seater by the long wall, two three-seaters, a black marble table */
  function recliner(x, z, facing, seats) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = facing; scene.add(g);
    const wdt = seats * 0.66 + 0.5;
    box(wdt - 0.36, 0.22, 0.86, M.taupeDark, 0, 0.2, 0, 0.06, g);
    for (let k = 0; k < seats; k++) {
      const cx = -((seats - 1) * 0.66) / 2 + k * 0.66;
      box(0.64, 0.16, 0.66, M.taupe, cx, 0.39, -0.06, 0.07, g);
      const back = box(0.62, 0.5, 0.2, M.taupe, cx, 0.68, 0.3, 0.09, g); back.rotation.x = -0.12;
      box(0.58, 0.18, 0.16, M.taupe, cx, 0.93, 0.33, 0.07, g);
    }
    for (const sx of [-1, 1]) {
      box(0.2, 0.52, 0.86, M.taupe, sx * (wdt / 2 - 0.1), 0.34, 0, 0.09, g);
      const btn = cyl(0.03, 0.03, 0.01, M.black, sx * (wdt / 2 + 0.001), 0.4, -0.12, 16, g); btn.rotation.z = Math.PI / 2;
      for (const lz of [-0.34, 0.34]) cyl(0.02, 0.012, 0.09, M.black, sx * (wdt / 2 - 0.12), 0.045, lz, 8, g);
    }
    return g;
  }
  const LC = { x: 0.35, z: -0.85 };
  recliner(LC.x - 1.75, LC.z, -Math.PI / 2, 2);            // by the long wall, facing the entrance side
  recliner(LC.x, LC.z + 1.45, 0, 3);                       // conference side, facing the windows
  recliner(LC.x + 1.75, LC.z - 0.05, Math.PI / 2, 3);      // entrance side, facing the long wall
  const blackMarble = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#16161A'; g.fillRect(0, 0, w, h);
    const r = rng(141);
    for (let k = 0; k < 22; k++) { g.strokeStyle = `rgba(${200 + r() * 40},${170 + r() * 40},${110 + r() * 30},${0.25 + r() * 0.35})`; g.lineWidth = 0.6 + r() * 1.8; let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k2 = 0; k2 < 6; k2++) { x += (r() - 0.5) * 120; y += (r() - 0.5) * 120; g.lineTo(x, y); } g.stroke(); }
  });
  const ctg = new THREE.Group(); ctg.position.set(LC.x, 0, LC.z); scene.add(ctg);
  box(1.12, 0.06, 1.12, std('blackMarble', { map: blackMarble, roughness: 0.15, metalness: 0.1 }), 0, 0.42, 0, 0.02, ctg);
  box(1.0, 0.36, 1.0, M.lacquer, 0, 0.2, 0, 0.03, ctg);
  box(0.2, 0.08, 0.12, M.white, 0.05, 0.49, 0.05, 0.02, ctg);
  // an Iron Man on a round side table between the sofas
  const side = new THREE.Group(); side.position.set(LC.x + 1.75, 0, LC.z + 1.55); scene.add(side);
  cyl(0.24, 0.24, 0.04, M.walnutDark, 0, 0.5, 0, 28, side);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const l = cyl(0.012, 0.012, 0.5, M.black, Math.cos(a) * 0.12, 0.25, Math.sin(a) * 0.12, 6, side); l.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
  ironMan(LC.x + 1.75, LC.z + 1.55, 0.52, 0.7, -0.8);

  /* executive desk at the CCTV / window corner, chair behind it, guest chairs */
  const ED = { x: X0 + 2.95, z: Z0 + 1.85 };
  const eg = new THREE.Group(); eg.position.set(ED.x, 0, ED.z); eg.rotation.y = Math.PI / 2; scene.add(eg);   // the desk's front faces the room (+x)
  const dShape = new THREE.Shape();   // shape y = -z: the front tip points into the room
  dShape.moveTo(-1.15, 0.12); dShape.lineTo(-1.15, -0.28); dShape.quadraticCurveTo(-1.15, -0.4, -1.0, -0.4); dShape.lineTo(-0.42, -0.42);
  dShape.quadraticCurveTo(-0.3, -0.85, -0.18, -0.92); dShape.lineTo(0.18, -0.92); dShape.quadraticCurveTo(0.3, -0.85, 0.42, -0.42);
  dShape.lineTo(1.0, -0.4); dShape.quadraticCurveTo(1.15, -0.4, 1.15, -0.28); dShape.lineTo(1.15, 0.12); dShape.quadraticCurveTo(1.15, 0.26, 1.0, 0.26);
  dShape.lineTo(-1.0, 0.26); dShape.quadraticCurveTo(-1.15, 0.26, -1.15, 0.12);
  const dtop = shadow(new THREE.Mesh(keep(new THREE.ExtrudeGeometry(dShape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.015, bevelSegments: 2, curveSegments: 20 })), M.veneer));
  dtop.rotation.x = -Math.PI / 2; dtop.position.set(0, DESK_TOP - 0.045, 0); eg.add(dtop);
  const ped = cyl(0.42, 0.16, DESK_TOP - 0.06, M.veneer, 0, (DESK_TOP - 0.06) / 2, 0.55, 4, eg); ped.rotation.y = Math.PI / 4; ped.scale.set(1, 1, 0.45);
  box(0.52, DESK_TOP - 0.06, 0.6, M.veneer, 0.82, (DESK_TOP - 0.06) / 2, -0.05, 0.03, eg);
  box(0.53, 0.06, 0.61, M.bronze, 0.82, DESK_TOP - 0.12, -0.05, 0.02, eg);
  box(0.06, DESK_TOP - 0.06, 0.5, M.walnutDark, -0.98, (DESK_TOP - 0.06) / 2, -0.05, 0.01, eg);
  const curved = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.2, 1.2, 0.4, 32, 1, true, Math.PI - 0.32, 0.64)), std('monBack', { color: '#F2F2F0', roughness: 0.3, side: THREE.DoubleSide }));
  curved.position.set(0.35, DESK_TOP + 0.38, 1.03); eg.add(curved);
  box(0.06, 0.2, 0.06, M.white, 0.35, DESK_TOP + 0.1, -0.1, 0.02, eg);
  box(0.6, 0.38, 0.03, M.steel, -0.35, DESK_TOP + 0.36, -0.12, 0.012, eg);
  const aio = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.56, 0.34)), keep(new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: screenTex({ id: 'dylan', name: 'HG', role: 'Dashboard', color: '#C9A84C' }), emissiveIntensity: 0.8 })));
  aio.position.set(-0.35, DESK_TOP + 0.36, -0.104); eg.add(aio);
  box(0.03, 0.3, 0.04, M.steel, -0.35, DESK_TOP + 0.12, -0.16, 0.01, eg); box(0.3, 0.01, 0.2, M.steel, -0.35, DESK_TOP + 0.005, -0.16, 0.004, eg);
  box(0.12, 0.3, 0.16, M.white, 0.85, DESK_TOP + 0.15, -0.15, 0.02, eg); cyl(0.02, 0.02, 0.14, M.black, 0.85, DESK_TOP + 0.33, -0.1, 8, eg);
  box(0.3, 0.004, 0.22, std('folder', { color: '#E8C76A', roughness: 0.8 }), -0.75, DESK_TOP + 0.003, 0.05, 0.001, eg).rotation.y = 0.2;
  box(0.24, 0.012, 0.17, M.black, 0.25, DESK_TOP + 0.006, 0.15, 0.004, eg);
  const exec = new THREE.Group(); exec.position.set(0, 0, -0.75); exec.rotation.y = Math.PI; eg.add(exec);
  officeChairStyled(exec, false, true);
  function shellChair(parent, x, z, facing) {   // walnut shell with a cream cushion
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = facing; parent.add(g);
    const shell = shadow(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.29, 0.27, 0.36, 28, 1, true, -Math.PI * 0.62, Math.PI * 1.24)), std('shell', { color: '#5A3B26', roughness: 0.45, side: THREE.DoubleSide })));
    shell.position.set(0, 0.66, 0); shell.rotation.y = Math.PI; g.add(shell);
    cyl(0.25, 0.25, 0.08, M.cream, 0, 0.47, 0, 28, g);
    box(0.4, 0.08, 0.05, M.cream, 0, 0.66, 0.24, 0.03, g);
    for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) { const l = cyl(0.018, 0.012, 0.44, std('shellLeg', { color: '#4A2F1E', roughness: 0.5 }), lx, 0.22, lz, 8, g); l.rotation.set(lz * 0.4, 0, -lx * 0.4); }
  }
  for (const dx of [-0.75, 0, 0.75]) shellChair(eg, dx, 1.28 + (dx ? -0.08 : 0), 0);
  cyl(0.13, 0.12, 0.34, M.steel, 1.3, 0.17, -0.75, 20, eg);
  box(0.32, 0.5, 0.25, M.black, -1.35, 0.25, -0.9, 0.02, eg);
  box(0.28, 0.7, 0.28, std('purifier', { color: '#D8D8D6', roughness: 0.4 }), -1.35, 0.35, -0.4, 0.04, eg);
  // red flowers by the windows, a green plant by the entrance
  const fl = plant(X0 + W - 1.9, Z0 + 0.6, 0.85, 10);
  const petal = std('rose', { color: '#B3121D', roughness: 0.5 });
  for (let i = 0; i < 14; i++) { const a = i * 2.39, rr = 0.06 + (i % 4) * 0.035; sphere(0.045, petal, Math.cos(a) * rr, 0.85 + (i % 3) * 0.08, Math.sin(a) * rr, fl, 10); }
  plant(X0 + W - 0.6, D / 2 - 0.6, 1.0, 11);

  // the agents at the conference table
  const people = new Map();   // id → { g, ring, p, screen, glow, tagEl, bubEl, busy, talk, hot }
  const pickables = [];
  const tag = (o, id) => o.traverse((m) => { m.userData.agent = id; });
  agents.slice(0, SEAT_ORDER.length).forEach((a, i) => {
    const [sx, sz, facing] = SEATS[SEAT_ORDER[i]];
    const g = new THREE.Group(); g.position.set(sx, 0, sz); g.rotation.y = facing; scene.add(g);
    officeChairStyled(g);
    const look = LOOKS[a.id] || { hair: '#2A1E17', skin: '#E2B793', style: 'short' };
    const p = person(g, look, a.color);
    // laptop in front, the agent's work on its screen
    const lz = -0.7;
    box(0.34, 0.016, 0.24, M.chrome, 0, DESK_TOP + 0.008, lz + 0.06, 0.006, g);
    const lid = new THREE.Group(); lid.position.set(0, DESK_TOP + 0.016, lz - 0.06); lid.rotation.x = -0.28; g.add(lid);
    box(0.34, 0.23, 0.012, M.chrome, 0, 0.115, 0, 0.006, lid);
    const screen = keep(new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: screenTex(a), emissiveIntensity: daypart === 'night' ? 1.1 : 0.85, roughness: 0.25 }));
    const scr = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.31, 0.2)), screen); scr.position.set(0, 0.115, 0.0065); lid.add(scr);
    const glow = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.31, 0.03)), keep(new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0 })));
    glow.position.set(0, 0.115, 0.007); lid.add(glow); glow.userData.baseY = 0.115;
    box(0.2, 0.012, 0.27, std('note', { color: '#FFF3B8', roughness: 0.8 }), 0.3, DESK_TOP + 0.006, lz + 0.02, 0.003, g).rotation.y = 0.15;
    cyl(0.04, 0.036, 0.1, mugMat(a.color), -0.3, DESK_TOP + 0.05, lz, 18, g);
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(0.5, 0.6, 56)), keep(new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0, depthWrite: false })));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.012, 0.05); g.add(ring);
    const tagEl = document.createElement('div');
    tagEl.className = 'vo3-tag'; tagEl.style.setProperty('--ac', a.color);
    tagEl.innerHTML = `<img src="${a.img}" alt=""><span>${a.name}</span>`;
    tagEl.addEventListener('click', (e) => { e.stopPropagation(); onPick(a.id); });
    tagEl.addEventListener('mouseenter', () => onHover(a.id, true)); tagEl.addEventListener('mouseleave', () => onHover(a.id, false));
    const tagObj = new CSS2DObject(tagEl); tagObj.position.set(0, 1.66, 0.02); g.add(tagObj);
    const bubEl = document.createElement('div');
    bubEl.className = 'vo3-bubble'; bubEl.innerHTML = '<span class="say"></span><span class="wait">✍️ sedang membalas…</span>';
    const bubObj = new CSS2DObject(bubEl); bubObj.position.set(0, 1.98, 0.02); g.add(bubObj);
    tag(g, a.id); pickables.push(g);
    people.set(a.id, { g, ring, p, screen, glow, tagEl, bubEl, busy: false, talk: false, hot: false, said: 0, phase: i * 1.7 });
  });

  /* ── Aurix, the WhatsApp robot (modelled on the mascot) ── */
  const robot = new THREE.Group(); robot.position.set(AURIX_AT[0], 0, AURIX_AT[1]); robot.rotation.y = 0.62; scene.add(robot);   // faces the camera
  const rWhite = keep(new THREE.MeshPhysicalMaterial({ color: '#F3EEE3', roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15 }));
  const rSuit = std('suit', { color: '#1B1B1F', roughness: 0.55 });
  const visorMat = keep(new THREE.MeshPhysicalMaterial({ color: '#040506', roughness: 0.06, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 }));
  const eyeMat = keep(new THREE.MeshStandardMaterial({ color: '#0b0b0b', emissive: '#8FEAFF', emissiveIntensity: 3 }));
  const legs = [];   // hip pivots: the legs swing from here when Aurix walks
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(sx * 0.1, 0.66, 0); robot.add(hip);
    limb(V(0, 0, 0), V(sx * 0.005, -0.2, 0), 0.08, rSuit, hip);
    sphere(0.068, M.gold, 0, -0.23, 0.01, hip, 18);
    limb(V(0, -0.26, 0), V(0, -0.54, 0), 0.075, rWhite, hip);
    box(0.16, 0.09, 0.27, rWhite, 0, -0.61, 0.03, 0.04, hip);
    box(0.165, 0.02, 0.275, M.gold, 0, -0.65, 0.03, 0.008, hip);
    legs.push(hip);
  }
  box(0.44, 0.46, 0.27, rSuit, 0, 0.89, 0, 0.08, robot);
  const shirtV = new THREE.Mesh(keep(new THREE.CircleGeometry(0.1, 3)), std('shirtW', { color: '#F1EEE8', roughness: 0.6 }));
  shirtV.position.set(0, 1.03, 0.137); shirtV.rotation.z = -Math.PI / 2; shirtV.scale.set(0.9, 1.3, 1); robot.add(shirtV);
  box(0.035, 0.2, 0.012, M.gold, 0, 0.96, 0.142, 0.008, robot);
  const pin = new THREE.Mesh(keep(new THREE.ConeGeometry(0.025, 0.04, 3)), M.gold); pin.position.set(0.12, 1.02, 0.14); robot.add(pin);
  for (let k = 0; k < 3; k++) sphere(0.012, M.gold, 0, 0.7 + k * 0.1, 0.14, robot, 8);
  const arms = { };
  for (const sx of [-1, 1]) {
    sphere(0.085, rWhite, sx * 0.27, 1.06, 0, robot, 18);
    const sh = new THREE.Group(); sh.position.set(sx * 0.27, 1.06, 0); robot.add(sh);
    const elbow = sx < 0 ? V(-0.12, 0.14, 0.08) : V(0.16, -0.06, 0.14);
    const hand = sx < 0 ? V(-0.06, 0.34, 0.2) : V(0.3, 0.06, 0.3);   // left: at the temple, right: pointing
    limb(V(0, 0, 0), elbow, 0.058, rWhite, sh);
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.062, 0.012, 8, 24)), M.gold); ring.position.copy(elbow); ring.lookAt(elbow.clone().multiplyScalar(2)); sh.add(ring);
    limb(elbow, hand, 0.05, rWhite, sh);
    sphere(0.058, rWhite, hand.x, hand.y, hand.z, sh, 14);
    if (sx > 0) limb(hand, hand.clone().add(V(0.06, 0.03, 0.1)), 0.016, rWhite, sh); // pointing finger
    arms[sx < 0 ? 'left' : 'right'] = sh;
  }
  cyl(0.065, 0.075, 0.1, rSuit, 0, 1.15, 0, 16, robot);
  const rHead = new THREE.Group(); rHead.position.set(0, 1.44, 0.01); robot.add(rHead);
  const helmet = sphere(0.27, rWhite, 0, 0, 0, rHead, 48); helmet.scale.set(1.16, 1, 1.05);
  const band = new THREE.Mesh(keep(new THREE.TorusGeometry(0.285, 0.008, 8, 64, Math.PI * 1.4)), M.gold);
  band.rotation.set(-0.4, 0, Math.PI * -0.2); band.scale.set(1.16, 1, 1.05); rHead.add(band);
  const visor = shadow(new THREE.Mesh(keep(new THREE.SphereGeometry(0.276, 48, 32, Math.PI / 2 - 0.95, 1.9, 0.62, 1.55)), visorMat), false, false);
  visor.scale.set(1.16, 1, 1.07); rHead.add(visor);
  const eyes = new THREE.Group(); eyes.position.set(0, 0.03, 0.29); rHead.add(eyes);
  for (const ex of [-0.085, 0.085]) { const e = new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.024, 0.045, 4, 10)), eyeMat); e.position.x = ex; eyes.add(e); }
  const smile = new THREE.Mesh(keep(new THREE.TorusGeometry(0.07, 0.01, 8, 24, Math.PI * 0.7)), eyeMat);
  smile.position.set(0, -0.07, 0.29); smile.rotation.z = Math.PI + Math.PI * 0.15; rHead.add(smile);
  for (const sx of [-1, 1]) {
    const pod = cyl(0.092, 0.092, 0.08, M.gold, sx * 0.315, 0, 0, 28, rHead); pod.rotation.z = Math.PI / 2;
    const inner = cyl(0.068, 0.068, 0.085, M.black, sx * 0.318, 0, 0, 28, rHead); inner.rotation.z = Math.PI / 2;
    const dot = sphere(0.014, eyeMat, sx * 0.362, 0.03, 0, rHead, 8);
  }
  const aRing = new THREE.Mesh(keep(new THREE.RingGeometry(0.42, 0.52, 56)), keep(new THREE.MeshBasicMaterial({ color: aurix.color, transparent: true, opacity: 0, depthWrite: false })));
  aRing.rotation.x = -Math.PI / 2; aRing.position.y = 0.012; robot.add(aRing);
  const aTagEl = document.createElement('div');
  aTagEl.className = 'vo3-tag'; aTagEl.style.setProperty('--ac', aurix.color);
  aTagEl.innerHTML = `<img src="${aurix.img}" alt=""><span>Aurix · Bot WA</span>`;
  aTagEl.addEventListener('click', (e) => { e.stopPropagation(); selectAurix(!aurixSel); });
  aTagEl.addEventListener('mouseenter', () => onHover('aurix', true)); aTagEl.addEventListener('mouseleave', () => onHover('aurix', false));
  const aTag = new CSS2DObject(aTagEl); aTag.position.set(0, 1.92, 0); robot.add(aTag);
  const aBubEl = document.createElement('div'); aBubEl.className = 'vo3-bubble'; aBubEl.innerHTML = '<span class="say"></span><span class="wait">📲 membaca grup…</span>';
  const aBub = new CSS2DObject(aBubEl); aBub.position.set(0, 2.22, 0); robot.add(aBub);
  tag(robot, 'aurix'); pickables.push(robot);
  people.set('aurix', { g: robot, ring: aRing, p: null, tagEl: aTagEl, bubEl: aBubEl, busy: false, talk: false, hot: false, said: 0, phase: 0 });

  /* ── lights ── */
  const hemi = new THREE.HemisphereLight(daypart === 'night' ? '#38415E' : '#EAF2FF', daypart === 'night' ? '#2A2420' : '#B79A78', daypart === 'night' ? 0.55 : 1.1);
  scene.add(hemi);
  // soft "ceiling" light from above the open front: grounds everything with shadows
  const key = new THREE.DirectionalLight(daypart === 'night' ? '#FFE2BD' : '#FFF6EA', daypart === 'night' ? 0.9 : 1.5);
  key.position.set(5, 11, 7); key.target.position.set(0, 0, 0); scene.add(key, key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 2, far: 34 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025; key.shadow.radius = 4;
  // the sun, low behind the back wall: it only reaches the floor through the window
  if (daypart !== 'night') {
    const sun = new THREE.DirectionalLight(daypart === 'dusk' ? '#FFB27A' : '#FFF3DC', daypart === 'dusk' ? 2.2 : 3.0);
    sun.position.set(-2.2, 4.6, -19); sun.target.position.set(-0.3, 0, -2.2); scene.add(sun, sun.target);   // in through the window wall
    sun.castShadow = !mobile;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 8, bottom: -8, near: 3, far: 40 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  }

  /* ── camera ── */
  let home = HOME;
  function place(az, polar, dist) {
    const t = controls.target;
    camera.position.set(t.x + dist * Math.sin(polar) * Math.sin(az), t.y + dist * Math.cos(polar), t.z + dist * Math.sin(polar) * Math.cos(az));
    camera.lookAt(t);
    controls.update();
  }
  function homeDist() {
    const a = camera.aspect;
    return a < 0.6 ? 36 : a < 0.75 ? 31 : a < 1.2 ? 25 : 22;   // a phone sees more of the room
  }
  let fly = null;   // { from, to, d0, d1, t0, ms }
  function flyTo(target, dist, ms = 700) {
    const off = camera.position.clone().sub(controls.target);
    fly = { from: controls.target.clone(), to: target.clone(), d0: off.length(), d1: dist, t0: performance.now(), ms };
  }
  function reset(animate = false) {
    if (animate) { flyTo(home.target, homeDist()); return; }
    controls.target.copy(home.target); place(home.az, home.polar, homeDist());
  }
  function focus(id) {
    const s = people.get(id); if (!s) return;
    const p = new THREE.Vector3();
    (s.p ? s.p.head : rHead).getWorldPosition(p);
    p.y -= 0.35;
    flyTo(p, camera.aspect < 0.75 ? 9.5 : 7.5);
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    labels.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize(); reset();

  /* ── Aurix walks where you click (Diablo-style), around the furniture ──
     A 20 cm grid of the floor; every piece of furniture standing on it blocks
     the cells it covers (plus Aurix's radius). A* finds the way, the corners
     are cut where the line is clear, a Catmull-Rom curve rounds them, and he
     speeds up, slows down and turns smoothly while his legs and arms swing. */
  const CELL = 0.2, GX = Math.ceil(W / CELL), GZ = Math.ceil(D / CELL), R_BOT = 0.3;
  const blocked = new Uint8Array(GX * GZ);
  const cellOf = (x, z) => [Math.floor((x - X0) / CELL), Math.floor((z - Z0) / CELL)];
  const cxOf = (i) => X0 + (i + 0.5) * CELL, czOf = (j) => Z0 + (j + 0.5) * CELL;
  const free = (i, j) => i >= 0 && j >= 0 && i < GX && j < GZ && !blocked[j * GX + i];
  const walkMarks = new THREE.Group(); scene.add(walkMarks);
  const markMat = keep(new THREE.MeshBasicMaterial({ color: aurix.color, transparent: true, opacity: 0.9, depthWrite: false }));
  const marker = new THREE.Group(); marker.visible = false; walkMarks.add(marker);
  const mRing = new THREE.Mesh(keep(new THREE.RingGeometry(0.17, 0.24, 40)), markMat); mRing.rotation.x = -Math.PI / 2; marker.add(mRing);
  const mDot = new THREE.Mesh(keep(new THREE.CircleGeometry(0.06, 24)), markMat); mDot.rotation.x = -Math.PI / 2; marker.add(mDot);
  const ghost = new THREE.Mesh(keep(new THREE.RingGeometry(0.15, 0.2, 40)), keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false })));
  ghost.rotation.x = -Math.PI / 2; ghost.visible = false; walkMarks.add(ghost);
  function buildGrid() {
    for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
      const x = cxOf(i), z = czOf(j);
      blocked[j * GX + i] = x < X0 + 0.32 || x > X0 + W - 0.28 || z < Z0 + 0.32 || z > Z0 + D - 0.28 ? 1 : 0;
    }
    // every solid piece blocks its own footprint (a group's empty space stays walkable)
    const bb = new THREE.Box3();
    const mark = (box3) => {
      if (box3.isEmpty() || box3.max.y < 0.03 || box3.min.y > 1.0) return;   // flat on the floor, or up on a wall
      const [i0, j0] = cellOf(box3.min.x - R_BOT, box3.min.z - R_BOT), [i1, j1] = cellOf(box3.max.x + R_BOT, box3.max.z + R_BOT);
      for (let j = Math.max(0, j0); j <= Math.min(GZ - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(GX - 1, i1); i++) blocked[j * GX + i] = 1;
    };
    for (const o of scene.children) {
      if (o === robot || o === floor || o === walkMarks) continue;
      o.updateWorldMatrix(true, true);
      o.traverse((m) => {
        if (!m.isMesh || (m.material && m.material.isMeshBasicMaterial)) return;   // floor rings, glows, the sky
        if (m.isInstancedMesh) { bb.makeEmpty(); bb.expandByObject(m, true); mark(bb); return; }
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        bb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld); mark(bb);
      });
    }
  }
  function nearestFree(i, j) {
    i = Math.min(GX - 1, Math.max(0, i)); j = Math.min(GZ - 1, Math.max(0, j));
    if (free(i, j)) return [i, j];
    for (let r = 1; r < Math.max(GX, GZ); r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !free(i + di, j + dj)) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = [i + di, j + dj]; }
      }
      if (best) return best;
    }
    return null;
  }
  function findPath(si, sj, ti, tj) {   // A*, 8 directions, no squeezing past corners
    const N = GX * GZ, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const h = (i, j) => { const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const heap = [];
    const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const q = (c - 1) >> 1; if (heap[q][0] <= heap[c][0]) break; [heap[q], heap[c]] = [heap[c], heap[q]]; c = q; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const start = sj * GX + si, goal = tj * GX + ti;
    g[start] = 0; push(h(si, sj), start);
    while (heap.length) {
      const k = pop()[1];
      if (closed[k]) continue; closed[k] = 1;
      if (k === goal) break;
      const i = k % GX, j = (k / GX) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if ((!di && !dj) || !free(i + di, j + dj)) continue;
        if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue;
        const nk = (j + dj) * GX + i + di, ng = g[k] + (di && dj ? Math.SQRT2 : 1);
        if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(ng + h(i + di, j + dj), nk); }
      }
    }
    if (goal !== start && from[goal] === -1) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = from[k]) { cells.push(k); if (k === start) break; }
    return cells.reverse().map((k) => new THREE.Vector3(cxOf(k % GX), 0, czOf((k / GX) | 0)));
  }
  function lineFree(a, b) {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / (CELL * 0.5)));
    for (let k = 0; k <= n; k++) { const q = a.clone().lerp(b, k / n); const [i, j] = cellOf(q.x, q.z); if (!free(i, j)) return false; }
    return true;
  }
  function simplify(pts) {   // keep only the turns the furniture forces
    const out = [pts[0]];
    for (let a = 0; a < pts.length - 1;) {
      let b = pts.length - 1;
      while (b > a + 1 && !lineFree(pts[a], pts[b])) b--;
      out.push(pts[b]); a = b;
    }
    return out;
  }
  const lerpAngle = (a, b, k) => a + ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * k;
  let walk = null, walkW = 0, walkPhase = 0, aurixSel = false, markerT = 0;
  function walkTo(p) {
    const [ti, tj] = cellOf(p.x, p.z);
    const t = nearestFree(ti, tj);
    const [si, sj] = cellOf(robot.position.x, robot.position.z);
    const st = nearestFree(si, sj);
    if (!t || !st) return false;
    const cells = findPath(st[0], st[1], t[0], t[1]);
    if (!cells) return false;
    const goal = free(ti, tj) ? new THREE.Vector3(p.x, 0, p.z) : cells[cells.length - 1].clone();
    const start = new THREE.Vector3(robot.position.x, 0, robot.position.z);
    if (start.distanceTo(goal) < 0.1) return false;
    const pts = simplify([start, ...cells.slice(1, -1), goal]);
    const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5) : new THREE.LineCurve3(pts[0], pts[1]);
    walk = { curve, len: curve.getLength(), s: 0, v: walk ? walk.v : 0 };
    marker.position.set(goal.x, 0.016, goal.z); marker.visible = true; markerT = 0;
    return true;
  }
  const POS_KEY = 'vo.aurix';
  function saveAurix() {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: +robot.position.x.toFixed(2), z: +robot.position.z.toFixed(2), r: +robot.rotation.y.toFixed(2) })); } catch (e) { /* private mode */ }
  }
  function selectAurix(on) {
    aurixSel = !!on;
    const s = people.get('aurix'); if (s) { s.sel = aurixSel; sync(s); }
    if (!aurixSel) ghost.visible = false;
    el.style.cursor = aurixSel ? 'crosshair' : '';
    if (opts.onAurixSelect) opts.onAurixSelect(aurixSel);
  }
  buildGrid();
  try {   // where you left him last time
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) && free(...cellOf(saved.x, saved.z))) {
      robot.position.x = saved.x; robot.position.z = saved.z;
      if (Number.isFinite(saved.r)) robot.rotation.y = saved.r;
    }
  } catch (e) { /* private mode or junk */ }
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /* ── picking and hover ── */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function hit(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(pickables, true)[0];
    return h ? h.object.userData.agent : null;
  }
  let down = null, hovered = null, hoverQueued = null;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    const id = hit(e);
    if (id === 'aurix') { selectAurix(!aurixSel); return; }   // click Aurix: take control (again: let go)
    if (id) { onPick(id); return; }
    if (aurixSel) { const q = ray.ray.intersectPlane(floorPlane, new THREE.Vector3()); if (q) walkTo(q); }
  };
  const onMove = (e) => {
    if (e.pointerType !== 'mouse' || down) return;
    hoverQueued = e;
  };
  const onLeave = () => { if (hovered) { onHover(hovered, false); hovered = null; } el.style.cursor = ''; };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);

  /* ── animation ── */
  const clockNow = () => {
    const [hh, mm] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
    hHand.rotation.z = -((hh % 12) + mm / 60) * (Math.PI / 6);
    mHand.rotation.z = -mm * (Math.PI / 30);
  };
  clockNow();
  let lastClock = 0, raf = 0, running = true, lastNow = performance.now();
  const t0 = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { lastNow = now; return; }
    const t = (now - t0) / 1000;
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000)); lastNow = now;   // slow devices still walk at real speed
    if (walk) {
      const remain = walk.len - walk.s;
      const vTarget = Math.min(1.35, Math.sqrt(2 * 2.2 * Math.max(0, remain)));   // brake before the goal
      walk.v = walk.v < vTarget ? Math.min(vTarget, walk.v + 2.6 * dt) : vTarget;   // ease in
      walk.s = Math.min(walk.len, walk.s + walk.v * dt);
      const u = walk.len ? walk.s / walk.len : 1;
      const p = walk.curve.getPointAt(u), tg = walk.curve.getTangentAt(Math.min(u, 0.995));
      robot.position.x = p.x; robot.position.z = p.z;
      robot.rotation.y = lerpAngle(robot.rotation.y, Math.atan2(tg.x, tg.z), 1 - Math.exp(-9 * dt));
      walkPhase += walk.v * dt * 5.4;
      if (remain < 0.005) { walk = null; saveAurix(); }
    }
    walkW += ((walk ? Math.min(1, walk.v / 0.55) : 0) - walkW) * (1 - Math.exp(-8 * dt));
    if (marker.visible) {
      markerT += dt;
      const k = walk ? 1 : Math.max(0, 1 - (markerT - 0.2) * 1.4);
      markMat.opacity = 0.9 * k; mRing.scale.setScalar(1 + Math.sin(markerT * 6) * 0.08);
      if (!walk && k <= 0) marker.visible = false;
    }
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.lerpVectors(fly.from, fly.to, e);
      camera.position.copy(controls.target).add(dir.multiplyScalar(fly.d0 + (fly.d1 - fly.d0) * e));
      if (k >= 1) fly = null;
    }
    controls.update();
    if (hoverQueued) {
      const id = hit(hoverQueued); hoverQueued = null;
      if (id !== hovered) { if (hovered) onHover(hovered, false); hovered = id; if (id) onHover(id, true); }
      // with Aurix in hand, a ghost ring shows where he would go
      const q = aurixSel && !id ? ray.ray.intersectPlane(floorPlane, new THREE.Vector3()) : null;
      if (q && Math.abs(q.x) < W / 2 && Math.abs(q.z) < D / 2) { ghost.position.set(q.x, 0.014, q.z); ghost.visible = true; } else ghost.visible = false;
      el.style.cursor = id ? 'pointer' : aurixSel ? 'crosshair' : '';
    }
    if (now - lastClock > 20000) { clockNow(); lastClock = now; }
    for (const l of leds) l.mat.emissiveIntensity = reduced ? 2 : (Math.sin(t * l.speed + l.phase) > -0.2 ? 2.4 : 0.2);
    for (const [id, s] of people) {
      const on = s.hot || s.talk || s.sel;
      const target = s.sel ? 0.65 + 0.3 * Math.sin(t * 5) : on ? 0.9 : s.busy ? 0.35 + 0.35 * Math.sin(t * 4) : 0;
      s.ring.material.opacity += (target - s.ring.material.opacity) * 0.15;
      if (reduced) continue;
      if (s.p) {
        s.p.torso.scale.y = 1 + Math.sin(t * 1.6 + s.phase) * 0.008;              // breathing
        s.p.head.rotation.y = Math.sin(t * 0.35 + s.phase) * 0.12;                // looking around a bit
        const typing = s.busy ? 1 : 0.15;
        s.p.arms[0].rotation.x = Math.sin(t * 13 + s.phase) * 0.08 * typing;
        s.p.arms[1].rotation.x = Math.sin(t * 13 + s.phase + 1.7) * 0.08 * typing;
        s.glow.material.opacity = s.busy ? 0.35 + 0.3 * Math.sin(t * 6) : 0;
        s.glow.position.y = s.glow.userData.baseY + (s.busy ? ((t * 0.35) % 1 - 0.5) * 0.17 : 0);
      } else { // Aurix
        robot.position.y = Math.sin(t * 1.4) * 0.008 * (1 - walkW) + Math.abs(Math.sin(walkPhase)) * 0.03 * walkW;
        legs[0].rotation.x = Math.sin(walkPhase) * 0.5 * walkW;
        legs[1].rotation.x = -Math.sin(walkPhase) * 0.5 * walkW;
        arms.left.rotation.x = -Math.sin(walkPhase) * 0.25 * walkW;
        arms.right.rotation.x = Math.sin(walkPhase) * 0.3 * walkW;
        rHead.rotation.z = Math.sin(t * 0.8) * 0.05 * (1 - walkW) + (s.hot ? Math.sin(t * 6) * 0.06 : 0);
        rHead.rotation.x = s.hot ? -0.08 : 0;
        arms.right.rotation.z = s.hot ? Math.sin(t * 7) * 0.25 : 0;
        const blink = (t % 3.6) < 0.12 ? 0.15 : 1;
        eyes.scale.y = blink;
      }
    }
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  function sync(s) {
    s.tagEl.classList.toggle('hot', s.hot || s.talk || s.sel);
    s.bubEl.classList.toggle('busy', s.busy);
    s.bubEl.classList.toggle('said', Date.now() < s.said && !s.busy);
  }

  return {
    setState(id, { busy, talk }) { const s = people.get(id); if (!s) return; if (busy !== undefined) s.busy = !!busy; if (talk !== undefined) s.talk = !!talk; sync(s); },
    setHot(id, on) { const s = people.get(id); if (!s) return; s.hot = !!on; sync(s); },
    say(id, text) {
      const s = people.get(id); if (!s) return;
      s.bubEl.querySelector('.say').textContent = text;
      s.said = Date.now() + 9000; sync(s);
      setTimeout(() => sync(s), 9100);
    },
    turn(deg) {
      const off = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta = Math.min(controls.maxAzimuthAngle, Math.max(controls.minAzimuthAngle, sph.theta + (deg * Math.PI) / 180));
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph)); controls.update();
    },
    zoom(f) {
      const off = camera.position.clone().sub(controls.target);
      const d = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() / f));
      camera.position.copy(controls.target).add(off.setLength(d)); controls.update();
    },
    reset: () => reset(true),
    aurixSelect: (on) => selectAurix(on),
    isAurixSelected: () => aurixSel,
    moveAurix: (x, z) => walkTo(new THREE.Vector3(x, 0, z)),
    aurixAt: () => ({ x: robot.position.x, z: robot.position.z, walking: !!walk }),
    // debugging: the walk grid as rows of '.' (free) and '#' (blocked), back wall first
    walkGrid: () => { const rows = []; for (let j = 0; j < GZ; j++) { let r = ''; for (let i = 0; i < GX; i++) r += blocked[j * GX + i] ? '#' : '.'; rows.push(r); } return rows.join('\n'); },
    focus,
    scene,   // for debugging in the console
    dispose() {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
      disposables.forEach((x) => x.dispose && x.dispose());
      renderer.dispose(); renderer.forceContextLoss();
      renderer.domElement.remove(); labels.domElement.remove();
    },
  };
}

export { mount };
