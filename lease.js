/* Lease accounting engine (vanilla JS, ES2018, no deps) - prepaid / straight-line (IFRS for SMEs s.20) / IFRS 16 */
(function (root) {
  'use strict';

  var DEFAULT_SETTINGS = {
    leaseStandard: "prepaid",
    defaultIbr: 0.065,
    vatRate: 0.15,
    accounts: {
      bank: "Bank - Al Rajhi",
      prepaidRent: "Prepaid Rent",
      rentExp: "Rent Expense",
      inputVat: "VAT Input (Recoverable)",
      rouAsset: "Right-of-use Assets",
      rouAccDep: "Accumulated Depreciation - ROU",
      leaseLiab: "Lease Liabilities",
      leaseInterest: "Interest Expense - Leases",
      rouDep: "Depreciation - ROU Assets",
      accruedRent: "Accrued Rent"
    }
  };
  var DAY = 86400000;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var BUCKETS = ["≤1y", "1–2y", "2–3y", "3–4y", "4–5y", ">5y"];

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
  function isLease(c) { return !!c && (c.category === "Branch Rent" || (!!c.model && c.model !== "")); }

  // ---------- basics ----------
  function termDays(contract) {
    var d = daysBetween(contract && contract.startDate, contract && contract.endDate);
    return isNaN(d) ? 0 : Math.max(0, d + 1);
  }
  function isShortTerm(c) {
    var t = termDays(c);
    return t <= 365 || (valid(c.startDate) && c.endDate < addMonths(c.startDate, 12));
  }
  function resolveModel(contract, settings) {
    var s = S(settings), c = contract || {};
    var m = c.model;
    if (m === "prepaid" || m === "straightline" || m === "ifrs16") return m;
    if (isShortTerm(c)) return "prepaid";
    var st = s.leaseStandard;
    return st === "straightline" || st === "ifrs16" ? st : "prepaid";
  }
  function payments(contract) {
    return ((contract && contract.installments) || []).filter(function (i) { return valid(i.dueDate); })
      .map(function (i) {
        return { no: i.no, date: i.dueDate, amount: num(i.amount), vat: num(i.vat), paid: valid(i.paidDate),
          paidDate: valid(i.paidDate) ? i.paidDate : "", paymentRef: i.paymentRef || "" };
      })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : num(a.no) - num(b.no); });
  }
  function totalPayments(c) { var t = 0; payments(c).forEach(function (p) { t += p.amount; }); return t; }
  function paidBy(c, dateISO) {
    var t = 0;
    payments(c).forEach(function (p) { if (p.paid && p.paidDate <= dateISO) t += p.amount; });
    return t;
  }

  // ---------- straight-line ----------
  function slCum(c, dateISO) { // rounded cumulative expense through dateISO
    var T = termDays(c); if (!T || !valid(dateISO)) return 0;
    var d = clamp(daysBetween(c.startDate, dateISO) + 1, 0, T);
    var tot = totalPayments(c);
    return d >= T ? round2(tot) : round2(tot * d / T);
  }
  function straightLine(contract, asOfISO) {
    var c = contract || {}, T = termDays(c);
    var dailyExpense = T ? totalPayments(c) / T : 0;
    var expenseToDate = slCum(c, asOfISO), paidToDate = round2(paidBy(c, asOfISO));
    return { dailyExpense: round2(dailyExpense), expenseToDate: expenseToDate, paidToDate: paidToDate,
      balance: round2(paidToDate - expenseToDate) };
  }
  function straightLineMonth(contract, monthISO) {
    var ms = monthStart(monthISO); if (!ms) return 0;
    return round2(slCum(contract, monthEnd(ms)) - slCum(contract, addDays(ms, -1)));
  }

  // ---------- IFRS 16 ----------
  function ibrOf(c, s) { return c && c.ibr !== undefined && c.ibr !== null && c.ibr !== "" ? num(c.ibr) : num(s.defaultIbr); }
  function core(contract, settings) {
    var s = S(settings), c = contract || {}, comm = c.startDate, end = c.endDate, r = ibrOf(c, s);
    var pays = payments(c).map(function (p) {
      return { date: p.date, amount: p.amount, idx: Math.max(0, daysBetween(comm, p.date)) };
    });
    function f(days) { return Math.pow(1 + r, days / 365); }
    var pv = 0;
    pays.forEach(function (p) { pv += p.amount / f(p.idx); });
    // liability at point p (days after commencement), payments with idx < p deducted
    function L(p) {
      if (p <= 0) return pv;
      var v = pv * f(p);
      pays.forEach(function (q) { if (q.idx < p) v -= q.amount * f(p - q.idx); });
      return v;
    }
    var pvR = round2(pv);
    var rouInitial = round2(pvR + round2(num(c.initialDirectCosts)) - round2(num(c.incentives)));
    return { c: c, s: s, comm: comm, end: end, ibr: r, pays: pays, pv: pv, pvR: pvR, rouInitial: rouInitial, L: L, T: termDays(c) };
  }
  function depCum(k, dateISO) { // rounded cumulative depreciation through dateISO
    if (!k.T || !valid(dateISO)) return 0;
    var d = clamp(daysBetween(k.comm, dateISO) + 1, 0, k.T);
    return d >= k.T ? k.rouInitial : round2(k.rouInitial * d / k.T);
  }
  function ifrs16(contract, settings) {
    var k = core(contract, settings);
    var out = { commencement: k.comm, end: k.end, ibr: k.ibr, pv: k.pvR, rouInitial: k.rouInitial, months: [] };
    if (!valid(k.comm) || !valid(k.end) || k.end < k.comm) return out;
    var first = monthStart(k.comm), last = monthStart(k.end), opening = k.pvR, prevDep = 0;
    for (var m = first; m <= last; m = addMonths(m, 1)) {
      var me = monthEnd(m), isLast = m === last, pay = 0;
      k.pays.forEach(function (p) {
        var pm = p.date < k.comm ? first : monthStart(p.date);
        if (pm === m || (isLast && pm > last)) pay += p.amount;
      });
      pay = round2(pay);
      var closing = isLast ? 0 : round2(k.L(daysBetween(k.comm, me) + 1));
      var interest = round2(closing - opening + pay);
      var cum = isLast ? k.rouInitial : depCum(k, me);
      out.months.push({ month: m, openingLiab: opening, interest: interest, payments: pay, closingLiab: closing,
        depreciation: round2(cum - prevDep), rouNbv: round2(k.rouInitial - cum) });
      opening = closing; prevDep = cum;
    }
    return out;
  }
  function liabilityAt(contract, settings, dateISO) {
    var c = contract || {};
    if (!valid(dateISO) || !valid(c.startDate) || dateISO < c.startDate || dateISO >= c.endDate) return 0;
    var k = core(c, settings);
    return round2(Math.max(0, k.L(daysBetween(k.comm, dateISO) + 1)));
  }
  function rouNbvAt(contract, settings, dateISO) {
    var c = contract || {};
    if (!valid(dateISO) || !valid(c.startDate) || dateISO < c.startDate) return 0;
    var k = core(c, settings);
    return round2(k.rouInitial - depCum(k, dateISO));
  }
  function currentPortion(contract, settings, dateISO) {
    var now = liabilityAt(contract, settings, dateISO);
    var later = liabilityAt(contract, settings, addMonths(dateISO, 12));
    return round2(clamp(now - later, 0, now));
  }

  // ---------- maturity ----------
  function blankBuckets() { var o = {}; BUCKETS.forEach(function (b) { o[b] = 0; }); o.total = 0; return o; }
  function bucketOf(asOf, due) {
    for (var y = 1; y <= 5; y++) if (due <= addMonths(asOf, 12 * y)) return BUCKETS[y - 1];
    return BUCKETS[5];
  }
  function maturityAnalysis(contracts, settings, asOfISO) {
    var overall = blankBuckets(), rows = [];
    (contracts || []).filter(isLease).forEach(function (c) {
      var row = blankBuckets();
      payments(c).forEach(function (p) {
        if (p.paid && p.paidDate <= asOfISO) return;
        var b = bucketOf(asOfISO, p.date);
        row[b] += p.amount; row.total += p.amount;
      });
      BUCKETS.concat(["total"]).forEach(function (b) { row[b] = round2(row[b]); overall[b] = round2(overall[b] + row[b]); });
      row.id = c.id; row.branch = c.branch || "";
      rows.push(row);
    });
    return { asOf: asOfISO, buckets: BUCKETS.slice(), rows: rows, overall: overall };
  }

  // ---------- critical dates ----------
  function severity(d) { return d < 0 ? "expired" : d <= 15 ? "critical" : d <= 30 ? "warning" : d <= 90 ? "notice" : "info"; }
  function criticalDates(contract, settings, todayIso) {
    var c = contract || {}, today = todayIso || todayISO(), out = [];
    function push(type, date, extra) {
      if (!valid(date)) return;
      var dl = daysBetween(today, date);
      out.push(Object.assign({ type: type, date: date, daysLeft: dl, severity: type === "Payment overdue" ? "expired" : severity(dl) }, extra || {}));
    }
    var closed = c.status === "Terminated" || c.status === "Expired";
    if (!closed) {
      var nd = c.noticeDays === undefined || c.noticeDays === null || c.noticeDays === "" ? 90 : num(c.noticeDays);
      if (valid(c.endDate) && today <= c.endDate) push("Notice deadline", addDays(c.endDate, -nd), { autoRenew: !!c.autoRenew });
      push("Lease end", c.endDate);
    }
    var next = null;
    payments(c).forEach(function (p) {
      if (p.paid) return;
      if (p.date < today) push("Payment overdue", p.date, { amount: p.amount, vat: p.vat, no: p.no });
      else if (!next) next = p;
    });
    if (next && !closed) push("Next payment", next.date, { amount: next.amount, vat: next.vat, no: next.no });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  // ---------- journal ----------
  function leaseJournal(contracts, settings, monthISO, todayIso) {
    var s = S(settings), A = s.accounts;
    var ms = monthStart(monthISO), me = monthEnd(monthISO), raw = [];
    var mLabel = ms ? MONTHS[+ms.slice(5, 7) - 1] + " " + ms.slice(0, 4) : "";
    function inMonth(d) { return valid(d) && d >= ms && d <= me; }
    function line(key, dr, cr, memo, cls) {
      return { accountKey: key, account: A[key] || key, debit: round2(dr), credit: round2(cr), memo: memo || "", cls: cls || "" };
    }
    if (!ms) return { entries: [], balanced: true, totals: { debit: 0, credit: 0 } };
    (contracts || []).filter(isLease).forEach(function (c) {
      var model = resolveModel(c, s); if (model !== "straightline" && model !== "ifrs16") return;
      var cls = c.branch || "", tag = "Lease " + c.id + (c.branch ? " - " + c.branch : "");
      var pays = payments(c);
      function payMemo(p) { return tag + " payment #" + p.no + " due " + p.date + (p.paymentRef ? " Ref " + p.paymentRef : ""); }
      if (model === "straightline") {
        // net = cumulative paid - cumulative expense; + = prepaid, - = accrued
        var prevEnd = addDays(ms, -1);
        var net = round2(paidBy(c, prevEnd) - slCum(c, prevEnd));
        pays.filter(function (p) { return p.paid && inMonth(p.paidDate); })
          .sort(function (a, b) { return a.paidDate < b.paidDate ? -1 : a.paidDate > b.paidDate ? 1 : 0; })
          .forEach(function (p) {
            var amt = round2(p.amount), vat = round2(p.vat), memo = payMemo(p), L = [];
            var clear = round2(Math.min(amt, Math.max(0, -net))), pre = round2(amt - clear);
            if (clear) L.push(line("accruedRent", clear, 0, memo, cls));
            if (pre) L.push(line("prepaidRent", pre, 0, memo, cls));
            if (vat) L.push(line("inputVat", vat, 0, "VAT " + memo, cls));
            if (amt + vat) L.push(line("bank", 0, round2(amt + vat), memo, cls));
            net = round2(net + amt);
            if (L.length) raw.push({ date: p.paidDate, order: 1, memo: memo, lines: L });
          });
        var e = straightLineMonth(c, ms);
        if (e) {
          var memo = tag + " straight-line rent - " + mLabel;
          var fromPre = round2(Math.min(e, Math.max(0, net))), acc = round2(e - fromPre);
          var L = [line("rentExp", e, 0, memo, cls)];
          if (fromPre) L.push(line("prepaidRent", 0, fromPre, memo, cls));
          if (acc) L.push(line("accruedRent", 0, acc, memo, cls));
          raw.push({ date: me, order: 3, memo: memo, lines: L });
        }
      } else {
        var sch = ifrs16(c, s), comm = sch.commencement;
        if (inMonth(comm)) {
          var cm = tag + " IFRS 16 initial recognition", idc = round2(num(c.initialDirectCosts)), inc = round2(num(c.incentives));
          var L0 = [line("rouAsset", sch.rouInitial, 0, cm, cls), line("leaseLiab", 0, sch.pv, cm, cls)];
          if (idc) L0.push(line("bank", 0, idc, cm + " - initial direct costs", cls));
          if (inc) L0.push(line("bank", inc, 0, cm + " - lease incentives received", cls));
          var pre0 = 0;
          pays.forEach(function (p) { if (p.paid && p.paidDate < comm) pre0 += p.amount; });
          pre0 = round2(pre0);
          if (pre0) {
            L0.push(line("leaseLiab", pre0, 0, cm + " - payments made before commencement", cls));
            L0.push(line("prepaidRent", 0, pre0, cm + " - payments made before commencement", cls));
          }
          raw.push({ date: comm, order: 0, memo: cm, lines: L0 });
        }
        pays.filter(function (p) { return p.paid && inMonth(p.paidDate); }).forEach(function (p) {
          var amt = round2(p.amount), vat = round2(p.vat), memo = payMemo(p), L = [];
          var key = valid(comm) && p.paidDate < comm ? "prepaidRent" : "leaseLiab";
          if (amt) L.push(line(key, amt, 0, memo, cls));
          if (vat) L.push(line("inputVat", vat, 0, "VAT " + memo, cls));
          if (amt + vat) L.push(line("bank", 0, round2(amt + vat), memo, cls));
          if (L.length) raw.push({ date: p.paidDate, order: 1, memo: memo, lines: L });
        });
        var row = null;
        sch.months.forEach(function (r) { if (r.month === ms) row = r; });
        if (row) {
          if (row.interest) {
            var im = tag + " lease interest - " + mLabel;
            raw.push({ date: me, order: 2, memo: im, lines: [
              line("leaseInterest", row.interest > 0 ? row.interest : 0, row.interest < 0 ? -row.interest : 0, im, cls),
              line("leaseLiab", row.interest < 0 ? -row.interest : 0, row.interest > 0 ? row.interest : 0, im, cls)] });
          }
          if (row.depreciation) {
            var dm = tag + " ROU depreciation - " + mLabel;
            raw.push({ date: me, order: 3, memo: dm, lines: [
              line("rouDep", row.depreciation, 0, dm, cls), line("rouAccDep", 0, row.depreciation, dm, cls)] });
          }
        }
      }
    });
    raw.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order; });
    var prefix = "LJE-" + ms.slice(0, 4) + "-" + ms.slice(5, 7) + "-";
    var td = 0, tc = 0, balanced = true;
    var entries = raw.map(function (e, i) {
      var d = 0, cr = 0;
      e.lines.forEach(function (l) { d += l.debit; cr += l.credit; });
      if (Math.abs(round2(d) - round2(cr)) > 0.005) balanced = false;
      td += d; tc += cr;
      return { jeNo: prefix + pad(i + 1, 2), date: e.date, memo: e.memo, lines: e.lines };
    });
    td = round2(td); tc = round2(tc);
    if (Math.abs(td - tc) > 0.005) balanced = false;
    return { entries: entries, balanced: balanced, totals: { debit: td, credit: tc } };
  }

  // ---------- portfolio ----------
  function portfolio(contracts, settings, todayIso) {
    var s = S(settings), today = todayIso || todayISO(), rows = [];
    var tot = { count: 0, monthlyCost: 0, annualCost: 0, overdueAmount: 0, paidToDate: 0, remainingPayments: 0, liability: 0, rouNbv: 0, areaSqm: 0 };
    (contracts || []).filter(isLease).forEach(function (c) {
      var model = resolveModel(c, s), T = termDays(c), daily = T ? totalPayments(c) / T : 0;
      var remDays = valid(c.endDate) ? clamp(daysBetween(today, c.endDate) + 1, 0, T) : 0;
      var next = null, overdue = 0, paid = 0, remaining = 0;
      payments(c).forEach(function (p) {
        if (p.paid) { if (p.paidDate <= today) paid += p.amount; else remaining += p.amount; return; }
        remaining += p.amount;
        if (p.date < today) overdue += p.amount;
        else if (!next) next = { date: p.date, amount: round2(p.amount) };
      });
      var nd = c.noticeDays === undefined || c.noticeDays === null || c.noticeDays === "" ? 90 : num(c.noticeDays);
      var status = c.status || (valid(c.endDate) && today > c.endDate ? "Expired" : valid(c.startDate) && today < c.startDate ? "Not started" : "Active");
      var area = num(c.areaSqm), annual = daily * 365;
      var row = {
        id: c.id, branch: c.branch || "", model: model,
        termMonths: Math.round(T * 12 / 365), remainingMonths: Math.round(remDays * 12 / 365),
        monthlyCost: round2(annual / 12), annualCost: round2(annual), costPerSqm: area ? round2(annual / area) : null,
        nextPayment: next, overdueAmount: round2(overdue), paidToDate: round2(paid), remainingPayments: round2(remaining),
        liability: model === "ifrs16" ? liabilityAt(c, s, today) : null,
        rouNbv: model === "ifrs16" ? rouNbvAt(c, s, today) : null,
        noticeDeadline: valid(c.endDate) ? addDays(c.endDate, -nd) : "", status: status
      };
      rows.push(row);
      tot.count++; tot.areaSqm += area;
      ["monthlyCost", "annualCost", "overdueAmount", "paidToDate", "remainingPayments", "liability", "rouNbv"].forEach(function (k) {
        tot[k] = round2(tot[k] + num(row[k]));
      });
    });
    tot.areaSqm = round2(tot.areaSqm);
    tot.costPerSqm = tot.areaSqm ? round2(tot.annualCost / tot.areaSqm) : null;
    return { rows: rows, totals: tot };
  }

  var Lease = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, BUCKETS: BUCKETS,
    round2: round2, parseISO: parseISO, addDays: addDays, addMonths: addMonths, daysBetween: daysBetween,
    monthStart: monthStart, monthEnd: monthEnd, isLease: isLease,
    resolveModel: resolveModel, termDays: termDays, payments: payments,
    straightLine: straightLine, straightLineMonth: straightLineMonth,
    ifrs16: ifrs16, liabilityAt: liabilityAt, rouNbvAt: rouNbvAt, currentPortion: currentPortion,
    maturityAnalysis: maturityAnalysis, criticalDates: criticalDates, leaseJournal: leaseJournal, portfolio: portfolio
  };
  root.Lease = Lease;
  if (typeof module !== 'undefined' && module && module.exports) module.exports = Lease;
})(typeof window !== 'undefined' ? window : this);
