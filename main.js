// VISTA BAY — open world city game (Three.js)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ============================================================ CONSTANTS
const N = 8, CELL = 90, ROAD = 18, BLOCK = CELL - ROAD, HALF = N * CELL / 2, OFF = -HALF;
const BEACH_X0 = HALF + ROAD / 2;
const SHORE_X = BEACH_X0 + 110;          // sand begins to slope here
const WATERLINE = SHORE_X + 5.4;         // visual shoreline
const BOUNDS = { x0: -HALF - 70, x1: WATERLINE + 2, z0: -HALF - 70, z1: HALF + 70 };
const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const TIME_SPEED = 24 / 960;             // 16 minute day
const nodeP = i => OFF + i * CELL;
const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const wrapA = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261118);
const R = (a, b) => a + rnd() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));
const MR = (a, b) => a + Math.random() * (b - a);

// ============================================================ QUALITY / START
let QUALITY = isTouch ? 'medium' : 'high';
const qBtns = document.querySelectorAll('.quality button');
const setQ = q => { QUALITY = q; qBtns.forEach(b => b.classList.toggle('on', b.dataset.q === q)); };
qBtns.forEach(b => b.addEventListener('click', () => setQ(b.dataset.q)));
setQ(QUALITY);

$('playBtn').addEventListener('click', async () => {
  $('loading').style.display = 'block';
  try { if (isTouch && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) { }
  try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch (e) { }
  AudioSys.init();
  setTimeout(() => {
    init();
    $('start').style.display = 'none';
    $('hud').style.display = 'block'; document.body.classList.add('playing');
    if (isTouch) $('touch').style.display = 'block'; else $('cross').style.display = 'block';
    showBig('VISTA BAY', '#ffffff', 3, 'Sarı halkalar = görev · 🔫 Silah · 🔧 Garaj · 🚗 Galeri haritada');
    lastT = performance.now();
    requestAnimationFrame(loop);
  }, 30);
});

// ============================================================ GLOBALS
let renderer, scene, camera, composer, bloomPass, sunLight, hemi, sky, envScene, pmrem, envRT, stars, ocean;
let maxAniso = 4, envTimer = 99, lastT = 0;
const M = {};                 // shared materials
const cars = [], peds = [], blocks = [];
const state = {
  money: 0, shownMoney: 0, health: 100, armor: 0, heat: 0, wanted: 0, time: 16.4, inCar: null,
  mission: null, missionCooldown: 0, dead: false, deadTimer: 0, fireCd: 0, lastLookInput: 0,
  shake: 0, combo: 0, now: 0, crimeTimer: 0,
  weapon: 0, ammo: [Infinity, 150, 0, 0, 0], ownedW: [true, true, false, false, false], shopOpen: null, saveT: 0, interact: null, soundMode: 0, policeSee: false, crashHeatT: 0,
  props: {}, spawnProp: null, ach: {}, ledger: [], lastHour: null, waypoint: null, phoneOpen: false, phoneApp: 'home', contractOffers: [], shopZone: null,
  stats: { kills: 0, missions: 0, fails: 0, contracts: 0, earned: 0, spent: 0, dist: 0, topSpeed: 0, maxWanted: 0, jacked: 0, play: 0 }, rain: 0, rainTarget: 0, weatherT: 70, lightning: 0, radioOn: true
};
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

// ============================================================ TEXTURES
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  return t;
}
function speckle(g, w, h, count, colors, s0, s1, alpha = 1) {
  g.globalAlpha = alpha;
  for (let i = 0; i < count; i++) { g.fillStyle = pick(colors, rnd); const s = R(s0, s1); g.fillRect(rnd() * w, rnd() * h, s, s); }
  g.globalAlpha = 1;
}

function makeFacade(style) {
  const S = QUALITY === 'low' ? 256 : 512, k = S / 512, T = 64;
  const lit = Array.from({ length: 64 }, () => rnd() < (style === 'warehouse' ? 0.2 : 0.42)), floorDark = Array.from({ length: 8 }, () => rnd() < 0.2);
  const warm = ['#ffd9a0', '#ffe9c4', '#fff2dc', '#ffcf8a', '#eef2ff', '#ffe0b0'];
  const WR = { office: [10, 14, 44, 36], brick: [17, 15, 30, 34], deco: [8, 16, 48, 30], house: [20, 18, 24, 28], glass: [2, 2, 60, 52], warehouse: [4, 22, 56, 10] }[style];
  const has = (tx, ty) => style === 'house' ? tx % 2 === 0 : style === 'warehouse' ? ty === 6 : true;
  const tex = (fn, srgb = true) => canvasTex(S, S, g => { g.scale(k, k); fn(g); }, srgb);
  const glassFill = (g, x, y, w, h) => { const gr = g.createLinearGradient(x, y, x + w * 0.6, y + h); gr.addColorStop(0, '#5a7088'); gr.addColorStop(0.45, '#26364a'); gr.addColorStop(1, '#3a4c60'); g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x + w * 0.1, y, w * 0.12, h); };
  const albedo = tex(g => {
    if (style === 'glass') {
      g.fillStyle = '#c9ced4'; g.fillRect(0, 0, 512, 512);
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) { const x = tx * T, y = ty * T; glassFill(g, x + 2, y + 2, 60, 52); g.fillStyle = '#3a4048'; g.fillRect(x, y + 54, 64, 10); }
      return;
    }
    if (style === 'brick') {
      g.fillStyle = '#b5a898'; g.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y += 4) for (let x = -8; x < 512; x += 9) { g.fillStyle = pick(['#9a4a35', '#a5553d', '#8c3f2e', '#b0623f', '#934536', '#a04a30'], rnd); g.fillRect(x + ((y / 4) % 2) * 4, y, 8, 3); }
    } else if (style === 'warehouse') {
      g.fillStyle = '#b8bcc0'; g.fillRect(0, 0, 512, 512);
      for (let x = 0; x < 512; x += 6) { g.fillStyle = (x / 6) % 2 ? '#c8ccd0' : '#a6aaae'; g.fillRect(x, 0, 3, 512); }
      g.globalAlpha = 0.15; for (let i = 0; i < 30; i++) { g.fillStyle = '#6a4a30'; g.fillRect(rnd() * 512, rnd() * 512, R(2, 6), R(20, 90)); } g.globalAlpha = 1;
      for (const tx of [1, 5]) { const x = tx * 64 + 6; g.fillStyle = '#8a9096'; g.fillRect(x - 3, 446, 110, 66); g.fillStyle = '#d0d4d8'; g.fillRect(x, 450, 104, 62); g.fillStyle = '#a8acb0'; for (let y = 452; y < 512; y += 5) g.fillRect(x, y, 104, 1.5); }
    } else {
      g.fillStyle = style === 'office' ? '#d6d3cc' : style === 'deco' ? '#f4f1ea' : '#efe8dc'; g.fillRect(0, 0, 512, 512);
      speckle(g, 512, 512, 9000, style === 'office' ? ['#c8c4bb', '#e2dfd8', '#bdb8ae'] : ['#e8e2d8', '#faf8f2', '#e0d8cc'], 1, 3, 0.5);
      g.globalAlpha = 0.12; for (let i = 0; i < 20; i++) { g.fillStyle = '#5a5040'; g.fillRect(rnd() * 512, rnd() * 512, R(1, 3), R(20, 80)); } g.globalAlpha = 1;
    }
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      if (!has(tx, ty)) continue;
      const x = tx * T, y = ty * T, [wx, wy, ww, wh] = WR;
      if (style === 'office') { g.fillStyle = '#9d9a94'; g.fillRect(x + 8, y + 12, 48, 40); glassFill(g, x + wx, y + wy, ww, wh); g.fillStyle = '#8d8a84'; g.fillRect(x + 31, y + 14, 2, 36); g.fillStyle = '#b5b1a8'; g.fillRect(x + 6, y + 52, 52, 4); }
      else if (style === 'brick') { g.fillStyle = '#d8d0c0'; g.fillRect(x + 13, y + 9, 38, 5); g.fillRect(x + 14, y + 50, 36, 4); g.fillStyle = '#ece8e0'; g.fillRect(x + wx - 2, y + wy - 1, ww + 4, wh + 2); glassFill(g, x + wx + 1, y + wy + 1, ww - 2, wh - 2); g.fillStyle = '#ece8e0'; g.fillRect(x + 31, y + wy, 2, wh); g.fillRect(x + wx, y + wy + wh / 2, ww, 2); }
      else if (style === 'deco') { const gr = g.createLinearGradient(0, y + 6, 0, y + 16); gr.addColorStop(0, 'rgba(0,0,0,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, y + 6, 64, 10); g.fillStyle = '#d6d0c6'; g.fillRect(x + wx - 2, y + wy - 2, ww + 4, wh + 4); glassFill(g, x + wx, y + wy, ww, wh); g.fillStyle = '#e8e4dc'; g.fillRect(x + 31, y + wy, 2, wh); g.fillStyle = '#dcd6cc'; g.fillRect(x, y, 2, 64); }
      else if (style === 'house') { g.fillStyle = '#4c5e52'; g.fillRect(x + 11, y + wy, 8, wh); g.fillRect(x + 45, y + wy, 8, wh); g.fillStyle = '#fbfaf6'; g.fillRect(x + wx - 2, y + wy - 2, ww + 4, wh + 4); glassFill(g, x + wx, y + wy, ww, wh); g.fillStyle = '#fbfaf6'; g.fillRect(x + 31, y + wy, 2, wh); g.fillRect(x + wx, y + wy + wh / 2 - 1, ww, 2); g.fillStyle = '#d8d0c4'; g.fillRect(x + wx - 3, y + wy + wh + 2, ww + 6, 3); }
      else if (style === 'warehouse') { glassFill(g, x + wx, y + wy, ww, wh); }
    }
  });
  const orm = tex(g => {
    const base = { glass: 'rgb(0,120,60)', warehouse: 'rgb(0,140,150)', brick: 'rgb(0,240,0)' }[style] || 'rgb(0,225,0)';
    g.fillStyle = base; g.fillRect(0, 0, 512, 512);
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) { if (!has(tx, ty)) continue; const [wx, wy, ww, wh] = WR; g.fillStyle = 'rgb(0,16,200)'; g.fillRect(tx * T + wx, ty * T + wy, ww, wh); }
  }, false);
  const em = tex(g => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      if (!has(tx, ty) || !lit[ty * 8 + tx] || floorDark[ty]) continue;
      const x = tx * T, y = ty * T, [wx, wy, ww, wh] = WR;
      g.fillStyle = pick(warm, rnd); g.fillRect(x + wx, y + wy, ww, wh);
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + wx + R(0, ww * 0.6), y + wy, R(3, ww * 0.35), wh);
    }
  });
  return new THREE.MeshStandardMaterial({ map: albedo, roughnessMap: orm, metalnessMap: orm, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 1, metalness: 1 });
}
function makeTileTex() {
  return canvasTex(256, 256, g => {
    g.fillStyle = '#9a4a32'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) for (let x = -8; x < 256; x += 16) {
      const ox = (y / 16) % 2 ? 8 : 0, gr = g.createLinearGradient(x + ox, 0, x + ox + 16, 0);
      const base = pick(['#b8583a', '#c0643f', '#a84c34', '#b2603e', '#c86e48'], rnd);
      gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.5, base); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = base; g.fillRect(x + ox, y, 16, 15); g.fillStyle = gr; g.fillRect(x + ox, y, 16, 15);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + ox, y + 13, 16, 3);
    }
  });
}
function makeSignTex() {
  const bgs = ['#3a2418', '#1d5a2e', '#b8241c', '#20252c', '#c8a040', '#1a6a8a', '#0f2a4a', '#f4f0e6'];
  const fg = ['#f6e0b8', '#ffffff', '#ffffff', '#ff9a3a', '#2a1a0a', '#ffffff', '#e8c870', '#a8202a'];
  return canvasTex(512, 512, g => {
    SIGN_NAMES.forEach((n, i) => {
      const y = i * 64; g.fillStyle = bgs[i]; g.fillRect(0, y, 512, 64);
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3; g.strokeRect(6, y + 6, 500, 52);
      g.fillStyle = fg[i]; g.font = `bold ${n.length > 8 ? 36 : 44}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, 256, y + 34);
    });
  });
}

function makeRoadTex() {
  const S = 1024, k = S / CELL, r = ROAD / 2 * k;
  return canvasTex(S, S, g => {
    g.fillStyle = '#2a2b2f'; g.fillRect(0, 0, S, S);
    speckle(g, S, S, 26000, ['#35363b', '#222327', '#3d3e43', '#2f3034'], 1, 3);
    g.globalAlpha = 0.07;
    for (let i = 0; i < 40; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#555'; g.beginPath(); g.ellipse(rnd() * S, rnd() * S, R(10, 60), R(6, 30), rnd() * 3, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    const len0 = r + 6 * k, len1 = S - r - 6 * k;
    for (const e of [0, S]) {
      // double yellow center
      g.fillStyle = '#d8ae2a';
      for (const o of [-0.25, 0.25]) { g.fillRect(e + o * k - 0.08 * k, len0, 0.16 * k, len1 - len0); g.fillRect(len0, e + o * k - 0.08 * k, len1 - len0, 0.16 * k); }
      // dashed lane lines + edge lines
      g.fillStyle = '#e8e8e8';
      for (const o of [-4.5, 4.5]) for (let s = len0; s < len1; s += 9 * k) {
        g.fillRect(e + o * k - 0.07 * k, s, 0.14 * k, 3 * k); g.fillRect(s, e + o * k - 0.07 * k, 3 * k, 0.14 * k);
      }
      for (const o of [-(ROAD / 2 - 0.6), ROAD / 2 - 0.6]) { g.fillRect(e + o * k - 0.08 * k, len0 - 5 * k, 0.16 * k, len1 - len0 + 10 * k); g.fillRect(len0 - 5 * k, e + o * k - 0.08 * k, len1 - len0 + 10 * k, 0.16 * k); }
      // crosswalks + stop lines
      for (const y0 of [r + 1 * k, S - r - 4 * k]) {
        for (let sx = -r + 0.6 * k; sx < r - 0.6 * k; sx += 1.0 * k) { g.fillRect(e + sx, y0, 0.5 * k, 3 * k); g.fillRect(y0, e + sx, 3 * k, 0.5 * k); }
      }
      g.fillRect(e - r, r + 4.6 * k, r, 0.4 * k); g.fillRect(e, S - r - 5 * k, r, 0.4 * k);
      g.fillRect(S - r - 5 * k, e - r, 0.4 * k, r); g.fillRect(r + 4.6 * k, e, 0.4 * k, r);
    }
  });
}
const noiseTex = (base, cols, size = 256, n = 5000, s0 = 1, s1 = 4) => canvasTex(size, size, g => { g.fillStyle = base; g.fillRect(0, 0, size, size); speckle(g, size, size, n, cols, s0, s1); });
function makeSidewalkTex() {
  return canvasTex(256, 256, g => {
    g.fillStyle = '#aaa69e'; g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 5000, ['#b6b2aa', '#9c988f', '#a3a097'], 1, 3);
    g.fillStyle = '#7f7b74'; for (let i = 0; i <= 256; i += 128) { g.fillRect(i - 1, 0, 2, 256); g.fillRect(0, i - 1, 256, 2); }
  });
}
function makeLeafTex() {
  return canvasTex(256, 64, g => {
    g.clearRect(0, 0, 256, 64);
    g.strokeStyle = '#3d5a1c'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 32); g.lineTo(256, 32); g.stroke();
    for (let x = 6; x < 250; x += 5) {
      const l = 30 * Math.sin((x / 256) * Math.PI * 0.95 + 0.15);
      for (const s of [-1, 1]) {
        g.strokeStyle = rnd() < 0.5 ? '#4f7d22' : '#3f6b1a'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 10, 32 + s * l); g.stroke();
      }
    }
  });
}
const glowTex = () => canvasTex(128, 128, g => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const beamTex = () => canvasTex(16, 128, g => {
  const gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 128);
});
const cashTex = () => canvasTex(128, 128, g => {
  g.fillStyle = '#1e8a3a'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#2fd060'; g.fillRect(8, 8, 112, 112);
  g.fillStyle = '#0c4a1c'; g.font = 'bold 96px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 64, 70);
});

// ============================================================ GEOMETRY BUILDER
class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  face(cx, cy, cz, rx, ry, rz, ux, uy, uz, a, b, u0, v0, us, vs, col) {
    const nx = ry * uz - rz * uy, ny = rz * ux - rx * uz, nz = rx * uy - ry * ux;
    const C = [[-a, -b], [a, -b], [a, b], [-a, b]];
    const U = [[u0, v0], [u0 + 2 * a / us, v0], [u0 + 2 * a / us, v0 + 2 * b / vs], [u0, v0 + 2 * b / vs]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [sa, sb] = C[k];
      this.p.push(cx + rx * sa + ux * sb, cy + ry * sa + uy * sb, cz + rz * sa + uz * sb);
      this.n.push(nx, ny, nz); this.u.push(U[k][0], U[k][1]); this.c.push(col.r, col.g, col.b);
    }
  }
  box(top, cx, y0, cz, w, h, d, col, o = {}) {
    const us = o.us ?? 32, vs = o.vs ?? 32, uo = o.uo ?? 0, cy = y0 + h / 2, hw = w / 2, hd = d / 2, hh = h / 2, v0 = y0 / vs;
    this.face(cx + hw, cy, cz, 0, 0, -1, 0, 1, 0, hd, hh, uo, v0, us, vs, col);
    this.face(cx - hw, cy, cz, 0, 0, 1, 0, 1, 0, hd, hh, uo + 0.25, v0, us, vs, col);
    this.face(cx, cy, cz + hd, 1, 0, 0, 0, 1, 0, hw, hh, uo + 0.5, v0, us, vs, col);
    this.face(cx, cy, cz - hd, -1, 0, 0, 0, 1, 0, hw, hh, uo + 0.75, v0, us, vs, col);
    if (top) { const ts = o.ts ?? 8; top.face(cx, y0 + h, cz, 1, 0, 0, 0, 0, -1, hw, hd, (cx - hw) / ts, -(cz + hd) / ts, ts, ts, o.topCol ?? col); }
  }
  tri(P, n, U, col) { for (let k = 0; k < 3; k++) { this.p.push(...P[k]); this.n.push(...n); this.u.push(...U[k]); this.c.push(col.r, col.g, col.b); } }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); return g;
  }
}
function colorize(geo, hex) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}
const merge = list => mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g));

// ============================================================ INIT
function init() {
  renderer = new THREE.WebGLRenderer({ antialias: QUALITY === 'low', powerPreference: 'high-performance' });
  const dpr = Math.min(devicePixelRatio, QUALITY === 'high' ? 2 : QUALITY === 'medium' ? 1.3 : 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = QUALITY !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('game').appendChild(renderer.domElement);
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe0a080, 150, QUALITY === 'low' ? 600 : 900);
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 7000);

  if (QUALITY !== 'low') {
    const rt = new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, { type: THREE.HalfFloatType, samples: QUALITY === 'high' ? 4 : 0 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.25, 0.45, 0.95);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
  }

  // lights
  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3020, 0.6); scene.add(hemi);
  sunLight = new THREE.DirectionalLight(0xffffff, 3);
  sunLight.castShadow = QUALITY !== 'low';
  const sm = QUALITY === 'high' ? 2048 : 1024;
  sunLight.shadow.mapSize.set(sm, sm);
  const sc = sunLight.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 900;
  sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight, sunLight.target);
  M.flash = new THREE.PointLight(0xff9040, 0, 60, 1.6); scene.add(M.flash);
  M.headSpot = new THREE.SpotLight(0xfff2d8, 0, 70, 0.55, 0.5, 1.2); scene.add(M.headSpot, M.headSpot.target);

  // sky
  sky = new Sky(); sky.scale.setScalar(6000); scene.add(sky);
  const u = sky.material.uniforms; u.turbidity.value = 5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(500); envSky.material.uniforms = u; envScene.add(envSky);
  pmrem = new THREE.PMREMGenerator(renderer);
  // stars
  const sp = []; for (let i = 0; i < 1800; i++) { const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.48; sp.push(Math.cos(th) * Math.sin(ph + 0.05) * 3500, Math.cos(ph) * 3500, Math.sin(th) * Math.sin(ph + 0.05) * 3500); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);

  buildMaterials();
  buildGround();
  buildCity();
  buildOcean();
  buildProps();
  buildTreesAndStreet();
  buildClouds();
  buildWeather();
  buildMinimapBase();
  initFX();
  const save = loadGame(); if (!save) state.money = state.shownMoney = 1500;
  spawnPlayer();
  spawnTraffic();
  buildShops(save);
  buildProperties();
  if (state.spawnProp) { const [x, z] = spawnPoint(); player.pos.set(x, 0.25, z); }
  buildStarts();
  if (AudioSys.master) AudioSys.master.gain.value = state.soundMode === 2 ? 0 : 0.55;
  spawnPeds();
  spawnPickups();
  initInput();
  initPhone();
  updateSky(0);
  addEventListener('resize', onResize);
}
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
  FX.add.mat.uniforms.uScale.value = FX.norm.mat.uniforms.uScale.value = innerHeight * renderer.getPixelRatio() * 0.5;
}

// ============================================================ MATERIALS
function buildMaterials() {
  M.fac = {}; for (const st of ['office', 'glass', 'brick', 'deco', 'house', 'warehouse']) M.fac[st] = makeFacade(st);
  const concrete = noiseTex('#8a8a88', ['#7a7a78', '#999996', '#6e6e6c'], 256, 6000);
  M.roof = new THREE.MeshStandardMaterial({ map: concrete, vertexColors: true, roughness: 0.92 });
  M.tiles = new THREE.MeshStandardMaterial({ map: makeTileTex(), vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const st = makeSignTex(); M.sign = new THREE.MeshStandardMaterial({ map: st, emissiveMap: st, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
  M.rail = new THREE.MeshStandardMaterial({ color: 0xa8c0cc, transparent: true, opacity: 0.4, roughness: 0.05, metalness: 0.4, depthWrite: false });
  M.hedge = new THREE.MeshStandardMaterial({ map: noiseTex('#3f6a2a', ['#335a22', '#4a7a32', '#2a4a1c'], 128, 4000, 1, 4), roughness: 1 });
  M.pool = new THREE.MeshStandardMaterial({ color: 0x38c0d8, roughness: 0.04, metalness: 0.1, emissive: 0x0a3a48, emissiveIntensity: 0.4 });
  const aoTex = canvasTex(8, 64, g => { const gr = g.createLinearGradient(0, 64, 0, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, '#555'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 8, 64); }, false);
  aoTex.wrapT = THREE.ClampToEdgeWrapping;
  M.ao = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: aoTex, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const blobTex = canvasTex(64, 64, g => { const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.6, '#888'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false);
  M.blob = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  M.neon = new THREE.MeshBasicMaterial({ vertexColors: true });
  M.sidewalk = new THREE.MeshStandardMaterial({ map: makeSidewalkTex(), roughness: 0.9, color: 0xc4c0b8 });
  M.grass = new THREE.MeshStandardMaterial({ map: noiseTex('#4a7a34', ['#3f6e2c', '#5a8a3c', '#3a6326', '#62903f'], 256, 9000, 1, 3), roughness: 1 });
  M.sand = new THREE.MeshStandardMaterial({ map: noiseTex('#e2cfa0', ['#d6c08c', '#ecdcb4', '#cdb47e', '#f2e6c8'], 256, 9000, 1, 2), roughness: 1 });
  M.road = new THREE.MeshStandardMaterial({ map: makeRoadTex(), roughness: 0.82, metalness: 0.0 });
  M.human = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  M.trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  M.wheel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  M.carGlass = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.05, metalness: 0.95 });
  M.carLight = new THREE.MeshBasicMaterial({ vertexColors: true });
  M.sirenR = new THREE.MeshBasicMaterial({ color: 0xff1030 }); M.sirenB = new THREE.MeshBasicMaterial({ color: 0x1040ff });
  M.burnt = new THREE.MeshStandardMaterial({ color: 0x151312, roughness: 1 });
  M.paint = {};
}
const paintMat = hex => M.paint[hex] || (M.paint[hex] = new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }));

// ============================================================ GROUND
function buildGround() {
  const edge = HALF + ROAD / 2, big = 3000;
  const rg = new THREE.PlaneGeometry(edge * 2, edge * 2); rg.rotateX(-Math.PI / 2);
  const rp = rg.attributes.position, ru = rg.attributes.uv;
  for (let i = 0; i < ru.count; i++) ru.setXY(i, (rp.getX(i) + HALF) / CELL, (rp.getZ(i) + HALF) / CELL);
  const road = new THREE.Mesh(rg, M.road); road.receiveShadow = true; scene.add(road);
  M.grass.map.repeat.set(400, 400);
  const grassPlane = (x0, x1, z0, z1) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    const uv = g.attributes.uv; const pa = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 8, pa.getZ(i) / 8);
    return g;
  };
  M.grass.map.repeat.set(1, 1);
  const gg = merge([grassPlane(-big, -edge, -big, big), grassPlane(-edge, BEACH_X0, -big, -edge), grassPlane(-edge, BEACH_X0, edge, big)]);
  const grass = new THREE.Mesh(gg, M.grass); grass.receiveShadow = true; scene.add(grass);

  // sand with slope into sea
  const sx0 = BEACH_X0, sx1 = SHORE_X + 120, sz0 = -big, sz1 = big;
  const sgeo = new THREE.PlaneGeometry(sx1 - sx0, sz1 - sz0, 80, 1); sgeo.rotateX(-Math.PI / 2); sgeo.translate((sx0 + sx1) / 2, 0, 0);
  const sp = sgeo.attributes.position, suv = sgeo.attributes.uv;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i); sp.setY(i, sandHeight(x)); suv.setXY(i, x / 6, sp.getZ(i) / 6);
  }
  sgeo.computeVertexNormals();
  const sand = new THREE.Mesh(sgeo, M.sand); sand.receiveShadow = true; scene.add(sand);
}
function sandHeight(x) { return 0.03 - Math.max(0, x - SHORE_X) * 0.05; }

// ============================================================ CITY
const PARKS = new Set(['1,2', '5,1', '2,6', '6,5', '3,3', '0,5']);
const DEALER = [6, 2], GUNSHOP = [3, 5];
const PALMS = [], TREES = [];
function district(i, j) {
  const cd = Math.hypot(i - (N - 1) / 2, j - (N - 1) / 2);
  if (PARKS.has(i + ',' + j)) return 'park';
  if (i === DEALER[0] && j === DEALER[1]) return 'dealer';
  if (i === N - 1) return 'beach';
  if (cd < 1.6) return 'downtown';
  if (i <= 1) return 'residential';
  if (j === N - 1) return 'industrial';
  if (cd < 2.6) return 'midtown';
  return 'mixed';
}
const SIGN_NAMES = ['CAFE', 'MARKET', 'PIZZA', 'BAR & GRILL', 'DINER', 'PHARMACY', 'BANK', 'HOTEL'];
function buildCity() {
  const C_DECO = ['#f3e3d3', '#e8d2c4', '#d8e6e4', '#f0e6c8', '#e6dcea', '#ffffff', '#e9d7c0', '#f6dcd0'];
  const C_OFFICE = ['#d8d4cc', '#c8c2b8', '#b4b8bc', '#e6e1d6', '#cfc6b4', '#bfb6a8'];
  const C_BRICK = ['#ffffff', '#f0e6e0', '#e8dcd0', '#d8c8c0', '#c8b8b0'];
  const C_GLASS = ['#a6c0d4', '#8aa6bc', '#b8ccd6', '#9cb4ac', '#a8aebc', '#c4c0b4'];
  const C_HOUSE = ['#f5efe4', '#e9dcc8', '#dfe8ec', '#f0e0d0', '#e4ead8', '#fff8ee', '#e8d8d0', '#dcd4e4'];
  const C_ROOFT = ['#ffffff', '#e0c8b8', '#9a9a9a', '#7a6a60', '#c0a090', '#8a7a6a'];
  const C_WARE = ['#ffffff', '#d8dde2', '#e2d6c0', '#c0ccd8', '#d0c8b8'];
  const C_CONT = ['#b8402a', '#2a5a9a', '#3a7a4a', '#d08a2a', '#7a7a80', '#8a2a3a', '#e0e0e0'];
  const roofC = ['#8a8a8e', '#7a7d82', '#97948e', '#6f7277'];
  const chunks = {};
  const chunk = (i, j) => {
    const k = (i >> 1) + ',' + (j >> 1);
    if (!chunks[k]) { const o = {}; chunks[k] = { get: m => o[m] || (o[m] = new GB()), o }; }
    return chunks[k];
  };
  const sideGB = new GB(), grassGB = new GB(), aoGB = new GB(), hedgeGB = new GB(), poolGB = new GB();
  const white = new THREE.Color(1, 1, 1), col = h => new THREE.Color(h);
  const aoRect = (x, z, w, d, y) => {
    const W = 2.6, yy = y + 0.015, k = new THREE.Color(1, 1, 1);
    for (const [ox, oz, dx, dz, len] of [[0, d / 2, 0, 1, w], [0, -d / 2, 0, -1, w], [w / 2, 0, 1, 0, d], [-w / 2, 0, -1, 0, d]])
      aoGB.face(x + ox + dx * W / 2, yy, z + oz + dz * W / 2, -dz, 0, dx, dx, 0, dz, len / 2 + W * 0.5, W / 2, 0, 0, 1, W, k);
  };
  // shop sign on a facade side: 0:+z 1:-z 2:+x 3:-x
  const sign = (C, x, y, z, w, d, side, len, idx, hgt = 1.2) => {
    const g = C.get('sign'), off = 0.28;
    const P = [[x, y, z + d / 2 + off, 1, 0, 0], [x, y, z - d / 2 - off, -1, 0, 0], [x + w / 2 + off, y, z, 0, 0, -1], [x - w / 2 - off, y, z, 0, 0, 1]][side];
    g.face(P[0], P[1], P[2], P[3], P[4], P[5], 0, 1, 0, len / 2, hgt / 2, 0, 1 - (idx + 1) / 8, len, hgt * 8, white);
  };
  const addBuilding = (b, C, x, z, w, d, h, style, tint, o = {}) => {
    const y0 = o.y0 ?? 0.25, uo = RI(0, 7) / 8, rc = col(pick(roofC, rnd)), c = col(tint);
    C.get(style).box(C.get('roof'), x, y0, z, w, h, d, c, { uo, topCol: rc });
    b.bld.push({ x0: x - w / 2 - 0.3, x1: x + w / 2 + 0.3, z0: z - d / 2 - 0.3, z1: z + d / 2 + 0.3, h: y0 + h });
    aoRect(x, z, w, d, y0);
    let top = y0 + h;
    const floors = Math.floor(h / 4);
    if (o.store) {
      C.get('glass').box(null, x, y0, z, w + 0.4, 3.6, d + 0.4, col('#9aa6b4'), { us: 32, vs: 32 });
      C.get('roof').box(null, x, y0 + 3.6, z, w + 0.9, 0.3, d + 0.9, c);
      const side = RI(0, 3), len = Math.min((side < 2 ? w : d) * 0.6, 7);
      sign(C, x, y0 + 4.5, z, w, d, side, len, RI(0, 6));
    }
    if (o.eyebrow) for (let f = 0; f < floors; f++) C.get('roof').box(null, x, y0 + f * 4 + 3.35, z, w + 1.0, 0.16, d + 1.0, col('#f8f6f2'));
    if (o.balcony && floors > 2) for (let f = 1; f < floors; f++) for (const s of [1, -1]) {
      C.get('roof').box(null, x, y0 + f * 4 - 0.1, z + s * (d / 2 + 0.6), w * 0.86, 0.18, 1.2, col('#e8e4dc'));
      C.get('rail').box(null, x, y0 + f * 4 + 0.08, z + s * (d / 2 + 1.17), w * 0.86, 0.95, 0.05, white);
    }
    if (!o.noParapet) {
      const p = C.get('roof'), t = 0.3, ph = 0.9;
      p.box(null, x, top, z + d / 2 - t / 2, w, ph, t, c); p.box(null, x, top, z - d / 2 + t / 2, w, ph, t, c);
      p.box(null, x + w / 2 - t / 2, top, z, t, ph, d, c); p.box(null, x - w / 2 + t / 2, top, z, t, ph, d, c);
    }
    if (h > 50 && rnd() < 0.7) {
      const w2 = Math.max(8, Math.round(w * R(0.55, 0.8) / 4) * 4), d2 = Math.max(8, Math.round(d * R(0.55, 0.8) / 4) * 4), h2 = Math.round(h * R(0.15, 0.35) / 4) * 4;
      C.get(style).box(C.get('roof'), x, top, z, w2, h2, d2, c, { uo, topCol: rc });
      b.bld.push({ x0: x - w2 / 2, x1: x + w2 / 2, z0: z - d2 / 2, z1: z + d2 / 2, h: top + h2 });
      top += h2;
      if (rnd() < 0.6) C.get('roof').box(null, x, top, z, 0.6, R(8, 20), 0.6, col('#888'));
    }
    for (let k = 0; k < RI(1, 4); k++) C.get('roof').box(C.get('roof'), x + R(-w / 3, w / 3), y0 + h, z + R(-d / 3, d / 3), R(1.5, 4), R(1, 2.5), R(1.5, 4), col(pick(['#a0a0a0', '#8c8f94', '#b8b4ac'], rnd)), { us: 4, vs: 4 });
    return top;
  };
  const addHouse = (b, C, x, z, w, d, floors, tint, roofTint) => {
    const y0 = 0.31, h = floors * 4, c = col(tint), rc = col(roofTint);
    C.get('house').box(null, x, y0, z, w, h, d, c, { uo: RI(0, 7) / 8 });
    b.bld.push({ x0: x - w / 2 - 0.2, x1: x + w / 2 + 0.2, z0: z - d / 2 - 0.2, z1: z + d / 2 + 0.2, h: y0 + h + d * 0.4 });
    aoRect(x, z, w, d, y0);
    const o = 0.6, rh = d * 0.36, yE = y0 + h, half = d / 2 + o, sl = Math.hypot(half, rh), uy = rh / sl, uz = half / sl;
    const rg = C.get('tiles');
    rg.face(x, yE + rh / 2 - uy * 0.0, z + half / 2, 1, 0, 0, 0, uy, -uz, w / 2 + o, sl / 2, 0, 0, 4, 4, rc);
    rg.face(x, yE + rh / 2, z - half / 2, -1, 0, 0, 0, uy, uz, w / 2 + o, sl / 2, 0, 0, 4, 4, rc);
    const hg = C.get('house');
    for (const sx of [1, -1]) {
      const X = x + sx * w / 2;
      const P = sx > 0 ? [[X, yE, z + d / 2], [X, yE, z - d / 2], [X, yE + rh, z]] : [[X, yE, z - d / 2], [X, yE, z + d / 2], [X, yE + rh, z]];
      hg.tri(P, [sx, 0, 0], P.map(p => [-sx * p[2] / 32, p[1] / 32]), c);
    }
    C.get('roof').box(null, x + w * 0.22, y0, z + d / 2 + 0.03, 1.1, 2.3, 0.12, col('#6a4a30'));
    if (rnd() < 0.5) C.get('roof').box(C.get('roof'), x - w * 0.3, yE, z - d * 0.15, 0.8, rh + 1.2, 0.8, col('#a08070'));
    if (rnd() < 0.5) C.get('roof').box(null, x, y0, z + d / 2 + 1.6, 2.6, 0.04, 3.2, col('#c8c4bc'));
  };

  for (let i = 0; i < N; i++) {
    blocks[i] = [];
    for (let j = 0; j < N; j++) {
      const cx = nodeP(i) + CELL / 2, cz = nodeP(j) + CELL / 2, dist = district(i, j);
      const b = { i, j, cx, cz, park: dist === 'park', dist, bld: [] };
      blocks[i][j] = b;
      sideGB.box(sideGB, cx, 0, cz, BLOCK, 0.25, BLOCK, white, { us: 4, vs: 4, ts: 4 });
      const C = chunk(i, j);
      if (dist === 'park') {
        grassGB.box(grassGB, cx, 0.25, cz, BLOCK - 8, 0.06, BLOCK - 8, white, { us: 8, vs: 8, ts: 8 });
        for (let k = 0; k < 10; k++) (rnd() < 0.5 ? PALMS : TREES).push([cx + R(-28, 28), 0.31, cz + R(-28, 28)]);
        continue;
      }
      if (dist === 'residential') {
        grassGB.box(grassGB, cx, 0.25, cz, BLOCK - 8, 0.06, BLOCK - 8, white, { us: 8, vs: 8, ts: 8 });
        const L = 64 / 3;
        for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
          const lx = cx - 32 + L * (a + 0.5), lz = cz - 32 + L * (c + 0.5);
          if (a === 1 && c === 1) { // shared pool / garden
            poolGB.box(poolGB, lx, 0.25, lz, 9, 0.08, 5, white);
            C.get('roof').box(null, lx, 0.25, lz, 11, 0.07, 7, col('#e8e2d6'));
            PALMS.push([lx + 6, 0.31, lz + 4], [lx - 6, 0.31, lz - 4]);
            continue;
          }
          const w = RI(10, 13), d = RI(8, 10);
          addHouse(b, C, lx + R(-1, 1), lz - 1.5, w, d, rnd() < 0.35 ? 2 : 1, pick(C_HOUSE, rnd), pick(C_ROOFT, rnd));
          (rnd() < 0.55 ? TREES : PALMS).push([lx + R(-8, 8), 0.31, lz + R(5, 8)]);
        }
        for (let k = 1; k < 3; k++) { hedgeGB.box(hedgeGB, cx - 32 + L * k, 0.31, cz, 0.8, 1.1, 62, white, { us: 2, vs: 2, ts: 2 }); hedgeGB.box(hedgeGB, cx, 0.31, cz - 32 + L * k, 62, 1.1, 0.8, white, { us: 2, vs: 2, ts: 2 }); }
        continue;
      }
      if (dist === 'dealer') {
        addBuilding(b, C, cx, cz - 20, 48, 18, 8, 'glass', '#d8e4ec', { noParapet: true });
        continue;
      }
      if (dist === 'industrial') {
        addBuilding(b, C, cx + R(-4, 4), cz - 14, RI(10, 12) * 4, RI(6, 7) * 4, RI(2, 4) * 4, 'warehouse', pick(C_WARE, rnd), { noParapet: rnd() < 0.5 });
        for (let k = 0; k < RI(4, 8); k++) {
          const x = cx + R(-26, 26), z = cz + R(10, 26), rot = rnd() < 0.5, w = rot ? 2.44 : 6.1, dd = rot ? 6.1 : 2.44, stack = RI(1, 3);
          for (let s = 0; s < stack; s++) C.get('warehouse').box(C.get('warehouse'), x, 0.25 + s * 2.6, z, w, 2.6, dd, col(pick(C_CONT, rnd)), { us: 8, vs: 8 });
          b.bld.push({ x0: x - w / 2, x1: x + w / 2, z0: z - dd / 2, z1: z + dd / 2, h: 0.25 + stack * 2.6 });
          aoRect(x, z, w, dd, 0.25);
        }
        continue;
      }
      if (dist === 'downtown') {
        if (rnd() < 0.55) addBuilding(b, C, cx, cz, RI(9, 12) * 4, RI(9, 12) * 4, RI(24, 44) * 4, rnd() < 0.75 ? 'glass' : 'office', pick(C_GLASS, rnd), { store: rnd() < 0.5 });
        else for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const st = rnd() < 0.55 ? 'glass' : 'office';
          addBuilding(b, C, cx + ox * 16, cz + oz * 16, RI(5, 7) * 4, RI(5, 7) * 4, RI(12, 32) * 4, st, pick(st === 'glass' ? C_GLASS : C_OFFICE, rnd), { store: true });
        }
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) TREES.push([cx + sx * (BLOCK / 2 - 2), 0.25, cz + sz * 18]);
        continue;
      }
      if (dist === 'beach') {
        for (const oz of [-1, 1]) {
          const w = RI(6, 7) * 4, d = RI(6, 7) * 4, h = RI(4, 12) * 4, x = cx + R(-4, 4), z = cz + oz * 16;
          const top = addBuilding(b, C, x, z, w, d, h, 'deco', pick(C_DECO, rnd), { store: true, eyebrow: true, balcony: rnd() < 0.5 });
          sign(C, x, top - 2.2, z, w, d, 2, Math.min(10, d * 0.6), 7, 2);
        }
        for (const sz of [-1, 0, 1]) PALMS.push([cx + BLOCK / 2 - 1.5, 0.25, cz + sz * 22]);
        continue;
      }
      // midtown & mixed
      const mid = dist === 'midtown', m = mid ? 2 : (rnd() < 0.5 ? 2 : 3), L = 64 / m;
      for (let a = 0; a < m; a++) for (let c = 0; c < m; c++) {
        if (m === 3 && a === 1 && c === 1) continue;
        const w = Math.max(8, Math.floor(L * R(0.62, 0.9) / 4) * 4), d = Math.max(8, Math.floor(L * R(0.62, 0.9) / 4) * 4);
        const x = cx - 32 + L * (a + 0.5) + R(-1, 1) * (L - w) * 0.3, z = cz - 32 + L * (c + 0.5) + R(-1, 1) * (L - d) * 0.3;
        const h = mid ? RI(5, 16) * 4 : RI(2, 6) * 4;
        const r = rnd(), st = mid ? (r < 0.4 ? 'brick' : r < 0.75 ? 'office' : 'glass') : (r < 0.4 ? 'deco' : r < 0.8 ? 'brick' : 'office');
        const tint = st === 'glass' ? C_GLASS : st === 'brick' ? C_BRICK : st === 'deco' ? C_DECO : C_OFFICE;
        addBuilding(b, C, x, z, w, d, h, st, pick(tint, rnd), { store: st !== 'glass' || rnd() < 0.5, eyebrow: st === 'deco', balcony: (st === 'brick' || st === 'deco') && rnd() < 0.5 });
      }
      for (const s of [-1, 1]) (mid ? TREES : PALMS).push([cx + s * 20, 0.25, cz + BLOCK / 2 - 1.6], [cx + s * 20, 0.25, cz - BLOCK / 2 + 1.6]);
    }
  }
  const sh = QUALITY !== 'low';
  const add = (gb, mat, cast = true, recv = true) => { if (!gb.p.length) return; const m = new THREE.Mesh(gb.geometry(), mat); m.castShadow = sh && cast; m.receiveShadow = sh && recv; scene.add(m); return m; };
  add(sideGB, M.sidewalk, false); add(grassGB, M.grass, false); add(hedgeGB, M.hedge); add(poolGB, M.pool, false);
  const ao = add(aoGB, M.ao, false, false); if (ao) ao.renderOrder = 1;
  for (const k in chunks) for (const m in chunks[k].o) add(chunks[k].o[m], M.fac[m] || M[m], m !== 'sign' && m !== 'rail', m !== 'rail');
}

// ============================================================ OCEAN
function buildOcean() {
  const geo = new THREE.PlaneGeometry(3200, 6000, 160, 160); geo.rotateX(-Math.PI / 2); geo.translate(SHORE_X - 10 + 1600, -0.25, 0);
  ocean = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(1, 0.2, 0) }, uSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
      uHorizon: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() }, uFogNear: { value: 150 }, uFogFar: { value: 900 }, uShore: { value: WATERLINE }, uDay: { value: 1 }
    },
    vertexShader: `uniform float uTime; uniform float uShore; varying vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0);
        float k = smoothstep(uShore, uShore+40.0, w.x);
        w.y += k*(sin(w.x*0.045+uTime*0.8)*0.35 + sin(w.z*0.06-uTime*0.6+w.x*0.02)*0.25 + sin((w.x+w.z)*0.1+uTime*1.3)*0.12);
        vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime, uFogNear, uFogFar, uShore, uDay; uniform vec3 uSunDir, uSunCol, uHorizon, uZenith, uDeep, uShallow, uFogColor; varying vec3 vW;
      void addW(inout vec2 g, vec2 p, vec2 d, float f, float a, float s){ float ph = dot(d,p)*f + uTime*s; g += d*(a*f*cos(ph)); }
      void main(){
        vec2 p = vW.xz, g = vec2(0.0);
        addW(g,p,normalize(vec2(1.0,0.3)),0.045,0.35,0.8); addW(g,p,normalize(vec2(0.2,1.0)),0.06,0.25,0.6);
        addW(g,p,normalize(vec2(0.7,0.7)),0.1,0.12,1.3); addW(g,p,normalize(vec2(-0.6,1.0)),0.37,0.05,2.1);
        addW(g,p,normalize(vec2(1.0,-0.4)),0.71,0.03,2.7); addW(g,p,normalize(vec2(0.3,-1.0)),1.31,0.014,3.3);
        addW(g,p,normalize(vec2(-1.0,-0.2)),2.3,0.008,4.1); addW(g,p,normalize(vec2(0.8,0.5)),3.9,0.004,5.3);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98*pow(1.0 - max(dot(n,v),0.0), 5.0);
        vec3 r = reflect(-v, n); r.y = abs(r.y);
        vec3 skyc = mix(uHorizon, uZenith, pow(clamp(r.y,0.0,1.0),0.5));
        float sd = max(dot(r, uSunDir), 0.0);
        vec3 spec = uSunCol*(pow(sd, 600.0)*30.0 + pow(sd, 60.0)*0.8);
        float depth = clamp((vW.x - uShore)/80.0, 0.0, 1.0);
        vec3 water = mix(uShallow, uDeep, depth);
        vec3 col = mix(water, skyc, clamp(fres,0.0,1.0)) + spec;
        float foam = smoothstep(7.0, 0.0, vW.x - uShore) * (0.55 + 0.45*sin(vW.z*0.25 + uTime*1.7 + sin(vW.z*0.04)*5.0));
        col = mix(col, vec3(0.92)*(0.15+0.85*uDay), clamp(foam,0.0,1.0)*0.7);
        float fd = length(cameraPosition - vW);
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar*1.6, fd));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  scene.add(ocean);
}

// ============================================================ PROPS (palms, lamps, umbrellas, ramps)
const ramps = [];
function buildProps() {
  // ---- palm tree geometry
  const trunk = new THREE.CylinderGeometry(0.17, 0.3, 9, 7, 8, true); trunk.translate(0, 4.5, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.pow(y / 9, 2) * 1.3); tp.setX(i, tp.getX(i) * (1 + 0.06 * Math.sin(y * 6))); }
  trunk.computeVertexNormals();
  const fronds = [];
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * Math.PI * 2 + rnd() * 0.3, L = R(3.8, 4.8), segs = 6, pos = [], uv = [], idx = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, cx = Math.cos(a) * t * L, cz = Math.sin(a) * t * L, y = 0.9 * t - 2.2 * t * t;
      const wx = -Math.sin(a) * 0.75, wz = Math.cos(a) * 0.75;
      pos.push(cx - wx, y - 0.15 * t, cz - wz, cx + wx, y - 0.15 * t, cz + wz);
      uv.push(t, 0, t, 1);
      if (s < segs) { const b = s * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    g.translate(1.3, 9, 0); fronds.push(g);
  }
  const frondGeo = mergeGeometries(fronds);
  const palms = [];
  const addPalm = (x, z) => palms.push([x, z, rnd() * Math.PI * 2, R(0.8, 1.25)]);
  for (let z = -HALF - 200; z < HALF + 200; z += R(11, 17)) addPalm(BEACH_X0 + R(6, 10), z), rnd() < 0.5 && addPalm(SHORE_X - R(10, 40), z + R(-4, 4));
  for (const [x, , z] of PALMS) addPalm(x, z);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b6b4a, roughness: 1, map: noiseTex('#8b6b4a', ['#6f5236', '#a08058'], 64, 400, 1, 6) });
  const leafMat = new THREE.MeshStandardMaterial({ map: makeLeafTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  const tI = new THREE.InstancedMesh(trunk, trunkMat, palms.length), fI = new THREE.InstancedMesh(frondGeo, leafMat, palms.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  palms.forEach(([x, z, r, s], i) => {
    const bb = blockAt(x, z), y = x > SHORE_X ? sandHeight(x) : (bb ? (bb.park || bb.dist === 'residential' ? 0.31 : 0.25) : 0.02);
    m4.compose(ps.set(x, y, z), q.setFromAxisAngle(up, r), sc.set(s, s, s)); tI.setMatrixAt(i, m4); fI.setMatrixAt(i, m4);
  });
  const sh = QUALITY !== 'low';
  tI.castShadow = fI.castShadow = sh; scene.add(tI, fI);

  // ---- street lamps + light pools
  const pole = merge([new THREE.CylinderGeometry(0.09, 0.14, 8, 6).translate(0, 4, 0), new THREE.BoxGeometry(0.12, 0.12, 2.4).translate(0, 7.9, 1.1)]);
  const head = new THREE.BoxGeometry(0.5, 0.15, 0.9).translate(0, 7.8, 2.2);
  const lamps = [];
  for (const row of blocks) for (const b of row) {
    const e = BLOCK / 2 - 1;
    for (const f of [-0.5, 0.5]) {
      lamps.push([b.cx + f * BLOCK * 0.9 / 1.8 * 1.6, b.cz - e, Math.PI], [b.cx + f * BLOCK * 0.8, b.cz + e, 0]);
      lamps.push([b.cx - e, b.cz + f * BLOCK * 0.8, -Math.PI / 2], [b.cx + e, b.cz + f * BLOCK * 0.8, Math.PI / 2]);
    }
  }
  M.lampHead = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
  M.pool = new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const poolGeo = new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2);
  const pI = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.4 }), lamps.length);
  const hI = new THREE.InstancedMesh(head, M.lampHead, lamps.length), gI = new THREE.InstancedMesh(poolGeo, M.pool, lamps.length);
  lamps.forEach(([x, z, r], i) => {
    m4.compose(ps.set(x, 0.25, z), q.setFromAxisAngle(up, r), sc.set(1, 1, 1)); pI.setMatrixAt(i, m4); hI.setMatrixAt(i, m4);
    m4.compose(ps.set(x + Math.sin(r) * 2.6, 0.05, z + Math.cos(r) * 2.6), q.identity(), sc.set(1, 1, 1)); gI.setMatrixAt(i, m4);
  });
  pI.castShadow = sh; scene.add(pI, hI, gI);

  // ---- beach umbrellas & loungers
  const umb = [];
  for (let z = -HALF; z < HALF; z += R(10, 18)) umb.push([R(SHORE_X - 70, SHORE_X - 15), z + R(-3, 3)]);
  const uPole = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5).translate(0, 1.3, 0);
  const uTop = new THREE.ConeGeometry(1.6, 0.6, 8, 1, true).translate(0, 2.6, 0);
  const upI = new THREE.InstancedMesh(uPole, new THREE.MeshStandardMaterial({ color: 0xdddddd }), umb.length);
  const utI = new THREE.InstancedMesh(uTop, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), umb.length);
  const uCols = ['#ff4f6d', '#2ec4d6', '#ffd23a', '#ffffff', '#8a5cff', '#ff8a3d'];
  umb.forEach(([x, z], i) => { m4.compose(ps.set(x, 0, z), q.setFromAxisAngle(up, rnd() * 6), sc.set(1, 1, 1)); upI.setMatrixAt(i, m4); utI.setMatrixAt(i, m4); utI.setColorAt(i, new THREE.Color(pick(uCols, rnd))); });
  upI.castShadow = utI.castShadow = sh; scene.add(upI, utI);

  // ---- stunt ramps on the beach
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xb08850, roughness: 0.8, map: noiseTex('#a88450', ['#8a6a3a', '#c09a60'], 128, 1500, 1, 8) });
  const stripe = new THREE.MeshBasicMaterial({ color: 0xff2a8a });
  for (const [x, z, dir] of [[BEACH_X0 + 45, -150, 1], [BEACH_X0 + 45, 120, -1], [BEACH_X0 + 70, -20, 1], [BEACH_X0 + 30, 260, -1]]) {
    const len = 14, h = 3.2, w = 7;
    const sh2 = new THREE.Shape(); sh2.moveTo(0, 0); sh2.lineTo(len, h); sh2.lineTo(len, 0); sh2.closePath();
    const g = new THREE.ExtrudeGeometry(sh2, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2);
    const mesh = new THREE.Mesh(g, rampMat);
    mesh.position.set(x, 0, z); mesh.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2; mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, w + 0.02), stripe); st.position.set(len - 0.2, h, 0); mesh.add(st);
    // ramp runs along -z*dir... compute: local +x after rotation
    const fx = Math.sin(mesh.rotation.y + Math.PI / 2), fz = Math.cos(mesh.rotation.y + Math.PI / 2);
    ramps.push({ x, z, fx, fz, len, h, w });
  }
}
function rampHeight(x, z) {
  let best = -1;
  for (const r of ramps) {
    const dx = x - r.x, dz = z - r.z, a = dx * r.fx + dz * r.fz, l = Math.abs(dx * -r.fz + dz * r.fx);
    if (a >= 0 && a <= r.len && l <= r.w / 2) best = Math.max(best, a / r.len * r.h);
  }
  return best;
}

