// NEON BAY — open world city game (Three.js)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ============================================================ CONSTANTS
const N = 8, CELL = 90, ROAD = 18, BLOCK = CELL - ROAD, HALF = N * CELL / 2, OFF = -HALF;
const BEACH_X0 = HALF + ROAD / 2;
const SHORE_X = BEACH_X0 + 110;          // sand begins to slope here
const WATERLINE = SHORE_X + 5.4;         // visual shoreline
const BOUNDS = { x0: -HALF - 70, x1: WATERLINE + 2, z0: -HALF - 70, z1: HALF + 70 };
const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const TIME_SPEED = 24 / 600;             // 10 minute day
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
    $('hud').style.display = 'block';
    if (isTouch) $('touch').style.display = 'block'; else $('cross').style.display = 'block';
    showBig('NEON BAY', '#ff4fa0', 2.5, 'Şehir senin. Bir araba çal ve işaretlere ulaş!');
    setTimeout(newMission, 3000);
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
  money: 0, shownMoney: 0, health: 100, armor: 0, heat: 0, wanted: 0, time: 17.85, inCar: null,
  mission: null, missionCooldown: 0, dead: false, deadTimer: 0, fireCd: 0, lastLookInput: 0,
  shake: 0, combo: 0, now: 0, crimeTimer: 0,
  weapon: 0, ammo: [Infinity, 150, 0, 0], rain: 0, rainTarget: 0, weatherT: 70, lightning: 0, radioOn: true
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

