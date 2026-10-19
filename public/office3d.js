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

const W = 11, D = 8.2, H = 3;
const X0 = -W / 2, Z0 = -D / 2;
const DESK_TOP = 0.75;
// Desk centres, in AGENTS order (the same layout as the CSS office).
const SLOTS = [[-3.35, -1.31], [-0.65, -1.31], [2.05, -1.31], [-3.35, 1.33], [-0.65, 1.33]];
const AURIX_AT = [5.0, 1.55];
const HOME = { az: 0.8, polar: 0.98, target: new THREE.Vector3(0.6, 0.45, 0.9) };
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
    minDistance: 6, maxDistance: 27, minPolarAngle: 0.42, maxPolarAngle: 1.28,
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

  /* ── the room ── */
  const floor = shadow(new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), M.floor), false, true);
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // a soft edge under the floor so the room sits on something
  const plinth = box(W + 0.3, 0.12, D + 0.3, std('plinth', { color: '#BDAE97', roughness: 0.9 }), 0, -0.061, 0, 0.04); plinth.castShadow = false;

  // back wall with a real window opening: the sun comes in through it
  const WIN = { x0: -4.54, x1: 0.86, y0: 0.66, y1: 2.04 };
  const wallShape = new THREE.Shape();
  wallShape.moveTo(X0 - 0.15, 0); wallShape.lineTo(X0 + W, 0); wallShape.lineTo(X0 + W, H); wallShape.lineTo(X0 - 0.15, H); wallShape.lineTo(X0 - 0.15, 0);
  const hole = new THREE.Path();
  hole.moveTo(WIN.x0, WIN.y0); hole.lineTo(WIN.x1, WIN.y0); hole.lineTo(WIN.x1, WIN.y1); hole.lineTo(WIN.x0, WIN.y1); hole.lineTo(WIN.x0, WIN.y0);
  wallShape.holes.push(hole);
  const backWall = shadow(new THREE.Mesh(keep(new THREE.ExtrudeGeometry(wallShape, { depth: 0.15, bevelEnabled: false })), M.wall));
  backWall.position.z = Z0 - 0.15; scene.add(backWall);
  box(0.15, H, D, M.wall, X0 - 0.075, H / 2, 0, 0);                       // left wall
  box(W + 0.15, 0.02, 0.15, M.wallTop, -0.075, H + 0.01, Z0 - 0.075, 0);  // wall tops
  box(0.15, 0.02, D, M.wallTop, X0 - 0.075, H + 0.01, 0, 0);
  box(W, 0.1, 0.03, M.base, 0, 0.05, Z0 + 0.015, 0);                      // baseboards
  box(0.03, 0.1, D, M.base, X0 + 0.015, 0.05, 0, 0);

  // window: frame, mullions, sill, glass, and the city behind it
  const winW = WIN.x1 - WIN.x0, winH = WIN.y1 - WIN.y0, winCx = (WIN.x0 + WIN.x1) / 2, winCy = (WIN.y0 + WIN.y1) / 2;
  for (const [w, h, x, y] of [[winW + 0.1, 0.06, winCx, WIN.y1 + 0.03], [winW + 0.1, 0.06, winCx, WIN.y0 - 0.03], [0.06, winH, WIN.x0 - 0.03, winCy], [0.06, winH, WIN.x1 + 0.03, winCy]]) box(w, h, 0.18, M.frame, x, y, Z0 - 0.06, 0.01);
  for (let i = 1; i < 4; i++) box(0.045, winH, 0.06, M.frame, WIN.x0 + (winW * i) / 4, winCy, Z0 - 0.07, 0.008);
  box(winW + 0.3, 0.035, 0.24, M.frame, winCx, WIN.y0 - 0.06, Z0 + 0.06, 0.01);
  const pane = new THREE.Mesh(keep(new THREE.PlaneGeometry(winW, winH)), glass);
  pane.position.set(winCx, winCy, Z0 - 0.08); scene.add(pane);
  const skyMat = keep(new THREE.MeshBasicMaterial({ map: skyTex(), toneMapped: false }));
  const sky = new THREE.Mesh(keep(new THREE.PlaneGeometry(winW + 2.2, 2.3)), skyMat);
  sky.position.set(winCx, 1.35, Z0 - 0.9); scene.add(sky);   // top stays below the wall top (no peeking over it)

  // wall decor: logo, clock, task board
  box(2.72, 0.6, 0.05, M.black, 3.37, 1.95, Z0 + 0.03, 0.02);
  const logo = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.62, 0.56)), keep(new THREE.MeshStandardMaterial({ map: logoTex, roughness: 0.4, emissive: '#ffffff', emissiveMap: logoTex, emissiveIntensity: 0.25 })));
  logo.position.set(3.37, 1.95, Z0 + 0.056); scene.add(logo);
  const clock = new THREE.Group(); clock.position.set(1.6, 2.2, Z0 + 0.03); scene.add(clock);
  const face = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 40)), [M.black, keep(new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.3 })), M.black]);
  face.rotation.x = Math.PI / 2; face.rotation.y = Math.PI / 2; clock.add(face);
  const hHand = new THREE.Group(), mHand = new THREE.Group(); hHand.position.z = mHand.position.z = 0.03; clock.add(hHand, mHand);
  box(0.016, 0.1, 0.008, M.black, 0, 0.045, 0, 0.004, hHand);
  box(0.012, 0.15, 0.008, M.black, 0, 0.07, 0.006, 0.004, mHand);
  box(0.06, 2.4 * 0.5, 2.36, M.frame, X0 + 0.02, 1.45, 0.05, 0.015);
  const board = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.3, 1.12)), keep(new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.35 })));
  board.rotation.y = Math.PI / 2; board.position.set(X0 + 0.055, 1.45, 0.05); scene.add(board);

  /* ── server rack (Hermes) with blinking lights ── */
  const rack = box(0.66, 1.8, 0.8, M.metalDark, -5.11, 0.9, -3.44, 0.02);
  const rackFront = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.56, 1.66)), keep(new THREE.MeshStandardMaterial({ map: rackTex, roughness: 0.5, metalness: 0.3 })));
  rackFront.position.set(-5.11, 0.92, -3.035); scene.add(rackFront);
  const leds = [];
  const ledCols = ['#22C55E', '#60A5FA', '#22C55E', '#F59E0B'];
  for (let i = 0; i < 9; i++) for (let k = 0; k < 3; k++) {
    const mat = keep(new THREE.MeshStandardMaterial({ color: '#111', emissive: ledCols[(i + k) % 4], emissiveIntensity: 2.2 }));
    const led = new THREE.Mesh(keep(new THREE.SphereGeometry(0.008, 8, 6)), mat);
    led.position.set(-5.34 + k * 0.03, 1.61 - i * 0.162, -3.03); scene.add(led);
    leds.push({ mat, phase: (i * 3 + k) * 0.7, speed: 1.2 + ((i + k) % 3) * 0.9 });
  }

  /* ── coffee corner ── */
  box(2.36, 0.86, 0.6, M.walnut, 4.14, 0.43, -3.75, 0.02);
  box(2.42, 0.04, 0.66, M.quartz, 4.14, 0.88, -3.74, 0.01);
  for (let i = 0; i < 4; i++) { box(0.55, 0.7, 0.02, std('door', { color: '#7A5639', roughness: 0.5 }), 3.25 + i * 0.59, 0.44, -3.44, 0.008); box(0.14, 0.016, 0.02, M.chrome, 3.25 + i * 0.59, 0.7, -3.425, 0.006); }
  box(2.2, 0.035, 0.26, M.walnut, 4.14, 1.62, -3.97, 0.008);                  // wall shelf
  const machine = box(0.34, 0.42, 0.34, M.black, 3.55, 1.11, -3.8, 0.04);
  box(0.26, 0.05, 0.2, M.chrome, 3.55, 0.93, -3.7, 0.01);
  sphere(0.012, keep(new THREE.MeshStandardMaterial({ color: '#111', emissive: '#F97316', emissiveIntensity: 2 })), 3.66, 1.25, -3.625);
  const mugMat = (c) => std('mug' + c, { color: c, roughness: 0.35 });
  for (const [x, c] of [[3.85, '#F5F5F5'], [3.98, '#C9A84C'], [4.11, '#2F6F9F']]) cyl(0.04, 0.035, 0.1, mugMat(c), x, 0.95, -3.62);
  for (let i = 0; i < 6; i++) cyl(0.05, 0.05, 0.16 + (i % 3) * 0.04, mugMat(['#E8E2D6', '#C9A84C', '#9CA3AF'][i % 3]), 3.4 + i * 0.3, 1.72 + ((i % 3) * 0.02), -3.96, 16);

  /* ── bookshelf ── */
  // open at the front (+x): back panel, sides and top, so the books show
  box(0.03, 1.84, 1.76, M.walnut, -5.455, 0.92, 2.78, 0.008);
  box(0.46, 1.84, 0.03, M.walnut, -5.24, 0.92, 1.915, 0.008); box(0.46, 1.84, 0.03, M.walnut, -5.24, 0.92, 3.645, 0.008);
  box(0.46, 0.03, 1.76, M.walnut, -5.24, 1.825, 2.78, 0.008);
  const bookGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const books = new THREE.InstancedMesh(bookGeo, keep(new THREE.MeshStandardMaterial({ roughness: 0.6 })), 60);
  books.castShadow = true; books.receiveShadow = true;
  const bc = ['#B4463A', '#2F6F9F', '#C9A84C', '#3E7D5A', '#6B4FA0', '#D07A3A', '#334155', '#E5E7EB'].map((c) => new THREE.Color(c));
  const tm = new THREE.Matrix4(); const r1 = rng(21);
  let n = 0;
  for (let s = 0; s < 4; s++) {
    box(0.42, 0.025, 1.7, std('shelf', { color: '#5B3E28', roughness: 0.6 }), -5.22, 0.08 + s * 0.44, 2.78, 0.004);
    let z = 1.96;
    while (z < 3.56 && n < 60) {
      const th = 0.03 + r1() * 0.04, hgt = 0.24 + r1() * 0.12;
      tm.compose(V(-5.13, 0.095 + s * 0.44 + hgt / 2, z + th / 2), new THREE.Quaternion(), V(0.26, hgt, th));
      books.setMatrixAt(n, tm); books.setColorAt(n, bc[Math.floor(r1() * bc.length)]);
      z += th + 0.004; n++;
    }
  }
  books.count = n; scene.add(books);

  /* ── plants ── */
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
  plant(4.95, -1.05, 1.1, 2); plant(4.95, 3.3, 1.25, 3); plant(-4.95, -1.75, 0.9, 4); plant(0.4, 3.55, 1.05, 5); plant(5.05, -3.62, 0.7, 6);

  /* ── meeting corner ── */
  const rug = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.3, 3.0)), M.rug);
  rug.rotation.x = -Math.PI / 2; rug.position.set(3.63, 0.006, 1.32); rug.receiveShadow = true; scene.add(rug);
  box(2.14, 0.05, 1.16, M.quartz, 3.57, 0.74, 1.36, 0.02);
  for (const dx of [-0.6, 0.6]) { cyl(0.05, 0.05, 0.7, M.metalDark, 3.57 + dx, 0.37, 1.36); box(0.5, 0.03, 0.5, M.metalDark, 3.57 + dx, 0.015, 1.36, 0.01); }
  function meetChair(x, z, facing) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = facing; scene.add(g);
    box(0.46, 0.08, 0.44, M.fabricMeet, 0, 0.46, 0, 0.03, g);
    box(0.46, 0.44, 0.06, M.fabricMeet, 0, 0.72, 0.21, 0.03, g);
    for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) cyl(0.014, 0.014, 0.44, M.chrome, lx, 0.22, lz, 10, g);
  }
  // facing: the seat looks at the table, the backrest is away from it
  for (const dx of [-0.65, 0, 0.65]) { meetChair(3.57 + dx, 0.55, Math.PI); meetChair(3.57 + dx, 2.17, 0); }
  const laptopScreen = keep(new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: screenTex({ id: 'joel', name: 'Rapat', role: 'Agenda', color: '#25D366' }), emissiveIntensity: 0.9 }));
  box(0.34, 0.015, 0.24, M.chrome, 3.5, 0.775, 1.42, 0.006);
  const lid = new THREE.Group(); lid.position.set(3.5, 0.78, 1.3); lid.rotation.x = -0.25; scene.add(lid);
  box(0.34, 0.22, 0.012, M.chrome, 0, 0.11, 0, 0.006, lid);
  const ls = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.31, 0.19)), laptopScreen); ls.position.set(0, 0.11, 0.0065); lid.add(ls);

  /* ── desks, chairs, people ── */
  const people = new Map();   // id → { group, ring, arms, head, tag, bubble, screen, busy, talk, hot }
  const pickables = [];
  const tag = (o, id) => o.traverse((m) => { m.userData.agent = id; });

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

  agents.slice(0, SLOTS.length).forEach((a, i) => {
    const [cx, cz] = SLOTS[i];
    const g = new THREE.Group(); g.position.set(cx, 0, cz); scene.add(g);
    // desk: top, metal frame, drawer unit
    box(1.6, 0.035, 0.8, M.oak, 0, DESK_TOP - 0.018, 0, 0.012, g);
    for (const sx of [-0.74, 0.74]) { box(0.05, 0.7, 0.05, M.metalDark, sx, 0.35, -0.33, 0.01, g); box(0.05, 0.7, 0.05, M.metalDark, sx, 0.35, 0.33, 0.01, g); box(0.05, 0.04, 0.66, M.metalDark, sx, 0.05, 0, 0.01, g); }
    box(1.44, 0.05, 0.04, M.metalDark, 0, 0.66, -0.33, 0.01, g);
    box(0.42, 0.58, 0.6, M.white, 0.5, 0.3, -0.06, 0.02, g);
    for (const yy of [0.15, 0.36, 0.52]) box(0.12, 0.012, 0.012, M.chrome, 0.5, yy, 0.245, 0.005, g);
    // monitor
    const screen = keep(new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: screenTex(a), emissiveIntensity: daypart === 'night' ? 1.15 : 0.85, roughness: 0.25 }));
    box(0.66, 0.4, 0.03, M.black, 0, DESK_TOP + 0.36, -0.26, 0.012, g);
    const scr = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.62, 0.36)), screen); scr.position.set(0, DESK_TOP + 0.36, -0.243); g.add(scr);
    box(0.05, 0.2, 0.03, M.chrome, 0, DESK_TOP + 0.12, -0.3, 0.01, g);
    box(0.24, 0.015, 0.16, M.chrome, 0, DESK_TOP + 0.008, -0.28, 0.006, g);
    const glow = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.62, 0.05)), keep(new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0 })));
    glow.position.set(0, DESK_TOP + 0.36, -0.242); g.add(glow);
    // keyboard, mouse, mug, notebook, lamp
    box(1.5, 0.36, 0.03, M.panelFabric, 0, DESK_TOP + 0.18, -0.385, 0.012, g);        // acoustic privacy panel
    box(0.74, 0.004, 0.32, M.deskMat, 0.04, DESK_TOP + 0.002, 0.11, 0.002, g);         // desk mat
    const kb = box(0.44, 0.018, 0.14, M.keys, 0, DESK_TOP + 0.012, 0.1, 0.006, g);
    cyl(0.032, 0.03, 0.09, M.black, -0.66, DESK_TOP + 0.045, -0.26, 16, g);              // pen holder
    for (const [px, pc] of [[-0.008, '#2563EB'], [0.01, '#111111'], [0.0, '#DC2626']]) cyl(0.004, 0.004, 0.14, std('pen' + pc, { color: pc, roughness: 0.4 }), -0.66 + px, DESK_TOP + 0.1, -0.26 + px, 6, g);
    box(0.072, 0.008, 0.145, M.black, 0.44, DESK_TOP + 0.005, -0.02, 0.006, g).rotation.y = -0.25;   // phone
    const frame = new THREE.Group(); frame.position.set(-0.32, DESK_TOP, -0.28); frame.rotation.set(-0.18, 0.35, 0); g.add(frame);
    box(0.12, 0.15, 0.012, M.walnut, 0, 0.075, 0, 0.004, frame);
    const photo = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.096, 0.12)), keep(new THREE.MeshStandardMaterial({ map: keep(new THREE.TextureLoader().load(a.img, (t) => { t.colorSpace = THREE.SRGBColorSpace; })), roughness: 0.5 })));
    photo.position.set(0, 0.075, 0.0065); frame.add(photo);
    cyl(0.12, 0.1, 0.3, M.binMesh, -0.6, 0.15, 0.05, 20, g);                              // bin under the desk
    box(0.06, 0.02, 0.1, M.white, 0.32, DESK_TOP + 0.011, 0.12, 0.012, g);
    cyl(0.04, 0.036, 0.1, mugMat(a.color), -0.55, DESK_TOP + 0.05, -0.1, 18, g);
    box(0.2, 0.012, 0.27, std('note', { color: '#FFF3B8', roughness: 0.8 }), -0.42, DESK_TOP + 0.007, 0.16, 0.003, g).rotation.y = 0.2;
    const lamp = new THREE.Group(); lamp.position.set(0.66, DESK_TOP, -0.28); g.add(lamp);
    cyl(0.07, 0.08, 0.02, M.black, 0, 0.01, 0, 18, lamp);
    limb(V(0, 0.02, 0), V(-0.05, 0.36, 0.08), 0.01, M.black, lamp);
    const shade = cyl(0.03, 0.07, 0.09, M.black, -0.09, 0.36, 0.15, 18, lamp); shade.rotation.x = 0.6;
    const bulb = sphere(0.025, keep(new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#FFD9A3', emissiveIntensity: daypart === 'night' ? 3 : 0.4 })), -0.1, 0.33, 0.18, lamp, 10);
    if (daypart !== 'day') { const pl = new THREE.PointLight('#FFD3A1', daypart === 'night' ? 2.4 : 1.2, 3.2, 2); pl.position.set(-0.1, 0.3, 0.2); lamp.add(pl); }
    // chair and the agent, facing the monitor
    const seat = new THREE.Group(); seat.position.set(0, 0, 0.66); g.add(seat);
    officeChair(seat);
    const look = LOOKS[a.id] || { hair: '#2A1E17', skin: '#E2B793', style: 'short' };
    const p = person(seat, look, a.color);   // a.color: the lapel pin
    // floor ring (hover / talking / busy)
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(0.5, 0.6, 56)), keep(new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0, depthWrite: false })));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.012, 0.66); g.add(ring);
    // labels
    const tagEl = document.createElement('div');
    tagEl.className = 'vo3-tag'; tagEl.style.setProperty('--ac', a.color);
    tagEl.innerHTML = `<img src="${a.img}" alt=""><span>${a.name}</span>`;
    tagEl.addEventListener('click', (e) => { e.stopPropagation(); onPick(a.id); });
    tagEl.addEventListener('mouseenter', () => onHover(a.id, true)); tagEl.addEventListener('mouseleave', () => onHover(a.id, false));
    const tagObj = new CSS2DObject(tagEl); tagObj.position.set(0, 1.66, 0.62); g.add(tagObj);
    const bubEl = document.createElement('div');
    bubEl.className = 'vo3-bubble'; bubEl.innerHTML = '<span class="say"></span><span class="wait">✍️ sedang membalas…</span>';
    const bubObj = new CSS2DObject(bubEl); bubObj.position.set(0, 1.98, 0.62); g.add(bubObj);
    tag(g, a.id); pickables.push(g);
    people.set(a.id, { g, ring, p, screen, glow, tagEl, bubEl, busy: false, talk: false, hot: false, said: 0, phase: i * 1.7 });
  });

  /* ── Aurix, the WhatsApp robot (modelled on the mascot) ── */
  const robot = new THREE.Group(); robot.position.set(AURIX_AT[0], 0, AURIX_AT[1]); robot.rotation.y = 0.62; scene.add(robot);   // faces the camera
  const rWhite = keep(new THREE.MeshPhysicalMaterial({ color: '#F3EEE3', roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15 }));
  const rSuit = std('suit', { color: '#1B1B1F', roughness: 0.55 });
  const visorMat = keep(new THREE.MeshPhysicalMaterial({ color: '#040506', roughness: 0.06, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 }));
  const eyeMat = keep(new THREE.MeshStandardMaterial({ color: '#0b0b0b', emissive: '#8FEAFF', emissiveIntensity: 3 }));
  for (const sx of [-1, 1]) {
    box(0.16, 0.09, 0.27, rWhite, sx * 0.1, 0.05, 0.03, 0.04, robot);
    box(0.165, 0.02, 0.275, M.gold, sx * 0.1, 0.01, 0.03, 0.008, robot);
    limb(V(sx * 0.1, 0.12, 0), V(sx * 0.1, 0.4, 0), 0.075, rWhite, robot);
    sphere(0.068, M.gold, sx * 0.1, 0.43, 0.01, robot, 18);
    limb(V(sx * 0.1, 0.46, 0), V(sx * 0.11, 0.66, 0), 0.08, rSuit, robot);
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
  aTagEl.addEventListener('click', (e) => { e.stopPropagation(); onPick('aurix'); });
  aTagEl.addEventListener('mouseenter', () => onHover('aurix', true)); aTagEl.addEventListener('mouseleave', () => onHover('aurix', false));
  const aTag = new CSS2DObject(aTagEl); aTag.position.set(0, 1.92, 0); robot.add(aTag);
  const aBubEl = document.createElement('div'); aBubEl.className = 'vo3-bubble'; aBubEl.innerHTML = '<span class="say"></span><span class="wait">📲 membaca grup…</span>';
  const aBub = new CSS2DObject(aBubEl); aBub.position.set(0, 2.22, 0); robot.add(aBub);
  tag(robot, 'aurix'); pickables.push(robot);
  people.set('aurix', { g: robot, ring: aRing, p: null, tagEl: aTagEl, bubEl: aBubEl, busy: false, talk: false, hot: false, said: 0, phase: 0 });

  /* ── more detail: blinds, lounge, TV, dispenser, printer, AC, art ── */
  // window blinds, half down: thin tilted slats that stripe the sunlight on the floor
  const slats = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(winW + 0.04, 0.006, 0.05)), std('slat', { color: '#F3F1EC', roughness: 0.5 }), 15);
  slats.castShadow = true; slats.receiveShadow = true;
  for (let i = 0; i < 15; i++) {
    tm.compose(V(winCx, WIN.y1 - 0.03 - i * 0.042, Z0 + 0.05), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.55), V(1, 1, 1));
    slats.setMatrixAt(i, tm);
  }
  scene.add(slats);
  box(winW + 0.1, 0.05, 0.07, M.frame, winCx, WIN.y1 + 0.02, Z0 + 0.05, 0.01);          // head rail

  // lounge corner (front left): rug, sofa, armchair, round coffee table, floor lamp
  const loungeRug = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.1, 1.9)), std('loungeRug', { map: canvasTex(512, 320, (g2, w, h) => {
    g2.fillStyle = '#D9CDB8'; g2.fillRect(0, 0, w, h);
    const r = rng(31); for (let k = 0; k < 7000; k++) { g2.fillStyle = `rgba(90,70,50,${r() * 0.06})`; g2.fillRect(r() * w, r() * h, 2, 2); }
    g2.strokeStyle = '#B9A88E'; g2.lineWidth = 10; g2.strokeRect(14, 14, w - 28, h - 28);
  }), roughness: 1 }));
  loungeRug.rotation.x = -Math.PI / 2; loungeRug.position.set(-2.85, 0.006, 3.1); loungeRug.receiveShadow = true; scene.add(loungeRug);
  const sofa = new THREE.Group(); sofa.position.set(-3.0, 0, 3.55); scene.add(sofa);   // faces -z
  box(2.0, 0.24, 0.82, M.sofa, 0, 0.2, 0, 0.06, sofa);
  for (const sx of [-0.48, 0.48]) box(0.94, 0.14, 0.7, M.cushion, sx, 0.38, -0.05, 0.06, sofa);
  box(2.0, 0.52, 0.2, M.sofa, 0, 0.58, 0.31, 0.08, sofa);
  for (const sx of [-0.48, 0.48]) box(0.9, 0.36, 0.14, M.cushion, sx, 0.6, 0.18, 0.07, sofa).rotation.x = -0.12;
  for (const sx of [-1.04, 1.04]) box(0.16, 0.5, 0.82, M.sofa, sx, 0.33, 0, 0.07, sofa);
  for (const [lx, lz] of [[-0.92, -0.32], [0.92, -0.32], [-0.92, 0.32], [0.92, 0.32]]) cyl(0.025, 0.02, 0.1, M.walnut, lx, 0.05, lz, 10, sofa);
  box(0.36, 0.3, 0.12, std('pillow', { color: '#C9A84C', roughness: 0.9 }), -0.72, 0.58, 0.12, 0.06, sofa).rotation.z = 0.15;
  const arm = new THREE.Group(); arm.position.set(-1.45, 0, 2.95); arm.rotation.y = Math.PI / 2; scene.add(arm);   // faces -x
  box(0.82, 0.26, 0.78, M.leather, 0, 0.22, 0, 0.07, arm);
  box(0.82, 0.48, 0.18, M.leather, 0, 0.58, 0.3, 0.08, arm);
  for (const sx of [-0.43, 0.43]) box(0.14, 0.42, 0.78, M.leather, sx, 0.33, 0, 0.06, arm);
  const ctab = new THREE.Group(); ctab.position.set(-2.85, 0, 2.75); scene.add(ctab);
  cyl(0.42, 0.42, 0.04, M.oak, 0, 0.42, 0, 40, ctab);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const leg = cyl(0.016, 0.016, 0.42, M.metalDark, Math.cos(a) * 0.26, 0.2, Math.sin(a) * 0.26, 8, ctab); leg.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18); }
  box(0.24, 0.02, 0.32, std('mag', { color: '#2F6F9F', roughness: 0.7 }), -0.1, 0.45, 0.05, 0.004, ctab).rotation.y = 0.4;
  cyl(0.05, 0.04, 0.09, mugMat('#F5F5F5'), 0.16, 0.485, -0.08, 16, ctab);
  const flamp = new THREE.Group(); flamp.position.set(-4.25, 0, 3.7); scene.add(flamp);
  cyl(0.16, 0.18, 0.03, M.black, 0, 0.015, 0, 24, flamp);
  cyl(0.012, 0.012, 1.55, M.black, 0, 0.8, 0, 8, flamp);
  cyl(0.16, 0.24, 0.3, std('shade', { color: '#F1E7D3', roughness: 0.9, emissive: '#FFD9A3', emissiveIntensity: daypart === 'night' ? 0.9 : 0.05, side: THREE.DoubleSide }), 0, 1.62, 0, 28, flamp).castShadow = false;
  if (daypart !== 'day') { const fl = new THREE.PointLight('#FFD3A1', daypart === 'night' ? 4 : 2, 4.5, 2); fl.position.set(0, 1.5, 0); flamp.add(fl); }

  // presentation TV on a stand at the west end of the meeting table
  const tv = new THREE.Group(); tv.position.set(2.05, 0, 1.36); tv.rotation.y = Math.PI / 2; scene.add(tv);   // faces +x
  box(0.6, 0.03, 0.42, M.metalDark, 0, 0.015, 0, 0.01, tv);
  box(0.06, 1.25, 0.06, M.metalDark, 0, 0.64, 0, 0.01, tv);
  box(1.3, 0.76, 0.05, M.black, 0, 1.3, 0.03, 0.015, tv);
  const tvScr = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.24, 0.7)), keep(new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff', emissiveIntensity: 0.9, emissiveMap: canvasTex(640, 360, (g2, w, h) => {
    g2.fillStyle = '#10131B'; g2.fillRect(0, 0, w, h);
    g2.fillStyle = '#C9A84C'; g2.font = 'bold 34px Inter, Arial, sans-serif'; g2.fillText('Weekly Meeting · HG', 30, 56);
    g2.fillStyle = 'rgba(255,255,255,.6)'; g2.font = '20px Inter, Arial, sans-serif'; ['Progres tugas tim', 'Jadwal minggu ini', 'Laporan Aurix'].forEach((t, i) => g2.fillText('•  ' + t, 34, 112 + i * 36));
    const r = rng(41); for (let i = 0; i < 7; i++) { const bh = 40 + r() * 140; g2.fillStyle = i % 2 ? '#25D366' : '#C9A84C'; g2.fillRect(360 + i * 36, 320 - bh, 24, bh); }
  }) })));
  tvScr.position.set(0, 1.3, 0.056); tv.add(tvScr);

  // water dispenser next to the coffee counter
  box(0.32, 1.0, 0.32, M.white, 2.6, 0.5, -3.8, 0.03);
  box(0.2, 0.12, 0.02, M.black, 2.6, 0.82, -3.635, 0.006);
  const bottle = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.13, 0.13, 0.42, 28)), keep(new THREE.MeshPhysicalMaterial({ color: '#7CC4F0', roughness: 0.05, transparent: true, opacity: 0.55 })));
  bottle.position.set(2.6, 1.22, -3.8); scene.add(bottle);

  // printer on a low cabinet beside the server rack
  box(0.72, 0.68, 0.5, M.white, -4.25, 0.34, -3.78, 0.02);
  box(0.52, 0.24, 0.42, std('printer', { color: '#D9DBE0', roughness: 0.45 }), -4.25, 0.8, -3.78, 0.03);
  box(0.36, 0.006, 0.16, M.shirtWhite, -4.25, 0.93, -3.62, 0.002);

  // air conditioner on the left wall
  box(0.24, 0.3, 0.95, M.white, X0 + 0.12, 2.55, -2.0, 0.05);
  box(0.02, 0.03, 0.8, M.black, X0 + 0.245, 2.45, -2.0, 0.006);

  // framed art above the bookshelf
  for (const [az, seed, pal] of [[2.35, 51, ['#C9A84C', '#1F3A4D', '#E8DCC2']], [3.25, 52, ['#2F6F9F', '#E07A5F', '#F4EFE6']]]) {
    box(0.03, 0.56, 0.72, M.black, X0 + 0.02, 2.36, az, 0.01);
    const art = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.64, 0.48)), keep(new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTex(320, 240, (g2, w, h) => {
      g2.fillStyle = pal[2]; g2.fillRect(0, 0, w, h);
      const r = rng(seed); for (let k = 0; k < 6; k++) { g2.fillStyle = pal[k % 2]; g2.globalAlpha = 0.75; g2.beginPath(); g2.arc(r() * w, r() * h, 20 + r() * 70, 0, Math.PI * 2); g2.fill(); }
      g2.globalAlpha = 1;
    }) })));
    art.rotation.y = Math.PI / 2; art.position.set(X0 + 0.04, 2.36, az); scene.add(art);
  }
  plant(-0.35, -3.65, 1.0, 7);   // by the window

  /* ── lights ── */
  const hemi = new THREE.HemisphereLight(daypart === 'night' ? '#38415E' : '#EAF2FF', daypart === 'night' ? '#2A2420' : '#B79A78', daypart === 'night' ? 0.55 : 1.1);
  scene.add(hemi);
  // soft "ceiling" light from above the open front: grounds everything with shadows
  const key = new THREE.DirectionalLight(daypart === 'night' ? '#FFE2BD' : '#FFF6EA', daypart === 'night' ? 0.9 : 1.5);
  key.position.set(5, 11, 7); key.target.position.set(0, 0, 0); scene.add(key, key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 7, bottom: -7, near: 2, far: 30 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025; key.shadow.radius = 4;
  // the sun, low behind the back wall: it only reaches the floor through the window
  if (daypart !== 'night') {
    const sun = new THREE.DirectionalLight(daypart === 'dusk' ? '#FFB27A' : '#FFF3DC', daypart === 'dusk' ? 2.2 : 3.0);
    sun.position.set(-4.2, 4.6, -13); sun.target.position.set(-1.2, 0, 0.5); scene.add(sun, sun.target);
    sun.castShadow = !mobile;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -6, near: 3, far: 32 });
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
    return a < 0.6 ? 29 : a < 0.75 ? 25 : a < 1.2 ? 20 : 17.5;   // a phone sees more of the room
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
  const el = renderer.domElement;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    const id = hit(e);
    if (id) onPick(id);
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
  let lastClock = 0, raf = 0, running = true;
  const t0 = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = (now - t0) / 1000;
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
      el.style.cursor = id ? 'pointer' : '';
    }
    if (now - lastClock > 20000) { clockNow(); lastClock = now; }
    for (const l of leds) l.mat.emissiveIntensity = reduced ? 2 : (Math.sin(t * l.speed + l.phase) > -0.2 ? 2.4 : 0.2);
    for (const [id, s] of people) {
      const on = s.hot || s.talk;
      const target = on ? 0.9 : s.busy ? 0.35 + 0.35 * Math.sin(t * 4) : 0;
      s.ring.material.opacity += (target - s.ring.material.opacity) * 0.15;
      if (reduced) continue;
      if (s.p) {
        s.p.torso.scale.y = 1 + Math.sin(t * 1.6 + s.phase) * 0.008;              // breathing
        s.p.head.rotation.y = Math.sin(t * 0.35 + s.phase) * 0.12;                // looking around a bit
        const typing = s.busy ? 1 : 0.15;
        s.p.arms[0].rotation.x = Math.sin(t * 13 + s.phase) * 0.08 * typing;
        s.p.arms[1].rotation.x = Math.sin(t * 13 + s.phase + 1.7) * 0.08 * typing;
        s.glow.material.opacity = s.busy ? 0.35 + 0.3 * Math.sin(t * 6) : 0;
        s.glow.position.y = DESK_TOP + 0.36 + (s.busy ? ((t * 0.35) % 1 - 0.5) * 0.32 : 0);
      } else { // Aurix
        robot.position.y = Math.sin(t * 1.4) * 0.008;
        rHead.rotation.z = Math.sin(t * 0.8) * 0.05 + (s.hot ? Math.sin(t * 6) * 0.06 : 0);
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
    s.tagEl.classList.toggle('hot', s.hot || s.talk);
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