// ============================================================ WORLD QUERIES
function blockAt(x, z) {
  const i = Math.floor((x - OFF) / CELL), j = Math.floor((z - OFF) / CELL);
  if (i < 0 || j < 0 || i >= N || j >= N) return null;
  const b = blocks[i][j];
  return (Math.abs(x - b.cx) <= BLOCK / 2 && Math.abs(z - b.cz) <= BLOCK / 2) ? b : null;
}
function groundY(x, z) {
  let g = x > SHORE_X ? sandHeight(x) : (blockAt(x, z) ? 0.25 : 0);
  if (x > BEACH_X0) { const r = rampHeight(x, z); if (r > g) g = r; }
  return g;
}
const hitRes = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
function collide(x, z, r, y = 0) {
  hitRes.hit = false; hitRes.nx = hitRes.nz = 0;
  const i0 = Math.floor((x - r - OFF) / CELL), i1 = Math.floor((x + r - OFF) / CELL), j0 = Math.floor((z - r - OFF) / CELL), j1 = Math.floor((z + r - OFF) / CELL);
  for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) {
    for (const b of blocks[i][j].bld) {
      if (y > b.h) continue;
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
      let dx = x - cx, dz = z - cz; const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); dx /= d; dz /= d; x = cx + dx * r; z = cz + dz * r; }
      else { // inside: push via min axis
        const l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bb = b.z1 - z, m = Math.min(l, rr, t, bb);
        if (m === l) { dx = -1; dz = 0; x = b.x0 - r; } else if (m === rr) { dx = 1; dz = 0; x = b.x1 + r; } else if (m === t) { dx = 0; dz = -1; z = b.z0 - r; } else { dx = 0; dz = 1; z = b.z1 + r; }
      }
      hitRes.hit = true; hitRes.nx += dx; hitRes.nz += dz;
    }
  }
  // world bounds
  if (x < BOUNDS.x0) { x = BOUNDS.x0; hitRes.hit = true; hitRes.nx += 1; } if (x > BOUNDS.x1) { x = BOUNDS.x1; hitRes.hit = true; hitRes.nx -= 1; }
  if (z < BOUNDS.z0) { z = BOUNDS.z0; hitRes.hit = true; hitRes.nz += 1; } if (z > BOUNDS.z1) { z = BOUNDS.z1; hitRes.hit = true; hitRes.nz -= 1; }
  const nl = Math.hypot(hitRes.nx, hitRes.nz) || 1; hitRes.nx /= nl; hitRes.nz /= nl;
  hitRes.x = x; hitRes.z = z; return hitRes;
}
function insideBuilding(x, y, z) {
  const b = blockAt(x, z); if (!b) return false;
  for (const o of b.bld) if (y < o.h && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) return true;
  return false;
}
function los(ax, ay, az, bx, by, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 2.5);
  for (let k = 1; k < n; k++) { const t = k / n; if (insideBuilding(lerp(ax, bx, t), lerp(ay, by, t), lerp(az, bz, t))) return false; }
  return true;
}
const nearestNode = (x, z) => [clamp(Math.round((x - OFF) / CELL), 0, N), clamp(Math.round((z - OFF) / CELL), 0, N)];

