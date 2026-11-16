'use strict';
// Passwörter (scrypt), Sitzungs-Token, Hilfen für Temporärpasswörter
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, s, k] = parts;
  const expected = Buffer.from(k, 'base64');
  const key = await scrypt(pw, Buffer.from(s, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Gleiche Rechenzeit auch bei unbekanntem Benutzernamen
let dummyHash = null;
async function burnTime(pw) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(pw, dummyHash);
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const newId = (prefix) => prefix + '_' + crypto.randomBytes(9).toString('base64url');

// Gut lesbares Einmalpasswort, z. B. "k7mq-x4tr-9wpa"
function tempPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) { out += A[bytes[i] % A.length]; if (i === 3 || i === 7) out += '-'; }
  return out;
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Das Passwort muss mindestens 10 Zeichen lang sein.';
  if (pw.length > 200) return 'Das Passwort ist zu lang.';
  return null;
}

module.exports = { hashPassword, verifyPassword, burnTime, newToken, hashToken, newId, tempPassword, passwordProblem };
