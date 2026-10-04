# Iqama & Jawazat Control System — shared spec

Single-page web app (published claude.ai Artifact, plain HTML + vanilla JS, no build step).
Data is stored in a shared document DB as plain JSON. All dates are ISO strings "YYYY-MM-DD".
Do all date math in UTC (Date.UTC); never depend on the local timezone. Currency: SAR. Round money to 2 dp.
Modules attach to `window` as globals (UMD-style IIFE); they must also work under Node for tests
(`if (typeof module !== 'undefined') module.exports = X`).

## Data model

### settings (one object)
```js
{
  company: "Company name", crNo: "", molNo: "",
  empPrefix: "EMP-", empPad: 4,            // auto employee number => EMP-0001
  iqamaFeeYear: 650,                       // SAR / year, prorated by months (3/6/9/12)
  levyMonth: 800,                          // expat levy SAR / month (700 if Saudis >= expats; 0 for industrial-licensed from 2026-01-01)
  wpFeeYear: 100,                          // work permit fee SAR / year, prorated
  depFeeMonth: 400,                        // dependent fee SAR / month / dependent
  lateFine1: 500, lateFine2: 1000,         // late iqama renewal; 3rd = deportation risk
  lateGraceDays: 3,
  erSingleBase: 200, erSingleBaseMonths: 2, erSingleAddMonth: 100,
  erMultiBase: 500, erMultiBaseMonths: 3, erMultiAddMonth: 200,
  finalExitFee: 0, iqamaLostFee: 1000, iqamaLostFee2: 2000, iqamaDamagedFee: 300, erUnusedFine: 1000,
  reminderDays: [90, 60, 30, 15, 7, 0],    // reminder stages before expiry
  passportMinDays: 90, passportAlertDays: 180, insuranceAlertDays: 30,
  accounts: {                              // QuickBooks account names
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
    rentExp: "Rent Expense",              // JE memo/class carries the branch name
    prepaidIns: "Prepaid Medical Insurance",
    insExp: "Medical Insurance Expense",
    prepaidOther: "Prepaid Expenses - Other",
    otherPrepaidExp: "Other Expense",
    inputVat: "VAT Input (Recoverable)"
  },
  vatRate: 0.15,
  contractReminderDays: [90, 60, 30],      // before contract end (Ejar renewal)
  installmentReminderDays: [30, 14, 7, 0]  // before installment due date
}
```

### employee
```js
{ empNo:"EMP-0001", nameEn, nameAr, nationality, jobTitle, department,
  iqamaNo, iqamaExpiry:"2026-11-15",   // last known expiry (before system renewals)
  passportNo, passportExpiry, insuranceExpiry,
  dependents: 0, depPayer: "Company"|"Employee",
  levyExempt: false,                   // small-establishment exemption => levy 0 for this employee
  status: "Active"|"On Vacation"|"Final Exit"|"Huroob"|"Transferred",
  phone, email, notes }
```

### renewal (iqama renewal request, workflow request -> renewal -> payment)
```js
{ id:"REN-0001", empNo, requestDate, months: 3|6|9|12,
  oldExpiry,            // expiry being renewed (filled at request time)
  otherFees: 0, notes,
  checklist: { insurance:bool, passport:bool, traffic:bool, mudad:bool },
  hrDate, financeDate, sadadNo, paymentDate, paymentRef, completedDate,  // workflow stamps ("" if not yet)
  dependentsAtRequest, depPayerAtRequest }
```
Status derivation (first match): completedDate → "Completed"; paymentDate → "Paid";
sadadNo → "Awaiting Payment"; financeDate → "Finance Approved"; hrDate → "HR Approved"; else "Requested".

### visa (Jawazat service)
```js
{ id:"ERV-0001", empNo, requestDate,
  type: "ER Single"|"ER Multiple"|"Final Exit"|"Iqama Lost"|"Iqama Damaged",
  months, payer:"Company"|"Employee", paymentDate, issueDate, departureDate, returnDate, notes }
```
Return-before = issueDate + months (ER types only).
Visa status: returnDate→"Returned"; departureDate→ (today>returnBefore ? "Not Returned" : "Outside KSA");
issueDate→ (today>returnBefore ? "Expired Unused" (SAR erUnusedFine fine risk if not cancelled) : "Issued"); paymentDate→"Paid"; else "Requested".
Iqama Lost fee: 1st time iqamaLostFee, 2nd+ (count employee's earlier "Iqama Lost" visas) iqamaLostFee2.
Final Exit: departureDate→"Left (Final)"; issueDate→"Issued".

## Accounting rules
- Company-borne renewal fees (iqama + levy + work permit + dependents if depPayer=Company) = PREPAID, amortized
  daily over the coverage period [oldExpiry+1 .. newExpiry], newExpiry = addMonths(oldExpiry, months).
- Catch-up method: cumulative recognized at date E = paid by E ? amount * clamp((E - start + 1)/(end - start + 1), 0, 1) : 0.
  Monthly expense = cum(month end) - cum(previous month end). Split by component pro-rata.
- Dependents fee with depPayer=Employee → Employee Receivable (not expense).
- Late fines + other fees → expensed when paid. Late = paymentDate (or today if unpaid) > oldExpiry + grace.
  Offense number = count of that employee's earlier late renewals + 1. Fine = offense 1 → lateFine1, ≥2 → lateFine2; offense ≥3 → deportation warning.
- Visa fees → expensed when paid (Company) or Employee Receivable (Employee).

### contract (prepaid contract: branch rent via Ejar, medical insurance, other)
```js
{ id:"CON-0001", category:"Branch Rent"|"Medical Insurance"|"Other",
  branch:"Riyadh - Olaya", vendor:"Landlord / insurer", refNo:"Ejar or policy no",
  startDate:"2026-01-01", endDate:"2026-12-31",
  totalAmount: 120000,                     // contract value EXCLUDING VAT
  frequency:"Annual"|"Semi-annual"|"Quarterly"|"Monthly",
  vatApplicable:true,                      // 15% VAT on commercial rent if landlord VAT-registered
  installments:[ { no:1, dueDate, periodStart, periodEnd, amount, vat, paidDate:"", paymentRef:"" } ],
  notes }
```
- Installments are generated from start/end/frequency: periods split the contract evenly by months
  (Annual=12, Semi-annual=6, Quarterly=3, Monthly=1); amount = totalAmount * periodDays/contractDays
  rounded to 2 dp with the rounding remainder on the LAST installment; dueDate = periodStart by default
  (editable); vat = amount*vatRate if vatApplicable.
- Each PAID installment is its own prepaid item amortized daily over [periodStart..periodEnd] with the same
  catch-up method. Payment JE: Dr prepaid (by category) amount, Dr inputVat vat, Cr bank.
  Amortization JE: Dr expense (by category; memo = branch) / Cr prepaid.
- Reminders: unpaid installment approaching dueDate (installmentReminderDays), overdue unpaid installment,
  contract approaching endDate (contractReminderDays) with no renewal contract for the same branch+category.