// ============================================================ HUMANS
function makeHuman(look) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const torso = colorize(new THREE.CapsuleGeometry(0.2, 0.36, 4, 10).scale(1.15, 1, 0.68).translate(0, 1.33, 0), look.shirt);
  const hips = colorize(new THREE.BoxGeometry(0.38, 0.2, 0.24).translate(0, 0.98, 0), look.pants);
  const head = colorize(new THREE.SphereGeometry(0.135, 14, 10).translate(0, 1.77, 0), look.skin);
  const hair = colorize(new THREE.SphereGeometry(0.145, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 1.79, -0.01), look.hair);
  const neck = colorize(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8).translate(0, 1.64, 0), look.skin);
  const body = new THREE.Mesh(merge([torso, hips, head, hair, neck]), M.human);
  const armGeo = merge([colorize(new THREE.CapsuleGeometry(0.062, 0.48, 4, 8).translate(0, -0.3, 0), look.shirt), colorize(new THREE.SphereGeometry(0.065, 8, 6).translate(0, -0.6, 0), look.skin)]);
  const legGeo = merge(look.shorts ? [colorize(new THREE.CapsuleGeometry(0.09, 0.28, 4, 8).translate(0, -0.23, 0), look.pants), colorize(new THREE.CapsuleGeometry(0.072, 0.4, 4, 8).translate(0, -0.62, 0), look.skin), colorize(new THREE.BoxGeometry(0.13, 0.09, 0.27).translate(0, -0.88, 0.05), look.shoes || '#222')]
    : [colorize(new THREE.CapsuleGeometry(0.085, 0.72, 4, 8).translate(0, -0.45, 0), look.pants), colorize(new THREE.BoxGeometry(0.13, 0.09, 0.27).translate(0, -0.88, 0.05), look.shoes || '#222')]);
  if (look.longHair) body.geometry = merge([body.geometry, colorize(new THREE.BoxGeometry(0.28, 0.36, 0.1).translate(0, 1.64, -0.11), look.hair)]);
  if (look.cap) body.geometry = merge([body.geometry, colorize(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12).translate(0, 1.88, 0), look.cap), colorize(new THREE.BoxGeometry(0.22, 0.02, 0.16).translate(0, 1.85, 0.15), look.cap)]);
  if (look.glasses) body.geometry = merge([body.geometry, colorize(new THREE.BoxGeometry(0.25, 0.05, 0.03).translate(0, 1.79, 0.125), '#0a0a0a')]);
  const mk = (geo, x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); const m = new THREE.Mesh(geo, M.human); m.castShadow = true; p.add(m); g.add(p); return p; };
  const armL = mk(armGeo, 0.29, 1.55), armR = mk(armGeo, -0.29, 1.55), legL = mk(legGeo, 0.11, 0.95), legR = mk(legGeo, -0.11, 0.95);
  body.castShadow = true; g.add(body);
  if (look.gun) { const gun = new THREE.Mesh(colorize(new THREE.BoxGeometry(0.06, 0.12, 0.3).translate(0, -0.62, 0.1), '#111'), M.human); armR.add(gun); }
  scene.add(g);
  return { g, armL, armR, legL, legR, phase: Math.random() * 6 };
}
function animHuman(h, speed, dt, aiming) {
  h.phase += dt * (2 + speed * 1.9);
  const amp = clamp(speed / 5, 0, 1) * (speed > 4 ? 0.95 : 0.6), s = Math.sin(h.phase);
  h.legL.rotation.x = s * amp; h.legR.rotation.x = -s * amp;
  h.armL.rotation.x = -s * amp * 0.8; h.armR.rotation.x = aiming ? -Math.PI / 2 : s * amp * 0.8;
  h.g.children[4].position.y = Math.abs(Math.cos(h.phase)) * amp * 0.06;
}
const SKIN = ['#f1c7a5', '#c58c60', '#8d5a3a', '#e0ac80', '#5a3a26', '#f6d6bd'];
const SHIRT = ['#c84a5a', '#4a90a8', '#e0c050', '#ffffff', '#1d1d24', '#4a8a5a', '#6a5a9a', '#d8804a', '#4a6fa5', '#e8e0d0', '#8a8a8a', '#f0d8d0', '#2a3a5a'];
const PANTS = ['#2b3a55', '#1d1d24', '#c9b48a', '#5a5a60', '#e8e8e8', '#3a2a20', '#6a7a8a'];
const HAIR = ['#1a1210', '#3a2416', '#8a6a3a', '#d8c088', '#101010', '#6a2a1a'];
const randLook = () => ({ skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS), hair: pick(HAIR), shoes: pick(['#222', '#f2f2f2', '#6a4a30', '#3a3a4a']), shorts: Math.random() < 0.4, longHair: Math.random() < 0.35, cap: Math.random() < 0.18 ? pick(['#c82020', '#1a2a4a', '#f2f2f2', '#2a6a3a']) : null, glasses: Math.random() < 0.3 });

// ============================================================ CARS
const CAR_SPECS = {
  sedan: { W: 1.86, wr: 0.36, wx: 1.38, max: 40, acc: 15, body: [[-2.25, 0.32], [2.2, 0.32], [2.3, 0.62], [2.2, 0.86], [1.1, 1.0], [-1.75, 1.06], [-2.22, 1.0], [-2.3, 0.62]], cab: [[1.1, 0.97], [0.42, 1.45], [-0.95, 1.48], [-1.72, 1.03]] },
  sport: { W: 1.96, wr: 0.35, wx: 1.42, max: 58, acc: 24, body: [[-2.25, 0.28], [2.25, 0.28], [2.38, 0.48], [2.22, 0.68], [0.9, 0.86], [-1.8, 0.96], [-2.25, 0.92], [-2.33, 0.55]], cab: [[0.95, 0.84], [0.0, 1.22], [-0.9, 1.24], [-1.85, 0.93]] },
  suv: { W: 2.02, wr: 0.43, wx: 1.48, max: 36, acc: 13, body: [[-2.3, 0.44], [2.25, 0.44], [2.34, 0.82], [2.2, 1.1], [1.25, 1.2], [-2.2, 1.22], [-2.3, 1.16], [-2.36, 0.82]], cab: [[1.25, 1.17], [0.72, 1.76], [-2.05, 1.8], [-2.18, 1.2]] },
};
CAR_SPECS.pickup = { W: 2.0, wr: 0.44, wx: 1.6, max: 38, acc: 14, co: 1.4, cr: 1.1, body: [[-2.6, 0.45], [2.45, 0.45], [2.55, 0.85], [2.4, 1.15], [1.3, 1.25], [0.2, 1.28], [-2.6, 1.28], [-2.66, 0.85]], cab: [[1.25, 1.22], [0.75, 1.85], [-0.6, 1.88], [-0.75, 1.25]] };
CAR_SPECS.van = { W: 2.0, wr: 0.4, wx: 1.55, max: 33, acc: 11, co: 1.35, cr: 1.1, body: [[-2.5, 0.4], [2.4, 0.4], [2.5, 0.9], [2.35, 1.2], [1.6, 1.33], [0, 1.35], [-2.5, 1.35], [-2.56, 0.9]], cab: [[1.55, 1.3], [0.9, 2.15], [-2.42, 2.2], [-2.48, 1.3]] };
CAR_SPECS.super = { W: 2.02, wr: 0.36, wx: 1.45, max: 74, acc: 32, body: [[-2.3, 0.26], [2.35, 0.26], [2.45, 0.42], [2.3, 0.56], [0.7, 0.8], [-1.6, 0.9], [-2.3, 0.86], [-2.36, 0.5]], cab: [[0.75, 0.78], [-0.15, 1.12], [-0.95, 1.13], [-1.7, 0.86]] };
CAR_SPECS.bike = { W: 0.7, wr: 0.34, wx: 0.78, max: 64, acc: 30, bike: true, cr: 0.55, co: 0.62 };
CAR_SPECS.taxi = CAR_SPECS.sedan;
CAR_SPECS.armored = { ...CAR_SPECS.suv, max: 36, acc: 13, armored: true }; CAR_SPECS.police = { ...CAR_SPECS.sedan, max: 50, acc: 20 };
const carGeoCache = {};
function carGeos(kind) {
  if (carGeoCache[kind]) return carGeoCache[kind];
  const s = CAR_SPECS[kind], W = s.W;
  const ext = (pts, depth, bev) => {
    const sh = new THREE.Shape(); pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 1 });
    g.translate(0, 0, -depth / 2); return g;
  };
  const body = ext(s.body, W - 0.2, 0.1), cab = ext(s.cab, W - 0.44, 0.07);
  const p1 = s.cab[1], p2 = s.cab[2];
  const roof = new THREE.BoxGeometry(Math.abs(p1[0] - p2[0]) + 0.25, 0.06, W - 0.46).translate((p1[0] + p2[0]) / 2, Math.max(p1[1], p2[1]) + 0.07, 0);
  const paint = merge([body, roof]);
  const fx = s.body[2][0], rx = s.body[7][0], ly = s.body[2][1] + 0.06;
  const lights = merge([
    colorize(new THREE.BoxGeometry(0.1, 0.13, 0.42).translate(fx - 0.02, ly, 0.6), '#fff4dd'), colorize(new THREE.BoxGeometry(0.1, 0.13, 0.42).translate(fx - 0.02, ly, -0.6), '#fff4dd'),
    colorize(new THREE.BoxGeometry(0.1, 0.14, 0.5).translate(rx + 0.02, ly + 0.08, 0.58), '#ff1a10'), colorize(new THREE.BoxGeometry(0.1, 0.14, 0.5).translate(rx + 0.02, ly + 0.08, -0.58), '#ff1a10')]);
  const trimL = [colorize(new THREE.BoxGeometry(0.2, 0.22, W - 0.1).translate(fx, s.body[0][1] + 0.05, 0), '#1a1a1c'), colorize(new THREE.BoxGeometry(0.2, 0.22, W - 0.1).translate(rx, s.body[0][1] + 0.05, 0), '#1a1a1c'),
  colorize(new THREE.BoxGeometry(0.06, 0.2, 0.9).translate(fx + 0.06, ly - 0.14, 0), '#0e0e10')];
  if (kind === 'police') trimL.push(colorize(new THREE.BoxGeometry(Math.abs(p1[0] - p2[0]) + 0.26, 0.065, W - 0.45).translate((p1[0] + p2[0]) / 2, Math.max(p1[1], p2[1]) + 0.075, 0), '#f4f4f4'),
    colorize(new THREE.BoxGeometry(2.0, 0.34, W + 0.04).translate(0.0, 0.68, 0), '#f4f4f4'));
  const c0 = s.cab[0];
  trimL.push(colorize(new THREE.BoxGeometry(0.03, 0.12, 0.34).translate(fx + 0.03, s.body[0][1] + 0.12, 0), '#f2f2ea'), colorize(new THREE.BoxGeometry(0.03, 0.12, 0.34).translate(rx - 0.03, ly - 0.1, 0), '#f2f2ea'));
  for (const sz of [1, -1]) trimL.push(colorize(new THREE.BoxGeometry(0.14, 0.12, 0.2).translate(c0[0] - 0.2, c0[1] + 0.08, sz * (W / 2 + 0.06)), '#1a1a1c'));
  if (kind === 'armored') trimL.push(colorize(new THREE.BoxGeometry(0.12, 0.5, W - 0.2).translate(fx + 0.12, s.body[0][1] + 0.3, 0), '#2a2a2a'), colorize(new THREE.BoxGeometry(2.6, 0.08, W + 0.06).translate(-0.2, s.body[4][1] - 0.1, 0), '#3a3c40'));
  if (kind === 'pickup') trimL.push(colorize(new THREE.BoxGeometry(1.7, 0.04, W - 0.3).translate(-1.65, 1.3, 0), '#141414'));
  if (kind === 'taxi') trimL.push(colorize(new THREE.BoxGeometry(0.5, 0.2, 0.25).translate((p1[0] + p2[0]) / 2, Math.max(p1[1], p2[1]) + 0.2, 0), '#ffe36e'));
  const trim = merge(trimL);
  const r = s.wr;
  const wheel = merge([
    colorize(new THREE.CylinderGeometry(r, r, 0.3, 18).rotateX(Math.PI / 2), '#141414'),
    colorize(new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.32, 14).rotateX(Math.PI / 2), '#c8ccd2'),
    colorize(new THREE.BoxGeometry(r * 1.2, 0.08, 0.34), '#555a60'), colorize(new THREE.BoxGeometry(0.08, r * 1.2, 0.34), '#555a60')]);
  return carGeoCache[kind] = { paint, cab, lights, trim, wheel };
}
const CAR_COLORS = ['#e8e8ea', '#101014', '#8a1018', '#1a3a7a', '#c8c8cc', '#2a4a3a', '#6a6a70', '#a8a090', '#3a5a7a', '#b04a1a', '#202a38', '#f0f0f0', '#d8b040', '#5a1a20'];
let bikeGeo = null;
function createBike(color, x, z, h, mode) {
  const s = CAR_SPECS.bike;
  if (!bikeGeo) {
    const r = s.wr;
    bikeGeo = {
      paint: merge([new THREE.BoxGeometry(0.36, 0.28, 0.7).translate(0, 0.86, 0.2), new THREE.BoxGeometry(0.42, 0.4, 0.28).translate(0, 0.98, 0.66), new THREE.BoxGeometry(0.26, 0.16, 0.6).translate(0, 0.92, -0.52)]),
      trim: merge([colorize(new THREE.BoxGeometry(0.3, 0.1, 0.55).translate(0, 1.03, -0.22), '#111'), colorize(new THREE.BoxGeometry(0.3, 0.34, 0.5).translate(0, 0.5, 0.02), '#55585e'),
        colorize(new THREE.BoxGeometry(0.05, 0.75, 0.05).rotateX(-0.35).translate(0.12, 0.66, 0.68), '#c8ccd2'), colorize(new THREE.BoxGeometry(0.05, 0.75, 0.05).rotateX(-0.35).translate(-0.12, 0.66, 0.68), '#c8ccd2'),
        colorize(new THREE.BoxGeometry(0.72, 0.05, 0.05).translate(0, 1.13, 0.58), '#111'), colorize(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 8).rotateX(Math.PI / 2).translate(0.2, 0.42, -0.38), '#d0d4da'),
        colorize(new THREE.BoxGeometry(0.06, 0.06, 0.9).rotateX(0.25).translate(0, 0.45, -0.42), '#333')]),
      glass: new THREE.BoxGeometry(0.36, 0.2, 0.04).rotateX(-0.5).translate(0, 1.22, 0.78),
      lights: merge([colorize(new THREE.BoxGeometry(0.18, 0.14, 0.05).translate(0, 0.98, 0.81), '#fff4dd'), colorize(new THREE.BoxGeometry(0.16, 0.06, 0.04).translate(0, 0.95, -0.83), '#ff1a10')]),
      wheel: merge([colorize(new THREE.CylinderGeometry(r, r, 0.16, 20).rotateZ(Math.PI / 2), '#141414'), colorize(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.18, 14).rotateZ(Math.PI / 2), '#c8ccd2'),
        colorize(new THREE.BoxGeometry(0.2, r * 1.15, 0.06), '#555a60'), colorize(new THREE.BoxGeometry(0.2, 0.06, r * 1.15), '#555a60')])
    };
  }
  const G = bikeGeo, group = new THREE.Group(); group.rotation.order = 'YXZ';
  const inner = new THREE.Group(); group.add(inner);
  const paintM = paintMat(color), paint = new THREE.Mesh(G.paint, paintM);
  const sh = QUALITY !== 'low'; paint.castShadow = sh;
  inner.add(paint, new THREE.Mesh(G.trim, M.trim), new THREE.Mesh(G.glass, M.carGlass), new THREE.Mesh(G.lights, M.carLight));
  const spinners = [], fronts = [];
  for (const wz of [s.wx, -0.72]) {
    const piv = new THREE.Group(); piv.position.set(0, s.wr, wz);
    const sp = new THREE.Group(); piv.add(sp); const wm = new THREE.Mesh(G.wheel, M.wheel); wm.castShadow = sh; sp.add(wm); inner.add(piv);
    spinners.push(sp); if (wz > 0) fronts.push(piv);
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.6).rotateX(-Math.PI / 2), M.blob); blob.position.y = 0.04; group.add(blob);
  group.position.set(x, groundY(x, z), z); group.rotation.y = h; scene.add(group);
  const car = { group, inner, paint, paintM, spinners, fronts, siren: null, kind: 'bike', spec: s, h, vx: 0, vz: 0, y: group.position.y, vy: 0, air: false, steer: 0, spin: 0, mode, health: 70, driver: false, active: true, ai: null, stuck: 0, reverseT: 0, smokeT: 0, police: false, pathT: 0, path: null, shootT: 2, idleT: 0, dead: false, honk: 0 };
  cars.push(initCar(car)); return car;
}
function createCar(kind, color, x, z, h, mode) {
  if (kind === 'bike') return createBike(color, x, z, h, mode);
  const G = carGeos(kind), s = CAR_SPECS[kind];
  const group = new THREE.Group(); group.rotation.order = 'YXZ';
  const inner = new THREE.Group(); inner.rotation.y = -Math.PI / 2; group.add(inner);
  const paintM = paintMat(kind === 'police' ? '#14182a' : kind === 'taxi' ? '#f2c230' : color);
  const paint = new THREE.Mesh(G.paint, paintM), cab = new THREE.Mesh(G.cab, M.carGlass), lights = new THREE.Mesh(G.lights, M.carLight), trim = new THREE.Mesh(G.trim, M.trim);
  const sh = QUALITY !== 'low';
  paint.castShadow = sh; cab.castShadow = sh;
  inner.add(paint, cab, lights, trim);
  const spinners = [], fronts = [];
  for (const [wx, wz] of [[s.wx, 1], [s.wx, -1], [-s.wx + 0.05, 1], [-s.wx + 0.05, -1]]) {
    const piv = new THREE.Group(); piv.position.set(wx, s.wr, wz * (s.W / 2 - 0.1));
    const sp = new THREE.Group(); piv.add(sp); sp.add(new THREE.Mesh(G.wheel, M.wheel)); inner.add(piv);
    spinners.push(sp); if (wx > 0) fronts.push(piv);
  }
  let siren = null;
  if (kind === 'police') {
    const p1 = s.cab[1], p2 = s.cab[2], y = Math.max(p1[1], p2[1]) + 0.18, cx = (p1[0] + p2[0]) / 2;
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.55), M.sirenR); a.position.set(cx, y, 0.3);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.55), M.sirenB); b.position.set(cx, y, -0.3);
    inner.add(a, b); siren = [a, b];
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(s.W + 0.7, 5.4).rotateX(-Math.PI / 2), M.blob); blob.position.y = 0.04; group.add(blob);
  group.position.set(x, groundY(x, z), z); group.rotation.y = h; scene.add(group);
  const car = { group, inner, paint, paintM, spinners, fronts, siren, kind, spec: s, h, vx: 0, vz: 0, y: group.position.y, vy: 0, air: false, steer: 0, spin: 0, mode, health: 100, driver: mode !== 'free', active: true, ai: null, stuck: 0, reverseT: 0, smokeT: 0, police: kind === 'police', pathT: 0, path: null, shootT: 2, idleT: 0, dead: false, honk: 0 };
  cars.push(initCar(car)); return car;
}
const carSpeed = c => Math.hypot(c.vx, c.vz);
const carFwd = c => c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h);

function carPhysics(c, dt, throttle, steerIn, hand) {
  const s = c.spec, sin = Math.sin(c.h), cos = Math.cos(c.h), up = c.up || { engine: 0, grip: 0 };
  const sMax = s.max * (1 + 0.2 * up.engine), sAcc = s.acc * (1 + 0.15 * up.engine), brk = 1 + 0.2 * up.grip;
  let vF = c.vx * sin + c.vz * cos, vL = c.vx * -cos + c.vz * sin;
  const grounded = !c.air;
  if (grounded) {
    if (throttle > 0) { vF += (vF < -0.5 ? 30 * brk : sAcc * (1 - Math.max(0, vF) / sMax * 0.85)) * throttle * dt; }
    else if (throttle < 0) { vF += (vF > 0.5 ? -32 * brk : -9 * (vF > -12 ? 1 : 0)) * -throttle * dt; }
    else vF -= Math.sign(vF) * Math.min(Math.abs(vF), (c.mode === 'player' ? 2.5 : 7) * dt);
    vF -= vF * Math.abs(vF) * 0.0011 * dt * 60 * 0.06;
    if (hand) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt);
    vF = clamp(vF, -14, sMax);
    const maxSteer = (s.bike ? 0.7 : 0.62) / (1 + Math.abs(vF) / (s.bike ? 20 : 16));
    c.steer = damp(c.steer, steerIn * maxSteer, 8, dt);
    const yawRate = -vF / 2.7 * Math.tan(c.steer) * (hand ? 1.35 : 1);
    c.h += yawRate * dt;
    const grip = (hand ? 1.6 : (c.mode === 'player' ? (s.bike ? 9 : 6.5) * brk : 10)) * (1 - 0.35 * state.rain);
    vL *= Math.exp(-grip * dt);
    c.drift = Math.abs(vL);
  } else { c.steer = damp(c.steer, 0, 2, dt); c.drift = 0; }
  const s2 = Math.sin(c.h), c2 = Math.cos(c.h);
  c.vx = s2 * vF - c2 * vL; c.vz = c2 * vF + s2 * vL;
  integrateCar(c, dt);
}
function integrateCar(c, dt) {
  let x = c.group.position.x + c.vx * dt, z = c.group.position.z + c.vz * dt;
  // two-circle building collision
  const co = c.spec.co ?? 1.25, fx = Math.sin(c.h) * co, fz = Math.cos(c.h) * co;
  let impact = 0;
  for (const sgn of [1, -1]) {
    const r = collide(x + fx * sgn, z + fz * sgn, c.spec.cr ?? 1.05, c.y + 0.3);
    if (r.hit) {
      x = r.x - fx * sgn; z = r.z - fz * sgn;
      const vn = c.vx * r.nx + c.vz * r.nz;
      if (vn < 0) { c.vx -= r.nx * vn * 1.35; c.vz -= r.nz * vn * 1.35; c.vx *= 0.8; c.vz *= 0.8; impact = Math.max(impact, -vn); }
    }
  }
  if (impact > 9) damageCar(c, (impact - 9) * 2.2, true);
  if (impact > 11) bikeCrash(c, impact);
  if (impact > 4 && c.mode === 'player') { state.shake = Math.min(1, impact / 25); AudioSys.crash(impact / 30); }
  c.group.position.x = x; c.group.position.z = z;
  // vertical
  const g = groundY(x, z);
  if (c.air) { c.vy -= 22 * dt; c.y += c.vy * dt; if (c.y <= g) { if (c.vy < -8 && c.mode === 'player') { state.shake = 0.6; AudioSys.crash(0.4); } c.y = g; c.vy = 0; c.air = false; } }
  else if (g < c.y - 0.35) { c.air = true; }
  else { c.vy = clamp((g - c.y) / Math.max(dt, 1e-3), -6, Math.max(2, carSpeed(c) * 0.5)); c.y = g; }
  c.group.position.y = c.y;
  c.group.rotation.y = c.h;
  const sp = carFwd(c);
  c.group.rotation.x = damp(c.group.rotation.x, -Math.atan2(c.vy, Math.max(6, Math.abs(sp))) * 0.8, c.air ? 3 : 10, dt);
  const lean = c.spec.bike ? clamp(Math.atan(sp * sp * Math.tan(c.steer) / 2.7 / 9.8) * 0.75, -0.75, 0.75) : c.steer * clamp(sp / 30, -1, 1) * 0.12;
  c.group.rotation.z = damp(c.group.rotation.z, c.air ? 0 : lean, 6, dt);
  c.spin += sp * dt / c.spec.wr;
  for (const s of c.spinners) if (c.spec.bike) s.rotation.x = c.spin; else s.rotation.z = -c.spin;
  for (const f of c.fronts) f.rotation.y = -c.steer;
}
function bikeCrash(c, impact) {
  if (!c.spec.bike || c.mode !== 'player') return;
  exitCar(true); applyDamage(impact * 1.3); player.vy = 6; player.onGround = false;
  floatText('KAZA!'); state.shake = 1;
}
function damageCar(c, amt, fromCrash) {
  if (c.dead) return;
  if (c.up && c.up.armor) amt *= 0.5;
  c.health -= amt;
  if (c.mode === 'player' && fromCrash) state.health -= amt * 0.12;
  if (c.health <= 0) explodeCar(c);
}
function explodeCar(c) {
  c.dead = true; c.health = 0; c.mode = 'dead'; c.driver = false;
  c.paint.material = M.burnt;
  const p = c.group.position;
  explosion(p.x, p.y + 1, p.z);
  c.vy = 7; c.air = true;
  if (c.police) addHeat(1.2);
  if (state.inCar === c) { exitCar(true); state.health -= 45; }
  setTimeout(() => {
    if (!c.dead || c.police || c.display || c.delivery) return;
    if (c.owned) { const [x, z] = dealerSpot(cars.filter(o => o.owned).indexOf(c)); c.dead = false; c.health = c.maxHealth; c.paint.material = c.paintM; c.mode = 'free'; c.vx = c.vz = 0; c.air = false; c.group.position.set(x, 0, z); c.y = 0; c.h = Math.PI / 2; c.group.rotation.set(0, c.h, 0); floatText('Sigorta: aracın galeride'); }
    else respawnTrafficCar(c);
  }, 25000);
}

// ============================================================ PLAYER
const player = { pos: new THREE.Vector3(), vy: 0, yaw: 0, speed: 0, onGround: true, human: null, aimT: 0 };
let camYaw = 0, camPitch = 0.22, camDist = 5;
function spawnPlayer() {
  player.human = makeHuman({ skin: '#c58c60', shirt: '#e8e4da', pants: '#3a4a5e', hair: '#1a1210', shoes: '#f2f2f2', gun: true, glasses: true });
  const x = nodeP(4) + ROAD / 2 + 3, z = nodeP(4) + ROAD / 2 + 3;
  player.pos.set(x, 0.25, z); player.yaw = Math.PI * 0.75; camYaw = player.yaw + Math.PI;
  createCar('sport', '#ff2a6a', nodeP(4) + 6.5, nodeP(4) + 22, 0, 'free');
  createCar('bike', '#00c8e0', nodeP(4) + 10, nodeP(4) + 4, Math.PI * 0.5, 'free');
}
function enterCar() {
  if (state.inCar) { exitCar(false); return; }
  let best = null, bd = 5;
  for (const c of cars) { if (!c.active || c.dead) continue; const d = Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  if (best.display) { floatText('Bu araç satılık — galeriden al!'); return; }
  if (best.driver) { // carjack!
    state.stats.jacked++;
    const p = best.group.position;
    ejectDriver(p.x - Math.cos(best.h) * 1.6, p.z + Math.sin(best.h) * 1.6);
    addHeat(best.police ? 1.5 : 0.35);
  }
  if (best.ai) best.ai = null;
  best.mode = 'player'; best.driver = true; state.inCar = best;
  if (best.spec.bike) { best.group.add(player.human.g); player.human.g.position.set(0, 0.45, -0.28); player.human.g.rotation.set(0.32, 0, 0); }
  else player.human.g.visible = false;
  if (state.soundMode === 0) floatText('📻 VISTA FM 101.4');
  document.body.classList.add('incar');
  AudioSys.door();
}
function exitCar(forced) {
  const c = state.inCar; if (!c) return;
  const sp = carSpeed(c);
  c.mode = c.dead ? 'dead' : 'free'; c.driver = false; state.inCar = null;
  let x = c.group.position.x + Math.cos(c.h) * 1.9, z = c.group.position.z - Math.sin(c.h) * 1.9; // driver (left) side
  const r = collide(x, z, 0.4, 0.5); x = r.x; z = r.z;
  player.pos.set(x, groundY(x, z), z); player.vy = 0;
  if (player.human.g.parent !== scene) scene.add(player.human.g);
  player.human.g.rotation.set(0, c.h, 0); player.human.g.children[4].position.y = 0;
  player.human.g.visible = true; player.yaw = c.h;
  if (sp > 12 && !forced) state.health -= 8;
  document.body.classList.remove('incar');
  AudioSys.door();
}
function updatePlayerFoot(dt) {
  const ix = input.mx, iy = input.my, mag = Math.min(1, Math.hypot(ix, iy));
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  let mx = fx * iy + rx * ix, mz = fz * iy + rz * ix;
  const run = input.sprint || mag > 0.92;
  const target = mag > 0.08 ? (run ? 6.8 : 2.6 + mag * 1.5) : 0;
  player.speed = damp(player.speed, target, 10, dt);
  if (mag > 0.08) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; if (player.aimT <= 0) player.yaw = wrapA(player.yaw + wrapA(Math.atan2(mx, mz) - player.yaw) * (1 - Math.exp(-12 * dt))); }
  else { mx = Math.sin(player.yaw); mz = Math.cos(player.yaw); }
  let x = player.pos.x + mx * player.speed * dt, z = player.pos.z + mz * player.speed * dt;
  // jump & gravity
  const g = groundY(x, z);
  if (input.jump && player.onGround) { player.vy = 5.8; player.onGround = false; }
  player.vy -= 18 * dt; player.pos.y += player.vy * dt;
  if (player.pos.y <= g) { if (g - player.pos.y < 0.6 || !player.onGround) { player.pos.y = g; player.vy = 0; player.onGround = true; } }
  else if (player.pos.y > g + 0.05) player.onGround = false;
  const r = collide(x, z, 0.38, player.pos.y + 0.2); x = r.x; z = r.z;
  // cars push
  for (const c of cars) {
    if (!c.active) continue;
    const p = c.group.position, fx2 = Math.sin(c.h) * 1.2, fz2 = Math.cos(c.h) * 1.2;
    for (const sg of [1, 0, -1]) {
      const dx = x - (p.x + fx2 * sg), dz = z - (p.z + fz2 * sg), d = Math.hypot(dx, dz);
      if (d < 1.4 && d > 0.001 && player.pos.y < p.y + 1.6) {
        const sp = carSpeed(c);
        if (sp > 7) { state.health -= sp * 1.4; player.vy = 4; player.onGround = false; x += dx / d * 2.5; z += dz / d * 2.5; state.shake = 0.5; break; }
        x = p.x + fx2 * sg + dx / d * 1.4; z = p.z + fz2 * sg + dz / d * 1.4;
      }
    }
  }
  player.pos.x = x; player.pos.z = z;
  if (player.aimT > 0) player.aimT -= dt;
  const h = player.human;
  h.g.position.copy(player.pos); h.g.rotation.y = player.yaw;
  h.legL.rotation.z = h.legR.rotation.z = 0;
  animHuman(h, player.onGround ? player.speed : 0, dt, player.aimT > 0);
  if (!player.onGround) { h.legL.rotation.x = -0.6; h.legR.rotation.x = 0.3; }
}
function updatePlayerCar(dt) {
  const c = state.inCar;
  let throttle = clamp(input.my + (input.gas ? 1 : 0) - (input.brake ? 1 : 0), -1, 1);
  carPhysics(c, dt, throttle, clamp(input.mx, -1, 1), input.hand);
  if (!state.inCar) return; // crashed off bike
  player.pos.copy(c.group.position);
  { const v = carSpeed(c); state.stats.dist += v * dt; state.stats.topSpeed = Math.max(state.stats.topSpeed, Math.abs(carFwd(c)) * 3.6); }
  if (c.spec.bike) { const h = player.human; h.legL.rotation.x = h.legR.rotation.x = -1.3; h.armL.rotation.x = h.armR.rotation.x = -1.15; h.legL.rotation.z = 0.25; h.legR.rotation.z = -0.25; }
  // tire smoke
  if (c.drift > 4 && !c.air) {
    for (const sp of (c.spec.bike ? [c.spinners[1]] : [c.spinners[2], c.spinners[3]])) {
      sp.getWorldPosition(tmpV);
      FX.norm.spawn(tmpV.x, tmpV.y, tmpV.z, MR(-1, 1), MR(0.5, 1.5), MR(-1, 1), 1.4, 1.2, 3, 0.8, 0.8, 0.82, 0.35, 0);
    }
  }
}
function ejectDriver(x, z) {
  // find a ped to repurpose
  const civ = peds.filter(q => !q.npc); let p = civ.find(q => q.dead) || civ.reduce((a, b) => (dist2(b) > dist2(a) ? b : a));
  p.dead = false; p.deadT = 0; p.free = true; p.x = x; p.z = z; p.panic = 10; p.h.g.rotation.x = 0; p.h.g.visible = true;
  p.fleeX = x - player.pos.x; p.fleeZ = z - player.pos.z;
}
const dist2 = p => (p.x - player.pos.x) ** 2 + (p.z - player.pos.z) ** 2;

