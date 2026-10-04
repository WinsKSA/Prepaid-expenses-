# Muqeem Desk — Iqama, Jawazat & Prepaid Expenses (KSA)

A single-page control system for Saudi companies:

- **Employees** — auto-generated employee numbers (EMP-0001…), Gregorian + Hijri (Umm al-Qura) dates, Excel import with Arabic/English headers.
- **Iqama renewals** — workflow: request → checklist → HR → Finance → SADAD → payment → renewed (Muqeem/Absher). Fees calculated automatically: Iqama (SAR 650/yr, 3/6/9/12 months), expat levy (800/700/0), work permit, dependents (400/month), late fines (500 / 1,000, 3-day grace).
- **Jawazat services** — exit/re-entry single & multiple, final exit, Iqama replacement; return-before tracking.
- **Rent & prepaid contracts** — branch rent (Ejar), medical insurance; installment schedules; 15% VAT kept separate.
- **Monthly amortization** — daily straight-line with catch-up; schedule, roll-forward with balance check, charts.
- **Journal entries** — monthly QuickBooks Online import CSV (payments + amortization).
- **Notifications** — reminders at 90/60/30/15/7/0 days for Iqama, passport, insurance, visas, rent installments and contract ends; acknowledge / snooze.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app (UI, data layer, charts). Runs as a claude.ai Artifact with the `db`, `user` and `downloads` capabilities; outside that it opens in demo mode with example data. |
| `engine.js` | Pure calculation engine (fees, amortization, alerts, journal, forecast). No dependencies. |
| `io.js` | Excel/CSV import & export (needs SheetJS 0.18.5). Hijri → Gregorian conversion. |
| `tests/` | `engine.test.js`, `io.test.js` (Node or browser via `run-tests.html` / `test.html`). |
| `docs/SPEC.md` | Data model and accounting rules. |

## Run locally

Serve the folder with any static server and open `index.html` (demo mode):

```bash
python -m http.server 8000
```

Fee rates follow MHRSD / Jawazat as of October 2026 and are editable in **Fees & Settings**. Verify on Absher / Qiwa before relying on them.

> No employee, rent or other company data is stored in this repository — live data lives in the app's database.
