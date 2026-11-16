'use strict';
// Notfall: Passwort eines Kontos direkt auf dem Server zurücksetzen.
// Aufruf: npm run reset-password -- <benutzername>
const path = require('node:path');
const { openDb } = require('../db');
const A = require('../auth');

(async () => {
  const username = String(process.argv[2] || '').trim().toLowerCase();
  if (!username) { console.error('Aufruf: npm run reset-password -- <benutzername>'); process.exit(1); }
  const db = openDb(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) { console.error('Kein Konto mit dem Benutzernamen "' + username + '" gefunden.'); process.exit(1); }
  const temp = A.tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change = 1, active = 1 WHERE id = ?').run(await A.hashPassword(temp), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare("INSERT INTO audit (at, username, action, detail) VALUES (?, 'server', 'password_reset', ?)").run(new Date().toISOString(), u.username + ' (über die Kommandozeile)');
  console.log('Neues Einmalpasswort für "' + u.username + '": ' + temp);
  console.log('Beim nächsten Anmelden muss ein eigenes Passwort gesetzt werden.');
})();
