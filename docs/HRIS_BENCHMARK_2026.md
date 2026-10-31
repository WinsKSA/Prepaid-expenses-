# Muqeem Desk: HRIS Benchmark 2026 (Attendance focus)

Version 1.0, 2026-10-31. Companion to `docs/HRIS_DESIGN.md` (section 1 = module benchmark, section 4 = KSA calculation rules). This file adds what those sections lack: location-based attendance, attendance policies, the attendance-related labour-law rules, and a ranked build list.

**Method.** Only public material: vendor help centers, product pages, official docs and government pages. No sign-ups, no logins, no copied code or text; everything is summarized in our own words. The REA (reverse-engineer-anything) skill was loaded, but its analysis server was not connected in this session, and every question here was answerable from public documentation, so no app front-end was decompiled. Evidence came from web search, page fetches, and the public Zendesk help-center search APIs of Jisr and Bayzat, read in a browser.

**Legend.** **[UNCERTAIN]** = sources disagree, are secondary, or the official text could not be opened. Confirm with HRSD or counsel before relying on it. **n/f** = not found in public docs, which does not prove the feature is missing.

---

## A. Location attendance: feature comparison

| Capability | Jisr (KSA) | ZenHR (KSA/MENA) | Bayzat (UAE/KSA) | Menaitech MenaTA | Workday | SAP SF Time Tracking | Oracle HCM | Factorial | Rippling | BambooHR |
|---|---|---|---|---|---|---|---|---|---|---|
| Zone shape / radius | Circle drawn on a map per work location [1] | Geolocation with multiple work sites; radius n/f [10] | Radius per office, example "within 100 m" [20] | GPS + Google/Apple maps; radius n/f [30] | Radius per geofence, recommends >100 m [40] | Circular **or polygon** geofences, radius in metres [42][43] | Radius in metres, default example 100 [45] | 50 m / 100 m / 500 m / 1 km per workplace [48] | "GPS radius" [49] | Records location only, no geofence (Timeero add-on) [50] |
| Several sites per employee | Yes: "location groups" assigned to employees; can **split allowed clock-in vs clock-out sites** [2] | Multiple work sites [10] | Default office + "additional check-in/out offices" per employee [21] | n/f | Several geofences per time-entry template [40] | Geofences assigned via Clock In Clock Out groups [43] | Several geofences per work location [45] | Several workplaces [48] | n/f | n/a |
| Assigned-branch vs any-branch vs anywhere | 5 policies: per **scheduled shift's location**, any org location, anywhere, **not allowed to punch**, custom group; plus a default policy [3] | Some companies restrict clock-in to office [11] | Office-only, multiple offices, or "out-of-office" allowed per work timing [21][22] | n/f | Optional: geofence by scheduled shift location [40] | Can only record inside boundary when enabled [43] | Assigned work location's geofences [46] | Per workplace [48] | n/f | n/a |
| Outside-zone behaviour | Punch shown with **"Out of range"** label + map [4] | n/f | Out-of-office punches flagged with "Outside office" pin [22] | n/f | **Block** with error + map [40] | Block [43] | Admin chooses **Restrict** or **Record and report** (manager emailed, event saved with exception) [45][46] | Admin chooses **block** or **alert** (email + weekly summary, timesheet in/out flag) [48] | n/f | n/a |
| Fake-GPS / mock detection | n/f | n/f | n/f (relies on face + liveness) [23] | n/f | n/f | n/f | n/f | n/f | n/f | n/f |
| Face / selfie | n/f | Device biometrics (Face ID / fingerprint / passcode) handled by the phone OS, no biometric data stored [12] | **Face match** against reference photo (passport photo by default), retry limit (default 3), fallback "photo only" or "block", confidence + both photos in reports [23]; liveness claimed on product page [24] | n/f | n/f | n/f | n/f | n/f | n/f | n/f |
| Device binding (anti buddy-punch) | **One approved phone per employee**; new phone needs manager-approved linking request [5] | n/f | n/f | n/f | n/f | n/f | n/f | n/f | n/f | n/f |
| Wi-Fi / QR | n/f | Wi-Fi restrictions mentioned [12]; QR punch via phone camera [10] | n/f | n/f | n/f | n/f | n/f | QR "Entrance app" (cannot be combined with geolocation) [48] | n/f | n/f |
| Kiosk | n/f | n/f | **Kiosk mode** on phone/tablet with image capture, for staff without phones [25] | n/f | n/f | n/f | Mobile-only checkbox [45] | n/f | n/f | n/f |
| Field staff / visits | "Anywhere" policy for sales/remote [3] | Auto clock-in by geofence [11] | **Multiple visits**: start/end visit at client sites, employees may add a location, visit reports [26] | "On-the-go" GPS [30] | n/f | n/f | n/f | n/f | n/f | n/f |
| Biometric devices | ZKTeco via BioTime, own "Jisr Clocking" device, punch shows serial + method (fingerprint/PIN/card) [6][4] | ZKTeco via BioTime 8.5 cloud; match on branch↔Area and Card ID; history pull 1–3 months; **failed-events viewer with retry** [13] | Biometric IDs per employee [27] | Device integration (MenaTA) [30] | n/f | n/f | Time collection device integration [47] | n/f | n/f | n/f |
| Location privacy | Map of each punch [4] | Location shown to employee to confirm [11] | Map per punch [22] | n/f | **Location not stored** in history report [40] | n/f | n/f | Coordinates captured only at punch moments; employee must accept geolocation policy [48] | n/f | n/a |
| Known mobile pitfalls | Android battery optimisation kills geofence (Samsung, Huawei) [7] | Weak GPS causes discrepancies [11] | "Increase the radius" if staff can't check in [22] | n/f | Accuracy depends on device/OS [40] | Android boundary display bug (KBA 3793475) [44] | n/f | Enable precise location [48] | n/f | n/a |

