const assert = require('assert');
const E = require('../engine.js');
const S = E.DEFAULT_SETTINGS;
let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } }
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, (msg || '') + ` expected ${b} got ${a}`);

t('date helpers', () => {
  assert.strictEqual(E.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(E.addMonths('2028-01-31', 1), '2028-02-29');
  assert.strictEqual(E.addMonths('2026-03-31', -1), '2026-02-28');
  assert.strictEqual(E.addMonths('2026-11-15', 3), '2027-02-15');
  assert.strictEqual(E.addMonths('2026-12-31', 12), '2027-12-31');
  assert.strictEqual(E.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(E.daysBetween('2026-01-01', '2026-12-31'), 364);
  assert.strictEqual(E.monthEnd('2026-02-10'), '2026-02-28');
  assert.strictEqual(E.monthStart('2026-02-10'), '2026-02-01');
  assert.ok(isNaN(E.parseISO('2026-02-30')));
  assert.ok(isNaN(E.parseISO('')));
  assert.strictEqual(E.fmtDate('2026-11-15'), '15 Nov 2026');
  const h = E.toHijri('2026-11-15');
  assert.ok(h === '' || /^\d{2}\/\d{2}\/14\d\d$/.test(h), 'hijri ' + h);
  console.log('     hijri 2026-11-15 =', h);
});

t('nextNumber', () => {
  assert.strictEqual(E.nextNumber([], 'EMP-', 4), 'EMP-0001');
  assert.strictEqual(E.nextNumber(['EMP-0001', 'EMP-0007', 'REN-0099', 'EMP-x'], 'EMP-', 4), 'EMP-0008');
  assert.strictEqual(E.nextNumber(['CON-0009'], 'CON-', 4), 'CON-0010');
});

const emp = { empNo: 'EMP-0001', nameEn: 'Ali', iqamaExpiry: '2026-11-15', dependents: 2, depPayer: 'Company', status: 'Active' };

t('calcRenewal 12m with 2 company dependents = 19950', () => {
  const r = { id: 'REN-0001', empNo: 'EMP-0001', requestDate: '2026-10-01', months: 12, oldExpiry: '2026-11-15', paymentDate: '2026-10-20' };
  const c = E.calcRenewal(r, emp, S, [r], '2026-10-04');
  assert.strictEqual(c.newExpiry, '2027-11-15');
  assert.strictEqual(c.coverageStart, '2026-11-16');
  assert.strictEqual(c.coverageDays, 365);
  near(c.iqamaFee, 650); near(c.levy, 9600); near(c.wpFee, 100); near(c.depFee, 9600);
  near(c.companyPrepaid, 19950); near(c.total, 19950);
  assert.strictEqual(c.isLate, false); assert.strictEqual(c.lateFine, 0);
  const c2 = E.calcRenewal(Object.assign({}, r, { depPayerAtRequest: 'Employee' }), emp, S, [r], '2026-10-04');
  near(c2.companyPrepaid, 10350); near(c2.employeeRecoverable, 9600); near(c2.total, 19950);
});

t('late renewals: 500 then 1000 then deport risk', () => {
  const e = { empNo: 'EMP-0002', iqamaExpiry: '2024-01-10', dependents: 0, depPayer: 'Company', status: 'Active' };
  const r1 = { id: 'REN-0002', empNo: 'EMP-0002', requestDate: '2024-01-15', months: 12, oldExpiry: '2024-01-10', paymentDate: '2024-01-20' };
  const r2 = { id: 'REN-0003', empNo: 'EMP-0002', requestDate: '2025-01-15', months: 12, oldExpiry: '2025-01-10', paymentDate: '2025-01-20' };
  const r3 = { id: 'REN-0004', empNo: 'EMP-0002', requestDate: '2026-01-15', months: 12, oldExpiry: '2026-01-10', paymentDate: '2026-01-13' };
  const all = [r3, r2, r1];
  const c1 = E.calcRenewal(r1, e, S, all, '2026-10-04');
  const c2 = E.calcRenewal(r2, e, S, all, '2026-10-04');
  const c3 = E.calcRenewal(r3, e, S, all, '2026-10-04');
  assert.strictEqual(c1.isLate, true); assert.strictEqual(c1.offenseNo, 1); assert.strictEqual(c1.lateFine, 500);
  assert.strictEqual(c2.offenseNo, 2); assert.strictEqual(c2.lateFine, 1000); assert.strictEqual(c2.deportRisk, false);
  assert.strictEqual(c3.isLate, false, 'within grace'); // 13th = 10th + 3 days grace
  near(c1.expensedNow, 500); near(c1.total, 650 + 9600 + 100 + 500);
  const r4 = Object.assign({}, r3, { paymentDate: '2026-01-14' });
  const c4 = E.calcRenewal(r4, e, S, [r1, r2, r4], '2026-10-04');
  assert.strictEqual(c4.offenseNo, 3); assert.strictEqual(c4.deportRisk, true);
  // unpaid uses today
  const r5 = { id: 'REN-0009', empNo: 'EMP-0009', requestDate: '2026-09-01', months: 3, oldExpiry: '2026-09-01' };
  assert.strictEqual(E.calcRenewal(r5, { empNo: 'EMP-0009' }, S, [r5], '2026-10-04').isLate, true);
  // same requestDate: smaller id is earlier
  const a = { id: 'REN-0010', empNo: 'X', requestDate: '2026-01-01', months: 3, oldExpiry: '2025-12-01', paymentDate: '2026-01-02' };
  const b = { id: 'REN-0011', empNo: 'X', requestDate: '2026-01-01', months: 3, oldExpiry: '2025-12-01', paymentDate: '2026-01-02' };
  assert.strictEqual(E.calcRenewal(b, { empNo: 'X' }, S, [b, a], '2026-10-04').offenseNo, 2);
  assert.strictEqual(E.calcRenewal(a, { empNo: 'X' }, S, [b, a], '2026-10-04').offenseNo, 1);
});

t('prorated 3 months, levy exempt variant', () => {
  const r = { id: 'REN-0005', empNo: 'EMP-0001', requestDate: '2026-10-01', months: 3, oldExpiry: '2026-11-15' };
  const c = E.calcRenewal(r, Object.assign({}, emp, { dependents: 0 }), S, [r], '2026-10-04');
  near(c.iqamaFee, 162.5); near(c.levy, 2400); near(c.wpFee, 25); near(c.total, 2587.5);
  assert.strictEqual(c.newExpiry, '2027-02-15');
  const cx = E.calcRenewal(r, Object.assign({}, emp, { dependents: 1, levyExempt: true }), S, [r], '2026-10-04');
  near(cx.levy, 0); near(cx.depFee, 1200); near(cx.total, 162.5 + 25 + 1200);
});

t('effectiveExpiry / suggestOldExpiry', () => {
  const rs = [
    { id: 'REN-1', empNo: 'EMP-0001', months: 12, oldExpiry: '2026-11-15', completedDate: '2026-11-01' },
    { id: 'REN-2', empNo: 'EMP-0001', months: 3, oldExpiry: '2027-11-15' }];
  assert.strictEqual(E.effectiveExpiry(emp, rs), '2027-11-15');
  assert.strictEqual(E.suggestOldExpiry(emp, rs, 'REN-9'), '2028-02-15');
  assert.strictEqual(E.suggestOldExpiry(emp, rs, 'REN-2'), '2027-11-15');
});

t('visa fees & status', () => {
  assert.strictEqual(E.visaFee({ type: 'ER Single', months: 2 }, S, []), 200);
  assert.strictEqual(E.visaFee({ type: 'ER Single', months: 4 }, S, []), 400);
  assert.strictEqual(E.visaFee({ type: 'ER Multiple', months: 6 }, S, []), 1100);
  const l1 = { id: 'ERV-0001', empNo: 'A', type: 'Iqama Lost', requestDate: '2026-01-01' };
  const l2 = { id: 'ERV-0002', empNo: 'A', type: 'Iqama Lost', requestDate: '2026-05-01' };
  assert.strictEqual(E.visaFee(l1, S, [l1, l2]), 1000);
  assert.strictEqual(E.visaFee(l2, S, [l1, l2]), 2000);
  const v = { type: 'ER Single', months: 2, issueDate: '2026-08-01', paymentDate: '2026-07-30' };
  assert.strictEqual(E.visaReturnBefore(v), '2026-10-01');
  assert.strictEqual(E.visaStatus(v, '2026-10-04'), 'Expired Unused');
  assert.strictEqual(E.visaStatus(Object.assign({}, v, { departureDate: '2026-08-05' }), '2026-09-04'), 'Outside KSA');
  assert.strictEqual(E.visaStatus(Object.assign({}, v, { departureDate: '2026-08-05' }), '2026-10-04'), 'Not Returned');
  assert.strictEqual(E.visaStatus({ type: 'Final Exit', departureDate: '2026-01-01' }), 'Left (Final)');
  assert.strictEqual(E.renewalStatus({ sadadNo: '1' }), 'Awaiting Payment');
});

const contract = { id: 'CON-0001', category: 'Branch Rent', branch: 'Riyadh - Olaya', startDate: '2026-01-01', endDate: '2026-12-31',
  totalAmount: 120000, frequency: 'Semi-annual', vatApplicable: true, installments: [] };

t('installments 120000 semi-annual with VAT', () => {
  const ins = E.buildInstallments(contract, S);
  assert.strictEqual(ins.length, 2);
  assert.strictEqual(ins[0].periodStart, '2026-01-01'); assert.strictEqual(ins[0].periodEnd, '2026-06-30');
  assert.strictEqual(ins[1].periodStart, '2026-07-01'); assert.strictEqual(ins[1].periodEnd, '2026-12-31');
  near(ins[0].amount, 59506.85); near(ins[1].amount, 60493.15);
  near(ins[0].amount + ins[1].amount, 120000);
  near(ins[0].vat, 8926.03); near(ins[1].vat, 9073.97);
  assert.strictEqual(ins[0].dueDate, '2026-01-01');
  const kept = E.buildInstallments(Object.assign({}, contract, { installments: [{ no: 1, periodStart: '2026-01-01', dueDate: '2025-12-25', paidDate: '2025-12-24', paymentRef: 'TT1' }] }), S);
  assert.strictEqual(kept[0].paidDate, '2025-12-24'); assert.strictEqual(kept[0].paymentRef, 'TT1'); assert.strictEqual(kept[0].dueDate, '2025-12-25');
  assert.strictEqual(E.buildInstallments(Object.assign({}, contract, { frequency: 'Monthly' }), S).length, 12);
  assert.strictEqual(E.buildInstallments(Object.assign({}, contract, { vatApplicable: false }), S)[0].vat, 0);
});

// state for amortization / journal
const e3 = { empNo: 'EMP-0003', nameEn: 'Omar', iqamaExpiry: '2025-12-31', dependents: 1, depPayer: 'Company', status: 'Active' };
const rLatePay = { id: 'REN-0020', empNo: 'EMP-0003', requestDate: '2025-12-20', months: 12, oldExpiry: '2025-12-31', paymentDate: '2026-03-10', otherFees: 50 };
const con = Object.assign({}, contract);
con.installments = E.buildInstallments(contract, S);
con.installments[0].paidDate = '2026-01-05';
con.installments[1].paidDate = '2026-03-20';
const vis = { id: 'ERV-0005', empNo: 'EMP-0003', type: 'ER Single', months: 2, payer: 'Company', paymentDate: '2026-03-02' };
const state = { employees: [e3], renewals: [rLatePay], visas: [vis], contracts: [con] };

t('amortization catch-up (paid after coverage start)', () => {
  const items = E.prepaidItems(state, S, '2026-10-04');
  const it = items.find(i => i.source === 'renewal');
  assert.strictEqual(it.start, '2026-01-01'); assert.strictEqual(it.end, '2026-12-31');
  near(it.amount, 650 + 9600 + 100 + 4800);
  assert.deepStrictEqual(Object.keys(it.split).sort(), ['depExp', 'iqamaExp', 'levyExp', 'wpExp']);
  assert.strictEqual(E.monthlyAmort(it, '2026-01-01'), 0);
  assert.strictEqual(E.monthlyAmort(it, '2026-02-01'), 0);
  const mar = E.monthlyAmort(it, '2026-03-01');
  near(mar, E.cumRecognized(it, '2026-03-31'));
  assert.ok(Math.abs(mar - it.amount * 90 / 365) < 0.05, 'catch-up ' + mar);
  let sum = 0; for (let m = 1; m <= 12; m++) sum += E.monthlyAmort(it, `2026-${String(m).padStart(2, '0')}-01`);
  near(sum, it.amount, 'full amortization');
  const sch = E.amortSchedule(state, S, '2026-01-01', 12, '2026-10-04');
  assert.strictEqual(sch.months.length, 12);
  near(sch.totals.reduce((a, b) => a + b, 0), it.amount + 120000);
  near(sch.byAccount.rentExp.reduce((a, b) => a + b, 0), 120000);
  assert.strictEqual(sch.rows.length, 3);
  // contract item: inst 2 paid in March, period starts July -> nothing until July
  const ci = items.find(i => i.key === 'contract:CON-0001:2');
  assert.strictEqual(E.monthlyAmort(ci, '2026-06-01'), 0);
  assert.ok(E.monthlyAmort(ci, '2026-07-01') > 0);
});

t('rollforward check = 0 every month', () => {
  for (let m = 1; m <= 12; m++) {
    const rf = E.prepaidRollforward(state, S, `2026-${String(m).padStart(2, '0')}-01`, '2026-10-04');
    assert.ok(Math.abs(rf.check) < 0.01, 'month ' + m + ' check ' + rf.check);
    Object.keys(rf.accounts).forEach(k => assert.ok(Math.abs(rf.accounts[k].check) < 0.01, k));
  }
  const mar = E.prepaidRollforward(state, S, '2026-03-01', '2026-10-04');
  near(mar.additions, 15150 + 60493.15);
  near(mar.accounts.prepaidRent.opening, 59506.85 - E.round2(59506.85 * 59 / 181));
  const dec = E.prepaidRollforward(state, S, '2026-12-01', '2026-10-04');
  near(dec.closing, 0);
});

t('monthly journal balanced + CSV', () => {
  const j = E.monthlyJournal(state, S, '2026-03-01', '2026-10-04');
  assert.strictEqual(j.balanced, true);
  near(j.totals.debit, j.totals.credit);
  assert.strictEqual(j.entries[0].jeNo, 'JE-2026-03-01');
  const ren = j.entries.find(e => e.lines.some(l => l.account === S.accounts.finesExp));
  assert.ok(ren, 'renewal entry with fine (paid late)');
  near(ren.lines.find(l => l.account === S.accounts.bank).credit, 15150 + 500 + 50);
  assert.ok(j.entries.some(e => e.lines.some(l => l.account === S.accounts.visaExp && l.debit === 200)));
  const pay = j.entries.find(e => e.lines.some(l => l.account === S.accounts.inputVat));
  near(pay.lines.find(l => l.account === S.accounts.prepaidRent).debit, 60493.15);
  const rentAm = j.entries.find(e => e.lines.some(l => l.account === S.accounts.rentExp));
  assert.strictEqual(rentAm.date, '2026-03-31');
  assert.strictEqual(rentAm.lines[0].cls, 'Riyadh - Olaya');
  for (let m = 1; m <= 12; m++) assert.ok(E.monthlyJournal(state, S, `2026-${String(m).padStart(2, '0')}-01`, '2026-10-04').balanced);
  const csv = E.journalCSV(j);
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines[0], 'JournalNo,JournalDate,AccountName,Debits,Credits,Description,Name,Class');
  assert.ok(/^JE-2026-03-01,\d\d\/03\/2026,/.test(lines[1]), lines[1]);
});

t('alerts at the right stages', () => {
  const today = '2026-10-04';
  const mk = (no, exp, extra) => Object.assign({ empNo: no, nameEn: no, iqamaExpiry: exp, status: 'Active' }, extra || {});
  const st = {
    employees: [
      mk('E1', E.addDays(today, 20)), mk('E2', E.addDays(today, 5)), mk('E3', E.addDays(today, -3)),
      mk('E4', E.addDays(today, 100)), mk('E5', E.addDays(today, 75)), mk('E6', E.addDays(today, 10)),
      mk('E7', E.addDays(today, 200), { status: 'Final Exit' }),
      mk('E8', E.addDays(today, 300), { passportExpiry: E.addDays(today, 60), insuranceExpiry: E.addDays(today, 10) })],
    renewals: [{ id: 'REN-0100', empNo: 'E6', requestDate: '2026-10-01', months: 12, oldExpiry: E.addDays(today, 10), hrDate: '2026-10-02' }],
    visas: [
      { id: 'ERV-0100', empNo: 'E4', type: 'ER Single', months: 2, issueDate: '2026-08-10', departureDate: '2026-08-12' },
      { id: 'ERV-0101', empNo: 'E4', type: 'ER Single', months: 2, issueDate: '2026-07-01' }],
    contracts: [Object.assign({}, contract, { id: 'CON-0100', startDate: '2025-11-01', endDate: '2026-10-31', installments: [
      { no: 1, dueDate: '2025-11-01', amount: 100, vat: 15, paidDate: '2025-11-01' },
      { no: 2, dueDate: '2026-10-10', amount: 100, vat: 15, paidDate: '' }] })]
  };
  const a = E.alerts(st, S, today);
  const find = (cat, ref) => a.filter(x => x.category === cat && x.ref === ref);
  assert.strictEqual(find('Iqama', 'E1')[0].severity, 'warning'); assert.strictEqual(find('Iqama', 'E1')[0].stage, '30');
  assert.strictEqual(find('Iqama', 'E2')[0].severity, 'critical'); assert.strictEqual(find('Iqama', 'E2')[0].stage, '7');
  assert.strictEqual(find('Iqama', 'E3')[0].severity, 'expired');
  assert.strictEqual(find('Iqama', 'E4').length, 0);
  assert.strictEqual(find('Iqama', 'E5')[0].severity, 'notice'); assert.strictEqual(find('Iqama', 'E5')[0].stage, '90');
  assert.strictEqual(find('Iqama', 'E6').length, 0, 'open renewal suppresses iqama alert');
  const ra = find('Renewal', 'REN-0100')[0];
  assert.strictEqual(ra.stage, 'HR Approved'); assert.strictEqual(ra.daysLeft, 10); assert.strictEqual(ra.severity, 'critical');
  assert.strictEqual(a.filter(x => x.empNo === 'E7').length, 0);
  assert.strictEqual(find('Passport', 'E8')[0].severity, 'critical');
  assert.strictEqual(find('Insurance', 'E8')[0].severity, 'critical');
  assert.strictEqual(find('Visa', 'ERV-0100')[0].stage, 'return14'); // return before 2026-10-10
  assert.strictEqual(find('Visa', 'ERV-0101')[0].stage, 'expiredUnused');
  assert.ok(/1,000/.test(find('Visa', 'ERV-0101')[0].message));
  const inst = find('Rent', 'CON-0100#2')[0]; assert.strictEqual(inst.stage, '7'); assert.strictEqual(inst.severity, 'critical');
  assert.strictEqual(find('Rent', 'CON-0100')[0].stage, 'end30');
  // renewal contract suppresses end alert
  const st2 = Object.assign({}, st, { contracts: st.contracts.concat([Object.assign({}, contract, { id: 'CON-0101', startDate: '2026-11-01', endDate: '2027-10-31', installments: [] })]) });
  assert.strictEqual(E.alerts(st2, S, today).filter(x => x.ref === 'CON-0100').length, 0);
  // sorting & stable keys
  const rank = { expired: 0, critical: 1, warning: 2, notice: 3 };
  for (let i = 1; i < a.length; i++) {
    assert.ok(rank[a[i - 1].severity] < rank[a[i].severity] || (a[i - 1].severity === a[i].severity && a[i - 1].daysLeft <= a[i].daysLeft), 'sorted');
  }
  assert.strictEqual(find('Iqama', 'E1')[0].key, 'Iqama|E1|30');
  assert.strictEqual(new Set(a.map(x => x.key)).size, a.length, 'unique keys');
  // visa return after iqama expiry
  const st3 = { employees: [mk('E9', '2026-10-20')], renewals: [], visas: [{ id: 'ERV-0200', empNo: 'E9', type: 'ER Multiple', months: 3, issueDate: '2026-10-01' }], contracts: [] };
  assert.strictEqual(E.alerts(st3, S, today).filter(x => x.stage === 'afterIqama').length, 1);
  // deport risk
  const late = n => ({ id: 'REN-03' + n, empNo: 'E1', requestDate: `202${n}-01-15`, months: 12, oldExpiry: `202${n}-01-01`, paymentDate: `202${n}-01-20`, completedDate: `202${n}-01-21` });
  const st4 = { employees: [mk('E1', '2027-06-01')], renewals: [late(3), late(4), late(5)], visas: [], contracts: [] };
  assert.strictEqual(E.alerts(st4, S, today).filter(x => x.stage === 'offense3').length, 1);
});

t('forecast', () => {
  const st = { employees: [Object.assign({}, emp)], renewals: [], visas: [], contracts: [Object.assign({}, contract, { installments: E.buildInstallments(contract, S) })] };
  const f = E.forecast(st, S, '2026-01-01', 12, '2026-10-04');
  assert.strictEqual(f.length, 12);
  assert.strictEqual(f[10].month, '2026-11-01'); assert.strictEqual(f[10].count, 1); near(f[10].iqamaCost, 19950);
  near(f[0].rentDue, 59506.85 + 8926.03); near(f[6].rentDue, 60493.15 + 9073.97);
});

console.log(`\n${passed} test groups passed${process.exitCode ? ', SOME FAILED' : ''}`);
