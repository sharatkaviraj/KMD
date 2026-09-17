# VPPS One

One school platform for Shri Veer Patta Senior Secondary School — staff,
academics, timetable, attendance, collection, assessments, notes and reports.

The active work is **PLAN revision 2**: restore access to the existing SamPark
and School Fees apps, complete SamPark workflow parity, and improve each role's
home screen, daily workflows and speed. Start at **R0.1**. These improvements
are planned, not already delivered; original Phases 1–7 remain in the history.

The original apps stay in their own repositories and deployments. Under the
plan's stated working interpretation, fee operations remain in School Fees;
VPPS One reads fee data and offers verified handoffs without a second ledger.

## Start here

| File | What |
|---|---|
| `CLAUDE.md` | the rules for anyone, human or agent, working in this repo |
| `docs/PLAN.md` | the whole plan: architecture, data model, phases, cutover |
| `docs/PROGRESS.md` | active R0–R8 queue and preserved original implementation history |
| `docs/PARITY.md` | SamPark and School Fees source-to-destination workflow inventory |
| `docs/QA.md` | deep workflow, role, mobile, recovery and performance acceptance |
| `docs/QA-BASELINE-2026-09-17.md` | executed baseline checks, confirmed gaps and unverified work |
| `docs/prompts/kickoff.md` | current coding-agent kickoff; replaces original Phase 1.1 prompt |
| `docs/SOURCES.md` | proven code in the sibling repos, and what to take from each |
| `docs/DECISIONS.md` | settings already decided |

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.local` points at the Supabase project `schoolfees-dev`
(`wtgxcptmucjerhufzjcf`), which holds the production schema with test rows.
See `.env.example`. The live fee database is not a target until the cutover.
