'use strict';
/*
 * Dienstplan Notaufnahme – eigenständiger Server
 * Anmeldung mit Benutzername/Passwort, Rollen: admin (Leitung), planner (Planung), reader (Lesen).
 * Jede Anfrage wird hier geprüft; die Oberfläche blendet nur zusätzlich aus.
 */
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { openDb, tx } = require('./db');
const A = require('./auth');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SESSION_HOURS = +process.env.SESSION_HOURS || 12;
const COOKIE_SECURE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : process.env.NODE_ENV === 'production';
const COOKIE = 'zna_sid';

const db = openDb(DATA_DIR);
const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------- Ersteinrichtung ----------
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
let SETUP_CODE = null;
if (!userCount()) {
  SETUP_CODE = String(crypto.randomInt(100000, 999999)) + '-' + String(crypto.randomInt(100000, 999999));
  console.log('\n==============================================================');
  console.log(' Ersteinrichtung: Es gibt noch kein Benutzerkonto.');
  console.log(' Öffne die Anwendung im Browser und gib diesen Einrichtungscode ein:');
  console.log('   ' + SETUP_CODE);
  console.log('==============================================================\n');
}

// ---------- Hilfen ----------
const now = () => new Date().toISOString();
function audit(user, action, detail) {
  db.prepare('INSERT INTO audit (at, user_id, username, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(now(), user ? user.id : null, user ? user.username : null, action, detail ? String(detail).slice(0, 500) : null);
}
class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
const bad = (msg) => new HttpError(400, msg, 'bad_request');
const str = (v, max, field) => {
  if (typeof v !== 'string') throw bad(field + ' fehlt.');
  const t = v.trim(); if (!t) throw bad(field + ' darf nicht leer sein.');
  if (t.length > max) throw bad(field + ' ist zu lang (max. ' + max + ' Zeichen).');
  return t;
};
const int = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const SHIFTS = ['F', 'S', 'N'];
const CELL_CODES = ['', 'U', 'K', 'FB', 'X'];
const QUALS = ['', 'PFK', 'FWB', 'PH', 'SCH', 'PRA', 'FSJ'];
const ROLES = ['admin', 'planner', 'reader'];
const ROLE_DE = { admin: 'Leitung', planner: 'Planung', reader: 'Lesen' };
const SHIFT_LABEL = { F: 'Früh', S: 'Spät', N: 'Nacht' };
const DAY_LABEL = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const CELL_LABEL = { U: 'Urlaub', K: 'Krank', FB: 'Fortbildung', X: 'Frei' };
const checkId = (id, what) => { if (!ID_RE.test(String(id))) throw bad('Ungültige ' + what + '.'); return String(id); };
const checkWeek = (id) => { if (!WEEK_RE.test(String(id))) throw bad('Ungültige Kalenderwoche.'); return String(id); };

function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setSessionCookie(res, token, maxAgeSec) {
  const parts = [COOKIE + '=' + (token || ''), 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=' + maxAgeSec];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
const publicUser = (u) => u && ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, staffId: u.staff_id || null, mustChange: !!u.must_change, active: !!u.active, createdAt: u.created_at, lastLogin: u.last_login });

// ---------- Sicherheits-Header ----------
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (COOKIE_SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// ---------- Statische Dateien ----------
const nm = (p) => path.join(__dirname, 'node_modules', p);
const staticOpts = { maxAge: '7d', index: false };
app.use('/vendor/jspdf', express.static(nm('jspdf/dist'), staticOpts));
app.use('/vendor/jspdf-autotable', express.static(nm('jspdf-autotable/dist'), staticOpts));
app.use('/fonts/ibm-plex-sans', express.static(nm('@fontsource/ibm-plex-sans'), staticOpts));
app.use('/fonts/ibm-plex-sans-condensed', express.static(nm('@fontsource/ibm-plex-sans-condensed'), staticOpts));
app.use('/fonts/ibm-plex-mono', express.static(nm('@fontsource/ibm-plex-mono'), staticOpts));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// ---------- API-Grundgerüst ----------
const api = express.Router();
api.use(express.json({ limit: '512kb' }));
api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
// CSRF-Schutz: SameSite=Strict-Cookie und zusätzlich ein eigener Header für jede Änderung
api.use((req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'zna') return res.status(403).json({ error: 'Anfrage abgelehnt.', code: 'csrf' });
  next();
});
// Sitzung laden
api.use((req, res, next) => {
  const tok = parseCookies(req.headers.cookie)[COOKIE];
  if (tok) {
    const row = db.prepare('SELECT u.*, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(A.hashToken(tok));
    if (row && row.s_exp > Date.now() && row.active) {
      req.user = row; req.tokenHash = A.hashToken(tok);
      // Gleitende Verlängerung, höchstens alle 10 Minuten
      const exp = Date.now() + SESSION_HOURS * 3600e3;
      if (exp - row.s_exp > 10 * 60e3) { db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(exp, req.tokenHash); setSessionCookie(res, tok, SESSION_HOURS * 3600); }
    }
  }
  next();
});
const wrap = (fn) => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
function need(level) {
  const rank = { reader: 1, planner: 2, admin: 3 };
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Bitte melde dich an.', code: 'auth' });
    if (req.user.must_change) return res.status(403).json({ error: 'Bitte ändere zuerst dein Passwort.', code: 'must_change' });
    if (rank[req.user.role] < rank[level]) return res.status(403).json({ error: 'Dafür fehlt dir die Berechtigung.', code: 'forbidden' });
    next();
  };
}

// ---------- Live-Aktualisierung (Server-Sent Events) ----------
const clients = new Set();
function broadcast(msg) {
  const line = 'event: change\ndata: ' + JSON.stringify(msg) + '\n\n';
  for (const c of clients) { try { c.write(line); } catch (_) {} }
}
api.get('/events', need('reader'), (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

// ---------- Anmeldung ----------
const attempts = new Map(); // Schutz gegen Ausprobieren von Passwörtern
function tooMany(key) { const a = attempts.get(key); return a && a.until > Date.now(); }
function failed(key) {
  const a = attempts.get(key) || { n: 0, until: 0 }; a.n++;
  if (a.n >= 8) { a.until = Date.now() + 15 * 60e3; a.n = 0; }
  attempts.set(key, a);
}
async function startSession(res, user) {
  const tok = A.newToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(A.hashToken(tok), user.id, Date.now() + SESSION_HOURS * 3600e3, Date.now());
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  setSessionCookie(res, tok, SESSION_HOURS * 3600);
}

api.get('/setup', (req, res) => res.json({ needed: !userCount() }));
api.post('/setup', wrap(async (req, res) => {
  if (userCount() || !SETUP_CODE) throw new HttpError(409, 'Die Einrichtung ist bereits abgeschlossen.');
  const ip = 'setup|' + req.ip;
  if (tooMany(ip)) throw new HttpError(429, 'Zu viele Versuche. Bitte warte 15 Minuten.');
  if (String(req.body.code || '').trim() !== SETUP_CODE) { failed(ip); throw new HttpError(403, 'Der Einrichtungscode stimmt nicht. Du findest ihn in der Ausgabe des Servers.'); }
  const username = str(req.body.username, 40, 'Benutzername').toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Benutzername: 3–40 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.');
  const displayName = str(req.body.displayName, 80, 'Name');
  const prob = A.passwordProblem(req.body.password); if (prob) throw bad(prob);
  const user = { id: A.newId('u'), username, display_name: displayName, role: 'admin' };
  db.prepare('INSERT INTO users (id, username, display_name, password_hash, role, must_change, created_at, last_login) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
    .run(user.id, username, displayName, await A.hashPassword(req.body.password), 'admin', now(), now());
  SETUP_CODE = null;
  audit(user, 'setup', 'Erstes Leitungskonto angelegt');
  await startSession(res, user);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
}));

api.post('/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 40);
  const password = String(req.body.password || '');
  const key = username + '|' + req.ip;
  if (tooMany(key)) throw new HttpError(429, 'Zu viele Fehlversuche. Bitte warte 15 Minuten.');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = u ? await A.verifyPassword(password, u.password_hash) : (await A.burnTime(password), false);
  if (!ok || !u.active) {
    failed(key);
    audit(u || { id: null, username }, 'login_failed', u && !u.active ? 'Konto deaktiviert' : null);
    throw new HttpError(401, u && ok && !u.active ? 'Dieses Konto ist deaktiviert. Wende dich an die Leitung.' : 'Benutzername oder Passwort ist falsch.');
  }
  attempts.delete(key);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), u.id);
  audit(u, 'login');
  await startSession(res, u);
  res.json({ user: publicUser(u) });
}));

