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
| `src/ui/` | School Fees' design kit (ported) — ported |
| `src/vx/` | the current screen design: `screens/`, shell, `text.ts` pairs |

## `src/app/` segments

| Segment | What it is |
|---|---|
| `(app)` | signed-in staff routes (table below) |
| `.well-known` | OAuth/MCP discovery documents |
| `api` | route handlers: cron/jobs, webhooks, Fees bridge relay, AI, MCP |
| `auth` | Supabase auth callbacks |
| `cv` | public short-link: cover/certificate view by code |
| `fonts` | self-hosted fonts used by PDFs and the shell |
| `lab` | signed-out lab/kiosk screens |
| `login` | staff sign-in |
| `mcp` | MCP OAuth authorize screen |
| `pay` | parent payment link by code (Razorpay is owned by Fees) |
| `qa` | QA day-run entry (test accounts only) |
| `r` | tokenised public link (receipt/report) |
| `rv` | public receipt verification by code |
| `t` | tokenised teacher links (marks, tasks) |
| `w` | tokenised public link |

## Signed-in routes — `src/app/(app)/`

*vx (current)*: every page renders `src/vx/screens/*`. *Ported Fees screens*: the
classic desks ported from School Fees. *One (pre-vx)*: One's own older screens.

| Route | Renders |
|---|---|
| `/academics` | mixed: vx + older |
| `/access-denied` | vx (current) |
| `/accounts` | vx (current) |
| `/admissions` | vx (current) |
| `/apps` | One (pre-vx) |
| `/archives` | One (pre-vx) |
| `/assessments` | mixed: vx + older |
| `/attendance` | vx (current) |
| `/calendar` | mixed: vx + older |
| `/collection` | One (pre-vx) |
| `/dashboard` | One (pre-vx) |
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
| `/notes` | vx (current) |
| `/payments` | vx (current) |
| `/preferences` | mixed: vx + older |
| `/receipts` | vx (current) |
| `/reminders` | vx (current) |
| `/reports` | vx (current) |
| `/school-office` | vx (current) |
| `/settings` | mixed: vx + older |
| `/smoke` | vx (current) |
| `/staff` | mixed: vx + older |
| `/student-tools` | vx (current) |
| `/students` | mixed: vx + older |
| `/substitutions` | mixed: vx + older |
| `/teach` | mixed: vx + older |
| `/timetable` | mixed: vx + older |

## Modules — `src/modules/`

| Module | Owner | Layers | README says |
|---|---|---|---|
| `academics` | One | domain, data, ui | — |
| `activity` | ported from Fees | data | The audit feed: who did what, when, and to which record. |
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

`academics` · `accounts` · `admin` · `admissions` · `board-office` · `calendar` · `collect` · `dues` · `exams` · `family-contact` · `fee-setup` · `messages` · `notes` · `payments` · `receipts` · `reminders` · `reports` · `school-office` · `settings` · `smoke` · `staff` · `student-tools` · `system` · `teach` · `timetable`

## Test harnesses

| Where | What | Needs |
|---|---|---|
| `tests/**/*.test.ts(x)` | vitest (`npm run test`) | nothing external |
| `tests/architecture.test.ts` | import/ownership rules, ported-tree fences | nothing external |
| `tests/sql/*.mjs` | migration + grant proofs on in-memory PGlite | nothing external |
| `tests/sql/*.py` | lock/concurrency proofs on a disposable PostgreSQL 17 with two real connections | CI service container or local Postgres |
| `tests/playwright/*.playwright.config.ts` | synthetic browser harnesses (no DB credentials) | Playwright browsers |
| `playwright.config.ts` → `tests/e2e` | workflow suite (`npm run smoke:workflows`) | a database and test accounts — **not** part of `check` |

Synthetic Playwright configs:

`academic-followup` · `academic-ui` · `accountant-dev` · `accountant-mobile` · `cheque-followup` · `class-followup` · `contact-durable` · `contact-genuine-continuation` · `contact-genuine` · `export-followup` · `fee-collector-dev` · `fee-followup` · `login-ui` · `marks-dev` · `marks-mobile` · `mobile-ui` · `module-followup` · `one-polish` · `operations-admin-interruption` · `operations-admin` · `operations-fee-collector` · `payment-draft` · `payment-ui` · `phone-operations` · `pr79-readonly` · `receipt-navigation` · `school-office` · `student-profile` · `student360-mobile` · `student360-sibling`

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