function makeFacadeTextures(kind) {
  const S = 512, T = 64; // 8x8 tiles, texture = 32m
  const lit = []; for (let i = 0; i < 64; i++) lit.push(rnd() < (kind === 'glass' ? 0.38 : 0.42));
  const floorDark = []; for (let i = 0; i < 8; i++) floorDark.push(rnd() < 0.2);
  const warm = ['#ffd27a', '#ffe9b8', '#fff4d6', '#ffc46b', '#9fd8ff', '#ffb3d9'];
  const albedo = canvasTex(S, S, g => {
    if (kind === 'glass') {
      g.fillStyle = '#c9ced4'; g.fillRect(0, 0, S, S);
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
        const x = tx * T, y = ty * T;
        const gr = g.createLinearGradient(x, y, x + T, y + T);
        gr.addColorStop(0, '#5d7a96'); gr.addColorStop(0.5, '#2b4058'); gr.addColorStop(1, '#3c5672');
        g.fillStyle = gr; g.fillRect(x + 2, y + 2, T - 4, T - 12);
        g.fillStyle = '#39414c'; g.fillRect(x, y + T - 10, T, 10);
      }
    } else {
      g.fillStyle = '#d6d3cc'; g.fillRect(0, 0, S, S);
      speckle(g, S, S, 9000, ['#c8c4bb', '#e2dfd8', '#bdb8ae'], 1, 3, 0.5);
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
        const x = tx * T, y = ty * T;
        g.fillStyle = '#9d9a94'; g.fillRect(x + 8, y + 12, 48, 40);
        const gr = g.createLinearGradient(x, y + 14, x + 20, y + 50);
        gr.addColorStop(0, '#4f6b86'); gr.addColorStop(1, '#17222f');
        g.fillStyle = gr; g.fillRect(x + 10, y + 14, 44, 36);
        g.fillStyle = '#8d8a84'; g.fillRect(x + 31, y + 14, 2, 36);
        g.fillStyle = '#b5b1a8'; g.fillRect(x + 6, y + 52, 52, 4);
      }
    }
  });
  const orm = canvasTex(S, S, g => { // G=roughness B=metalness
    g.fillStyle = kind === 'glass' ? 'rgb(0,120,60)' : 'rgb(0,225,0)'; g.fillRect(0, 0, S, S);
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      const x = tx * T, y = ty * T;
      g.fillStyle = 'rgb(0,18,200)';
      if (kind === 'glass') g.fillRect(x + 2, y + 2, T - 4, T - 12); else g.fillRect(x + 10, y + 14, 44, 36);
    }
  }, false);
  const em = canvasTex(S, S, g => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      if (!lit[ty * 8 + tx] || floorDark[ty]) continue;
      const x = tx * T, y = ty * T;
      g.fillStyle = pick(warm, rnd);
      if (kind === 'glass') g.fillRect(x + 2, y + 2, T - 4, T - 12); else g.fillRect(x + 10, y + 14, 44, 36);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 10 + R(0, 30), y + 14, R(4, 14), 36);
    }
  });
  return { albedo, orm, em };
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
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.5, 0.9);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
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
  const u = sky.material.uniforms; u.turbidity.value = 8; u.rayleigh.value = 2.4; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.82;
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
  buildWeather();
  buildMinimapBase();
  initFX();
  spawnPlayer();
  spawnTraffic();
  spawnPeds();
  spawnPickups();
  initInput();
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
  const fw = makeFacadeTextures('win'), fg = makeFacadeTextures('glass');
  M.wall = new THREE.MeshStandardMaterial({ map: fw.albedo, roughnessMap: fw.orm, metalnessMap: fw.orm, emissiveMap: fw.em, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 1, metalness: 1 });
  M.glass = new THREE.MeshStandardMaterial({ map: fg.albedo, roughnessMap: fg.orm, metalnessMap: fg.orm, emissiveMap: fg.em, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 1, metalness: 1 });
  const concrete = noiseTex('#8a8a88', ['#7a7a78', '#999996', '#6e6e6c'], 256, 6000);
  M.roof = new THREE.MeshStandardMaterial({ map: concrete, vertexColors: true, roughness: 0.92 });
  M.neon = new THREE.MeshBasicMaterial({ vertexColors: true });
  M.sidewalk = new THREE.MeshStandardMaterial({ map: makeSidewalkTex(), roughness: 0.9 });
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
function buildCity() {
  const parkSet = new Set(['1,2', '5,1', '2,6', '6,5', '3,3', '0,5']);
  const pastel = ['#f7c4d4', '#bfe9e2', '#fbe5b3', '#e6d4f6', '#ffffff', '#f8d8b6', '#c7e3f6', '#ffd0c0'];
  const concrete = ['#d8d4cc', '#bcb5aa', '#a5a9ad', '#e8e3d8', '#c4b8a0', '#b0a090'];
  const glassC = ['#a6c8e4', '#86abcc', '#c3dbe8', '#94b8ac', '#a8aec6', '#d6c4a8'];
  const neonC = ['#ff2a8a', '#00e5ff', '#b14bff', '#ff8a00', '#ff3355', '#2bff88'].map(h => new THREE.Color(h).multiplyScalar(1.6));
  const roofC = ['#6a6a6e', '#5a5d62', '#77746e', '#4f5257'];
  const chunks = {};
  const chunk = (i, j) => { const k = (i >> 1) + ',' + (j >> 1); return chunks[k] || (chunks[k] = { wall: new GB(), glass: new GB(), roof: new GB(), neon: new GB() }); };
  const sideGB = new GB(), parkGB = new GB();
  const white = new THREE.Color(1, 1, 1);

  for (let i = 0; i < N; i++) {
    blocks[i] = [];
    for (let j = 0; j < N; j++) {
      const cx = nodeP(i) + CELL / 2, cz = nodeP(j) + CELL / 2;
      const park = parkSet.has(i + ',' + j);
      const b = { i, j, cx, cz, park, bld: [] };
      blocks[i][j] = b;
      sideGB.box(sideGB, cx, 0, cz, BLOCK, 0.25, BLOCK, white, { us: 4, vs: 4, ts: 4 });
      if (park) { parkGB.box(parkGB, cx, 0.25, cz, BLOCK - 8, 0.06, BLOCK - 8, white, { us: 8, vs: 8, ts: 8 }); continue; }
      const C = chunk(i, j);
      const cd = Math.hypot(i - (N - 1) / 2, j - (N - 1) / 2);
      const beach = i === N - 1;
      const addBuilding = (x, z, w, d, h, kind, col) => {
        const gb = kind === 'glass' ? C.glass : C.wall;
        const uo = RI(0, 7) / 8;
        gb.box(C.roof, x, 0.25, z, w, h, d, col, { uo, topCol: new THREE.Color(pick(roofC, rnd)) });
        b.bld.push({ x0: x - w / 2 - 0.3, x1: x + w / 2 + 0.3, z0: z - d / 2 - 0.3, z1: z + d / 2 + 0.3, h: h + 0.25 });
        let top = h + 0.25;
        // setback tiers for towers
        if (h > 50 && rnd() < 0.7) {
          const w2 = Math.max(8, Math.round(w * R(0.55, 0.8) / 4) * 4), d2 = Math.max(8, Math.round(d * R(0.55, 0.8) / 4) * 4), h2 = Math.round(h * R(0.15, 0.35) / 4) * 4;
          gb.box(C.roof, x, top, z, w2, h2, d2, col, { uo, topCol: new THREE.Color(pick(roofC, rnd)) });
          b.bld.push({ x0: x - w2 / 2, x1: x + w2 / 2, z0: z - d2 / 2, z1: z + d2 / 2, h: top + h2 });
          top += h2;
          if (rnd() < 0.6) { // antenna + beacon
            C.roof.box(C.roof, x, top, z, 0.6, R(8, 20), 0.6, new THREE.Color('#888'));
          }
        }
        // rooftop units
        for (let k = 0; k < RI(1, 4); k++) C.roof.box(C.roof, x + R(-w / 3, w / 3), h + 0.25, z + R(-d / 3, d / 3), R(1.5, 4), R(1, 2.5), R(1.5, 4), new THREE.Color(pick(['#9a9a9a', '#7c7f84', '#b0aca4'], rnd)), { us: 4, vs: 4 });
        // storefront + awning
        if (kind !== 'glass' && h < 70) {
          C.glass.box(null, x, 0.25, z, w + 0.4, 3.6, d + 0.4, new THREE.Color('#a4b0bf'), { us: 32, vs: 32 });
          if (rnd() < 0.65) {
            const ac = new THREE.Color(pick(['#e0365a', '#2a8fbd', '#f2a541', '#3aa65a', '#ffffff', '#7a3fb0'], rnd));
            const side = RI(0, 3), ox = side === 0 ? w / 2 + 0.9 : side === 1 ? -w / 2 - 0.9 : 0, oz = side === 2 ? d / 2 + 0.9 : side === 3 ? -d / 2 - 0.9 : 0;
            C.roof.box(C.roof, x + ox, 3.7, z + oz, ox ? 1.8 : w * 0.7, 0.25, oz ? 1.8 : d * 0.7, ac, { us: 4, vs: 4 });
          }
        }
        // neon
        if ((beach || rnd() < 0.38) && (h < 90 || rnd() < 0.5)) {
          const nc = pick(neonC, rnd), t = 0.35, y = top - 0.6;
          C.neon.box(C.neon, x, y, z - d / 2 - 0.05, w + 0.2, t, t, nc);
          C.neon.box(C.neon, x, y, z + d / 2 + 0.05, w + 0.2, t, t, nc);
          C.neon.box(C.neon, x - w / 2 - 0.05, y, z, t, t, d + 0.2, nc);
          C.neon.box(C.neon, x + w / 2 + 0.05, y, z, t, t, d + 0.2, nc);
          if (rnd() < 0.5) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) C.neon.box(C.neon, x + sx * (w / 2 + 0.05), 4, z + sz * (d / 2 + 0.05), t, top - 4.6, t, nc);
          if (rnd() < 0.5 && h > 12) { // band mid-facade
            const yy = Math.round(R(2, h / 4 - 1)) * 4 + 0.2;
            C.neon.box(C.neon, x, yy, z - d / 2 - 0.08, w * 0.8, 0.3, 0.3, pick(neonC, rnd));
          }
        }
      };
      if (cd < 1.6) { // downtown
        if (rnd() < 0.55) {
          const w = RI(9, 12) * 4, d = RI(9, 12) * 4;
          addBuilding(cx, cz, w, d, RI(24, 44) * 4, 'glass', new THREE.Color(pick(glassC, rnd)));
        } else for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const w = RI(5, 7) * 4, d = RI(5, 7) * 4;
          addBuilding(cx + ox * 16, cz + oz * 16, w, d, RI(12, 32) * 4, rnd() < 0.6 ? 'glass' : 'win', new THREE.Color(pick(rnd() < 0.6 ? glassC : concrete, rnd)));
        }
      } else if (beach) { // ocean drive hotels
        for (const oz of [-1, 1]) {
          const w = RI(6, 7) * 4, d = RI(6, 7) * 4;
          addBuilding(cx + R(-4, 4), cz + oz * 16, w, d, RI(4, 14) * 4, 'win', new THREE.Color(pick(pastel, rnd)));
        }
      } else {
        const m = cd < 3 ? 2 : (rnd() < 0.5 ? 2 : 3), L = 64 / m;
        for (let a = 0; a < m; a++) for (let c = 0; c < m; c++) {
          if (m === 3 && a === 1 && c === 1) continue;
          const w = Math.max(8, Math.floor(L * R(0.62, 0.9) / 4) * 4), d = Math.max(8, Math.floor(L * R(0.62, 0.9) / 4) * 4);
          const x = cx - 32 + L * (a + 0.5) + R(-1, 1) * (L - w) * 0.3, z = cz - 32 + L * (c + 0.5) + R(-1, 1) * (L - d) * 0.3;
          const h = cd < 3 ? RI(5, 16) * 4 : RI(2, 6) * 4;
          const kind = cd < 3 && rnd() < 0.35 ? 'glass' : 'win';
          addBuilding(x, z, w, d, h, kind, new THREE.Color(pick(kind === 'glass' ? glassC : (cd < 3 ? concrete : pastel), rnd)));
        }
      }
    }
  }
  const sw = new THREE.Mesh(sideGB.geometry(), M.sidewalk); sw.receiveShadow = true; scene.add(sw);
  const pk = new THREE.Mesh(parkGB.geometry(), M.grass); pk.receiveShadow = true; scene.add(pk);
  const shadows = QUALITY !== 'low';
  for (const k in chunks) {
    const C = chunks[k];
    for (const [gb, mat] of [[C.wall, M.wall], [C.glass, M.glass], [C.roof, M.roof], [C.neon, M.neon]]) {
      if (!gb.p.length) continue;
      const m = new THREE.Mesh(gb.geometry(), mat);
      if (mat !== M.neon) { m.castShadow = shadows; m.receiveShadow = shadows; }
      scene.add(m);
    }
  }
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
  for (const row of blocks) for (const b of row) {
    if (b.park) for (let k = 0; k < 14; k++) addPalm(b.cx + R(-30, 30), b.cz + R(-30, 30));
    else if (Math.hypot(b.i - 3.5, b.j - 3.5) > 1.6) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (rnd() < 0.6) addPalm(b.cx + sx * (BLOCK / 2 - 1.5), b.cz + sz * (BLOCK / 2 - 1.5));
  }
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b6b4a, roughness: 1, map: noiseTex('#8b6b4a', ['#6f5236', '#a08058'], 64, 400, 1, 6) });
  const leafMat = new THREE.MeshStandardMaterial({ map: makeLeafTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  const tI = new THREE.InstancedMesh(trunk, trunkMat, palms.length), fI = new THREE.InstancedMesh(frondGeo, leafMat, palms.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  palms.forEach(([x, z, r, s], i) => {
    const y = x > SHORE_X ? sandHeight(x) : (blockAt(x, z) ? 0.25 : 0.02);
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
  const legGeo = merge([colorize(new THREE.CapsuleGeometry(0.085, 0.72, 4, 8).translate(0, -0.45, 0), look.pants), colorize(new THREE.BoxGeometry(0.13, 0.09, 0.27).translate(0, -0.88, 0.05), look.shoes || '#222')]);
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
const SHIRT = ['#ff4f6d', '#2ec4d6', '#ffd23a', '#ffffff', '#1d1d24', '#3aa65a', '#8a5cff', '#ff8a3d', '#4a6fa5', '#e8e0d0'];
const PANTS = ['#2b3a55', '#1d1d24', '#c9b48a', '#5a5a60', '#e8e8e8', '#3a2a20', '#6a7a8a'];
const HAIR = ['#1a1210', '#3a2416', '#8a6a3a', '#d8c088', '#101010', '#6a2a1a'];
const randLook = () => ({ skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS), hair: pick(HAIR) });

// ============================================================ CARS
const CAR_SPECS = {
  sedan: { W: 1.86, wr: 0.36, wx: 1.38, max: 40, acc: 15, body: [[-2.25, 0.32], [2.2, 0.32], [2.3, 0.62], [2.2, 0.86], [1.1, 1.0], [-1.75, 1.06], [-2.22, 1.0], [-2.3, 0.62]], cab: [[1.1, 0.97], [0.42, 1.45], [-0.95, 1.48], [-1.72, 1.03]] },
  sport: { W: 1.96, wr: 0.35, wx: 1.42, max: 58, acc: 24, body: [[-2.25, 0.28], [2.25, 0.28], [2.38, 0.48], [2.22, 0.68], [0.9, 0.86], [-1.8, 0.96], [-2.25, 0.92], [-2.33, 0.55]], cab: [[0.95, 0.84], [0.0, 1.22], [-0.9, 1.24], [-1.85, 0.93]] },
  suv: { W: 2.02, wr: 0.43, wx: 1.48, max: 36, acc: 13, body: [[-2.3, 0.44], [2.25, 0.44], [2.34, 0.82], [2.2, 1.1], [1.25, 1.2], [-2.2, 1.22], [-2.3, 1.16], [-2.36, 0.82]], cab: [[1.25, 1.17], [0.72, 1.76], [-2.05, 1.8], [-2.18, 1.2]] },
};
CAR_SPECS.bike = { W: 0.7, wr: 0.34, wx: 0.78, max: 64, acc: 30, bike: true, cr: 0.55, co: 0.62 };
CAR_SPECS.taxi = CAR_SPECS.sedan; CAR_SPECS.police = { ...CAR_SPECS.sedan, max: 50, acc: 20 };
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
  if (kind === 'taxi') trimL.push(colorize(new THREE.BoxGeometry(0.5, 0.2, 0.25).translate((p1[0] + p2[0]) / 2, Math.max(p1[1], p2[1]) + 0.2, 0), '#ffe36e'));
  const trim = merge(trimL);
  const r = s.wr;
  const wheel = merge([
    colorize(new THREE.CylinderGeometry(r, r, 0.3, 18).rotateX(Math.PI / 2), '#141414'),
    colorize(new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.32, 14).rotateX(Math.PI / 2), '#c8ccd2'),
    colorize(new THREE.BoxGeometry(r * 1.2, 0.08, 0.34), '#555a60'), colorize(new THREE.BoxGeometry(0.08, r * 1.2, 0.34), '#555a60')]);
  return carGeoCache[kind] = { paint, cab, lights, trim, wheel };
}
const CAR_COLORS = ['#e8e8ea', '#101014', '#b01020', '#1a4a9a', '#f2c230', '#2a8a6a', '#7a7a80', '#ff5a8a', '#3ad0e0', '#f06a20', '#5a2a8a', '#c0c4ca'];
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
  group.position.set(x, groundY(x, z), z); group.rotation.y = h; scene.add(group);
  const car = { group, inner, paint, paintM, spinners, fronts, siren: null, kind: 'bike', spec: s, h, vx: 0, vz: 0, y: group.position.y, vy: 0, air: false, steer: 0, spin: 0, mode, health: 70, driver: false, active: true, ai: null, stuck: 0, reverseT: 0, smokeT: 0, police: false, pathT: 0, path: null, shootT: 2, idleT: 0, dead: false, honk: 0 };
  cars.push(car); return car;
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
  group.position.set(x, groundY(x, z), z); group.rotation.y = h; scene.add(group);
  const car = { group, inner, paint, paintM, spinners, fronts, siren, kind, spec: s, h, vx: 0, vz: 0, y: group.position.y, vy: 0, air: false, steer: 0, spin: 0, mode, health: 100, driver: mode !== 'free', active: true, ai: null, stuck: 0, reverseT: 0, smokeT: 0, police: kind === 'police', pathT: 0, path: null, shootT: 2, idleT: 0, dead: false, honk: 0 };
  cars.push(car); return car;
}
const carSpeed = c => Math.hypot(c.vx, c.vz);
const carFwd = c => c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h);

