/* Iqama & Jawazat Control System - calculation engine (vanilla JS, ES2018, no deps) */
(function (root) {
  'use strict';

  var DEFAULT_SETTINGS = {
    company: "Company name", crNo: "", molNo: "",
    empPrefix: "EMP-", empPad: 4,
    iqamaFeeYear: 650,
    levyMonth: 800,
    wpFeeYear: 100,
    depFeeMonth: 400,
    lateFine1: 500, lateFine2: 1000,
    lateGraceDays: 3,
    erSingleBase: 200, erSingleBaseMonths: 2, erSingleAddMonth: 100,
    erMultiBase: 500, erMultiBaseMonths: 3, erMultiAddMonth: 200,
    finalExitFee: 0, iqamaLostFee: 1000, iqamaLostFee2: 2000, iqamaDamagedFee: 300, erUnusedFine: 1000,
    reminderDays: [90, 60, 30, 15, 7, 0],
    passportMinDays: 90, passportAlertDays: 180, insuranceAlertDays: 30,
    accounts: {
      bank: "Bank - Al Rajhi",
      prepaid: "Prepaid Government Fees",
      iqamaExp: "Iqama Fees Expense",
      levyExp: "Work Permit Levy Expense",
      wpExp: "Work Permit Fees Expense",
      depExp: "Dependents Fees Expense",
      visaExp: "Exit Re-entry Visa Expense",
      finesExp: "Government Penalties (Non-deductible)",
      otherExp: "Other Government Fees",
      empRecv: "Employee Receivable",
      prepaidRent: "Prepaid Rent",
      rentExp: "Rent Expense",
      prepaidIns: "Prepaid Medical Insurance",
      insExp: "Medical Insurance Expense",
      prepaidOther: "Prepaid Expenses - Other",
      otherPrepaidExp: "Other Expense",
      inputVat: "VAT Input (Recoverable)"
    },
    vatRate: 0.15,
    contractReminderDays: [90, 60, 30],
    installmentReminderDays: [30, 14, 7, 0]
  };

  var DAY = 86400000;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // expense account -> prepaid account
  var PREPAID_OF = { iqamaExp: "prepaid", levyExp: "prepaid", wpExp: "prepaid", depExp: "prepaid",
    rentExp: "prepaidRent", insExp: "prepaidIns", otherPrepaidExp: "prepaidOther" };
  var PREPAID_ACCOUNTS = ["prepaid", "prepaidRent", "prepaidIns", "prepaidOther"];
  var EXP_ORDER = ["iqamaExp", "levyExp", "wpExp", "depExp", "rentExp", "insExp", "otherPrepaidExp"];

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
  function maxISO(a, b) { if (!a) return b || ""; if (!b) return a; return a > b ? a : b; }

  // ---------- dates ----------
  function parseISO(s) {
    if (typeof s !== "string") return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return NaN;
    var ms = Date.UTC(y, mo - 1, d);
    var dt = new Date(ms);
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
  function toHijri(s) {
    var ms = parseISO(s); if (isNaN(ms)) return "";
    try {
      var f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn",
        { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
      var parts = f.formatToParts(new Date(ms)), o = {};
      parts.forEach(function (p) { o[p.type] = p.value; });
      var y = String(o.year || o.relatedYear || "").replace(/[^0-9]/g, "");
      var dd = String(o.day || "").replace(/[^0-9]/g, ""), mm = String(o.month || "").replace(/[^0-9]/g, "");
      if (!y || !dd || !mm) return "";
      return pad(dd, 2) + "/" + pad(mm, 2) + "/" + y;
    } catch (e) { return ""; }
  }
  function fmtDate(s) {
    var ms = parseISO(s); if (isNaN(ms)) return "";
    var d = new Date(ms);
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function dmy(s) { return valid(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : ""; }

  // ---------- ids ----------
  function nextNumber(existingIds, prefix, padW) {
    prefix = prefix || ""; padW = padW == null ? 4 : padW;
    var max = 0;
    (existingIds || []).forEach(function (id) {
      if (typeof id !== "string" || id.indexOf(prefix) !== 0) return;
      var rest = id.slice(prefix.length);
      if (/^\d+$/.test(rest)) max = Math.max(max, parseInt(rest, 10));
    });
    return prefix + pad(max + 1, padW);
  }

  // ---------- renewals ----------
  function renewalStatus(r) {
    if (!r) return "";
    if (r.completedDate) return "Completed";
    if (r.paymentDate) return "Paid";
    if (r.sadadNo) return "Awaiting Payment";
    if (r.financeDate) return "Finance Approved";
    if (r.hrDate) return "HR Approved";
    return "Requested";
  }
  function renNewExpiry(r) { return valid(r.oldExpiry) ? addMonths(r.oldExpiry, num(r.months)) : ""; }
  function effectiveExpiry(emp, renewals) {
    var e = (emp && emp.iqamaExpiry) || "";
    (renewals || []).forEach(function (r) {
      if (r.empNo === emp.empNo && r.completedDate) e = maxISO(e, renNewExpiry(r));
    });
    return e;
  }
  function suggestOldExpiry(emp, renewals, excludeId) {
    var e = (emp && emp.iqamaExpiry) || "";
    (renewals || []).forEach(function (r) {
      if (r.empNo === emp.empNo && r.id !== excludeId) e = maxISO(e, renNewExpiry(r));
    });
    return e;
  }
  function isEarlier(a, b) { // a earlier than b
    var ad = a.requestDate || "", bd = b.requestDate || "";
    if (ad !== bd) return ad < bd;
    return String(a.id || "") < String(b.id || "");
  }
  function renewalLate(r, oldExpiry, settings, today) {
    if (!valid(oldExpiry)) return false;
    var d = r.paymentDate || today || todayISO();
    return d > addDays(oldExpiry, num(settings.lateGraceDays));
  }
  function calcRenewal(r, emp, settings, allRenewals, today) {
    var s = S(settings); emp = emp || {}; allRenewals = allRenewals || []; today = today || todayISO();
    var m = num(r.months);
    var oldExpiry = valid(r.oldExpiry) ? r.oldExpiry : suggestOldExpiry(emp, allRenewals, r.id);
    var coverageStart = addDays(oldExpiry, 1);
    var newExpiry = addMonths(oldExpiry, m);
    var coverageDays = valid(newExpiry) ? daysBetween(coverageStart, newExpiry) + 1 : 0;
    var deps = (r.dependentsAtRequest !== undefined && r.dependentsAtRequest !== null && r.dependentsAtRequest !== "")
      ? num(r.dependentsAtRequest) : num(emp.dependents);
    var payer = r.depPayerAtRequest || emp.depPayer || "Company";
    var iqamaFee = round2(num(s.iqamaFeeYear) * m / 12);
    var levy = round2((emp.levyExempt ? 0 : num(s.levyMonth)) * m);
    var wpFee = round2(num(s.wpFeeYear) * m / 12);
    var depFee = round2(deps * num(s.depFeeMonth) * m);
    var isLate = renewalLate(r, oldExpiry, s, today);
    var offenseNo = 0;
    if (isLate) {
      var earlier = 0;
      allRenewals.forEach(function (o) {
        if (o === r || o.id === r.id || o.empNo !== r.empNo || !isEarlier(o, r)) return;
        var oe = valid(o.oldExpiry) ? o.oldExpiry : suggestOldExpiry(emp, allRenewals, o.id);
        if (renewalLate(o, oe, s, today)) earlier++;
      });
      offenseNo = earlier + 1;
    }
    var lateFine = !isLate ? 0 : (offenseNo === 1 ? num(s.lateFine1) : num(s.lateFine2));
    var otherFees = round2(num(r.otherFees));
    var compDep = payer === "Employee" ? 0 : depFee;
    var companyPrepaid = round2(iqamaFee + levy + wpFee + compDep);
    var employeeRecoverable = payer === "Employee" ? depFee : 0;
    var expensedNow = round2(lateFine + otherFees);
    return {
      oldExpiry: oldExpiry, coverageStart: coverageStart, newExpiry: newExpiry, coverageDays: coverageDays,
      iqamaFee: iqamaFee, levy: levy, wpFee: wpFee, depFee: depFee, depPayer: payer, dependents: deps,
      isLate: isLate, offenseNo: offenseNo, deportRisk: offenseNo >= 3, lateFine: lateFine,
      otherFees: otherFees, companyPrepaid: companyPrepaid, employeeRecoverable: employeeRecoverable,
      expensedNow: expensedNow, total: round2(companyPrepaid + employeeRecoverable + expensedNow),
      components: { iqama: iqamaFee, levy: levy, wp: wpFee, dep: compDep }
    };
  }

  // ---------- visas ----------
  function isER(v) { return v && (v.type === "ER Single" || v.type === "ER Multiple"); }
  function visaReturnBefore(v) {
    if (!isER(v) || !valid(v.issueDate)) return "";
    return addMonths(v.issueDate, num(v.months));
  }
  function visaStatus(v, today) {
    today = today || todayISO();
    if (!v) return "";
    if (v.type === "Final Exit") {
      if (v.departureDate) return "Left (Final)";
      if (v.issueDate) return "Issued";
      if (v.paymentDate) return "Paid";
      return "Requested";
    }
    if (isER(v)) {
      var rb = visaReturnBefore(v);
      var past = rb && today > rb;
      if (v.returnDate) return "Returned";
      if (v.departureDate) return past ? "Not Returned" : "Outside KSA";
      if (v.issueDate) return past ? "Expired Unused" : "Issued";
      if (v.paymentDate) return "Paid";
      return "Requested";
    }
    if (v.issueDate) return "Issued";
    if (v.paymentDate) return "Paid";
    return "Requested";
  }
  function visaFee(v, settings, allVisas) {
    var s = S(settings), m = num(v.months);
    switch (v.type) {
      case "ER Single": return round2(num(s.erSingleBase) + Math.max(0, m - num(s.erSingleBaseMonths)) * num(s.erSingleAddMonth));
      case "ER Multiple": return round2(num(s.erMultiBase) + Math.max(0, m - num(s.erMultiBaseMonths)) * num(s.erMultiAddMonth));
      case "Final Exit": return round2(num(s.finalExitFee));
      case "Iqama Damaged": return round2(num(s.iqamaDamagedFee));
      case "Iqama Lost":
        var prior = (allVisas || []).filter(function (o) {
          return o !== v && o.id !== v.id && o.empNo === v.empNo && o.type === "Iqama Lost" && isEarlier(o, v);
        }).length;
        return round2(prior === 0 ? num(s.iqamaLostFee) : num(s.iqamaLostFee2));
      default: return 0;
    }
  }

  // ---------- contracts ----------
  var FREQ_MONTHS = { "Annual": 12, "Semi-annual": 6, "Quarterly": 3, "Monthly": 1 };
  function buildInstallments(contract, settings) {
    var s = S(settings), c = contract || {};
    var start = c.startDate, end = c.endDate;
    if (!valid(start) || !valid(end) || end < start) return [];
    var n = FREQ_MONTHS[c.frequency] || 12;
    var total = num(c.totalAmount);
    var contractDays = daysBetween(start, end) + 1;
    var existing = {};
    (c.installments || []).forEach(function (i) { existing[i.no] = i; });
    var out = [], k = 0;
    while (true) {
      var ps = addMonths(start, k * n);
      if (ps > end) break;
      var pe = addDays(addMonths(start, (k + 1) * n), -1);
      if (pe > end) pe = end;
      out.push({ no: k + 1, periodStart: ps, periodEnd: pe });
      k++;
      if (k > 1200) break;
    }
    var sum = 0;
    out.forEach(function (it, idx) {
      var amt;
      if (idx === out.length - 1) amt = round2(total - sum);
      else { amt = round2(total * (daysBetween(it.periodStart, it.periodEnd) + 1) / contractDays); sum = round2(sum + amt); }
      var ex = existing[it.no] || {};
      it.dueDate = (ex.dueDate && ex.periodStart === it.periodStart) ? ex.dueDate : it.periodStart;
      it.amount = amt;
      it.vat = c.vatApplicable ? round2(amt * num(s.vatRate)) : 0;
      it.paidDate = ex.paidDate || "";
      it.paymentRef = ex.paymentRef || "";
    });
    return out;
  }
  function contractExpKey(c) {
    return c.category === "Branch Rent" ? "rentExp" : c.category === "Medical Insurance" ? "insExp" : "otherPrepaidExp";
  }

  // ---------- prepaid items & amortization ----------
  function prepaidItems(state, settings, today) {
    var s = S(settings); state = state || {}; today = today || todayISO();
    var emps = {}; (state.employees || []).forEach(function (e) { emps[e.empNo] = e; });
    var renewals = state.renewals || [], items = [];
    renewals.forEach(function (r) {
      if (!valid(r.paymentDate)) return;
      var emp = emps[r.empNo] || { empNo: r.empNo };
      var c = calcRenewal(r, emp, s, renewals, today);
      if (!(c.companyPrepaid > 0) || !valid(c.coverageStart) || !valid(c.newExpiry)) return;
      var split = { iqamaExp: c.iqamaFee, levyExp: c.levy, wpExp: c.wpFee };
      if (c.components.dep > 0) split.depExp = c.components.dep;
      items.push({
        key: "renewal:" + r.id, source: "renewal", refId: r.id,
        label: r.id + " " + (emp.nameEn || r.empNo) + " (" + num(r.months) + "m)",
        empNo: r.empNo, category: "Iqama Renewal", paidDate: r.paymentDate,
        start: c.coverageStart, end: c.newExpiry, amount: c.companyPrepaid, split: split, prepaidAccount: "prepaid"
      });
    });
    (state.contracts || []).forEach(function (con) {
      var ek = contractExpKey(con);
      (con.installments || []).forEach(function (i) {
        if (!valid(i.paidDate) || !valid(i.periodStart) || !valid(i.periodEnd)) return;
        var amt = round2(num(i.amount)); if (!(amt > 0)) return;
        var split = {}; split[ek] = amt;
        items.push({
          key: "contract:" + con.id + ":" + i.no, source: "contract", refId: con.id, installmentNo: i.no,
          label: con.id + " " + (con.category || "") + (con.branch ? " - " + con.branch : "") + " #" + i.no,
          branch: con.branch || "", category: con.category || "Other", paidDate: i.paidDate,
          start: i.periodStart, end: i.periodEnd, amount: amt, split: split, prepaidAccount: PREPAID_OF[ek]
        });
      });
    });
    return items;
  }
  function fraction(item, dateISO) {
    if (!item.paidDate || !valid(dateISO) || item.paidDate > dateISO) return 0;
    var tot = daysBetween(item.start, item.end) + 1;
    if (!(tot > 0)) return 1;
    var f = (daysBetween(item.start, dateISO) + 1) / tot;
    return Math.max(0, Math.min(1, f));
  }
  function cumSplit(item, dateISO) {
    var f = fraction(item, dateISO), o = {};
    Object.keys(item.split || {}).forEach(function (k) { o[k] = round2(item.split[k] * f); });
    return o;
  }
  function sumObj(o) { var t = 0; Object.keys(o).forEach(function (k) { t += o[k]; }); return round2(t); }
  function cumRecognized(item, dateISO) { return sumObj(cumSplit(item, dateISO)); }
  function prevMonthEnd(monthISO) { return addDays(monthStart(monthISO), -1); }
  function monthlyAmortSplit(item, monthISO) {
    var a = cumSplit(item, monthEnd(monthISO)), b = cumSplit(item, prevMonthEnd(monthISO)), o = {};
    Object.keys(a).forEach(function (k) { o[k] = round2(a[k] - (b[k] || 0)); });
    return o;
  }
  function monthlyAmort(item, monthISO) {
    return round2(cumRecognized(item, monthEnd(monthISO)) - cumRecognized(item, prevMonthEnd(monthISO)));
  }
  function amortSchedule(state, settings, fromMonth, nMonths, today) {
    var items = prepaidItems(state, settings, today);
    var months = [], start = monthStart(fromMonth || todayISO());
    for (var i = 0; i < (nMonths || 12); i++) months.push(addMonths(start, i));
    var totals = months.map(function () { return 0; }), byAccount = {};
    var lastEnd = monthEnd(months[months.length - 1] || start);
    var rows = items.map(function (it) {
      var byMonth = months.map(function (m, j) {
        var sp = monthlyAmortSplit(it, m), v = sumObj(sp);
        totals[j] = round2(totals[j] + v);
        Object.keys(sp).forEach(function (k) {
          if (!byAccount[k]) byAccount[k] = months.map(function () { return 0; });
          byAccount[k][j] = round2(byAccount[k][j] + sp[k]);
        });
        return v;
      });
      var td = cumRecognized(it, lastEnd);
      return { item: it, byMonth: byMonth, totalToDate: td, balance: round2((it.paidDate <= lastEnd ? it.amount : 0) - td) };
    });
    return { months: months, rows: rows, totals: totals, byAccount: byAccount };
  }
  function prepaidRollforward(state, settings, monthISO, today) {
    var items = prepaidItems(state, settings, today);
    var ms = monthStart(monthISO), me = monthEnd(monthISO), pe = prevMonthEnd(monthISO);
    function blank() { return { opening: 0, additions: 0, amortization: 0, closing: 0, check: 0 }; }
    var all = blank(), accounts = {};
    PREPAID_ACCOUNTS.forEach(function (a) { accounts[a] = blank(); });
    function add(rec, f, v) { rec[f] = round2(rec[f] + v); }
    items.forEach(function (it) {
      var cPrev = cumSplit(it, pe), cEnd = cumSplit(it, me);
      Object.keys(it.split).forEach(function (k) {
        var acc = accounts[PREPAID_OF[k] || "prepaid"], amt = round2(it.split[k]);
        var open = it.paidDate <= pe ? round2(amt - cPrev[k]) : 0;
        var addn = (it.paidDate >= ms && it.paidDate <= me) ? amt : 0;
        var am = it.paidDate <= me ? round2(cEnd[k] - cPrev[k]) : 0;
        var close = it.paidDate <= me ? round2(amt - cEnd[k]) : 0;
        [[acc, "opening", open], [acc, "additions", addn], [acc, "amortization", am], [acc, "closing", close],
         [all, "opening", open], [all, "additions", addn], [all, "amortization", am], [all, "closing", close]]
          .forEach(function (x) { add(x[0], x[1], x[2]); });
      });
    });
    [all].concat(PREPAID_ACCOUNTS.map(function (a) { return accounts[a]; })).forEach(function (r) {
      r.check = round2(r.opening + r.additions - r.amortization - r.closing);
    });
    all.accounts = accounts;
    return all;
  }

  // ---------- journal ----------
  function monthlyJournal(state, settings, monthISO, today) {
    var s = S(settings), A = s.accounts; state = state || {}; today = today || todayISO();
    var ms = monthStart(monthISO), me = monthEnd(monthISO);
    var inMonth = function (d) { return valid(d) && d >= ms && d <= me; };
    var emps = {}; (state.employees || []).forEach(function (e) { emps[e.empNo] = e; });
    var raw = [];
    function line(key, dr, cr, memo, cls) {
      return { accountKey: key, account: A[key] || key, debit: round2(dr), credit: round2(cr), memo: memo || "", cls: cls || "" };
    }
    (state.renewals || []).forEach(function (r) {
      if (!inMonth(r.paymentDate)) return;
      var emp = emps[r.empNo] || { empNo: r.empNo };
      var c = calcRenewal(r, emp, s, state.renewals, today);
      var nm = r.empNo + (emp.nameEn ? " " + emp.nameEn : "");
      var memo = "Iqama renewal " + r.id + " - " + nm + " (" + num(r.months) + "m)";
      var L = [];
      if (c.companyPrepaid) L.push(line("prepaid", c.companyPrepaid, 0, memo));
      if (c.employeeRecoverable) L.push(line("empRecv", c.employeeRecoverable, 0, "Dependents fee - " + nm));
      if (c.lateFine) L.push(line("finesExp", c.lateFine, 0, "Late renewal fine (offense " + c.offenseNo + ") - " + nm));
      if (c.otherFees) L.push(line("otherExp", c.otherFees, 0, "Other fees " + r.id + " - " + nm));
      if (c.total) L.push(line("bank", 0, c.total, memo + (r.sadadNo ? " SADAD " + r.sadadNo : "") + (r.paymentRef ? " Ref " + r.paymentRef : "")));
      if (L.length) raw.push({ date: r.paymentDate, order: 1, memo: memo, lines: L });
    });
    (state.visas || []).forEach(function (v) {
      if (!inMonth(v.paymentDate)) return;
      var fee = visaFee(v, s, state.visas); if (!fee) return;
      var emp = emps[v.empNo] || {};
      var memo = v.type + " " + v.id + " - " + v.empNo + (emp.nameEn ? " " + emp.nameEn : "");
      raw.push({ date: v.paymentDate, order: 2, memo: memo, lines: [
        line(v.payer === "Employee" ? "empRecv" : "visaExp", fee, 0, memo), line("bank", 0, fee, memo)] });
    });
    (state.contracts || []).forEach(function (con) {
      var pk = PREPAID_OF[contractExpKey(con)];
      (con.installments || []).forEach(function (i) {
        if (!inMonth(i.paidDate)) return;
        var memo = (con.category || "Contract") + " " + con.id + " #" + i.no + (con.branch ? " - " + con.branch : "") +
          " (" + i.periodStart + " to " + i.periodEnd + ")";
        var cls = con.category === "Branch Rent" ? (con.branch || "") : "";
        var amt = round2(num(i.amount)), vat = round2(num(i.vat)), L = [];
        if (amt) L.push(line(pk, amt, 0, memo, cls));
        if (vat) L.push(line("inputVat", vat, 0, "VAT " + memo, cls));
        if (amt + vat) L.push(line("bank", 0, round2(amt + vat), memo + (i.paymentRef ? " Ref " + i.paymentRef : ""), cls));
        if (L.length) raw.push({ date: i.paidDate, order: 3, memo: memo, lines: L });
      });
    });
    // amortization
    var items = prepaidItems(state, s, today), byExp = {};
    items.forEach(function (it) {
      var sp = monthlyAmortSplit(it, ms);
      Object.keys(sp).forEach(function (k) {
        if (!sp[k]) return;
        var grp = k === "rentExp" ? (it.branch || "") : "";
        byExp[k] = byExp[k] || {};
        byExp[k][grp] = round2((byExp[k][grp] || 0) + sp[k]);
      });
    });
    var mLabel = MONTHS[+ms.slice(5, 7) - 1] + " " + ms.slice(0, 4);
    EXP_ORDER.forEach(function (k) {
      if (!byExp[k]) return;
      var memo = "Amortization of " + (A[PREPAID_OF[k]] || PREPAID_OF[k]) + " - " + (A[k] || k) + " - " + mLabel;
      var L = [], tot = 0;
      Object.keys(byExp[k]).sort().forEach(function (g) {
        var v = byExp[k][g]; if (!v) return;
        tot = round2(tot + v);
        L.push(line(k, v > 0 ? v : 0, v < 0 ? -v : 0, k === "rentExp" ? (g || memo) : memo, k === "rentExp" ? g : ""));
      });
      if (!tot) return;
      L.push(line(PREPAID_OF[k], tot < 0 ? -tot : 0, tot > 0 ? tot : 0, memo));
      raw.push({ date: me, order: 4, memo: memo, lines: L });
    });
    raw.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order; });
    var prefix = "JE-" + ms.slice(0, 4) + "-" + ms.slice(5, 7) + "-";
    var td = 0, tc = 0, balanced = true;
    var entries = raw.map(function (e, i) {
      var d = 0, c = 0;
      e.lines.forEach(function (l) { d += l.debit; c += l.credit; });
      if (Math.abs(round2(d) - round2(c)) > 0.005) balanced = false;
      td += d; tc += c;
      return { jeNo: prefix + pad(i + 1, 2), date: e.date, memo: e.memo, lines: e.lines };
    });
    td = round2(td); tc = round2(tc);
    if (Math.abs(td - tc) > 0.005) balanced = false;
    return { entries: entries, balanced: balanced, totals: { debit: td, credit: tc } };
  }
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function journalCSV(journal) {
    var rows = [["JournalNo", "JournalDate", "AccountName", "Debits", "Credits", "Description", "Name", "Class"]];
    ((journal && journal.entries) || []).forEach(function (e) {
      e.lines.forEach(function (l) {
        rows.push([e.jeNo, dmy(e.date), l.account, l.debit ? l.debit.toFixed(2) : "", l.credit ? l.credit.toFixed(2) : "",
          l.memo || e.memo || "", l.name || "", l.cls || ""]);
      });
    });
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }

  // ---------- alerts ----------
  var SEV_RANK = { expired: 0, critical: 1, warning: 2, notice: 3 };
  function stdSeverity(d) { return d < 0 ? "expired" : d <= 15 ? "critical" : d <= 30 ? "warning" : d <= 90 ? "notice" : null; }
  function stageFor(d, thresholds) {
    if (d < 0) return "expired";
    var best = null;
    (thresholds || []).forEach(function (t) { if (t >= d && (best === null || t < best)) best = t; });
    return best;
  }
  function isActive(e) { return e && (e.status === "Active" || e.status === "On Vacation" || !e.status); }
  function alerts(state, settings, today) {
    var s = S(settings); state = state || {}; today = today || todayISO();
    var out = [], renewals = state.renewals || [];
    var emps = {}; (state.employees || []).forEach(function (e) { emps[e.empNo] = e; });
    function push(a) {
      a.key = [a.category, a.ref, a.stage].join("|");
      out.push(a);
    }
    (state.employees || []).forEach(function (e) {
      if (!isActive(e)) return;
      var nm = e.nameEn || e.empNo;
      var exp = effectiveExpiry(e, renewals);
      if (valid(exp)) {
        var d = daysBetween(today, exp);
        var open = renewals.filter(function (r) { return r.empNo === e.empNo && !r.completedDate; });
        if (open.length) {
          open.forEach(function (r) {
            var st = renewalStatus(r);
            push({ severity: stdSeverity(d) || "notice", category: "Renewal", empNo: e.empNo, ref: r.id,
              title: "Renewal " + r.id + " pending: " + st,
              message: nm + ": renewal " + r.id + " is at stage \"" + st + "\"; iqama " +
                (d < 0 ? "expired " + (-d) + " day(s) ago" : "expires in " + d + " day(s)") + " (" + fmtDate(exp) + ").",
              dueDate: exp, daysLeft: d, stage: st });
          });
        } else {
          var sev = stdSeverity(d);
          if (sev) {
            var stg = stageFor(d, s.reminderDays);
            push({ severity: sev, category: "Iqama", empNo: e.empNo, ref: e.empNo,
              title: d < 0 ? "Iqama expired" : "Iqama expiring in " + d + " day(s)",
              message: nm + " (" + (e.iqamaNo || "no iqama no") + "): iqama " +
                (d < 0 ? "expired " + (-d) + " day(s) ago - renew now to avoid late fines" : "expires " + fmtDate(exp)) +
                (stg !== null && stg !== "expired" ? " (" + stg + "-day reminder)." : "."),
              dueDate: exp, daysLeft: d, stage: stg === null ? "" : String(stg) });
          }
        }
      }
      if (valid(e.passportExpiry)) {
        var pd = daysBetween(today, e.passportExpiry);
        if (pd < num(s.passportAlertDays)) {
          var psev = pd < 0 ? "expired" : pd < num(s.passportMinDays) ? "critical" : "warning";
          push({ severity: psev, category: "Passport", empNo: e.empNo, ref: e.empNo,
            title: pd < 0 ? "Passport expired" : "Passport expires in " + pd + " day(s)",
            message: nm + " (" + (e.passportNo || "") + "): passport " + (pd < 0 ? "expired" : "expires") + " " + fmtDate(e.passportExpiry) +
              (pd >= 0 && pd < num(s.passportMinDays) ? " - less than " + s.passportMinDays + " days validity blocks iqama renewal / exit re-entry." : "."),
            dueDate: e.passportExpiry, daysLeft: pd, stage: psev });
        }
      }
      if (valid(e.insuranceExpiry)) {
        var id = daysBetween(today, e.insuranceExpiry);
        if (id < num(s.insuranceAlertDays)) {
          var isev = id < 0 ? "expired" : id <= 15 ? "critical" : "warning";
          push({ severity: isev, category: "Insurance", empNo: e.empNo, ref: e.empNo,
            title: id < 0 ? "Medical insurance expired" : "Medical insurance expires in " + id + " day(s)",
            message: nm + ": medical insurance " + (id < 0 ? "expired" : "expires") + " " + fmtDate(e.insuranceExpiry) + " (required for iqama renewal).",
            dueDate: e.insuranceExpiry, daysLeft: id, stage: isev });
        }
      }
    });
    // visas
    (state.visas || []).forEach(function (v) {
      if (!isER(v)) return;
      var e = emps[v.empNo] || { empNo: v.empNo }, nm = e.nameEn || v.empNo;
      var st = visaStatus(v, today), rb = visaReturnBefore(v);
      if (!rb) return;
      var d = daysBetween(today, rb);
      if (st === "Outside KSA" && d <= 14) {
        push({ severity: d <= 7 ? "critical" : "warning", category: "Visa", empNo: v.empNo, ref: v.id,
          title: "Return due in " + d + " day(s)",
          message: nm + " is outside KSA on " + v.id + "; must return before " + fmtDate(rb) + ".",
          dueDate: rb, daysLeft: d, stage: "return14" });
      } else if (st === "Not Returned") {
        push({ severity: "expired", category: "Visa", empNo: v.empNo, ref: v.id, title: "Employee did not return",
          message: nm + " did not return by " + fmtDate(rb) + " (" + v.id + "). Report to Jawazat / Muqeem.",
          dueDate: rb, daysLeft: d, stage: "notReturned" });
      } else if (st === "Expired Unused") {
        push({ severity: "critical", category: "Visa", empNo: v.empNo, ref: v.id, title: "Exit re-entry expired unused",
          message: v.id + " for " + nm + " expired " + fmtDate(rb) + " without use. Cancel it to avoid the SAR " +
            num(s.erUnusedFine).toLocaleString("en-US") + " fine.",
          dueDate: rb, daysLeft: d, stage: "expiredUnused" });
      }
      if (!v.returnDate && (st === "Issued" || st === "Outside KSA")) {
        var exp = effectiveExpiry(e, renewals);
        if (valid(exp) && rb > exp) {
          push({ severity: "warning", category: "Visa", empNo: v.empNo, ref: v.id, title: "Return date after iqama expiry",
            message: v.id + " return-before " + fmtDate(rb) + " is later than iqama expiry " + fmtDate(exp) + " for " + nm + ". Renew the iqama before travel/return.",
            dueDate: exp, daysLeft: daysBetween(today, exp), stage: "afterIqama" });
        }
      }
    });
    // 3rd+ late offense
    renewals.forEach(function (r) {
      var e = emps[r.empNo] || { empNo: r.empNo };
      var c = calcRenewal(r, e, s, renewals, today);
      if (!c.deportRisk) return;
      push({ severity: "critical", category: "Renewal", empNo: r.empNo, ref: r.id,
        title: "Late renewal offense #" + c.offenseNo + " - deportation risk",
        message: (e.nameEn || r.empNo) + ": renewal " + r.id + " is late offense #" + c.offenseNo + ". A 3rd offense may lead to deportation.",
        dueDate: addDays(c.oldExpiry, num(s.lateGraceDays)), daysLeft: daysBetween(today, c.oldExpiry), stage: "offense" + c.offenseNo });
    });
    // contracts
    var contracts = state.contracts || [];
    var instMax = Math.max.apply(null, [0].concat(s.installmentReminderDays || []));
    var conMax = Math.max.apply(null, [0].concat(s.contractReminderDays || []));
    contracts.forEach(function (c) {
      var cat = c.category === "Branch Rent" ? "Rent" : "Contract";
      var who = (c.category || "Contract") + (c.branch ? " - " + c.branch : "") + (c.vendor ? " (" + c.vendor + ")" : "");
      (c.installments || []).forEach(function (i) {
        if (i.paidDate || !valid(i.dueDate)) return;
        var d = daysBetween(today, i.dueDate);
        if (d > instMax) return;
        var stg = stageFor(d, s.installmentReminderDays);
        var due = round2(num(i.amount) + num(i.vat));
        push({ severity: d < 0 ? "expired" : d <= 7 ? "critical" : d <= 14 ? "warning" : "notice", category: cat,
          empNo: "", ref: c.id + "#" + i.no,
          title: d < 0 ? "Installment overdue " + (-d) + " day(s)" : "Installment due in " + d + " day(s)",
          message: who + ": installment #" + i.no + " SAR " + due.toFixed(2) + " (incl. VAT) " + (d < 0 ? "was due " : "due ") + fmtDate(i.dueDate) + ".",
          dueDate: i.dueDate, daysLeft: d, stage: d < 0 ? "overdue" : String(stg) });
      });
      if (valid(c.endDate)) {
        var d = daysBetween(today, c.endDate);
        if (d <= conMax && d >= -30) {
          var renewed = contracts.some(function (o) {
            return o !== c && o.id !== c.id && o.category === c.category && (o.branch || "") === (c.branch || "") &&
              valid(o.endDate) && o.endDate > c.endDate;
          });
          if (!renewed) {
            var stg2 = stageFor(d, s.contractReminderDays);
            push({ severity: d < 0 ? "expired" : d <= 30 ? "critical" : d <= 60 ? "warning" : "notice", category: cat,
              empNo: "", ref: c.id,
              title: d < 0 ? "Contract ended without renewal" : "Contract ends in " + d + " day(s)",
              message: who + " " + (c.refNo ? "[" + c.refNo + "] " : "") + (d < 0 ? "ended " : "ends ") + fmtDate(c.endDate) +
                " and no renewal contract is recorded" + (c.category === "Branch Rent" ? " (renew on Ejar)." : "."),
              dueDate: c.endDate, daysLeft: d, stage: d < 0 ? "ended" : "end" + stg2 });
          }
        }
      }
    });
    out.sort(function (a, b) {
      var r = SEV_RANK[a.severity] - SEV_RANK[b.severity];
      if (r) return r;
      return (a.daysLeft || 0) - (b.daysLeft || 0);
    });
    return out;
  }

  // ---------- forecast ----------
  function forecast(state, settings, fromMonth, nMonths, today) {
    var s = S(settings); state = state || {}; today = today || todayISO();
    var renewals = state.renewals || [];
    var start = monthStart(fromMonth || today), res = [];
    for (var i = 0; i < (nMonths || 12); i++) {
      var m = addMonths(start, i), me = monthEnd(m);
      var count = 0, cost = 0, rent = 0;
      (state.employees || []).forEach(function (e) {
        if (!isActive(e)) return;
        var exp = effectiveExpiry(e, renewals);
        if (!valid(exp) || exp < m || exp > me) return;
        count++;
        var deps = e.depPayer === "Employee" ? 0 : num(e.dependents);
        cost += num(s.iqamaFeeYear) + (e.levyExempt ? 0 : num(s.levyMonth) * 12) + num(s.wpFeeYear) + deps * num(s.depFeeMonth) * 12;
      });
      (state.contracts || []).forEach(function (c) {
        (c.installments || []).forEach(function (it) {
          if (it.paidDate || !valid(it.dueDate) || it.dueDate < m || it.dueDate > me) return;
          rent += num(it.amount) + num(it.vat);
        });
      });
      res.push({ month: m, count: count, iqamaCost: round2(cost), rentDue: round2(rent) });
    }
    return res;
  }

  var Engine = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    round2: round2,
    parseISO: parseISO, iso: iso, addDays: addDays, addMonths: addMonths, daysBetween: daysBetween,
    monthStart: monthStart, monthEnd: monthEnd, todayISO: todayISO, toHijri: toHijri, fmtDate: fmtDate,
    nextNumber: nextNumber,
    renewalStatus: renewalStatus, visaStatus: visaStatus, visaReturnBefore: visaReturnBefore,
    effectiveExpiry: effectiveExpiry, suggestOldExpiry: suggestOldExpiry,
    calcRenewal: calcRenewal, visaFee: visaFee, buildInstallments: buildInstallments,
    prepaidItems: prepaidItems, cumRecognized: cumRecognized, monthlyAmort: monthlyAmort, monthlyAmortSplit: monthlyAmortSplit,
    amortSchedule: amortSchedule, prepaidRollforward: prepaidRollforward,
    monthlyJournal: monthlyJournal, journalCSV: journalCSV,
    alerts: alerts, forecast: forecast
  };
  root.Engine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
