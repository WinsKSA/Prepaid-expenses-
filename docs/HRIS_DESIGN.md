# Muqeem Desk: HRIS Module Design

Version 1.0, 2026-10-04. Audience: the engineers building Muqeem Desk (a vanilla-JS single-page app on a JSON document database with no server code).
Legend: **[UNCERTAIN]** means the sources disagree or are secondary, so confirm it with HRSD, GOSI or Qiwa before go-live. Store every legal figure as configuration (`hr_config`) and never hard-code it.

---

## 0. Starting point

The app holds 137 employees: 26 expats whose Iqama fees the company pays (`iqamaFeesBy=company`), 102 expats it does not pay for, and 9 Saudis. Existing fields: `empNo`, `hrNo`, `nameAr/En`, `gender`, `nationality`, `nationalId`, `iqamaNo/Expiry`, `passportNo/Expiry`, `insuranceExpiry`, `jobTitle`, `department`, `molFile`, `iqamaFeesBy`, `status`, `dependents`, `depPayer`, `levyExempt`. Existing modules: Iqama renewals, Jawazat, rent contracts, prepaid amortization and the QuickBooks JE export.
The HRIS module extends the existing employee doc and does not replace it. The QuickBooks JE export is reused for payroll, EOSB and leave accruals.

---

## 1. Benchmark

### 1.1 Module map

| Module | Workday HCM | SAP SF Employee Central | Oracle HCM Cloud | BambooHR | Jisr (KSA) | ZenHR (KSA/MENA) | Menaitech (KSA/MENA) |
|---|---|---|---|---|---|---|---|
| Core record | Worker + Position in Supervisory Orgs, effective-dated | Person/Employment + effective-dated **Job Information**; Foundation Objects (legal entity, dept, location) | Person → Work Relationship → Assignment; Legal Employer = PSU for KSA | Single employee profile + custom fields | Employee file with Saudi IDs | Employee file | Core HR (MenaHRMS) |
| Position mgmt | Native (positions in sup. orgs) | Position object, parent position defines manager | Positions/Jobs/Grades | No | Basic | Basic | Yes |
| Workflow | **Business Process Framework** (steps, conditions, delegations) | Workflow per event-reason | Approval rules (BPM) | Custom approval workflows | Request/approval chains | Approvals | Workflow engine |
| Leave | Absence plans and accruals | Time Off | Absence Mgmt, dual (Hijri) calendar | Accrual policies, tenure tiers | Saudi leave types | Saudi leave types | Leave + ESS |
| Payroll KSA | Partner/Cloud Pay | EC Payroll + localization | **GOSI calc cards, Employer Gratuity (EOSB) card** | No (US) | GOSI, **Mudad direct**, EOSB | GOSI, Mudad/WPS, EOSB | MenaPAY ↔ Mudad, GOSI |
| Gov integration | Nil | Nil | Reports (GOSI Form 3) | Nil | **GOSI, SANED, Muqeem, Mudad, Qiwa** | GOSI, Mudad | Mudad, GOSI, Nitaqat |
| ESS / mobile | Strong | Strong | Strong | Strong | Mobile-first ESS | ESS app | MenaME ESS (loans, leave, salary) |
| Audit | Full history per event | Effective-dated history + audit reports | Audit + history | **Field-level audit trail (who/when/old value)** | Logs | Logs | Logs |

Sources: SAP Job Information https://help.sap.com/docs/successfactors-employee-central/implementing-employee-central-core/job-information ; SAP position object https://learning.sap.com/courses/sap-successfactors-employee-central-position-management-academy/configuring-the-position-object_bf49ecbc-fe31-4909-ace8-202e8e5e5933 ; Workday BPF https://doc.workday.com/workday-education/en-us/course-manuals/hcm-core-for-administrators/business-process-framework.html and orgs https://doc.workday.com/workday-education/en-us/course-manuals/hcm-core-for-administrators/organizations-and-hierarchies.html ; Oracle KSA https://docs.oracle.com/en/cloud/saas/human-resources/21d/falzi/saudi-arabia.html , GOSI https://docs.oracle.com/en/cloud/saas/human-resources/faaas/calculate-gosi-for-saudi-arabia.html ; BambooHR https://www.bamboohr.com/platform/hr-data-and-reporting/ ; Jisr https://www.jisr.net/en/features , https://www.jisr.net/en/saudi-compliance-management ; ZenHR https://www.zenhr.com/en/modules/payroll ; Menaitech https://menaitech.com/en/products/mename/