function carPhysics(c, dt, throttle, steerIn, hand) {
  const s = c.spec, sin = Math.sin(c.h), cos = Math.cos(c.h);
  let vF = c.vx * sin + c.vz * cos, vL = c.vx * -cos + c.vz * sin;
  const grounded = !c.air;
  if (grounded) {
    if (throttle > 0) { vF += (vF < -0.5 ? 30 : s.acc * (1 - Math.max(0, vF) / s.max * 0.85)) * throttle * dt; }
    else if (throttle < 0) { vF += (vF > 0.5 ? -32 : -9 * (vF > -12 ? 1 : 0)) * -throttle * dt; }
    else vF -= Math.sign(vF) * Math.min(Math.abs(vF), (c.mode === 'player' ? 2.5 : 7) * dt);
    vF -= vF * Math.abs(vF) * 0.0011 * dt * 60 * 0.06;
    if (hand) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt);
    vF = clamp(vF, -14, s.max);
    const maxSteer = (s.bike ? 0.7 : 0.62) / (1 + Math.abs(vF) / (s.bike ? 20 : 16));
    c.steer = damp(c.steer, steerIn * maxSteer, 8, dt);
    const yawRate = -vF / 2.7 * Math.tan(c.steer) * (hand ? 1.35 : 1);
    c.h += yawRate * dt;
    const grip = (hand ? 1.6 : (c.mode === 'player' ? (s.bike ? 9 : 6.5) : 10)) * (1 - 0.35 * state.rain);
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
  setTimeout(() => { if (c.dead && !c.police) respawnTrafficCar(c); }, 25000);
}