// ============================================================ WEAPON
const WEAPONS = [
  { name: 'TABANCA', icon: '🔫', cd: 0.3, range: 55, cone: 0.32, carDmg: 14, pellets: 1, vol: 1 },
  { name: 'UZI', icon: '⚡', cd: 0.085, range: 45, cone: 0.36, carDmg: 8, pellets: 1, vol: 0.7, spread: 0.05 },
  { name: 'TÜFEK', icon: '🎯', cd: 0.12, range: 75, cone: 0.3, carDmg: 12, pellets: 1, vol: 1.1, spread: 0.02 },
  { name: 'POMPALI', icon: '💥', cd: 0.85, range: 24, cone: 0.55, carDmg: 34, pellets: 7, vol: 1.6, spread: 0.13 },
  { name: 'ROKETATAR', icon: '🚀', cd: 1.3, range: 140, cone: 0.25, rocket: true, vol: 1 },
];
function nextWeapon(dir = 1) {
  const L = WEAPONS.length; for (let k = 1; k <= L; k++) { const i = (state.weapon + dir * k + L * 2) % L; if (state.ownedW[i] && state.ammo[i] > 0) { state.weapon = i; break; } }
  AudioSys.tone(700, 0.05, 0.12, 'square');
}
function selectWeapon(i) { if (state.ownedW[i] && state.ammo[i] > 0) { state.weapon = i; AudioSys.tone(700, 0.05, 0.12, 'square'); } }
function fire() {
  if (state.fireCd > 0 || state.dead) return;
  if (!state.ownedW[state.weapon] || state.ammo[state.weapon] <= 0) { nextWeapon(); return; }
  haptic(20);
  const w = WEAPONS[state.weapon];
  state.fireCd = w.cd;
  if (state.ammo[state.weapon] !== Infinity) state.ammo[state.weapon]--;
  const inCar = state.inCar;
  const ox = player.pos.x, oz = player.pos.z, oy = player.pos.y + (inCar ? 1.3 : 1.45);
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  let best = null, bs = w.cone;
  const consider = (obj, x, y, z, rad) => {
    const dx = x - ox, dz = z - oz, d = Math.hypot(dx, dz); if (d > w.range || d < 0.5) return;
    const a = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1)) - Math.atan(rad / d);
    if (a < bs && los(ox, oy, oz, x, y, z)) { bs = a; best = obj; best._p = [x, y, z]; }
  };
  for (const p of peds) if (!p.dead && p.h.g.visible) consider(p, p.x, p.h.g.position.y + 1.2, p.z, 0.4);
  for (const c of cars) if (c.active && !c.dead && c !== inCar) consider(c, c.group.position.x, c.y + 0.9, c.group.position.z, 1.6);
  let tx, ty, tz, dirx = fx, dirz = fz, d = w.range;
  if (best) { [tx, ty, tz] = best._p; d = Math.hypot(tx - ox, tz - oz); dirx = (tx - ox) / d; dirz = (tz - oz) / d; }
  else {
    for (let k = 1; k * 2.5 <= w.range; k++) { const t = k * 2.5; if (insideBuilding(ox + fx * t, oy, oz + fz * t)) { d = t; break; } }
    tx = ox + fx * d; ty = oy; tz = oz + fz * d;
  }
  if (!inCar) { player.yaw = Math.atan2(dirx, dirz); player.aimT = 0.6; }
  const mx = ox + Math.sin(player.yaw) * 0.6, mz = oz + Math.cos(player.yaw) * 0.6;
  FX.add.spawn(mx, oy, mz, 0, 0, 0, 0.06, w.pellets > 1 ? 2 : 1.2, 0, 3, 2.2, 0.8, 1, 0);
  if (w.rocket) {
    const dy = best ? (ty - oy) / d : 0;
    launchRocket(mx, oy, mz, dirx, dy, dirz);
    AudioSys.rocket();
  } else {
    if (best) {
      if (best.spec) { damageCar(best, w.carDmg); if (best.ai) best.ai.panic = 6; }
      else hitPed(best);
      FX.add.spawn(tx, ty, tz, 0, 1, 0, 0.15, 0.6, 2, 3, 1.4, 0.4, 1, 0);
    } else if (d < w.range) for (let k = 0; k < 4; k++) FX.add.spawn(tx, ty, tz, MR(-3, 3), MR(0, 4), MR(-3, 3), 0.3, 0.25, 0, 2, 1.6, 0.6, 1, 15);
    for (let k = 0; k < w.pellets; k++) {
      if (k === 0 && !w.spread) { FX.tracer(mx, oy, mz, tx, ty, tz); continue; }
      const a = Math.atan2(dirx, dirz) + MR(-1, 1) * (w.spread || 0), dd = d * MR(0.85, 1.05);
      FX.tracer(mx, oy, mz, ox + Math.sin(a) * dd, ty + MR(-0.5, 0.5) * (w.spread || 0) * 6, oz + Math.cos(a) * dd);
    }
    AudioSys.shot(w.vol);
  }
  // shots fired near people -> heat
  if (state.wanted < 1) for (const p of peds) if (!p.dead && dist2(p) < 900) { addHeat(1); break; }
  for (const p of peds) if (!p.dead && dist2(p) < 1600) { p.panic = 8; p.fleeX = p.x - ox; p.fleeZ = p.z - oz; if (p.npc && state.mission && state.mission.type === 'bounty') state.mission.alert = true; }
}
const rockets = [], rocketPool = []; let rocketGeo = null, rocketMat = null;
function launchRocket(x, y, z, dx, dy, dz) {
  if (!rocketGeo) { rocketGeo = merge([colorize(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 8).rotateX(Math.PI / 2), '#6a6f58'), colorize(new THREE.ConeGeometry(0.09, 0.25, 8).rotateX(Math.PI / 2).translate(0, 0, 0.47), '#c03020')]); rocketMat = new THREE.MeshStandardMaterial({ vertexColors: true }); }
  if (rockets.length >= 8) return;
  const m = rocketPool.pop() || (() => { const n = new THREE.Mesh(rocketGeo, rocketMat); scene.add(n); return n; })();
  m.visible = true; m.position.set(x, y, z); m.lookAt(x + dx, y + dy, z + dz);
  rockets.push({ m, vx: dx * 65, vy: dy * 65, vz: dz * 65, t: 2.6 });
}
function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i], p = r.m.position; r.t -= dt;
    let hit = false;
    for (let st = 0; st < 3 && !hit; st++) {
      p.x += r.vx * dt / 3; p.y += r.vy * dt / 3; p.z += r.vz * dt / 3;
      if (insideBuilding(p.x, p.y, p.z) || p.y <= groundY(p.x, p.z) + 0.1) hit = true;
      for (const c of cars) if (c.active && c !== state.inCar && Math.abs(c.group.position.x - p.x) < 2.2 && Math.abs(c.group.position.z - p.z) < 2.2 && Math.abs(c.y + 0.8 - p.y) < 1.6) hit = true;
      for (const q of peds) if (!q.dead && Math.hypot(q.x - p.x, q.z - p.z) < 1 && p.y < 2.3) hit = true;
    }
    FX.norm.spawn(p.x, p.y, p.z, MR(-0.3, 0.3), MR(-0.3, 0.3), MR(-0.3, 0.3), 1.3, 0.4, 1.8, 0.75, 0.75, 0.78, 0.5, -0.3);
    FX.add.spawn(p.x, p.y, p.z, 0, 0, 0, 0.08, 0.55, 0, 3, 1.5, 0.4, 1, 0);
    if (hit || r.t <= 0) { explosion(p.x, p.y, p.z, true); r.m.visible = false; rocketPool.push(r.m); rockets.splice(i, 1); haptic(60); }
  }
}
function killPed(p, byPlayer) {
  if (p.dead) return;
  p.dead = true; p.deadT = 18;
  p.h.g.rotation.x = -Math.PI / 2;
  for (let k = 0; k < 10; k++) FX.norm.spawn(p.x, 0.9, p.z, MR(-2, 2), MR(1, 4), MR(-2, 2), 0.5, 0.35, 0.2, 0.55, 0.02, 0.02, 0.9, 12);
  spawnCash(p.x + MR(-0.5, 0.5), p.z + MR(-0.5, 0.5), Math.round(MR(10, 90)));
  if (byPlayer) { addHeat(p.cop ? 1.5 : 0.7); state.stats.kills++; }
}
function addHeat(v) { state.heat = clamp(Math.max(state.heat, 1) + (state.heat >= 1 ? v : 0), 0, 5.99); state.crimeTimer = 0; }

// ============================================================ TRAFFIC
function spawnTraffic() {
  const n = QUALITY === 'low' ? 16 : QUALITY === 'medium' ? 22 : 30;
  for (let k = 0; k < n; k++) {
    const kind = pick(['sedan', 'sedan', 'sedan', 'suv', 'suv', 'sport', 'taxi', 'taxi', 'pickup', 'pickup', 'van', 'super']);
    const c = createCar(kind, pick(CAR_COLORS), 0, 0, 0, 'ai');
    placeOnRoad(c, true);
  }
  // parked cars along curbs
  const np = QUALITY === 'low' ? 10 : 18;
  for (let k = 0; k < np; k++) {
    const i = RI(0, N - 1), j = RI(0, N), alongX = rnd() < 0.5;
    const t = R(20, CELL - 20), side = rnd() < 0.5 ? 1 : -1, off = side * (ROAD / 2 - 1.3);
    const x = alongX ? nodeP(i) + t : nodeP(j) + off, z = alongX ? nodeP(j) + off : nodeP(i) + t;
    const h = alongX ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0);
    const c = createCar(pick(['sedan', 'suv', 'sport', 'sedan', 'pickup', 'van']), pick(CAR_COLORS), x, z, h + (rnd() < 0.5 ? Math.PI : 0), 'free');
    c.driver = false;
  }
  for (let k = 0; k < (QUALITY === 'low' ? 5 : 9); k++) {
    const i = RI(0, N - 1), j = RI(0, N), t = R(20, CELL - 20), side = rnd() < 0.5 ? 1 : -1;
    createCar('bike', pick(['#ff2a6a', '#00c8e0', '#ffd23a', '#101014', '#f06a20', '#8a5cff', '#e8e8ea']), nodeP(i) + t, nodeP(j) + side * (ROAD / 2 - 1.2), rnd() * 6, 'free');
  }
  // police pool
  for (let k = 0; k < 4; k++) { const c = createCar('police', '#fff', 0, -9999, 0, 'police'); c.active = false; c.group.visible = false; }
}
function placeOnRoad(c, anywhere) {
  let i, j, dir, tries = 0;
  do {
    i = RI(0, N); j = RI(0, N); dir = RI(0, 3); tries++;
  } while ((i + DX[dir] < 0 || i + DX[dir] > N || j + DZ[dir] < 0 || j + DZ[dir] > N ||
    (!anywhere && Math.hypot(nodeP(i) - player.pos.x, nodeP(j) - player.pos.z) < 120)) && tries < 50);
  c.ai = { i, j, dir, t: R(10, CELL - 10), lane: rnd() < 0.5 ? 2.4 : 6.6, speed: 0, cruise: R(9, 14), panic: 0, wait: 0, ghost: 0 };
  const tp = aiTarget(c.ai); c.group.position.set(tp[0], 0, tp[1]); c.h = Math.atan2(DX[dir], DZ[dir]); c.y = 0;
  c.mode = 'ai'; c.driver = true;
}
function respawnTrafficCar(c) {
  c.dead = false; c.health = c.maxHealth || 100; c.paint.material = c.paintM; c.vx = c.vz = 0; c.air = false; c.vy = 0;
  c.group.rotation.set(0, 0, 0); placeOnRoad(c, false);
}
function aiTarget(a) {
  const fx = DX[a.dir], fz = DZ[a.dir];
  return [nodeP(a.i) + fx * a.t - fz * a.lane, nodeP(a.j) + fz * a.t + fx * a.lane];
}
function updateAI(c, dt) {
  const a = c.ai, fx = DX[a.dir], fz = DZ[a.dir], p = c.group.position;
  let desired = a.panic > 0 ? 22 : a.cruise;
  if (a.panic > 0) a.panic -= dt;
  const stopAt = CELL - ROAD / 2 - 3; let atLight = false;
  if (a.panic <= 0 && a.t < stopAt && a.t > stopAt - 16) { const st = lightState(a.dir % 2); if (st === 'r' || (st === 'y' && stopAt - a.t > 5)) { desired = Math.min(desired, Math.max(0, (stopAt - a.t) * 1.1 - 0.5)); atLight = true; } }
  if (a.ghost > 0) a.ghost -= dt;
  else {
    const chk = (ox, oz, rad) => {
      const dx = ox - p.x, dz = oz - p.z, ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 13 && lat < rad) desired = Math.min(desired, Math.max(0, (ahead - 6.5) * 1.6));
    };
    for (const o of cars) if (o !== c && o.active) chk(o.group.position.x, o.group.position.z, 2.3);
    if (!state.inCar) chk(player.pos.x, player.pos.z, 1.6);
    for (const q of peds) if (!q.dead && q.free) chk(q.x, q.z, 1.4);
  }
  a.speed = damp(a.speed, desired, desired < a.speed ? 5 : 1.5, dt);
  if (a.speed < 0.5 && !atLight) { a.wait += dt; if (a.wait > 5) { a.ghost = 2; a.wait = 0; } } else a.wait = 0;
  a.t += a.speed * dt;
  if (a.t >= CELL) {
    a.t -= CELL; a.i += fx; a.j += fz;
    const opts = [];
    for (const d of [a.dir, a.dir, a.dir, (a.dir + 1) % 4, (a.dir + 3) % 4]) { const ni = a.i + DX[d], nj = a.j + DZ[d]; if (ni >= 0 && ni <= N && nj >= 0 && nj <= N) opts.push(d); }
    a.dir = opts.length ? pick(opts) : (a.dir + 2) % 4;
  }
  const [tx, tz] = aiTarget(a);
  const ox = p.x, oz = p.z;
  p.x = damp(p.x, tx, 4, dt); p.z = damp(p.z, tz, 4, dt);
  c.vx = (p.x - ox) / dt; c.vz = (p.z - oz) / dt;
  const sp = Math.hypot(c.vx, c.vz);
  if (sp > 0.3) { const th = Math.atan2(c.vx, c.vz), d = wrapA(th - c.h); c.h += d * (1 - Math.exp(-8 * dt)); c.steer = clamp(-d * 3, -0.5, 0.5); }
  c.y = groundY(p.x, p.z); p.y = c.y; c.group.rotation.y = c.h; c.group.rotation.x = 0; c.group.rotation.z = 0;
  c.spin += sp * dt / c.spec.wr; for (const s of c.spinners) s.rotation.z = -c.spin; for (const f of c.fronts) f.rotation.y = -c.steer;
}

// ============================================================ POLICE
function bfsPath(si, sj, ti, tj) {
  const W = N + 1, prev = new Int16Array(W * W).fill(-1), q = [si * W + sj]; prev[si * W + sj] = si * W + sj;
  while (q.length) {
    const cur = q.shift(); if (cur === ti * W + tj) break;
    const ci = Math.floor(cur / W), cj = cur % W;
    for (let d = 0; d < 4; d++) { const ni = ci + DX[d], nj = cj + DZ[d]; if (ni < 0 || nj < 0 || ni > N || nj > N) continue; const k = ni * W + nj; if (prev[k] === -1) { prev[k] = cur; q.push(k); } }
  }
  const path = []; let k = ti * W + tj; if (prev[k] === -1) return path;
  while (k !== si * W + sj) { path.unshift([Math.floor(k / W), k % W]); k = prev[k]; }
  return path;
}
function updatePolice(dt) {
  const want = Math.min(4, state.wanted), pc = cars.filter(c => c.police);
  let active = pc.filter(c => c.active && c.mode === 'police');
  // spawn
  if (active.length < want) {
    const c = pc.find(c => !c.active);
    if (c) {
      let best = null;
      for (let t = 0; t < 30; t++) { const i = RI(0, N), j = RI(0, N), d = Math.hypot(nodeP(i) - player.pos.x, nodeP(j) - player.pos.z); if (d > 130 && d < 260) { best = [i, j]; break; } }
      if (best) {
        c.active = true; c.group.visible = true; c.dead = false; c.health = 100; c.paint.material = c.paintM; c.mode = 'police'; c.driver = true;
        c.group.position.set(nodeP(best[0]), 0, nodeP(best[1])); c.y = 0; c.vx = c.vz = 0; c.air = false;
        c.h = Math.atan2(player.pos.x - nodeP(best[0]), player.pos.z - nodeP(best[1])); c.path = null; c.pathT = 0; c.stuck = 0; c.reverseT = 0; c.idleT = 0;
      }
    }
  }
  let nearest = 1e9, see = false;
  for (const c of pc) {
    if (!c.active) continue;
    const p = c.group.position, d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
    if (c.mode !== 'police') { if (c.mode === 'dead' || c.mode === 'free') { if (d > 160) { c.active = false; c.group.visible = false; } } continue; }
    nearest = Math.min(nearest, d);
    if (!see && d < 75 && state.wanted > 0 && los(p.x, 1.5, p.z, player.pos.x, 1.5, player.pos.z)) see = true;
    if (state.wanted === 0) { c.idleT += dt; carPhysics(c, dt, 0, 0, false); if (c.idleT > 6 || d > 140) { c.active = false; c.group.visible = false; } continue; }
    // targeting
    let tx = player.pos.x, tz = player.pos.z;
    const direct = d < 45 && los(p.x, 1, p.z, tx, 1, tz);
    if (!direct) {
      c.pathT -= dt;
      if (c.pathT <= 0 || !c.path || !c.path.length) { const s = nearestNode(p.x, p.z), t = nearestNode(tx, tz); c.path = bfsPath(s[0], s[1], t[0], t[1]); c.pathT = 1; }
      if (c.path && c.path.length) {
        let [ni, nj] = c.path[0];
        if (Math.hypot(nodeP(ni) - p.x, nodeP(nj) - p.z) < 9) { c.path.shift(); if (c.path.length) [ni, nj] = c.path[0]; }
        tx = nodeP(ni); tz = nodeP(nj);
      }
    }
    const want = Math.atan2(tx - p.x, tz - p.z), diff = wrapA(want - c.h);
    let thr = d < 9 && !state.inCar ? -0.3 : 1, steer = clamp(-diff * 2.2, -1, 1);
    if (Math.abs(diff) > 1.6 && carSpeed(c) < 8) thr = 0.6;
    if (c.reverseT > 0) { c.reverseT -= dt; thr = -1; steer = -steer; }
    else if (carSpeed(c) < 1.5 && d > 10) { c.stuck += dt; if (c.stuck > 1.5) { c.reverseT = 1.2; c.stuck = 0; } } else c.stuck = 0;
    carPhysics(c, dt, thr, steer, Math.abs(diff) > 1.2 && carSpeed(c) > 14);
    // shooting
    if (state.wanted >= 2 && d < 32 && !state.dead) {
      c.shootT -= dt;
      if (c.shootT <= 0 && los(p.x, 1.4, p.z, player.pos.x, 1.3, player.pos.z)) {
        c.shootT = MR(0.6, 1.3) / (state.wanted * 0.5);
        const hit = Math.random() < 0.45;
        const ex = player.pos.x + (hit ? 0 : MR(-3, 3)), ez = player.pos.z + (hit ? 0 : MR(-3, 3));
        FX.tracer(p.x, p.y + 1.4, p.z, ex, player.pos.y + 1.2, ez, true);
        AudioSys.shot(0.35);
        if (hit) { if (state.inCar) { damageCar(state.inCar, 5); state.health -= 1.5; } else applyDamage(6); }
      }
    }
    // bust: on foot, police very close and stopped
    if (!state.inCar && d < 4.5 && carSpeed(c) < 3 && state.wanted <= 2) { c.bustT = (c.bustT || 0) + dt; if (c.bustT > 2.5) busted(); } else c.bustT = 0;
  }
  state.policeSee = see;
  return nearest;
}
function applyDamage(a) { if (state.armor > 0) { const t = Math.min(state.armor, a * 0.7); state.armor -= t; a -= t; } state.health -= a; state.shake = Math.max(state.shake, 0.25); }

// ============================================================ PEDESTRIANS
function spawnPeds() {
  const n = QUALITY === 'low' ? 22 : QUALITY === 'medium' ? 30 : 42;
  for (let k = 0; k < n; k++) {
    const look = randLook(); const h = makeHuman(look);
    const p = { h, bi: 0, bj: 0, s: 0, dir: 1, speed: R(1.1, 1.7), dead: false, deadT: 0, panic: 0, free: false, x: 0, z: 0, fleeX: 0, fleeZ: 0, yaw: 0 };
    placePed(p, true); peds.push(p);
  }
}
function placePed(p, anywhere) {
  for (let t = 0; t < 30; t++) {
    p.bi = RI(0, N - 1); p.bj = RI(0, N - 1);
    const b = blocks[p.bi][p.bj];
    if (anywhere || Math.hypot(b.cx - player.pos.x, b.cz - player.pos.z) > 90) break;
  }
  p.s = R(0, 1000); p.dir = rnd() < 0.5 ? 1 : -1; p.dead = false; p.free = false; p.panic = 0; p.h.g.rotation.x = 0; p.h.g.visible = true;
  const [x, z] = pathPos(p); p.x = x; p.z = z;
}
function pathPos(p) {
  const b = blocks[p.bi][p.bj], hs = BLOCK / 2 - 2, P = 8 * hs;
  const s = ((p.s % P) + P) % P, seg = Math.floor(s / (2 * hs)), f = s - seg * 2 * hs;
  let x, z;
  if (seg === 0) { x = -hs + f; z = -hs; } else if (seg === 1) { x = hs; z = -hs + f; } else if (seg === 2) { x = hs - f; z = hs; } else { x = -hs; z = hs - f; }
  return [b.cx + x, b.cz + z];
}
function attachToPath(p) {
  let b = blockAt(p.x, p.z);
  if (!b) b = blocks[clamp(Math.floor((p.x - OFF) / CELL), 0, N - 1)][clamp(Math.floor((p.z - OFF) / CELL), 0, N - 1)];
  p.bi = b.i; p.bj = b.j; const hs = BLOCK / 2 - 2;
  const lx = clamp(p.x - b.cx, -hs, hs), lz = clamp(p.z - b.cz, -hs, hs);
  const dE = [Math.abs(lz + hs), Math.abs(lx - hs), Math.abs(lz - hs), Math.abs(lx + hs)], seg = dE.indexOf(Math.min(...dE));
  const f = seg === 0 ? lx + hs : seg === 1 ? lz + hs : seg === 2 ? hs - lx : hs - lz;
  p.s = seg * 2 * hs + f; p.free = false;
}
function randomSidewalk() {
  const b = blocks[RI(0, N - 1)][RI(0, N - 1)], hs = BLOCK / 2 - 2, t = R(-hs, hs), side = RI(0, 3);
  return side === 0 ? [b.cx + t, b.cz - hs] : side === 1 ? [b.cx + t, b.cz + hs] : side === 2 ? [b.cx - hs, b.cz + t] : [b.cx + hs, b.cz + t];
}
function updatePeds(dt) {
  for (const p of peds) {
    if (p.npc) continue;
    const h = p.h;
    if (p.dead) {
      p.deadT -= dt;
      if (p.deadT <= 0 && dist2(p) > 3600) placePed(p, false);
      continue;
    }
    const d2p = dist2(p);
    if (d2p > 220 * 220 && !p.free) { placePed(p, false); }
    h.g.visible = d2p < 180 * 180;
    let speed = p.speed, ox = p.x, oz = p.z;
    if (p.panic > 0) p.panic -= dt;
    if (p.free || p.panic > 0) {
      // run away from threat
      const l = Math.hypot(p.fleeX, p.fleeZ) || 1; speed = 5;
      let nx = p.x + p.fleeX / l * speed * dt, nz = p.z + p.fleeZ / l * speed * dt;
      const r = collide(nx, nz, 0.35, 0.5); if (r.hit) { p.fleeX = p.fleeX * 0.2 + r.nx + MR(-0.5, 0.5); p.fleeZ = p.fleeZ * 0.2 + r.nz + MR(-0.5, 0.5); }
      p.x = r.x; p.z = r.z;
      if (p.panic <= 0) attachToPath(p);
    } else {
      p.s += p.dir * speed * dt;
      const [tx, tz] = pathPos(p);
      p.x = damp(p.x, tx, 5, dt); p.z = damp(p.z, tz, 5, dt);
    }
    const mvx = p.x - ox, mvz = p.z - oz, mv = Math.hypot(mvx, mvz);
    if (mv > 1e-4) p.yaw = wrapA(p.yaw + wrapA(Math.atan2(mvx, mvz) - p.yaw) * (1 - Math.exp(-10 * dt)));
    // car hits
    for (const c of cars) {
      if (!c.active) continue;
      const sp = carSpeed(c); if (sp < 5) continue;
      const cp = c.group.position, fx = Math.sin(c.h) * 1.2, fz = Math.cos(c.h) * 1.2;
      for (const sg of [1, 0, -1]) if (Math.hypot(p.x - cp.x - fx * sg, p.z - cp.z - fz * sg) < 1.35) {
        killPed(p, c.mode === 'player'); if (c.mode === 'player') { state.shake = 0.3; AudioSys.thud(); } break;
      }
      if (p.dead) break;
    }
    if (p.dead) { h.g.position.set(p.x, groundY(p.x, p.z) + 0.12, p.z); continue; }
    // panic when player car approaches fast
    if (state.inCar && d2p < 100 && carSpeed(state.inCar) > 8 && !p.free && p.panic <= 0) { p.panic = 3; p.fleeX = p.x - player.pos.x; p.fleeZ = p.z - player.pos.z; }
    h.g.position.set(p.x, groundY(p.x, p.z), p.z); h.g.rotation.y = p.yaw;
    if (h.g.visible) animHuman(h, mv / Math.max(dt, 1e-3), dt, false);
  }
}