### 1.2 What best in class looks like for each module

- **Core HR:** effective-dated records (SAP jobInfo, Workday events). Every change has an effective date and a reason code, and history is never overwritten.
- **Org/position:** position-based structure (SAP and Workday), where the manager comes from the parent position. At 137 heads a lightweight org unit with a manager field is enough. Positions come in Phase 3.
- **Workflow:** a single configurable process engine (Workday BPF) with steps, conditions, delegation and SLA.
- **Leave:** policy-driven accrual tiers by tenure (BambooHR) plus statutory types and Hijri awareness (Oracle).
- **Payroll KSA:** GOSI by nationality and regime, EOSB as an accrual card (Oracle), and direct Mudad WPS (Jisr, Menaitech).
- **Compliance:** expiry radar, Muqeem/Qiwa/GOSI sync and Nitaqat what-if (Jisr). Muqeem Desk already does the expiry part well.
- **Audit:** field-level old-to-new values with user and timestamp (BambooHR).

---

## 2. Target architecture (phased)

| # | Module | MVP (0–3 mo) | Phase 2 (3–6 mo) | Phase 3 (6–12 mo) |
|---|---|---|---|---|
| 1 | Core HR | Extend employee doc: personal, employment, org unit, branch, manager, bank IBAN, GOSI regime; effective-dated `jobHistory`/`compHistory` | Org chart, branches, cost centers | Positions and headcount budget |
| 2 | Contracts and probation | Contract record (type, start/end, probation end, notice days, Qiwa status), alerts at probation end −14d and contract end −60d | Contract templates AR/EN (PDF print) | Renewals workflow, non-compete tracking (Art. 83) |
| 3 | Compensation | Basic, housing, transport, other allowances; in-kind housing flag | Salary change workflow, bulk increments | Grades/bands |
| 4 | Leave | Types, balances, accrual engine, request/approve, Saudi rules | Calendar, Hijri display, leave settlement on return | Carry-over policies, team planner |
| 5 | Attendance | Manual absence/OT entry per month (import CSV) | Device CSV import, Ramadan hours | Geo check-in from mobile ESS |
| 6 | Payroll | Monthly run: gross-to-net, GOSI, deductions, loans/advances, Mudad CSV, JE to QuickBooks | Off-cycle runs, retro pay, payslip PDF | Bank-specific files |
| 7 | EOSB | Calculator (all reasons) and monthly accrual JE | Final settlement wizard (EOSB + leave + dues − loans) | Actuarial (IAS 19) export |
| 8 | Documents | Existing expiry tracking + contract/IBAN/certificate attachments | Doc-request ESS (salary certificate) | E-signature |
| 9 | ESS | Read-only profile, payslips, leave request (mobile web) | Loan/advance, letters, update requests | Notifications (email/WhatsApp link) |
| 10 | Workflows | Fixed 2-step chain (manager → HR) | Configurable chains per request type, delegation | SLA/escalation |
| 11 | Nitaqat | Dashboard: weighted Saudi count, %, what-if | Band thresholds by activity/size (config) | 26-week weighted trend |
| 12 | Analytics | Headcount by nationality/dept, expiries, cost | Turnover, leave liability, EOSB liability | Payroll cost trends |
| 13 | Audit log | Field-level diff on every write | Audit viewer + export | Retention/archive |
| 14 | RBAC | Roles: Admin, HR, Payroll, Manager, Employee, Auditor (read-only) | Field-level masking (salary, IBAN) | Branch scoping |

---

## 3. Data model (document DB: max 25,000 docs, max 256 KB/doc)

### 3.1 Doc budget (10-year horizon)

| Collection | Docs | Growth/yr | Notes |
|---|---|---|---|
| `employees` (existing, extended) | 137→~300 | ~20 | ~6–15 KB each with embedded history |
| `hr_config` | ~10 | 0 | rates, leave types, holidays, Nitaqat bands |
| `org_units` | ~30 | small | departments + branches |
| `contracts` | 1 per contract | ~60 | |
| `leave_ledgers` | 1 per emp-year | ~150 | embeds requests + accrual entries |
| `requests` | 1 per open request | ~1,000, archived | closed ones moved into `leave_ledgers` or `request_archive_YYYY` |
| `pay_runs` | 1 header/month | 12 | |
| `pay_lines` | chunks of ≤50 employees/run | ~36 | ~2.5 KB per employee line, ≤130 KB/chunk |
| `loans` | 1 per loan | ~40 | embedded schedule |
| `eosb_accruals` | 1/month | 12 | per-employee array |
| `attendance_months` | 1/month (chunked) | 12–36 | |
| `audit_log` | chunked buckets | ~60–150 | see 3.4 |
| **Total new docs, 10 yrs** | | | **~6,000–9,000**, well under 25k even with existing modules |

