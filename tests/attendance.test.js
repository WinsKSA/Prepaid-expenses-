const assert = require('assert');
const A = require('../attendance.js');
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } }

// KSA local time helper: L('2026-10-04','08:00') -> UTC ISO
const L = (d, hhmm) => A.atFor(d, A.hm(hhmm));
const P = (kind, d, hhmm, extra) => Object.assign({ empNo: 'E1', kind, at: L(d, hhmm), status: 'ok' }, extra || {});
const emp = (hr) => ({ empNo: 'E1', nameEn: 'Ali', status: 'Active', hr: Object.assign({ hireDate: '2020-01-01' }, hr || {}) });
const SUN = '2026-10-04', FRI = '2026-10-09';
const after = { now: '2026-10-20T12:00:00Z' };

t('KSA local time conversion: 08:00 Riyadh = 05:00 UTC', () => {
  assert.strictEqual(L(SUN, '08:00'), '2026-10-04T05:00:00.000Z');
  assert.strictEqual(A.weekday(SUN), 0);
  assert.strictEqual(A.localDate(Date.parse('2026-10-04T22:30:00Z')), '2026-10-05');
});
t('On time, full day: 08:00–17:00 with 60 min unpaid break = 8h, present, no OT', () => {
  const r = A.day(emp(), SUN, [P('in', SUN, '07:58'), P('out', SUN, '17:02')], after);
  assert.strictEqual(r.status, 'PRESENT'); assert.strictEqual(r.code, 'P');
  assert.strictEqual(r.workedMin, 484); assert.strictEqual(r.lateMin, 0); assert.strictEqual(r.otMin, 0); assert.strictEqual(r.absence, 0);
});
t('Within grace (08:14) is not late; 08:20 is late by 20 minutes from shift start', () => {
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '08:14'), P('out', SUN, '17:00')], after).status, 'PRESENT');
  const r = A.day(emp(), SUN, [P('in', SUN, '08:20'), P('out', SUN, '17:00')], after);
  assert.strictEqual(r.status, 'LATE'); assert.strictEqual(r.lateMin, 20);
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '08:20'), P('out', SUN, '17:00')], Object.assign({ cfg: { lateFromStart: false } }, after)).lateMin, 5);
});
t('Early leave flagged; overtime counted only above 30 minutes', () => {
  const e = A.day(emp(), SUN, [P('in', SUN, '08:00'), P('out', SUN, '16:00')], after);
  assert.strictEqual(e.earlyMin, 60); assert.ok(e.flags.includes('EARLY_LEAVE'));
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '08:00'), P('out', SUN, '17:20')], after).otMin, 0);
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '08:00'), P('out', SUN, '19:00')], after).otMin, 120);
});
t('No punches on a past workday = absent; weekend and holiday are off; holiday work is overtime (Art. 107)', () => {
  assert.strictEqual(A.day(emp(), SUN, [], after).status, 'ABSENT');
  assert.strictEqual(A.day(emp(), SUN, [], after).absence, 1);
  assert.strictEqual(A.day(emp(), FRI, [], after).status, 'WEEKEND');
  const cfg = { holidays: [{ date: '2026-09-23', name: 'National Day' }] };
  assert.strictEqual(A.day(emp(), '2026-09-23', [], Object.assign({ cfg }, after)).status, 'HOLIDAY');
  const w = A.day(emp(), FRI, [P('in', FRI, '09:00'), P('out', FRI, '13:00')], after);
  assert.strictEqual(w.status, 'WEEKEND'); assert.strictEqual(w.otMin, 240); assert.ok(w.flags.includes('OFFDAY_WORK'));
});
t('Approved leave wins over absence; pending leave does not', () => {
  const lv = [{ empNo: 'E1', from: '2026-10-04', to: '2026-10-06', status: 'APPROVED', type: 'ANNUAL' }];
  assert.strictEqual(A.day(emp(), SUN, [], Object.assign({ leaves: lv }, after)).status, 'LEAVE');
  assert.strictEqual(A.day(emp(), SUN, [], Object.assign({ leaves: [Object.assign({}, lv[0], { status: 'PENDING' })] }, after)).status, 'ABSENT');
});
t('Live day: before start+grace = not yet; after = not in; checked in = IN with running minutes', () => {
  assert.strictEqual(A.day(emp(), SUN, [], { now: L(SUN, '08:05') }).status, 'NOT_YET');
  assert.strictEqual(A.day(emp(), SUN, [], { now: L(SUN, '09:00') }).status, 'NOT_IN');
  const r = A.day(emp(), SUN, [P('in', SUN, '08:00')], { now: L(SUN, '10:30') });
  assert.strictEqual(r.status, 'IN'); assert.strictEqual(r.workedMin, 150);
  assert.strictEqual(A.day(emp(), '2026-10-25', [], { now: L(SUN, '10:30') }).status, 'UPCOMING');
});
t('Missing check-out on a past day = incomplete (flagged, no absence by default)', () => {
  const r = A.day(emp(), SUN, [P('in', SUN, '08:00')], after);
  assert.strictEqual(r.status, 'INCOMPLETE'); assert.ok(r.flags.includes('MISSING_OUT')); assert.strictEqual(r.absence, 0);
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '08:00')], Object.assign({ cfg: { incompleteAbsence: 0.5 } }, after)).absence, 0.5);
});
t('Recorded breaks replace the automatic break; half day under 4 hours', () => {
  const r = A.day(emp(), SUN, [P('in', SUN, '08:00'), P('break_start', SUN, '12:00'), P('break_end', SUN, '12:30'), P('out', SUN, '17:00')], after);
  assert.strictEqual(r.breakMin, 30); assert.strictEqual(r.workedMin, 510); assert.strictEqual(r.otMin, 30);
  const h = A.day(emp(), SUN, [P('in', SUN, '08:00'), P('out', SUN, '11:00')], after);
  assert.strictEqual(h.status, 'HALF_DAY'); assert.strictEqual(h.absence, 0.5);
});
t('Rejected punches never count; outside-geofence punches count but are flagged for review', () => {
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '08:00', { status: 'rejected' }), P('out', SUN, '17:00', { status: 'rejected' })], after).status, 'ABSENT');
  const o = A.day(emp(), SUN, [P('in', SUN, '08:00', { status: 'outside' }), P('out', SUN, '17:00')], after);
  assert.strictEqual(o.status, 'PRESENT'); assert.ok(o.flags.includes('REVIEW'));
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '08:00', { status: 'outside' })], Object.assign({ cfg: { countOutside: false } }, after)).status, 'ABSENT');
});
t('Night shift 22:00–06:00: punches after midnight belong to the shift day', () => {
  const cfg = { shifts: [{ id: 'N', start: '22:00', end: '06:00', breakMin: 0, days: [0, 1, 2, 3, 4, 5, 6] }], defaultShiftId: 'N' };
  const r = A.day(emp(), SUN, [P('in', SUN, '21:55'), P('out', '2026-10-05', '06:05')], Object.assign({ cfg }, after));
  assert.strictEqual(r.status, 'PRESENT'); assert.strictEqual(r.workedMin, 490);
  // the next day sees only its own punches
  assert.strictEqual(A.day(emp(), '2026-10-05', [P('in', SUN, '21:55'), P('out', '2026-10-05', '06:05')], Object.assign({ cfg }, after)).status, 'ABSENT');
});
t('Night shift into a day off: Thursday 22:00 → Friday 06:00 keeps its check-out', () => {
  const cfg = { shifts: [{ id: 'N', start: '22:00', end: '06:00', breakMin: 0, days: [0, 1, 2, 3, 4, 6] }], defaultShiftId: 'N' };
  const THU = '2026-10-08', FRI2 = '2026-10-09';
  const ps = [P('in', THU, '21:50'), P('out', FRI2, '06:02')];
  const r = A.day(emp(), THU, ps, Object.assign({ cfg }, after));
  assert.strictEqual(r.status, 'PRESENT'); assert.strictEqual(r.workedMin, 492);
  assert.strictEqual(A.fmtMin(r.lastOut), '06:02');
  const f = A.day(emp(), FRI2, ps, Object.assign({ cfg }, after));
  assert.strictEqual(f.status, 'WEEKEND'); assert.strictEqual(f.punches.length, 0);
});
t('Ramadan: 6-hour day, no break; flexible shifts are never late', () => {
  const cfg = { ramadan: { from: '2026-10-01', to: '2026-10-10', hoursDay: 6 } };
  const s = A.resolveShift(emp(), SUN, cfg);
  assert.strictEqual(s.expected, 360); assert.strictEqual(s.ramadan, true);
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '08:00'), P('out', SUN, '14:00')], Object.assign({ cfg }, after)).status, 'PRESENT');
  const f = { shifts: [{ id: 'F', start: '07:00', end: '16:00', breakMin: 60, flexible: true }], defaultShiftId: 'F' };
  assert.strictEqual(A.day(emp(), SUN, [P('in', SUN, '10:00'), P('out', SUN, '18:00')], Object.assign({ cfg: f }, after)).lateMin, 0);
});
t('Days before attendance tracking started are never absences', () => {
  assert.strictEqual(A.day(emp(), SUN, [], Object.assign({ cfg: { trackingFrom: '2026-10-05' } }, after)).status, 'NA');
  const m = A.month([emp()], [], { cfg: { trackingFrom: '2026-10-05' }, now: '2026-10-07T20:00:00Z' }, '2026-10-01');
  assert.strictEqual(m.rows[0].totals.absent, 3);   // 5, 6, 7 Oct only
});
t('Before hire date = not applicable', () => {
  assert.strictEqual(A.day(emp({ hireDate: '2026-10-10' }), SUN, [], after).status, 'NA');
});
t('Month totals and payroll inputs (absence days + OT hours)', () => {
  const ps = [P('in', SUN, '08:30'), P('out', SUN, '19:00'), P('in', '2026-10-05', '08:00'), P('out', '2026-10-05', '17:00')];
  const m = A.month([emp()], ps, { now: '2026-10-07T20:00:00Z' }, '2026-10-01');
  const tt = m.rows[0].totals;
  // Oct 1 (Thu) absent, 2–3 weekend, 4 late+OT, 5 present, 6–7 absent
  assert.strictEqual(tt.present, 2); assert.strictEqual(tt.late, 1); assert.strictEqual(tt.lateMin, 30);
  assert.strictEqual(tt.absent, 3); assert.strictEqual(tt.otMin, 90); assert.strictEqual(tt.off, 2);
  const pi = A.payrollInputs(m);
  assert.deepStrictEqual(pi.E1, { absenceDays: 3, otHours: 1.5 });
  assert.strictEqual(A.payrollInputs(m, { deductLate: true }).E1.absenceDays, 3.06);
});
t('Board counts for a live day', () => {
  const e2 = { empNo: 'E2', status: 'Active', hr: {} }, e3 = { empNo: 'E3', status: 'Active', hr: {} };
  const ps = [P('in', SUN, '07:55'), Object.assign(P('in', SUN, '08:40'), { empNo: 'E2' })];
  const b = A.board([emp(), e2, e3], ps, { now: L(SUN, '10:00') }, SUN);
  assert.strictEqual(b.counts.present, 2); assert.strictEqual(b.counts.late, 1); assert.strictEqual(b.counts.notIn, 1); assert.strictEqual(b.counts.inNow, 2);
});
t('Geofence: haversine distance and inside / outside / low accuracy', () => {
  const br = [{ id: 'RUH', lat: 24.7136, lng: 46.6753, radius_m: 150 }, { id: 'JED', lat: 21.5433, lng: 39.1728, radius_m: 200 }];
  const d = A.haversine(24.7136, 46.6753, 24.7146, 46.6753);
  assert.ok(Math.abs(d - 111.2) < 1, 'about 111 m per 0.001° latitude, got ' + d);
  const ok = A.evaluatePunch(br, 24.7140, 46.6755, 12);
  assert.strictEqual(ok.branchId, 'RUH'); assert.strictEqual(ok.inside, true); assert.strictEqual(ok.status, 'ok');
  assert.strictEqual(A.evaluatePunch(br, 24.7300, 46.6753, 12).status, 'outside');
  assert.strictEqual(A.evaluatePunch(br, 24.7140, 46.6755, 250).status, 'low_accuracy');
  assert.strictEqual(A.evaluatePunch(br, 21.5435, 39.1730, 10).branchId, 'JED');
});
t('Location rules: assigned-branch mode, block-outside mode, impossible travel', () => {
  const br = [{ id: 'RUH', name: 'Riyadh', lat: 24.7136, lng: 46.6753, radius_m: 150 }, { id: 'JED', name: 'Jeddah', lat: 21.5433, lng: 39.1728, radius_m: 200 }];
  // standing at Jeddah but assigned to Riyadh only
  const any = A.evaluatePunch(br, 21.5435, 39.1730, 10, {}, ['RUH']);
  assert.strictEqual(any.status, 'ok'); assert.strictEqual(any.branchId, 'JED');
  const asg = A.evaluatePunch(br, 21.5435, 39.1730, 10, { geoMode: 'assigned' }, ['RUH']);
  assert.strictEqual(asg.status, 'outside'); assert.strictEqual(asg.branchId, 'RUH'); assert.ok(/Outside Riyadh/.test(asg.reason));
  assert.strictEqual(A.evaluatePunch(br, 24.7300, 46.6753, 10, { blockOutside: true }).blocked, true);
  assert.strictEqual(A.evaluatePunch(br, 24.7137, 46.6753, 10, { blockOutside: true }).blocked, false);
  assert.deepStrictEqual(A.allowedBranches({ hr: { branchId: 'RUH', branchIds: ['JED', 'RUH'] } }), ['JED', 'RUH']);
  const tr = A.travelCheck({ lat: 24.7136, lng: 46.6753, at: '2026-10-04T05:00:00Z' }, { lat: 21.5433, lng: 39.1728, at: '2026-10-04T05:30:00Z' });
  assert.ok(tr && tr.kmh > 1000, 'Riyadh → Jeddah in 30 min is impossible');
  assert.strictEqual(A.travelCheck({ lat: 24.7136, lng: 46.6753, at: '2026-10-04T05:00:00Z' }, { lat: 24.7140, lng: 46.6760, at: '2026-10-04T05:30:00Z' }), null);
});
t('Art. 101: no break over 5 h and over 12 h on site are flagged', () => {
  const cfg = { shifts: [{ id: 'X', start: '07:00', end: '20:00', breakMin: 0, days: [0, 1, 2, 3, 4] }], defaultShiftId: 'X' };
  const r = A.day(emp(), SUN, [P('in', SUN, '07:00'), P('out', SUN, '20:30')], Object.assign({ cfg }, after));
  assert.ok(r.flags.includes('NO_BREAK')); assert.ok(r.flags.includes('OVER_12H'));
  const ok = A.day(emp(), SUN, [P('in', SUN, '08:00'), P('out', SUN, '17:00')], after);
  assert.ok(!ok.flags.includes('NO_BREAK') && !ok.flags.includes('OVER_12H'));
});
t('Art. 80 watch: 11 absences in a row = warning; leave and weekends do not count', () => {
  const ps = []; // present on Sun 4 Oct only, then absent every workday until 25 Oct
  ps.push(P('in', SUN, '08:00'), P('out', SUN, '17:00'));
  const w = A.lawWatch([emp()], ps, { now: '2026-10-25T20:00:00Z' }, '2026-10-04', '2026-10-25')[0];
  assert.strictEqual(w.absentDays, 15); assert.strictEqual(w.longestRun, 15); assert.strictEqual(w.level, 'warning');
  const lv = [{ empNo: 'E1', from: '2026-10-05', to: '2026-10-25', status: 'APPROVED', type: 'ANNUAL' }];
  assert.strictEqual(A.lawWatch([emp()], ps, { now: '2026-10-25T20:00:00Z', leaves: lv }, '2026-10-04', '2026-10-25')[0].absentDays, 0);
});
t('Ramadan hours for Muslims only when configured', () => {
  const cfg = { ramadan: { from: '2026-10-01', to: '2026-10-10', hoursDay: 6, applyTo: 'muslims' } };
  assert.strictEqual(A.resolveShift(emp(), SUN, cfg).ramadan, false);
  assert.strictEqual(A.resolveShift(emp({ muslim: true }), SUN, cfg).ramadan, true);
  assert.strictEqual(A.resolveShift(Object.assign(emp(), { religion: 'Muslim' }), SUN, cfg).expected, 360);
});
t('Next action: in → out, break → break end', () => {
  assert.strictEqual(A.nextAction([]), 'in');
  assert.strictEqual(A.nextAction([P('in', SUN, '08:00')]), 'out');
  assert.strictEqual(A.nextAction([P('in', SUN, '08:00'), P('break_start', SUN, '12:00')]), 'break_end');
  assert.strictEqual(A.nextAction([P('in', SUN, '08:00'), P('out', SUN, '17:00')]), 'in');
});
t('Device import: local time strings, first = in, last = out', () => {
  assert.strictEqual(A.parseLocal('2026-10-04 08:00'), '2026-10-04T05:00:00.000Z');
  assert.strictEqual(A.parseLocal('04/10/2026 05:30 PM'), '2026-10-04T14:30:00.000Z');
  const ps = A.fromDeviceRows([{ empNo: 'E1', at: A.parseLocal('2026-10-04 12:00') }, { empNo: 'E1', at: A.parseLocal('2026-10-04 07:59') }, { empNo: 'E1', at: A.parseLocal('2026-10-04 17:01') }]);
  assert.strictEqual(ps.length, 2); assert.strictEqual(ps[0].kind, 'in'); assert.strictEqual(ps[1].kind, 'out'); assert.strictEqual(ps[0].at, '2026-10-04T04:59:00.000Z');
});
t('Umm al-Qura holiday suggestions for 2027 include both Eids and Ramadan', () => {
  const s = A.suggestHolidays(2027);
  const fitr = s.holidays.find(h => h.name === 'Eid al-Fitr'), adha = s.holidays.find(h => h.name === 'Eid al-Adha');
  assert.ok(fitr && /^2027-03-/.test(fitr.date), 'Eid al-Fitr in March 2027, got ' + (fitr && fitr.date));
  assert.ok(adha && /^2027-05-/.test(adha.date), 'Eid al-Adha in May 2027, got ' + (adha && adha.date));
  assert.ok(s.ramadan.from && s.ramadan.to && s.ramadan.from < fitr.date);
  assert.strictEqual(s.holidays[0].name, 'Founding Day');
});

console.log(`\n${passed} passed, ${failed} failed`);
