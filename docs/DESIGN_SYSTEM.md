# Muqeem Desk design system — "Najdi ledger"

The look lives in **`design.css`** (loaded after the inline `<style>` in `index.html`, so it wins) and **`design.js`** (theme toggle, Arabic-Indic digits, skip link). `tools/build_gas.py` inlines both into `gas/Index.html`.

## Idea
A calm, dense HR/finance console. One signature only: the **Al-Sadu weave** on the rail edge and sign-in page. Everything else is quiet — white cards, hairline borders, one green for actions, saffron reserved for "today / you are here".

## Tokens (CSS variables)
| Group | Tokens |
|---|---|
| Brand primitives | `--ink-900` #12261F (rail), `--palm-600` #0F6B4E (primary), `--saffron-500` #C8902E (active / today / Hijri), `--sadu-600` #A63D2F (danger family), stone neutrals `--stone-*` |
| Semantic (use these in screens) | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--fg`, `--fg-2`, `--muted`, `--faint`, `--line`, `--line-strong`, `--line-input`, `--accent`, `--accent-hover`, `--accent-fg`, `--accent-soft`, `--ring` |
| Status | `--red`/`--red-soft`, `--amber`/`--amber-soft`, `--blue`/`--blue-soft`, `--green`/`--green-soft` (each pair passes WCAG AA in both themes) |
| Type | `--f-display` Readex Pro (headings, big numbers), `--f-sans` IBM Plex Sans / Plex Sans Arabic; sizes `--fs-2xs` 11 … `--fs-4xl` 44 |
| Space | 4-px grid `--sp-1` 4 … `--sp-12` 48 |
| Radius | `--r-sm` 6 (small controls), `--r-md` 8 (buttons, inputs), `--r-lg` 12 (cards, tables), `--r-xl` 16 (sheets, modals) |
| Shadow | `--sh-1` resting cards, `--sh-2` hover/popovers, `--sh-3` modals |
| Charts | categorical `--s1…--s7` (fixed order, never cycled), status `--st-*`, `--grid`, `--axis` |

Dark theme has its own steps (not an inversion). It follows the device until the user presses the moon/sun button in the top bar (stored in `localStorage` as `mqd-theme`).

## Components
Buttons `.btn` (`.pri`, `.ghost`, `.danger`, `.sm`) · inputs inside `.field` / `.fgrid` · `input.search` · `select.sel` · `.seg` segmented control · `.chip` filters · `.panel` · `.kpi` tiles (`.red/.amber/.blue/.green`, zero values recede) · tables (`.tbl-wrap`, `td.n` for numbers) · `.pill` status (`.p-red/.p-amber/.p-blue/.p-green/.p-grey`) · `.flag` · `.alert` list · `.warnbox` / `.okbox` · `.empty` · modal (`.overlay > .modal`, becomes a bottom sheet on phones) · `.toast` · `.mcard` phone cards · attendance (`.att-row`, `.tl` timeline, `table.ts` timesheet, `.me-*` phone check-in, `.punch`).

## Rules for new screens
1. Never hard-code a colour; use the semantic tokens above.
2. Use logical properties (`margin-inline-start`, `padding-inline`, `inset-inline-end`) so Arabic mirrors automatically.
3. Numbers: `td.n` or `font-variant-numeric: tabular-nums`. Don't use a monospace font for data.
4. Phone (≤760px): lists become `.mlist > .mcard`, tap targets are 44px, forms open as sheets. Tablet (761–1100px): icon rail.
5. Status is never colour alone — pills have a dot **and** a word.
6. Motion only answers an action (sheet opens, toast) plus one entrance on screen change; all motion stops under "reduce motion".

## Language & numbers
- EN/AR switch in the top bar; Arabic flips the page to RTL.
- Hijri (Umm al-Qura) date sits under the Gregorian date in the top bar.
- In Arabic, the **١٢٣** button switches displayed numbers to Arabic-Indic digits (`mqd-digits`). It changes display only; inputs, exports and calculations keep Western digits. Add class `no-digits` to any element that must stay Western.
