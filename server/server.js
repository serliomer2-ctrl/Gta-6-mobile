// Vista Bay account server — zero dependencies (Node 18+)
// Accounts (scrypt-hashed passwords), cloud saves, admin role, bans, signed room tickets.
// Also serves the game's static files, so one deployment can host everything.
//
//   PORT=8787 ADMIN_USER=admin ADMIN_PASSWORD=admin node server/server.js
//
// Environment:
//   PORT              listen port (default 8787)
//   DATA_DIR          where db.json lives (default ./server/data)
//   ADMIN_USER        admin account name (default "admin")
//   ADMIN_PASSWORD    admin password (default "admin" — CHANGE THIS for a public server)
//   TICKET_SECRET     HMAC secret for room tickets (default: random per start)
//   ALLOWED_ORIGINS   comma separated CORS origins (default "*")
//   STATIC_DIR        folder with index.html (default: repository root); set to "" to disable
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8787;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const TICKET_SECRET = process.env.TICKET_SECRET || crypto.randomBytes(32).toString('hex');
const ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const STATIC_DIR = process.env.STATIC_DIR !== undefined ? process.env.STATIC_DIR : path.join(__dirname, '..');
const TOKEN_TTL = 30 * 24 * 3600 * 1000, TICKET_TTL = 15 * 60 * 1000, MAX_SAVE = 256 * 1024;
const NAME_RE = /^[a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]{3,14}$/;

// ---------------- storage (single JSON file, atomic writes)
let db = { users: {}, tokens: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { }
db.users = db.users || {}; db.tokens = db.tokens || {}; db.graves = db.graves || []; db.graveSeq = db.graveSeq || 0; db.gflowers = db.gflowers || {};
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 300);
}
// ---------------- passwords
function hashPass(pass, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(pass, salt, 64).toString('hex') }; }
function checkPass(u, pass) { const h = crypto.scryptSync(pass, u.salt, 64); return crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex')); }
// admin account is created / updated from the environment on every start
{
  const a = db.users[ADMIN_USER];
  if (!a || !checkPass(a, ADMIN_PASSWORD)) db.users[ADMIN_USER] = { ...(a || { data: null, created: Date.now() }), name: a ? a.name : ADMIN_USER, ...hashPass(ADMIN_PASSWORD), role: 'admin', banned: false };
  else a.role = 'admin';
  persist();
  if (ADMIN_PASSWORD === 'admin') console.warn('⚠  ADMIN_PASSWORD is the default "admin". Anyone who knows it gets admin powers — set ADMIN_PASSWORD before going public.');
}
// ---------------- tokens & tickets
function newToken(user) { const t = crypto.randomBytes(32).toString('hex'); db.tokens[t] = { user, exp: Date.now() + TOKEN_TTL }; persist(); return t; }
function userFromReq(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || ''); if (!m) return null;
  const t = db.tokens[m[1]]; if (!t || t.exp < Date.now()) return null;
  const u = db.users[t.user]; if (!u || u.banned) return null;
  return { key: t.user, u, token: m[1] };
}
const b64 = s => Buffer.from(s).toString('base64url');
function signTicket(payload) { const body = b64(JSON.stringify(payload)); return body + '.' + crypto.createHmac('sha256', TICKET_SECRET).update(body).digest('base64url'); }
function readTicket(t) {
  if (typeof t !== 'string' || t.length > 600) return null;
  const [body, sig] = t.split('.'); if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', TICKET_SECRET).update(body).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
const profile = (key, u) => ({ user: u.name || key, role: u.role || 'player', data: u.data || null, created: u.created });
// ---------------- rate limiting (per IP, per route group)
const hits = new Map();
function limited(req, group, max, windowMs = 60000) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), k = group + '|' + ip, now = Date.now();
  let h = hits.get(k); if (!h || h.t < now) { h = { n: 0, t: now + windowMs }; hits.set(k, h); }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.t < now) hits.delete(k); for (const t in db.tokens) if (db.tokens[t].exp < now) delete db.tokens[t]; }, 60000).unref();
