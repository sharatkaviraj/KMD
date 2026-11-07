# Repo map

**Generated — do not edit by hand.** Run `npm run docs:map`; CI runs
`npm run docs:map:check` and fails when this file disagrees with the tree.
The reasons behind the layout are in [AGENTS.md](../../AGENTS.md) and
[CLAUDE.md](../../CLAUDE.md); the Collect trace is [collect-flow.md](collect-flow.md).

Ownership comes from `PORTED_TREES` in `scripts/port-rewrite-imports.mjs`: a
ported tree uses the fee Supabase clients, fee roles and the next-intl
catalogue; everything else uses One's own.

## Top level

| Path | What it is |
|---|---|
| `.github/` | CI workflows (see the workflow table below) |
| `docs/` | PLAN, PROGRESS, DECISIONS, PARITY, QA, cutover/coexistence records, maps |
| `public/` | static assets, PWA manifest/icons (Next requires the root) |
| `scripts/` | operational, QA and quality scripts — many reach a database; see AGENTS.md |
| `src/` | the application |
| `supabase/` | `migrations/` (vppsone schema) and `fee-migrations/` (fee-schema SQL One owns); never edit an applied file |
| `tests/` | vitest suites, synthetic Playwright harnesses, SQL/concurrency proofs |

## `src/`

| Path | What it is |
|---|---|
| `src/app/` | Next App Router routes |
| `src/lib/` | small shared helpers predating `platform/` |
| `src/messages/` | strings: `index.ts`/`setup.ts` pairs (One) and `{en,hi,hi-en}.json` (ported, next-intl) |
| `src/modules/` | feature folders: `domain/` (pure) · `data/` (db) · `ui/` |
| `src/platform/` | auth, Supabase clients, deployment confinement, Fees bridge client, i18n, money |
| `src/ui/` | School Fees' design kit — ported |
| `src/vx/` | the current screen design: `screens/`, shell, `text.ts` pairs |

## `src/app/` segments

| Segment | What it is |
|---|---|
| `(app)` | signed-in staff routes (table below) |
| `.well-known` | OAuth/MCP discovery documents |
| `api` | route handlers: cron/jobs, webhooks, Fees bridge relay, AI, MCP |
| `auth` | Supabase auth callbacks |
| `cv` | public certificate verification (the QR on a school certificate) |
| `fonts` | self-hosted fonts used by PDFs and the shell |
| `lab` | signed-out lab/kiosk screens |
| `login` | staff sign-in |
| `mcp` | MCP OAuth authorize screen |
| `pay` | parent payment link by code (Razorpay is owned by Fees) |
| `qa` | QA day-run entry (test accounts only) |
| `r` | a teacher's tokenised page (for teachers without an account) |
| `rv` | public receipt verification by code |
| `t` | tokenised teacher links (marks, tasks) |
| `w` | landing page for the button on a WhatsApp template message |

## Signed-in routes — `src/app/(app)/`

*vx (current)*: every page renders `src/vx/screens/*`. *Ported Fees screens*: the
classic desks ported from School Fees. *One (pre-vx)*: One's own older screens.

| Route | Renders |
|---|---|
| `/academics` | One (pre-vx) + vx (current) |
| `/access-denied` | vx (current) |
| `/accounts` | vx (current) |
| `/admissions` | vx (current) |
| `/apps` | redirect |
| `/archives` | One (pre-vx) |
| `/assessments` | One (pre-vx) + vx (current) |
| `/attendance` | vx (current) |
| `/calendar` | One (pre-vx) + vx (current) |
| `/collection` | One (pre-vx) |
| `/dashboard` | redirect |
| `/documents` | no page |
| `/dues` | vx (current) |
| `/duty` | One (pre-vx) |
| `/enrolments` | One (pre-vx) |
| `/exam-office` | vx (current) |
| `/exams` | vx (current) |
| `/fee-setup` | vx (current) |
| `/fees` | ported Fees screens (classic) |
| `/inbox` | vx (current) |
| `/jobs` | One (pre-vx) |
| `/menu` | One (pre-vx) |
| `/messages` | vx (current) |
| `/more` | One (pre-vx) |
| `/not-in-one` | One (pre-vx) |
| `/notes` | vx (current) |
| `/payments` | vx (current) |
| `/preferences` | One (pre-vx) + vx (current) |
| `/receipts` | vx (current) |
| `/reminders` | vx (current) |
| `/reports` | vx (current) |
| `/school-office` | vx (current) |
| `/settings` | One (pre-vx) + redirect + vx (current) |
| `/smoke` | vx (current) |
| `/staff` | One (pre-vx) + vx (current) |
| `/student-tools` | vx (current) |
| `/students` | One (pre-vx) + vx (current) |
| `/substitutions` | One (pre-vx) + vx (current) |
| `/teach` | One (pre-vx) + vx (current) |
| `/timetable` | One (pre-vx) + vx (current) |
| `/transport` | vx (current) |

