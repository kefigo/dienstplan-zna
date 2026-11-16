'use strict';
// Sicherung der Datenbank im laufenden Betrieb: npm run backup [-- <zielordner>]
const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('../db');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const target = process.argv[2] || path.join(dataDir, 'backups');
fs.mkdirSync(target, { recursive: true });
const file = path.join(target, 'dienstplan-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.db');
const db = openDb(dataDir);
db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
console.log('Sicherung geschrieben: ' + file);
