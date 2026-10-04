const assert = require('assert');
const L = require('./lease.js');
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} got ${a} (tol ${tol})`);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

const settings = { leaseStandard: 'ifrs16', defaultIbr: 0.065, vatRate: 0.15 };

// Real-shaped contract: 20 semi-annual payments of 150,000 from 2025-03-11, end 2035-03-10, ibr 6.5%
function realContract() {
  const inst = [];
  for (let k = 0; k < 20; k++) {
    const ps = L.addMonths('2025-03-11', 6 * k);
    inst.push({ no: k + 1, dueDate: ps, periodStart: ps, periodEnd: L.addDays(L.addMonths('2025-03-11', 6 * (k + 1)), -1),
      amount: 150000, vat: 22500, paidDate: k < 3 ? ps : '', paymentRef: k < 3 ? 'TRF-' + (k + 1) : '' });
  }
  return { id: 'CON-0001', category: 'Branch Rent', branch: 'Riyadh - Olaya', vendor: 'Landlord', refNo: 'EJ-1',
    startDate: '2025-03-11', endDate: '2035-03-10', totalAmount: 3000000, frequency: 'Semi-annual', vatApplicable: true,
    installments: inst, model: 'auto', ibr: 0.065, noticeDays: 90, areaSqm: 250 };
}
const C = realContract();
const TOTAL = 3000000;

t('basics: termDays / resolveModel / payments', () => {
  assert.strictEqual(L.termDays(C), L.daysBetween('2025-03-11', '2035-03-10') + 1);
  assert.strictEqual(L.resolveModel(C, settings), 'ifrs16');
  assert.strictEqual(L.resolveModel(C, {}), 'prepaid');
  assert.strictEqual(L.resolveModel(Object.assign({}, C, { endDate: '2026-03-10' }), settings), 'prepaid');
  assert.strictEqual(L.resolveModel(Object.assign({}, C, { model: 'straightline' }), settings), 'straightline');
  const p = L.payments(C);
  assert.strictEqual(p.length, 20);
  assert.strictEqual(p[0].date, '2025-03-11'); assert.strictEqual(p[19].date, '2034-09-11');
  assert.ok(p[0].paid && !p[3].paid);
});

const sch = L.ifrs16(C, settings);
t('IFRS16: PV < sum of payments', () => {
  assert.ok(sch.pv > 0 && sch.pv < TOTAL, 'pv ' + sch.pv);
  console.log('     pv =', sch.pv, ' rouInitial =', sch.rouInitial, ' months =', sch.months.length);
});
t('IFRS16: schedule shape and closing liability 0 at end', () => {
  assert.strictEqual(sch.months[0].month, '2025-03-01');
  assert.strictEqual(sch.months[sch.months.length - 1].month, '2035-03-01');
  assert.strictEqual(sch.months.length, 121);
  assert.strictEqual(sch.months[0].openingLiab, sch.pv);
  assert.strictEqual(sch.months[sch.months.length - 1].closingLiab, 0);
  assert.strictEqual(sch.months[sch.months.length - 1].rouNbv, 0);
  sch.months.forEach((m, i) => {
    near(m.openingLiab + m.interest - m.payments, m.closingLiab, 0.001, 'roll ' + m.month);
    if (i) assert.strictEqual(m.openingLiab, sch.months[i - 1].closingLiab);
  });
  // last real interest month is not distorted by rounding absorption
  near(sch.months[sch.months.length - 1].interest, 0, 0.05, 'final month interest after last payment');
});
t('IFRS16: sum(interest) = sum(payments) - pv (±0.05)', () => {
  near(sum(sch.months, m => m.interest), sum(sch.months, m => m.payments) - sch.pv, 0.05);
  near(sum(sch.months, m => m.payments), TOTAL, 0.001);
});
t('IFRS16: sum(depreciation) = rouInitial (±0.05)', () => {
  near(sum(sch.months, m => m.depreciation), sch.rouInitial, 0.05);
  near(sch.rouInitial, sch.pv, 0.001, 'no IDC/incentives');
});
t('IFRS16: liabilityAt ties to schedule; currentPortion between 0 and liability', () => {
  const r = sch.months.find(m => m.month === '2026-09-01');
  near(L.liabilityAt(C, settings, '2026-09-30'), r.closingLiab, 0.001);
  const liab = L.liabilityAt(C, settings, '2026-10-04');
  const cur = L.currentPortion(C, settings, '2026-10-04');
  assert.ok(cur > 0 && cur < liab, `cur ${cur} liab ${liab}`);
  console.log('     liability 2026-10-04 =', liab, ' current =', cur);
  assert.strictEqual(L.liabilityAt(C, settings, '2024-01-01'), 0);
  assert.strictEqual(L.liabilityAt(C, settings, '2035-03-10'), 0);
});
t('IFRS16: IDC and incentives adjust ROU only', () => {
  const c2 = Object.assign({}, C, { initialDirectCosts: 12000, incentives: 5000 });
  const s2 = L.ifrs16(c2, settings);
  near(s2.rouInitial, s2.pv + 7000, 0.001);
  near(sum(s2.months, m => m.depreciation), s2.rouInitial, 0.05);
});

t('straight-line over full term = total payments (±0.05)', () => {
  const months = sch.months.map(m => m.month);
  near(sum(months, m => L.straightLineMonth(C, m)), TOTAL, 0.05);
  const sl = L.straightLine(C, '2035-03-10');
  near(sl.expenseToDate, TOTAL, 0.05);
  const mid = L.straightLine(C, '2026-10-04');
  near(mid.paidToDate, 450000, 0.001);
  near(mid.balance, mid.paidToDate - mid.expenseToDate, 0.001);
  assert.ok(mid.balance < 0, 'accrued: #4 overdue ' + mid.balance);
});

t('maturity buckets sum = unpaid total', () => {
  const ma = L.maturityAnalysis([C, { id: 'INS-1', category: 'Medical Insurance', installments: [{ no: 1, dueDate: '2027-01-01', amount: 999 }] }], settings, '2026-10-04');
  assert.strictEqual(ma.rows.length, 1, 'non-lease contract excluded');
  const o = ma.overall;
  near(L.BUCKETS.reduce((s, b) => s + o[b], 0), o.total, 0.001);
  near(o.total, 17 * 150000, 0.001);
  near(o['≤1y'], 450000, 0.001); // overdue #4 + 2027-03-11 + 2027-09-11
  near(o['>5y'], sum(L.payments(C).filter(p => p.date > '2031-10-04'), p => p.amount), 0.001);
});

t('critical dates', () => {
  const cd = L.criticalDates(C, settings, '2026-10-04');
  const types = cd.map(x => x.type);
  assert.ok(types.includes('Notice deadline') && types.includes('Lease end') && types.includes('Next payment'));
  const nd = cd.find(x => x.type === 'Notice deadline');
  assert.strictEqual(nd.date, L.addDays('2035-03-10', -90));
  const np = cd.find(x => x.type === 'Next payment');
  assert.strictEqual(np.date, '2027-03-11'); // #4 2026-09-11 is unpaid -> overdue
  const od = cd.find(x => x.type === 'Payment overdue');
  assert.ok(od && od.date === '2026-09-11' && od.daysLeft === -23 && od.severity === 'expired');
});

t('journal (IFRS16) balanced; month with payment', () => {
  const c = realContract(); c.installments[3].paidDate = '2026-09-11'; c.installments[3].paymentRef = 'TRF-4';
  const j = L.leaseJournal([c], settings, '2026-09-01', '2026-10-04');
  assert.ok(j.balanced);
  assert.strictEqual(j.entries[0].jeNo, 'LJE-2026-09-01');
  const pay = j.entries[0];
  assert.strictEqual(pay.date, '2026-09-11');
  assert.deepStrictEqual(pay.lines.map(l => [l.accountKey, l.debit, l.credit, l.cls]),
    [['leaseLiab', 150000, 0, 'Riyadh - Olaya'], ['inputVat', 22500, 0, 'Riyadh - Olaya'], ['bank', 0, 172500, 'Riyadh - Olaya']]);
  const row = sch.months.find(m => m.month === '2026-09-01');
  const intE = j.entries.find(e => e.lines[0].accountKey === 'leaseInterest');
  assert.strictEqual(intE.lines[0].debit, row.interest);
  const depE = j.entries.find(e => e.lines[0].accountKey === 'rouDep');
  assert.strictEqual(depE.lines[1].accountKey, 'rouAccDep'); assert.strictEqual(depE.lines[1].credit, row.depreciation);
  assert.strictEqual(j.entries.length, 3);
  const j0 = L.leaseJournal([C], settings, '2025-03-01');
  assert.ok(j0.balanced);
  const init = j0.entries[0];
  assert.strictEqual(init.lines[0].accountKey, 'rouAsset'); assert.strictEqual(init.lines[0].debit, sch.rouInitial);
  assert.strictEqual(init.lines[1].accountKey, 'leaseLiab'); assert.strictEqual(init.lines[1].credit, sch.pv);
  // prepaid-model contracts are excluded
  assert.strictEqual(L.leaseJournal([C], { leaseStandard: 'prepaid' }, '2026-09-01').entries.length, 0);
});

// Straight-line with uneven payments (escalating, with a late payment creating an accrual)
function slContract() {
  return { id: 'CON-0002', category: 'Branch Rent', branch: 'Jeddah - Tahlia', startDate: '2026-01-01', endDate: '2028-12-31',
    model: 'straightline', vatApplicable: true, installments: [
      { no: 1, dueDate: '2026-01-01', amount: 80000, vat: 12000, paidDate: '2026-01-01' },
      { no: 2, dueDate: '2027-01-01', amount: 100000, vat: 15000, paidDate: '2027-02-15' },
      { no: 3, dueDate: '2028-01-01', amount: 120000, vat: 18000, paidDate: '' }] };
}
t('straight-line uneven payments: tie-out and balance sign', () => {
  const c = slContract(), T = L.termDays(c);
  assert.strictEqual(T, 1096);
  let tot = 0;
  for (let m = '2026-01-01'; m <= '2028-12-01'; m = L.addMonths(m, 1)) tot += L.straightLineMonth(c, m);
  near(tot, 300000, 0.05);
  near(L.straightLineMonth(c, '2026-01-01'), 300000 / T * 31, 0.01);
  const a = L.straightLine(c, '2026-12-31');
  near(a.expenseToDate, 300000 * 365 / T, 0.01); assert.ok(a.balance < 0, 'accrued after year 1: ' + a.balance);
  const b = L.straightLine(c, '2027-02-15');
  near(b.paidToDate, 180000, 0.001);
  assert.strictEqual(L.straightLineMonth(c, '2025-12-01'), 0);
  assert.strictEqual(L.straightLineMonth(c, '2029-01-01'), 0);
});
t('straight-line journal: accrual then payment clears accruedRent first', () => {
  const c = slContract();
  const dec = L.leaseJournal([c], {}, '2026-10-01');
  assert.ok(dec.balanced);
  const e = dec.entries[0];
  const exp = L.straightLineMonth(c, '2026-10-01');
  assert.strictEqual(e.lines[0].accountKey, 'rentExp'); assert.strictEqual(e.lines[0].debit, exp);
  const cr = Object.fromEntries(e.lines.slice(1).map(l => [l.accountKey, l.credit]));
  assert.ok(cr.prepaidRent > 0 && cr.accruedRent > 0, 'split Oct 2026 ' + JSON.stringify(cr)); // prepaid runs out ~19 Oct
  const feb = L.leaseJournal([c], {}, '2027-02-01');
  assert.ok(feb.balanced);
  const pay = feb.entries[0];
  const accruedBefore = -L.straightLine(c, '2027-01-31').balance;
  const dr = Object.fromEntries(pay.lines.map(l => [l.accountKey, l.debit]));
  near(dr.accruedRent, accruedBefore, 0.001);
  near(dr.prepaidRent, 100000 - accruedBefore, 0.001);
  assert.strictEqual(dr.inputVat, 15000);
  assert.strictEqual(pay.lines.find(l => l.accountKey === 'bank').credit, 115000);
  // net GL position over the whole life = paid - expense
  let pre = 0, acc = 0;
  for (let m = '2026-01-01'; m <= '2028-12-01'; m = L.addMonths(m, 1)) {
    const j = L.leaseJournal([c], {}, m, '2029-01-01'); assert.ok(j.balanced, 'balanced ' + m);
    j.entries.forEach(x => x.lines.forEach(l => {
      if (l.accountKey === 'prepaidRent') pre += l.debit - l.credit;
      if (l.accountKey === 'accruedRent') acc += l.credit - l.debit;
    }));
    assert.ok(pre > -0.005 && acc > -0.005, 'no negative balances ' + m);
  }
  near(pre - acc, 180000 - 300000, 0.05); // payment #3 never paid -> accrued
});

// Payments started before commencement
function earlyContract() {
  const inst = [];
  for (let k = 0; k < 6; k++) {
    const d = k === 0 ? '2025-01-15' : L.addMonths('2025-03-01', 6 * k);
    inst.push({ no: k + 1, dueDate: d, amount: 60000, vat: 9000, paidDate: k < 2 ? d : '' });
  }
  return { id: 'CON-0003', category: 'Branch Rent', branch: 'Dammam', startDate: '2025-03-01', endDate: '2028-02-29',
    model: 'ifrs16', ibr: 0.07, installments: inst };
}
t('IFRS16 with payment before commencement', () => {
  const c = earlyContract(), s = L.ifrs16(c, settings);
  assert.strictEqual(s.months[0].month, '2025-03-01');
  assert.strictEqual(s.months[0].payments, 60000, 'pre-commencement payment in commencement month');
  assert.ok(s.pv < 360000 && s.pv > 60000);
  const pvManual = c.installments.reduce((a, i) => a + i.amount * Math.pow(1.07, -Math.max(0, L.daysBetween('2025-03-01', i.dueDate)) / 365), 0);
  near(s.pv, pvManual, 0.006);
  assert.strictEqual(s.months[s.months.length - 1].closingLiab, 0);
  near(sum(s.months, m => m.interest), 360000 - s.pv, 0.05);
  near(sum(s.months, m => m.depreciation), s.rouInitial, 0.05);
  const jan = L.leaseJournal([c], settings, '2025-01-01');
  assert.ok(jan.balanced);
  assert.strictEqual(jan.entries[0].lines[0].accountKey, 'prepaidRent');
  const mar = L.leaseJournal([c], settings, '2025-03-01');
  assert.ok(mar.balanced);
  const init = mar.entries[0];
  const reclass = init.lines.find(l => l.accountKey === 'prepaidRent');
  assert.ok(reclass && reclass.credit === 60000, 'prepaid reclassified to liability');
  // liability right after commencement = pv - early payment
  near(L.liabilityAt(c, settings, '2025-03-01'), (s.pv - 60000) * Math.pow(1.07, 1 / 365), 0.01);
});

t('portfolio', () => {
  const p = L.portfolio([C, slContract(), earlyContract()], settings, '2026-10-04');
  assert.strictEqual(p.rows.length, 3);
  const r = p.rows[0];
  assert.strictEqual(r.model, 'ifrs16'); assert.strictEqual(r.termMonths, 120);
  near(r.annualCost, TOTAL / L.termDays(C) * 365, 0.01);
  near(r.costPerSqm, r.annualCost / 250, 0.01);
  assert.deepStrictEqual(r.nextPayment, { date: '2027-03-11', amount: 150000 });
  assert.strictEqual(r.overdueAmount, 150000); assert.strictEqual(r.paidToDate, 450000); assert.strictEqual(r.remainingPayments, 2550000);
  assert.strictEqual(r.liability, L.liabilityAt(C, settings, '2026-10-04'));
  assert.ok(r.rouNbv > 0 && r.rouNbv < sch.rouInitial);
  assert.strictEqual(r.noticeDeadline, '2034-12-10'); assert.strictEqual(r.status, 'Active');
  assert.strictEqual(p.rows[1].liability, null);
  near(p.totals.paidToDate, p.rows.reduce((a, x) => a + x.paidToDate, 0), 0.001);
});

console.log(`\n${passed} passed, ${failed} failed`);
