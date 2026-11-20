// VISTA BAY — open world city game (Three.js)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
try { const sq = JSON.parse(localStorage.getItem('vistabay_settings') || '{}').quality; if (sq) QUALITY = sq; } catch (e) { }
const qBtns = document.querySelectorAll('.quality button');
const setQ = q => { QUALITY = q; qBtns.forEach(b => b.classList.toggle('on', b.dataset.q === q)); };
qBtns.forEach(b => b.addEventListener('click', () => setQ(b.dataset.q)));
setQ(QUALITY);

$('playBtn').addEventListener('click', () => startGame(false));
async function startGame(online) {
  settings.quality = QUALITY; saveSettings();
  $('loading').style.display = 'block';
  try { if (isTouch && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) { }
  try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch (e) { }
  AudioSys.init();
  setTimeout(() => {
    init();
    $('start').style.display = 'none';
    $('hud').style.display = 'block'; document.body.classList.add('playing');
    if (isTouch) $('touch').style.display = 'block'; $('cross').style.display = 'block';
    showBig('VISTA BAY', '#ffffff', 3, 'Sarı halkalar = görev · 🔫 Silah · 🔧 Garaj · 🚗 Galeri haritada');
    if (online) mpAfterStart();
    lastT = performance.now();
    requestAnimationFrame(loop);
  }, 30);
}

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
  stats: { kills: 0, missions: 0, fails: 0, contracts: 0, earned: 0, spent: 0, dist: 0, topSpeed: 0, maxWanted: 0, jacked: 0, play: 0, stunts: 0, robberies: 0, racesWon: 0, heists: 0 }, turf: {}, packages: {}, stuntsDone: {}, truck: null, eventT: 150, timeScale: 1, timeTarget: 1, realDt: 0, stunt: null, curTurf: undefined, story: 0, look: null, dialog: null, photo: null, hidden: false, noSave: false, emote: null, interior: null, passenger: null, mpRace: null, raceInv: null, incoming: null, heist: null, spawnProt: 0, lastHitBy: null, lastHitT: -99, rain: 0, rainTarget: 0, weatherT: 70, lightning: 0, radioOn: true, weather: 'clear', cloud: 0.32, cloudTarget: 0.32, fog: 0, fogTarget: 0
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
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
  const dpr = Math.min(devicePixelRatio, QUALITY === 'high' ? 2 : QUALITY === 'medium' ? 1.25 : 0.8);
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
    if (QUALITY === 'medium') { fxaaPass = new ShaderPass(FXAAShader); composer.addPass(fxaaPass); fxaaPass.material.uniforms.resolution.value.set(1 / (innerWidth * dpr), 1 / (innerHeight * dpr)); }
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
  M.lampHead = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
  buildAirport();
  buildDoorMeshes();
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
  buildBusStops();
  spawnBuses();
  buildProperties();
  if (state.spawnProp) { const [x, z] = spawnPoint(); player.pos.set(x, 0.25, z); }
  buildStarts();
  buildDockAndPads();
  buildRoofAccess();
  buildSpecialVehicles();
  buildGang();
  buildStuntRamps();
  buildTurfs();
  buildPackages();
  setWeather('clear', false);
  if (AudioSys.master) AudioSys.master.gain.value = state.soundMode === 2 ? 0 : 0.55;
  spawnPeds();
  spawnPickups();
  initInput();
  initPhone();
  initExtrasUI();
  initPerf();
  buildStory();
  buildClothesShop();
  buildInteriors();
  markWorld();
  initOnlineUI();
  initStage2UI();
  updateSky(0);
  addEventListener('resize', onResize);
}
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  applyPixelRatio(perf.pr || renderer.getPixelRatio());
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
    aoRect(x, z, w, d, y0); registerDoor(b, x, z, w, d, y0, o.store ? 'shop' : style, undefined, 0, h);
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
      p.box(null, x, top - 0.45, z, w + 0.6, 0.4, d + 0.6, c);
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
    b.bld.push({ x0: x - w / 2 - 0.2, x1: x + w / 2 + 0.2, z0: z - d / 2 - 0.2, z1: z + d / 2 + 0.2, h: y0 + h + d * 0.4, pitch: { y: y0 + h, rh: d * 0.36, cz: z, half: d / 2 + 0.6 } });
    aoRect(x, z, w, d, y0); registerDoor(b, x, z, w, d, y0, 'house', 0, w * 0.22, h);
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
  for (const k in chunks) for (const m in chunks[k].o) CHUNK_MESHES.push(add(chunks[k].o[m], M.fac[m] || M[m], m !== 'sign' && m !== 'rail', m !== 'rail'));
}

// ============================================================ OCEAN
function buildOcean() {
  const seg = QUALITY === 'low' ? 60 : 160, geo = new THREE.PlaneGeometry(3200, 6000, seg, seg); geo.rotateX(-Math.PI / 2); geo.translate(SHORE_X - 10 + 1600, -0.25, 0);
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
  M.lampHead = M.lampHead || new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
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
    if (a >= 0 && a <= r.len && l <= r.w / 2) best = Math.max(best, (r.y0 || 0) + a / r.len * r.h);
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
  { const r = rampHeight(x, z); if (r > g) g = r; }
  if (x > BEACH_X0 && onDock(x, z)) g = Math.max(g, DOCK.y);
  return g;
}
const hitRes = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
let _cx = 0, _cz = 0;
function pushOut(b, r) {
  const cx = clamp(_cx, b.x0, b.x1), cz = clamp(_cz, b.z0, b.z1);
  let dx = _cx - cx, dz = _cz - cz; const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-8) { const d = Math.sqrt(d2); dx /= d; dz /= d; _cx = cx + dx * r; _cz = cz + dz * r; }
  else { // inside: push via min axis
    const l = _cx - b.x0, rr = b.x1 - _cx, t = _cz - b.z0, bb = b.z1 - _cz, m = Math.min(l, rr, t, bb);
    if (m === l) { dx = -1; dz = 0; _cx = b.x0 - r; } else if (m === rr) { dx = 1; dz = 0; _cx = b.x1 + r; } else if (m === t) { dx = 0; dz = -1; _cz = b.z0 - r; } else { dx = 0; dz = 1; _cz = b.z1 + r; }
  }
  hitRes.hit = true; hitRes.nx += dx; hitRes.nz += dz;
}
function collide(x, z, r, y = 0, bounds = true) {
  hitRes.hit = false; hitRes.nx = hitRes.nz = 0; _cx = x; _cz = z;
  const i0 = Math.floor((x - r - OFF) / CELL), i1 = Math.floor((x + r - OFF) / CELL), j0 = Math.floor((z - r - OFF) / CELL), j1 = Math.floor((z + r - OFF) / CELL);
  for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++)
    for (const b of blocks[i][j].bld) { if (y > b.h) continue; pushOut(b, r); }
  if (nearAir(z)) for (const b of EXTRA_BLD) { if (y > b.h || (b.y0 && y + 1.7 < b.y0)) continue; pushOut(b, r); }
  x = _cx; z = _cz;
  // world bounds
  if (bounds) {
    if (x < BOUNDS.x0) { x = BOUNDS.x0; hitRes.hit = true; hitRes.nx += 1; } if (x > BOUNDS.x1) { if (x < DOCK.x1 && Math.abs(z - DOCK.z) < DOCK.w / 2 + r) z = clamp(z, DOCK.z - DOCK.w / 2 + r, DOCK.z + DOCK.w / 2 - r); else { x = x < DOCK.x1 + 1 && Math.abs(z - DOCK.z) < DOCK.w / 2 ? DOCK.x1 : BOUNDS.x1; hitRes.hit = true; hitRes.nx -= 1; } }
    if (z < BOUNDS.z0) { z = BOUNDS.z0; hitRes.hit = true; hitRes.nz += 1; } if (z > BOUNDS.z1) { z = BOUNDS.z1; hitRes.hit = true; hitRes.nz -= 1; }
  }
  const nl = Math.hypot(hitRes.nx, hitRes.nz) || 1; hitRes.nx /= nl; hitRes.nz /= nl;
  hitRes.x = x; hitRes.z = z; return hitRes;
}
function insideBuilding(x, y, z) {
  if (nearAir(z)) for (const o of EXTRA_BLD) if (y < o.h && y > (o.y0 || -1) && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) return true;
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

// ============================================================ HEIGHTS: walkable roofs, pitched / arched roofs, structures outside the grid
const EXTRA_BLD = [];        // airport & other off-grid structures (same AABB format as block.bld, optional y0 = underside)
const AIR = { x0: -430, x1: 350, z0: 452, z1: 830 };
const inAirport = (x, z) => x > AIR.x0 && x < AIR.x1 && z > AIR.z0 && z < AIR.z1;
const nearAir = z => z > AIR.z0 - 20;
// actual top surface of a collision box at (x,z): flat roof, pitched house roof or arched hangar roof
function bldTop(o, x, z) {
  if (o.arch) { const a = o.arch, d = x - a.cx; return a.base + a.k * Math.sqrt(Math.max(0, a.r * a.r - d * d)); }
  if (o.pitch) { const p = o.pitch; return p.y + p.rh * Math.max(0, 1 - Math.abs(z - p.cz) / p.half); }
  return o.h;
}
// highest walkable surface under (x,z) that is not above the feet (+ a step of 0.6 m)
function surfaceY(x, z, yRef) {
  if (state.interior) return interiorSurface(INTERIORS[state.interior], x, z, yRef);
  let s = groundY(x, z);
  const lim = yRef + 0.6, b = blockAt(x, z);
  if (b) for (const o of b.bld) if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) { const t = bldTop(o, x, z); if (t <= lim && t > s) s = t; }
  if (nearAir(z)) for (const o of EXTRA_BLD) if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) { const t = bldTop(o, x, z); if (t <= lim && t > s) s = t; }
  return s;
}
// find a free spot next to a vehicle at the vehicle's own height (roof / helipad / ground) — no more teleport to y=0
function exitSpot(c) {
  const p = c.group.position, base = c.y ?? p.y, dist = c.spec.heli ? 2.8 : c.spec.plane ? 3.4 : 1.9;
  const ch = Math.cos(c.h), sh = Math.sin(c.h);
  const dirs = [[ch, -sh], [-ch, sh], [sh * 1.3, ch * 1.3], [-sh * 1.4, -ch * 1.4]];
  for (let pass = 0; pass < 2; pass++) for (const [dx, dz] of dirs) {
    const x = p.x + dx * dist, z = p.z + dz * dist, r = collide(x, z, 0.4, base + 0.3);
    if (pass === 0 && r.hit && Math.hypot(r.x - x, r.z - z) > 0.6) continue;
    const s = surfaceY(r.x, r.z, base + 0.4);
    if (base - s < 1.2) return [r.x, s, r.z];
  }
  return [p.x, surfaceY(p.x, p.z, base + 0.4), p.z];
}
function interiorSurface(I, x, z, yRef) {
  if (!I || !I.FH) return 0;
  let s = 0;
  for (const L of I.levels) { if (L.y > yRef + 0.6) break; const h = L.hole; if (x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1) continue; s = L.y; }
  for (const st of I.stairs) if (x > st.x0 && x < st.x1 && z >= st.za && z <= st.zb2) { const y = st.y + clamp((z - st.zb) / (st.zt - st.zb), 0, 1) * I.FH; if (y <= yRef + 0.6 && y > s) s = y; }
  return s;
}
function interiorBlocked(x, y, z) {
  const I = INTERIORS[state.interior]; if (!I) return false;
  if (x < I.x0 || x > I.x1 || z < I.z0 || z > I.z1) return true;
  for (const b of I.boxes) if (b.wall && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1) return true;
  return false;
}
const camBlocked = (x, y, z) => state.interior ? interiorBlocked(x, y, z) : insideBuilding(x, y, z);

