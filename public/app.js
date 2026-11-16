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
    pending: {}, brush: "U", canWrite: false, canAdmin: false, myStaffId: null, loaded: { pos: false, st: false }, armed: new Set(), picker: null
  };
  let ME = null;
  const roleOf = () => state.canAdmin ? "lead" : state.canWrite ? "plan" : "read";
  const ROLE_LABEL = { lead: "Leitung", plan: "Planung", read: "Lesen" };
  const ROLE_OF_SERVER = { admin: "lead", planner: "plan", reader: "read" };
  const myStaff = () => state.myStaffId ? state.staff.find((s) => s.id === state.myStaffId) : null;
  const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  let adapter = null, unsubWeek = null, writeChain = Promise.resolve(), IDX = null;

  // ---------- Server-Verbindung ----------
  async function api(method, url, body) {
    const opt = { method, headers: { "X-Requested-With": "zna" }, credentials: "same-origin" };
    if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opt); } catch (e) { const err = new Error("offline"); err.status = 0; throw err; }
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || "Fehler " + res.status); err.status = res.status; err.code = data && data.code; err.body = data;
      if (res.status === 401 && ME && url !== "/api/me/password") { showNotice("Deine Sitzung ist abgelaufen. Bitte melde dich neu an.", true); setTimeout(() => location.reload(), 1500); }
      throw err;
    }
    return data;
  }
  function apiAdapter() {
    const subs = { positions: [], staff: [], all: [], week: null };
    const META = { fromCache: false };
    async function loadData() {
      const d = await api("GET", "/api/data");
      subs.positions.forEach((cb) => cb(d.positions, META)); subs.staff.forEach((cb) => cb(d.staff, META));
    }
    async function loadAll() { const d = await api("GET", "/api/weeks"); subs.all.forEach((cb) => cb(d.weeks)); }
    async function loadWeek() {
      const w = subs.week; if (!w) return;
      const d = await api("GET", "/api/weeks/" + w.id);
      if (subs.week === w) w.cb(d.exists ? d : null, META);
    }
    let allTimer = null;
    const soonAll = () => { clearTimeout(allTimer); allTimer = setTimeout(() => loadAll().catch(() => {}), 400); };
    function connect() {
      if (!window.EventSource) { setInterval(() => { loadData().catch(() => {}); loadWeek().catch(() => {}); soonAll(); }, 20000); return; }
      const es = new EventSource("/api/events");
      es.addEventListener("change", (ev) => {
        let m = {}; try { m = JSON.parse(ev.data); } catch (e) {}
        if (m.type === "data") loadData().catch(() => {});
        if (m.type === "week") { soonAll(); if (subs.week && subs.week.id === m.id) loadWeek().catch(() => {}); }
        if (m.type === "users") onUsersChanged();
      });
      // Nach Verbindungsabbruch alles neu laden, damit nichts verpasst wird
      let wasDown = false;
      es.onerror = () => { wasDown = true; };
      es.onopen = () => { if (wasDown) { wasDown = false; loadData().catch(() => {}); loadWeek().catch(() => {}); soonAll(); } };
    }
    return {
      start: async () => { await loadData(); loadAll().catch(() => {}); connect(); },
      subPositions: (cb) => { subs.positions.push(cb); },
      subStaff: (cb) => { subs.staff.push(cb); },
      subAllWeeks: (cb) => { subs.all.push(cb); },
      subWeek: (id, cb) => { const w = { id, cb }; subs.week = w; loadWeek().catch((e) => showNotice(errText(e), true)); return () => { if (subs.week === w) subs.week = null; }; },
      savePosition: (p) => api("PUT", "/api/positions/" + encodeURIComponent(p.id), p),
      deletePosition: (id) => api("DELETE", "/api/positions/" + encodeURIComponent(id)),
      saveStaff: (p) => api("PUT", "/api/staff/" + encodeURIComponent(p.id), p),
      deleteStaff: (id) => api("DELETE", "/api/staff/" + encodeURIComponent(id)),
      patchWeek: (wk, op) => api("PATCH", "/api/weeks/" + wk, op),
      copyPrev: (wk) => api("POST", "/api/weeks/" + wk + "/copy-previous"),
      clearWeek: (wk) => api("DELETE", "/api/weeks/" + wk),
      reloadWeek: () => loadWeek()
    };
  }
  function errText(e) {
    if (!e) return "Unbekannter Fehler.";
    if (e.status === 0) return "Keine Verbindung zum Server. Bitte prüfe das Netzwerk und versuche es erneut.";
    if (e.status >= 400 && e.status < 500 && e.message) return e.message;
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
      try { await adapter.patchWeek(wk, patch); if (wk === weekId()) state.weekExists = true; }
      catch (e) { showNotice(errText(e), true); if (e && e.status === 403 && e.code === "forbidden") { state.canWrite = false; renderAll(); } if (wk === weekId()) adapter.reloadWeek().catch(() => {}); }
      finally { if (state.pending[key] === value) delete state.pending[key]; renderGrid(); }
    });
  }
  function setSlot(posId, sh, d, ids) { queue("s|" + posId + "|" + sh + "|" + d, ids, { op: "slot", posId, sh, d, ids }); }
  function setAbsence(sid, d, code) { if (absence(sid, d) === code) return; queue("c|" + sid + "|" + d, code, { op: "cell", sid, d, code }); }
  function arm(key, btn, run) {
    if (state.armed.has(key)) { state.armed.delete(key); run(); return; }
    state.armed.add(key); btn.classList.add("armed");
    const orig = btn.dataset.orig || btn.textContent; btn.dataset.orig = orig; btn.textContent = key.startsWith("w:") ? "Wirklich? Erneut klicken" : "Sicher?";
    setTimeout(() => { if (state.armed.delete(key)) { btn.classList.remove("armed"); btn.textContent = orig; } }, 4000);
  }
  const adminFail = (e) => { showNotice(e && e.code === "forbidden" ? "Nicht gespeichert: Bereiche und Mitarbeitende darf nur die Leitung ändern." : errText(e), true); if (e && e.code === "forbidden") { state.canAdmin = false; renderAll(); } };
  const savePos = (p) => adapter.savePosition(p).catch(adminFail);
  const saveSt = (s) => adapter.saveStaff(s).catch(adminFail);

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
      await writeChain; await adapter.copyPrev(weekId()); state.weekExists = true;
      showNotice("Einteilung aus der Vorwoche übernommen.");
    } catch (err) { showNotice(errText(err), err.status !== 404); }
  }));
  $("clearWeek").addEventListener("click", (e) => arm("w:clear", e.currentTarget, async () => {
    const btn = $("clearWeek"); btn.textContent = "Woche leeren"; btn.classList.remove("armed");
    try { await writeChain; await adapter.clearWeek(weekId()); state.weekExists = true; showNotice("Woche geleert."); }
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
    arm("p:" + id, b, () => adapter.deletePosition(id).catch((err) => showNotice(errText(err), true)));
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
    arm("s:" + b.dataset.delst, b, () => adapter.deleteStaff(b.dataset.delst).catch((err) => showNotice(errText(err), true)));
  });

  // ---------- PDF-Export ----------
  const JSPDF_URL = "/vendor/jspdf/jspdf.umd.min.js";
  const AUTOTABLE_URL = "/vendor/jspdf-autotable/jspdf.plugin.autotable.min.js";
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
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
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
    const wk = route === "week";
    $("overview").hidden = route !== "overview"; $("rights").hidden = route !== "rights";
    $("planPanel").hidden = !wk; $("masterData").hidden = !wk; $("weekNav").hidden = !wk;
    $("navOverview").setAttribute("aria-selected", route === "overview"); $("navWeek").setAttribute("aria-selected", wk); $("navRights").setAttribute("aria-selected", route === "rights");
    if (!wk) closePicker();
    if (route === "overview") renderOverview();
    if (route === "rights") renderRights();
  }
  // ---------- Benutzer & Rechte ----------
  function renderLastEdit() {
    const el = $("lastEdit"), m = state.weekMeta;
    if (!m || !m.at) { el.textContent = ""; return; }
    el.textContent = "Zuletzt geändert von " + (m.byName || "unbekannt") + " · " + new Date(m.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) + " Uhr";
  }
  const ACTIONS = {
    seed: "Start", setup: "Einrichtung", login: "Anmeldung", login_failed: "Anmeldung fehlgeschlagen", password_changed: "Passwort geändert",
    password_reset: "Passwort zurückgesetzt", user_created: "Konto angelegt", user_updated: "Konto geändert", user_deleted: "Konto gelöscht",
    position_created: "Bereich angelegt", position_updated: "Bereich geändert", position_deleted: "Bereich gelöscht",
    staff_created: "Mitarbeitende/r angelegt", staff_updated: "Mitarbeitende/r geändert", staff_deleted: "Mitarbeitende/r entfernt",
    week_changed: "Plan geändert", week_copied: "Vorwoche übernommen", week_cleared: "Woche geleert"
  };
  const ROLE_SELECT = [["reader", "Lesen"], ["planner", "Planung"], ["admin", "Leitung"]];
  let usersCache = [], rightsToken = 0;
  async function renderRights() {
    if (route !== "rights" || !ME) return;
    const tok = ++rightsToken, role = roleOf(), ms = myStaff();
    $("rMe").innerHTML = '<span class="av" style="width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--accent-ink);font-weight:600;font-size:17px">' + esc(initials(ME.displayName)) + '</span>' +
      '<div class="who"><b>' + esc(ME.displayName) + '</b><span>Benutzername <code>' + esc(ME.username) + '</code> · Rolle: <span class="role r-' + role + '">' + ROLE_LABEL[role] + '</span>' +
      (ms ? ' · verknüpft mit „' + esc(ms.name) + '“' : '') + '</span></div>';
    const rows = [
      ["Übersicht und Wochenplan ansehen, PDF exportieren", 1, 1, 1],
      ["Personen in Bereiche einteilen und entfernen", 1, 1, 0],
      ["Urlaub, Krank, Fortbildung, Frei eintragen", 1, 1, 0],
      ["Vorwoche übernehmen, Woche leeren", 1, 1, 0],
      ["Bereiche und Mindestbesetzung pflegen", 1, 0, 0],
      ["Mitarbeitende anlegen, ändern, entfernen", 1, 0, 0],
      ["Benutzerkonten und Rollen verwalten, Protokoll ansehen", 1, 0, 0],
      ["Eigenes Passwort ändern", 1, 1, 1]
    ];
    const cols = [["lead", "Leitung"], ["plan", "Planung"], ["read", "Lesen"]];
    $("rMatrix").innerHTML = '<thead><tr><th>Funktion</th>' + cols.map((c) => '<th class="' + (c[0] === role ? "mine" : "") + '">' + c[1] + (c[0] === role ? '<small>deine Rolle</small>' : '') + '</th>').join("") + '</tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + r[0] + '</td>' + [1, 2, 3].map((i) => '<td class="' + (r[i] ? "y" : "n") + (cols[i - 1][0] === role ? " mine" : "") + '">' + (r[i] ? "✓" : "–") + '</td>').join("") + '</tr>').join("") + '</tbody>';
    $("adminArea").hidden = !state.canAdmin;
    if (!state.canAdmin) return;
    $("nuStaff").innerHTML = '<option value="">Keine Verknüpfung</option>' + state.staff.slice().sort((a, b) => String(a.name).localeCompare(b.name, "de")).map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join("");
    let users, audit;
    try { [users, audit] = await Promise.all([api("GET", "/api/users"), api("GET", "/api/audit?limit=150")]); }
    catch (e) { showNotice(errText(e), true); return; }
    if (tok !== rightsToken) return;
    usersCache = users.users;
    const staffOpts = (cur) => '<option value="">Keine Verknüpfung</option>' + state.staff.slice().sort((a, b) => String(a.name).localeCompare(b.name, "de")).map((s) => '<option value="' + esc(s.id) + '"' + (s.id === cur ? " selected" : "") + '>' + esc(s.name) + '</option>').join("");
    let h = '<thead><tr><th>Name</th><th>Benutzername</th><th>Rolle</th><th>Mitarbeitende/r</th><th>Aktiv</th><th>Letzte Anmeldung</th><th></th></tr></thead><tbody>';
    usersCache.forEach((u) => {
      const id = esc(u.id), self = u.id === ME.id;
      h += '<tr class="' + (u.active ? "" : "off") + '" data-uid="' + id + '">' +
        '<td><input type="text" id="un-' + id + '" data-uf="displayName" value="' + esc(u.displayName) + '" aria-label="Name"></td>' +
        '<td class="un">' + esc(u.username) + (u.mustChange ? '<br><small style="color:var(--warn);font-family:var(--font-body)">Einmalpasswort offen</small>' : '') + '</td>' +
        '<td><select id="ur-' + id + '" data-uf="role" aria-label="Rolle">' + ROLE_SELECT.map(([v, l]) => '<option value="' + v + '"' + (u.role === v ? " selected" : "") + '>' + l + '</option>').join("") + '</select></td>' +
        '<td><select id="us-' + id + '" data-uf="staffId" aria-label="Verknüpfte Person">' + staffOpts(u.staffId) + '</select></td>' +
        '<td><label class="sw"><input type="checkbox" id="ua-' + id + '" data-uf="active"' + (u.active ? " checked" : "") + (self ? " disabled" : "") + '> ' + (u.active ? "aktiv" : "gesperrt") + '</label></td>' +
        '<td class="num" style="font-size:12px;color:var(--muted)">' + (u.lastLogin ? new Date(u.lastLogin).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie") + '</td>' +
        '<td><div class="acts"><button class="btn" data-ureset="' + id + '">Passwort zurücksetzen</button>' + (self ? '' : '<button class="btn danger" data-udel="' + id + '">Löschen</button>') + '</div></td></tr>';
    });
    $("usersTable").innerHTML = h + '</tbody>';
    $("auditTable").innerHTML = '<thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Details</th></tr></thead><tbody>' +
      audit.entries.map((a) => '<tr><td class="t">' + new Date(a.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" }) + '</td><td>' + esc(a.username || "–") + '</td><td>' + esc(ACTIONS[a.action] || a.action) + '</td><td>' + esc(a.detail || "") + '</td></tr>').join("") + '</tbody>';
  }
  function showTemp(name, pw) {
    $("tempBox").innerHTML = '<div class="temp" role="status"><p><b>Einmalpasswort für ' + esc(name) + ':</b></p><code id="tempCode">' + esc(pw) + '</code>' +
      '<p>Nur jetzt sichtbar. Gib es der Person persönlich weiter. Beim ersten Anmelden legt sie ein eigenes Passwort fest.</p>' +
      '<div style="display:flex;gap:8px"><button class="btn" id="tempCopy">Kopieren</button><button class="btn" id="tempHide">Ausblenden</button></div></div>';
    $("tempBox").scrollIntoView({ block: "nearest" });
  }
  $("tempBox").addEventListener("click", (e) => {
    if (e.target.id === "tempHide") $("tempBox").innerHTML = "";
    if (e.target.id === "tempCopy") {
      const t = $("tempCode").textContent;
      const sel = () => { const r = document.createRange(); r.selectNodeContents($("tempCode")); const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); };
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => { e.target.textContent = "Kopiert"; }, sel); else sel();
    }
  });
  function formMsg(el, text, ok) { el.textContent = text; el.className = "msg" + (ok ? " ok" : ""); el.hidden = !text; }
  $("nuForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { displayName: $("nuName").value, username: $("nuUser").value, role: $("nuRole").value, staffId: $("nuStaff").value || null };
    try {
      const r = await api("POST", "/api/users", body);
      formMsg($("nuMsg"), ""); $("nuName").value = ""; $("nuUser").value = "";
      showTemp(r.user.displayName + " (" + r.user.username + ")", r.tempPassword); renderRights();
    } catch (err) { formMsg($("nuMsg"), errText(err)); }
  });
  $("nuName").addEventListener("input", () => {
    // Benutzername vorschlagen: "Anna Vogt" → "a.vogt"
    const u = $("nuUser"); if (u.dataset.touched) return;
    const parts = $("nuName").value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").split(/\s+/).filter(Boolean);
    u.value = parts.length > 1 ? parts[0][0] + "." + parts[parts.length - 1].replace(/[^a-z0-9-]/g, "") : (parts[0] || "").replace(/[^a-z0-9-]/g, "");
  });
  $("nuUser").addEventListener("input", () => { $("nuUser").dataset.touched = "1"; });
  $("usersTable").addEventListener("change", async (e) => {
    const row = e.target.closest("[data-uid]"), f = e.target.dataset.uf; if (!row || !f) return;
    const val = f === "active" ? e.target.checked : e.target.value;
    try { await api("PUT", "/api/users/" + encodeURIComponent(row.dataset.uid), { [f]: f === "staffId" ? (val || null) : val }); showNotice("Konto gespeichert."); }
    catch (err) { showNotice(errText(err), true); }
    renderRights();
  });
  $("usersTable").addEventListener("click", (e) => {
    const rs = e.target.closest("[data-ureset]"), dl = e.target.closest("[data-udel]");
    if (rs) arm("ur:" + rs.dataset.ureset, rs, async () => {
      const u = usersCache.find((x) => x.id === rs.dataset.ureset);
      try { const r = await api("POST", "/api/users/" + encodeURIComponent(rs.dataset.ureset) + "/reset-password"); showTemp(u ? u.displayName + " (" + u.username + ")" : "Konto", r.tempPassword); }
      catch (err) { showNotice(errText(err), true); }
      renderRights();
    });
    if (dl) arm("ud:" + dl.dataset.udel, dl, async () => {
      try { await api("DELETE", "/api/users/" + encodeURIComponent(dl.dataset.udel)); showNotice("Konto gelöscht."); }
      catch (err) { showNotice(errText(err), true); }
      renderRights();
    });
  });
  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("pwNew").value !== $("pwNew2").value) return formMsg($("pwMsg"), "Die beiden neuen Passwörter stimmen nicht überein.");
    try {
      await api("POST", "/api/me/password", { current: $("pwCur").value, next: $("pwNew").value });
      ["pwCur", "pwNew", "pwNew2"].forEach((id) => { $(id).value = ""; });
      formMsg($("pwMsg"), "Passwort geändert. Andere angemeldete Geräte wurden abgemeldet.", true);
    } catch (err) { formMsg($("pwMsg"), errText(err)); }
  });
  async function onUsersChanged() {
    try {
      const r = await api("GET", "/api/me"); const before = ME.role;
      applyMe(r.user);
      if (before !== r.user.role) { showNotice("Deine Rolle wurde geändert: " + ROLE_LABEL[roleOf()] + "."); renderAll(); }
      else { renderGrid(); }
    } catch (e) {}
    if (route === "rights") renderRights();
  }
  function applyMe(user) {
    ME = user;
    state.canAdmin = user.role === "admin"; state.canWrite = user.role !== "reader"; state.myStaffId = user.staffId || null;
    $("meAv").textContent = initials(user.displayName); $("meName").textContent = user.displayName;
    $("meRole").textContent = ROLE_LABEL[roleOf()]; $("meChip").hidden = false;
  }
  function setHash(name) { if (location.hash.slice(1) !== name) { try { location.hash = name; } catch (e) {} } }
  function openWeek(mon) { route = "week"; applyRoute(); if (weekIdOf(mon) !== weekId() || !unsubWeek) goWeek(mon); else setHash("kw-" + weekId()); }
  function readHash() {
    const h = location.hash.slice(1);
    if (h === "uebersicht") return { route: "overview" };
    if (h === "rechte") return { route: "rights" };
    const m = /^kw-(\d{4}-W\d{2})$/.exec(h);
    if (m) { const mon = mondayOfWeekId(m[1]); if (mon) return { route: "week", monday: mon }; }
    return null;
  }
  window.addEventListener("hashchange", () => {
    const r = readHash(); if (!r || !adapter) return;
    if (r.route === "overview" || r.route === "rights") { if (route !== r.route) { route = r.route; applyRoute(); } }
    else if (route !== "week" || weekIdOf(r.monday) !== weekId()) openWeek(r.monday);
  });
  $("mainNav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-route]"); if (!b) return;
    if (b.dataset.route === "overview") {
      route = "overview"; state.ovYear = isoWeek(state.monday).y; applyRoute(); setHash("uebersicht");
      const t = document.querySelector('.wk[data-week="' + weekId() + '"]') || document.querySelector(".wk.cur");
      if (t) t.scrollIntoView({ block: "center" });
    }
    else if (b.dataset.route === "rights") { route = "rights"; applyRoute(); setHash("rechte"); }
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

  // ---------- Anmeldung & Start ----------
  const APP_PARTS = ["overview", "rights", "planPanel", "masterData", "mainNav", "weekNav", "meChip"];
  const AUTH_PARTS = ["loginView", "setupView", "changeView"];
  function showAuth(which, msg) {
    APP_PARTS.forEach((id) => { $(id).hidden = true; });
    AUTH_PARTS.forEach((id) => { $(id).hidden = id !== which + "View"; });
    $("modeLine").textContent = "Bitte anmelden";
    if (which === "login") { if (msg) formMsg($("liMsg"), msg); setTimeout(() => $("liUser").focus(), 0); }
    if (which === "setup") setTimeout(() => $("suCode").focus(), 0);
    if (which === "change") { $("cpUserHidden").value = ME ? ME.username : ""; setTimeout(() => $("cpCur").focus(), 0); }
  }
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("loginForm").querySelector("button"); btn.disabled = true;
    try { const r = await api("POST", "/api/login", { username: $("liUser").value, password: $("liPass").value }); $("liPass").value = ""; formMsg($("liMsg"), ""); onAuthed(r.user); }
    catch (err) { formMsg($("liMsg"), errText(err)); $("liPass").select(); }
    finally { btn.disabled = false; }
  });
  $("setupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("suPass").value !== $("suPass2").value) return formMsg($("suMsg"), "Die beiden Passwörter stimmen nicht überein.");
    try { const r = await api("POST", "/api/setup", { code: $("suCode").value, displayName: $("suName").value, username: $("suUser").value, password: $("suPass").value }); onAuthed(r.user); }
    catch (err) { formMsg($("suMsg"), errText(err)); }
  });
  $("changeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("cpNew").value !== $("cpNew2").value) return formMsg($("cpMsg"), "Die beiden neuen Passwörter stimmen nicht überein.");
    try { const r = await api("POST", "/api/me/password", { current: $("cpCur").value, next: $("cpNew").value }); ["cpCur", "cpNew", "cpNew2"].forEach((id) => { $(id).value = ""; }); onAuthed(r.user); }
    catch (err) { formMsg($("cpMsg"), errText(err)); }
  });
  $("logoutBtn").addEventListener("click", async () => {
    try { await api("POST", "/api/logout"); } catch (e) {}
    location.hash = ""; location.reload();
  });

  let started = false;
  function onAuthed(user) {
    ME = user;
    if (user.mustChange) return showAuth("change");
    AUTH_PARTS.forEach((id) => { $(id).hidden = true; });
    $("mainNav").hidden = false;
    applyMe(user);
    if (!started) { started = true; startApp(); } else { renderAll(); applyRoute(); }
  }
  async function startApp() {
    adapter = apiAdapter();
    $("modeLine").textContent = "Gemeinsamer Plan · Änderungen sind sofort für alle sichtbar";
    adapter.subPositions((list) => { state.positions = list; state.loaded.pos = true; renderGrid(); renderPositions(); renderStaff(); renderOverview(); });
    adapter.subStaff((list) => { state.staff = list; state.loaded.st = true; renderGrid(); renderStaff(); renderOverview(); if (route === "rights") renderRights(); });
    adapter.subAllWeeks((all) => { state.allWeeks = all; renderOverview(); });
    const r = readHash();
    if (r && (r.route === "overview" || r.route === "rights")) route = r.route;
    if (r && r.monday) state.monday = r.monday;
    state.ovYear = isoWeek(state.monday).y;
    renderChrome(); applyRoute();
    try { await adapter.start(); } catch (e) { showNotice(errText(e), true); }
    goWeek(state.monday);
  }
  async function boot() {
    try { const r = await api("GET", "/api/me"); onAuthed(r.user); }
    catch (e) {
      if (e.status === 401) return showAuth(e.body && e.body.setupNeeded ? "setup" : "login");
      showAuth("login", "Der Server ist gerade nicht erreichbar. Bitte lade die Seite gleich neu.");
    }
  }

  renderHeader(); renderChrome();
  APP_PARTS.forEach((id) => { $(id).hidden = true; });
  boot();
})();