// ============================================================ PLAYER
const player = { pos: new THREE.Vector3(), vy: 0, yaw: 0, speed: 0, onGround: true, human: null, aimT: 0 };
let camYaw = 0, camPitch = 0.22, camDist = 5;
function spawnPlayer() {
  player.human = makeHuman({ skin: '#c58c60', shirt: '#1fb5b8', pants: '#232f45', hair: '#1a1210', shoes: '#f2f2f2', gun: true });
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
  if (best.driver) { // carjack!
    const p = best.group.position;
    ejectDriver(p.x - Math.cos(best.h) * 1.6, p.z + Math.sin(best.h) * 1.6);
    addHeat(best.police ? 1.5 : 0.35);
  }
  if (best.ai) best.ai = null;
  best.mode = 'player'; best.driver = true; state.inCar = best;
  if (best.spec.bike) { best.group.add(player.human.g); player.human.g.position.set(0, 0.45, -0.28); player.human.g.rotation.set(0.32, 0, 0); }
  else player.human.g.visible = false;
  if (state.radioOn) floatText('📻 NEON FM 88.6');
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
  let p = peds.find(q => q.dead) || peds.reduce((a, b) => (dist2(b) > dist2(a) ? b : a));
  p.dead = false; p.deadT = 0; p.free = true; p.x = x; p.z = z; p.panic = 10; p.h.g.rotation.x = 0; p.h.g.visible = true;
  p.fleeX = x - player.pos.x; p.fleeZ = z - player.pos.z;
}
const dist2 = p => (p.x - player.pos.x) ** 2 + (p.z - player.pos.z) ** 2;

