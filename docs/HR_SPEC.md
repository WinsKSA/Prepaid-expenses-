# hr.js — HR calculation engine (MVP). Rules source: HRIS_DESIGN.md (same folder) §4. Follow it; where it marks UNCERTAIN, use the value below and expose it in DEFAULT_HR so the UI can edit it.

Vanilla JS IIFE → `window.HR` (+ `module.exports`). No dependencies. ISO "YYYY-MM-DD", UTC math. Money 2 dp.

## Employee HR fields (on the existing employee doc, all optional)
```js
emp = { empNo, nameAr, nameEn, nationality, saudi:true|undefined, status, gender:"Male"|"Female",
  hr: { hireDate, basic, housing, transport, otherAllow, housingInKind:false,
        iban, bankName, gosiRegNo, gosiRegime /* override: SAUDI_LEGACY|SAUDI_NEW|NONSAUDI|GCC */, firstContribDate,
        contractType:"FIXED"|"INDEFINITE", contractEnd, probationEnd, managerEmpNo,
        annualLeaveOpening /* days balance at openingAsOf */, openingAsOf, qiwaDocumented:true, endDate, endReason } }
```
## Collections the UI keeps (inputs to the engine)
- leaves: `{id, empNo, type:"ANNUAL"|"SICK"|"MATERNITY"|"PATERNITY"|"MARRIAGE"|"BEREAVEMENT"|"HAJJ"|"EXAM"|"UNPAID", from, to, days /*calendar days*/, status:"PENDING"|"APPROVED"|"REJECTED"|"CANCELLED"}`
- loans: `{id, empNo, amount, startPeriod:"YYYY-MM", monthly, status}`
- payInputs (per period): `{ [empNo]: {absenceDays, otHours, bonus, otherDeduction, note} }`

## API (exact names)
- `DEFAULT_HR` — { gosi:{ SAUDI_LEGACY:{ee:0.0975, er:0.1175}, SAUDI_NEW schedule by effective date [{from:"2024-07-03",ee:0.1075,er:0.1275},{from:"2025-07-01",...}...to 2028 per design}, NONSAUDI:{ee:0, er:0.02}, baseMin:1500, baseMax:45000, newRegimeFrom:"2024-07-03" },
  workHoursDay:8, otRule:"art107" /* hourly wage + 50% of basic hourly */, saudizationHalfBelow:4000,
  leave:{ ANNUAL:{daysUnder5:21, daysFrom5:30}, SICK tiers [30 full,60 @75%,30 unpaid] per 12 months, MATERNITY:84, PATERNITY:3, MARRIAGE:5, BEREAVEMENT:5, HAJJ:10, ... },
  accounts:{ salaries:"Salaries & Wages", housing:"Housing Allowance", transport:"Transport Allowance", otherAllow:"Other Allowances", overtime:"Overtime", gosiExp:"GOSI Expense", gosiPay:"GOSI Payable", salPay:"Salaries Payable", loansRecv:"Employee Loans & Advances", eosbExp:"End of Service Expense", eosbProv:"End of Service Provision", leaveExp:"Leave Expense", leaveProv:"Leave Provision", bank:"Bank - Al Rajhi" } }
- `gosiRegime(emp, cfg)` → auto: non-Saudi → NONSAUDI; Saudi → firstContribDate (or hireDate) < newRegimeFrom ? SAUDI_LEGACY : SAUDI_NEW; `hr.gosiRegime` overrides.
- `gosi(emp, periodISO, cfg)` → `{regime, base /* basic+housing (in-kind housing: per design), clamped */, ee, er, eeRate, erRate}`.
- `serviceDays(emp, toISO)`, `serviceYears(emp, toISO)` (days/365).
- `eosb(emp, toISO, reason, cfg)` reasons: "EMPLOYER_TERMINATION","CONTRACT_END","RESIGNATION","ART80","ART81","FORCE_MAJEURE","FEMALE_MARRIAGE_CHILDBIRTH","DEATH","RETIREMENT" → `{years, wage /* last basic+housing+transport+otherAllow per design */, full, factor, amount, explanation:[...]}` (Art. 84/85/87 + resignation fractions 0 / 1/3 / 2/3 / 1 at <2, 2–5, 5–10, ≥10 years).
- `eosbProvision(emps, asOfISO, cfg)` → `{rows:[{empNo, years, amount}], total}` (full Art. 84 entitlement as liability).
- `leaveBalance(emp, leaves, asOfISO, cfg)` → `{entitlementPerYear, accrued, taken, opening, balance, valuePerDay /* (basic+housing+transport)/30 */, liability}`; accrual daily from max(hireDate, openingAsOf); entitlement 30 once service ≥ 5 years (from that date).
- `sickPay(emp, leaves, leaveRequest, cfg)` → split of the request into full/75%/unpaid days given the rolling 12-month window.
- `leaveDays(from, to)` calendar days inclusive.
- `payroll(emps, periodISO /* YYYY-MM-01 */, {leaves, loans, inputs}, cfg)` → `{period, lines:[{empNo, name, days, basic, housing, transport, otherAllow, ot, bonus, gross, gosiEe, gosiEr, absence, unpaidLeave, sickDeduction, loan, otherDeduction, deductions, net, iban, bankName}], totals, warnings:[...] }`.
  Include only active staff with hr.basic > 0. Pro-rate by days in period for hire/end inside the month (30-day month basis per design). Absence & unpaid leave & unpaid sick days deduct (gross/30 per day; sick 75% tier deducts 25% of daily). OT per DEFAULT_HR.otRule. Warn on missing IBAN, basic<0, net<0.
- `mudadCSV(run, cfg, company)` → CSV text for WPS/Mudad upload per design §4.9 (mark columns that are UNCERTAIN in a header comment line starting with "#" only if the design says so; otherwise plain CSV): employee id (iqama/national id), name, IBAN, bank code (from IBAN chars 5–6), basic, housing, other earnings, deductions, net, period.
- `payrollJournal(run, cfg)` → `{entries:[{jeNo:"PAY-YYYY-MM", date: month end, memo, lines:[{account, debit, credit, memo, cls}]}], balanced}`: Dr salaries/housing/transport/otherAllow/overtime(+bonus to overtime or salaries), Dr gosiExp (er); Cr gosiPay (ee+er), Cr loansRecv (loan deductions), Cr salPay (net); absence reduces the earning lines (post net earnings). Must balance.
- `eosbJournal(prevProvision, currProvision, monthISO, cfg)` → one entry Dr eosbExp / Cr eosbProv for the increase (reverse if decrease).
- `nitaqat(emps, cfg)` → `{saudiWeighted, total, pct, rows}`: active staff; Saudi counts 1 if qiwaDocumented !== false and wage (basic+housing+transport) ≥ 4000, 0.5 if below, 0 if not documented; non-Saudi 1 in total.
- `headcount(emps)` → by nationality, department, gender, status.

## Tests (hr.test.js) — Node is NOT installed; run in headless Edge
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom file:///... with a harness html.
Work in C:\Users\Lenovo\AppData\Local\Temp\mqhr\ (the scratchpad path is >260 chars for Windows tools), then `cp` hr.js and hr.test.js into the scratchpad folder.
Cover: EOSB worked examples from the design (3 yrs employer termination; 7 yrs resignation = 2/3; 12 yrs resignation full; Art 80 = 0), GOSI legacy/new/non-Saudi incl. cap 45,000 and floor 1,500, leave accrual crossing the 5-year mark, sick tiers across the window, payroll proration for a mid-month joiner, OT per Art 107, journal balanced, Nitaqat half-count below 4,000.