**Platform facts that matter for Muqeem Desk (web SPA, not a native app):**
- Native Android exposes `Location.isMock()` (API 31+; older `isFromMockProvider()` from API 18) and iOS 15+ exposes `CLLocationSourceInformation.isSimulatedBySoftware`. [60][61] **The browser Geolocation API has no mock flag**; it gives only coordinates, `accuracy` in metres, and a timestamp. [62] So a web app cannot detect fake GPS directly. It must rely on server-side signals: accuracy, impossible travel, a repeated identical fix, a stale timestamp, device binding and a selfie.
- None of the KSA vendors documents mock-location detection publicly. Bayzat answers spoofing with face match. Jisr answers it with device binding and an out-of-range label. [5][23]
- **Ranking evidence:** no neutral G2/Capterra/Gartner KSA grid was found. The 2026 "best KSA HR software" lists are written by the vendors themselves (Bayzat, ZenHR) or by competitors. [70][71] Treat them as marketing.

---

## B. Top 15 features and rules to add or verify (ranked)

| # | Feature / rule | Why | Source |
|---|---|---|---|
| 1 | **Punch-location policy per employee with 5 modes:** assigned branch (from shift), any company branch, named branch group, anywhere (field/sales), not allowed. Plus a company default. | Jisr's model covers every case we have (multi-branch staff, supervisors moving between sites, drivers, staff under discipline) with one setting. | [3][2] |
| 2 | **Outside-zone mode per policy: Block or Record-and-flag**, where flag = save the punch with an exception, notify the manager, and put it in the exceptions queue. | Oracle and Factorial both offer this choice. Blocking alone loses the record when GPS drifts; flagging alone is weak against abuse. | [45][46][48] |
| 3 | **Server-side distance check using the reported `accuracy`:** reject or flag when `accuracy` > threshold (config, e.g. 100 m), and treat as inside only if `distance − accuracy ≤ radius`. Default radius ≥100 m; allowed range 50 m–1 km. | Workday recommends >100 m; Factorial's presets run from 50 m to 1 km; GPS error is device-dependent. The browser gives `accuracy`, so use it. | [40][48][62] |
| 4 | **Fake-GPS heuristics (web-safe):** impossible travel between consecutive punches; identical lat/lng to many decimals on repeated punches; `accuracy` exactly 0 or suspiciously round; timestamp skew vs server time. Store a `suspicion` score and never auto-reject on it alone. | A web app has no mock flag. These are the only signals the browser gives. | [60][61][62] |
| 5 | **Device binding:** first device fingerprint becomes the employee's device; a new device needs a manager-approved request. | Jisr's main anti-buddy-punch control, cheap to build in a web app (store a random device ID in localStorage plus user-agent). | [5] |
| 6 | **Selfie at punch, with fallback rules:** capture photo; optional face match later; retry limit (3); on failure choose "photo only" or "block"; show reference + captured photo in reports. | Bayzat's design. Start with photo-only (no ML), which already deters proxy punches. Mind PDPL: biometric data is sensitive. | [23][24] |
| 7 | **Clocking windows per shift:** earliest clock-in (e.g. 60 min before), grace "allowed delay" (e.g. 15 min), latest clock-in (else incomplete), earliest/latest clock-out, allowed early-leave shortage, optional "clock-out not required". | Jisr's rules define exactly when a punch counts, and they drive late, early and incomplete statuses. | [8][9] |
| 8 | **Penalty ladder by tier × occurrence, with a 180-day reset** (the MHRSD table in section C2): written warning → % of daily wage → days, with a "caused disruption to others" toggle chosen by the manager. | KSA law requires the ladder to come from approved work regulations. Bayzat implements up to 4 levels × 4 occurrences with a "work disruption" flag and a refresh window. | [52][53][26b] |
| 9 | **Deduction guards:** a fine ≤ 5 days' wage per violation and ≤ 5 days' wage per month; one penalty per violation; total deductions ≤ 50% of wage; penalty no later than 30 days after discovery. Block at payroll, don't just warn. | Arts. 66–72 and 92; these hard limits protect the employer in disputes. | [51][14] |
| 10 | **Excuse / permission requests** (late-in, early-out, mid-day, full day) with monthly count/hours caps, and **punch-correction requests** with a monthly limit and submission window (e.g. 3 days). | Jisr and Bayzat both cap corrections. Without caps, corrections become a backdoor. | [9b][9c][28] |
| 11 | **Overtime: pre-approval or auto-OT with a max per shift**, the statutory formula (hourly actual + 50% basic), a **TOIL option** (time off in lieu with consent), and holiday/rest-day hours counted as OT. | Art. 107 + 2025 TOIL. Jisr offers auto-OT "after required hours" or "after shift end" with a cap. | [56][9d][9e] |
| 12 | **Ramadan hours auto-applied to Muslim employees only** (from a religion field) with dated Ramadan periods in config; 6 h/day or 36 h/week. | Art. 98. ZenHR applies it from the Religion field. | [55][15] |
| 13 | **Art. 80 absence counters:** consecutive and intermittent unexcused absence per contract year, with automatic **warning tasks at day 10 (consecutive) and day 20 (intermittent)** before the 15/30 thresholds. | Dismissal under Art. 80 is invalid without the prior written warning; the table places the warnings at 10 and 20 days. | [53][52] |
| 14 | **Device import robustness:** map device user ID ↔ employee and device area ↔ branch; import history by date range; a **failed-rows viewer with retry**; show source (device serial / method, mobile + OS, manual by whom, sheet by whom) on every punch. | ZenHR and Jisr make the punch source auditable, which matters in disputes. | [13][4] |
| 15 | **Field-visit punches:** start/end visit at client sites, employee can add the current location, visit report (count, time per site). | Bayzat's model for drivers and field staff, who would otherwise all need "anywhere" mode. | [26] |