// ============================================================ WEAPON
const WEAPONS = [
  { name: 'TABANCA', icon: '🔫', cd: 0.3, range: 55, cone: 0.32, carDmg: 14, pellets: 1, vol: 1 },
  { name: 'UZI', icon: '⚡', cd: 0.085, range: 45, cone: 0.36, carDmg: 8, pellets: 1, vol: 0.7, spread: 0.05 },
  { name: 'POMPALI', icon: '💥', cd: 0.85, range: 24, cone: 0.55, carDmg: 34, pellets: 7, vol: 1.6, spread: 0.13 },
  { name: 'ROKETATAR', icon: '🚀', cd: 1.3, range: 140, cone: 0.25, rocket: true, vol: 1 },
];
function nextWeapon(dir = 1) {
  for (let k = 1; k <= 4; k++) { const i = (state.weapon + dir * k + 8) % 4; if (state.ammo[i] > 0) { state.weapon = i; break; } }
  AudioSys.tone(700, 0.05, 0.12, 'square');
}
function selectWeapon(i) { if (state.ammo[i] > 0) { state.weapon = i; AudioSys.tone(700, 0.05, 0.12, 'square'); } }
function fire() {
  if (state.fireCd > 0 || state.dead) return;
  if (state.ammo[state.weapon] <= 0) { nextWeapon(); return; }
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
      else killPed(best, true);
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
  for (const p of peds) if (!p.dead && dist2(p) < 1600) { p.panic = 8; p.fleeX = p.x - ox; p.fleeZ = p.z - oz; }
}
const rockets = []; let rocketGeo = null, rocketMat = null;
function launchRocket(x, y, z, dx, dy, dz) {
  if (!rocketGeo) { rocketGeo = merge([colorize(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 8).rotateX(Math.PI / 2), '#6a6f58'), colorize(new THREE.ConeGeometry(0.09, 0.25, 8).rotateX(Math.PI / 2).translate(0, 0, 0.47), '#c03020')]); rocketMat = new THREE.MeshStandardMaterial({ vertexColors: true }); }
  const m = new THREE.Mesh(rocketGeo, rocketMat); m.position.set(x, y, z); m.lookAt(x + dx, y + dy, z + dz); scene.add(m);
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
    if (hit || r.t <= 0) { explosion(p.x, p.y, p.z, true); scene.remove(r.m); rockets.splice(i, 1); }
  }
}
function killPed(p, byPlayer) {
  if (p.dead) return;
  p.dead = true; p.deadT = 18;
  p.h.g.rotation.x = -Math.PI / 2;
  for (let k = 0; k < 10; k++) FX.norm.spawn(p.x, 0.9, p.z, MR(-2, 2), MR(1, 4), MR(-2, 2), 0.5, 0.35, 0.2, 0.55, 0.02, 0.02, 0.9, 12);
  spawnCash(p.x + MR(-0.5, 0.5), p.z + MR(-0.5, 0.5), Math.round(MR(10, 90)));
  if (byPlayer) addHeat(p.cop ? 1.5 : 0.7);
}
function addHeat(v) { state.heat = clamp(Math.max(state.heat, 1) + (state.heat >= 1 ? v : 0), 0, 5.99); state.crimeTimer = 0; }

