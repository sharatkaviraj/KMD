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
| P1 Design system | not started | | | | |
| P2 App shell and roles | not started | | | | |
| P3 Payment Desk | not started | | | | |
| P4 Rest of Money | not started | | | | |
| P5 Admin core | not started | | | | |
| P6 Teacher app | not started | | | | |
| P7 Notes on children | not started | | | | |
| P8 Academic coordinator | not started | | | | |
| P9 Exam coordinator | not started | | | | |
| P10 Remaining admin modules | not started | | | | |
| P11 System states | not started | | | | |
| P12 Polish and final check | not started | | | | |

## Local setup notes

- `cdn.sheetjs.com` is blocked from the cloud build container, so a local
  install there swaps `xlsx` for the registry's 0.18.5 *without committing it*.
  The committed `package.json` keeps 0.20.3 from the SheetJS CDN, which Vercel
  and GitHub Actions can reach.
