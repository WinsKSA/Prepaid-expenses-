# Muqeem Desk: Module Gap Report 2026

Version 1.0, 2026-10-31. Companion to `HRIS_DESIGN.md` (module benchmark, KSA rules) and `HRIS_BENCHMARK_2026.md` (attendance deep dive).

**Question.** Which modules do leading HRIS products have that Muqeem Desk lacks, and which gaps matter most to a Saudi company with about 140 staff (mostly expatriates) across several branches?

**Method.** Public material only: vendor feature pages, help centres and review listings. No sign-ups, logins or copied text. The REA (reverse-engineer-anything) skill was loaded. Its tools analyse shipped binaries, packages and captured traffic, and these products are cloud services with public docs, so its staged checklist method was applied to public sources rather than to code. "n/f" means not found in public docs, which does not prove the feature is missing.

Legend: **Yes** = built and working. **Part** = some of it exists. **No** = missing.

---

## 1. Module matrix

| # | Module | Jisr | ZenHR | Bayzat | Workday | SAP SF | Oracle HCM | BambooHR | Rippling | Factorial | Personio | **Muqeem Desk** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Recruitment / ATS | Yes [J1] | Yes (ZenATS) [Z1] | Yes [B1] | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **No** |
| 2 | Onboarding / offboarding checklists | Yes [J1] | Part (ESS tasks) | Yes [B1] | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Part**: exit and final settlement exist; no task checklist, no clearance |
| 3 | Performance reviews and goals | Yes, 360° [J1] | Yes, goal-linked [Z1] | Yes [B1] | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **No** (only probation-end reminder) |
| 4 | Training / L&D | Yes, AR/EN library [J1] | n/f | n/f | Yes | Yes | Yes | Yes (add-on) | Yes | Yes | Part | **No** |
| 5 | Documents and e-signature | Docs yes; e-sign n/f [J1] | Docs yes | Docs yes | Yes | Yes | Yes | Yes, e-sign | Yes | Yes, e-sign | Yes, e-sign | **Part**: expiry tracking for Iqama/passport/insurance; no file store, no e-sign |
| 6 | Assets / custody (عهدة) | n/f | n/f | n/f [B1] | Part | Part | Yes | Yes (asset tab) | Yes (devices) | Yes | n/f | **No** |
| 7 | Expense claims | Yes, OCR [J1] | n/f | Yes, paid via payroll [B1] | Yes | Yes | Yes | n/f | Yes | Yes | n/f | **No** |
| 8 | Approvals / workflows | Yes [J1] | Yes (MSS) [Z1] | Yes (Studio) [B1] | Yes (BPF) | Yes | Yes | Yes | Yes | Yes | Yes | **Part**: fixed approve/reject on leave and attendance corrections only |
| 9 | Org chart | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** (`org` screen) |
| 10 | Self-service requests (letters, salary certificate) | Yes [J1] | Yes (ESS) [Z1] | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Part**: HR can print 4 bilingual letters; employees cannot request them; ESS = phone check-in only |
| 11 | Shift scheduling / rostering | Yes [J1] | Yes [Z1] | Yes | Yes | Yes | Yes | No | Yes | Yes | Part | **Part**: shift templates per employee; no roster calendar (attendance session's area) |
| 12 | Overtime approvals | Yes, auto/pre-approved [J2] | Yes [Z1] | Yes | Yes | Yes | Yes | n/f | Yes | Yes | Yes | **Part**: OT hours computed and entered in payroll; no pre-approval (attendance session's area) |
| 13 | GOSI / Mudad / Qiwa / Muqeem | Integrations: GOSI, Mudad, Muqeem, SANED; Qiwa "soon" [J1] | GOSI, Mudad [Z1] | Mudad, GOSI [B1] | No | No | GOSI reports | No | No | No | No | **Part**: GOSI calculation, Mudad WPS file, Iqama/Jawazat tracking, Nitaqat estimate; no live API links |
| 14 | Reports and analytics | Yes | Yes [Z1] | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Part**: dashboards, CSV/Excel exports; no report builder, turnover or cost trends |
| 15 | Audit log | Logs | Logs | Logs | Full history | Effective-dated | Yes | Field-level | Yes | Yes | Yes | **Part**: database trigger writes `audit_log` (Supabase); no screen to read it |
| 16 | Roles and permissions | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Part**: 5 roles (admin, hr, finance, viewer, employee); no branch or manager scoping |

Global-vendor cells come from the vendors' public product pages (Workday, SAP SuccessFactors, Oracle HCM, BambooHR, Rippling, Factorial, Personio). Each lists these suites on its main product menu. KSA vendor cells cite the sources below.

What Muqeem Desk already does as well as or better than the KSA leaders: Iqama and Jawazat expiry tracking with renewal workflow, prepaid amortisation and QuickBooks journal entries, end-of-service calculations with the Art. 84/85 split, GOSI rate schedule to 2028, and GPS attendance with branch zones.

---

## 2. Gaps ranked for a ~140-staff Saudi company with several branches

Scoring: **Value** = how much HR time or legal risk it removes for this company (1–5). **Effort** = build size in this codebase (S/M/L). Modules owned by another session are marked.

| Rank | Gap | Value | Effort | Why it ranks here |
|---|---|---|---|---|
| **1** | **Employee requests and approvals inbox** (salary certificate, employment letter, NOC, exit/re-entry visa, salary advance, data or IBAN change, general request), routed manager → HR, with status the employee can see | 5 | M | The most frequent HR work in a 140-person KSA company. Every KSA leader puts it on the phone app first. It reuses the existing letters, loans and Jawazat records and turns them into self-service. |
| **2** | **Assets and custody (العهد)**: laptops, phones, vehicles, tools, SIMs, uniforms, keys; handover and return with condition; custody per employee | 5 | S | Custody clearance is required before final settlement in Saudi practice. Drivers, warehouse and field staff hold vehicles and tools across branches. No KSA vendor documents it publicly, so it is a differentiator. |
| **3** | **Onboarding and offboarding checklists** with a **clearance form (إخلاء طرف)**: Qiwa contract, GOSI registration, medical insurance, Iqama issue or transfer, Muqeem final exit or exit/re-entry, custody return, final settlement, each with an owner and due date | 5 | M | Missed steps cause government fines. Examples: an employee left off GOSI, or a final exit issued before settlement. Builds on the existing exit and settlement screen and on rank 2. |
| **4** | **Expense claims** with receipt photo, category limits, manager → finance approval, paid through payroll or petty cash, and a QuickBooks journal entry | 4 | M | Branch and field staff spend money (fuel, tools, transport). Jisr and Bayzat both pay claims through the pay run. Reuses the existing payroll inputs and journal export. |
| **5** | **Performance and probation evaluation**: probation review before day 90/180 (Art. 53), annual review with goals and ratings, manager form, employee acknowledgement | 4 | M | The probation decision is a legal deadline the app already reminds about but cannot record. An annual review supports increments and Art. 80 documentation. |
| 6 | Audit log viewer (who changed what, filter, export) | 3 | S | The data is already captured in Supabase, so this is a quick win. |
| 7 | Manager and branch scoping for roles | 3 | M | Needed once branch managers sign in. Security work that touches the database rules. |
| 8 | Documents store with e-signature (contracts, certificates) | 3 | L | Needs file storage (Supabase Storage) and a signing flow. Qiwa already signs employment contracts electronically. |
| 9 | Reports: turnover, headcount trend, payroll cost by branch, leave and end-of-service liability | 3 | M | Useful for management. Most inputs exist. |
| 10 | Training records and certificate expiry (forklift, safety, driving licence, food handling) | 2 | S | Mainly expiry tracking for certificates; a course library is overkill at 140 staff. |
| 11 | Recruitment / ATS | 2 | L | Most hires are recruited abroad through visa agencies, so an applicant pipeline adds little. Can come later. |
| — | Shift rostering, overtime pre-approval | 4 | M | **Attendance session's area.** Left to that session. |
| — | Live GOSI / Mudad / Qiwa / Muqeem APIs | 4 | L | Needs accredited access (Elm, Mudad partners) and a server. Not buildable in a browser-only app; the file exports stay. |

**Recommendation: build ranks 1–5 in that order.** Ranks 2 and 3 share data: the custody list feeds the clearance step. Rank 6 is a small add-on if time allows.

---

## 3. Legal points the new modules depend on

| Point | Rule | Status |
|---|---|---|
| Probation | Up to 90 days; may be extended or agreed up to 180 days in writing (2025 amendment); Eid holidays and sick leave excluded | Art. 53. Extension wording **[UNCERTAIN, see HRIS_DESIGN §4.1]** |
| Deductions for custody loss or damage | The employer may deduct for loss or damage the worker caused by fault, limited by the wage-deduction rules | Art. 91–92. Exact cap wording **[UNCERTAIN]**: the app shows the 50% cap as a warning only |
| Salary advance repayment | Repayment deductions count toward the deduction cap | Art. 92 **[UNCERTAIN on exact wording]** |
| Service / experience certificate | The employer must give a free service certificate on request at the end of the contract | Art. 64 |
| Final settlement timing | Pay within 1 week (employer ends) or 2 weeks (employee ends) | Art. 88 |
| Final exit before settlement | Not a law article; company control so dues and custody are settled first | Company policy |
| Exit/re-entry visa | Issued through Muqeem/Absher by the employer; the app records the request, approval and visa number only | Process, no legal figure |
| Expense receipts and VAT | Keep tax invoices for input VAT; 15% VAT | ZATCA. App stores the VAT amount; it gives no tax advice |

---

## Sources

KSA vendors
- [J1] Jisr features page (Core HR, Payroll, T&A, Compliance, Recruitment, Performance, Engagement, Learning, Employee expenses, Business travel): https://www.jisr.net/en/features
- [J2] Jisr help centre, Automatic Overtime: https://jisr.zendesk.com/hc/en-sa/articles/13534409998353
- [Z1] ZenHR modules page (Payroll, Time, ESS/MSS, Employee Management, Performance, Reporting, ZenATS): https://www.zenhr.com/en/modules
- [B1] Bayzat listings and case study (expense claims through pay run, onboarding/offboarding, performance, Mudad and GOSI): https://www.capterra.ae/software/166098/Bayzat , https://www.hr.software/reviews/bayzat , https://www.bayzat.com/ksa/case-studies/saudi-icon

Global vendors (public product menus)
- Workday HCM: https://www.workday.com/en-us/products/human-capital-management/overview.html
- SAP SuccessFactors: https://www.sap.com/products/hcm.html
- Oracle Cloud HCM: https://www.oracle.com/human-capital-management/
- BambooHR: https://www.bamboohr.com/platform/
- Rippling: https://www.rippling.com/hris
- Factorial: https://factorialhr.com/
- Personio: https://www.personio.com/product/

Law
- HRSD Labor Law text: https://www.hrsd.gov.sa/sites/default/files/2023-02/Labor.pdf
- See `HRIS_DESIGN.md` §4 and `HRIS_BENCHMARK_2026.md` §C for the article sources already collected.
