/* Attendance module UI: live board, locations map, timesheet, exceptions, shifts & branches, phone check-in.
   Loaded before the main app script; the app calls window.AttendanceUI(MQ) with its internals. */
window.AttendanceUI = function (MQ) {
  "use strict";
  const { S, $, h, fd, toast, openModal, closeModal, confirmBox, put, E } = MQ;
  const A = window.Attendance;
  S.att = { punches: [], requests: [], branches: [], months: {}, pos: null, locating: false };
  S.attCfg = S.attCfg || {};
  const U = S.ui;

  /* ---------- helpers ---------- */
  const isSupa = () => !!(MQ.sb && MQ.db && MQ.db.supa);
  // attendance go-live: the saved date, else the first punch on record (so earlier days never become absences)
  let firstMemo = { n: -1, d: "" };
  const firstPunchDay = () => { const n = S.att.punches.length; if (firstMemo.n !== n) { let m = ""; S.att.punches.forEach(p => { const d = p.at ? A.localDate(Date.parse(p.at)) : ""; if (d && (!m || d < m)) m = d; }); firstMemo = { n, d: m }; } return firstMemo.d; };
  const cfgRaw = () => Object.assign({}, S.attCfg || {}, { trackingFrom: (S.attCfg && S.attCfg.trackingFrom) || firstPunchDay() || A.localToday({}) });
  const cfg = () => A.config(cfgRaw());
  const branches = () => (isSupa() ? S.att.branches : ((S.attCfg && S.attCfg.branches) || []));
  const branchBy = id => branches().find(b => b.id === id);
  const tLocal = at => new Date(Date.parse(at) + cfg().tzOffsetMin * 60000).toISOString().slice(11, 16);
  const dLocal = at => A.localDate(Date.parse(at), cfg());
  const todayL = () => A.localToday(cfg());
  const nowISO = () => new Date().toISOString();
  const ctx = () => ({ cfg: cfgRaw(), leaves: S.leaves || [], now: nowISO() });
  const nm = e => (e && (e.nameEn || e.nameAr)) || (e && e.empNo) || "";
  const initials = e => (nm(e).split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("") || "?").toUpperCase();
  const av = e => `<span class="av" aria-hidden="true">${h(initials(e))}</span>`;
  const who = (e, sub) => `<span class="who">${av(e)}<span><b>${h(nm(e))}</b><span class="sub">${h(sub != null ? sub : [e.empNo, e.jobTitle].filter(Boolean).join(" · "))}</span></span></span>`;
  const empBranch = e => (e && e.hr && e.hr.branchId) || "";
  const fmtM = m => (m == null ? "—" : A.fmtMin(m));
  const durS = m => { m = Math.round(m || 0); if (!m) return "—"; const hh = Math.floor(m / 60), mm = m % 60; return hh ? `${hh}h${mm ? " " + mm + "m" : ""}` : `${mm}m`; };
  const ym = d => d.slice(0, 7);
  const staff = () => MQ.activeStaff().slice().sort((a, b) => nm(a).localeCompare(nm(b)));
  const filterEmps = list => list.filter(e => (!U.attBr || empBranch(e) === U.attBr) && (!U.attDept || (e.department || "") === U.attDept)
    && (!U.attQ || [e.empNo, e.hrNo, e.nameEn, e.nameAr, e.jobTitle].join(" ").toLowerCase().includes(U.attQ.toLowerCase())));
  const depts = () => [...new Set(MQ.activeStaff().map(e => e.department).filter(Boolean))].sort();
  const canEdit = () => !MQ.readOnly && !S.essOnly;
  const errMsg = e => (e && (e.message || e.details)) || String(e);

  /* ---------- data ---------- */
  const normP = r => ({ id: String(r.id), empNo: r.emp_no, email: r.email, kind: r.kind, at: r.at, lat: r.lat, lng: r.lng, accuracy: r.accuracy_m, branchId: r.branch_id,
    distance: r.distance_m, inside: r.inside, status: r.status, note: r.note, device: r.device, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, flags: r.flags || [] });
  const normR = r => ({ id: String(r.id), empNo: r.emp_no, email: r.email, day: r.day, kind: r.kind, time: r.at_time, reason: r.reason, status: r.status, createdAt: r.created_at, reviewedBy: r.reviewed_by, reviewNote: r.review_note });
  function upsertP(p) { const i = S.att.punches.findIndex(x => x.id === p.id); if (i >= 0) S.att.punches[i] = p; else S.att.punches.push(p); }
  function upsertR(r) { const i = S.att.requests.findIndex(x => x.id === r.id); if (i >= 0) S.att.requests[i] = r; else S.att.requests.push(r); }
  async function supaAll(q) { const out = []; for (let f = 0; ; f += 1000) { const { data, error } = await q().range(f, f + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; }
  async function loadMonth(m) {
    if (!isSupa() || S.att.months[m]) return; S.att.months[m] = "loading";
    const from = new Date(Date.parse(m + "-01T00:00:00+03:00") - 86400000).toISOString();
    const y = +m.slice(0, 4), mo = +m.slice(5, 7), to = new Date(Date.UTC(y, mo, 2) - 3 * 3600000).toISOString();
    try { const rows = await supaAll(() => MQ.sb.from("attendance").select("*").gte("at", from).lt("at", to).order("at")); rows.forEach(r => upsertP(normP(r))); S.att.months[m] = true; MQ.render(); }
    catch (e) { S.att.months[m] = false; console.error(e); toast("Attendance could not load: " + errMsg(e)); }
  }
  async function loadSupaSide() {
    const sb = MQ.sb;
    try { const { data } = await sb.from("branches").select("*").order("name"); S.att.branches = data || []; } catch (e) { console.error(e); }
    try { const since = new Date(Date.now() - 62 * 86400000).toISOString().slice(0, 10); const { data, error } = await sb.from("attendance_requests").select("*").gte("day", since).order("created_at", { ascending: false }); if (!error) S.att.requests = (data || []).map(normR); } catch (e) {}
    sb.channel("att-live").on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, p => { if (p.new && p.new.id) { upsertP(normP(p.new)); MQ.render(); } })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_requests" }, p => { if (p.new && p.new.id) { upsertR(normR(p.new)); MQ.render(); } })
      .on("postgres_changes", { event: "*", schema: "public", table: "branches" }, async () => { const { data } = await sb.from("branches").select("*").order("name"); S.att.branches = data || []; MQ.render(); }).subscribe();
  }
  async function start() {
    const db = MQ.db;
    db.doc("config/attendance").onSnapshot(s => { S.attCfg = s.exists ? s.data() : {}; MQ.render(); }, () => {});
    if (isSupa()) {
      await loadSupaSide(); loadMonth(ym(todayL()));
      try { const { data } = await MQ.sb.rpc("app_emp_no"); if (data) S.me = { empNo: data }; } catch (e) {}
    } else {
      db.collection("attendance").onSnapshot(s => { S.att.punches = s.docs.map(d => Object.assign({ id: d.id }, d.data(), { id: d.id })); MQ.render(); }, () => {});
      db.collection("attreq").onSnapshot(s => { S.att.requests = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })); MQ.render(); }, () => {});
      if (db.linkedEmpNo) S.me = { empNo: db.linkedEmpNo };
    }
    setInterval(() => { if (document.visibilityState === "visible" && !$("#ov") && ["att", "attmap", "me", "dashboard"].includes(U.view) && !document.activeElement.matches("input,select,textarea")) MQ.renderNow(); }, 30000);
  }
  async function startEss() {
    const sb = MQ.sb;
    try { const { data, error } = await sb.rpc("my_context"); if (error) throw error; if (data) { S.me = { empNo: data.empNo, emp: data }; S.attCfg = data.attendance || {}; } }
    catch (e) { try { const { data } = await sb.rpc("app_emp_no"); if (data) S.me = { empNo: data, emp: { empNo: data } }; } catch (x) {} }
    await loadSupaSide();
    try { const since = new Date(Date.now() - 45 * 86400000).toISOString(); const rows = await supaAll(() => sb.from("attendance").select("*").gte("at", since).order("at")); rows.forEach(r => upsertP(normP(r))); } catch (e) { console.error(e); }
    locate(); setInterval(() => { if (document.visibilityState === "visible") MQ.renderNow(); }, 30000);
  }
  const meEmp = () => { if (!S.me) return null; return MQ.empBy(S.me.empNo) || S.me.emp || { empNo: S.me.empNo }; };

  async function savePunchDoc(row) { await put("attendance", row.id, row); upsertP(row); }
  async function punchNow(kind) {
    const e = meEmp(); if (!e) { toast("This sign-in is not linked to an employee."); return; }
    if (S.att.busy) return; S.att.busy = true; MQ.renderNow();
    try {
      const pos = await locate(true);
      if (!pos || pos.err) throw new Error((pos && pos.err) || "Location is needed to check in. Allow location access and try again.");
      const ev = A.evaluatePunch(branches(), pos.lat, pos.lng, pos.acc, cfg(), A.allowedBranches(e));
      if (isSupa()) {
        const { data, error } = await MQ.sb.rpc("punch", { p_kind: kind, p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.acc, p_device: (navigator.userAgent || "").slice(0, 280), p_note: null });
        if (error) throw error; const p = normP(data); upsertP(p); done(p);
      } else {
        if (ev.blocked) throw new Error(ev.reason + ". Check-in is only allowed inside the zone.");
        const mine = S.att.punches.filter(p => p.empNo === e.empNo).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        if (mine[0] && mine[0].kind === kind && Date.now() - Date.parse(mine[0].at) < 60000) throw new Error("Duplicate punch — wait a minute.");
        const row = { id: "P-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), empNo: e.empNo, email: MQ.uid || "", kind, at: nowISO(),
          lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), accuracy: Math.round(pos.acc), branchId: ev.branchId, distance: ev.distance, inside: ev.inside, status: ev.status,
          device: (navigator.userAgent || "").slice(0, 120), flags: [] };
        const tr = A.travelCheck(mine[0], row); if (tr) { row.flags.push("IMPOSSIBLE_TRAVEL"); row.status = "outside"; row.note = `Moved ${tr.km} km since the last punch (${tr.kmh} km/h)`; }
        await savePunchDoc(row); done(row);
      }
    } catch (x) { toast(errMsg(x)); }
    finally { S.att.busy = false; MQ.renderNow(); }
    function done(p) { const b = branchBy(p.branchId); const lbl = { in: "Checked in", out: "Checked out", break_start: "Break started", break_end: "Break ended" }[p.kind];
      toast(`${lbl} at ${tLocal(p.at)}${b ? " · " + b.name : ""}${p.status !== "ok" ? " · outside the zone, HR will review" : ""}`); }
  }
  function locate(fresh) {
    return new Promise(res => {
      if (U.fakeLoc && S.demo) { const e = meEmp(), b = branchBy(empBranch(e)) || branches()[0]; if (b) { S.att.pos = { lat: b.lat + 0.0003, lng: b.lng + 0.0002, acc: 12, at: Date.now(), fake: true }; MQ.render(); return res(S.att.pos); } }
      if (!navigator.geolocation) { S.att.pos = { err: "This browser cannot share location." }; MQ.render(); return res(S.att.pos); }
      if (!fresh && S.att.pos && !S.att.pos.err && Date.now() - S.att.pos.at < 60000) return res(S.att.pos);
      S.att.locating = true; MQ.render();
      navigator.geolocation.getCurrentPosition(p => { S.att.locating = false; S.att.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; MQ.render(); res(S.att.pos); },
        er => { S.att.locating = false; S.att.pos = { err: er.code === 1 ? "Location permission is off. Allow location for this site in your browser settings." : er.code === 3 ? "Location timed out. Move near a window or outdoors and try again." : "Location is unavailable on this device." }; MQ.render(); res(S.att.pos); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: fresh ? 0 : 30000 });
    });
  }
  async function manualPunch(empNo, at, kind, note) {
    if (isSupa()) {
      const { data, error } = await MQ.sb.from("attendance").insert({ emp_no: empNo, email: MQ.uid || "", kind, at, status: "manual", inside: true, note: note || null }).select().single();
      if (error) throw error; upsertP(normP(data));
    } else await savePunchDoc({ id: "M-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), empNo, email: MQ.uid || "", kind, at, status: "manual", inside: true, note: note || "", device: "HR entry" });
  }
  async function review(id, status, note) {
    const p = S.att.punches.find(x => x.id === id); if (!p) return;
    if (isSupa()) { const { data, error } = await MQ.sb.from("attendance").update({ status, reviewed_by: MQ.uid, reviewed_at: nowISO(), note: note != null ? note : p.note }).eq("id", +id).select().single(); if (error) throw error; upsertP(normP(data)); }
    else await savePunchDoc(Object.assign({}, p, { status, reviewedBy: MQ.uid || "", reviewedAt: nowISO(), prevStatus: p.status }));
  }
  async function saveRequest(r) {
    if (isSupa()) { const { data, error } = await MQ.sb.from("attendance_requests").insert({ emp_no: r.empNo, email: MQ.uid, day: r.day, kind: r.kind, at_time: r.time, reason: r.reason }).select().single(); if (error) throw error; upsertR(normR(data)); }
    else { const id = "RQ-" + Date.now().toString(36); await put("attreq", id, Object.assign({ id, status: "pending", createdAt: nowISO() }, r)); }
  }
  async function decide(id, status) {
    const r = S.att.requests.find(x => x.id === id); if (!r) return;
    if (status === "approved") await manualPunch(r.empNo, A.atFor(r.day, A.hm(r.time), cfg()), r.kind, "Correction request: " + r.reason);
    if (isSupa()) { const { data, error } = await MQ.sb.from("attendance_requests").update({ status, reviewed_by: MQ.uid, reviewed_at: nowISO() }).eq("id", +id).select().single(); if (error) throw error; upsertR(normR(data)); }
    else { const o = Object.assign({}, r, { status, reviewedBy: MQ.uid || "", reviewedAt: nowISO() }); delete o._id; await put("attreq", id, o); }
  }
  async function saveCfg(patch) { const o = Object.assign({}, S.attCfg || {}, patch); delete o._id; await put("config", "attendance", o); S.attCfg = o; }
  async function saveBranch(b) {
    if (isSupa()) { const { error } = await MQ.sb.from("branches").upsert({ id: b.id, name: b.name, lat: b.lat, lng: b.lng, radius_m: b.radius_m, active: b.active !== false }); if (error) throw error;
      const { data } = await MQ.sb.from("branches").select("*").order("name"); S.att.branches = data || []; }
    else { const list = branches().filter(x => x.id !== b.id).concat([b]).sort((a, c) => a.name.localeCompare(c.name)); await saveCfg({ branches: list }); }
  }

  /* ---------- maps (Leaflet + OpenStreetMap, loaded on demand) ---------- */
  let LP = null; const maps = [];
  function leaflet() {
    if (window.L) return Promise.resolve(window.L); if (LP) return LP;
    LP = new Promise((res, rej) => {
      const c = document.createElement("link"); c.rel = "stylesheet"; c.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(c);
      const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; s.onload = () => res(window.L); s.onerror = () => { LP = null; rej(new Error("map")); }; document.head.appendChild(s);
    }); return LP;
  }
  const COL = { ok: "#0F6B4E", outside: "#A63D2F", low_accuracy: "#C8902E", manual: "#2856a8", approved: "#0F6B4E", rejected: "#7a7a7a" };
  function mountMaps() {
    maps.splice(0).forEach(m => { try { m.remove(); } catch (e) {} });
    document.querySelectorAll("[data-lmap]").forEach(el => {
      leaflet().then(L => {
        if (!document.body.contains(el)) return;
        const spec = JSON.parse(el.dataset.lmap || "{}");
        const m = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: !!spec.wheel }); maps.push(m);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
        const pts = [];
        (spec.branches || []).forEach(b => { const c = L.circle([b.lat, b.lng], { radius: b.r, color: "#0F6B4E", weight: 2, fillColor: "#0F6B4E", fillOpacity: .12 }).addTo(m);
          c.bindTooltip(`${h(b.name)}${b.label ? " · " + h(b.label) : ""}`, { permanent: !!spec.labels, direction: "top", className: "lm-tip" }); pts.push([b.lat, b.lng]); });
        (spec.points || []).forEach(p => { L.circleMarker([p.lat, p.lng], { radius: 6, color: "#fff", weight: 1.5, fillColor: COL[p.s] || "#0F6B4E", fillOpacity: .95 }).addTo(m).bindPopup(h(p.t)); pts.push([p.lat, p.lng]); });
        if (spec.edit) {
          const st = spec.edit; let mk = L.marker([st.lat, st.lng], { draggable: true }).addTo(m), ci = L.circle([st.lat, st.lng], { radius: st.r, color: "#0F6B4E", fillOpacity: .15 }).addTo(m);
          const sync = ll => { ci.setLatLng(ll); const la = $("#br_lat"), lo = $("#br_lng"); if (la) la.value = ll.lat.toFixed(6); if (lo) lo.value = ll.lng.toFixed(6); };
          mk.on("drag", ev => sync(ev.target.getLatLng())); m.on("click", ev => { mk.setLatLng(ev.latlng); sync(ev.latlng); });
          el._setR = r => ci.setRadius(r); el._move = (la, lo) => { mk.setLatLng([la, lo]); ci.setLatLng([la, lo]); m.setView([la, lo], 17); };
          m.setView([st.lat, st.lng], st.lat ? 17 : 5); return;
        }
        const key = el.dataset.key;
        if (spec.focus) m.setView([spec.focus.lat, spec.focus.lng], spec.focus.z);
        else if (key && U["mv_" + key]) m.setView(U["mv_" + key].c, U["mv_" + key].z);
        else if (pts.length > 1) m.fitBounds(pts, { padding: [30, 30], maxZoom: 17 }); else if (pts.length) m.setView(pts[0], 16); else m.setView([24.2, 45.1], 5);
        if (key) m.on("moveend", () => { U["mv_" + key] = { c: m.getCenter(), z: m.getZoom() }; });
      }).catch(() => { el.innerHTML = `<div class="empty"><b>Map could not load</b>Check the internet connection. Locations still work without the map.</div>`; });
    });
  }

  /* ---------- shared bits ---------- */
  function statusPill(r) {
    const late = r.lateMin > 0 ? ` · late ${durS(r.lateMin)}` : "";
    const lv = r.leave ? (window.HR && r.leave.type ? r.leave.type[0] + r.leave.type.slice(1).toLowerCase() + " leave" : "On leave") : "On leave";
    const m = { PRESENT: ["p-green", "On time"], LATE: ["p-amber", "Late " + durS(r.lateMin)], IN: [r.lateMin > 0 ? "p-amber" : "p-green", "Working" + late], NOT_IN: ["p-red", "Not checked in"],
      NOT_YET: ["p-grey", "Shift not started"], ABSENT: ["p-red", "Absent"], LEAVE: ["p-blue", lv], HOLIDAY: ["p-grey", r.holiday ? r.holiday.name : "Holiday"], WEEKEND: ["p-grey", "Day off"],
      INCOMPLETE: ["p-amber", "No check-out"], HALF_DAY: ["p-amber", "Half day"], UPCOMING: ["p-grey", "Upcoming"], NA: ["p-grey", "—"] }[r.status] || ["p-grey", r.status];
    return `<span class="pill ${m[0]}">${h(m[1])}</span>`;
  }
  function flagsHtml(r) {
    const f = [];
    if (r.flags.includes("REVIEW")) f.push(`<span class="flag r">Outside zone</span>`);
    if (r.punches.some(p => (p.flags || []).includes("IMPOSSIBLE_TRAVEL"))) f.push(`<span class="flag r">Location jump</span>`);
    if (r.lateMin > 0 && r.status !== "LATE" && r.status !== "IN") f.push(`<span class="flag a">Late ${durS(r.lateMin)}</span>`);
    if (r.flags.includes("MANUAL")) f.push(`<span class="flag">Manual</span>`);
    if (r.earlyMin > 0) f.push(`<span class="flag a">Left ${durS(r.earlyMin)} early</span>`);
    if (r.otMin > 0) f.push(`<span class="flag">Overtime ${durS(r.otMin)}</span>`);
    if (r.flags.includes("NO_BREAK")) f.push(`<span class="flag a" title="Labor Law Art. 101">No break over 5h</span>`);
    if (r.flags.includes("OVER_12H")) f.push(`<span class="flag r" title="Labor Law Art. 101">Over 12h on site</span>`);
    if (r.flags.includes("WORKED_ON_LEAVE")) f.push(`<span class="flag a">Punched on leave</span>`);
    return f.length ? `<span class="flagset">${f.join("")}</span>` : "";
  }
  function segments(r, nowRel) {
    const out = []; let open = null;
    r.punches.forEach(p => { if (p.kind === "in" || p.kind === "break_end") { if (open == null) open = p.rel; } else if (open != null) { out.push([open, p.rel, false]); open = null; } });
    if (open != null && r.status === "IN") out.push([open, Math.max(open, nowRel), true]);
    return out;
  }
  function timeline(r, lo, hi, nowRel) {
    const pc = v => ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo) * 100).toFixed(2) + "%";
    const w = (a, b) => ((Math.min(b, hi) - Math.max(a, lo)) / (hi - lo) * 100).toFixed(2) + "%";
    const sh = r.shift; let x = "";
    if (sh.workday && !["HOLIDAY", "LEAVE", "NA"].includes(r.status)) x += `<span class="sh" style="left:${pc(sh.start)};width:${w(sh.start, sh.end)}"></span>`;
    segments(r, nowRel).forEach(s => { x += `<span class="wk${s[2] ? " live" : ""}" style="left:${pc(s[0])};width:${w(s[0], s[1])}"></span>`; });
    r.punches.forEach(p => { x += `<span class="tk${p.status === "outside" || p.status === "low_accuracy" ? " bad" : ""}" style="left:${pc(p.rel)}" title="${h(tLocal(p.at) + " " + p.kind.replace("_", " "))}"></span>`; });
    if (nowRel > lo && nowRel < hi) x += `<span class="now" style="left:${pc(nowRel)}"></span>`;
    return `<div class="tl" role="img" aria-label="${h("Shift " + fmtM(sh.start) + "–" + fmtM(sh.end) + ", worked " + durS(r.workedMin))}">${x}</div>`;
  }
  const branchSel = (id, val, all) => `<select class="sel" id="${id}"><option value="">${all || "All branches"}</option>${branches().map(b => `<option value="${h(b.id)}" ${val === b.id ? "selected" : ""}>${h(b.name)}</option>`).join("")}</select>`;
  const deptSel = (id, val) => `<select class="sel" id="${id}"><option value="">All departments</option>${depts().map(d => `<option ${val === d ? "selected" : ""}>${h(d)}</option>`).join("")}</select>`;
  const noBranches = () => !branches().length ? `<div class="warnbox row" style="margin-bottom:14px"><span><b>No branch zones yet.</b> Phone check-ins need at least one branch with a location and radius.</span><span class="spacer"></span>${canEdit() ? `<button class="btn sm pri" data-a="brEdit">Add a branch</button>` : ""}</div>` : "";

  /* ---------- view: attendance today ---------- */
  function vAtt() {
    U.attDay = U.attDay || todayL(); const day = U.attDay; if (isSupa()) loadMonth(ym(day));
    const c = ctx(), emps = filterEmps(staff()), b = A.board(emps, S.att.punches, c, day), k = b.counts;
    const nowRel = A.relMin(nowISO(), day, cfg()), isToday = day === todayL();
    const F = U.attF || "";
    const match = r => !F || (F === "present" && ["PRESENT", "LATE", "IN", "INCOMPLETE", "HALF_DAY"].includes(r.status)) || (F === "late" && r.lateMin > 0)
      || (F === "notin" && (r.status === "NOT_IN" || r.status === "NOT_YET")) || (F === "absent" && r.status === "ABSENT") || (F === "leave" && r.status === "LEAVE")
      || (F === "review" && r.flags.includes("REVIEW")) || (F === "early" && r.earlyMin > 0) || (F === "incomplete" && r.status === "INCOMPLETE");
    const order = { NOT_IN: 0, ABSENT: 1, INCOMPLETE: 2, LATE: 3, IN: 4, HALF_DAY: 5, PRESENT: 6, NOT_YET: 7, LEAVE: 8, HOLIDAY: 9, WEEKEND: 10 };
    const rows = b.rows.filter(match).sort((x, y) => (order[x.status] ?? 11) - (order[y.status] ?? 11) || nm(x.emp || MQ.empBy(x.empNo)).localeCompare(nm(y.emp || MQ.empBy(y.empNo))));
    let lo = 1440, hi = 0; b.rows.forEach(r => { if (r.shift.workday) { lo = Math.min(lo, r.shift.start - 60); hi = Math.max(hi, r.shift.end + 60); } r.punches.forEach(p => { lo = Math.min(lo, p.rel - 30); hi = Math.max(hi, p.rel + 30); }); });
    if (lo >= hi) { lo = 360; hi = 1260; } lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
    const ticks = []; const step = (hi - lo) > 960 ? 240 : 180; for (let t = lo; t <= hi; t += step) ticks.push(t);
    const kpi = (f, cls, v, l, tag) => `<button class="kpi ${cls}${F === f ? " sel" : ""}" data-a="attf" data-v="${f}"><span class="tag"><i></i>${tag}</span><span class="v">${v}</span><span class="l">${l}</span></button>`;
    const expected = k.total - k.leave - k.off;
    return `${noBranches()}<div class="att-bar">
      <div class="datepick"><button class="btn sm" data-a="attDayStep" data-v="-1" aria-label="Previous day">‹</button><input type="date" id="attDay" value="${h(day)}" max="${h(todayL())}"><button class="btn sm" data-a="attDayStep" data-v="1" aria-label="Next day" ${isToday ? "disabled" : ""}>›</button>${isToday ? "" : `<button class="btn sm" data-a="attToday">Today</button>`}</div>
      ${branchSel("attBr", U.attBr)}${deptSel("attDept", U.attDept)}
      <input class="search" id="attQ" placeholder="Search employee…" value="${h(U.attQ || "")}">
      <span class="spacer"></span>${canEdit() ? `<button class="btn" data-a="manual">Add punch</button>` : ""}<button class="btn" data-nav="attmap">Locations map</button></div>
    <div class="panel" style="margin-bottom:16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      <div style="font-family:var(--f-display);font-size:44px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums">${expected > 0 ? Math.round(k.present / expected * 100) : 0}<small style="font-size:20px">%</small></div>
      <div style="flex:1;min-width:220px"><b>${k.present} of ${expected} expected staff ${isToday ? "are in" : "attended"}</b><div class="sub">${new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} · <bdi dir="rtl" class="ar">${h(MQ.hj(day))} هـ</bdi>${k.off ? ` · ${k.off} on a day off` : ""}${isToday ? ` · updated ${tLocal(nowISO())}` : ""}</div></div>
      ${F ? `<button class="btn sm" data-a="attf" data-v="">Show everyone</button>` : ""}</div>
    <div class="kpis">
      ${kpi("present", "green", k.present, isToday ? `${k.inNow} working now` : "Present", "Present")}
      ${kpi("late", "amber", k.late, "Checked in after grace", "Late")}
      ${kpi("notin", "red", isToday ? k.notIn : k.absent, isToday ? `Shift started, no check-in${k.notYet ? ` · ${k.notYet} not started` : ""}` : "No punches", isToday ? "Not in" : "Absent")}
      ${isToday ? kpi("absent", "red", k.absent, "Shift ended, no punches", "Absent") : ""}
      ${kpi("leave", "blue", k.leave, "Approved leave", "On leave")}
      ${kpi("review", "red", k.review, "Outside zone or weak GPS", "Review")}
      ${kpi("early", "amber", k.early, "Left before shift end", "Early")}
    </div>
    <div class="panel" style="padding:0;overflow:hidden">
      <div class="att-row hd"><span>Employee</span><span class="c-tl"><div class="tl-scale">${ticks.map(t => `<span>${A.fmtMin(t)}</span>`).join("")}</div></span><span class="c-in n">In</span><span class="c-out n">Out</span><span class="c-wk n">Worked</span><span>Status</span></div>
      <div class="att-list">${rows.map(r => { const e = MQ.empBy(r.empNo) || { empNo: r.empNo }; const br = branchBy(empBranch(e));
        return `<button class="att-row" data-a="day" data-emp="${h(r.empNo)}" data-d="${h(day)}">${who(e, [e.empNo, br ? br.name : e.department, r.shift.name].filter(Boolean).join(" · "))}
          <span class="c-tl">${timeline(r, lo, hi, nowRel)}</span><span class="c-in n">${fmtM(r.firstIn)}</span><span class="c-out n">${fmtM(r.lastOut)}</span><span class="c-wk n">${durS(r.workedMin)}</span>
          <span style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">${statusPill(r)}${flagsHtml(r)}</span></button>`; }).join("")}</div>
      ${rows.length ? "" : `<div class="empty"><b>${emps.length ? "No one matches this filter" : "No active employees"}</b>${emps.length ? "Choose another card above or show everyone." : "Add employees first; each one gets a shift and a branch."}</div>`}
    </div>
    <div class="ts-legend"><span><i style="background:repeating-linear-gradient(135deg,transparent 0 5px,rgba(90,106,100,.25) 5px 7px);border:1px dashed var(--muted)"></i>Shift hours</span><span><i style="background:var(--accent)"></i>Worked</span><span><i style="background:var(--ink);width:3px"></i>Punch</span><span><i style="background:var(--sadu);width:3px"></i>Punch outside the zone</span><span><i style="background:var(--saffron);width:3px"></i>Now</span></div>`;
  }

  /* ---------- view: locations live ---------- */
  function vMap() {
    const day = U.attDay || todayL(); if (isSupa()) loadMonth(ym(day));
    const emps = staff(), c = ctx(), bd = A.board(emps, S.att.punches, c, day);
    const byB = {}; bd.rows.forEach(r => { const e = MQ.empBy(r.empNo); const id = empBranch(e) || "_"; (byB[id] = byB[id] || []).push(r); });
    const dayP = S.att.punches.filter(p => dLocal(p.at) === day && p.lat != null && p.status !== "rejected");
    const fb = U.mapFocus ? branchBy(U.mapFocus) : null;
    const spec = { labels: true, focus: fb ? { lat: +fb.lat, lng: +fb.lng, z: (+fb.radius_m || 150) > 400 ? 15 : 17 } : null, branches: branches().map(b => { const rs = byB[b.id] || []; const pr = rs.filter(r => ["PRESENT", "LATE", "IN", "INCOMPLETE", "HALF_DAY"].includes(r.status)).length; return { lat: +b.lat, lng: +b.lng, r: +b.radius_m || 150, name: b.name, label: `${pr}/${rs.filter(r => r.shift.workday && r.status !== "LEAVE" && r.status !== "HOLIDAY").length} in` }; }),
      points: dayP.map(p => { const e = MQ.empBy(p.empNo); const b = branchBy(p.branchId); return { lat: +p.lat, lng: +p.lng, s: p.status, t: `${nm(e)} · ${p.kind === "in" ? "check-in" : p.kind === "out" ? "check-out" : p.kind.replace("_", " ")} ${tLocal(p.at)}\n${p.distance != null ? Math.round(p.distance) + " m from " + (b ? b.name : "branch") : ""} · ±${Math.round(p.accuracy || 0)} m` }; }) };
    const outside = dayP.filter(p => p.status === "outside" || p.status === "low_accuracy");
    return `${noBranches()}<div class="att-bar"><div class="datepick"><input type="date" id="attDay" value="${h(day)}" max="${h(todayL())}"></div><div class="seg" role="group" aria-label="Zoom to branch"><button data-a="mapFocus" data-v="" aria-pressed="${!fb}">All branches</button>${branches().map(b => `<button data-a="mapFocus" data-v="${h(b.id)}" aria-pressed="${fb && fb.id === b.id}">${h(b.name)}</button>`).join("")}</div><span class="sub">Green circles are branch check-in zones. Dots are punches: green inside the zone, red outside, gold weak GPS.</span><span class="spacer"></span>${canEdit() ? `<button class="btn" data-a="brEdit">Add branch</button>` : ""}</div>
    <div class="panel" style="padding:0;overflow:hidden;margin-bottom:16px"><div data-lmap='${h(JSON.stringify(spec))}' data-key="live" style="height:min(62vh,560px)"></div></div>
    <div class="grid3">${branches().map(b => { const rs = byB[b.id] || []; const k = { in: 0, late: 0, miss: 0, out: 0 };
      rs.forEach(r => { if (["PRESENT", "LATE", "IN", "INCOMPLETE", "HALF_DAY"].includes(r.status)) k.in++; if (r.lateMin > 0) k.late++; if (r.status === "NOT_IN" || r.status === "ABSENT") k.miss++; if (r.flags.includes("REVIEW")) k.out++; });
      return `<div class="panel"><h2>${h(b.name)}<span class="spacer"></span><span class="pill ${b.active === false ? "p-grey" : "p-green"}">${b.active === false ? "Inactive" : (b.radius_m || 150) + " m zone"}</span></h2>
        <div class="me-stats"><div><b>${k.in}</b><span>In</span></div><div><b>${k.late}</b><span>Late</span></div><div><b>${k.miss}</b><span>Missing</span></div><div><b style="color:${k.out ? "var(--red)" : "inherit"}">${k.out}</b><span>Outside</span></div></div>
        <div class="row" style="margin-top:12px"><span class="sub">${rs.length} staff assigned</span><span class="spacer"></span><button class="btn sm" data-a="attGoBranch" data-v="${h(b.id)}">See staff</button>${canEdit() ? `<button class="btn sm" data-a="brEdit" data-v="${h(b.id)}">Edit zone</button>` : ""}</div></div>`; }).join("")}
      ${byB._ && byB._.length ? `<div class="panel"><h2>No branch assigned<span class="spacer"></span><span class="pill p-amber">${byB._.length}</span></h2><div class="sub">These employees can check in at any branch zone. Assign each one in Shifts &amp; Branches.</div><div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn sm" data-nav="attsetup">Assign</button></div></div>` : ""}</div>
    ${outside.length ? `<div class="panel" style="padding:0;margin-top:16px"><div style="padding:16px 18px 6px"><h2>Punches outside a zone today <small>خارج النطاق</small></h2></div>${punchTable(outside, true)}</div>` : ""}`;
  }
  function punchTable(list, withWho) {
    return `<div class="tbl-wrap" style="border:0;border-radius:0"><table><thead><tr>${withWho ? "<th>Employee</th>" : ""}<th>Time</th><th>Type</th><th>Result</th><th class="n">Distance</th><th class="n">GPS ±</th><th>Branch</th><th></th></tr></thead><tbody>
      ${list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map(p => { const e = MQ.empBy(p.empNo) || { empNo: p.empNo }; const b = branchBy(p.branchId);
        const res = { ok: ["p-green", "Inside zone"], outside: ["p-red", "Outside zone"], low_accuracy: ["p-amber", "Weak GPS"], manual: ["p-blue", "Entered by HR"], approved: ["p-green", "Approved"], rejected: ["p-grey", "Rejected"] }[p.status] || ["p-grey", p.status];
        const pend = p.status === "outside" || p.status === "low_accuracy";
        return `<tr>${withWho ? `<td>${who(e)}</td>` : ""}<td class="mono">${fd(dLocal(p.at))} ${tLocal(p.at)}</td><td>${h({ in: "Check-in", out: "Check-out", break_start: "Break start", break_end: "Break end" }[p.kind] || p.kind)}</td>
          <td><span class="pill ${res[0]}">${h(res[1])}</span>${(p.flags || []).includes("IMPOSSIBLE_TRAVEL") ? ` <span class="flag r">Location jump</span>` : ""}${p.note ? `<div class="sub" style="white-space:normal;max-width:260px">${h(p.note)}</div>` : ""}</td>
          <td class="n">${p.distance != null ? Math.round(p.distance).toLocaleString("en-US") + " m" : "—"}</td><td class="n">${p.accuracy != null ? Math.round(p.accuracy) + " m" : "—"}</td><td>${h(b ? b.name : "—")}</td>
          <td>${p.lat != null ? `<a class="btn sm" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}">Map</a> ` : ""}${pend && canEdit() ? `<button class="btn sm pri" data-a="rev" data-v="approved" data-id="${h(p.id)}">Accept</button> <button class="btn sm" data-a="rev" data-v="rejected" data-id="${h(p.id)}">Reject</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>`;
  }

  /* ---------- day detail ---------- */
  function openDay(empNo, day) {
    const e = MQ.empBy(empNo) || (S.me && S.me.empNo === empNo ? meEmp() : { empNo }); const r = A.day(e, day, S.att.punches.filter(p => p.empNo === empNo), ctx());
    const all = S.att.punches.filter(p => p.empNo === empNo && dLocal(p.at) === day).concat(r.punches.filter(p => dLocal(p.at) !== day));
    const uniq = [...new Map(all.map(p => [p.id, p])).values()];
    const br = branchBy(empBranch(e)); const pts = uniq.filter(p => p.lat != null);
    const spec = { branches: (br ? [br] : branches()).map(b => ({ lat: +b.lat, lng: +b.lng, r: +b.radius_m || 150, name: b.name })), points: pts.map(p => ({ lat: +p.lat, lng: +p.lng, s: p.status, t: `${p.kind} ${tLocal(p.at)}` })) };
    openModal(`${nm(e)} · ${fd(day)}`, `<div class="row">${statusPill(r)}${flagsHtml(r)}<span class="sub">${h(r.shift.name)}${r.shift.ramadan ? " · Ramadan hours" : ""}</span></div>
      <div class="calc"><div><span>Shift</span><b>${r.shift.workday ? fmtM(r.shift.start) + "–" + fmtM(r.shift.end) : "Day off"}</b></div><div><span>First in</span><b>${fmtM(r.firstIn)}</b></div><div><span>Last out</span><b>${fmtM(r.lastOut)}</b></div>
        <div><span>Worked</span><b>${durS(r.workedMin)}</b></div><div><span>Late</span><b>${durS(r.lateMin)}</b></div><div><span>Left early</span><b>${durS(r.earlyMin)}</b></div><div><span>Overtime</span><b>${durS(r.otMin)}</b></div><div><span>Absence charged</span><b>${r.absence ? r.absence + " day" : "—"}</b></div></div>
      ${pts.length ? `<div class="mapbox" data-lmap='${h(JSON.stringify(spec))}'></div>` : ""}
      ${uniq.length ? `<div class="tbl-wrap">${punchTable(uniq, false)}</div>` : `<div class="empty"><b>No punches this day</b>${canEdit() ? "Add one if the employee was at work." : ""}</div>`}`,
      [canEdit() ? { label: "Add punch", fn: () => { closeModal(); openManual(empNo, day); } } : null, { label: "Close", fn: closeModal }].filter(Boolean));
    setTimeout(mountMaps, 30);
  }
  function openManual(empNo, day, kind, time) {
    const emps = staff();
    openModal("Add a punch · إضافة بصمة", `<div class="fgrid">
      <div class="field"><label for="mp_e">Employee</label><select id="mp_e"><option value="">Select…</option>${emps.map(e => `<option value="${h(e.empNo)}" ${e.empNo === empNo ? "selected" : ""}>${h(e.empNo)} — ${h(nm(e))}</option>`).join("")}</select></div>
      <div class="field"><label for="mp_d">Date</label><input id="mp_d" type="date" value="${h(day || todayL())}" max="${h(todayL())}"></div>
      <div class="field"><label for="mp_t">Time (KSA)</label><input id="mp_t" type="time" value="${h(time || "08:00")}"></div>
      <div class="field"><label for="mp_k">Type</label><select id="mp_k">${[["in", "Check-in"], ["out", "Check-out"], ["break_start", "Break start"], ["break_end", "Break end"]].map(([v, l]) => `<option value="${v}" ${kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field" style="grid-column:1/-1"><label for="mp_n">Reason (kept in the audit trail)</label><input id="mp_n" placeholder="e.g. Device was down at the gate"></div></div>`,
      [{ label: "Cancel", fn: closeModal }, { label: "Save punch", cls: "pri", fn: async () => {
        const e = $("#mp_e").value, d = $("#mp_d").value, t = $("#mp_t").value, k = $("#mp_k").value, n = $("#mp_n").value.trim();
        if (!e || !d || !t) { toast("Choose the employee, date and time."); return; } if (n.length < 3) { toast("Write a short reason."); return; }
        try { await manualPunch(e, A.atFor(d, A.hm(t), cfg()), k, n); closeModal(); toast("Punch saved"); MQ.render(); } catch (x) { toast("Not saved: " + errMsg(x)); } } }]);
  }

  /* ---------- view: timesheet ---------- */
  function monthCalc() { U.attM = U.attM || ym(todayL()); if (isSupa()) loadMonth(U.attM); return A.month(filterEmps(staff()), S.att.punches, ctx(), U.attM + "-01"); }
  function vSheet() {
    const m = monthCalc(), T = m.totals; const run = (S.payruns || []).find(r => r.id === U.attM);
    const cls = x => x.status === "HALF_DAY" ? "c-half" : x.status === "NOT_IN" ? "c-q" : x.code ? "c-" + x.code : "";
    const totOT = m.rows.reduce((a, r) => a + r.totals.otMin, 0);
    const tip = (x, e) => `${nm(e)} · ${new Date(x.date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}\n${statusPill(x).replace(/<[^>]+>/g, "")}${x.firstIn != null ? `\n${fmtM(x.firstIn)} – ${fmtM(x.lastOut)} · ${durS(x.workedMin)}` : ""}${x.otMin ? "\nOvertime " + durS(x.otMin) : ""}`;
    return `${noBranches()}<div class="att-bar"><input type="month" id="attM" value="${h(U.attM)}" max="${h(ym(todayL()))}">${branchSel("attBr", U.attBr)}${deptSel("attDept", U.attDept)}<input class="search" id="attQ" placeholder="Search employee…" value="${h(U.attQ || "")}">
      <span class="spacer"></span><button class="btn" data-a="sheetXlsx">Export Excel</button>${canEdit() ? `<button class="btn pri" data-a="toPayroll" ${run && run.status === "LOCKED" ? "disabled title=\"Payroll is locked\"" : ""}>Send to payroll</button>` : ""}</div>
    <div class="kpis"><div class="kpi green"><span class="tag"><i></i>Attendance</span><span class="v">${T.attendanceRate}%</span><span class="l">Of scheduled workdays so far</span></div>
      <div class="kpi red"><span class="tag"><i></i>Absence</span><span class="v">${+T.absent.toFixed(1)}</span><span class="l">Days to deduct in payroll</span></div>
      <div class="kpi amber"><span class="tag"><i></i>Lateness</span><span class="v">${T.late}</span><span class="l">Late days · ${durS(T.lateMin)} in total</span></div>
      <div class="kpi blue"><span class="tag"><i></i>Overtime</span><span class="v">${+(totOT / 60).toFixed(1)}</span><span class="l">Hours (Art. 107: +50% of basic)</span></div>
      <div class="kpi amber"><span class="tag"><i></i>Missing</span><span class="v">${T.incomplete}</span><span class="l">Days without check-out</span></div></div>
    ${run && run.attendanceSyncedAt ? `<div class="okbox" style="margin-bottom:12px">Sent to ${h(U.attM)} payroll on ${h(fd(run.attendanceSyncedAt.slice(0, 10)))}${run.status === "LOCKED" ? " · payroll is now locked" : ". Send again after corrections."}</div>` : ""}
    <div class="ts-wrap"><table class="ts"><thead><tr><th class="emp">Employee</th>${m.days.map(d => { const wd = A.weekday(d); const off = cfg().weekend.includes(wd); return `<th class="${off ? "we" : ""}" title="${h(d)}">${+d.slice(8)}<div style="font-weight:400;font-size:10px">${"SMTWTFS"[wd]}</div></th>`; }).join("")}<th>Present</th><th>Absent</th><th>Late</th><th>OT</th></tr></thead><tbody>
      ${m.rows.map(r => `<tr><td class="emp">${who(r.emp, r.emp.empNo)}</td>${r.days.map(x => `<td class="c ${cls(x)}" data-a="day" data-emp="${h(r.empNo)}" data-d="${h(x.date)}" data-tip="${h(tip(x, r.emp))}">${h(x.code || (x.status === "NOT_IN" ? "?" : ""))}</td>`).join("")}
        <td class="tot">${r.totals.present}</td><td class="tot" style="color:${r.totals.absent ? "var(--red)" : "inherit"}">${r.totals.absent || ""}</td><td class="tot">${r.totals.lateMin ? durS(r.totals.lateMin) : ""}</td><td class="tot">${r.totals.otMin ? +(r.totals.otMin / 60).toFixed(1) + "h" : ""}</td></tr>`).join("")}
    </tbody></table>${m.rows.length ? "" : `<div class="empty"><b>No employees in this filter</b></div>`}</div>
    <div class="ts-legend">${[["c-P", "P", "Present"], ["c-L", "L", "Late"], ["c-half", "½", "Half day"], ["c-A", "A", "Absent"], ["c-I", "I", "No check-out"], ["c-V", "V", "Leave"], ["c-H", "H", "Holiday"], ["c-W", "W", "Day off"]].map(([c, t, l]) => `<span><i class="${c}">${t}</i>${l}</span>`).join("")}<span>Click any day to see punches and fix them.</span></div>`;
  }
  async function toPayroll() {
    const m = monthCalc(), inp = A.payrollInputs(m, cfgRaw()); const id = U.attM; const cur = (S.payruns || []).find(r => r.id === id) || {};
    if (cur.status === "LOCKED") { toast("This payroll month is locked. Unlock it in Payroll first."); return; }
    const n = Object.values(inp).filter(x => x.absenceDays || x.otHours).length; const abs = Object.values(inp).reduce((a, x) => a + x.absenceDays, 0), ot = Object.values(inp).reduce((a, x) => a + x.otHours, 0);
    confirmBox(`Send ${id} attendance to payroll? ${n} employees get ${+abs.toFixed(2)} absence days and ${+ot.toFixed(2)} overtime hours in total. Bonus and other deductions already typed in payroll are kept.`, async () => {
      const inputs = JSON.parse(JSON.stringify(cur.inputs || {}));
      Object.keys(inp).forEach(no => { inputs[no] = Object.assign({}, inputs[no] || {}, { absenceDays: inp[no].absenceDays, otHours: inp[no].otHours }); });
      const o = Object.assign({}, cur, { id, inputs, status: cur.status || "DRAFT", attendanceSyncedAt: nowISO() }); delete o._id;
      await put("payruns", id, o); closeModal(); toast("Attendance sent to payroll"); });
  }
  function sheetXlsx() {
    if (!window.XLSX) { toast("The Excel library did not load."); return; }
    const m = monthCalc(), X = window.XLSX, wb = X.utils.book_new();
    const grid = [["Emp No", "Name", "Department", ...m.days.map(d => +d.slice(8)), "Present", "Absent days", "Late days", "Late minutes", "Overtime hours", "No check-out"]];
    m.rows.forEach(r => grid.push([r.empNo, nm(r.emp), r.emp.department || "", ...r.days.map(x => x.code || ""), r.totals.present, r.totals.absent, r.totals.late, r.totals.lateMin, +(r.totals.otMin / 60).toFixed(2), r.totals.incomplete]));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(grid), "Timesheet");
    const det = [["Date", "Emp No", "Name", "Status", "Shift", "First in", "Last out", "Worked hours", "Late min", "Early min", "Overtime min", "Absence", "Flags"]];
    m.rows.forEach(r => r.days.forEach(x => { if (["NA", "UPCOMING"].includes(x.status)) return; det.push([x.date, r.empNo, nm(r.emp), x.status, x.shift.name, x.firstIn == null ? "" : fmtM(x.firstIn), x.lastOut == null ? "" : fmtM(x.lastOut), +(x.workedMin / 60).toFixed(2), x.lateMin, x.earlyMin, x.otMin, x.absence, x.flags.join(" ")]); }));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(det), "Daily detail");
    const pun = [["Date", "Time", "Emp No", "Name", "Type", "Result", "Branch", "Distance m", "GPS accuracy m", "Latitude", "Longitude", "Note"]];
    S.att.punches.filter(p => ym(dLocal(p.at)) === U.attM).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach(p => { const e = MQ.empBy(p.empNo); const b = branchBy(p.branchId); pun.push([dLocal(p.at), tLocal(p.at), p.empNo, nm(e), p.kind, p.status, b ? b.name : "", p.distance == null ? "" : Math.round(p.distance), p.accuracy == null ? "" : Math.round(p.accuracy), p.lat == null ? "" : p.lat, p.lng == null ? "" : p.lng, p.note || ""]); });
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(pun), "Punches & locations");
    MQ.saveFile(`Attendance-${U.attM}.xlsx`, new Blob([X.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  /* ---------- view: exceptions ---------- */
  function pendingPunches() { const since = Date.now() - 45 * 86400000; return S.att.punches.filter(p => (p.status === "outside" || p.status === "low_accuracy") && Date.parse(p.at) >= since); }
  function badge() { return pendingPunches().length + S.att.requests.filter(r => r.status === "pending").length; }
  function vReview() {
    const reqs = S.att.requests.filter(r => r.status === "pending").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const pp = pendingPunches();
    const t = todayL(), from = A.addDays(t, -30); const inc = [];
    const months = [...new Set([ym(from), ym(t)])]; months.forEach(mm => { if (isSupa()) loadMonth(mm); A.month(staff(), S.att.punches, ctx(), mm + "-01").rows.forEach(r => r.days.forEach(x => { if (x.status === "INCOMPLETE" && x.date >= from) inc.push({ r, x }); })); });
    return `<div class="att-bar"><div class="sub prose">Punches outside a branch zone or with weak GPS still count until you reject them. Accepting keeps them; rejecting removes them from the timesheet and payroll.</div><span class="spacer"></span>${canEdit() ? `<button class="btn" data-a="importDev">Import device / Excel file</button><button class="btn" data-a="manual">Add punch</button>` : ""}</div>
    <div class="panel" style="padding:0;margin-bottom:16px"><div style="padding:16px 18px 6px"><h2>Correction requests <small>طلبات التصحيح</small><span class="spacer"></span><span class="pill ${reqs.length ? "p-amber" : "p-green"}">${reqs.length} waiting</span></h2></div>
      ${reqs.length ? `<div class="tbl-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Employee</th><th>Day</th><th>Missing punch</th><th>Reason</th><th></th></tr></thead><tbody>${reqs.map(r => { const e = MQ.empBy(r.empNo) || { empNo: r.empNo };
        return `<tr><td>${who(e)}</td><td>${fd(r.day)}</td><td>${h({ in: "Check-in", out: "Check-out", break_start: "Break start", break_end: "Break end" }[r.kind])} at <b>${h(r.time)}</b></td><td style="white-space:normal;max-width:340px">${h(r.reason)}</td>
        <td>${canEdit() ? `<button class="btn sm pri" data-a="req" data-v="approved" data-id="${h(r.id)}">Approve</button> <button class="btn sm" data-a="req" data-v="rejected" data-id="${h(r.id)}">Reject</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty"><b>No requests waiting</b>Employees ask for corrections from their check-in screen.</div>`}</div>
    <div class="panel" style="padding:0;margin-bottom:16px"><div style="padding:16px 18px 6px"><h2>Location exceptions · last 45 days <small>خارج النطاق</small><span class="spacer"></span>${pp.length && canEdit() ? `<button class="btn sm" data-a="revNear">Accept all within 2× zone</button>` : ""}</h2></div>
      ${pp.length ? punchTable(pp, true) : `<div class="empty"><b>Every punch was inside a zone</b>Nothing to review.</div>`}</div>
    <div class="panel" style="padding:0"><div style="padding:16px 18px 6px"><h2>Missing check-outs · last 30 days <small>بدون انصراف</small><span class="spacer"></span><span class="pill ${inc.length ? "p-amber" : "p-green"}">${inc.length}</span></h2></div>
      ${inc.length ? `<div class="tbl-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Employee</th><th>Day</th><th>Checked in</th><th>Shift end</th><th></th></tr></thead><tbody>${inc.sort((a, b) => b.x.date.localeCompare(a.x.date)).map(({ r, x }) => `<tr><td>${who(r.emp)}</td><td>${fd(x.date)}</td><td>${fmtM(x.firstIn)}</td><td>${fmtM(x.shift.end)}</td><td>${canEdit() ? `<button class="btn sm" data-a="addOut" data-emp="${h(r.empNo)}" data-d="${h(x.date)}" data-v="${h(fmtM(x.shift.end))}">Add check-out</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>No missing check-outs</b></div>`}</div>
    ${lawPanel()}`;
  }
  function lawPanel() {
    const W = S.att.law; const lvl = { dismissal: ["p-red", "Art. 80 dismissal threshold passed"], warning: ["p-amber", "Written warning due"], watch: ["p-blue", "Watch"], ok: ["p-green", "OK"] };
    const rows = W ? W.rows.filter(r => r.level !== "ok" || r.otOverCap || r.noBreakDays || r.over12Days).sort((a, b) => ["dismissal", "warning", "watch", "ok"].indexOf(a.level) - ["dismissal", "warning", "watch", "ok"].indexOf(b.level) || b.absentDays - a.absentDays) : [];
    return `<div class="panel" style="padding:0;margin-top:16px"><div style="padding:16px 18px 6px"><h2>Labour-law watch · last 12 months <small>متابعة نظام العمل</small><span class="spacer"></span><button class="btn sm ${W ? "" : "pri"}" data-a="lawRun">${W ? "Recalculate" : "Check now"}</button></h2>
      <div class="sub prose">Art. 80: a written warning is required after 20 days of unexcused absence in a year (or 10 in a row); dismissal without notice is possible only above 30 days (or 15 in a row). Art. 101: at most 5 hours in a row without a 30-minute break and 12 hours at the workplace a day. Overtime is capped at 720 hours a year unless the employee agrees (HRSD). Approved leave, weekends and holidays never count as absence.${W ? ` Checked ${h(fd(W.from))} – ${h(fd(W.to))}.` : ""}</div></div>
      ${!W ? "" : rows.length ? `<div class="tbl-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Employee</th><th class="n">Absent days</th><th class="n">Longest run</th><th>Art. 80</th><th class="n">Overtime h</th><th class="n">No-break days</th><th class="n">Over 12h days</th></tr></thead><tbody>${rows.map(r => `<tr><td>${who(r.emp)}</td><td class="n">${r.absentDays}</td><td class="n">${r.longestRun}</td><td><span class="pill ${lvl[r.level][0]}">${h(lvl[r.level][1])}</span></td><td class="n" style="color:${r.otOverCap ? "var(--red)" : "inherit"}">${r.otHours}${r.otOverCap ? " · over 720" : ""}</td><td class="n">${r.noBreakDays || ""}</td><td class="n">${r.over12Days || ""}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty"><b>No one is near a legal threshold</b>Absence, breaks, long days and overtime are within the limits.</div>`}</div>`;
  }
  async function lawRun() {
    const t = todayL(), from = [A.addDays(t, -364), cfgRaw().trackingFrom].sort().pop();
    if (isSupa()) { toast("Loading 12 months of punches…"); const ms = []; for (let d = from.slice(0, 7) + "-01"; ym(d) <= ym(t); d = A.addDays(A.addDays(d, 32).slice(0, 7) + "-01", 0)) ms.push(ym(d)); for (const mm of ms) await loadMonth(mm); }
    S.att.law = { from, to: t, rows: A.lawWatch(staff(), S.att.punches, ctx(), from, t) }; MQ.renderNow();
  }
  function openImport() {
    openModal("Import punches from a device or Excel · استيراد البصمات", `<div class="sub prose">Export the attendance log from your fingerprint / face device (ZKTeco and most others) or any Excel sheet. Needed columns: an employee code (Emp No, HR No or device user ID) and a date-time (or separate date and time columns). Times are read as KSA time. For each person and day the first punch is the check-in and the last is the check-out.</div>
      <div class="field"><label for="im_f">File (.xlsx, .xls or .csv)</label><input id="im_f" type="file" accept=".xlsx,.xls,.csv,.txt"></div><div id="im_p"></div>`,
      [{ label: "Cancel", fn: closeModal }, { label: "Import punches", cls: "pri", fn: async () => {
        const rows = S.att.importRows || []; if (!rows.length) { toast("Choose a file with punches first."); return; }
        let ok = 0, fail = 0;
        for (const p of rows) { try { await manualPunch(p.empNo, p.at, p.kind, "Imported from device file"); ok++; } catch (e) { fail++; } }
        S.att.importRows = null; closeModal(); toast(`${ok} punches imported${fail ? `, ${fail} skipped (already there or not allowed)` : ""}`); MQ.render(); } }]);
    $("#im_f").addEventListener("change", async ev => {
      const f = ev.target.files[0]; if (!f || !window.XLSX) return; const X = window.XLSX;
      const wb = X.read(await f.arrayBuffer(), { type: "array", cellDates: false }); const ws = wb.Sheets[wb.SheetNames[0]]; const data = X.utils.sheet_to_json(ws, { defval: "", raw: true });
      if (!data.length) { $("#im_p").innerHTML = `<div class="warnbox">The file has no rows.</div>`; return; }
      const keys = Object.keys(data[0]); const find = re => keys.find(k => re.test(String(k).trim()));
      const kEmp = find(/^(emp|employee).*(no|id|code|number)|^(ac-?no|user ?id|enroll|pin|badge|hr ?no|رقم)/i) || keys[0];
      const kDT = find(/date.?time|^time$|^checktime|^punch|^التاريخ والوقت/i), kD = find(/^date|التاريخ/i), kT = find(/^time|الوقت/i);
      const idx = {}; MQ.activeStaff().concat(S.employees || []).forEach(e => { [e.empNo, e.hrNo, e.hr && e.hr.deviceId].forEach(c => { if (c) idx[String(c).trim().toUpperCase()] = e.empNo; }); });
      const raw = [], miss = new Set();
      data.forEach(r => { const code = String(r[kEmp]).trim().toUpperCase(); const no = idx[code] || idx["EMP-" + code.padStart(4, "0")]; if (!no) { if (code) miss.add(code); return; }
        let at = null; if (kDT && kDT !== kD) at = A.parseLocal(r[kDT]); else if (kD && kT) { const dv = r[kD], tv = r[kT]; const ds = typeof dv === "number" ? new Date(Math.round((dv - 25569) * 86400000)).toISOString().slice(0, 10) : String(dv).trim(); const ts = typeof tv === "number" ? A.fmtMin(Math.round(tv * 1440)) : String(tv).trim(); at = A.parseLocal(ds + " " + ts) || A.parseLocal(ds.split(/[\/.-]/).length === 3 && /^\d{1,2}[\/.-]/.test(ds) ? ds + " " + ts : ""); }
        if (at) raw.push({ empNo: no, at }); });
      const rows = A.fromDeviceRows(raw, cfg()); S.att.importRows = rows;
      $("#im_p").innerHTML = rows.length ? `<div class="okbox">${raw.length} raw scans → <b>${rows.length} punches</b> for ${new Set(rows.map(r => r.empNo)).size} employees. Columns used: employee “${h(kEmp)}”, time “${h(kDT || (kD + " + " + kT))}”.</div>${miss.size ? `<div class="warnbox" style="margin-top:8px">${miss.size} codes did not match any employee (e.g. ${h([...miss].slice(0, 6).join(", "))}). Add the device user ID to each employee in Shifts &amp; Branches.</div>` : ""}`
        : `<div class="warnbox">No punches could be read. Check that the file has an employee code column and a date-time column.</div>`;
    });
  }

  /* ---------- view: shifts, branches, holidays, rules, assignments ---------- */
  function vSetup() {
    const c = cfg(), sh = c.shifts, emps = staff(); const year = +todayL().slice(0, 4); const hol = (c.holidays || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const useCnt = id => emps.filter(e => ((e.hr && e.hr.shiftId) || c.defaultShiftId) === id).length;
    const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; const ro = !canEdit();
    const spec = { labels: true, branches: branches().map(b => ({ lat: +b.lat, lng: +b.lng, r: +b.radius_m || 150, name: b.name })) };
    return `<div class="grid2">
      <div class="panel" style="padding:0"><div style="padding:16px 18px 6px"><h2>Branch check-in zones <small>نطاقات الفروع</small><span class="spacer"></span>${ro ? "" : `<button class="btn sm pri" data-a="brEdit">Add branch</button>`}</h2></div>
        ${branches().length ? `<div data-lmap='${h(JSON.stringify(spec))}' data-key="setup" style="height:240px"></div>` : ""}
        <div class="tbl-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Branch</th><th class="n">Zone</th><th class="n">Staff</th><th>Location</th><th></th></tr></thead><tbody>${branches().map(b => `<tr><td><b>${h(b.name)}</b><div class="sub">${h(b.id)}${b.active === false ? " · inactive" : ""}</div></td><td class="n">${h(b.radius_m || 150)} m</td><td class="n">${emps.filter(e => empBranch(e) === b.id).length}</td><td class="mono" style="font-size:12px">${(+b.lat).toFixed(5)}, ${(+b.lng).toFixed(5)}</td><td>${ro ? "" : `<button class="btn sm" data-a="brEdit" data-v="${h(b.id)}">Edit</button>`}</td></tr>`).join("")}</tbody></table>${branches().length ? "" : `<div class="empty"><b>No branches yet</b>Add each branch with its location and a check-in radius (150 m suits most offices; use more for warehouses and yards).</div>`}</div></div>
      <div class="panel"><h2>Location rules <small>قواعد الموقع</small></h2><div class="fgrid">
        <div class="field"><label for="r_geo">Where can an employee check in?</label><select id="r_geo" ${ro ? "disabled" : ""}><option value="any" ${c.geoMode !== "assigned" ? "selected" : ""}>At any branch zone</option><option value="assigned" ${c.geoMode === "assigned" ? "selected" : ""}>Only at their assigned branch</option></select></div>
        <div class="field"><label for="r_blk">Outside the zone</label><select id="r_blk" ${ro ? "disabled" : ""}><option value="0" ${!c.blockOutside ? "selected" : ""}>Record it and send to HR review</option><option value="1" ${c.blockOutside ? "selected" : ""}>Refuse the check-in</option></select></div>
        <div class="field"><label for="r_acc">Weakest GPS accepted (m)</label><input id="r_acc" type="number" min="10" max="1000" value="${h(c.maxAccuracyM)}" ${ro ? "disabled" : ""}></div>
        <div class="field"><label for="r_out">Outside-zone punches in the timesheet</label><select id="r_out" ${ro ? "disabled" : ""}><option value="1" ${c.countOutside ? "selected" : ""}>Count until HR rejects</option><option value="0" ${!c.countOutside ? "selected" : ""}>Count only after HR accepts</option></select></div>
      </div><div class="sub" style="margin-top:10px">The server measures the distance again on every punch, so a changed phone clock or app cannot move it. Punches more than 5 km from the previous one at an impossible speed are flagged as a location jump.</div>
      <h2 style="margin-top:18px">Time rules <small>قواعد الوقت</small></h2><div class="fgrid">
        <div class="field"><label for="r_gr">Late after (grace, min)</label><input id="r_gr" type="number" min="0" max="120" value="${h(c.graceMin)}" ${ro ? "disabled" : ""}></div>
        <div class="field"><label for="r_eg">Early leave after (min)</label><input id="r_eg" type="number" min="0" max="120" value="${h(c.earlyGraceMin)}" ${ro ? "disabled" : ""}></div>
        <div class="field"><label for="r_ot">Overtime counts from (min)</label><input id="r_ot" type="number" min="0" max="240" value="${h(c.minOtMin)}" ${ro ? "disabled" : ""}></div>
        <div class="field"><label for="r_hd">Half day below (worked min)</label><input id="r_hd" type="number" min="0" max="600" value="${h(c.halfDayMin)}" ${ro ? "disabled" : ""}></div>
        <div class="field"><label for="r_inc">Day without check-out</label><select id="r_inc" ${ro ? "disabled" : ""}><option value="0" ${!+c.incompleteAbsence ? "selected" : ""}>No deduction (flag only)</option><option value="0.5" ${+c.incompleteAbsence === 0.5 ? "selected" : ""}>Half day absent</option><option value="1" ${+c.incompleteAbsence === 1 ? "selected" : ""}>Full day absent</option></select></div>
        <div class="field"><label for="r_dl">Late minutes in payroll</label><select id="r_dl" ${ro ? "disabled" : ""}><option value="0" ${!c.deductLate ? "selected" : ""}>Do not deduct</option><option value="1" ${c.deductLate ? "selected" : ""}>Deduct as part-days</option></select></div>
        <div class="field"><label for="r_tf">Attendance tracking starts on</label><input id="r_tf" type="date" value="${h(cfgRaw().trackingFrom)}" ${ro ? "disabled" : ""}></div>
        <div class="field"><label>Weekend</label><div class="row" style="gap:4px">${DN.map((d, i) => `<label class="chip" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" class="r_we" value="${i}" ${c.weekend.includes(i) ? "checked" : ""} ${ro ? "disabled" : ""}>${d}</label>`).join("")}</div></div>
      </div>${ro ? "" : `<div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn pri" data-a="saveRules">Save rules</button></div>`}</div></div>
    <div class="panel" style="padding:0;margin-bottom:16px"><div style="padding:16px 18px 6px"><h2>Shifts <small>الورديات</small><span class="spacer"></span>${ro ? "" : `<button class="btn sm pri" data-a="shEdit">Add shift</button>`}</h2></div>
      <div class="tbl-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Shift</th><th>Hours</th><th class="n">Break</th><th class="n">Grace</th><th>Workdays</th><th class="n">Staff</th><th></th></tr></thead><tbody>${sh.map(s => `<tr><td><b>${h(s.name || s.id)}</b><div class="sub">${h(s.id)}${s.id === c.defaultShiftId ? " · default" : ""}${s.flexible ? " · flexible" : ""}</div></td><td class="mono">${h(s.start)}–${h(s.end)}${A.hm(s.end) <= A.hm(s.start) ? " (+1)" : ""}</td><td class="n">${h(s.breakMin || 0)}m</td><td class="n">${s.flexible ? "—" : h(s.graceMin != null ? s.graceMin : c.graceMin) + "m"}</td><td>${(s.days || []).map(d => DN[d]).join(" ")}</td><td class="n">${useCnt(s.id)}</td><td>${ro ? "" : `<button class="btn sm" data-a="shEdit" data-v="${h(s.id)}">Edit</button>`}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="grid2">
      <div class="panel"><h2>Public holidays ${year} <small>العطل الرسمية</small><span class="spacer"></span>${ro ? "" : `<button class="btn sm" data-a="holFill" data-v="${year}">Fill ${year} from Umm al-Qura</button><button class="btn sm" data-a="holFill" data-v="${year + 1}">${year + 1}</button>`}</h2>
        ${hol.length ? `<div class="lg-list">${hol.filter(x => x.date.slice(0, 4) >= String(year - 1)).map((x, i) => `<div><i style="background:${x.estimated ? "var(--saffron)" : "var(--accent)"}"></i><span>${h(x.name)} · ${fd(x.date)}${x.to && x.to !== x.date ? " → " + fd(x.to) : ""}${x.estimated ? " <span class=\"sub\">(estimated, confirm with MHRSD)</span>" : ""}</span>${ro ? "" : `<button class="btn sm" data-a="holDel" data-v="${h(x.date + "|" + x.name)}" aria-label="Remove">✕</button>`}</div>`).join("")}</div>` : `<div class="empty"><b>No holidays yet</b>Fill them from the Umm al-Qura calendar: Founding Day, Eid al-Fitr, Eid al-Adha and National Day.</div>`}
        ${ro ? "" : `<div class="row" style="margin-top:12px"><input type="date" id="hol_d" class="sel"><input type="date" id="hol_t" class="sel" title="Last day (optional)"><input id="hol_n" class="sel" placeholder="Holiday name" style="flex:1;min-width:120px"><button class="btn sm" data-a="holAdd">Add</button></div>`}</div>
      <div class="panel"><h2>Ramadan hours <small>ساعات رمضان</small></h2><div class="sub prose" style="margin-bottom:10px">Labor Law Art. 98: working hours for Muslim employees in Ramadan are reduced (6 hours a day by default; editable). Shifts end ${h(c.ramadan.hoursDay)} hours after they start, with no break. Exempt individual employees from their profile if needed.</div>
        <div class="fgrid"><div class="field"><label for="rm_f">Ramadan starts</label><input id="rm_f" type="date" value="${h(c.ramadan.from)}" ${ro ? "disabled" : ""}></div><div class="field"><label for="rm_t">Ramadan ends</label><input id="rm_t" type="date" value="${h(c.ramadan.to)}" ${ro ? "disabled" : ""}></div><div class="field"><label for="rm_h">Hours per day</label><input id="rm_h" type="number" step="0.5" min="4" max="8" value="${h(c.ramadan.hoursDay)}" ${ro ? "disabled" : ""}></div>
          <div class="field"><label for="rm_a">Applies to</label><select id="rm_a" ${ro ? "disabled" : ""}><option value="all" ${c.ramadan.applyTo !== "muslims" ? "selected" : ""}>All employees</option><option value="muslims" ${c.ramadan.applyTo === "muslims" ? "selected" : ""}>Muslim employees only (Art. 98)</option></select></div></div>
        ${ro ? "" : `<div class="row" style="margin-top:12px"><button class="btn sm" data-a="ramFill">Use Umm al-Qura dates</button><span class="spacer"></span><button class="btn sm pri" data-a="ramSave">Save</button></div>`}</div></div>
    <div class="panel" style="padding:0"><div style="padding:16px 18px 6px"><h2>Who works where <small>توزيع الموظفين</small></h2><div class="sub">Each employee's shift, branch zone and device user ID (for fingerprint imports). Changes save straight away.</div>
      ${ro ? "" : `<div class="row" style="margin:10px 0 4px">${deptSel("asgDept", U.asgDept)}<select class="sel" id="asgShift"><option value="">Shift…</option>${sh.map(s => `<option value="${h(s.id)}">${h(s.name || s.id)}</option>`).join("")}</select>${branchSel("asgBranch", "", "Branch…")}<button class="btn sm" data-a="asgBulk">Apply to ${U.asgDept ? h(U.asgDept) : "everyone shown"}</button></div>`}</div>
      <div class="tbl-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Employee</th><th>Department</th><th>Shift</th><th>Branch zone</th><th>Device ID</th><th>Ramadan hours</th></tr></thead><tbody>${emps.filter(e => !U.asgDept || e.department === U.asgDept).map(e => { const r = e.hr || {};
        return `<tr><td>${who(e)}</td><td>${h(e.department || "")}</td><td><select class="sel asg" data-emp="${h(e.empNo)}" data-k="shiftId" ${ro ? "disabled" : ""}><option value="">Default (${h(c.defaultShiftId)})</option>${sh.map(s => `<option value="${h(s.id)}" ${r.shiftId === s.id ? "selected" : ""}>${h(s.name || s.id)}</option>`).join("")}</select></td>
          <td><select class="sel asg" data-emp="${h(e.empNo)}" data-k="branchId" ${ro ? "disabled" : ""}><option value="">Any branch</option>${branches().map(b => `<option value="${h(b.id)}" ${r.branchId === b.id ? "selected" : ""}>${h(b.name)}</option>`).join("")}</select></td>
          <td><input class="sel asg" data-emp="${h(e.empNo)}" data-k="deviceId" value="${h(r.deviceId || "")}" style="width:90px" ${ro ? "disabled" : ""}></td>
          <td><select class="sel asg" data-emp="${h(e.empNo)}" data-k="muslim" ${ro ? "disabled" : ""}><option value="">${c.ramadan.applyTo === "muslims" ? "No" : "Yes (all staff)"}</option><option value="yes" ${r.muslim === true ? "selected" : ""}>Yes (Muslim)</option></select></td></tr>`; }).join("")}</tbody></table></div></div>`;
  }
  function openBranch(id) {
    const b0 = id ? branchBy(id) : null; const b = Object.assign({ id: "", name: "", lat: "", lng: "", radius_m: 150, active: true }, b0 || {});
    const start = { lat: +b.lat || 24.7136, lng: +b.lng || 46.6753, r: +b.radius_m || 150 };
    openModal(b0 ? `Branch zone · ${b.name}` : "New branch zone · فرع جديد", `<div class="sub">Click the map or drag the pin to the branch entrance, then set the radius. Paste coordinates or a Google Maps link if you have one.</div>
      <div class="mapbox" style="height:280px" id="brMap" data-lmap='${h(JSON.stringify({ edit: start, wheel: true }))}'></div>
      <div class="fgrid"><div class="field"><label for="br_id">Code</label><input id="br_id" value="${h(b.id)}" ${b0 ? "readonly" : ""} placeholder="RUH"></div><div class="field"><label for="br_n">Name</label><input id="br_n" value="${h(b.name)}" placeholder="Riyadh HQ"></div>
        <div class="field"><label for="br_r">Radius (m): <b id="br_rv">${h(b.radius_m)}</b></label><input id="br_r" type="range" min="30" max="1500" step="10" value="${h(b.radius_m)}"></div>
        <div class="field"><label for="br_a">Status</label><select id="br_a"><option value="1" ${b.active !== false ? "selected" : ""}>Active</option><option value="0" ${b.active === false ? "selected" : ""}>Inactive</option></select></div>
        <div class="field"><label for="br_lat">Latitude</label><input id="br_lat" value="${h(b.lat === "" ? "" : (+b.lat).toFixed(6))}" inputmode="decimal"></div><div class="field"><label for="br_lng">Longitude</label><input id="br_lng" value="${h(b.lng === "" ? "" : (+b.lng).toFixed(6))}" inputmode="decimal"></div>
        <div class="field" style="grid-column:1/-1"><label for="br_paste">Paste coordinates or a map link</label><input id="br_paste" placeholder="24.6905, 46.6853  or  https://maps.google.com/…@24.6905,46.6853,17z"></div></div>`,
      [{ label: "Use my current location", fn: async () => { const p = await locate(true); if (p && !p.err) { $("#br_lat").value = p.lat.toFixed(6); $("#br_lng").value = p.lng.toFixed(6); const m = $("#brMap"); if (m && m._move) m._move(p.lat, p.lng); toast(`Location set (±${Math.round(p.acc)} m)`); } else toast((p && p.err) || "Location unavailable"); } },
       { label: "Save zone", cls: "pri", fn: async () => {
        const o = { id: ($("#br_id").value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""), name: $("#br_n").value.trim(), lat: parseFloat($("#br_lat").value), lng: parseFloat($("#br_lng").value), radius_m: Math.round(+$("#br_r").value), active: $("#br_a").value === "1" };
        if (!o.id || !o.name) { toast("Enter a code and a name."); return; } if (!(o.lat >= -90 && o.lat <= 90 && o.lng >= -180 && o.lng <= 180)) { toast("Set the location on the map."); return; }
        if (!b0 && branchBy(o.id)) { toast("That code is already used."); return; }
        try { await saveBranch(o); closeModal(); toast("Branch zone saved"); MQ.render(); } catch (x) { toast("Not saved: " + errMsg(x)); } } }]);
    $("#br_r").addEventListener("input", ev => { $("#br_rv").textContent = ev.target.value; const m = $("#brMap"); if (m && m._setR) m._setR(+ev.target.value); });
    $("#br_paste").addEventListener("input", ev => { const v = ev.target.value; const mm = v.match(/@?(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/) || v.match(/[?&](?:q|ll|query)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
      if (mm) { $("#br_lat").value = (+mm[1]).toFixed(6); $("#br_lng").value = (+mm[2]).toFixed(6); const m = $("#brMap"); if (m && m._move) m._move(+mm[1], +mm[2]); } });
    ["br_lat", "br_lng"].forEach(i => $("#" + i).addEventListener("change", () => { const la = parseFloat($("#br_lat").value), lo = parseFloat($("#br_lng").value); const m = $("#brMap"); if (m && m._move && isFinite(la) && isFinite(lo)) m._move(la, lo); }));
    setTimeout(mountMaps, 30);
  }
  function openShift(id) {
    const c = cfg(); const s0 = id ? c.shifts.find(s => s.id === id) : null; const s = Object.assign({ id: "", name: "", start: "08:00", end: "17:00", breakMin: 60, graceMin: c.graceMin, days: [0, 1, 2, 3, 4], flexible: false }, s0 || {});
    const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    openModal(s0 ? `Shift · ${s.name || s.id}` : "New shift · وردية جديدة", `<div class="fgrid">
      <div class="field"><label for="sh_id">Code</label><input id="sh_id" value="${h(s.id)}" ${s0 ? "readonly" : ""} placeholder="EARLY"></div><div class="field"><label for="sh_n">Name</label><input id="sh_n" value="${h(s.name)}" placeholder="Warehouse · 6:00–14:00"></div>
      <div class="field"><label for="sh_s">Starts</label><input id="sh_s" type="time" value="${h(s.start)}"></div><div class="field"><label for="sh_e">Ends (earlier than start = next day)</label><input id="sh_e" type="time" value="${h(s.end)}"></div>
      <div class="field"><label for="sh_b">Unpaid break (min)</label><input id="sh_b" type="number" min="0" max="180" value="${h(s.breakMin)}"></div><div class="field"><label for="sh_g">Grace (min)</label><input id="sh_g" type="number" min="0" max="120" value="${h(s.graceMin)}"></div>
      <div class="field"><label for="sh_f">Type</label><select id="sh_f"><option value="0" ${!s.flexible ? "selected" : ""}>Fixed start time</option><option value="1" ${s.flexible ? "selected" : ""}>Flexible (hours only)</option></select></div>
      <div class="field"><label for="sh_d">Default shift for new staff</label><select id="sh_d"><option value="0">No</option><option value="1" ${c.defaultShiftId === s.id ? "selected" : ""}>Yes</option></select></div>
      <div class="field" style="grid-column:1/-1"><label>Workdays</label><div class="row" style="gap:4px">${DN.map((d, i) => `<label class="chip" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" class="sh_day" value="${i}" ${(s.days || []).includes(i) ? "checked" : ""}>${d}</label>`).join("")}</div></div></div><div class="calc" id="sh_c"></div>`,
      [s0 && c.shifts.length > 1 ? { label: "Delete", cls: "danger", fn: async () => { await saveCfg({ shifts: c.shifts.filter(x => x.id !== s.id), defaultShiftId: c.defaultShiftId === s.id ? c.shifts.find(x => x.id !== s.id).id : c.defaultShiftId }); closeModal(); toast("Shift deleted"); } } : null,
       { label: "Save shift", cls: "pri", fn: async () => {
        const o = { id: ($("#sh_id").value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""), name: $("#sh_n").value.trim(), start: $("#sh_s").value, end: $("#sh_e").value, breakMin: +$("#sh_b").value || 0, graceMin: +$("#sh_g").value || 0, flexible: $("#sh_f").value === "1", days: [...document.querySelectorAll(".sh_day:checked")].map(x => +x.value) };
        if (!o.id || !o.start || !o.end) { toast("Enter a code, start and end."); return; } if (!o.days.length) { toast("Choose at least one workday."); return; }
        if (!s0 && c.shifts.some(x => x.id === o.id)) { toast("That code is already used."); return; }
        o.name = o.name || `${o.id} · ${o.start}–${o.end}`;
        const list = c.shifts.filter(x => x.id !== o.id).concat([o]);
        await saveCfg({ shifts: list, defaultShiftId: $("#sh_d").value === "1" ? o.id : (c.defaultShiftId && list.some(x => x.id === c.defaultShiftId) ? c.defaultShiftId : o.id) }); closeModal(); toast("Shift saved"); } }].filter(Boolean));
    const upd = () => { const st = A.hm($("#sh_s").value), en = A.hm($("#sh_e").value); if (st == null || en == null) return; const span = (en <= st ? en + 1440 : en) - st, net = span - (+$("#sh_b").value || 0);
      $("#sh_c").innerHTML = `<div><span>Paid hours a day</span><b>${durS(net)}</b></div><div><span>Days a week</span><b>${document.querySelectorAll(".sh_day:checked").length}</b></div><div><span>Hours a week</span><b>${durS(net * document.querySelectorAll(".sh_day:checked").length)}</b></div>${net > 480 ? `<div style="grid-column:1/-1;color:var(--amber)">Above 8 hours a day: the extra time is overtime (Labor Law Art. 98 / 107).</div>` : ""}${net * document.querySelectorAll(".sh_day:checked").length > 2880 ? `<div style="grid-column:1/-1;color:var(--amber)">Above 48 hours a week (Art. 98).</div>` : ""}`; };
    ["sh_s", "sh_e", "sh_b"].forEach(i => $("#" + i).addEventListener("input", upd)); document.querySelectorAll(".sh_day").forEach(x => x.addEventListener("change", upd)); upd();
  }

  /* ---------- view: my check-in (employee phone screen) ---------- */
  function radar(pos, ev) {
    const b = ev && ev.branch; const R = 46, C = 66;
    if (!pos || pos.err || !b) return `<svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="${R}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-dasharray="4 4"/><circle cx="66" cy="66" r="4" fill="var(--muted)"/></svg>`;
    const rad = +b.radius_m || 150, d = ev.distance || 0; let px = d / rad * R; const far = px > 60; if (far) px = 60;
    const br = A.bearing(+b.lat, +b.lng, pos.lat, pos.lng) * Math.PI / 180; const x = C + Math.sin(br) * px, y = C - Math.cos(br) * px;
    const col = ev.inside ? "var(--accent)" : "var(--sadu)"; const accPx = Math.min(60, (pos.acc || 0) / rad * R);
    return `<svg viewBox="0 0 132 132" role="img" aria-label="${h(ev.inside ? "Inside the zone" : "Outside the zone")}"><circle cx="66" cy="66" r="62" fill="none" stroke="var(--line)"/><circle cx="66" cy="66" r="${R}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/>
      <circle cx="66" cy="66" r="3" fill="var(--accent)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${accPx.toFixed(1)}" fill="${col}" opacity=".15"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${col}" stroke="var(--surface)" stroke-width="2.5"><animate attributeName="r" values="7;8.5;7" dur="2s" repeatCount="indefinite"/></circle>${far ? `<text x="66" y="128" text-anchor="middle" style="font-size:10px;fill:var(--muted)">not to scale</text>` : ""}</svg>`;
  }
  function vMe() {
    const e = meEmp();
    if (!e) return `<div class="me"><div class="me-card"><div class="empty"><b>This sign-in is not linked to an employee</b>Ask HR to link your email to your employee number. ${S.demo ? "" : "Admins do this in Supabase → app_users → emp_no."}</div></div></div>`;
    if (!U.meLocated) { U.meLocated = true; setTimeout(() => locate(), 50); }
    const t = todayL(), c = cfg(); const mine = S.att.punches.filter(p => p.empNo === e.empNo);
    const r = A.day(e, t, mine, ctx()); const todayP = r.punches; const next = A.nextAction(todayP); const pos = S.att.pos;
    const ev = pos && !pos.err ? A.evaluatePunch(branches(), pos.lat, pos.lng, pos.acc, c, A.allowedBranches(e)) : null;
    const br = branchBy(empBranch(e)); const sh = r.shift;
    const locTxt = S.att.locating ? ["Finding your location…", "Keep this screen open for a few seconds."]
      : !pos ? ["Location not checked yet", "Tap “Refresh location”."] : pos.err ? ["Location unavailable", pos.err]
      : !ev.branch ? ["No branch zone is set up", "Ask HR to add your branch."]
      : ev.status === "ok" ? [`Inside ${ev.branch.name}`, `${Math.round(ev.distance)} m from the centre · zone ${ev.branch.radius_m || 150} m · GPS ±${Math.round(pos.acc)} m`]
      : ev.status === "low_accuracy" ? ["GPS signal is weak", `±${Math.round(pos.acc)} m. Step outside or near a window, then refresh.`]
      : [`Outside the zone`, `${Math.round(ev.distance).toLocaleString("en-US")} m from ${ev.branch.name} (zone ${ev.branch.radius_m || 150} m).${c.blockOutside ? " Check-in is only allowed inside." : " You can still punch; HR will review it."}`];
    const blocked = c.blockOutside && ev && ev.status !== "ok";
    const btn = { in: ["Check in", ""], out: ["Check out", "out"], break_end: ["End break", "out"] }[next];
    const m = A.month([e], mine, ctx(), t.slice(0, 8) + "01"), mt = m.rows[0] ? m.rows[0].totals : {}; const days = m.rows[0] ? m.rows[0].days : [];
    const first = A.weekday(t.slice(0, 8) + "01"); const myReq = S.att.requests.filter(x => x.empNo === e.empNo).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 5);
    const cal = ["S", "M", "T", "W", "T", "F", "S"].map(d => `<div class="hd">${d}</div>`).join("") + Array(first).fill("<div></div>").join("") + days.map(x => `<div class="${x.code ? (x.status === "HALF_DAY" ? "c-half" : "c-" + x.code) : ""} ${x.date === t ? "td" : ""}" title="${h(x.status)}">${+x.date.slice(8)}</div>`).join("");
    const kindL = { in: "Checked in", out: "Checked out", break_start: "Break", break_end: "Back from break" };
    return `<div class="me">
      <div class="me-hello">${av(e)}<div><h2>${h(greet())}, ${h(nm(e).split(" ")[0])}</h2><div class="sub">${h([e.jobTitle, br ? br.name : null].filter(Boolean).join(" · "))}</div></div></div>
      <div class="me-card me-clock"><div class="t" id="meClock">${h(tLocal(nowISO()))}</div><div class="d">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" })} · <bdi dir="rtl" class="ar">${h(MQ.hj(t))} هـ</bdi></div>
        <div class="me-shift">${sh.workday ? `<span class="pill p-grey">Shift ${fmtM(sh.start)}–${fmtM(sh.end)}${sh.ramadan ? " · Ramadan" : ""}</span>` : `<span class="pill p-grey">${r.holiday ? h(r.holiday.name) : "Day off today"}</span>`}${sh.workday && !r.holiday ? statusPill(r) : ""}${r.workedMin ? `<span class="pill p-blue" id="meWorked">Worked ${durS(r.workedMin)}</span>` : ""}</div></div>
      <div class="me-card"><div class="radar">${radar(pos, ev)}<div><div class="st" style="color:${ev && ev.status === "ok" ? "var(--accent)" : ev ? "var(--sadu)" : "inherit"}">${h(locTxt[0])}</div><div class="ds">${h(locTxt[1])}</div>
        <div class="row" style="margin-top:10px"><button class="btn sm" data-a="meLocate" ${S.att.locating ? "disabled" : ""}>Refresh location</button>${S.demo ? `<label class="check"><input type="checkbox" data-a="fakeLoc" ${U.fakeLoc ? "checked" : ""}> Preview: stand at my branch</label>` : ""}</div></div></div>
        <div style="margin-top:16px"><button class="punch ${btn[1]}" data-a="punch" data-v="${next}" ${S.att.busy || S.att.locating || blocked || (S.essOnly && MQ.readOnly) ? "disabled" : ""}>${S.att.busy ? `<span class="spin"></span>Saving…` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${next === "in" ? '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>' : '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'}</svg>${btn[0]}`}</button>
        ${next === "out" ? `<div class="me-sub"><button class="btn" data-a="punch" data-v="break_start" ${S.att.busy ? "disabled" : ""}>Start break</button><button class="btn" data-a="meReq">Fix a missed punch</button></div>` : `<div class="me-sub"><span></span><button class="btn" data-a="meReq">Fix a missed punch</button></div>`}</div></div>
      <div class="me-card"><h2 style="font-size:15px;margin-bottom:6px">Today</h2>${todayP.length ? `<div class="me-tl">${todayP.map(p => `<div class="it"><span class="tm">${tLocal(p.at)}</span><i class="${p.kind === "in" ? "" : p.kind === "out" ? "o" : "b"}"></i><span>${h(kindL[p.kind])}${p.branchId && branchBy(p.branchId) ? ` <span class="sub">· ${h(branchBy(p.branchId).name)}</span>` : ""}</span>${p.status === "ok" || p.status === "approved" ? `<span class="pill p-green">In zone</span>` : p.status === "manual" ? `<span class="pill p-blue">By HR</span>` : p.status === "rejected" ? `<span class="pill p-grey">Rejected</span>` : `<span class="pill p-amber">HR review</span>`}</div>`).join("")}</div>` : `<div class="sub">No punches yet today.</div>`}</div>
      <div class="me-card"><h2 style="font-size:15px;margin-bottom:10px">${new Date().toLocaleDateString("en-GB", { month: "long", timeZone: "Asia/Riyadh" })} so far</h2>
        <div class="me-stats"><div><b>${mt.present || 0}</b><span>Days present</span></div><div><b>${mt.late || 0}</b><span>Late</span></div><div><b>${mt.absent || 0}</b><span>Absent</span></div><div><b>${+((mt.otMin || 0) / 60).toFixed(1)}</b><span>Overtime h</span></div></div><div class="me-cal">${cal}</div></div>
      ${myReq.length ? `<div class="me-card"><h2 style="font-size:15px;margin-bottom:8px">My correction requests</h2>${myReq.map(q => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${fd(q.day)} · ${h(kindL[q.kind] || q.kind)} ${h(q.time)}</span><span class="spacer"></span><span class="pill ${q.status === "approved" ? "p-green" : q.status === "rejected" ? "p-red" : "p-amber"}">${h(q.status[0].toUpperCase() + q.status.slice(1))}</span></div>`).join("")}</div>` : ""}
      ${S.essOnly ? `<div class="row" style="justify-content:center"><button class="btn" data-act="userMenu">Account · sign out</button></div>` : ""}</div>`;
  }
  function greet() { const hr = +new Date().toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Riyadh" }); return hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening"; }
  function openReq() {
    const e = meEmp(); if (!e) return;
    openModal("Fix a missed punch · طلب تصحيح", `<div class="sub">HR reviews the request. Once approved, the punch is added to your record.</div><div class="fgrid">
      <div class="field"><label for="rq_d">Day</label><input id="rq_d" type="date" value="${h(A.addDays(todayL(), -1))}" max="${h(todayL())}" min="${h(A.addDays(todayL(), -45))}"></div>
      <div class="field"><label for="rq_k">Missing punch</label><select id="rq_k"><option value="in">Check-in</option><option value="out">Check-out</option></select></div>
      <div class="field"><label for="rq_t">Actual time</label><input id="rq_t" type="time" value="08:00"></div>
      <div class="field" style="grid-column:1/-1"><label for="rq_r">What happened?</label><input id="rq_r" maxlength="500" placeholder="e.g. My phone had no battery at the end of the shift"></div></div>`,
      [{ label: "Cancel", fn: closeModal }, { label: "Send to HR", cls: "pri", fn: async () => {
        const o = { empNo: e.empNo, day: $("#rq_d").value, kind: $("#rq_k").value, time: $("#rq_t").value, reason: $("#rq_r").value.trim() };
        if (!o.day || !o.time) { toast("Choose the day and time."); return; } if (o.reason.length < 3) { toast("Explain what happened in a few words."); return; }
        try { await saveRequest(o); closeModal(); toast("Request sent to HR"); MQ.render(); } catch (x) { toast("Not sent: " + errMsg(x)); } } }]);
  }

  /* ---------- dashboard strip ---------- */
  function dashStrip() {
    const emps = staff(); if (!emps.length) return "";
    const b = A.board(emps, S.att.punches, ctx(), todayL()), k = b.counts; const exp = k.total - k.leave - k.off; if (exp <= 0 && !k.present) return "";
    return `<div class="panel" style="margin-bottom:16px;display:flex;gap:20px;align-items:center;flex-wrap:wrap"><div><div class="sub">Attendance today</div><div style="font-family:var(--f-display);font-size:34px;font-weight:600;font-variant-numeric:tabular-nums">${k.present}<span class="sub" style="font-size:16px"> / ${exp}</span></div></div>
      <div class="row" style="gap:8px;flex:1">${k.late ? `<span class="pill p-amber">${k.late} late</span>` : ""}${k.notIn ? `<span class="pill p-red">${k.notIn} not checked in</span>` : ""}${k.absent ? `<span class="pill p-red">${k.absent} absent</span>` : ""}${k.leave ? `<span class="pill p-blue">${k.leave} on leave</span>` : ""}${k.review ? `<span class="pill p-red">${k.review} outside zone</span>` : ""}${!k.late && !k.notIn && !k.absent && !k.review ? `<span class="pill p-green">All on time so far</span>` : ""}</div>
      <button class="btn" data-nav="att">Open attendance</button><button class="btn" data-nav="attmap">Locations map</button></div>`;
  }

  /* ---------- actions & inputs ---------- */
  async function act(a, t) {
    const d = t.dataset;
    try {
      switch (a) {
        case "attf": U.attF = d.v || ""; return MQ.renderNow();
        case "attDayStep": U.attDay = A.addDays(U.attDay || todayL(), +d.v); if (U.attDay > todayL()) U.attDay = todayL(); return MQ.renderNow();
        case "attToday": U.attDay = todayL(); return MQ.renderNow();
        case "mapFocus": U.mapFocus = d.v || ""; delete U.mv_live; return MQ.renderNow();
        case "attGoBranch": U.attBr = d.v; U.attF = ""; return MQ.go("att");
        case "day": return openDay(d.emp, d.d);
        case "manual": return openManual("", U.attDay || todayL());
        case "addOut": return openManual(d.emp, d.d, "out", d.v);
        case "rev": await review(d.id, d.v); toast(d.v === "approved" ? "Punch accepted" : "Punch rejected"); return MQ.renderNow();
        case "revNear": { const list = pendingPunches().filter(p => { const b = branchBy(p.branchId); return p.status === "outside" && b && p.distance <= 2 * (b.radius_m || 150) && !(p.flags || []).includes("IMPOSSIBLE_TRAVEL"); });
          if (!list.length) { toast("No punches within twice the zone radius."); return; }
          return confirmBox(`Accept ${list.length} punches that are within twice their branch radius?`, async () => { for (const p of list) await review(p.id, "approved"); closeModal(); toast(`${list.length} punches accepted`); MQ.render(); }); }
        case "req": await decide(d.id, d.v); toast(d.v === "approved" ? "Approved · punch added" : "Request rejected"); return MQ.renderNow();
        case "importDev": return openImport();
        case "lawRun": t.disabled = true; t.textContent = "Checking…"; return setTimeout(lawRun, 30);
        case "sheetXlsx": return sheetXlsx();
        case "toPayroll": return toPayroll();
        case "brEdit": return openBranch(d.v);
        case "shEdit": return openShift(d.v);
        case "saveRules": await saveCfg({ geoMode: $("#r_geo").value, blockOutside: $("#r_blk").value === "1", maxAccuracyM: +$("#r_acc").value || 100, countOutside: $("#r_out").value === "1",
          graceMin: +$("#r_gr").value || 0, earlyGraceMin: +$("#r_eg").value || 0, minOtMin: +$("#r_ot").value || 0, halfDayMin: +$("#r_hd").value || 0, incompleteAbsence: +$("#r_inc").value || 0, deductLate: $("#r_dl").value === "1",
          weekend: [...document.querySelectorAll(".r_we:checked")].map(x => +x.value), trackingFrom: $("#r_tf").value || "" }); return toast("Rules saved");
        case "holFill": { const y = +d.v, sg = A.suggestHolidays(y); const cur = (cfg().holidays || []).filter(x => x.date.slice(0, 4) !== String(y)); await saveCfg({ holidays: cur.concat(sg.holidays) }); return toast(`${sg.holidays.length} holidays added for ${y}. Confirm the Eid dates when MHRSD announces them.`); }
        case "holDel": { const [dt, n] = d.v.split("|"); await saveCfg({ holidays: (cfg().holidays || []).filter(x => !(x.date === dt && x.name === n)) }); return; }
        case "holAdd": { const dt = $("#hol_d").value, to = $("#hol_t").value || dt, n = $("#hol_n").value.trim(); if (!dt || !n) { toast("Choose a date and a name."); return; } await saveCfg({ holidays: (cfg().holidays || []).concat([{ date: dt, to: to < dt ? dt : to, name: n }]) }); return toast("Holiday added"); }
        case "ramFill": { const y = +todayL().slice(0, 4); let sg = A.suggestHolidays(y).ramadan; if (sg.to && sg.to < todayL()) sg = A.suggestHolidays(y + 1).ramadan; $("#rm_f").value = sg.from; $("#rm_t").value = sg.to; return toast("Dates filled from Umm al-Qura. Save to apply."); }
        case "ramSave": await saveCfg({ ramadan: { from: $("#rm_f").value, to: $("#rm_t").value, hoursDay: +$("#rm_h").value || 6, applyTo: $("#rm_a").value } }); return toast("Ramadan hours saved");
        case "asgBulk": { const shv = $("#asgShift").value, brv = $("#asgBranch").value; if (!shv && !brv) { toast("Choose a shift or a branch to apply."); return; }
          const list = staff().filter(e => !U.asgDept || e.department === U.asgDept);
          return confirmBox(`Apply ${[shv ? "shift " + shv : "", brv ? "branch " + brv : ""].filter(Boolean).join(" and ")} to ${list.length} employees?`, async () => { for (const e of list) await setEmpHr(e.empNo, Object.assign({}, shv ? { shiftId: shv } : {}, brv ? { branchId: brv } : {})); closeModal(); toast("Assignments saved"); }); }
        case "punch": return punchNow(d.v);
        case "meLocate": return locate(true);
        case "fakeLoc": U.fakeLoc = t.checked; S.att.pos = null; return locate(true);
        case "meReq": return openReq();
      }
    } catch (x) { console.error(x); toast(errMsg(x)); }
  }
  async function setEmpHr(no, patch) { const e = MQ.empBy(no); if (!e) return; const o = JSON.parse(JSON.stringify(e)); delete o._id; o.hr = Object.assign({}, o.hr || {}, patch); Object.keys(patch).forEach(k => { if (patch[k] === "") delete o.hr[k]; }); await put("employees", o.empNo, o); }
  function onChange(ev) {
    const el = ev.target, id = el.id, v = el.value;
    if (id === "attDay" && v) { U.attDay = v > todayL() ? todayL() : v; MQ.renderNow(); return true; }
    if (id === "attM" && v) { U.attM = v; MQ.renderNow(); return true; }
    if (id === "attBr") { U.attBr = v; MQ.renderNow(); return true; }
    if (id === "attDept") { U.attDept = v; MQ.renderNow(); return true; }
    if (id === "asgDept") { U.asgDept = v; MQ.renderNow(); return true; }
    if (el.classList && el.classList.contains("asg")) { setEmpHr(el.dataset.emp, { [el.dataset.k]: el.dataset.k === "muslim" ? (v === "yes" ? true : "") : v.trim() }).then(() => toast("Saved")).catch(x => toast("Not saved: " + errMsg(x))); return true; }
    return false;
  }
  let qT = null;
  function onInput(ev) {
    if (ev.target.id !== "attQ") return false;
    U.attQ = ev.target.value; clearTimeout(qT); qT = setTimeout(() => { const pos = ev.target.selectionStart; MQ.renderNow(); const el = $("#attQ"); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 220); return true;
  }
  // live clock on the check-in screen
  setInterval(() => { const el = document.getElementById("meClock"); if (el) el.textContent = tLocal(nowISO()); }, 1000);

  return { views: { att: vAtt, attmap: vMap, attsheet: vSheet, attreview: vReview, attsetup: vSetup, me: vMe },
    start, startEss, act, onChange, onInput, badge, dashStrip, after: mountMaps };
};
