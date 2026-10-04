# rental.js — world-class lease & prepaid lifecycle engine (extends lease.js; does NOT replace it)

Benchmark: CoStar Real Estate Manager, Visual Lease, LeaseQuery, Nakisa Lease Administration, Yardi Commercial.
Vanilla JS IIFE → `window.Rental` (+ module.exports). Standalone (may call `window.Lease` if present only for ifrs16 helpers — better re-implement what you need). ISO dates, UTC math, money 2 dp, schedules tie out exactly (last row absorbs rounding).

## Domain additions on the existing contract doc (all optional, backward compatible)
```js
contract += {
  landlord: { name, crNo, vatNo, phone, email, iban, bankName, agent },
  property: { type, city, district, address, areaSqm, plotNo, deedNo, ejarNo, unitNo, activity },
  escalation: { type:"none"|"fixed_pct"|"fixed_amount"|"step"|"cpi", pct, amount, every:"year", firstOn:"YYYY-MM-DD", steps:[{from,annualRent}] },
  rentFree: [{from,to}],                    // rent-free / fit-out periods
  deposit: { amount, paidDate, refundDate, refundedAmount, status:"held"|"refunded"|"forfeited" },
  serviceCharges: [{ name, amountPerYear, vat:true, frequency }],   // non-lease components (IFRS 16.12 separate)
  options: { renewal:{ years, noticeDays, reasonablyCertain:false }, termination:{ earliest, penalty, noticeDays } },
  events: [ { id, type:"renewal"|"modification"|"termination"|"rent_review"|"note", date, by, details:{...}, newInstallments? } ],  // full audit trail
  documents: [ { name, kind:"contract"|"ejar"|"invoice"|"receipt"|"other", ref, date } ],   // metadata only
  status: "Draft"|"Active"|"Notice given"|"Renewed"|"Terminated"|"Expired"
}
```
Prepaid (non-lease) items reuse the same contract doc with category != "Branch Rent" (Medical Insurance, Software/Subscriptions, Licenses (Baladiya, Civil Defense, CR), Advertising, Maintenance contracts, Other).

## API (exact names)
- `generateSchedule(contract, opts)` → installments [{no,dueDate,periodStart,periodEnd,amount,vat}] from start/end/frequency + escalation + rentFree (rent-free days reduce that period's amount pro-rata; escalation applies to periods starting on/after each anniversary). Respect `customSchedule:true` → return existing installments untouched.
- `annualRentAt(contract, dateISO)`; `effectiveMonthlyCost(contract)` (straight-line incl. rent-free & escalation over term).
- `renew(contract, {years, newAnnualRent|pctIncrease, frequency, startDate?})` → new contract object (new id suffix "-R1"), links `renewedFrom`, original gets status "Renewed" + event.
- `modify(contract, {effectiveDate, newAnnualRent?, newEndDate?, reason}, settings)` → {contract (installments after effectiveDate regenerated), event, ifrs16Remeasurement:{liabilityBefore, liabilityAfter, rouAdjustment}} (IFRS 16.44–46: remeasure liability at revised discount rate = settings.defaultIbr unless contract.ibr; adjust ROU).
- `terminate(contract, {date, penalty, reason}, settings)` → {contract (unpaid installments after date removed, status Terminated), event, settlement:{refundDue /* prepaid beyond date */, penalty, depositRefund, gainLossOnDerecognition (ifrs16: liability − ROU NBV − penalty)}}.
- `prepaidStatus(contract, asOfISO)` → {paid, expensedToDate, prepaidBalance, accrued} using daily straight-line per paid installment (consistent with engine.js catch-up method).
- `portfolioAnalytics(contracts, asOfISO)` → { byBranch:[{branch, annualRent, monthlyCost, areaSqm, costPerSqm, remainingYears, nextPayment, overdue, depositHeld}], byCity, byCategory, waleYears /* weighted-average lease expiry by annual rent */, expiryProfile:{year: annualRentExpiring}, commitments:{next12m, y1to5, beyond5}, totalDeposits }
- `alerts(contracts, todayISO, settings)` → reminders: payment due (30/14/7/0), overdue, notice deadline for renewal/termination options (option noticeDays), lease end (180/90/60/30), rent review / escalation date (60/30), deposit refund overdue (30 days after end), Ejar registration missing for active lease, VAT invoice missing for paid installment (documents with kind "invoice" lacking for that installment no). Shape like Engine.alerts: {key, severity, category:"Lease"|"Prepaid", ref, title, message, dueDate, daysLeft, stage}.
- `depositsJournal(contracts, monthISO, settings)` → JE entries: deposit paid Dr "Security Deposits (Refundable)" Cr bank; refunded reverse; forfeited Dr "Rent Expense" Cr deposits.
- `exportRows(contracts)` → flat rows for registers (lease register, payment schedule, deposits, events log) suitable for Excel/Sheets.

## Tests (rental.test.js) in headless Edge (Node NOT installed):
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom file:///...
Work in C:\Users\Lenovo\AppData\Local\Temp\mqrent\ then `cp` rental.js + rental.test.js into the scratchpad.
Cover: 5% annual escalation over 3 years semi-annual; 3-month rent-free; step rents; renewal with +10%; mid-term modification remeasurement (liability recomputed, ROU adjusted, ties out); termination with refund of prepaid + deposit + gain/loss; WALE on 3 leases; alerts stages; deposits JE balanced; schedule sums tie exactly.