## Modules — `src/modules/`

| Module | Owner | Layers | README says |
|---|---|---|---|
| `academics` | One | domain, data, ui | — |
| `activity` | ported from Fees | data | The audit feed: who did what, when, and to which record. |
| `ai-report` | One | domain, data | One file with everything One and Fees hold for a session, to give to an AI assistant. |
| `archives` | One | domain, data, ui | — |
| `assessments` | One | domain, data, ui | — |
| `assist` | One | domain, data | — |
| `attendance` | One | domain, data, ui | — |
| `certificates` | One | domain, data, ui | — |
| `coexistence` | One | domain, data | — |
| `collect` | One | domain, data | — |
| `collection` | One | domain, data, ui | — |
| `dashboard` | ported from Fees | domain, data, ui, vx | Five read-only boards over one money band. Analytics, never a write. |
| `defaulters` | ported from Fees | domain, data, ui, vx | The daily follow-up list, and the contact log behind it. |
| `enrolments` | One | domain, data | — |
| `exports` | ported from Fees | domain, data | Every XLSX and printable the office downloads, and the AI context bundle. |
| `fees` | ported from Fees | domain, data, ui, vx, platform | The fee engine and the policy that drives it. The most load-bearing module in the repo. |
| `finance-controls` | ported from Fees | domain, data, ui, vx | Day close, refunds, and the correction review queue. |
| `government-records` | One | domain, data | — |
| `home` | One | domain, data, ui | — |
| `imports` | ported from Fees | domain, data, ui, vx | The staged student import: upload, map, dry run, review, commit only what is valid. |
| `jobs` | One | domain, data, ui | — |
| `master-data` | ported from Fees | data, ui | The school's own lists: sessions, classes, routes. |
| `mcp` | One | domain, data, ui | — |
| `notes` | One | domain, data, ui | — |
| `official-results` | One | domain, data | `/exam-office/board` configures an authority/session/attempt and its real existing |
| `ops-health` | One | domain | — |
| `payments` | ported from Fees | domain, data, ui, vx | The Payment Desk. The only place in this application that posts money. |
| `performance` | One | ui | — |
| `prev-year-dues` | ported from Fees | domain, data | Carry-forward: what a family still owed when the year turned over. |
| `promotion` | ported from Fees | data, vx | Year-end rollover: copy the policy, promote the students, carry the credit. |
| `receipts` | ported from Fees | domain, data, ui, vx | Receipt lookup, reprint, share, and the reversal that money corrections run through. |
| `recovery` | ported from Fees | domain, data | Students who have left and still owe. The non-active complement to defaulters. |
| `repayment-plans` | ported from Fees | domain, data | EMI plans: a schedule a family agreed to, kept on file. |
| `reports` | ported from Fees | domain, data, ui, vx | Read-only reporting and the per-student ledger. |
| `smoke` | One | domain, data | — |
| `staff` | One | domain, data, ui | — |
| `staff-fees` | ported from Fees | data, ui | Staff accounts, roles, and password change. |
| `staff-notices` | One | domain, data | — |
| `students` | One | domain, data, ui | — |
| `students-fees` | ported from Fees | domain, data, ui, vx | The student master. With Fee Setup, one of the two sources of truth. |
| `substitutions` | One | domain, data, ui | — |
| `system-sync` | ported from Fees | domain, data | Cache invalidation and financial revalidation. Small, and every money path depends on it. |
| `teacher-tasks` | One | domain, data, ui | — |
| `timetable` | One | domain, data, ui | — |
| `transactions` | ported from Fees | domain, data, ui | The read-only financial record centre. |
| `transport` | One | domain, data | Which children ride each bus route, when each bus leaves, and who drives it. |
| `whatsapp` | ported from Fees | domain, data, ui, vx | Fee reminders and the message templates behind them. |

## Platform — `src/platform/`

| Folder | Owner |
|---|---|
| `auth` | One |
| `config` | One |
| `db` | ported from Fees |
| `deployment` | One |
| `drafts` | One |
| `excel` | ported from Fees |
| `fees-bridge` | One |
| `google` | One |
| `helpers` | ported from Fees |
| `i18n` | One |
| `locale` | ported from Fees |
| `messaging` | One |
| `migration` | One |
| `money` | ported from Fees |
| `navigation` | ported from Fees |
| `observability` | ported from Fees |
| `pdf` | ported from Fees |
| `performance` | One |
| `pwa` | One |
| `supabase` | One |
| `telemetry` | ported from Fees |