Rule: any array that grows without a limit is chunked. A doc is split when its serialized size is over 200 KB, which keeps a 20% margin. Check `JSON.stringify(doc).length` before every write.

### 3.2 Key shapes

```json
// employees/{empNo}  (existing doc + new "hr" block)
{
  "empNo": "EMP-0042", "hrNo": "...", "nameAr": "...", "nameEn": "...",
  "gender": "M", "nationality": "IN", "nationalId": null, "iqamaNo": "2xxxxxxxxx",
  "iqamaExpiry": "2027-03-01", "iqamaFeesBy": "company", "levyExempt": false,
  "status": "active",
  "hr": {
    "hireDate": "2019-06-17", "orgUnitId": "OU-OPS", "branchId": "BR-RUH",
    "managerEmpNo": "EMP-0003", "isSaudi": false,
    "gosi": { "regNo": "...", "regime": "NONSAUDI", "firstContribDate": "2019-06-17" },
    "bank": { "iban": "SA0380000000608010167519", "bankCode": "80", "holderName": "..." },
    "contractId": "CON-0042-02",
    "jobHistory": [
      { "from": "2019-06-17", "to": null, "jobTitle": "Driver", "orgUnitId": "OU-OPS",
        "reason": "HIRE", "by": "u_hr1", "at": "2019-06-17T08:00:00Z" }
    ],
    "compHistory": [
      { "from": "2025-01-01", "to": null, "basic": 4000, "housing": 1000, "housingInKind": false,
        "transport": 400, "other": [{ "code": "PHONE", "amt": 100 }],
        "reason": "INCREMENT", "by": "u_hr1", "at": "..." }
    ],
    "nitaqat": { "disabled": false, "student": false, "partTime": false, "qiwaDocumented": true }
  },
  "_v": 17, "_updatedAt": "...", "_updatedBy": "u_hr1"
}
```
Gosi `regime` ∈ `SAUDI_LEGACY` (contributor before 2024-07-03), `SAUDI_NEW` (first contribution on or after 2024-07-03), `NONSAUDI`, `GCC` (GCC nationals follow their own GCC extension rules **[UNCERTAIN]**, so set them manually).

```json
// contracts/{id}
{ "id":"CON-0042-02","empNo":"EMP-0042","type":"FIXED|INDEFINITE",
  "start":"2025-06-17","end":"2026-06-16","probationDays":90,"probationEnd":"2025-09-14",
  "noticeDaysEmployee":30,"noticeDaysEmployer":60,"qiwa":{"status":"AUTHENTICATED","ref":"..."},
  "wageAtSigning":{"basic":4000,"housing":1000,"transport":400} }

// leave_ledgers/{empNo}_{year}
{ "empNo":"EMP-0042","year":2026,
  "balances":{"ANNUAL":{"opening":6.5,"accrued":17.5,"taken":10,"encashed":0,"adjust":0},
              "SICK":{"windowStart":"2026-02-03","fullUsed":12,"t75Used":0,"unpaidUsed":0}},
  "entries":[{"d":"2026-01-31","type":"ANNUAL","kind":"ACCRUAL","days":1.75},
             {"d":"2026-04-02","type":"ANNUAL","kind":"TAKEN","days":10,"reqId":"REQ-..."}] }

// requests/{id}  (leave, loan, letter, data-change)
{ "id":"REQ-2026-0193","kind":"LEAVE","empNo":"EMP-0042","payload":{"type":"ANNUAL","from":"2026-04-02","to":"2026-04-11","days":10},
  "steps":[{"role":"MANAGER","who":"EMP-0003","status":"APPROVED","at":"..."},{"role":"HR","status":"PENDING"}],
  "status":"PENDING" }

// pay_runs/{YYYY-MM}  +  pay_lines/{YYYY-MM}_{chunk}
{ "period":"2026-10","status":"DRAFT|LOCKED|EXPORTED","gosiRatesRef":"hr_config/gosi@2026-07",
  "totals":{"gross":..., "net":..., "gosiEe":..., "gosiEr":...},"chunks":3 }
{ "period":"2026-10","chunk":1,"lines":[{ "empNo":"EMP-0042","days":30,
   "earn":{"basic":4000,"housing":1000,"transport":400,"ot":0,"other":100},
   "ded":{"gosiEe":0,"loan":500,"absence":0,"sickUnpaid":0},
   "gosiEr":100,"gross":5500,"net":5000,"iban":"SA03..." }]}

// audit_log/{YYYY-MM}_{n}
{ "bucket":"2026-10_1","entries":[
  {"ts":"...","user":"u_hr1","coll":"employees","id":"EMP-0042","op":"update",
   "diff":{"hr.compHistory[+]":[null,{"from":"2026-10-01","basic":4400}]},"reason":"INCREMENT"}]}
```

