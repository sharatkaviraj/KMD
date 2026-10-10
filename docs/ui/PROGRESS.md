# UI build progress

The approved design (`docs/design-handoff/`) built into the app, phase by phase
(`docs/design-handoff/PLAN.md`, P0–P12). Every phase ends with a push to
`main`, which Vercel deploys to https://vppsone.vercel.app.

**To continue in a fresh session:** read `docs/design-handoff/PROMPT.md`, this
file, `docs/ui/DECISIONS.md` and `docs/ui/INVENTORY.md`, then take the first
phase below that is not done.

Database: schoolfees-dev `wtgxcptmucjerhufzjcf` only. Never `vgqyilgstjvgohrsiwkb`.

| Phase | Status | What shipped | Routes | Migrations applied | Open items |
|---|---|---|---|---|---|
| P0 Inventory and ledger | done | Pack in `docs/design-handoff/`, `INVENTORY.md`, this file, `DECISIONS.md`. Supabase ref confirmed `wtgxcptmucjerhufzjcf` (schoolfees-dev, ACTIVE_HEALTHY) | — | — | — |
| P1 Design system | done | `src/vx/`: tokens and component CSS (`vx.css`), icons, format helpers, language pairs, primitives, controls, sheets/toasts/confirm, voice note, page frame (`VxPage`, `TopBar`, `Split`, `DataList`) | — | — | `/dev/ui` gallery folded into P12 shots |
| P2 App shell and roles | done | `VxShell` in `(app)/layout.tsx`: sidebar (collapsible, badges, theme, EN·हि), phone bottom bar with quick actions, `/menu`, Ctrl K search (pages, students, receipts), admin "See the app as" with read-only banner, fee session pill. New permissions `messages:send`, `settings:manage`. Every new nav route exists; ones not rebuilt yet redirect to the classic screen | `/menu` + interim redirects | `20261010100247_vx_role_permissions` | Interim redirects are replaced phase by phase |
| P3 Payment Desk | done | `/payments` (find, student, amount chips, advance, back-date with late fee, cash/UPI/cheque/bank, late fee take or waive, confirm, saved with drawn tick and receipt, duplicate guard, admin 10-minute removal, preview/read-only states) and `/payments/bulk` (grid or Excel through the existing import batch). Reuses the existing posting actions with `client_request_id` | `/payments`, `/payments/bulk` | — | Waive/remove requests need an approval table; cheque bounce lives in Books |
| P4 Rest of Money | partial | Fee setup (11 states, accountant view-only + ask-admin), Reports (hub, collection, defaulters, class heat table, day book, export, schedules), Accountant Today, Books (cheques, deposit slip, bounce, UPI match, refunds, requests). Receipts, Dues and Reminders in progress | `/fee-setup`, `/reports`, `/accounts`, `/accounts/books` | `20261010102516_vx_accounts_books` | Report schedules and reminder pause have no sender yet (sending costs money) |
| P5 Admin core | done | Admin Today at `/` (KPIs, queue preview, timeline, money charts for fees:view only), Needs you `/inbox` (unmarked classes, cover, corrections, collection answers, refunds, failed jobs; Undo), Students list with fee chips, Student 360 tabs, Attendance board with mark-on-behalf | `/`, `/inbox`, `/students`, `/students/[id]`, `/attendance` | — | Office money reads through the fee RLS may be empty (fee app gives office no fees role); write-off/duplicate-SR items have no data source yet |
| P6 Teacher app | not started | | | | |
| P7 Notes on children | not started | | | | |
| P8 Academic coordinator | done | AcadHome, Progress (class, student, compare, attention, support plan), Attendance (today, month, chronic, corrections, register, mark), School calendar (month, agenda, holidays, day, add, notify). Old academics hub → `/academics/setup`, old calendar editor → `/calendar/days` | `/academics*`, `/calendar*` | `20261010102233_vx_academic_role_permissions`, `20261010102943_vx_academics_calendar`, `20261010103638_vx_needs_attention_open_notes`, `20261010104156_vx_academic_rollups` | Parent notices from the calendar are recorded for approval, never sent |
| P9 Exam coordinator | not started | | | | |
| P10 Remaining admin modules | not started | | | | |
| P11 System states | not started | | | | |
| P12 Polish and final check | not started | | | | |

## Local setup notes

- `cdn.sheetjs.com` is blocked from the cloud build container, so a local
  install there swaps `xlsx` for the registry's 0.18.5 *without committing it*.
  The committed `package.json` keeps 0.20.3 from the SheetJS CDN, which Vercel
  and GitHub Actions can reach.
