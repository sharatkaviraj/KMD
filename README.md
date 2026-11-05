# VPPS One

One school platform for Shri Veer Patta Senior Secondary School — staff,
academics, timetable, attendance, collection, assessments, notes and reports.

**Current arrangement (1 November 2026 coexistence):** School Fees keeps running
as its own app and remains the financial authority. One owns academics and
reaches fees only through the Fees `/api/one/v1` bridge — one ledger, no second
receipt counter. See
[docs/plans/2026-11-01-fees-one-coexistence-plan.md](docs/plans/2026-11-01-fees-one-coexistence-plan.md)
and [docs/cutover/COEXISTENCE-2026-11-01.md](docs/cutover/COEXISTENCE-2026-11-01.md).
Older text about retiring Fees or a live cutover is historical.

## Start here

| File | What |
|---|---|
| `AGENTS.md` | entry guide for agents and new developers: where things live, safe vs external commands, boundaries |
| `CLAUDE.md` | the rules for anyone, human or agent, working in this repo |
| `docs/maps/repo-map.md` | generated map of routes, modules, ownership and test harnesses |
| `docs/maps/collect-flow.md` | Collect (payments) traced from route to ledger |
| `docs/PLAN.md` | the whole plan: architecture, data model, phases |
| `docs/PROGRESS.md` | active work queue and preserved implementation history |
| `docs/PARITY.md` | SamPark and School Fees source-to-destination workflow inventory |
| `docs/QA.md` | deep workflow, role, mobile, recovery and performance acceptance |
| `docs/QA-BASELINE-2026-09-17.md` | executed baseline checks, confirmed gaps and unverified work |
| `docs/prompts/kickoff.md` | coding-agent kickoff (read with the coexistence direction above) |
| `docs/SOURCES.md` | proven code in the sibling repos, and what to take from each |
| `docs/DECISIONS.md` | settings already decided |

## Running it

```bash
npm ci
cp .env.example .env.local   # names only; values come from the owner
npm run dev                  # http://localhost:3000
```

One has one Supabase project, `wtgxcptmucjerhufzjcf`, and **it is production**
(D-338). Local `next dev` and Preview deployments are confined to test accounts
and TEST-session data (`src/platform/deployment/confinement.ts`). The Fees live
database `vgqyilgstjvgohrsiwkb` is never a target from this repo. The full
environment inventory is `docs/cutover/ENV-INVENTORY.md` (names only).

`npm run check` runs the same gates as CI without touching any database.
