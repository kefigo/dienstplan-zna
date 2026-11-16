"use strict";
(function () {
  "use strict";
  const SHIFTS = {
    F:  { label: "Früh",        time: "06:00–14:30", h: 8 },
    S:  { label: "Spät",        time: "14:00–22:30", h: 8 },
    N:  { label: "Nacht",       time: "22:00–06:30", h: 8 },
    X:  { label: "Frei",        time: "", h: 0, show: "–" },
    U:  { label: "Urlaub",      time: "", h: 7.7 },
    K:  { label: "Krank",       time: "", h: 7.7 },
    FB: { label: "Fortbildung", time: "", h: 8 }
  };
  const DUTY = ["F", "S", "N"];
  const ABSENT = ["U", "K", "FB"];
  const ABS_BRUSH = ["U", "K", "FB", "X"];
  const REST_BAD = { N: ["F", "S", "FB"], S: ["F"] }; // Ruhezeit < 11 h (ArbZG §5)
  const restBad = (a, b) => !!(a && REST_BAD[a] && REST_BAD[a].includes(b));
  const QUALS = [
    { k: "PFK", label: "Pflegefachkraft", tier: "fk" },
    { k: "FWB", label: "Pflegefachkraft mit Fachweiterbildung", tier: "fk" },
    { k: "PH",  label: "Pflegehelfer/-in", tier: "hf" },
    { k: "SCH", label: "Schüler/-in", tier: "lern" },
    { k: "PRA", label: "Praktikant/-in", tier: "lern" },
    { k: "FSJ", label: "Freiwilliges Soziales Jahr", tier: "lern" }
  ];
  const QUAL = Object.fromEntries(QUALS.map((q) => [q.k, q]));
  const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const DAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtH = (n) => (Math.round(n * 10) / 10).toLocaleString("de-DE");
  const newId = (p) => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function mondayOf(date) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function isoWeek(mon) { const t = addDays(mon, 3), y = t.getFullYear(), jan4 = new Date(y, 0, 4); return { y, w: 1 + Math.round(((t - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7) }; }
  const weekIdOf = (mon) => { const { y, w } = isoWeek(mon); return y + "-W" + String(w).padStart(2, "0"); };
  const dShort = (d) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const qbadge = (s) => s && QUAL[s.qual] ? '<span class="qb ' + QUAL[s.qual].tier + '" title="' + QUAL[s.qual].label + '">' + s.qual + '</span>' : "";
  const qualOptions = (cur) => '<option value="">Keine Angabe</option>' + QUALS.map((q) => '<option value="' + q.k + '"' + (q.k === cur ? " selected" : "") + '>' + q.label + ' (' + q.k + ')</option>').join("");
  function qualGroups() {
    const groups = QUALS.map((q) => ({ name: q.label, short: q.k, staff: [] })), gi = Object.fromEntries(QUALS.map((q, i) => [q.k, groups[i]]));
    const none = { name: "Ohne Qualifikation", short: "", staff: [] };
    state.staff.slice().sort((a, b) => String(a.name).localeCompare(b.name, "de")).forEach((s) => (gi[s.qual] || none).staff.push(s));
    return groups.concat([none]).filter((g) => g.staff.length);
  }
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));

  let view = "areas";
  try { const v = localStorage.getItem("zna-view"); if (v === "people" || v === "areas") view = v; } catch (e) {}

  const state = {
    allWeeks: {}, ovYear: isoWeek(mondayOf(new Date())).y,
    monday: mondayOf(new Date()), positions: [], staff: [], slots: {}, cells: {}, weekExists: false,
    pending: {}, brush: "U", canWrite: false, canAdmin: false, myStaffId: null, weekMeta: null, loaded: { pos: false, st: false }, armed: new Set(), picker: null
  };
  let adapter = null, unsubWeek = null, writeChain = Promise.resolve(), IDX = null;

  // ---------- PIN & Rollen ----------
  let ME = null;
  const ROLE_LABEL = { admin: "Leitung", planner: "Planung", reader: "Lesen" };
  const ROLE_CLS = { admin: "lead", planner: "plan", reader: "read" };
  const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  // SHA-256 in reinem JavaScript (funktioniert auch ohne HTTPS und beim Öffnen als Datei)
  const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(bytes) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
    m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(n - 4, (l * 8) >>> 0); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
    const W = new Array(64);
    for (let i = 0; i < n; i += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const x = W[t - 15], y = W[t - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K256[t] + W[t]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & b) ^ (a & c) ^ (b & c);
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + ((S0 + mj) >>> 0)) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer); H.forEach((v, i) => ov.setUint32(i * 4, v)); return out;
  }
  const utf8 = (str) => new TextEncoder().encode(str);
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const PIN_ITER = 20000;
  function pinHash(pin, salt, iter) {
    const sb = utf8(salt); let k = sha256(utf8(salt + "|" + pin));
    const buf = new Uint8Array(32 + sb.length); buf.set(sb, 32);
    for (let i = 0; i < iter; i++) { buf.set(k, 0); k = sha256(buf); }
    return hex(k);
  }
  function makePin(pin) { const r = new Uint8Array(16); crypto.getRandomValues(r); const salt = hex(r); return { pinSalt: salt, pinIter: PIN_ITER, pinHash: pinHash(pin, salt, PIN_ITER) }; }
  const checkPin = (u, pin) => !!u && !!u.pinHash && pinHash(pin, u.pinSalt, u.pinIter || PIN_ITER) === u.pinHash;
  function pinProblem(pin) {
    if (!/^\d{4,8}$/.test(pin)) return "Die PIN muss aus 4 bis 8 Ziffern bestehen.";
    if (/^(\d)\1+$/.test(pin)) return "Bitte keine PIN aus lauter gleichen Ziffern.";
    if ("0123456789".includes(pin) || "9876543210".includes(pin)) return "Bitte keine aufsteigende oder absteigende Zahlenfolge.";
    return null;
  }
  function tempPin() { const r = new Uint32Array(1); let p; do { crypto.getRandomValues(r); p = String(r[0] % 1000000).padStart(6, "0"); } while (pinProblem(p)); return p; }
  function logAudit(action, detail) { if (adapter) adapter.log({ at: new Date().toISOString(), by: ME ? ME.name : "", action, detail: detail ? String(detail).slice(0, 300) : "" }); }
  const myStaff = () => state.myStaffId ? state.staff.find((s) => s.id === state.myStaffId) : null;

  // ---------- Speicher ----------
  function deepMerge(t, p) { for (const k in p) { const v = p[k]; if (v && typeof v === "object" && !Array.isArray(v)) { if (!t[k] || typeof t[k] !== "object" || Array.isArray(t[k])) t[k] = {}; deepMerge(t[k], v); } else t[k] = v; } return t; }
  // Startwerte: die Bereiche der Notaufnahme
  const DEFAULT_POSITIONS = {
    p_lieger_a: { name: "Lieger A", short: "LA", order: 0, soll: { F: 1, S: 1, N: 1 } },
    p_lieger_b: { name: "Lieger B", short: "LB", order: 1, soll: { F: 1, S: 1, N: 1 } },
    p_lieger_c: { name: "Lieger C", short: "LC", order: 2, soll: { F: 1, S: 1, N: 0 } },
    p_springer: { name: "Springer", short: "SPR", order: 3, soll: { F: 1, S: 1, N: 1 } },
    p_aufnahmestation: { name: "Aufnahmestation", short: "AST", order: 4, soll: { F: 1, S: 1, N: 0 } },
    p_aufnahme_triage: { name: "Aufnahme & Triage", short: "AT", order: 5, soll: { F: 1, S: 1, N: 0 } }
  };
  const STORE_KEY = "zna-dienstplan";
  function localAdapter() {
    let data = null, storageOk = true;
    const read = () => { try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { storageOk = false; return null; } };
    data = read();
    if (!data) { data = { positions: clone(DEFAULT_POSITIONS), staff: {}, weeks: {}, users: {}, audit: [], savedAt: null, backupAt: null }; persist(); }
    const fix = () => { ["positions", "staff", "weeks", "users"].forEach((k) => { if (!data[k] || typeof data[k] !== "object") data[k] = {}; }); if (!Array.isArray(data.audit)) data.audit = []; };
    fix();
    const subs = { positions: [], staff: [], weeks: [], all: [], users: [] }, meta = { fromCache: false };
    function persist() {
      data.savedAt = new Date().toISOString();
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); storageOk = true; }
      catch (e) { storageOk = false; showNotice("Speichern im Browser ist nicht möglich (privates Fenster oder Speicher voll). Lade eine Sicherung herunter, sonst gehen die Änderungen verloren.", true); }
    }
    const emitOnly = (kind) => {
      if (kind === "weeks") { subs.all.forEach((cb) => cb(clone(data.weeks))); subs.weeks.forEach((s) => s.cb(data.weeks[s.id] ? clone(data.weeks[s.id]) : null, meta)); }
      else if (kind === "users") subs.users.forEach((cb) => cb());
      else subs[kind].forEach((cb) => cb(Object.entries(data[kind]).map(([id, v]) => Object.assign({ id }, v)), meta));
    };
    const emit = (kind) => { persist(); emitOnly(kind); };
    const emitAll = () => ["positions", "staff", "weeks", "users"].forEach(emitOnly);
    // Gleicher Browser, anderer Tab: Änderungen übernehmen
    window.addEventListener("storage", (e) => { if (e.key === STORE_KEY && e.newValue) { try { data = JSON.parse(e.newValue); fix(); emitAll(); } catch (err) {} } });
    const sub = (kind) => (cb) => { subs[kind].push(cb); setTimeout(() => emitOnly(kind)); return () => { subs[kind] = subs[kind].filter((x) => x !== cb); }; };
    return {
      storageOk: () => storageOk,
      subPositions: sub("positions"), subStaff: sub("staff"),
      subAllWeeks: (cb) => { subs.all.push(cb); setTimeout(() => cb(clone(data.weeks))); return () => {}; },
      subWeek: (id, cb) => { const s = { id, cb }; subs.weeks.push(s); setTimeout(() => cb(data.weeks[id] ? clone(data.weeks[id]) : null, meta)); return () => { subs.weeks = subs.weeks.filter((x) => x !== s); }; },
      savePosition: async (p) => { const { id, ...r } = p; data.positions[id] = r; emit("positions"); },
      deletePosition: async (id) => { delete data.positions[id]; emit("positions"); },
      saveStaff: async (p) => { const { id, ...r } = p; data.staff[id] = r; emit("staff"); },
      deleteStaff: async (id) => { delete data.staff[id]; emit("staff"); },
      patchWeek: async (wk, patch) => { deepMerge(data.weeks[wk] || (data.weeks[wk] = {}), clone(patch)); emit("weeks"); },
      getWeek: async (wk) => data.weeks[wk] ? clone(data.weeks[wk]) : null,
      setWeek: async (wk, v) => { data.weeks[wk] = clone(v); emit("weeks"); },
      exportData: () => { data.backupAt = new Date().toISOString(); persist(); return { app: "dienstplan-zna", version: 2, exportedAt: data.backupAt, positions: data.positions, staff: data.staff, weeks: data.weeks, users: data.users, audit: data.audit }; },
      importData: (obj) => {
        if (!obj || obj.app !== "dienstplan-zna" || typeof obj.positions !== "object" || typeof obj.staff !== "object" || typeof obj.weeks !== "object") throw new Error("format");
        // Sicherungen ohne Zugänge (ältere Version) behalten die vorhandenen Zugänge
        const hasUsers = obj.users && typeof obj.users === "object" && Object.keys(obj.users).length;
        data = { positions: obj.positions || {}, staff: obj.staff || {}, weeks: obj.weeks || {}, users: hasUsers ? obj.users : data.users, audit: Array.isArray(obj.audit) ? obj.audit : data.audit, savedAt: null, backupAt: obj.exportedAt || null };
        fix(); persist(); emitAll();
      },
      subUsers: (cb) => { subs.users.push(cb); },
      users: () => Object.entries(data.users).map(([id, v]) => Object.assign({ id }, v)),
      getUser: (id) => data.users[id] ? Object.assign({ id }, data.users[id]) : null,
      saveUser: (u) => { const { id, ...r } = u; data.users[id] = r; emit("users"); },
      deleteUser: (id) => { delete data.users[id]; emit("users"); },
      log: (entry) => { data.audit.unshift(entry); if (data.audit.length > 500) data.audit.length = 500; persist(); },
      audit: () => data.audit.slice(),
      lastBackup: () => data.backupAt
    };
  }
  function errText(e) {
    const c = e && e.code;
    return "Speichern gerade nicht möglich. Bitte gleich noch einmal versuchen.";
  }
  let noticeTimer = null;
  function showNotice(msg, bad) {
    const n = $("notice"); n.textContent = msg; n.className = "notice" + (bad ? " bad" : ""); n.hidden = false; delete n.dataset.loading;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { n.hidden = true; }, bad ? 8000 : 5000);
  }

  // ---------- Abgeleitete Daten ----------
  const weekId = () => weekIdOf(state.monday);
  const staffById = () => Object.fromEntries(state.staff.map((s) => [s.id, s]));
  const sortedPositions = () => state.positions.slice().sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(b.name, "de"));
  const posById = () => Object.fromEntries(state.positions.map((p) => [p.id, p]));
  function slotIds(posId, sh, d) {
    const k = "s|" + posId + "|" + sh + "|" + d;
    const raw = k in state.pending ? state.pending[k] : (((state.slots[posId] || {})[sh] || {})[d] || []);
    return Array.isArray(raw) ? raw : [];
  }
  function absence(sid, d) { const k = "c|" + sid + "|" + d; return k in state.pending ? state.pending[k] : (((state.cells[sid] || {})[d]) || ""); }
  // Index: Person → Tag → Einsätze
  function buildIndex() {
    const by = staffById(), duties = {};
    state.staff.forEach((s) => { duties[s.id] = [[], [], [], [], [], [], []]; });
    state.positions.forEach((p) => DUTY.forEach((sh) => { for (let d = 0; d < 7; d++) slotIds(p.id, sh, d).forEach((sid) => { if (by[sid]) duties[sid][d].push({ sh, posId: p.id }); }); }));
    const code = (sid, d) => { if (d < 0 || d > 6 || !duties[sid]) return ""; const du = duties[sid][d]; return du.length ? du[0].sh : absence(sid, d); };
    const hours = (sid) => { let h = 0; for (let d = 0; d < 7; d++) { const du = duties[sid][d]; if (du.length) h += du.length * 8; else { const a = absence(sid, d); if (SHIFTS[a]) h += SHIFTS[a].h; } } return h; };
    return { duties, code, hours };
  }
  function issuesFor(sid, d, sh) {
    // Probleme, wenn Person sid am Tag d die Schicht sh hat
    const out = [];
    const ab = absence(sid, d);
    if (ABSENT.includes(ab)) out.push({ lvl: "bad", t: SHIFTS[ab].label });
    const others = IDX.duties[sid] ? IDX.duties[sid][d] : [];
    return { out, others, ab };
  }

  // ---------- Rendern ----------
  function renderHeader() {
    const { w } = isoWeek(state.monday);
    $("kwLabel").textContent = "KW " + w;
    $("kwRange").textContent = state.monday.toLocaleDateString("de-DE", { day: "numeric", month: "short" }) + " – " + addDays(state.monday, 6).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
  }
  function renderChrome() {
    $("tabAreas").setAttribute("aria-selected", view === "areas");
    $("tabPeople").setAttribute("aria-selected", view === "people");
    $("copyPrev").hidden = $("clearWeek").hidden = !state.canWrite;
    $("brushbar").hidden = !(state.canWrite && view === "people");
    $("help").textContent = !state.canWrite ? "Nur Ansicht. Du kannst diesen Plan lesen, aber nicht ändern."
      : view === "areas" ? "Jeder Bereich hat eine Zeile für Früh, Spät und Nacht. Über „+ Person“ trägst du für jeden Tag ein, wer dort arbeitet. Rot hinterlegt heißt: weniger Personen als Soll."
      : "Übersicht je Person, berechnet aus der Bereichsansicht. Hier trägst du Urlaub, Krankheit, Fortbildung oder Frei ein: Kürzel wählen, dann in die Tage tippen.";
    let h = '<span class="lbl">Eintragen:</span>';
    ABS_BRUSH.forEach((k) => { const s = SHIFTS[k]; h += '<button class="brush" data-brush="' + k + '" aria-pressed="' + (state.brush === k) + '"><span class="code c-' + k + '">' + (s.show || k) + '</span>' + s.label + '</button>'; });
    h += '<button class="brush" data-brush="erase" aria-pressed="' + (state.brush === "erase") + '"><span class="code c-erase">⌫</span>Löschen</button>';
    $("brushbar").innerHTML = h;
  }
  function headerCells(dates) {
    const today = new Date();
    return dates.map((d, i) => '<th scope="col" class="' + (sameDay(d, today) ? "today" : "") + '"><span class="dname">' + DAYS[i] + '</span><span class="ddate num">' + dShort(d) + '</span></th>').join("");
  }
  function renderSummary() {
    const pos = sortedPositions(), sum = $("summary");
    if (!pos.length || !state.staff.length) { sum.innerHTML = ""; return; }
    let under = 0, missing = 0, dbl = 0, rest = 0, conf = 0;
    pos.forEach((p) => DUTY.forEach((sh) => { const soll = +((p.soll || {})[sh] || 0); for (let d = 0; d < 7; d++) { const n = slotIds(p.id, sh, d).filter((id) => IDX.duties[id]).length; if (n < soll) { under++; missing += soll - n; } } }));
    state.staff.forEach((s) => { for (let d = 0; d < 7; d++) {
      const du = IDX.duties[s.id][d];
      if (du.length > 1) dbl++;
      if (du.length && ABSENT.includes(absence(s.id, d))) conf++;
      if (d > 0 && du.length && restBad(IDX.code(s.id, d - 1), du[0].sh)) rest++;
    } });
    const ms = myStaff(); let mine = "";
    if (ms && IDX.duties[ms.id]) {
      const pb = posById(), parts = [];
      for (let d = 0; d < 7; d++) IDX.duties[ms.id][d].forEach((x) => parts.push(DAYS[d] + " " + x.sh + " " + ((pb[x.posId] || {}).short || "")));
      mine = '<span class="pill mep">' + (parts.length ? "Deine Dienste: " + esc(parts.join(" · ")) : "Du hast diese Woche keine Dienste") + '</span>';
    }
    sum.innerHTML = mine + (under ? '<span class="pill badp">' + under + ' Schichten unterbesetzt · ' + missing + ' Personen fehlen</span>' : '<span class="pill okp">Mindestbesetzung überall erfüllt</span>') +
      (dbl ? '<span class="pill badp">' + dbl + '× doppelt eingeplant</span>' : '') +
      (conf ? '<span class="pill badp">' + conf + '× trotz Abwesenheit eingeplant</span>' : '') +
      (rest ? '<span class="pill warnp">' + rest + '× Ruhezeit unter 11 h</span>' : '');
  }
  function renderAreas() {
    const pos = sortedPositions(), by = staffById(), pb = posById();
    const dates = DAYS.map((_, i) => addDays(state.monday, i));
    let h = '<div class="scroll"><table class="areas"><thead><tr><th class="acol" scope="col"><span class="eyebrow">Bereich</span></th><th class="scol" scope="col"><span class="eyebrow">Schicht</span></th>' + headerCells(dates) + '</tr></thead><tbody>';
    pos.forEach((p) => {
      const so = p.soll || {};
      DUTY.forEach((sh, si) => {
        h += '<tr class="' + (si === 0 ? "first" : "") + '">';
        if (si === 0) h += '<th class="acol" rowspan="3" scope="rowgroup"><span class="aname">' + esc(p.name) + '</span><small>' + esc(p.short || "") + ' · Soll ' + (so.F || 0) + '/' + (so.S || 0) + '/' + (so.N || 0) + '</small></th>';
        h += '<th class="scol" scope="row"><span class="code c-' + sh + '">' + sh + '</span> ' + SHIFTS[sh].label + '<small>' + SHIFTS[sh].time + '</small></th>';
        const soll = +(so[sh] || 0);
        for (let d = 0; d < 7; d++) {
          const ids = slotIds(p.id, sh, d).filter((id) => by[id]);
          const low = ids.length < soll;
          h += '<td class="slot"><div class="slotbox' + (low ? " low" : "") + '"><span class="cnt" title="Ist / Soll">' + ids.length + '/' + soll + '</span>';
          ids.forEach((sid) => {
            const s = by[sid], du = IDX.duties[sid][d], ab = absence(sid, d);
            let lvl = "", flag = "", why = "";
            const other = du.filter((x) => !(x.posId === p.id && x.sh === sh));
            if (ABSENT.includes(ab)) { lvl = "bad"; flag = ab; why = SHIFTS[ab].label + " eingetragen"; }
            else if (other.length) { lvl = "bad"; flag = "2×"; why = "Auch " + other.map((o) => SHIFTS[o.sh].label + " " + ((pb[o.posId] || {}).short || "")).join(", "); }
            else if (restBad(IDX.code(sid, d - 1), sh) || restBad(sh, IDX.code(sid, d + 1))) { lvl = "warn"; flag = "11h"; why = "Ruhezeit unter 11 Stunden zum Vor- oder Folgetag"; }
            h += '<div class="pchip ' + lvl + (state.myStaffId && s.id === state.myStaffId ? " mine" : "") + '" title="' + esc(s.name) + (why ? " – " + esc(why) : "") + '"><span class="pn">' + qbadge(s) + esc(s.name) + '</span>' + (flag ? '<span class="flag">' + flag + '</span>' : '') +
              (state.canWrite ? '<button data-rm="' + esc(sid) + '" data-p="' + esc(p.id) + '" data-sh="' + sh + '" data-d="' + d + '" aria-label="' + esc(s.name) + ' entfernen">×</button>' : '') + '</div>';
          });
          if (state.canWrite) h += '<button class="addbtn" data-add data-p="' + esc(p.id) + '" data-sh="' + sh + '" data-d="' + d + '" aria-label="Person eintragen: ' + esc(p.name) + ', ' + SHIFTS[sh].label + ', ' + DAYS_LONG[d] + '">+ Person</button>';
          else if (!ids.length) h += '<span class="none">–</span>';
          h += '</div></td>';
        }
        h += '</tr>';
      });
    });
    return h + '</tbody></table></div>';
  }
  function renderPeople() {
    const pb = posById();
    const dates = DAYS.map((_, i) => addDays(state.monday, i));
    const groups = qualGroups();
    let h = '<div class="scroll"><table class="plan"><thead><tr><th class="who" scope="col"><span class="eyebrow">Mitarbeitende</span></th>' + headerCells(dates) + '<th scope="col"><span class="eyebrow">Std.</span></th></tr></thead><tbody>';
    groups.forEach((g) => {
      if (!g.staff.length) return;
      h += '<tr class="grp"><th class="who">' + esc(g.name) + '</th><th colspan="8"></th></tr>';
      g.staff.forEach((s) => {
        h += '<tr' + (state.myStaffId && s.id === state.myStaffId ? ' class="mine"' : '') + '><th class="who" scope="row"><span class="nm">' + qbadge(s) + esc(s.name) + '</span><small>' + (QUAL[s.qual] ? esc(QUAL[s.qual].label) + ' · ' : '') + fmtH(s.hours || 0) + ' h/Wo.</small></th>';
        for (let d = 0; d < 7; d++) {
          const du = IDX.duties[s.id][d], ab = absence(s.id, d);
          let cls, inner, lbl;
          if (du.length) {
            const f = du[0];
            cls = "c-" + f.sh + (du.length > 1 ? " dbl" : "") + (ABSENT.includes(ab) ? " conf" : "") + (restBad(IDX.code(s.id, d - 1), f.sh) ? " rest" : "");
            inner = (du.length > 1 ? du.map((x) => x.sh).join("+") : f.sh) + '<small>' + esc(du.map((x) => (pb[x.posId] || {}).short || "").join(" ")) + '</small>';
            lbl = du.map((x) => SHIFTS[x.sh].label + " " + ((pb[x.posId] || {}).name || "")).join(", ") + (ABSENT.includes(ab) ? ", aber " + SHIFTS[ab].label + " eingetragen" : "");
          } else if (ab) { cls = "c-" + ab; inner = SHIFTS[ab].show || ab; lbl = SHIFTS[ab].label; }
          else { cls = "c-none"; inner = "·"; lbl = "nicht eingeplant"; }
          lbl = s.name + ", " + DAYS_LONG[d] + ": " + lbl;
          h += '<td><button class="cell ' + cls + '" data-s="' + esc(s.id) + '" data-d="' + d + '" aria-label="' + esc(lbl) + '" title="' + esc(lbl) + '"' + (state.canWrite ? "" : " disabled") + '>' + inner + '</button></td>';
        }
        const hrs = IDX.hours(s.id), over = s.hours && hrs > s.hours + 0.01;
        h += '<td class="hrs num' + (over ? " over" : "") + '"><b>' + fmtH(hrs) + '</b> / ' + fmtH(s.hours || 0) + '</td></tr>';
      });
    });
    return h + '</tbody></table></div>';
  }
  function renderGrid() {
    IDX = buildIndex();
    const body = $("planBody");
    if (!state.loaded.pos || !state.loaded.st) return;
    renderSummary();
    if (!state.positions.length) { body.innerHTML = '<div class="empty"><h3>Noch keine Bereiche angelegt</h3><p>Lege unten unter „Bereiche“ zuerst deine Bereiche an. Danach bekommt jeder Bereich hier eine Zeile pro Schicht.</p></div>'; return; }
    if (!state.staff.length) { body.innerHTML = (view === "areas" ? renderAreas() : "") + '<div class="empty"><h3>Noch keine Mitarbeitenden</h3><p>Lege unten unter „Mitarbeitende“ dein Team an. Danach kannst du die Personen hier in die Bereiche eintragen.</p></div>'; return; }
    body.innerHTML = view === "areas" ? renderAreas() : renderPeople();
    if (state.picker) renderPicker();
  }
  function renderPositions() {
    const ro = state.canAdmin ? "" : " disabled", pos = sortedPositions();
    let h = '<div class="row pos hdr"><span>Bereich</span><span>Kürzel</span><span>F</span><span>S</span><span>N</span><span></span></div>';
    if (!pos.length) h += '<p class="hint" style="padding-top:12px">Noch keine Bereiche angelegt.</p>';
    pos.forEach((p) => {
      const so = p.soll || {}, armed = state.armed.has("p:" + p.id), id = esc(p.id);
      h += '<div class="row pos" data-pid="' + id + '">' +
        '<input id="pn-' + id + '" data-f="name" value="' + esc(p.name) + '" aria-label="Bereichsname"' + ro + '>' +
        '<input id="ps-' + id + '" data-f="short" maxlength="5" value="' + esc(p.short || "") + '" aria-label="Kürzel"' + ro + '>' +
        DUTY.map((k) => '<input id="p' + k + '-' + id + '" class="n" type="number" min="0" max="20" data-f="soll.' + k + '" value="' + (so[k] || 0) + '" aria-label="Soll ' + SHIFTS[k].label + '"' + ro + '>').join("") +
        (state.canAdmin ? '<button class="btn danger' + (armed ? " armed" : "") + '" data-delpos="' + id + '">' + (armed ? "Sicher?" : "Entfernen") + '</button>' : '<span></span>') + '</div>';
    });
    $("posList").innerHTML = h;
    $("posForm").hidden = !state.canAdmin;
  }
  function renderStaff() {
    const ro = state.canAdmin ? "" : " disabled", pos = sortedPositions();
    let h = '<div class="row st hdr"><span>Name</span><span>Qualifikation</span><span>Std./Wo.</span><span></span></div>';
    if (!state.staff.length) h += '<p class="hint" style="padding-top:12px">Noch keine Mitarbeitenden angelegt.</p>';
    state.staff.slice().sort((a, b) => String(a.name).localeCompare(b.name, "de")).forEach((s) => {
      const armed = state.armed.has("s:" + s.id), id = esc(s.id);
      h += '<div class="row st" data-sid="' + id + '">' +
        '<input id="sn-' + id + '" data-f="name" value="' + esc(s.name) + '" aria-label="Name"' + ro + '>' +
        '<select id="sq-' + id + '" data-f="qual" aria-label="Qualifikation"' + ro + '>' + qualOptions(s.qual || "") + '</select>' +
        '<input id="sh-' + id + '" class="n" type="number" min="0" max="60" step="0.5" data-f="hours" value="' + (s.hours || 0) + '" aria-label="Wochenstunden"' + ro + '>' +
        (state.canAdmin ? '<button class="btn danger' + (armed ? " armed" : "") + '" data-delst="' + id + '">' + (armed ? "Sicher?" : "Entfernen") + '</button>' : '<span></span>') + '</div>';
    });
    $("stList").innerHTML = h;
    $("stForm").hidden = !state.canAdmin;
    const qsel = $("stQual"), qcur = qsel.value; qsel.innerHTML = qualOptions(qcur);
    const counts = {}; state.staff.forEach((s) => { if (QUAL[s.qual]) counts[s.qual] = (counts[s.qual] || 0) + 1; });
    $("qLegend").innerHTML = QUALS.map((q) => '<span><span class="qb ' + q.tier + '">' + q.k + '</span>' + q.label + (counts[q.k] ? ' · ' + counts[q.k] : '') + '</span>').join("");
    $("stCount").textContent = state.staff.length ? state.staff.length + " im Team" : "";
  }
  function renderAll() { renderHeader(); renderChrome(); renderGrid(); renderPositions(); renderStaff(); }

  // ---------- Auswahl-Popover ----------
  function openPicker(anchor, posId, sh, d) {
    state.picker = { posId, sh, d, anchor: { posId, sh, d } };
    $("pickQ").value = "";
    const pk = $("picker"); pk.hidden = false;
    renderPicker(); placePicker(anchor);
    $("pickQ").focus({ preventScroll: true });
  }
  function placePicker(anchor) {
    const pk = $("picker"), r = anchor.getBoundingClientRect(), w = 320, vh = window.innerHeight, vw = window.innerWidth;
    let left = Math.min(Math.max(8, r.left), vw - w - 8), top = r.bottom + 6;
    const ph = Math.min(pk.offsetHeight || 400, vh * 0.7);
    if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 6);
    pk.style.left = left + "px"; pk.style.top = top + "px";
  }
  function closePicker() { state.picker = null; $("picker").hidden = true; }
  function renderPicker() {
    const pk = state.picker; if (!pk) return;
    const p = posById()[pk.posId]; if (!p) return closePicker();
    const date = addDays(state.monday, pk.d);
    $("pickCode").className = "code c-" + pk.sh; $("pickCode").textContent = pk.sh;
    $("pickT").textContent = p.name + " · " + SHIFTS[pk.sh].label;
    $("pickSub").textContent = DAYS_LONG[pk.d] + ", " + date.toLocaleDateString("de-DE") + " · " + SHIFTS[pk.sh].time;
    const q = $("pickQ").value.trim().toLowerCase(), pb = posById();
    const inSlot = new Set(slotIds(pk.posId, pk.sh, pk.d));
    const rows = state.staff.filter((s) => !inSlot.has(s.id) && (!q || String(s.name).toLowerCase().includes(q))).map((s) => {
      const tags = []; let score = 0;
      const ab = absence(s.id, pk.d), du = IDX.duties[s.id][pk.d];
      if (ABSENT.includes(ab)) { tags.push(["bad", SHIFTS[ab].label]); score += 4; }
      if (du.length) { tags.push(["bad", "schon " + du.map((x) => x.sh + " " + ((pb[x.posId] || {}).short || "")).join(", ")]); score += 3; }
      if (restBad(IDX.code(s.id, pk.d - 1), pk.sh)) { tags.push(["warn", "Ruhezeit nach " + SHIFTS[IDX.code(s.id, pk.d - 1)].label]); score += 1; }
      if (restBad(pk.sh, IDX.code(s.id, pk.d + 1))) { tags.push(["warn", "Ruhezeit vor " + SHIFTS[IDX.code(s.id, pk.d + 1)].label]); score += 1; }
      if (ab === "X") { tags.push(["warn", "Frei eingetragen"]); score += 1; }
      const hrs = IDX.hours(s.id);
      if (s.hours && hrs + 8 > s.hours + 0.01) { tags.push(["warn", "über Soll-Stunden"]); }
      return { s, tags, score, hrs };
    }).sort((a, b) => (a.score > 0) - (b.score > 0) || a.score - b.score || String(a.s.name).localeCompare(b.s.name, "de"));
    let h = "", sep = null;
    rows.forEach((r) => {
      const grp = r.score > 0 ? "Mit Hinweis" : "Verfügbar";
      if (grp !== sep) { h += '<div class="sep">' + grp + '</div>'; sep = grp; }
      h += '<button class="opt" data-pick="' + esc(r.s.id) + '"><span class="on">' + qbadge(r.s) + esc(r.s.name) + '</span><span class="oh num">' + fmtH(r.hrs) + '/' + fmtH(r.s.hours || 0) + ' h</span>' +
        (r.tags.length ? '<span class="tags">' + r.tags.map(([c, t]) => '<span class="tag ' + c + '">' + esc(t) + '</span>').join("") + '</span>' : '') + '</button>';
    });
    $("pickList").innerHTML = h || '<p class="pe">' + (state.staff.length ? "Keine passende Person gefunden." : "Lege zuerst Mitarbeitende an.") + '</p>';
  }

  // ---------- Schreiben ----------
  function queue(key, value, patch) {
    const wk = weekId();
    state.pending[key] = value;
    renderGrid();
    writeChain = writeChain.then(async () => {
      try { await adapter.patchWeek(wk, Object.assign({}, patch, { meta: { by: ME ? ME.name : "", at: new Date().toISOString() } })); if (wk === weekId()) state.weekExists = true; }
      catch (e) { showNotice(errText(e), true); }
      finally { if (state.pending[key] === value) delete state.pending[key]; renderGrid(); }
    });
  }
  function setSlot(posId, sh, d, ids) {
    const p = posById()[posId] || {}, by = staffById();
    logAudit("week_changed", weekId() + " · " + (p.name || "") + " · " + SHIFTS[sh].label + " · " + DAYS[d] + ": " + (ids.map((x) => (by[x] || {}).name).filter(Boolean).join(", ") || "niemand"));
    queue("s|" + posId + "|" + sh + "|" + d, ids, { slots: { [posId]: { [sh]: { [String(d)]: ids } } } }); }
  function setAbsence(sid, d, code) {
    if (absence(sid, d) === code) return;
    logAudit("week_changed", weekId() + " · " + ((staffById()[sid] || {}).name || "") + " · " + DAYS[d] + ": " + (SHIFTS[code] ? SHIFTS[code].label : "Eintrag gelöscht"));
    queue("c|" + sid + "|" + d, code, { cells: { [sid]: { [String(d)]: code } } }); }
  function arm(key, btn, run) {
    if (state.armed.has(key)) { state.armed.delete(key); run(); return; }
    state.armed.add(key); btn.classList.add("armed");
    const orig = btn.dataset.orig || btn.textContent; btn.dataset.orig = orig; btn.textContent = key.startsWith("w:") ? "Wirklich? Erneut klicken" : "Sicher?";
    setTimeout(() => { if (state.armed.delete(key)) { btn.classList.remove("armed"); btn.textContent = orig; } }, 4000);
  }
  const savePos = (p) => {
    logAudit(state.positions.some((x) => x.id === p.id) ? "position_updated" : "position_created", p.name + " (" + p.short + ") Soll " + ((p.soll || {}).F || 0) + "/" + ((p.soll || {}).S || 0) + "/" + ((p.soll || {}).N || 0));
    return adapter.savePosition(p).catch((e) => showNotice(errText(e), true));
  };
  const saveSt = (s) => {
    logAudit(state.staff.some((x) => x.id === s.id) ? "staff_updated" : "staff_created", s.name + (s.qual ? " (" + s.qual + ")" : "") + ", " + fmtH(s.hours || 0) + " h");
    return adapter.saveStaff(s).catch((e) => showNotice(errText(e), true));
  };
  const weekStamp = () => ({ meta: { by: ME ? ME.name : "", at: new Date().toISOString() } });

  // ---------- Ereignisse ----------
  $("viewTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    view = b.dataset.view; try { localStorage.setItem("zna-view", view); } catch (err) {}
    closePicker(); renderChrome(); renderGrid();
  });
  $("brushbar").addEventListener("click", (e) => { const b = e.target.closest("[data-brush]"); if (!b) return; state.brush = b.dataset.brush; renderChrome(); });
  $("planBody").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) { e.stopPropagation(); openPicker(add, add.dataset.p, add.dataset.sh, +add.dataset.d); return; }
    const rm = e.target.closest("[data-rm]");
    if (rm) { const { p, sh, d } = rm.dataset; setSlot(p, sh, +d, slotIds(p, sh, +d).filter((x) => x !== rm.dataset.rm)); }
  });
  // Abwesenheiten malen (Personenansicht)
  let painting = false, paintCode = null;
  const brushValue = (sid, d) => state.brush === "erase" ? "" : (absence(sid, d) === state.brush ? "" : state.brush);
  $("planBody").addEventListener("pointerdown", (e) => {
    const c = e.target.closest(".cell"); if (!c || c.disabled) return;
    paintCode = brushValue(c.dataset.s, +c.dataset.d); setAbsence(c.dataset.s, +c.dataset.d, paintCode);
    painting = e.pointerType === "mouse"; e.preventDefault();
  });
  $("planBody").addEventListener("pointerover", (e) => { if (!painting) return; const c = e.target.closest(".cell"); if (c && !c.disabled) setAbsence(c.dataset.s, +c.dataset.d, paintCode); });
  window.addEventListener("pointerup", () => { painting = false; });
  $("planBody").addEventListener("keydown", (e) => {
    const c = e.target.closest(".cell"); if (!c || c.disabled || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); setAbsence(c.dataset.s, +c.dataset.d, brushValue(c.dataset.s, +c.dataset.d));
  });
  $("pickList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]"); if (!b || !state.picker) return;
    const { posId, sh, d } = state.picker;
    setSlot(posId, sh, d, slotIds(posId, sh, d).filter((x) => x !== b.dataset.pick).concat(b.dataset.pick));
    $("pickQ").focus({ preventScroll: true });
  });
  $("pickQ").addEventListener("input", renderPicker);
  $("pickQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const f = $("pickList").querySelector("[data-pick]"); if (f) f.click(); } });
  $("pickClose").onclick = closePicker;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.picker) closePicker(); });
  document.addEventListener("pointerdown", (e) => { if (state.picker && !e.target.closest("#picker") && !e.target.closest("[data-add]")) closePicker(); });
  window.addEventListener("resize", () => { if (state.picker) closePicker(); });
  document.querySelector("#planBody").addEventListener("scroll", () => { if (state.picker) closePicker(); }, true);

  $("prevW").onclick = () => goWeek(addDays(state.monday, -7));
  $("nextW").onclick = () => goWeek(addDays(state.monday, 7));
  $("todayW").onclick = () => goWeek(mondayOf(new Date()));
  $("copyPrev").addEventListener("click", (e) => arm("w:copy", e.currentTarget, async () => {
    const btn = $("copyPrev"); btn.textContent = "Vorwoche übernehmen"; btn.classList.remove("armed");
    try {
      const prev = await adapter.getWeek(weekIdOf(addDays(state.monday, -7)));
      if (!prev || (!Object.keys(prev.slots || {}).length && !Object.keys(prev.cells || {}).length)) { showNotice("Die Vorwoche ist leer. Es gibt nichts zu übernehmen."); return; }
      await writeChain; await adapter.setWeek(weekId(), Object.assign({ slots: prev.slots || {}, cells: prev.cells || {} }, weekStamp())); state.weekExists = true; logAudit("week_copied", weekIdOf(addDays(state.monday, -7)) + " → " + weekId());
      showNotice("Einteilung aus der Vorwoche übernommen.");
    } catch (err) { showNotice(errText(err), true); }
  }));
  $("clearWeek").addEventListener("click", (e) => arm("w:clear", e.currentTarget, async () => {
    const btn = $("clearWeek"); btn.textContent = "Woche leeren"; btn.classList.remove("armed");
    try { await writeChain; await adapter.setWeek(weekId(), Object.assign({ slots: {}, cells: {} }, weekStamp())); state.weekExists = true; logAudit("week_cleared", weekId()); showNotice("Woche geleert."); }
    catch (err) { showNotice(errText(err), true); }
  }));

  $("posForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("posName").value.trim(), short = $("posShort").value.trim().toUpperCase();
    if (!name || !short) return;
    const maxOrder = state.positions.reduce((m, p) => Math.max(m, p.order || 0), -1);
    savePos({ id: newId("p"), name, short, order: maxOrder + 1, soll: { F: +$("posF").value || 0, S: +$("posS").value || 0, N: +$("posN").value || 0 } });
    $("posName").value = ""; $("posShort").value = ""; $("posName").focus();
  });
  $("posList").addEventListener("change", (e) => {
    const row = e.target.closest("[data-pid]"); if (!row) return;
    const p = state.positions.find((x) => x.id === row.dataset.pid); if (!p) return;
    const next = clone(p), f = e.target.dataset.f;
    if (f.startsWith("soll.")) { next.soll = next.soll || {}; next.soll[f.slice(5)] = Math.max(0, +e.target.value || 0); }
    else next[f] = f === "short" ? e.target.value.trim().toUpperCase() : e.target.value.trim();
    if (!next.name) return renderPositions();
    savePos(next);
  });
  $("posList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-delpos]"); if (!b) return;
    const id = b.dataset.delpos;
    arm("p:" + id, b, () => { logAudit("position_deleted", (posById()[id] || {}).name || id); adapter.deletePosition(id).catch((err) => showNotice(errText(err), true)); });
  });
  $("stForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("stName").value.trim(); if (!name) return;
    saveSt({ id: newId("m"), name, qual: $("stQual").value, hours: +$("stHours").value || 0 });
    $("stName").value = ""; $("stName").focus();
  });
  $("stList").addEventListener("change", (e) => {
    const row = e.target.closest("[data-sid]"); if (!row) return;
    const s = state.staff.find((x) => x.id === row.dataset.sid); if (!s) return;
    const next = Object.assign({}, s), f = e.target.dataset.f;
    next[f] = f === "hours" ? Math.max(0, +e.target.value || 0) : e.target.value.trim();
    if (!next.name) return renderStaff();
    saveSt(next);
  });
  $("stList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-delst]"); if (!b) return;
    arm("s:" + b.dataset.delst, b, () => {
      const id = b.dataset.delst; logAudit("staff_deleted", (staffById()[id] || {}).name || id);
      adapter.users().filter((u) => u.staffId === id).forEach((u) => adapter.saveUser(Object.assign({}, u, { staffId: "" })));
      adapter.deleteStaff(id).catch((err) => showNotice(errText(err), true));
    });
  });

  // ---------- PDF-Export ----------
  const JSPDF_URL = "vendor/jspdf.umd.min.js";
  const AUTOTABLE_URL = "vendor/jspdf.plugin.autotable.min.js";
  function loadScript(src) { return new Promise((res, rej) => { const el = document.createElement("script"); el.src = src; el.onload = res; el.onerror = () => rej(new Error("load")); document.head.appendChild(el); }); }
  async function pdfLib() {
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript(JSPDF_URL);
    if (!window.jspdf.jsPDF.API.autoTable) await loadScript(AUTOTABLE_URL);
    return window.jspdf.jsPDF;
  }
  const PDF_RGB = { F: [[253, 231, 162], [83, 59, 0]], S: [[251, 199, 164], [103, 40, 6]], N: [[54, 58, 140], [255, 255, 255]], U: [[211, 235, 215], [29, 77, 45]], K: [[245, 207, 207], [118, 26, 26]], FB: [[221, 226, 247], [43, 52, 116]], X: [[240, 243, 246], [90, 104, 118]] };
  const LOW = [251, 228, 225], LOW_TXT = [180, 35, 24], HEAD = [15, 95, 116], ZEBRA = [246, 248, 250];
  async function buildPdf() {
    const JsPDF = await pdfLib();
    IDX = buildIndex();
    const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const { y, w } = isoWeek(state.monday);
    const dates = DAYS.map((_, i) => addDays(state.monday, i));
    const range = dates[0].toLocaleDateString("de-DE") + " – " + dates[6].toLocaleDateString("de-DE");
    const stamp = "Stand: " + new Date().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + " Uhr";
    const by = staffById(), pb = posById(), pos = sortedPositions();
    const dayHead = dates.map((d, i) => DAYS[i] + " " + dShort(d));
    let sub = "";
    const pageDeco = () => {
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(22, 32, 42);
      doc.text("Dienstplan Notaufnahme · KW " + w + "/" + y, 12, 13);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90, 104, 118);
      doc.text(range + "   ·   " + sub, 12, 18.5);
      doc.text(stamp, W - 12, 13, { align: "right" });
      doc.setFontSize(7.5);
      doc.text("Früh 06:00–14:30 · Spät 14:00–22:30 · Nacht 22:00–06:30 · U Urlaub · K Krank · FB Fortbildung · – Frei", 12, H - 6);
      doc.text("Qualifikation: " + QUALS.map((q) => q.k + " " + q.label).join(" · "), 12, H - 9.5);
      doc.text("Seite " + doc.internal.getNumberOfPages(), W - 12, H - 6, { align: "right" });
    };
    const common = { theme: "grid", margin: { top: 23, left: 12, right: 12, bottom: 15 },
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.4, lineColor: [213, 221, 229], lineWidth: 0.2, textColor: [22, 32, 42], valign: "top", overflow: "linebreak" },
      headStyles: { fillColor: HEAD, textColor: [255, 255, 255], fontStyle: "bold", halign: "center" },
      didDrawPage: pageDeco };

    // Seite 1: nach Bereich
    sub = "Einteilung nach Bereich (Namen je Schicht, rot = unter Soll)";
    const body = [];
    pos.forEach((p) => DUTY.forEach((sh, si) => {
      const soll = +((p.soll || {})[sh] || 0), row = [];
      if (si === 0) row.push({ content: p.name + "\n" + (p.short || "") + " · Soll " + ((p.soll || {}).F || 0) + "/" + ((p.soll || {}).S || 0) + "/" + ((p.soll || {}).N || 0), rowSpan: 3, styles: { fontStyle: "bold", fillColor: [255, 255, 255] } });
      row.push({ content: SHIFTS[sh].label + "\n" + SHIFTS[sh].time, styles: { fillColor: PDF_RGB[sh][0], textColor: PDF_RGB[sh][1], fontStyle: "bold" } });
      for (let d = 0; d < 7; d++) {
        const ids = slotIds(p.id, sh, d).filter((id) => by[id]);
        const low = ids.length < soll;
        let txt = ids.map((id) => (by[id].qual ? by[id].qual + "  " : "") + by[id].name).join("\n");
        if (low) txt += (txt ? "\n" : "") + "fehlt: " + (soll - ids.length) + " (" + ids.length + "/" + soll + ")";
        row.push({ content: txt, styles: low ? { fillColor: LOW, textColor: ids.length ? [22, 32, 42] : LOW_TXT } : {} });
      }
      body.push(row);
    }));
    doc.autoTable(Object.assign({}, common, {
      head: [["Bereich", "Schicht"].concat(dayHead)], body,
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 23 } },
      rowPageBreak: "avoid"
    }));

    // Seite 2: nach Person
    doc.addPage(); sub = "Übersicht nach Person";
    const groups = qualGroups();
    const body2 = [];
    groups.forEach((g) => g.staff.forEach((s) => {
      const row = [{ content: s.name, styles: { fontStyle: "bold" } }, s.qual || ""];
      for (let d = 0; d < 7; d++) {
        const du = IDX.duties[s.id][d], ab = absence(s.id, d);
        if (du.length) {
          const c = du[0].sh;
          row.push({ content: du.map((x) => x.sh + " " + ((pb[x.posId] || {}).short || "")).join("\n") + (ABSENT.includes(ab) ? "\n(" + SHIFTS[ab].label + "!)" : ""), styles: { fillColor: PDF_RGB[c][0], textColor: PDF_RGB[c][1], fontStyle: "bold", halign: "center" } });
        } else if (ab) row.push({ content: ab === "X" ? "–" : ab, styles: { fillColor: PDF_RGB[ab][0], textColor: PDF_RGB[ab][1], halign: "center" } });
        else row.push({ content: "", styles: { halign: "center" } });
      }
      row.push({ content: fmtH(IDX.hours(s.id)) + " / " + fmtH(s.hours || 0), styles: { halign: "right" } });
      body2.push(row);
    }));
    doc.autoTable(Object.assign({}, common, {
      head: [["Name", "Quali."].concat(dayHead, ["Std."])], body: body2,
      styles: Object.assign({}, common.styles, { fontSize: 8, valign: "middle", minCellHeight: 7 }),
      columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 14 }, 9: { cellWidth: 22 } }
    }));
    return { bytes: doc.output("arraybuffer"), name: "Dienstplan_ZNA_KW" + String(w).padStart(2, "0") + "_" + y + ".pdf" };
  }
  $("exportPdf").addEventListener("click", async () => {
    const btn = $("exportPdf"); if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "PDF wird erstellt …";
    try {
      const { bytes, name } = await buildPdf();
      saveFile(new Blob([bytes], { type: "application/pdf" }), name);
    } catch (e) { showNotice("Das PDF konnte nicht erstellt werden. Bitte lade die Seite neu und versuche es erneut.", true); } finally { btn.disabled = false; btn.textContent = "PDF exportieren"; }
  });

  // ---------- Übersicht ----------
  let route = "week";
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  function mondayOfWeekId(id) {
    const m = /^(\d{4})-W(\d{2})$/.exec(id); if (!m) return null;
    return addDays(mondayOf(new Date(+m[1], 0, 4)), (+m[2] - 1) * 7);
  }
  function weekStats(data) {
    const by = staffById();
    let soll = 0, filled = 0, missing = 0, assigned = 0;
    state.positions.forEach((p) => DUTY.forEach((sh) => {
      const so = +((p.soll || {})[sh] || 0);
      for (let d = 0; d < 7; d++) {
        const raw = (((data && data.slots || {})[p.id] || {})[sh] || {})[d];
        const n = (Array.isArray(raw) ? raw : []).filter((id) => by[id]).length;
        soll += so; filled += Math.min(n, so); missing += Math.max(0, so - n); assigned += n;
      }
    }));
    const status = !assigned ? "leer" : missing ? "teil" : "voll";
    return { soll, filled, missing, assigned, status, pct: soll ? filled / soll : (assigned ? 1 : 0) };
  }
  function renderOverview() {
    if (route !== "overview") return;
    const Y = state.ovYear, today = mondayOf(new Date()), curId = weekIdOf(today);
    $("yLabel").textContent = Y;
    const weeks = [];
    for (let m = mondayOf(new Date(Y, 0, 4)); isoWeek(m).y === Y; m = addDays(m, 7)) weeks.push(m);
    const byMonth = new Map();
    let planned = 0, full = 0, partial = 0, nextOpen = null;
    weeks.forEach((m) => {
      const id = weekIdOf(m), st = weekStats(state.allWeeks[id]);
      if (st.status !== "leer") planned++;
      if (st.status === "voll") full++;
      if (st.status === "teil") partial++;
      if (!nextOpen && m >= today && st.status !== "voll") nextOpen = { id, m };
      const key = addDays(m, 3).getMonth();
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push({ m, id, st });
    });
    $("ovSub").textContent = weeks.length + " Kalenderwochen";
    $("ovSummary").innerHTML = state.positions.length
      ? '<span class="pill okp">' + full + ' vollständig besetzt</span>' + (partial ? '<span class="pill warnp">' + partial + ' unvollständig</span>' : '') +
        '<span class="pill" style="background:var(--surface-2);color:var(--muted)">' + (weeks.length - planned) + ' noch leer</span>' +
        (nextOpen ? '<button class="btn" data-week="' + nextOpen.id + '" style="padding:2px 10px;font-size:12px">Nächste offene Woche: KW ' + isoWeek(nextOpen.m).w + ' →</button>' : '')
      : '<span class="pill badp">Lege im Wochenplan zuerst Bereiche mit Mindestbesetzung an.</span>';
    let h = "";
    byMonth.forEach((list, mi) => {
      h += '<div class="month"><h3>' + MONTHS[mi] + '</h3><div class="wkgrid">';
      list.forEach(({ m, id, st }) => {
        const past = addDays(m, 6) < today, cur = id === curId, pct = Math.round(st.pct * 100);
        const txt = st.status === "leer" ? "Noch leer" : st.status === "voll" ? "Vollständig · " + st.assigned + " Einsätze" : pct + " % besetzt · " + st.missing + " fehlen";
        h += '<button class="wk ' + st.status + (cur ? " cur" : "") + (past ? " past" : "") + '" data-week="' + id + '" aria-label="KW ' + isoWeek(m).w + ', ' + dShort(m) + ' bis ' + dShort(addDays(m, 6)) + ': ' + txt + '">' +
          '<span class="wkn"><b>KW ' + isoWeek(m).w + '</b>' + (cur ? '<span class="badge">Diese Woche</span>' : '') + '</span>' +
          '<span class="wkd num">' + dShort(m) + ' – ' + dShort(addDays(m, 6)) + '</span>' +
          '<span class="bar"><i style="width:' + pct + '%"></i></span><span class="wks">' + txt + '</span></button>';
      });
      h += '</div></div>';
    });
    $("ovBody").innerHTML = h;
  }
  function applyRoute() {
    if (!ME) return;
    const wk = route === "week";
    $("overview").hidden = route !== "overview"; $("usersView").hidden = route !== "users";
    $("planPanel").hidden = !wk; $("masterData").hidden = !wk; $("dataPanel").hidden = !wk || !state.canAdmin; $("weekNav").hidden = !wk;
    $("navOverview").setAttribute("aria-selected", route === "overview"); $("navWeek").setAttribute("aria-selected", wk); $("navUsers").setAttribute("aria-selected", route === "users");
    if (!wk) closePicker();
    if (route === "overview") renderOverview();
    if (route === "users") renderUsers();
  }
  function setHash(name) { if (location.hash.slice(1) !== name) { try { location.hash = name; } catch (e) {} } }
  function openWeek(mon) { route = "week"; applyRoute(); if (weekIdOf(mon) !== weekId() || !unsubWeek) goWeek(mon); else setHash("kw-" + weekId()); }
  function readHash() {
    const h = location.hash.slice(1);
    if (h === "uebersicht") return { route: "overview" };
    if (h === "benutzer") return { route: "users" };
    const m = /^kw-(\d{4}-W\d{2})$/.exec(h);
    if (m) { const mon = mondayOfWeekId(m[1]); if (mon) return { route: "week", monday: mon }; }
    return null;
  }
  window.addEventListener("hashchange", () => {
    const r = readHash(); if (!r || !adapter || !ME) return;
    if (r.route === "overview" || r.route === "users") { if (route !== r.route) { route = r.route; applyRoute(); } }
    else if (route !== "week" || weekIdOf(r.monday) !== weekId()) openWeek(r.monday);
  });
  $("mainNav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-route]"); if (!b) return;
    if (b.dataset.route === "overview") {
      route = "overview"; state.ovYear = isoWeek(state.monday).y; applyRoute(); setHash("uebersicht");
      const t = document.querySelector('.wk[data-week="' + weekId() + '"]') || document.querySelector(".wk.cur");
      if (t) t.scrollIntoView({ block: "center" });
    }
    else if (b.dataset.route === "users") { route = "users"; applyRoute(); setHash("benutzer"); }
    else openWeek(state.monday);
  });
  $("overview").addEventListener("click", (e) => {
    const w = e.target.closest("[data-week]");
    if (w) { openWeek(mondayOfWeekId(w.dataset.week)); window.scrollTo(0, 0); return; }
    if (e.target.closest("#yPrev")) { state.ovYear--; renderOverview(); }
    if (e.target.closest("#yNext")) { state.ovYear++; renderOverview(); }
  });

  // ---------- Woche laden ----------
  function goWeek(mon) {
    closePicker();
    state.monday = mon; state.slots = {}; state.cells = {}; state.pending = {}; state.weekExists = false;
    renderHeader(); renderGrid();
    if (route === "week") setHash("kw-" + weekId());
    if (unsubWeek) unsubWeek();
    const id = weekId();
    unsubWeek = adapter.subWeek(id, (data, meta) => {
      if (id !== weekId()) return;
      state.slots = (data && data.slots) || {}; state.cells = (data && data.cells) || {}; state.weekExists = !!data;
      state.weekMeta = (data && data.meta) || null; renderLastEdit();
      if (!meta.fromCache) clearLoadTimer();
      renderGrid();
    });
  }
  let loadTimer = null;
  function clearLoadTimer() { if (!loadTimer) return; clearTimeout(loadTimer); loadTimer = null; const n = $("notice"); if (n.dataset.loading) { n.hidden = true; delete n.dataset.loading; } }

  // ---------- Datensicherung ----------
  function saveFile(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }
  function renderBackupStamp() {
    const t = adapter && adapter.lastBackup();
    $("backupStamp").textContent = t ? "Letzte Sicherung: " + new Date(t).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) + " Uhr" : "Noch keine Sicherung heruntergeladen.";
  }
  $("backupBtn").addEventListener("click", () => {
    if (!state.canAdmin) return;
    logAudit("backup", "Sicherung heruntergeladen");
    const d = adapter.exportData();
    saveFile(new Blob([JSON.stringify(d, null, 1)], { type: "application/json" }), "Dienstplan_ZNA_Sicherung_" + d.exportedAt.slice(0, 10) + ".json");
    renderBackupStamp();
  });
  $("restoreBtn").addEventListener("click", (e) => arm("w:restore", e.currentTarget, () => {
    const btn = $("restoreBtn"); btn.textContent = "Sicherung laden …"; btn.classList.remove("armed");
    $("restoreFile").click();
  }));
  $("restoreFile").addEventListener("change", async () => {
    const f = $("restoreFile").files[0]; $("restoreFile").value = ""; if (!f) return;
    try {
      if (!state.canAdmin) return;
      const who = ME.name;
      adapter.importData(JSON.parse(await f.text()));
      logAudit("restore", "Sicherung geladen von " + who + ": " + f.name);
      const still = refreshMe(); if (!still) return;
      closePicker(); goWeek(state.monday); renderBackupStamp();
      showNotice("Sicherung vom " + new Date(adapter.lastBackup() || Date.now()).toLocaleDateString("de-DE") + " geladen.");
    } catch (err) { showNotice("Diese Datei ist keine gültige Dienstplan-Sicherung. Wähle eine Datei, die mit „Sicherung herunterladen“ erstellt wurde.", true); }
  });

  // ---------- Benutzer & Rechte ----------
  function renderLastEdit() {
    const el = $("lastEdit"), m = state.weekMeta;
    el.textContent = m && m.at ? "Zuletzt geändert" + (m.by ? " von " + m.by : "") + " · " + new Date(m.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + " Uhr" : "";
  }
  const ACTIONS = {
    setup: "Einrichtung", login: "Anmeldung", login_failed: "Anmeldung fehlgeschlagen", logout: "Abmeldung", timeout: "Automatisch abgemeldet",
    pin_changed: "PIN geändert", pin_reset: "PIN zurückgesetzt", user_created: "Zugang angelegt", user_updated: "Zugang geändert", user_deleted: "Zugang gelöscht",
    position_created: "Bereich angelegt", position_updated: "Bereich geändert", position_deleted: "Bereich gelöscht",
    staff_created: "Mitarbeitende/r angelegt", staff_updated: "Mitarbeitende/r geändert", staff_deleted: "Mitarbeitende/r entfernt",
    week_changed: "Plan geändert", week_copied: "Vorwoche übernommen", week_cleared: "Woche geleert", backup: "Sicherung", restore: "Sicherung geladen"
  };
  const activeAdmins = (exceptId) => adapter.users().filter((u) => u.role === "admin" && u.active !== false && u.id !== exceptId).length;
  function formMsg(el, text, ok) { el.textContent = text; el.className = "msg" + (ok ? " ok" : ""); el.hidden = !text; }
  function renderUsers() {
    if (route !== "users" || !ME) return;
    const role = ME.role, ms = myStaff();
    $("rMe").innerHTML = '<span class="av" style="width:48px;height:48px;font-size:17px">' + esc(initials(ME.name)) + '</span>' +
      '<div class="who"><b>' + esc(ME.name) + '</b><span>Rolle: <span class="role r-' + ROLE_CLS[role] + '">' + ROLE_LABEL[role] + '</span>' + (ms ? ' · verknüpft mit „' + esc(ms.name) + '“' : '') + '</span></div>';
    const rows = [
      ["Übersicht und Wochenplan ansehen, PDF exportieren", 1, 1, 1],
      ["Personen in Bereiche einteilen und entfernen", 1, 1, 0],
      ["Urlaub, Krank, Fortbildung, Frei eintragen", 1, 1, 0],
      ["Vorwoche übernehmen, Woche leeren", 1, 1, 0],
      ["Bereiche und Mindestbesetzung pflegen", 1, 0, 0],
      ["Mitarbeitende anlegen, ändern, entfernen", 1, 0, 0],
      ["Zugänge und Rollen verwalten, Protokoll ansehen", 1, 0, 0],
      ["Sicherung herunterladen und laden", 1, 0, 0],
      ["Eigene PIN ändern", 1, 1, 1]
    ];
    const cols = ["admin", "planner", "reader"];
    $("rMatrix").innerHTML = '<thead><tr><th>Funktion</th>' + cols.map((c) => '<th class="' + (c === role ? "mine" : "") + '">' + ROLE_LABEL[c] + (c === role ? '<small>deine Rolle</small>' : '') + '</th>').join("") + '</tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + r[0] + '</td>' + [1, 2, 3].map((i) => '<td class="' + (r[i] ? "y" : "n") + (cols[i - 1] === role ? " mine" : "") + '">' + (r[i] ? "✓" : "–") + '</td>').join("") + '</tr>').join("") + '</tbody>';
    $("adminArea").hidden = !state.canAdmin;
    if (!state.canAdmin) return;
    const staffSorted = state.staff.slice().sort((a, b) => String(a.name).localeCompare(b.name, "de"));
    const staffOpts = (cur) => '<option value="">Keine Verknüpfung</option>' + staffSorted.map((s) => '<option value="' + esc(s.id) + '"' + (s.id === cur ? " selected" : "") + '>' + esc(s.name) + '</option>').join("");
    $("nuStaff").innerHTML = staffOpts("");
    const users = adapter.users().sort((a, b) => String(a.name).localeCompare(b.name, "de"));
    let h = '<thead><tr><th>Name</th><th>Rolle</th><th>Mitarbeitende/r</th><th>Aktiv</th><th>Letzte Anmeldung</th><th></th></tr></thead><tbody>';
    users.forEach((u) => {
      const id = esc(u.id), self = u.id === ME.id, active = u.active !== false;
      h += '<tr class="' + (active ? "" : "off") + '" data-uid="' + id + '">' +
        '<td><input type="text" id="un-' + id + '" data-uf="name" value="' + esc(u.name) + '" aria-label="Name">' + (u.mustChange ? '<small style="color:var(--warn)">vorläufige PIN offen</small>' : '') + '</td>' +
        '<td><select id="ur-' + id + '" data-uf="role" aria-label="Rolle">' + cols.map((c) => '<option value="' + c + '"' + (u.role === c ? " selected" : "") + '>' + ROLE_LABEL[c] + '</option>').join("") + '</select></td>' +
        '<td><select id="us-' + id + '" data-uf="staffId" aria-label="Verknüpfte Person">' + staffOpts(u.staffId) + '</select></td>' +
        '<td><label class="sw"><input type="checkbox" id="ua-' + id + '" data-uf="active"' + (active ? " checked" : "") + (self ? " disabled" : "") + '> ' + (active ? "aktiv" : "gesperrt") + '</label></td>' +
        '<td class="num" style="font-size:12px;color:var(--muted)">' + (u.lastLogin ? new Date(u.lastLogin).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie") + '</td>' +
        '<td><div class="acts"><button class="btn" data-ureset="' + id + '">PIN zurücksetzen</button>' + (self ? '' : '<button class="btn danger" data-udel="' + id + '">Löschen</button>') + '</div></td></tr>';
    });
    $("usersTable").innerHTML = h + '</tbody>';
    $("auditTable").innerHTML = '<thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Details</th></tr></thead><tbody>' +
      adapter.audit().slice(0, 200).map((a) => '<tr><td class="t">' + new Date(a.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" }) + '</td><td>' + esc(a.by || "–") + '</td><td>' + esc(ACTIONS[a.action] || a.action) + '</td><td>' + esc(a.detail || "") + '</td></tr>').join("") + '</tbody>';
  }
  function showTemp(name, pin) {
    $("tempBox").innerHTML = '<div class="temp" role="status"><p><b>Vorläufige PIN für ' + esc(name) + ':</b></p><code>' + esc(pin) + '</code>' +
      '<p>Nur jetzt sichtbar. Gib sie der Person persönlich weiter. Beim ersten Anmelden legt sie eine eigene PIN fest.</p>' +
      '<div><button class="btn" id="tempHide">Ausblenden</button></div></div>';
  }
  $("tempBox").addEventListener("click", (e) => { if (e.target.id === "tempHide") $("tempBox").innerHTML = ""; });
  $("nuForm").addEventListener("submit", (e) => {
    e.preventDefault(); if (!state.canAdmin) return;
    const name = $("nuName").value.trim(); if (!name) return;
    if (adapter.users().some((u) => u.name.toLowerCase() === name.toLowerCase())) return formMsg($("nuMsg"), "Diesen Namen gibt es schon. Ergänze ihn, damit man die Personen beim Anmelden unterscheiden kann.");
    const pin = tempPin(), staffId = $("nuStaff").value;
    if (staffId) adapter.users().filter((u) => u.staffId === staffId).forEach((u) => adapter.saveUser(Object.assign({}, u, { staffId: "" })));
    adapter.saveUser(Object.assign({ id: newId("u"), name, role: $("nuRole").value, staffId, active: true, mustChange: true, createdAt: new Date().toISOString(), lastLogin: null }, makePin(pin)));
    logAudit("user_created", name + " (" + ROLE_LABEL[$("nuRole").value] + ")");
    $("nuName").value = ""; formMsg($("nuMsg"), "");
    renderUsers(); showTemp(name, pin);
  });
  $("usersTable").addEventListener("change", (e) => {
    const row = e.target.closest("[data-uid]"), f = e.target.dataset.uf; if (!row || !f || !state.canAdmin) return;
    const u = adapter.getUser(row.dataset.uid); if (!u) return;
    const next = Object.assign({}, u), val = f === "active" ? e.target.checked : e.target.value.trim();
    next[f] = val;
    if (f === "name" && !val) return renderUsers();
    if (u.role === "admin" && u.active !== false && (next.role !== "admin" || next.active === false) && !activeAdmins(u.id)) { showNotice("Es muss mindestens einen aktiven Zugang mit der Rolle Leitung geben.", true); return renderUsers(); }
    if (f === "staffId" && val) adapter.users().filter((x) => x.staffId === val && x.id !== u.id).forEach((x) => adapter.saveUser(Object.assign({}, x, { staffId: "" })));
    adapter.saveUser(next);
    const what = f === "role" ? "Rolle " + ROLE_LABEL[u.role] + " → " + ROLE_LABEL[val] : f === "active" ? (val ? "entsperrt" : "gesperrt") : f === "staffId" ? (val ? "mit Mitarbeitenden verknüpft" : "Verknüpfung gelöst") : "Name geändert";
    logAudit("user_updated", next.name + ": " + what);
    showNotice("Zugang gespeichert."); renderUsers();
  });
  $("usersTable").addEventListener("click", (e) => {
    const rs = e.target.closest("[data-ureset]"), dl = e.target.closest("[data-udel]");
    if (rs) arm("ur:" + rs.dataset.ureset, rs, () => {
      const u = adapter.getUser(rs.dataset.ureset); if (!u) return;
      const pin = tempPin(); adapter.saveUser(Object.assign({}, u, makePin(pin), { mustChange: true }));
      logAudit("pin_reset", u.name); renderUsers(); showTemp(u.name, pin);
    });
    if (dl) arm("ud:" + dl.dataset.udel, dl, () => {
      const u = adapter.getUser(dl.dataset.udel); if (!u) return;
      if (u.role === "admin" && u.active !== false && !activeAdmins(u.id)) return showNotice("Es muss mindestens einen aktiven Zugang mit der Rolle Leitung geben.", true);
      adapter.deleteUser(u.id); logAudit("user_deleted", u.name); showNotice("Zugang gelöscht."); renderUsers();
    });
  });
  $("pwForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const u = adapter.getUser(ME.id);
    if (!checkPin(u, $("pwCur").value)) return formMsg($("pwMsg"), "Die aktuelle PIN stimmt nicht.");
    const p = $("pwNew").value, prob = pinProblem(p); if (prob) return formMsg($("pwMsg"), prob);
    if (p !== $("pwNew2").value) return formMsg($("pwMsg"), "Die beiden neuen PINs stimmen nicht überein.");
    adapter.saveUser(Object.assign({}, u, makePin(p), { mustChange: false }));
    ["pwCur", "pwNew", "pwNew2"].forEach((id) => { $(id).value = ""; });
    logAudit("pin_changed", ME.name); formMsg($("pwMsg"), "PIN geändert.", true);
  });

  // ---------- Anmeldung mit PIN ----------
  const SESSION_KEY = "zna-sitzung", LOCK_KEY = "zna-sperre", IDLE_MIN = 15;
  const APP_PARTS = ["overview", "usersView", "planPanel", "masterData", "dataPanel", "mainNav", "weekNav", "meChip"];
  const AUTH_PARTS = ["loginView", "setupView", "changeView"];
  let pickUid = null, lastActivity = Date.now();
  const lockInfo = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "{}"); } catch (e) { return {}; } };
  const setLock = (o) => { try { localStorage.setItem(LOCK_KEY, JSON.stringify(o)); } catch (e) {} };
  function showAuth(which, msg) {
    ME = null; closePicker();
    ["usersTable", "auditTable", "tempBox", "rMe"].forEach((id) => { $(id).innerHTML = ""; }); $("adminArea").hidden = true;
    APP_PARTS.forEach((id) => { $(id).hidden = true; });
    AUTH_PARTS.forEach((id) => { $(id).hidden = id !== which + "View"; });
    $("modeLine").textContent = "Bitte anmelden";
    if (which === "login") { renderLoginUsers(); backToPick(); if (msg) { $("liPick").hidden = false; formMsg($("liMsg"), ""); showNotice(msg); } }
    if (which === "setup") setTimeout(() => $("suName").focus(), 0);
    if (which === "change") setTimeout(() => $("cpPin").focus(), 0);
  }
  function renderLoginUsers() {
    const users = adapter.users().filter((u) => u.active !== false).sort((a, b) => String(a.name).localeCompare(b.name, "de"));
    const q = $("liSearch").value.trim().toLowerCase();
    $("liSearch").hidden = users.length <= 8;
    $("liUsers").innerHTML = users.filter((u) => !q || u.name.toLowerCase().includes(q)).map((u) => '<button class="who-btn" data-login="' + esc(u.id) + '"><span class="av">' + esc(initials(u.name)) + '</span><span>' + esc(u.name) + '</span></button>').join("") || '<p class="msg">Kein Zugang gefunden.</p>';
  }
  function backToPick() { pickUid = null; $("pinForm").hidden = true; $("liPick").hidden = false; $("liPin").value = ""; formMsg($("liMsg"), ""); }
  $("liSearch").addEventListener("input", renderLoginUsers);
  $("liUsers").addEventListener("click", (e) => {
    const b = e.target.closest("[data-login]"); if (!b) return;
    const u = adapter.getUser(b.dataset.login); if (!u) return;
    pickUid = u.id; $("liAv").textContent = initials(u.name); $("liName").textContent = u.name;
    $("liPick").hidden = true; $("pinForm").hidden = false; $("liPin").value = ""; formMsg($("liMsg"), "");
    $("liPin").focus();
  });
  $("liBack").addEventListener("click", backToPick);
  $("keypad").addEventListener("click", (e) => {
    const k = e.target.closest("[data-k]"); if (!k) return;
    const f = $("liPin");
    if (k.dataset.k === "del") f.value = f.value.slice(0, -1); else if (f.value.length < 8) f.value += k.dataset.k;
    f.focus();
  });
  $("liPin").addEventListener("input", () => { $("liPin").value = $("liPin").value.replace(/\D/g, "").slice(0, 8); });
  $("pinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const u = adapter.getUser(pickUid); if (!u) return backToPick();
    const locks = lockInfo(), l = locks[u.id] || { n: 0, until: 0 };
    if (l.until > Date.now()) return formMsg($("liMsg"), "Zu viele falsche Versuche. Bitte warte " + Math.ceil((l.until - Date.now()) / 60000) + " Minute(n).");
    if (!checkPin(u, $("liPin").value) || u.active === false) {
      l.n++; if (l.n >= 5) { l.until = Date.now() + 5 * 60000; l.n = 0; }
      locks[u.id] = l; setLock(locks);
      const tmp = ME; ME = { name: u.name }; logAudit("login_failed", ""); ME = tmp;
      $("liPin").value = "";
      return formMsg($("liMsg"), l.until > Date.now() ? "Zu viele falsche Versuche. Die Anmeldung ist für 5 Minuten gesperrt." : "Die PIN stimmt nicht.");
    }
    delete locks[u.id]; setLock(locks);
    adapter.saveUser(Object.assign({}, u, { lastLogin: new Date().toISOString() }));
    loginAs(u.id, true);
  });
  function loginAs(uid, fresh) {
    const u = adapter.getUser(uid); if (!u || u.active === false) return showAuth("login");
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid, at: Date.now() })); } catch (e) {}
    ME = { id: u.id, name: u.name, role: u.role };
    if (fresh) logAudit("login", "");
    if (u.mustChange) { AUTH_PARTS.forEach((id) => { $(id).hidden = id !== "changeView"; }); APP_PARTS.forEach((id) => { $(id).hidden = true; }); setTimeout(() => $("cpPin").focus(), 0); return; }
    enterApp();
  }
  function applyMe() {
    const u = adapter.getUser(ME.id);
    ME = { id: u.id, name: u.name, role: u.role };
    state.canAdmin = u.role === "admin"; state.canWrite = u.role !== "reader"; state.myStaffId = u.staffId || null;
    $("adminArea").hidden = !state.canAdmin;
    $("meAv").textContent = initials(u.name); $("meName").textContent = u.name; $("meRole").textContent = ROLE_LABEL[u.role];
  }
  function enterApp() {
    AUTH_PARTS.forEach((id) => { $(id).hidden = true; });
    $("mainNav").hidden = false; $("meChip").hidden = false;
    $("modeLine").textContent = "Gespeichert in diesem Browser";
    applyMe(); lastActivity = Date.now();
    renderChrome(); renderGrid(); renderPositions(); renderStaff(); applyRoute(); renderBackupStamp();
  }
  // Prüft nach Änderungen an den Zugängen (auch aus anderen Tabs), ob die angemeldete Person noch gültig ist
  function refreshMe() {
    let sess = null; try { sess = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
    const uid = (ME && ME.id) || (sess && sess.uid);
    const u = uid && adapter.getUser(uid);
    if (!u || u.active === false) { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} showAuth(adapter.users().length ? "login" : "setup", "Du wurdest abgemeldet, weil dein Zugang geändert oder entfernt wurde."); return false; }
    if (!ME) ME = { id: u.id, name: u.name, role: u.role };
    const before = ME.role; applyMe();
    if (before !== u.role) { showNotice("Deine Rolle wurde geändert: " + ROLE_LABEL[u.role] + "."); renderAll(); applyRoute(); }
    return true;
  }
  $("changeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const p = $("cpPin").value, prob = pinProblem(p); if (prob) return formMsg($("cpMsg"), prob);
    if (p !== $("cpPin2").value) return formMsg($("cpMsg"), "Die beiden PINs stimmen nicht überein.");
    const u = adapter.getUser(ME.id); if (!u) return showAuth("login");
    if (checkPin(u, p)) return formMsg($("cpMsg"), "Bitte wähle eine andere PIN als die vorläufige.");
    adapter.saveUser(Object.assign({}, u, makePin(p), { mustChange: false }));
    $("cpPin").value = $("cpPin2").value = ""; formMsg($("cpMsg"), "");
    logAudit("pin_changed", u.name); enterApp();
  });
  $("setupForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (adapter.users().length) return showAuth("login");
    const name = $("suName").value.trim(), p = $("suPin").value, prob = pinProblem(p);
    if (!name) return formMsg($("suMsg"), "Bitte gib deinen Namen ein.");
    if (prob) return formMsg($("suMsg"), prob);
    if (p !== $("suPin2").value) return formMsg($("suMsg"), "Die beiden PINs stimmen nicht überein.");
    const id = newId("u");
    adapter.saveUser(Object.assign({ id, name, role: "admin", staffId: "", active: true, mustChange: false, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() }, makePin(p)));
    ME = { id, name, role: "admin" }; logAudit("setup", "Erster Zugang für die Leitung angelegt");
    loginAs(id, false);
  });
  function logout(reason) {
    if (ME) logAudit(reason === "timeout" ? "timeout" : "logout", "");
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    route = "week"; setHash("kw-" + weekId());
    showAuth("login", reason === "timeout" ? "Du wurdest nach " + IDLE_MIN + " Minuten ohne Aktivität abgemeldet." : "");
  }
  $("logoutBtn").addEventListener("click", () => logout());
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach((ev) => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (!ME) return;
    if (Date.now() - lastActivity > IDLE_MIN * 60000) return logout("timeout");
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid: ME.id, at: lastActivity })); } catch (e) {}
  }, 20000);

  function start() {
    adapter = localAdapter();
    adapter.subPositions((list) => { state.positions = list; state.loaded.pos = true; renderGrid(); renderPositions(); renderStaff(); renderOverview(); });
    adapter.subStaff((list) => { state.staff = list; state.loaded.st = true; renderGrid(); renderStaff(); renderOverview(); if (route === "users") renderUsers(); });
    adapter.subAllWeeks((all) => { state.allWeeks = all; renderOverview(); });
    adapter.subUsers(() => { if (ME) { if (refreshMe() && route === "users") renderUsers(); } else if (!$("loginView").hidden) renderLoginUsers(); });
    const r = readHash();
    if (r && (r.route === "overview" || r.route === "users")) route = r.route;
    if (r && r.monday) state.monday = r.monday;
    state.ovYear = isoWeek(state.monday).y;
    goWeek(state.monday);
    APP_PARTS.forEach((id) => { $(id).hidden = true; });
    if (!adapter.users().length) return showAuth("setup");
    let sess = null; try { sess = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
    if (sess && sess.uid && Date.now() - sess.at < IDLE_MIN * 60000 && adapter.getUser(sess.uid)) return loginAs(sess.uid, false);
    showAuth("login");
  }

  renderHeader(); renderChrome(); renderPositions(); renderStaff();
  start();
})();
