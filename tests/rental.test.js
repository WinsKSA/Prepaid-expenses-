const assert = require('assert');
const R = require('./rental.js');
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); process.exitCode = 1; } }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} got ${a} (tol ${tol})`);
const sum = (arr, f) => R.round2(arr.reduce((s, x) => s + f(x), 0));
const amounts = sch => sch.map(i => i.amount);
const settings = { leaseStandard: 'ifrs16', defaultIbr: 0.065, vatRate: 0.15 };
const pvOf = (pays, ref, r) => pays.reduce((s, p) => s + (p.dueDate >= ref ? p.amount / Math.pow(1 + r, R.daysBetween(ref, p.dueDate) / 365) : 0), 0);

// ---------- schedules ----------
function escContract() {
  return { id: 'CON-1', category: 'Branch Rent', branch: 'Riyadh - Olaya', startDate: '2026-01-01', endDate: '2028-12-31',
    frequency: 'Semi-annual', vatApplicable: true, annualRent: 100000, escalation: { type: 'fixed_pct', pct: 5, every: 'year' } };
}
t('5% annual escalation over 3 years, semi-annual', () => {
  const c = escContract(), sch = R.generateSchedule(c, settings);
  assert.deepStrictEqual(amounts(sch), [50000, 50000, 52500, 52500, 55125, 55125]);
  assert.deepStrictEqual(sch.map(i => i.periodStart), ['2026-01-01', '2026-07-01', '2027-01-01', '2027-07-01', '2028-01-01', '2028-07-01']);
  assert.strictEqual(sch[5].periodEnd, '2028-12-31');
  assert.strictEqual(sch[2].vat, 7875);
  assert.strictEqual(sum(sch, i => i.amount), 315250);
  assert.deepStrictEqual(R.anniversaries(c), ['2027-01-01', '2028-01-01']);
  assert.strictEqual(R.annualRentAt(c, '2026-12-31'), 100000);
  assert.strictEqual(R.annualRentAt(c, '2027-01-01'), 105000);
  assert.strictEqual(R.annualRentAt(c, '2028-06-30'), 110250);
  // pct given as fraction and as fixed amount
  assert.strictEqual(R.annualRentAt(Object.assign(escContract(), { escalation: { type: 'fixed_pct', pct: 0.05 } }), '2028-01-01'), 110250);
  assert.strictEqual(R.annualRentAt(Object.assign(escContract(), { escalation: { type: 'fixed_amount', amount: 6000 } }), '2028-01-01'), 112000);
  c.installments = sch;
  near(R.effectiveMonthlyCost(c), 315250 / R.termDays(c) * 365 / 12, 0.006);
});

t('3-month rent-free (monthly, quarterly, semi-annual pro-rata) and ties exactly', () => {
  const base = { id: 'RF', category: 'Branch Rent', startDate: '2026-01-01', endDate: '2026-12-31', annualRent: 120000,
    vatApplicable: true, rentFree: [{ from: '2026-01-01', to: '2026-03-31' }] };
  const m = R.generateSchedule(Object.assign({}, base, { frequency: 'Monthly' }), settings);
  assert.strictEqual(m.length, 12);
  assert.deepStrictEqual(amounts(m).slice(0, 4), [0, 0, 0, 10000]);
  assert.strictEqual(m[0].vat, 0); assert.strictEqual(m[0].rentFreeDays, 31);
  assert.strictEqual(sum(m, i => i.amount), 90000);
  const q = R.generateSchedule(Object.assign({}, base, { frequency: 'Quarterly' }), settings);
  assert.deepStrictEqual(amounts(q), [0, 30000, 30000, 30000]);
  const sa = R.generateSchedule(Object.assign({}, base, { frequency: 'Semi-annual' }), settings);
  const exact = 60000 * (1 - 90 / 181) + 60000;
  assert.strictEqual(sa[0].amount, R.round2(60000 * (1 - 90 / 181)));
  assert.strictEqual(sum(sa, i => i.amount), R.round2(exact));
  const c = Object.assign({}, base, { frequency: 'Monthly', installments: m });
  near(R.effectiveMonthlyCost(c), 90000 / 365 * 365 / 12, 0.001);
});

t('step rents', () => {
  const c = { id: 'ST', category: 'Branch Rent', startDate: '2026-01-01', endDate: '2030-12-31', frequency: 'Annual', vatApplicable: false,
    escalation: { type: 'step', steps: [{ from: '2026-01-01', annualRent: 100000 }, { from: '2028-01-01', annualRent: 120000 }, { from: '2030-01-01', annualRent: 150000 }] } };
  const sch = R.generateSchedule(c, settings);
  assert.deepStrictEqual(amounts(sch), [100000, 100000, 120000, 120000, 150000]);
  assert.strictEqual(sch[0].vat, 0);
  assert.strictEqual(sum(sch, i => i.amount), 590000);
  assert.strictEqual(R.annualRentAt(c, '2029-12-31'), 120000);
  assert.deepStrictEqual(R.anniversaries(c), ['2028-01-01', '2030-01-01']);
});

t('schedule sums tie exactly (last row absorbs rounding); legacy totalAmount mode; customSchedule untouched', () => {
  const legacy = { id: 'LG', category: 'Branch Rent', startDate: '2026-01-15', endDate: '2026-12-31', totalAmount: 100000,
    frequency: 'Quarterly', vatApplicable: true };
  const a = R.generateSchedule(legacy, settings);
  assert.strictEqual(a.length, 4);
  assert.strictEqual(sum(a, i => i.amount), 100000);
  assert.strictEqual(a[3].periodEnd, '2026-12-31');
  const odd = { id: 'OD', startDate: '2026-02-10', endDate: '2029-05-20', frequency: 'Monthly', annualRent: 100000 / 3,
    escalation: { type: 'fixed_pct', pct: 3.7 }, rentFree: [{ from: '2026-02-10', to: '2026-03-03' }], category: 'Branch Rent' };
  const b = R.generateSchedule(odd, settings);
  // independent exact total
  let exact = 0;
  for (let k = 0; ; k++) {
    const ps = R.addMonths('2026-02-10', k); if (ps > odd.endDate) break;
    const full = R.addDays(R.addMonths('2026-02-10', k + 1), -1), pe = full < odd.endDate ? full : odd.endDate;
    const n = R.anniversaries(odd).filter(x => x <= ps).length;
    const pd = R.daysBetween(ps, pe) + 1, fd = R.daysBetween(ps, full) + 1;
    let free = 0; if (ps <= '2026-03-03') free = R.daysBetween(ps, pe < '2026-03-03' ? pe : '2026-03-03') + 1;
    exact += (100000 / 3) * Math.pow(1.037, n) / 12 * pd / fd * (1 - free / pd);
  }
  assert.strictEqual(sum(b, i => i.amount), R.round2(exact));
  b.slice(0, -1).forEach(i => assert.strictEqual(i.amount, R.round2(i.amount)));
  const custom = { customSchedule: true, startDate: '2026-01-01', endDate: '2026-12-31', installments: [{ no: 1, dueDate: '2026-01-05', amount: 777, vat: 0 }] };
  assert.deepStrictEqual(R.generateSchedule(custom, settings), custom.installments);
  // existing payments preserved on regeneration
  const withPaid = Object.assign(escContract(), { installments: R.generateSchedule(escContract(), settings) });
  withPaid.installments[0].paidDate = '2026-01-02'; withPaid.installments[0].paymentRef = 'TRF-9';
  const re = R.generateSchedule(withPaid, settings);
  assert.strictEqual(re[0].paidDate, '2026-01-02'); assert.strictEqual(re[0].paymentRef, 'TRF-9');
});

// ---------- renewal ----------
t('renewal with +10%', () => {
  const c = escContract(); c.installments = R.generateSchedule(c, settings);
  c.deposit = { amount: 20000, paidDate: '2026-01-01', status: 'held' };
  const n = R.renew(c, { years: 3, pctIncrease: 10, date: '2028-09-01', by: 'finance' });
  assert.strictEqual(n.id, 'CON-1-R1'); assert.strictEqual(n.renewedFrom, 'CON-1');
  assert.strictEqual(n.startDate, '2029-01-01'); assert.strictEqual(n.endDate, '2031-12-31');
  assert.strictEqual(n.annualRent, 121275);
  assert.strictEqual(n.installments[0].amount, 60637.5);
  assert.strictEqual(n.installments.length, 6);
  assert.strictEqual(R.annualRentAt(n, '2030-01-01'), R.round2(121275 * 1.05));
  assert.strictEqual(n.totalAmount, sum(n.installments, i => i.amount));
  assert.ok(n.installments.every(i => !i.paidDate));
  assert.strictEqual(n.status, 'Active'); assert.strictEqual(n.events[0].type, 'renewal');
  assert.strictEqual(c.status, 'Renewed'); assert.strictEqual(c.renewedTo, 'CON-1-R1');
  assert.strictEqual(c.events.length, 1); assert.strictEqual(c.events[0].details.newAnnualRent, 121275);
  const n2 = R.renew(n, { years: 1, newAnnualRent: 130000, frequency: 'Quarterly', date: '2031-10-01' });
  assert.strictEqual(n2.id, 'CON-1-R2'); assert.strictEqual(n2.installments.length, 4);
  assert.strictEqual(sum(n2.installments, i => i.amount), 130000);
});

// ---------- IFRS 16 lease used for modification / termination ----------
function ifrsLease() {
  const c = { id: 'L-1', category: 'Branch Rent', branch: 'Jeddah - Tahlia', startDate: '2026-01-01', endDate: '2030-12-31',
    frequency: 'Semi-annual', annualRent: 120000, vatApplicable: true, model: 'ifrs16', ibr: 0.065,
    deposit: { amount: 20000, paidDate: '2026-01-01', status: 'held' } };
  c.installments = R.generateSchedule(c, settings);
  c.installments[0].paidDate = '2026-01-01'; c.installments[1].paidDate = '2026-07-01';
  return c;
}
t('mid-term modification remeasurement (liability recomputed, ROU adjusted, ties out)', () => {
  const c = ifrsLease();
  const init = R.initialRecognition(c, settings);
  near(init.pv, pvOf(c.installments, '2026-01-01', 0.065), 0.005);
  const res = R.modify(c, { effectiveDate: '2027-01-01', newAnnualRent: 150000, newIbr: 0.07, reason: 'rent review', by: 'cfo' }, settings);
  const m = res.ifrs16Remeasurement, nc = res.contract;
  // liability before = PV of 8 remaining x 60,000 at 6.5% = rolled-forward carrying amount
  near(m.liabilityBefore, pvOf(c.installments.slice(2), '2027-01-01', 0.065), 0.005);
  assert.strictEqual(m.liabilityBefore, R.liabilityAt(c, settings, '2026-12-31'));
  // schedule regenerated after effective date
  assert.strictEqual(nc.installments.length, 10);
  assert.deepStrictEqual(amounts(nc.installments), [60000, 60000, 75000, 75000, 75000, 75000, 75000, 75000, 75000, 75000]);
  assert.deepStrictEqual(nc.installments.map(i => i.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.strictEqual(nc.installments[0].paidDate, '2026-01-01');
  assert.strictEqual(nc.totalAmount, 720000); assert.strictEqual(sum(nc.installments, i => i.amount), 720000);
  assert.strictEqual(res.event.newInstallments.length, 8);
  near(m.liabilityAfter, pvOf(nc.installments.slice(2), '2027-01-01', 0.07), 0.005);
  assert.strictEqual(m.ibrAfter, 0.07); assert.strictEqual(nc.ibr, 0.07);
  // ROU adjusted by liability change; ties out
  assert.strictEqual(m.rouNbvBefore, R.rouNbvAt(c, settings, '2026-12-31'));
  near(m.rouNbvBefore, init.rouInitial * (1 - 365 / R.termDays(c)), 0.01);
  assert.strictEqual(m.rouAdjustment, R.round2(m.liabilityAfter - m.liabilityBefore));
  assert.strictEqual(m.rouNbvAfter, R.round2(m.rouNbvBefore + m.rouAdjustment));
  assert.strictEqual(m.gainLoss, 0);
  assert.ok(m.journal.balanced);
  assert.strictEqual(R.liabilityAt(nc, settings, '2026-12-31'), m.liabilityAfter);
  near(R.rouNbvAt(nc, settings, '2030-12-30'), m.rouNbvAfter / (R.daysBetween('2027-01-01', '2030-12-31') + 1), 0.01);
  assert.strictEqual(R.rouNbvAt(nc, settings, '2030-12-31'), 0);
  assert.strictEqual(nc.events[nc.events.length - 1].type, 'modification');
  assert.ok(!c.events, 'original untouched');
  console.log('     liab', m.liabilityBefore, '->', m.liabilityAfter, ' ROU', m.rouNbvBefore, '+', m.rouAdjustment, '=', m.rouNbvAfter);
  // default rate: revised = contract.ibr
  const r2 = R.modify(ifrsLease(), { effectiveDate: '2027-01-01', newAnnualRent: 150000 }, settings).ifrs16Remeasurement;
  assert.strictEqual(r2.ibrAfter, 0.065);
  const c3 = ifrsLease(); delete c3.ibr;
  assert.strictEqual(R.modify(c3, { effectiveDate: '2027-01-01' }, { defaultIbr: 0.08 }).ifrs16Remeasurement.ibrAfter, 0.08);
});
t('modification: decrease in scope (shorter term) -> proportionate derecognition + gain/loss', () => {
  const c = ifrsLease();
  const res = R.modify(c, { effectiveDate: '2027-01-01', newEndDate: '2028-12-31', reason: 'downsize' }, settings);
  const m = res.ifrs16Remeasurement;
  assert.strictEqual(res.contract.installments.length, 6);
  assert.strictEqual(res.contract.endDate, '2028-12-31');
  near(m.liabilityAfter, pvOf(res.contract.installments.slice(2), '2027-01-01', 0.065), 0.005);
  assert.ok(m.liabilityAfter < m.liabilityBefore);
  assert.strictEqual(m.gainLoss, R.round2(m.scopeReduction.liability - m.scopeReduction.rou));
  assert.strictEqual(m.rouAdjustment, R.round2(m.liabilityAfter - m.liabilityBefore + m.gainLoss));
  assert.ok(m.rouNbvAfter > 0);
  assert.ok(m.journal.balanced);
  assert.strictEqual(R.rouNbvAt(res.contract, settings, '2028-12-31'), 0);
});

// ---------- termination ----------
t('termination: refund of prepaid + deposit + gain/loss', () => {
  const c = ifrsLease();
  const res = R.terminate(c, { date: '2026-09-30', penalty: 30000, reason: 'branch closure', by: 'ops' }, settings);
  const st = res.settlement, nc = res.contract;
  assert.strictEqual(st.refundDue, 30000); // 92 of 184 days of the 2nd paid half-year
  assert.strictEqual(st.refundVat, 4500);
  assert.strictEqual(st.penalty, 30000);
  assert.strictEqual(st.depositRefund, 20000);
  const liab = R.liabilityAt(c, settings, '2026-09-30'), nbv = R.rouNbvAt(c, settings, '2026-09-30');
  near(liab, pvOf(c.installments.slice(2), '2026-10-01', 0.065), 0.005);
  assert.strictEqual(st.liability, liab); assert.strictEqual(st.rouNbv, nbv);
  assert.strictEqual(st.gainLossOnDerecognition, R.round2(liab - nbv - 30000));
  assert.strictEqual(st.netCashToReceive, R.round2(30000 + 4500 + 20000 - 30000));
  assert.strictEqual(nc.installments.length, 2);
  assert.deepStrictEqual(st.removedInstallments, [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.strictEqual(nc.status, 'Terminated'); assert.strictEqual(nc.terminationDate, '2026-09-30');
  assert.strictEqual(nc.endDate, '2026-09-30'); assert.strictEqual(nc.originalEndDate, '2030-12-31');
  assert.strictEqual(res.event.type, 'termination'); assert.strictEqual(nc.events.length, 1);
  console.log('     liability', liab, ' ROU NBV', nbv, ' gain/loss', st.gainLossOnDerecognition);
  // non-IFRS16 model: gain/loss is just the penalty
  const p = Object.assign(ifrsLease(), { model: 'prepaid' });
  assert.strictEqual(R.terminate(p, { date: '2026-09-30', penalty: 1000 }, settings).settlement.gainLossOnDerecognition, -1000);
});

// ---------- prepaid status ----------
t('prepaidStatus: daily straight-line per paid installment (catch-up)', () => {
  const c = { id: 'INS-1', category: 'Medical Insurance', startDate: '2026-01-01', endDate: '2026-12-31', frequency: 'Semi-annual', totalAmount: 36500 };
  c.installments = R.generateSchedule(c, settings);
  c.installments[0].paidDate = '2025-12-20';
  const s = R.prepaidStatus(c, '2026-03-31');
  assert.strictEqual(s.paid, c.installments[0].amount);
  assert.strictEqual(s.expensedToDate, R.round2(c.installments[0].amount * 90 / 181));
  assert.strictEqual(s.prepaidBalance, R.round2(s.paid - s.expensedToDate));
  assert.strictEqual(s.accrued, 0);
  const s2 = R.prepaidStatus(c, '2026-08-31'); // 2nd unpaid -> accrued
  assert.strictEqual(s2.expensedToDate, c.installments[0].amount); assert.strictEqual(s2.prepaidBalance, 0);
  assert.strictEqual(s2.accrued, R.round2(c.installments[1].amount * 62 / 184));
  assert.strictEqual(R.prepaidStatus(c, '2025-12-19').paid, 0);
});

// ---------- portfolio ----------
t('portfolio analytics: WALE on 3 leases, expiry profile, commitments, deposits', () => {
  const asOf = '2026-01-01';
  const A = { id: 'A', category: 'Branch Rent', branch: 'Riyadh - Olaya', startDate: '2025-01-01', endDate: '2026-12-31', annualRent: 100000,
    frequency: 'Annual', property: { city: 'Riyadh', areaSqm: 200 }, deposit: { amount: 10000, paidDate: '2025-01-01', status: 'held' } };
  const B = { id: 'B', category: 'Branch Rent', branch: 'Jeddah - Tahlia', startDate: '2025-07-01', endDate: '2028-06-30', annualRent: 200000,
    frequency: 'Semi-annual', property: { city: 'Jeddah', areaSqm: 400 }, deposit: { amount: 25000, paidDate: '2025-07-01', status: 'held' } };
  const C = { id: 'C', category: 'Branch Rent', branch: 'Riyadh - Malqa', startDate: '2024-01-01', endDate: '2030-12-31', annualRent: 300000,
    frequency: 'Annual', city: 'Riyadh', areaSqm: 300 };
  const I = { id: 'I', category: 'Medical Insurance', startDate: '2026-01-01', endDate: '2026-12-31', totalAmount: 50000, frequency: 'Annual' };
  [A, B, C, I].forEach(c => { c.installments = R.generateSchedule(c, settings); c.installments.forEach(i => { if (i.dueDate < asOf) i.paidDate = i.dueDate; }); });
  const p = R.portfolioAnalytics([A, B, C, I], asOf);
  const rem = c => (R.daysBetween(asOf, c.endDate) + 1) / 365;
  const wale = (100000 * rem(A) + 200000 * rem(B) + 300000 * rem(C)) / 600000;
  assert.strictEqual(p.waleYears, R.round2(wale));
  console.log('     WALE =', p.waleYears);
  assert.deepStrictEqual(p.expiryProfile, { 2026: 100000, 2028: 200000, 2030: 300000 });
  assert.strictEqual(p.byBranch.length, 3);
  const jb = p.byBranch.find(b => b.branch === 'Jeddah - Tahlia');
  assert.strictEqual(jb.costPerSqm, 500); assert.strictEqual(jb.annualRent, 200000);
  assert.strictEqual(jb.nextPayment.date, '2026-01-01'); assert.strictEqual(jb.depositHeld, 25000);
  assert.strictEqual(jb.remainingYears, R.round2(rem(B)));
  const riy = p.byCity.find(x => x.city === 'Riyadh');
  assert.strictEqual(riy.count, 2); assert.strictEqual(riy.annualRent, 400000); assert.strictEqual(riy.areaSqm, 500);
  assert.strictEqual(p.byCategory.find(x => x.category === 'Medical Insurance').annualRent, 50000);
  assert.strictEqual(p.byCategory.find(x => x.category === 'Branch Rent').count, 3);
  const unpaid = [A, B, C].reduce((s, c) => s + c.installments.filter(i => !i.paidDate).reduce((a, i) => a + i.amount, 0), 0);
  assert.strictEqual(p.commitments.total, R.round2(unpaid));
  assert.strictEqual(R.round2(p.commitments.next12m + p.commitments.y1to5 + p.commitments.beyond5), p.commitments.total);
  const d12 = R.addMonths(asOf, 12);
  assert.strictEqual(p.commitments.next12m, R.round2([A, B, C].reduce((s, c) => s + c.installments.filter(i => !i.paidDate && i.dueDate <= d12).reduce((a, i) => a + i.amount, 0), 0)));
  assert.strictEqual(p.commitments.next12m, 1000000);
  assert.strictEqual(p.commitments.beyond5, 0);
  assert.strictEqual(p.totalDeposits, 35000);
});

// ---------- alerts ----------
t('alerts: payment stages, overdue, notice, lease end, rent review, deposit, Ejar, VAT invoice', () => {
  const today = '2026-10-04';
  const L1 = { id: 'AL-1', category: 'Branch Rent', branch: 'Dammam', startDate: '2024-01-01', endDate: '2026-12-31', frequency: 'Monthly',
    annualRent: 120000, vatApplicable: true, status: 'Active', property: { ejarNo: '' }, options: { renewal: { years: 2, noticeDays: 90 } },
    installments: [
      { no: 1, dueDate: '2026-09-01', amount: 10000, vat: 1500, paidDate: '' },               // overdue
      { no: 2, dueDate: '2026-10-04', amount: 10000, vat: 1500, paidDate: '' },               // stage 0
      { no: 3, dueDate: '2026-10-11', amount: 10000, vat: 1500, paidDate: '' },               // stage 7
      { no: 4, dueDate: '2026-10-15', amount: 10000, vat: 1500, paidDate: '' },               // stage 14
      { no: 5, dueDate: '2026-10-30', amount: 10000, vat: 1500, paidDate: '' },               // stage 30
      { no: 6, dueDate: '2026-12-01', amount: 10000, vat: 1500, paidDate: '' },               // too far
      { no: 7, dueDate: '2026-08-01', amount: 10000, vat: 1500, paidDate: '2026-08-01' },     // invoice missing
      { no: 8, dueDate: '2026-07-01', amount: 10000, vat: 1500, paidDate: '2026-07-01' }],    // invoice on file
    documents: [{ name: 'INV-8', kind: 'invoice', ref: 8, date: '2026-07-01' }] };
  const L2 = { id: 'AL-2', category: 'Branch Rent', branch: 'Khobar', startDate: '2025-11-01', endDate: '2027-04-01', annualRent: 100000,
    frequency: 'Annual', refNo: 'EJ-123', status: 'Active', escalation: { type: 'fixed_pct', pct: 5, firstOn: '2026-11-01' },
    options: { termination: { earliest: '2027-01-31', noticeDays: 60, penalty: 5000 } }, installments: [] };
  const L3 = { id: 'AL-3', category: 'Branch Rent', branch: 'Abha', startDate: '2024-08-01', endDate: '2026-08-01', annualRent: 50000,
    frequency: 'Annual', refNo: 'EJ-9', status: 'Expired', deposit: { amount: 8000, paidDate: '2024-08-01', status: 'held' }, installments: [] };
  const P1 = { id: 'PP-1', category: 'Software/Subscriptions', vendor: 'SaaS Co', startDate: '2025-11-01', endDate: '2026-10-31', frequency: 'Annual',
    totalAmount: 12000, installments: [{ no: 1, dueDate: '2026-10-20', amount: 12000, vat: 0, paidDate: '' }] };
  const a = R.alerts([L1, L2, L3, P1], today, settings);
  const by = (ref, type) => a.filter(x => x.ref === ref && x.type === type);
  const stage = ref => by(ref, ref.indexOf('#') > 0 ? (by(ref, 'payment_due')[0] ? 'payment_due' : 'payment_overdue') : '')[0];
  assert.strictEqual(stage('AL-1#1').stage, 'overdue'); assert.strictEqual(stage('AL-1#1').severity, 'expired');
  assert.strictEqual(stage('AL-1#2').stage, '0'); assert.strictEqual(stage('AL-1#2').severity, 'critical');
  assert.strictEqual(stage('AL-1#3').stage, '7');
  assert.strictEqual(stage('AL-1#4').stage, '14'); assert.strictEqual(stage('AL-1#4').severity, 'warning');
  assert.strictEqual(stage('AL-1#5').stage, '30'); assert.strictEqual(stage('AL-1#5').severity, 'notice');
  assert.strictEqual(a.filter(x => x.ref === 'AL-1#6').length, 0);
  assert.strictEqual(by('AL-1#7', 'vat_invoice_missing').length, 1);
  assert.strictEqual(by('AL-1#8', 'vat_invoice_missing').length, 0);
  const end = by('AL-1', 'lease_end')[0]; assert.strictEqual(end.stage, 'end90'); assert.strictEqual(end.daysLeft, 88);
  const nr = by('AL-1', 'notice_renewal')[0]; assert.strictEqual(nr.dueDate, '2026-10-02'); assert.strictEqual(nr.stage, 'missed');
  assert.strictEqual(by('AL-1', 'ejar_missing').length, 1);
  assert.strictEqual(by('AL-2', 'ejar_missing').length, 0);
  const nt = by('AL-2', 'notice_termination')[0]; assert.strictEqual(nt.dueDate, '2026-12-02'); assert.strictEqual(nt.stage, '60');
  const rr = by('AL-2', 'rent_review')[0]; assert.strictEqual(rr.dueDate, '2026-11-01'); assert.strictEqual(rr.daysLeft, 28);
  assert.ok(/105000\.00/.test(rr.message));
  assert.strictEqual(by('AL-2', 'lease_end')[0].stage, 'end180');
  const dep = by('AL-3', 'deposit_refund_overdue')[0]; assert.strictEqual(dep.dueDate, '2026-08-31'); assert.strictEqual(dep.severity, 'expired');
  assert.strictEqual(by('AL-3', 'lease_end').length, 0, 'expired lease: no end reminder');
  const pp = a.filter(x => x.ref === 'PP-1#1')[0]; assert.strictEqual(pp.category, 'Prepaid'); assert.strictEqual(pp.stage, '30');
  assert.strictEqual(by('PP-1', 'lease_end')[0].category, 'Prepaid');
  assert.ok(a.every(x => x.key && x.severity && x.category && x.ref && x.title && x.message && 'dueDate' in x && 'daysLeft' in x && 'stage' in x));
  assert.strictEqual(new Set(a.map(x => x.key)).size, a.length, 'unique keys');
  assert.strictEqual(a[0].severity, 'expired');
  // renewed lease: no end / notice reminders
  const ren = R.alerts([Object.assign({}, L1, { status: 'Renewed' })], today, settings);
  assert.strictEqual(ren.filter(x => x.type === 'lease_end' || x.type === 'notice_renewal').length, 0);
});

// ---------- deposits JE ----------
t('deposits journal: paid / refunded (with deduction) / forfeited - balanced', () => {
  const cs = [
    { id: 'D1', branch: 'Riyadh', deposit: { amount: 20000, paidDate: '2026-09-05', status: 'held' } },
    { id: 'D2', branch: 'Jeddah', deposit: { amount: 15000, paidDate: '2023-01-01', refundDate: '2026-09-20', refundedAmount: 12000, status: 'refunded' } },
    { id: 'D3', branch: 'Dammam', endDate: '2026-09-10', deposit: { amount: 9000, paidDate: '2023-01-01', status: 'forfeited' } },
    { id: 'D4', branch: 'Abha', deposit: { amount: 5000, paidDate: '2026-08-01', status: 'held' } }];
  const j = R.depositsJournal(cs, '2026-09', settings);
  assert.ok(j.balanced);
  assert.strictEqual(j.entries.length, 3);
  assert.strictEqual(j.totals.debit, j.totals.credit);
  assert.strictEqual(j.totals.debit, 20000 + 15000 + 9000);
  const e1 = j.entries[0];
  assert.strictEqual(e1.jeNo, 'DJE-2026-09-01');
  assert.deepStrictEqual(e1.lines.map(l => [l.account, l.debit, l.credit]), [['Security Deposits (Refundable)', 20000, 0], ['Bank - Al Rajhi', 0, 20000]]);
  const e3 = j.entries.find(e => /forfeited/.test(e.memo));
  assert.deepStrictEqual(e3.lines.map(l => [l.account, l.debit, l.credit]), [['Rent Expense', 9000, 0], ['Security Deposits (Refundable)', 0, 9000]]);
  const e2 = j.entries.find(e => /refunded/.test(e.memo));
  assert.deepStrictEqual(e2.lines.map(l => [l.accountKey, l.debit, l.credit]), [['bank', 12000, 0], ['rentExp', 3000, 0], ['securityDeposits', 0, 15000]]);
  assert.strictEqual(e2.lines[0].cls, 'Jeddah');
  assert.strictEqual(R.depositsJournal(cs, '2026-07', settings).entries.length, 0);
});

// ---------- export ----------
t('exportRows: lease register, payment schedule, deposits, events log', () => {
  const c = ifrsLease();
  const res = R.modify(c, { effectiveDate: '2027-01-01', newAnnualRent: 150000, reason: 'review' }, settings);
  const x = R.exportRows([res.contract]);
  assert.strictEqual(x.leaseRegister.length, 1);
  assert.strictEqual(x.leaseRegister[0]['Contract ID'], 'L-1');
  assert.strictEqual(x.paymentSchedule.length, 10);
  assert.strictEqual(x.paymentSchedule[0].Status, 'Paid'); assert.strictEqual(x.paymentSchedule[0].Total, 69000);
  assert.strictEqual(x.deposits.length, 1); assert.strictEqual(x.deposits[0].Amount, 20000);
  assert.strictEqual(x.eventsLog.length, 1); assert.strictEqual(x.eventsLog[0].Type, 'modification');
  [x.leaseRegister, x.paymentSchedule, x.deposits, x.eventsLog].forEach(rows => rows.forEach(r =>
    Object.keys(r).forEach(k => assert.ok(r[k] === null || typeof r[k] !== 'object', 'flat ' + k))));
});

console.log(`\n${passed} passed, ${failed} failed`);
