# Muqeem Desk — Iqama, Jawazat & Prepaid Expenses (KSA)

A single-page control system for Saudi companies:

- **Employees** — auto-generated employee numbers (EMP-0001…), Gregorian + Hijri (Umm al-Qura) dates, Excel import with Arabic/English headers.
- **Iqama renewals** — workflow: request → checklist → HR → Finance → SADAD → payment → renewed (Muqeem/Absher). Fees calculated automatically: Iqama (SAR 650/yr, 3/6/9/12 months), expat levy (800/700/0), work permit, dependents (400/month), late fines (500 / 1,000, 3-day grace).
- **Jawazat services** — exit/re-entry single & multiple, final exit, Iqama replacement; return-before tracking.
- **Rent & prepaid contracts** — branch rent (Ejar), medical insurance; installment schedules; 15% VAT kept separate.
- **Monthly amortization** — daily straight-line with catch-up; schedule, roll-forward with balance check, charts.
- **Journal entries** — monthly QuickBooks Online import CSV (payments + amortization).
- **Attendance by location (GPS geofence)** — employees check in/out from their phone; the server re-measures the distance to the branch zone on every punch.
  - Branch zones on a real map (radius per branch), live **Locations** map of today's punches, one-click zoom per branch.
  - Rules: any branch or only the assigned branch; outside the zone → record for HR review or refuse; weakest GPS accepted; impossible-travel ("location jump") flag.
  - Shifts (fixed, flexible, night shifts across midnight), grace, early leave, half day, overtime (Art. 107: rest-day and holiday hours are overtime), Ramadan hours (Art. 98, optionally Muslim staff only), Umm al-Qura holidays.
  - Live board with timelines, monthly timesheet (Excel export) → **Send to payroll** (absence days + overtime hours), exceptions queue, correction requests from employees, fingerprint-device / Excel import (ZKTeco etc.).
  - Labour-law watch: Art. 80 absence thresholds (warning 20 / 10, dismissal 30 / 15), Art. 101 breaks and 12-hour days, 720 h overtime guideline.
  - Employees with the `employee` role see only their own phone check-in screen.
- **Notifications** — reminders at 90/60/30/15/7/0 days for Iqama, passport, insurance, visas, rent installments and contract ends; acknowledge / snooze.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app (UI, data layer, charts). Runs as a claude.ai Artifact with the `db`, `user` and `downloads` capabilities; outside that it opens in demo mode with example data. |
| `engine.js` | Pure calculation engine (fees, amortization, alerts, journal, forecast). No dependencies. |
| `attendance.js` | Attendance engine: shifts, day status, month totals, payroll inputs, geofence, labour-law watch. Tested (`tests/attendance.test.js`). |
| `attendance_ui.js` | Attendance screens and the phone check-in. |
| `demo.js` | Sample company for `?demo` preview (kept in memory, never saved). |
| `io.js` | Excel/CSV import & export (needs SheetJS 0.18.5). Hijri → Gregorian conversion. |
| `tests/` | `engine.test.js`, `io.test.js` (Node or browser via `run-tests.html` / `test.html`). |
| `docs/SPEC.md` | Data model and accounting rules. |

## Tests

```bash
node tests/run-all.js
```

## Database (Supabase)

Run the migrations in `supabase/migrations` in order in the Supabase SQL editor. `003_attendance_ess.sql` adds correction requests, the employee `my_context()` lookup and the stricter server-side `punch()` (assigned-branch mode, refuse-outside mode, location-jump flag). Link an employee login by setting `emp_no` on its row in `app_users` (role `employee`).

## Run locally

Serve the folder with any static server. `index.html` opens the sign-in page; add `?demo` to preview every screen with a fictional sample company (nothing is saved):

```bash
python -m http.server 8000
```

Fee rates follow MHRSD / Jawazat as of October 2026 and are editable in **Fees & Settings**. Verify on Absher / Qiwa before relying on them.

> No employee, rent or other company data is stored in this repository — live data lives in the app's database.