### 3.3 Effective dating

- Current values = the row in `jobHistory`/`compHistory` with `from ≤ asOf` and (`to` null or `to ≥ asOf`). Write the `getAsOf(emp, date)` helper once and use it in payroll, EOSB and Nitaqat.
- For a future-dated change, insert a row with a future `from` and close the previous row at `from − 1`. Never edit a past row. Corrections are new rows with `reason:"CORRECTION"`.

### 3.4 Audit history (no server)

1. Route every write through one `dbWrite(coll, id, newDoc, reason)` wrapper. The wrapper reads the current doc, computes a shallow and deep diff, checks `_v` (optimistic lock, rejecting a write when the version changed) and writes the doc with `_v+1`. It then appends a diff entry to the current `audit_log/{YYYY-MM}_{n}` bucket and rolls to `n+1` when the bucket is over 200 KB.
2. Mask IBAN and salary values in the diff for non-Payroll viewers (the audit viewer masks them; the stored values remain).
3. **Risk:** with no server, a client can skip the wrapper. Use the DB's per-collection access rules if it has them, for example append-only `audit_log` and payroll restricted to Payroll roles. If it has none, treat the audit log as best-effort and say so (see §6).

---

## 4. Calculation rules

Primary statute: Labor Law (Royal Decree M/51), official HRSD English text: https://www.hrsd.gov.sa/sites/default/files/2023-02/Labor.pdf (pre-2025 consolidated text). 2025 amendments (Royal Decree M/44, effective **18 or 19 Feb 2025 [UNCERTAIN, sources differ by one day]**): https://english.alarabiya.net/News/saudi-arabia/2025/02/21/saudi-arabia-amends-labor-law-extends-maternity-leave , https://www.middleeastbriefing.com/news/saudi-arabia-labor-law-amendments-preparing-for-compliance/ , https://blog.zenhr.com/en/saudi-labor-law-updates-2025

**Definitions used below:**
`W` = monthly "actual wage" = basic + housing + transport + fixed allowances (Labor Law Art. 2 definition, used for EOSB per Art. 84 "last wage"). Commissions may be excluded by agreement (Art. 86). **[UNCERTAIN in practice:** some employers compute EOSB on basic + housing only. Make the components configurable, default to all fixed allowances.]
`dayRate = W / 30`. Using a 30-day month is the KSA payroll convention **[UNCERTAIN, configurable]**.

### 4.1 Key statutory parameters (stored in `hr_config`)