Also verify (already in the build plan): payroll cut-off day for attendance [9f]; Android battery-optimisation help text for staff [7]; weekly rest (Art. 104) default Friday, configurable [54].

---

## C. KSA legal rules for attendance and payroll

### C1. Labour Law articles

| Topic | Rule and figures | Article | Source | Status |
|---|---|---|---|---|
| Daily / weekly hours | Max 8 h/day (daily basis) or 48 h/week (weekly basis) | 98 | HRSD Knowledge Centre [55]; Jisr quoting Art. 98 [9d] | Confirmed (HRSD) |
| Ramadan | Muslims: max **6 h/day or 36 h/week** | 98 | [55][15] | Confirmed (HRSD). Some secondary sites say 7 h/35 h [57]; HRSD_DESIGN §4.1 flagged a 9/45 vs 7/35 reading in the 2023 PDF. **Keep configurable.** |
| Hour variations | Up to 9 h/day for some categories; down to 7 h for hazardous work (ministerial decision) | 99 | [55] | Confirmed (HRSD) |
| Shift averaging | Rotating shifts: averages over ≤3 weeks must stay within 8 h/day and 48 h/week, with ministry approval | 100 | [55] | Confirmed (HRSD) |
| Breaks | No more than 5 consecutive hours without a break of ≥30 min for rest, prayer and meals; max 12 h/day at the workplace including breaks | 101 | [15][58] | Secondary, consistent across sources |
| Breaks as work time | Breaks are not working time if the worker may leave the workplace; otherwise they count | 102 | [15] | Secondary |
| Weekly rest | Friday by default; another day allowed after notifying the labour office; ≥24 consecutive hours, fully paid, not replaceable by cash | 104 | [15][58] | Secondary |
| Overtime pay | Hourly wage + 50% of basic wage; holiday and Eid hours = OT; **paid time off in lieu with consent (2025)** | 107 | [55][9d][59] | Confirmed (HRSD). Basic-hourly divisor 240 (8×30) per ZenHR [15] **[UNCERTAIN, configurable]** |
| Overtime cap | 720 h/year, raisable with worker consent | Implementing regs | [57b] | **[UNCERTAIN]** secondary only |
| Penalty types | Warning, fine, withholding an allowance or promotion up to 1 year, suspension without pay, dismissal (cases set by law); only penalties listed in the law or the approved work regulations | 66–67 | [51] | Confirmed (HRSD) |
| Repeat window | A harsher penalty for repetition only if <180 days since the worker was told of the previous penalty | 68 | [51] | Confirmed (HRSD) |
| Time limits | Charge within 30 days of discovery; penalty within 30 days of the investigation ending | 69 | [51] | Confirmed (HRSD) |
| Fine caps | ≤5 days' wage per violation; ≤5 days' wage deducted per month for fines; one penalty per violation; suspension ≤5 days/month | 70 | [51] | Confirmed (HRSD). ZenHR cites the same caps as Art. 67/68 and suspension ≤30 days/year [15] **[UNCERTAIN numbering]** |
| Procedure | Written notice, interrogation, defence in minutes (verbal allowed for a warning or a 1-day deduction, but recorded); written decision; objection within 15 days | 71–72 | [51] | Confirmed (HRSD) |
| Total deduction cap | Deductions only with written consent, a court order or a legal basis; total ≤ **half the wage** (higher for alimony) | 92 | [15] | Secondary; official text not opened **[UNCERTAIN on exact wording]** |
| Absence dismissal | Dismissal without notice or award for unexcused absence of **>30 intermittent days or >15 consecutive days** in one contract year, after a written warning | 80 | [15][53] | Secondary + official 1437H table text |
| 2025 amendments | Effective Feb 2025 (sources say 19 Feb or 25 Feb **[UNCERTAIN]**); add TOIL for OT; no change to hours found | — | [59][59b] | Secondary |
| Employer fines (MHRSD) | Revised employer violations schedule in force Feb 2026 (e.g. unpaid wages SAR 1,000–3,000 per worker by size; leave/rest breaches SAR 1,000–3,000 per worker) | Ministerial resolution | [54b] | Secondary. **These are fines on the employer, not employee penalties.** |