// ============================================================ AIRPORT (south of the city: road, parking, terminal, apron, hangars, tower, runway)
const AIRPORT = {
  blk: { cx: 0, cz: 640, bld: EXTRA_BLD, doors: [] }, group: null, lightMat: null, beaconMat: null, glassMat: null, signMat: null,
  rwy: { x0: -400, x1: 330, z: 770, w: 50 }, taxi: { x0: -380, x1: 320, z0: 690, z1: 712 }, apron: { x0: -360, x1: 320, z0: 576, z1: 690 },
  terminal: { x0: -110, x1: 50, z0: 534, z1: 576, h: 15.2 }, tower: { x: -238, z: 611 }, gates: [-90, -40, 10], hangars: [], icon: [-30, 548]
};
function buildAirport() {
  const A = AIRPORT, grp = new THREE.Group(); A.group = grp; scene.add(grp);
  BOUNDS.z1 = AIR.z1 + 20;
  const L = new Map(), add = (mat, geo) => { if (!L.has(mat)) L.set(mat, []); L.get(mat).push(geo); };
  const rep = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const S = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
  const asphalt = new THREE.MeshStandardMaterial({ map: rep(noiseTex('#3b3d41', ['#33353a', '#45474b', '#2d2f33', '#4a4c50'], 256, 7000, 1, 3)), roughness: 0.88 });
  const concrete = new THREE.MeshStandardMaterial({ map: rep(noiseTex('#7e7c77', ['#74726d', '#8a8883', '#787671', '#908e88'], 256, 6000, 1, 4)), roughness: 0.95 });
  const paintW = S(0xe6e6e0), paintY = S(0xe0a820), wall = S(0xdcd8d0), dark = S(0x3a3e44, { roughness: 0.5, metalness: 0.4 }), metal = S(0xb8bec4, { metalness: 0.55, roughness: 0.45 });
  const hangarM = new THREE.MeshStandardMaterial({ map: rep(canvasTex(128, 128, g => { g.fillStyle = '#b4bac0'; g.fillRect(0, 0, 128, 128); for (let x = 0; x < 128; x += 8) { g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(x, 0, 2, 128); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 2, 0, 1, 128); } })), metalness: 0.45, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x5a7890, metalness: 0.75, roughness: 0.08, emissive: 0xffe2b0, emissiveIntensity: 0 }); A.glassMat = glass;
  const flat = (x0, x1, z0, z1, y, mat, uv = 8) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); const p = g.attributes.position, u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, p.getX(i) / uv, p.getZ(i) / uv); add(mat, g); };
  const bx = (x, y, z, w, h, d, mat) => add(mat, new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z));
  const cy = (x, y, z, r, h, mat, seg = 12, r2 = r) => add(mat, new THREE.CylinderGeometry(r, r2, h, seg).translate(x, y + h / 2, z));
  const coll = (x0, x1, z0, z1, h, extra = {}) => { const o = { x0, x1, z0, z1, h, ...extra }; EXTRA_BLD.push(o); return o; };
  const edgeZ = HALF + ROAD / 2;
  // ---- paved surfaces
  flat(-9, 9, edgeZ - 0.5, 470, 0.045, asphalt);                                   // access road
  flat(-12.5, -9, edgeZ, 470, 0.06, concrete, 4); flat(9, 12.5, edgeZ, 470, 0.06, concrete, 4); // sidewalks
  flat(-120, 60, 470, 534, 0.045, asphalt);                                        // parking + drop-off
  flat(60, 76, 470, 582, 0.047, asphalt);                                          // service road to the apron gate
  flat(A.apron.x0, A.apron.x1, A.apron.z0, A.apron.z1, 0.04, concrete);            // apron
  flat(A.taxi.x0, A.taxi.x1, A.taxi.z0, A.taxi.z1, 0.05, asphalt);                 // parallel taxiway
  for (const x of [-380, -60, 298]) flat(x, x + 22, 712, 745, 0.05, asphalt);      // runway connectors
  // ---- markings
  for (let z = edgeZ + 2; z < 468; z += 6) flat(-0.12, 0.12, z, z + 3, 0.052, paintW, 1);
  for (const [z0, z1] of [[480, 491], [503, 514]]) for (let x = -114; x <= 54; x += 3) flat(x - 0.06, x + 0.06, z0, z1, 0.052, paintW, 1);
  flat(-118, 58, 522, 522.3, 0.052, paintW, 1);
  for (const gx of A.gates) { flat(gx - 0.15, gx + 0.15, 580, 684, 0.046, paintY, 1); flat(gx - 3, gx + 3, 604, 604.4, 0.046, paintY, 1); }
  flat(A.taxi.x0, A.taxi.x1, 700.8, 701.2, 0.056, paintY, 1);
  for (const x of [-380, -60, 298]) { flat(x + 10.8, x + 11.2, 701, 745, 0.056, paintY, 1); for (const o of [0, 0.9]) flat(x, x + 22, 716 + o, 716.3 + o, 0.056, paintY, 1); }
  flat(A.apron.x0, A.apron.x1, 689.6, 690, 0.046, paintY, 1);
  // ---- runway with painted markings
  const RW = A.rwy.x1 - A.rwy.x0;
  const rwyTex = canvasTex(4096, 280, g => {
    const W = 4096, H = 280, sx = W / RW, sz = H / A.rwy.w;
    g.fillStyle = '#3a3c40'; g.fillRect(0, 0, W, H); speckle(g, W, H, 40000, ['#34363a', '#44464a', '#2e3034', '#4c4e52'], 1, 3);
    g.fillStyle = 'rgba(18,18,20,0.35)'; for (const x0 of [55, RW - 175]) for (let i = 0; i < 70; i++) g.fillRect((x0 + Math.random() * 120) * sx, (25 + (Math.random() - 0.5) * 12) * sz, (8 + Math.random() * 30) * sx, 0.45 * sz);
    g.fillStyle = '#e8e8e2';
    g.fillRect(0, 1.2 * sz, W, 0.9 * sz); g.fillRect(0, H - 2.1 * sz, W, 0.9 * sz);
    for (let x = 75; x < RW - 75; x += 50) g.fillRect(x * sx, 24.55 * sz, 30 * sx, 0.9 * sz);
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) { const zz = (25 + s * (4.5 + i * 2.4) - 0.6) * sz; g.fillRect(6 * sx, zz, 30 * sx, 1.2 * sz); g.fillRect((RW - 36) * sx, zz, 30 * sx, 1.2 * sz); }
    for (const x of [130, 175, RW - 155, RW - 200]) for (const s of [-1, 1]) g.fillRect(x * sx, (25 + s * 8 - 1) * sz, 22 * sx, 2 * sz);
    g.font = `bold ${Math.round(14 * sz)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(56 * sx, 25 * sz); g.rotate(Math.PI / 2); g.fillText('09', 0, 0); g.restore();
    g.save(); g.translate((RW - 56) * sx, 25 * sz); g.rotate(-Math.PI / 2); g.fillText('27', 0, 0); g.restore();
  });
  rwyTex.anisotropy = 8;
  const rwy = new THREE.Mesh(new THREE.PlaneGeometry(RW, A.rwy.w).rotateX(-Math.PI / 2).translate((A.rwy.x0 + A.rwy.x1) / 2, 0.055, A.rwy.z), new THREE.MeshStandardMaterial({ map: rwyTex, roughness: 0.85 }));
  rwy.receiveShadow = true; grp.add(rwy);
  // ---- terminal
  const T = A.terminal, tcx = (T.x0 + T.x1) / 2, tcz = (T.z0 + T.z1) / 2;
  bx(tcx, 0, tcz + 0.2, T.x1 - T.x0, 14, T.z1 - T.z0 - 0.4, wall);
  bx(tcx, 1.0, T.z0 + 0.12, T.x1 - T.x0 - 6, 11.5, 0.24, glass);                                          // glass curtain wall
  for (let x = T.x0 + 3; x <= T.x1 - 3; x += 5) bx(x, 0.4, T.z0 - 0.04, 0.22, 12.4, 0.16, dark);        // mullions
  for (const y of [3.2, 6.5, 12.4]) bx(tcx, y, T.z0 - 0.04, T.x1 - T.x0 - 6, 0.22, 0.16, dark);
  bx(tcx, 14, (516 + 580) / 2, T.x1 - T.x0 + 12, 1.2, 64, metal);                                         // canopy roof
  for (let x = T.x0 - 4; x <= T.x1 + 4; x += 20) cy(x, 0, 519, 0.45, 14, metal, 10);
  for (let x = T.x0 + 8; x < T.x1 - 6; x += 22) bx(x, 0, 524.5, 1.6, 0.45, 0.6, dark);                  // benches at the kerb
  coll(T.x0, T.x1, T.z0, T.z1, T.h);
  coll(T.x0 - 6, T.x1 + 6, 516, T.z0, 15.2, { y0: 14 });
  for (let x = T.x0 - 4; x <= T.x1 + 4; x += 20) coll(x - 0.45, x + 0.45, 518.55, 519.45, 14);
  const signM = new THREE.MeshBasicMaterial({ map: canvasTex(2048, 64, g => { g.fillStyle = '#10161e'; g.fillRect(0, 0, 2048, 64); g.fillStyle = '#ffffff'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('✈  VISTA BAY ULUSLARARASI HAVALİMANI  ✈', 1024, 34); }), toneMapped: false }); A.signMat = signM;
  { const s = new THREE.Mesh(new THREE.PlaneGeometry(96, 3), signM); s.rotation.y = Math.PI; s.position.set(tcx, 14.6, 515.9); grp.add(s); }
  registerDoor(A.blk, tcx, tcz, T.x1 - T.x0, T.z1 - T.z0, 0, 'terminal', 1, 0, T.h);
  Object.assign(DOORS[DOORS.length - 1], { name: 'Yolcu Terminali', bld: EXTRA_BLD[0] });
  // jet bridges
  for (const gx of A.gates) {
    bx(gx, 3.4, 588, 3.2, 2.6, 24, metal); bx(gx, 3.2, 598.5, 4.4, 3.2, 3.2, dark);
    for (const s of [-1, 1]) cy(gx + s * 1.1, 0, 597, 0.22, 3.3, dark, 8);
    coll(gx - 2.2, gx + 2.2, T.z1, 600.1, 6.4, { y0: 3.2 }); coll(gx - 1.4, gx + 1.4, 596.7, 597.3, 3.3);
  }
  // ---- hangars (arched roofs)
  for (let i = 0; i < 3; i++) {
    const hx = 160 + i * 58, z0 = 596, z1 = 646, w = 52, r = w / 2, base = 10, k = 0.32;
    bx(hx, 0, (z0 + z1) / 2, w, base, z1 - z0, hangarM);
    add(hangarM, new THREE.CylinderGeometry(r, r, z1 - z0, 22, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, k, 1).translate(hx, base, (z0 + z1) / 2));
    const doorM = new THREE.MeshStandardMaterial({ map: canvasTex(256, 128, g => { g.fillStyle = '#5e646c'; g.fillRect(0, 0, 256, 128); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < 128; y += 10) g.fillRect(0, y, 256, 2); for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 2, 128); g.fillStyle = '#ffd23a'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.fillText('H' + (i + 1), 128, 80); }), metalness: 0.4, roughness: 0.5 });
    const d = new THREE.Mesh(new THREE.BoxGeometry(42, 9.4, 0.3).translate(hx - 3, 4.7, z1 + 0.1), doorM); d.receiveShadow = true; grp.add(d);
    const o = coll(hx - r, hx + r, z0, z1 + 0.3, base + r * k, { arch: { cx: hx, r, base, k } });
    registerDoor(A.blk, hx, (z0 + z1) / 2, w, z1 - z0, 0, 'warehouse', 0, 21, base);
    Object.assign(DOORS[DOORS.length - 1], { name: `Hangar ${i + 1}`, bld: o, noRoof: true });
    A.hangars.push({ x: hx, z0, z1 });
  }
  // ---- control tower (enterable, roof = top of the cab)
  { const { x, z } = A.tower;
    bx(x, 0, z, 14, 9, 14, wall); cy(x, 9, z, 3, 25, wall, 16);
    cy(x, 33.4, z, 7.4, 0.5, metal, 8); cy(x, 33.9, z, 7, 5, glass, 8, 6.3); cy(x, 38.9, z, 7.6, 0.9, metal, 8); cy(x + 4.6, 39.8, z + 4.6, 0.12, 7, dark, 6);
    coll(x - 7, x + 7, z - 7, z + 7, 9); coll(x - 3, x + 3, z - 3, z + 3, 34); const cab = coll(x - 7, x + 7, z - 7, z + 7, 39.8, { y0: 33.4 });
    registerDoor(A.blk, x, z, 14, 14, 0, 'tower', 1, 0, 39.8);
    Object.assign(DOORS[DOORS.length - 1], { name: 'Kontrol Kulesi', bld: cab });
    A.beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const bcn = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), A.beaconMat); bcn.position.set(x + 4.6, 47, z + 4.6); grp.add(bcn);
  }
  // ---- perimeter fence (airside)
  const fenceTex = rep(canvasTex(64, 64, g => { g.strokeStyle = 'rgba(205,210,215,0.95)'; g.lineWidth = 3; g.beginPath(); for (let i = -64; i < 128; i += 16) { g.moveTo(i, 0); g.lineTo(i + 64, 64); g.moveTo(i, 64); g.lineTo(i + 64, 0); } g.stroke(); g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, 64, 5); }));
  const fenceM = new THREE.MeshStandardMaterial({ map: fenceTex, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 });
  const segs = [[-420, 580, 60, 580], [76, 580, 340, 580], [-420, 815, 340, 815], [-420, 580, -420, 815], [340, 580, 340, 815]];
  for (const [ax, az, bx2, bz] of segs) {
    const len = Math.hypot(bx2 - ax, bz - az), alongX = az === bz, g = new THREE.PlaneGeometry(len, 2.4);
    const u = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < u.count; i++) u.setXY(i, p.getX(i) / 2.4, p.getY(i) / 2.4);
    if (!alongX) g.rotateY(Math.PI / 2); g.translate((ax + bx2) / 2, 1.3, (az + bz) / 2); add(fenceM, g);
    for (let t = 0; t <= len; t += 4) { const fx = ax + (bx2 - ax) * t / len, fz = az + (bz - az) * t / len; bx(fx, 0, fz, 0.1, 2.7, 0.1, metal); }
    if (alongX) coll(Math.min(ax, bx2), Math.max(ax, bx2), az - 0.15, az + 0.15, 2.6); else coll(ax - 0.15, ax + 0.15, Math.min(az, bz), Math.max(az, bz), 2.6);
  }
  bx(62, 0, 579.6, 0.4, 1.1, 0.4, dark); add(S(0xd83030), new THREE.BoxGeometry(0.16, 6, 0.16).translate(62, 4.1, 579.6));   // raised gate barrier
  // ---- lights: runway edge (white), thresholds (green / red), taxiway edge (blue)
  const lp = [];
  for (let x = A.rwy.x0; x <= A.rwy.x1; x += 30) for (const s of [-1, 1]) lp.push([x, A.rwy.z + s * 25.6, 0xfff2d0]);
  for (let z = A.rwy.z - 23; z <= A.rwy.z + 23; z += 4) { lp.push([A.rwy.x0 - 1, z, 0x30ff60]); lp.push([A.rwy.x1 + 1, z, 0xff3030]); }
  for (let x = A.taxi.x0; x <= A.taxi.x1; x += 30) for (const z of [A.taxi.z0 + 0.5, A.taxi.z1 - 0.5]) lp.push([x, z, 0x3a6aff]);
  A.lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const li = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 6).translate(0, 0.2, 0), A.lightMat, lp.length), mm = new THREE.Matrix4();
  lp.forEach(([x, z, c], i) => { li.setMatrixAt(i, mm.makeTranslation(x, 0, z)); li.setColorAt(i, new THREE.Color(c)); }); grp.add(li);
  // ---- street lamps, apron masts, windsock, sign, palms
  const lamp = (x, z, rot, h = 9) => { cy(x, 0, z, 0.12, h, dark, 8, 0.16); const ax = Math.sin(rot), az = Math.cos(rot); add(dark, new THREE.BoxGeometry(0.12, 0.12, 2).rotateY(rot).translate(x + ax, h, z + az)); add(M.lampHead, new THREE.BoxGeometry(0.5, 0.1, 0.9).rotateY(rot).translate(x + ax * 1.9, h - 0.08, z + az * 1.9)); };
  for (let z = edgeZ + 12; z < 468; z += 30) { lamp(-11, z, Math.PI / 2); lamp(11, z, -Math.PI / 2); }
  for (const x of [-100, -60, -20, 20]) lamp(x, 497, 0);
  for (const x of [-330, -200, 120, 300]) { cy(x, 0, 586, 0.35, 22, metal, 8, 0.45); bx(x, 22, 586.6, 3.4, 0.5, 1, M.lampHead); bx(x, 22.4, 586, 3.6, 0.3, 1.4, dark); }
  cy(310, 0, 735, 0.08, 6, metal, 6);
  add(S(0xff7a1a), new THREE.ConeGeometry(0.55, 2.6, 10, 1, true).rotateZ(-Math.PI / 2).translate(311.3, 5.7, 735));
  for (const s of [-1, 1]) cy(13 + s * 2.8, 0, 380, 0.1, 5.6, metal, 6);
  bx(13, 4, 380, 6.4, 2.4, 0.18, S(0x1d5a3a));
  { const sm = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), new THREE.MeshBasicMaterial({ map: canvasTex(256, 96, g => { g.fillStyle = '#1d5a3a'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(6, 6, 244, 84); g.fillStyle = '#fff'; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('✈ HAVALİMANI', 128, 50); }) })); sm.rotation.y = Math.PI; sm.position.set(13, 5.2, 379.89); grp.add(sm); }
  for (let z = edgeZ + 20; z < 466; z += 14) PALMS.push([-15, 0.02, z], [15, 0.02, z + 7]);
  for (let x = -110; x <= 50; x += 20) PALMS.push([x, 0.02, 467]);
  // ---- merge everything per material
  const shadows = QUALITY !== 'low';
  for (const [mat, list] of L) {
    const m = new THREE.Mesh(merge(list), mat); m.receiveShadow = true;
    m.castShadow = shadows && mat !== asphalt && mat !== concrete && mat !== paintW && mat !== paintY && mat !== fenceM; grp.add(m);
  }
}
function updateAirport(dt) {
  if (state.scoutT > 0) state.scoutT -= dt;
  const A = AIRPORT; if (!A.group) return;
  const cx = camera.position.x, cz = camera.position.z, dx = Math.max(AIR.x0 - cx, 0, cx - AIR.x1), dz = Math.max(AIR.z0 - 90 - cz, 0, cz - AIR.z1);
  A.group.visible = !state.interior && Math.hypot(dx, dz) < (QUALITY === 'low' ? 420 : 800) + Math.max(0, camera.position.y) * 3;
  if (!A.group.visible) return;
  A.lightMat.color.setScalar(0.3 + nightF * 2.8);
  A.beaconMat.color.setRGB(Math.sin(state.now * 4) > 0.55 ? 4 : 0.25, 0.02, 0.02);
  A.glassMat.emissiveIntensity = nightF * 0.35;
  A.signMat.color.setScalar(0.75 + nightF * 0.6);
}
function drawAirportMap(g, X, Z, k) {
  const A = AIRPORT, rect = (x0, x1, z0, z1) => g.fillRect(X(x0), Z(z0), (x1 - x0) * k, (z1 - z0) * k);
  g.fillStyle = '#5c6068'; rect(-9, 9, HALF, 470); rect(-120, 60, 470, 534); rect(60, 76, 470, 582);
  g.fillStyle = '#86868a'; rect(A.apron.x0, A.apron.x1, A.apron.z0, A.apron.z1);
  g.fillStyle = '#50535a'; rect(A.taxi.x0, A.taxi.x1, A.taxi.z0, A.taxi.z1); for (const x of [-380, -60, 298]) rect(x, x + 22, 712, 745);
  g.fillStyle = '#2e3034'; rect(A.rwy.x0, A.rwy.x1, A.rwy.z - A.rwy.w / 2, A.rwy.z + A.rwy.w / 2);
  g.fillStyle = '#e8e8e2'; for (let x = A.rwy.x0 + 75; x < A.rwy.x1 - 75; x += 50) rect(x, x + 30, A.rwy.z - 0.8, A.rwy.z + 0.8);
  for (const o of EXTRA_BLD) { const thin = o.x1 - o.x0 < 1 || o.z1 - o.z0 < 1; g.fillStyle = thin ? '#a8b0b8' : '#454a54'; rect(o.x0, Math.max(o.x1, o.x0 + 0.8), o.z0, Math.max(o.z1, o.z0 + 0.8)); }
}

// ============================================================ HUMANS
function makeHuman(look) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const C = (geo, col) => colorize(geo, col);
  const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  // torso: shaped chest/waist (lathe) squashed front-to-back
  const torso = C(lathe([[0.001, 1.02], [0.16, 1.03], [0.15, 1.14], [0.175, 1.3], [0.205, 1.44], [0.2, 1.53], [0.13, 1.6], [0.001, 1.61]]).scale(1, 1, 0.62), look.shirt);
  const pelvis = C(lathe([[0.001, 0.86], [0.15, 0.88], [0.17, 0.96], [0.162, 1.05], [0.001, 1.06]]).scale(1, 1, 0.66), look.pants);
  const neck = C(new THREE.CylinderGeometry(0.052, 0.06, 0.14, 10).translate(0, 1.65, 0), look.skin);
  const head = C(new THREE.SphereGeometry(0.115, 18, 14).scale(0.92, 1.08, 1).translate(0, 1.79, 0.005), look.skin);
  const jaw = C(new THREE.SphereGeometry(0.085, 14, 10).scale(1, 0.75, 1).translate(0, 1.72, 0.025), look.skin);
  const nose = C(new THREE.ConeGeometry(0.018, 0.05, 8).rotateX(Math.PI / 2).translate(0, 1.78, 0.115), look.skin);
  const ears = [1, -1].map(s => C(new THREE.SphereGeometry(0.026, 8, 6).scale(0.5, 1, 0.8).translate(s * 0.104, 1.79, 0), look.skin));
  const eyes = [1, -1].map(s => C(new THREE.SphereGeometry(0.014, 8, 6).translate(s * 0.04, 1.805, 0.1), '#1a1410'));
  const hair = C(new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.96, 1.02, 1.04).translate(0, 1.805, -0.012), look.hair);
  const parts = [torso, pelvis, neck, head, jaw, nose, ...ears, ...eyes, hair];
  if (look.longHair) parts.push(C(new THREE.CapsuleGeometry(0.1, 0.22, 4, 10).scale(1.25, 1, 0.55).translate(0, 1.66, -0.085), look.hair));
  if (look.cap) parts.push(C(new THREE.SphereGeometry(0.128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 1.83, -0.005), look.cap), C(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 16, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.2).translate(0, 1.835, 0.09), look.cap));
  if (look.backpack) parts.push(C(new THREE.CapsuleGeometry(0.15, 0.2, 4, 10).scale(1.15, 1, 0.6).translate(0, 1.3, -0.2), look.backpack), ...[1, -1].map(sx => C(new THREE.BoxGeometry(0.04, 0.4, 0.2).translate(sx * 0.11, 1.38, -0.05), '#1a1a1a')));
  if (look.glasses) parts.push(C(new THREE.BoxGeometry(0.2, 0.035, 0.02).translate(0, 1.808, 0.112), '#0a0a0a'), ...[1, -1].map(s => C(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 12).rotateX(Math.PI / 2).translate(s * 0.042, 1.805, 0.118), '#101418')));
  const body = new THREE.Mesh(merge(parts), M.human);
  // arms: upper arm + forearm/hand on an elbow pivot
  const mkLimb = (px, py, upper, lower, lowerY) => {
    const p = new THREE.Group(); p.position.set(px, py, 0); g.add(p);
    const um = new THREE.Mesh(upper, M.human); um.castShadow = true; p.add(um);
    const j = new THREE.Group(); j.position.y = lowerY; p.add(j);
    const lm = new THREE.Mesh(lower, M.human); lm.castShadow = true; j.add(lm);
    return [p, j];
  };
  const upperArm = merge([C(new THREE.SphereGeometry(0.075, 10, 8).translate(0, -0.02, 0), look.shirt), C(new THREE.CapsuleGeometry(0.058, 0.2, 4, 10).translate(0, -0.15, 0), look.shirt)]);
  const foreArm = merge([C(new THREE.CapsuleGeometry(0.048, 0.2, 4, 10).translate(0, -0.14, 0), look.skin), C(new THREE.SphereGeometry(0.052, 10, 8).scale(0.85, 1.15, 0.7).translate(0, -0.3, 0.01), look.skin)]);
  const shortsL = !!look.shorts;
  const thigh = merge([C(new THREE.CapsuleGeometry(0.083, 0.3, 4, 10).translate(0, -0.21, 0), look.pants)]);
  const shin = merge([C(new THREE.CapsuleGeometry(0.066, 0.32, 4, 10).translate(0, -0.2, 0), shortsL ? look.skin : look.pants),
    C(new THREE.SphereGeometry(0.07, 12, 8).scale(0.9, 0.55, 1.75).translate(0, -0.42, 0.045), look.shoes || '#222')]);
  const [armL, elbowL] = mkLimb(0.235, 1.52, upperArm, foreArm, -0.29);
  const [armR, elbowR] = mkLimb(-0.235, 1.52, upperArm, foreArm, -0.29);
  const [legL, kneeL] = mkLimb(0.095, 0.93, thigh, shin, -0.42);
  const [legR, kneeR] = mkLimb(-0.095, 0.93, thigh, shin, -0.42);
  body.castShadow = true; g.add(body); // keep body at children[4]
  if (look.gun) { const gun = new THREE.Mesh(merge([C(new THREE.BoxGeometry(0.035, 0.07, 0.2).translate(0, -0.3, 0.09), '#111'), C(new THREE.BoxGeometry(0.03, 0.1, 0.045).translate(0, -0.36, 0.03), '#1a1a1a')]), M.human); elbowR.add(gun); }
  scene.add(g);
  return { g, armL, armR, legL, legR, elbowL, elbowR, kneeL, kneeR, phase: Math.random() * 6 };
}
function animHuman(h, speed, dt, aiming) {
  h.phase += dt * (2 + speed * 1.9);
  const amp = clamp(speed / 5, 0, 1) * (speed > 4 ? 0.95 : 0.6), s = Math.sin(h.phase), cph = Math.cos(h.phase);
  h.legL.rotation.x = s * amp; h.legR.rotation.x = -s * amp;
  h.kneeL.rotation.x = Math.max(0, -cph) * amp * 1.3 + 0.05; h.kneeR.rotation.x = Math.max(0, cph) * amp * 1.3 + 0.05;
  h.armL.rotation.x = -s * amp * 0.8; h.armR.rotation.x = aiming ? -Math.PI / 2 : s * amp * 0.8;
  h.elbowL.rotation.x = -(0.15 + amp * 0.6); h.elbowR.rotation.x = aiming ? 0 : -(0.15 + amp * 0.6);
  h.armL.rotation.z = 0.06; h.armR.rotation.z = aiming ? 0 : -0.06;
  h.g.children[4].position.y = Math.abs(cph) * amp * 0.05;
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
// smooth rounded polygon (rounds every corner with a quadratic curve)
function roundedShape(pts, t = 0.32) {
  const sh = new THREE.Shape(), n = pts.length, P = i => pts[(i + n) % n];
  const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const m0 = lerp2(P(0), P(1), 0.5); sh.moveTo(m0[0], m0[1]);
  for (let i = 1; i <= n; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), p0 = lerp2(b, a, t), p1 = lerp2(b, c, t);
    sh.lineTo(p0[0], p0[1]); sh.quadraticCurveTo(b[0], b[1], p1[0], p1[1]);
    if (i < n) { const m = lerp2(b, c, 0.5); sh.lineTo(m[0], m[1]); }
  }
  sh.closePath(); return sh;
}
function carGeos(kind) {
  if (carGeoCache[kind]) return carGeoCache[kind];
  const s = CAR_SPECS[kind], W = s.W;
  const ext = (pts, depth, bev, t) => {
    const g = new THREE.ExtrudeGeometry(roundedShape(pts, t), { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 6 });
    g.translate(0, 0, -depth / 2); g.computeVertexNormals(); return g;
  };
  const RB = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
  const body = ext(s.body, W - 0.3, 0.15, 0.3), cab = ext(s.cab, s.cabW ? s.cabW - 0.2 : W - 0.52, 0.1, s.cabW ? 0.08 : 0.22);
  const p1 = s.cab[1], p2 = s.cab[2];
  const roof = RB(Math.abs(p1[0] - p2[0]) + 0.3, 0.07, W - 0.5, 0.035).translate((p1[0] + p2[0]) / 2, Math.max(p1[1], p2[1]) + 0.085, 0);
  const paint = merge([body, roof]);
  const fx = s.body[2][0], rx = s.body[7][0], ly = s.body[2][1] + 0.06;
  let lights = merge([
    colorize(RB(0.12, 0.13, 0.42, 0.05).translate(fx - 0.06, ly, 0.6), '#fff4dd'), colorize(RB(0.12, 0.13, 0.42, 0.05).translate(fx - 0.06, ly, -0.6), '#fff4dd'),
    colorize(RB(0.1, 0.14, 0.5, 0.04).translate(rx + 0.05, ly + 0.08, 0.58), '#ff1a10'), colorize(RB(0.1, 0.14, 0.5, 0.04).translate(rx + 0.05, ly + 0.08, -0.58), '#ff1a10')]);
  const trimL = [colorize(RB(0.24, 0.24, W - 0.12, 0.09).translate(fx - 0.02, s.body[0][1] + 0.05, 0), '#1a1a1c'), colorize(RB(0.24, 0.24, W - 0.12, 0.09).translate(rx + 0.02, s.body[0][1] + 0.05, 0), '#1a1a1c'),
    colorize(RB(0.06, 0.2, 0.9, 0.025).translate(fx + 0.03, ly - 0.14, 0), '#0e0e10')];
  // side skirts
  for (const sz of [1, -1]) trimL.push(colorize(RB(Math.abs(s.wx * 2) - s.wr * 2.4, 0.08, 0.06, 0.03).translate(0, s.body[0][1] - 0.02, sz * (W / 2 - 0.02)), '#141416'));
  if (kind === 'police') trimL.push(colorize(RB(Math.abs(p1[0] - p2[0]) + 0.32, 0.075, W - 0.48, 0.035).translate((p1[0] + p2[0]) / 2, Math.max(p1[1], p2[1]) + 0.09, 0), '#f4f4f4'),
    colorize(RB(2.0, 0.34, W + 0.02, 0.08).translate(0.0, 0.68, 0), '#f4f4f4'));
  const c0 = s.cab[0];
  trimL.push(colorize(RB(0.03, 0.12, 0.34, 0.012).translate(fx + 0.02, s.body[0][1] + 0.12, 0), '#f2f2ea'), colorize(RB(0.03, 0.12, 0.34, 0.012).translate(rx - 0.02, ly - 0.1, 0), '#f2f2ea'));
  for (const sz of [1, -1]) trimL.push(colorize(new THREE.SphereGeometry(0.09, 10, 8).scale(1, 0.75, 1.1).translate(c0[0] - 0.22, c0[1] + 0.08, sz * (W / 2 + 0.03)), '#1a1a1c'));
  if (kind === 'armored') trimL.push(colorize(RB(0.12, 0.5, W - 0.2, 0.05).translate(fx + 0.12, s.body[0][1] + 0.3, 0), '#2a2a2a'), colorize(RB(2.6, 0.08, W + 0.04, 0.03).translate(-0.2, s.body[4][1] - 0.1, 0), '#3a3c40'));
  if (kind === 'pickup') trimL.push(colorize(RB(1.7, 0.05, W - 0.32, 0.02).translate(-1.65, 1.3, 0), '#141414'));
  if (kind === 'taxi') trimL.push(colorize(RB(0.5, 0.2, 0.25, 0.06).translate((p1[0] + p2[0]) / 2, Math.max(p1[1], p2[1]) + 0.22, 0), '#ffe36e'));
  if (kind === 'bus') { trimL.push(colorize(RB(11, 0.28, W + 0.03, 0.1).translate(-0.05, 1.3, 0), '#1e5ab4'), colorize(RB(0.9, 2.2, 0.05, 0.02).translate(4.7, 1.6, W / 2 + 0.01), '#2a3038')); lights = merge([lights, colorize(RB(0.06, 0.32, 1.7, 0.03).translate(5.47, 3.0, 0), '#ffb020')]); }
  const trim = merge(trimL);
  // wheels: rounded tyre profile (lathe) + 5-spoke rim
  const r = s.wr, tw = 0.15;
  const tyre = new THREE.LatheGeometry([[r * 0.62, -tw], [r * 0.9, -tw - 0.005], [r * 0.99, -tw * 0.7], [r, 0], [r * 0.99, tw * 0.7], [r * 0.9, tw + 0.005], [r * 0.62, tw]].map(([a, b]) => new THREE.Vector2(a, b)), 22).rotateX(Math.PI / 2);
  const rim = [colorize(new THREE.CylinderGeometry(r * 0.63, r * 0.63, tw * 1.6, 20).rotateX(Math.PI / 2), '#2a2c30'), colorize(new THREE.CylinderGeometry(r * 0.16, r * 0.16, tw * 2.1, 12).rotateX(Math.PI / 2), '#d8dce2')];
  for (let k = 0; k < 5; k++) rim.push(colorize(new THREE.BoxGeometry(r * 0.1, r * 0.55, tw * 1.9).translate(0, r * 0.3, 0).rotateZ(k / 5 * Math.PI * 2), '#c8ccd2'));
  const wheel = merge([colorize(tyre, '#141414'), ...rim]);
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
  if (NW.client && c.mode === 'net') { mpSend({ t: 'cd', to: 'h', i: c.wIdx, a: Math.round(amt) }); return; }
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
    if (c.home) { respawnSpecial(c); return; }
    if (c.event) { c.active = false; c.group.visible = false; return; }
    if (c.owned) { const [x, z] = dealerSpot(cars.filter(o => o.owned).indexOf(c)); c.dead = false; c.health = c.maxHealth; c.paint.material = c.paintM; c.mode = 'free'; c.vx = c.vz = 0; c.air = false; c.group.position.set(x, 0, z); c.y = 0; c.h = Math.PI / 2; c.group.rotation.set(0, c.h, 0); floatText('Sigorta: aracın galeride'); }
    else respawnTrafficCar(c);
  }, 25000);
}

// ============================================================ PLAYER
const player = { pos: new THREE.Vector3(), vy: 0, yaw: 0, speed: 0, onGround: true, human: null, aimT: 0 };
let camYaw = 0, camPitch = 0.22, camDist = 5;
function spawnPlayer() {
  if (!state.look) state.look = { ...DEFAULT_LOOK };
  player.human = makeHuman({ ...state.look, gun: true });
  const x = nodeP(4) + ROAD / 2 + 3, z = nodeP(4) + ROAD / 2 + 3;
  player.pos.set(x, 0.25, z); player.yaw = Math.PI * 0.75; camYaw = player.yaw + Math.PI;
  createCar('sport', '#ff2a6a', nodeP(4) + 6.5, nodeP(4) + 22, 0, 'free');
  createCar('bike', '#00c8e0', nodeP(4) + 10, nodeP(4) + 4, Math.PI * 0.5, 'free');
}
function enterCar() {
  if (state.passenger) { exitPassenger(); return; }
  if (state.inCar) { exitCar(false); return; }
  if (MP.on && !state.interior) { const rv = nearRemoteVehicle(4.5); if (rv) { let nl = 1e9; for (const c of cars) if (c.active && !c.dead) nl = Math.min(nl, Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z)); if (Math.hypot(rv.x - player.pos.x, rv.z - player.pos.z) < nl) { enterAsPassenger(rv); return; } } }
  let best = null, bd = 5;
  for (const c of cars) { if (!c.active || c.dead) continue; const d = Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  if (best.display) { floatText('Bu araç satılık — galeriden al!'); return; }
  const netCar = best.mode === 'net';
  if (best.driver && !netCar) { // carjack!
    state.stats.jacked++;
    const p = best.group.position;
    ejectDriver(p.x - Math.cos(best.h) * 1.6, p.z + Math.sin(best.h) * 1.6);
    addHeat(best.police ? 1.5 : 0.35);
  }
  if (best.ai) best.ai = null;
  best.mode = 'player'; best.driver = true; state.inCar = best;
  if (netCar) netCarClaim(best);
  if (best.spec.bike) { best.group.add(player.human.g); player.human.g.position.set(0, 0.45, -0.28); player.human.g.rotation.set(0.32, 0, 0); }
  else player.human.g.visible = false;
  if (state.soundMode === 0) floatText('📻 VISTA FM 101.4');
  document.body.classList.add('incar'); document.body.classList.toggle('inheli', !!best.spec.heli);
  if (best.spec.heli) floatText('🚁 Motor ısınıyor… ▲ YÜKSEL ile kalk');
  AudioSys.door();
}
function exitCar(forced) {
  const c = state.inCar; if (!c) return;
  if (state.stunt && (forced || !(c.spec.heli && c.y - heliFloor(c) > 1.2))) endStunt(false);
  if (c.spec.heli && !forced && c.y - heliFloor(c) > 1.2) { floatText('🚁 Önce yere in'); return; }
  const sp = carSpeed(c);
  c.mode = c.dead ? 'dead' : 'free'; c.driver = false; state.inCar = null;
  if (NW.client && c.wIdx >= 0) netCarRelease(c);
  { const [x, y, z] = exitSpot(c); player.pos.set(x, y, z); player.vy = 0; player.onGround = true; } // driver side, at the vehicle's height
  if (c.spec.boat) {
    const bx = c.group.position.x, bz = c.group.position.z;
    if (bx < DOCK.x1 + 8 && Math.abs(bz - DOCK.z) < 12) player.pos.set(clamp(bx, DOCK.x0 + 1, DOCK.x1 - 1), DOCK.y, DOCK.z);
    else { player.pos.set(WATERLINE - 3, 0.05, clamp(bz, BOUNDS.z0, BOUNDS.z1)); floatText('🏊 Kıyıya yüzdün'); }
  }
  if (c.spec.heli) c.vy = 0;
  if (player.human.g.parent !== scene) scene.add(player.human.g);
  player.human.g.rotation.set(0, c.h, 0); player.human.g.children[4].position.y = 0;
  player.human.g.visible = true; player.yaw = c.h;
  if (sp > 12 && !forced) state.health -= 8;
  document.body.classList.remove('incar', 'inheli');
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
  // roof edge: the parapet stops you — jump to go over it
  if (player.onGround && !state.interior && player.pos.y > 2 && !input.jump && surfaceY(x, z, player.pos.y) < player.pos.y - 1.5) {
    x = player.pos.x; z = player.pos.z; player.speed *= 0.5;
    if (!(state.now - (updatePlayerFoot.edgeT || -9) < 3)) { updatePlayerFoot.edgeT = state.now; floatText('⚠ Çatı kenarı · atlamak için ZIPLA'); }
  }
  const r = state.interior ? interiorCollide(x, z, 0.38, player.pos.y) : collide(x, z, 0.38, player.pos.y + 0.2); x = r.x; z = r.z;
  // jump & gravity on the highest surface below the feet (ground, roof, stairs, storey)
  const g = surfaceY(x, z, player.pos.y);
  if (input.jump && player.onGround) { player.vy = 5.8; player.onGround = false; }
  player.vy -= 18 * dt; player.pos.y += player.vy * dt;
  if (player.pos.y <= g) {
    if (g - player.pos.y < 0.6 || !player.onGround) {
      const vLand = player.vy, wasAir = !player.onGround;
      player.pos.y = g; player.vy = 0; player.onGround = true;
      if (wasAir && vLand < -13 && !state.dead) { const dmg = (-vLand - 13) * 7; state.health -= dmg; state.shake = Math.max(state.shake, Math.min(1, dmg / 60)); AudioSys.crash(Math.min(1, dmg / 80)); haptic(80); if (dmg > 20) floatText('🦴 Sert düşüş!'); }
    }
  } else if (player.onGround && player.vy <= 0 && player.pos.y - g < 0.45) { player.pos.y = g; player.vy = 0; }   // stick to stairs / ramps going down
  else if (player.pos.y > g + 0.05) player.onGround = false;
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
  if (state.emote) applyEmote(h, state.emote.type, state.emote.t);
  if (!player.onGround) { h.legL.rotation.x = -0.6; h.legR.rotation.x = 0.3; }
}
function updatePlayerCar(dt) {
  const c = state.inCar;
  let throttle = clamp(input.my + (input.gas ? 1 : 0) - (input.brake ? 1 : 0), -1, 1);
  if (c.spec.boat) boatPhysics(c, dt, throttle, clamp(input.mx, -1, 1));
  else if (c.spec.heli) heliPhysics(c, dt, throttle, clamp(input.mx, -1, 1), (input.up ? 1 : 0) - (input.down ? 1 : 0));
  else carPhysics(c, dt, throttle, clamp(input.mx, -1, 1), input.hand);
  if (!state.inCar) return; // crashed off bike
  updateStunt(c, state.realDt);
  player.pos.copy(c.group.position);
  { const v = carSpeed(c); state.stats.dist += v * dt; state.stats.topSpeed = Math.max(state.stats.topSpeed, Math.abs(carFwd(c)) * 3.6); }
  if (c.spec.bike) { const h = player.human; h.legL.rotation.x = h.legR.rotation.x = -1.3; h.armL.rotation.x = h.armR.rotation.x = -1.15; h.legL.rotation.z = 0.25; h.legR.rotation.z = -0.25; h.kneeL.rotation.x = h.kneeR.rotation.x = 1.5; h.elbowL.rotation.x = h.elbowR.rotation.x = -0.3; }
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
  if (NW.client && p.net && p.wIdx >= 0) mpSend({ t: 'pk', to: 'h', i: p.wIdx });
  p.dead = true; p.deadT = 18;
  p.h.g.rotation.x = -Math.PI / 2;
  for (let k = 0; k < 10; k++) FX.norm.spawn(p.x, 0.9, p.z, MR(-2, 2), MR(1, 4), MR(-2, 2), 0.5, 0.35, 0.2, 0.55, 0.02, 0.02, 0.9, 12);
  spawnCash(p.x + MR(-0.5, 0.5), p.z + MR(-0.5, 0.5), Math.round(MR(10, 90)));
  if (p.npc === 'gang') { gangAggro(); p.respawnT = 60; }
  if (p.heistIdx >= 0) heistGuardKilledLocally(p);
  if (byPlayer) { if (p.npc !== 'turf') addHeat(p.npc === 'gang' ? 0.3 : p.cop ? 1.5 : 0.7); state.stats.kills++; }
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
function placeOnRoad(c, anywhere, ctr = player.pos) {
  let i, j, dir, tries = 0;
  do {
    i = RI(0, N); j = RI(0, N); dir = RI(0, 3); tries++;
  } while ((i + DX[dir] < 0 || i + DX[dir] > N || j + DZ[dir] < 0 || j + DZ[dir] > N ||
    (anywhere === 'near' ? (dd => dd < 70 || dd > 200)(Math.hypot(nodeP(i) - ctr.x, nodeP(j) - ctr.z)) : (!anywhere && Math.hypot(nodeP(i) - ctr.x, nodeP(j) - ctr.z) < 120))) && tries < 60);
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
    const p = { h, look, bi: 0, bj: 0, s: 0, dir: 1, speed: R(1.1, 1.7), dead: false, deadT: 0, panic: 0, free: false, x: 0, z: 0, fleeX: 0, fleeZ: 0, yaw: 0 };
    placePed(p, true); peds.push(p);
  }
}
function placePed(p, anywhere, ctr = player.pos) {
  for (let t = 0; t < 30; t++) {
    p.bi = RI(0, N - 1); p.bj = RI(0, N - 1);
    const b = blocks[p.bi][p.bj];
    const db = Math.hypot(b.cx - ctr.x, b.cz - ctr.z); if (anywhere || (db > 45 && db < 150)) break;
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
  if (state.interior) return;
  for (const p of peds) {
    if (p.npc || p.net) continue;
    const h = p.h;
    if (p.dead) {
      p.deadT -= dt;
      if (p.deadT <= 0 && dist2(p) > 3600) placePed(p, false);
      continue;
    }
    const d2p = dist2(p);
    if (!p.free && (MP.on && MP.host ? nearestPlayerDist(p.x, p.z) > 170 : d2p > 170 * 170)) { placePed(p, false, popCenter()); }
    h.g.visible = d2p < (QUALITY === 'low' ? 75 * 75 : QUALITY === 'medium' ? 130 * 130 : 180 * 180);
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
      if (c.spec.heli || c.spec.boat) continue;
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
const MCOL = { reach: 0xffc020, race: 0x20e0ff, taxi: 0x40ff80, hit: 0xff3040, delivery: 0xff9a20, bounty: 0xff2050, turf: 0x30d070, story: 0xb060ff };
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
function missionPos() { const m = state.mission; if (m.type === 'story') return [m.tx, m.tz]; if (m.type === 'turf') { const e = m.enemies.find(p => !p.dead); return e ? [e.x, e.z] : [m.x, m.z]; } if (m.type === 'bounty') return [m.boss.x, m.boss.z]; return m.type === 'hit' ? [m.target.group.position.x, m.target.group.position.z] : m.type === 'delivery' && m.stage === 0 ? [m.car.group.position.x, m.car.group.position.z] : [m.x, m.z]; }
function missionEnd(ok, sub) {
  const m = state.mission;
  if (ok) S().missions++; else S().fails++;
  if (ok && packagesFound()) m.reward = Math.round(m.reward * (1 + 0.03 * packagesFound()) / 10) * 10;
  if (m.type === 'story' && m.bossSt) setTimeout(() => { if (!state.mission || (state.mission.type !== 'bounty' && state.mission.type !== 'story')) hideBounty(m.bossSt); }, ok ? 8000 : 0);
  if (m.type === 'turf') setTimeout(() => { if (!state.mission || state.mission.type !== 'turf') hideTurfWar(m); }, ok ? 8000 : 0);
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
  } else if (m.type === 'story') {
    updateStory(dt, m); return;
  } else if (m.type === 'turf') {
    updateTurfWar(dt, m); return;
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
  if (byPlayer && MP.on) for (const r of MP.remotes.values()) { const dd = Math.hypot(r.x - x, r.z - z); if (dd < 8) pvpHit(r, 90 * (1 - dd / 8)); }
  if (byPlayer && MP.on) mpSend({ t: 'fx', k: 'boom', p: [x, y, z].map(v => Math.round(v * 10) / 10) });
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
    if ((A.mode === 'ai' || A.mode === 'net') && (B.mode === 'ai' || B.mode === 'net')) continue;
    if (A.spec.heli || B.spec.heli || A.spec.boat || B.spec.boat) continue;
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
      const stA = A.mode === 'ai' || A.mode === 'net', stB = B.mode === 'ai' || B.mode === 'net';
      if (!stA) { pa.x -= nx * push; pa.z -= nz * push; } if (!stB) { pb.x += nx * push; pb.z += nz * push; }
      if (rv < 0) {
        const j = -rv * 0.8;
        if (!stA) { A.vx -= nx * j; A.vz -= nz * j; } if (!stB) { B.vx += nx * j; B.vz += nz * j; }
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
  if (state.weatherT <= 0) setWeather(pick(WEATHERS[state.weather].next));
  state.cloud = damp(state.cloud, state.cloudTarget, 0.1, dt); state.fog = damp(state.fog, state.fogTarget, 0.08, dt);
  state.rain = damp(state.rain, state.rainTarget, 0.12, dt);
  const rain = state.rain;
  rainLines.visible = rain > 0.02 && !state.interior;
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
  if (state.weather === 'storm' && rain > 0.6 && Math.random() < dt * 0.12) { state.lightning = 1; setTimeout(() => AudioSys.thunder(), MR(300, 1800)); }
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
  const fogA = state.fog;
  if (fogA > 0.001) { scene.fog.near = lerp(scene.fog.near, 6, fogA); scene.fog.far = lerp(scene.fog.far, 150, fogA); fog.lerp(tmpC2.setRGB(0.72, 0.74, 0.77).multiplyScalar(0.15 + 0.85 * day), fogA * 0.85); scene.fog.color.copy(fog); sunLight.intensity *= 1 - 0.55 * fogA; }
  if (state.interior) { scene.fog.near = 300; scene.fog.far = 2000; }
  sunLight.intensity *= 1 - 0.8 * rain;
  hemi.intensity = hemi.intensity * (1 - 0.25 * rain) + state.lightning * 3;
  if (state.interior === 'gen') { sunLight.intensity *= 0.18; hemi.intensity *= 0.7; }   // indoors: daylight only through the windows
  renderer.toneMappingExposure = (0.85 + night * 0.1) * (1 - 0.12 * rain);
  stars.material.opacity = night;
  for (const k in M.fac) M.fac[k].emissiveIntensity = night * (k === 'glass' ? 0.45 : 0.6);
  M.sign.emissiveIntensity = night * 0.85;
  M.lampHead.color.setRGB(1, 0.85, 0.55).multiplyScalar(0.3 + night * 3.2);
  M.pool.opacity = night * 0.6;
  M.carLight.color.setScalar(0.9 + night * 2.6);
  const cu = clouds.material.uniforms;
  cu.uSunDir.value.copy(y > -0.05 ? sunDir : tmpV2); cu.uCover.value = Math.max(state.cloud, state.rain);
  cu.uLit.value.setRGB(1, 0.97, 0.92).lerp(tmpC2.setRGB(1, 0.62, 0.42), sunset * 0.8).multiplyScalar(0.06 + 0.94 * day).lerp(tmpC2.setRGB(0.42, 0.44, 0.47), state.rain * 0.75).addScalar(state.lightning);
  if (state.fog > 0.01) { cu.uLit.value.lerp(scene.fog.color, state.fog * 0.7); }
  cu.uShade.value.setRGB(0.58, 0.62, 0.7).lerp(tmpC2.setRGB(0.55, 0.4, 0.45), sunset * 0.6).multiplyScalar(0.05 + 0.95 * day).lerp(tmpC2.setRGB(0.22, 0.23, 0.25).multiplyScalar(0.2 + 0.8 * day), state.rain * 0.8);
  if (bloomPass) bloomPass.strength = 0.18 + night * 0.3 + sunset * 0.08;
  // ocean
  const u = ocean.material.uniforms;
  u.uSunDir.value.copy(sunDir); u.uSunCol.value.copy(sunLight.color).multiplyScalar((y > 0 ? 1 : 0.15) * (1 - rain));
  u.uHorizon.value.copy(fog); u.uZenith.value.setHex(0x3a6ea8).lerp(tmpC2.setHex(0x6a4a8a), sunset * 0.6).lerp(tmpC2.setHex(0x050810), night);
  u.uDeep.value.setHex(0x0b4a6e).multiplyScalar(0.15 + 0.85 * day); u.uShallow.value.setHex(0x2ab8b0).multiplyScalar(0.12 + 0.88 * day);
  u.uFogColor.value.copy(fog); u.uFogNear.value = scene.fog.near; u.uFogFar.value = scene.fog.far; u.uDay.value = day;
  envTimer += dt;
  if (envTimer > (QUALITY === 'low' ? 25 : QUALITY === 'medium' ? 6 : 3)) { envTimer = 0; if (envRT) envRT.dispose(); envRT = pmrem.fromScene(envScene, 0.02); scene.environment = envRT.texture; }
  const hh = Math.floor(state.time), mm = Math.floor((state.time - hh) * 60);
  $('clock').textContent = (WEATHERS[state.weather] ? WEATHERS[state.weather].icon + ' ' : '') + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// ============================================================ CAMERA
function updateCamera(dt) {
  if (state.stunt && state.stunt.cam) {
    const sc = state.stunt.car, sp = sc.group.position;
    camera.position.lerp(state.stunt.cam, 0.12); camera.lookAt(sp.x, sc.y + 1, sp.z);
    camera.fov = damp(camera.fov, 48, 3, dt); camera.updateProjectionMatrix(); input.lookDX = input.lookDY = 0; return;
  }
  const c = state.inCar;
  const tx = player.pos.x, ty = player.pos.y + (c ? (c.spec.heli ? 2.6 : 1.7) : 1.55), tz = player.pos.z;
  camYaw -= input.lookDX * settings.sens; camPitch = clamp(camPitch + input.lookDY * settings.sens, -0.35, 1.25);
  if (input.lookDX || input.lookDY) state.lastLookInput = state.now;
  input.lookDX = input.lookDY = 0;
  let dist = state.interior ? 3 : state.passenger ? 8.5 : 4.6;
  if (c) {
    const sp = carSpeed(c);
    dist = (c.spec.heli ? 15 : c.spec.bus ? 15 : c.spec.boat ? 10 : c.spec.bike ? 5.6 : 8.2) + Math.min(sp, 50) * 0.06;
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
  for (let k = 1; k <= 14; k++) { const t = k / 14 * camDist; if (camBlocked(tx + dx * t, ty + dy * t, tz + dz * t)) { d = Math.max(1.2, t - 0.6); break; } }
  let cx = tx + dx * d, cy = ty + dy * d, cz = tz + dz * d;
  cy = Math.max(cy, groundY(cx, cz) + 0.4);
  if (state.interior) { const I = INTERIORS[state.interior]; cx = clamp(cx, I.x0 + 0.35, I.x1 - 0.35); cz = clamp(cz, I.z0 + 0.35, I.z1 - 0.35); if (I.FH) { const fy = genFloorOf(I) * I.FH; cy = clamp(cy, fy + 0.45, fy + I.FH - 0.35); } else cy = clamp(cy, 0.5, I.h - 0.35); }
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
const input = { mx: 0, my: 0, lookDX: 0, lookDY: 0, fire: false, jump: false, sprint: false, gas: false, brake: false, hand: false, up: false, down: false };
const keys = {};
const touchState = { joyId: null, jx: 0, jy: 0, jdx: 0, jdy: 0, lookId: null, lx: 0, ly: 0 };
function initInput() {
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (state.dialog) { if (['Space', 'Enter', 'KeyE', 'Escape'].includes(e.code)) { e.preventDefault(); advanceDialog(); } return; }
    if (state.photo) { if (e.code === 'Escape') endPhoto(); if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); state.photo.shot = true; } return; }
    if ((e.code === 'KeyP' || e.code === 'Tab') && !state.shopOpen) { e.preventDefault(); togglePhone(); return; }
    if (state.phoneOpen) { if (e.code === 'Escape') closePhone(); return; }
    if (e.code === 'KeyE' && !state.shopOpen) { if (!interact()) enterCar(); }
    else if (e.code === 'KeyF' || e.code === 'Enter') enterCar();
    if (/^Digit[1-5]$/.test(e.code)) selectWeapon(+e.code[5] - 1);
    if (e.code === 'KeyX') nextWeapon();
    if (e.code === 'KeyR') toggleRadio();
    if (e.code === 'KeyL' && MP.on) { const l = $('mpList'); l.style.display = l.style.display === 'block' ? 'none' : 'block'; if (l.style.display === 'block') renderMpList(); }
    if (e.code === 'KeyT' && MP.on) { const cp = $('chatPanel'); cp.style.display = cp.style.display === 'block' ? 'none' : 'block'; }
    if (e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  $('shopClose').addEventListener('click', closeShop);
  addEventListener('keydown', e => { if (e.code === 'Escape' && state.shopOpen) closeShop(); });
  const cv = renderer.domElement;
  cv.addEventListener('click', () => { if (!isTouch && !state.phoneOpen && !state.shopOpen && !state.dialog && document.pointerLockElement !== cv) cv.requestPointerLock?.(); });
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
  btn('bFire', 'TFire'); btn('bJump', 'TJump'); btn('bGas', 'TGas'); btn('bBrake', 'TBrake'); btn('bHand', 'THand'); btn('bUp', 'TUp'); btn('bDown', 'TDown');
  btn('bEnter', 'TEnter', enterCar);
  btn('bWeapon', 'TW', () => nextWeapon()); btn('bRadio', 'TR', toggleRadio); btn('bAct', 'TA', interact);
  $('bRadio').textContent = ['📻', '🔈', '🔇'][state.soundMode];
}
function readInput() {
  const k = keys;
  if (state.phoneOpen) { Object.assign(input, { mx: 0, my: 0, lookDX: 0, lookDY: 0, fire: false, jump: false, sprint: false, gas: false, brake: false, hand: false, up: false, down: false }); return; }
  let mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  let my = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  if (touchState.joyId !== null) { mx += touchState.jdx; my -= touchState.jdy; }
  input.mx = clamp(mx, -1, 1); input.my = clamp(my, -1, 1);
  input.fire = !!(k.Mouse0 || k.TFire || k.KeyQ);
  input.jump = !!(k.TJump || (!state.inCar && k.Space));
  input.hand = !!(k.THand || (state.inCar && k.Space));
  input.sprint = !!(k.ShiftLeft || k.ShiftRight);
  input.gas = !!k.TGas; input.brake = !!k.TBrake;
  input.up = !!(k.TUp || (state.inCar && k.Space)); input.down = !!(k.TDown || k.KeyC || (state.inCar && (k.ShiftLeft || k.ControlLeft)));
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
const MAP = { x0: -HALF - 150, x1: WATERLINE + 160, z0: -HALF - 150, z1: AIR.z1 + 70 }; MAP.size = Math.max(MAP.x1 - MAP.x0, MAP.z1 - MAP.z0);
function buildMinimapBase() {
  const S = Math.round(MAP.size * 0.887), k = S / MAP.size, X = x => (x - MAP.x0) * k, Z = z => (z - MAP.z0) * k;
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
  drawAirportMap(g, X, Z, k);
  MAP.k = k; MAP.S = S; MAP.X = X; MAP.Z = Z;
  mapCtx = $('minimap').getContext('2d');
}
function drawMinimap() {
  if (state.interior) { const g = mapCtx; g.clearRect(0, 0, 300, 300); g.fillStyle = '#1a1420'; g.fillRect(0, 0, 300, 300); g.fillStyle = '#fff'; g.font = 'bold 30px Rajdhani, sans-serif'; g.textAlign = 'center'; g.fillText('İÇ MEKAN', 150, 140); g.font = '20px sans-serif'; { const I = INTERIORS[state.interior]; g.fillText(I.name, 150, 175); if (I.nF > 1) { g.fillStyle = '#ffd23a'; g.font = 'bold 26px Rajdhani, sans-serif'; g.fillText(`${floorLabel(I, genFloorOf(I))} / ${I.nF}`, 150, 212); g.fillStyle = '#ccc'; g.font = '17px sans-serif'; g.fillText(I.floorNames[genFloorOf(I)] || '', 150, 240); } } return; }
  const g = mapCtx, W = 300, r = W / 2, zoom = 1.5;  // canvas px per map px
  g.save(); g.clearRect(0, 0, W, W);
  g.translate(r, r); g.rotate(camYaw);
  g.scale(zoom, zoom);
  g.drawImage(mapBase, -MAP.X(player.pos.x), -MAP.Z(player.pos.z));
  if (turfLayer) g.drawImage(turfLayer, -MAP.X(player.pos.x), -MAP.Z(player.pos.z));
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
  g.font = '18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const c of cars) if (c.home && !c.dead && c !== state.inCar) { const [px, py] = toMap(c.group.position.x, c.group.position.z); if (Math.hypot(px - r, py - r) < r - 10) g.fillText(c.spec.heli ? '🚁' : '🚤', px, py); }
  for (const c of cars) if (c.owned && !c.dead && c !== state.inCar) dot(c.group.position.x, c.group.position.z, '#40a0ff', 6, false);
  g.font = '22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const s of SHOPS) { let [px, py] = toMap(s.x, s.z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 14) { px = r + dx / l * (r - 14); py = r + dy / l * (r - 14); } g.fillStyle = '#000c'; g.beginPath(); g.arc(px, py, 15, 0, 7); g.fill(); g.strokeStyle = s.mapCol; g.lineWidth = 3; g.stroke(); g.fillText(s.icon, px, py + 1); }
  if (!state.mission && STORY[state.story] && storyRing) { let [px, py] = toMap(...storyGiverPos()); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 14) { px = r + dx / l * (r - 14); py = r + dy / l * (r - 14); } g.fillStyle = '#8a3ad0'; g.beginPath(); g.arc(px, py, 13, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 16px Georgia'; g.fillText('S', px, py + 1); }
  g.font = '16px sans-serif';
  for (const t of TURFS) if (t.x !== undefined && !turfOwned(t.id)) { const [px, py] = toMap(t.x, t.z); if (Math.hypot(px - r, py - r) < r - 10) { g.fillStyle = t.color; g.beginPath(); g.arc(px, py, 11, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText('⚔', px, py + 1); } }
  if (state.truck && state.truck.active && !state.truck.looted) { let [px, py] = toMap(state.truck.group.position.x, state.truck.group.position.z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 14) { px = r + dx / l * (r - 14); py = r + dy / l * (r - 14); } g.fillStyle = '#000c'; g.beginPath(); g.arc(px, py, 13, 0, 7); g.fill(); g.font = '18px sans-serif'; g.fillText('💰', px, py + 1); }
  if (state.waypoint) dot(state.waypoint.x, state.waypoint.z, '#c060ff', 9, true);
  for (const rp of MP.remotes.values()) { dot(rp.x, rp.z, rp.bounty ? '#ff2a3a' : rp.info.color, rp.bounty ? 11 : 8, true); if (rp.bounty) { let [px, py] = toMap(rp.x, rp.z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 10) { px = r + dx / l * (r - 10); py = r + dy / l * (r - 10); } g.font = '15px sans-serif'; g.fillText('☠', px, py + 1); } }
  if (state.mpRace) dot(state.mpRace.x, state.mpRace.z, '#2a7aff', 11, true);
  if (state.heist) { let [px, py] = toMap(state.heist.x, state.heist.z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 14) { px = r + dx / l * (r - 14); py = r + dy / l * (r - 14); } g.fillStyle = '#000c'; g.beginPath(); g.arc(px, py, 13, 0, 7); g.fill(); g.font = '17px sans-serif'; g.fillText('💼', px, py + 1); }
  if (!state.mission && state.missionCooldown <= 0) for (const st of STARTS) { let [px, py] = toMap(st.x, st.z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 14) { px = r + dx / l * (r - 14); py = r + dy / l * (r - 14); } g.fillStyle = '#ffc020'; g.beginPath(); g.arc(px, py, 13, 0, 7); g.fill(); g.fillText(START_INFO[st.type][0], px, py + 1); }
  if (state.mission) { const [mx, mz] = missionPos(); dot(mx, mz, '#' + MCOL[state.mission.type].toString(16).padStart(6, '0'), 11, true); }
  { let [px, py] = toMap(AIRPORT.icon[0], AIRPORT.icon[1]); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 14) { px = r + dx / l * (r - 14); py = r + dy / l * (r - 14); } g.fillStyle = '#000c'; g.beginPath(); g.arc(px, py, 14, 0, 7); g.fill(); g.strokeStyle = '#4aa8ff'; g.lineWidth = 3; g.stroke(); g.fillStyle = '#fff'; g.font = '17px sans-serif'; g.fillText('✈', px, py + 1); }
  if (state.scoutT > 0) { g.font = '15px sans-serif'; for (const p of PACKAGES) if (!state.packages[p.id] && Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < (state.scoutR || 450)) { let [px, py] = toMap(p.x, p.z); const dx = px - r, dy = py - r, l = Math.hypot(dx, dy); if (l > r - 12) { px = r + dx / l * (r - 12); py = r + dy / l * (r - 12); } g.fillText('🎒', px, py + 1); } }
  // player arrow
  g.save(); g.translate(r, r); g.rotate(camYaw); g.rotate(Math.PI - (state.inCar ? state.inCar.h : player.yaw));
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath(); g.stroke(); g.fill();
  g.restore();
}
function updateHUD(dt) {
  state.shownMoney += (state.money - state.shownMoney) * Math.min(1, dt * 6);
  if (Math.abs(state.money - state.shownMoney) < 1) state.shownMoney = state.money;
  const hk = Math.round(state.shownMoney) + '|' + Math.round(state.health) + '|' + Math.round(state.armor);
  if (hk !== updateHUD.hk) { updateHUD.hk = hk; $('money').textContent = '$' + String(Math.round(state.shownMoney)).padStart(8, '0'); $('hpBar').firstChild.style.width = clamp(state.health, 0, 100) + '%'; $('armBar').firstChild.style.width = clamp(state.armor, 0, 100) + '%'; }
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
  const navT = state.mission ? missionPos() : state.mpRace ? [state.mpRace.x, state.mpRace.z] : state.heist && !state.heist.opened ? [state.heist.x, state.heist.z] : state.waypoint ? [state.waypoint.x, state.waypoint.z] : null;
  nav.style.color = state.mission ? '#ffc020' : '#c060ff';
  if (navT) {
    const [mx, mz] = navT, dx = mx - player.pos.x, dz = mz - player.pos.z, s = Math.sin(camYaw), c = Math.cos(camYaw);
    nav.style.display = 'block'; nav.style.transform = `translateX(-50%) rotate(${Math.atan2(dx * c - dz * s, -dx * s - dz * c)}rad)`;
  } else nav.style.display = 'none';
  if (QUALITY !== 'low' || (frame & 1)) drawMinimap();
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
  if (state.interior) { state.interior = null; interiorLight.intensity = 0; for (const hh of clubDancers) hh.g.visible = false; disposeGen(); }
  state.spawnProt = 3;
  const [x, z] = spawnPoint();
  if (packagesFound() >= 5) state.armor = 100;
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
    if (c && c.spec.heli) { const pw = c.power; this.eo.frequency.setTargetAtTime(18 + pw * 16, t, 0.1); this.eo2.frequency.setTargetAtTime(9 + pw * 8, t, 0.1); this.ef.frequency.setTargetAtTime(350 + pw * 450, t, 0.1); this.eg.gain.setTargetAtTime(0.17 * pw, t, 0.1); }
    else if (c) { const bk = c.spec.bike ? 1.6 : c.spec.boat ? 1.3 : 1, sp = Math.abs(carFwd(c)) * bk, gear = sp / c.spec.max * 5, rpm = 0.3 + (gear % 1) * 0.7 + Math.floor(gear) * 0.08; this.eo.frequency.setTargetAtTime(40 + rpm * 90 + sp, t, 0.05); this.eo2.frequency.setTargetAtTime(20 + rpm * 45 + sp * 0.5, t, 0.05); this.ef.frequency.setTargetAtTime(300 + Math.abs(input.my) * 900 + sp * 15, t, 0.1); this.eg.gain.setTargetAtTime(0.09 + Math.abs(input.my) * 0.06, t, 0.1); }
    else this.eg.gain.setTargetAtTime(0, t, 0.15);
    const sv = state.wanted > 0 ? clamp(1 - policeDist / 150, 0, 1) * 0.12 : 0;
    this.sg.gain.setTargetAtTime(sv, t, 0.2); this.so.frequency.setTargetAtTime(650 + Math.sin(state.now * 3.5) * 220, t, 0.03);
    this.ag.gain.setTargetAtTime(0.015 + clamp((player.pos.x - BEACH_X0) / 100, 0, 1) * 0.08 + state.rain * 0.16, t, 0.5);
    this.af.frequency.setTargetAtTime(400 + state.rain * 2600, t, 0.5);
    Radio.update((!!c || state.interior === 'club') && state.soundMode === 0 && !state.dead);
  }
};

// ============================================================ TREES / STREET FURNITURE / TRAFFIC LIGHTS
function buildTreesAndStreet() {
  const sh = QUALITY !== 'low', m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  // ---- broadleaf trees
  const blobs = [[0, 6.2, 0, 2.5], [1.4, 5.6, 0.7, 1.9], [-1.2, 5.8, -0.8, 1.9], [0.3, 7.4, -0.3, 1.7], [-0.6, 5.4, 1.2, 1.6]];
  const canopy = merge(blobs.map(([x, y, z, r]) => { const g = new THREE.IcosahedronGeometry(r, QUALITY === 'low' ? 1 : 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const f = 1 + (Math.sin(p.getX(i) * 3.1 + p.getY(i) * 2.3) * 0.12); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.85, p.getZ(i) * f); } return g.translate(x, y, z); }));
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
  clouds.renderOrder = -1; scene.add(clouds); if (QUALITY === 'low') clouds.visible = false;
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
  if (!isTouch || !navigator.vibrate || state.soundMode === 2 || !settings.vibrate) return;
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
    if (!CAR_SPECS[kind] || CAR_SPECS[kind].heli || CAR_SPECS[kind].boat) return;
    const [x, z] = dealerSpot(k); const c = createCar(kind, '#' + hex, x, z, Math.PI / 2, 'free'); c.owned = true; c.driver = false;
    if (up) Object.assign(c.up, up);
    applyCarStyle(c, c.up.neon, c.up.rim);
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
  $('shopTitle').textContent = type === 'prop' ? '🏠 ' + zone.prop.name.toUpperCase() : type === 'clothes' ? '👕 VISTA MODA' : type === 'elev' ? '🛗 ASANSÖR' : { gun: '🔫 SİLAH & EKİPMAN', car: '🚗 VISTA MOTORS', garage: '🔧 GARAJ & BOYA' }[type];
  renderShop(); $('shop').style.display = 'flex';
}
function closeShop() { state.shopOpen = null; $('shop').style.display = 'none'; saveGame(); }
function shopItems(type) {
  if (type === 'elev') return elevItems();
  if (type === 'prop') return propItems();
  if (type === 'clothes') return clothesItems();
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
  it.push(...garageStyleItems(c));
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
  if (state.noSave) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: Math.round(state.money), ammo: state.ammo.map(a => a === Infinity ? -1 : a), ownedW: state.ownedW,
      owned: cars.filter(c => c.owned && !c.dead && !c.delivery && !c.home).map(c => [c.kind, c.paintM.color.getHexString(THREE.SRGBColorSpace), c.up, c.fav ? 1 : 0]), soundMode: state.soundMode,
      props: state.props, spawnProp: state.spawnProp, stats: state.stats, ach: state.ach, turf: state.turf, packages: state.packages, stuntsDone: state.stuntsDone, story: state.story, look: state.look
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
    state.turf = d.turf || {}; state.packages = d.packages || {}; state.stuntsDone = d.stuntsDone || {};
    state.story = d.story || 0; state.look = d.look || null;
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
  const hide = !!state.mission || state.missionCooldown > 0 || !!state.mpRace;
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
function propIncome() { return PROPERTIES.reduce((a, p) => a + (state.props[p.id] ? p.income : 0), 0) + turfIncome(); }
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
const ownedCars = () => cars.filter(c => c.owned && !c.display && !c.delivery && !c.home);
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
  { id: 'turf1', name: 'Mahalle Ağası', desc: 'İlk bölgeni ele geçir', reward: 1500, test: () => turfCount() >= 1 },
  { id: 'turfAll', name: 'Şehrin Sahibi', desc: 'Tüm bölgeleri ele geçir', reward: 20000, test: () => turfCount() === TURFS.length },
  { id: 'pk20', name: 'Hazine Avcısı', desc: '20 gizli paketin hepsini bul', reward: 10000, test: () => packagesFound() === PACKAGE_COUNT },
  { id: 'rob', name: 'Soyguncu', desc: 'Zırhlı para kamyonunu soy', reward: 1000, test: () => S().robberies >= 1 },
  { id: 'story', name: 'Vista Bay Efsanesi', desc: 'Hikayeyi bitir', reward: 5000, test: () => state.story >= STORY.length },
  { id: 'stunt5', name: 'Dublör', desc: '5 stunt atlayışı yap', reward: 1500, test: () => S().stunts >= 5 },
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
  if (p.npc === 'gang') gangAggro();
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
    if (c && !c.spec.heli && !c.spec.boat && carSpeed(c) > 6 && Math.hypot(c.group.position.x - p.x, c.group.position.z - p.z) < 1.7) { killPed(p, true); state.shake = 0.3; AudioSys.thud(); m.alert = true; continue; }
    h.g.position.set(p.x, groundY(p.x, p.z), p.z); h.g.rotation.y = p.yaw;
    animHuman(h, spd, dt, m.alert && p.npc === 'guard');
  }
}

// ============================================================ SMARTPHONE UI
const APPS = [['valet', '🚗', 'Vale', '#1e6ad8'], ['bank', '🏦', 'Banka', '#1a9a50'], ['contracts', '🎯', 'Kontrat', '#c8283a'], ['props', '🏠', 'Emlak', '#d88a10'], ['world', '🗺', 'Dünya', '#6a3ac8'], ['photo', '📷', 'Foto', '#3a3a48'], ['settings', '⚙️', 'Ayarlar', '#5a5f6a']];
function togglePhone() { if (state.phoneOpen) closePhone(); else openPhone(); }
function openPhone() {
  if (state.shopOpen || state.dead || state.dialog || state.photo) return;
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
      ['Tamamlanan görev', st.missions], ['Başarısız görev', st.fails], ['Kontratlar', st.contracts], ['Çalınan araç', st.jacked], ['Gidilen yol', (st.dist / 1000).toFixed(1) + ' km'], ['En yüksek hız', Math.round(st.topSpeed) + ' km/s'], ['En yüksek aranma', '★'.repeat(st.maxWanted) || '—'], ['Hikaye', state.story + '/' + STORY.length], ['Bölgeler', turfCount() + '/' + TURFS.length], ['Kazanılan yarış', st.racesWon], ['Soygun (online)', st.heists], ['Gizli paket', packagesFound() + '/' + PACKAGE_COUNT], ['Stunt', st.stunts], ['Soygun', st.robberies], ['Oyun süresi', `${Math.floor(m / 60)} sa ${m % 60} dk`]];
    const done = ACHIEVEMENTS.filter(a => state.ach[a.id]).length;
    h = head('🏦 Banka', '#1a9a50') + `<div class="phBody"><div class="phBal"><small>Hesap bakiyesi</small><b>${money}</b></div>
      <div class="phSec">Son işlemler</div>${state.ledger.length ? state.ledger.map(l => `<div class="phLed"><span>${l.t}</span><span>${l.label}</span><b class="${l.amt < 0 ? 'neg' : ''}">${l.amt < 0 ? '-' : '+'}$${Math.abs(l.amt).toLocaleString('tr-TR')}</b></div>`).join('') : '<div class="phEmpty">Henüz işlem yok</div>'}
      <div class="phSec">İstatistikler</div><div class="phStats">${stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      <div class="phSec">Başarımlar ${done}/${ACHIEVEMENTS.length}</div>${ACHIEVEMENTS.map(a => `<div class="phAch ${state.ach[a.id] ? 'on' : ''}"><i>${state.ach[a.id] ? '🏆' : '🔒'}</i><div><b>${a.name}</b><small>${a.desc}</small></div><span>+$${a.reward}</span></div>`).join('')}</div>`;
  } else if (app === 'contracts') {
    const busy = !!state.mission;
    h = head('🎯 Kontratlar', '#c8283a') + `<div class="phBody"><p class="phNote">Korumalı hedefleri ortadan kaldır. Hedef kaçar, korumalar ateş eder.</p>${busy ? '<div class="phEmpty">Önce mevcut görevi bitir.</div>' : ''}
      ${state.contractOffers.map((o, k) => `<div class="phCard"><div><b>${o.name}</b><small>📍 ${o.area} · ${Math.round(Math.hypot(o.x - player.pos.x, o.z - player.pos.z))} m · 🛡 ${o.guards} koruma</small></div><div class="phCardR"><span>$${o.reward.toLocaleString('tr-TR')}</span><button class="phBtn red" data-contract="${k}" ${busy ? 'disabled' : ''}>Kabul et</button></div></div>`).join('')}</div>`;
  } else if (app === 'settings') {
    const tg = (k, label, desc) => `<div class="phRow"><div><b>${label}</b><small>${desc}</small></div><button class="phBtn ${settings[k] ? '' : 'off'}" data-set="${k}">${settings[k] ? 'AÇIK' : 'KAPALI'}</button></div>`;
    h = head('⚙️ Ayarlar', '#5a5f6a') + `<div class="phBody">${tg('fps', 'FPS göstergesi', 'Ekranın üstünde kare hızı')}${tg('autoRes', 'Otomatik çözünürlük', `FPS düşünce keskinliği azaltır · şu an ${perf.pr.toFixed(2)}x · ${Math.round(perf.fps)} FPS`)}${tg('vibrate', 'Titreşim', 'Ateş, çarpışma ve para kazanınca')}
      <div class="phRow"><div><b>Kamera hassasiyeti</b><small>${settings.sens.toFixed(1)}x</small></div><button class="phBtn" data-sens="-1">−</button><button class="phBtn" data-sens="1">+</button></div>
      <div class="phSec">Grafik kalitesi · oyun yeniden yüklenir</div><div class="phRow phQ">${['low', 'medium', 'high'].map((q, i) => `<button class="phBtn ${QUALITY === q ? '' : 'off'}" data-q="${q}">${['Düşük', 'Orta', 'Ultra'][i]}</button>`).join('')}</div>
      <div class="phSec">Kayıt</div><div class="phRow"><div><b>İlerlemeyi sıfırla</b><small>Para, mülkler, araçlar ve hikaye silinir</small></div><button class="phBtn red" data-reset="1">SIFIRLA</button></div></div>`;
  } else if (app === 'world') {
    const tr = state.truck, truck = tr && tr.active && !tr.looted ? `💰 Zırhlı kamyon yolda · ${Math.round(Math.hypot(tr.group.position.x - player.pos.x, tr.group.position.z - player.pos.z))} m` : '💰 Şu an para kamyonu yok';
    h = head('🗺 Dünya', '#6a3ac8') + `<div class="phBody"><div class="phBal"><small>Bölge geliri · ${turfCount()}/${TURFS.length} bölge</small><b>+$${turfIncome()}/saat</b></div>
      <div class="phSec">Bölgeler</div>${TURFS.map(t => `<div class="phRow"><i class="sw" style="background:${turfOwned(t.id) ? PLAYER_TURF : t.color}"></i><div><b>${t.name}</b><small>${turfOwned(t.id) ? 'Senin · +$' + t.income + '/saat' : t.gang + ' · ele geçir: +$' + t.income + '/saat'}</small></div><button class="phBtn" data-tgps="${t.id}">📍 GPS</button></div>`).join('')}
      <div class="phSec">Etkinlikler</div><div class="phRow"><div><b>${truck}</b><small>Kamyonu patlat, saçılan parayı topla</small></div></div>
      <div class="phRow"><div><b>🎒 Gizli paketler ${packagesFound()}/${PACKAGE_COUNT}</b><small>Her paket +$500 ve görev ödüllerine kalıcı +%3 · 5/10/15/20'de ekstra bonus</small></div></div>
      <div class="phRow"><div><b>🏁 Stunt atlayışları ${Object.keys(state.stuntsDone).length}/${ramps.length}</b><small>Rampalardan hızla atla · ilk atlayış x2 bonus</small></div></div></div>`;
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
    if (d.app === 'photo') startPhoto();
    else if (d.app) renderPhone(d.app);
    else if (d.set) { settings[d.set] = !settings[d.set]; saveSettings(); $('fps').style.display = settings.fps ? 'block' : 'none'; renderPhone('settings'); }
    else if (d.sens) { settings.sens = clamp(Math.round((settings.sens + 0.2 * +d.sens) * 10) / 10, 0.4, 2.4); saveSettings(); renderPhone('settings'); }
    else if (d.q) { settings.quality = d.q; saveSettings(); saveGame(); location.reload(); }
    else if (d.reset) { if (confirm('Tüm ilerleme silinsin mi?')) { state.noSave = true; try { localStorage.removeItem(SAVE_KEY); } catch (e) { } location.reload(); } }
    else if (d.call) { if (callCar(cars[+d.call])) closePhone(); else renderPhone('valet'); }
    else if (d.fav) { const c = cars[+d.fav], was = c.fav; for (const o of cars) o.fav = false; c.fav = !was; saveGame(); renderPhone('valet'); }
    else if (d.contract) { startContract(+d.contract); closePhone(); }
    else if (d.tgps) { const t = TURFS.find(q => q.id === d.tgps); state.waypoint = { x: t.x, z: t.z, label: t.name }; floatText('📍 ' + t.name + ' işaretlendi'); closePhone(); }
    else if (d.gps) { const p = PROPERTIES.find(q => q.id === d.gps); state.waypoint = { x: p.zone.x, z: p.zone.z, label: p.name }; floatText('📍 ' + p.name + ' işaretlendi'); closePhone(); }
    else if (t.id === 'phClose' || t.id === 'phHomeBtn') { if (t.id === 'phHomeBtn' && state.phoneApp !== 'home') renderPhone('home'); else closePhone(); }
  };
  ph.addEventListener('click', tap);
  const pb = $('bPhone');
  pb.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); togglePhone(); }, { passive: false });
  pb.addEventListener('click', e => { e.stopPropagation(); togglePhone(); });
}

// ============================================================ WEATHER CYCLE (clear -> cloudy -> rain -> storm -> fog ...)
const WEATHERS = {
  clear: { rain: 0, cloud: 0.32, fog: 0, icon: '☀️', name: 'Güneşli', next: ['clear', 'cloudy', 'cloudy'] },
  cloudy: { rain: 0, cloud: 0.78, fog: 0.08, icon: '⛅', name: 'Bulutlu', next: ['rain', 'rain', 'clear', 'fog'] },
  rain: { rain: 0.75, cloud: 1, fog: 0.2, icon: '🌧', name: 'Yağmurlu', next: ['storm', 'cloudy', 'fog'] },
  storm: { rain: 1, cloud: 1, fog: 0.3, icon: '⛈', name: 'Fırtına', next: ['rain'] },
  fog: { rain: 0, cloud: 0.7, fog: 1, icon: '🌫', name: 'Sisli', next: ['clear', 'cloudy'] },
};
function setWeather(w, announce = true) {
  state.weather = w; const W = WEATHERS[w];
  state.rainTarget = W.rain; state.cloudTarget = W.cloud; state.fogTarget = W.fog;
  state.weatherT = w === 'storm' ? MR(50, 80) : MR(80, 160);
  if (announce) floatText(`${W.icon} Hava: ${W.name}`);
}

// ============================================================ DOCK + HELIPADS
const DOCK = { z: 40, w: 4.4, x0: SHORE_X - 8, x1: WATERLINE + 34, y: 0.7 };
const onDock = (x, z) => x > DOCK.x0 && x < DOCK.x1 && Math.abs(z - DOCK.z) < DOCK.w / 2;
const HELIPADS = [];
function waveH(x, z) {
  const t = state.now, k = smooth(WATERLINE, WATERLINE + 40, x);
  return -0.25 + k * (Math.sin(x * 0.045 + t * 0.8) * 0.35 + Math.sin(z * 0.06 - t * 0.6 + x * 0.02) * 0.25 + Math.sin((x + z) * 0.1 + t * 1.3) * 0.12);
}
function roofHeight(x, z) { const b = blockAt(x, z); let h = 0; if (b) for (const o of b.bld) if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) h = Math.max(h, o.h); if (nearAir(z)) for (const o of EXTRA_BLD) if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) h = Math.max(h, o.h); return h; }
const heliFloor = c => Math.max(groundY(c.group.position.x, c.group.position.z), roofHeight(c.group.position.x, c.group.position.z));
function buildDockAndPads() {
  const wood = new THREE.MeshStandardMaterial({ map: noiseTex('#8a6a48', ['#7a5a3a', '#9a7a56', '#6a4a30'], 128, 2500, 1, 6), roughness: 0.9 });
  const len = DOCK.x1 - DOCK.x0, parts = [new THREE.BoxGeometry(len, 0.25, DOCK.w).translate(0, DOCK.y - 0.12, 0)];
  for (let x = -len / 2 + 1; x < len / 2; x += 4) for (const s of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.16, 0.18, 3.5, 6).translate(x, DOCK.y - 1.7, s * (DOCK.w / 2 - 0.2)));
  for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(len, 0.1, 0.1).translate(0, DOCK.y + 0.9, s * (DOCK.w / 2 - 0.1)));
  const dock = new THREE.Mesh(merge(parts), wood); dock.position.set((DOCK.x0 + DOCK.x1) / 2, 0, DOCK.z); dock.castShadow = dock.receiveShadow = true; scene.add(dock);
  const padTex = canvasTex(256, 256, g => { g.fillStyle = '#3a3d42'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill(); g.strokeStyle = '#ffd23a'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 150px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 136); });
  const padMat = new THREE.MeshStandardMaterial({ map: padTex, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  const pad = (x, y, z) => { const m = new THREE.Mesh(new THREE.CircleGeometry(6, 40).rotateX(-Math.PI / 2), padMat); m.position.set(x, y + 0.03, z); m.receiveShadow = true; scene.add(m); HELIPADS.push([x, y, z]); };
  const pk = blocks[3][3]; pad(pk.cx, 0.31, pk.cz);
  pad(BEACH_X0 + 62, 0.03, 200);
  // rooftop pad on the tallest downtown tower (landing spot for pilots)
  let best = null; for (const row of blocks) for (const b of row) if (b.dist === 'downtown') for (const o of b.bld) if ((o.x1 - o.x0) >= 14 && (o.z1 - o.z0) >= 14 && (!best || o.h > best.h)) best = o;
  if (best) pad((best.x0 + best.x1) / 2, best.h, (best.z0 + best.z1) / 2);
}

// ============================================================ SPEEDBOAT
function baseVehicle(group, inner, paint, paintM, kind, spec, h, extra = {}) {
  return Object.assign({ group, inner, paint, paintM, spinners: [], fronts: [], siren: null, kind, spec, h, vx: 0, vz: 0, y: group.position.y, vy: 0, air: false, steer: 0, spin: 0, mode: 'free', health: 100, driver: false, active: true, ai: null, stuck: 0, reverseT: 0, smokeT: 0, police: false, pathT: 0, path: null, shootT: 2, idleT: 0, dead: false, honk: 0 }, extra);
}
CAR_SPECS.boat = { W: 2.3, wr: 0.3, max: 34, acc: 13, boat: true, cr: 1.4, co: 1.3 };
CAR_SPECS.heli = { W: 3, wr: 0.3, max: 48, acc: 18, heli: true, cr: 3, co: 0 };
function createBoat(color, x, z, h) {
  const s = CAR_SPECS.boat, group = new THREE.Group(); group.rotation.order = 'YXZ';
  const inner = new THREE.Group(); group.add(inner);
  const sh = new THREE.Shape(); [[-1.1, -3], [1.1, -3], [1.15, 0.8], [0.55, 2.7], [0, 3.4], [-0.55, 2.7], [-1.15, 0.8]].forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); sh.closePath();
  const hull = new THREE.ExtrudeGeometry(sh, { depth: 0.95, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 }).rotateX(Math.PI / 2).translate(0, 0.55, 0);
  const paintM = paintMat(color), paint = new THREE.Mesh(hull, paintM); paint.castShadow = true;
  const trim = new THREE.Mesh(merge([colorize(new THREE.BoxGeometry(2.1, 0.08, 4.6).translate(0, 0.62, -0.5), '#d8c8a8'), colorize(new THREE.BoxGeometry(2.36, 0.16, 6.0).translate(0, 0.12, -0.2), '#1a3a7a'),
    colorize(new THREE.BoxGeometry(0.9, 0.5, 0.7).translate(0.45, 0.9, -0.6), '#202428'), colorize(new THREE.BoxGeometry(0.9, 0.5, 0.7).translate(-0.45, 0.9, -1.9), '#202428'),
    colorize(new THREE.BoxGeometry(0.5, 0.9, 0.5).translate(0, 0.65, -3.25), '#111'), colorize(new THREE.BoxGeometry(0.14, 0.9, 0.14).translate(0, 0.1, -3.3), '#333')]), M.trim);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.06).rotateX(-0.6).translate(0, 1.0, 0.55), M.carGlass);
  inner.add(paint, trim, glass);
  group.position.set(x, -0.2, z); group.rotation.y = h; scene.add(group);
  const c = baseVehicle(group, inner, paint, paintM, 'boat', s, h, { home: [x, z, h] });
  cars.push(initCar(c)); return c;
}
function boatPhysics(c, dt, thr, steer) {
  const up = c.up || { engine: 0 }, sMax = c.spec.max * (1 + 0.2 * up.engine), sin = Math.sin(c.h), cos = Math.cos(c.h);
  let vF = c.vx * sin + c.vz * cos, vL = c.vx * -cos + c.vz * sin;
  if (!c.dead) vF += thr * (thr > 0 ? c.spec.acc * (1 - Math.max(0, vF) / sMax * 0.8) : (vF > 0.5 ? 14 : 6)) * dt;
  vF *= Math.exp(-0.32 * dt); vF = clamp(vF, -7, sMax);
  c.steer = damp(c.steer, steer * 0.6, 4, dt);
  c.h += -c.steer * clamp(vF / 7, -1, 1) * 1.15 * dt;
  vL *= Math.exp(-2.4 * dt);
  const s2 = Math.sin(c.h), c2 = Math.cos(c.h); c.vx = s2 * vF - c2 * vL; c.vz = c2 * vF + s2 * vL;
  let x = c.group.position.x + c.vx * dt, z = c.group.position.z + c.vz * dt;
  const xmin = WATERLINE + 3.5;
  if (x < xmin) { x = xmin; c.vx = Math.abs(c.vx) * 0.2; if (Math.abs(vF) > 8 && c.mode === 'player') { AudioSys.crash(0.5); damageCar(c, Math.abs(vF)); } }
  x = Math.min(x, SHORE_X + 1500); z = clamp(z, -2800, 2800);
  if (x < DOCK.x1 + 1.5 && Math.abs(z - DOCK.z) < DOCK.w / 2 + 1.4) { const sd = z >= DOCK.z ? 1 : -1; if (x > DOCK.x1 - 0.5) x = DOCK.x1 + 1.5; else z = DOCK.z + sd * (DOCK.w / 2 + 1.4); c.vz *= -0.3; }
  c.group.position.x = x; c.group.position.z = z;
  const w = waveH(x, z), wf = waveH(x + s2 * 2.5, z + c2 * 2.5), wb = waveH(x - s2 * 2.5, z - c2 * 2.5);
  c.y = c.dead ? c.y - dt * 0.35 : w + 0.05; c.group.position.y = c.y;
  c.group.rotation.y = c.h;
  c.group.rotation.x = damp(c.group.rotation.x, -Math.atan2(wf - wb, 5) - clamp(vF / 160, -0.05, 0.16), 4, dt);
  c.group.rotation.z = damp(c.group.rotation.z, c.steer * clamp(vF / 25, -1, 1) * 0.25 + Math.sin(state.now * 1.3 + x) * 0.03, 4, dt);
  if (Math.abs(vF) > 5 && !c.dead && Math.random() < 0.8) {
    const bx = x - s2 * 3.2, bz = z - c2 * 3.2;
    FX.norm.spawn(bx + MR(-0.6, 0.6), c.y + 0.2, bz + MR(-0.6, 0.6), -s2 * 2 + MR(-1.5, 1.5), MR(1, 2.5), -c2 * 2 + MR(-1.5, 1.5), 1.1, 0.6, 2.2, 0.92, 0.95, 1, 0.55, 6);
  }
}

// ============================================================ HELICOPTER
function createHeli(color, x, y, z, h) {
  const s = CAR_SPECS.heli, group = new THREE.Group(); group.rotation.order = 'YXZ';
  const inner = new THREE.Group(); group.add(inner);
  const paintM = paintMat(color);
  const body = merge([new THREE.SphereGeometry(1, 18, 12).scale(1.2, 1.05, 2.1).translate(0, 1.55, 0.3), new THREE.CylinderGeometry(0.22, 0.38, 4.6, 10).rotateX(Math.PI / 2).translate(0, 1.85, -3.4), new THREE.BoxGeometry(0.12, 1.3, 0.8).translate(0, 2.4, -5.5)]);
  const paint = new THREE.Mesh(body, paintM); paint.castShadow = true;
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.1, 0.9, 1.3).rotateX(1.15).translate(0, 1.7, 1.1), M.carGlass);
  const skids = new THREE.Mesh(merge([colorize(new THREE.BoxGeometry(0.12, 0.12, 4.2).translate(0.95, 0.06, 0.2), '#222'), colorize(new THREE.BoxGeometry(0.12, 0.12, 4.2).translate(-0.95, 0.06, 0.2), '#222'),
    ...[[0.8, 1.2], [-0.8, 1.2], [0.8, -0.7], [-0.8, -0.7]].map(([sx, sz]) => colorize(new THREE.BoxGeometry(0.08, 0.75, 0.08).translate(sx, 0.45, sz), '#222')), colorize(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8).translate(0, 2.75, 0.1), '#222')]), M.trim);
  const rotor = new THREE.Group(); rotor.position.set(0, 3.0, 0.1);
  const bladeM = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 7.2).translate(0, 0, 3.6), bladeM); b.rotation.y = k * Math.PI / 2; rotor.add(b); }
  const tail = new THREE.Group(); tail.position.set(0.18, 2.3, -5.6);
  for (let k = 0; k < 2; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.6, 0.18), bladeM); b.rotation.x = k * Math.PI / 2; tail.add(b); }
  inner.add(paint, glass, skids, rotor, tail);
  group.position.set(x, y, z); group.rotation.y = h; scene.add(group);
  const c = baseVehicle(group, inner, paint, paintM, 'heli', s, h, { rotor, tailRotor: tail, power: 0, rotorA: 0, home: [x, y, z, h] });
  c.y = y; cars.push(initCar(c)); return c;
}
function heliPhysics(c, dt, fwdIn, turnIn, liftIn) {
  const on = c.mode === 'player' && !c.dead, p = c.group.position;
  c.power = damp(c.power, on ? 1 : 0, on ? 0.9 : 0.4, dt);
  c.rotorA += c.power * 30 * dt; c.rotor.rotation.y = c.rotorA; c.tailRotor.rotation.x = c.rotorA * 1.6;
  const floor = Math.max(groundY(p.x, p.z), roofHeight(p.x, p.z)), alt = c.y - floor, flying = alt > 0.25;
  if (c.dead) c.vy -= 16 * dt;
  else { const ready = c.power > 0.8; c.vy = damp(c.vy, ready ? liftIn * 9 : (flying ? -6 : 0), ready ? 2.5 : 1.2, dt); }
  const sMax = c.spec.max * (1 + 0.2 * ((c.up && c.up.engine) || 0));
  if (flying && !c.dead) {
    c.vx += Math.sin(c.h) * fwdIn * 20 * dt * c.power; c.vz += Math.cos(c.h) * fwdIn * 20 * dt * c.power;
    c.h += -turnIn * 1.7 * dt;
    const sp = Math.hypot(c.vx, c.vz); if (sp > sMax) { c.vx *= sMax / sp; c.vz *= sMax / sp; }
    c.vx *= Math.exp(-0.6 * dt); c.vz *= Math.exp(-0.6 * dt);
  } else { c.vx *= Math.exp(-6 * dt); c.vz *= Math.exp(-6 * dt); if (c.power > 0.8) c.h += -turnIn * 0.9 * dt; }
  let x = p.x + c.vx * dt, z = p.z + c.vz * dt;
  c.y = Math.min(300, c.y + c.vy * dt);
  if ((Math.abs(x) < HALF + 30 && Math.abs(z) < HALF + 30) || inAirport(x, z)) {
    const r = collide(x, z, 2.6, c.y + 0.5, false);
    if (r.hit) { const imp = Math.hypot(c.vx, c.vz); x = r.x; z = r.z; c.vx *= -0.3; c.vz *= -0.3; if (imp > 9) { damageCar(c, imp * 2.5); state.shake = 0.6; AudioSys.crash(0.8); } }
  }
  x = clamp(x, -2200, 2200); z = clamp(z, -2200, 2200);
  const nf = Math.max(groundY(x, z), roofHeight(x, z));
  if (c.y < nf) { if (c.vy < -9 && !c.dead) { damageCar(c, -c.vy * 5); state.shake = 0.7; AudioSys.crash(0.7); } c.y = nf; c.vy = Math.max(0, c.vy); }
  p.set(x, c.y, z); c.group.rotation.y = c.h;
  c.group.rotation.x = damp(c.group.rotation.x, flying ? fwdIn * 0.22 : 0, 3, dt);
  c.group.rotation.z = damp(c.group.rotation.z, flying ? turnIn * 0.18 : 0, 3, dt);
  if (c.power > 0.5 && alt < 8 && Math.random() < 0.5) FX.norm.spawn(x + MR(-4, 4), nf + 0.3, z + MR(-4, 4), MR(-6, 6), 0.5, MR(-6, 6), 0.9, 1, 3, 0.75, 0.72, 0.65, 0.3 * (1 - alt / 8), 0);
}
function respawnSpecial(c) {
  const h = c.home; c.dead = false; c.health = c.maxHealth; c.paint.material = c.paintM; c.mode = 'free'; c.vx = c.vz = c.vy = 0; c.air = false;
  if (c.spec.heli) { c.y = h[1]; c.group.position.set(h[0], h[1], h[2]); c.h = h[3]; } else { c.group.position.set(h[0], 0, h[1]); c.h = h[2]; c.y = 0; }
  c.group.rotation.set(0, c.h, 0); c.group.visible = true; c.active = true;
}
function buildSpecialVehicles() {
  createBoat('#f4f4f4', DOCK.x1 - 6, DOCK.z + DOCK.w / 2 + 1.6, Math.PI / 2);
  createBoat('#c81e28', DOCK.x1 - 14, DOCK.z - DOCK.w / 2 - 1.6, Math.PI / 2);
  createHeli('#1a3a6a', HELIPADS[0][0], HELIPADS[0][1], HELIPADS[0][2], 0);
  createHeli('#e8e8e8', HELIPADS[1][0], HELIPADS[1][1], HELIPADS[1][2], -Math.PI / 2);
}

// ============================================================ GANG (industrial district fights back)
const GANG = { name: 'Kızıl Kobralar', members: [], hostile: false, calmT: 0, warnT: 0, inZone: false };
function inGangZone(x, z) { const b = blockAt(x, z) || blocks[clamp(Math.floor((x - OFF) / CELL), 0, N - 1)][clamp(Math.floor((z - OFF) / CELL), 0, N - 1)]; return b.dist === 'industrial' && Math.abs(z - b.cz) < CELL / 2 && Math.abs(x - b.cx) < CELL / 2; }
function buildGang() {
  const zone = []; for (const row of blocks) for (const b of row) if (b.dist === 'industrial') zone.push(b);
  for (const b of zone.filter(b => b.i >= 4).slice(0, 4)) {
    const gx = b.cx + R(-18, 18), gz = b.cz + BLOCK / 2 - 3;
    for (let k = 0; k < 2; k++) {
      const p = npcPed({ skin: pick(SKIN), shirt: '#a8141e', pants: pick(['#1d1d24', '#2b3a55']), hair: '#101010', shoes: '#f2f2f2', cap: Math.random() < 0.6 ? '#a8141e' : null, glasses: Math.random() < 0.4, gun: true }, gx + k * 1.6, gz);
      p.npc = 'gang'; p.hp = 2; p.home = [gx + k * 1.6, gz]; p.dead = false; p.yaw = Math.PI; p.h.g.visible = true; p.respawnT = 0;
      GANG.members.push(p);
    }
  }
}
function updateGang(dt) {
  const inZ = inGangZone(player.pos.x, player.pos.z);
  if (turfOwned('se')) { for (const p of GANG.members) if (!p.dead) { p.dead = true; p.h.g.visible = false; } GANG.hostile = false; return; }
  GANG.inZone = inZ;
  let near = 1e9;
  for (const p of GANG.members) {
    const h = p.h;
    if (p.dead) {
      p.respawnT -= dt; h.g.position.set(p.x, groundY(p.x, p.z) + 0.12, p.z);
      if (p.respawnT <= 0 && dist2(p) > 140 * 140) { p.dead = false; p.hp = 2; p.x = p.home[0]; p.z = p.home[1]; h.g.rotation.set(0, Math.PI, 0); }
      continue;
    }
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z, d = Math.hypot(dx, dz) || 1; near = Math.min(near, d);
    h.g.visible = d < 180;
    let spd = 0, mx = 0, mz = 0;
    if (GANG.hostile && d < 55 && !state.dead) {
      if (d > 11) { spd = 3.4; mx = dx / d; mz = dz / d; }
      p.shootT -= dt;
      if (d < 42 && p.shootT <= 0 && los(p.x, 1.4, p.z, player.pos.x, 1.3, player.pos.z)) {
        p.shootT = MR(0.7, 1.5); const hit = Math.random() < 0.3;
        FX.tracer(p.x, 1.45, p.z, player.pos.x + (hit ? 0 : MR(-2.5, 2.5)), player.pos.y + 1.2, player.pos.z + (hit ? 0 : MR(-2.5, 2.5)), true);
        AudioSys.shot(0.45);
        if (hit) { if (state.inCar) { damageCar(state.inCar, 4); state.health -= 1; } else applyDamage(6); }
      }
    } else if (Math.hypot(p.x - p.home[0], p.z - p.home[1]) > 2) { const hx = p.home[0] - p.x, hz = p.home[1] - p.z, hl = Math.hypot(hx, hz); spd = 1.6; mx = hx / hl; mz = hz / hl; }
    if (spd) { const r = collide(p.x + mx * spd * dt, p.z + mz * spd * dt, 0.35, 0.5); p.x = r.x; p.z = r.z; }
    const want = GANG.hostile && d < 55 ? Math.atan2(dx, dz) : spd ? Math.atan2(mx, mz) : (d < 12 ? Math.atan2(dx, dz) : p.yaw);
    p.yaw = wrapA(p.yaw + wrapA(want - p.yaw) * (1 - Math.exp(-6 * dt)));
    const c = state.inCar;
    if (c && !c.spec.heli && !c.spec.boat && carSpeed(c) > 6 && Math.hypot(c.group.position.x - p.x, c.group.position.z - p.z) < 1.7) { killPed(p, true); AudioSys.thud(); continue; }
    if (h.g.visible) { h.g.position.set(p.x, groundY(p.x, p.z), p.z); h.g.rotation.y = p.yaw; animHuman(h, spd, dt, GANG.hostile && d < 55); }
  }
  // provocation: loitering right next to them on foot
  if (!GANG.hostile && !state.inCar && near < 6) { GANG.warnT += dt; if (GANG.warnT > 2 && GANG.warnT - dt <= 2) floatText('💬 "Burada ne arıyorsun?"'); if (GANG.warnT > 6) gangAggro(); }
  else GANG.warnT = Math.max(0, GANG.warnT - dt);
  if (GANG.hostile) { GANG.calmT = near > 120 ? GANG.calmT + dt : 0; if (GANG.calmT > 15) { GANG.hostile = false; GANG.calmT = 0; } }
}
function gangAggro() { if (!GANG.hostile) floatText(`🔥 ${GANG.name} saldırıyor!`); GANG.hostile = true; GANG.calmT = 0; }

// ============================================================ POPULATION BUBBLE (despawn / respawn around the player)
let recycleT = 0;
function recyclePopulation(dt) {
  if (state.interior || NW.client) return;
  recycleT += dt; if (recycleT < 0.5) return; recycleT = 0;
  const tgt = state.mission && (state.mission.type === 'hit' || state.mission.type === 'story') ? state.mission.target : null;
  for (const c of cars) {
    if (!c.active || c.mode !== 'ai' || c === tgt || c.event) continue;
    if (nearestPlayerDist(c.group.position.x, c.group.position.z) > 230) { placeOnRoad(c, 'near', popCenter()); c.group.visible = true; }
  }
}

// ============================================================ TURF WARS (4 territories)
const TURFS = [
  { id: 'nw', name: 'Kuzeybatı', gang: 'Mavi Ejderler', color: '#2a6ad8', i0: 0, i1: 3, j0: 0, j1: 3, flag: [1, 1], income: 400 },
  { id: 'ne', name: 'Kuzeydoğu', gang: 'Altın Kartallar', color: '#e0b020', i0: 4, i1: 7, j0: 0, j1: 3, flag: [6, 1], income: 500 },
  { id: 'sw', name: 'Güneybatı', gang: 'Mor Akrepler', color: '#8a3ad0', i0: 0, i1: 3, j0: 4, j1: 7, flag: [2, 5], income: 400 },
  { id: 'se', name: 'Güneydoğu', gang: 'Kızıl Kobralar', color: '#c8202a', i0: 4, i1: 7, j0: 4, j1: 7, flag: [5, 7], income: 600 },
];
const PLAYER_TURF = '#30d070';
const turfOwned = id => state.turf[id] === 'player';
const turfCount = () => TURFS.filter(t => turfOwned(t.id)).length;
const turfIncome = () => TURFS.reduce((a, t) => a + (turfOwned(t.id) ? t.income : 0), 0);
function turfAt(x, z) { const i = Math.floor((x - OFF) / CELL), j = Math.floor((z - OFF) / CELL); return TURFS.find(t => i >= t.i0 && i <= t.i1 && j >= t.j0 && j <= t.j1) || null; }
let turfLayer = null;
function drawTurfLayer() {
  if (!turfLayer) { turfLayer = document.createElement('canvas'); turfLayer.width = turfLayer.height = MAP.S; }
  const g = turfLayer.getContext('2d'); g.clearRect(0, 0, MAP.S, MAP.S);
  for (const t of TURFS) {
    const x0 = MAP.X(nodeP(t.i0)), x1 = MAP.X(nodeP(t.i1 + 1)), z0 = MAP.Z(nodeP(t.j0)), z1 = MAP.Z(nodeP(t.j1 + 1)), col = turfOwned(t.id) ? PLAYER_TURF : t.color;
    g.globalAlpha = 0.24; g.fillStyle = col; g.fillRect(x0, z0, x1 - x0, z1 - z0);
    g.globalAlpha = 0.85; g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(x0 + 2, z0 + 2, x1 - x0 - 4, z1 - z0 - 4);
  }
  g.globalAlpha = 1;
}
function buildTurfs() {
  const poleM = new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.7, roughness: 0.4 });
  for (const t of TURFS) {
    const b = blocks[t.flag[0]][t.flag[1]], x = b.cx - 14, z = b.cz + BLOCK / 2 - 3, y = groundY(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6.5, 8).translate(0, 3.25, 0), poleM); pole.position.set(x, y, z);
    t.clothM = new THREE.MeshStandardMaterial({ color: turfOwned(t.id) ? PLAYER_TURF : t.color, side: THREE.DoubleSide, emissive: 0x000000, roughness: 0.8 });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4, 8, 1).translate(1.1, 5.7, 0), t.clothM); cloth.position.set(x, y, z);
    t.ringM = new THREE.MeshBasicMaterial({ color: turfOwned(t.id) ? PLAYER_TURF : t.color, transparent: true, opacity: 0.8, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.8, 3.4, 40).rotateX(-Math.PI / 2), t.ringM); ring.position.set(x, y + 0.04, z);
    pole.castShadow = cloth.castShadow = true; scene.add(pole, cloth, ring);
    Object.assign(t, { x, z, cloth, ring, pool: [] });
  }
  drawTurfLayer();
}
function setTurfOwner(t, owner) {
  state.turf[t.id] = owner; const col = owner === 'player' ? PLAYER_TURF : t.color;
  t.clothM.color.set(col); t.ringM.color.set(col); drawTurfLayer();
}
function turfPed(t) {
  const free = t.pool.find(p => p.dead && !p.h.g.visible); if (free) return free;
  const p = npcPed({ skin: pick(SKIN), shirt: t.color, pants: pick(['#1d1d24', '#2b3a55', '#3a3a40']), hair: '#101010', shoes: '#f2f2f2', cap: Math.random() < 0.5 ? t.color : null, glasses: Math.random() < 0.4, gun: true }, 0, 0);
  p.npc = 'turf'; t.pool.push(p); return p;
}
function startTurfWar(t) {
  if (state.mission) { floatText('Önce mevcut görevi bitir'); return; }
  state.mission = { type: 'turf', turf: t, wave: 0, waves: [4, 5, 6], enemies: [], x: t.x, z: t.z, time: 999, reward: 3000 + t.income * 5, nextT: 1.5 };
  setMarker(t.x, t.z, 'turf'); markerGroup.visible = false;
  showBig('BÖLGE SAVAŞI', t.color, 3, `${t.gang} · 3 dalgayı temizle · Ödül $${state.mission.reward}`);
  haptic([60, 40, 60]); AudioSys.thunder();
}
function spawnTurfWave(m) {
  const t = m.turf, n = m.waves[m.wave];
  m.enemies = [];
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, d = MR(24, 38), p = turfPed(t);
    const r = collide(t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.5, 0.5);
    Object.assign(p, { x: r.x, z: r.z, dead: false, hp: 2, shootT: MR(1, 2.5), yaw: 0 });
    p.h.g.rotation.set(0, 0, 0); p.h.g.visible = true; m.enemies.push(p);
  }
  floatText(`⚔ Dalga ${m.wave + 1}/${m.waves.length} · ${n} düşman`); AudioSys.door();
}
function updateTurfWar(dt, m) {
  const t = m.turf, el = $('mission');
  if (Math.hypot(player.pos.x - t.x, player.pos.z - t.z) > 140) return missionEnd(false, 'Bölgeden kaçtın');
  if (!m.enemies.length || m.enemies.every(p => p.dead)) {
    if (m.enemies.length) { m.wave++; m.enemies = []; m.nextT = 3; if (m.wave >= m.waves.length) { setTurfOwner(t, 'player'); showBig('BÖLGE ELE GEÇİRİLDİ', PLAYER_TURF, 3, `${t.name} artık senin · +$${t.income}/saat`); return missionEnd(true, `${t.name} kontrolünde`); } floatText('✔ Dalga temizlendi'); }
    m.nextT -= dt; if (m.nextT <= 0) spawnTurfWave(m);
  }
  const alive = m.enemies.filter(p => !p.dead).length;
  el.textContent = `⚔ ${t.gang} · Dalga ${Math.min(m.wave + 1, m.waves.length)}/${m.waves.length} · Kalan ${alive} · 💵 $${m.reward}`;
  for (const p of m.enemies) {
    const h = p.h;
    if (p.dead) { h.g.position.set(p.x, groundY(p.x, p.z) + 0.12, p.z); continue; }
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
    let spd = 0;
    if (d > 10 && !state.dead) { spd = 3.6; const r = collide(p.x + dx / d * spd * dt, p.z + dz / d * spd * dt, 0.35, 0.5); p.x = r.x; p.z = r.z; }
    p.shootT -= dt;
    if (!state.dead && d < 45 && p.shootT <= 0 && los(p.x, 1.4, p.z, player.pos.x, 1.3, player.pos.z)) {
      p.shootT = MR(0.8, 1.7); const hit = Math.random() < 0.3;
      FX.tracer(p.x, 1.45, p.z, player.pos.x + (hit ? 0 : MR(-2.5, 2.5)), player.pos.y + 1.2, player.pos.z + (hit ? 0 : MR(-2.5, 2.5)), true);
      AudioSys.shot(0.45);
      if (hit) { if (state.inCar) { damageCar(state.inCar, 4); state.health -= 1; } else applyDamage(6); }
    }
    const c = state.inCar;
    if (c && !c.spec.heli && !c.spec.boat && carSpeed(c) > 6 && Math.hypot(c.group.position.x - p.x, c.group.position.z - p.z) < 1.7) { killPed(p, true); AudioSys.thud(); continue; }
    p.yaw = wrapA(p.yaw + wrapA(Math.atan2(dx, dz) - p.yaw) * (1 - Math.exp(-6 * dt)));
    h.g.position.set(p.x, groundY(p.x, p.z), p.z); h.g.rotation.y = p.yaw; animHuman(h, spd, dt, true);
  }
}
function hideTurfWar(m) { for (const p of m.turf.pool) { p.dead = true; p.h.g.visible = false; p.h.g.rotation.x = 0; } }
function updateTurfs(dt) {
  for (const t of TURFS) {
    t.cloth.rotation.y = Math.sin(state.now * 2 + t.x) * 0.25;
    if (turfOwned(t.id) || state.mission || state.dead) continue;
    if (Math.hypot(player.pos.x - t.x, player.pos.z - t.z) < 3.4) state.interact = state.inCar ? { label: 'Bölge savaşı için araçtan in', fn: null } : { label: '⚔ BÖLGE SAVAŞI BAŞLAT', fn: () => startTurfWar(t) };
  }
  const cur = turfAt(player.pos.x, player.pos.z);
  if (cur !== state.curTurf) { state.curTurf = cur; if (cur) floatText(turfOwned(cur.id) ? `🟢 Senin bölgen: ${cur.name}` : `⚠ ${cur.gang} bölgesi`); }
}

// ============================================================ WORLD EVENTS: armored truck + hidden packages
const PACKAGE_COUNT = 20;
const PACKAGES = [];
let packageMesh = null;
function buildPackages() {
  const r = mulberry32(777), RR = (a, b) => a + r() * (b - a);
  const spots = [[DOCK.x1 - 1.5, DOCK.y, DOCK.z], [WATERLINE - 4, 0.05, -HALF - 40], [WATERLINE - 4, 0.05, HALF + 40], [-HALF - 50, 0.02, -HALF - 50], [-HALF - 50, 0.02, HALF + 50]];
  if (HELIPADS[2]) spots.push([HELIPADS[2][0] + 4, HELIPADS[2][1], HELIPADS[2][2] + 4]); // rooftop: helicopter only
  let tries = 0;
  while (spots.length < PACKAGE_COUNT && tries++ < 4000) {
    const b = blocks[Math.floor(r() * N)][Math.floor(r() * N)];
    if (b.park || b.dist === 'residential') continue;
    const x = b.cx + RR(-31, 31), z = b.cz + RR(-31, 31);
    if (insideBuilding(x, 0.5, z)) continue;
    if (collide(x, z, 0.7, 0.5).hit) continue;            // free spot …
    if (!collide(x, z, 2.2, 0.5).hit) continue;           // … but tucked against a wall (back alley)
    if (spots.some(s => Math.hypot(s[0] - x, s[2] - z) < 70)) continue;
    spots.push([x, 0.25, z]);
  }
  spots.slice(0, PACKAGE_COUNT).forEach((s, id) => PACKAGES.push({ id, x: s[0], y: s[1], z: s[2] }));
  const geo = merge([colorize(new THREE.BoxGeometry(0.62, 0.42, 0.3), '#ffffff'), colorize(new THREE.TorusGeometry(0.14, 0.03, 6, 12, Math.PI).translate(0, 0.21, 0), '#ffffff')]);
  packageMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), PACKAGES.length);
  PACKAGES.forEach((p, i) => packageMesh.setColorAt(i, new THREE.Color().setHSL((i * 0.13) % 1, 1, 0.55).multiplyScalar(2.2)));
  packageMesh.frustumCulled = false; scene.add(packageMesh);
}
const packagesFound = () => PACKAGES.filter(p => state.packages[p.id]).length;
function updatePackages(dt) {
  const t = state.now;
  for (const p of PACKAGES) {
    const found = state.packages[p.id];
    m4.compose(tmpV.set(p.x, p.y + 0.7 + Math.sin(t * 2 + p.id) * 0.12, p.z), q4.setFromEuler(e4.set(0, t * 1.5 + p.id, 0)), tmpV2.setScalar(found ? 0 : 1));
    packageMesh.setMatrixAt(p.id, m4);
    if (found) continue;
    const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
    if (d < (state.inCar ? 3 : 1.6) && Math.abs(player.pos.y - p.y) < 3) collectPackage(p);
  }
  packageMesh.instanceMatrix.needsUpdate = true;
}
function collectPackage(p) {
  state.packages[p.id] = true;
  const n = packagesFound(); earn(500, '🎒 Gizli paket');
  let bonus = `Görev ödülleri kalıcı +%${n * 3}`;
  if (n === 5) bonus = 'BONUS: Her doğuşta tam zırh';
  if (n === 10) { state.ownedW[2] = true; state.ammo[2] += 300; bonus = 'BONUS: Taramalı tüfek + 300 mermi'; }
  if (n === 15) { state.ownedW[4] = true; state.ammo[4] += 10; bonus = 'BONUS: Roketatar + 10 roket'; }
  if (n === PACKAGE_COUNT) { earn(50000, '🎒 Tüm paketler'); bonus = 'TÜM PAKETLER! +$50.000'; }
  showBig(`🎒 GİZLİ PAKET ${n}/${PACKAGE_COUNT}`, '#ff5fd0', 3, `+$500 · ${bonus}`);
  AudioSys.success(); AudioSys.cash(); haptic([30, 30, 30, 30, 80]);
  for (let k = 0; k < 20; k++) FX.add.spawn(p.x, p.y + 0.8, p.z, MR(-3, 3), MR(2, 6), MR(-3, 3), 0.8, 0.35, 0, 2.5, 0.6, 2.2, 1, 6);
  saveGame();
}
function updateEvents(dt) {
  const tr = state.truck;
  if (tr && tr.active) {
    const d = Math.hypot(tr.group.position.x - player.pos.x, tr.group.position.z - player.pos.z);
    tr.eventT += dt;
    if (tr.dead && !tr.looted) {
      tr.looted = true; const p = tr.group.position;
      for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2, rr = MR(1.5, 6); spawnCash(p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr, Math.round(MR(250, 650) / 10) * 10, false); }
      addHeat(1.5); S().robberies++;
      showBig('SOYGUN!', '#7dff9a', 3, 'Para balyaları etrafa saçıldı — topla!'); haptic([50, 30, 50]);
    }
    if (!tr.dead && tr.eventT > 200 && d > 150) { tr.active = false; tr.group.visible = false; floatText('💰 Para kamyonu bölgeden ayrıldı'); }
    if (tr.ai && tr.health < tr.maxHealth && !tr.dead) tr.ai.panic = 4;
  }
  state.eventT -= dt;
  if (state.eventT <= 0) {
    state.eventT = MR(200, 320);
    if (!tr || !tr.active || tr.dead) {
      let c = tr;
      if (!c) { c = createCar('armored', '#4a5644', 0, 0, 0, 'ai'); c.event = 'truck'; state.truck = c; }
      c.dead = false; c.paint.material = c.paintM; c.maxHealth = c.health = 520; c.active = true; c.group.visible = true; c.looted = false; c.eventT = 0;
      c.group.rotation.set(0, 0, 0); c.vx = c.vz = c.vy = 0; c.air = false;
      placeOnRoad(c, 'near'); c.ai.cruise = 10;
      showBig('💰 ZIRHLI PARA KAMYONU', '#ffd23a', 3, 'Yakınlarda para taşıyor · durdur ve patlat!');
      AudioSys.tone(660, 0.2, 0.2, 'square'); AudioSys.tone(880, 0.3, 0.2, 'square', 1, 0.2);
    }
  }
}

// ============================================================ STUNT JUMPS + SLOW MOTION
function addRamp(x, z, heading, y0, rampMat, stripe) {
  const len = 14, h = 3.4, w = 7, rot = heading - Math.PI / 2;
  const sh2 = new THREE.Shape(); sh2.moveTo(0, 0); sh2.lineTo(len, h); sh2.lineTo(len, 0); sh2.closePath();
  const g = new THREE.ExtrudeGeometry(sh2, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2);
  const mesh = new THREE.Mesh(g, rampMat); mesh.position.set(x, y0, z); mesh.rotation.y = rot; mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  const st = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, w + 0.02), stripe); st.position.set(len - 0.2, h, 0); mesh.add(st);
  ramps.push({ x, z, fx: Math.sin(heading), fz: Math.cos(heading), len, h, w, y0 });
}
function buildStuntRamps() {
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xb08850, roughness: 0.8, map: noiseTex('#a88450', ['#8a6a3a', '#c09a60'], 128, 1500, 1, 8) });
  const stripe = new THREE.MeshBasicMaterial({ color: 0xffc020 });
  for (const [bi, bj, hd] of [[1, 2, Math.PI / 2], [5, 1, -Math.PI / 2], [6, 5, 0]]) {
    const b = blocks[bi][bj]; addRamp(b.cx - Math.sin(hd) * 16, b.cz - Math.cos(hd) * 16, hd, 0.31, rampMat, stripe);
  }
  ramps.forEach((r, i) => r.id = i);
}
function rampAt(x, z) { for (const r of ramps) { const dx = x - r.x, dz = z - r.z, a = dx * r.fx + dz * r.fz, l = Math.abs(dx * -r.fz + dz * r.fx); if (a >= 0 && a <= r.len + 0.5 && l <= r.w / 2) return r; } return null; }
function updateStunt(c, realDt) {
  if (c.spec.heli || c.spec.boat) return;
  const p = c.group.position, r = rampAt(p.x, p.z);
  if (r) { c.rampT = state.now; c.rampId = r.id; }
  const st = state.stunt;
  if (!st) {
    if (c.air && state.now - (c.rampT ?? -9) < 0.5 && carSpeed(c) > 15) {
      const fx = Math.sin(c.h), fz = Math.cos(c.h), rx = -Math.cos(c.h), rz = Math.sin(c.h);
      state.stunt = { car: c, t: 0, x0: p.x, z0: p.z, y0: c.y, maxH: 0, ramp: c.rampId, cam: new THREE.Vector3(p.x + fx * 16 + rx * 11, c.y + 4, p.z + fz * 16 + rz * 11) };
      state.timeTarget = 0.3; document.body.classList.add('cine');
    }
    return;
  }
  st.t += realDt; st.maxH = Math.max(st.maxH, c.y - groundY(p.x, p.z));
  if (st.t > 2.4) { state.timeTarget = 1; st.cam = null; document.body.classList.remove('cine'); }
  if (st.t > 6) { endStunt(false); return; }
  if (!c.air && st.t > 0.15) {
    endStunt(true);
  }
}
function endStunt(landed) {
  const st = state.stunt; if (!st) return;
  state.stunt = null; state.timeTarget = 1; document.body.classList.remove('cine');
  const c = st.car, p = c.group.position, dist = Math.hypot(p.x - st.x0, p.z - st.z0);
  if (!landed || c.dead || state.inCar !== c || dist < 8) return;
  const first = !state.stuntsDone[st.ramp];
  let bonus = Math.round((80 + dist * 9 + st.maxH * 45) / 10) * 10; if (first) bonus *= 2;
  const tilt = Math.abs(c.group.rotation.z) + Math.abs(c.group.rotation.x);
  if (tilt > 0.9) { showBig('KÖTÜ İNİŞ', '#ff8a3a', 2, 'Bonus yok'); return; }
  state.stuntsDone[st.ramp] = true; S().stunts++;
  earn(bonus, '🏁 Stunt');
  showBig('STUNT BONUS', '#ffd23a', 3, `+$${bonus} · ${Math.round(dist)} m · yükseklik ${st.maxH.toFixed(1)} m${first ? ' · İLK ATLAYIŞ x2' : ''}`);
  AudioSys.success(); AudioSys.cash(); haptic([40, 30, 80]);
}

// ============================================================ SETTINGS + PERFORMANCE
const SETTINGS_KEY = 'vistabay_settings';
const settings = Object.assign({ fps: false, autoRes: true, vibrate: true, sens: 1, quality: null }, (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })());
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { } }
const perf = { t: 0, frames: 0, fps: 60, pr: 1, prMax: 1, prMin: 0.6, cool: 0 };
let fxaaPass = null;
function applyPixelRatio(pr) {
  perf.pr = pr; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
  if (composer) { composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight); }
  if (fxaaPass) fxaaPass.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  FX.add.mat.uniforms.uScale.value = FX.norm.mat.uniforms.uScale.value = innerHeight * pr * 0.5;
}
function updatePerf(rdt) {
  perf.t += rdt; perf.frames++;
  if (perf.t < 2) return;
  perf.fps = perf.frames / perf.t; perf.t = 0; perf.frames = 0;
  const el = $('fps'); el.style.display = settings.fps ? 'block' : 'none';
  if (settings.fps) el.textContent = `${Math.round(perf.fps)} FPS · ${perf.pr.toFixed(2)}x · ${renderer.info.render.calls} çizim`;
  if (!settings.autoRes || state.shopOpen || state.phoneOpen || state.dialog) return;
  if (perf.cool > 0) { perf.cool--; return; }
  if (perf.fps < 42 && perf.pr > perf.prMin + 0.01) { applyPixelRatio(Math.max(perf.prMin, perf.pr - 0.12)); perf.cool = 1; }
  else if (perf.fps > 57 && perf.pr < perf.prMax - 0.01) { applyPixelRatio(Math.min(perf.prMax, perf.pr + 0.08)); perf.cool = 2; }
}
function initPerf() {
  perf.pr = renderer.getPixelRatio(); perf.prMax = QUALITY === 'low' ? Math.min(devicePixelRatio, 1) : perf.pr; perf.prMin = QUALITY === 'low' ? 0.5 : Math.max(0.55, perf.prMax * 0.55);
  if (QUALITY !== 'high' && renderer.shadowMap.enabled) renderer.shadowMap.autoUpdate = false; // shadows at half rate
  document.addEventListener('visibilitychange', () => {
    state.hidden = document.hidden;
    try { if (AudioSys.ctx) document.hidden ? AudioSys.ctx.suspend() : AudioSys.ctx.resume(); } catch (e) { }
    if (document.hidden) saveGame(); else lastT = performance.now();
  });
}

// ============================================================ DIALOG (story cutscenes)
const CHARS = { rico: { name: 'Rico', icon: '😎', col: '#ffb040' }, nina: { name: 'Nina', icon: '🔧', col: '#40c0ff' }, vic: { name: 'Victor Kral', icon: '🎩', col: '#ff5060' }, you: { name: 'Sen', icon: '🙂', col: '#7dff9a' }, mar: { name: 'Marisol', icon: '💃', col: '#ff6ad5' } };
function showDialog(lines, onDone) {
  state.dialog = { lines, i: 0, onDone };
  try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { }
  for (const k in keys) keys[k] = false;
  touchState.joyId = touchState.lookId = null; touchState.jdx = touchState.jdy = 0; $('joy').style.display = 'none';
  document.body.classList.add('cine', 'talking'); $('dialog').style.display = 'flex'; renderDialog();
}
function renderDialog() {
  const d = state.dialog, [who, text] = d.lines[d.i], c = CHARS[who];
  $('dlgIcon').textContent = c.icon; $('dlgName').textContent = c.name; $('dlgName').style.color = c.col; $('dlgText').textContent = text;
  $('dlgMore').textContent = d.i < d.lines.length - 1 ? '▶ devam' : '✔ tamam';
  AudioSys.tone(520 + d.i * 40, 0.05, 0.06, 'triangle');
}
function advanceDialog() {
  const d = state.dialog; if (!d) return;
  d.i++;
  if (d.i < d.lines.length) { renderDialog(); return; }
  state.dialog = null; $('dialog').style.display = 'none'; document.body.classList.remove('cine', 'talking');
  if (d.onDone) d.onDone();
}

// ============================================================ STORY MISSIONS (6 chapters)
const garagePos = () => { const g = SHOPS.find(o => o.type === 'garage'); return [g.x, g.z]; };
const STORY = [
  { title: 'Eve Dönüş', giver: 'rico', reward: 1500,
    intro: [['rico', 'Sonunda geldin! Vista Bay\'e hoş geldin, kardeşim.'], ['rico', 'Sen yokken işler değişti. Victor Kral\'ın adamları her yeri tuttu.'], ['you', 'Ben de bu yüzden buradayım.'], ['rico', 'Önce sana bir araba lazım. Bir tane bul ve Nina\'nın garajına getir.']],
    stages: [{ kind: 'getin', what: 'car', text: 'Bir araca bin' }, { kind: 'goto', pos: garagePos, r: 5, need: 'car', text: 'Arabayı Nina\'nın garajına getir' }],
    outro: [['nina', 'Demek Rico\'nun meşhur arkadaşı sensin. Fena araba değil.'], ['nina', 'Garajım artık senin de garajın. Tamir, boya, yükseltme… ne lazımsa.']] },
  { title: 'Borç Tahsilatı', giver: 'rico', reward: 2500,
    intro: [['rico', 'Kral\'ın tahsildarı Dante her ay benden haraç kesiyor.'], ['rico', 'Arabası şu an şehirde dolaşıyor. Onu hurdaya çevir!']],
    stages: [{ kind: 'destroy', text: 'Dante\'nin arabasını yok et' }],
    outro: [['rico', 'Hahaha! Dante bir süre yürüyerek gezer.'], ['rico', 'Kral bunu duyacak. Hazırlıklı ol.']] },
  { title: 'Sıcak Takip', giver: 'nina', reward: 3000,
    intro: [['nina', 'Polis telsizlerini çözmeye çalışıyorum ama veriye ihtiyacım var.'], ['nina', 'Biraz ortalığı karıştır, 3 yıldız topla… sonra da izini kaybettir.']],
    stages: [{ kind: 'wanted', n: 3, text: '3 yıldız aranma seviyesine ulaş' }, { kind: 'lose', text: 'Polisi atlat (ya da garajda izini kaybettir)' }],
    outro: [['nina', 'Telsizden her şeyi kaydettim. Sen tam bir delisin!']] },
  { title: 'Liman Teslimatı', giver: 'rico', reward: 3500,
    intro: [['rico', 'Açık denizde bir şamandıraya paket bağlanmış.'], ['rico', 'İskeleden bir tekne al, paketi alıp geri getir. Kimse görmesin.']],
    stages: [{ kind: 'goto', pos: () => [DOCK.x1 - 8, DOCK.z], r: 8, text: 'Sahildeki iskeleye git' }, { kind: 'getin', what: 'boat', text: 'Bir tekneye bin' },
      { kind: 'goto', pos: () => [WATERLINE + 260, -240], r: 14, need: 'boat', text: 'Şamandıraya git' }, { kind: 'goto', pos: () => [DOCK.x1 + 6, DOCK.z + 6], r: 14, need: 'boat', text: 'Paketi iskeleye getir' }],
    outro: [['rico', 'Paket sağlam. Kral bunu duyunca çıldıracak.']] },
  { title: 'Gökyüzünden', giver: 'nina', reward: 4000,
    intro: [['nina', 'Kral\'ın adamları en yüksek gökdelenin çatısında buluşuyor.'], ['nina', 'Parktaki helikopteri al ve çatıya in. Onları gözetleyeceğiz.']],
    stages: [{ kind: 'getin', what: 'heli', text: 'Helikoptere bin (parktaki H pisti)' }, { kind: 'goto', pos: () => { const hp = HELIPADS[2] || HELIPADS[0]; return [hp[0], hp[2]]; }, r: 9, need: 'heli', alt: () => (HELIPADS[2] || HELIPADS[0])[1], text: 'Gökdelenin çatısındaki piste in' }],
    outro: [['nina', 'Görüntüler mükemmel! Kral sanayi bölgesindeki deposunda saklanıyor.']] },
  { title: 'Kral\'ın Düşüşü', giver: 'rico', reward: 10000,
    intro: [['rico', 'İşte o an geldi. Victor Kral sanayi bölgesinde.'], ['vic', 'Rico\'nun yeni oyuncağı demek… Gel bakalım!'], ['rico', 'Korumalarına dikkat et. Bu iş bitince şehir bizim!']],
    stages: [{ kind: 'boss', guards: 4, pos: () => { const b = blocks[5][7]; return [b.cx + 10, b.cz + BLOCK / 2 - 3]; }, text: 'Victor Kral\'ı etkisiz hale getir' }],
    outro: [['rico', 'Bitti… Vista Bay artık bizim!'], ['nina', 'Ve garajım kâra geçecek gibi görünüyor 😄'], ['rico', 'Ama bu boşluğu dolduracak başkaları da var. Hazır ol…']] },
  // ---------------- PERDE 2: KARTEL
  { title: 'Yeni Oyuncular', giver: 'nina', reward: 6000,
    intro: [['nina', 'Kral düştü ama boşluğu Kartel doldurmaya çalışıyor.'], ['nina', 'Kuryeleri şehirde mal taşıyor. Kuryenin aracını durdur!']],
    stages: [{ kind: 'destroy', text: 'Kartel kuryesinin aracını yok et' }],
    outro: [['nina', 'Kartel bunu kişisel algılayacak… Rico\'yla konuş.']] },
  { title: 'Otobüs Operasyonu', giver: 'rico', reward: 7000,
    intro: [['rico', 'Kartel, şehir otobüslerini kurye olarak kullanıyor.'], ['rico', 'Bir otobüs al ve 3 durağı dolaş. Paketleri durağa bırakacağız.']],
    stages: [{ kind: 'getin', what: 'bus', text: 'Bir şehir otobüsüne bin (durakta park halinde biri var)' },
      { kind: 'goto', pos: () => [BUS_STOPS[1].x, BUS_STOPS[1].roadZ], r: 9, need: 'bus', text: '1. durağa git' },
      { kind: 'goto', pos: () => [BUS_STOPS[2].x, BUS_STOPS[2].roadZ], r: 9, need: 'bus', text: '2. durağa git' },
      { kind: 'goto', pos: () => [BUS_STOPS[3].x, BUS_STOPS[3].roadZ], r: 9, need: 'bus', text: '3. durağa git' }],
    outro: [['rico', 'Paketler yerinde. Kartel\'in rotası çöktü!'], ['rico', 'Patronları Marisol bu gece kulüpte olacakmış…']] },
  { title: 'Kulüpte Hesaplaşma', giver: 'rico', reward: 15000,
    intro: [['rico', 'Kartel patronu Marisol, Gece Kulübü\'nde.'], ['rico', 'İçeri gir, onunla konuş… ama dikkatli ol.']],
    stages: [{ kind: 'interior', id: 'club', text: 'Gece Kulübü\'ne gir' },
      { kind: 'talk', lines: [['mar', 'Demek ünlü yeni oyuncu sensin.'], ['mar', 'Vista Bay\'i kimseyle paylaşmam. Adamlarım dışarıda seni bekliyor!'], ['you', 'O zaman dışarıda görüşelim.']] },
      { kind: 'boss', guards: 4, pos: () => { const [x, z] = INTERIORS.club.ext; return [x + 14, z + 5]; }, text: 'Dışarı çık ve Kartel tetikçilerini alt et' }],
    outro: [['rico', 'Kartel de bitti. Şehirde senden büyük yok!'], ['nina', 'Bir sonraki perdeye kadar biraz dinlen 😄']] },
];
const STORY_SPOTS = {
  rico: () => [24, 12],
  nina: () => { const [x, z] = garagePos(); return [x + 9, z - 3]; },
};
let storyRing = null, storyNpcs = {};
function buildStory() {
  storyRing = new THREE.Group();
  storyRing.add(new THREE.Mesh(new THREE.RingGeometry(2.4, 3, 40).rotateX(-Math.PI / 2).translate(0, 0.3, 0), new THREE.MeshBasicMaterial({ color: 0xb060ff, transparent: true, opacity: 0.85, depthWrite: false })));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, g => { g.fillStyle = 'rgba(40,10,60,0.8)'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#c080ff'; g.lineWidth = 6; g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 78px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('S', 64, 70); }) }));
  sp.scale.set(1.6, 1.6, 1); sp.position.y = 3.4; storyRing.add(sp); scene.add(storyRing);
  storyNpcs.rico = makeHuman({ skin: '#a8724a', shirt: '#f2efe6', pants: '#c9b48a', hair: '#101010', shoes: '#6a4a30', glasses: true });
  storyNpcs.nina = makeHuman({ skin: '#f1c7a5', shirt: '#2a4a7a', pants: '#2a2a30', hair: '#6a2a1a', shoes: '#222', longHair: true, cap: '#d04020' });
}
function storyGiverPos() { const ch = STORY[state.story]; return ch ? STORY_SPOTS[ch.giver]() : null; }
function updateStoryGiver(dt) {
  const ch = STORY[state.story], show = !!ch && !state.mission;
  storyRing.visible = show;
  for (const k in storyNpcs) storyNpcs[k].g.visible = false;
  if (!show) return;
  const [x, z] = storyGiverPos(), y = groundY(x, z), npc = storyNpcs[ch.giver];
  storyRing.position.set(x, y - 0.25, z); storyRing.children[1].position.y = 3.4 + Math.sin(state.now * 2) * 0.15;
  npc.g.visible = true; npc.g.position.set(x + 1.6, y, z);
  npc.g.rotation.y = Math.atan2(player.pos.x - x - 1.6, player.pos.z - z); animHuman(npc, 0, dt, false);
  if (!state.dead && Math.hypot(player.pos.x - x, player.pos.z - z) < 3) state.interact = state.inCar ? { label: 'Hikaye için araçtan in', fn: null } : { label: `📖 HİKAYE: ${ch.title}`, fn: startStory };
}
function startStory() {
  const k = state.story, ch = STORY[k]; if (!ch || state.mission) return;
  showDialog(ch.intro, () => {
    state.mission = { type: 'story', ch: k, si: -1, x: player.pos.x, z: player.pos.z, time: 9999, reward: ch.reward, tx: player.pos.x, tz: player.pos.z };
    showBig(`BÖLÜM ${k + 1}: ${ch.title.toUpperCase()}`, '#c080ff', 2.5, `Ödül $${ch.reward}`);
    nextStoryStage(state.mission);
  });
}
function nextStoryStage(m) {
  const ch = STORY[m.ch]; m.si++;
  if (m.si >= ch.stages.length) {
    markerGroup.visible = false;
    showDialog(ch.outro, () => { state.story = Math.max(state.story, m.ch + 1); missionEnd(true, `Bölüm ${m.ch + 1} tamamlandı`); if (m.ch === 5) setTimeout(() => showBig('1. PERDE TAMAMLANDI', '#c080ff', 4, '2. Perde: Kartel geliyor… Nina seni bekliyor'), 3200); if (state.story >= STORY.length) setTimeout(() => showBig('HİKAYE TAMAMLANDI', '#c080ff', 4, 'Vista Bay\'in efsanesi oldun!'), 3200); });
    return;
  }
  const st = ch.stages[m.si]; m.stage = st; m.wasWanted = state.wanted > 0;
  markerGroup.visible = false;
  if (st.kind === 'talk') { showDialog(st.lines, () => nextStoryStage(m)); return; }
  if (st.kind === 'interior') { [m.tx, m.tz] = INTERIORS[st.id].ext; setMarker(m.tx, m.tz, 'race'); }
  if (st.kind === 'goto') { [m.tx, m.tz] = st.pos(); setMarker(m.tx, m.tz, 'race'); }
  if (st.kind === 'destroy') {
    const cand = cars.filter(c => c.active && c.mode === 'ai' && !c.dead && !c.event && Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) > 110);
    m.target = cand.length ? pick(cand) : null;
    if (!m.target) { m.target = createCar('sport', '#1a1a1e', 0, 0, 0, 'ai'); placeOnRoad(m.target, 'near'); }
    m.target.health = m.target.maxHealth = 170; setMarker(0, 0, 'hit');
  }
  if (st.kind === 'boss') {
    const [x, z] = st.pos(); m.bossSt = spawnBossGroup(x, z, st.guards); setMarker(x, z, 'bounty');
  }
  floatText('📖 ' + st.text); AudioSys.pickup();
}
function spawnBossGroup(x, z, n) {
  if (!bountyNpcs.boss) {
    bountyNpcs.boss = npcPed({ skin: '#e0ac80', shirt: '#f2f2f2', pants: '#1a1a1e', hair: '#1a1210', shoes: '#101010', glasses: true }, 0, 0);
    for (let g = 0; g < 4; g++) bountyNpcs.guards.push(npcPed({ skin: pick(SKIN), shirt: '#16181c', pants: '#16181c', hair: '#101010', shoes: '#101010', glasses: true, gun: true }, 0, 0));
  }
  const place = (p, px, pz, role, hp) => { const r = collide(px, pz, 0.4, 0.5); Object.assign(p, { x: r.x, z: r.z, dead: false, npc: role, hp, shootT: MR(0.5, 1.5), yaw: Math.random() * 6 }); p.h.g.rotation.set(0, p.yaw, 0); p.h.g.visible = true; };
  place(bountyNpcs.boss, x, z, 'boss', 6);
  const guards = bountyNpcs.guards.slice(0, n);
  guards.forEach((g, i) => { const a = i / n * Math.PI * 2; place(g, x + Math.cos(a) * 3, z + Math.sin(a) * 3, 'guard', 3); });
  return { boss: bountyNpcs.boss, guards, alert: false };
}
function vehicleIs(c, what) { if (!c) return false; if (what === 'bus') return c.kind === 'bus'; if (what === 'boat') return !!c.spec.boat; if (what === 'heli') return !!c.spec.heli; return !c.spec.boat && !c.spec.heli; }
function updateStory(dt, m) {
  const ch = STORY[m.ch], st = m.stage, el = $('mission'), c = state.inCar;
  if (!st) return;
  if (state.dead) return missionEnd(false, 'Bayıldın · hikaye noktasından tekrar dene');
  let ok = false, extra = '';
  if (st.kind === 'getin') { ok = vehicleIs(c, st.what); m.tx = player.pos.x; m.tz = player.pos.z; }
  else if (st.kind === 'goto') {
    const d = Math.hypot(player.pos.x - m.tx, player.pos.z - m.tz); extra = ` · ${Math.round(d)} m`;
    const needOk = !st.need || vehicleIs(c, st.need);
    if (st.need && !needOk) extra += st.need === 'boat' ? ' · tekne gerekli' : st.need === 'heli' ? ' · helikopter gerekli' : ' · araç gerekli';
    const altOk = !st.alt || (c && Math.abs(c.y - st.alt()) < 1.6 && c.spec.heli && Math.abs(c.vy) < 2);
    ok = d < st.r && needOk && altOk;
  }
  else if (st.kind === 'interior') { ok = state.interior === st.id; const e = INTERIORS[st.id].ext; m.tx = e[0]; m.tz = e[1]; extra = ` · ${Math.round(Math.hypot(player.pos.x - m.tx, player.pos.z - m.tz))} m`; }
  else if (st.kind === 'wanted') { ok = state.wanted >= st.n; extra = ` · ${'★'.repeat(state.wanted)}${'☆'.repeat(Math.max(0, st.n - state.wanted))}`; m.tx = player.pos.x; m.tz = player.pos.z; }
  else if (st.kind === 'lose') { ok = state.wanted === 0; extra = ` · ${'★'.repeat(state.wanted)}`; m.tx = player.pos.x; m.tz = player.pos.z; }
  else if (st.kind === 'destroy') {
    const t = m.target; if (!t.active) return missionEnd(false, 'Hedef kaçtı');
    m.tx = t.group.position.x; m.tz = t.group.position.z; markerGroup.position.set(m.tx, t.y, m.tz);
    extra = ` · ${Math.round(Math.hypot(player.pos.x - m.tx, player.pos.z - m.tz))} m`; ok = t.dead;
    if (t.ai && Math.hypot(player.pos.x - m.tx, player.pos.z - m.tz) < 40) t.ai.panic = 3;
  }
  else if (st.kind === 'boss') {
    const b = m.bossSt; updateBounty(dt, b);
    m.tx = b.boss.x; m.tz = b.boss.z; markerGroup.position.set(m.tx, 0, m.tz);
    extra = ` · 🛡 ${b.guards.filter(g => !g.dead).length}/${b.guards.length} · ${Math.round(Math.hypot(player.pos.x - m.tx, player.pos.z - m.tz))} m`; ok = b.boss.dead;
  }
  el.textContent = `📖 ${ch.title}: ${st.text}${extra} · 💵 $${m.reward}`;
  if (ok) nextStoryStage(m);
}

// ============================================================ CLOTHING STORE
const DEFAULT_LOOK = { skin: '#c58c60', shirt: '#e8e4da', pants: '#3a4a5e', hair: '#1a1210', shoes: '#f2f2f2', glasses: true, cap: null, shorts: false, longHair: false };
const SHIRTS = [['Beyaz', '#f0eee8'], ['Siyah', '#18181c'], ['Kırmızı', '#b0202a'], ['Lacivert', '#1e2e5a'], ['Hawaii Mavisi', '#2a9ab8'], ['Mercan', '#f07060'], ['Haki', '#7a7a50'], ['Pembe', '#f0a0c0']];
const PANTSC = [['Kot', '#3a4a6e'], ['Siyah', '#16161a'], ['Bej', '#c9b48a'], ['Beyaz', '#e8e8e8'], ['Gri', '#6a6a70'], ['Kahve', '#5a3a26']];
const HAIRC = [['Siyah', '#101010'], ['Kahve', '#3a2416'], ['Kumral', '#8a6a3a'], ['Sarı', '#d8c088'], ['Kızıl', '#8a2a1a']];
function buildClothesShop() { const b = blocks[2][3]; makeZone('clothes', b.cx, b.cz + BLOCK / 2 - 4, 'VISTA MODA', '👕', '#2a0a2a', '#ff7ae0', 0xff5fd0, { glow: true, label: 'MAĞAZAYA GİR' }); }
function applyLook() {
  const old = player.human, nh = makeHuman({ ...state.look, gun: true });
  nh.g.position.copy(old.g.position); nh.g.rotation.copy(old.g.rotation); nh.g.visible = old.g.visible;
  if (old.g.parent && old.g.parent !== scene) old.g.parent.add(nh.g);
  old.g.parent && old.g.parent.remove(old.g); player.human = nh;
  if (MP.on) mpSend({ t: 'info', info: myInfo() });
}
function clothesItems() {
  const L = state.look, it = [{ sec: 'Gömlek / Tişört' }];
  const sw = (n, hex) => `<i class="sw" style="background:${hex}"></i>${n}`;
  for (const [n, hex] of SHIRTS) it.push({ name: sw(n, hex), desc: 'Üst', price: 120, dis: L.shirt === hex ? 'GİYİLİ' : null, buy: () => { L.shirt = hex; applyLook(); } });
  it.push({ sec: 'Alt' });
  for (const [n, hex] of PANTSC) it.push({ name: sw(n, hex), desc: L.shorts ? 'Şort' : 'Pantolon', price: 120, dis: L.pants === hex ? 'GİYİLİ' : null, buy: () => { L.pants = hex; applyLook(); } });
  it.push({ name: L.shorts ? '👖 Uzun pantolon' : '🩳 Şort', desc: 'Kesim değiştir', price: 90, buy: () => { L.shorts = !L.shorts; applyLook(); } });
  it.push({ sec: 'Aksesuar' });
  it.push({ name: '🧢 Şapkasız', desc: 'Şapkayı çıkar', price: 0, btn: 'ÇIKAR', dis: !L.cap ? 'GİYİLİ' : null, buy: () => { L.cap = null; applyLook(); } });
  for (const [n, hex] of [['Kırmızı', '#c82020'], ['Lacivert', '#1a2a4a'], ['Beyaz', '#f2f2f2'], ['Yeşil', '#2a6a3a']]) it.push({ name: sw('Şapka · ' + n, hex), desc: 'Beyzbol şapkası', price: 80, dis: L.cap === hex ? 'GİYİLİ' : null, buy: () => { L.cap = hex; applyLook(); } });
  it.push({ name: L.glasses ? '🕶 Gözlüğü çıkar' : '🕶 Güneş gözlüğü', desc: 'Aksesuar', price: L.glasses ? 0 : 60, btn: 'ÇIKAR', buy: () => { L.glasses = !L.glasses; applyLook(); } });
  it.push({ sec: 'Sırt çantası' });
  it.push({ name: '🎒 Çantasız', desc: 'Çantayı çıkar', price: 0, btn: 'ÇIKAR', dis: !L.backpack ? 'GİYİLİ' : null, buy: () => { L.backpack = null; applyLook(); } });
  for (const [n, hex] of [['Siyah', '#1a1a1e'], ['Kırmızı', '#b0202a'], ['Kamuflaj', '#5a6a3a'], ['Turuncu', '#e07020']]) it.push({ name: sw('Çanta · ' + n, hex), desc: 'Online herkese görünür', price: 150, dis: L.backpack === hex ? 'GİYİLİ' : null, buy: () => { L.backpack = hex; applyLook(); } });
  it.push({ sec: 'Kuaför' });
  for (const [n, hex] of HAIRC) it.push({ name: sw('Saç · ' + n, hex), desc: 'Saç rengi', price: 50, dis: L.hair === hex ? 'MEVCUT' : null, buy: () => { L.hair = hex; applyLook(); } });
  it.push({ name: L.longHair ? '💇 Kısa saç' : '💇 Uzun saç', desc: 'Saç kesimi', price: 50, buy: () => { L.longHair = !L.longHair; applyLook(); } });
  return it;
}

// ============================================================ PHOTO MODE
function startPhoto() {
  closePhone();
  state.photo = { dist: Math.max(4, camDist), yaw: camYaw, pitch: camPitch, shot: false };
  document.body.classList.add('photo'); if (isTouch) $('touch').style.display = 'block';
}
function endPhoto() { state.photo = null; document.body.classList.remove('photo'); }
function updatePhoto(dt) {
  readInput();
  const ph = state.photo;
  ph.yaw -= input.lookDX * settings.sens; ph.pitch = clamp(ph.pitch + input.lookDY * settings.sens, -0.35, 1.45); input.lookDX = input.lookDY = 0;
  ph.dist = clamp(ph.dist - input.my * dt * 8, 1.6, 40);
  const t = state.inCar ? state.inCar.group.position : player.pos, ty = t.y + (state.inCar ? 1.2 : 1.3), cp = Math.cos(ph.pitch);
  camera.position.set(t.x + Math.sin(ph.yaw) * cp * ph.dist, Math.max(groundY(t.x, t.z) + 0.3, ty + Math.sin(ph.pitch) * ph.dist), t.z + Math.cos(ph.yaw) * cp * ph.dist);
  camera.lookAt(t.x, ty, t.z);
  if (composer) composer.render(); else renderer.render(scene, camera);
  if (ph.shot) {
    ph.shot = false;
    try {
      const url = renderer.domElement.toDataURL('image/jpeg', 0.92), a = document.createElement('a');
      a.href = url; a.download = `vistabay-${Date.now()}.jpg`; document.body.appendChild(a); a.click(); a.remove();
      const f = $('fade'); f.style.transition = 'none'; f.style.background = '#fff'; f.style.opacity = 0.8; AudioSys.burst(0.08, 4000, 0.4, 'highpass');
      requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; setTimeout(() => f.style.background = '#000', 600); });
      floatText('📸 Fotoğraf kaydedildi');
    } catch (e) { floatText('Fotoğraf kaydedilemedi'); }
  }
}
function initExtrasUI() {
  $('dialog').addEventListener('click', e => { e.preventDefault(); advanceDialog(); });
  $('dialog').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); advanceDialog(); }, { passive: false });
  const tapBtn = (id, fn) => { const el = $(id); el.addEventListener('click', e => { e.stopPropagation(); fn(); }); el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false }); };
  tapBtn('phShot', () => { if (state.photo) state.photo.shot = true; });
  tapBtn('phExit', endPhoto);
}

// ============================================================ CITY BUS + BUS STOPS
CAR_SPECS.bus = { W: 2.5, cabW: 2.6, wr: 0.5, wx: 3.7, max: 24, acc: 7, co: 3.9, cr: 1.35, bus: true,
  body: [[-5.5, 0.5], [5.4, 0.5], [5.52, 1.0], [5.45, 2.95], [5.2, 3.15], [-5.3, 3.15], [-5.48, 2.95], [-5.55, 1.0]],
  cab: [[5.28, 1.55], [5.2, 2.8], [-5.28, 2.8], [-5.36, 1.55]] };
const BUS_STOPS = [];
function buildBusStops() {
  const glass = new THREE.MeshStandardMaterial({ color: 0x9ec4d8, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.3, depthWrite: false });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a3a5a, metalness: 0.6, roughness: 0.4 });
  const signTex = canvasTex(128, 64, g => { g.fillStyle = '#1e5ab4'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#fff'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🚌 DURAK', 64, 34); });
  const signM = new THREE.MeshBasicMaterial({ map: signTex });
  for (const [bi, bj] of [[1, 4], [4, 1], [6, 6], [3, 0]]) {
    const b = blocks[bi][bj], x = b.cx + 20, z = b.cz + BLOCK / 2 - 1.7;
    const g = new THREE.Group(); g.position.set(x, 0.25, z);
    g.add(new THREE.Mesh(merge([new THREE.BoxGeometry(4.4, 0.1, 1.8).translate(0, 2.5, 0), ...[[-2.1, -0.8], [2.1, -0.8], [-2.1, 0.8], [2.1, 0.8]].map(([px, pz]) => new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6).translate(px, 1.25, pz)), new THREE.BoxGeometry(3.8, 0.08, 0.45).translate(0, 0.5, -0.55)]), frame));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 0.04).translate(0, 1.35, -0.85), glass));
    const sg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.06), signM); sg.position.set(2.5, 2.4, 0.8); g.add(sg);
    g.children.forEach(m => m.castShadow = true); scene.add(g);
    BUS_STOPS.push({ x, z, roadZ: nodeP(bj + 1) - ROAD / 2 + 2.6 });
  }
}
function spawnBuses() {
  for (let k = 0; k < (QUALITY === 'low' ? 1 : 2); k++) { const c = createCar('bus', '#e9edf2', 0, 0, 0, 'ai'); placeOnRoad(c, true); c.ai.cruise = 9; c.ai.lane = 6.6; }
  const s = BUS_STOPS[0]; createCar('bus', '#e9edf2', s.x - 9, s.roadZ, Math.PI / 2, 'free').driver = false;
}

// ============================================================ INTERIORS (night club, villa)
const INTERIORS = {
  club: { name: 'Gece Kulübü', x0: -2614, x1: -2586, z0: -2611, z1: -2589, h: 6, spawn: [-2600, -2592.8, Math.PI], exitAt: [-2600, -2590.2], boxes: [], ext: null },
  house: { name: 'Lüks Villa', x0: -2559, x1: -2541, z0: -2607, z1: -2593, h: 3.4, spawn: [-2550, -2595.6, Math.PI], exitAt: [-2550, -2593.6], boxes: [], ext: null },
};
let interiorLight = null, danceTiles = null, clubDancers = [];
function buildInteriors() {
  interiorLight = new THREE.PointLight(0xffffff, 0, 40, 1.4); scene.add(interiorLight);
  const box = (I, x, y, z, w, h, d, mat, solid = true) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.04, w / 2.1, h / 2.1, d / 2.1)), mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m); if (solid) I.boxes.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }); return m; };
  const shell = (I, wallM, floorM, ceilM) => {
    const cx = (I.x0 + I.x1) / 2, cz = (I.z0 + I.z1) / 2, w = I.x1 - I.x0, d = I.z1 - I.z0, t = 0.3;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), floorM); fl.position.set(cx, 0.0, cz); fl.receiveShadow = true; scene.add(fl);
    const ce = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * t, 0.2, d + 2 * t), ceilM); ce.position.set(cx, I.h + 0.1, cz); ce.castShadow = true; scene.add(ce);
    for (const [x, z, ww, dd] of [[cx, I.z0 - t / 2, w + 2 * t, t], [cx, I.z1 + t / 2, w + 2 * t, t], [I.x0 - t / 2, cz, t, d], [I.x1 + t / 2, cz, t, d]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(ww, I.h + 0.2, dd), wallM); m.position.set(x, I.h / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m); }
    // exit door
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.08), new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.6 })); door.position.set(I.exitAt[0], 1.2, I.z1 - 0.02); scene.add(door);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x40e080, transparent: true, opacity: 0.85, depthWrite: false })); ring.position.set(I.exitAt[0], 0.03, I.exitAt[1] - 0.6); scene.add(ring);
  };
  // ---- CLUB
  {
    const I = INTERIORS.club;
    shell(I, new THREE.MeshStandardMaterial({ color: 0x1a1020, roughness: 0.85 }), new THREE.MeshStandardMaterial({ color: 0x141016, roughness: 0.35, metalness: 0.3 }), new THREE.MeshStandardMaterial({ color: 0x0a080c }));
    // dance floor (animated tiles)
    const tileGeo = new THREE.BoxGeometry(1.5, 0.06, 1.5);
    danceTiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 36);
    let k = 0; const m4l = new THREE.Matrix4();
    for (let a = 0; a < 6; a++) for (let c = 0; c < 6; c++) { m4l.makeTranslation(-2600 - 4.5 + a * 1.6 + 0.4, 0.06, -2601 - 4 + c * 1.6); danceTiles.setMatrixAt(k, m4l); danceTiles.setColorAt(k++, new THREE.Color(1, 1, 1)); }
    scene.add(danceTiles);
    // bar + bottles
    const barM = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.4, metalness: 0.2 });
    box(I, -2611.5, 0, -2601, 1.2, 1.15, 12, barM);
    box(I, -2613.6, 0, -2601, 0.5, 2.6, 12, new THREE.MeshStandardMaterial({ color: 0x20161a }));
    const bottles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.32, 8), new THREE.MeshBasicMaterial(), 30);
    for (let i = 0; i < 30; i++) { m4l.makeTranslation(-2613.3, 1.3 + (i % 3) * 0.55, -2606.5 + Math.floor(i / 3) * 1.15); bottles.setMatrixAt(i, m4l); bottles.setColorAt(i, new THREE.Color().setHSL(Math.random(), 0.8, 0.55).multiplyScalar(1.6)); }
    scene.add(bottles);
    // DJ booth
    box(I, -2600, 0, -2609.4, 5, 1.2, 1.6, new THREE.MeshStandardMaterial({ color: 0x101014, metalness: 0.6, roughness: 0.3 }));
    const djGlow = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 0.04), new THREE.MeshBasicMaterial({ color: 0x40e0ff })); djGlow.position.set(-2600, 0.9, -2608.58); scene.add(djGlow); I.djGlow = djGlow;
    // neon strips along walls
    I.neon = [];
    for (const [x, z, w, d, col] of [[-2600, -2610.8, 27, 0.08, 0xff2a8a], [-2613.8, -2600, 0.08, 21, 0x2ad8ff], [-2586.2, -2600, 0.08, 21, 0xb050ff]]) { const n = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), new THREE.MeshBasicMaterial({ color: col })); n.position.set(x, 4.8, z); scene.add(n); I.neon.push(n); }
    // sofas / tables
    const sofaM = new THREE.MeshStandardMaterial({ color: 0x5a1a3a, roughness: 0.7 });
    for (const z of [-2606, -2600, -2594]) { box(I, -2588.2, 0, z, 1.2, 0.8, 3, sofaM); box(I, -2589.9, 0, z, 0.7, 0.7, 0.7, new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.5 })); }
    // dancers
    for (let i = 0; i < 9; i++) { const h = makeHuman(randLook()); h.base = [-2600 - 4 + (i % 3) * 3.2 + MR(-0.6, 0.6), -2604.5 + Math.floor(i / 3) * 3 + MR(-0.6, 0.6)]; h.g.position.set(h.base[0], 0.05, h.base[1]); h.g.rotation.y = Math.random() * 6; h.dt = Math.random() * 5; h.g.visible = false; clubDancers.push(h); }
  }
  // ---- HOUSE
  {
    const I = INTERIORS.house;
    const wood = new THREE.MeshStandardMaterial({ map: noiseTex('#8a6240', ['#7a5434', '#9a7048', '#6e4a2c'], 256, 4000, 1, 10), roughness: 0.55 });
    shell(I, new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.9 }), wood, new THREE.MeshStandardMaterial({ color: 0xf6f2ea }));
    const fab = new THREE.MeshStandardMaterial({ color: 0x3a5a7a, roughness: 0.9 });
    box(I, -2554, 0, -2604.8, 4, 0.45, 1.2, fab); box(I, -2554, 0.45, -2605.25, 4, 0.5, 0.3, fab);          // sofa
    box(I, -2554, 0, -2602.4, 1.8, 0.4, 0.9, new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.4 })); // coffee table
    const rug = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.02, 3.2), new THREE.MeshStandardMaterial({ color: 0xb08a6a, roughness: 1 })); rug.position.set(-2554, 0.065, -2603); scene.add(rug);
    box(I, -2554, 0, -2599.6, 2.4, 0.6, 0.5, new THREE.MeshStandardMaterial({ color: 0x1a1a1c }));                // TV stand
    const tv = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 0.06), new THREE.MeshBasicMaterial({ color: 0x2a6ab8 })); tv.position.set(-2554, 1.35, -2599.55); scene.add(tv); I.tv = tv;
    box(I, -2545, 0, -2605, 2.2, 0.55, 3, new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.9 }));    // bed
    box(I, -2545, 0.55, -2606.1, 2, 0.18, 0.6, new THREE.MeshStandardMaterial({ color: 0xffffff }), false);          // pillow
    box(I, -2545, 0.5, -2604.2, 2.25, 0.12, 1.4, new THREE.MeshStandardMaterial({ color: 0x8a3a3a }), false);        // blanket
    box(I, -2542.2, 0, -2598, 0.9, 0.95, 4, new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.3 }));  // kitchen counter
    box(I, -2542.3, 0, -2595.2, 0.9, 2, 0.9, new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.3 })); // fridge
    box(I, -2558.2, 0, -2596, 0.7, 2.1, 1.6, new THREE.MeshStandardMaterial({ color: 0x5a3a26 }));                  // wardrobe
    const pot = box(I, -2557.8, 0, -2606.2, 0.5, 0.5, 0.5, new THREE.MeshStandardMaterial({ color: 0xb05a3a })); const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshStandardMaterial({ color: 0x3a7a3a })); leaf.position.set(-2557.8, 1.1, -2606.2); scene.add(leaf);
    I.bed = [-2545, -2603.2]; I.wardrobe = [-2557.4, -2596];
  }
  // exterior entrances
  { const b = blocks[4][2]; INTERIORS.club.ext = [b.cx - 6, b.cz + BLOCK / 2 - 2.2]; }
  { const b = blocks[0][3]; INTERIORS.house.ext = [b.cx - 6, b.cz + BLOCK / 2 - 2.2]; }
  for (const id in INTERIORS) {
    const I = INTERIORS[id], [x, z] = I.ext, y = groundY(x, z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 36).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: id === 'club' ? 0xff4fd0 : 0x40e080, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.position.set(x, y + 0.04, z); scene.add(ring);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, g => { g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.font = '68px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(id === 'club' ? '🚪' : '🏠', 64, 70); }) }));
    sp.scale.set(1.2, 1.2, 1); sp.position.set(x, y + 2.6, z); scene.add(sp); I.extSprite = sp;
  }
}
function interiorCollide(x, z, r, y = 0) {
  const I = INTERIORS[state.interior];
  x = clamp(x, I.x0 + r, I.x1 - r); z = clamp(z, I.z0 + r, I.z1 - r);
  for (const b of I.boxes) {
    if (b.y1 !== undefined && (y + 1.7 < b.y0 || y > b.y1 - 0.1)) continue;
    const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1), dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) { if (d2 > 1e-8) { const d = Math.sqrt(d2); x = cx + dx / d * r; z = cz + dz / d * r; } else { const l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bb = b.z1 - z, m = Math.min(l, rr, t, bb); if (m === l) x = b.x0 - r; else if (m === rr) x = b.x1 + r; else if (m === t) z = b.z0 - r; else z = b.z1 + r; } }
  }
  return { x, z, hit: false, nx: 0, nz: 0 };
}
function enterInterior(id) {
  const I = INTERIORS[id];
  if (id === 'house' && !state.props.villa) { floatText('🏠 Önce Lüks Villa\'yı satın al'); return; }
  const f = $('fade'); f.style.opacity = 1;
  setTimeout(() => {
    state.interior = id; player.pos.set(I.spawn[0], 0, I.spawn[1]); player.yaw = I.spawn[2]; camYaw = player.yaw + Math.PI; camDist = 3;
    if (id === 'club') { for (const h of clubDancers) h.g.visible = true; interiorLight.position.set(-2600, 5, -2601); }
    else interiorLight.position.set(-2550, 3, -2600);
    interiorLight.intensity = id === 'club' ? 180 : 30;
    f.style.opacity = 0; floatText(`🚪 ${I.name}`);
  }, 350);
}
function exitInterior() {
  const I = INTERIORS[state.interior], f = $('fade'); f.style.opacity = 1;
  setTimeout(() => {
    state.interior = null; interiorLight.intensity = 0; for (const h of clubDancers) h.g.visible = false;
    if (I.extOut) { const [x, z, yaw] = I.extOut; player.pos.set(x, groundY(x, z), z); player.yaw = yaw; camYaw = yaw + Math.PI; } else { const [x, z] = I.ext; player.pos.set(x, groundY(x, z), z + 2.4); player.yaw = 0; camYaw = Math.PI; }
    if (I.gen) disposeGen(); f.style.opacity = 0;
  }, 350);
}
function updateInteriors(dt) {
  if (!state.interior) {
    for (const id in INTERIORS) {
      const I = INTERIORS[id]; if (!I.extSprite) continue; const [x, z] = I.ext; I.extSprite.position.y = groundY(x, z) + 2.6 + Math.sin(state.now * 2.5) * 0.12;
      if (!state.dead && !state.mission?.boss && Math.hypot(player.pos.x - x, player.pos.z - z) < 1.6) state.interact = state.inCar ? { label: 'İçeri girmek için araçtan in', fn: null } : { label: id === 'club' ? '🚪 KULÜBE GİR' : (state.props.villa ? '🏠 EVE GİR' : '🏠 Villa satın alınınca açılır'), fn: id === 'house' && !state.props.villa ? null : () => enterInterior(id) };
    }
    return;
  }
  const I = INTERIORS[state.interior], t = state.now;
  if (player.pos.y < 1.5 && Math.hypot(player.pos.x - I.exitAt[0], player.pos.z - (I.exitAt[1] - 0.6)) < 1.1) state.interact = { label: '🚪 DIŞARI ÇIK', fn: exitInterior };
  if (state.interior === 'gen') updateGenInterior(dt);
  if (state.interior === 'club') {
    if (Math.floor(t * 4) !== I.lastBeat) { I.lastBeat = Math.floor(t * 4); for (let k = 0; k < 36; k++) danceTiles.setColorAt(k, tmpC.setHSL((k * 0.11 + t * 0.3) % 1, 0.9, Math.random() < 0.5 ? 0.6 : 0.15).multiplyScalar(1.4)); danceTiles.instanceColor.needsUpdate = true; }
    interiorLight.color.setHSL((t * 0.15) % 1, 0.8, 0.6); interiorLight.intensity = 140 + Math.sin(t * 8) * 60;
    I.djGlow.material.color.setHSL((t * 0.4) % 1, 1, 0.55);
    for (const h of clubDancers) { h.dt += dt; animHuman(h, 0, dt, false); applyEmote(h, 'dance', h.dt); h.g.rotation.y += dt * 0.6; }
  } else if (state.interior === 'house') {
    I.tv.material.color.setHSL(0.58 + Math.sin(t * 0.7) * 0.05, 0.6, 0.35 + Math.sin(t * 3.1) * 0.08);
    if (Math.hypot(player.pos.x - I.bed[0], player.pos.z - I.bed[1]) < 2) state.interact = { label: '🛏 UYU & KAYDET', fn: () => { state.health = 100; state.armor = Math.max(state.armor, 50); state.time = (state.time + 8) % 24; state.lastHour = Math.floor(state.time); saveGame(); showBig('İYİ UYUDUN', '#7dff9a', 2.5, '8 saat geçti · can doldu · oyun kaydedildi'); } };
    if (Math.hypot(player.pos.x - I.wardrobe[0], player.pos.z - I.wardrobe[1]) < 1.8) state.interact = { label: '👕 GARDIROP', fn: () => openShop('clothes') };
  }
}

// ============================================================ MULTIPLAYER (PeerJS / WebRTC, host-relay star topology)
// Host peer id = 'vistabay-<code>'. Clients connect only to the host; the host relays every packet to the others.
// Messages: hello/welcome/join/leave (lobby), st (20 Hz state), shot/fx (combat FX), chat/emote, world (time + weather).
const MP = { on: false, host: false, peer: null, conns: new Map(), fast: new Map(), peerPid: new Map(), fastConn: null, heistT: 210, hostConn: null, myId: null, code: null, pub: false, nextId: 0, remotes: new Map(), acc: 0, worldT: 0, chatT: -99, name: '', color: '#e8443a', costume: 0 };
const MP_PREFIX = 'vistabay-', MP_MAX = 8, MP_TICK = 0.05, MP_DELAY = 0.12, MP_PUB = 5;
const MP_COLORS = ['#e8443a', '#2e86de', '#20bf6b', '#f7b731', '#8854d0', '#fd79a8', '#00cec9', '#f0f0f0'];
const MP_COSTUMES = [{ name: 'Sokak', cap: null, glasses: true, shorts: false }, { name: 'Sahil', cap: null, glasses: true, shorts: true }, { name: 'Şapkalı', cap: '#1a1a1e', glasses: false, shorts: false }, { name: 'Patron', cap: '#d4a017', glasses: true, shorts: false }];
const QUICK_MSGS = ['Selam! 👋', 'Arabama bin! 🚗', 'Yarışalım mı? 🏁', 'Polisler peşimde! 🚨', 'Beni takip et! 👉', 'Yardım lazım! 🆘', 'Harika! 😎', 'GG 🏆'];
const EMOTES = [['wave', '👋', 'El salla'], ['dance', '💃', 'Dans'], ['cheer', '🙌', 'Sevin'], ['honk', '📯', 'Korna']];
const mpNow = () => performance.now() / 1000;

function loadPeerJS() {
  return new Promise((res, rej) => {
    if (window.Peer) return res();
    const add = (src, next) => { const s = document.createElement('script'); s.src = src; s.onload = () => window.Peer ? res() : next(); s.onerror = next; document.head.appendChild(s); };
    add('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', () => add('lib/peerjs.min.js', () => rej(new Error('PeerJS yüklenemedi'))));
  });
}
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const o = { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } };
  if (q.get('peerhost')) { o.host = q.get('peerhost'); o.port = +(q.get('peerport') || 9000); o.path = q.get('peerpath') || '/'; o.secure = q.get('peersecure') === '1'; }
  return o;
}
function newPeer(id) {
  return new Promise((res, rej) => {
    const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    let done = false;
    const to = setTimeout(() => { if (done) return; done = true; try { p.destroy(); } catch (e) { } rej(Object.assign(new Error('Sunucuya ulaşılamadı'), { type: 'timeout' })); }, 10000);
    p.on('open', () => { if (done) return; done = true; clearTimeout(to); res(p); });
    p.on('error', e => { if (done) return; done = true; clearTimeout(to); try { p.destroy(); } catch (x) { } rej(e); });
  });
}
function myInfo() { return { name: MP.name, color: MP.color, look: state.look }; }
// ---------------- hosting
async function mpHost(fixedId, pub) {
  let peer = null, code = null;
  for (let k = 0; k < 6 && !peer; k++) {
    code = fixedId || String(1000 + Math.floor(Math.random() * 9000));
    try { peer = await newPeer(MP_PREFIX + code); } catch (e) { if (e.type === 'unavailable-id' && !fixedId) continue; throw e; }
  }
  if (!peer) throw new Error('Oda kurulamadı');
  Object.assign(MP, { peer, code, host: true, on: true, myId: 'h', pub: !!pub });
  peer.on('connection', onHostConn);
  peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { } });
  peer.on('error', e => console.warn('peer', e.type));
}
function onHostConn(conn) {
  if (conn.label === 'fast') { // unreliable side-channel (position packets) of an already joined player
    const pidOf = () => MP.peerPid.get(conn.peer);
    conn.on('open', () => { const pid = pidOf(); if (pid) MP.fast.set(pid, conn); });
    conn.on('data', d => { const pid = pidOf(); if (pid) hostRecv(pid, d); });
    conn.on('close', () => { const pid = pidOf(); if (pid && MP.fast.get(pid) === conn) MP.fast.delete(pid); });
    conn.on('error', () => { });
    return;
  }
  const id = 'p' + (++MP.nextId);
  conn.on('open', () => {
    if (MP.conns.size >= MP_MAX - 1) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 400); return; }
    conn.pid = id; MP.conns.set(id, conn); MP.peerPid.set(conn.peer, id);
  });
  conn.on('data', d => { if (conn.pid) hostRecv(id, d); });
  conn.on('close', () => dropPlayer(id));
  conn.on('error', () => dropPlayer(id));
}
function hostRecv(id, d) {
  if (!d || !d.t || !scene) return;
  if (d.t === 'hello') {
    const r = ensureRemote(id, d.info);
    const players = [{ id: 'h', info: myInfo() }]; for (const [rid, rr] of MP.remotes) if (rid !== id) players.push({ id: rid, info: rr.info });
    MP.conns.get(id).send({ t: 'welcome', id, players, time: state.time, weather: state.weather, code: MP.code, ...worldManifest() });
    mpBroadcast({ t: 'join', id, info: r.info }, id);
    mpFeed(`🟢 ${r.info.name} katıldı`); AudioSys.tone(880, 0.12, 0.12, 'sine');
    return;
  }
  d.id = id;
  if (d.to) { if (d.to === 'h') applyPacket(d); else mpSendTo(d.to, d); return; }   // private message, routed by the host
  applyPacket(d);
  mpBroadcast(d, id);
}
function dropPlayer(id) {
  if (!MP.conns.has(id) && !MP.remotes.has(id)) return;
  const c = MP.conns.get(id); MP.conns.delete(id);
  const f = MP.fast.get(id); MP.fast.delete(id); try { f && f.close(); } catch (e) { }
  if (c) MP.peerPid.delete(c.peer);
  if (MP.host) releaseClaimsOf(id);
  const r = MP.remotes.get(id); if (r) mpFeed(`🔴 ${r.info.name} ayrıldı`);
  removeRemote(id);
  if (MP.host) mpBroadcast({ t: 'leave', id });
}
function mpBroadcast(msg, except) { for (const [id, c] of MP.conns) if (id !== except) mpSendTo(id, msg); }
function mpSendTo(id, msg) {
  const f = MP.fast.get(id), c = (msg.t === 'st' || msg.t === 'wt' || msg.t === 'wp') && f && f.open ? f : MP.conns.get(id);
  if (c && c.open) { try { c.send(msg); } catch (e) { } }
}
// ---------------- joining
function connectTo(peer, targetId, timeout = 12000) {
  return new Promise((res, rej) => {
    let done = false;
    const conn = peer.connect(MP_PREFIX + targetId, { reliable: true, serialization: 'json' });
    const fail = msg => { if (done) return; done = true; clearTimeout(to); peer.off('error', onErr); try { conn.close(); } catch (e) { } rej(new Error(msg)); };
    const onErr = e => { if (e.type === 'peer-unavailable') fail('Oda bulunamadı'); };
    const to = setTimeout(() => fail('Oda yanıt vermedi'), timeout);
    peer.on('error', onErr);
    conn.on('open', () => { if (done) return; done = true; clearTimeout(to); peer.off('error', onErr); res(conn); });
  });
}
async function mpJoin(code) {
  const peer = MP.peer && !MP.peer.destroyed ? MP.peer : await newPeer();
  MP.peer = peer;
  const conn = await connectTo(peer, code);
  attachClient(conn, code);
}
function attachClient(conn, code) {
  Object.assign(MP, { hostConn: conn, on: true, host: false, code, pub: String(code).startsWith('pub') });
  conn.on('data', clientRecv);
  conn.on('close', () => mpLost('Oda sahibi ayrıldı'));
  conn.on('error', () => mpLost('Bağlantı hatası'));   // 'hello' is sent from mpAfterStart() once the world is built
  // second, unreliable/unordered data channel for 20 Hz state packets (no head-of-line blocking on packet loss)
  try { const f = MP.peer.connect(MP_PREFIX + code, { label: 'fast', reliable: false, serialization: 'json' }); f.on('open', () => { MP.fastConn = f; }); f.on('data', clientRecv); f.on('close', () => { if (MP.fastConn === f) MP.fastConn = null; }); f.on('error', () => { }); } catch (e) { }
}
async function mpQuickJoin(status) {
  const peer = await newPeer(); MP.peer = peer;
  for (let k = 1; k <= MP_PUB; k++) {
    status(`Açık odalar aranıyor… (${k}/${MP_PUB})`);
    try { const conn = await connectTo(peer, 'pub-' + k, 5000); attachClient(conn, 'pub-' + k); return 'joined'; } catch (e) { }
  }
  try { peer.destroy(); } catch (e) { } MP.peer = null;
  for (let k = 1; k <= MP_PUB; k++) {
    status('Açık oda yok, yeni bir genel oda kuruluyor…');
    try { await mpHost('pub-' + k, true); return 'hosted'; } catch (e) { if (e.type !== 'unavailable-id') throw e; }
  }
  throw new Error('Tüm genel odalar dolu');
}
function clientRecv(d) {
  if (!d || !d.t) return;
  if (d.t === 'welcome') {
    MP.myId = d.id; for (const p of d.players) ensureRemote(p.id, p.info);
    rebuildWorldFromHost(d); sendScore();
    applyWorld(d); mpFeed(`🌐 Odaya katıldın · ${d.players.length + 1} oyuncu`); return;
  }
  if (d.t === 'join') { ensureRemote(d.id, d.info); mpFeed(`🟢 ${d.info.name} katıldı`); AudioSys.tone(880, 0.12, 0.12, 'sine'); return; }
  if (d.t === 'leave') { const r = MP.remotes.get(d.id); if (r) mpFeed(`🔴 ${r.info.name} ayrıldı`); removeRemote(d.id); return; }
  if (d.t === 'world') { applyWorld(d); return; }
  if (d.t === 'full') { mpLost('Oda dolu (8/8)'); return; }
  applyPacket(d);
}
function applyWorld(d) {
  if (typeof d.time === 'number' && Math.abs(wrapA((d.time - state.time) / 24 * Math.PI * 2)) > 0.03) state.time = d.time;
  if (d.weather && d.weather !== state.weather && WEATHERS[d.weather]) setWeather(d.weather, false);
}
function mpSend(msg) {
  if (!MP.on) return;
  if (MP.host) {
    if (!msg.id) msg.id = 'h';            // FIX: host's own packets must carry its id, otherwise clients drop them
    if (msg.to) mpSendTo(msg.to, msg); else mpBroadcast(msg);
    return;
  }
  const c = msg.t === 'st' && MP.fastConn && MP.fastConn.open ? MP.fastConn : MP.hostConn;
  if (c && c.open) { try { c.send(msg); } catch (e) { } }
}
function mpLost(reason) {
  if (!MP.on) return;
  showBig('BAĞLANTI KOPTU', '#ff5050', 3, reason + ' · tek oyunculu devam ediyorsun');
  mpLeave(true);
}
function mpLeave(silent) {
  if (NW.client) { for (const c of WORLD_CARS) if (c.mode === 'net') { c.mode = 'free'; c.driver = false; c.active = true; c.group.visible = true; c.vx = c.vz = 0; } for (const p of WORLD_PEDS) { p.net = null; } NW.client = false; }
  if (state.passenger) exitPassenger();
  for (const id of [...MP.remotes.keys()]) removeRemote(id);
  for (const c of MP.conns.values()) { try { c.close(); } catch (e) { } }
  MP.conns.clear(); for (const f of MP.fast.values()) { try { f.close(); } catch (e) { } } MP.fast.clear(); MP.peerPid.clear();
  try { MP.fastConn && MP.fastConn.close(); } catch (e) { } MP.fastConn = null;
  try { MP.hostConn && MP.hostConn.close(); } catch (e) { }
  try { MP.peer && MP.peer.destroy(); } catch (e) { }
  Object.assign(MP, { on: false, host: false, peer: null, hostConn: null, myId: null, code: null });
  document.body.classList.remove('online'); $('mpList').style.display = 'none'; $('chatPanel').style.display = 'none';
  if (!silent) floatText('🌐 Odadan ayrıldın');
}
// ---------------- packets
function handleNet3(d) {
  switch (d.t) {
    case 'wt': if (NW.client) applyWorldCars(d.c); return true;
    case 'wp': if (NW.client) applyWorldPeds(d.p); return true;
    case 'claim_no': { const c = WORLD_CARS[d.i]; if (c && state.inCar === c) { exitCar(true); floatText('🚫 Bu aracı başka oyuncu kullanıyor'); } return true; }
    case 'claim': case 'release': case 'cd': case 'pk': return hostHandleWorld(d);
    case 'hit': onPvpHit(d); return true;
    case 'kill': onRemoteKill(d); return true;
    case 'sb': { const r = MP.remotes.get(d.id); if (r) { r.sb = d; r.bounty = d.b; r.tagKey = ''; } if ($('mpList').style.display === 'block') renderMpList(); return true; }
    case 'info': if (MP.remotes.has(d.id)) ensureRemote(d.id, d.info); return true;
  }
  return false;
}
function applyPacket(d) {
  if (handleNet3(d)) return;
  if (handleStage2(d)) return;
  const r = MP.remotes.get(d.id); if (!r) return;
  if (d.t === 'st') { d.rt = mpNow(); r.snaps.push(d); if (r.snaps.length > 30) r.snaps.shift(); return; }
  const dist = Math.hypot(r.x - player.pos.x, r.z - player.pos.z), vol = clamp(1 - dist / 120, 0, 1);
  if (d.t === 'shot') {
    if (dist < 200) { for (let k = 0; k < (d.n || 1); k++) FX.tracer(d.a[0], d.a[1], d.a[2], d.b[0] + (k ? MR(-1.5, 1.5) : 0), d.b[1], d.b[2] + (k ? MR(-1.5, 1.5) : 0)); FX.add.spawn(d.a[0], d.a[1], d.a[2], 0, 0, 0, 0.06, 1.2, 0, 3, 2.2, 0.8, 1, 0); }
    if (vol > 0) AudioSys.shot(vol * (WEAPONS[d.w] ? WEAPONS[d.w].vol : 1));
    r.aimT = 0.6;
  } else if (d.t === 'fx' && d.k === 'boom') fxBoom(d.p[0], d.p[1], d.p[2], vol);
  else if (d.t === 'chat') { const txt = String(d.m).slice(0, 40); r.bubble = txt; r.bubbleT = 4.5; mpFeed(`<b style="color:${r.info.color}">${esc(r.info.name)}:</b> ${esc(txt)}`); AudioSys.tone(1200, 0.06, 0.08, 'sine'); }
  else if (d.t === 'emote') { r.emote = d.e; r.emoteT = 0; if (d.e === 'honk' && vol > 0) honkSound(vol); }
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fxBoom(x, y, z, vol = 1) {
  for (let k = 0; k < 50; k++) FX.add.spawn(x, y, z, MR(-8, 8), MR(2, 12), MR(-8, 8), MR(0.4, 1.1), MR(1.5, 3), 3, 3, MR(0.8, 1.6), 0.2, 1, 4);
  for (let k = 0; k < 30; k++) FX.norm.spawn(x + MR(-1, 1), y + MR(0, 2), z + MR(-1, 1), MR(-3, 3), MR(2, 7), MR(-3, 3), MR(2, 4), MR(2, 3), 6, 0.12, 0.11, 0.1, 0.8, -0.5);
  M.flash.position.set(x, y + 2, z); M.flash.intensity = 3000 * vol + 500;
  if (vol > 0) { AudioSys.burst(1.4, 300, 1.1 * vol); AudioSys.tone(70, 1.1, 0.7 * vol, 'sine', 0.3); }
}
function honkSound(vol = 1) { AudioSys.tone(415, 0.35, 0.22 * vol, 'square'); AudioSys.tone(523, 0.35, 0.16 * vol, 'square'); }
// ---------------- remote players
function ensureRemote(id, info) {
  info = Object.assign({ name: 'Oyuncu', color: '#e8443a', look: { ...DEFAULT_LOOK } }, info || {});
  info.name = String(info.name || 'Oyuncu').slice(0, 14);
  let r = MP.remotes.get(id);
  if (!r) { r = { id, info, snaps: [], human: null, veh: null, vehKey: '', tag: null, tagKey: '', bubble: '', bubbleT: 0, x: 0, y: 0, z: 0, r: 0, sp: 0, aimT: 0, emote: null, emoteT: 0, hp: 100, wn: 0 }; MP.remotes.set(id, r); }
  else { r.info = info; if (r.human) { disposeHuman(r.human); r.human = null; } }
  r.human = makeHuman({ ...(info.look || DEFAULT_LOOK), gun: true }); r.human.g.visible = false;
  if (!r.tag) { const tex = new THREE.CanvasTexture(document.createElement('canvas')); r.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); r.tag.renderOrder = 20; r.tag.scale.set(2.6, 1.3, 1); scene.add(r.tag); }
  r.tagKey = ''; updateOnlineHUD();
  return r;
}
function disposeHuman(h) { h.g.parent && h.g.parent.remove(h.g); h.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
function removeRemote(id) {
  const r = MP.remotes.get(id); if (!r) return;
  if (r.human) disposeHuman(r.human);
  if (r.veh) scene.remove(r.veh.group);
  if (r.tag) { scene.remove(r.tag); r.tag.material.map.dispose(); r.tag.material.dispose(); }
  MP.remotes.delete(id); updateOnlineHUD();
}
function vehVisual(kind, color) {
  if (!CAR_SPECS[kind]) kind = 'sedan';
  const c = kind === 'bike' ? createBike(color, 0, -9999, 0, 'free') : kind === 'boat' ? createBoat(color, 0, -9999, 0) : kind === 'heli' ? createHeli(color, 0, 0, -9999, 0) : createCar(kind, color, 0, -9999, 0, 'free');
  const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1);
  c.remote = true; return c;
}
function drawTag(r) {
  const key = `${r.info.name}|${r.hp}|${r.wn}|${r.bounty || 0}|${r.bubbleT > 0 ? r.bubble : ''}`;
  if (key === r.tagKey) return; r.tagKey = key;
  const cv = r.tag.material.map.image; cv.width = 256; cv.height = 128; const g = cv.getContext('2d');
  g.clearRect(0, 0, 256, 128); g.textAlign = 'center'; g.textBaseline = 'middle';
  if (r.bubbleT > 0 && r.bubble) {
    g.font = 'bold 22px Arial'; const w = Math.min(250, g.measureText(r.bubble).width + 24);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.roundRect(128 - w / 2, 2, w, 34, 12); g.fill();
    g.beginPath(); g.moveTo(120, 36); g.lineTo(136, 36); g.lineTo(128, 44); g.fill();
    g.fillStyle = '#111'; g.fillText(r.bubble, 128, 20);
  }
  g.font = 'bold 26px Arial'; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(r.info.name, 128, 66); g.fillStyle = r.info.color; g.fillText(r.info.name, 128, 66);
  g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(68, 84, 120, 10); g.fillStyle = r.hp > 30 ? '#2ee66b' : '#ff4040'; g.fillRect(70, 86, 116 * clamp(r.hp / 100, 0, 1), 6);
  if (r.bounty > 0 && !(r.bubbleT > 0)) { g.font = 'bold 22px Arial'; g.lineWidth = 5; g.strokeStyle = '#000'; const t = `☠ $${r.bounty}`; g.strokeText(t, 128, 22); g.fillStyle = '#ff3a4a'; g.fillText(t, 128, 22); }
  if (r.wn > 0) { g.font = 'bold 20px Arial'; g.fillStyle = '#ffd23a'; g.strokeStyle = '#000'; g.lineWidth = 4; const s = '★'.repeat(r.wn); g.strokeText(s, 128, 112); g.fillText(s, 128, 112); }
  r.tag.material.map.needsUpdate = true;
}
function sampleRemote(r) {
  const S = r.snaps; if (!S.length) return null;
  const rt = mpNow() - MP_DELAY;
  while (S.length > 2 && S[1].rt <= rt) S.shift();
  const a = S[0], b = S[1];
  if (!b || rt <= a.rt) return { ...a };
  const span = Math.max(0.02, b.rt - a.rt);
  let k = (rt - a.rt) / span;
  if (k > 1) k = Math.min(k, 1 + 0.25 / span);                       // buffer starved: extrapolate up to 250 ms
  if (Math.hypot(b.x - a.x, b.z - a.z) > 40) k = 1;                     // teleport: snap
  return { ...b, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), r: a.r + wrapA(b.r - a.r) * Math.min(k, 1.5), px: lerp(a.px || 0, b.px || 0, Math.min(k, 1)), rz: lerp(a.rz || 0, b.rz || 0, Math.min(k, 1)) };
}
function updateRemotes(dt) {
  for (const r of MP.remotes.values()) {
    const s = sampleRemote(r); if (!s) continue;
    const ox = r.x, oz = r.z;
    r.x = s.x; r.y = s.y; r.z = s.z; r.r = s.r; r.hp = s.hp; r.wn = s.wn || 0;
    const mv = Math.hypot(r.x - ox, r.z - oz) / Math.max(dt, 1e-3);
    const far = Math.hypot(r.x - player.pos.x, r.z - player.pos.z) > 320;
    const h = r.human;
    // vehicle visual
    const key = s.v ? s.v + s.vc + (s.ug || '') + (s.rm || '') : '';
    if (key !== r.vehKey) { if (r.veh) { if (h.g.parent === r.veh.group) scene.add(h.g); scene.remove(r.veh.group); r.veh = null; } if (s.v) { r.veh = vehVisual(s.v, s.vc); applyCarStyle(r.veh, s.ug, s.rm); } r.vehKey = key; }
    if (r.veh) {
      const c = r.veh, gp = c.group;
      gp.visible = !far; gp.position.set(r.x, r.y, r.z); gp.rotation.set(s.px || 0, r.r, s.rz || 0);
      c.spin += (s.sp || 0) * dt / c.spec.wr; for (const sp of c.spinners) if (c.spec.bike) sp.rotation.x = c.spin; else sp.rotation.z = -c.spin;
      for (const f of c.fronts) f.rotation.y = -(s.st || 0);
      if (c.rotor) { c.rotorA += 30 * dt; c.rotor.rotation.y = c.rotorA; c.tailRotor.rotation.x = c.rotorA * 1.6; }
      if (c.spec.bike) { if (h.g.parent !== gp) { gp.add(h.g); h.g.position.set(0, 0.45, -0.28); h.g.rotation.set(0.32, 0, 0); } h.g.visible = true; h.legL.rotation.x = h.legR.rotation.x = -1.3; h.kneeL.rotation.x = h.kneeR.rotation.x = 1.5; h.armL.rotation.x = h.armR.rotation.x = -1.15; }
      else h.g.visible = false;
    } else {
      if (h.g.parent !== scene) scene.add(h.g);
      h.g.visible = !far && !s.pas; h.g.position.set(r.x, r.y, r.z); h.g.rotation.set(s.dead ? -Math.PI / 2 : 0, r.r, 0);
      if (!s.dead && h.g.visible) {
        r.aimT -= dt; animHuman(h, Math.min(mv, 8), dt, r.aimT > 0 || s.aim);
        if (r.emote) { r.emoteT += dt; applyEmote(h, r.emote, r.emoteT); if (r.emoteT > 3.5 || mv > 1) r.emote = null; }
      }
    }
    if (r.bubbleT > 0) r.bubbleT -= dt;
    drawTag(r);
    r.tag.visible = !far; r.tag.position.set(r.x, r.y + (s.pas ? 3.4 : 0) + (r.veh ? (r.veh.spec.heli ? 4 : r.veh.spec.bike ? 2.6 : 3) : 2.35), r.z);
  }
}
function applyEmote(h, e, t) {
  if (e === 'wave') { h.armR.rotation.x = -2.7 + Math.sin(t * 10) * 0.25; h.armR.rotation.z = -0.5 + Math.sin(t * 10) * 0.3; h.elbowR.rotation.x = -0.4; }
  else if (e === 'cheer') { for (const [a, el, sg] of [[h.armL, h.elbowL, 1], [h.armR, h.elbowR, -1]]) { a.rotation.x = -2.9 + Math.sin(t * 9) * 0.2; a.rotation.z = sg * 0.35; el.rotation.x = -0.2; } h.g.children[4].position.y = Math.abs(Math.sin(t * 9)) * 0.06; }
  else if (e === 'dance') {
    const b = Math.sin(t * 8);
    h.armL.rotation.x = -1.6 + b * 0.9; h.armR.rotation.x = -1.6 - b * 0.9; h.elbowL.rotation.x = h.elbowR.rotation.x = -0.9;
    h.legL.rotation.x = b * 0.35; h.legR.rotation.x = -b * 0.35; h.kneeL.rotation.x = Math.max(0, b) * 0.6; h.kneeR.rotation.x = Math.max(0, -b) * 0.6;
    h.g.children[4].position.y = Math.abs(b) * 0.07;
  } else if (e === 'honk') { h.armR.rotation.x = h.armL.rotation.x = -1.3; h.elbowL.rotation.x = h.elbowR.rotation.x = -1.2; }
}
// ---------------- local tick + HUD
function myState() {
  const c = state.inCar, p = c ? c.group.position : player.pos, f2 = v => Math.round(v * 100) / 100;
  const o = { t: 'st', x: f2(p.x), y: f2(c ? c.y : player.pos.y), z: f2(p.z), r: Math.round((c ? c.h : player.yaw) * 1000) / 1000, sp: f2(c ? carFwd(c) : player.speed), hp: Math.max(0, Math.round(state.health)), wn: state.wanted, w: state.weapon, aim: player.aimT > 0 ? 1 : 0, dead: state.dead ? 1 : 0 };
  if (state.passenger) o.pas = state.passenger;
  if (c && c.up) { if (c.up.neon) o.ug = c.up.neon; if (c.up.rim) o.rm = c.up.rim; }
  if (c) { o.v = c.kind; o.vc = '#' + c.paintM.color.getHexString(THREE.SRGBColorSpace); o.px = f2(c.group.rotation.x); o.rz = f2(c.group.rotation.z); o.st = f2(c.steer); }
  return o;
}
function mpUpdate(rdt) {
  if (!MP.on) return;
  MP.acc += rdt;
  if (MP.acc >= MP_TICK) { MP.acc = Math.min(MP.acc - MP_TICK, MP_TICK); mpSend(myState()); }
  if (MP.host && MP.remotes.size) hostStreamWorld(rdt);
  if (MP.host) { MP.worldT += rdt; if (MP.worldT > 5) { MP.worldT = 0; mpBroadcast({ t: 'world', time: state.time, weather: state.weather }); } }
  updateRemotes(rdt);
  if (state.emote) { state.emote.t += rdt; if (state.emote.t > 3.5 || player.speed > 1 || state.inCar) state.emote = null; }
}
function updateOnlineHUD() {
  if (!MP.on) return;
  document.body.classList.add('online');
  $('mpPill').textContent = `🌐 ${MP.pub ? 'Genel oda' : 'Oda ' + MP.code} · 👥 ${MP.remotes.size + 1}/${MP_MAX} · 🏆`;
  if ($('mpList').style.display === 'block') renderMpList();
}
function renderMpList() {
  const rows = [`<div class="mpRow"><i style="background:${MP.color}"></i><b>${esc(MP.name)} (sen)</b><span>${MP.host ? '👑 Oda sahibi' : ''}</span></div>`];
  for (const r of MP.remotes.values()) rows.push(`<div class="mpRow"><i style="background:${r.info.color}"></i><b>${esc(r.info.name)}</b><span>${r.id === 'h' ? '👑' : ''} ${Math.round(Math.hypot(r.x - player.pos.x, r.z - player.pos.z))} m</span></div>`);
  $('mpList').innerHTML = `<div class="mpHead">🏆 Skor tablosu · ${MP.pub ? 'Genel oda' : 'Oda <b>' + MP.code + '</b>'}</div>${renderScoreboard()}
    <div class="mpBtns">${MP.pub ? '' : '<button data-mp="copy">📋 Kodu kopyala</button>'}<button data-mp="leave" class="red">🚪 Odadan ayrıl</button></div>`;
}
function mpFeed(html) {
  const f = $('chatFeed'), el = document.createElement('div'); el.innerHTML = html; f.appendChild(el);
  while (f.children.length > 5) f.firstChild.remove();
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 600); }, 7000);
}
function sendChat(i) {
  if (state.now - MP.chatT < 0.8) return; MP.chatT = state.now;
  const m = QUICK_MSGS[i]; mpSend({ t: 'chat', m }); mpFeed(`<b style="color:${MP.color}">${esc(MP.name)}:</b> ${esc(m)}`);
  $('chatPanel').style.display = 'none';
}
function doEmote(e) {
  if (e === 'honk') honkSound(1); else if (!state.inCar) state.emote = { type: e, t: 0 };
  mpSend({ t: 'emote', e }); $('chatPanel').style.display = 'none'; haptic(20);
}
function copyCode() { const t = MP.code; try { navigator.clipboard.writeText(t).then(() => floatText('📋 Kod kopyalandı: ' + t)); } catch (e) { floatText('Kod: ' + t); } }
function initOnlineUI() {
  const cp = $('chatPanel');
  cp.innerHTML = `<div class="cpGrid">${QUICK_MSGS.map((m, i) => `<button data-chat="${i}">${m}</button>`).join('')}</div><div class="cpEm">${EMOTES.map(([k, ic, n]) => `<button data-emote="${k}">${ic}<small>${n}</small></button>`).join('')}</div>`;
  const tapHandler = (el, fn) => { el.addEventListener('click', e => { e.stopPropagation(); fn(e); }); el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(e); }, { passive: false }); };
  tapHandler(cp, e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.chat) sendChat(+b.dataset.chat); else if (b.dataset.emote) doEmote(b.dataset.emote); });
  tapHandler($('bChat'), () => { cp.style.display = cp.style.display === 'block' ? 'none' : 'block'; $('mpList').style.display = 'none'; });
  tapHandler($('mpPill'), () => { const l = $('mpList'); l.style.display = l.style.display === 'block' ? 'none' : 'block'; cp.style.display = 'none'; if (l.style.display === 'block') renderMpList(); });
  tapHandler($('mpList'), e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.mp === 'copy') copyCode(); if (b.dataset.mp === 'leave') mpLeave(false); });
}
// ---------------- lobby (start screen)
function initLobby() {
  try { Object.assign(MP, JSON.parse(localStorage.getItem('vistabay_mp') || '{}')); } catch (e) { }
  if (!MP.name) MP.name = 'Oyuncu' + Math.floor(10 + Math.random() * 90);
  $('mpName').value = MP.name;
  $('mpColors').innerHTML = MP_COLORS.map(c => `<button data-c="${c}" style="background:${c}" class="${c === MP.color ? 'on' : ''}"></button>`).join('');
  $('mpCostumes').innerHTML = MP_COSTUMES.map((c, i) => `<button data-k="${i}" class="${i === MP.costume ? 'on' : ''}">${c.name}</button>`).join('');
  $('mpColors').onclick = e => { const b = e.target.closest('button'); if (!b) return; MP.color = b.dataset.c; [...$('mpColors').children].forEach(x => x.classList.toggle('on', x === b)); };
  $('mpCostumes').onclick = e => { const b = e.target.closest('button'); if (!b) return; MP.costume = +b.dataset.k; [...$('mpCostumes').children].forEach(x => x.classList.toggle('on', x === b)); };
  $('onlineBtn').onclick = () => { $('lobby').style.display = 'block'; $('modeBtns').style.display = 'none'; };
  $('mpBack').onclick = () => { $('lobby').style.display = 'none'; $('modeBtns').style.display = 'flex'; };
  const status = (t, err) => { const s = $('mpStatus'); s.textContent = t; s.style.color = err ? '#ff8a8a' : '#fff'; };
  const busy = b => document.querySelectorAll('#lobby button').forEach(x => x.disabled = b);
  const go = async (fn) => {
    MP.name = ($('mpName').value || '').trim().slice(0, 14) || MP.name;
    try { localStorage.setItem('vistabay_mp', JSON.stringify({ name: MP.name, color: MP.color, costume: MP.costume })); } catch (e) { }
    busy(true);
    try { status('Ağ kütüphanesi yükleniyor…'); await loadPeerJS(); await fn(); startGame(true); }
    catch (e) { console.warn(e); status('❌ ' + (e.message || e.type || 'Bağlantı hatası'), true); try { MP.peer && MP.peer.destroy(); } catch (x) { } MP.peer = null; MP.on = false; busy(false); }
  };
  $('mpHostBtn').onclick = () => go(async () => { status('Oda kuruluyor…'); await mpHost(); });
  $('mpJoinBtn').onclick = () => { const code = ($('mpCode').value || '').replace(/\D/g, ''); if (code.length !== 4) { status('4 haneli oda kodunu gir', true); return; } go(async () => { status('Odaya bağlanılıyor…'); await mpJoin(code); }); };
  $('mpQuickBtn').onclick = () => go(async () => { await mpQuickJoin(t => status(t)); });
}
function mpAfterStart() {
  const cos = MP_COSTUMES[MP.costume] || MP_COSTUMES[0];
  Object.assign(state.look, { shirt: MP.color, cap: cos.cap, glasses: cos.glasses, shorts: cos.shorts }); applyLook(); saveGame();
  if (MP.hostConn && MP.hostConn.open) MP.hostConn.send({ t: 'hello', info: myInfo() });
  updateOnlineHUD();
  if (MP.host) showBig(MP.pub ? '🌐 GENEL ODA AÇILDI' : `🌐 ODA KODU: ${MP.code}`, '#7dff9a', 5, MP.pub ? 'Hızlı Katıl ile gelen oyuncular buraya düşer' : 'Arkadaşların bu kodla katılabilir · 👥 düğmesinden kopyala');
}

// ============================================================ MP STAGE 2: passenger seat, street races, co-op heist
// ---------------- passenger seat (+ drive-by)
function nearRemoteVehicle(maxD = 4.5) {
  let best = null, bd = maxD;
  for (const r of MP.remotes.values()) { if (!r.veh) continue; const d = Math.hypot(r.x - player.pos.x, r.z - player.pos.z); if (d < bd) { bd = d; best = r; } }
  return best;
}
function enterAsPassenger(r) {
  if (state.inCar || state.passenger) return;
  state.passenger = r.id; player.human.g.visible = false; document.body.classList.add('passenger');
  mpSend({ t: 'pas', to: r.id, on: 1 }); AudioSys.door();
  floatText(`🚗 ${r.info.name} aracında yolcusun · ATEŞ ile camdan ateş et`);
}
function exitPassenger(reason) {
  const r = MP.remotes.get(state.passenger), h = r ? r.r : player.yaw;
  if (r) mpSend({ t: 'pas', to: r.id, on: 0 });
  state.passenger = null; document.body.classList.remove('passenger');
  let x = player.pos.x + Math.cos(h) * 2.4, z = player.pos.z - Math.sin(h) * 2.4;
  const y0 = player.pos.y, c = state.interior ? interiorCollide(x, z, 0.4, y0) : collide(x, z, 0.4, y0 + 0.3); x = c.x; z = c.z;
  let sy = surfaceY(x, z, y0 + 0.4); if (y0 - sy > 1.2 && r) { x = r.x; z = r.z; sy = surfaceY(x, z, y0 + 0.4); }
  player.pos.set(x, sy, z); player.vy = 0; player.onGround = true; player.human.g.visible = true;
  if (reason) floatText(reason); AudioSys.door();
}
function updatePassenger(dt) {
  const r = MP.remotes.get(state.passenger);
  if (!r || !r.veh) { exitPassenger('Sürücü araçtan indi'); return; }
  player.pos.set(r.x, r.y, r.z); player.yaw = r.r; player.human.g.visible = false;
  if (player.aimT > 0) player.aimT -= dt;
}

// ---------------- impromptu street race (inviter is the authority)
const RACE_BETS = [0, 500, 2000, 5000];
let raceMarker = null;
function buildRaceMarker() {
  raceMarker = new THREE.Group();
  raceMarker.add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 90, 24, 1, true).translate(0, 45, 0), new THREE.MeshBasicMaterial({ map: beamTex(), color: 0x2a7aff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));
  raceMarker.add(new THREE.Mesh(new THREE.RingGeometry(6, 7.2, 40).rotateX(-Math.PI / 2).translate(0, 0.1, 0), new THREE.MeshBasicMaterial({ color: 0x40a0ff, transparent: true, opacity: 0.9, depthWrite: false })));
  raceMarker.visible = false; scene.add(raceMarker);
}
function openRacePanel(r) {
  const p = $('racePanel');
  p.innerHTML = `<b>🏁 ${esc(r.info.name)} ile yarış</b><small>Bahis seç · kazanan ikisini de alır</small><div>${RACE_BETS.map(b => `<button data-bet="${b}" ${state.money < b ? 'disabled' : ''}>${b ? '$' + b : 'Bahissiz'}</button>`).join('')}</div><button data-bet="x" class="gray">İptal</button>`;
  p.dataset.to = r.id; p.style.display = 'block';
}
function sendRaceInvite(to, bet) {
  $('racePanel').style.display = 'none';
  if (!MP.remotes.has(to)) return;
  state.raceInv = { to, bet, t: 15 }; mpSend({ t: 'race_inv', to, bet });
  floatText(`🏁 Yarış teklifi gönderildi · $${bet}`);
}
function showInvite(from, bet) {
  const r = MP.remotes.get(from); if (!r || state.mpRace) return;
  const el = $('invite'); state.incoming = { from, bet, t: 15 };
  el.innerHTML = `<b>🏁 ${esc(r.info.name)} sana yarış teklif ediyor</b><small>Bahis: ${bet ? '$' + bet : 'yok'} · bitiş haritada mavi fişekle gösterilir</small><div><button data-inv="1" ${state.money < bet ? 'disabled' : ''}>KABUL</button><button data-inv="0" class="red">RET</button></div>`;
  el.style.display = 'block'; AudioSys.tone(660, 0.15, 0.2, 'square'); AudioSys.tone(990, 0.2, 0.2, 'square', 1, 0.15); haptic([40, 40, 40]);
}
function answerInvite(ok) {
  const inc = state.incoming; $('invite').style.display = 'none'; state.incoming = null;
  if (!inc) return;
  if (ok && state.money >= inc.bet && !state.mission && !state.mpRace) mpSend({ t: 'race_acc', to: inc.from, bet: inc.bet });
  else mpSend({ t: 'race_dec', to: inc.from });
}
function startMpRace(o) {
  state.mpRace = { ...o, stage: 'count', t: 3.5, lastN: 4 };
  if (o.bet) { state.money -= o.bet; S().spent += o.bet; ledger('🏁 Yarış bahsi', -o.bet); }
  raceMarker.position.set(o.x, groundY(o.x, o.z), o.z); raceMarker.visible = true;
  state.waypoint = null;
}
function finishMpRace(winner) {
  const rc = state.mpRace; if (!rc) return;
  const opp = MP.remotes.get(rc.opp), oname = opp ? opp.info.name : 'Rakip';
  if (winner === MP.myId) { if (rc.bet) earn(rc.bet * 2, '🏁 Yarış kazancı'); S().racesWon++; showBig('YARIŞI KAZANDIN!', '#7dff9a', 3.5, rc.bet ? `+$${rc.bet * 2}` : `${oname} geride kaldı`); AudioSys.success(); AudioSys.cash(); haptic([50, 40, 90]); }
  else if (winner === 'void') { if (rc.bet) { state.money += rc.bet; ledger('🏁 Bahis iadesi', rc.bet); } showBig('YARIŞ İPTAL', '#ffd23a', 2.5, 'Bahis iade edildi'); }
  else { showBig('YARIŞI KAYBETTİN', '#ff5050', 3, `${oname} önce vardı`); AudioSys.fail(); }
  state.mpRace = null; raceMarker.visible = false; saveGame();
}
function raceAuthorityFinish(from) {
  const rc = state.mpRace; if (!rc || rc.auth !== MP.myId || rc.done) return;
  rc.done = true; mpSend({ t: 'race_res', to: rc.opp, rid: rc.rid, winner: from }); finishMpRace(from);
}
function updateMpRace(dt) {
  const el = $('mission');
  if (state.raceInv) { state.raceInv.t -= dt; if (state.raceInv.t <= 0) { state.raceInv = null; floatText('🏁 Teklif yanıtsız kaldı'); } }
  if (state.incoming) { state.incoming.t -= dt; if (state.incoming.t <= 0) answerInvite(false); }
  const rc = state.mpRace; if (!rc) return;
  if (!MP.remotes.has(rc.opp)) { finishMpRace('void'); return; }
  raceMarker.children[0].material.opacity = 0.75 + Math.sin(state.now * 5) * 0.25;
  if (Math.random() < 0.6) FX.add.spawn(rc.x + MR(-1, 1), raceMarker.position.y + 1, rc.z + MR(-1, 1), MR(-1, 1), MR(8, 14), MR(-1, 1), 1.2, 0.7, 0.5, 0.4, 0.9, 3, 1, 2);
  const d = Math.hypot(player.pos.x - rc.x, player.pos.z - rc.z);
  el.style.display = 'block'; el.style.borderLeftColor = '#2a7aff';
  if (rc.stage === 'count') {
    rc.t -= dt; const n = Math.ceil(rc.t);
    if (n !== rc.lastN && n > 0) { rc.lastN = n; showBig(String(n), '#40a0ff', 0.8, 'Yarış başlıyor…'); AudioSys.tone(520, 0.15, 0.25, 'square'); }
    if (rc.t <= 0) { rc.stage = 'go'; rc.el = 0; showBig('BAŞLA!', '#7dff9a', 1.2, 'Mavi fişeğe ilk ulaşan kazanır'); AudioSys.tone(1040, 0.35, 0.3, 'square'); haptic(80); }
    el.textContent = `🏁 Sokak yarışı · ${Math.max(0, Math.ceil(rc.t))} · Bahis $${rc.bet}`;
    return;
  }
  rc.el += dt;
  const opp = MP.remotes.get(rc.opp), od = opp ? Math.hypot(opp.x - rc.x, opp.z - rc.z) : 0;
  el.textContent = `🏁 Yarış · sen ${Math.round(d)} m · ${opp ? esc(opp.info.name) : 'rakip'} ${Math.round(od)} m · ${Math.floor(rc.el)} sn · 💵 $${rc.bet * 2}`;
  if (d < 9 && !rc.sentFin) { rc.sentFin = true; if (rc.auth === MP.myId) raceAuthorityFinish(MP.myId); else mpSend({ t: 'race_fin', to: rc.auth, rid: rc.rid }); }
  if (rc.el > 300) { if (rc.auth === MP.myId) { mpSend({ t: 'race_res', to: rc.opp, rid: rc.rid, winner: 'void' }); } finishMpRace('void'); }
}

// ---------------- co-op heist (host schedules; kills / loot are shared)
const heistNpcs = [];
let heistBagGeo = null, heistBagMat = null;
function startHeist(h) {
  endHeist(true);
  const van = vehVisual('armored', '#2c3a2c'); van.group.position.set(h.x, groundY(h.x, h.z), h.z); van.group.rotation.y = h.r;
  while (heistNpcs.length < 5) { const p = npcPed({ skin: pick(SKIN), shirt: '#26303a', pants: '#1a1e24', hair: '#101010', shoes: '#101010', cap: '#1a2a4a', glasses: true, gun: true }, 0, 0); p.npc = 'guard'; heistNpcs.push(p); }
  const guards = heistNpcs.slice(0, h.n);
  guards.forEach((p, i) => { const a = i / h.n * Math.PI * 2, r = collide(h.x + Math.cos(a) * 4.5, h.z + Math.sin(a) * 4.5, 0.4, 0.5); Object.assign(p, { x: r.x, z: r.z, dead: false, hp: 3, shootT: MR(0.8, 2), yaw: a, heistIdx: i }); p.h.g.rotation.set(0, a, 0); p.h.g.visible = true; });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 20, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ map: beamTex(), color: 0xffc020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.set(h.x, 0, h.z); scene.add(beam);
  state.heist = { ...h, van, guards, beam, opened: false, bags: [], alert: false, t: 0 };
  showBig('💼 ORTAK SOYGUN', '#ffc020', 3.5, 'Zırhlı konvoy haritada · korumaları temizle, kasayı aç!'); AudioSys.thunder(); haptic([60, 40, 60]);
}
function endHeist(silent) {
  const H = state.heist; if (!H) return;
  scene.remove(H.van.group); scene.remove(H.beam); H.beam.geometry.dispose(); H.beam.material.dispose();
  for (const b of H.bags) if (b.m) scene.remove(b.m);
  for (const p of H.guards) { p.dead = true; p.h.g.visible = false; p.h.g.rotation.x = 0; p.heistIdx = -1; }
  state.heist = null; if (!silent) floatText('💼 Soygun etkinliği sona erdi');
}
function heistLoot(bags) {
  const H = state.heist; if (!H) return;
  H.opened = true;
  if (!heistBagGeo) { heistBagGeo = merge([colorize(new THREE.SphereGeometry(0.32, 12, 10).scale(1, 1.15, 0.9), '#6a5a3a'), colorize(new THREE.CylinderGeometry(0.07, 0.12, 0.14, 8).translate(0, 0.4, 0), '#4a3a24'), colorize(new THREE.BoxGeometry(0.3, 0.22, 0.02).translate(0, 0, 0.29), '#2fd060')]); heistBagMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0x204010, roughness: 0.8 }); }
  H.bags = bags.map(([x, z, amt], i) => { const m = new THREE.Mesh(heistBagGeo, heistBagMat); m.position.set(x, groundY(x, z) + 0.4, z); m.castShadow = true; scene.add(m); return { i, x, z, amt, m }; });
  showBig('KASA AÇILDI!', '#7dff9a', 3, `${bags.length} para çantası saçıldı · ilk kapan alır`); AudioSys.boom();
}
function takeBag(i, mine) {
  const H = state.heist; if (!H) return; const b = H.bags.find(q => q.i === i && q.m); if (!b) return;
  scene.remove(b.m); b.m = null;
  if (mine) { earn(b.amt, '💼 Soygun'); floatText(`💼 +$${b.amt}`); AudioSys.cash(); haptic(30); mpSend({ t: 'heist_bag', hid: H.id, i }); }
  if (H.bags.every(q => !q.m)) { S().heists++; setTimeout(() => endHeist(true), 1500); }
}
function hostOpenHeist() {
  const H = state.heist; if (!H || H.opened) return;
  const bags = []; for (let k = 0; k < 9; k++) { const a = Math.random() * Math.PI * 2, r = MR(2, 7); bags.push([Math.round((H.x + Math.cos(a) * r) * 10) / 10, Math.round((H.z + Math.sin(a) * r) * 10) / 10, Math.round(MR(400, 1100) / 10) * 10]); }
  mpSend({ t: 'heist_loot', hid: H.id, bags }); heistLoot(bags);
}
function updateHeist(dt) {
  if (MP.on && MP.host) {
    MP.heistT += dt;
    if (MP.heistT >= 300 && !state.heist) {
      MP.heistT = 0;
      const [x, z] = randomSidewalk(), h = { t: 'heist', hid: Date.now() % 1e9, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r: Math.round(Math.random() * 62) / 10, n: 4 + Math.min(1, MP.remotes.size) };
      h.id = h.hid; mpSend(h); startHeist(h);
    }
  }
  const H = state.heist; if (!H) return;
  H.t += dt; if (H.t > 240) { endHeist(false); return; }
  H.beam.material.opacity = 0.6 + Math.sin(state.now * 4) * 0.3;
  const dv = Math.hypot(player.pos.x - H.x, player.pos.z - H.z);
  if (!H.alert && dv < 32) { H.alert = true; floatText('⚠ Konvoy korumaları alarm verdi!'); }
  for (const p of H.guards) {
    const h = p.h;
    if (p.dead) { h.g.position.set(p.x, groundY(p.x, p.z) + 0.12, p.z); continue; }
    if (p.hp < 3) H.alert = true;
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
    let spd = 0;
    if (H.alert && !state.dead && d < 60) {
      if (d > 12) { spd = 3.4; const r = collide(p.x + dx / d * spd * dt, p.z + dz / d * spd * dt, 0.35, 0.5); p.x = r.x; p.z = r.z; }
      p.shootT -= dt;
      if (d < 42 && p.shootT <= 0 && los(p.x, 1.4, p.z, player.pos.x, 1.3, player.pos.z)) {
        p.shootT = MR(0.8, 1.6); const hit = Math.random() < 0.32;
        FX.tracer(p.x, 1.45, p.z, player.pos.x + (hit ? 0 : MR(-2.5, 2.5)), player.pos.y + 1.2, player.pos.z + (hit ? 0 : MR(-2.5, 2.5)), true);
        AudioSys.shot(0.45); if (hit) { if (state.inCar) { damageCar(state.inCar, 4); state.health -= 1; } else applyDamage(5); }
      }
      p.yaw = wrapA(p.yaw + wrapA(Math.atan2(dx, dz) - p.yaw) * (1 - Math.exp(-6 * dt)));
    }
    h.g.position.set(p.x, groundY(p.x, p.z), p.z); h.g.rotation.y = p.yaw; animHuman(h, spd, dt, H.alert);
  }
  const allDown = H.guards.every(p => p.dead);
  if (allDown && !H.opened && dv < 4.5 && !state.inCar && !state.dead) state.interact = { label: '💰 KASAYI AÇ', fn: () => { if (MP.host) hostOpenHeist(); else mpSend({ t: 'heist_open', to: 'h', hid: H.id }); } };
  if (H.opened) for (const b of H.bags) if (b.m) { b.m.rotation.y += dt * 2; if (Math.hypot(player.pos.x - b.x, player.pos.z - b.z) < (state.inCar ? 2.8 : 1.4)) takeBag(b.i, true); }
  const el = $('mission');
  if (!state.mission && !state.mpRace) { el.style.display = 'block'; el.style.borderLeftColor = '#ffc020'; el.textContent = H.opened ? `💼 Soygun · kalan çanta ${H.bags.filter(b => b.m).length}` : `💼 Ortak soygun · korumalar ${H.guards.filter(p => !p.dead).length}/${H.guards.length} · ${Math.round(dv)} m${allDown ? ' · KASAYI AÇ!' : ''}`; }
}
function heistGuardKilledLocally(p) { const H = state.heist; if (H && p.heistIdx >= 0 && !p.remoteKill) mpSend({ t: 'heist_kill', hid: H.id, i: p.heistIdx }); }

// ---------------- packet handling for stage 2 (returns true if handled)
function handleStage2(d) {
  const r = MP.remotes.get(d.id), H = state.heist;
  switch (d.t) {
    case 'pas': if (r) floatText(d.on ? `🚗 ${r.info.name} aracına bindi` : `🚶 ${r.info.name} araçtan indi`); return true;
    case 'race_inv': if (r) { if (state.mission || state.mpRace) mpSend({ t: 'race_dec', to: d.id, busy: 1 }); else showInvite(d.id, d.bet | 0); } return true;
    case 'race_dec': if (state.raceInv && state.raceInv.to === d.id) { state.raceInv = null; floatText(`🏁 ${r ? r.info.name : 'Rakip'} teklifi reddetti`); } return true;
    case 'race_acc': {
      if (!state.raceInv || state.raceInv.to !== d.id || state.money < state.raceInv.bet) return true;
      const bet = state.raceInv.bet; state.raceInv = null;
      const mx = (player.pos.x + (r ? r.x : player.pos.x)) / 2, mz = (player.pos.z + (r ? r.z : player.pos.z)) / 2, [fx, fz] = farNode(380, 650, mx, mz);
      const o = { rid: Date.now() % 1e9, x: fx, z: fz, bet, auth: MP.myId };
      mpSend({ t: 'race_go', to: d.id, ...o }); startMpRace({ ...o, opp: d.id });
      return true;
    }
    case 'race_go': startMpRace({ rid: d.rid, x: d.x, z: d.z, bet: d.bet | 0, auth: d.auth, opp: d.id }); return true;
    case 'race_fin': if (state.mpRace && state.mpRace.rid === d.rid) raceAuthorityFinish(d.id); return true;
    case 'race_res': if (state.mpRace && state.mpRace.rid === d.rid) finishMpRace(d.winner); return true;
    case 'heist': startHeist(d); return true;
    case 'heist_kill': if (H && H.id === d.hid) { const p = H.guards[d.i]; if (p && !p.dead) { p.remoteKill = true; killPed(p, false); p.remoteKill = false; } } return true;
    case 'heist_open': if (MP.host && H && H.id === d.hid) hostOpenHeist(); return true;
    case 'heist_loot': if (H && H.id === d.hid && !H.opened) heistLoot(d.bags); return true;
    case 'heist_bag': if (H && H.id === d.hid) takeBag(d.i, false); return true;
  }
  return false;
}
function updateStage2(dt) {
  if (!MP.on) { if (state.passenger) exitPassenger(); if (state.mpRace) finishMpRace('void'); if (state.heist) endHeist(true); return; }
  updateMpRace(dt); updateHeist(dt);
  if (state.dead || state.inCar || state.passenger || state.interior) return;
  const rv = nearRemoteVehicle(4.5);
  if (rv) { state.interact = { label: `🚗 ${rv.info.name} ARACINA BİN`, fn: () => enterAsPassenger(rv) }; return; }
  if (state.mission || state.mpRace || state.raceInv) return;
  for (const r of MP.remotes.values()) if (Math.hypot(r.x - player.pos.x, r.z - player.pos.z) < 14) { state.interact = { label: `🏁 ${r.info.name} İLE YARIŞ`, fn: () => openRacePanel(r) }; return; }
}
function initStage2UI() {
  buildRaceMarker();
  const tap = (el, fn) => { el.addEventListener('click', e => { e.stopPropagation(); fn(e); }); el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(e); }, { passive: false }); };
  tap($('racePanel'), e => { const b = e.target.closest('button'); if (!b || b.disabled) return; if (b.dataset.bet === 'x') $('racePanel').style.display = 'none'; else sendRaceInvite($('racePanel').dataset.to, +b.dataset.bet); });
  tap($('invite'), e => { const b = e.target.closest('button'); if (!b || b.disabled) return; answerInvite(b.dataset.inv === '1'); });
}

// ---------------- performance helpers (chunk culling)
const CHUNK_MESHES = [];
let cullT = 0;
function cullChunks(dt) {
  cullT += dt; if (cullT < 0.3 || !CHUNK_MESHES.length) return; cullT = 0;
  const far = (state.interior ? 1e9 : scene.fog.far) * 1.05, cx = camera.position.x, cz = camera.position.z;
  for (const m of CHUNK_MESHES) { if (!m) continue; const s = m.geometry.boundingSphere; m.visible = state.interior ? false : Math.hypot(s.center.x - cx, s.center.z - cz) - s.radius < far; }
}

// ============================================================ CROSSHAIR AIMING (shots go exactly where the crosshair points)
const CROSS_NDC_Y = 1 - 2 * 0.44;          // #cross sits at 44% of the screen height
const _rc = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _aimO = new THREE.Vector3(), _aimD = new THREE.Vector3(), _tv = new THREE.Vector3();
const PVP_DMG = [18, 9, 14, 10, 0];       // per bullet / pellet, by weapon index (rocket = explosion)
function aimRay(spread = 0) {
  _ndc.set(spread ? MR(-spread, spread) : 0, CROSS_NDC_Y + (spread ? MR(-spread, spread) * camera.aspect : 0));
  _rc.setFromCamera(_ndc, camera); _aimO.copy(_rc.ray.origin); _aimD.copy(_rc.ray.direction);
}
function raySphere(cx, cy, cz, r, t0, t1) {
  const ox = cx - _aimO.x, oy = cy - _aimO.y, oz = cz - _aimO.z, t = ox * _aimD.x + oy * _aimD.y + oz * _aimD.z;
  if (t < t0 || t > t1) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - t * t; return d2 < r * r ? t - Math.sqrt(r * r - d2) : -1;
}
function worldHitT(t0, t1) {
  for (let t = t0; t < t1; t += 0.7) {
    const x = _aimO.x + _aimD.x * t, y = _aimO.y + _aimD.y * t, z = _aimO.z + _aimD.z * t;
    if (y < groundY(x, z) + 0.02) return t;
    if (state.interior) { const I = INTERIORS[state.interior]; if (x < I.x0 || x > I.x1 || z < I.z0 || z > I.z1 || y > I.h) return t; if (I.FH && (y < interiorSurface(I, x, z, y) + 0.02 || y > (genFloorOf(I) + 1) * I.FH - 0.2)) return t; for (const b of I.boxes) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && (b.y1 !== undefined ? y > b.y0 && y < b.y1 : y < 1.2)) return t; }
    else if (insideBuilding(x, y, z)) return t;
  }
  return -1;
}
// returns { t, kind: 'ped'|'car'|'remote'|'world'|'none', obj, head }
function castShot(range, ignoreCar) {
  const tStart = camera.position.distanceTo(_tv.set(player.pos.x, player.pos.y + 1.4, player.pos.z)) * 0.9 + 0.4, tEnd = tStart + range;
  let best = { t: tEnd, kind: 'none', obj: null, head: false };
  for (const p of peds) {
    if (p.dead || !p.h.g.visible) continue;
    const y = p.h.g.position.y, th = raySphere(p.x, y + 1.76, p.z, 0.17, tStart, best.t);
    if (th > 0) { best = { t: th, kind: 'ped', obj: p, head: true }; continue; }
    const tb = Math.max(raySphere(p.x, y + 1.25, p.z, 0.33, tStart, best.t), raySphere(p.x, y + 0.6, p.z, 0.3, tStart, best.t));
    if (tb > 0 && tb < best.t) best = { t: tb, kind: 'ped', obj: p, head: false };
  }
  for (const c of cars) {
    if (!c.active || c.dead || c === ignoreCar || !c.group.visible) continue;
    const p = c.group.position, sx = Math.sin(c.h), sz = Math.cos(c.h), L = c.spec.bus ? 4 : c.spec.heli ? 1.5 : c.spec.bike ? 0.5 : 1.3, R = c.spec.bike ? 0.7 : c.spec.heli ? 1.8 : 1.25;
    for (const k of [-1, 0, 1]) { const t = raySphere(p.x + sx * L * k, c.y + (c.spec.heli ? 1.6 : 0.85), p.z + sz * L * k, R, tStart, best.t); if (t > 0 && t < best.t) best = { t, kind: 'car', obj: c, head: false }; }
  }
  if (MP.on) for (const r of MP.remotes.values()) {
    if (!r.human || r.dead) continue;
    const inVeh = !!r.veh, t = inVeh ? raySphere(r.x, r.y + 1, r.z, 1.4, tStart, best.t) : Math.max(raySphere(r.x, r.y + 1.25, r.z, 0.38, tStart, best.t), raySphere(r.x, r.y + 0.6, r.z, 0.32, tStart, best.t));
    const th = inVeh ? -1 : raySphere(r.x, r.y + 1.76, r.z, 0.17, tStart, best.t);
    if (th > 0) best = { t: th, kind: 'remote', obj: r, head: true }; else if (t > 0 && t < best.t) best = { t, kind: 'remote', obj: r, head: false };
  }
  const tw = worldHitT(tStart, best.t);
  if (tw > 0) best = { t: tw, kind: 'world', obj: null, head: false };
  // mobile aim assist: nothing hit directly -> nearest target within a small cone (with line of sight)
  if (isTouch && (best.kind === 'world' || best.kind === 'none')) {
    let ba = 0.075, cand = null;
    const test = (obj, kind, x, y, z) => { const dx = x - _aimO.x, dy = y - _aimO.y, dz = z - _aimO.z, d = Math.hypot(dx, dy, dz); if (d < tStart || d > Math.min(tEnd, best.t + 1.5)) return; const a = Math.acos(clamp((dx * _aimD.x + dy * _aimD.y + dz * _aimD.z) / d, -1, 1)); if (a < ba && los(player.pos.x, player.pos.y + 1.4, player.pos.z, x, y, z)) { ba = a; cand = { t: d, kind, obj, head: false }; } };
    for (const p of peds) if (!p.dead && p.h.g.visible) test(p, 'ped', p.x, p.h.g.position.y + 1.2, p.z);
    if (MP.on) for (const r of MP.remotes.values()) if (r.human && !r.dead) test(r, 'remote', r.x, r.y + 1.1, r.z);
    if (cand) best = cand;
  }
  best.x = _aimO.x + _aimD.x * best.t; best.y = _aimO.y + _aimD.y * best.t; best.z = _aimO.z + _aimD.z * best.t;
  return best;
}
function applyHit(res, w, pellet) {
  if (res.kind === 'ped') { hitPed(res.obj); if (res.head && res.obj.npc) hitPed(res.obj); }
  else if (res.kind === 'car') { damageCar(res.obj, w.carDmg / (pellet ? 2 : 1)); if (res.obj.ai) res.obj.ai.panic = 6; }
  else if (res.kind === 'remote') pvpHit(res.obj, (PVP_DMG[state.weapon] || 12) * (res.head ? 2.2 : 1), res.head);
  if (res.kind !== 'none') FX.add.spawn(res.x, res.y, res.z, MR(-1, 1), MR(0.5, 2), MR(-1, 1), 0.2, res.kind === 'world' ? 0.3 : 0.5, 1, 3, 1.6, 0.5, 1, 6);
  if (res.kind === 'ped' || res.kind === 'remote') for (let k = 0; k < 5; k++) FX.norm.spawn(res.x, res.y, res.z, MR(-1.5, 1.5), MR(0.5, 2.5), MR(-1.5, 1.5), 0.4, 0.28, 0.2, 0.55, 0.02, 0.02, 0.9, 10);
}
function fire() {
  if (state.fireCd > 0 || state.dead) return;
  if (!state.ownedW[state.weapon] || state.ammo[state.weapon] <= 0) { nextWeapon(); return; }
  haptic(20);
  const w = WEAPONS[state.weapon];
  state.fireCd = w.cd;
  if (state.ammo[state.weapon] !== Infinity) state.ammo[state.weapon]--;
  const inCar = state.inCar, range = w.range * 1.25;
  const ox = player.pos.x, oz = player.pos.z, oy = player.pos.y + (inCar || state.passenger ? 1.3 : 1.45);
  aimRay(0);
  const main = castShot(range, inCar);
  const tx = main.x, ty = main.y, tz = main.z;
  const dx = tx - ox, dz = tz - oz, dl = Math.hypot(dx, dz) || 1;
  if (!inCar) { player.yaw = Math.atan2(dx, dz); player.aimT = 0.6; }
  const mx = ox + dx / dl * 0.6, mz = oz + dz / dl * 0.6, my = oy;
  FX.add.spawn(mx, my, mz, 0, 0, 0, 0.06, w.pellets > 1 ? 2 : 1.2, 0, 3, 2.2, 0.8, 1, 0);
  if (w.rocket) {
    const L = Math.hypot(tx - mx, ty - my, tz - mz) || 1;
    launchRocket(mx, my, mz, (tx - mx) / L, (ty - my) / L, (tz - mz) / L);
    AudioSys.rocket();
  } else {
    applyHit(main, w, false); FX.tracer(mx, my, mz, tx, ty, tz);
    for (let k = 1; k < (w.pellets || 1); k++) { aimRay(w.spread || 0.05); const r2 = castShot(range, inCar); applyHit(r2, w, true); FX.tracer(mx, my, mz, r2.x, r2.y, r2.z); }
    if (w.spread && w.pellets === 1) { /* automatic weapons: tiny bloom */ }
    AudioSys.shot(w.vol);
    if (main.kind === 'remote') { const c = $('cross'); c.classList.add('hit'); clearTimeout(fire.ht); fire.ht = setTimeout(() => c.classList.remove('hit'), 160); }
  }
  if (MP.on) { const q = v => Math.round(v * 100) / 100; mpSend({ t: 'shot', a: [q(mx), q(my), q(mz)], b: [q(tx), q(ty), q(tz)], w: state.weapon, n: w.pellets || 1 }); }
  // shots fired near people -> heat
  if (state.wanted < 1) for (const p of peds) if (!p.dead && !p.npc && dist2(p) < 900) { addHeat(1); break; }
  for (const c of cars) if (c.mode === 'ai' && c.ai && Math.hypot(c.group.position.x - ox, c.group.position.z - oz) < 60) c.ai.panic = 6;
  for (const p of peds) if (!p.dead && dist2(p) < 1600) { p.panic = 8; p.fleeX = p.x - ox; p.fleeZ = p.z - oz; if (p.npc && state.mission && state.mission.type === 'bounty') state.mission.alert = true; if (p.npc === 'gang') gangAggro(); }
}
let aimCheckT = 0;
function updateCrosshair(dt) {
  aimCheckT += dt; if (aimCheckT < 0.1) return; aimCheckT = 0;
  const c = $('cross'); if (!camera || state.dead) return;
  aimRay(0); const r = castShot(WEAPONS[state.weapon].range * 1.25, state.inCar);
  c.classList.toggle('hot', r.kind === 'ped' || r.kind === 'remote' || (r.kind === 'car' && r.obj.driver));
}

// ============================================================ SHARED WORLD (host simulates traffic + pedestrians, clients mirror them)
// Host:   WORLD_CARS / WORLD_PEDS are simulated normally and streamed at ~10 Hz ('wt') / ~6 Hz ('wp').
// Client: on 'welcome' it rebuilds its world cars/peds from the host's list, then only interpolates them (mode 'net').
//         Driving, damaging or killing a world object is routed to the host ('claim', 'release', 'cd', 'pk').
let WORLD_CARS = [], WORLD_PEDS = [];
const NW = { tT: 0, pT: 0 };
function markWorld() {
  WORLD_CARS = cars.filter(c => (c.mode === 'ai' || (c.mode === 'free' && !c.driver)) && !c.display && !c.owned && !c.home && !c.police && !c.delivery && !c.event && !c.remote);
  WORLD_CARS.forEach((c, i) => { c.wIdx = i; });
  WORLD_PEDS = peds.filter(p => !p.npc); WORLD_PEDS.forEach((p, i) => { p.wIdx = i; });
}
const carHex = c => '#' + c.paintM.color.getHexString(THREE.SRGBColorSpace);
function worldManifest() { return { wc: WORLD_CARS.map(c => [c.kind, carHex(c)]), wpl: WORLD_PEDS.map(p => p.look || DEFAULT_LOOK) }; }
const nearestPlayerDist = (x, z) => { let d = Math.hypot(x - player.pos.x, z - player.pos.z); if (MP.on && MP.host) for (const r of MP.remotes.values()) d = Math.min(d, Math.hypot(x - r.x, z - r.z)); return d; };
function popCenter() { if (!(MP.on && MP.host) || !MP.remotes.size || Math.random() < 1 / (MP.remotes.size + 1)) return player.pos; const rs = [...MP.remotes.values()].filter(r => r.x > -2000); const r = rs.length ? pick(rs) : null; return r ? { x: r.x, z: r.z } : player.pos; }
// ---------------- client: rebuild world from host manifest
function rebuildWorldFromHost(d) {
  if (!d.wc) return;
  if (state.inCar && state.inCar.wIdx >= 0) exitCar(true);
  for (const c of WORLD_CARS) { scene.remove(c.group); const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1); }
  WORLD_CARS = d.wc.map(([kind, hex], i) => {
    const c = kind === 'bike' ? createBike(hex, 0, -9999, 0, 'free') : createCar(kind, hex, 0, -9999, 0, 'free');
    Object.assign(c, { wIdx: i, mode: 'net', driver: kind !== 'bike', ai: null, net: { x: 0, z: 0, h: 0, vx: 0, vz: 0, t: 0, flags: 0, seen: false } }); c.group.visible = false; return c;
  });
  if (d.wpl) WORLD_PEDS.forEach((p, i) => {
    const look = d.wpl[i]; if (!look) { p.dead = true; p.h.g.visible = false; return; }
    const vis = p.h.g.visible; disposeHuman(p.h); p.h = makeHuman(look); p.h.g.visible = vis; p.look = look;
    p.net = { x: p.x, z: p.z, yaw: 0, dead: 0, mv: 0 }; p.netMode = true;
  });
  NW.client = true;
}
// ---------------- host: stream world state
function hostStreamWorld(dt) {
  NW.tT += dt; NW.pT += dt;
  if (NW.tT >= 0.1) {
    NW.tT = 0; const q = v => Math.round(v * 10) / 10;
    mpBroadcast({ t: 'wt', id: 'h', c: WORLD_CARS.map(c => { const p = c.group.position, hidden = c === state.inCar || c.claimedBy; return [q(p.x), q(p.z), Math.round(c.h * 100) / 100, q(c.y), (c.dead ? 1 : 0) | (hidden ? 2 : 0) | (c.active ? 0 : 2)]; }) });
  }
  if (NW.pT >= 0.16) {
    NW.pT = 0; const q = v => Math.round(v * 10) / 10;
    mpBroadcast({ t: 'wp', id: 'h', p: WORLD_PEDS.map(p => [q(p.x), q(p.z), Math.round(p.yaw * 100) / 100, p.dead ? 1 : 0, p.h.g.visible ? 1 : 0]) });
  }
}
// ---------------- client: apply + smooth
function applyWorldCars(arr) {
  const now = mpNow();
  arr.forEach((s, i) => {
    const c = WORLD_CARS[i]; if (!c || !c.net || c.mode === 'player') return;
    const n = c.net, dtp = Math.max(0.05, now - n.t);
    if (n.seen) { n.vx = (s[0] - n.x) / dtp; n.vz = (s[1] - n.z) / dtp; if (Math.hypot(n.vx, n.vz) > 60) n.vx = n.vz = 0; }
    if (!n.seen || Math.hypot(s[0] - c.group.position.x, s[1] - c.group.position.z) > 25) { c.group.position.set(s[0], s[3], s[1]); c.h = s[2]; }
    n.x = s[0]; n.z = s[1]; n.h = s[2]; n.y = s[3]; n.t = now; n.seen = true;
    const wasDead = c.dead; c.dead = !!(s[4] & 1); n.hidden = !!(s[4] & 2);
    if (c.dead && !wasDead) { c.paint.material = M.burnt; fxBoom(c.group.position.x, c.y + 1, c.group.position.z, clamp(1 - Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) / 120, 0, 1)); }
    if (!c.dead && wasDead) { c.paint.material = c.paintM; c.health = c.maxHealth; }
  });
}
function applyWorldPeds(arr) {
  arr.forEach((s, i) => {
    const p = WORLD_PEDS[i]; if (!p || !p.net) return;
    const n = p.net; n.mv = Math.hypot(s[0] - n.x, s[1] - n.z) / 0.16;
    if (Math.hypot(s[0] - p.x, s[1] - p.z) > 20) { p.x = s[0]; p.z = s[1]; }
    n.x = s[0]; n.z = s[1]; n.yaw = s[2]; n.vis = s[4];
    if (s[3] && !p.dead) { p.dead = true; p.deadT = 18; p.h.g.rotation.x = -Math.PI / 2; }
    else if (!s[3] && p.dead) { p.dead = false; p.h.g.rotation.x = 0; }
  });
}
function updateNetWorld(dt) {
  if (!NW.client) return;
  const vd = QUALITY === 'low' ? 170 : QUALITY === 'medium' ? 240 : 320, k = 1 - Math.exp(-10 * dt);
  for (const c of WORLD_CARS) {
    if (c.mode === 'player' || !c.net || !c.net.seen) continue;
    const n = c.net, ex = Math.min(mpNow() - n.t, 0.3), p = c.group.position;
    const tx = n.x + n.vx * ex, tz = n.z + n.vz * ex, ox = p.x, oz = p.z;
    p.x += (tx - p.x) * k; p.z += (tz - p.z) * k; c.y += (n.y - c.y) * k; p.y = c.y;
    c.h += wrapA(n.h - c.h) * k; c.group.rotation.set(0, c.h, 0);
    c.vx = (p.x - ox) / Math.max(dt, 1e-3); c.vz = (p.z - oz) / Math.max(dt, 1e-3);
    const sp = carFwd(c); c.spin += sp * dt / c.spec.wr; for (const s of c.spinners) if (c.spec.bike) s.rotation.x = c.spin; else s.rotation.z = -c.spin;
    c.active = !n.hidden; c.group.visible = !n.hidden && Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < vd;
  }
  const pv = QUALITY === 'low' ? 75 : QUALITY === 'medium' ? 130 : 180, kp = 1 - Math.exp(-8 * dt);
  for (const p of WORLD_PEDS) {
    if (!p.net) continue;
    const n = p.net; p.x += (n.x - p.x) * kp; p.z += (n.z - p.z) * kp;
    if (!p.dead) p.yaw += wrapA(n.yaw - p.yaw) * kp;
    const h = p.h; h.g.visible = !!n.vis && Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < pv;
    h.g.position.set(p.x, groundY(p.x, p.z) + (p.dead ? 0.12 : 0), p.z); h.g.rotation.y = p.yaw;
    if (h.g.visible && !p.dead) animHuman(h, Math.min(n.mv, 6), dt, false);
    // local player's car runs over a mirrored pedestrian -> tell the host
    const c = state.inCar;
    if (c && !p.dead && !c.spec.heli && !c.spec.boat && carSpeed(c) > 5 && Math.hypot(c.group.position.x - p.x, c.group.position.z - p.z) < 1.6) { killPed(p, true); AudioSys.thud(); }
  }
}
// ---------------- routing helpers (called from game code)
function netCarClaim(c) { if (NW.client && c.wIdx >= 0) mpSend({ t: 'claim', to: 'h', i: c.wIdx }); }
function netCarRelease(c) {
  if (!NW.client || !(c.wIdx >= 0)) return;
  const p = c.group.position; mpSend({ t: 'release', to: 'h', i: c.wIdx, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, h: Math.round(c.h * 100) / 100, dead: c.dead ? 1 : 0 });
  c.mode = 'net'; c.net.seen = false; c.net.hidden = false;
}
function hostHandleWorld(d) {
  if (!MP.host) return false;
  const c = WORLD_CARS[d.i];
  if (d.t === 'claim') { if (!c || c.claimedBy || c === state.inCar || c.dead) { mpSend({ t: 'claim_no', to: d.id, i: d.i }); return true; } c.claimedBy = d.id; c.ai = null; c.mode = 'claimed'; c.active = false; c.group.visible = false; return true; }
  if (d.t === 'release') { if (c && c.claimedBy === d.id) { releaseWorldCar(c, d); } return true; }
  if (d.t === 'cd') { if (c && !c.dead) damageCar(c, d.a); return true; }
  if (d.t === 'pk') { const p = WORLD_PEDS[d.i]; if (p && !p.dead) killPed(p, false); return true; }
  return false;
}
function releaseWorldCar(c, d) {
  c.claimedBy = null; c.active = true; c.group.visible = true; c.mode = d && d.dead ? 'dead' : 'free'; c.driver = false; c.vx = c.vz = 0;
  if (d) { c.h = d.h; c.y = groundY(d.x, d.z); c.group.position.set(d.x, c.y, d.z); c.group.rotation.set(0, c.h, 0); if (d.dead && !c.dead) explodeCar(c); }
}
function releaseClaimsOf(id) { for (const c of WORLD_CARS) if (c.claimedBy === id) { const r = MP.remotes.get(id); releaseWorldCar(c, r ? { x: r.x, z: r.z, h: r.r, dead: 0 } : null); } }

// ============================================================ MP STAGE 3: PvP, scoreboard, bounty, customization sync
const SB = { k: 0, d: 0, streak: 0, t: 0 };          // own session score
const BOUNTY_STREAK = 3;
const myBounty = () => SB.streak >= BOUNTY_STREAK ? Math.min(10000, SB.streak * 750) : 0;
function pvpHit(r, dmg, head) {
  mpSend({ t: 'hit', to: r.id, dmg: Math.round(dmg), head: head ? 1 : 0 });
  r.hp = Math.max(0, (r.hp || 100) - dmg); r.tagKey = '';
  if (head) floatText('🎯 Kafadan vuruş!');
}
function onPvpHit(d) {
  if (state.dead || state.spawnProt > 0) return;
  const r = MP.remotes.get(d.id);
  state.lastHitBy = d.id; state.lastHitT = state.now;
  if (state.inCar) { state.health -= d.dmg * 0.6; damageCar(state.inCar, d.dmg * 0.5); } else applyDamage(d.dmg);
  state.shake = Math.max(state.shake, 0.35); haptic(40);
  const el = $('dmgDir'); if (el && r) { const a = Math.atan2(r.x - player.pos.x, r.z - player.pos.z), rel = a - (camYaw + Math.PI); el.style.transform = `rotate(${-rel}rad)`; el.style.opacity = 1; clearTimeout(onPvpHit.t); onPvpHit.t = setTimeout(() => el.style.opacity = 0, 700); }
}
// called instead of the plain "fainted" when health hits 0
function onLocalDeath() {
  const killer = state.lastHitBy && state.now - (state.lastHitT || -99) < 6 && MP.remotes.get(state.lastHitBy);
  if (MP.on) {
    const bounty = myBounty();
    SB.d++; SB.streak = 0;
    mpSend({ t: 'kill', killer: killer ? killer.id : null, bounty });
    if (killer) { mpFeed(`☠ <b style="color:${killer.info.color}">${esc(killer.info.name)}</b> → <b style="color:${MP.color}">${esc(MP.name)}</b>`); playerDown('ÖLDÜRÜLDÜN', `${killer.info.name} seni alt etti${bounty ? ' · başındaki $' + bounty + ' ödül onun' : ''}`); }
    else playerDown('BAYILDIN', 'Hastanede uyandın');
    sendScore();
  } else playerDown('BAYILDIN', 'Hastanede uyandın');
  state.lastHitBy = null;
}
function onRemoteKill(d) {
  const victim = MP.remotes.get(d.id), killer = d.killer === MP.myId ? null : MP.remotes.get(d.killer);
  if (victim) { victim.dead = true; setTimeout(() => { if (victim) victim.dead = false; }, 4000); }
  if (d.killer === MP.myId) {
    SB.k++; SB.streak++; S().kills++;
    floatText(`☠ ${victim ? victim.info.name : 'Oyuncu'} alt edildi`); AudioSys.tone(220, 0.25, 0.25, 'sawtooth', 0.5);
    if (d.bounty > 0) { earn(d.bounty, '🎯 Ödül avı'); showBig('ÖDÜL ALINDI!', '#ff3050', 3, `+$${d.bounty} · ${victim ? victim.info.name : ''}`); AudioSys.cash(); }
    if (SB.streak === BOUNTY_STREAK) showBig('BAŞINA ÖDÜL KONDU', '#ff3050', 3, `$${myBounty()} · diğer oyuncular seni avlayabilir!`);
    sendScore();
  } else if (victim) mpFeed(killer ? `☠ <b style="color:${killer.info.color}">${esc(killer.info.name)}</b> → <b style="color:${victim.info.color}">${esc(victim.info.name)}</b>` : `💀 ${esc(victim.info.name)} bayıldı`);
}
function sendScore() { SB.t = 0; mpSend({ t: 'sb', k: SB.k, d: SB.d, rw: S().racesWon, m: Math.round(state.money), b: myBounty() }); }
function updateStage3(dt) {
  if (state.spawnProt > 0) state.spawnProt -= dt;
  if (!MP.on) return;
  SB.t += dt; if (SB.t > 3) sendScore();
}
function renderScoreboard() {
  const rows = [{ name: MP.name + ' (sen)', color: MP.color, k: SB.k, d: SB.d, rw: S().racesWon, m: Math.round(state.money), b: myBounty(), me: true }];
  for (const r of MP.remotes.values()) { const s = r.sb || {}; rows.push({ name: r.info.name, color: r.info.color, k: s.k || 0, d: s.d || 0, rw: s.rw || 0, m: s.m || 0, b: s.b || 0, dist: Math.round(Math.hypot(r.x - player.pos.x, r.z - player.pos.z)) }); }
  rows.sort((a, b) => b.k - a.k || a.d - b.d);
  return `<table class="sbT"><tr><th>#</th><th>Oyuncu</th><th>☠</th><th>💀</th><th>🏁</th><th>💵</th><th>🎯</th></tr>${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${r.color}"></i>${esc(r.name)}${r.dist != null ? ` <small>${r.dist} m</small>` : ''}</td><td>${r.k}</td><td>${r.d}</td><td>${r.rw}</td><td>$${(r.m / 1000).toFixed(1)}k</td><td>${r.b ? '<b class="bty">☠ $' + r.b + '</b>' : '—'}</td></tr>`).join('')}</table>`;
}
// ---------------- vehicle customization: underglow neon + rim colour
const NEONS = [['Pembe', '#ff2a9a'], ['Mavi', '#2a8cff'], ['Yeşil', '#20ff7a'], ['Mor', '#a040ff'], ['Turuncu', '#ff8a20'], ['Beyaz', '#ffffff']];
const RIMS = [['Krom', '#e8ecf0'], ['Siyah', '#26282c'], ['Altın', '#e0b040'], ['Kırmızı', '#d02020'], ['Mavi', '#2a6ad8'], ['Bronz', '#a06a3a']];
let glowTexture = null;
function applyCarStyle(c, neon, rim) {
  if (c.spec.boat || c.spec.heli) return;
  if (neon) {
    if (!glowTexture) glowTexture = glowTex();
    if (!c.neonMesh) { c.neonMesh = new THREE.Mesh(new THREE.PlaneGeometry((c.spec.W || 1.9) + 1.6, c.spec.bike ? 3 : 6.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })); c.neonMesh.position.y = 0.07; c.neonMesh.renderOrder = 2; c.group.add(c.neonMesh); }
    c.neonMesh.material.color.set(neon).multiplyScalar(1.6); c.neonMesh.visible = true;
  } else if (c.neonMesh) c.neonMesh.visible = false;
  if (rim) {
    if (!c.wheelMat) { c.wheelMat = M.wheel.clone(); for (const sp of c.spinners) sp.traverse(o => { if (o.isMesh) o.material = c.wheelMat; }); }
    c.wheelMat.color.set(rim);
  } else if (c.wheelMat) c.wheelMat.color.set('#ffffff');
}
function styleKey(c) { return c && c.up ? `${c.up.neon || ''}|${c.up.rim || ''}` : '|'; }
function garageStyleItems(c) {
  const it = [{ sec: 'Neon alt ışık' }];
  const sw = (n, hex) => `<i class="sw" style="background:${hex};box-shadow:0 0 8px ${hex}"></i>${n}`;
  for (const [n, hex] of NEONS) it.push({ name: sw(n, hex), desc: 'Aracın altında parlayan ışık · online herkese görünür', price: 1500, dis: c.up.neon === hex ? 'TAKILI' : null, buy: () => { c.up.neon = hex; c.owned = true; applyCarStyle(c, c.up.neon, c.up.rim); } });
  if (c.up.neon) it.push({ name: '✖ Neonu sök', desc: 'Alt ışığı kaldır', price: 0, btn: 'SÖK', buy: () => { c.up.neon = null; applyCarStyle(c, null, c.up.rim); } });
  it.push({ sec: 'Jant rengi' });
  for (const [n, hex] of RIMS) it.push({ name: sw(n, hex), desc: 'Jant boyası', price: 800, dis: (c.up.rim || '#e8ecf0') === hex ? 'TAKILI' : null, buy: () => { c.up.rim = hex; c.owned = true; applyCarStyle(c, c.up.neon, c.up.rim); } });
  return it;
}