| Parameter | Value | Source |
|---|---|---|
| Probation | up to 90 days, extendable in writing to max 180 (pre-2025 text); post-2025: may be agreed up to 180 days directly; excludes Eid holidays and sick leave | Art. 53, HRSD PDF; amendment: https://blog.zenhr.com/en/saudi-labor-law-updates-2025 |
| Notice (indefinite) | Employee resigns: **30 days**; employer terminates: **60 days** (2025) | Art. 75 amended, https://www.middleeastbriefing.com/news/saudi-arabia-labor-law-amendments-preparing-for-compliance/ |
| Resignation acceptance | Employer responds within 30 days, else deemed accepted; may defer up to 60 days in writing (2025) | Art. 79 amended, https://blog.zenhr.com/en/saudi-labor-law-updates-2025 |
| Non-Saudi contract | Fixed-term; if no term is stated, deemed 1 year | Art. 37 amended (same source) |
| Unfair termination compensation | Indefinite: 15 days' wage per year; fixed: remaining term wages; min 2 months' wage | Art. 77, HRSD PDF |
| Hours | 8 h/day or 48 h/week; Ramadan (Muslims) 6 h/day or 36 h/week | Art. 98, https://www.hrsd.gov.sa/en/knowledge-centre/articles/312 . **[UNCERTAIN: the 2023 HRSD English PDF reads 9 h/45 h and Ramadan 7 h/35 h. Keep this configurable and confirm.]** |
| Max at workplace | 12 h/day; break ≥30 min after 5 h | Art. 101 |
| Overtime | hourly wage + 50% of basic hourly wage; holiday/Eid hours = OT; paid time off in lieu allowed with consent (2025) | Art. 107; amendment per Middle East Briefing |
| Annual leave | 21 days; 30 days after 5 consecutive years; notify ≥30 days ahead; no cash in lieu during service | Art. 109 |
| Leave on exit | pay for accrued unused days, pro-rata for part-year | Art. 111 |
| Sick leave | 30 days full, next 60 days at 75%, next 30 days unpaid, per year starting from the first sick day | Art. 117 |
| Marriage / death of spouse, ascendant or descendant | 5 days full pay | Art. 113 |
| Paternity | 3 days (2025: within 7 days of birth **[UNCERTAIN on the 7-day window]**) | Art. 113, https://www.saudihr.ai/en/blog/maternity-paternity-leave-2026 |
| Sibling death | 3 days full pay (new in 2025) | Art. 113 amended |
| Hajj | 10–15 days incl. Eid al-Adha, once, after 2 consecutive years | Art. 114 |
| Unpaid leave | by agreement; contract suspended beyond 20 days (exclude from service/accrual) | Art. 116 |
| Maternity | **12 weeks full pay** (2025, was 10); 6 weeks mandatory post-birth; may start 4 weeks before due date; +1 month full pay if child has special needs; optional unpaid extensions | Art. 151 amended |
| Iddah (Muslim widow) | ≥4 months 10 days full pay **[verify the non-Muslim variant, 15 days]** | Art. 160, https://www.skuad.io/leave-policy/saudi-arabia |
| Final pay deadline | 1 week (employer ends contract) / 2 weeks (employee ends contract) | Art. 88 |

### 4.2 End-of-Service Benefit (Art. 84, 85, 87, 80, 81)

```
Y      = service days / 365   (exclude unpaid leave >20 days, Art.116)
FULL   = W × [ 0.5 × min(Y,5) + 1.0 × max(Y−5,0) ]               // Art.84
factor by reason:
  EMPLOYER_TERMINATION (not Art.80), CONTRACT_EXPIRY,
  MUTUAL (if agreed full), DEATH, DISABILITY, FORCE_MAJEURE (Art.87),
  EMPLOYEE_LEAVES_UNDER_ART81, FEMALE_WITHIN_6M_MARRIAGE / 3M_BIRTH (Art.87) → 1
  RESIGNATION (Art.85):  Y<2 → 0 ; 2≤Y≤5 → 1/3 ; 5<Y<10 → 2/3 ; Y≥10 → 1
  DISMISSAL_ART80 → 0
EOSB = FULL × factor
```
Note that Art. 85 is explicit about "consecutive" years. Death and disability being full is market practice under force majeure **[UNCERTAIN, confirm with counsel]**.

**Worked example:** W = 10,000 (basic 7,000 + housing 2,500 + transport 500). Hire 2019-06-01, exit 2026-09-30 → 2,678 days → Y = 7.337.
- FULL = 10,000 × (0.5×5 + 2.337) = 10,000 × 4.837 = **48,370**
- Resignation (5<Y<10): 48,370 × 2/3 = **32,247**
- Same person resigning at Y = 3.0: FULL = 15,000 → ×1/3 = **5,000**. At Y = 1.9: **0**.
- Female resigning within 6 months of marriage, Y = 3: **15,000** (Art. 87).
- Art. 80 dismissal: **0**.

**Monthly accrual (for the JE):** `provision_m = FULL(Y at month end, W current) − provision_{m−1}` (full-award basis, which is conservative). JE: Dr EOSB Expense / Cr EOSB Provision. At settlement: Dr EOSB Provision (FULL) / Cr Final Settlement Payable (EOSB) / Cr EOSB Expense (reversal of the unpaid fraction).

### 4.3 Annual leave accrual and encashment