### C2. Disciplinary table: working-hours violations

Source: the violations and penalties table annexed to the implementing regulations (1437H). Two public copies agree on every row except row 11. [52][53] Percentages are of the **daily wage**. A deduction for the actual minutes or days missed is **added** for late >30 min, early leave and absence. An employer applies this only if it is in the company's approved work regulations (Art. 66–67) [51].

| # | Violation (no permission or acceptable excuse) | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|---|
| 1 | Late ≤15 min, no disruption to others | Written warning | 5% | 10% | 20% |
| 2 | Late ≤15 min, disrupts others | Written warning | 15% | 25% | 50% |
| 3 | Late 15–30 min, no disruption | 10% | 15% | 25% | 50% |
| 4 | Late 15–30 min, disrupts others | 25% | 50% | 75% | 1 day |
| 5 | Late 30–60 min, no disruption | 25% | 50% | 75% | 1 day |
| 6 | Late 30–60 min, disrupts others | 30% | 50% | 1 day | 2 days |
| 7 | Late >1 h | Written warning | 1 day | 2 days | 3 days |
| 8 | Early leave ≤15 min | Written warning | 10% | 25% | 1 day |
| 9 | Early leave >15 min | 10% | 25% | 50% | 1 day |
| 10 | Staying or returning after hours without permission | Written warning | 10% | 25% | 1 day |
| 11 | Absence 1 day | **[UNCERTAIN]** 50% / 1 day / 2 days / 3 days [53] **vs** 2 / 3 / 4 days / withhold promotion [52] | | | |
| 12 | Consecutive absence 2–6 days | 2 days | 3 days | 4 days | Withhold promotion/raise once |
| 13 | Consecutive absence 7–10 days | 4 days | 5 days | Withhold promotion/raise once | Dismissal with award if total absence ≤30 days **[UNCERTAIN wording]** |
| 14 | Consecutive absence 11–14 days | 5 days | Withhold promotion/raise + Art. 80 dismissal warning | Dismissal (Art. 80) | — |
| 15 | >15 consecutive days | Dismissal without award (Art. 80), after a written warning at **day 10** | | | |
| 16 | >30 intermittent days in a contract year | Dismissal without award (Art. 80), after a written warning at **day 20** | | | |