// ============================================================ PICKUPS / MISSIONS
const pickups = []; let cashMesh, crateMesh, markerGroup, passenger = null;
const CRATES = { w1: ['#4aa8ff', 'UZI +120'], w2: ['#ffa030', 'POMPALI +16'], w3: ['#ff3050', 'ROKET +4'], hp: ['#ff8ab0', 'CAN DOLDU'], ar: ['#7affe0', 'ZIRH DOLDU'] };
function spawnPickups() {
  cashMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ map: cashTex(), emissive: 0x30ff70, emissiveIntensity: 0.6, emissiveMap: null }), 80);
  cashMesh.count = 0; cashMesh.frustumCulled = false; scene.add(cashMesh);
  for (let k = 0; k < 30; k++) { const [x, z] = randomSidewalk(); spawnCash(x, z, RI(5, 30) * 10, true); }
  const crateTex = canvasTex(64, 64, g => { g.fillStyle = '#333'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.fillRect(6, 6, 52, 52); g.fillStyle = '#333'; g.fillRect(28, 12, 8, 40); g.fillRect(12, 28, 40, 8); });
  crateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), new THREE.MeshStandardMaterial({ map: crateTex, emissive: 0x444444, roughness: 0.4 }), 40);
  crateMesh.setColorAt(0, new THREE.Color()); crateMesh.count = 0; crateMesh.frustumCulled = false; scene.add(crateMesh);
  for (const [kind, n] of [['w1', 6], ['w2', 5], ['w3', 3], ['hp', 5], ['ar', 4]]) for (let k = 0; k < n; k++) { const [x, z] = randomSidewalk(); spawnCash(x, z, 0, true, kind); }
  // mission marker
  markerGroup = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 70, 24, 1, true).translate(0, 35, 0), new THREE.MeshBasicMaterial({ map: beamTex(), color: 0xffc020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 40).rotateX(-Math.PI / 2).translate(0, 0.1, 0), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  markerGroup.add(beam, ring); markerGroup.visible = false; scene.add(markerGroup);
}
function spawnCash(x, z, amt, respawn, kind = 'cash') { if (pickups.length < 110) pickups.push({ x, z, amt, respawn, kind, t: Math.random() * 6 }); }
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(1, 1, 1), e4 = new THREE.Euler();
function updatePickups(dt) {
  let n = 0;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.t += dt;
    if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < (state.inCar ? 2.8 : 1.4)) {
      if (p.kind === 'cash') AudioSys.cash(); else AudioSys.pickup(); haptic(25);
      if (p.kind === 'cash') { earn(p.amt, '💵 Nakit'); floatText('+$' + p.amt); }
      else {
        floatText(CRATES[p.kind][1]);
        const wi = { w1: 1, w2: 3, w3: 4 }[p.kind]; if (wi) { state.ownedW[wi] = true; state.ammo[wi] += [0, 120, 0, 16, 4][wi]; }
        else if (p.kind === 'hp') state.health = 100; else state.armor = 100;
        if (p.kind[0] === 'w' && state.weapon === 0) state.weapon = { w1: 1, w2: 3, w3: 4 }[p.kind];
      }
      for (let k = 0; k < 8; k++) FX.add.spawn(p.x, 1, p.z, MR(-2, 2), MR(1, 4), MR(-2, 2), 0.5, 0.3, 0, 0.3, 2, 0.6, 1, 6);
      pickups.splice(i, 1);
      if (p.respawn) { const [x, z] = randomSidewalk(); setTimeout(() => spawnCash(x, z, RI(5, 30) * 10, true, p.kind), p.kind === 'cash' ? 0 : 45000); }
      continue;
    }
  }
  let nc = 0;
  for (const p of pickups) {
    m4.compose(tmpV.set(p.x, groundY(p.x, p.z) + 0.8 + Math.sin(p.t * 3) * 0.15, p.z), q4.setFromEuler(e4.set(0.3, p.t * 2, 0.2)), s4);
    if (p.kind === 'cash') { if (n < 80) cashMesh.setMatrixAt(n++, m4); }
    else if (nc < 40) { crateMesh.setMatrixAt(nc, m4); crateMesh.setColorAt(nc++, tmpC2.set(CRATES[p.kind][0])); }
  }
  cashMesh.count = n; cashMesh.instanceMatrix.needsUpdate = true;
  crateMesh.count = nc; crateMesh.instanceMatrix.needsUpdate = true; if (crateMesh.instanceColor) crateMesh.instanceColor.needsUpdate = true;
}
const MCOL = { reach: 0xffc020, race: 0x20e0ff, taxi: 0x40ff80, hit: 0xff3040, delivery: 0xff9a20, bounty: 0xff2050 };
function setMarker(x, z, type) {
  markerGroup.position.set(x, 0, z); markerGroup.visible = true;
  markerGroup.children[0].material.color.setHex(MCOL[type]); markerGroup.children[1].material.color.setHex(MCOL[type]);
}
function farNode(d0, d1, fx = player.pos.x, fz = player.pos.z) {
  let bestN = null;
  for (let t = 0; t < 80; t++) { const i = RI(0, N), j = RI(0, N), x = nodeP(i), z = nodeP(j), d = Math.hypot(x - fx, z - fz); if (d > d0 && d < d1) return [x, z, d]; if (!bestN || Math.abs(d - d0) < Math.abs(bestN[2] - d0)) bestN = [x, z, d]; }
  return bestN;
}
function retireDeliveryCar() {
  const old = state.dcar; if (!old || old === state.inCar) return;
  old.active = false; old.group.visible = false; old.dead = true; state.dcar = null;
}
function newMission(type = pick(['reach', 'race', 'race', 'taxi', 'taxi', 'hit']), sx = player.pos.x, sz = player.pos.z) {
  haptic(40);
  if (type === 'delivery') {
    // a special car appears next to the start ring; bring it to the garage
    retireDeliveryCar();
    const c = createCar(pick(['super', 'sport']), pick(['#d4a017', '#c0c4ca', '#8a1018', '#101014']), sx + 6, sz, Math.PI / 2, 'free');
    c.driver = false; c.delivery = true; state.dcar = c;
    const g = SHOPS.find(o => o.type === 'garage'), d = Math.hypot(g.x - sx, g.z - sz);
    const reward = Math.round((1800 + d * 2.5) / 10) * 10;
    state.mission = { type, stage: 0, car: c, x: sx, z: sz, time: 45, reward, base: reward };
    setMarker(sx, sz, type);
    showBig('ARAÇ TESLİMATI', '#ff9a20', 3, `Lüks aracı al, polislerden kaç ve garaja hasarsız getir · $${reward}`);
    return;
  }
  if (type === 'race') {
    const cps = []; let fx = player.pos.x, fz = player.pos.z, total = 25;
    for (let k = 0; k < 5; k++) { const n = farNode(110, 230, fx, fz); cps.push(n); total += n[2] / 16 + 4; fx = n[0]; fz = n[1]; }
    const reward = Math.round(total * 30 / 10) * 10;
    state.mission = { type, cps, idx: 0, x: cps[0][0], z: cps[0][1], time: Math.round(total), reward };
    setMarker(cps[0][0], cps[0][1], type);
    showBig('YARIŞ', '#3ff2ff', 2.5, `5 kontrol noktası · ${Math.round(total)} sn · Ödül $${reward}`);
  } else if (type === 'taxi') {
    const [x, z] = farNode(70, 200);
    if (!passenger) passenger = makeHuman({ skin: pick(SKIN), shirt: '#ffd23a', pants: '#1d1d24', hair: pick(HAIR) });
    const px = x + ROAD / 2 + 1.5, pz = z + ROAD / 2 + 1.5;
    passenger.g.position.set(px, 0.25, pz); passenger.g.rotation.set(0, -Math.PI * 0.75, 0); passenger.g.visible = true;
    state.mission = { type, stage: 0, x, z, time: 60, reward: 0 };
    setMarker(x, z, type);
    showBig('TAKSİ', '#7dff9a', 2.5, 'Yolcuyu al ve gideceği yere götür');
  } else if (type === 'hit') {
    const cand = cars.filter(c => c.active && c.mode === 'ai' && !c.dead && Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) > 120);
    if (!cand.length) return newMission('race', sx, sz);
    const c = pick(cand); c.health = 140;
    state.mission = { type, target: c, x: 0, z: 0, time: 120, reward: 1500 };
    setMarker(c.group.position.x, c.group.position.z, type);
    showBig('SUİKAST', '#ff4060', 2.5, 'Kırmızı işaretli aracı yok et · Ödül $1500');
  } else {
    const [x, z, d] = farNode(220, 520);
    const time = Math.round(d / 11 + 25), reward = Math.round((300 + d * 1.6) / 10) * 10;
    state.mission = { type, x, z, time, reward };
    setMarker(x, z, type);
    showBig('GÖREV', '#ffd23a', 2, `İşarete ${time} saniyede ulaş · Ödül $${reward}`);
  }
}
function missionPos() { const m = state.mission; if (m.type === 'bounty') return [m.boss.x, m.boss.z]; return m.type === 'hit' ? [m.target.group.position.x, m.target.group.position.z] : m.type === 'delivery' && m.stage === 0 ? [m.car.group.position.x, m.car.group.position.z] : [m.x, m.z]; }
function missionEnd(ok, sub) {
  const m = state.mission;
  if (ok) S().missions++; else S().fails++;
  if (m.type === 'bounty') setTimeout(() => { if (!state.mission || state.mission.type !== 'bounty') hideBounty(m); }, ok ? 9000 : 0);
  if (ok) { earn(m.reward, '🎯 Görev'); showBig('GÖREV TAMAMLANDI', '#7dff9a', 3, `+$${m.reward}` + (sub ? ' · ' + sub : '')); AudioSys.success(); AudioSys.cash(); haptic([40, 40, 90]); state.armor = Math.min(100, state.armor + 25); state.ammo[1] += 60; saveGame(); }
  else { showBig('GÖREV BAŞARISIZ', '#ff3b3b', 2.5, sub); AudioSys.fail(); haptic(120); }
  if (passenger) passenger.g.visible = false;
  state.mission = null; markerGroup.visible = false; state.missionCooldown = 4;
}
function updateMission(dt) {
  const m = state.mission, el = $('mission');
  if (!m) { el.style.display = 'none'; return; }
  m.time -= dt;
  const [tx, tz] = missionPos(), d = Math.hypot(tx - player.pos.x, tz - player.pos.z), t = Math.max(0, Math.ceil(m.time));
  const c = state.inCar, sp = c ? carSpeed(c) : 0;
  el.style.display = 'block';
  el.style.borderLeftColor = m.time < 10 ? '#ff3b3b' : '#' + MCOL[m.type].toString(16).padStart(6, '0');
  markerGroup.children[0].material.opacity = 0.7 + Math.sin(state.now * 4) * 0.3;
  markerGroup.children[1].scale.setScalar(1 + Math.sin(state.now * 3) * 0.1);
  const rw = ` · 💵 $${m.reward}`;
  if (m.type === 'delivery') {
    const dc = m.car, hp = Math.max(0, Math.round(dc.health / dc.maxHealth * 100));
    if (dc.dead) return missionEnd(false, 'Teslimat aracı yok oldu');
    if (m.stage === 0) {
      markerGroup.position.set(tx, dc.y, tz);
      el.textContent = `📦 Lüks araca bin · ${t} sn · ${Math.round(d)} m` + rw;
      if (c === dc) {
        const g = SHOPS.find(o => o.type === 'garage'), dd = Math.hypot(g.x - player.pos.x, g.z - player.pos.z);
        m.stage = 1; m.x = g.x; m.z = g.z; m.time = Math.round(dd / 11 + 40); setMarker(g.x, g.z, 'delivery');
        state.heat = Math.max(state.heat, 2.3); state.crimeTimer = 0;
        showBig('POLİS PEŞİNDE!', '#ff4040', 2.5, 'Aracı garaja götür · hasar ödülü düşürür');
      }
    } else {
      m.reward = Math.round(m.base * (0.3 + 0.7 * hp / 100) / 10) * 10;
      el.textContent = `📦 Garaja teslim et · ${t} sn · ${Math.round(d)} m · Sağlam %${hp} · 💵 $${m.reward}`;
      if (c === dc && d < 6) {
        exitCar(true); dc.active = false; dc.group.visible = false; state.dcar = null;
        return missionEnd(true, `Araç %${hp} sağlam teslim edildi`);
      }
      if (c !== dc && Math.hypot(dc.group.position.x - player.pos.x, dc.group.position.z - player.pos.z) > 60) return missionEnd(false, 'Aracı terk ettin');
    }
  } else if (m.type === 'bounty') {
    updateBounty(dt, m);
    const alive = m.guards.filter(g => !g.dead).length;
    markerGroup.position.set(tx, 0, tz);
    el.textContent = `💀 Kontrat: ${m.name} · 🛡 ${alive}/${m.guards.length} · ${t} sn · ${Math.round(d)} m` + rw;
    if (m.boss.dead) { const bonus = (m.guards.length - alive) * 150; m.reward += bonus; S().contracts++; return missionEnd(true, bonus ? `Koruma bonusu $${bonus}` : 'Temiz iş'); }
  } else if (m.type === 'reach') {
    el.textContent = `🎯 İşarete ulaş · ${t} sn · ${Math.round(d)} m` + rw;
    if (d < 6) return missionEnd(true);
  } else if (m.type === 'race') {
    el.textContent = `🏁 Yarış ${m.idx + 1}/${m.cps.length} · ${t} sn · ${Math.round(d)} m` + rw + (c ? '' : ' · Araca bin!');
    if (d < 8 && c) {
      m.idx++; AudioSys.pickup(); haptic(30); floatText(`✓ ${m.idx}/${m.cps.length}`);
      if (m.idx >= m.cps.length) return missionEnd(true, `${t} sn kaldı`);
      m.x = m.cps[m.idx][0]; m.z = m.cps[m.idx][1]; setMarker(m.x, m.z, 'race');
    }
  } else if (m.type === 'taxi') {
    if (m.stage === 0) {
      el.textContent = `🚕 Yolcuyu al · ${t} sn · ${Math.round(d)} m` + (c && c.spec.bike ? ' · Araba lazım!' : '');
      const h = passenger; h.armR.rotation.x = -2.6 + Math.sin(state.now * 8) * 0.4; h.armR.rotation.z = -0.3;
      if (d < 9 && c && !c.spec.bike && sp < 3) {
        passenger.g.visible = false; m.stage = 1;
        const [x, z, dd] = farNode(230, 450); m.x = x; m.z = z; m.time = Math.round(dd / 11 + 22); m.reward = Math.round((200 + dd * 1.3) / 10) * 10;
        setMarker(x, z, 'taxi'); floatText('Yolcu bindi'); AudioSys.door();
      }
    } else {
      el.textContent = `🚕 Yolcuyu bırak · ${t} sn · ${Math.round(d)} m`;
      if (d < 8 && c && sp < 3.5) { const tip = Math.round(m.time * 8); m.reward += tip; return missionEnd(true, `Bahşiş $${tip}`); }
      if (!c) return missionEnd(false, 'Yolcu kaçtı');
    }
  } else if (m.type === 'hit') {
    const tc = m.target;
    markerGroup.position.set(tx, tc.y, tz);
    el.textContent = `💀 Hedef aracı yok et · ${t} sn · ${Math.round(d)} m` + rw;
    if (tc.dead) return missionEnd(true);
    if (!tc.active) return missionEnd(false, 'Hedef kayboldu');
    if (d < 40 && tc.ai) tc.ai.panic = 3;
  }
  if (m.time <= 0) missionEnd(false, 'Süre doldu');
}