api.post('/logout', (req, res) => {
  if (req.tokenHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.tokenHash);
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

api.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Bitte melde dich an.', code: 'auth', setupNeeded: !userCount() });
  res.json({ user: publicUser(req.user) });
});

api.post('/me/password', wrap(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Bitte melde dich an.');
  if (!(await A.verifyPassword(String(req.body.current || ''), req.user.password_hash))) throw new HttpError(403, 'Das aktuelle Passwort stimmt nicht.');
  const prob = A.passwordProblem(req.body.next); if (prob) throw bad(prob);
  if (req.body.next === req.body.current) throw bad('Das neue Passwort muss sich vom alten unterscheiden.');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(await A.hashPassword(req.body.next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(req.user.id, req.tokenHash);
  audit(req.user, 'password_changed');
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
}));

// ---------- Stammdaten ----------
const posOut = (p) => ({ id: p.id, name: p.name, short: p.short, order: p.sort, soll: { F: p.soll_f, S: p.soll_s, N: p.soll_n } });
const staffOut = (s) => ({ id: s.id, name: s.name, qual: s.qual, hours: s.hours });
api.get('/data', need('reader'), (req, res) => {
  res.json({
    positions: db.prepare('SELECT * FROM positions ORDER BY sort, name').all().map(posOut),
    staff: db.prepare('SELECT * FROM staff ORDER BY name').all().map(staffOut)
  });
});
api.put('/positions/:id', need('admin'), (req, res) => {
  const id = checkId(req.params.id, 'Bereichs-ID');
  const b = req.body || {}, soll = b.soll || {};
  const p = [str(b.name, 60, 'Bereich'), str(b.short, 5, 'Kürzel').toUpperCase(), int(b.order, 0, 999), int(soll.F, 0, 20), int(soll.S, 0, 20), int(soll.N, 0, 20)];
  const existed = !!db.prepare('SELECT 1 FROM positions WHERE id = ?').get(id);
  db.prepare(`INSERT INTO positions (id, name, short, sort, soll_f, soll_s, soll_n) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, short=excluded.short, sort=excluded.sort, soll_f=excluded.soll_f, soll_s=excluded.soll_s, soll_n=excluded.soll_n`).run(id, ...p);
  audit(req.user, existed ? 'position_updated' : 'position_created', p[0] + ' (' + p[1] + ') Soll ' + p[3] + '/' + p[4] + '/' + p[5]);
  broadcast({ type: 'data' });
  res.json({ ok: true });
});
api.delete('/positions/:id', need('admin'), (req, res) => {
  const id = checkId(req.params.id, 'Bereichs-ID');
  const p = db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
  db.prepare('DELETE FROM positions WHERE id = ?').run(id);
  if (p) audit(req.user, 'position_deleted', p.name);
  broadcast({ type: 'data' });
  res.json({ ok: true });
});
api.put('/staff/:id', need('admin'), (req, res) => {
  const id = checkId(req.params.id, 'Mitarbeitenden-ID');
  const b = req.body || {};
  const qual = QUALS.includes(b.qual) ? b.qual : '';
  const hours = Math.min(60, Math.max(0, Math.round((Number(b.hours) || 0) * 100) / 100));
  const name = str(b.name, 80, 'Name');
  const existed = !!db.prepare('SELECT 1 FROM staff WHERE id = ?').get(id);
  db.prepare('INSERT INTO staff (id, name, qual, hours) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, qual=excluded.qual, hours=excluded.hours').run(id, name, qual, hours);
  audit(req.user, existed ? 'staff_updated' : 'staff_created', name + (qual ? ' (' + qual + ')' : '') + ', ' + hours + ' h');
  broadcast({ type: 'data' });
  res.json({ ok: true });
});
api.delete('/staff/:id', need('admin'), (req, res) => {
  const id = checkId(req.params.id, 'Mitarbeitenden-ID');
  const s = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  tx(db, () => {
    db.prepare('DELETE FROM staff WHERE id = ?').run(id);
    db.prepare('UPDATE users SET staff_id = NULL WHERE staff_id = ?').run(id);
  });
  if (s) audit(req.user, 'staff_deleted', s.name);
  broadcast({ type: 'data' }); broadcast({ type: 'users' });
  res.json({ ok: true });
});

// ---------- Wochen ----------
function readWeek(id) {
  const row = db.prepare('SELECT w.*, u.display_name AS by_name FROM weeks w LEFT JOIN users u ON u.id = w.updated_by WHERE w.id = ?').get(id);
  if (!row) return { exists: false, slots: {}, cells: {}, meta: null };
  const d = JSON.parse(row.data);
  return { exists: true, slots: d.slots || {}, cells: d.cells || {}, meta: row.updated_at ? { byName: row.by_name || 'gelöschtes Konto', at: row.updated_at } : null };
}
function writeWeek(id, data, user) {
  db.prepare(`INSERT INTO weeks (id, data, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(id, JSON.stringify({ slots: data.slots || {}, cells: data.cells || {} }), user.id, now());
}
api.get('/weeks', need('reader'), (req, res) => {
  const weeks = {};
  for (const r of db.prepare('SELECT id, data FROM weeks').all()) { const d = JSON.parse(r.data); weeks[r.id] = { slots: d.slots || {} }; }
  res.json({ weeks });
});
api.get('/weeks/:id', need('reader'), (req, res) => res.json(readWeek(checkWeek(req.params.id))));
api.patch('/weeks/:id', need('planner'), (req, res) => {
  const id = checkWeek(req.params.id), b = req.body || {};
  const d = int(b.d, 0, 6);
  const staffIds = new Set(db.prepare('SELECT id FROM staff').all().map((r) => r.id));
  let detail;
  tx(db, () => {
    const w = readWeek(id);
    if (b.op === 'slot') {
      const posId = checkId(b.posId, 'Bereichs-ID');
      const pos = db.prepare('SELECT name, short FROM positions WHERE id = ?').get(posId);
      if (!pos) throw bad('Diesen Bereich gibt es nicht mehr.');
      if (!SHIFTS.includes(b.sh)) throw bad('Ungültige Schicht.');
      if (!Array.isArray(b.ids) || b.ids.length > 40) throw bad('Ungültige Personenliste.');
      const ids = [...new Set(b.ids.map(String))].filter((x) => staffIds.has(x));
      ((w.slots[posId] = w.slots[posId] || {})[b.sh] = w.slots[posId][b.sh] || {})[d] = ids;
      const names = ids.map((x) => (db.prepare('SELECT name FROM staff WHERE id = ?').get(x) || {}).name).filter(Boolean);
      detail = id + ' · ' + pos.name + ' · ' + SHIFT_LABEL[b.sh] + ' · ' + DAY_LABEL[d] + ': ' + (names.length ? names.join(', ') : 'niemand');
    } else if (b.op === 'cell') {
      const sid = checkId(b.sid, 'Mitarbeitenden-ID');
      if (!staffIds.has(sid)) throw bad('Diese Person gibt es nicht mehr.');
      if (!CELL_CODES.includes(b.code)) throw bad('Ungültiger Eintrag.');
      (w.cells[sid] = w.cells[sid] || {})[d] = b.code;
      const who = (db.prepare('SELECT name FROM staff WHERE id = ?').get(sid) || {}).name;
      detail = id + ' · ' + who + ' · ' + DAY_LABEL[d] + ': ' + (CELL_LABEL[b.code] || 'Eintrag gelöscht');
    } else throw bad('Unbekannte Änderung.');
    writeWeek(id, w, req.user);
  });
  audit(req.user, 'week_changed', detail);
  broadcast({ type: 'week', id });
  res.json({ ok: true });
});
api.post('/weeks/:id/copy-previous', need('planner'), (req, res) => {
  const id = checkWeek(req.params.id);
  const [y, w] = id.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4)); const mon1 = new Date(jan4); mon1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const prevMon = new Date(mon1); prevMon.setUTCDate(mon1.getUTCDate() + (w - 2) * 7);
  const t = new Date(prevMon); t.setUTCDate(prevMon.getUTCDate() + 3);
  const py = t.getUTCFullYear(), pj4 = new Date(Date.UTC(py, 0, 4));
  const pw = 1 + Math.round(((t - pj4) / 864e5 - 3 + ((pj4.getUTCDay() + 6) % 7)) / 7);
  const prevId = py + '-W' + String(pw).padStart(2, '0');
  const prev = readWeek(prevId);
  if (!prev.exists || (!Object.keys(prev.slots).length && !Object.keys(prev.cells).length)) throw new HttpError(404, 'Die Vorwoche ist leer. Es gibt nichts zu übernehmen.');
  writeWeek(id, prev, req.user);
  audit(req.user, 'week_copied', prevId + ' → ' + id);
  broadcast({ type: 'week', id });
  res.json({ ok: true });
});
api.delete('/weeks/:id', need('planner'), (req, res) => {
  const id = checkWeek(req.params.id);
  writeWeek(id, { slots: {}, cells: {} }, req.user);
  audit(req.user, 'week_cleared', id);
  broadcast({ type: 'week', id });
  res.json({ ok: true });
});

// ---------- Benutzer & Rechte (nur Leitung) ----------
const activeAdmins = (exceptId) => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(exceptId || '').n;
api.get('/users', need('admin'), (req, res) => res.json({ users: db.prepare('SELECT * FROM users ORDER BY display_name').all().map(publicUser) }));
api.post('/users', need('admin'), wrap(async (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 40, 'Benutzername').toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Benutzername: 3–40 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Diesen Benutzernamen gibt es schon.');
  const displayName = str(b.displayName, 80, 'Name');
  const role = ROLES.includes(b.role) ? b.role : 'reader';
  const staffId = b.staffId ? checkId(b.staffId, 'Mitarbeitenden-ID') : null;
  if (staffId && !db.prepare('SELECT 1 FROM staff WHERE id = ?').get(staffId)) throw bad('Diese Person gibt es nicht mehr.');
  const temp = A.tempPassword(), id = A.newId('u'), hash = await A.hashPassword(temp);
  tx(db, () => {
    if (staffId) db.prepare('UPDATE users SET staff_id = NULL WHERE staff_id = ?').run(staffId);
    db.prepare('INSERT INTO users (id, username, display_name, password_hash, role, staff_id, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, username, displayName, hash, role, staffId, now());
  });
  audit(req.user, 'user_created', username + ' (' + ROLE_DE[role] + ')');
  broadcast({ type: 'users' });
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)), tempPassword: temp });
}));
api.put('/users/:id', need('admin'), (req, res) => {
  const id = checkId(req.params.id, 'Benutzer-ID'), b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'Dieses Konto gibt es nicht mehr.');
  const displayName = b.displayName !== undefined ? str(b.displayName, 80, 'Name') : u.display_name;
  const role = b.role !== undefined ? (ROLES.includes(b.role) ? b.role : u.role) : u.role;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : u.active;
  let staffId = u.staff_id;
  if (b.staffId !== undefined) {
    staffId = b.staffId ? checkId(b.staffId, 'Mitarbeitenden-ID') : null;
    if (staffId && !db.prepare('SELECT 1 FROM staff WHERE id = ?').get(staffId)) throw bad('Diese Person gibt es nicht mehr.');
  }
  if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && !activeAdmins(u.id)) throw new HttpError(409, 'Es muss mindestens ein aktives Leitungskonto geben.');
  tx(db, () => {
    if (staffId && staffId !== u.staff_id) db.prepare('UPDATE users SET staff_id = NULL WHERE staff_id = ? AND id <> ?').run(staffId, id);
    db.prepare('UPDATE users SET display_name = ?, role = ?, active = ?, staff_id = ? WHERE id = ?').run(displayName, role, active, staffId, id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  });
  const changes = [];
  if (role !== u.role) changes.push('Rolle ' + ROLE_DE[u.role] + ' → ' + ROLE_DE[role]);
  if (active !== u.active) changes.push(active ? 'aktiviert' : 'deaktiviert');
  if (displayName !== u.display_name) changes.push('Name geändert');
  if (staffId !== u.staff_id) changes.push(staffId ? 'mit Mitarbeitenden verknüpft' : 'Verknüpfung gelöst');
  audit(req.user, 'user_updated', u.username + (changes.length ? ': ' + changes.join(', ') : ''));
  broadcast({ type: 'users' });
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});
api.post('/users/:id/reset-password', need('admin'), wrap(async (req, res) => {
  const id = checkId(req.params.id, 'Benutzer-ID');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'Dieses Konto gibt es nicht mehr.');
  const temp = A.tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').run(await A.hashPassword(temp), id);
  if (id !== req.user.id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit(req.user, 'password_reset', u.username);
  res.json({ tempPassword: temp });
}));
api.delete('/users/:id', need('admin'), (req, res) => {
  const id = checkId(req.params.id, 'Benutzer-ID');
  if (id === req.user.id) throw new HttpError(409, 'Du kannst dein eigenes Konto nicht löschen.');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.json({ ok: true });
  if (u.role === 'admin' && u.active && !activeAdmins(u.id)) throw new HttpError(409, 'Es muss mindestens ein aktives Leitungskonto geben.');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.user, 'user_deleted', u.username);
  broadcast({ type: 'users' });
  res.json({ ok: true });
});
api.get('/audit', need('admin'), (req, res) => {
  const limit = int(req.query.limit || 150, 1, 1000);
  res.json({ entries: db.prepare('SELECT at, username, action, detail FROM audit ORDER BY id DESC LIMIT ?').all(limit) });
});

api.use((req, res) => res.status(404).json({ error: 'Nicht gefunden.' }));
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültige Anfrage.' });
  console.error(err);
  res.status(500).json({ error: 'Interner Fehler. Bitte erneut versuchen.' });
});
app.use('/api', api);

// Abgelaufene Sitzungen regelmäßig entfernen
setInterval(() => { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }, 3600e3).unref();

app.listen(PORT, HOST, () => console.log('Dienstplan Notaufnahme läuft auf http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT));