Implementation notes: store the table as config rows (`tier`, `disruption`, `occurrence[1..4]`, `unit` = WARNING | PCT_DAY | DAYS | WITHHOLD | DISMISS). The occurrence counter resets after 180 days (Art. 68). The engine must cap each fine at 5 days and the monthly total at 5 days (Art. 70) before payroll. A **newer MHRSD model work-regulation table may exist [UNCERTAIN]**, so load the company's own approved regulation from Qiwa before go-live.

---

## Sources

KSA vendors
- [1] Jisr, Attendance registration via Geofencing: https://jisr.zendesk.com/hc/en-sa/articles/13536914327185-Attendance-registration-via-Geofencing-Technology
- [2] Jisr, Defining a Location Group: https://jisr.zendesk.com/hc/en-sa/articles/46616803860497
- [3] Jisr, Geofencing Location Restriction: https://jisr.zendesk.com/hc/en-sa/articles/24977273918353-Geofencing-Location-Restriction
- [4] Jisr, Tracking submitted logs (source, device, out-of-range label): https://jisr.zendesk.com/hc/en-sa/articles/13535541082897
- [5] Jisr, Device linking: https://jisr.zendesk.com/hc/en-sa/articles/41226611675537
- [6] Jisr, Prerequisites for BioTime integration: https://jisr.zendesk.com/hc/en-sa/articles/27553321976337
- [7] Jisr, Android attendance recording issue: https://jisr.zendesk.com/hc/en-sa/articles/13537034185489
- [8] Jisr, Clocking Windows & Punch Rules: https://jisr.zendesk.com/hc/en-sa/articles/13535772026385
- [9] Jisr, Clock out not required: https://jisr.zendesk.com/hc/en-sa/articles/13533436991889
- [9b] Jisr, Excuse Policy: https://jisr.zendesk.com/hc/en-sa/articles/13535411721233
- [9c] Jisr, Punch Correction Policies: https://jisr.zendesk.com/hc/en-sa/articles/43870482738577
- [9d] Jisr, How to calculate overtime (quotes Arts. 98, 107): https://jisr.zendesk.com/hc/en-sa/articles/13536217401361
- [9e] Jisr, Automatic Overtime: https://jisr.zendesk.com/hc/en-sa/articles/13534409998353 ; TOIL: https://jisr.zendesk.com/hc/en-sa/articles/34407191199761
- [9f] Jisr, Lateness deduction calc: https://jisr.zendesk.com/hc/en-sa/articles/13763222787857 ; Incomplete-record deduction: https://jisr.zendesk.com/hc/en-sa/articles/13764055700497 ; Flexibility (max 360 min): https://jisr.zendesk.com/hc/en-sa/articles/15346709471249
- [10] ZenHR, Attendance & Time-Tracking: https://www.zenhr.com/en/modules/attendance-and-time-tracking
- [11] ZenHR, Mobile ESS: https://zenhrsolutions.freshdesk.com/en/support/solutions/articles/43000745169
- [12] ZenHR, Biometric Verification: https://zenhrsolutions.freshdesk.com/en/support/solutions/articles/43000774348
- [13] ZenHR, ZKTeco integration: https://zenhrsolutions.freshdesk.com/en/support/solutions/articles/43000670307
- [14] ZenHR, Regular Shifts (grace, OT-after): https://zenhrsolutions.freshdesk.com/en/support/solutions/articles/43000745929
- [15] ZenHR, Saudi Labor Law mapped to features: https://zenhrsolutions.freshdesk.com/en/support/solutions/articles/43000793464
- [20] Bayzat, Multiple office locations (radius): https://bayzathelp.zendesk.com/hc/en-gb/articles/14309065418001
- [21] Bayzat, Multiple office check-in: https://bayzathelp.zendesk.com/hc/en-gb/articles/26474226750993
- [22] Bayzat, Out-of-office check-in: https://bayzathelp.zendesk.com/hc/en-gb/articles/14282414448017 ; view locations: https://bayzathelp.zendesk.com/hc/en-gb/articles/26559411648657
- [23] Bayzat, Facial Recognition: https://bayzathelp.zendesk.com/hc/en-gb/articles/39304429837841
- [24] Bayzat, Attendance product page: https://www.bayzat.com/attendance
- [25] Bayzat, Kiosk Mode: https://bayzathelp.zendesk.com/hc/en-gb/articles/14284101276945
- [26] Bayzat, Multiple Visits: https://bayzathelp.zendesk.com/hc/en-gb/articles/14283861334417 , https://bayzathelp.zendesk.com/hc/en-gb/articles/14284003904145
- [26b] Bayzat, Deduction policies (levels, occurrences, refresh, disruption): https://bayzathelp.zendesk.com/hc/en-gb/articles/16525235097233 ; work timing levels: https://bayzathelp.zendesk.com/hc/en-gb/articles/16515377627281
- [27] Bayzat, Updating Biometric IDs: https://bayzathelp.zendesk.com/hc/en-gb/articles/23899767717777
- [28] Bayzat, Attendance Regularization FAQ: https://bayzathelp.zendesk.com/hc/en-gb/articles/33598486036113
- [30] Menaitech, MenaTA: https://menaitech.com/en/products/menata/

