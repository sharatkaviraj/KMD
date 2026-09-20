# VPPS One — rules for AI agents

Read `docs/PLAN.md` first, then `docs/PROGRESS.md` to find the next task.

**Active work is PLAN revision 2, queue R0–R8. Start R0.1; do not restart original
Phase 1.1 or stop at deferred live-cutover task 7.3.** Read `docs/PARITY.md`,
`docs/QA.md` and the latest baseline.

**The School Fees app has been ported into this repo** (D-178, Janmejay's
explicit call): 709 files, 48 screens, 20 modules, and fee data is writable
from here. The earlier interpretation — "fee writes remain in School Fees" — is
superseded, and PLAN §9's native fee module is now selected. SamPark is
unaffected and its parity work continues.

The fee app still runs at its own deployment and is to be retired once this one
is complete, so for now two applications can write one fee database.

### The overlap

Two things make that safe, and both are in Postgres rather than in discipline:
`post_student_payment` serialises receipt numbering with a **database-wide
advisory lock**, and `receipts_student_client_request_id_unique` is a partial
unique index that makes a repeated post idempotent. Both hold across
applications. **Keep passing `client_request_id`** — that is the part that can
be broken from here.

What does *not* cross is cache invalidation: a payment posted in one app will
not purge the other's dashboard, so two people at one desk can see different day
totals for up to 300s. `OfficeSyncListener` uses Supabase realtime, which does
cross, which is why it is mounted. `auto-day-close` must run in exactly one
deployment or the day closes twice.

Existing tests passing does not establish full workflow parity or staff acceptance.

## What this project is

One mobile-friendly school platform for Shri Veer Patta Senior Secondary School:
staff, academics, timetable, attendance, collection, assessments, notes, reports.
Single school, single repo, single database, no parent login.

**It used to be a separate application from the fee app, and is not any more.**
School Fees is ported in and will be retired. `veerpatta/schoolfees` is still
the reference to port *from*, and is still never committed to.

The separation that remains is of *databases*, and it still replaces every
feature flag, canary user and release gate the previous attempt needed: this app
is built against `schoolfees-dev` and nothing here points at the live fee
database until the cutover phase.

## The rules

1. **Own your schema.** Every table, view, function and enum VPPS One creates
   lives in the `vppsone` Postgres schema. Never create anything in `public` —
   `public` belongs to the fee app.
2. **Fee data is writable now, and only from the fee module.** This replaced
   "fee data is read-only, always" when the fee app was ported into this repo
   and scheduled for retirement (D-178). The property that rule protected is
   the one kept: **nothing writes fee data by accident.**

   - Fee tables are reached only through `src/modules/fees/platform/supabase/*`,
     never through this app's own clients. Ported code calls `.from("students")`
     with no `.schema()`, so the wrong client silently addresses `vppsone`.
   - Only the ported trees may import those clients — the list is
     `PORTED_TREES` in `scripts/port-rewrite-imports.mjs`.
   - Every page, route handler and server action that writes fee data must
     authorize first: a permission, or a machine credential for a cron or a
     webhook. Fee RLS keys on `public.users.role` and most accounts here have
     no such row, so writes bypass RLS and **that check is the only one there
     is** (D-179).

   `tests/architecture.test.ts` enforces all three. Still forbidden: altering
   fee tables, and adding a column, trigger, policy or foreign key to them.
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
9. **Language is per account, never hard-coded.** Every staff member reads the
   app in `hi`, `en` or `both` (PLAN §3a). Write every user-facing string as a
   pair in `src/messages/index.ts` and render it with `primary()` /
   `secondary()` / `flat()` against the reader's language. A hard-coded Hindi
   string in a component is a bug.

9a. **The ported fee screens keep their own catalogue, and the two never mix.**
   Files under `PORTED_TREES` say their strings through `next-intl` out of
   `src/messages/{en,hi,hi-en}.json`; everything else uses the pairs above.
   No file may import both — that is a file where the reader's language is
   decided twice and the two answers can disagree. `preferred_language` is
   still the only stored preference; `src/platform/i18n/bridge.ts` derives
   the fee locale from it (D-181). Enforced in `tests/architecture.test.ts`.

## Stack

Next.js 16 (App Router, `src/`), React 19, TypeScript, **Tailwind v3**,
Supabase (Postgres + Auth), Vercel. Node 24. All routes `runtime = "nodejs"`.

Tailwind is v3 on purpose. This repo was v4, and moved back so it compiles
the same `tailwind.config.ts` and `globals.css` as the fee app whose
components were ported in — parity as a property of the compiler rather than
a claim somebody re-checks. `npm run check:theme` compares all 430 tokens
against the sibling repo. Going back to v4 is a job for when there is one
app instead of two.

Also from the fee app: next-intl, next-themes, five Radix primitives, cva,
@react-pdf/renderer, qrcode, fflate, xlsx. `build` is `next build --webpack`
because the React Compiler runs as a Babel pass and Turbopack skips it.

## Layout

```
src/app/(app)/       this app's signed-in routes
src/app/(app)/fees/  the ported School Fees screens
src/modules/<x>/     feature-first: domain/ (pure logic), data/ (db), ui/
src/platform/        auth, supabase clients, config, shared server helpers
src/ui/              design system and shell — School Fees' kit
supabase/migrations/ numbered SQL, additive, never edited once applied
docs/                PLAN, PROGRESS, DECISIONS, SOURCES
```

**Two apps share this tree, and which one a file belongs to matters.**
`PORTED_TREES` in `scripts/port-rewrite-imports.mjs` is the list, and it is
the single definition — the architecture tests and the ESLint config import
it rather than keeping copies. Ported files use the fee Supabase clients,
the fee role vocabulary and the next-intl catalogue; this app's own files use
this app's. Three modules are named for the same nouns in both repos and the
ported ones carry a suffix: `students-fees`, `staff-fees`, and the fee
session switcher at `modules/fees/platform/session-context/`.

The ported trees are exempt from the React Compiler lint rules. That is
scoped rather than global: this app's own code keeps the stricter contract,
and a file that leaves a ported tree loses the exemption by moving.

Pure logic goes in `domain/` with unit tests and no database import. That is the
one architectural rule worth enforcing; the rest is preference.
