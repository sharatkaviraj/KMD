# VPPS One

One school platform for Shri Veer Patta Senior Secondary School — staff,
academics, timetable, attendance, collection, assessments, notes and reports.

Fees are not here. The fee app stays in `veerpatta/schoolfees` on its own
deployment and its own database. VPPS One reads fee data and never writes it.

## Start here

| File | What |
|---|---|
| `CLAUDE.md` | the rules for anyone, human or agent, working in this repo |
| `docs/PLAN.md` | the whole plan: architecture, data model, phases, cutover |
| `docs/PROGRESS.md` | where we are; the next task is the first row that is not done |
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