// ---------------- http helpers
function cors(req, res) {
  const o = req.headers.origin;
  if (ORIGINS.includes('*')) res.setHeader('Access-Control-Allow-Origin', o || '*');
  else if (o && ORIGINS.includes(o)) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req, max = MAX_SAVE + 4096) {
  return new Promise((ok, fail) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { fail(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { fail(new Error('bad json')); } });
    req.on('error', fail);
  });
}
// ---------------- API
const routes = {
  'GET /api/health': async () => [200, { ok: true, name: 'vista-bay', users: Object.keys(db.users).length }],
  'POST /api/register': async (req) => {
    if (limited(req, 'reg', 8)) return [429, { error: 'Çok fazla deneme, biraz bekle' }];
    const { user, pass } = await body(req, 4096);
    if (typeof user !== 'string' || !NAME_RE.test(user)) return [400, { error: 'Kullanıcı adı 3-14 harf/rakam olmalı' }];
    if (typeof pass !== 'string' || pass.length < 4 || pass.length > 64) return [400, { error: 'Şifre 4-64 karakter olmalı' }];
    const key = user.toLowerCase();
    if (db.users[key]) return [409, { error: 'Bu kullanıcı adı alınmış' }];
    db.users[key] = { name: user, ...hashPass(pass), role: 'player', banned: false, data: null, created: Date.now() }; persist();
    return [200, { token: newToken(key), ...profile(key, db.users[key]) }];
  },
  'POST /api/login': async (req) => {
    if (limited(req, 'login', 12)) return [429, { error: 'Çok fazla deneme, biraz bekle' }];
    const { user, pass } = await body(req, 4096);
    const key = String(user || '').toLowerCase(), u = db.users[key];
    if (!u || typeof pass !== 'string' || !checkPass(u, pass)) return [401, { error: 'Kullanıcı adı ya da şifre yanlış' }];
    if (u.banned) return [403, { error: 'Bu hesap yasaklandı' }];
    return [200, { token: newToken(key), ...profile(key, u) }];
  },
  'POST /api/logout': async (req) => { const a = userFromReq(req); if (a) { delete db.tokens[a.token]; persist(); } return [200, { ok: true }]; },
  'GET /api/me': async (req) => { const a = userFromReq(req); return a ? [200, profile(a.key, a.u)] : [401, { error: 'Oturum geçersiz' }]; },
  'POST /api/save': async (req) => {
    const a = userFromReq(req); if (!a) return [401, { error: 'Oturum geçersiz' }];
    if (limited(req, 'save', 30)) return [429, { error: 'Çok sık kayıt' }];
    const { data } = await body(req);
    if (!data || typeof data !== 'object') return [400, { error: 'Kayıt verisi yok' }];
    a.u.data = data; a.u.saved = Date.now(); persist();
    return [200, { ok: true, saved: a.u.saved }];
  },
  // a short-lived, signed proof of identity for one multiplayer room (aud = room code)
  'POST /api/ticket': async (req) => {
    const a = userFromReq(req); if (!a) return [401, { error: 'Oturum geçersiz' }];
    const { aud } = await body(req, 1024);
    return [200, { ticket: signTicket({ user: a.u.name || a.key, key: a.key, role: a.u.role || 'player', aud: String(aud || '').slice(0, 40), exp: Date.now() + TICKET_TTL }) }];
  },
  // room hosts verify the tickets of joining players / admin commands here
  'POST /api/verify': async (req) => {
    if (limited(req, 'verify', 120)) return [429, { error: 'rate' }];
    const { ticket, aud } = await body(req, 2048);
    const p = readTicket(ticket); if (!p) return [200, { ok: false }];
    const u = db.users[p.key];
    if (!u) return [200, { ok: false }];
    if (aud !== undefined && p.aud !== String(aud)) return [200, { ok: false, reason: 'aud' }];
    return [200, { ok: !u.banned, banned: !!u.banned, user: u.name || p.key, role: u.role || 'player' }];
  },
  // ---------------- cemetery: permanent gravestones shared by every player
  'GET /api/graves': async (req) => {
    if (limited(req, 'graves', 60)) return [429, { error: 'rate' }];
    return [200, { graves: db.graves.slice(-120).reverse().map(({ k, ...g }) => g) }];
  },
  'POST /api/graves': async (req) => {
    const a = userFromReq(req); if (!a) return [401, { error: 'Oturum geçersiz' }];
    if (limited(req, 'grave', 4)) return [429, { error: 'Çok sık' }];
    if (Date.now() - (a.u.lastGrave || 0) < 60000) return [429, { error: 'Çok sık' }];
    const { words, cause } = await body(req, 2048);
    const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
    const g = { id: ++db.graveSeq, k: a.key, name: a.u.name || a.key, words: clean(words, 60), cause: clean(cause, 40), died: Date.now(), flowers: 0 };
    a.u.lastGrave = g.died;
    const mine = db.graves.filter(o => o.k === a.key);
    if (mine.length >= 3) { const drop = new Set(mine.slice(0, mine.length - 2).map(o => o.id)); db.graves = db.graves.filter(o => !drop.has(o.id)); }
    db.graves.push(g); if (db.graves.length > 2000) db.graves.splice(0, db.graves.length - 2000);
    persist(); return [200, { grave: { ...g, k: undefined } }];
  },
  'POST /api/graves/flower': async (req) => {
    const a = userFromReq(req); if (!a) return [401, { error: 'Oturum geçersiz' }];
    if (limited(req, 'flower', 30)) return [429, { error: 'rate' }];
    const { id } = await body(req, 512), g = db.graves.find(o => o.id === +id); if (!g) return [404, { error: 'Mezar yok' }];
    const day = Math.floor(Date.now() / 86400000), key = `${g.id}|${a.key}|${day}`;
    if (!db.gflowers[key]) { db.gflowers[key] = day; g.flowers++; for (const k in db.gflowers) if (db.gflowers[k] < day - 1) delete db.gflowers[k]; persist(); }
    return [200, { flowers: g.flowers }];
  },
  'POST /api/admin/grave': async (req) => {
    const a = userFromReq(req); if (!a || a.u.role !== 'admin') return [403, { error: 'Yetki yok' }];
    const { id } = await body(req, 512); db.graves = db.graves.filter(o => o.id !== +id); persist(); return [200, { ok: true }];
  },
  // ---------------- admin
  'GET /api/admin/users': async (req) => {
    const a = userFromReq(req); if (!a || a.u.role !== 'admin') return [403, { error: 'Yetki yok' }];
    return [200, { users: Object.entries(db.users).map(([k, u]) => ({ user: u.name || k, role: u.role, banned: !!u.banned, money: u.data && u.data.money || 0, saved: u.saved || null })) }];
  },
  'POST /api/admin/ban': async (req) => {
    const a = userFromReq(req); if (!a || a.u.role !== 'admin') return [403, { error: 'Yetki yok' }];
    const { user, ban } = await body(req, 1024), key = String(user || '').toLowerCase(), u = db.users[key];
    if (!u) return [404, { error: 'Böyle bir hesap yok' }];
    if (u.role === 'admin') return [400, { error: 'Admin yasaklanamaz' }];
    u.banned = !!ban; if (u.banned) for (const t in db.tokens) if (db.tokens[t].user === key) delete db.tokens[t];
    persist(); return [200, { ok: true, user: u.name, banned: u.banned }];
  },
  'POST /api/admin/money': async (req) => {
    const a = userFromReq(req); if (!a || a.u.role !== 'admin') return [403, { error: 'Yetki yok' }];
    const { user, amount } = await body(req, 1024), u = db.users[String(user || '').toLowerCase()], amt = Math.round(+amount);
    if (!u) return [404, { error: 'Böyle bir hesap yok' }];
    if (!Number.isFinite(amt) || Math.abs(amt) > 1e9) return [400, { error: 'Geçersiz miktar' }];
    u.data = u.data || {}; u.data.money = Math.max(0, (u.data.money || 0) + amt); persist();
    return [200, { ok: true, money: u.data.money }];
  },
};
// ---------------- static files (the game itself)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res) {
  if (!STATIC_DIR) { send(res, 404, { error: 'not found' }); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const root = path.resolve(STATIC_DIR), file = path.resolve(root, '.' + p);
  if (!file.startsWith(root + path.sep) || /[\\/](server|\.git)([\\/]|$)/.test(file.slice(root.length))) { send(res, 404, { error: 'not found' }); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { send(res, 404, { error: 'not found' }); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(buf);
  });
}
const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://x'), fn = routes[`${req.method} ${url.pathname}`];
  if (fn) { try { const [code, obj] = await fn(req); send(res, code, obj); } catch (e) { send(res, 400, { error: e.message || 'Hata' }); } return; }
  if (url.pathname.startsWith('/api/')) { send(res, 404, { error: 'not found' }); return; }
  if (req.method === 'GET') serveStatic(req, res); else send(res, 405, { error: 'method' });
});
server.listen(PORT, () => console.log(`Vista Bay server on http://localhost:${PORT}  (accounts: ${Object.keys(db.users).length})`));
