const assert = require('assert');
const HR = require('./hr.js');
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} got ${a} (tol ${tol})`);

// Design §4.2 worked example: W = 10,000 (basic 7,000 + housing 2,500 + transport 500), hire 2019-06-01
const W10 = (extra) => Object.assign({ empNo: 'E1', nameEn: 'Ali', saudi: true, status: 'Active', gender: 'Male',
  hr: { hireDate: '2019-06-01', basic: 7000, housing: 2500, transport: 500 } }, extra || {});
const at = (days) => HR.addDays('2019-06-01', days);

t('EOSB design example: 2019-06-01 -> 2026-09-30 = 2,678 days, Y = 7.337, FULL 48,370', () => {
  const r = HR.eosb(W10(), '2026-09-30', 'EMPLOYER_TERMINATION');
  assert.strictEqual(HR.serviceDays(W10(), '2026-09-30'), 2678);
  near(r.years, 7.337, 0.0005);
  assert.strictEqual(r.wage, 10000);
  assert.strictEqual(Math.round(r.full), 48370);
  assert.strictEqual(r.amount, r.full);
  assert.ok(r.explanation.length >= 4);
});
t('EOSB design example: resignation at 7.337 yrs = 2/3 -> 32,247', () => {
  const r = HR.eosb(W10(), '2026-09-30', 'RESIGNATION');
  near(r.factor, 2 / 3, 1e-12);
  assert.strictEqual(Math.round(r.amount), 32247);
});
t('EOSB: 3 yrs employer termination = 15,000; resignation = 1/3 -> 5,000; female marriage = 15,000', () => {
  assert.strictEqual(HR.eosb(W10(), at(1095), 'EMPLOYER_TERMINATION').amount, 15000);
  assert.strictEqual(HR.eosb(W10(), at(1095), 'RESIGNATION').amount, 5000);
  assert.strictEqual(HR.eosb(W10({ gender: 'Female' }), at(1095), 'FEMALE_MARRIAGE_CHILDBIRTH').amount, 15000);
});
t('EOSB: resignation at Y = 1.9 = 0', () => {
  const r = HR.eosb(W10(), at(694), 'RESIGNATION');
  near(r.years, 1.9, 0.01); assert.strictEqual(r.amount, 0);
});
t('EOSB: 12 yrs resignation = full (95,000)', () => {
  const r = HR.eosb(W10(), at(12 * 365), 'RESIGNATION');
  assert.strictEqual(r.factor, 1); assert.strictEqual(r.full, 95000); assert.strictEqual(r.amount, 95000);
});
t('EOSB: Art. 80 dismissal = 0; unknown reason throws', () => {
  assert.strictEqual(HR.eosb(W10(), '2026-09-30', 'ART80').amount, 0);
  assert.throws(() => HR.eosb(W10(), '2026-09-30', 'NOPE'));
});
t('EOSB: unpaid leave > 20 days excluded from service (Art. 116)', () => {
  const lv = [{ empNo: 'E1', type: 'UNPAID', from: '2020-01-01', to: '2020-01-30', days: 30, status: 'APPROVED' }];
  assert.strictEqual(HR.serviceDays(W10(), '2026-09-30', lv), 2678 - 10);
});

// GOSI §4.5 (Oct-2026)
const G = (saudi, basic, housing, hr) => ({ empNo: 'G', saudi: saudi || undefined, nationality: saudi ? 'Saudi' : 'IN', status: 'Active',
  hr: Object.assign({ hireDate: '2015-01-01', basic: basic, housing: housing }, hr || {}) });
t('GOSI: Saudi legacy 8,000+2,000 -> EE 975, ER 1,175', () => {
  const g = HR.gosi(G(true, 8000, 2000), '2026-10-01');
  assert.strictEqual(g.regime, 'SAUDI_LEGACY'); assert.strictEqual(g.base, 10000);
  assert.strictEqual(g.ee, 975); assert.strictEqual(g.er, 1175);
});
t('GOSI: Saudi new entrant (Aug-2024) -> EE 1,075, ER 1,275 in Oct-2026; 10.25% in Oct-2025', () => {
  const e = G(true, 8000, 2000, { hireDate: '2024-08-01' });
  assert.strictEqual(HR.gosiRegime(e), 'SAUDI_NEW');
  const g = HR.gosi(e, '2026-10-01');
  assert.strictEqual(g.ee, 1075); assert.strictEqual(g.er, 1275);
  const g25 = HR.gosi(e, '2025-10-01');
  assert.strictEqual(g25.ee, 1025); assert.strictEqual(g25.er, 1225);
  assert.strictEqual(HR.gosi(e, '2024-10-01').ee, 975);
});
t('GOSI: firstContribDate before 2024-07-03 -> legacy; override wins', () => {
  assert.strictEqual(HR.gosiRegime(G(true, 1, 1, { hireDate: '2025-01-01', firstContribDate: '2020-01-01' })), 'SAUDI_LEGACY');
  assert.strictEqual(HR.gosiRegime(G(true, 1, 1, { gosiRegime: 'GCC' })), 'GCC');
});
t('GOSI: expat 4,000+1,000 -> EE 0, ER 100', () => {
  const g = HR.gosi(G(false, 4000, 1000), '2026-10-01');
  assert.strictEqual(g.regime, 'NONSAUDI'); assert.strictEqual(g.ee, 0); assert.strictEqual(g.er, 100);
});
t('GOSI: cap 45,000 (legacy EE 4,387.50) and Saudi floor 1,500', () => {
  const g = HR.gosi(G(true, 40000, 10000), '2026-10-01');
  assert.strictEqual(g.base, 45000); assert.strictEqual(g.ee, 4387.5);
  const f = HR.gosi(G(true, 1000, 0), '2026-10-01');
  assert.strictEqual(f.base, 1500); assert.strictEqual(f.ee, 146.25);
  assert.strictEqual(HR.gosi(G(false, 1000, 0), '2026-10-01').base, 1000); // no floor for expats
  assert.strictEqual(HR.gosi(G(false, 60000, 0), '2026-10-01').er, 900);
});
t('GOSI: housing in kind valued at basic x 2/12', () => {
  assert.strictEqual(HR.gosi(G(true, 6000, 0, { housingInKind: true }), '2026-10-01').base, 7000);
});

// Leave §4.3
t('Leave: accrual crossing the 5-year mark (hire 2021-10-15): Oct-2026 = 2.16 days', () => {
  const e = { empNo: 'L1', status: 'Active', hr: { hireDate: '2021-10-15', basic: 7000, housing: 2500, transport: 500, annualLeaveOpening: 0, openingAsOf: '2026-09-30' } };
  const sep = HR.leaveBalance(e, [], '2026-10-14');
  assert.strictEqual(sep.entitlementPerYear, 21);
  const b = HR.leaveBalance(e, [], '2026-10-31');
  assert.strictEqual(b.entitlementPerYear, 30);
  assert.strictEqual(HR.round2(b.accrued), 2.16);
  near(b.accrued, 1.75 * 14 / 31 + 2.5 * 17 / 31, 1e-4);
});
t('Leave: encashment example 12.5 days x 333.33 = 4,166.67; taken reduces balance', () => {
  const e = W10({ hr: Object.assign({}, W10().hr, { annualLeaveOpening: 12.5, openingAsOf: '2022-06-30' }) });
  const b = HR.leaveBalance(e, [], '2022-06-30');
  assert.strictEqual(b.balance, 12.5); assert.strictEqual(b.valuePerDay, 333.33); assert.strictEqual(b.liability, 4166.67);
  const lv = [{ empNo: 'E1', type: 'ANNUAL', from: '2022-07-10', to: '2022-07-14', days: 5, status: 'APPROVED' },
              { empNo: 'E1', type: 'ANNUAL', from: '2022-07-20', to: '2022-07-21', days: 2, status: 'REJECTED' }];
  const b2 = HR.leaveBalance(e, lv, '2022-07-31');
  assert.strictEqual(b2.taken, 5); near(b2.accrued, 1.75, 1e-9); near(b2.balance, 12.5 + 1.75 - 5, 1e-9);
});
t('Leave: full year from hire accrues 21 days', () => {
  const e = { empNo: 'L2', hr: { hireDate: '2025-01-01', basic: 3000 } };
  near(HR.leaveBalance(e, [], '2025-12-31').accrued, 21, 1e-6);
  assert.strictEqual(HR.leaveDays('2026-01-30', '2026-02-02'), 4);
});

// Sick §4.4
const S9 = { empNo: 'S1', status: 'Active', hr: { hireDate: '2020-01-01', basic: 6000, housing: 2250, transport: 750 } };
t('Sick: 25 used + 20-day certificate = 5 full + 15 @75%, deduction 1,125', () => {
  const lv = [{ id: 'a', empNo: 'S1', type: 'SICK', from: '2026-01-01', to: '2026-01-25', days: 25, status: 'APPROVED' }];
  const r = HR.sickPay(S9, lv, { id: 'b', empNo: 'S1', type: 'SICK', from: '2026-03-01', to: '2026-03-20', days: 20 });
  assert.strictEqual(r.full, 5); assert.strictEqual(r.t75, 15); assert.strictEqual(r.unpaid, 0);
  assert.strictEqual(r.dayRate, 300); assert.strictEqual(r.deduction, 1125); assert.strictEqual(r.cycleStart, '2026-01-01');
});
t('Sick: crossing 75% -> unpaid tier, and a new window after 365 days', () => {
  const lv = [{ id: 'a', empNo: 'S1', type: 'SICK', from: '2026-01-01', to: '2026-03-26', status: 'APPROVED' }]; // 85 days
  const r = HR.sickPay(S9, lv, { id: 'b', empNo: 'S1', type: 'SICK', from: '2026-06-01', to: '2026-06-10' });
  assert.strictEqual(r.t75, 5); assert.strictEqual(r.unpaid, 5); assert.strictEqual(r.deduction, 5 * 75 + 5 * 300);
  const n = HR.sickPay(S9, lv, { id: 'c', empNo: 'S1', type: 'SICK', from: '2027-01-01', to: '2027-01-10' });
  assert.strictEqual(n.full, 10); assert.strictEqual(n.cycleStart, '2027-01-01'); assert.strictEqual(n.deduction, 0);
  const x = HR.sickPay(S9, lv, { id: 'd', empNo: 'S1', type: 'SICK', from: '2026-12-27', to: '2027-01-05' }); // window ends 2026-12-31
  assert.strictEqual(x.t75, 5); assert.strictEqual(x.full, 5);
});

// Payroll §4.6 / §4.7 / §4.8
t('Payroll: mid-month joiner 18 Oct 2026, W 9,000 -> 13/30 = 3,900 (calendar mode 4,064.52)', () => {
  const e = { empNo: 'P1', nameEn: 'New', nationality: 'IN', status: 'Active', iqamaNo: '2123456789',
    hr: { hireDate: '2026-10-18', basic: 6000, housing: 2250, transport: 750, iban: 'SA0380000000608010167519' } };
  const run = HR.payroll([e], '2026-10-01', {});
  const l = run.lines[0];
  assert.strictEqual(l.days, 13); assert.strictEqual(l.gross, 3900);
  assert.strictEqual(l.gosiEr, 165); // full registered base for the month of registration
  assert.strictEqual(run.warnings.length, 0);
  const c = HR.payroll([e], '2026-10-01', {}, { proration: 'CALENDAR' }).lines[0];
  assert.strictEqual(c.gross, 4064.52);
  assert.strictEqual(HR.payroll([Object.assign({}, e, { hr: Object.assign({}, e.hr, { hireDate: '2026-10-31' }) })], '2026-10-01', {}).lines[0].days, 1);
});
t('Payroll: OT per Art. 107 (basic 6,000, W 8,000, 10 h = 458.33); simplified option = 375', () => {
  const e = { empNo: 'O1', status: 'Active', nationality: 'EG', hr: { hireDate: '2020-01-01', basic: 6000, housing: 1500, transport: 500, iban: 'SA0380000000608010167519' } };
  const inputs = { O1: { otHours: 10 } };
  assert.strictEqual(HR.payroll([e], '2026-10-01', { inputs }).lines[0].ot, 458.33);
  assert.strictEqual(HR.payroll([e], '2026-10-01', { inputs }, { otRule: 'simple15' }).lines[0].ot, 375);
});

const staff = [
  { empNo: 'A1', nameEn: 'Saudi Legacy', saudi: true, nationalId: '1012345678', status: 'Active', department: 'Ops', gender: 'Male',
    hr: { hireDate: '2018-03-01', basic: 8000, housing: 2000, transport: 500, otherAllow: 300, iban: 'SA0380000000608010167519', bankName: 'Al Rajhi' } },
  { empNo: 'A2', nameEn: 'Expat, "Driver"', nationality: 'IN', iqamaNo: '2123456789', status: 'Active', department: 'Drivers', gender: 'Male',
    hr: { hireDate: '2026-10-11', basic: 3000, housing: 750, transport: 300 } },
  { empNo: 'A3', nameEn: 'Saudi New', saudi: true, status: 'On Vacation', department: 'Admin', gender: 'Female',
    hr: { hireDate: '2025-02-01', basic: 2500, housing: 625, transport: 300, iban: 'SA0080000000608010167519', endDate: '2026-10-20' } },
  { empNo: 'A4', nameEn: 'Left', nationality: 'PK', status: 'Terminated', hr: { hireDate: '2019-01-01', basic: 5000, endDate: '2026-08-31' } },
  { empNo: 'A5', nameEn: 'No basic', nationality: 'PK', status: 'Active', hr: { hireDate: '2019-01-01' } },
  { empNo: 'A6', nameEn: 'Bad', nationality: 'PK', status: 'Active', hr: { hireDate: '2019-01-01', basic: -10 } }
];
const data = {
  leaves: [{ id: 'u', empNo: 'A1', type: 'UNPAID', from: '2026-10-05', to: '2026-10-06', days: 2, status: 'APPROVED' },
           { id: 's0', empNo: 'A1', type: 'SICK', from: '2026-08-01', to: '2026-08-30', days: 30, status: 'APPROVED' },
           { id: 's1', empNo: 'A1', type: 'SICK', from: '2026-10-12', to: '2026-10-14', days: 3, status: 'APPROVED' },
           { id: 'x', empNo: 'A1', type: 'UNPAID', from: '2026-10-20', to: '2026-10-25', days: 6, status: 'PENDING' }],
  loans: [{ id: 'L', empNo: 'A1', amount: 2500, startPeriod: '2026-06', monthly: 600, status: 'ACTIVE' }],
  inputs: { A1: { absenceDays: 1, otHours: 5, bonus: 1000, otherDeduction: 123.45 }, A2: { otherDeduction: 5000 } }
};
const run = HR.payroll(staff, '2026-10-01', data);
t('Payroll: inclusion, deductions, loans, warnings', () => {
  assert.deepStrictEqual(run.lines.map(l => l.empNo), ['A1', 'A2', 'A3']);
  const a1 = run.lines[0], dr = (8000 + 2000 + 500 + 300) / 30;
  assert.strictEqual(a1.absence, HR.round2(dr)); assert.strictEqual(a1.unpaidLeave, HR.round2(2 * dr));
  assert.strictEqual(a1.sickDeduction, HR.round2(3 * dr * 0.25));
  assert.strictEqual(a1.loan, 100); // 2500 - 4 x 600 = 100 left in Oct
  assert.strictEqual(a1.gosiEe, 975);
  near(a1.net, a1.gross - a1.deductions, 0.001);
  const a3 = run.lines[2];
  assert.strictEqual(a3.days, 20); assert.strictEqual(a3.gosiRegime, 'SAUDI_NEW');
  const codes = run.warnings.map(w => w.empNo + ':' + w.code);
  ['A2:IBAN_MISSING', 'A2:NET_NEGATIVE', 'A6:BASIC_NEGATIVE', 'A3:IBAN_INVALID'].forEach(c => assert.ok(codes.includes(c), 'missing ' + c + ' in ' + codes));
  assert.strictEqual(HR.loanInstalment(data.loans[0], '2026-11'), 0);
  assert.strictEqual(HR.loanInstalment(Object.assign({}, data.loans[0], { deferredPeriods: ['2026-07'] }), '2026-10'), 600);
});
t('Payroll journal: balanced, Dr = gross - absence/unpaid/sick + ER', () => {
  const j = HR.payrollJournal(run);
  assert.strictEqual(j.balanced, true);
  const e = j.entries[0];
  assert.strictEqual(e.jeNo, 'PAY-2026-10'); assert.strictEqual(e.date, '2026-10-31');
  const sum = (k) => Math.round(e.lines.reduce((s, l) => s + l[k] * 100, 0));
  assert.strictEqual(sum('debit'), sum('credit'));
  const T = run.totals;
  assert.strictEqual(sum('debit') - 230000, Math.round((T.gross - T.absence - T.unpaidLeave - T.sickDeduction + T.gosiEr) * 100));
  const sp = e.lines.filter(l => l.accountKey === 'salPay');
  assert.ok(sp.some(l => l.debit > 0), 'negative net posts as debit');
  assert.ok(e.lines.every(l => l.cls !== undefined && l.memo));
  assert.ok(e.lines.some(l => l.account === 'GOSI Payable' && l.cls === 'Ops'));
});
t('EOSB provision + journal (increase and reversal)', () => {
  const p0 = HR.eosbProvision(staff, '2026-09-30'), p1 = HR.eosbProvision(staff.slice(0, 1), '2026-09-30'), p2 = HR.eosbProvision(staff.slice(0, 1), '2026-10-31');
  assert.deepStrictEqual(p0.rows.map(r => r.empNo), ['A1', 'A3']); assert.deepStrictEqual(HR.eosbProvision(staff, '2026-10-31').rows.map(r => r.empNo), ['A1', 'A2']);
  assert.ok(p2.total > p1.total);
  const j = HR.eosbJournal(p1, p2, '2026-10-01');
  assert.strictEqual(j.lines[0].account, 'End of Service Expense'); assert.strictEqual(j.lines[0].debit, HR.round2(p2.total - p1.total));
  assert.strictEqual(j.lines[1].credit, j.lines[0].debit);
  const r = HR.eosbJournal(p2, p1, '2026-10-01');
  assert.strictEqual(r.lines[0].account, 'End of Service Provision'); assert.ok(r.lines[0].debit > 0);
  assert.strictEqual(HR.eosbJournal(100, 100, '2026-10-01').lines.length, 0);
});
t('Mudad CSV: UNCERTAIN comment line, header, bank code, quoting', () => {
  const csv = HR.mudadCSV(run, undefined, { name: 'Co' });
  const rows = csv.trim().split('\r\n');
  assert.ok(rows[0].startsWith('#') && /UNCERTAIN/.test(rows[0]));
  assert.strictEqual(rows[1], 'ID Number,Name,IBAN,Bank Code,Basic,Housing,Other Earnings,Deductions,Net,Period');
  assert.strictEqual(rows.length, 2 + run.lines.length);
  assert.ok(rows[2].startsWith('1012345678,Saudi Legacy,SA0380000000608010167519,80,8000.00,2000.00,'));
  assert.ok(rows[2].endsWith(',2026-10'));
  assert.ok(rows[3].includes('"Expat, ""Driver"""'));
  assert.ok(HR.validIBAN('SA0380000000608010167519') && !HR.validIBAN('SA0380000000608010167518'));
});
t('Nitaqat: half count below 4,000, zero below 3,000 / undocumented, expats count 1', () => {
  const S = (no, b, h, x) => ({ empNo: no, saudi: true, status: 'Active', hr: Object.assign({ basic: b, housing: h, transport: 0 }, x || {}) });
  const emps = [S('n1', 4000, 0), S('n2', 3000, 500), S('n3', 2000, 500), S('n4', 9000, 0, { qiwaDocumented: false }),
    { empNo: 'x1', nationality: 'IN', status: 'Active', hr: {} }, { empNo: 'x2', nationality: 'IN', status: 'Active', hr: {} },
    { empNo: 'x3', nationality: 'IN', status: 'Terminated', hr: {} }];
  const n = HR.nitaqat(emps);
  assert.deepStrictEqual(n.rows.filter(r => r.saudi).map(r => r.weight), [1, 0.5, 0, 0]);
  assert.strictEqual(n.saudiWeighted, 1.5); assert.strictEqual(n.total, 3.5); assert.strictEqual(n.pct, 42.86);
  assert.strictEqual(HR.nitaqat(emps, { saudizationZeroBelow: 0 }).saudiWeighted, 2);
});
t('Headcount', () => {
  const h = HR.headcount(staff);
  assert.strictEqual(h.total, 6); assert.strictEqual(h.active, 5);
  assert.strictEqual(h.byNationality.Saudi, 2); assert.strictEqual(h.byStatus.Terminated, 1); assert.strictEqual(h.byGender.Female, 1);
  assert.strictEqual(h.byDepartment.Ops, 1); assert.strictEqual(h.byDepartment.Drivers, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
