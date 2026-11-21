// Vista Bay hesap sunucusu — Cloudflare Workers + D1 sürümü (server/server.js ile aynı API)
// Kurulum: README.md → "Hesap sunucusu: Cloudflare ile kurulum". Tablolar ilk istekte otomatik oluşturulur.
//
// Bağlamalar (Worker → Settings):
//   D1 veritabanı      DB               (zorunlu)
//   Secret             ADMIN_PASSWORD   (zorunlu — admin hesabının şifresi)
//   Secret             TICKET_SECRET    (zorunlu — uzun rastgele bir metin)
//   Değişken           ADMIN_USER       (isteğe bağlı, varsayılan "admin")
//   Değişken           ALLOWED_ORIGINS  (isteğe bağlı, örn "https://vista.serli.net", varsayılan "*")
const TOKEN_TTL = 30 * 24 * 3600 * 1000, TICKET_TTL = 15 * 60 * 1000, MAX_SAVE = 256 * 1024, PBKDF2_ITER = 20000;
const NAME_RE = /^[a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]{3,14}$/;
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = s => b64u(enc.encode(s));
const unb64u = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function hashPass(pass, salt = randHex(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITER }, key, 256);
  return { salt, hash: hex(bits) };
}
async function checkPass(u, pass) { return safeEq((await hashPass(pass, u.salt)).hash, u.hash); }
async function hmac(secret, body) { const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(body))); }
// ---------------- database
let schemaReady = false;
async function schema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS users (k TEXT PRIMARY KEY, name TEXT, salt TEXT, hash TEXT, role TEXT, banned INTEGER DEFAULT 0, data TEXT, created INTEGER, saved INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS tokens (t TEXT PRIMARY KEY, k TEXT, exp INTEGER)'),
  ]);
  schemaReady = true;
}
const getUser = (db, k) => db.prepare('SELECT * FROM users WHERE k = ?').bind(k).first();
async function newToken(db, k) { const t = randHex(32); await db.prepare('INSERT INTO tokens (t, k, exp) VALUES (?, ?, ?)').bind(t, k, Date.now() + TOKEN_TTL).run(); return t; }
async function userFromReq(req, db) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization') || ''); if (!m) return null;
  const t = await db.prepare('SELECT * FROM tokens WHERE t = ?').bind(m[1]).first(); if (!t || t.exp < Date.now()) return null;
  const u = await getUser(db, t.k); if (!u || u.banned) return null;
  return { key: t.k, u, token: m[1] };
}
const profile = (k, u) => ({ user: u.name || k, role: u.role || 'player', data: u.data ? JSON.parse(u.data) : null, created: u.created });
// admin account is kept in sync with the ADMIN_PASSWORD secret
async function ensureAdmin(env, db) {
  const k = (env.ADMIN_USER || 'admin').toLowerCase(), u = await getUser(db, k);
  const h = await hashPass(env.ADMIN_PASSWORD);
  if (u) await db.prepare('UPDATE users SET salt = ?, hash = ?, role = ?, banned = 0 WHERE k = ?').bind(h.salt, h.hash, 'admin', k).run();
  else await db.prepare('INSERT INTO users (k, name, salt, hash, role, banned, data, created) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)').bind(k, k, h.salt, h.hash, 'admin', Date.now()).run();
}
// best-effort rate limit (per Worker instance)
const hits = new Map();
function limited(req, group, max) {
  const ip = req.headers.get('CF-Connecting-IP') || 'x', k = group + '|' + ip, now = Date.now();
  let h = hits.get(k); if (!h || h.t < now) { h = { n: 0, t: now + 60000 }; hits.set(k, h); }
  if (hits.size > 5000) hits.clear();
  return ++h.n > max;
}
async function body(req, max = MAX_SAVE + 4096) {
  const txt = await req.text(); if (txt.length > max) throw new Error('Veri çok büyük');
  try { return txt ? JSON.parse(txt) : {}; } catch (e) { throw new Error('Geçersiz veri'); }
}
// ---------------- routes
const routes = {
  'GET /api/health': async (req, env, db) => [200, { ok: true, name: 'vista-bay', platform: 'cloudflare' }],
  'POST /api/register': async (req, env, db) => {
    if (limited(req, 'reg', 8)) return [429, { error: 'Çok fazla deneme, biraz bekle' }];
    const { user, pass } = await body(req, 4096);
    if (typeof user !== 'string' || !NAME_RE.test(user)) return [400, { error: 'Kullanıcı adı 3-14 harf/rakam olmalı' }];
    if (typeof pass !== 'string' || pass.length < 4 || pass.length > 64) return [400, { error: 'Şifre 4-64 karakter olmalı' }];
    const k = user.toLowerCase();
    if (k === (env.ADMIN_USER || 'admin').toLowerCase() || await getUser(db, k)) return [409, { error: 'Bu kullanıcı adı alınmış' }];
    const h = await hashPass(pass);
    await db.prepare('INSERT INTO users (k, name, salt, hash, role, banned, data, created) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)').bind(k, user, h.salt, h.hash, 'player', Date.now()).run();
    return [200, { token: await newToken(db, k), user, role: 'player', data: null }];
  },
  'POST /api/login': async (req, env, db) => {
    if (limited(req, 'login', 12)) return [429, { error: 'Çok fazla deneme, biraz bekle' }];
    const { user, pass } = await body(req, 4096), k = String(user || '').toLowerCase();
    if (k === (env.ADMIN_USER || 'admin').toLowerCase()) {        // admin: compared with the secret directly (one hash at most)
      if (typeof pass !== 'string' || !safeEq(pass, String(env.ADMIN_PASSWORD))) return [401, { error: 'Kullanıcı adı ya da şifre yanlış' }];
      let u = await getUser(db, k);
      if (!u || u.role !== 'admin') { await ensureAdmin(env, db); u = await getUser(db, k); }
      return [200, { token: await newToken(db, k), ...profile(k, u) }];
    }
    const u = await getUser(db, k);
    if (!u || typeof pass !== 'string' || !await checkPass(u, pass)) return [401, { error: 'Kullanıcı adı ya da şifre yanlış' }];
    if (u.banned) return [403, { error: 'Bu hesap yasaklandı' }];
    return [200, { token: await newToken(db, k), ...profile(k, u) }];
  },
  'POST /api/logout': async (req, env, db) => { const a = await userFromReq(req, db); if (a) await db.prepare('DELETE FROM tokens WHERE t = ?').bind(a.token).run(); return [200, { ok: true }]; },
  'GET /api/me': async (req, env, db) => { const a = await userFromReq(req, db); return a ? [200, profile(a.key, a.u)] : [401, { error: 'Oturum geçersiz' }]; },
  'POST /api/save': async (req, env, db) => {
    const a = await userFromReq(req, db); if (!a) return [401, { error: 'Oturum geçersiz' }];
    if (limited(req, 'save', 30)) return [429, { error: 'Çok sık kayıt' }];
    const { data } = await body(req);
    if (!data || typeof data !== 'object') return [400, { error: 'Kayıt verisi yok' }];
    const now = Date.now(); await db.prepare('UPDATE users SET data = ?, saved = ? WHERE k = ?').bind(JSON.stringify(data), now, a.key).run();
    return [200, { ok: true, saved: now }];
  },
  'POST /api/ticket': async (req, env, db) => {
    const a = await userFromReq(req, db); if (!a) return [401, { error: 'Oturum geçersiz' }];
    const { aud } = await body(req, 1024);
    const b = b64uStr(JSON.stringify({ user: a.u.name || a.key, key: a.key, role: a.u.role || 'player', aud: String(aud || '').slice(0, 40), exp: Date.now() + TICKET_TTL }));
    return [200, { ticket: b + '.' + await hmac(env.TICKET_SECRET, b) }];
  },
  'POST /api/verify': async (req, env, db) => {
    if (limited(req, 'verify', 120)) return [429, { error: 'rate' }];
    const { ticket, aud } = await body(req, 2048);
    if (typeof ticket !== 'string' || ticket.length > 600) return [200, { ok: false }];
    const [b, sig] = ticket.split('.'); if (!b || !sig || !safeEq(await hmac(env.TICKET_SECRET, b), sig)) return [200, { ok: false }];
    let p; try { p = JSON.parse(unb64u(b)); } catch (e) { return [200, { ok: false }]; }
    if (!(p.exp > Date.now())) return [200, { ok: false }];
    if (aud !== undefined && p.aud !== String(aud)) return [200, { ok: false, reason: 'aud' }];
    const u = await getUser(db, p.key); if (!u) return [200, { ok: false }];
    return [200, { ok: !u.banned, banned: !!u.banned, user: u.name || p.key, role: u.role || 'player' }];
  },
  'GET /api/admin/users': async (req, env, db) => {
    const a = await userFromReq(req, db); if (!a || a.u.role !== 'admin') return [403, { error: 'Yetki yok' }];
    const { results } = await db.prepare('SELECT k, name, role, banned, data, saved FROM users ORDER BY created DESC LIMIT 500').all();
    return [200, { users: results.map(u => ({ user: u.name || u.k, role: u.role, banned: !!u.banned, money: u.data ? (JSON.parse(u.data).money || 0) : 0, saved: u.saved })) }];
  },
  'POST /api/admin/ban': async (req, env, db) => {
    const a = await userFromReq(req, db); if (!a || a.u.role !== 'admin') return [403, { error: 'Yetki yok' }];
    const { user, ban } = await body(req, 1024), k = String(user || '').toLowerCase(), u = await getUser(db, k);
    if (!u) return [404, { error: 'Böyle bir hesap yok' }];
    if (u.role === 'admin') return [400, { error: 'Admin yasaklanamaz' }];
    await db.prepare('UPDATE users SET banned = ? WHERE k = ?').bind(ban ? 1 : 0, k).run();
    if (ban) await db.prepare('DELETE FROM tokens WHERE k = ?').bind(k).run();
    return [200, { ok: true, user: u.name, banned: !!ban }];
  },
  'POST /api/admin/money': async (req, env, db) => {
    const a = await userFromReq(req, db); if (!a || a.u.role !== 'admin') return [403, { error: 'Yetki yok' }];
    const { user, amount } = await body(req, 1024), k = String(user || '').toLowerCase(), u = await getUser(db, k), amt = Math.round(+amount);
    if (!u) return [404, { error: 'Böyle bir hesap yok' }];
    if (!Number.isFinite(amt) || Math.abs(amt) > 1e9) return [400, { error: 'Geçersiz miktar' }];
    const data = u.data ? JSON.parse(u.data) : {}; data.money = Math.max(0, (data.money || 0) + amt);
    await db.prepare('UPDATE users SET data = ? WHERE k = ?').bind(JSON.stringify(data), k).run();
    return [200, { ok: true, money: data.money }];
  },
};
function corsHeaders(req, env) {
  const o = req.headers.get('Origin'), list = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  const allow = list.includes('*') ? (o || '*') : (o && list.includes(o) ? o : list[0]);
  return { 'Access-Control-Allow-Origin': allow, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
}
export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (!env.DB) return json(500, { error: 'D1 veritabanı bağlanmamış (DB)' });
    if (!env.ADMIN_PASSWORD || !env.TICKET_SECRET) return json(500, { error: 'ADMIN_PASSWORD ve TICKET_SECRET ayarlanmamış' });
    const url = new URL(req.url), fn = routes[`${req.method} ${url.pathname}`];
    if (!fn) return json(404, { error: 'not found' });
    try { await schema(env.DB); const [code, obj] = await fn(req, env, env.DB); return json(code, obj); }
    catch (e) { return json(400, { error: e.message || 'Hata' }); }
  },
};