// ============================================================ TRAFFIC
function spawnTraffic() {
  const n = QUALITY === 'low' ? 16 : QUALITY === 'medium' ? 22 : 30;
  for (let k = 0; k < n; k++) {
    const kind = pick(['sedan', 'sedan', 'sedan', 'suv', 'suv', 'sport', 'taxi', 'taxi']);
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
    const c = createCar(pick(['sedan', 'suv', 'sport', 'sedan']), pick(CAR_COLORS), x, z, h + (rnd() < 0.5 ? Math.PI : 0), 'free');
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
  c.dead = false; c.health = 100; c.paint.material = c.paintM; c.vx = c.vz = 0; c.air = false; c.vy = 0;
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
  if (a.speed < 0.5) { a.wait += dt; if (a.wait > 5) { a.ghost = 2; a.wait = 0; } } else a.wait = 0;
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
  let nearest = 1e9;
  for (const c of pc) {
    if (!c.active) continue;
    const p = c.group.position, d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
    if (c.mode !== 'police') { if (c.mode === 'dead' || c.mode === 'free') { if (d > 160) { c.active = false; c.group.visible = false; } } continue; }
    nearest = Math.min(nearest, d);
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
      AudioSys.pickup();
      if (p.kind === 'cash') { state.money += p.amt; floatText('+$' + p.amt); }
      else {
        floatText(CRATES[p.kind][1]);
        if (p.kind === 'w1') state.ammo[1] += 120; else if (p.kind === 'w2') state.ammo[2] += 16; else if (p.kind === 'w3') state.ammo[3] += 4;
        else if (p.kind === 'hp') state.health = 100; else state.armor = 100;
        if (p.kind[0] === 'w' && state.weapon === 0) state.weapon = +p.kind[1];
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
const MCOL = { reach: 0xffc020, race: 0x20e0ff, taxi: 0x40ff80, hit: 0xff3040 };
function setMarker(x, z, type) {
  markerGroup.position.set(x, 0, z); markerGroup.visible = true;
  markerGroup.children[0].material.color.setHex(MCOL[type]); markerGroup.children[1].material.color.setHex(MCOL[type]);
}
function farNode(d0, d1, fx = player.pos.x, fz = player.pos.z) {
  let bestN = null;
  for (let t = 0; t < 80; t++) { const i = RI(0, N), j = RI(0, N), x = nodeP(i), z = nodeP(j), d = Math.hypot(x - fx, z - fz); if (d > d0 && d < d1) return [x, z, d]; if (!bestN || Math.abs(d - d0) < Math.abs(bestN[2] - d0)) bestN = [x, z, d]; }
  return bestN;
}
function newMission() {
  const type = pick(['reach', 'race', 'race', 'taxi', 'taxi', 'hit']);
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
    if (!cand.length) return newMission();
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
function missionPos() { const m = state.mission; return m.type === 'hit' ? [m.target.group.position.x, m.target.group.position.z] : [m.x, m.z]; }
function missionEnd(ok, sub) {
  const m = state.mission;
  if (ok) { state.money += m.reward; showBig('GÖREV TAMAMLANDI', '#7dff9a', 3, `+$${m.reward}` + (sub ? ' · ' + sub : '')); AudioSys.success(); state.armor = Math.min(100, state.armor + 25); state.ammo[1] += 60; }
  else { showBig('GÖREV BAŞARISIZ', '#ff3b3b', 2.5, sub); AudioSys.fail(); }
  if (passenger) passenger.g.visible = false;
  state.mission = null; markerGroup.visible = false; state.missionCooldown = 4;
}
function updateMission(dt) {
  const m = state.mission, el = $('mission');
  if (!m) { el.style.display = 'none'; if (state.missionCooldown > 0) { state.missionCooldown -= dt; if (state.missionCooldown <= 0) newMission(); } return; }
  m.time -= dt;
  const [tx, tz] = missionPos(), d = Math.hypot(tx - player.pos.x, tz - player.pos.z), t = Math.max(0, Math.ceil(m.time));
  const c = state.inCar, sp = c ? carSpeed(c) : 0;
  el.style.display = 'block';
  el.style.borderLeftColor = m.time < 10 ? '#ff3b3b' : '#' + MCOL[m.type].toString(16).padStart(6, '0');
  markerGroup.children[0].material.opacity = 0.7 + Math.sin(state.now * 4) * 0.3;
  markerGroup.children[1].scale.setScalar(1 + Math.sin(state.now * 3) * 0.1);
  if (m.type === 'reach') {
    el.textContent = `🎯 İşarete ulaş · ${t} sn · ${Math.round(d)} m`;
    if (d < 6) return missionEnd(true);
  } else if (m.type === 'race') {
    el.textContent = `🏁 Yarış ${m.idx + 1}/${m.cps.length} · ${t} sn · ${Math.round(d)} m` + (c ? '' : ' · Araca bin!');
    if (d < 8 && c) {
      m.idx++; AudioSys.pickup(); floatText(`✓ ${m.idx}/${m.cps.length}`);
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
    el.textContent = `💀 Hedef aracı yok et · ${t} sn · ${Math.round(d)} m`;
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
        if ((A.mode === 'player' || B.mode === 'player') && impact > 3) { state.shake = Math.min(1, impact / 20); AudioSys.crash(impact / 25); if ((A.police || B.police) && impact > 6) addHeat(0.3); }
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
  cloudDome = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), new THREE.MeshBasicMaterial({ color: 0x555a60, side: THREE.BackSide, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  cloudDome.renderOrder = -1; scene.add(cloudDome);
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
  cloudDome.material.opacity = Math.min(0.92, rain * 1.1);
  cloudDome.material.color.copy(scene.fog.color).multiplyScalar(0.9 + state.lightning * 4);
  cloudDome.position.copy(camera.position);
  M.road.roughness = lerp(0.82, 0.12, rain); M.road.color.setScalar(lerp(1, 0.6, rain)); M.road.envMapIntensity = 1 + rain * 1.5;
  M.sidewalk.roughness = lerp(0.9, 0.3, rain); M.sidewalk.color.setScalar(lerp(1, 0.7, rain));
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
  M.wall.emissiveIntensity = night * 0.62; M.glass.emissiveIntensity = night * 0.45;
  M.neon.color.setScalar(0.6 + night * 1.7);
  M.lampHead.color.setRGB(1, 0.85, 0.55).multiplyScalar(0.3 + night * 3.2);
  M.pool.opacity = night * 0.6;
  M.carLight.color.setScalar(0.9 + night * 2.6);
  if (bloomPass) bloomPass.strength = 0.3 + night * 0.3 + sunset * 0.1;
  // ocean
  const u = ocean.material.uniforms;
  u.uSunDir.value.copy(sunDir); u.uSunCol.value.copy(sunLight.color).multiplyScalar((y > 0 ? 1 : 0.15) * (1 - rain));
  u.uHorizon.value.copy(fog); u.uZenith.value.setHex(0x3a6ea8).lerp(tmpC2.setHex(0x6a4a8a), sunset * 0.6).lerp(tmpC2.setHex(0x050810), night);
  u.uDeep.value.setHex(0x0a3a5a).multiplyScalar(0.15 + 0.85 * day); u.uShallow.value.setHex(0x1fa0a0).multiplyScalar(0.12 + 0.88 * day);
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
    if (e.code === 'KeyF' || e.code === 'KeyE' || e.code === 'Enter') enterCar();
    if (/^Digit[1-4]$/.test(e.code)) selectWeapon(+e.code[5] - 1);
    if (e.code === 'KeyX' || e.code === 'Tab') { e.preventDefault(); nextWeapon(); }
    if (e.code === 'KeyR') toggleRadio();
    if (e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  const cv = renderer.domElement;
  cv.addEventListener('click', () => { if (!isTouch && document.pointerLockElement !== cv) cv.requestPointerLock?.(); });
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
  btn('bWeapon', 'TW', () => nextWeapon()); btn('bRadio', 'TR', toggleRadio);
}
function readInput() {
  const k = keys;
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
  if (near && !isTouch) { pr.style.display = 'block'; pr.textContent = 'F — Araca bin'; } else pr.style.display = 'none';
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
  const x = nodeP(RI(2, 6)) + ROAD / 2 + 3, z = nodeP(RI(2, 6)) + ROAD / 2 + 3;
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
  crash(v) { if (this.ctx && (this._ct || 0) < this.ctx.currentTime) { this._ct = this.ctx.currentTime + 0.25; this.burst(0.35, 900, clamp(v, 0.1, 1) * 0.8, 'bandpass', 0.7); } },
  thud() { this.tone(90, 0.25, 0.6, 'sine', 0.5); },
  door() { this.tone(220, 0.08, 0.2, 'square', 0.5); this.burst(0.1, 600, 0.3); },
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
    Radio.update(!!c && state.radioOn && !state.dead);
  }
};

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
function toggleRadio() { state.radioOn = !state.radioOn; floatText(state.radioOn ? '📻 NEON FM 88.6' : '📻 Kapalı'); }

// ============================================================ MAIN LOOP
let frame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; state.now += dt; frame++;
  readInput();
  updateSky(dt);
  if (state.dead) { state.deadTimer -= dt; if (state.deadTimer <= 0) respawn(); }
  else {
    if (state.inCar) updatePlayerCar(dt); else updatePlayerFoot(dt);
    if (input.fire) fire();
  }
  if (state.fireCd > 0) state.fireCd -= dt;
  for (const c of cars) {
    if (!c.active || c === state.inCar) continue;
    if (c.mode === 'ai') { const d = Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z); if (d > 300 && frame % 3) continue; updateAI(c, dt); }
    else if (c.mode === 'free' || c.mode === 'dead') { if (carSpeed(c) > 0.05 || c.air) carPhysics(c, dt, 0, 0, c.mode === 'dead'); }
    c.group.visible = Math.hypot(c.group.position.x - player.pos.x, c.group.position.z - player.pos.z) < 320;
  }
  const pd = updatePolice(dt);
  carCollisions();
  updatePeds(dt);
  updatePickups(dt);
  updateMission(dt);
  // wanted level dynamics
  state.crimeTimer += dt;
  if (state.heat > 0 && state.crimeTimer > 6) {
    const seen = pd < 55;
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
