/* Attendance engine (vanilla JS, ES2018, no deps).
   Turns raw punches (check-in / check-out / break, GPS-verified) into daily and monthly attendance:
   present, late, early leave, absent, leave, holiday, weekend, overtime, and the payroll inputs
   (absence days, overtime hours) the HR engine already understands.
   Times are stored as UTC ISO timestamps; days are evaluated in KSA local time (UTC+3, no DST). */
(function (root) {
  'use strict';

  var DEFAULT_ATT = {
    tzOffsetMin: 180,            // Asia/Riyadh
    weekend: [5, 6],             // 0 = Sunday … 6 = Saturday → Friday + Saturday
    graceMin: 15,                // late only when the first check-in is after start + grace
    lateFromStart: true,         // late minutes counted from shift start (not from the end of grace)
    earlyGraceMin: 10,           // early leave only when check-out is more than this before shift end
    minOtMin: 30,                // overtime counted only when it reaches this many minutes
    halfDayMin: 240,             // a day with less than 4 h worked counts as half a day absent
    maxAccuracyM: 100,           // GPS fixes worse than this need review
    geoMode: "any",              // "any" = nearest active branch, "assigned" = only the employee's assigned branches
    blockOutside: false,         // true = refuse punches outside the zone instead of recording them for review
    countOutside: true,          // punches outside the geofence still count (flagged for review); rejected ones never count
    incompleteAbsence: 0,        // absence charged for a day with a check-in but no check-out (0 = none, flagged)
    deductLate: false,           // convert late minutes into absence days for payroll
    workHoursDay: 8,
    ramadan: { from: "", to: "", hoursDay: 6, applyTo: "all" },   // Labor Law Art. 98: 6 h/day for Muslims in Ramadan; applyTo "muslims" uses hr.muslim / religion
    defaultShiftId: "GEN",
    shifts: [
      { id: "GEN", name: "General · 8:00–17:00", start: "08:00", end: "17:00", breakMin: 60, graceMin: 15, days: [0, 1, 2, 3, 4] }
    ],
    holidays: [],                // [{date:"2026-09-23", to:"2026-09-23", name:"National Day"}]
    trackingFrom: ""             // attendance go-live date: days before it are never counted (no absence, no deduction)
  };

  var DAY = 86400000;
  function C(cfg) {
    var c = {}, k; cfg = cfg || {};
    for (k in DEFAULT_ATT) c[k] = DEFAULT_ATT[k];
    for (k in cfg) if (cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== "") c[k] = cfg[k];
    c.ramadan = Object.assign({}, DEFAULT_ATT.ramadan, cfg.ramadan || {});
    if (!c.shifts || !c.shifts.length) c.shifts = DEFAULT_ATT.shifts;
    return c;
  }
  function hm(s) { var m = /^(\d{1,2}):(\d{2})/.exec(String(s || "")); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtMin(min) { if (min == null || isNaN(min)) return ""; var m = Math.round(min); m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  function dur(min) { min = Math.max(0, Math.round(min || 0)); return Math.floor(min / 60) + "h " + pad(min % 60) + "m"; }
  function addDays(d, n) { return new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10); }
  function weekday(d) { return new Date(d + "T00:00:00Z").getUTCDay(); }
  function dayStartMs(d, cfg) { return Date.parse(d + "T00:00:00Z") - cfg.tzOffsetMin * 60000; }
  function localDate(ms, cfg) { return new Date(ms + cfg.tzOffsetMin * 60000).toISOString().slice(0, 10); }
  function localToday(cfg, nowMs) { return localDate(nowMs == null ? Date.now() : nowMs, C(cfg)); }
  function relMin(at, d, cfg) { return (Date.parse(at) - dayStartMs(d, cfg)) / 60000; }
  function atFor(d, min, cfg) { return new Date(dayStartMs(d, C(cfg)) + min * 60000).toISOString(); }
  function monthDays(monthISO) {
    var y = +monthISO.slice(0, 4), m = +monthISO.slice(5, 7), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
    for (var i = 1; i <= n; i++) out.push(monthISO.slice(0, 7) + "-" + pad(i));
    return out;
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  function holidayOn(d, cfg) {
    var hs = cfg.holidays || [];
    for (var i = 0; i < hs.length; i++) { var h = hs[i]; if (!h || !h.date) continue; if (d >= h.date && d <= (h.to || h.date)) return h; }
    return null;
  }
  function inRamadan(d, cfg) { var r = cfg.ramadan || {}; return !!(r.from && r.to && d >= r.from && d <= r.to); }
  function leaveOn(emp, d, leaves) {
    var no = emp.empNo;
    for (var i = 0; i < (leaves || []).length; i++) {
      var l = leaves[i];
      if (l && l.empNo === no && l.status === "APPROVED" && l.from <= d && (l.to || l.from) >= d) return l;
    }
    return null;
  }

  /* The shift that applies to an employee on a date (with Ramadan hours when the date is in Ramadan). */
  function resolveShift(emp, d, cfg) {
    cfg = C(cfg);
    var r = (emp && emp.hr) || {}, id = r.shiftId || cfg.defaultShiftId, sh = null;
    for (var i = 0; i < cfg.shifts.length; i++) if (cfg.shifts[i].id === id) sh = cfg.shifts[i];
    sh = sh || cfg.shifts[0];
    var s = hm(sh.start), e = hm(sh.end); if (s == null) s = 480; if (e == null) e = 1020; if (e <= s) e += 1440;
    var isMuslim = r.muslim === true || /^(muslim|islam|مسلم)/i.test(String((emp && emp.religion) || r.religion || ""));
    var brk = +sh.breakMin || 0, ram = inRamadan(d, cfg) && sh.ramadan !== false && !r.ramadanExempt && (cfg.ramadan.applyTo !== "muslims" || isMuslim);
    if (ram) { if (sh.ramadanStart) s = hm(sh.ramadanStart); e = s + Math.round((+cfg.ramadan.hoursDay || 6) * 60); brk = 0; }
    var days = sh.days && sh.days.length ? sh.days : [0, 1, 2, 3, 4, 5, 6].filter(function (x) { return cfg.weekend.indexOf(x) < 0; });
    return { id: sh.id, name: sh.name || sh.id, start: s, end: e, breakMin: brk,
      grace: sh.graceMin != null && sh.graceMin !== "" ? +sh.graceMin : +cfg.graceMin,
      flexible: !!sh.flexible, workday: days.indexOf(weekday(d)) >= 0, expected: Math.max(0, e - s - brk),
      ramadan: ram, overnight: e > 1440 };
  }
  // Minutes (relative to local midnight of d) during which a punch belongs to day d.
  function rawWindow(emp, d, cfg) {
    var sh = resolveShift(emp, d, cfg);
    if (!sh.workday) return { lo: 0, hi: 1440 };
    return { lo: Math.max(-360, sh.start - 360), hi: Math.max(sh.end + 360, 1440) };
  }
  function windowFor(emp, d, cfg) {
    // a day off starts where the previous night shift's window ends; a shift is cut only by the next day's own shift window
    var w = rawWindow(emp, d, cfg), prev = rawWindow(emp, addDays(d, -1), cfg), next = rawWindow(emp, addDays(d, 1), cfg);
    var nextWork = resolveShift(emp, addDays(d, 1), cfg).workday;
    return { lo: Math.max(w.lo, prev.hi - 1440), hi: nextWork ? Math.min(w.hi, next.lo + 1440) : w.hi };
  }

  var CODES = { PRESENT: "P", LATE: "L", HALF_DAY: "½", ABSENT: "A", LEAVE: "V", HOLIDAY: "H", WEEKEND: "W", INCOMPLETE: "I", IN: "P", NOT_IN: "?", NOT_YET: "", UPCOMING: "", NA: "" };

  /* One employee, one day. punches: that employee's punches (any order; others are ignored by date window). */
  function day(emp, d, punches, ctx) {
    ctx = ctx || {}; var cfg = C(ctx.cfg), now = ctx.now ? Date.parse(ctx.now) : Date.now();
    var sh = resolveShift(emp, d, cfg), r = (emp && emp.hr) || {};
    var out = { date: d, empNo: emp.empNo, shift: sh, status: "", code: "", firstIn: null, lastOut: null,
      workedMin: 0, lateMin: 0, earlyMin: 0, otMin: 0, absence: 0, flags: [], punches: [], leave: null, holiday: null };
    if ((r.hireDate && d < r.hireDate) || (r.endDate && d > r.endDate) || (cfg.trackingFrom && d < cfg.trackingFrom)) { out.status = "NA"; return out; }
    var w = windowFor(emp, d, cfg), dayMs = dayStartMs(d, cfg);
    var ps = (punches || []).filter(function (p) { return p && p.at && p.status !== "rejected" && (!p.empNo || p.empNo === emp.empNo); })
      .filter(function (p) { return cfg.countOutside || p.status === "ok" || p.status === "manual" || p.status === "approved"; })
      .map(function (p) { return Object.assign({}, p, { rel: relMin(p.at, d, cfg) }); })
      .filter(function (p) { return p.rel >= w.lo && p.rel < w.hi; })
      .sort(function (a, b) { return a.rel - b.rel; });
    out.punches = ps;
    ps.forEach(function (p) {
      if (p.status === "outside" || p.status === "low_accuracy") { if (out.flags.indexOf("REVIEW") < 0) out.flags.push("REVIEW"); }
      if (p.status === "manual" && out.flags.indexOf("MANUAL") < 0) out.flags.push("MANUAL");
    });
    // pair punches into worked segments; a break closes the segment, break end reopens it
    var open = null, worked = 0, breaks = 0, firstIn = null, lastOut = null, bStart = null;
    ps.forEach(function (p) {
      if (p.kind === "in") { if (open == null) open = p.rel; if (firstIn == null) firstIn = p.rel; }
      else if (p.kind === "out") { if (open != null) { worked += p.rel - open; open = null; } lastOut = p.rel; }
      else if (p.kind === "break_start") { if (open != null) { worked += p.rel - open; open = null; bStart = p.rel; } }
      else if (p.kind === "break_end") { if (bStart != null) { breaks += p.rel - bStart; bStart = null; } if (open == null) open = p.rel; }
    });
    var nowRel = (now - dayMs) / 60000, live = false;
    if (open != null) { if (nowRel < w.hi && nowRel > open) { worked += nowRel - open; live = true; } }
    if (!breaks && sh.breakMin && worked > 300) worked = Math.max(300, worked - sh.breakMin);
    out.firstIn = firstIn; out.lastOut = open == null ? lastOut : null; out.workedMin = Math.round(worked); out.breakMin = Math.round(breaks);
    // Labor Law Art. 101: no more than 5 hours in a row without a 30-minute break; no more than 12 hours at the workplace
    if (firstIn != null && out.lastOut != null) {
      if (out.lastOut - firstIn > 720) out.flags.push("OVER_12H");
      var longest = 0, segStart = null;
      ps.forEach(function (p) { if (p.kind === "in" || p.kind === "break_end") { if (segStart == null) segStart = p.rel; } else if (segStart != null) { longest = Math.max(longest, p.rel - segStart); segStart = null; } });
      if (longest > 300 && !breaks && !(sh.breakMin >= 30)) out.flags.push("NO_BREAK");
    }

    var leave = leaveOn(emp, d, ctx.leaves), hol = holidayOn(d, cfg);
    if (leave) {
      out.status = "LEAVE"; out.leave = leave; if (ps.length) out.flags.push("WORKED_ON_LEAVE");
    } else if (hol || !sh.workday) {
      out.status = hol ? "HOLIDAY" : "WEEKEND"; out.holiday = hol;
      if (out.workedMin >= cfg.minOtMin && open == null) { out.otMin = out.workedMin; out.flags.push("OFFDAY_WORK"); } // Art. 107: rest-day / holiday hours are overtime
    } else if (firstIn == null) {
      if (now < dayMs) out.status = "UPCOMING";
      else if (nowRel < sh.start + sh.grace) out.status = "NOT_YET";
      else if (nowRel < sh.end) out.status = "NOT_IN";
      else { out.status = "ABSENT"; out.absence = 1; }
    } else {
      if (!sh.flexible && firstIn > sh.start + sh.grace) out.lateMin = Math.round(cfg.lateFromStart ? firstIn - sh.start : firstIn - sh.start - sh.grace);
      if (open != null) {
        out.status = live ? "IN" : "INCOMPLETE";
        if (!live) { out.flags.push("MISSING_OUT"); out.absence = +cfg.incompleteAbsence || 0; }
      } else {
        if (!sh.flexible && lastOut != null && lastOut < sh.end - cfg.earlyGraceMin) { out.earlyMin = Math.round(sh.end - lastOut); out.flags.push("EARLY_LEAVE"); }
        var extra = out.workedMin - sh.expected;
        if (extra >= cfg.minOtMin) out.otMin = Math.round(extra);
        if (sh.flexible && extra < 0) out.shortMin = Math.round(-extra);
        if (out.workedMin < cfg.halfDayMin) { out.status = "HALF_DAY"; out.absence = 0.5; }
        else out.status = out.lateMin > 0 ? "LATE" : "PRESENT";
      }
      if (out.lateMin > 0 && out.status !== "LATE" && out.flags.indexOf("LATE") < 0) out.flags.push("LATE");
    }
    out.code = CODES[out.status] || "";
    return out;
  }

  function groupBy(punches) { var g = {}; (punches || []).forEach(function (p) { (g[p.empNo] = g[p.empNo] || []).push(p); }); return g; }

  /* Everyone, one day: rows + counts for the live board. */
  function board(emps, punches, ctx, d) {
    var g = groupBy(punches), rows = (emps || []).map(function (e) { return day(e, d, g[e.empNo] || [], ctx); }).filter(function (r) { return r.status !== "NA"; });
    var c = { total: rows.length, present: 0, late: 0, absent: 0, notIn: 0, leave: 0, off: 0, incomplete: 0, inNow: 0, review: 0, early: 0, notYet: 0 };
    rows.forEach(function (r) {
      var s = r.status;
      if (s === "PRESENT" || s === "LATE" || s === "IN" || s === "INCOMPLETE" || s === "HALF_DAY") c.present++;
      if (r.lateMin > 0) c.late++;
      if (s === "ABSENT") c.absent++;
      if (s === "NOT_IN") c.notIn++;
      if (s === "NOT_YET") c.notYet++;
      if (s === "LEAVE") c.leave++;
      if (s === "HOLIDAY" || s === "WEEKEND") c.off++;
      if (s === "INCOMPLETE") c.incomplete++;
      if (s === "IN") c.inNow++;
      if (r.earlyMin > 0) c.early++;
      if (r.flags.indexOf("REVIEW") >= 0) c.review++;
    });
    var expected = c.total - c.leave - c.off;
    c.rate = expected > 0 ? round2(c.present / expected * 100) : 0;
    return { date: d, rows: rows, counts: c };
  }

  /* Everyone, one month: per-employee day rows + totals. */
  function month(emps, punches, ctx, monthISO) {
    var g = groupBy(punches), days = monthDays(monthISO);
    var todayL = localToday(ctx && ctx.cfg, ctx && ctx.now ? Date.parse(ctx.now) : null);
    var rows = (emps || []).map(function (e) {
      var ds = days.map(function (d) { return day(e, d, g[e.empNo] || [], ctx); });
      var t = { workDays: 0, present: 0, late: 0, lateMin: 0, earlyMin: 0, absent: 0, leave: 0, holiday: 0, off: 0, otMin: 0, workedMin: 0, incomplete: 0, review: 0 };
      ds.forEach(function (x) {
        var s = x.status;
        if (s === "NA" || s === "UPCOMING" || s === "NOT_YET" || x.date > todayL) return;
        if (x.shift.workday && s !== "HOLIDAY" && s !== "LEAVE") t.workDays++;
        if (s === "PRESENT" || s === "LATE" || s === "IN" || s === "INCOMPLETE") t.present++;
        if (s === "HALF_DAY") t.present += 0.5;
        if (x.lateMin > 0) { t.late++; t.lateMin += x.lateMin; }
        t.earlyMin += x.earlyMin; t.absent += x.absence; t.otMin += x.otMin; t.workedMin += x.workedMin;
        if (s === "LEAVE") t.leave++;
        if (s === "HOLIDAY") t.holiday++;
        if (s === "WEEKEND") t.off++;
        if (s === "INCOMPLETE") t.incomplete++;
        if (x.flags.indexOf("REVIEW") >= 0) t.review++;
      });
      t.absent = round2(t.absent);
      return { empNo: e.empNo, emp: e, days: ds, totals: t };
    });
    var T = { present: 0, absent: 0, late: 0, lateMin: 0, otMin: 0, incomplete: 0, review: 0, workDays: 0 };
    rows.forEach(function (r) { Object.keys(T).forEach(function (k) { T[k] += r.totals[k] || 0; }); });
    T.attendanceRate = T.workDays > 0 ? round2((T.workDays - T.absent) / T.workDays * 100) : 0;
    return { month: monthISO.slice(0, 7), days: days, rows: rows, totals: T };
  }

  /* Labor Law Art. 80 / 107 watch over a period (normally the last 12 months):
     unexcused absence days (total and longest run) against the warning (20 / 10) and dismissal (30 / 15) thresholds,
     and overtime hours against the 720 h/year guideline. Approved leave, weekends and holidays never count as absence. */
  function lawWatch(emps, punches, ctx, fromISO, toISO) {
    var g = groupBy(punches), c = C(ctx && ctx.cfg), todayL = localToday(c, ctx && ctx.now ? Date.parse(ctx.now) : null);
    var lim = { warnTotal: 20, warnRun: 10, dismissTotal: 30, dismissRun: 15, otYear: 720 };
    return (emps || []).map(function (e) {
      var total = 0, run = 0, maxRun = 0, ot = 0, noBreak = 0, over12 = 0, days = [];
      for (var d = fromISO; d <= toISO && d <= todayL; d = addDays(d, 1)) {
        var x = day(e, d, g[e.empNo] || [], ctx);
        if (x.status === "ABSENT") { total++; run++; if (run > maxRun) maxRun = run; days.push(d); }
        else if (x.status !== "WEEKEND" && x.status !== "HOLIDAY" && x.status !== "NA") run = 0;
        ot += x.otMin; if (x.flags.indexOf("NO_BREAK") >= 0) noBreak++; if (x.flags.indexOf("OVER_12H") >= 0) over12++;
      }
      var level = total > lim.dismissTotal || maxRun > lim.dismissRun ? "dismissal" : total >= lim.warnTotal || maxRun >= lim.warnRun ? "warning" : total >= lim.warnTotal / 2 || maxRun >= lim.warnRun / 2 ? "watch" : "ok";
      return { empNo: e.empNo, emp: e, absentDays: total, longestRun: maxRun, absentDates: days, otHours: round2(ot / 60), otOverCap: ot / 60 > lim.otYear, noBreakDays: noBreak, over12Days: over12, level: level };
    });
  }

  /* Payroll inputs for HR.payroll: { empNo: { absenceDays, otHours } } */
  function payrollInputs(m, cfg) {
    cfg = C(cfg); var out = {};
    (m.rows || []).forEach(function (r) {
      var t = r.totals, abs = t.absent;
      if (cfg.deductLate && t.lateMin > 0) abs += t.lateMin / (cfg.workHoursDay * 60);
      out[r.empNo] = { absenceDays: round2(abs), otHours: round2(t.otMin / 60) };
    });
    return out;
  }

  /* Geofence — the same rule the server applies (Supabase punch()). */
  function haversine(lat1, lng1, lat2, lng2) {
    var R = 6371000, toR = Math.PI / 180, dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
    var a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  /* allowedIds: the employee's assigned branch ids. cfg.geoMode "any" = nearest active branch, "assigned" = only assigned branches.
     cfg.blockOutside = refuse the punch (instead of recording it for review) when it is not inside a zone with a usable GPS fix. */
  function allowedBranches(emp) { var r = (emp && emp.hr) || {}; var ids = [].concat(r.branchIds || [], r.branchId ? [r.branchId] : []); return ids.filter(function (x, i) { return x && ids.indexOf(x) === i; }); }
  function evaluatePunch(branches, lat, lng, accuracy, cfg, allowedIds) {
    cfg = C(cfg); var best = null, bestD = null;
    var list = (branches || []).filter(function (b) { return b && b.active !== false && isFinite(b.lat) && isFinite(b.lng); });
    if (cfg.geoMode === "assigned" && allowedIds && allowedIds.length) list = list.filter(function (b) { return allowedIds.indexOf(b.id) >= 0; });
    list.forEach(function (b) { var d = haversine(lat, lng, +b.lat, +b.lng); if (bestD == null || d < bestD) { bestD = d; best = b; } });
    var inside = !!(best && bestD <= (+best.radius_m || +best.radius || 150));
    var status = accuracy == null || accuracy > cfg.maxAccuracyM ? "low_accuracy" : inside ? "ok" : "outside";
    return { branchId: best ? best.id : null, branch: best, distance: bestD == null ? null : Math.round(bestD * 10) / 10, inside: inside, status: status,
      blocked: !!cfg.blockOutside && status !== "ok", reason: status === "ok" ? "" : status === "low_accuracy" ? "GPS accuracy is too weak (±" + Math.round(accuracy || 0) + " m)" : !best ? "No branch zone is set up" : "Outside " + (best.name || best.id) + " by " + Math.round(bestD - (+best.radius_m || 150)) + " m" };
  }
  /* Flags a punch whose location implies impossible travel since the previous one (likely a fake-GPS app). */
  function travelCheck(prev, cur, maxKmh) {
    if (!prev || !cur || !isFinite(prev.lat) || !isFinite(cur.lat) || prev.lat == null || cur.lat == null) return null;
    var km = haversine(+prev.lat, +prev.lng, +cur.lat, +cur.lng) / 1000, h = Math.abs(Date.parse(cur.at) - Date.parse(prev.at)) / 3600000;
    if (km < 5) return null; var kmh = h > 0 ? km / h : Infinity;
    return kmh > (maxKmh || 250) ? { km: Math.round(km), kmh: Math.round(kmh) } : null;
  }
  function bearing(lat1, lng1, lat2, lng2) {
    var toR = Math.PI / 180, y = Math.sin((lng2 - lng1) * toR) * Math.cos(lat2 * toR),
      x = Math.cos(lat1 * toR) * Math.sin(lat2 * toR) - Math.sin(lat1 * toR) * Math.cos(lat2 * toR) * Math.cos((lng2 - lng1) * toR);
    return (Math.atan2(y, x) / toR + 360) % 360;
  }

  /* Next punch an employee should make, given today's punches. */
  function nextAction(todayPunches) {
    var ps = (todayPunches || []).filter(function (p) { return p.status !== "rejected"; }).slice().sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); });
    var last = ps[ps.length - 1];
    if (!last || last.kind === "out") return "in";
    if (last.kind === "break_start") return "break_end";
    return "out";
  }

  /* Device / Excel import: rows [{empNo, at}] → punches; per employee per day first = in, last = out, middle ignored. */
  function fromDeviceRows(rows, cfg) {
    cfg = C(cfg); var g = {};
    (rows || []).forEach(function (r) {
      var ms = Date.parse(r.at); if (!r.empNo || isNaN(ms)) return;
      var k = r.empNo + "|" + localDate(ms, cfg); (g[k] = g[k] || []).push({ empNo: r.empNo, at: new Date(ms).toISOString(), ms: ms });
    });
    var out = [];
    Object.keys(g).forEach(function (k) {
      var l = g[k].sort(function (a, b) { return a.ms - b.ms; });
      out.push({ empNo: l[0].empNo, at: l[0].at, kind: "in" });
      if (l.length > 1 && l[l.length - 1].ms - l[0].ms >= 60000) out.push({ empNo: l[0].empNo, at: l[l.length - 1].at, kind: "out" });
    });
    return out;
  }
  /* "2026-10-05 07:58", "05/10/2026 07:58", Excel serial → UTC ISO (input is KSA local time). */
  function parseLocal(v, cfg) {
    cfg = C(cfg);
    if (typeof v === "number" && isFinite(v)) { var ms = Math.round((v - 25569) * DAY); return new Date(ms - cfg.tzOffsetMin * 60000).toISOString(); }
    var s = String(v || "").trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s))) return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - cfg.tzOffsetMin * 60000).toISOString();
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s))) {
      var hh = +m[4]; if (m[7]) { if (/pm/i.test(m[7]) && hh < 12) hh += 12; if (/am/i.test(m[7]) && hh === 12) hh = 0; }
      return new Date(Date.UTC(+m[3], m[2] - 1, +m[1], hh, +m[5], +(m[6] || 0)) - cfg.tzOffsetMin * 60000).toISOString();
    }
    return null;
  }

  /* Estimated KSA public holidays and Ramadan for a Gregorian year from the Umm al-Qura calendar (needs Intl).
     Private sector: Eid al-Fitr 4 days from 1 Shawwal, Eid al-Adha 4 days from 9 Dhu al-Hijjah (Arafah),
     Founding Day 22 Feb, National Day 23 Sep. Confirm each year with the MHRSD announcement. */
  function hijriParts(d) {
    var f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
    var o = {}; f.formatToParts(new Date(d + "T00:00:00Z")).forEach(function (p) { if (p.type === "day" || p.type === "month" || p.type === "year") o[p.type] = parseInt(p.value, 10); });
    return o;
  }
  function suggestHolidays(year) {
    var out = [{ date: year + "-02-22", to: year + "-02-22", name: "Founding Day", fixed: true }, { date: year + "-09-23", to: year + "-09-23", name: "Saudi National Day", fixed: true }];
    var ramadan = { from: "", to: "" };
    try {
      var d = year + "-01-01", end = year + "-12-31";
      while (d <= end) {
        var p = hijriParts(d);
        if (p.month === 10 && p.day === 1) out.push({ date: d, to: addDays(d, 3), name: "Eid al-Fitr", estimated: true });
        if (p.month === 12 && p.day === 9) out.push({ date: d, to: addDays(d, 3), name: "Eid al-Adha", estimated: true });
        if (p.month === 9 && p.day === 1 && !ramadan.from) ramadan.from = d;
        if (p.month === 10 && p.day === 1 && ramadan.from && !ramadan.to) ramadan.to = addDays(d, -1);
        d = addDays(d, 1);
      }
    } catch (e) {}
    out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return { holidays: out, ramadan: ramadan };
  }

  var API = { DEFAULT_ATT: DEFAULT_ATT, config: C, hm: hm, fmtMin: fmtMin, dur: dur, addDays: addDays, weekday: weekday, monthDays: monthDays,
    localToday: localToday, localDate: function (ms, cfg) { return localDate(ms, C(cfg)); }, relMin: function (at, d, cfg) { return relMin(at, d, C(cfg)); }, atFor: atFor,
    resolveShift: resolveShift, day: day, board: board, month: month, payrollInputs: payrollInputs, lawWatch: lawWatch,
    haversine: haversine, bearing: bearing, evaluatePunch: evaluatePunch, allowedBranches: allowedBranches, travelCheck: travelCheck, nextAction: nextAction,
    fromDeviceRows: fromDeviceRows, parseLocal: parseLocal, suggestHolidays: suggestHolidays, hijriParts: hijriParts, CODES: CODES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.Attendance = API;
})(typeof window !== "undefined" ? window : this);