Global vendors
- [40] Workday, geofence for time entry: https://doc.workday.com/admin-guide/en-us/human-capital-management/time-tracking/time-entry-setup/time-entry-templates/yqw1579906153510.html
- [42] SAP Learning, Time Tracking: https://learning.sap.com/courses/sap-successfactors-time-management-academy/introducing-sap-successfactors-time-tracking_b667fdde-e92e-4fd8-9e25-0ed11e7b8766
- [43] SAP Help, Manage Clock In Clock Out: https://help.sap.com/docs/successfactors-employee-central/operating-time-management-in-sap-successfactors/manage-clock-in-clock-out
- [44] SAP KBA 3793475: https://userapps.support.sap.com/sap/support/knowledge/en/3793475
- [45] Oracle FAQ, geolocation and geofencing for Web Clock: https://docs.oracle.com/en/cloud/saas/human-resources/faqah/set-up-geolocation-and-geofencing-for-the-web-clock.html
- [46] Oracle 24D, Geofences for Web Clock: https://docs.oracle.com/en/cloud/saas/readiness/hcm/24d/tila-24d/24D-time-labor-wn-f35084.htm
- [47] Oracle, Time collection device integration: https://docs.oracle.com/en/cloud/saas/human-resources/24c/faitl/time-collection-device-integration-options-on-time-entry-profiles.html
- [48] Factorial, Geolocation in time tracking: https://help.factorialhr.com/how-to-use-geolocation-in-time-tracking
- [49] Rippling, Mobile time clock: https://www.rippling.com/mobile-time-clock
- [50] BambooHR, Geolocation for time tracking: https://www.bamboohr.com/product-updates/geolocation-for-time-tracking