```
entitlement/yr = 21, or 30 once tenure ≥ 5 consecutive years (Art.109)
monthly accrual = entitlement/12  → 1.75 or 2.5 days
first-month accrual pro-rated: × (days employed in month / days in month)
months of unpaid leave >20 days: no accrual
encashment (exit only, Art.109/111) = unused days × W/30
```
Example: W = 10,000, tenure 3 yrs, balance 12.5 days at exit → 12.5 × 333.33 = **4,166.67**.
Example tier change: hire 2021-10-15, so 30-day entitlement from 2026-10-15. The October 2026 accrual = 1.75×14/31 + 2.5×17/31 = 0.790 + 1.371 = **2.16 days**.
Leave-liability JE (monthly, Phase 2): Dr Leave Expense / Cr Accrued Leave = Δ(balance × dayRate).
Whether `W` for leave pay includes all allowances: the statute says "wage" and the common practice is basic + housing + transport **[UNCERTAIN, configurable]**.

### 4.4 Sick leave tiers (Art. 117)

The window is the 365 days counted from the first sick day of the cycle. Days are consumed in order: 30 at 100%, 60 at 75%, 30 at 0%.
```
deduction = days_in_75_tier × dayRate × 0.25 + days_in_0_tier × dayRate
```
Example: W = 9,000 (dayRate 300). Cycle so far 25 days. A new 20-day certificate takes 5 days at 100% and 15 days at 75%. Deduction = 15 × 300 × 0.25 = **1,125**.

### 4.5 GOSI

| Group | Employee | Employer | Composition |
|---|---|---|---|
| Saudi, legacy (contributor before 2024-07-03) | 9.75% | 11.75% | annuity 9/9, SANED 0.75/0.75, hazards 0/2 |
| Saudi, new entrant: Jul-2024–Jun-2025 | 9.75% | 11.75% | annuity 9/9 |
| Jul-2025–Jun-2026 | 10.25% | 12.25% | annuity 9.5/9.5 |
| **Jul-2026–Jun-2027 (current)** | **10.75%** | **12.75%** | annuity 10/10 |
| Jul-2027–Jun-2028 | 11.25% | 13.25% | annuity 10.5/10.5 |
| Jul-2028 onward | 11.75% | 13.75% | annuity 11/11 |
| Non-Saudi | 0% | 2% | occupational hazards only |

Base = basic + housing (cash, or in kind), floor **SAR 1,500** for Saudis, cap **SAR 45,000**. Use the base registered with GOSI, not the payslip; GOSI bills on the registered wage. Housing in kind is commonly valued at 2 months' basic per year (basic × 2/12) **[UNCERTAIN, verify on GOSI]**.
Sources: PwC https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes ; new-entrant schedule https://zenhrsolutions.freshdesk.com/en/support/solutions/articles/43000760572-mandatory-gosi-update-new-contribution-rates-effective-july-2025 , https://www.silberson.com/2025/09/saudi-social-insurance-law-2025/ , https://mercans.com/resources/statutory-alerts/saudi-arabia-new-social-security-law-3-july-2025/ ; floor/cap https://docs.oracle.com/en/cloud/saas/human-resources/faaas/calculate-gosi-for-saudi-arabia.html ; GOSI FAQ https://www.gosi.gov.sa/GOSIOnline/FAQ_Employer?locale=en_US

```
rateRow = hr_config.gosi.find(regime, payPeriodStart)   // dated table
base    = clamp(basic + housing, isSaudi ? 1500 : 0, 45000)
ee = round2(base × rateRow.ee) ; er = round2(base × rateRow.er)
```
Examples (Oct-2026 payroll):
- Saudi legacy, basic 8,000 + housing 2,000 → base 10,000: EE **975**, ER **1,175**.
- Saudi new entrant (first job Aug-2024), same wage: EE **1,075**, ER **1,275**.
- Expat, basic 4,000 + housing 1,000: EE **0**, ER **100**.
- Saudi, basic 40,000 + housing 10,000 → base capped at 45,000: EE (legacy) **4,387.50**.

For the 9 Saudis, the HR user must set `regime`. Default to `SAUDI_LEGACY` only if the employee has a GOSI history from before 2024-07-03.

### 4.6 Overtime (Art. 107)

```
hourlyActual = W / (30 × 8) ; hourlyBasic = basic / (30 × 8)
otRate = hourlyActual + 0.5 × hourlyBasic
```
Example: basic 6,000, W 8,000 → hourlyActual 33.33, hourlyBasic 25. otRate = 33.33 + 12.50 = **45.83**/h. 10 h → **458.33**.
Many systems simplify this to 1.5 × basic hourly (= 37.50). The statute's wording gives the formula above **[UNCERTAIN in practice; implement the statutory formula as the default and offer the simplified one as a policy option]**. The 240-hour divisor assumes 8 h × 30 days, so it changes if the working-hours setting changes.

### 4.7 Pro-rating (joiners and leavers)