// ============================================================ FX (particles, tracers, explosions)
const FX = {};
class Particles {
  constructor(max, additive) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.life0 = new Float32Array(max); this.s0 = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: innerHeight * renderer.getPixelRatio() * 0.5 } },
      vertexShader: `attribute float psize; attribute vec4 pcolor; varying vec4 vC; uniform float uScale;
        void main(){ vC = pcolor; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = psize*uScale/max(0.1,-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.05,d)*vC.a; if(a<0.01) discard; gl_FragColor = vec4(vC.rgb*${additive ? 'a' : '1.0'}, ${additive ? '1.0' : 'a'}); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; scene.add(this.pts);
  }
  spawn(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a, grav) {
    if (this.n >= this.max) return; const i = this.n++;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.col.set([r, g, b, a], i * 4);
    this.life[i] = this.life0[i] = life; this.s0[i] = size; this.grow[i] = grow; this.a0[i] = a; this.grav[i] = grav; this.size[i] = size;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { // swap with last
        const l = --this.n;
        this.pos.copyWithin(i * 3, l * 3, l * 3 + 3); this.vel.copyWithin(i * 3, l * 3, l * 3 + 3); this.col.copyWithin(i * 4, l * 4, l * 4 + 4);
        for (const arr of [this.life, this.life0, this.s0, this.grow, this.a0, this.grav, this.size]) arr[i] = arr[l];
        i--; continue;
      }
      const t = 1 - this.life[i] / this.life0[i];
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-1.5 * dt);
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= drag; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
      this.size[i] = this.s0[i] + this.grow[i] * t;
      this.col[i * 4 + 3] = this.a0[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = this.geo.attributes.pcolor.needsUpdate = this.geo.attributes.psize.needsUpdate = true;
  }
}
function initFX() {
  FX.add = new Particles(700, true); FX.norm = new Particles(900, false);
  const tg = new THREE.BufferGeometry(); const TP = new Float32Array(40 * 6), TC = new Float32Array(40 * 6);
  tg.setAttribute('position', new THREE.BufferAttribute(TP, 3).setUsage(THREE.DynamicDrawUsage)); tg.setAttribute('color', new THREE.BufferAttribute(TC, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false; scene.add(lines);
  const tr = []; FX.tracers = tr;
  FX.tracer = (ax, ay, az, bx, by, bz, red) => { if (tr.length >= 40) tr.shift(); tr.push({ a: [ax, ay, az], b: [bx, by, bz], t: 0.12, red }); };
  FX.updateTracers = dt => {
    let n = 0;
    for (let i = tr.length - 1; i >= 0; i--) { tr[i].t -= dt; if (tr[i].t <= 0) tr.splice(i, 1); }
    for (const t of tr) {
      const k = t.t / 0.12 * 3, c = t.red ? [k, k * 0.35, k * 0.2] : [k, k * 0.85, k * 0.45];
      TP.set(t.a, n * 6); TP.set(t.b, n * 6 + 3); TC.set(c, n * 6); TC.set(c.map(v => v * 0.3), n * 6 + 3); n++;
    }
    tg.setDrawRange(0, n * 2); tg.attributes.position.needsUpdate = tg.attributes.color.needsUpdate = true;
  };
}
function explosion(x, y, z, byPlayer) {
  for (let k = 0; k < 60; k++) FX.add.spawn(x, y, z, MR(-8, 8), MR(2, 12), MR(-8, 8), MR(0.4, 1.1), MR(1.5, 3), 3, 3, MR(0.8, 1.6), 0.2, 1, 4);
  for (let k = 0; k < 40; k++) FX.norm.spawn(x + MR(-1, 1), y + MR(0, 2), z + MR(-1, 1), MR(-3, 3), MR(2, 7), MR(-3, 3), MR(2, 4), MR(2, 3), 6, 0.12, 0.11, 0.1, 0.8, -0.5);
  for (let k = 0; k < 25; k++) FX.add.spawn(x, y, z, MR(-15, 15), MR(5, 18), MR(-15, 15), MR(0.5, 1.2), 0.25, 0, 3, 2, 0.6, 1, 18);
  M.flash.position.set(x, y + 2, z); M.flash.intensity = 4000;
  AudioSys.boom();
  const dp = Math.hypot(player.pos.x - x, player.pos.z - z);
  state.shake = Math.max(state.shake, clamp(1 - dp / 60, 0, 1));
  if (!state.inCar && dp < 9) { applyDamage(70 * (1 - dp / 9)); player.vy = 6; player.onGround = false; }
  if (state.inCar && dp < 8) damageCar(state.inCar, 50 * (1 - dp / 8));
  for (const p of peds) if (!p.dead && Math.hypot(p.x - x, p.z - z) < 8) killPed(p, !!byPlayer);
  for (const c of cars) if (c.active && !c.dead && c !== state.inCar) { const d = Math.hypot(c.group.position.x - x, c.group.position.z - z); if (d < 8 && d > 0.1) { setTimeout(() => damageCar(c, 60 * (1 - d / 8)), 150); c.vx += (c.group.position.x - x) / d * 8; c.vz += (c.group.position.z - z) / d * 8; } }
}
function carSmoke(dt) {
  for (const c of cars) {
    if (!c.active || (c.health > 35 && !c.dead)) continue;
    if (Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) > 120) continue;
    c.smokeT -= dt; if (c.smokeT > 0) continue; c.smokeT = c.dead ? 0.05 : 0.12;
    const p = c.group.position, hx = p.x + Math.sin(c.h) * 1.6, hz = p.z + Math.cos(c.h) * 1.6;
    if (c.dead) { FX.add.spawn(p.x + MR(-0.8, 0.8), p.y + 1, p.z + MR(-0.8, 0.8), MR(-0.5, 0.5), MR(2, 4), MR(-0.5, 0.5), 0.6, 1.2, 1, 2.5, 0.9, 0.2, 0.9, -1); FX.norm.spawn(p.x, p.y + 1.5, p.z, MR(-1, 1), MR(2, 4), MR(-1, 1), 3, 1.5, 5, 0.08, 0.08, 0.08, 0.6, -0.5); }
    else FX.norm.spawn(hx, p.y + 1.1, hz, MR(-0.5, 0.5), MR(1.5, 3), MR(-0.5, 0.5), 2, 0.8, 3, c.health < 15 ? 0.1 : 0.5, c.health < 15 ? 0.1 : 0.5, c.health < 15 ? 0.1 : 0.52, 0.5, -0.5);
  }
}

// ============================================================ CAR-CAR COLLISIONS
function carCollisions() {
  const act = cars.filter(c => c.active);
  for (let a = 0; a < act.length; a++) for (let b = a + 1; b < act.length; b++) {
    const A = act[a], B = act[b], pa = A.group.position, pb = B.group.position;
    if (A.mode === 'ai' && B.mode === 'ai') continue;
    if (Math.abs(pa.x - pb.x) > 6 || Math.abs(pa.z - pb.z) > 6) continue;
    for (const sa of [1, -1]) for (const sb of [1, -1]) {
      const oa = A.spec.co ?? 1.2, ob = B.spec.co ?? 1.2;
      const ax = pa.x + Math.sin(A.h) * oa * sa, az = pa.z + Math.cos(A.h) * oa * sa, bx = pb.x + Math.sin(B.h) * ob * sb, bz = pb.z + Math.cos(B.h) * ob * sb;
      const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), R2 = (A.spec.cr ?? 1.1) + (B.spec.cr ?? 1.1);
      if (d >= R2 || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, push = (R2 - d) / 2;
      const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
      const impact = -rv;
      if (A.mode === 'ai' && (impact > 5 || B.mode === 'player')) aiToFree(A);
      if (B.mode === 'ai' && (impact > 5 || A.mode === 'player')) aiToFree(B);
      if (A.mode !== 'ai') { pa.x -= nx * push; pa.z -= nz * push; } if (B.mode !== 'ai') { pb.x += nx * push; pb.z += nz * push; }
      if (rv < 0) {
        const j = -rv * 0.8;
        if (A.mode !== 'ai') { A.vx -= nx * j; A.vz -= nz * j; } if (B.mode !== 'ai') { B.vx += nx * j; B.vz += nz * j; }
        if (impact > 8) { damageCar(A, impact * 1.2, true); damageCar(B, impact * 1.2, true); }
        if (impact > 9) { bikeCrash(A, impact); bikeCrash(B, impact); }
        if ((A.mode === 'player' || B.mode === 'player') && impact > 3) {
          state.shake = Math.min(1, impact / 20); AudioSys.crash(impact / 25);
          const other = A.mode === 'player' ? B : A;
          if (impact > 6 && (other.police || (other.driver && state.now > state.crashHeatT))) { addHeat(other.police ? 0.5 : 0.35); state.crashHeatT = state.now + 2.5; }
        }
      }
    }
  }
}
function aiToFree(c) {
  if (c.mode !== 'ai') return;
  c.mode = 'free'; c.ai = null; c.honk = 1;
  setTimeout(() => { if (c.mode === 'free' && !c.dead && c.driver && Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) > 100) placeOnRoad(c, false); }, 15000);
}

// ============================================================ SKY / TIME
const C_DAY = new THREE.Color(0xb8cde0), C_SET = new THREE.Color(0xf09a6a), C_NIGHT = new THREE.Color(0x0a0f1e), tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
const sunDir = new THREE.Vector3();
let nightF = 0;
let rainLines, rainPos, cloudDome;
const RAIN_N = 1400;
function buildWeather() {
  rainPos = new Float32Array(RAIN_N * 6);
  for (let i = 0; i < RAIN_N; i++) { const x = MR(-25, 25), y = MR(0, 30), z = MR(-25, 25); rainPos.set([x, y, z, x, y - 0.9, z], i * 6); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  rainLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb0c4e0, transparent: true, opacity: 0.45, depthWrite: false }));
  rainLines.frustumCulled = false; rainLines.visible = false; scene.add(rainLines);
}
function updateWeather(dt) {
  state.weatherT -= dt;
  if (state.weatherT <= 0) {
    const was = state.rainTarget > 0;
    state.rainTarget = !was && Math.random() < 0.45 ? MR(0.6, 1) : 0;
    state.weatherT = state.rainTarget ? MR(70, 140) : MR(100, 200);
    if (state.rainTarget) floatText('🌧 Yağmur başladı');
  }
  state.rain = damp(state.rain, state.rainTarget, 0.12, dt);
  const rain = state.rain;
  rainLines.visible = rain > 0.02;
  if (rainLines.visible) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, n = Math.floor(RAIN_N * rain * (QUALITY === 'low' ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const o = i * 6; let x = rainPos[o], y = rainPos[o + 1] - 32 * dt, z = rainPos[o + 2];
      if (y < cy - 8) { y += 30; x = cx + MR(-25, 25); z = cz + MR(-25, 25); }
      if (x - cx > 25) x -= 50; else if (x - cx < -25) x += 50; if (z - cz > 25) z -= 50; else if (z - cz < -25) z += 50;
      rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z; rainPos[o + 3] = x + 0.08; rainPos[o + 4] = y - 0.9; rainPos[o + 5] = z;
    }
    rainLines.geometry.setDrawRange(0, n * 2); rainLines.geometry.attributes.position.needsUpdate = true;
    rainLines.material.opacity = 0.25 + 0.3 * (1 - nightF);
  }
  if (rain > 0.6 && Math.random() < dt * 0.07) { state.lightning = 1; setTimeout(() => AudioSys.thunder(), MR(300, 1800)); }
  state.lightning = Math.max(0, state.lightning - dt * (Math.random() < 0.5 ? 3 : 9));
  clouds.position.copy(camera.position); clouds.material.uniforms.uTime.value = state.now;
  M.road.roughness = lerp(0.82, 0.12, rain); M.road.color.setScalar(lerp(1, 0.6, rain)); M.road.envMapIntensity = 1 + rain * 1.5;
  M.sidewalk.roughness = lerp(0.9, 0.3, rain); M.sidewalk.color.setHex(0xc4c0b8).multiplyScalar(lerp(1, 0.7, rain));
}
function updateSky(dt) {
  state.time = (state.time + dt * TIME_SPEED) % 24;
  const ang = (state.time - 6) / 24 * Math.PI * 2;
  sunDir.set(-Math.cos(ang), Math.sin(ang), 0.35).normalize();
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  const y = sunDir.y;
  const night = smooth(0.05, -0.14, y), day = 1 - night, sunset = 1 - smooth(0.0, 0.38, Math.abs(y));
  nightF = night;
  const tgt = player.pos;
  sunLight.target.position.copy(tgt);
  if (y > -0.05) {
    sunLight.position.copy(tgt).addScaledVector(sunDir, 400);
    sunLight.intensity = 3.4 * smooth(-0.05, 0.22, y);
    sunLight.color.setHex(0xfff2e0).lerp(tmpC.setHex(0xff8040), sunset * 0.8);
  } else {
    tmpV2.set(-sunDir.x, -sunDir.y, sunDir.z).normalize();
    sunLight.position.copy(tgt).addScaledVector(tmpV2, 400);
    sunLight.intensity = 0.5 * smooth(-0.05, -0.22, y);
    sunLight.color.setHex(0x8fa8ff);
  }
  hemi.intensity = 0.14 + 0.56 * day;
  hemi.color.setHex(0x34446e).lerp(tmpC.setHex(0xbfd8ff), day);
  hemi.groundColor.setHex(0x151018).lerp(tmpC.setHex(0x4a3a28), day);
  const fog = tmpC.copy(C_DAY).lerp(C_SET, sunset * 0.85).lerp(C_NIGHT, night);
  const rain = state.rain;
  if (rain > 0.001) fog.lerp(tmpC2.setRGB(0.3, 0.32, 0.35).multiplyScalar(0.2 + 0.8 * day), rain * 0.8);
  scene.fog.color.copy(fog);
  scene.fog.near = lerp(150, 25, rain); scene.fog.far = lerp(QUALITY === 'low' ? 600 : 900, 300, rain);
  sunLight.intensity *= 1 - 0.8 * rain;
  hemi.intensity = hemi.intensity * (1 - 0.25 * rain) + state.lightning * 3;
  renderer.toneMappingExposure = (0.85 + night * 0.1) * (1 - 0.12 * rain);
  stars.material.opacity = night;
  for (const k in M.fac) M.fac[k].emissiveIntensity = night * (k === 'glass' ? 0.45 : 0.6);
  M.sign.emissiveIntensity = night * 0.85;
  M.lampHead.color.setRGB(1, 0.85, 0.55).multiplyScalar(0.3 + night * 3.2);
  M.pool.opacity = night * 0.6;
  M.carLight.color.setScalar(0.9 + night * 2.6);
  const cu = clouds.material.uniforms;
  cu.uSunDir.value.copy(y > -0.05 ? sunDir : tmpV2); cu.uCover.value = 0.42 + state.rain * 0.58;
  cu.uLit.value.setRGB(1, 0.97, 0.92).lerp(tmpC2.setRGB(1, 0.62, 0.42), sunset * 0.8).multiplyScalar(0.06 + 0.94 * day).lerp(tmpC2.setRGB(0.42, 0.44, 0.47), state.rain * 0.75).addScalar(state.lightning);
  cu.uShade.value.setRGB(0.58, 0.62, 0.7).lerp(tmpC2.setRGB(0.55, 0.4, 0.45), sunset * 0.6).multiplyScalar(0.05 + 0.95 * day).lerp(tmpC2.setRGB(0.22, 0.23, 0.25).multiplyScalar(0.2 + 0.8 * day), state.rain * 0.8);
  if (bloomPass) bloomPass.strength = 0.18 + night * 0.3 + sunset * 0.08;
  // ocean
  const u = ocean.material.uniforms;
  u.uSunDir.value.copy(sunDir); u.uSunCol.value.copy(sunLight.color).multiplyScalar((y > 0 ? 1 : 0.15) * (1 - rain));
  u.uHorizon.value.copy(fog); u.uZenith.value.setHex(0x3a6ea8).lerp(tmpC2.setHex(0x6a4a8a), sunset * 0.6).lerp(tmpC2.setHex(0x050810), night);
  u.uDeep.value.setHex(0x0b4a6e).multiplyScalar(0.15 + 0.85 * day); u.uShallow.value.setHex(0x2ab8b0).multiplyScalar(0.12 + 0.88 * day);
  u.uFogColor.value.copy(fog); u.uFogNear.value = scene.fog.near; u.uFogFar.value = scene.fog.far; u.uDay.value = day;
  envTimer += dt;
  if (envTimer > 3) { envTimer = 0; if (envRT) envRT.dispose(); envRT = pmrem.fromScene(envScene, 0.02); scene.environment = envRT.texture; }
  const hh = Math.floor(state.time), mm = Math.floor((state.time - hh) * 60);
  $('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// ============================================================ CAMERA
function updateCamera(dt) {
  const c = state.inCar;
  const tx = player.pos.x, ty = player.pos.y + (c ? 1.7 : 1.55), tz = player.pos.z;
  camYaw -= input.lookDX; camPitch = clamp(camPitch + input.lookDY, -0.35, 1.25);
  if (input.lookDX || input.lookDY) state.lastLookInput = state.now;
  input.lookDX = input.lookDY = 0;
  let dist = 4.6;
  if (c) {
    const sp = carSpeed(c);
    dist = (c.spec.bike ? 5.6 : 8.2) + Math.min(sp, 50) * 0.06;
    if (state.now - state.lastLookInput > 1.3 && sp > 2) {
      const behind = (carFwd(c) < -1 ? c.h : c.h + Math.PI);
      camYaw += wrapA(behind - camYaw) * (1 - Math.exp(-3.5 * dt));
      camPitch = damp(camPitch, 0.2, 2, dt);
    }
    camera.fov = damp(camera.fov, 60 + Math.min(sp, 55) * 0.32, 3, dt);
  } else camera.fov = damp(camera.fov, 60, 3, dt);
  camera.updateProjectionMatrix();
  camDist = damp(camDist, dist, 4, dt);
  const cp = Math.cos(camPitch), dx = Math.sin(camYaw) * cp, dy = Math.sin(camPitch), dz = Math.cos(camYaw) * cp;
  let d = camDist;
  for (let k = 1; k <= 14; k++) { const t = k / 14 * camDist; if (insideBuilding(tx + dx * t, ty + dy * t, tz + dz * t)) { d = Math.max(1.2, t - 0.6); break; } }
  let cx = tx + dx * d, cy = ty + dy * d, cz = tz + dz * d;
  cy = Math.max(cy, groundY(cx, cz) + 0.4);
  if (state.shake > 0) { const s = state.shake * 0.35; cx += MR(-s, s); cy += MR(-s, s); cz += MR(-s, s); state.shake = Math.max(0, state.shake - dt * 2.2); }
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty + 0.2, tz);
  // headlight spotlight on player car at night
  if (c && nightF > 0.2) {
    M.headSpot.intensity = 250 * nightF;
    M.headSpot.position.set(c.group.position.x + Math.sin(c.h) * 2.4, c.y + 0.8, c.group.position.z + Math.cos(c.h) * 2.4);
    M.headSpot.target.position.set(c.group.position.x + Math.sin(c.h) * 22, c.y - 1, c.group.position.z + Math.cos(c.h) * 22);
  } else M.headSpot.intensity = 0;
}

// ============================================================ INPUT
const input = { mx: 0, my: 0, lookDX: 0, lookDY: 0, fire: false, jump: false, sprint: false, gas: false, brake: false, hand: false };
const keys = {};
const touchState = { joyId: null, jx: 0, jy: 0, jdx: 0, jdy: 0, lookId: null, lx: 0, ly: 0 };
function initInput() {
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if ((e.code === 'KeyP' || e.code === 'Tab') && !state.shopOpen) { e.preventDefault(); togglePhone(); return; }
    if (state.phoneOpen) { if (e.code === 'Escape') closePhone(); return; }
    if (e.code === 'KeyE' && !state.shopOpen) { if (!interact()) enterCar(); }
    else if (e.code === 'KeyF' || e.code === 'Enter') enterCar();
    if (/^Digit[1-5]$/.test(e.code)) selectWeapon(+e.code[5] - 1);
    if (e.code === 'KeyX') nextWeapon();
    if (e.code === 'KeyR') toggleRadio();
    if (e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  $('shopClose').addEventListener('click', closeShop);
  addEventListener('keydown', e => { if (e.code === 'Escape' && state.shopOpen) closeShop(); });
  const cv = renderer.domElement;
  cv.addEventListener('click', () => { if (!isTouch && !state.phoneOpen && !state.shopOpen && document.pointerLockElement !== cv) cv.requestPointerLock?.(); });
  addEventListener('mousemove', e => { if (document.pointerLockElement === cv) { input.lookDX += e.movementX * 0.0025; input.lookDY += e.movementY * 0.002; } });
  addEventListener('mousedown', e => { if (e.button === 0 && document.pointerLockElement === cv) keys.Mouse0 = true; });
  addEventListener('mouseup', e => { if (e.button === 0) keys.Mouse0 = false; });
  addEventListener('wheel', e => { if (document.pointerLockElement === cv) nextWeapon(e.deltaY > 0 ? 1 : -1); });

  const layer = $('touch'), joy = $('joy'), knob = $('knob');
  const opts = { passive: false };
  layer.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.target.classList.contains('btn')) continue;
      if (t.clientX < innerWidth * 0.42 && touchState.joyId === null) {
        $('joyHint').style.display = 'none';
        touchState.joyId = t.identifier; touchState.jx = t.clientX; touchState.jy = t.clientY; touchState.jdx = touchState.jdy = 0;
        joy.style.display = 'block'; joy.style.left = t.clientX + 'px'; joy.style.top = t.clientY + 'px'; knob.style.transform = '';
      } else if (touchState.lookId === null) { touchState.lookId = t.identifier; touchState.lx = t.clientX; touchState.ly = t.clientY; }
    }
  }, opts);
  layer.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.joyId) {
        let dx = t.clientX - touchState.jx, dy = t.clientY - touchState.jy; const l = Math.hypot(dx, dy), mx = 55;
        if (l > mx) { dx = dx / l * mx; dy = dy / l * mx; }
        touchState.jdx = dx / mx; touchState.jdy = dy / mx; knob.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (t.identifier === touchState.lookId) {
        input.lookDX += (t.clientX - touchState.lx) * 0.006; input.lookDY += (t.clientY - touchState.ly) * 0.0045;
        touchState.lx = t.clientX; touchState.ly = t.clientY;
      }
    }
  }, opts);
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.joyId) { touchState.joyId = null; touchState.jdx = touchState.jdy = 0; joy.style.display = 'none'; }
      if (t.identifier === touchState.lookId) touchState.lookId = null;
    }
  };
  layer.addEventListener('touchend', end); layer.addEventListener('touchcancel', end);
  const btn = (id, key, onPress) => {
    const el = $(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); keys[key] = true; el.classList.add('down'); onPress && onPress(); }, opts);
    const up = e => { e.preventDefault(); keys[key] = false; el.classList.remove('down'); };
    el.addEventListener('touchend', up, opts); el.addEventListener('touchcancel', up, opts);
  };
  btn('bFire', 'TFire'); btn('bJump', 'TJump'); btn('bGas', 'TGas'); btn('bBrake', 'TBrake'); btn('bHand', 'THand');
  btn('bEnter', 'TEnter', enterCar);
  btn('bWeapon', 'TW', () => nextWeapon()); btn('bRadio', 'TR', toggleRadio); btn('bAct', 'TA', interact);
  $('bRadio').textContent = ['📻', '🔈', '🔇'][state.soundMode];
}
function readInput() {
  const k = keys;
  if (state.phoneOpen) { Object.assign(input, { mx: 0, my: 0, lookDX: 0, lookDY: 0, fire: false, jump: false, sprint: false, gas: false, brake: false, hand: false }); return; }
  let mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  let my = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  if (touchState.joyId !== null) { mx += touchState.jdx; my -= touchState.jdy; }
  input.mx = clamp(mx, -1, 1); input.my = clamp(my, -1, 1);
  input.fire = !!(k.Mouse0 || k.TFire || k.KeyQ);
  input.jump = !!(k.TJump || (!state.inCar && k.Space));
  input.hand = !!(k.THand || (state.inCar && k.Space));
  input.sprint = !!(k.ShiftLeft || k.ShiftRight);
  input.gas = !!k.TGas; input.brake = !!k.TBrake;
}

// ============================================================ HUD
let floatEl = null;
function showBig(text, color, dur, sub) {
  const el = $('bigMsg'); el.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); el.style.color = color; el.style.opacity = 1;
  clearTimeout(showBig.t); showBig.t = setTimeout(() => el.style.opacity = 0, dur * 1000);
}
function floatText(t) {
  const el = document.createElement('div'); el.textContent = t;
  el.style.cssText = 'position:absolute;right:20px;top:110px;font:400 30px "Bebas Neue",Impact;color:#7dff9a;text-shadow:2px 2px 0 #000;transition:all 1.2s ease-out;opacity:1';
  $('hud').appendChild(el); requestAnimationFrame(() => { el.style.transform = 'translateY(-40px)'; el.style.opacity = 0; }); setTimeout(() => el.remove(), 1300);
}
let mapBase, mapCtx, lastStars = -1;
const MAP = { x0: -HALF - 150, x1: WATERLINE + 160 }; MAP.size = MAP.x1 - MAP.x0;
function buildMinimapBase() {
  const S = 1024, k = S / MAP.size, X = x => (x - MAP.x0) * k, Z = z => (z - MAP.x0 - (MAP.size - (MAP.x1 - MAP.x0)) / 2) * k;
  mapBase = document.createElement('canvas'); mapBase.width = mapBase.height = S;
  const g = mapBase.getContext('2d');
  g.fillStyle = '#2c4a2a'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#d8c48a'; g.fillRect(X(BEACH_X0), 0, S, S);
  g.fillStyle = '#1f5f8f'; g.fillRect(X(WATERLINE), 0, S, S);
  g.fillStyle = '#666b73'; g.fillRect(X(-HALF - ROAD / 2), Z(-HALF - ROAD / 2), (N * CELL + ROAD) * k, (N * CELL + ROAD) * k);
  for (const row of blocks) for (const b of row) {
    g.fillStyle = b.park ? '#3d8a44' : '#2a2d33'; g.fillRect(X(b.cx - BLOCK / 2), Z(b.cz - BLOCK / 2), BLOCK * k, BLOCK * k);
    g.fillStyle = '#454a54'; for (const o of b.bld) g.fillRect(X(o.x0), Z(o.z0), (o.x1 - o.x0) * k, (o.z1 - o.z0) * k);
  }
  MAP.k = k; MAP.S = S; MAP.X = X; MAP.Z = Z;
  mapCtx = $('minimap').getContext('2d');
}
function drawMinimap() {
  const g = mapCtx, W = 300, r = W / 2, zoom = 1.5;  // canvas px per map px
  g.save(); g.clearRect(0, 0, W, W);
  g.translate(r, r); g.rotate(camYaw);
  g.scale(zoom, zoom);
  g.drawImage(mapBase, -MAP.X(player.pos.x), -MAP.Z(player.pos.z));
  g.restore();
  const toMap = (x, z) => {
    const dx = (x - player.pos.x) * MAP.k * zoom, dz = (z - player.pos.z) * MAP.k * zoom;
    const c = Math.cos(camYaw), s = Math.sin(camYaw);
    return [r + dx * c - dz * s, r + dx * s + dz * c];
  };
  const dot = (x, z, col, rad, clampEdge) => {
    let [px, py] = toMap(x, z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy);
    if (l > r - 10) { if (!clampEdge) return; px = r + dx / l * (r - 10); py = r + dy / l * (r - 10); }
    g.fillStyle = col; g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke();
  };
  for (const c of cars) if (c.active && c.police && c.mode === 'police') dot(c.group.position.x, c.group.position.z, Math.sin(state.now * 12) > 0 ? '#ff2040' : '#2060ff', 8, true);
  for (const c of cars) if (c.owned && !c.dead && c !== state.inCar) dot(c.group.position.x, c.group.position.z, '#40a0ff', 6, false);
  g.font = '22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const s of SHOPS) { let [px, py] = toMap(s.x, s.z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 14) { px = r + dx / l * (r - 14); py = r + dy / l * (r - 14); } g.fillStyle = '#000c'; g.beginPath(); g.arc(px, py, 15, 0, 7); g.fill(); g.strokeStyle = s.mapCol; g.lineWidth = 3; g.stroke(); g.fillText(s.icon, px, py + 1); }
  if (state.waypoint) dot(state.waypoint.x, state.waypoint.z, '#c060ff', 9, true);
  if (!state.mission && state.missionCooldown <= 0) for (const st of STARTS) { let [px, py] = toMap(st.x, st.z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 14) { px = r + dx / l * (r - 14); py = r + dy / l * (r - 14); } g.fillStyle = '#ffc020'; g.beginPath(); g.arc(px, py, 13, 0, 7); g.fill(); g.fillText(START_INFO[st.type][0], px, py + 1); }
  if (state.mission) { const [mx, mz] = missionPos(); dot(mx, mz, '#' + MCOL[state.mission.type].toString(16).padStart(6, '0'), 11, true); }
  // player arrow
  g.save(); g.translate(r, r); g.rotate(camYaw); g.rotate(Math.PI - (state.inCar ? state.inCar.h : player.yaw));
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath(); g.stroke(); g.fill();
  g.restore();
}
function updateHUD(dt) {
  state.shownMoney += (state.money - state.shownMoney) * Math.min(1, dt * 6);
  if (Math.abs(state.money - state.shownMoney) < 1) state.shownMoney = state.money;
  $('money').textContent = '$' + String(Math.round(state.shownMoney)).padStart(8, '0');
  $('hpBar').firstChild.style.width = clamp(state.health, 0, 100) + '%';
  $('armBar').firstChild.style.width = clamp(state.armor, 0, 100) + '%';
  const w = WEAPONS[state.weapon], am = state.ammo[state.weapon], wk = w.name + am;
  if (wk !== updateHUD.wk) { updateHUD.wk = wk; $('wName').textContent = w.icon + ' ' + w.name; $('wAmmo').textContent = am === Infinity ? '∞' : am; $('bWeapon').textContent = w.icon; }
  if (state.wanted !== lastStars) { lastStars = state.wanted; document.querySelectorAll('#stars i').forEach((s, i) => s.classList.toggle('on', i < state.wanted)); }
  $('stars').classList.toggle('blink', state.wanted > 0 && state.blink);
  const sp = $('speedo');
  if (state.inCar) { sp.style.display = 'block'; $('spd').textContent = Math.round(Math.abs(carFwd(state.inCar)) * 3.6); } else sp.style.display = 'none';
  // enter prompt
  let near = false;
  if (!state.inCar) for (const c of cars) if (c.active && !c.dead && Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) < 5) { near = true; break; }
  $('bEnter').classList.toggle('hot', near || !!state.inCar);
  const pr = $('prompt');
  const ia = state.interact, act = $('bAct');
  if (ia) { act.style.display = ia.fn ? 'flex' : 'none'; act.textContent = ia.label; }
  else act.style.display = 'none';
  if (ia && !isTouch) { pr.style.display = 'block'; pr.textContent = ia.fn ? 'E — ' + ia.label : ia.label; }
  else if (ia && isTouch && !ia.fn) { pr.style.display = 'block'; pr.textContent = ia.label; }
  else if (near && !isTouch) { pr.style.display = 'block'; pr.textContent = 'F — Araca bin'; } else pr.style.display = 'none';
  const nav = $('navArrow');
  const navT = state.mission ? missionPos() : state.waypoint ? [state.waypoint.x, state.waypoint.z] : null;
  nav.style.color = state.mission ? '#ffc020' : '#c060ff';
  if (navT) {
    const [mx, mz] = navT, dx = mx - player.pos.x, dz = mz - player.pos.z, s = Math.sin(camYaw), c = Math.cos(camYaw);
    nav.style.display = 'block'; nav.style.transform = `translateX(-50%) rotate(${Math.atan2(dx * c - dz * s, -dx * s - dz * c)}rad)`;
  } else nav.style.display = 'none';
  drawMinimap();
}

// ============================================================ DEATH / BUSTED
function playerDown(title, sub) {
  state.dead = true; state.deadTimer = 4;
  if (state.inCar) exitCar(true);
  player.human.g.rotation.x = -Math.PI / 2;
  showBig(title, '#ff3b3b', 3.5, sub);
  $('fade').style.opacity = 0.6;
}
function busted() { if (state.dead) return; const loss = Math.min(state.money, 250); state.money -= loss; playerDown('YAKALANDIN', `Rüşvet: -$${loss}`); }
function respawn() {
  state.dead = false; state.health = 100; state.heat = 0; state.wanted = 0;
  const loss = 0; state.money -= loss;
  const [x, z] = spawnPoint();
  player.pos.set(x, 0.25, z); player.human.g.rotation.x = 0; player.human.g.visible = true;
  $('fade').style.opacity = 0;
  for (const c of cars) if (c.police && c.active) { c.active = false; c.group.visible = false; }
}

// ============================================================ AUDIO (synth)
const AudioSys = {
  ctx: null,
  init() {
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);
      const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = nb;
      // engine
      this.eg = ctx.createGain(); this.eg.gain.value = 0; this.ef = ctx.createBiquadFilter(); this.ef.type = 'lowpass'; this.ef.frequency.value = 500;
      this.eo = ctx.createOscillator(); this.eo.type = 'sawtooth'; this.eo2 = ctx.createOscillator(); this.eo2.type = 'square';
      this.eo.connect(this.ef); this.eo2.connect(this.ef); this.ef.connect(this.eg); this.eg.connect(this.master); this.eo.start(); this.eo2.start();
      // siren
      this.sg = ctx.createGain(); this.sg.gain.value = 0; this.so = ctx.createOscillator(); this.so.type = 'triangle'; this.so.connect(this.sg); this.sg.connect(this.master); this.so.start();
      // ambience (sea/wind)
      const an = ctx.createBufferSource(); an.buffer = nb; an.loop = true; const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 400; this.ag = ctx.createGain(); this.ag.gain.value = 0.03;
      this.af = af; an.connect(af); af.connect(this.ag); this.ag.connect(this.master); an.start();
    } catch (e) { this.ctx = null; }
  },
  burst(dur, freq, vol, type = 'lowpass', q = 1) {
    if (!this.ctx) return; const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(c.currentTime + dur);
  },
  tone(freq, dur, vol, type = 'sine', slide = 0, delay = 0) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay; o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
  },
  rocket() { this.burst(0.8, 1200, 0.6, 'bandpass', 0.6); this.tone(300, 0.6, 0.2, 'sawtooth', 0.4); },
  thunder() { this.burst(3, 140, 1.4); this.burst(1.2, 500, 0.5); },
  shot(v = 1) { this.burst(0.18, 1800, 0.6 * v); this.tone(160, 0.12, 0.35 * v, 'square', 0.3); },
  boom() { this.burst(1.6, 300, 1.2); this.tone(70, 1.2, 0.8, 'sine', 0.3); },
  crash(v) { haptic(50); if (this.ctx && (this._ct || 0) < this.ctx.currentTime) { this._ct = this.ctx.currentTime + 0.25; this.burst(0.35, 900, clamp(v, 0.1, 1) * 0.8, 'bandpass', 0.7); } },
  thud() { this.tone(90, 0.25, 0.6, 'sine', 0.5); },
  door() { this.tone(220, 0.08, 0.2, 'square', 0.5); this.burst(0.1, 600, 0.3); },
  cash() { this.tone(1568, 0.07, 0.22, 'square', 1, 0); this.tone(2093, 0.35, 0.22, 'triangle', 1, 0.06); this.tone(2637, 0.3, 0.12, 'sine', 1, 0.1); this.burst(0.12, 6000, 0.25, 'highpass'); },
  pickup() { this.tone(880, 0.12, 0.25, 'sine', 1.5); this.tone(1320, 0.15, 0.2, 'sine', 1.3, 0.08); },
  success() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 0.25, 'triangle', 1, i * 0.12)); },
  fail() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 0.25, 'triangle', 1, i * 0.15)); },
  update(dt, policeDist) {
    if (!this.ctx) return; const t = this.ctx.currentTime, c = state.inCar;
    if (c) { const bk = c.spec.bike ? 1.6 : 1, sp = Math.abs(carFwd(c)) * bk, gear = sp / c.spec.max * 5, rpm = 0.3 + (gear % 1) * 0.7 + Math.floor(gear) * 0.08; this.eo.frequency.setTargetAtTime(40 + rpm * 90 + sp, t, 0.05); this.eo2.frequency.setTargetAtTime(20 + rpm * 45 + sp * 0.5, t, 0.05); this.ef.frequency.setTargetAtTime(300 + Math.abs(input.my) * 900 + sp * 15, t, 0.1); this.eg.gain.setTargetAtTime(0.09 + Math.abs(input.my) * 0.06, t, 0.1); }
    else this.eg.gain.setTargetAtTime(0, t, 0.15);
    const sv = state.wanted > 0 ? clamp(1 - policeDist / 150, 0, 1) * 0.12 : 0;
    this.sg.gain.setTargetAtTime(sv, t, 0.2); this.so.frequency.setTargetAtTime(650 + Math.sin(state.now * 3.5) * 220, t, 0.03);
    this.ag.gain.setTargetAtTime(0.015 + clamp((player.pos.x - BEACH_X0) / 100, 0, 1) * 0.08 + state.rain * 0.16, t, 0.5);
    this.af.frequency.setTargetAtTime(400 + state.rain * 2600, t, 0.5);
    Radio.update(!!c && state.soundMode === 0 && !state.dead);
  }
};

// ============================================================ TREES / STREET FURNITURE / TRAFFIC LIGHTS
function buildTreesAndStreet() {
  const sh = QUALITY !== 'low', m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  // ---- broadleaf trees
  const blobs = [[0, 6.2, 0, 2.5], [1.4, 5.6, 0.7, 1.9], [-1.2, 5.8, -0.8, 1.9], [0.3, 7.4, -0.3, 1.7], [-0.6, 5.4, 1.2, 1.6]];
  const canopy = merge(blobs.map(([x, y, z, r]) => { const g = new THREE.IcosahedronGeometry(r, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const f = 1 + (Math.sin(p.getX(i) * 3.1 + p.getY(i) * 2.3) * 0.12); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.85, p.getZ(i) * f); } return g.translate(x, y, z); }));
  canopy.computeVertexNormals();
  const trunk = merge([new THREE.CylinderGeometry(0.17, 0.3, 5.2, 7).translate(0, 2.6, 0), new THREE.CylinderGeometry(0.08, 0.12, 2, 5).rotateZ(0.7).translate(0.7, 4.6, 0)]);
  const leafMat = new THREE.MeshStandardMaterial({ map: noiseTex('#5a8a3a', ['#4a7a2e', '#6a9a46', '#3e6a26', '#7aa850'], 128, 3000, 1, 4), roughness: 0.9 });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x6a5240, roughness: 1 });
  const tI = new THREE.InstancedMesh(trunk, barkMat, TREES.length), cI = new THREE.InstancedMesh(canopy, leafMat, TREES.length);
  TREES.forEach(([x, y, z], i) => {
    const s = R(0.75, 1.25); m4.compose(ps.set(x, y, z), q.setFromAxisAngle(up, rnd() * 6.3), sc.set(s, s * R(0.85, 1.15), s));
    tI.setMatrixAt(i, m4); cI.setMatrixAt(i, m4); cI.setColorAt(i, new THREE.Color().setHSL(R(0.2, 0.3), R(0.35, 0.55), R(0.5, 0.75)));
  });
  tI.castShadow = cI.castShadow = sh; cI.receiveShadow = sh; scene.add(tI, cI);

  // ---- traffic lights (one per approach)
  const pole = merge([new THREE.CylinderGeometry(0.1, 0.13, 6.2, 8).translate(0, 3.1, 0), new THREE.BoxGeometry(5.2, 0.14, 0.14).translate(-2.6, 6.0, 0), new THREE.BoxGeometry(0.45, 1.25, 0.35).translate(-4.8, 5.55, 0), new THREE.BoxGeometry(0.6, 1.4, 0.04).translate(-4.8, 5.55, -0.19)]);
  const tl = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (let d = 0; d < 4; d++) {
    const fx = DX[d], fz = DZ[d], pi = i - fx, pj = j - fz;
    if (pi < 0 || pj < 0 || pi > N || pj > N) continue;
    const off = ROAD / 2 + 1, x = nodeP(i) - fx * off - fz * off, z = nodeP(j) - fz * off + fx * off;
    tl.push([x, z, Math.atan2(-fx, -fz), d % 2]);
  }
  const pI = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.45 }), tl.length);
  M.tl = [0, 1].map(() => ['#ff2010', '#ffaa10', '#20ff60'].map(c => new THREE.MeshBasicMaterial({ color: c })));
  const lampGeo = [0, 1, 2].map(c => new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10).rotateX(Math.PI / 2).translate(-4.8, 5.95 - c * 0.38, 0.19));
  const lamps = [0, 1].map(a => [0, 1, 2].map(c => new THREE.InstancedMesh(lampGeo[c], M.tl[a][c], tl.filter(t => t[3] === a).length)));
  const cnt = [0, 0];
  tl.forEach(([x, z, r, a], i) => {
    m4.compose(ps.set(x, 0.25, z), q.setFromAxisAngle(up, r), sc.set(1, 1, 1)); pI.setMatrixAt(i, m4);
    for (let c = 0; c < 3; c++) lamps[a][c].setMatrixAt(cnt[a], m4); cnt[a]++;
  });
  pI.castShadow = sh; scene.add(pI); lamps.flat().forEach(l => scene.add(l));

  // ---- benches, bins, hydrants
  const bench = merge([colorize(new THREE.BoxGeometry(1.8, 0.07, 0.5).translate(0, 0.46, 0), '#7a5a3a'), colorize(new THREE.BoxGeometry(1.8, 0.45, 0.06).translate(0, 0.78, -0.24), '#7a5a3a'),
    colorize(new THREE.BoxGeometry(0.08, 0.46, 0.5).translate(0.8, 0.23, 0), '#2a2a2a'), colorize(new THREE.BoxGeometry(0.08, 0.46, 0.5).translate(-0.8, 0.23, 0), '#2a2a2a')]);
  const bin = merge([colorize(new THREE.CylinderGeometry(0.3, 0.27, 0.95, 10).translate(0, 0.475, 0), '#2e4a34'), colorize(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 10).translate(0, 0.97, 0), '#1c2a20')]);
  const hyd = merge([colorize(new THREE.CylinderGeometry(0.13, 0.16, 0.65, 8).translate(0, 0.32, 0), '#c8201a'), colorize(new THREE.SphereGeometry(0.14, 8, 6).translate(0, 0.66, 0), '#c8201a'), colorize(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6).rotateZ(Math.PI / 2).translate(0, 0.45, 0), '#a01a14')]);
  const spots = { bench: [], bin: [], hyd: [] };
  for (const row of blocks) for (const b of row) {
    if (b.park || b.dist === 'residential') continue;
    for (let s = 0; s < 4; s++) for (const kind of ['bench', 'bin', 'hyd']) {
      if (rnd() > (kind === 'bench' ? 0.45 : 0.6)) continue;
      const t = R(-24, 24), e = BLOCK / 2 - 1.5, r = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][s];
      const x = s < 2 ? b.cx + t : b.cx + (s === 2 ? -e : e), z = s < 2 ? b.cz + (s === 0 ? -e : e) : b.cz + t;
      spots[kind].push([x, z, r]);
    }
  }
  const furnMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
  for (const [geo, list] of [[bench, spots.bench], [bin, spots.bin], [hyd, spots.hyd]]) {
    const im = new THREE.InstancedMesh(geo, furnMat, list.length);
    list.forEach(([x, z, r], i) => { m4.compose(ps.set(x, 0.25, z), q.setFromAxisAngle(up, r), sc.set(1, 1, 1)); im.setMatrixAt(i, m4); });
    im.castShadow = sh; scene.add(im);
  }
}
const lightState = axis => { const t = state.now % 26; return axis === 0 ? (t < 11 ? 'g' : t < 13 ? 'y' : 'r') : (t < 13 ? 'r' : t < 24 ? 'g' : 'y'); };
function updateTrafficLights() {
  const on = { r: [5, 0.25, 0.15], y: [5, 3, 0.2], g: [0.25, 5, 1.6] }, keys = ['r', 'y', 'g'];
  for (let a = 0; a < 2; a++) { const st = lightState(a); for (let c = 0; c < 3; c++) { const v = on[keys[c]], lit = keys[c] === st; M.tl[a][c].color.setRGB(...v.map(x => lit ? x : x * 0.04 + 0.02)); } }
}

// ============================================================ CLOUDS + GRADING
let clouds;
function buildClouds() {
  clouds = new THREE.Mesh(new THREE.SphereGeometry(2800, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCover: { value: 0.45 }, uSunDir: { value: new THREE.Vector3() }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.65, 0.7) } },
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime, uCover; uniform vec3 uSunDir, uLit, uShade; varying vec3 vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }
      void main(){
        vec3 d = normalize(vD); if (d.y < 0.0) discard;
        vec2 p = d.xz/(d.y+0.1)*1.4 + vec2(uTime*0.006, uTime*0.002);
        float f = fbm(p);
        float c = smoothstep(1.0-uCover, 1.0-uCover+0.3, f);
        float f2 = fbm(p + uSunDir.xz*0.15);
        float shade = clamp(0.55 + (f - f2)*3.5, 0.0, 1.0);
        float glow = pow(max(dot(d, uSunDir), 0.0), 6.0);
        vec3 col = mix(uShade, uLit, shade) + uLit*glow*0.5;
        float a = c*smoothstep(0.0, 0.2, d.y);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false
  }));
  clouds.renderOrder = -1; scene.add(clouds);
}
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.06 }, uCon: { value: 1.07 }, uVig: { value: 0.32 }, uTint: { value: new THREE.Vector3(1.02, 1.0, 0.97) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig; uniform vec3 uTint; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126,0.7152,0.0722)); col = mix(vec3(l), col, uSat);
      col = (col-0.5)*uCon + 0.5; col *= uTint;
      col = mix(col, col*vec3(0.92,0.98,1.06), smoothstep(0.5,0.0,l)*0.35);
      vec2 d = vUv-0.5; col *= 1.0 - uVig*dot(d,d)*2.0;
      gl_FragColor = vec4(clamp(col,0.0,1.0), c.a); }`
};