Law
- [51] HRSD Knowledge Centre, Disciplinary Rules (Arts. 66–72): https://www.hrsd.gov.sa/en/knowledge-centre/articles/320
- [52] Violations and penalties tables annexed to the implementing regulations, 1437H (Qistas copy): https://qistas.com/legislations/ksa/view/MjE5MzU1ODY=
- [53] Mulem Law, Schedule of violations, working hours: https://mulem.com.sa/en/schedule-of-violations-and-penalties/violations-related-to-working-hours/
- [54] Qoyod, Working hours and weekly rest: https://www.qoyod.com/en/learn/working-hours-weekly-rest-saudi-labor-law/
- [54b] MRRORS, MHRSD revised employer violations schedule (Feb 2026): https://www.mrrors.org/article/saudi-arabia-revises-its-schedule-of-violations-and-penalties-for-work-violations/
- [55] HRSD Knowledge Centre, working hours (Arts. 98–100, 107): https://www.hrsd.gov.sa/en/knowledge-centre/articles/312
- [56] Jisr Art. 107 explainer: see [9d]
- [57] KSA Expats, working hours: https://ksaexpats.com/working-hours-saudi-arabia-expats/ ; [57b] overtime 720 h/year: https://ksaexpats.com/hrsd-the-maximum-number-of-overtime-hours-during-the-year-is-720-hrs/
- [58] Migrant-Rights, Know Your Rights KSA: https://www.migrant-rights.org/wp-content/uploads/2023/09/Know-Your-Rights_Saudi-Arabia-as-of-Oct-9.pdf ; Gulf News on Arts. 101/104: https://gulfnews.com/world/gulf/saudi/saudi-arabia-enforces-labour-law-to-ensure-workers-right-to-rest-and-reasonable-hours-1.500340433
- [59] Rödl & Partner, 2025 amendments: https://www.roedl.com/insights/saudi-arabia-labor-law-amendments-impact ; [59b] Addleshaw Goddard: https://addleshawgoddard.com/en/insights/insights-briefings/2025/employment/embracing-change-2025-ksa-labour-law-amendments
- Official consolidated text (PDF; not machine-readable in this session): https://www.hrsd.gov.sa/sites/default/files/2023-02/Labor.pdf

Platform
- [60] Android `Location` (isMock API 31, isFromMockProvider API 18, getAccuracy): https://developer.android.com/reference/android/location/Location
- [61] Apple `isSimulatedBySoftware` (iOS 15+): https://developer.apple.com/documentation/corelocation/cllocationsourceinformation/issimulatedbysoftware
- [62] MDN, GeolocationCoordinates.accuracy: https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy

Rankings
- [70] Bayzat KSA buyer's guide (vendor-written): https://www.bayzat.com/blog/?p=26314
- [71] OrangeHRM Middle East top 10 (competitor-written): https://www.orangehrmlive.com/resources/blog/top-ten-hr-software-in-the-uae-and-middle-east-2026