```
mode "30DAY" (default): paidDays = 30 − (startDay − 1), with startDay 31 → 1 day; leavers paidDays = min(endDay,30)
mode "CALENDAR": paidDays = days worked / days in month
pay_component = monthly × paidDays / (30 | daysInMonth)
```
Example: W 9,000, joins 18 Oct 2026. 30-day mode: 13/30 × 9,000 = **3,900**. Calendar mode: 14/31 × 9,000 = **4,064.52**. GOSI on joiners uses the full registered monthly base for the month of registration **[UNCERTAIN; reconcile with the GOSI invoice]**.

### 4.8 Gross-to-net and the payroll JE

```
gross = Σ prorated(basic, housing, transport, other) + OT + adjustments
net   = gross − gosiEe − loanInstalment − absence − sickDeduction − otherDed
guard: total deductions ≤ 50% of wage unless the employee consented (Art.92/93-style limit) [UNCERTAIN on exact cap; warn only]
```
Loans/advances: `loans/{id}` holds the principal and the instalment schedule. Payroll consumes the next due instalment, and the instalment can be deferred by HR.
QuickBooks JE (one per run, by department class):
Dr Salaries-Basic, Dr Housing Allowance, Dr Transport, Dr Overtime, Dr GOSI Employer Expense
Cr GOSI Payable (EE+ER), Cr Employee Loans Receivable, Cr Salaries Payable (net).
After the bank transfer: Dr Salaries Payable / Cr Bank. Reuse the existing JE export's account mapping table.

### 4.9 Mudad / WPS export

The upload carries one row per GOSI-registered employee, including those with zero net pay. Columns: ID number (Iqama for expats, National ID for Saudis), name, IBAN, basic, housing, transport, other allowances, deductions, net, payment date. Format rules: CSV UTF-8 (XML is also accepted), period as decimal separator, dates as `YYYY-MM-DD`, ASCII file names. Components must match the Qiwa contract.
Validation: `^SA\d{22}$` plus an ISO 13616 mod-97 check. Map the bank code (IBAN chars 5–6) to a bank. Warn when the account holder name differs from the employee name.
Sources: https://hr360s.com/en/upload-the-wage-protection-file/ (secondary). **[UNCERTAIN: the exact Mudad column order changes. Download the current template from the Mudad portal and drive the export from a column-mapping config.]** Deadlines and compliance bands (paid within 0–10 days of month end = compliant) are from secondary sources **[UNCERTAIN]**.

### 4.10 Nitaqat (Saudization) basics

```
saudiWeighted = Σ w(e) over Saudis with qiwaDocumented=true (from 15-Apr-2026)
  w = 1 if wage ≥ 4,000 ; 0.5 if 3,000 ≤ wage < 4,000 ; 0 below
  disabled (with certificate, wage ≥4,000) = 4 (capped 10% of headcount)
  student / part-time = 0.5 (caps apply)
ratio = saudiWeighted / (saudiWeighted + expatCount) ; band via hr_config.nitaqat[activity][sizeBand]
```
The official figure is a 26-week weighted average, so the dashboard shows the snapshot plus a trend and labels the result "estimate". Current data: 9 Saudis of 137 ≈ 6.6% before weighting. Sources: https://mercans.com/glossary/saudization-nitaqat/ , https://www.middleeastbriefing.com/news/saudi-arabias-nitaqat-2026-update-latest-quotas-by-sector-and-what-foreign-employers-need-to-comply-now/ , Qiwa explainer https://www.qiwa.sa/en/business-owners/manage-establishment/what-nitaqat-and-how-it-calculated . **[UNCERTAIN: band thresholds are activity-specific. Load them from the company's Qiwa Nitaqat page, never from guesswork.]**

---

## 5. Screens and UX (bilingual AR/EN, RTL)

Global: `dir="rtl"` toggled on `<html>`. Use CSS logical properties (`margin-inline-start`) throughout. Use `Intl.NumberFormat('ar-SA'|'en-SA')` with a user choice of Western or Arabic-Indic digits; keep Western digits in exports. Show a Hijri date beside the Gregorian one via `Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura')`. Store all dates as ISO Gregorian. Every label lives in an `i18n` dictionary keyed by an ID, and names are shown in the UI language (`nameAr`/`nameEn`).