## vx screens — `src/vx/screens/`

`academics` · `accounts` · `admin` · `admissions` · `board-office` · `calendar` · `collect` · `dues` · `exams` · `family-contact` · `fee-setup` · `messages` · `notes` · `payments` · `receipts` · `reminders` · `reports` · `school-office` · `settings` · `smoke` · `staff` · `student-tools` · `system` · `teach` · `timetable` · `transport`

## Test harnesses

| Where | What | Needs |
|---|---|---|
| `tests/**/*.test.ts(x)` | vitest (`npm run test`) | nothing external |
| `tests/architecture.test.ts` | import/ownership rules, ported-tree fences | nothing external |
| `tests/sql/*.mjs` | migration + grant proofs on in-memory PGlite | nothing external |
| `tests/sql/*.py` | lock/concurrency proofs on a disposable PostgreSQL 17 with two real connections | CI service container or local Postgres |
| `tests/playwright/*.playwright.config.ts` | browser harnesses — synthetic or external, per config below | Playwright browsers; external ones need an app |
| `playwright.config.ts` → `tests/e2e` | workflow suite (`npm run smoke:workflows`) | a database and test accounts — **not** part of `check` |

Playwright configs, classified from each config's `webServer` ("In CI" = named in a workflow):

| Config | Needs | In CI |
|---|---|---|
| `academic-followup` | synthetic (vite fixture) | yes |
| `academic-ui` | synthetic (vite fixture) | yes |
| `accountant-dev` | **external**: a running app/database or a deployed site | no |
| `accountant-mobile` | synthetic (vite fixture) | yes |
| `cheque-followup` | synthetic (vite fixture) | yes |
| `class-followup` | synthetic (vite fixture) | yes |
| `contact-durable` | **external**: a running app/database or a deployed site | no |
| `contact-genuine-continuation` | **external**: a running app/database or a deployed site | no |
| `contact-genuine` | **external**: a running app/database or a deployed site | no |
| `export-followup` | synthetic (vite fixture) | yes |
| `fee-collector-dev` | **external**: a running app/database or a deployed site | no |
| `fee-followup` | synthetic (vite fixture) | yes |
| `login-ui` | synthetic (vite fixture) | yes |
| `marks-dev` | **external**: a running app/database or a deployed site | no |
| `marks-mobile` | synthetic (vite fixture) | yes |
| `mobile-ui` | synthetic (vite fixture) | no |
| `module-followup` | synthetic (vite fixture) | yes |
| `one-polish` | synthetic (vite fixture) | yes |
| `operations-admin-interruption` | **external**: a running app/database or a deployed site | no |
| `operations-admin` | synthetic (vite fixture) | yes |
| `operations-fee-collector` | synthetic (vite fixture) | yes |
| `payment-draft` | synthetic (vite fixture) | no |
| `payment-ui` | synthetic (vite fixture) | yes |
| `phone-operations` | **external**: a running app/database or a deployed site | no |
| `pr79-readonly` | **external**: a running app/database or a deployed site | no |
| `receipt-navigation` | synthetic (vite fixture) | yes |
| `school-office` | synthetic (vite fixture) | no |
| `student-profile` | synthetic (vite fixture) | yes |
| `student360-mobile` | synthetic (vite fixture) | yes |
| `student360-sibling` | synthetic (vite fixture) | yes |

Test folders:

`academic-followup` · `academic-ui` · `accountant-dev` · `accountant-mobile` · `cheque-followup` · `class-followup` · `collect` · `e2e` · `export-followup` · `fee-collector-dev` · `fee-followup` · `fees` · `fixtures` · `login-ui` · `marks-dev` · `marks-mobile` · `mcp` · `mobile-ui` · `module-followup` · `operations-admin` · `operations-fee-collector` · `payment-draft-ui` · `payment-ui` · `playwright` · `pr79-readonly` · `profile-photos` · `receipt-navigation` · `sampark-workflows` · `school-office-ui` · `shared` · `sibling-context` · `sql` · `support` · `vx`

## Workflows — `.github/workflows/`

| File | Name | Runs on |
|---|---|---|
| `ai-connection-sql.yml` | AI connection SQL | PR, push main, manual |
| `ci.yml` | CI | PR, push main, manual |
| `payment-parity-ui.yml` | Payment parity UI | PR (paths), manual |
| `phone-followup-ui.yml` | Phone follow-up UI | PR, push main, manual |
| `phone-operations-ui.yml` | Phone operations UI | PR, push main, manual |
| `provider-claim.yml` | Provider claim concurrency | PR, push main, manual |
| `teacher-task-sql.yml` | Teacher task SQL scope | PR, push main, manual |
| `transport-sql.yml` | Transport SQL | PR, push main, manual |
