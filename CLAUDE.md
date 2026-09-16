# VPPS One — rules for AI agents

Read `docs/PLAN.md` first, then `docs/PROGRESS.md` to find the next task.

## What this project is

One mobile-friendly school platform for Shri Veer Patta Senior Secondary School:
staff, academics, timetable, attendance, collection, assessments, notes, reports.
Single school, single repo, single database, no parent login.

**It is a separate application from the fee app.** The fee app lives in the
`veerpatta/schoolfees` repo on its own Vercel project and its own production
database. Nothing in this repo can change it. That separation replaces every
feature flag, canary user and release gate the previous attempt needed.

## The rules

1. **Own your schema.** Every table, view, function and enum VPPS One creates
   lives in the `vppsone` Postgres schema. Never create anything in `public` —
   `public` belongs to the fee app.
2. **Fee data is read-only, always.** `public.students`, `public.classes`,
   `public.sessions` and friends may be SELECTed. Never INSERT, UPDATE, DELETE
   or ALTER them, and never add a column, trigger, policy or foreign key
   constraint *to* them. VPPS One may hold their ids.
3. **Build against dev.** `wtgxcptmucjerhufzjcf` (schoolfees-dev) is the only
   database this app is ever pointed at until the cutover phase (PLAN §7).
   The live fee database `vgqyilgstjvgohrsiwkb` is not a target. Do not connect
   to it, migrate it, or seed it.
4. **Copy, don't reinvent.** `docs/SOURCES.md` lists proven code in the three
   sibling repos. Port it with its tests; note what you changed and why.
5. **Push to main.** No release ceremony, no flags, no approval gates. Open a PR
   so CI runs, merge it yourself when green, and it deploys. Janmejay tests it
   live and the next task comes from what he finds.
6. **No personal data in the repo.** No real student name, phone number or
   Aadhaar in a fixture, seed, test or commit message. Test data only.
7. **Update `docs/PROGRESS.md` before you stop** — status, branch, commit, and
   one line on what remains or surprised you. A task whose code is merged and
   whose row is not updated is not done.
8. **Stop and ask** only for: a change that would write to the live fee
   database, a real WhatsApp send to a parent, or spending money. Everything
   else — proceed and note the decision in `docs/DECISIONS.md`.

## Stack

Next.js 16 (App Router, `src/`), React 19, TypeScript, Tailwind v4,
Supabase (Postgres + Auth), Vercel. Node 24. All routes `runtime = "nodejs"`.

## Layout

```
src/app/             routes
src/modules/<x>/     feature-first: domain/ (pure logic), data/ (db), ui/
src/platform/        auth, supabase clients, config, shared server helpers
src/ui/              design system and shell
supabase/migrations/ numbered SQL, additive, never edited once applied
docs/                PLAN, PROGRESS, DECISIONS, SOURCES
```

Pure logic goes in `domain/` with unit tests and no database import. That is the
one architectural rule worth enforcing; the rest is preference.