| Screen | Desktop key components | Mobile |
|---|---|---|
| HR Home | KPI tiles (headcount by Saudi/company-paid/self-paid expats, expiring docs 30/60/90, probation ending, pending approvals), Nitaqat gauge | Same tiles stacked; approvals first |
| Employee List | Filter by dept/branch/nationality/status/iqamaFeesBy, column chooser, bulk actions, CSV export | Search + cards |
| Employee Profile | Tabs: Personal, Employment (timeline of jobHistory), Compensation (history, masked by role), Contract, Leave, Documents, Payroll, Audit | Collapsible sections |
| Contract Editor | Type, dates, probation calc (excluding Eids), notice days, Qiwa status, print AR/EN | View only |
| Org & Branches | Tree, manager assignment, headcount | Read-only list |
| Leave Center | Request form with live balance and working-day count (excludes Fri/Sat + holidays), team calendar, approval inbox | ESS request + balance card |
| Leave Policies (admin) | Types, accrual tiers, eligibility (gender, tenure, once-only Hajj), pay % tiers | n/a |
| Attendance Month | Grid emp × day (absence, OT hours), CSV import, Ramadan toggle | n/a |
| Payroll Run | Wizard: select period → pull inputs → preview lines (diff vs last month highlights) → lock → Mudad CSV → QuickBooks JE → payslips | Approver: summary + approve |
| Loans | Schedule, deferrals | ESS request |
| EOSB Calculator / Final Settlement | Reason dropdown, dates, wage components, breakdown (EOSB, leave encashment, notice pay, loans), printable settlement AR/EN | View result |
| Nitaqat Dashboard | Weighted count, ratio, band, what-if (hire N Saudis at wage X), list of Saudis not Qiwa-documented or under 4,000 | Gauge |
| Analytics | Headcount trend, turnover, payroll cost by dept, EOSB/leave liability | Key charts |
| Audit Log | Filter by user/entity/date, field diff view, export | n/a |
| Settings: Roles & Config | Role matrix, `hr_config` editors with effective dates (GOSI rates, holidays) | n/a |
| ESS Home | Profile, payslips, leave balance, requests, documents expiring | Primary target (≥360px) |

---

## 6. Risks and compliance checklist

**Architecture and security**
- [ ] **No server = no trusted enforcement.** RBAC, approvals and audit run in the browser. Confirm that the JSON DB supports per-collection or per-role rules. If it does not, keep payroll and salary data restricted to HR/Payroll users and do not expose ESS to all 137 employees until the rules exist. This is the top risk.
- [ ] PDPL (Saudi Personal Data Protection Law): minimize stored PII, mask IBAN/ID/salary by role, keep a record of processing **[confirm hosting/data-residency obligations]**.
- [ ] Optimistic locking (`_v`) on every write. Lock a pay run after approval; corrections go through an off-cycle run.
- [ ] Doc size guard (>200 KB → chunk) and doc-count monitor (alert at 20k).
- [ ] Money: integer halalas internally and round only at line totals.

**Legal and statutory**
- [ ] All rates and days in dated `hr_config` rows, with a change history kept in the audit log.
- [ ] GOSI regime set correctly for each of the 9 Saudis. Rates switch automatically each July through 2028.
- [ ] Employees under the 2025 rules: maternity 12 weeks, paternity 3, sibling death 3, notice 30/60. Apply these to leave and contract defaults.
- [ ] Probation end excludes Eid holidays and sick leave (Art. 53); a second probation needs written consent and a different job (Art. 54).
- [ ] No annual-leave encashment during employment (Art. 109); encash only on exit.
- [ ] Unpaid leave over 20 days suspends the contract, so exclude it from service and accrual.
- [ ] Final settlement paid within 1 or 2 weeks (Art. 88). The settlement screen shows the due date.
- [ ] Mudad: wages paid to the employee's own IBAN; components equal the Qiwa contract; file within the deadline; zero-net employees included.
- [ ] Nitaqat: from 15 Apr 2026 Saudis count only with a Qiwa-documented contract. Saudis paid under SAR 4,000 count as 0.5.
- [ ] Qiwa contract for every employee; changes to wage components need contract updates in Qiwa first.
- [ ] Muqeem/Absher touchpoints (Iqama renewal, exit/re-entry, final exit) remain manual or semi-manual. Record the reference numbers in Muqeem Desk; Muqeem services are offered by Elm (https://www.elm.sa/en/e-services/pages/muqeem.aspx). A final-exit request must be blocked until the final settlement is approved.
- [ ] Items marked [UNCERTAIN] signed off by a Saudi labour lawyer or accountant before payroll go-live; run payroll in parallel for 2 months.
