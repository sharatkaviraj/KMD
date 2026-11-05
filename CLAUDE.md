# VPPS One — rules for AI agents

## Current owner direction — 1 November 2026 coexistence

The owner explicitly requested implementation, needed migrations and live
deployment of `docs/plans/2026-11-01-fees-one-coexistence-plan.md`.
This supersedes retirement of Fees and the older prohibition on any Fees
backend change for this integration. Fees stays the financial authority.
Source changes belong in the `schoolfees` repository: narrowly scoped
`/api/one/v1` operations, explicit actor grants and durable source capture.
One uses those APIs and One-owned roster projections. Its ordinary Supabase
clients and migration readers still MUST NOT become generic writable clients
for the Fees source. The sealed source reader remains read-only.

Do not run the old cutover's source-link shutdown, independent One financial
posting/provider jobs, or tail-payment re-entry. Preserve TEST isolation,
current source permissions and one owner of receipt/message/provider effects.
Deployment authorization is not permission to invent real collections, send
parent test messages, promote ambiguous staff, or purchase a plan. Publish
real academic identity only after classification/quarantine is verified.

Start at [AGENTS.md](AGENTS.md) (where things live, safe commands, boundaries)
and the generated [docs/maps/repo-map.md](docs/maps/repo-map.md). Then
`docs/PLAN.md` and `docs/PROGRESS.md` to find the next task.

**Active work is the 4 October plan pack: P0–P12 in `docs/PROGRESS.md`, sourced
from `docs/plan-pack/`.** Take the first P row that is not done; the residual
R rows (R3.4 onward) follow it and stay open. Do not restart original Phase 1.1
or stop at deferred live-cutover task 7.3. Read `docs/PARITY.md`, `docs/QA.md`
and the latest baseline.

### Historical: the port and the planned retirement (superseded 1 Nov 2026)

Kept because the code still carries its shape; **not current direction**.
The School Fees app was ported into this repo (D-178): its screens and modules
live under `PORTED_TREES`, and against One's own database they write fee data
for TEST-session students (local adapter, confined deployments). The plan then
was to retire the Fees deployment and make One the ledger (PLAN §9). The
coexistence direction above replaces that: **Fees stays the financial
authority and keeps running**, and real collections from One go to Fees
through `/api/one/v1`. Do not treat "Fees will be retired" or "two apps write
one fee database" as instructions.

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

Fees code is ported in (above) but **Fees remains its own live application and
the financial authority** (coexistence, 1 Nov 2026). Bridge-side changes belong
in `veerpatta/schoolfees` as narrowly scoped `/api/one/v1` work, reviewed there;
nothing in this repo writes to the Fees database.

The separation that remains is of *databases*: One's code runs against One's
database (`wtgxcptmucjerhufzjcf`, production — rule 3), and the Fees live
database `vgqyilgstjvgohrsiwkb` is never a target from here.

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
3. **One database, and it is production.** `wtgxcptmucjerhufzjcf` is One's
   main database (D-338) — production from go-live, and the only test bed
   there will ever be (D-346). There is no separate dev database. Testing
   happens in it, under `TEST-2026-27`, by test accounts
   (`vppsone.staff_profiles.is_test_account`).

   - **The database says whether it is production**:
     `vppsone.deployment.environment` (`dev` until the lockdown; unreadable
     counts as production). QA, smoke-lab, day-run and seed tooling read it
     through `scripts/target-guard.mjs#toolScope` (scripts) or
     `src/platform/deployment/tool-access.ts` (the app). On production they
     are **confined, not banned**: they touch only test accounts and
     TEST-session data, and refuse otherwise. `replicate-live.mjs` refuses
     production outright.
   - **Non-production deployments are confined**: Preview and local
     `next dev` point at the same database, so `isConfinedDeployment()`
     (`src/platform/deployment/confinement.ts`, the single definition) makes
     every user a test account and allows fee writes only for TEST-session
     students.
   - **Fee writes** are switched by `app_settings.fee_writes_enabled` (D-345),
     enforced in the money functions and in the fee clients' fetch.
   - **The fees app's live database `vgqyilgstjvgohrsiwkb` is never a target.**
     Do not migrate it, seed it or write to it. Only `scripts/migrate/*` read
     it, through a sealed select-only reader (D-339); everything else refuses
     it by name (`FEES_SOURCE_PROJECT_REF`).
   - Fee-schema SQL One owns goes in `supabase/fee-migrations/` with a header
     saying why it differs from the fees app; `supabase/migrations/` stays
     `vppsone`-only.

   Until the first real load the fee data here is a **de-identified replica**
   of live (D-186); check `vppsone.data_replica`. Compare privileges, not just
   columns, before believing two schemas match — `docs/cutover/SCHEMA-PARITY.md`
   records what still differs and why.

3a. **Never decide the academic session by sorting the labels.** Six places did
   and all six were wrong: `TEST-2026-27` sorts above `2026-27`, and live
   carries that rehearsal session. Use `pickSessionLabel()` from
   `platform/config/active-session.ts`, which prefers
   `app_settings.active_session_label` — the row the fee app's own
   `getActiveSessionLabel()` reads (D-187).

3b. **Chunk every `.in(...)` list of ids.** It is serialized into the request
   URL: ~300 ids succeed, 400 fail, and the school has 583 active children.
   The failure is an eight-second hang and then `TypeError: fetch failed`,
   which a `const { data } = await …` turns into a plausible empty array. Use
   `fetchInChunks` with `IN_FILTER_CHUNK_SIZE` from
   `platform/helpers/in-filter.ts`.
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
   string in a component is a bug. Pairs for set-up and policy screens a
   handful of staff open go in `src/messages/setup.ts` (`ms`) instead:
   `index.ts` ships with every page, and the route bundle budget fails when
   it grows (D-229).

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

The full, generated layout is [docs/maps/repo-map.md](docs/maps/repo-map.md)
(`npm run docs:map`; CI fails when it is stale). In short:

```
src/app/(app)/       this app's signed-in routes
src/app/(app)/fees/  the ported School Fees screens
src/vx/screens/      the current screen design most routes render
src/modules/<x>/     feature-first: domain/ (pure logic), data/ (db), ui/
src/platform/        auth, supabase clients, deployment confinement, fees-bridge client
src/ui/              design system and shell — School Fees' kit
supabase/migrations/ numbered SQL, additive, never edited once applied
docs/                PLAN, PROGRESS, DECISIONS, SOURCES, maps/
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

<!-- BEGIN:browserstack -->
## Cross-browser and real-device testing (BrowserStack)

BrowserStack (Janmejay's GitHub Student Pack licence) is available for this project. Use it after UI, CSS, layout, PWA or mobile changes to check the real browsers and phones that local Chromium can't show - Safari on iPhone, Chrome on Android, Edge and Firefox on Windows.

- **Coding agents (Claude Code, Codex, Cursor):** `.mcp.json` registers BrowserStack's official remote MCP server as `browserstack` (one-time `/mcp` sign-in). Codex: `codex mcp add browserstack --url https://mcp.browserstack.com/mcp`, then `codex mcp login browserstack`.
- **Agents that drive Chrome (Cowork / Claude in Chrome):** Janmejay's Chrome has the BrowserStack extension installed and is signed in - use https://live.browserstack.com/dashboard.
- How-to, default device set, localhost testing and troubleshooting: [docs/BROWSERSTACK.md](docs/BROWSERSTACK.md).
- Never a blocker: if BrowserStack isn't available (no sign-in, plan limit, network), say so in your summary and carry on.
<!-- END:browserstack -->
