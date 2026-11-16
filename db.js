'use strict';
// Datenbank: eine SQLite-Datei (node:sqlite, ab Node 22.13 ohne Zusatzpaket).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','planner','reader')),
  staff_id      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login    TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  short  TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 0,
  soll_f INTEGER NOT NULL DEFAULT 0,
  soll_s INTEGER NOT NULL DEFAULT 0,
  soll_n INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS staff (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  qual  TEXT NOT NULL DEFAULT '',
  hours REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS weeks (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  user_id  TEXT,
  username TEXT,
  action   TEXT NOT NULL,
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
`;

// Bereiche der Notaufnahme als Startwerte (lassen sich in der App ändern)
const DEFAULT_POSITIONS = [
  ['p_lieger_a', 'Lieger A', 'LA', 0, 1, 1, 1],
  ['p_lieger_b', 'Lieger B', 'LB', 1, 1, 1, 1],
  ['p_lieger_c', 'Lieger C', 'LC', 2, 1, 1, 0],
  ['p_springer', 'Springer', 'SPR', 3, 1, 1, 1],
  ['p_aufnahmestation', 'Aufnahmestation', 'AST', 4, 1, 1, 0],
  ['p_aufnahme_triage', 'Aufnahme & Triage', 'AT', 5, 1, 1, 0]
];

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'dienstplan.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const n = db.prepare('SELECT COUNT(*) AS n FROM positions').get().n;
  const meta = db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'seed'").get().n;
  if (!n && !meta) {
    const ins = db.prepare('INSERT INTO positions (id, name, short, sort, soll_f, soll_s, soll_n) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const p of DEFAULT_POSITIONS) ins.run(...p);
    db.prepare("INSERT INTO audit (at, action, detail) VALUES (?, 'seed', 'Standardbereiche angelegt')").run(new Date().toISOString());
  }
  return db;
}

// Kleine Transaktionshilfe
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}

module.exports = { openDb, tx };