// ============================================================ HAPTICS
function haptic(p) {
  if (!isTouch || !navigator.vibrate || state.soundMode === 2) return;
  const t = performance.now(); if (t - (haptic.last || 0) < 70) return; haptic.last = t;
  try { navigator.vibrate(p); } catch (e) { }
}

// ============================================================ ZONES (shops / garage) + SAVE
// SHOPS: physical interaction zones. type: 'gun' | 'car' | 'garage'. needCar: interaction only from inside a vehicle.
const SHOPS = [];
const GARAGE_BLOCK = [2, 1];
const WEAPON_SHOP = [
  { w: 3, name: 'POMPALI TÜFEK', desc: 'Yakın mesafe, çok yüksek hasar · +16 fişek', price: 900, ammo: 16, packPrice: 200 },
  { w: 2, name: 'TARAMALI TÜFEK', desc: 'Seri ateş, uzun menzil · +90 mermi', price: 1200, ammo: 90, packPrice: 250 },
  { w: 4, name: 'ROKETATAR', desc: 'Alan hasarı, araç patlatır · +4 roket', price: 2500, ammo: 4, packPrice: 800 },
  { w: 1, name: 'UZI', desc: 'Hafif makineli · +120 mermi', price: 400, ammo: 120, packPrice: 150 },
];
const CAR_ITEMS = [['bike', 'Motosiklet', 1200], ['sedan', 'Sedan', 2500], ['van', 'Minibüs', 3200], ['pickup', 'Pikap', 3800], ['suv', 'SUV', 4500], ['sport', 'Spor Coupe', 9000], ['super', 'Süper Araba', 18000]];
const PAINTS = [['Kırmızı', '#c8141e'], ['Turuncu', '#f06a10'], ['Sarı', '#f2c21a'], ['Yeşil', '#1e9a46'], ['Turkuaz', '#10a8b8'], ['Mavi', '#1e48c8'], ['Mor', '#6a28b0'], ['Siyah', '#101014'], ['Beyaz', '#f0f0f0']];
const MAX_UP = 3;
function dealerSpot(k) { const b = blocks[DEALER[0]][DEALER[1]]; return [b.cx - 30 + (k % 9) * 7, nodeP(DEALER[1] + 1) - (ROAD / 2 - 1.3)]; }
function garageSpot(k) { const b = blocks[GARAGE_BLOCK[0]][GARAGE_BLOCK[1]]; return [b.cx - 20 + (k % 5) * 7, nodeP(GARAGE_BLOCK[1] + 1) - (ROAD / 2 - 1.3)]; }
function initCar(c) { c.up = { engine: 0, grip: 0, armor: 0 }; c.maxHealth = c.spec.armored ? 320 : c.health; c.health = c.maxHealth; return c; }
function makeZone(type, x, z, title, icon, bg, fg, ringCol, o = {}) {
    const signTex = (title, sub) => canvasTex(512, 128, g => {
      g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
      g.shadowColor = fg; g.shadowBlur = o.glow ? 18 : 0;
      g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(12, 12, 488, 104);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `bold ${sub ? 46 : 56}px Arial, sans-serif`; g.fillText(title, 256, sub ? 52 : 68);
      if (sub) { g.font = 'bold 28px Arial, sans-serif'; g.fillText(sub, 256, 95); }
    });
    const tex = signTex(title, o.sub);
    const face = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: o.glow ? 0.9 : 0.15 }), dark = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.6, 0.16), [dark, dark, dark, dark, face, face]); board.position.set(x, o.signY ?? 4.2, z);
    board.castShadow = true; scene.add(board);
    if (!o.canopy) { const poles = new THREE.Mesh(merge([new THREE.CylinderGeometry(0.08, 0.08, 4, 6).translate(-2.6, 2, 0), new THREE.CylinderGeometry(0.08, 0.08, 4, 6).translate(2.6, 2, 0)]), dark); poles.position.set(x, 0.25, z - 0.1); scene.add(poles); }
    const rr = o.ringR ?? 1.8, rz = z + (o.ringOff ?? 1.8);
    const ring = new THREE.Mesh(new THREE.RingGeometry(rr - 0.4, rr, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ringCol, transparent: true, opacity: 0.85, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(rr - 0.4, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ringCol, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.set(x, 0.29, rz); disc.position.set(x, 0.285, rz); scene.add(ring, disc);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, g => { g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.font = '72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon, 64, 70); }), depthTest: true }));
    sp.scale.set(1.4, 1.4, 1); sp.position.set(x, 2, rz); scene.add(sp);
    const zone = { type, x, z: rz, r: rr, ring, disc, sp, icon, face, glow: !!o.glow, needCar: !!o.needCar, label: o.label, mapCol: '#' + new THREE.Color(ringCol).getHexString() };
    zone.redraw = (t, sub) => { const nt = signTex(t, sub); face.map.dispose(); face.map = face.emissiveMap = nt; face.needsUpdate = true; };
    SHOPS.push(zone); return zone;
}
function buildShops(save) {
  const mk = makeZone;
  const gb = blocks[GUNSHOP[0]][GUNSHOP[1]], db = blocks[DEALER[0]][DEALER[1]], gg = blocks[GARAGE_BLOCK[0]][GARAGE_BLOCK[1]];
  mk('gun', gb.cx, gb.cz + BLOCK / 2 - 4, 'SİLAH & EKİPMAN', '🔫', '#140304', '#ff2a2a', 0xff2a2a, { glow: true, label: 'MAĞAZAYI AÇ' });
  mk('car', db.cx + 22, db.cz + BLOCK / 2 - 4, 'VISTA MOTORS', '🚗', '#0d2c54', '#ffffff', 0x40e080, { label: 'GALERİYİ AÇ' });
  // garage: canopy service bay on the sidewalk + big ring cars can drive into
  {
    const x = gg.cx, z = gg.cz + BLOCK / 2 - 2.6, dark = new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.5, roughness: 0.5 });
    const canopy = new THREE.Mesh(merge([new THREE.BoxGeometry(10, 0.35, 7).translate(0, 4.6, 1),
      ...[[-4.7, -2.2], [4.7, -2.2], [-4.7, 4.2], [4.7, 4.2]].map(([px, pz]) => new THREE.BoxGeometry(0.25, 4.6, 0.25).translate(px, 2.3, pz))]), dark);
    canopy.position.set(x, 0.25, z); canopy.castShadow = true; scene.add(canopy);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(10.1, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0x2a8cff })); strip.position.set(x, 4.65, z + 4.5); scene.add(strip); M.garageStrip = strip.material;
    mk('garage', x, z - 2.4, 'GARAJ & BOYA', '🔧', '#040a1c', '#3aa8ff', 0x2a8cff, { glow: true, canopy: true, signY: 5.7, ringR: 3.6, ringOff: 5.4, needCar: true, label: 'GARAJA GİR' });
  }
  CAR_ITEMS.forEach(([kind], k) => { const c = createCar(kind, pick(CAR_COLORS), db.cx - 27 + k * 8.5, db.cz + 6 + (k % 2) * 6, Math.PI + 0.4, 'free'); c.display = true; c.driver = false; });
  if (save && save.owned) save.owned.forEach(([kind, hex, up, fav], k) => {
    if (!CAR_SPECS[kind]) return;
    const [x, z] = dealerSpot(k); const c = createCar(kind, '#' + hex, x, z, Math.PI / 2, 'free'); c.owned = true; c.driver = false;
    if (up) Object.assign(c.up, up);
    if (fav) c.fav = true;
  });
}
// interaction: state.interact = { label, fn } (shown as touch button / "E" prompt)
function updateShops(dt) {
  state.interact = null;
  if (M.garageStrip) M.garageStrip.color.setRGB(0.16, 0.55, 1).multiplyScalar(1 + nightF * 3);
  for (const s of SHOPS) {
    s.sp.position.y = 3.3 + Math.sin(state.now * 2.5) * 0.15;
    s.ring.material.opacity = 0.6 + Math.sin(state.now * 4) * 0.25;
    s.face.emissiveIntensity = (s.glow ? 0.7 : 0.15) + nightF * 1.2;
    if (state.dead) continue;
    const d = Math.hypot(player.pos.x - s.x, player.pos.z - s.z);
    if (d > s.r + 0.3) continue;
    if (s.needCar !== !!state.inCar) { state.interact = { label: s.needCar ? 'Araçla gir' : 'Araçtan in', fn: null }; continue; }
    if (s.needCar && state.mission && state.mission.type === 'delivery') continue;
    state.interact = { label: s.label, fn: () => openShop(s.type, s) };
  }
}
function interact() { if (state.interact && state.interact.fn) { state.interact.fn(); return true; } return false; }
function openShop(type, zone = null) {
  state.shopZone = zone;
  if (type === 'garage' && state.inCar) { const c = state.inCar; c.vx = c.vz = 0; }
  state.shopOpen = type; try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { }
  for (const k in keys) keys[k] = false;
  touchState.joyId = null; touchState.jdx = touchState.jdy = 0; $('joy').style.display = 'none';
  $('shopTitle').textContent = type === 'prop' ? '🏠 ' + zone.prop.name.toUpperCase() : { gun: '🔫 SİLAH & EKİPMAN', car: '🚗 VISTA MOTORS', garage: '🔧 GARAJ & BOYA' }[type];
  renderShop(); $('shop').style.display = 'flex';
}
function closeShop() { state.shopOpen = null; $('shop').style.display = 'none'; saveGame(); }
function shopItems(type) {
  if (type === 'prop') return propItems();
  const own = i => state.ownedW[i];
  if (type === 'gun') {
    const it = [
      { sec: 'Sağlık' },
      { name: 'CAN + ZIRH YENİLEME', desc: 'Can ve zırhı anında %100 yapar', price: 300, dis: state.health >= 100 && state.armor >= 100 ? 'DOLU' : null, buy: () => { state.health = 100; state.armor = 100; } },
      { name: 'İLK YARDIM', desc: 'Can %100', price: 100, dis: state.health >= 100 ? 'DOLU' : null, buy: () => { state.health = 100; } },
      { name: 'ÇELİK YELEK', desc: 'Zırh %100', price: 200, dis: state.armor >= 100 ? 'DOLU' : null, buy: () => { state.armor = 100; } },
      { sec: 'Silahlar' }];
    for (const w of WEAPON_SHOP) it.push({ name: WEAPONS[w.w].icon + ' ' + w.name, desc: w.desc, price: w.price, dis: own(w.w) ? 'SAHİPSİN' : null, buy: () => { state.ownedW[w.w] = true; state.ammo[w.w] += w.ammo; state.weapon = w.w; } });
    it.push({ sec: 'Mermi Paketleri' });
    for (const w of WEAPON_SHOP) it.push({ name: WEAPONS[w.w].name + ' mermisi', desc: own(w.w) ? `+${w.ammo} · elindeki: ${state.ammo[w.w]}` : 'Önce silahı satın al', price: w.packPrice, dis: own(w.w) ? null : 'KİLİTLİ', buy: () => { state.ammo[w.w] += w.ammo; } });
    return it;
  }
  if (type === 'car') return CAR_ITEMS.map(([kind, name, price]) => ({ name, price, desc: `Azami hız ${Math.round(CAR_SPECS[kind].max * 3.6)} km/s · Hızlanma ${'★'.repeat(Math.min(5, Math.round(CAR_SPECS[kind].acc / 6)))}`, buy: () => buyCar(kind, name, dealerSpot(cars.filter(c => c.owned).length), 'galerinin önünde'), close: true }));
  // garage
  const c = state.inCar; if (!c) return [];
  const dmg = 1 - c.health / c.maxHealth, repair = Math.round((80 + dmg * 900 + state.wanted * 250) / 10) * 10;
  const lvl = (n, k) => '■'.repeat(c.up[k]) + '□'.repeat(MAX_UP - c.up[k]);
  const it = [
    { sec: 'Servis' },
    { name: '🛠 TAMİR ET & İZİ KAYBET', desc: `Hasar %${Math.round(dmg * 100)} · Aranma ${'★'.repeat(state.wanted) || 'yok'} → hepsi sıfırlanır`, price: repair, dis: dmg < 0.01 && state.wanted === 0 ? 'TEMİZ' : null, buy: () => repairCar(c) },
    { sec: 'Performans' },
    { name: `⚙ MOTOR ${lvl('Motor', 'engine')}`, desc: '+%20 azami hız ve hızlanma', price: 1500 * (c.up.engine + 1), dis: c.up.engine >= MAX_UP ? 'MAKS' : null, buy: () => { c.up.engine++; c.owned = true; } },
    { name: `🛞 FREN & YOL TUTUŞU ${lvl('Fren', 'grip')}`, desc: '+%20 fren gücü ve tutuş', price: 1000 * (c.up.grip + 1), dis: c.up.grip >= MAX_UP ? 'MAKS' : null, buy: () => { c.up.grip++; c.owned = true; } },
    { name: '🛡 GÖVDE ZIRHI', desc: 'Araç hasarı yarıya iner', price: 2000, dis: c.up.armor ? 'TAKILI' : c.spec.bike ? 'YOK' : null, buy: () => { c.up.armor = 1; c.owned = true; } },
    { sec: 'Boya' }];
  for (const [n, hex] of PAINTS) it.push({ name: `<i class="sw" style="background:${hex}"></i>${n}`, desc: 'Metalik boya', price: 250, buy: () => { c.paintM = paintMat(hex); if (!c.dead) c.paint.material = c.paintM; c.owned = true; } });
  it.push({ sec: 'Garajdan Araç Çağır' });
  it.push({ name: '🏎 HIZLI SPOR ARABA', desc: `Süper araba · ${Math.round(CAR_SPECS.super.max * 3.6)} km/s`, price: 16000, buy: () => buyCar('super', 'Spor araba', garageSpot(cars.filter(o => o.owned).length), 'garajın önünde'), close: true });
  it.push({ name: '🛡 ZIRHLI ARAÇ', desc: 'Kurşun geçirmez SUV · 3x dayanıklılık', price: 12000, buy: () => buyCar('armored', 'Zırhlı araç', garageSpot(cars.filter(o => o.owned).length), 'garajın önünde'), close: true });
  return it;
}
function renderShop() {
  const type = state.shopOpen, box = $('shopItems'); box.innerHTML = '';
  $('shopMoney').textContent = '$' + Math.round(state.money);
  for (const it of shopItems(type)) {
    const el = document.createElement('div');
    if (it.sec) { el.className = 'shopSec'; el.textContent = it.sec; box.appendChild(el); continue; }
    const poor = it.price > 0 && state.money < it.price;
    el.className = 'shopItem' + (it.dis ? ' done' : poor ? ' poor' : '');
    el.innerHTML = `<div><b>${it.name}</b><small>${it.desc}</small></div><button>${it.dis || (it.price ? '$' + it.price : it.btn || 'TAMAM')}</button>`;
    el.querySelector('button').onclick = () => {
      if (it.dis) return;
      if (poor) { AudioSys.fail(); haptic(60); return; }
      state.money -= it.price; state.shownMoney = state.money; if (it.price) { S().spent += it.price; ledger('🛒 ' + it.name.replace(/<[^>]+>/g, '').trim(), -it.price); }
      it.buy(); if (it.price) AudioSys.cash(); else AudioSys.pickup(); haptic(30); saveGame();
      if (it.close) closeShop(); else renderShop();
    };
    box.appendChild(el);
  }
}
function repairCar(c) {
  c.health = c.maxHealth; c.smokeT = 0; state.heat = 0; state.wanted = 0; state.crimeTimer = 99;
  for (const p of cars) if (p.police && p.active && p.mode === 'police') p.idleT = 0;
  floatText('Araç yenilendi · Polis izini kaybetti');
}
function buyCar(kind, name, spot, where) {
  const [x, z] = spot;
  const c = createCar(kind, kind === 'armored' ? '#1a1d22' : pick(CAR_COLORS), x, z, Math.PI / 2, 'free'); c.owned = true; c.driver = false;
  showBig('YENİ ARACIN HAZIR', '#7dff9a', 3, `${name} ${where} seni bekliyor`);
}
const SAVE_KEY = 'vistabay_save_v1';
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: Math.round(state.money), ammo: state.ammo.map(a => a === Infinity ? -1 : a), ownedW: state.ownedW,
      owned: cars.filter(c => c.owned && !c.dead && !c.delivery).map(c => [c.kind, c.paintM.color.getHexString(THREE.SRGBColorSpace), c.up, c.fav ? 1 : 0]), soundMode: state.soundMode,
      props: state.props, spawnProp: state.spawnProp, stats: state.stats, ach: state.ach
    }));
  } catch (e) { }
}
function loadGame() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (!d) return null;
    state.money = state.shownMoney = d.money || 0;
    state.ammo = (d.ammo || []).map(a => a < 0 ? Infinity : a); while (state.ammo.length < WEAPONS.length) state.ammo.push(0); state.ammo[0] = Infinity;
    state.ownedW = WEAPONS.map((w, i) => i === 0 || (d.ownedW ? !!d.ownedW[i] : state.ammo[i] > 0));
    if (d.soundMode != null) state.soundMode = d.soundMode;
    state.props = d.props || {}; state.spawnProp = d.spawnProp || null; state.ach = d.ach || {}; Object.assign(state.stats, d.stats || {});
    return d;
  } catch (e) { return null; }
}

// ============================================================ MISSION STARTS (yellow rings)
const STARTS = [];
const START_INFO = { race: ['🏁', 'ZAMANA KARŞI YARIŞ'], delivery: ['📦', 'ARAÇ TESLİMATI'], taxi: ['🚕', 'TAKSİ'], hit: ['💀', 'SUİKAST'], reach: ['🎯', 'KURYE'] };
const startTex = {};
function buildStarts() {
  const beamM = new THREE.MeshBasicMaterial({ map: beamTex(), color: 0xffc020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (const t in START_INFO) startTex[t] = canvasTex(128, 128, g => { g.fillStyle = 'rgba(30,20,0,0.7)'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#ffc020'; g.lineWidth = 6; g.stroke(); g.font = '70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(START_INFO[t][0], 64, 70); });
  for (let k = 0; k < 3; k++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.RingGeometry(3, 3.6, 40).rotateX(-Math.PI / 2).translate(0, 0.08, 0), new THREE.MeshBasicMaterial({ color: 0xffc020, transparent: true, opacity: 0.9, depthWrite: false })));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 7, 28, 1, true).translate(0, 3.5, 0), beamM));
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: startTex.race })); sp.scale.set(2, 2, 1); sp.position.y = 4.2; g.add(sp);
    scene.add(g);
    const s = { g, sp, type: null, x: 0, z: 0 }; STARTS.push(s); placeStart(s);
  }
}
function placeStart(s) {
  const r = Math.random();
  s.type = r < 0.38 ? 'race' : r < 0.76 ? 'delivery' : pick(['taxi', 'hit', 'reach']);
  for (let t = 0; t < 40; t++) {
    const i = RI(0, N - 1), j = RI(0, N), x = nodeP(i) + CELL / 2, z = nodeP(j) + (Math.random() < 0.5 ? 1 : -1) * 4.5;
    const d = Math.hypot(x - player.pos.x, z - player.pos.z);
    if (d < 60 || d > 420) continue;
    if (STARTS.some(o => o !== s && Math.hypot(o.x - x, o.z - z) < 120) || SHOPS.some(o => Math.hypot(o.x - x, o.z - z) < 40)) continue;
    s.x = x; s.z = z; break;
  }
  s.g.position.set(s.x, 0, s.z); s.sp.material.map = startTex[s.type]; s.sp.material.needsUpdate = true;
}
function updateStarts(dt) {
  const hide = !!state.mission || state.missionCooldown > 0;
  if (state.missionCooldown > 0) state.missionCooldown -= dt;
  for (const s of STARTS) {
    s.g.visible = !hide;
    if (hide) continue;
    s.sp.position.y = 4.2 + Math.sin(state.now * 2 + s.x) * 0.25;
    s.g.children[0].material.opacity = 0.65 + Math.sin(state.now * 4) * 0.25;
    const d = Math.hypot(player.pos.x - s.x, player.pos.z - s.z);
    if (d < 3.6 && !state.dead) {
      if (s.type === 'race' && !state.inCar) { state.interact = { label: 'Yarış için araca bin', fn: null }; continue; }
      if (s.type === 'taxi' && (!state.inCar || state.inCar.spec.bike)) { state.interact = { label: 'Taksi için araba gerekli', fn: null }; continue; }
      newMission(s.type, s.x, s.z); placeStart(s); break;
    }
  }
}

// ============================================================ PROPERTIES (real estate + passive income + safehouse)
const PROPERTIES = [
  { id: 'carwash', name: 'Oto Yıkama', icon: '🧽', block: [5, 6], price: 15000, income: 350, desc: 'Köşe başında yoğun bir yıkamacı' },
  { id: 'beach', name: 'Sahil Kulübü', icon: '🏖', block: [7, 4], price: 25000, income: 650, desc: 'Okyanus manzaralı plaj kulübü' },
  { id: 'villa', name: 'Lüks Villa', icon: '🏡', block: [0, 3], price: 40000, income: 450, desc: 'Havuzlu villa · en güvenli ev' },
  { id: 'club', name: 'Gece Kulübü', icon: '🎵', block: [4, 2], price: 50000, income: 1200, desc: 'Şehrin en popüler gece kulübü' },
];
const HOUR_SEC = 1 / TIME_SPEED; // real seconds per in-game hour
function propIncome() { return PROPERTIES.reduce((a, p) => a + (state.props[p.id] ? p.income : 0), 0); }
function ownedProps() { return PROPERTIES.filter(p => state.props[p.id]).length; }
function propSignText(p) { return state.props[p.id] ? ['SAHİBİ: SEN', `+$${p.income} / saat`] : ['SATILIK', '$' + p.price.toLocaleString('tr-TR')]; }
function buildProperties() {
  for (const p of PROPERTIES) {
    const b = blocks[p.block[0]][p.block[1]];
    const [l1, l2] = propSignText(p);
    p.zone = makeZone('prop', b.cx + 8, b.cz + BLOCK / 2 - 4, p.name.toUpperCase(), p.icon, '#06200f', '#6dff9c', 0x30d070, { glow: true, label: 'MÜLKÜ İNCELE', sub: l1 + '  ·  ' + l2 });
    p.zone.prop = p;
  }
}
function refreshPropSign(p) { const [l1, l2] = propSignText(p); p.zone.redraw(p.name.toUpperCase(), l1 + '  ·  ' + l2); }
function buyProperty(p) {
  state.props[p.id] = true; refreshPropSign(p);
  if (!state.spawnProp) state.spawnProp = p.id;
  showBig('MÜLK SATIN ALINDI', '#7dff9a', 3, `${p.name} · her saat +$${p.income}`);
}
function spawnPoint() {
  const p = PROPERTIES.find(q => q.id === state.spawnProp && state.props[q.id]);
  if (p) return [p.zone.x, p.zone.z - 1.5];
  return [nodeP(RI(2, 6)) + ROAD / 2 + 3, nodeP(RI(2, 6)) + ROAD / 2 + 3];
}
function propItems() {
  const p = state.shopZone.prop, own = state.props[p.id], it = [{ sec: 'Mülk' },
    { name: `${p.icon} ${p.name}`, desc: `${p.desc} · Saatlik gelir +$${p.income}`, price: p.price, dis: own ? 'SENİN' : null, buy: () => buyProperty(p) }];
  if (own) it.push({ sec: 'Güvenli Ev' },
    { name: '💾 KAYDET & DİNLEN', desc: 'Oyunu kaydeder, canını %100 yapar', price: 0, btn: 'KAYDET', buy: () => { state.health = 100; floatText('💾 Oyun kaydedildi'); } },
    { name: '🛏 DOĞUŞ NOKTASI YAP', desc: 'Oyun açılınca ve bayılınca burada başlarsın', price: 0, btn: 'SEÇ', dis: state.spawnProp === p.id ? 'AKTİF' : null, buy: () => { state.spawnProp = p.id; floatText('Doğuş noktası: ' + p.name); } });
  it.push({ sec: 'Toplam' }, { name: `🏦 Mülklerin: ${ownedProps()}/${PROPERTIES.length}`, desc: `Saatlik toplam gelir +$${propIncome()}`, price: 0, dis: '—' });
  return it;
}

