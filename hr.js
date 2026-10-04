/* Saudi HR / payroll calculation engine (vanilla JS, ES2018, no deps).
   Rules: HRIS_DESIGN.md §4. API: HR_SPEC.md. Every value marked UNCERTAIN in the design lives in DEFAULT_HR. */
(function (root) {
  'use strict';

  var DEFAULT_HR = {
    gosi: {
      SAUDI_LEGACY: { ee: 0.0975, er: 0.1175 },
      // New entrants (first contribution on/after 2024-07-03): dated schedule, HRIS_DESIGN §4.5
      SAUDI_NEW: [
        { from: "2024-07-03", ee: 0.0975, er: 0.1175 },
        { from: "2025-07-01", ee: 0.1025, er: 0.1225 },
        { from: "2026-07-01", ee: 0.1075, er: 0.1275 },
        { from: "2027-07-01", ee: 0.1125, er: 0.1325 },
        { from: "2028-07-01", ee: 0.1175, er: 0.1375 }
      ],
      NONSAUDI: { ee: 0, er: 0.02 },
      GCC: { ee: 0, er: 0.02 },            // UNCERTAIN: GCC extension rules; set per employee manually
      baseMin: 1500,                         // floor applies to Saudis only
      baseMax: 45000,
      newRegimeFrom: "2024-07-03",
      housingInKindFactor: 2 / 12,           // UNCERTAIN: in-kind housing valued at basic x 2/12
      prorateJoiners: false                  // UNCERTAIN: joiners use the full registered base
    },
    workHoursDay: 8,                         // UNCERTAIN (Art. 98: 8 vs 9 h)
    monthDays: 30,                           // UNCERTAIN: 30-day month convention
    proration: "30DAY",                      // "30DAY" | "CALENDAR"
    otRule: "art107",                        // "art107" = hourly actual wage + 50% basic hourly; "simple15" = 1.5 x basic hourly
    bonusAccount: "overtime",                // accounts key the bonus is posted to ("overtime" | "salaries")
    saudizationHalfBelow: 4000,
    saudizationZeroBelow: 3000,              // design §4.10: below 3,000 counts 0
    nitaqatDisabledWeight: 4, nitaqatDisabledCapPct: 0.10, nitaqatPartWeight: 0.5,
    eosbComponents: ["basic", "housing", "transport", "otherAllow"], // UNCERTAIN: W for EOSB/OT
    leavePayComponents: ["basic", "housing", "transport"],          // UNCERTAIN: W for leave pay
    deductionCapPct: 0.5,                    // UNCERTAIN: warn only
    leave: {
      ANNUAL: { daysUnder5: 21, daysFrom5: 30 },
      SICK: { windowDays: 365, tiers: [{ days: 30, pay: 1 }, { days: 60, pay: 0.75 }, { days: 30, pay: 0 }] },
      MATERNITY: 84, PATERNITY: 3, MARRIAGE: 5, BEREAVEMENT: 5, BEREAVEMENT_SIBLING: 3,
      HAJJ: 10, HAJJ_MAX: 15, HAJJ_MIN_SERVICE_YEARS: 2, EXAM: null,
      UNPAID: { suspendAfterDays: 20 }       // days beyond 20 per leave excluded from service and accrual
    },
    mudad: {
      columns: [
        ["idNo", "ID Number"], ["name", "Name"], ["iban", "IBAN"], ["bankCode", "Bank Code"],
        ["basic", "Basic"], ["housing", "Housing"], ["otherEarnings", "Other Earnings"],
        ["deductions", "Deductions"], ["net", "Net"], ["period", "Period"]
      ],
      uncertainNote: "Column order is UNCERTAIN (HRIS_DESIGN 4.9): verify against the current Mudad template before upload"
    },
    accounts: {
      salaries: "Salaries & Wages", housing: "Housing Allowance", transport: "Transport Allowance",
      otherAllow: "Other Allowances", overtime: "Overtime", gosiExp: "GOSI Expense", gosiPay: "GOSI Payable",
      salPay: "Salaries Payable", loansRecv: "Employee Loans & Advances", eosbExp: "End of Service Expense",
      eosbProv: "End of Service Provision", leaveExp: "Leave Expense", leaveProv: "Leave Provision",
      bank: "Bank - Al Rajhi", otherDed: "Other Payroll Deductions"
    }
  };

  var DAY = 86400000;
  var EOSB_REASONS = {
    EMPLOYER_TERMINATION: "Art. 84 (employer termination)", CONTRACT_END: "Art. 84 (contract end)",
    CONTRACT_EXPIRY: "Art. 84 (contract expiry)", MUTUAL: "Art. 84 (mutual, full agreed)",
    ART81: "Art. 81 (employee leaves for employer breach)", FORCE_MAJEURE: "Art. 87 (force majeure)",
    FEMALE_MARRIAGE_CHILDBIRTH: "Art. 87 (female, within 6 months of marriage / 3 months of birth)",
    DEATH: "Art. 87 practice (death) [UNCERTAIN]", DISABILITY: "Art. 87 practice (disability) [UNCERTAIN]",
    RETIREMENT: "Art. 84 (retirement)", RESIGNATION: "Art. 85 (resignation)", ART80: "Art. 80 (dismissal)"
  };

  // ---------- helpers ----------
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function round2(x) {
    x = num(x);
    var r = Math.round(Math.abs(x) * 100 + 1e-7) / 100;
    r = x < 0 ? -r : r;
    return r === 0 ? 0 : r;
  }
  function cents(x) { return Math.round(round2(x) * 100); }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }
  function D(s) {
    if (!s) return NaN;
    s = String(s);
    return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, s.length >= 10 ? +s.slice(8, 10) : 1);
  }
  function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1, 2) + "-" + pad(d.getUTCDate(), 2); }
  function daysBetween(a, b) { return Math.round((D(b) - D(a)) / DAY); }
  function dim(y, m0) { return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate(); }
  function addDays(s, n) { return iso(D(s) + n * DAY); }
  function addYears(s, n) {
    var y = +s.slice(0, 4) + n, m0 = +s.slice(5, 7) - 1, d = +s.slice(8, 10);
    return iso(Date.UTC(y, m0, Math.min(d, dim(y, m0))));
  }
  function periodStart(p) { return String(p).slice(0, 7) + "-01"; }
  function monthEnd(p) { var y = +p.slice(0, 4), m0 = +p.slice(5, 7) - 1; return p.slice(0, 7) + "-" + pad(dim(y, m0), 2); }
  function ymIndex(ym) { return (+ym.slice(0, 4)) * 12 + (+ym.slice(5, 7)) - 1; }
  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
  function merge(base, over) {
    var out = {}, k;
    for (k in base) out[k] = isObj(base[k]) ? merge(base[k], {}) : base[k];
    if (over) for (k in over) out[k] = isObj(over[k]) && isObj(out[k]) ? merge(out[k], over[k]) : over[k];
    return out;
  }
  function C(cfg) { return cfg && cfg.__merged ? cfg : Object.assign(merge(DEFAULT_HR, cfg || {}), { __merged: true }); }
  function H(emp) { return (emp && emp.hr) || {}; }
  function isSaudi(emp) {
    if (!emp) return false;
    if (emp.saudi === true || H(emp).isSaudi === true) return true;
    return /^(sa|sau|saudi|saudi arabia|سعودي|السعودية)$/i.test(String(emp.nationality || "").trim());
  }
  function isActive(e) { return !!e && (e.status === "Active" || e.status === "On Vacation" || !e.status); }
  function comp(emp, key) { var h = H(emp); return num(key === "otherAllow" ? (h.otherAllow != null ? h.otherAllow : h.other) : h[key]); }
  function wage(emp, keys) { return keys.reduce(function (s, k) { return s + comp(emp, k); }, 0); }
  function empName(emp) { return emp.nameEn || emp.nameAr || emp.empNo || ""; }
  function approved(l) { return l && (l.status === "APPROVED" || l.status == null); }
  function forEmp(list, empNo) { return (list || []).filter(function (l) { return l && l.empNo === empNo; }); }
  function leaveDays(from, to) { if (!from || !to) return 0; var n = daysBetween(from, to) + 1; return n > 0 ? n : 0; }
  function leaveLen(l) { return leaveDays(l.from, l.to) || num(l.days); }

  // Day indexes (UTC days since epoch) excluded from service/accrual: unpaid leave days beyond 20 per leave (Art. 116)
  function excludedDays(emp, leaves, cfg) {
    var lim = num(cfg.leave.UNPAID && cfg.leave.UNPAID.suspendAfterDays), set = {};
    forEmp(leaves, emp.empNo).forEach(function (l) {
      if (l.type !== "UNPAID" || !approved(l) || !l.from) return;
      var n = leaveLen(l), s = D(l.from) / DAY;
      for (var i = lim; i < n; i++) set[s + i] = 1;
    });
    return set;
  }
  function countIn(set, a, b) { var c = 0; for (var k in set) if (+k >= a && +k < b) c++; return c; }

  // ---------- service ----------
  function serviceDays(emp, toISO, leaves, cfg) {
    var h = H(emp); toISO = toISO || h.endDate;
    if (!h.hireDate || !toISO) return 0;
    var n = daysBetween(h.hireDate, toISO);
    if (leaves) n -= countIn(excludedDays(emp, leaves, C(cfg)), D(h.hireDate) / DAY, D(toISO) / DAY);
    return n > 0 ? n : 0;
  }
  function serviceYears(emp, toISO, leaves, cfg) { return serviceDays(emp, toISO, leaves, cfg) / 365; }

  // ---------- GOSI ----------
  function gosiRegime(emp, cfg) {
    cfg = C(cfg); var h = H(emp);
    var o = h.gosiRegime || (h.gosi && h.gosi.regime);
    if (o) return o;
    if (!isSaudi(emp)) return "NONSAUDI";
    var d = h.firstContribDate || (h.gosi && h.gosi.firstContribDate) || h.hireDate;
    return d && d < cfg.gosi.newRegimeFrom ? "SAUDI_LEGACY" : "SAUDI_NEW";
  }
  function gosiRates(regime, periodISO, cfg) {
    var r = cfg.gosi[regime];
    if (Array.isArray(r)) {
      var p = periodStart(periodISO), row = r[0];
      r.forEach(function (x) { if (x.from <= p || (x.from.slice(0, 7) === p.slice(0, 7))) row = x; });
      return row;
    }
    return r || { ee: 0, er: 0 };
  }
  function gosi(emp, periodISO, cfg) {
    cfg = C(cfg); var h = H(emp), regime = gosiRegime(emp, cfg);
    var basic = num(h.basic), housing = h.housingInKind ? basic * num(cfg.gosi.housingInKindFactor) : num(h.housing);
    var base = basic + housing;
    if (/^SAUDI/.test(regime)) base = Math.max(base, num(cfg.gosi.baseMin));
    base = round2(Math.min(base, num(cfg.gosi.baseMax)));
    var r = gosiRates(regime, periodISO, cfg);
    return { regime: regime, base: base, ee: round2(base * r.ee), er: round2(base * r.er), eeRate: r.ee, erRate: r.er };
  }

  // ---------- EOSB ----------
  function eosb(emp, toISO, reason, cfg, leaves) {
    cfg = C(cfg); var h = H(emp);
    toISO = toISO || h.endDate; reason = reason || h.endReason || "EMPLOYER_TERMINATION";
    if (!EOSB_REASONS[reason]) throw new Error("eosb: unknown reason " + reason);
    var days = serviceDays(emp, toISO, leaves, cfg), Y = days / 365;
    var W = round2(wage(emp, cfg.eosbComponents));
    var full = round2(W * (0.5 * Math.min(Y, 5) + Math.max(Y - 5, 0)));
    var factor = 1, ex = [];
    ex.push("Service " + h.hireDate + " to " + toISO + " = " + days + " days = " + Y.toFixed(3) + " years");
    ex.push("Wage W (" + cfg.eosbComponents.join(" + ") + ") = " + W.toFixed(2));
    ex.push("Art. 84 full = W x (0.5 x " + Math.min(Y, 5).toFixed(3) + " + 1.0 x " + Math.max(Y - 5, 0).toFixed(3) + ") = " + full.toFixed(2));
    if (reason === "ART80") factor = 0;
    else if (reason === "RESIGNATION") factor = Y < 2 ? 0 : Y <= 5 ? 1 / 3 : Y < 10 ? 2 / 3 : 1;
    var fs = factor === 1 / 3 ? "1/3" : factor === 2 / 3 ? "2/3" : String(factor);
    ex.push(EOSB_REASONS[reason] + ": factor " + fs);
    var amount = round2(full * factor);
    ex.push("EOSB = " + full.toFixed(2) + " x " + fs + " = " + amount.toFixed(2));
    return { years: Y, days: days, wage: W, full: full, factor: factor, amount: amount, reason: reason, explanation: ex };
  }
  function eosbProvision(emps, asOfISO, cfg, leaves) {
    cfg = C(cfg); var rows = [], tot = 0;
    (emps || []).forEach(function (e) {
      var h = H(e);
      if (!isActive(e) || !(num(h.basic) > 0) || !h.hireDate || h.hireDate > asOfISO) return;
      if (h.endDate && h.endDate < asOfISO) return;
      var r = eosb(e, asOfISO, "EMPLOYER_TERMINATION", cfg, leaves);
      rows.push({ empNo: e.empNo, years: r.years, amount: r.full });
      tot += cents(r.full);
    });
    return { asOf: asOfISO, rows: rows, total: tot / 100 };
  }

  // ---------- leave ----------
  function fiveYearDate(emp, ex) {
    var h = H(emp), d = addYears(h.hireDate, 5), shift = 0;
    for (var i = 0; i < 10; i++) {
      var s = countIn(ex, D(h.hireDate) / DAY, D(d) / DAY + shift);
      if (s === shift) break; shift = s;
    }
    return addDays(d, shift);
  }
  function leaveBalance(emp, leaves, asOfISO, cfg) {
    cfg = C(cfg); var h = H(emp), A = cfg.leave.ANNUAL, ex = excludedDays(emp, leaves, cfg);
    var res = { entitlementPerYear: A.daysUnder5, accrued: 0, taken: 0, opening: num(h.annualLeaveOpening), balance: 0,
      valuePerDay: round2(wage(emp, cfg.leavePayComponents) / num(cfg.monthDays)), liability: 0 };
    if (!h.hireDate) return res;
    var five = fiveYearDate(emp, ex);
    res.entitlementPerYear = asOfISO >= five ? A.daysFrom5 : A.daysUnder5;
    var start = h.hireDate;
    if (h.openingAsOf && addDays(h.openingAsOf, 1) > start) start = addDays(h.openingAsOf, 1);
    var acc = 0, end = D(asOfISO);
    for (var t = D(start); t <= end; t += DAY) {
      if (ex[t / DAY]) continue;
      var d = new Date(t), ent = iso(t) >= five ? A.daysFrom5 : A.daysUnder5;
      acc += ent / 12 / dim(d.getUTCFullYear(), d.getUTCMonth());
    }
    var taken = 0;
    forEmp(leaves, emp.empNo).forEach(function (l) {
      if (l.type !== "ANNUAL" || !approved(l) || !l.from) return;
      var a = l.from > start ? l.from : start, b = l.to && l.to < asOfISO ? l.to : asOfISO;
      if (!l.to) { taken += l.from >= start && l.from <= asOfISO ? num(l.days) : 0; return; }
      taken += leaveDays(a, b);
    });
    res.accrued = Math.round(acc * 10000) / 10000;
    res.taken = taken;
    res.balance = Math.round((res.opening + acc - taken) * 10000) / 10000;
    res.liability = round2(res.balance * wage(emp, cfg.leavePayComponents) / num(cfg.monthDays));
    res.thirtyDayFrom = five;
    return res;
  }

  // Day-by-day Art. 117 allocation of all approved sick days (+ optional request). Returns {dayIdx: tierIdx}
  function sickAllocation(emp, leaves, req, cfg) {
    var S = cfg.leave.SICK, days = {}, list = forEmp(leaves, emp.empNo).filter(function (l) {
      return l.type === "SICK" && approved(l) && l.from && !(req && req.id != null && l.id === req.id);
    });
    if (req) list.push(req);
    list.forEach(function (l) { var s = D(l.from) / DAY, n = leaveLen(l); for (var i = 0; i < n; i++) days[s + i] = 1; });
    var keys = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
    var out = {}, cycle = null, used = 0, starts = {};
    keys.forEach(function (k) {
      if (cycle === null || k >= cycle + num(S.windowDays)) { cycle = k; used = 0; }
      var tier = 0, cum = 0;
      for (tier = 0; tier < S.tiers.length; tier++) { cum += S.tiers[tier].days; if (used < cum) break; }
      out[k] = tier; starts[k] = cycle; used++;
    });
    return { tier: out, cycleStart: starts };
  }
  function tierPay(cfg, t) { var T = cfg.leave.SICK.tiers; return t < T.length ? T[t].pay : 0; }
  function sickPay(emp, leaves, req, cfg) {
    cfg = C(cfg);
    var al = sickAllocation(emp, leaves, req, cfg), s = D(req.from) / DAY, n = leaveLen(req);
    var dayRate = wage(emp, cfg.eosbComponents) / num(cfg.monthDays);
    var r = { days: n, full: 0, t75: 0, unpaid: 0, beyond: 0, cycleStart: iso(al.cycleStart[s] * DAY), usedBefore: 0,
      dayRate: round2(dayRate), deduction: 0 };
    var cs = al.cycleStart[s];
    for (var k in al.tier) if (+k < s && al.cycleStart[k] === cs) r.usedBefore++;
    var ded = 0;
    for (var i = 0; i < n; i++) {
      var t = al.tier[s + i];
      if (t === 0) r.full++; else if (t === 1) r.t75++; else if (t === 2) r.unpaid++; else r.beyond++;
      ded += dayRate * (1 - tierPay(cfg, t));
    }
    r.deduction = round2(ded);
    r.explanation = ["Cycle from " + r.cycleStart + ", " + r.usedBefore + " sick day(s) used before this request",
      r.full + " day(s) full pay, " + r.t75 + " at 75%, " + (r.unpaid + r.beyond) + " unpaid" + (r.beyond ? " (" + r.beyond + " beyond the 120-day statutory tiers)" : ""),
      "Deduction = " + r.t75 + " x " + r.dayRate.toFixed(2) + " x 0.25 + " + (r.unpaid + r.beyond) + " x " + r.dayRate.toFixed(2) + " = " + r.deduction.toFixed(2)];
    return r;
  }

  // ---------- payroll ----------
  function paidDays(emp, pStart, pEnd, cfg) {
    var h = H(emp), y = +pStart.slice(0, 4), m0 = +pStart.slice(5, 7) - 1, n = dim(y, m0);
    var s = h.hireDate && h.hireDate > pStart ? h.hireDate : pStart;
    var e = h.endDate && h.endDate < pEnd ? h.endDate : pEnd;
    if (s > e) return { days: 0, basis: cfg.proration === "CALENDAR" ? n : 30 };
    if (cfg.proration === "CALENDAR") return { days: daysBetween(s, e) + 1, basis: n };
    if (s === pStart && e === pEnd) return { days: 30, basis: 30 };
    var sd = Math.min(+s.slice(8, 10), 30), ed = e === pEnd ? 30 : Math.min(+e.slice(8, 10), 30);
    return { days: Math.max(ed - sd + 1, 0), basis: 30 };
  }
  function loanInstalment(loan, ym) {
    if (/closed|paid|settled|cancel|reject|pending/i.test(loan.status || "")) return 0;
    if (!loan.startPeriod) return 0;
    var deferred = loan.deferredPeriods || [];
    if (deferred.indexOf(ym) >= 0) return 0;
    var el = ymIndex(ym) - ymIndex(loan.startPeriod.slice(0, 7));
    if (el < 0) return 0;
    el -= deferred.filter(function (p) { return p >= loan.startPeriod.slice(0, 7) && p < ym; }).length;
    var rem = num(loan.amount) - Math.min(num(loan.amount), num(loan.monthly) * el);
    return round2(Math.max(0, Math.min(num(loan.monthly), rem)));
  }
  function validIBAN(iban) {
    iban = String(iban || "").replace(/\s+/g, "").toUpperCase();
    if (!/^SA\d{22}$/.test(iban)) return false;
    var s = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); });
    var r = 0; for (var i = 0; i < s.length; i++) r = (r * 10 + +s[i]) % 97;
    return r === 1;
  }
  function payroll(emps, periodISO, data, cfg) {
    cfg = C(cfg); data = data || {};
    var pStart = periodStart(periodISO), pEnd = monthEnd(pStart), ym = pStart.slice(0, 7);
    var inputs = data.inputs || {}, lines = [], warnings = [];
    function warn(empNo, code, msg) { warnings.push({ empNo: empNo, code: code, message: msg }); }
    (emps || []).forEach(function (e) {
      var h = H(e);
      if (!h.hireDate || h.hireDate > pEnd) return;
      if (h.endDate && h.endDate < pStart) return;
      var leaverThisMonth = h.endDate && h.endDate >= pStart && h.endDate <= pEnd;
      if (!isActive(e) && !leaverThisMonth) return;
      if (num(h.basic) < 0) { warn(e.empNo, "BASIC_NEGATIVE", empName(e) + ": basic salary is negative; excluded"); return; }
      if (!(num(h.basic) > 0)) return;
      var pd = paidDays(e, pStart, pEnd, cfg), f = pd.days / pd.basis;
      var inp = inputs[e.empNo] || {};
      var mBasic = num(h.basic), mHousing = h.housingInKind ? 0 : num(h.housing), mTransport = num(h.transport), mOther = comp(e, "otherAllow");
      var basic = round2(mBasic * f), housing = round2(mHousing * f), transport = round2(mTransport * f), otherAllow = round2(mOther * f);
      var fixed = round2(basic + housing + transport + otherAllow);
      var hours = num(cfg.monthDays) * num(cfg.workHoursDay);
      var otRate = cfg.otRule === "simple15" ? 1.5 * mBasic / hours : wage(e, cfg.eosbComponents) / hours + 0.5 * mBasic / hours;
      var ot = round2(num(inp.otHours) * otRate), bonus = round2(inp.bonus);
      var gross = round2(fixed + ot + bonus);
      var g = gosi(e, pStart, cfg);
      var gosiEe = g.ee, gosiEr = g.er;
      if (cfg.gosi.prorateJoiners && pd.days < pd.basis) { gosiEe = round2(gosiEe * f); gosiEr = round2(gosiEr * f); }
      var dayRate = (mBasic + mHousing + mTransport + mOther) / num(cfg.monthDays);
      var absence = round2(num(inp.absenceDays) * dayRate);
      // unpaid leave days inside the period and employment
      var eS = h.hireDate > pStart ? h.hireDate : pStart, eE = h.endDate && h.endDate < pEnd ? h.endDate : pEnd, ul = 0;
      forEmp(data.leaves, e.empNo).forEach(function (l) {
        if (l.type !== "UNPAID" || !approved(l) || !l.from) return;
        var to = l.to || addDays(l.from, num(l.days) - 1);
        var a = l.from > eS ? l.from : eS, b = to < eE ? to : eE;
        if (a <= b) ul += leaveDays(a, b);
      });
      ul = Math.min(ul, pd.days);
      var unpaidLeave = round2(ul * dayRate);
      // sick deduction for the period (Art. 117 tiers, rolling window)
      var al = sickAllocation(e, data.leaves, null, cfg), sick = 0, a0 = D(eS) / DAY, a1 = D(eE) / DAY;
      for (var k in al.tier) if (+k >= a0 && +k <= a1) sick += dayRate * (1 - tierPay(cfg, al.tier[k]));
      var sickDeduction = round2(sick);
      var dayDed = absence + unpaidLeave + sickDeduction;
      if (dayDed > fixed) {           // never deduct more day-based pay than was earned
        var sc = fixed / dayDed; absence = round2(absence * sc); unpaidLeave = round2(unpaidLeave * sc);
        sickDeduction = round2(fixed - absence - unpaidLeave);
      }
      var loan = 0;
      forEmp(data.loans, e.empNo).forEach(function (l) { loan += loanInstalment(l, ym); });
      loan = round2(loan);
      var otherDeduction = round2(inp.otherDeduction);
      var deductions = round2(gosiEe + absence + unpaidLeave + sickDeduction + loan + otherDeduction);
      var net = round2(gross - deductions);
      var iban = h.iban || (h.bank && h.bank.iban) || "";
      if (!iban) warn(e.empNo, "IBAN_MISSING", empName(e) + ": IBAN missing");
      else if (!validIBAN(iban)) warn(e.empNo, "IBAN_INVALID", empName(e) + ": IBAN fails SA/mod-97 check");
      if (net < 0) warn(e.empNo, "NET_NEGATIVE", empName(e) + ": net pay is negative (" + net.toFixed(2) + ")");
      var capBase = wage(e, cfg.eosbComponents) * f;
      if (capBase > 0 && loan + otherDeduction + absence > num(cfg.deductionCapPct) * capBase)
        warn(e.empNo, "DEDUCTION_CAP", empName(e) + ": deductions exceed " + (num(cfg.deductionCapPct) * 100) + "% of wage (consent needed)");
      if (g.regime === "GCC") warn(e.empNo, "GOSI_GCC", empName(e) + ": GCC GOSI rates are UNCERTAIN; verify");
      lines.push({ empNo: e.empNo, name: empName(e), idNo: (isSaudi(e) ? (e.nationalId || e.iqamaNo) : (e.iqamaNo || e.nationalId)) || "",
        department: e.department || h.orgUnitId || "", days: pd.days,
        basic: basic, housing: housing, transport: transport, otherAllow: otherAllow, ot: ot, bonus: bonus, gross: gross,
        gosiRegime: g.regime, gosiBase: g.base, gosiEe: gosiEe, gosiEr: gosiEr, absence: absence, unpaidLeave: unpaidLeave,
        sickDeduction: sickDeduction, loan: loan, otherDeduction: otherDeduction, deductions: deductions, net: net,
        iban: iban, bankName: h.bankName || "", note: inp.note || "" });
    });
    var keys = ["days", "basic", "housing", "transport", "otherAllow", "ot", "bonus", "gross", "gosiEe", "gosiEr", "absence",
      "unpaidLeave", "sickDeduction", "loan", "otherDeduction", "deductions", "net"], totals = { count: lines.length };
    keys.forEach(function (k) { totals[k] = lines.reduce(function (s, l) { return s + cents(l[k]); }, 0) / 100; });
    totals.days = lines.reduce(function (s, l) { return s + l.days; }, 0);
    return { period: ym, periodStart: pStart, periodEnd: pEnd, lines: lines, totals: totals, warnings: warnings };
  }

  // ---------- journals ----------
  function jeLine(cfg, key, amtCents, side, memo, cls) {
    var a = amtCents / 100, dr = side === "D" ? a : -a;
    return { accountKey: key, account: cfg.accounts[key] || key, debit: dr > 0 ? round2(dr) : 0, credit: dr < 0 ? round2(-dr) : 0, memo: memo, cls: cls || "" };
  }
  function payrollJournal(run, cfg) {
    cfg = C(cfg); var memo = "Payroll " + run.period, acc = {}, order = [];
    function add(key, side, c, cls) {
      if (!c) return; var id = key + "|" + side + "|" + cls;
      if (!acc[id]) { acc[id] = { key: key, side: side, cls: cls, c: 0 }; order.push(id); }
      acc[id].c += c;
    }
    var earn = ["salaries", "housing", "transport", "otherAllow"], field = { salaries: "basic", housing: "housing", transport: "transport", otherAllow: "otherAllow" };
    run.lines.forEach(function (l) {
      var cls = l.department || "", parts = earn.map(function (k) { return cents(l[field[k]]); });
      var tot = parts.reduce(function (s, x) { return s + x; }, 0), red = cents(l.absence) + cents(l.unpaidLeave) + cents(l.sickDeduction);
      // absence / unpaid / sick reduce the earning lines proportionally (post net earnings)
      var left = red, last = -1;
      parts.forEach(function (p, i) { if (p) last = i; });
      var net = parts.map(function (p, i) {
        if (!tot || !p) return p;
        var r = i === last ? left : Math.round(red * p / tot); left -= r; return p - r;
      });
      if (!tot && red) net[0] -= red;
      earn.forEach(function (k, i) { add(k, "D", net[i], cls); });
      add("overtime", "D", cents(l.ot), cls);
      add(cfg.bonusAccount || "overtime", "D", cents(l.bonus), cls);
      add("gosiExp", "D", cents(l.gosiEr), cls);
      add("gosiPay", "C", cents(l.gosiEe) + cents(l.gosiEr), cls);
      add("loansRecv", "C", cents(l.loan), cls);
      add("otherDed", "C", cents(l.otherDeduction), cls);
      add("salPay", "C", cents(l.net), cls);
    });
    var lines = order.map(function (id) { var x = acc[id]; return jeLine(cfg, x.key, x.c, x.side, memo, x.cls); })
      .filter(function (x) { return x.debit || x.credit; });
    var dr = lines.reduce(function (s, x) { return s + cents(x.debit); }, 0), cr = lines.reduce(function (s, x) { return s + cents(x.credit); }, 0);
    var entry = { jeNo: "PAY-" + run.period, date: monthEnd(run.period + "-01"), memo: memo, lines: lines, totalDebit: dr / 100, totalCredit: cr / 100 };
    return { entries: [entry], balanced: dr === cr };
  }
  function eosbJournal(prev, curr, monthISO, cfg) {
    cfg = C(cfg);
    var p = typeof prev === "number" ? prev : num(prev && prev.total), c = typeof curr === "number" ? curr : num(curr && curr.total);
    var d = cents(c) - cents(p), ym = String(monthISO).slice(0, 7), memo = "EOSB provision " + ym + (d < 0 ? " (release)" : "");
    var lines = d ? [jeLine(cfg, "eosbExp", d, "D", memo, ""), jeLine(cfg, "eosbProv", d, "C", memo, "")] : [];
    if (d < 0) lines.reverse();
    return { jeNo: "EOSB-" + ym, date: monthEnd(ym + "-01"), memo: memo, amount: d / 100, lines: lines, balanced: true };
  }

  // ---------- Mudad / WPS ----------
  function csvCell(v) { v = v == null ? "" : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function mudadCSV(run, cfg, company) {
    cfg = C(cfg); var cols = cfg.mudad.columns, out = [];
    if (cfg.mudad.uncertainNote) out.push("# " + cfg.mudad.uncertainNote + (company && company.name ? " | " + company.name : "") +
      (company && company.molNo ? " | MOL " + company.molNo : ""));
    out.push(cols.map(function (c) { return csvCell(c[1]); }).join(","));
    run.lines.forEach(function (l) {
      var iban = String(l.iban || "").replace(/\s+/g, "").toUpperCase();
      var v = { idNo: l.idNo, name: l.name, iban: iban, bankCode: iban.slice(4, 6), basic: l.basic, housing: l.housing,
        transport: l.transport, otherAllow: l.otherAllow,
        otherEarnings: round2(l.transport + l.otherAllow + l.ot + l.bonus), deductions: l.deductions, net: l.net,
        period: run.period, empNo: l.empNo };
      out.push(cols.map(function (c) { var x = v[c[0]]; return csvCell(typeof x === "number" ? x.toFixed(2) : x); }).join(","));
    });
    return out.join("\r\n") + "\r\n";
  }

  // ---------- Nitaqat / headcount ----------
  function nitaqat(emps, cfg) {
    cfg = C(cfg); var act = (emps || []).filter(isActive), rows = [], sw = 0, expats = 0;
    var disabledCap = Math.floor(num(cfg.nitaqatDisabledCapPct) * act.length), disabledUsed = 0;
    act.forEach(function (e) {
      var h = H(e), n = h.nitaqat || {};
      if (!isSaudi(e)) { expats++; rows.push({ empNo: e.empNo, saudi: false, weight: 0, total: 1 }); return; }
      var w = round2(num(h.basic) + num(h.housing) + num(h.transport)), wt, why;
      var documented = h.qiwaDocumented !== false && n.qiwaDocumented !== false;
      if (!documented) { wt = 0; why = "not documented on Qiwa"; }
      else if ((h.disabled || n.disabled) && w >= cfg.saudizationHalfBelow && disabledUsed < disabledCap) { wt = num(cfg.nitaqatDisabledWeight); disabledUsed++; why = "disabled"; }
      else if (h.student || n.student || h.partTime || n.partTime) { wt = num(cfg.nitaqatPartWeight); why = "student / part-time"; }
      else if (w >= cfg.saudizationHalfBelow) { wt = 1; why = "wage >= " + cfg.saudizationHalfBelow; }
      else if (w >= cfg.saudizationZeroBelow) { wt = 0.5; why = "wage below " + cfg.saudizationHalfBelow; }
      else { wt = 0; why = "wage below " + cfg.saudizationZeroBelow; }
      sw += wt;
      rows.push({ empNo: e.empNo, saudi: true, wage: w, weight: wt, reason: why });
    });
    var total = sw + expats;
    return { saudiWeighted: sw, expats: expats, total: total, pct: total ? round2(sw / total * 100) : 0, rows: rows, estimate: true };
  }
  function headcount(emps) {
    var r = { total: 0, active: 0, byNationality: {}, byDepartment: {}, byGender: {}, byStatus: {} };
    function inc(m, k) { k = k || "Unknown"; m[k] = (m[k] || 0) + 1; }
    (emps || []).forEach(function (e) {
      r.total++; inc(r.byStatus, e.status || "Active");
      if (!isActive(e)) return;
      r.active++;
      inc(r.byNationality, isSaudi(e) ? "Saudi" : e.nationality);
      inc(r.byDepartment, e.department || H(e).orgUnitId);
      inc(r.byGender, e.gender);
    });
    return r;
  }

  var HR = {
    DEFAULT_HR: DEFAULT_HR, gosiRegime: gosiRegime, gosi: gosi, serviceDays: serviceDays, serviceYears: serviceYears,
    eosb: eosb, eosbProvision: eosbProvision, leaveBalance: leaveBalance, sickPay: sickPay, leaveDays: leaveDays,
    payroll: payroll, mudadCSV: mudadCSV, payrollJournal: payrollJournal, eosbJournal: eosbJournal,
    nitaqat: nitaqat, headcount: headcount,
    // helpers
    round2: round2, isSaudi: isSaudi, isActive: isActive, validIBAN: validIBAN, loanInstalment: loanInstalment,
    paidDays: function (emp, periodISO, cfg) { cfg = C(cfg); var s = periodStart(periodISO); return paidDays(emp, s, monthEnd(s), cfg); },
    addDays: addDays, daysBetween: daysBetween, EOSB_REASONS: Object.keys(EOSB_REASONS)
  };
  if (typeof module !== "undefined" && module.exports) module.exports = HR;
  root.HR = HR;
})(typeof window !== "undefined" ? window : this);
