/* Rental: lease & prepaid lifecycle engine (vanilla JS, ES2018, no deps).
   Extends lease.js (does not replace it): schedules with escalation / rent-free, renewals, modifications
   (IFRS 16.44-46 remeasurement), terminations, prepaid status, portfolio analytics, alerts, deposits JE, exports. */
(function (root) {
  'use strict';

  var DEFAULT_SETTINGS = {
    leaseStandard: "prepaid",
    defaultIbr: 0.065,
    vatRate: 0.15,
    installmentReminderDays: [30, 14, 7, 0],
    leaseEndReminderDays: [180, 90, 60, 30],
    rentReviewReminderDays: [60, 30],
    noticeReminderDays: [90, 60, 30, 14, 7, 0],
    depositRefundGraceDays: 30,
    accounts: {
      bank: "Bank - Al Rajhi",
      prepaidRent: "Prepaid Rent",
      rentExp: "Rent Expense",
      inputVat: "VAT Input (Recoverable)",
      securityDeposits: "Security Deposits (Refundable)",
      rouAsset: "Right-of-use Assets",
      leaseLiab: "Lease Liabilities",
      leaseModGain: "Gain/Loss on Lease Modification"
    }
  };
  var DAY = 86400000;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var FREQ_MONTHS = { "Annual": 12, "Semi-annual": 6, "Quarterly": 3, "Monthly": 1 };
  var SEV_RANK = { expired: 0, critical: 1, warning: 2, notice: 3, info: 4 };
  var CLOSED = { Terminated: 1, Expired: 1 };

  // ---------- helpers ----------
  function round2(x) {
    x = Number(x) || 0;
    var r = Math.round(Math.abs(x) * 100 + 1e-7) / 100;
    r = x < 0 ? -r : r;
    return r === 0 ? 0 : r;
  }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }
  function S(settings) {
    var s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    s.accounts = Object.assign({}, DEFAULT_SETTINGS.accounts, (settings && settings.accounts) || {});
    return s;
  }
  function parseISO(s) {
    if (typeof s !== "string") return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return NaN;
    var ms = Date.UTC(y, mo - 1, d), dt = new Date(ms);
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return ms;
  }
  function iso(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return "";
    var d = new Date(ms);
    return pad(d.getUTCFullYear(), 4) + "-" + pad(d.getUTCMonth() + 1, 2) + "-" + pad(d.getUTCDate(), 2);
  }
  function valid(s) { return !isNaN(parseISO(s)); }
  function addDays(s, n) { var ms = parseISO(s); return isNaN(ms) ? "" : iso(ms + Math.round(num(n)) * DAY); }
  function addMonths(s, n) {
    var ms = parseISO(s); if (isNaN(ms)) return "";
    var d = new Date(ms);
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + Math.round(num(n)), day = d.getUTCDate();
    var ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return iso(Date.UTC(ty, tm, Math.min(day, last)));
  }
  function daysBetween(a, b) {
    var x = parseISO(a), y = parseISO(b);
    if (isNaN(x) || isNaN(y)) return NaN;
    return Math.round((y - x) / DAY);
  }
  function monthStart(s) { return valid(s) ? s.slice(0, 8) + "01" : ""; }
  function monthEnd(s) {
    var ms = parseISO(s); if (isNaN(ms)) return "";
    var d = new Date(ms);
    return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  }
  function todayISO() {
    var d = new Date();
    return pad(d.getFullYear(), 4) + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2);
  }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function minISO(a, b) { return a < b ? a : b; }
  function maxISO(a, b) { return a > b ? a : b; }
  function sumBy(arr, f) { var t = 0; (arr || []).forEach(function (x) { t += num(f(x)); }); return round2(t); }
  function pctOf(p) { p = num(p); return Math.abs(p) > 1 ? p / 100 : p; }
  function isLease(c) { return !!c && (c.category === "Branch Rent" || (!!c.model && c.model !== "")); }
  function catOf(c) { return isLease(c) ? "Lease" : "Prepaid"; }
  function freqMonths(f) { return FREQ_MONTHS[f] || (num(f) > 0 ? Math.round(num(f)) : 12); }
  function termDays(c) {
    var d = daysBetween(c && c.startDate, c && c.endDate);
    return isNaN(d) ? 0 : Math.max(0, d + 1);
  }
  function termMonths(c) {
    var T = termDays(c); if (!T) return 0;
    for (var n = 1; n <= 1200; n++) {
      var e = addDays(addMonths(c.startDate, n), -1);
      if (e === c.endDate) return n;
      if (e > c.endDate) break;
    }
    return T * 12 / 365;
  }
  function ibrOf(c, s) { return c && c.ibr !== undefined && c.ibr !== null && c.ibr !== "" ? num(c.ibr) : num(s.defaultIbr); }
  function resolveModel(c, settings) {
    var s = S(settings), m = c && c.model;
    if (m === "prepaid" || m === "straightline" || m === "ifrs16") return m;
    var T = termDays(c || {});
    if (T <= 365 || (valid(c.startDate) && c.endDate < addMonths(c.startDate, 12))) return "prepaid";
    return s.leaseStandard === "straightline" || s.leaseStandard === "ifrs16" ? s.leaseStandard : "prepaid";
  }
  function areaOf(c) { return num((c.property && c.property.areaSqm) || c.areaSqm); }
  function cityOf(c) { return (c.property && c.property.city) || c.city || ""; }
  function landlordOf(c) { return (c.landlord && c.landlord.name) || c.vendor || ""; }
  function overlapDays(a1, a2, b1, b2) {
    var s = maxISO(a1, b1), e = minISO(a2, b2);
    return e < s ? 0 : daysBetween(s, e) + 1;
  }
  function nextEventId(c) { return (c.id || "C") + "-EV" + pad(((c.events || []).length) + 1, 3); }
  function installmentsOf(c) { return (c && c.installments) || []; }

  // ---------- rent & escalation ----------
  function baseAnnualRent(c) {
    if (num(c.annualRent) > 0) return num(c.annualRent);
    var e = c.escalation || {};
    if (e.type === "step" && e.steps && e.steps.length) {
      var st = e.steps.slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; });
      if (st[0].from <= c.startDate) return num(st[0].annualRent);
    }
    var m = termMonths(c);
    return m ? num(c.totalAmount) * 12 / m : 0;
  }
  function escType(c) { var t = c && c.escalation && c.escalation.type; return t || "none"; }
  function anniversaries(c) {
    var e = c.escalation || {}, t = escType(c), out = [];
    if (!valid(c.startDate) || !valid(c.endDate)) return out;
    if (t === "fixed_pct" || t === "fixed_amount" || t === "cpi") {
      var first = valid(e.firstOn) ? e.firstOn : addMonths(c.startDate, 12);
      var every = num(e.everyYears) > 0 ? Math.round(num(e.everyYears)) : 1;
      for (var k = 0; k < 200; k++) {
        var d = addMonths(first, 12 * every * k);
        if (d > c.endDate) break;
        out.push(d);
      }
    } else if (t === "step") {
      (e.steps || []).forEach(function (s) { if (valid(s.from) && s.from > c.startDate && s.from <= c.endDate) out.push(s.from); });
      out.sort();
    }
    return out;
  }
  // rent overrides (steps + rent reviews from modifications), sorted; reviews win ties
  function overrides(c) {
    var o = [];
    if (escType(c) === "step") (c.escalation.steps || []).forEach(function (s) { if (valid(s.from)) o.push({ from: s.from, annualRent: num(s.annualRent), r: 0 }); });
    (c.rentReviews || []).forEach(function (s) { if (valid(s.from)) o.push({ from: s.from, annualRent: num(s.annualRent), r: 1 }); });
    o.sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : a.r - b.r; });
    return o;
  }
  function annualRentRaw(c, dateISO) {
    c = c || {};
    var rent = baseAnnualRent(c), anchor = c.startDate || "";
    overrides(c).forEach(function (o) { if (o.from <= dateISO) { rent = o.annualRent; anchor = o.from; } });
    var t = escType(c);
    if (t === "fixed_pct" || t === "fixed_amount" || t === "cpi") {
      var n = 0;
      anniversaries(c).forEach(function (a) { if (a > anchor && a <= dateISO) n++; });
      if (t === "fixed_amount") rent += n * num(c.escalation.amount);
      else rent *= Math.pow(1 + pctOf(c.escalation.pct), n); // cpi: escalation.pct holds the assumed/actual CPI rate
    }
    return rent;
  }
  function annualRentAt(contract, dateISO) { return round2(annualRentRaw(contract, dateISO || (contract && contract.startDate))); }

  // ---------- schedule ----------
  function generateSchedule(contract, opts) {
    var c = contract || {}, s = S(opts);
    if (c.customSchedule) return clone(installmentsOf(c));
    var start = c.startDate, end = c.endDate;
    if (!valid(start) || !valid(end) || end < start) return [];
    var n = freqMonths(c.frequency), T = termDays(c);
    var simple = !(num(c.annualRent) > 0) && escType(c) === "none" && !(c.rentReviews && c.rentReviews.length);
    var existing = {};
    if (!opts || opts.preserve !== false) installmentsOf(c).forEach(function (i) { if (i.periodStart) existing[i.periodStart] = i; });
    var rows = [], k = 0, exact = 0;
    while (k < 1200) {
      var ps = addMonths(start, k * n);
      if (ps > end) break;
      var full = addDays(addMonths(start, (k + 1) * n), -1), pe = minISO(full, end);
      var pDays = daysBetween(ps, pe) + 1, fullDays = daysBetween(ps, full) + 1;
      var gross = simple ? num(c.totalAmount) * pDays / T : annualRentRaw(c, ps) * n / 12 * (pDays / fullDays);
      var free = 0;
      (c.rentFree || []).forEach(function (r) { if (valid(r.from) && valid(r.to)) free += overlapDays(ps, pe, r.from, r.to); });
      free = Math.min(free, pDays);
      var amt = gross * (1 - free / pDays);
      exact += amt;
      rows.push({ no: k + 1, periodStart: ps, periodEnd: pe, raw: amt, free: free });
      k++;
    }
    var running = 0, target = round2(exact);
    return rows.map(function (r, idx) {
      var amt = idx === rows.length - 1 ? round2(target - running) : round2(r.raw);
      running = round2(running + amt);
      var ex = existing[r.periodStart] || {};
      var it = { no: r.no, dueDate: ex.dueDate || r.periodStart, periodStart: r.periodStart, periodEnd: r.periodEnd,
        amount: amt, vat: c.vatApplicable ? round2(amt * num(s.vatRate)) : 0,
        paidDate: ex.paidDate || "", paymentRef: ex.paymentRef || "" };
      if (r.free) it.rentFreeDays = r.free;
      return it;
    });
  }
  function scheduleOf(c, s) { return installmentsOf(c).length ? installmentsOf(c) : generateSchedule(c, s); }
  function effectiveMonthlyCost(contract) {
    var c = contract || {}, T = termDays(c);
    if (!T) return 0;
    return round2(sumBy(scheduleOf(c), function (i) { return i.amount; }) / T * 365 / 12);
  }

  // ---------- IFRS 16 helpers (same conventions as lease.js) ----------
  function payList(c) {
    return installmentsOf(c).filter(function (i) { return valid(i.dueDate); })
      .map(function (i) { return { no: i.no, date: i.dueDate, amount: num(i.amount), paidDate: valid(i.paidDate) ? i.paidDate : "" }; });
  }
  function pvAt(pays, refISO, r) { // PV at start of refISO of payments due on/after refISO
    var pv = 0;
    pays.forEach(function (p) { if (p.date >= refISO) pv += p.amount / Math.pow(1 + r, daysBetween(refISO, p.date) / 365); });
    return pv;
  }
  function initialRecognition(contract, settings) {
    var c = contract || {}, s = S(settings);
    if (c.ifrs16Initial) return c.ifrs16Initial;
    var r = ibrOf(c, s), pv = 0;
    payList(c).forEach(function (p) { pv += p.amount / Math.pow(1 + r, Math.max(0, daysBetween(c.startDate, p.date)) / 365); });
    var pvR = round2(pv);
    return { pv: pvR, rouInitial: round2(pvR + round2(num(c.initialDirectCosts)) - round2(num(c.incentives))),
      commencement: c.startDate, endDate: c.endDate, ibr: r };
  }
  // liability at END of dateISO: PV (current ibr) of payments due after dateISO not already paid by then
  function liabilityAt(contract, settings, dateISO) {
    var c = contract || {}, s = S(settings);
    if (!valid(dateISO) || !valid(c.startDate) || dateISO < c.startDate || dateISO >= c.endDate) return 0;
    var pays = payList(c).filter(function (p) { return !(p.paidDate && p.paidDate <= dateISO); });
    return round2(pvAt(pays, addDays(dateISO, 1), ibrOf(c, s)));
  }
  // ROU NBV at END of dateISO (straight-line daily, honouring remeasurement adjustments)
  function rouNbvAt(contract, settings, dateISO) {
    var c = contract || {};
    if (!valid(dateISO) || !valid(c.startDate) || dateISO < c.startDate) return 0;
    var init = initialRecognition(c, settings), base = init.rouInitial, from = c.startDate, to = init.endDate || c.endDate;
    (c.ifrs16Adjustments || []).forEach(function (a) {
      if (a.date <= dateISO) { base = num(a.rouNbvAfter); from = a.date; to = a.endDate; }
    });
    var T = daysBetween(from, to) + 1; if (!(T > 0)) return 0;
    var d = clamp(daysBetween(from, dateISO) + 1, 0, T);
    return d >= T ? 0 : round2(base - base * d / T);
  }

  // ---------- lifecycle ----------
  function nextRenewalId(id) {
    id = id || "CON";
    var m = /^(.*)-R(\d+)$/.exec(id);
    return m ? m[1] + "-R" + (+m[2] + 1) : id + "-R1";
  }
  function renew(contract, o) {
    o = o || {};
    var c = contract;
    if (!c || !valid(c.endDate)) throw new Error("renew: contract with a valid endDate required");
    var years = num(o.years) || num(c.options && c.options.renewal && c.options.renewal.years) || 1;
    var start = valid(o.startDate) ? o.startDate : addDays(c.endDate, 1);
    var end = addDays(addMonths(start, Math.round(years * 12)), -1);
    var rent = num(o.newAnnualRent) > 0 ? num(o.newAnnualRent) : round2(annualRentRaw(c, c.endDate) * (1 + pctOf(o.pctIncrease)));
    var nc = clone(c);
    ["renewedTo", "terminationDate", "originalEndDate", "ifrs16Initial", "ifrs16Adjustments", "rentReviews", "installments"].forEach(function (k) { delete nc[k]; });
    nc.id = nextRenewalId(c.id);
    nc.renewedFrom = c.id;
    nc.startDate = start; nc.endDate = end; nc.annualRent = rent;
    nc.frequency = o.frequency || c.frequency;
    nc.rentFree = o.rentFree || [];
    nc.customSchedule = false;
    if (escType(c) === "step") nc.escalation = { type: "none" };
    else if (nc.escalation) delete nc.escalation.firstOn;
    if (o.escalation) nc.escalation = o.escalation;
    nc.status = "Active";
    nc.documents = [];
    nc.installments = generateSchedule(nc, o.settings || { vatRate: o.vatRate !== undefined ? o.vatRate : DEFAULT_SETTINGS.vatRate });
    nc.totalAmount = sumBy(nc.installments, function (i) { return i.amount; });
    var date = valid(o.date) ? o.date : todayISO();
    var details = { newContractId: nc.id, years: years, startDate: start, endDate: end, previousAnnualRent: annualRentAt(c, c.endDate),
      newAnnualRent: rent, frequency: nc.frequency };
    nc.events = [{ id: nc.id + "-EV001", type: "renewal", date: date, by: o.by || "", details: Object.assign({ renewedFrom: c.id }, details) }];
    // original: status + audit event (mutated in place)
    c.events = c.events || [];
    c.events.push({ id: nextEventId(c), type: "renewal", date: date, by: o.by || "", details: details });
    c.status = "Renewed";
    c.renewedTo = nc.id;
    return nc;
  }

  function modify(contract, o, settings) {
    var s = S(settings), c = contract || {};
    o = o || {};
    var eff = o.effectiveDate;
    if (!valid(eff) || !valid(c.startDate) || eff < c.startDate) throw new Error("modify: valid effectiveDate on/after startDate required");
    var oldEnd = c.endDate, newEnd = valid(o.newEndDate) ? o.newEndDate : oldEnd;
    if (newEnd < eff) throw new Error("modify: newEndDate before effectiveDate");
    var nc = clone(c);
    nc.ifrs16Initial = initialRecognition(c, s);
    var rOld = ibrOf(c, s);
    var rNew = o.newIbr !== undefined && o.newIbr !== null && o.newIbr !== "" ? num(o.newIbr) : rOld;
    if (!(num(nc.annualRent) > 0) && !nc.customSchedule) nc.annualRent = round2(baseAnnualRent(c));
    if (num(o.newAnnualRent) > 0) nc.rentReviews = (nc.rentReviews || []).concat([{ from: eff, annualRent: num(o.newAnnualRent) }]);
    nc.endDate = newEnd;
    nc.ibr = rNew;
    var kept, regen;
    if (nc.customSchedule) {
      kept = installmentsOf(c).filter(function (i) { return (i.dueDate || "") <= newEnd; }).map(clone);
      regen = [];
    } else {
      kept = installmentsOf(c).filter(function (i) { return (i.periodStart || i.dueDate) < eff; }).map(clone);
      var maxNo = 0; kept.forEach(function (i) { maxNo = Math.max(maxNo, num(i.no)); });
      regen = generateSchedule(nc, s).filter(function (i) { return i.periodStart >= eff; });
      regen.forEach(function (i, k) { i.no = maxNo + k + 1; });
    }
    nc.installments = kept.concat(regen);
    nc.totalAmount = sumBy(nc.installments, function (i) { return i.amount; });

    // IFRS 16.44-46 remeasurement at effectiveDate
    var liabilityBefore = round2(pvAt(payList(c).filter(function (p) { return !(p.paidDate && p.paidDate < eff); }), eff, rOld));
    var liabilityAfter = round2(pvAt(payList(nc).filter(function (p) { return !(p.paidDate && p.paidDate < eff); }), eff, rNew));
    var rouNbvBefore = rouNbvAt(c, s, addDays(eff, -1));
    var gainLoss = 0, liabScopeReduction = 0, rouScopeReduction = 0;
    if (newEnd < oldEnd) { // decrease in scope (16.46(a)): proportionate derecognition, gain/loss in P&L
      var prop = (daysBetween(eff, newEnd) + 1) / (daysBetween(eff, oldEnd) + 1);
      liabScopeReduction = round2(liabilityBefore * (1 - prop));
      rouScopeReduction = round2(rouNbvBefore * (1 - prop));
      gainLoss = round2(liabScopeReduction - rouScopeReduction);
    }
    var rouAdjustment = round2(liabilityAfter - liabilityBefore + gainLoss);
    if (rouNbvBefore + rouAdjustment < 0) { // ROU cannot go below zero (16.39): excess to P&L
      gainLoss = round2(gainLoss - (rouNbvBefore + rouAdjustment));
      rouAdjustment = round2(-rouNbvBefore);
    }
    var rouNbvAfter = round2(rouNbvBefore + rouAdjustment);
    var A = s.accounts, cls = c.branch || "", memo = "Lease " + c.id + " modification " + eff + (o.reason ? " - " + o.reason : "");
    var dL = round2(liabilityAfter - liabilityBefore), lines = [];
    function ln(key, dr, cr) { if (dr || cr) lines.push({ accountKey: key, account: A[key] || key, debit: round2(dr), credit: round2(cr), memo: memo, cls: cls }); }
    ln("rouAsset", Math.max(0, rouAdjustment), Math.max(0, -rouAdjustment));
    ln("leaseLiab", Math.max(0, -dL), Math.max(0, dL));
    ln("leaseModGain", Math.max(0, -gainLoss), Math.max(0, gainLoss));
    var dr = sumBy(lines, function (l) { return l.debit; }), cr = sumBy(lines, function (l) { return l.credit; });
    nc.ifrs16Adjustments = (nc.ifrs16Adjustments || []).concat([{ date: eff, rouAdjustment: rouAdjustment, rouNbvBefore: rouNbvBefore,
      rouNbvAfter: rouNbvAfter, liabilityBefore: liabilityBefore, liabilityAfter: liabilityAfter, endDate: newEnd, ibr: rNew }]);
    var remeasurement = { date: eff, model: resolveModel(c, s), ibrBefore: rOld, ibrAfter: rNew,
      liabilityBefore: liabilityBefore, liabilityAfter: liabilityAfter, liabilityChange: dL,
      rouNbvBefore: rouNbvBefore, rouAdjustment: rouAdjustment, rouNbvAfter: rouNbvAfter,
      scopeReduction: { liability: liabScopeReduction, rou: rouScopeReduction }, gainLoss: gainLoss,
      journal: { date: eff, memo: memo, lines: lines, balanced: Math.abs(dr - cr) < 0.005 } };
    var event = { id: nextEventId(c), type: "modification", date: valid(o.date) ? o.date : eff, by: o.by || "",
      details: { effectiveDate: eff, reason: o.reason || "", newAnnualRent: num(o.newAnnualRent) || null,
        oldEndDate: oldEnd, newEndDate: newEnd, liabilityBefore: liabilityBefore, liabilityAfter: liabilityAfter,
        rouAdjustment: rouAdjustment, gainLoss: gainLoss },
      newInstallments: clone(regen) };
    nc.events = (nc.events || []).concat([event]);
    return { contract: nc, event: event, ifrs16Remeasurement: remeasurement };
  }

  function depositOutstanding(c) {
    var d = c.deposit; if (!d || !(num(d.amount) > 0)) return 0;
    if (d.status === "refunded" || d.status === "forfeited") return 0;
    return round2(num(d.amount) - num(d.refundedAmount));
  }
  function terminate(contract, o, settings) {
    var s = S(settings), c = contract || {};
    o = o || {};
    var date = o.date;
    if (!valid(date)) throw new Error("terminate: valid date required");
    var nc = clone(c), removed = [];
    nc.installments = installmentsOf(c).filter(function (i) {
      var drop = !valid(i.paidDate) && valid(i.dueDate) && i.dueDate > date;
      if (drop) removed.push(i.no);
      return !drop;
    }).map(clone);
    var refundDue = 0, refundVat = 0;
    installmentsOf(c).forEach(function (i) {
      if (!valid(i.paidDate) || !valid(i.periodStart) || !valid(i.periodEnd) || i.periodEnd <= date) return;
      var tot = daysBetween(i.periodStart, i.periodEnd) + 1;
      var after = daysBetween(maxISO(addDays(date, 1), i.periodStart), i.periodEnd) + 1;
      refundDue += round2(num(i.amount) * after / tot);
      refundVat += round2(num(i.vat) * after / tot);
    });
    refundDue = round2(refundDue); refundVat = round2(refundVat);
    var tOpt = (c.options && c.options.termination) || {};
    var penalty = round2(o.penalty !== undefined && o.penalty !== null && o.penalty !== "" ? num(o.penalty) : num(tOpt.penalty));
    var depositRefund = o.forfeitDeposit ? 0 : depositOutstanding(c);
    var model = resolveModel(c, s);
    var liability = liabilityAt(c, s, date), rouNbv = rouNbvAt(c, s, date);
    var gainLoss = model === "ifrs16" ? round2(liability - rouNbv - penalty) : round2(-penalty);
    nc.status = "Terminated";
    nc.terminationDate = date;
    nc.originalEndDate = c.originalEndDate || c.endDate;
    if (valid(c.endDate) && date < c.endDate) nc.endDate = date;
    var settlement = { date: date, model: model, refundDue: refundDue, refundVat: refundVat, penalty: penalty,
      depositRefund: depositRefund, liability: model === "ifrs16" ? liability : 0, rouNbv: model === "ifrs16" ? rouNbv : 0,
      gainLossOnDerecognition: gainLoss, netCashToReceive: round2(refundDue + refundVat + depositRefund - penalty),
      removedInstallments: removed };
    var event = { id: nextEventId(c), type: "termination", date: date, by: o.by || "",
      details: { reason: o.reason || "", penalty: penalty, refundDue: refundDue, depositRefund: depositRefund,
        gainLossOnDerecognition: gainLoss, removedInstallments: removed, originalEndDate: nc.originalEndDate } };
    nc.events = (nc.events || []).concat([event]);
    return { contract: nc, event: event, settlement: settlement };
  }

  // ---------- prepaid status (engine.js daily catch-up) ----------
  function fraction(start, end, dateISO) {
    var tot = daysBetween(start, end) + 1;
    if (!(tot > 0)) return 1;
    return clamp((daysBetween(start, dateISO) + 1) / tot, 0, 1);
  }
  function prepaidStatus(contract, asOfISO) {
    var paid = 0, exp = 0, accrued = 0;
    installmentsOf(contract).forEach(function (i) {
      var amt = round2(num(i.amount));
      if (!valid(i.periodStart) || !valid(i.periodEnd)) return;
      var f = fraction(i.periodStart, i.periodEnd, asOfISO);
      if (valid(i.paidDate) && i.paidDate <= asOfISO) { paid += amt; exp += round2(amt * f); }
      else accrued += round2(amt * f);
    });
    paid = round2(paid); exp = round2(exp);
    return { asOf: asOfISO, paid: paid, expensedToDate: exp, prepaidBalance: round2(paid - exp), accrued: round2(accrued) };
  }

  // ---------- portfolio analytics ----------
  function inTerm(c, asOf) {
    return !CLOSED[c.status] && c.status !== "Draft" && valid(c.startDate) && valid(c.endDate) && c.startDate <= asOf && asOf <= c.endDate;
  }
  function depositHeldAt(c, asOf) {
    var d = c.deposit; if (!d || !(num(d.amount) > 0)) return 0;
    if (valid(d.paidDate) && d.paidDate > asOf) return 0;
    if ((d.status === "refunded" || d.status === "forfeited") && (!valid(d.refundDate) || d.refundDate <= asOf)) return 0;
    return round2(num(d.amount));
  }
  function annualCost(c, asOf) {
    if (isLease(c)) return annualRentAt(c, asOf);
    var T = termDays(c);
    return T ? round2(sumBy(scheduleOf(c), function (i) { return i.amount; }) / T * 365) : 0;
  }
  function portfolioAnalytics(contracts, asOfISO) {
    var asOf = asOfISO || todayISO(), list = contracts || [];
    var branches = {}, cities = {}, cats = {}, expiry = {};
    var waleNum = 0, waleDen = 0, totalDeposits = 0;
    var com = { next12m: 0, y1to5: 0, beyond5: 0, total: 0 };
    var d12 = addMonths(asOf, 12), d60 = addMonths(asOf, 60);
    list.forEach(function (c) {
      totalDeposits += depositHeldAt(c, asOf);
      if (isLease(c)) installmentsOf(c).forEach(function (i) {
        if (valid(i.paidDate) && i.paidDate <= asOf) return;
        var a = num(i.amount), b = !valid(i.dueDate) || i.dueDate <= d12 ? "next12m" : i.dueDate <= d60 ? "y1to5" : "beyond5";
        com[b] += a; com.total += a;
      });
      if (!inTerm(c, asOf)) return;
      var ann = annualCost(c, asOf), monthly = effectiveMonthlyCost(c);
      var cat = c.category || "Other";
      var ck = cats[cat] || (cats[cat] = { category: cat, count: 0, annualRent: 0, monthlyCost: 0 });
      ck.count++; ck.annualRent += ann; ck.monthlyCost += monthly;
      if (!isLease(c)) return;
      var remYears = (daysBetween(asOf, c.endDate) + 1) / 365, area = areaOf(c);
      waleNum += ann * remYears; waleDen += ann;
      var y = c.endDate.slice(0, 4);
      expiry[y] = round2((expiry[y] || 0) + ann);
      var next = null, overdue = 0;
      installmentsOf(c).forEach(function (i) {
        if (valid(i.paidDate) || !valid(i.dueDate)) return;
        if (i.dueDate < asOf) overdue += num(i.amount) + num(i.vat);
        else if (!next || i.dueDate < next.date) next = { date: i.dueDate, amount: round2(num(i.amount)), vat: round2(num(i.vat)), contractId: c.id };
      });
      var bn = c.branch || "(no branch)";
      var b = branches[bn] || (branches[bn] = { branch: bn, contracts: [], annualRent: 0, monthlyCost: 0, areaSqm: 0, _w: 0,
        nextPayment: null, overdue: 0, depositHeld: 0, city: cityOf(c) });
      b.contracts.push(c.id); b.annualRent += ann; b.monthlyCost += monthly; b.areaSqm += area; b._w += ann * remYears;
      b._rem = Math.max(b._rem || 0, remYears);
      if (next && (!b.nextPayment || next.date < b.nextPayment.date)) b.nextPayment = next;
      b.overdue += overdue; b.depositHeld += depositHeldAt(c, asOf);
      var cn = cityOf(c) || "(no city)";
      var ct = cities[cn] || (cities[cn] = { city: cn, count: 0, annualRent: 0, monthlyCost: 0, areaSqm: 0 });
      ct.count++; ct.annualRent += ann; ct.monthlyCost += monthly; ct.areaSqm += area;
    });
    var byBranch = Object.keys(branches).sort().map(function (k) {
      var b = branches[k];
      return { branch: b.branch, city: b.city, contracts: b.contracts, annualRent: round2(b.annualRent), monthlyCost: round2(b.monthlyCost),
        areaSqm: round2(b.areaSqm), costPerSqm: b.areaSqm ? round2(b.annualRent / b.areaSqm) : null,
        remainingYears: round2(b.annualRent ? b._w / b.annualRent : b._rem || 0), nextPayment: b.nextPayment,
        overdue: round2(b.overdue), depositHeld: round2(b.depositHeld) };
    });
    var byCity = Object.keys(cities).sort().map(function (k) {
      var x = cities[k];
      return { city: x.city, count: x.count, annualRent: round2(x.annualRent), monthlyCost: round2(x.monthlyCost),
        areaSqm: round2(x.areaSqm), costPerSqm: x.areaSqm ? round2(x.annualRent / x.areaSqm) : null };
    });
    var byCategory = Object.keys(cats).sort().map(function (k) {
      var x = cats[k];
      return { category: x.category, count: x.count, annualRent: round2(x.annualRent), monthlyCost: round2(x.monthlyCost) };
    });
    Object.keys(com).forEach(function (k) { com[k] = round2(com[k]); });
    return { asOf: asOf, byBranch: byBranch, byCity: byCity, byCategory: byCategory,
      waleYears: waleDen ? round2(waleNum / waleDen) : 0, expiryProfile: expiry, commitments: com,
      totalDeposits: round2(totalDeposits) };
  }

  // ---------- alerts ----------
  function stageFor(d, thresholds) {
    var best = null;
    (thresholds || []).forEach(function (t) { if (t >= d && (best === null || t < best)) best = t; });
    return best;
  }
  function fmt(d) { return valid(d) ? d.slice(8, 10) + " " + MONTHS[+d.slice(5, 7) - 1] + " " + d.slice(0, 4) : ""; }
  function hasInvoice(c, no) {
    return (c.documents || []).some(function (d) {
      return d && d.kind === "invoice" && (String(d.installmentNo) === String(no) || String(d.ref) === String(no) ||
        String(d.ref) === c.id + "#" + no);
    });
  }
  function reviewDates(c) {
    var out = anniversaries(c).slice();
    (c.rentReviews || []).forEach(function (r) { if (valid(r.from)) out.push(r.from); });
    (c.events || []).forEach(function (e) { if (e && e.type === "rent_review" && valid(e.date)) out.push(e.date); });
    var seen = {};
    return out.filter(function (d) { if (seen[d]) return false; seen[d] = 1; return true; }).sort();
  }
  function alerts(contracts, todayIso, settings) {
    var s = S(settings), today = todayIso || todayISO(), out = [], list = contracts || [];
    var instMax = Math.max.apply(null, [0].concat(s.installmentReminderDays));
    var endMax = Math.max.apply(null, [0].concat(s.leaseEndReminderDays));
    var revMax = Math.max.apply(null, [0].concat(s.rentReviewReminderDays));
    var noticeMax = Math.max.apply(null, [0].concat(s.noticeReminderDays));
    function push(a) { a.key = [a.category, a.ref, a.type, a.stage].join("|"); out.push(a); }
    list.forEach(function (c) {
      if (!c || c.status === "Draft") return;
      var cat = catOf(c), lease = cat === "Lease";
      var who = (c.category || "Contract") + (c.branch ? " - " + c.branch : "") + (landlordOf(c) ? " (" + landlordOf(c) + ")" : "");
      var closed = !!CLOSED[c.status], renewed = c.status === "Renewed" || !!c.renewedTo ||
        list.some(function (o) { return o && o !== c && o.renewedFrom === c.id; });
      // payments due / overdue
      installmentsOf(c).forEach(function (i) {
        if (valid(i.paidDate) || !valid(i.dueDate)) return;
        var d = daysBetween(today, i.dueDate);
        if (d > instMax) return;
        var due = round2(num(i.amount) + num(i.vat)), stg = stageFor(d, s.installmentReminderDays);
        push({ type: d < 0 ? "payment_overdue" : "payment_due", severity: d < 0 ? "expired" : d <= 7 ? "critical" : d <= 14 ? "warning" : "notice",
          category: cat, ref: c.id + "#" + i.no,
          title: d < 0 ? "Payment overdue " + (-d) + " day(s)" : d === 0 ? "Payment due today" : "Payment due in " + d + " day(s)",
          message: who + ": installment #" + i.no + " SAR " + due.toFixed(2) + " (incl. VAT) " + (d < 0 ? "was due " : "due ") + fmt(i.dueDate) + ".",
          dueDate: i.dueDate, daysLeft: d, stage: d < 0 ? "overdue" : String(stg) });
      });
      // VAT invoice missing for paid installment
      installmentsOf(c).forEach(function (i) {
        if (!valid(i.paidDate) || i.paidDate > today || !(num(i.vat) > 0) || hasInvoice(c, i.no)) return;
        push({ type: "vat_invoice_missing", severity: "warning", category: cat, ref: c.id + "#" + i.no,
          title: "VAT invoice missing", message: who + ": installment #" + i.no + " paid " + fmt(i.paidDate) +
            " (VAT SAR " + round2(num(i.vat)).toFixed(2) + ") has no tax invoice on file - input VAT cannot be reclaimed.",
          dueDate: i.paidDate, daysLeft: daysBetween(today, i.paidDate), stage: "invoice" });
      });
      // deposit refund overdue
      var endRef = c.terminationDate || c.endDate;
      if (depositOutstanding(c) > 0 && valid(endRef) && c.status !== "Renewed" && !renewed) {
        var due2 = addDays(endRef, s.depositRefundGraceDays), d2 = daysBetween(today, due2);
        if (d2 < 0) push({ type: "deposit_refund_overdue", severity: "expired", category: cat, ref: c.id,
          title: "Security deposit refund overdue", message: who + ": deposit SAR " + depositOutstanding(c).toFixed(2) +
            " not refunded " + s.depositRefundGraceDays + " days after lease end (" + fmt(endRef) + ").",
          dueDate: due2, daysLeft: d2, stage: "overdue" });
      }
      if (closed || !valid(c.endDate)) return;
      // lease / contract end
      var dEnd = daysBetween(today, c.endDate);
      if (!renewed && dEnd <= endMax && dEnd >= -30) {
        var se = stageFor(dEnd, s.leaseEndReminderDays);
        push({ type: "lease_end", severity: dEnd < 0 ? "expired" : dEnd <= 30 ? "critical" : dEnd <= 60 ? "warning" : "notice",
          category: cat, ref: c.id, title: dEnd < 0 ? (lease ? "Lease ended without renewal" : "Contract ended without renewal") :
            (lease ? "Lease ends in " : "Contract ends in ") + dEnd + " day(s)",
          message: who + (dEnd < 0 ? " ended " : " ends ") + fmt(c.endDate) + "; no renewal recorded" + (lease ? " (renew on Ejar)." : "."),
          dueDate: c.endDate, daysLeft: dEnd, stage: dEnd < 0 ? "ended" : "end" + se });
      }
      if (dEnd < 0) return;
      // option notice deadlines
      var opt = c.options || {};
      var nots = [];
      if (!renewed && c.status !== "Notice given" && opt.renewal && opt.renewal.noticeDays !== undefined)
        nots.push({ kind: "renewal", date: addDays(c.endDate, -num(opt.renewal.noticeDays)), label: "Renewal option notice deadline" });
      if (c.status !== "Notice given" && opt.termination && opt.termination.noticeDays !== undefined) {
        var earliest = valid(opt.termination.earliest) ? opt.termination.earliest : c.endDate;
        nots.push({ kind: "termination", date: addDays(earliest, -num(opt.termination.noticeDays)), label: "Termination option notice deadline" });
      }
      nots.forEach(function (n) {
        var d = daysBetween(today, n.date);
        if (d > noticeMax || d < -30) return;
        var st = stageFor(d, s.noticeReminderDays);
        push({ type: "notice_" + n.kind, severity: d < 0 ? "expired" : d <= 15 ? "critical" : d <= 30 ? "warning" : "notice",
          category: cat, ref: c.id, title: d < 0 ? n.label + " passed" : n.label + " in " + d + " day(s)",
          message: who + ": " + n.label.toLowerCase() + " " + fmt(n.date) + (d < 0 ? " has passed." : "."),
          dueDate: n.date, daysLeft: d, stage: d < 0 ? "missed" : String(st) });
      });
      // rent review / escalation
      reviewDates(c).forEach(function (rd) {
        var d = daysBetween(today, rd);
        if (d < 0 || d > revMax) return;
        push({ type: "rent_review", severity: d <= 30 ? "warning" : "notice", category: cat, ref: c.id,
          title: "Rent review / escalation in " + d + " day(s)",
          message: who + ": rent changes on " + fmt(rd) + " to SAR " + annualRentAt(c, rd).toFixed(2) + " per year.",
          dueDate: rd, daysLeft: d, stage: "review" + stageFor(d, s.rentReviewReminderDays) + ":" + rd });
      });
      // Ejar registration missing
      if (lease && (c.status === "Active" || (!c.status && c.startDate <= today)) &&
          !(c.property && c.property.ejarNo) && !c.refNo && !(c.documents || []).some(function (d) { return d && d.kind === "ejar"; })) {
        push({ type: "ejar_missing", severity: "warning", category: cat, ref: c.id, title: "Ejar registration missing",
          message: who + ": active lease has no Ejar contract number or Ejar document recorded.",
          dueDate: c.startDate, daysLeft: daysBetween(today, c.startDate), stage: "ejar" });
      }
    });
    out.sort(function (a, b) {
      var r = SEV_RANK[a.severity] - SEV_RANK[b.severity];
      return r || (a.daysLeft || 0) - (b.daysLeft || 0);
    });
    return out;
  }

  // ---------- deposits journal ----------
  function depositsJournal(contracts, monthISO, settings) {
    if (typeof monthISO === "string" && /^\d{4}-\d{2}$/.test(monthISO)) monthISO += "-01";
    var s = S(settings), A = s.accounts, ms = monthStart(monthISO), me = monthEnd(monthISO), raw = [];
    if (!ms) return { entries: [], balanced: true, totals: { debit: 0, credit: 0 } };
    function inMonth(d) { return valid(d) && d >= ms && d <= me; }
    function line(key, dr, cr, memo, cls) {
      return { accountKey: key, account: A[key] || key, debit: round2(dr), credit: round2(cr), memo: memo || "", cls: cls || "" };
    }
    (contracts || []).forEach(function (c) {
      var d = c && c.deposit; if (!d || !(num(d.amount) > 0)) return;
      var amt = round2(num(d.amount)), cls = c.branch || "", tag = "Security deposit " + c.id + (c.branch ? " - " + c.branch : "");
      if (inMonth(d.paidDate)) {
        var m1 = tag + " paid" + (landlordOf(c) ? " to " + landlordOf(c) : "");
        raw.push({ date: d.paidDate, order: 1, memo: m1, lines: [line("securityDeposits", amt, 0, m1, cls), line("bank", 0, amt, m1, cls)] });
      }
      var closeDate = valid(d.refundDate) ? d.refundDate : (c.terminationDate || c.endDate);
      if (d.status === "refunded" && inMonth(closeDate)) {
        var got = d.refundedAmount !== undefined && d.refundedAmount !== null && d.refundedAmount !== "" ? round2(num(d.refundedAmount)) : amt;
        var ded = round2(amt - got), m2 = tag + " refunded", L = [];
        if (got) L.push(line("bank", got, 0, m2, cls));
        if (ded > 0) L.push(line("rentExp", ded, 0, m2 + " - deduction by landlord", cls));
        L.push(line("securityDeposits", 0, amt, m2, cls));
        if (ded < 0) L.push(line("rentExp", 0, -ded, m2 + " - excess refund", cls));
        raw.push({ date: closeDate, order: 2, memo: m2, lines: L });
      } else if (d.status === "forfeited" && inMonth(closeDate)) {
        var got3 = round2(num(d.refundedAmount)), m3 = tag + " forfeited", L3 = [];
        if (got3 > 0) L3.push(line("bank", got3, 0, m3 + " - partial refund", cls));
        L3.push(line("rentExp", round2(amt - got3), 0, m3, cls));
        L3.push(line("securityDeposits", 0, amt, m3, cls));
        raw.push({ date: closeDate, order: 3, memo: m3, lines: L3 });
      }
    });
    raw.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order; });
    var prefix = "DJE-" + ms.slice(0, 4) + "-" + ms.slice(5, 7) + "-", td = 0, tc = 0, balanced = true;
    var entries = raw.map(function (e, i) {
      var dd = 0, cc = 0;
      e.lines.forEach(function (l) { dd += l.debit; cc += l.credit; });
      if (Math.abs(round2(dd) - round2(cc)) > 0.005) balanced = false;
      td += dd; tc += cc;
      return { jeNo: prefix + pad(i + 1, 2), date: e.date, memo: e.memo, lines: e.lines };
    });
    td = round2(td); tc = round2(tc);
    if (Math.abs(td - tc) > 0.005) balanced = false;
    return { entries: entries, balanced: balanced, totals: { debit: td, credit: tc } };
  }

  // ---------- export ----------
  function escText(c) {
    var e = c.escalation || {}, t = escType(c);
    if (t === "fixed_pct") return pctOf(e.pct) * 100 + "% yearly";
    if (t === "cpi") return "CPI (" + pctOf(e.pct) * 100 + "%)";
    if (t === "fixed_amount") return "+" + num(e.amount) + " yearly";
    if (t === "step") return (e.steps || []).map(function (s) { return s.from + ": " + s.annualRent; }).join("; ");
    return "None";
  }
  function exportRows(contracts) {
    var reg = [], pay = [], dep = [], ev = [];
    (contracts || []).forEach(function (c) {
      if (!c) return;
      var p = c.property || {}, l = c.landlord || {}, d = c.deposit || {};
      reg.push({ "Contract ID": c.id || "", "Category": c.category || "", "Branch": c.branch || "", "Landlord": landlordOf(c),
        "Landlord VAT No": l.vatNo || "", "Landlord IBAN": l.iban || c.landlordIban || "", "City": cityOf(c), "District": p.district || c.district || "",
        "Property Type": p.type || c.propertyType || "", "Area (sqm)": areaOf(c) || "", "Ejar No": p.ejarNo || c.refNo || "",
        "Start Date": c.startDate || "", "End Date": c.endDate || "", "Frequency": c.frequency || "",
        "Annual Rent (start)": annualRentAt(c, c.startDate), "Escalation": escText(c),
        "Total (excl VAT)": round2(c.totalAmount !== undefined ? c.totalAmount : sumBy(installmentsOf(c), function (i) { return i.amount; })),
        "Effective Monthly Cost": effectiveMonthlyCost(c), "Deposit": round2(num(d.amount)), "Deposit Status": d.status || "",
        "Status": c.status || "Active", "Renewed From": c.renewedFrom || "", "Renewed To": c.renewedTo || "",
        "Termination Date": c.terminationDate || "" });
      installmentsOf(c).forEach(function (i) {
        pay.push({ "Contract ID": c.id || "", "Branch": c.branch || "", "Category": c.category || "", "No": i.no,
          "Due Date": i.dueDate || "", "Period Start": i.periodStart || "", "Period End": i.periodEnd || "",
          "Amount (excl VAT)": round2(num(i.amount)), "VAT": round2(num(i.vat)), "Total": round2(num(i.amount) + num(i.vat)),
          "Paid Date": i.paidDate || "", "Payment Ref": i.paymentRef || "", "Status": valid(i.paidDate) ? "Paid" : "Unpaid" });
      });
      if (num(d.amount) > 0) dep.push({ "Contract ID": c.id || "", "Branch": c.branch || "", "Landlord": landlordOf(c),
        "Amount": round2(num(d.amount)), "Paid Date": d.paidDate || "", "Refund Date": d.refundDate || "",
        "Refunded Amount": round2(num(d.refundedAmount)), "Status": d.status || "held" });
      (c.events || []).forEach(function (e) {
        ev.push({ "Contract ID": c.id || "", "Branch": c.branch || "", "Event ID": e.id || "", "Type": e.type || "",
          "Date": e.date || "", "By": e.by || "", "Details": e.details ? JSON.stringify(e.details) : "" });
      });
    });
    return { leaseRegister: reg, paymentSchedule: pay, deposits: dep, eventsLog: ev };
  }

  var Rental = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    round2: round2, parseISO: parseISO, addDays: addDays, addMonths: addMonths, daysBetween: daysBetween,
    monthStart: monthStart, monthEnd: monthEnd, termDays: termDays, isLease: isLease, resolveModel: resolveModel,
    anniversaries: anniversaries, initialRecognition: initialRecognition, liabilityAt: liabilityAt, rouNbvAt: rouNbvAt,
    generateSchedule: generateSchedule, annualRentAt: annualRentAt, effectiveMonthlyCost: effectiveMonthlyCost,
    renew: renew, modify: modify, terminate: terminate, prepaidStatus: prepaidStatus,
    portfolioAnalytics: portfolioAnalytics, alerts: alerts, depositsJournal: depositsJournal, exportRows: exportRows
  };
  root.Rental = Rental;
  if (typeof module !== 'undefined' && module && module.exports) module.exports = Rental;
})(typeof window !== 'undefined' ? window : this);