// ============================================================ ENTERABLE BUILDINGS (a door on every building + procedural interiors)
const DOORS = [];
const DOOR_TYPE = { shop: 'shop', office: 'office', glass: 'office', brick: 'apt', deco: 'apt', house: 'home', warehouse: 'ware', terminal: 'terminal', tower: 'tower' };
const GEN_NAMES = { shop: ['Market', 'Kafe', 'Butik'], office: ['Ofis Binası'], apt: ['Apartman'], home: ['Ev'], ware: ['Depo'], terminal: ['Yolcu Terminali'], tower: ['Kontrol Kulesi'] };
function registerDoor(b, x, z, w, d, y0, style, forceSide, along = 0, h = 4) {
  const type = DOOR_TYPE[style] || 'apt';
  const dist = [(b.cz + BLOCK / 2) - (z + d / 2), (z - d / 2) - (b.cz - BLOCK / 2), (b.cx + BLOCK / 2) - (x + w / 2), (x - w / 2) - (b.cx - BLOCK / 2)];
  const side = forceSide ?? dist.indexOf(Math.min(...dist));
  const N = [[0, 1], [0, -1], [1, 0], [-1, 0]][side], face = side < 2 ? w : d, out = type === 'shop' ? 0.45 : 0.1;
  const fx = x + N[0] * (w / 2 + out) + (side < 2 ? along : 0), fz = z + N[1] * (d / 2 + out) + (side >= 2 ? along : 0);
  const door = { id: DOORS.length, type, style, fx, fz, x: fx + N[0] * 1.1, z: fz + N[1] * 1.1, nx: N[0], nz: N[1], y0, face, depth: side < 2 ? d : w, h, bld: b.bld[b.bld.length - 1], blk: b };
  DOORS.push(door); (b.doors || (b.doors = [])).push(door);
}
function buildDoorMeshes() {
  const wood = [], glassD = [], lamps = [];
  for (const d of DOORS) {
    const rot = Math.atan2(d.nx, d.nz), m = new THREE.Matrix4().compose(new THREE.Vector3(d.fx, d.y0, d.fz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
    const isGlass = d.type === 'shop' || d.type === 'office' || d.type === 'terminal' || d.type === 'tower';
    (isGlass ? glassD : wood).push(new THREE.BoxGeometry(d.type === 'ware' ? 3.4 : 1.5, d.type === 'ware' ? 3.4 : 2.4, 0.1).translate(0, d.type === 'ware' ? 1.7 : 1.2, 0).applyMatrix4(m));
    wood.push(new THREE.BoxGeometry(d.type === 'ware' ? 3.7 : 1.75, 0.14, 0.16).translate(0, d.type === 'ware' ? 3.45 : 2.47, 0.02).applyMatrix4(m));
    lamps.push(new THREE.BoxGeometry(0.5, 0.08, 0.12).translate(0, d.type === 'ware' ? 3.6 : 2.65, 0.12).applyMatrix4(m));
  }
  const add = (list, mat) => { if (!list.length) return; const mesh = new THREE.Mesh(mergeGeometries(list), mat); mesh.receiveShadow = true; scene.add(mesh); };
  add(wood, new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.7 }));
  add(glassD, new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.08, metalness: 0.85 }));
  M.doorLamp = new THREE.MeshBasicMaterial({ color: 0xffd9a0 }); add(lamps, M.doorLamp);
}
// ---------------- procedural interior
const GM = {};
function genMats() {
  if (GM.ready) return GM;
  const S = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, envMapIntensity: 0.22, ...o });
  Object.assign(GM, { ready: true, wallW: S(0xcfc6b8), wallC: S(0xb8bcc2), wallB: S(0xa89880), floorTile: S(0xc8c6c0, { roughness: 0.45 }), floorWood: new THREE.MeshStandardMaterial({ map: noiseTex('#8a6240', ['#7a5434', '#9a7048', '#6e4a2c'], 256, 4000, 1, 10), roughness: 0.55 }),
    floorCon: new THREE.MeshStandardMaterial({ map: noiseTex('#8a8a86', ['#7a7a76', '#9a9a96'], 256, 5000, 1, 4), roughness: 0.9 }), ceil: S(0xd8d6d0), wood: S(0x6a4a30, { roughness: 0.6 }), darkWood: S(0x3a2618, { roughness: 0.5 }),
    metal: S(0xb8bcc2, { metalness: 0.7, roughness: 0.3 }), fabricA: S(0x3a5a7a, { roughness: 0.95 }), fabricB: S(0x7a3a3a, { roughness: 0.95 }), fabricC: S(0x4a6a4a, { roughness: 0.95 }), white: S(0xf6f6f2),
    black: S(0x1a1a1c, { roughness: 0.4 }), crate: new THREE.MeshStandardMaterial({ map: noiseTex('#a8844e', ['#8a6a3a', '#c09a60', '#7a5a30'], 128, 2500, 1, 10), roughness: 0.9 }), plant: S(0x3a7a3a), pot: S(0xb05a3a),
    fridge: new THREE.MeshStandardMaterial({ color: 0xcfe8ff, emissive: 0x6aa8d8, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.3 }), screen: new THREE.MeshBasicMaterial({ color: 0x3a7ac8 }), panel: new THREE.MeshBasicMaterial({ color: 0xffe8c8 }), tv: new THREE.MeshBasicMaterial({ color: 0x3a7ac8 }), win: new THREE.MeshBasicMaterial({ color: 0x9cc8ec }), stair: S(0x8a847a, { roughness: 0.7 }),
    prod: new THREE.MeshStandardMaterial({ roughness: 0.6 }) });
  for (const k in GM) if (GM[k].isMeshStandardMaterial) GM[k].envMapIntensity = Math.min(GM[k].envMapIntensity, 0.22);
  return GM;
}
let genGroup = null;
function disposeGen() {
  if (!genGroup) return;
  genGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  scene.remove(genGroup);
  for (const h of (INTERIORS.gen && INTERIORS.gen.npcs) || []) disposeHuman(h);
  genGroup = null; delete INTERIORS.gen; state.crack = null;
}
// ---------------- multi-storey procedural interiors (stairs, elevator, per-floor interactions, roof access)
const FH = 4;                                   // storey height (matches facade floors)
const GEN_CD = new Map();                       // looted / robbed spots → time when available again
const cdLeft = k => Math.max(0, (GEN_CD.get(k) ?? -1e9) - state.now);
const FLOOR_NAMES = { Market: 'Market', Kafe: 'Kafe', Butik: 'Butik', storage: 'Depo · stok', apt: 'Daire', aptLobby: 'Apartman girişi', lobby: 'Lobi', office: 'Ofis katı', exec: 'Yönetim katı · kasa', control: 'Kontrol odası', living: 'Salon', bedroom: 'Yatak odası', ware: 'Depo', terminal: 'Terminal salonu' };
function doorFloors(d) { const cap = { office: 8, apt: 7, shop: 4, home: 3, ware: 1, tower: 4, terminal: 1 }[d.type] || 1; return clamp(Math.floor(((d.h || 4) + 0.5) / FH), 1, cap); }
const floorLabel = (I, k) => k === 0 ? 'Zemin Kat' : `${k}. Kat`;
const genFloorOf = I => I && I.FH ? clamp(Math.floor((player.pos.y + 0.6) / I.FH), 0, I.nF - 1) : 0;
function doorTitle(d) { const n = doorFloors(d); return (d.name || (d.type === 'shop' ? 'Dükkan' : GEN_NAMES[d.type][0])) + (n > 1 ? ` · ${n} kat` : ''); }
function genInteriorFor(door) {
  disposeGen(); const G = genMats(), id = door.id, rng = mulberry32(id * 7919 + 17), RR = (a, b) => a + rng() * (b - a), pk = a => a[Math.floor(rng() * a.length)];
  const type = door.type, nF = doorFloors(door), multi = nF > 1, hasRoof = !!door.roof;
  const variant = type === 'shop' ? pk(['Market', 'Kafe', 'Butik']) : null;
  let W = clamp(Math.round(door.face * 0.8), 10, 22), D = clamp(Math.round(door.depth * 0.75), 8, 18);
  if (multi || hasRoof) { W = Math.max(W, 15); D = Math.max(D, 13); }
  if (type === 'terminal') { W = 44; D = 26; }
  const FHh = multi ? FH : type === 'terminal' ? 9 : type === 'office' || type === 'tower' ? 5 : type === 'ware' ? 7 : 3.4;
  const ox = -3200 - (id % 12) * 70, oz = -2400 - Math.floor(id / 12) * 70, x0 = ox - W / 2, x1 = ox + W / 2, z0 = oz - D / 2, z1 = oz + D / 2;
  const root = new THREE.Group(); genGroup = root; scene.add(root);
  const I = { name: door.name || variant || GEN_NAMES[type][0], x0, x1, z0, z1, h: nF * FHh, FH: multi ? FH : 0, nF, boxes: [], spawn: [ox, z1 - 2.6, Math.PI], exitAt: [ox, z1 - 0.6], ext: [door.x, door.z], extOut: [door.x + door.nx * 1.2, door.z + door.nz * 1.2, Math.atan2(door.nx, door.nz)], gen: true, npcs: [], type, door, levels: [], stairs: [], spots: [], FG: [], floorNames: [], curF: -1 };
  INTERIORS.gen = I;
  for (let k = 0; k < nF; k++) { const g = new THREE.Group(); root.add(g); I.FG.push(g); }
  // geometry is collected per floor & material and merged → a handful of draw calls per storey
  const buckets = [];
  let K = 0, Y = 0;
  const geoAdd = (geo, mat) => { const m = buckets[K] || (buckets[K] = new Map()); if (!m.has(mat)) m.set(mat, []); m.get(mat).push(geo); };
  const box = (x, y, z, w, h, d, mat, solid = true, wall = false) => { geoAdd(new THREE.BoxGeometry(w, h, d).translate(x, Y + y + h / 2, z), mat); if (solid) I.boxes.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: Y + y, y1: Y + y + h, wall }); };
  const solidOnly = (x, z, w, d, h = 1.8) => I.boxes.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: Y, y1: Y + h });
  const cyl = (x, y, z, r, h, mat, solid = true) => { geoAdd(new THREE.CylinderGeometry(r, r, h, 12).translate(x, Y + y + h / 2, z), mat); if (solid) I.boxes.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: Y + y, y1: Y + y + h }); };
  const plant = (x, z) => { cyl(x, 0, z, 0.25, 0.5, G.pot); geoAdd(new THREE.IcosahedronGeometry(0.5, 1).translate(x, Y + 1.05, z), G.plant); };
  const spot = (x, z, kind, extra = {}) => I.spots.push({ f: K, x, z, kind, ...extra });
  const npc = (x, z, yaw = 0) => { if (I.npcs.length >= 5) return; const h = makeHuman(randLook()); h.g.position.set(x, Y, z); h.g.rotation.y = yaw; h.g.visible = true; h.f = K; I.npcs.push(h); };
  // layout: stair shaft (two lanes, switch-back) against the west wall, elevator + roof door on the back wall
  const zS = z0 + 1.8, SL = 6.4, zE = zS + SL, LA = [x0, x0 + 1.7], LB = [x0 + 1.7, x0 + 3.4];
  const rx0 = multi ? x0 + 3.8 : x0 + 0.4, rx1 = x1 - 0.4, rz0 = multi ? z0 + 2.6 : hasRoof ? z0 + 2.4 : z0 + 0.4, rz1 = z1 - 0.4;
  const rcx = (rx0 + rx1) / 2, rcz = (rz0 + rz1) / 2, RW = rx1 - rx0, RD = rz1 - rz0;
  const scoutK = nF >= 3 || type === 'tower' ? nF - 1 : -1;
  const free = (x, z, r = 1) => !(K === 0 && Math.abs(x - ox) < 1.8 + r && z > z1 - 3.6 - r) && !(K === scoutK && x > rx1 - 2.4 - r && Math.abs(z - rcz) < 1.6 + r) && !(hasRoof && K === nF - 1 && x < x0 + 8.6 + r && z < z0 + 2.4 + r);
  for (let s = 0; s < nF - 1; s++) {
    const A = s % 2 === 0, lane = A ? LA : LB, zb = A ? zS : zE, zt = A ? zE : zS;
    I.stairs.push({ x0: lane[0], x1: lane[1], za: zS, zb2: zE, zb, zt, y: s * FH });
    I.levels.push({ y: (s + 1) * FH, hole: { x0: lane[0], x1: lane[1], z0: zS, z1: zE } });
  }
  const floorM = type === 'ware' ? G.floorCon : type === 'shop' || type === 'office' || type === 'tower' || type === 'terminal' ? G.floorTile : G.floorWood, wallM = type === 'ware' ? G.wallC : type === 'apt' ? G.wallB : G.wallW;
  const kindOf = k => {
    if (type === 'terminal') return 'terminal';
    if (type === 'ware') return 'ware';
    if (type === 'shop') return k === 0 ? variant : k % 2 ? 'storage' : 'apt';
    if (type === 'office' || type === 'tower') return k === 0 ? 'lobby' : k === nF - 1 && nF >= 3 ? (type === 'tower' ? 'control' : 'exec') : 'office';
    if (type === 'apt') return k === 0 && multi ? 'aptLobby' : 'apt';
    if (type === 'home') return !multi ? 'apt' : k === 0 ? 'living' : 'bedroom';
    return 'apt';
  };
  // ---------- furniture sets (all positions inside the free region R)
  const FURN = {
    Market() {
      box(rx0 + 1.5, 0, rz1 - 2.6, 2.6, 1.05, 0.9, G.wood); box(rx0 + 1.0, 1.05, rz1 - 2.6, 0.4, 0.3, 0.35, G.black, false);
      spot(rx0 + 1.5, rz1 - 1.6, 'rob'); npc(rx0 + 1.5, rz1 - 3.5, 0);
      const rows = Math.max(1, Math.floor((RD - 5) / 2.6)), sx = (rx0 + 3.4 + rx1) / 2, len = Math.max(3, rx1 - rx0 - 4.6);
      const prods = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.36, 0.25), G.prod, rows * 60), m4l = new THREE.Matrix4(); let n = 0;
      for (let r = 0; r < rows; r++) {
        const z = rz0 + 1.8 + r * 2.6; box(sx, 0, z, len, 1.8, 0.6, G.metal);
        for (let lv = 0; lv < 3; lv++) for (const sd of [-0.18, 0.18]) for (let k = 0; k < 10; k++) { m4l.makeTranslation(sx - len / 2 + 0.4 + k * (len - 0.8) / 9, Y + 0.35 + lv * 0.55, z + sd); prods.setMatrixAt(n, m4l); prods.setColorAt(n++, new THREE.Color().setHSL(rng(), 0.7, 0.5)); }
      }
      prods.count = n; I.FG[K].add(prods);
      box(rcx, 0, rz0 + 0.4, RW - 1, 2.2, 0.7, G.fridge);
    },
    Kafe() {
      box(rx0 + 0.2, 0, rcz, 0.4, 2.2, RD * 0.5, G.wood); box(rx0 + 1.9, 0, rcz, 1.0, 1.05, RD * 0.5, G.darkWood);
      npc(rx0 + 0.9, rcz, Math.PI / 2); spot(rx0 + 3.0, rcz, 'rob');
      for (let x = rx0 + 4.6; x < rx1 - 1; x += 3) for (let z = rz0 + 1.4; z < rz1 - 1.2; z += 3) { if (!free(x, z, 1)) continue; cyl(x, 0, z, 0.5, 0.75, G.darkWood); for (const s of [-1, 1]) box(x + s * 0.9, 0, z, 0.45, 0.45, 0.45, G.fabricB, false); }
      plant(rx1 - 0.5, rz0 + 0.5); plant(rx1 - 0.5, rz1 - 1.6);
    },
    Butik() {
      box(rx0 + 1.5, 0, rz1 - 2.6, 2.4, 1.05, 0.9, G.white); spot(rx0 + 1.5, rz1 - 1.6, 'rob'); npc(rx0 + 1.5, rz1 - 3.5, 0);
      const cloth = [G.fabricA, G.fabricB, G.fabricC, G.wood, G.black];
      for (let x = rx0 + 4.4; x < rx1 - 1.5; x += 3.2) for (let z = rz0 + 1.2; z < rz1 - 4; z += 2.4) {
        if (!free(x, z, 1.5)) continue;
        box(x, 1.55, z, 2.4, 0.05, 0.05, G.metal, false); for (const s of [-1, 1]) box(x + s * 1.15, 0, z, 0.06, 1.6, 0.4, G.metal, false);
        for (let c = 0; c < 6; c++) box(x - 0.9 + c * 0.36, 0.55, z, 0.3, 0.95, 0.5, pk(cloth), false);
        solidOnly(x, z, 2.4, 0.5);
      }
      box(rx1 - 0.1, 0.2, rz0 + 1.5, 0.05, 2.0, 1.0, G.metal, false);
    },
    storage() {
      for (let i = 0; i < 10; i++) { const sz = RR(0.8, 1.4), x = RR(rx0 + 1, rx1 - 1), z = RR(rz0 + 2, rz1 - 1.2); if (!free(x, z, 1)) continue; const st = 1 + Math.floor(rng() * 3); for (let s = 0; s < st; s++) box(x, s * sz, z, sz, sz, sz, G.crate, s === 0); }
      box(rcx, 0, rz0 + 0.35, RW - 1.5, 2.2, 0.6, G.metal); spot(rcx, rz0 + 1.3, 'stock');
    },
    apt(bed = true, wardrobe = true) {
      const sx = rx0 + Math.min(3.2, RW * 0.3);
      box(sx, 0, rz0 + 0.6, 3.2, 0.45, 0.9, G.fabricC); box(sx, 0.45, rz0 + 0.2, 3.2, 0.5, 0.3, G.fabricC, false);
      box(sx, 0, rz0 + 2.0, 1.5, 0.4, 0.7, G.darkWood);
      box(sx, 0, rz0 + 3.5, 2.1, 0.55, 0.45, G.black); box(sx, 0.9, rz0 + 3.5, 1.9, 1.05, 0.06, G.tv, false);
      if (bed) { box(rx1 - 1.2, 0, rz0 + 1.5, 2.0, 0.55, 2.6, G.white); box(rx1 - 1.2, 0.55, rz0 + 0.3, 2.0, 0.5, 0.15, G.darkWood, false); box(rx1 - 1.2, 0.56, rz0 + 2.0, 2.05, 0.08, 1.5, G.fabricB, false); spot(rx1 - 1.2, rz0 + 3.3, 'bed'); }
      box(rx1 - 0.45, 0, rz1 - 2.4, 0.8, 0.95, 2.4, G.white); box(rx1 - 0.5, 0, rz1 - 0.6, 0.85, 2.0, 0.8, G.metal);
      if (wardrobe) { box(rcx + 1.0, 0, rz0 + 0.35, 1.8, 2.1, 0.6, G.wood); spot(rcx + 1.0, rz0 + 1.3, 'loot'); }
      cyl(rx0 + 2.4, 0, rz1 - 2.4, 0.6, 0.76, G.wood); for (const a of [0, 1, 2, 3]) box(rx0 + 2.4 + Math.cos(a * Math.PI / 2) * 1.0, 0, rz1 - 2.4 + Math.sin(a * Math.PI / 2) * 1.0, 0.4, 0.45, 0.4, G.darkWood, false);
      plant(rx0 + 0.5, rz1 - 0.5);
      if (rng() < 0.5) npc(rcx, rcz + 0.5, Math.PI);
    },
    living() { FURN.apt(false, true); },
    bedroom() {
      box(rcx, 0, rz0 + 1.5, 2.0, 0.55, 2.6, G.white); box(rcx, 0.55, rz0 + 0.3, 2.0, 0.6, 0.15, G.darkWood, false); box(rcx, 0.56, rz0 + 2.0, 2.05, 0.08, 1.5, G.fabricA, false); spot(rcx, rz0 + 3.3, 'bed');
      box(rx0 + 0.4, 0, rcz, 0.6, 2.1, 1.8, G.wood); spot(rx0 + 1.3, rcz, 'loot');
      box(rx1 - 1.2, 0, rz1 - 1.5, 1.6, 0.76, 0.7, G.darkWood); box(rx1 - 1.2, 0.76, rz1 - 1.5, 0.5, 0.03, 0.35, G.black, false);
      box(rcx, 0.01, rcz + 1.5, 3, 0.02, 2, G.fabricB, false); plant(rx1 - 0.5, rz0 + 0.5);
    },
    aptLobby() {
      box(rx0 + 0.25, 0, rcz, 0.35, 1.7, Math.min(4, RD - 2), G.metal);
      box(rx1 - 0.6, 0, rcz, 0.9, 0.45, 3, G.fabricA); box(rx1 - 0.2, 0.45, rcz, 0.3, 0.45, 3, G.fabricA, false);
      box(rcx, 0.01, rcz, 3, 0.02, 4, G.fabricB, false); plant(rx1 - 0.6, rz0 + 0.6); plant(rx0 + 0.6, rz1 - 0.6);
    },
    lobby() {
      box(rcx, 0, rcz - 1, 4, 1.1, 1, G.white); box(rcx, 1.1, rcz - 1, 4.2, 0.06, 1.2, G.darkWood, false); npc(rcx, rcz - 1.9, 0);
      for (const s of [-1, 1]) { box(rcx + s * (RW / 2 - 1.0), 0, rcz + 1.5, 1, 0.45, 3, G.fabricA); plant(rcx + s * (RW / 2 - 0.6), rz1 - 1.2); }
      box(rcx + (multi ? 2.5 : 0), 2.2, z0 + 0.05, 3.4, 0.9, 0.06, G.screen, false);
    },
    office() {
      let first = true, wk = 0;
      for (let x = rx0 + 1.2; x < rx1 - 1; x += 2.8) for (let z = rz0 + 0.8; z < rz1 - 1.4; z += 2.6) {
        if (!free(x, z, 1)) continue;
        box(x, 0, z, 1.6, 0.75, 0.8, G.white); box(x, 0.75, z - 0.2, 0.62, 0.42, 0.05, G.screen, false); box(x, 0, z + 0.7, 0.5, 0.5, 0.5, G.fabricA, false);
        if (first) { spot(x, z + 1.15, 'hack'); first = false; } else if (wk++ === 2) npc(x, z + 0.75, Math.PI);
      }
      plant(rx1 - 0.5, rz1 - 0.5); cyl(rx0 + 0.4, 0, rz1 - 0.5, 0.25, 1.2, G.white);
    },
    exec() {
      box(rcx, 0, rcz - 0.5, 3.2, 0.78, 1.4, G.darkWood); box(rcx, 0, rcz + 0.6, 0.7, 1.1, 0.7, G.black, false);
      box(rx0 + 0.3, 0, rcz, 0.4, 2.2, 4, G.wood); box(rcx, 0, rz1 - 1, 3, 0.45, 0.9, G.fabricA); box(rcx, 0.45, rz1 - 0.6, 3, 0.45, 0.25, G.fabricA, false);
      box(rx1 - 0.6, 0, rz0 + 0.6, 0.9, 1.2, 0.85, G.black); geoAdd(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12).rotateX(Math.PI / 2).translate(rx1 - 0.6, Y + 0.75, rz0 + 1.05), G.metal);
      spot(rx1 - 0.6, rz0 + 1.6, 'safe'); plant(rx0 + 0.6, rz1 - 0.6); npc(rcx, rcz - 1.6, 0);
    },
    control() {
      for (let x = rx0 + 1; x < rx1 - 1; x += 2.2) { box(x, 0, rz1 - 0.6, 2, 1, 0.9, G.black); box(x, 1.0, rz1 - 0.35, 1.8, 0.5, 0.06, G.screen, false); }
      box(rcx, 0, rcz - 0.5, 2.4, 0.78, 1.2, G.white); box(ox, 0.9, z1 - 0.03, W - 1, 2.6, 0.05, G.win, false); npc(rcx, rcz + 0.4, Math.PI);
    },
    ware() {
      for (let k = 0; k < 12; k++) { const sz = RR(0.9, 1.6), x = RR(rx0 + 1.6, rx1 - 1.6), z = RR(rz0 + 2.2, rz1 - 4); if (!free(x, z, 1.5)) continue; const st = 1 + Math.floor(rng() * 3); for (let s = 0; s < st; s++) box(x, s * sz, z, sz, sz, sz, G.crate, s === 0); }
      for (const s of [-1, 1]) box(ox + s * (W / 2 - 0.8), 0, oz + 1, 1, 4.5, D - 5, G.metal);
      for (let k = 0; k < 4; k++) cyl(RR(rx0 + 2, rx1 - 2), 0, rz1 - 4 + RR(-1, 1), 0.35, 0.95, k % 2 ? G.fabricB : G.fabricA);
      box(rcx + 2, 0, rz0 + 0.5, 3, 0.95, 0.9, G.wood); spot(rcx + 2, rz0 + 1.5, 'stock');
      if (rng() < 0.5) npc(rcx - 2, rz0 + 1.5, 0);
    },
    terminal() {
      for (let x = rx0 + 5; x < rx1 - 3; x += 4.6) { box(x, 0, rz0 + 2.6, 3, 1.05, 1, G.white); box(x, 1.5, rz0 + 1.6, 3, 1.1, 0.08, G.screen, false); box(x + 1.8, 0, rz0 + 2.6, 0.6, 0.5, 1, G.black); if (x < rx0 + 20) npc(x, rz0 + 1.9, 0); }
      for (let x = rx0 + 3; x < rx1 - 3; x += 7) for (let z = rcz + 1; z < rz1 - 4; z += 2.4) { if (!free(x, z, 3)) continue; box(x, 0, z, 6, 0.45, 0.6, G.fabricA); box(x, 0.45, z + 0.27, 6, 0.45, 0.08, G.fabricA, false); }
      for (const [x, z] of [[ox - 11, rcz - 1], [ox + 11, rcz - 1], [ox - 11, rz1 - 5], [ox + 11, rz1 - 5]]) cyl(x, 0, z, 0.5, FHh, G.white);
      cyl(ox, 0, rcz - 1.5, 1.4, 1.1, G.darkWood); npc(ox, rcz - 1.5 + 0.1, Math.PI);
      for (const s of [-1, 1]) { box(ox + s * (W / 2 - 0.03), 1.6, oz, 0.05, 5, D - 6, G.win, false); plant(ox + s * 4, rz1 - 1.2); }
      const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), new THREE.MeshBasicMaterial({ map: canvasTex(768, 256, g => {
        g.fillStyle = '#0b0f16'; g.fillRect(0, 0, 768, 256); g.fillStyle = '#ffd23a'; g.font = 'bold 34px Arial'; g.fillText('✈ KALKIŞLAR', 20, 42);
        g.font = 'bold 26px monospace'; const rows = [['VB101', 'PALMİYE ADASI', '14:20', 'ZAMANINDA'], ['VB204', 'FENER ADASI', '15:05', 'BİNİŞ'], ['VB330', 'MERCAN KOYU', '16:40', 'ZAMANINDA'], ['VB415', 'KUZEY BURNU', '18:10', 'RÖTAR']];
        rows.forEach((r, i) => { const y = 92 + i * 42; g.fillStyle = '#e8e8e8'; g.fillText(r[0], 20, y); g.fillText(r[1], 130, y); g.fillText(r[2], 470, y); g.fillStyle = r[3] === 'RÖTAR' ? '#ff6a4a' : '#6aff8a'; g.fillText(r[3], 580, y); });
      }), toneMapped: false }));
      board.position.set(ox + 4, Y + 5.2, z0 + 0.1); I.FG[K].add(board); I.board = board;
    }
  };
  // ---------- per floor shell + content
  for (let k = 0; k < nF; k++) {
    K = k; Y = k * FHh;
    if (k === 0) box(ox, -0.05, oz, W, 0.1, D, floorM, false);
    else {
      const h = I.levels[k - 1].hole, parts = [[x0, x1, z0, h.z0], [x0, x1, h.z1, z1], [h.x1, x1, h.z0, h.z1], [x0, h.x0, h.z0, h.z1]];
      for (const [a, b, c, d] of parts) if (b - a > 0.01 && d - c > 0.01) { box((a + b) / 2, -0.2, (c + d) / 2, b - a, 0.18, d - c, floorM, false); box((a + b) / 2, -0.22, (c + d) / 2, b - a, 0.02, d - c, G.ceil, false); }
    }
    if (k === nF - 1) box(ox, FHh, oz, W + 0.6, 0.2, D + 0.6, G.ceil, false);
    for (const [x, z, w, d] of [[ox, z0 - 0.15, W + 0.6, 0.3], [ox, z1 + 0.15, W + 0.6, 0.3], [x0 - 0.15, oz, 0.3, D], [x1 + 0.15, oz, 0.3, D]]) box(x, 0, z, w, FHh, d, wallM, false);
    const np = Math.max(2, Math.floor(W / 5)); for (let p = 0; p < np; p++) box(x0 + (p + 0.5) * W / np, FHh - 0.06, oz + (multi ? 2 : 0), 1.6, 0.05, 0.6, G.panel, false);
    if (k > 0 || type === 'apt' || type === 'home' || type === 'office' || type === 'tower') { for (const s of [-1, 1]) box(x1 - 0.02, 1.0, oz + s * D / 4, 0.04, 1.6, D / 3.2, G.win, false); if (k > 0) for (const s of [-1, 1]) box(ox + s * W / 4, 1.0, z1 - 0.02, W / 4, 1.6, 0.04, G.win, false); }
    if (multi) {
      // shaft walls (divider between the two flights + wall to the room)
      box(x0 + 1.7, 0, (zS + zE) / 2, 0.12, FH, SL, wallM, true, true); box(x0 + 3.4, 0, (zS + zE) / 2, 0.14, FH, SL, wallM, true, true);
      // elevator
      box(x0 + 4.7, 0, z0 + 0.13, 2.2, 2.6, 0.26, G.metal, true, true); box(x0 + 4.7, 0.05, z0 + 0.28, 0.04, 2.3, 0.04, G.black, false); box(x0 + 4.7, 2.75, z0 + 0.2, 0.6, 0.25, 0.08, G.panel, false);
      spot(x0 + 4.7, z0 + 1.25, 'elev');
    }
    if (hasRoof && k === nF - 1) {
      if (multi) { box(x0 + 7.2, 0, z0 + 0.06, 1.2, 2.3, 0.1, G.darkWood, false); box(x0 + 7.2, 2.5, z0 + 0.08, 0.9, 0.3, 0.05, G.panel, false); spot(x0 + 7.2, z0 + 1.0, 'roof'); }
      else { for (const s of [-1, 1]) box(x0 + 7.2 + s * 0.4, 0, z0 + 0.15, 0.06, FHh, 0.06, G.metal, false); for (let y = 0.35; y < FHh; y += 0.35) box(x0 + 7.2, y, z0 + 0.15, 0.8, 0.04, 0.04, G.metal, false); spot(x0 + 7.2, z0 + 1.0, 'roof', { ladder: true }); }
      I.roofAt = [x0 + 7.2, z0 + 1.1, k * FHh];
    }
    const kind = kindOf(k); FURN[kind](); I.floorNames[k] = FLOOR_NAMES[kind];
    if (k === scoutK) { box(x1 - 0.03, 0.8, rcz, 0.05, 2.4, Math.min(8, D - 3), G.win, false); spot(x1 - 1.0, rcz, 'scout'); I.floorNames[k] += ' · manzara'; }
  }
  // stairs: solid flights, a block under the high end and a rail at the stairwell opening above
  for (let s = 0; s < nF - 1; s++) {
    const st = I.stairs[s], dir = Math.sign(st.zt - st.zb), cx = (st.x0 + st.x1) / 2, n = 16;
    K = s; Y = s * FH;
    for (let i = 0; i < n; i++) box(cx, 0, st.zb + dir * (i + 0.5) * SL / n, 1.66, (i + 1) * FH / n, SL / n + 0.02, G.stair, false);
    const a = st.zb + dir * 1.6, b = st.zt; I.boxes.push({ x0: st.x0, x1: st.x1, z0: Math.min(a, b), z1: Math.max(a, b), y0: Y, y1: Y + 0.7 });
    K = s + 1; Y = (s + 1) * FH;
    box(cx, 0, st.zb + dir * 0.06, 1.7, 1.05, 0.12, G.metal, true);
  }
  // entrance door + exit ring (ground floor)
  K = 0; Y = 0;
  box(ox, 0, z1 - 0.02, 1.6, 2.4, 0.08, G.darkWood, false);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x40e080, transparent: true, opacity: 0.85, depthWrite: false })); ring.position.set(ox, 0.06, z1 - 1.2); I.FG[0].add(ring);
  if (multi) I.elev = [x0 + 4.7, z0 + 1.4];
  for (let k = 0; k < buckets.length; k++) if (buckets[k]) for (const [mat, list] of buckets[k]) { const m = new THREE.Mesh(merge(list), mat); m.receiveShadow = true; I.FG[k].add(m); for (const g of list) g.dispose(); }
  return I;
}
function genSetFloor(I) {
  const f = genFloorOf(I); if (f === I.curF) return; I.curF = f;
  I.FG.forEach((g, k) => g.visible = Math.abs(k - f) <= 1);
  for (const h of I.npcs) h.g.visible = Math.abs(h.f - f) <= 1;
  const fy = f * (I.FH || 0), fh = I.FH || I.h;
  interiorLight.position.set((I.x0 + I.x1) / 2, fy + fh - 0.6, (I.z0 + I.z1) / 2);
  interiorLight.color.set(I.type === 'ware' ? 0xfff0d8 : 0xfff4e6);
  interiorLight.intensity = I.type === 'ware' ? 24 : I.type === 'terminal' ? 45 : 14;
}
function enterGeneric(door, fromRoof) {
  const f = $('fade'); f.style.opacity = 1;
  setTimeout(() => {
    const I = genInteriorFor(door);
    state.interior = 'gen';
    if (fromRoof && I.roofAt) { player.pos.set(I.roofAt[0], I.roofAt[2], I.roofAt[1]); player.yaw = 0; }
    else { player.pos.set(I.spawn[0], 0, I.spawn[1]); player.yaw = I.spawn[2]; }
    player.vy = 0; player.onGround = true; camYaw = player.yaw + Math.PI; camDist = 3;
    genSetFloor(I);
    f.style.opacity = 0; floatText(`🚪 ${I.name}${I.nF > 1 ? ' · ' + floorLabel(I, I.curF) : ''}`);
  }, 300);
}
function elevTo(I, k) {
  const f = $('fade'); f.style.opacity = 1; AudioSys.tone(660, 0.12, 0.15, 'sine');
  setTimeout(() => {
    if (INTERIORS.gen !== I || state.interior !== 'gen') { f.style.opacity = 0; return; }
    player.pos.set(I.elev[0], k * I.FH, I.elev[1]); player.vy = 0; player.onGround = true; player.yaw = 0; camYaw = Math.PI;
    genSetFloor(I); f.style.opacity = 0; AudioSys.tone(990, 0.18, 0.15, 'sine'); floatText(`🛗 ${floorLabel(I, k)} · ${I.floorNames[k]}`);
  }, 450);
}
function goRoof(door) {
  const R = door.roof; if (!R) return;
  const f = $('fade'); f.style.opacity = 1; state.crack = null;
  setTimeout(() => {
    state.interior = null; interiorLight.intensity = 0; disposeGen();
    player.pos.set(R.sx, R.y, R.sz); player.vy = 0; player.onGround = true; player.yaw = R.yaw; camYaw = R.yaw + Math.PI; camDist = 4.6;
    f.style.opacity = 0; floatText(`🏙 Çatı · ${Math.round(R.y)} m`);
  }, 350);
}
function elevItems() {
  const I = INTERIORS.gen; if (!I || !I.elev) return [];
  const it = [{ sec: `${I.name} · ${I.nF} kat` }];
  if (I.door.roof) it.push({ name: '🏙 Çatı', desc: `Açık hava · ${Math.round(I.door.roof.y)} m · helikopter iniş alanı`, price: 0, btn: 'ÇIK', close: true, buy: () => goRoof(I.door) });
  for (let k = I.nF - 1; k >= 0; k--) it.push({ name: floorLabel(I, k), desc: I.floorNames[k], price: 0, btn: 'GİT', dis: k === I.curF ? 'BURADASIN' : null, close: true, buy: () => elevTo(I, k) });
  return it;
}
// ---------- interaction points inside buildings
const cdKey = (I, s) => `${I.door.id}:${s.kind}:${s.f}`;
const cdTag = (I, s, label) => { const l = cdLeft(cdKey(I, s)); return l > 0 ? `${label.split(' ')[0]} BOŞ · ${Math.ceil(l)} sn sonra` : label; };
function genReward(I, s, cd, range, heat, chance, label) {
  const key = cdKey(I, s); if (cdLeft(key) > 0) { floatText('⏳ Burası yakın zamanda boşaltıldı'); AudioSys.fail(); return false; }
  GEN_CD.set(key, state.now + cd);
  const amt = Math.round(MR(range[0], range[1]) / 10) * 10; earn(amt, label); AudioSys.cash(); haptic(30); floatText(`${label} +$${amt}`);
  if (heat && Math.random() < chance) { addHeat(heat); setTimeout(() => floatText('🚨 Polis haberdar edildi!'), 700); }
  return true;
}
const SPOTS = {
  bed: { label: () => '🛏 DİNLEN', fn: () => { state.health = 100; floatText('😴 Dinlendin · can doldu'); } },
  elev: { label: () => '🛗 ASANSÖR', fn: () => openShop('elev') },
  roof: { label: s => s.ladder ? '🪜 ÇATIYA ÇIK' : '🏙 ÇATIYA ÇIK', fn: (s, I) => goRoof(I.door) },
  rob: { label: (s, I) => cdTag(I, s, '💰 KASAYI SOY'), fn: (s, I) => { if (genReward(I, s, 480, [250, 900], 2, 1, '💰 Kasa soygunu')) S().robberies++; } },
  hack: { label: (s, I) => cdTag(I, s, '💻 BİLGİSAYARI HACKLE'), fn: (s, I) => genReward(I, s, 300, [300, 900], 1, 0.35, '💻 Veri satışı') },
  loot: { label: (s, I) => cdTag(I, s, '🧳 ÇEKMECELERİ KARIŞTIR'), fn: (s, I) => genReward(I, s, 240, [40, 260], 1, 0.3, '🧳 Ev hırsızlığı') },
  stock: { label: (s, I) => cdTag(I, s, '📦 STOKLARI KARIŞTIR'), fn: (s, I) => { if (genReward(I, s, 300, [60, 220], 0, 0, '📦 Stok satışı') && state.ownedW[1]) { state.ammo[1] += 30; floatText('🔫 +30 mermi bulundu'); } } },
  safe: { label: (s, I) => cdTag(I, s, '🔐 KASAYI KIR · 4 sn bekle'), fn: (s, I) => { if (cdLeft(cdKey(I, s)) > 0) { floatText('⏳ Kasa boş'); AudioSys.fail(); return; } state.crack = { s, t: 0, tick: -1 }; } },
  scout: { label: (s, I) => cdTag(I, s, '🔭 GÖZETLE'), fn: (s, I) => { const key = cdKey(I, s); if (cdLeft(key) > 0) return; GEN_CD.set(key, state.now + 60); const tw = I.type === 'tower'; state.scoutT = tw ? 90 : 45; state.scoutR = tw ? 3000 : 450; showBig('🔭 GÖZETLEME', '#7dd8ff', 2.5, tw ? 'Tüm şehir radarda · gizli paketler haritada' : 'Yakındaki gizli paketler haritada işaretlendi'); AudioSys.pickup(); } },
};
function updateDoors() {
  if (state.interior || state.inCar || state.dead || state.interact || state.passenger) return;
  const px = player.pos.x, pz = player.pos.z, py = player.pos.y;
  const b = blockAt(px, pz) || (inAirport(px, pz) ? AIRPORT.blk : null); if (!b || !b.doors) return;
  for (const d of b.doors) {
    if (py < d.y0 + 2 && Math.hypot(px - d.x, pz - d.z) < 1.5) { state.interact = { label: `🚪 GİR · ${doorTitle(d)}`, fn: () => enterGeneric(d) }; return; }
    if (d.roof && Math.abs(py - d.roof.y) < 1.2 && Math.hypot(px - d.roof.ix, pz - d.roof.iz) < 1.4) { state.interact = { label: `🚪 MERDİVENDEN İN · ${doorTitle(d)}`, fn: () => enterGeneric(d, true) }; return; }
  }
}
function updateGenInterior(dt) {
  const I = INTERIORS.gen; if (!I) return;
  genSetFloor(I);
  for (const h of I.npcs) if (h.f === I.curF) { animHuman(h, 0, dt, false); h.g.rotation.y = Math.atan2(player.pos.x - h.g.position.x, player.pos.z - h.g.position.z); }
  GM.tv.color.setHSL(0.58 + Math.sin(state.now * 0.7) * 0.05, 0.6, 0.35 + Math.sin(state.now * 3.1) * 0.08);
  const day = 1 - nightF; GM.win.color.setRGB(lerp(0.05, 0.62, day), lerp(0.07, 0.78, day), lerp(0.14, 0.92, day));
  if (state.crack) {
    const c = state.crack;
    if (c.s.f !== I.curF || Math.hypot(player.pos.x - c.s.x, player.pos.z - c.s.z) > 1.8) { state.crack = null; floatText('🔐 Kasa kırma yarıda kaldı'); }
    else {
      c.t += dt; state.interact = { label: `🔐 KASA AÇILIYOR… %${Math.floor(Math.min(1, c.t / 4) * 100)}`, fn: null };
      const tk = Math.floor(c.t * 4); if (tk !== c.tick) { c.tick = tk; AudioSys.tone(1400 + (tk % 3) * 200, 0.04, 0.08, 'square'); }
      if (c.t >= 4) { state.crack = null; if (genReward(I, c.s, 900, [2500, 6000], 3, 1, '🔐 Kasa soygunu')) { S().robberies++; showBig('KASA AÇILDI!', '#ffd23a', 2.5, '🚨 Alarm çaldı — polis yolda'); } }
      return;
    }
  }
  if (state.interact) return;
  for (const s of I.spots) if (s.f === I.curF && Math.abs(player.pos.y - s.f * (I.FH || 0)) < 1.6 && Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 1.3) { const d = SPOTS[s.kind]; state.interact = { label: d.label(s, I), fn: d.fn ? () => d.fn(s, I) : null }; return; }
}
// stair huts with a door on flat roofs → walk down into the top floor
function buildRoofAccess() {
  const parts = [], doors = [], q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const d of DOORS) {
    const o = d.bld; if (!o || o.pitch || o.arch || d.type === 'home' || d.noRoof) continue;
    const span = d.nz ? o.z1 - o.z0 : o.x1 - o.x0, along = d.nz ? o.x1 - o.x0 : o.z1 - o.z0;
    if (span < 11 || along < 7) continue;
    if (HELIPADS.some(p => p[1] > 1 && p[0] > o.x0 - 4 && p[0] < o.x1 + 4 && p[2] > o.z0 - 4 && p[2] < o.z1 + 4)) continue;
    const ex = d.nx > 0 ? o.x1 : d.nx < 0 ? o.x0 : clamp(d.fx, o.x0 + 2.5, o.x1 - 2.5), ez = d.nz > 0 ? o.z1 : d.nz < 0 ? o.z0 : clamp(d.fz, o.z0 + 2.5, o.z1 - 2.5);
    const at = k => [ex - d.nx * k, ez - d.nz * k], [hx, hz] = at(2.9), [ix, iz] = at(5.0), [sx, sz] = at(5.6), y = o.h;
    if (roofHeight(sx, sz) > y + 0.1 || roofHeight(ix, iz) > y + 0.1 || roofHeight(hx, hz) > y + 0.1) continue;
    d.roof = { y, ix, iz, sx, sz, yaw: Math.atan2(-d.nx, -d.nz) };
    const hw = d.nz ? 2.8 : 2.4, hd = d.nz ? 2.4 : 2.8;
    (d.blk ? d.blk.bld : EXTRA_BLD).push({ x0: hx - hw / 2, x1: hx + hw / 2, z0: hz - hd / 2, z1: hz + hd / 2, h: y + 2.7, hut: true });
    parts.push(new THREE.BoxGeometry(hw, 2.7, hd).translate(hx, y + 1.35, hz), new THREE.BoxGeometry(hw + 0.3, 0.15, hd + 0.3).translate(hx, y + 2.77, hz));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(hx - d.nx * 1.22, y, hz - d.nz * 1.22), q.setFromAxisAngle(up, Math.atan2(-d.nx, -d.nz)), one);
    doors.push(new THREE.BoxGeometry(1.1, 2.2, 0.06).translate(0, 1.1, 0).applyMatrix4(m), new THREE.BoxGeometry(0.4, 0.06, 0.1).translate(0, 2.4, 0.03).applyMatrix4(m));
  }
  if (!parts.length) return;
  const hut = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.9 })); hut.castShadow = QUALITY !== 'low'; hut.receiveShadow = true; scene.add(hut);
  const dm = new THREE.Mesh(merge(doors), new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.7 })); scene.add(dm);
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
  let dt = clamp((now - lastT) / 1000, 0, 0.05); lastT = now;
  state.realDt = dt; state.timeScale = damp(state.timeScale, state.timeTarget, 6, dt); dt *= state.timeScale;
  if (state.hidden) return;
  updatePerf(state.realDt);
  mpUpdate(state.realDt);
  if (state.shopOpen || state.dialog) { if (composer) composer.render(); else renderer.render(scene, camera); return; }
  if (state.photo) { updatePhoto(dt); return; }
  state.now += dt; frame++;
  state.saveT += dt; if (state.saveT > 12) { state.saveT = 0; saveGame(); }
  readInput();
  updateSky(dt);
  if (state.dead) { state.deadTimer -= dt; if (state.deadTimer <= 0) respawn(); }
  else {
    if (state.passenger) updatePassenger(dt); else if (state.inCar) updatePlayerCar(dt); else updatePlayerFoot(dt);
    if (input.fire) fire();
  }
  if (state.fireCd > 0) state.fireCd -= dt;
  for (const c of cars) {
    if (c === state.inCar) { c.group.visible = true; continue; }
    if (!c.active) continue;
    if (c.mode === 'ai') { const d = Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z); if (d > 300 && frame % 3) continue; updateAI(c, dt); }
    else if (c.mode === 'free' || c.mode === 'dead') {
      if (c.spec.boat) { if (Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) < 300) boatPhysics(c, dt, 0, 0); }
      else if (c.spec.heli) { if (c.power > 0.01 || c.dead || c.y > heliFloor(c) + 0.05) heliPhysics(c, dt, 0, 0, 0); }
      else if (carSpeed(c) > 0.05 || c.air) carPhysics(c, dt, 0, 0, c.mode === 'dead');
    }
    c.group.visible = Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) < (QUALITY === 'low' ? 170 : QUALITY === 'medium' ? 240 : 320);
  }
  const pd = updatePolice(dt);
  carCollisions();
  updatePeds(dt);
  updatePickups(dt);
  updateMission(dt);
  updateShops(dt);
  updateStarts(dt);
  updateEconomy(dt);
  updateGang(dt);
  updateTurfs(dt);
  updateStoryGiver(dt);
  updateInteriors(dt);
  updateStage2(dt);
  updateStage3(dt);
  updateDoors();
  updateAirport(dt);
  updateNetWorld(dt);
  updateCrosshair(dt);
  cullChunks(dt);
  updateEvents(dt);
  updatePackages(dt);
  recyclePopulation(dt);
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
  if (state.health <= 0 && !state.dead) onLocalDeath();
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
  if (!renderer.shadowMap.autoUpdate && frame % 2 === 0) renderer.shadowMap.needsUpdate = true;
  if (composer) composer.render(); else renderer.render(scene, camera);
}


initLobby();
addEventListener('beforeunload', () => { if (MP.on) mpLeave(true); });
