# Lease module spec (lease.js) — modeled on enterprise lease-accounting systems
(Visual Lease / LeaseQuery / CoStar style: lease register, critical dates, IFRS 16 engine, disclosures)

Vanilla JS IIFE → `window.Lease` (+ `module.exports`). No dependencies. ISO "YYYY-MM-DD" dates, UTC math only.
Money rounded to 2 dp at output (keep full precision internally, round per row so schedules tie out exactly:
the final row absorbs rounding so closing liability = 0 and ROU NBV = 0 at lease end).

## Contract fields (existing `contract` from SPEC.md plus these optional lease fields)
```js
{ id, category:"Branch Rent", branch, vendor /*landlord*/, refNo /*Ejar no*/,
  startDate, endDate, totalAmount, frequency, vatApplicable, customSchedule,
  installments:[{no,dueDate,periodStart,periodEnd,amount /*excl VAT*/,vat,paidDate,paymentRef}],
  // lease extensions
  model: "auto"|"prepaid"|"straightline"|"ifrs16",   // auto => settings.leaseStandard; leases ≤ 12 months => prepaid
  ibr: 0.065,                // incremental borrowing rate, annual (default settings.defaultIbr)
  noticeDays: 90,            // notice period before endDate to renew/terminate
  autoRenew: false,
  securityDeposit: 0,        // refundable deposit (asset, not amortized)
  initialDirectCosts: 0,     // added to ROU (IFRS 16)
  incentives: 0,             // deducted from ROU (IFRS 16)
  escalationPct: 0,          // info only (payments come from installments)
  city, district, areaSqm, propertyType: "Shop"|"Drive-thru"|"Lounge"|"Office"|"Warehouse"|"Staff housing"|"Other",
  landlordPhone, landlordIban, status: "Active"|"Terminated"|"Expired", terminationDate }
```
settings additions: `leaseStandard: "prepaid"|"straightline"|"ifrs16"` (default "prepaid"), `defaultIbr: 0.065`,
accounts: `rouAsset:"Right-of-use Assets"`, `rouAccDep:"Accumulated Depreciation - ROU"`, `leaseLiab:"Lease Liabilities"`,
`leaseInterest:"Interest Expense - Leases"`, `rouDep:"Depreciation - ROU Assets"`, `accruedRent:"Accrued Rent"`,
`prepaidRent`, `rentExp`, `inputVat`, `bank` (already exist).

## API (exact names)
- `resolveModel(contract, settings)` → "prepaid"|"straightline"|"ifrs16" (auto → settings.leaseStandard, but term ≤ 365 days → "prepaid").
- `termDays(contract)` = endDate − startDate + 1.
- `payments(contract)` → [{date: dueDate, amount, vat, paid: bool, paidDate}] sorted.
- **Straight-line (IFRS for SMEs s.20 operating lease)** `straightLine(contract, asOfISO)` →
  `{dailyExpense, expenseToDate, paidToDate, balance /* + = prepaid, − = accrued */}`; expense = total payments (excl VAT) / termDays per day, from startDate, capped at endDate.
  Paid = sum of installments with paidDate ≤ asOf.
- `straightLineMonth(contract, monthISO)` → expense recognized in that calendar month.
- **IFRS 16** `ifrs16(contract, settings)` →
  ```
  { commencement, end, ibr, pv /* PV of all lease payments excl VAT at commencement */,
    rouInitial /* pv + paymentsAtOrBeforeCommencement already in pv + initialDirectCosts − incentives */,
    months: [ { month:"YYYY-MM-01", openingLiab, interest, payments, closingLiab,
                depreciation, rouNbv } ... ]   // calendar months from commencement month to end month
  }
  ```
  PV: discount each payment by (1+ibr)^(−days/365) where days = dueDate − commencement (payments on/before commencement factor 1).
  Liability rolls DAILY-compounding-equivalent: interest for a month = liability × ((1+ibr)^(d/365) − 1) on each sub-period
  between payment dates within the month (payments reduce liability on their due date). Depreciation straight-line daily over
  [commencement, end]. Final month absorbs rounding (closingLiab = 0, rouNbv = 0).
- `liabilityAt(contract, settings, dateISO)` and `currentPortion(contract, settings, dateISO)` = liabilityAt(date) − liabilityAt(date+12 months) + interest is NOT included (use principal reduction approach: current = liability at date − liability at date+12m).
- `maturityAnalysis(contracts, settings, asOfISO)` → undiscounted UNPAID payments incl. VAT=false (excl VAT) bucketed:
  `{ "≤1y", "1–2y", "2–3y", "3–4y", "4–5y", ">5y", total }` per contract and overall (IFRS 16.58 / IFRS 7).
- `criticalDates(contract, settings, todayISO)` → [{type:"Notice deadline"|"Lease end"|"Next payment"|"Payment overdue", date, daysLeft, severity}]
  notice deadline = endDate − noticeDays.
- `leaseJournal(contracts, settings, monthISO, todayISO)` → same shape as Engine.monthlyJournal entries
  `{entries:[{jeNo,date,memo,lines:[{accountKey,account,debit,credit,memo,cls}]}], balanced}` covering ONLY contracts whose model is
  straightline or ifrs16:
  - straightline: payments in month → Dr prepaidRent (amount) Dr inputVat Cr bank; month-end → Dr rentExp (straightLineMonth)
    Cr prepaidRent — and if cumulative balance goes negative, the excess goes to accruedRent instead (handle with a single rule:
    credit prepaidRent up to its available prepaid balance, rest to accruedRent; a later payment first clears accruedRent).
  - ifrs16: commencement month → Dr rouAsset rouInitial, Cr leaseLiab pv, Cr bank (payments at commencement) / Cr prepaidRent
    (if paid before) — keep simple: Dr rouAsset / Cr leaseLiab for pv, plus IDC/incentives vs bank; payments in month →
    Dr leaseLiab amount, Dr inputVat vat, Cr bank; month-end → Dr leaseInterest / Cr leaseLiab (interest); Dr rouDep / Cr rouAccDep.
  cls = branch. jeNo like "LJE-2026-09-01".
- `portfolio(contracts, settings, todayISO)` → per contract summary rows for a lease register:
  `{id, branch, model, termMonths, remainingMonths, monthlyCost /* straight-line equivalent */, annualCost, costPerSqm,
    nextPayment:{date,amount}, overdueAmount, paidToDate, remainingPayments, liability (ifrs16 only), rouNbv (ifrs16 only),
    noticeDeadline, status}` + totals.

## Tests (lease.test.js, run in a browser harness like run-tests.html since Node is NOT installed)
Use the real-shaped contract: 20 semi-annual payments of 150,000 (excl VAT) from 2025-03-11, end 2035-03-10, ibr 6.5%.
Assert: PV < sum of payments; schedule closing liability 0 at end; sum(interest) = sum(payments) − pv (±0.05);
sum(depreciation) = rouInitial (±0.05); straight-line expense over full term = total payments (±0.05);
maturity buckets sum = unpaid total; journal balanced; currentPortion between 0 and liability.