// ============================================================ ECONOMY / STATS / ACHIEVEMENTS
const S = () => state.stats;
function earn(amt, label) { state.money += amt; S().earned += amt; ledger(label, amt); }
function ledger(label, amt) { state.ledger.unshift({ t: clockStr(), label, amt }); if (state.ledger.length > 8) state.ledger.pop(); }
function clockStr() { const h = Math.floor(state.time), m = Math.floor((state.time - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
const ownedCars = () => cars.filter(c => c.owned && !c.display && !c.delivery);
const ACHIEVEMENTS = [
  { id: 'm1', name: 'İlk İş', desc: '1 görev tamamla', reward: 250, test: () => S().missions >= 1 },
  { id: 'm10', name: 'Profesyonel', desc: '10 görev tamamla', reward: 2500, test: () => S().missions >= 10 },
  { id: 'spd', name: 'Hız Tutkunu', desc: '200 km/s hıza ulaş', reward: 500, test: () => S().topSpeed >= 200 },
  { id: 'w4', name: 'Aranan Adam', desc: '4 yıldız aranma seviyesine çık', reward: 750, test: () => S().maxWanted >= 4 },
  { id: 'p1', name: 'Mülk Sahibi', desc: 'İlk mülkünü satın al', reward: 1000, test: () => ownedProps() >= 1 },
  { id: 'pAll', name: 'Emlak Kralı', desc: 'Tüm mülkleri satın al', reward: 15000, test: () => ownedProps() === PROPERTIES.length },
  { id: 'c5', name: 'Koleksiyoner', desc: '5 araca sahip ol', reward: 3000, test: () => ownedCars().length >= 5 },
  { id: 'b1', name: 'Kiralık Katil', desc: 'İlk kontratı tamamla', reward: 500, test: () => S().contracts >= 1 },
  { id: 'b5', name: 'Efsane Tetikçi', desc: '5 kontrat tamamla', reward: 4000, test: () => S().contracts >= 5 },
  { id: 'rich', name: 'Zengin', desc: 'Hesabında $100.000 biriktir', reward: 5000, test: () => state.money >= 100000 },
  { id: 'km', name: 'Yol Canavarı', desc: '50 km araç kullan', reward: 1500, test: () => S().dist >= 50000 },
  { id: 'guns', name: 'Cephanelik', desc: 'Tüm silahlara sahip ol', reward: 1000, test: () => state.ownedW.every(Boolean) },
];
let econT = 0;
function updateEconomy(dt) {
  const st = S(); st.play += dt; st.maxWanted = Math.max(st.maxWanted, state.wanted);
  const h = Math.floor(state.time);
  if (state.lastHour === null) state.lastHour = h;
  if (h !== state.lastHour) {
    state.lastHour = h;
    const inc = propIncome();
    if (inc > 0) { earn(inc, '🏦 Mülk geliri'); floatText(`🏦 +$${inc} mülk geliri`); AudioSys.cash(); haptic(25); }
  }
  if (state.waypoint && Math.hypot(state.waypoint.x - player.pos.x, state.waypoint.z - player.pos.z) < 10) { floatText('📍 Hedefe vardın'); state.waypoint = null; }
  econT += dt; if (econT < 1) return; econT = 0;
  for (const a of ACHIEVEMENTS) if (!state.ach[a.id] && a.test()) {
    state.ach[a.id] = true; earn(a.reward, '🏆 ' + a.name);
    showBig('🏆 BAŞARIM AÇILDI', '#ffd23a', 3, `${a.name} · +$${a.reward}`); AudioSys.success(); haptic([30, 30, 60]); saveGame(); break;
  }
}

// ============================================================ VALET (call owned car to the nearest curb)
function curbSpot() {
  const x = player.pos.x, z = player.pos.z, off = ROAD / 2 - 1.6;
  const i = clamp(Math.round((x - OFF) / CELL), 0, N), j = clamp(Math.round((z - OFF) / CELL), 0, N), rx = nodeP(i), rz = nodeP(j);
  const away = (v) => { const k = clamp(Math.round((v - OFF) / CELL), 0, N), n = nodeP(k), dv = v - n; return Math.abs(dv) < ROAD / 2 + 7 ? n + (dv >= 0 ? 1 : -1) * (ROAD / 2 + 9) : v; };
  if (Math.abs(x - rx) < Math.abs(z - rz)) { const side = x >= rx ? 1 : -1; return [rx + side * off, away(clamp(z, OFF + 12, -OFF - 12)), side > 0 ? Math.PI : 0]; }
  const side = z >= rz ? 1 : -1; return [away(clamp(x, OFF + 12, -OFF - 12)), rz + side * off, side > 0 ? Math.PI / 2 : -Math.PI / 2];
}
function callCar(c) {
  if (state.inCar === c) { floatText('Zaten bu araçtasın'); return false; }
  if (state.money < 100) { floatText('Vale ücreti $100'); AudioSys.fail(); return false; }
  state.money -= 100; S().spent += 100; ledger('🚗 Vale', -100);
  const [x, z, h] = curbSpot();
  c.active = true; c.group.visible = true; c.mode = 'free'; c.driver = false; c.ai = null;
  c.vx = c.vz = 0; c.vy = 0; c.air = false; c.h = h; c.y = groundY(x, z); c.group.position.set(x, c.y, z); c.group.rotation.set(0, h, 0);
  for (let k = 0; k < 14; k++) FX.norm.spawn(x + MR(-2, 2), 0.6, z + MR(-2, 2), MR(-1, 1), MR(0.5, 2), MR(-1, 1), 1.2, 1.2, 2, 0.8, 0.8, 0.82, 0.5, 0);
  state.waypoint = { x, z, label: 'Aracın' };
  floatText('🚗 Aracın yolun kenarında'); AudioSys.door(); saveGame();
  return true;
}

// ============================================================ CONTRACTS (bounty: boss + bodyguards)
const BOSS_NAMES = ['"Kobra" Vargas', 'Dimitri "Buz" Volkov', 'Marco "Çakal" Rossi', 'Lena "Gölge" Park', 'Tony "Balyoz" Moretti', 'Ray "Kasırga" Duarte', 'Viktor "Diş" Kral', 'Sal "Sessiz" Romano'];
const AREA_NAMES = { downtown: 'Merkez', midtown: 'Midtown', mixed: 'Eski Şehir', beach: 'Sahil', residential: 'Banliyö', industrial: 'Sanayi', dealer: 'Galeri', park: 'Park' };
const bountyNpcs = { boss: null, guards: [] };
function makeContract() {
  let spot = randomSidewalk();
  for (let t = 0; t < 20; t++) { const s = randomSidewalk(), d = Math.hypot(s[0] - player.pos.x, s[1] - player.pos.z); if (d > 150 && d < 420) { spot = s; break; } }
  const guards = RI(2, 4), b = blockAt(spot[0], spot[1]);
  return { name: pick(BOSS_NAMES), area: AREA_NAMES[b ? b.dist : 'mixed'] || 'Şehir', x: spot[0], z: spot[1], guards, reward: Math.round((2000 + guards * 900 + MR(0, 800)) / 50) * 50 };
}
function npcPed(look, x, z) {
  const h = makeHuman(look);
  const p = { h, bi: 0, bj: 0, s: 0, dir: 1, speed: 0, dead: true, deadT: 0, panic: 0, free: false, x, z, fleeX: 0, fleeZ: 0, yaw: 0, npc: 'guard', hp: 2, shootT: 1 };
  h.g.visible = false; peds.push(p); return p;
}
function startContract(k) {
  if (state.mission) { floatText('Önce mevcut görevi bitir'); return; }
  const o = state.contractOffers[k]; state.contractOffers[k] = makeContract();
  if (!bountyNpcs.boss) {
    bountyNpcs.boss = npcPed({ skin: '#e0ac80', shirt: '#f2f2f2', pants: '#1a1a1e', hair: '#1a1210', shoes: '#101010', glasses: true }, 0, 0);
    for (let g = 0; g < 4; g++) bountyNpcs.guards.push(npcPed({ skin: pick(SKIN), shirt: '#16181c', pants: '#16181c', hair: '#101010', shoes: '#101010', glasses: true, gun: true }, 0, 0));
  }
  const place = (p, x, z, role, hp) => { const r = collide(x, z, 0.4, 0.5); p.x = r.x; p.z = r.z; p.dead = false; p.npc = role; p.hp = hp; p.shootT = MR(0.5, 1.5); p.yaw = Math.random() * 6; p.h.g.rotation.set(0, p.yaw, 0); p.h.g.visible = true; };
  place(bountyNpcs.boss, o.x, o.z, 'boss', 4);
  const guards = bountyNpcs.guards.slice(0, o.guards);
  guards.forEach((g, i) => { const a = i / o.guards * Math.PI * 2; place(g, o.x + Math.cos(a) * 2.8, o.z + Math.sin(a) * 2.8, 'guard', 2); });
  bountyNpcs.guards.slice(o.guards).forEach(g => { g.dead = true; g.h.g.visible = false; });
  state.mission = { type: 'bounty', boss: bountyNpcs.boss, guards, name: o.name, x: o.x, z: o.z, time: 240, reward: o.reward, alert: false };
  setMarker(o.x, o.z, 'bounty');
  showBig('KONTRAT KABUL EDİLDİ', '#ff4060', 3, `Hedef: ${o.name} · ${o.area} · ${o.guards} koruma · $${o.reward}`);
  haptic(40);
}
function hideBounty(m) { for (const p of [m.boss, ...m.guards]) { p.dead = true; p.h.g.visible = false; p.h.g.rotation.x = 0; } }
function hitPed(p) {
  if (p.npc && p.hp > 1) {
    p.hp--; if (state.mission && state.mission.type === 'bounty') state.mission.alert = true;
    for (let k = 0; k < 6; k++) FX.norm.spawn(p.x, 1.1, p.z, MR(-1.5, 1.5), MR(1, 3), MR(-1.5, 1.5), 0.4, 0.3, 0.2, 0.55, 0.02, 0.02, 0.9, 12);
    return;
  }
  killPed(p, true);
}
function updateBounty(dt, m) {
  const boss = m.boss;
  if (!m.alert && Math.hypot(player.pos.x - boss.x, player.pos.z - boss.z) < 26) { m.alert = true; floatText('⚠ Korumalar seni fark etti!'); }
  for (const p of [boss, ...m.guards]) {
    const h = p.h;
    if (p.dead) { h.g.position.set(p.x, groundY(p.x, p.z) + 0.12, p.z); continue; }
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
    let spd = 0, mx = 0, mz = 0;
    if (m.alert && !state.dead) {
      if (p.npc === 'boss') { spd = 4.3; mx = -dx / d; mz = -dz / d; }
      else {
        if (d > 13) { spd = 3.6; mx = dx / d; mz = dz / d; }
        p.shootT -= dt;
        if (d < 40 && p.shootT <= 0 && los(p.x, 1.4, p.z, player.pos.x, 1.3, player.pos.z)) {
          p.shootT = MR(0.8, 1.6); const hit = Math.random() < 0.35;
          FX.tracer(p.x, 1.45, p.z, player.pos.x + (hit ? 0 : MR(-2.5, 2.5)), player.pos.y + 1.2, player.pos.z + (hit ? 0 : MR(-2.5, 2.5)), true);
          AudioSys.shot(0.4);
          if (hit) { if (state.inCar) { damageCar(state.inCar, 4); state.health -= 1; } else applyDamage(5); }
        }
      }
    }
    if (spd) {
      const r = collide(p.x + mx * spd * dt, p.z + mz * spd * dt, 0.35, 0.5);
      if (r.hit && p.npc === 'boss') { const t = mx; mx = -mz; mz = t; }
      p.x = r.x; p.z = r.z;
    }
    const want = m.alert && p.npc === 'guard' ? Math.atan2(dx, dz) : spd ? Math.atan2(mx, mz) : p.yaw + Math.sin(state.now * 0.7 + p.x) * 0.004;
    p.yaw = wrapA(p.yaw + wrapA(want - p.yaw) * (1 - Math.exp(-8 * dt)));
    const c = state.inCar;
    if (c && carSpeed(c) > 6 && Math.hypot(c.group.position.x - p.x, c.group.position.z - p.z) < 1.7) { killPed(p, true); state.shake = 0.3; AudioSys.thud(); m.alert = true; continue; }
    h.g.position.set(p.x, groundY(p.x, p.z), p.z); h.g.rotation.y = p.yaw;
    animHuman(h, spd, dt, m.alert && p.npc === 'guard');
  }
}

// ============================================================ SMARTPHONE UI
const APPS = [['valet', '🚗', 'Vale', '#1e6ad8'], ['bank', '🏦', 'Banka', '#1a9a50'], ['contracts', '🎯', 'Kontrat', '#c8283a'], ['props', '🏠', 'Emlak', '#d88a10']];
function togglePhone() { if (state.phoneOpen) closePhone(); else openPhone(); }
function openPhone() {
  if (state.shopOpen || state.dead) return;
  state.phoneOpen = true; try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { }
  for (const k in keys) keys[k] = false;
  touchState.joyId = touchState.lookId = null; touchState.jdx = touchState.jdy = 0; $('joy').style.display = 'none';
  $('touch').style.display = 'none';
  if (!state.contractOffers.length) state.contractOffers = [makeContract(), makeContract(), makeContract()];
  $('phone').classList.add('open'); renderPhone('home'); AudioSys.tone(1200, 0.05, 0.08, 'sine');
}
function closePhone() {
  state.phoneOpen = false; $('phone').classList.remove('open');
  if (isTouch) $('touch').style.display = 'block';
  saveGame();
}
function renderPhone(app) {
  state.phoneApp = app;
  const sc = $('phScreen'), money = '$' + Math.round(state.money).toLocaleString('tr-TR');
  $('phClock').textContent = clockStr();
  const head = (title, col) => `<div class="phHead" style="background:${col}"><button class="phBack" data-app="home">‹</button><b>${title}</b><span>${money}</span></div>`;
  let h = '';
  if (app === 'home') {
    h = `<div class="phWall"><div class="phTime">${clockStr()}</div><div class="phDate">VISTA BAY · ${money}</div>
      <div class="phGrid">${APPS.map(([id, ic, n, col]) => `<button class="phApp" data-app="${id}"><i style="background:${col}">${ic}</i><span>${n}</span></button>`).join('')}</div></div>`;
  } else if (app === 'valet') {
    const list = ownedCars();
    const fav = list.find(c => c.fav);
    h = head('🚗 Vale', '#1e6ad8') + `<div class="phBody"><p class="phNote">Aracın en yakın yolun kenarına getirilir · Ücret $100</p>`;
    if (!list.length) h += `<div class="phEmpty">Kayıtlı aracın yok.<br>VISTA MOTORS galerisinden al ya da 🔧 Garajda bir aracı boyat/yükselt.</div>`;
    else {
      if (fav) h += `<button class="phBig" data-call="${cars.indexOf(fav)}">★ Favoriyi çağır · ${carName(fav)}</button>`;
      for (const c of list) {
        const col = '#' + c.paintM.color.getHexString(THREE.SRGBColorSpace), d = Math.round(Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z));
        h += `<div class="phRow"><i class="sw" style="background:${col}"></i><div><b>${carName(c)}</b><small>Motor ${c.up.engine}/3 · Fren ${c.up.grip}/3${c.up.armor ? ' · Zırhlı' : ''} · ${c.dead ? 'Hurda' : d + ' m'}</small></div>
          <button class="phStar ${c.fav ? 'on' : ''}" data-fav="${cars.indexOf(c)}">★</button><button class="phBtn" data-call="${cars.indexOf(c)}" ${c.dead || c === state.inCar ? 'disabled' : ''}>Çağır</button></div>`;
      }
    }
    h += '</div>';
  } else if (app === 'bank') {
    const st = S(), m = Math.floor(st.play / 60);
    const stats = [['Toplam kazanç', '$' + st.earned.toLocaleString('tr-TR')], ['Harcanan', '$' + st.spent.toLocaleString('tr-TR')], ['Saatlik mülk geliri', '+$' + propIncome()], ['Etkisiz hale getirilen', st.kills],
      ['Tamamlanan görev', st.missions], ['Başarısız görev', st.fails], ['Kontratlar', st.contracts], ['Çalınan araç', st.jacked], ['Gidilen yol', (st.dist / 1000).toFixed(1) + ' km'], ['En yüksek hız', Math.round(st.topSpeed) + ' km/s'], ['En yüksek aranma', '★'.repeat(st.maxWanted) || '—'], ['Oyun süresi', `${Math.floor(m / 60)} sa ${m % 60} dk`]];
    const done = ACHIEVEMENTS.filter(a => state.ach[a.id]).length;
    h = head('🏦 Banka', '#1a9a50') + `<div class="phBody"><div class="phBal"><small>Hesap bakiyesi</small><b>${money}</b></div>
      <div class="phSec">Son işlemler</div>${state.ledger.length ? state.ledger.map(l => `<div class="phLed"><span>${l.t}</span><span>${l.label}</span><b class="${l.amt < 0 ? 'neg' : ''}">${l.amt < 0 ? '-' : '+'}$${Math.abs(l.amt).toLocaleString('tr-TR')}</b></div>`).join('') : '<div class="phEmpty">Henüz işlem yok</div>'}
      <div class="phSec">İstatistikler</div><div class="phStats">${stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      <div class="phSec">Başarımlar ${done}/${ACHIEVEMENTS.length}</div>${ACHIEVEMENTS.map(a => `<div class="phAch ${state.ach[a.id] ? 'on' : ''}"><i>${state.ach[a.id] ? '🏆' : '🔒'}</i><div><b>${a.name}</b><small>${a.desc}</small></div><span>+$${a.reward}</span></div>`).join('')}</div>`;
  } else if (app === 'contracts') {
    const busy = !!state.mission;
    h = head('🎯 Kontratlar', '#c8283a') + `<div class="phBody"><p class="phNote">Korumalı hedefleri ortadan kaldır. Hedef kaçar, korumalar ateş eder.</p>${busy ? '<div class="phEmpty">Önce mevcut görevi bitir.</div>' : ''}
      ${state.contractOffers.map((o, k) => `<div class="phCard"><div><b>${o.name}</b><small>📍 ${o.area} · ${Math.round(Math.hypot(o.x - player.pos.x, o.z - player.pos.z))} m · 🛡 ${o.guards} koruma</small></div><div class="phCardR"><span>$${o.reward.toLocaleString('tr-TR')}</span><button class="phBtn red" data-contract="${k}" ${busy ? 'disabled' : ''}>Kabul et</button></div></div>`).join('')}</div>`;
  } else if (app === 'props') {
    const next = Math.ceil((1 - (state.time % 1)) * HOUR_SEC);
    h = head('🏠 Emlak', '#d88a10') + `<div class="phBody"><div class="phBal"><small>Saatlik gelir · sonraki ödeme ${next} sn</small><b>+$${propIncome()}</b></div>
      ${PROPERTIES.map(p => `<div class="phRow"><i class="phIc">${p.icon}</i><div><b>${p.name}</b><small>${state.props[p.id] ? `Senin · +$${p.income}/saat${state.spawnProp === p.id ? ' · 🛏 Doğuş' : ''}` : `$${p.price.toLocaleString('tr-TR')} · +$${p.income}/saat`}</small></div><button class="phBtn" data-gps="${p.id}">📍 GPS</button></div>`).join('')}
      <p class="phNote">Mülkü satın almak için önündeki yeşil halkaya git.</p></div>`;
  }
  sc.innerHTML = h;
}
function carName(c) { const n = { bike: 'Motosiklet', sedan: 'Sedan', van: 'Minibüs', pickup: 'Pikap', suv: 'SUV', sport: 'Spor Coupe', super: 'Süper Araba', armored: 'Zırhlı SUV', taxi: 'Taksi', police: 'Polis Aracı' }; return n[c.kind] || c.kind; }
function initPhone() {
  const ph = $('phone'), tap = (e) => {
    const t = e.target.closest('button'); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const d = t.dataset;
    if (d.app) renderPhone(d.app);
    else if (d.call) { if (callCar(cars[+d.call])) closePhone(); else renderPhone('valet'); }
    else if (d.fav) { const c = cars[+d.fav], was = c.fav; for (const o of cars) o.fav = false; c.fav = !was; saveGame(); renderPhone('valet'); }
    else if (d.contract) { startContract(+d.contract); closePhone(); }
    else if (d.gps) { const p = PROPERTIES.find(q => q.id === d.gps); state.waypoint = { x: p.zone.x, z: p.zone.z, label: p.name }; floatText('📍 ' + p.name + ' işaretlendi'); closePhone(); }
    else if (t.id === 'phClose' || t.id === 'phHomeBtn') { if (t.id === 'phHomeBtn' && state.phoneApp !== 'home') renderPhone('home'); else closePhone(); }
  };
  ph.addEventListener('click', tap);
  const pb = $('bPhone');
  pb.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); togglePhone(); }, { passive: false });
  pb.addEventListener('click', e => { e.stopPropagation(); togglePhone(); });
}

// ============================================================ RADIO (procedural synthwave)
const Radio = {
  timer: null, step: 0, next: 0, gain: null, on: false,
  CH: [[69, 72, 76, 45], [65, 69, 72, 41], [67, 72, 76, 48], [67, 71, 74, 43]],
  mtof: m => 440 * Math.pow(2, (m - 69) / 12),
  start() {
    const ctx = AudioSys.ctx; if (!ctx || this.timer) return;
    this.gain = ctx.createGain(); this.gain.gain.value = 0; this.gain.connect(AudioSys.master);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 2600; this.lp.connect(this.gain);
    this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 30);
  },
  tick() {
    const ctx = AudioSys.ctx, spb = 60 / 104 / 4;
    if (!this.on) { this.next = ctx.currentTime + 0.05; return; }
    while (this.next < ctx.currentTime + 0.15) { this.play(this.step, this.next); this.step = (this.step + 1) % 64; this.next += spb; }
  },
  note(freq, t, dur, vol, type, cut) {
    const ctx = AudioSys.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g; if (cut) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; g.connect(f); out = f; }
    o.connect(g); out.connect(this.lp); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(t, dur, vol, freq, type) {
    const ctx = AudioSys.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = AudioSys.noise;
    f.type = type; f.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.lp); s.start(t, Math.random()); s.stop(t + dur);
  },
  play(st, t) {
    const ch = this.CH[Math.floor(st / 16)], ctx = AudioSys.ctx;
    if (st % 4 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); g.connect(this.lp); o.start(t); o.stop(t + 0.32); }
    if (st % 8 === 4) this.noise(t, 0.22, 0.5, 1800, 'bandpass');
    if (st % 2 === 1) this.noise(t, 0.05, 0.18, 7000, 'highpass');
    if (st % 2 === 0) this.note(this.mtof(ch[3] + (st % 4 === 2 ? 12 : 0)), t, 0.2, 0.32, 'sawtooth', 700);
    this.note(this.mtof(ch[st % 3] + (st % 8 >= 4 ? 12 : 0)), t, 0.14, 0.09, 'square', 3000);
    if (st % 16 === 0) for (const n of ch.slice(0, 3)) for (const det of [-6, 6]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = this.mtof(n - 12); o.detune.value = det; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.025, t + 0.4); g.gain.linearRampToValueAtTime(0.0001, t + 2.3); o.connect(g); g.connect(this.lp); o.start(t); o.stop(t + 2.4); }
  },
  update(active) {
    if (!AudioSys.ctx) return;
    if (active && !this.timer) this.start();
    if (!this.gain) return;
    this.on = active || this.gain.gain.value > 0.01;
    this.gain.gain.setTargetAtTime(active ? 0.2 : 0, AudioSys.ctx.currentTime, 0.3);
  }
};
function toggleRadio() {
  state.soundMode = (state.soundMode + 1) % 3; state.radioOn = state.soundMode === 0;
  if (AudioSys.master) AudioSys.master.gain.setTargetAtTime(state.soundMode === 2 ? 0 : 0.55, AudioSys.ctx.currentTime, 0.05);
  $('bRadio').textContent = ['📻', '🔈', '🔇'][state.soundMode];
  floatText(['📻 Radyo açık · VISTA FM', '🔈 Radyo kapalı · Efektler açık', '🔇 Tüm sesler kapalı'][state.soundMode]); saveGame();
}

// ============================================================ MAIN LOOP
let frame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (state.shopOpen) { if (composer) composer.render(); else renderer.render(scene, camera); return; }
  state.now += dt; frame++;
  state.saveT += dt; if (state.saveT > 12) { state.saveT = 0; saveGame(); }
  readInput();
  updateSky(dt);
  if (state.dead) { state.deadTimer -= dt; if (state.deadTimer <= 0) respawn(); }
  else {
    if (state.inCar) updatePlayerCar(dt); else updatePlayerFoot(dt);
    if (input.fire) fire();
  }
  if (state.fireCd > 0) state.fireCd -= dt;
  for (const c of cars) {
    if (c === state.inCar) { c.group.visible = true; continue; }
    if (!c.active) continue;
    if (c.mode === 'ai') { const d = Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z); if (d > 300 && frame % 3) continue; updateAI(c, dt); }
    else if (c.mode === 'free' || c.mode === 'dead') { if (carSpeed(c) > 0.05 || c.air) carPhysics(c, dt, 0, 0, c.mode === 'dead'); }
    c.group.visible = Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) < 320;
  }
  const pd = updatePolice(dt);
  carCollisions();
  updatePeds(dt);
  updatePickups(dt);
  updateMission(dt);
  updateShops(dt);
  updateStarts(dt);
  updateEconomy(dt);
  if (state.phoneOpen) $('phClock').textContent = clockStr();
  updateTrafficLights();
  // wanted level dynamics
  state.crimeTimer += dt;
  if (state.heat > 0 && state.crimeTimer > 6) {
    const seen = state.policeSee || pd < 20;
    if (!seen) state.heat = Math.max(0, state.heat - dt * 0.09);
    state.blink = !seen;
  } else state.blink = false;
  state.wanted = Math.floor(state.heat);
  if (state.heat > 0 && state.heat < 1) state.heat = state.crimeTimer > 6 ? 0 : 1;
  // health
  if (state.health <= 0 && !state.dead) playerDown('BAYILDIN', 'Hastanede uyandın');
  if (state.wanted === 0 && state.health < 100 && !state.dead) state.health = Math.min(100, state.health + dt * 1.5);
  // sirens flash
  const ph = Math.sin(state.now * 14) > 0;
  M.sirenR.color.setRGB(ph ? 4 : 0.15, 0.05, 0.1); M.sirenB.color.setRGB(0.05, 0.15, ph ? 0.2 : 5);
  M.flash.intensity *= Math.exp(-dt * 6);
  carSmoke(dt);
  updateRockets(dt);
  updateWeather(dt);
  FX.add.update(dt); FX.norm.update(dt); FX.updateTracers(dt);
  ocean.material.uniforms.uTime.value = state.now;
  updateCamera(dt);
  updateHUD(dt);
  AudioSys.update(dt, pd);
  if (composer) composer.render(); else renderer.render(scene, camera);
}

