# VPPS One — progress

**The 4 October plan pack is done: P0–P12 merged and deployed (last: `b16eee0`, #49).**
Its Gate H report is `docs/RELEASE-REPORT-2026-10-04.md`: ready for the bounded
in-app cover pilot in `docs/PILOT-RUNBOOK.md`, and **not** for real WhatsApp,
parent automation or cutover. What waits on the school is listed there under
"Decisions the school still owes"; nothing in it is code. The next code work
is the residual R rows below.
F6 is done — `schoolfees-dev` carries a de-identified replica of the live fee
database (D-186), and `docs/replica-and-smoke.md` is the account of what having
real fee data uncovered. **F7 is done: an accountant posts a payment in VPPS One, and the role boundary holds at the database (D-191).** R3.4 is the next R row and still owes
mock message retry and the S-01–S-09 acceptance pass; precedence on accept is
now in the database (P10a, D-234), which replaces wiring `mayReplace()`.

Use the first actionable row, not the deferred original live-cutover row 7.3.
Phases 0–7 below are historical implementation records and remain intact.
An agent updates its row before it stops. Never delete a row; add `N.x-fix` rows
under the task they fix.

**The design atlas.** `docs/design/` (Ledger Calm 2, v1.0) is the shared UI
reference; its `HANDOFF.md` adds a D0–D5 queue that runs *alongside* the R
queue rather than replacing it. D0–D2 are in the table below. Read
`docs/evidence/D0-2026-09-17.md` before touching a role home: it records which
atlas screens belong to this repo, which belong to `veerpatta/schoolfees`, and
the five places the implementation deliberately departs from the pictures.

Status: `todo` · `in progress` · `pr open` · `done` · `blocked (reason)`

## Plan pack — 4 October 2026 (active)

Raj supplied a planning pack on 4 October (`VPPS-One-Full-Plan.md`, coding
prompts, PDF and a source-evidence archive) and asked for it end to end. Its
tickets P0–P12 run **ahead of** the residual R rows below, which stay open and
are not reset. First slice: absence → valid published cover → staff notice →
teacher acknowledgement (P0–P5). Authorization given before work began: ship
per rule 5, additive `vppsone` migrations on schoolfees-dev, Timetable2025
regular bells as an editable default, admin-only role changes (D-205).

| Task | Bounded deliverable | Gate | Status | Branch / commit / evidence |
|---|---|---|---|---|
| P0 | Baseline, target isolation and a fail-closed client guard; redacted execution manifest | A | done | `p0-p1-isolation-and-authority` · `target-guard.ts`, `scripts/target-guard.mjs` · `docs/evidence/P0-P1-2026-10-04.md` · D-208. The "conflicting" ref `hkkrtspkawifcyqfzltx` exists nowhere |
| P1 | One staff authority, admin-only role/activation, last-admin guard, scoped direct reads, teacher class scope in pages | C | done | same branch · migrations `*_staff_authority_and_scoped_reads`, `*_hide_phone_reason_and_token_columns` · `npm run verify:access` · D-205–D-209. Concurrent last-admin race never run on dev (reason in evidence); D-207 names the fee-role decision needed before cutover |
| P2 | Bell schedule and physical teaching events: joint, parallel cohort and team block; every-member eligibility | B, D | done | `p2-physical-duties` · `domain/events.ts`, `domain/bells.ts`, migration `*_bells_and_team_rules`, `/substitutions/rules` · `docs/evidence/P2-2026-10-04.md` · D-210, D-211. Team rules unset: ELGA stays manual until the school says how many must be present |
| P3 | One atomic, versioned, idempotent "Save absence & arrange cover" command with receipt | E | done | `p3-cover-command` · `commit_cover_command`, `domain/arrange.ts`, new `/substitutions` · `npm run verify:cover` 19/19 · `tests/e2e/cover-workflow.spec.ts` (absence → hand-picked teacher → acknowledge → cannot cover → back at school, in a browser) · `docs/evidence/P3-P5-2026-10-04.md` · D-212, D-213, D-216. Writing the journey found that assigning the current holder never pinned her |
| P4 | Staff notice outbox: intents, leased attempts, current-state recheck, Unknown, mock transport | F | done | same branch · `staff_notice_attempts`, claim/stamp/finish/sweep/reconcile, `staff-notices/` · `npm run verify:outbox` 11/11 · D-214. Real AiSensy campaign not created or verified (provider gate) |
| P5 | Teacher duty loop: Today + link to one authenticated duty, Acknowledge, Cannot cover, escalation | G | done | same branch · `/duty/[id]`, `respond_to_cover_duty`, Today card · D-215. Physical phone and teacher trials not run (R8.3) |
| P6 | Attendance: effective roster, explicit whole-roster save, half-day, receipt recovery | — | done | `p6-attendance` · `save_attendance_register`, `attendance_register_revisions`, `attendance_rules`, dated `attendance_roster()`, reminder via the outbox · `npm run verify:attendance` 22/22 · `tests/e2e/attendance-register.spec.ts` · `docs/evidence/P6-2026-10-04.md` · D-217–D-222. Subject teachers no longer take a class's daily register (plan rule); phone trials not run (R8.3) |
| P7 | Marks: blank/zero/absent/exempt distinct, draft then submit | — | done | `p7-marks` · `save_marks`, `marks.exempt`, paper scheme (step, exemption), `marks_commands`, `paper_roster()` · `npm run verify:marks` 23/23 · `tests/e2e/marks-entry.spec.ts` · `docs/evidence/P7-2026-10-04.md` · D-223–D-225. Only the assigned subject teacher or the exam office enters a paper now; the school's scheme and bands are P8's to confirm |
| P8 | SA1 reports: scheme, completeness, immutable issued revision | — | done | `p8-reports` · `report_schemes`, `report_card_issues`, `issue_report_card`, `/assessments/scheme`, Draft marking · `npm run verify:reports` 14/14 · `tests/report-scheme.test.ts` · `tests/e2e/report-issue.spec.ts` · `docs/evidence/P8-2026-10-04.md` · D-226–D-229 (set-up strings moved to `src/messages/setup.ts` to keep `/students` inside its bundle budget). The school's own SA1 scheme (bands, rounding, pass rule, header, signatories) is unconfirmed — defaults until the exam office approves its own |
| P9 | Parent message policy: approval by default, stale approval blocked | — | done | `p9-parent-policy` · `parent_message_policies`, `parent_route_flags`, snapshot and stale columns on `message_sends`, `/collection/policy` · `npm run verify:parent-policy` 15/15 · `tests/parent-policy.test.ts` · `tests/e2e/parent-messages.spec.ts` · `docs/evidence/P9-2026-10-04.md` · D-230–D-232. Every category needs approval and `parent_dispatch` is off; no school-approved automatic exception exists, and report and absence messages are not queued anywhere yet |
| P10 | SamPark residual parity (R3.4/R4) | — | done | **P10a merged** (`f3bb72e`, #48): one writer `write_student_value`, `student_record_history`, `accept_submissions` · `verify:records` 19/19 · D-233–D-234. **P10b/P10c/P10d merged** (`b16eee0`, #49): SamPark workbook import by ids with the identity queue (`/collection/import`, `apply_sampark_import`, `resolve_sampark_row`), photographs (`/collection/photos`, `place_student_photo`, private bucket) · `verify:sampark-import` 17/17 · `verify:photos` 9/9 · `docs/evidence/P10bc-2026-10-04.md` · D-235–D-236. **P10d**: students and round workbooks (`/collection/export/students`, `/collection/rounds/[id]/export`), every cell text, counts inside, logged · `tests/workbook.test.ts`, `tests/e2e/workbook-export.spec.ts` · D-237. Open: teacher photo capture by link, the general student import, identity/source health |
| P11 | Archive catalogue and restore drill | — | done | `b16eee0` (#49) · `vppsone.archives`, `restore_drills`, private `vppsone-archives` bucket, `archive_table_export` / `restore_drill_table`, shared `archive-engine.ts`, `/archives` · `npm run verify:archive` 10/10 (66 tables, 4,530 rows, 5 files; four kinds of tampering caught) · `tests/e2e/archive-drill.spec.ts` · `docs/ARCHIVE.md` · `docs/evidence/P11-2026-10-04.md` · D-238. Off-site copies stay manual until the school authorizes a destination; archives are made by hand |
| P12 | Release report, pilot runbook, hosting decision inputs | H | done | `b16eee0` (#49) · `docs/RELEASE-REPORT-2026-10-04.md` (Gate H: ready for the bounded in-app cover pilot; not for real WhatsApp, parent automation or cutover), `docs/PILOT-RUNBOOK.md`, `docs/HOSTING-DECISION.md` · `npm run verify:fee-parity` 7/7 against `docs/evidence/fee-contract-baseline.json` (505 fee objects) · the migration boundary test · `verify:cover` gains the operator-switch check (20/20) · D-239. Never run: real devices, the provider gate, synthetic fee postings for the behavioural fee regressions and rollback drill, a fresh-project restore |

## Revision 2 — active queue (2026-09-17)

Planning delivery: updated PLAN, parity register, QA protocol, verified baseline,
kickoff and aligned entry documents. Branch `main`; identify this documentation
commit through git history. Baseline application commit `0712de6`. No R-phase
implementation is claimed. See `QA-BASELINE-2026-09-17.md` for executed checks.

| Task | Bounded deliverable | Depends on | Status | Branch / commit / evidence |
|---|---|---|---|---|
| R0.1 | Complete source parity inventory, verify app/test origins and record baseline defects/metrics | Existing source + baseline | done | `r0-1-parity-and-origins` · `f6327b3` ([#17](https://github.com/veerpatta/vppsone/pull/17)) · `docs/evidence/R0.1-2026-09-17.md`, `docs/evidence/R0.1-origins-2026-09-17.json`, `npm run verify:origins` |
| R0.2 | Deterministic six-role + second-teacher fixtures, run-scoped reset and mock provider | R0.1 | done | `r0-2-fixtures` · `8f78782` ([#18](https://github.com/veerpatta/vppsone/pull/18)) · `npm run qa:seed`/`qa:reset`/`qa:status` · `docs/evidence/R0.2-2026-09-17.md` |
| R0.2-fix | B-21: the teacher's Today card called her first lesson "Period 0" | R0.2 | done | `r0-2-fixtures` · `8f78782` ([#18](https://github.com/veerpatta/vppsone/pull/18)) · `src/modules/timetable/domain/periods.ts`, `tests/periods.test.ts` |
| R0.3 | Independent access expectations; smoke timeouts/counts/results; first teacher and office browser journeys | R0.2 | done | `r0-3-expectations-and-journeys` · `01da4d4` ([#19](https://github.com/veerpatta/vppsone/pull/19)) · `npm run smoke:workflows` · `docs/evidence/R0.3-2026-09-17.md`, `docs/evidence/R0.3-smoke-roles-2026-09-17.json` |
| R1.1 | App registry, Apps hub, original SamPark/School Fees home shortcuts and verified context links | R0.1 | done | `r1-1-app-registry` · `76bba63` ([#20](https://github.com/veerpatta/vppsone/pull/20)) · `src/platform/config/apps.ts`, `/apps` · `docs/evidence/R1.1-2026-09-17.md` |
| R1.2 | Role home resolver, role-priority phone nav, grouped desktop sidebar and aliases | R1.1 | done | `r1-2-role-navigation` · `d3eca8e` ([#21](https://github.com/veerpatta/vppsone/pull/21)) · `homeFor()`, `NAV_PRIORITY`, `sidebarFor()` · `docs/evidence/R1.2-2026-09-17.md` |
| R1.3 | Shared form/state components, language preferences and responsive design baseline | R1.2 | done | `r1-3-shared-states` · `3aa251f` ([#22](https://github.com/veerpatta/vppsone/pull/22)) · `authored.ts`, `AuthoredText`, `/preferences`, `class-order.ts` · `docs/evidence/R1.3-2026-09-17.md` |
| R2.1 | Teacher Today priorities, assigned requests and class shortcuts | R1.3, R0.3 | done | `r2-1-teacher-today` · `6fde807` ([#23](https://github.com/veerpatta/vppsone/pull/23)) · `lessonsToday()`, `nextAction()`, `TaskHero` · `docs/evidence/R2.1-2026-09-17.md`. Assigned requests deferred to R3.3 with the inbox they need |
| R2.2 | Office/admin, academic/exam coordinator and viewer homes with real queues | R1.3, R0.3 | done | `r2-1-teacher-today` · `6fde807` ([#23](https://github.com/veerpatta/vppsone/pull/23)) · `attention.ts`, `home-repo.ts` · `docs/evidence/R2.2-2026-09-17.md`. Exam coordinator queue deferred to R5.3 with the counts it needs; no fee summary until R6 |
| R2.3 | Student directory and shared summary, source labels, persistent search/session context | R2.1, R2.2 | done | `r2-3-directory` · `/students`, `directory.ts`, source badges, fee context link · `docs/evidence/R2.3-2026-09-17.md`. Detail screen stays at `/teach/student/[id]` until R4.1 moves it with an alias |
| R3.1 | Additive rounds, frozen membership/value snapshots, identity mapping and audience domain | R0, R2.3 | done | `r3-1-rounds` · `652393c` ([#25](https://github.com/veerpatta/vppsone/pull/25)) · `collection_rounds`, `collection_request_members`, `audience.ts`, `external_student_ids` · `tests/e2e/collection-freeze.spec.ts` · `docs/evidence/R3.1-2026-09-17.md`. Rounds and mapping are schema with no writer yet: the wizard is R3.2, the fan-out R3.3, the matcher R4.1 |
| R3.2 | Audience/fields/preview wizard, gap filters and Excel ask-list matching with notes | R3.1 | done | `r3-2-round-wizard` · `4668104` ([#26](https://github.com/veerpatta/vppsone/pull/26)) · `/collection/rounds`, `rounds-repo.ts`, `gaps.ts`, `ask-list.ts` · `tests/e2e/{round-wizard,ask-list}.spec.ts` · `docs/evidence/R3.2-2026-09-17.md`. A round mints no links yet (R3.3). House and route audiences are resolvable and not offered: both columns are empty on dev and rule 2 forbids filling them (B-31), and nothing holds house/route ownership (B-32) |
| R3.3 | Teacher fan-out, master/office links, completion board and resume | R3.2 | done | `r3-3-fan-out` · `fbcfb4a` ([#27](https://github.com/veerpatta/vppsone/pull/27)) · `staff_scopes`, `ownership.ts`, `fan-out.ts`, `fan-out-repo.ts`, `RoundBoard` · `tests/e2e/fan-out.spec.ts` · `docs/evidence/R3.3-2026-09-17.md`. Nothing is sent: the board records what the office did in WhatsApp itself (D-10). No per-group override yet (B-35); house and route rounds still undemonstrable on dev data (B-31) |
| R3.4 | Round-aware review/precedence/superseding and mock message retry; S-01–S-09 acceptance | R3.3 | in progress | `r3-4-review-precedence` · `precedence.ts`, round context on the queue, staleness and superseding · `tests/e2e/review-precedence.spec.ts` · `docs/evidence/R3.4-2026-09-17.md`. **Still owed: mock message retry, the S-01–S-09 acceptance pass, and wiring `mayReplace()` into accept** |
| R4.1 | Student source/health tools and resumable import preview/error handling | R3.4 | todo | — |
| R4.2 | Student photo capture/retake/replace, bulk filename matching and office-assisted workflow | R4.1 | todo | — |
| R4.3 | Documents, workbook export and residual S-12–S-14 source parity | R4.2 | todo | — |
| R5.1 | Attendance UX, durable/account-scoped drafts, corrections and atomic save recovery | R2, R0.3 | in progress | Draft/recovery/UI portion shipped in R7-smooth; complete correction/concurrency acceptance remains |
| R5.1-fix | Independent attendance recovery, pending-correction visibility, refusal handling and queue warnings | R5.1 | released; acceptance partial | [PR #66](https://github.com/veerpatta/vppsone/pull/66), main `585e593f4118d163344a8de2aa647866d642c079`; review CI 38109919157 and main CI 38110232040 passed, matching Vercel production READY. No DB writes or migration approval. Physical/authenticated acceptance remains open. |
| R7.1-fix | Student 360 streamed fee errors remain distinct from absent records, with retry | R7.1 | released; acceptance partial | [PR #66](https://github.com/veerpatta/vppsone/pull/66), main `585e593f4118d163344a8de2aa647866d642c079`; 12,239 tests/126 files, 74 responsive browser cases, four payment-draft cases and build/budgets passed. Hosted commit verified; see `docs/evidence/independent-release-integration-2026-10-11.md`. |
| R5.2 | Timetable/cover usability, atomic publication and stale/concurrent plan handling | R5.1 | todo | — |
| R5.3 | Marks entry/paste/history, report readiness and print; atomic/versioned saves | R5.2, R4.3 | in progress | Scoped draft/recovery and submit-time payload shipped in R7-smooth; paste/history/report/versioning acceptance remains |
| R6.1 | Complete all F-row fee destinations and verify authentication/context/environment handoff | R1.1, R2.3 | todo | — |
| R6.2 | Reconcile fee summaries and validate original workflows in verified fee test environment | R6.1 | todo | Record unavailable sandbox as an evidence gap, never use live writes |
| R7.1 | Measure and optimize query/render/bundle/image/save hotspots; before/after evidence | R3–R6 | in progress | Bounded shell/directory/form work measured in R7-smooth; remaining workflow/image hotspots and field acceptance are open |
| R7.2 | Full responsive/language/keyboard/accessibility pass and performance budgets | R7.1 | todo | Partial performance/PWA work in R7-smooth below; the full atlas state matrix remains owed |
| R7-smooth | Requested desktop/mobile smoothness, installability, scoped drafts and measured performance | User request | done | `perf/installable-workspace` · `2c9ef2f` / `741318f` · [PR 39](https://github.com/veerpatta/vppsone/pull/39) · D-201–D-203 · `docs/evidence/smoothness-2026-10-01.md`; does not close all R5/R7/R8 parity work |
| R7-smooth-fix | Payment draft key readiness, switching/reload recovery and honest warning | R7-smooth | pr open | `fix/payment-draft-recovery`; implementation `d947828619bf3de107cae3064206618f72e91d63`; [draft PR 40](https://github.com/veerpatta/vppsone/pull/40); D-204; `docs/evidence/payment-draft-recovery-2026-10-01.md`. All required local gates and four Chromium journeys passed; explicit release approval remains outstanding |
| R8.1 | Full deep smoke matrix; fix P0/P1 with regression and cleanup evidence | R7.2 | todo | — |
| R8.1-smoke-fix | Requested test-data rule/workflow smoke, responsive feedback and query latency fixes | User request, 5 October | done | [PR 52](https://github.com/veerpatta/vppsone/pull/52), [PR 54](https://github.com/veerpatta/vppsone/pull/54), [PR 55](https://github.com/veerpatta/vppsone/pull/55) · code merged/deployed at `8c5dbe5`, `bom1` · D-240–D-247 · CI 10,074 tests/94 files; 12 rule commands plus 17 recovery API assertions; all 76 browser workflows covered, five final live checks passed · final live role matrix 784/784, account sweep 991 cases, zero broken screens/missing fixtures; inert fixtures removed and checked · native recovery migration `20261006043431` applied on dev, 505 public fee objects unchanged · live p50 `/teach` 3127→573ms, `/dashboard` 2048→585ms, `/fees/payments` 2427→791ms · `docs/RELEASE-REPORT-2026-10-06.md` and dated evidence · Surprise: layout redirects did not stop concurrent fee-page background work; shared native fee guard now stops it, with zero error/fatal logs after the final sweep. Field CWV, physical acceptance and occasional latency spikes remain open |
| R8.1-pdf-fonts | Live smoke, 10 October: every PDF returned 500 on production | User request, 10 October | done | [PR 57](https://github.com/veerpatta/vppsone/pull/57), `1bbcf87`, [PR 58](https://github.com/veerpatta/vppsone/pull/58) · deployed at `bc0e2bf`; live receipt PDF 200 `application/pdf` 70 KB at 17:15 UTC · `claude/project-thread-byaizq` · write flows (payment, note) and desktop/phone crawls of all 10 accounts clean except PDFs; receipt PDF, WhatsApp receipt attachment, fee statements and collection lists failed with MODULE_NOT_FOUND because pdfkit loads `#standard-fonts/*` through a subpath import file tracing does not follow, those files require `./chunks/`, and `document-kit.tsx` reads `public/fonts/*.ttf` and two branding PNGs off disk, which Vercel keeps out of functions · fix: `outputFileTracingIncludes` for all of them on every route (the comment in document-kit said this include existed; it was never ported into next.config) · Surprise: each fix exposed the next missing file, three in a row. One ₹100 dev test receipt SVP20261010-0001 left unreversed |
| R5.1-no-approval | Attendance corrections need no admin approval, and class teachers have no time limit | User request, 11 October | done | `remove-attendance-approval` · [PR 71](https://github.com/veerpatta/vppsone/pull/71) · D-248 · removed the 30-minute change window (both server actions and the teacher screen), the "Ask the office" sheet, `/teach/corrections`, the coordinator's Changes tab, Needs-you correction items and their counts. A class teacher picks a reason in the save sheet. No migration: the window was app-only, and `attendance_corrections` stays as history. Surprise: the first diagnosis was wrong. On the old screen a class teacher could already correct directly; the approval came from the new vx screen merged the same day |
| R7-whole-student | 11 Oct improvement notes: payment desk trust, Students views, Student 360 overview, scoped notes, Today around the school day | User request, 11 October | done | [PR 73](https://github.com/veerpatta/vppsone/pull/73), [PR 74](https://github.com/veerpatta/vppsone/pull/74) · D-249–D-260 · no migration. Payment form 541/553px at 1100/1440px (was ~228px); review step, uncertain-save check by request id, Overdue/Due today/Upcoming; School view default with attendance and badges; provisional term label; notes scoped to a child; Scheduled now. Surprise: the profile's Notes tab had been empty since 10 Oct (ambiguous author embed). Open: fee-collector posting (D-259), marks finalisation and bulk approvals wait on the notes' §10 decisions, and the row click/scroll return were checked in code, not visually |
| R7-whole-student-2 | The notes' remaining items, built with defaults: fee collectors post payments (D-261), admin finalises marks (D-262), bulk decide of ticked changes (D-263), health/family notes scoped (D-264), family contact outcomes (D-265), support actions worked in Student 360 (D-266), teacher roster badges and named reviews on Today (D-267), attendance/Year Clear answers (D-268); live-check fixes D-270 to D-272 | R7-whole-student | done | PR #75 merged as `f160533`, then a follow-up PR for D-270 to D-272. Migrations `20261011090858`, `20261011091243`, `20261011092957` applied to schoolfees-dev, and the dev fee DB grants fee collectors posting. Live check on 11 Oct: row click and scroll return pass on desktop and phone; Today timetable right at a set test time; Student 360 and teacher badges pass; the QA fee collector posted ₹100 cash (SVP20261011-0001) on dev. That check found the automatic WhatsApp receipt attempt (D-270, nothing reached anyone: no provider key), the stale balance on the printed receipt (D-271) and the clock and Accounts gaps (D-272). Still owed at cutover: `docs/cutover/fee-collector-posts-payments.sql` on the live fee DB. Search text typed but not submitted is lost on Back |
| R8.2 | CI/main/deployment verification, parity closure and rollback report | R8.1 | todo | — |
| R8.3 | Timed teacher/office/admin and physical Android/webview/camera/print acceptance | R8.2 | todo | Code-delivered and staff-accepted are separate if physical evidence unavailable |

### Design atlas queue (`docs/design/HANDOFF.md`)

Runs alongside the R rows above; it does not replace them. D3 is deliberately
not a row of its own — the handoff's own table maps each of its slices onto
R2–R8, so those rows own it.

| Task | Bounded deliverable | Depends on | Status | Branch / commit / evidence |
|---|---|---|---|---|
| D0 | Delta audit: atlas vs built, persona→role map, repo ownership per screen, deviations | R1–R3 as merged | done | `d1-d2-role-homes` · `docs/evidence/D0-2026-09-17.md` |
| D1 | Shared foundation the role homes need: two-column desktop layout, page eyebrow and desktop title scale, labelled progress bar, signed-in identity in the top bar, wider shell | D0 | done | `d1-d2-role-homes` · `HomeColumns`, `ProgressRow`, `PageHeader` `eyebrow`, `max-w-7xl` · `docs/evidence/D1-D2-2026-09-17.md` |
| D2 | Role homes with real data: accounts staff start in School Fees, teacher opens her class/day, admin gets the combined overview; office/coordinator/viewer preserved | D1 | done | `d1-d2-role-homes` · `start.ts`, `overview.ts`, `schoolOverview()`, `/preferences` start form · `tests/e2e/role-homes.spec.ts` · `docs/evidence/D1-D2-2026-09-17.md` |
| D2-fix | B-38: an issued link carrying a query string 404ed. B-39: `/\host` passed the redirect check. B-40/B-41: the workflow suite's own fragility — a 58 s test against a 60 s timeout, and three teardowns that leaked three requests a run | D2 | done | `d1-d2-role-homes` · `isSafeInternalPath()`, `/auth/confirm`, `removeRound()` · `tests/env.test.ts`, `tests/e2e/role-homes.spec.ts` |
| D3 | The design language on every screen: shared panel/row/footnote/state kit, page eyebrows across the app, row lists converted | D2 | done | `d3-design-language` · `src/ui/panel.tsx`, `StateCard`, 37 eyebrowed headings · `docs/evidence/D3-2026-09-18.md`. Its per-workflow slices stay owned by the R rows the handoff names |
| D3-fix | B-42: the first `Panel` rendered lists as `<div>`s, so a register was fifteen unrelated paragraphs to a screen reader. B-43: `HomeColumns` changed element type when its aside went away, remounting the register form and losing the "Saved" acknowledgement | D3 | done | `d3-design-language` · `Panel` is a `<ul>`, `PanelRow` an `<li>`, `HomeColumns` keeps one wrapper · both caught by `tests/e2e/teacher-attendance.spec.ts` |
| D4 | Deep interaction and visual QA across the atlas's full state matrix | D3, R5 | todo | Partial pass recorded in `docs/evidence/D1-D2-2026-09-17.md` and `D3-2026-09-18.md`; the rest belongs with R7.2/R8.1 |
| D5 | Design deviations and status folded into the release report | D4, R8.2 | todo | Deviations recorded in D0; the report is R8.2's |

## The School Fees port (F rows)

Janmejay's call, 18 September 2026, after the conflict with CLAUDE.md rule 2
was put to him: *"eventually the vpps one will become the main app for all and
we will close fees app once the vpps one is complete... the accountant should
see the exact fee app as now in vpps one, nothing changes same as fee app, you
literally copy paste exact code for accountant user."*

So the fee app is ported in, not linked to. Branch `port-fee-app`.
This supersedes the working interpretation in PLAN §1 and selects the
alternative PLAN §9 left open. R6 (the launcher-based handoff) is reduced to
whatever still needs a link after the port, and is not yet revisited.

| Task | Bounded deliverable | Status | Evidence |
|---|---|---|---|
| F1 | Tailwind v3 + the fee app's tokens, config and globals | done | `a9cda27` · `npm run check:theme` compares 430 tokens against the sibling repo |
| F2 | The fee build configuration: staleTimes, dynamicOnHover, React Compiler, 12 dependencies | done | `8f235a3` · `next build --webpack` |
| F3 | One role model and one language across both vocabularies | done | `9fead20` · `fee-roles.ts`, the session shim, `i18n/bridge.ts`, migration `20260918043934` · `tests/{fee-roles,i18n-bridge}.test.ts` |
| F4 | The port itself — 709 files, 20 modules, 48 screens, 16 API routes | done | `4335eb8` · `scripts/port-rewrite-imports.mjs`, `npm run check:port` |
| F5 | One shell, fee tabs in the navigation map, fee routes reachable | done | `9c8f52d` · `DashboardShell` takes items; `money` group in `navigation.ts` |
| F5-fix | Production-only render failures and two pieces of stale copy | done | `9e743ed` · icons resolved client-side, the fee providers mounted, `public/` copied |
| F6 | Fee test data on `schoolfees-dev`, so the fee screens can be exercised at all | done | `scripts/replicate-live.mjs` · a de-identified replica of live: 11,295 rows, 34 tables, money exact to the rupee, every person replaced (D-186) |
| F7 | Timed accountant walkthrough against real fee configuration | done | Receipt SVP20260922-0002 posted through the desk; `current_staff_role()` falls back to `vppsone.staff_profiles` (D-191, migration `20260922100000`) |
| F13 | The Payment Desk broke on the first payment of each day | done | `cookies()` inside `unstable_cache()` from `getReceiptReversalTotals`, hidden by an early return that an empty day always took (D-192) |
| F14 | An over-long PostgREST URL is refused at once, not after eight seconds | done | `createGuardedFetch` on both admin clients (D-193) · `tests/guarded-fetch.test.ts` |
| F10 | The academic session was read by sorting the labels, in six places | done | `pickSessionLabel()` + `tests/active-session.test.ts` (D-187) · every register, mark and cover plan would have worked in the rehearsal session on live |
| F11 | A `.in()` list of more than ~300 ids fails silently after eight seconds | done | `platform/helpers/in-filter.ts` · the defaulters queue went 16,000ms to 880ms and stopped hiding four columns of data |
| F12 | The fee matviews had no grants in dev, so the Payment Desk 503ed for everybody | done | Mirrored from live, deliberately not a migration (D-189) |
| F8 | Decide what an installed VPPS One is, then switch the PWA on or delete it | done | `perf/installable-workspace` · [PR 39](https://github.com/veerpatta/vppsone/pull/39) · D-201/D-202 · Neutral installed workspace; browser-tested offline fallback, draft recovery and deliberate updates. See `docs/evidence/smoothness-2026-10-01.md`. Physical installation acceptance remains R8.3 |
| F8-fix | The proxy auth-redirected `manifest.webmanifest` and `offline.html` | done | `31c102a` ([#33](https://github.com/veerpatta/vppsone/pull/33)) · found by probing the deployed site; `src/proxy.ts` excludes them, and `branding/`, now |
| F9 | Merge and deploy | done | `cd4d1e2` ([#32](https://github.com/veerpatta/vppsone/pull/32)) and `31c102a` ([#33](https://github.com/veerpatta/vppsone/pull/33)) · live at `vppsone.vercel.app`, verified signed in |
| F9-fix | B-44: the administrator's home said 19 registers outstanding on a Sunday | done | `31c102a` · `schoolOpenToday` reaches `attention.ts`; `tests/attention.test.ts` |

### F6 is done, and what doing it uncovered

`schoolfees-dev` now carries a de-identified replica of the live fee database:
11,295 rows, 34 tables, the money exact to the rupee and every person replaced
(D-186). `npm run replica:load`, and `docs/replica-and-smoke.md` is the full
account.

Having fee data to reach the code with is what made the next three findings
possible, and none of them could have been seen without it:

- **The academic session was chosen by sorting the labels**, in six places
  including `resolveSessionLabel()` and its 92 callers (D-187). `TEST-2026-27`
  sorts above `2026-27`, and live has carried that rehearsal session for months
  — so on live every register, mark and cover plan would have worked in the
  rehearsal year, silently. Fixed, with `tests/active-session.test.ts`.
- **A `.in()` list over ~300 ids fails silently after eight seconds**, and the
  school has 583 active children. The defaulters queue took 16 seconds and hid
  four columns of data. Now 880ms. `platform/helpers/in-filter.ts`.
- **An accountant could not post a payment at all** (D-188). `has_permission()`
  reads `public.users`, and VPPS One accounts have no row there by design — so
  the RPC refused the cookie client and the service-role client alike. Sixteen
  of the eighteen fee RPCs are gated that way. **Fixed** (D-191):
  `current_staff_role()` now falls back to `vppsone.staff_profiles`, which the
  fee database was already prepared for — `public.staff_role` carries all eight
  VPPS One roles and `has_permission()` already had an arm for each.
- **The Payment Desk broke on the first payment of each day** (D-192), and only
  then: `cookies()` inside `unstable_cache()`, reached through an early return
  that an empty day always took. Fixing the `.in()` bug is what exposed it.

### What is verified, and what is not

**Verified.** `npm run check` green: typecheck, lint, 430-token theme parity,
the import codemod, 7,825 unit tests, production build. `npm run
smoke:workflows`: **42 of 42**, including the teacher attendance journey that
previous runs had only ever skipped because the day was a Sunday.
`npm run smoke:roles`: **728 of 728**, and for the first time that number
includes the 48 ported fee screens — the matrix could not see their guards
before. `npm run smoke:deep`: **921 cases** across all eleven accounts, zero
crashes, with per-screen timings.

**Seen in a browser on a production build.** As the QA teacher: Class 1, 39
children, 8 periods and the register waiting — the screen that read "आपकी कक्षा
—" with 0 children before the session fix. As the QA accountant: the Payment
Desk loading a real child with ₹58,500 across five instalments, ₹44,500 of it
overdue, masked name and phone throughout.

**Posting a payment is verified.** Receipt SVP20260922-0002, ₹7,500 cash,
posted through the Payment Desk as the QA accountant, `created_by` the real
person, the ledger moving ₹58,500 → ₹51,000, and the same `client_request_id`
sent twice producing exactly one receipt. Undo, late-fee waiver and repayment
plans were each asked of a role that may and a role that may not.

**Not verified.** Refunds, which need a refund request to exist first, and the
WhatsApp reminder run, which is deliberately disabled in this app.

### B-44 — the number that only appears at the weekend

The administrator's home read **19 registers outstanding, whose work: teachers**
on a Sunday. `registersOutstanding` was `classesTotal - submitted` with no
question about whether the school was open, so a day when nobody takes a
register counted every class as owing one. Wrong every weekend since R2.2, and
invisible because the arithmetic is right and the question is wrong.

D-101 is the same question in the nightly job, fixed there in 7.4. This was the
second copy of it. It was found by opening the deployed site, not by a test —
which is the argument for doing that at all.

**Not verified.** Every fee workflow (F6). The `accountant` and `fee_collector`
QA accounts are in the fixture list but have not been seeded, so neither role
has been signed in as — the fee screens above were read as `admin`. Physical
device, printer and WhatsApp paths are untouched, as before.

### Two things about the suite itself

`reuseExistingServer` is **false** now. It let Playwright attach to whatever
was already on 3100, including a server started before the build under test —
three specs "failed" that way, each waiting sixty seconds for an element that
was on the page, and the run took 17 minutes instead of 3. The same trap cost
a debugging session in D3. A failure that looks identical to a real one is
worse than a slow suite.

`tests/e2e/warm-server.ts` loads the heavy route module graphs before the first
test's clock starts. It was written for the wrong reason — the stale server was
the actual cause — but it is kept: after the port a cold signed-in render is a
real cost, and paying it once outside anybody's budget is cheaper than a longer
timeout in all 42.

### R0.1 — what it found

The parity register is complete: 14 SamPark rows and 12 School Fees rows now
carry source file, current state, destination, roles and owning phase, with
S-12–S-14 subfeatures named and their deferrals recorded.

Three findings change later tasks:

- **The fee app is at `vpps-one.vercel.app`.** `schoolfees.vercel.app` is a
  different company's product answering 200, and `sampark.vercel.app` errors.
  Both are now refused by `tests/app-origins.test.ts`, and the three real
  origins are re-checkable with `npm run verify:origins` (B-15).
- **There is no staff-reachable test origin for either sibling.** School Fees
  previews do run on schoolfees-dev but sit behind Vercel SSO; SamPark has no
  test deployment at all. R6.2 as written cannot be executed until somebody
  creates one — recorded as a gap, not worked around (B-16).
- **The QA teacher holds no class.** `qa.teacher@qa.vpps.local` has zero
  teaching assignments, so every "teacher" row in the 216-combination smoke is
  a result about an empty teacher. R0.2 has to fix the fixtures before any
  teacher workflow can be said to pass (B-17).

Also: B-06 is five screens, not one — `/collection`, `/assessments/[id]`,
`/timetable`, `/teach/attendance` and `/teach/register` all sort class labels
with `localeCompare` and all ignore the `sort_order` column that already
exists. Baseline for the R7.1 ratchet is **1,293.2 KB of client JS in 37 files**.

### R0.2 — what a working teacher fixture found in the first minute

Nine accounts now, from one list the seeder, the role smoke and `dev:login` all
read; three files used to keep their own copy. The two teaching accounts are
bound to teachers the **published timetable already knows**, chosen by rule
rather than by a name in the repository — most periods, ties by short name, and
the second must share no class with the first. On this data that is a primary
teacher (Classes 1–5, now class teacher of Class 1) and a secondary teacher
(Classes 6–12, now class teacher of Class 7).

Every write records its previous value in `vppsone.qa_undo`, so `qa:reset` puts
back rows the fixture did not create — which it has to, because binding a login
to an existing profile is the only way to give it a day. Proved by running it:
11 steps out, 11 steps back, database identical, then 11 steps out again with
the same two teachers.

**B-21, found and fixed the moment a teacher had a period to render.** The
Today card printed `timetable_slots.period` raw, and that column is 0-based —
so a teacher's first lesson of the day read "0" and her last read "7". Six
other screens each remembered to add one; this one, the screen she opens every
morning, did not. It had been shipping since Phase 3.1 and no test could reach
it, because the only teacher account had no periods at all. `periodNumber()` is
now the only place the off-by-one lives, and `tests/periods.test.ts` refuses
both shapes that caused it.

**B-20 raised, not fixed**: the same card lists 20 rows for an eight-period day,
because a parallel subject taught to five classes at once is five slots and
renders as five lines. The teacher is in one room. How a combined period should
read is R2.1's decision, not a patch in passing.

`dispatch()` now goes through a typed provider adapter. `MESSAGE_PROVIDER=mock`
decides from the destination's last digit — 5 slow, 6 timeout, 7 rate-limited,
8 server error, 9 duplicate with a stable id — and is refused on a live
deployment. Mocked sends carry a `mock:` prefix into
`message_sends.provider_message_id` so they can never be read as real ones.

Still open from this row: a 40-child class and a 1,205-row student list cannot
be fixtured from here, because the roster is the fee app's and rule 2 forbids
writing it (B-18).

### R0.3 — a third reading, and a smoke that can fail

`smoke:roles` was comparing two things that come from the same place: the
permission each page's guard names, and what the map says that implies. A page
asking for the wrong permission agrees with itself.
`tests/fixtures/role-expectations.ts` is the second opinion — 36 routes read
out of PLAN §3 by hand, each with the sentence it comes from. A screen
disagreeing with the map is a failure; the map disagreeing with the plan is a
**drift**, which has to be owned in that file by name or the run fails.

**B-22, found on the first run.** `view_only` holds `attendance:view`, so it
can open the register form, a class's roster, the corrections queue, the
monthly register and a child's card — every one an editable form or a list of
named children, which PLAN §3 gives the viewer neither of. It also puts a Teach
tab on a viewer's bar leading to an empty teacher workspace. Owned by R1.2,
which is where the role navigation lives; `smoke:roles -- --strict` is what
that task turns on when it is resolved.

The runner also fails now, which it could not before: a missing fixture is a
failure rather than a shrug, a hung case has a 20-second deadline, and a run
that executed fewer combinations than it set out to refuses to print a pass.
All three were tried against the broken state before being trusted.

**Two browser journeys** (`npm run smoke:workflows`, Playwright against a
production build). A teacher takes her register — all present, two exceptions,
save, reload, submit again, and the class disappears from Today — with every
step asserted against the rows rather than the toast. The office asks for a
number, finds the draft link answers 404 until it is opened, watches a
nine-digit number leave the Send button disabled with no row written, saves a
real one, re-answers it and sees the replacement in the review queue — the last
part in a browser context with no session at all.

The first teardown was wrong in a way worth keeping: it assumed the register
was the test's own. **A register for today already exists** — the
`open-registers` job opens one per class every morning — so the run left Class
1 submitted and the next one failed with "there is nothing to do today". It
snapshots and restores now.

**B-23 raised**: `Section` renders a bare `<section>` with an `<h2>` inside
and no `aria-labelledby`, so every landmark on every screen is unnamed.

### R1.1 — the way to the other two apps

`src/platform/config/apps.ts` is the registry PLAN §2 asks for: stable ids,
the names staff already use with what each app is *for*, the destination's own
environment, who is offered it, and an allow-list of paths. Two properties do
the work.

**Nothing else in `src/` may write a sibling hostname.** A test scans every
source file outside the two config files for a `vercel.app` host and fails on
a match, because two of the three a reader would guess are wrong and one is a
different company's product (B-15).

**No link carries an id across a dataset boundary.** This app is on
schoolfees-dev and both siblings are on live data, so a student link falls back
to the destination's own search screen instead of a URL that would 404 with a
child's name on it. It flips to a detail link the moment the two sides match,
and a test asserts both halves. SamPark never gets one in either direction: it
keeps its own text ids, and mapping them is R3.1's work (S-10).

`/apps` is guarded on a new `apps:view`, which admin and office hold. Every
card carries **its own** environment badge — both read "live data" while this
app's header reads "test" — because PLAN §2 is explicit that one badge must
not be read as covering all three. Each says a separate sign-in may be needed;
same Supabase project is not a shared cookie and SamPark is a different auth
stack. Ordinary links in the same tab, so Back works.

Both apps also sit on the office and admin home, above the list of screens,
with their hostnames printed.

Still true after this: **`/apps` is not on the office bottom bar.** Office may
open ten screens, the bar holds five, and the shared order leads with Teach and
Cover — which is B-04, and R1.2 owns it. The More hub and the home shortcut
cover it meanwhile.

### R1.2 — where each role starts, and what its thumb reaches first

`homeFor(role)` gives a teacher `/teach` and everybody else `/dashboard`, and
it is applied at every landing: `/`, both login doors, `/auth/confirm`, the
school-name link and the Go home button. `admitSignedInUser()` hands the role
back with the admission, because the fallback can only be resolved once the
profile is known and reading it twice is two chances to disagree. A teacher
signing in now lands on her day with the register as the first thing on the
screen; before this she landed on a card showing her own email address (B-03).

**B-04 closed.** One shared order gave every role Home, Teach, Cover,
Timetable, Exams — so the office reached SamPark through More, behind three
screens it does not use, and R1.1's Apps tab never appeared on its bar at all.
`NAV_PRIORITY` is an ordered row per role following PLAN §3's navigation
column. Where a screen the plan names does not exist yet the row is simply
shorter; nothing is invented to fill a gap.

**B-22 closed.** `view_only` held `attendance:view`, which guards six screens
that are each an editable form or a list of named children — neither of which
PLAN §3 gives that role. The permission is gone; the attendance *figures* the
plan does promise it are a count on its own Home, read under `dashboard:view`.
So `npm run smoke:roles` runs with `--strict` now, and passes: **222 of 222 as
expected, 0 drift**. The permission map, the guards and the plan agree for the
first time.

The desktop sidebar shows **everything** a role may open, in three groups in
the order a day runs — today's work, records, setup — with no More on it,
because nothing is hidden and a hub listing what did not fit would be empty.
Nine screens for the office against the four-plus-More the phone shows.

Two independently written fixtures needed updating, which is them working:
`permissions.test.ts`'s expected set for the viewer, and `navigation.test.ts`'s
two order-sensitive assertions, now set comparisons with the order asserted by
new cases. `differenceIn()` was split out of `differenceFor()` so the drift
mechanism stays tested against a made-up expectation now the live list is
empty — a test that only exercised real rows would stop running the day the
last one was fixed.

### R1.3 — a title is text somebody typed, and a class list is in school order

**B-05 and B-14 were holding each other up.** Both title columns were NOT
NULL, so a Hindi school typed every request title twice — and all four screens
that rendered one did `language === "en" ? titleEn : titleHi`, which is a
blank title the moment only one half exists. Migration `20260917110132` makes
one half enough and checks that one survives; `readAuthored()` decides what a
reader sees **and whether it fell back**; `AuthoredText` is the one component
all four sites use. The fallback is visible — a Hindi reader gets "in English"
beside an English title — because hiding it is how somebody decides the app is
half-translated and stops trusting the rest.

**B-06 closed.** The order already existed on both tables and was being thrown
away by `[...map.entries()].sort(byLabel)`. `classLabelMap()` is built in
school order now, so three screens simply stopped sorting and the fourth — a
teacher's own classes, a subset — ranks against it. A test scans every source
file for the two shapes that caused it. **Correction to R0.1: four screens, not
five.** `/timetable` sorts staff names, which is right.

**Self-service language** (PLAN §3a). `/preferences` writes one column on the
row belonging to whoever is asking, found by their own `user_id` — no id in the
form to tamper with. Each option is written in its own language, because
somebody on a screen they cannot read needs to recognise the word for theirs.
It sits in the top bar beside sign-out: both are about the person, a teacher's
bar is already full so More is not a tab she has, and this is the one setting
somebody may need *because* they cannot read the screen they are on.

**B-23 closed**: `Section` names its landmark from its own heading, and `Field`
gained a hint slot above the control rather than below it.

**The phone baseline found the smallest target in the app.** Six screens at
360/390/430px, checking no horizontal scroll and no target under 44px. The
first run failed on `← मेरा दिन` at **20px** — the `PageHeader` back link, on
the screen a teacher opens most, reached with a thumb while holding a register.
It is 44px now. The check's first version also failed every form, and that was
the check being wrong: a checkbox is 20px inside a 48px row that is the target.

One fixture bug worth keeping: eighteen cases signing in individually asked
Supabase for eighteen one-time links in a minute, got rate-limited, and the
refusal read exactly like a permission bug. One session per account now,
except for the tests that are about signing in.

Client JS is **1,309.9 KB in 39 files** against R0.1's 1,293.2 KB — +1.3 %,
inside the R7.1 ratchet.

### R2.1 — the teacher day, with one thing to do next

**B-20 closed.** The Today card listed one row per timetable slot, so a subject
taught to five classes at once rendered as five lines and a teacher saw **20
entries for an eight-period day**, told she was in five rooms. `lessonsToday()`
groups by period *and subject*: a combined lesson is one row carrying its
classes, and two different subjects in one period stay two rows because that is
a clash worth seeing. The QA teacher Thursday now reads 8 rows.

`nextAction()` plus `TaskHero` give PLAN section 1 its "one prominent next
action": the first outstanding register, with the roll count that makes it
concrete — "Class 1 में 15 बच्चे" — as the only accent-coloured block on the
screen. **When everything is in there is no hero at all**; no fallback task is
invented, because a made-up action is how the card stops being believed.

Metric cards show only what can be read honestly: classes held, merged lessons,
cover duties, corrections. A **dash, not a nought**, when no timetable is
published — "there is none" and "you are free" are different news. The design
package also shows Open requests and Records to check; neither is rendered,
because the teacher request inbox is R3.3 and records are a permission a teacher
does not hold. Lesson *times* are absent too: there is no bell schedule in this
database (D-61), so periods are numbered rather than given plausible clock
times.

The classless teacher was checked as well: no hero, a dash for classes with the
reason under it, 0 periods (correct — the timetable is published and she has
none), and her one cover duty as the only thing on her day.

One bug made and removed: `classRoll(classId, sessionLabel)` is two strings in a
row, I passed them backwards, TypeScript said nothing, and the teacher screen
rendered an error card. The signature takes a named object now, at all seven
call sites.

The visual reference was the design package another agent left at `docs/design/`
— followed for layout, and **not** followed where a card would need data this
app does not have. It is untracked by the user decision and is not committed.

### R2.2 — exceptions with counts and owners

`/dashboard` was a profile card and a list of links, identical for six roles,
since Phase 1.2 (B-03). It is now each role queue, in the order that role works:
admin gets registers, absences, review, corrections and failed jobs; office
leads with its own review and corrections; the academic coordinator gets
absences first.

**The owner is the load-bearing half.** A number with no name beside it is
somebody else problem to everybody who reads it, and the register that has not
come in belongs to a teacher rather than to whoever has the dashboard open.

Three empty queues are deliberate. The exam coordinator gets none because
incomplete papers and report readiness have no cheap count yet and an empty
queue is honest where a wrong one is not (R5.3 owns it). A teacher gets none
because her exceptions are already the top of `/teach`. The viewer gets figures
instead — 139 children, 19 classes, 0 registers in of 19 — because PLAN section
3 gives that role read-only information and no per-child actions.

**Unavailable is not zero.** Each count is read individually; a failure comes
back null, renders a dash, and says the count could not be read — and still
counts as needing attention, because nobody knows that it does not. D-93 is why:
a swallowed query error once reported "19 classes have no class teacher", and
on a dashboard that same mistake tells an administrator the school has nothing
outstanding.

One density fix found by looking rather than by reading: the owner line used
`flat()`, so a bilingual reader got both halves and it truncated to nothing
useful on a 360px phone. It is `primary()` now.

Not built here and named rather than faked: no fee summary (a school-wide fee
figure is a new read whose reconciliation rules R6 is still settling, and an
unreconciled number is exactly the ₹0-instead-of-unavailable the design package
warns about), no student search box (the directory is R2.3, and a field posting
to a route that does not exist is a dead control), and no uncovered-period
count (that needs the planner own context; the card sends the coordinator to
`/substitutions`, where the real figure is).

### R2.3 — a real directory, and where each value came from

`/students` is the searchable roster PLAN section 3a asks for, in place of
reaching a child through whichever register they happen to be on. A plain GET
form with every filter in the URL, so Back works, a bookmark works and a pasted
link opens the same list for whoever receives it — and the screen ships no
JavaScript of its own. Scope, search, count and paging all happen in Postgres:
the staff list is a few dozen and ships whole (D-29), but the roster will be a
few thousand and PostgREST truncates at a thousand with no error (D-62).

It is guarded on a new `students:view` that only admin and office hold, and it
is now **second on the office bar** — मुख्य · विद्यार्थी · जानकारी · ऐप · और —
which is PLAN section 3 office row exactly, for the first time.

**A search bug the browser found.** Three kinds of thing get typed into a
school search box and `queryKind()` tells them apart: a bare number is an exact
admission number, ten digits is a phone, anything else is a label. The first
version searched labels against names only — and **this school issues
alphanumeric SR numbers**, so pasting `TEST-CL6-002` from a spreadsheet
searched names, found nothing, and read as "that child is not here". The loose
branch searches `admission_no` too now, with a test that reads the repo query
back so the rule cannot be dropped.

**Source labels (S-10).** Each accepted value now carries a badge saying where
it came from — a teacher, the office, an import — because an approved human
correction and an imported figure look identical once they are both text on a
card, and which one it is decides whether somebody rings the parent to check. A
source the app has never heard of renders as itself rather than being forced
into one of the three.

**The fee link finally has a caller.** R1.1 built the context builder and
nothing used it. The student page now emits
`/protected/students?query=<SR>` — a *search* link carrying the SR, not a deep
link carrying a dev UUID that means nothing in the fee app live database — and
the button says "Find this child" rather than "Open this child" (D-122).

Named rather than half-done: the detail screen stays at `/teach/student/[id]`
until R4.1 moves it with an alias (one record, not two); search is not
transliteration-aware, so "Meera" does not find "मीरा", which needs a stored
transliteration or a Postgres extension rather than a tweak.

### R3.1 — a question asked on Monday is still Monday's question

A request's roll and its prefilled values were re-read from `enrolments` and
`student_records` **every time the link was opened**. So a child moved between
classes after a link went out stopped being on it, and an office correction
changed what "the number we hold" meant on the review screen — the teacher is
shown one thing, answers it, and the queue compares her answer against
something she never saw. Neither reads as an error. Both look exactly like
working software. That is B-07, and S-02 is the behaviour it is missing.

`vppsone.collection_request_members` is the fix: who was asked, their roll
number, and `snapshot jsonb` — the prefilled values exactly as sent, written
once by `freezeMembers()` at creation and **never re-derived**. Alongside it,
the additive round schema (`collection_rounds`, `round_id`,
`audience_kind`/`audience_label`, sent/reminded/archived columns) and
`audience.ts` for what an audience is.

The workflow test is the point. It creates a request through the form, opens
the link, then **moves a child to another class and corrects a value** while
the link is live, and asserts the page did not notice. That would pass against
code that never froze anything — so it then deletes the member rows and
reloads, which is the legacy path `rollForRequest` still takes, and asserts
the roll shrinks and the correction leaks through. The defect is reproduced on
demand thirty lines below the fix that closes it (D-147).

Two defects found while building it. Adding `sent_by` and `reminded_by` gave
`collection_requests` a **third** foreign key to `staff_profiles`, which made
the unnamed PostgREST embed ambiguous and threw on every `/collection` screen
for every role (B-26). `tests/embeds.test.ts` exists to catch exactly that and
stayed green, because it read foreign keys out of `create table` blocks only —
a table gains most of its later references by `alter table`, which made the
check strongest on the day a table was written and blind ever after (D-148).
And `tests/directory.test.ts` measured source within a character window
against a file checked out CRLF, so it passed in CI and failed locally (B-27).

The first version of the freeze test used `mother_phone` and passed — and
would have passed against any code at all, because a collect field prefills
nothing and the assertion was about the absence of something never rendered
(D-149). It uses `guardian_phone` now, where what the school holds is text on
the screen.

Named rather than half-done: **no screen creates a round.** `collection_rounds`
exists and is empty; the wizard is R3.2 and the fan-out is R3.3, so a request
made today is a single class that carries `audience_kind = 'class'` and
freezes its members — the whole of B-07 and none of B-02. `ask_note`,
`reminder_count`, `archived_at` and `token_rotated_at` are columns with no
writer, here because this is the additive migration. `external_student_ids`
gives SamPark links a mapping to use (S-10) and nothing populates it, so the
link still degrades to search — a missing row now rather than a missing
mechanism (D-146).

### R3.2 — see who a round reaches before you make it

R3.1 gave a round a table and no way to make one. This is the screen, and the
count on it is the whole point: `/collection/rounds/new` is **two forms on one
page** — a `GET` that only changes the URL, and a `POST` that carries the same
selection as hidden fields. So the number the office reads is a server render
of the real resolver, not arithmetic the browser did on what it happened to
have loaded. The day those are two code paths is the day a preview says nine
and the round covers eleven.

It also ships no JavaScript of its own. Ticking a class is a page load — slower
than a click, and it works on the connection this is actually opened on, with
Back and a shareable URL thrown in (D-139).

`gaps.ts` is what "missing" means, in one place. **Blank is missing; wrong is
not** — a nine-digit phone number is a different problem from no phone number,
and rolling them together puts a child the office must fix itself onto a
teacher's list. And **two gaps mean both**, the smaller set, so the sentence
shown to the teacher says "and" rather than "or" (D-152).

The ask list is for the case no filter can find: thirty-five families whose
number is on record and is not a WhatsApp number. Ported from SamPark reading
**CSV** rather than `.xlsx` — `SOURCES.md` records that `excel.ts` was not
ported, and a spreadsheet library to parse a file Excel already exports is a
dependency bought for nothing. The BOM is kept, because without it Excel opens
the Hindi notes column as mojibake. **What did not match is the point**: the
upload is two steps and the first creates nothing, so every non-blank row comes
back matched or named by the row number Excel shows down the left.

Four defects found by looking, one of them by reading the resolver rather
than by any failing test: a round carrying an explicit list still had the gap
filters applied on top of it, so a list frozen from a gap selection and
re-resolved after those gaps were filled would quietly cover fewer children
than it was frozen with (B-33, D-158). Nothing would have failed loudly — the
failure is a *smaller* number, and every screen renders that without
complaint. The journey now builds exactly that shape and fails without the fix.

The count line read **"1 कक्षाओं में"** — a
plural Hindi noun on a singular number, obvious to every Hindi speaker in the
school and invisible to anybody reviewing in English, which is exactly why it
shipped (B-28, D-153). The phone baseline caught a **16px link** on the
builder, the same defect class as B-24 (B-29). And the match report ran
together as text — "पंक्ति 4NOPE-404Somebody Missing" — because a margin
separates pixels and a screen reader reads the text (B-30).

Named rather than half-done: **a round mints no links.** The fan-out, the
recipients and the master link are R3.3, and the round page says so rather than
showing an empty list somebody reads as a failure. **House and route audiences
are resolvable and not offered**: both columns are empty on schoolfees-dev — 0
of 139 — and rule 2 forbids filling them, so chips for a filter that could only
return nobody would be a lie (B-31). Nothing holds house or route *ownership*
either, so such a round would have no recipient to fan out to (B-32). The
audience carries `search` and the builder has no box for it yet.

### R3.3 — one round becomes nineteen links, and says who it cannot reach

R3.2 could write a round down and minted nothing. This is the fan-out.

**B-32 had to go first.** `class_teachers` covered classes and nothing covered
a house or a bus route, so a house round resolved to children and then had
nowhere to send them. `vppsone.staff_scopes` is that fact, normalised —
classes deliberately stay where they are, because `class_teachers` carries
handover dates a bus route in-charge does not need and a route does not want
four columns that mean nothing to it (D-159).

A link sent to the wrong teacher is a group that never gets collected and
nobody notices until the due date, so there are **three outcomes and none of
them is a guess**: one owner, more than one, or nobody. Two owners is a choice
for this round rather than a mistake to clean up — both people really do hold
it. A teacher with no number blocks the group as well, caught in the plan
rather than at insert, because a link nobody can be sent is a roster frozen for
nothing (D-160).

**Who gets left out is first class.** House is recorded for about a third of a
school, so grouping a house-wise send by house silently drops every child with
no house — exactly the children whose records are thinnest. `unassigned` comes
back beside the groups rather than being inferred from two totals disagreeing,
and both lists are stated before anything is created (D-161).

That produced **B-34**: the first version labelled the skipped total "in no
group", but skipped is blocked *plus* unassigned, and a child in a class whose
teacher has no number is very much in a group. It reads "N children no link
would reach" now.

**The fan-out is not one transaction, deliberately.** Per-link atomicity is
kept, but if link seven of eleven fails the first six stay: six live tokens
with frozen rosters are six classes the office can send to right now, and
deleting them to satisfy an all-or-nothing aesthetic destroys real work. There
is **no separate resume path** — a resume *is* "create the groups that are not
there yet", so it is the only path, and the half that runs after a failure is
the same code that ran before it (D-162).

Exercised in the browser over three classes chosen for three outcomes: Nursery
(6) and JKG (4) got links, Class 1 (15) got none because its teacher has no
number and was named as held up, and the master link froze exactly the 10 the
class links cover between them. Pressing it again created nothing; the tokens
answered 404 while draft and 200 once opened, to a browser with no session.

Named rather than half-done: **nothing is sent** — the board records what the
office did in WhatsApp itself (D-10). There is no per-group override for a
blocked group yet, so the office fixes it in the staff record (B-35). House and
route rounds remain undemonstrable on dev data (B-31). Two rounds asking the
same class for the same field make two links and nothing reconciles them; that
is R3.4.

### R3.4 (part 1) — the queue says when the record moved

Two failures that look like nothing on screen. A **stale** answer renders as an
ordinary row with a reasonable value in it, and accepting it silently reverts a
correction somebody made on purpose (S-07). A **superseded** one renders as a
*second* ordinary row, and the office adjudicates a question it cannot see the
shape of — which is the ordinary case, not an edge: the office asks in April,
half come back, and it asks the stragglers again in June.

`precedence.ts` answers both, compared against the **frozen** value the
submission carries rather than one re-read now — re-reading is the bug freezing
exists to remove (D-164). The earlier answer is *marked*, never deleted: "what
did she say in April" is a real question when June's answer looks wrong, and an
accepted row is never superseded at all, because rewriting a decision makes the
audit trail a record of what the app thinks rather than of what anybody did
(D-165).

**B-37 came out of building the scenario and looking at it.** The first version
read "what is held now" from `student_records` only, with a comment claiming
that avoided flagging everything — it did the opposite. A value the teacher was
shown that came from the *fee column* has no `student_records` row, so "no row"
was indistinguishable from "the value was cleared" and every such answer was
called stale: four flags on four pending rows. The read now follows the same
precedence the link used, and the rule now requires something to conflict with
— "shown a number, hold nothing now" is a hole to fill, not a correction to
revert (D-166).

The queue also shows the **group** the answer was asked of rather than the
class on the request row, because a house link has no class and would print a
dash on every one.

**R3.4 is not finished.** Still owed: the mock message retry the R0.2 provider
outcomes exist to exercise, the S-01–S-09 acceptance pass, and wiring the
long-existing `mayReplace()` into the accept path — nothing imports yet, so it
cannot currently be wrong, but it is not wired.

### D0 — the atlas is an evolution of what is running

`docs/design/` arrived mid-R3. The delta audit is
`docs/evidence/D0-2026-09-17.md`, and its finding is the useful part: the
palette, the primitives, the role-priority bar, the grouped sidebar, the app
registry, the per-account language and the 44px baseline were **already
there**, from R1.1–R1.3 and R2.1. No token migration, no second component set,
no dependency change. Three things were genuinely missing, which is why this
delivery is small.

Everything that belongs to another repository or a later R row is listed there
by name rather than half-built here: the fee screens are
`veerpatta/schoolfees`, the teacher request cards are R3.3's inbox, photo
progress is R4.2, exam readiness is R5.3, fee figures are R6.

### D1 and D2 — where each account starts, and what it opens on

**Accounts staff start in School Fees, and no account became an accountant.**
The design package warns twice against the obvious implementation — "do not
silently turn `office` into `accountant`", "never derive account type from an
email, a menu label, or a mock query parameter" — and it is right: half the
office are not in accounts. So `staff_profiles.preferred_start` is an explicit
choice the person makes about themselves on `/preferences`, offering only what
`allowedFor(role)` and the app registry already allow. Choosing School Fees
opens a door that was already on the Apps hub; the fee app still decides what
happens on the other side of it (D-168). A stored value is re-resolved on every
read, so a role change takes the landing away with the permission instead of
leaving somebody at `/access-denied` every morning (D-169). Observed: a fresh
magic link for an office account with the preference set answers `307` to
`https://vpps-one.vercel.app/protected/dashboard` — the registry's verified
origin, not a guess.

**A teacher opens her own class and day.** `/teach` was already her Home; it
now names the class in the heading, counts the children on her roll rather than
the number of classes she holds, names the day's first lesson, and puts the
timetable in a column beside the work on a desk instead of four sections below
it. **"First lesson", not "next"** — there is no bell schedule in this database
(D-173), and the atlas's "09:10" is a picture of a fictional school.

**An administrator opens the combined overview.** Attendance, staff, cover and
exams as fractions beside the exception queue, plus the current information
round and the two sibling apps as desks. The profile card is gone from that one
home: a screen about the school should not open with a card about the person
reading it.

**The fee line carries no amount.** VPPS One reads no fee totals until R6, so
the card says the figures are not read here and names the app that holds them.
A zero would be a number an administrator could act on and it would be wrong
every day (D-172); a test asserts no rupee symbol can reach that screen. Every
other count on the screen is `number | null`, and a read that failed renders a
dash with a reason and no bar — the D-93 rule, applied to five more figures.

**Three defects, two of them found by looking rather than by testing.**

- **B-38.** `/auth/confirm` did `url.pathname = sanitizeRedirectPath(next)`,
  and the `URL.pathname` setter percent-encodes a `?`. Every magic link whose
  deep link carried query parameters — which is every link into a register, a
  class or a filtered directory — landed on `/teach/attendance%3Fclass=…`,
  a path that does not exist. Found while checking that a deep link still beats
  the new start screen.
- **B-39.** `sanitizeRedirectPath` refused `//host` and not `/\host`, which URL
  parsing for http(s) treats identically. It was not exploitable only because
  that one caller encoded it — so fixing B-38 would have turned the sign-in
  door into an open redirect. `isSafeInternalPath()` refuses a backslash
  anywhere and any control character (D-171).
- **B-40 and B-41 are one defect seen twice.** `fan-out.spec.ts` measured
  58.2 s against the suite's 60 s default, so the same build passed and failed
  on consecutive runs; confirmed pre-existing against `main`, and its ceiling
  was raised. That did not fix the run — `collection-freeze.spec.ts` failed
  next, on a page this branch does not touch, and the accessibility snapshot in
  its failure report showed `/collection` full of titles hours old.

  Three specs ended with `delete from collection_rounds` under a comment saying
  it cascaded to the round's links. It does not: `round_id` is
  `ON DELETE SET NULL`, which is right for the app — archiving a round must not
  destroy answers a teacher already sent — and wrong for a teardown. Every
  fan-out run left **three live requests** behind on the database three
  journeys share, `listRequests()` reads them all with a query per row, and the
  whole suite had been getting slower for a fortnight.

  `removeRound()` deletes the links first; 34 leftovers were removed from dev.
  The suite went from **12.4 minutes with a failure to 1.8 minutes, 42 of 42**,
  and `fan-out` from 58.2 s to 10.6 s. The raised ceiling stays on that one
  journey; the suite default is left alone, because it is what catches the next
  test that starts taking a minute.

Preserved and checked: office, coordinator and viewer homes unchanged;
`smoke:roles -- --strict` 258 of 258, 0 drift; every new string a Hindi/English
pair; no horizontal overflow and no sub-44px control at 320 and 360.

**Evidence gaps, named.** The populated information-round card was not seen
against real data — the only round on dev is a draft over a class with no class
teacher, so no link can be minted for it. The fee destination is asserted from
the `Location` header and never opened, because it is the school's live fee
app. Physical devices and the full D4 state matrix remain R8.3's and R7.2's.

### D3 — the atlas is one composition, applied

Opening the atlas's `students`, `staff`, `attendance`, `review`, `cover`,
`setup` and `reports` side by side, they are **one** composition: a white card
whose head carries a title and a line of context, and whose body is a list of
rows separated by hairlines rather than by gaps. The role homes had it by hand;
every other screen had a stack of separately-bordered cards, which is a
different density and reads as a different product.

So this pass is mostly one component. `Panel`, `PanelRow`, `FootNote`,
`RowAction` and `StateCard` in `src/ui/panel.tsx` and `src/ui/states/`, plus
the page eyebrow on all 37 remaining headings, applied by route area.

Converted: the directory, the staff list (with four real figures above it), the
register, the teacher's day, all five role homes, collection, rounds,
assessments, the academics hub (two columns now), More, and a teacher's own
token page. The state boundaries became the atlas's "every state has a next
step" — a symbol, a sentence, and a way back to *this role's* Home.

**Left as cards on purpose**: review, cover, the rounds board, jobs,
corrections, policies and the form screens. The atlas draws those as cards too
— a review row is a before/after diff with a decision form in it, a cover row
carries its candidates. `PanelRow` is for a row that fits on a row, and forcing
these into one would delete the content that makes them worth opening.

**The register's live counts stay in the form.** The atlas puts Present/Absent/
Late/Excused in the supporting column; those are client state the offline queue
owns, and the queue is the last part of this app worth destabilising for a
layout. The column carries the guidance card instead.

**Two defects of my own, both caught by one existing test.**

**B-42.** The first `Panel` rendered its rows as `<div>`s — which is what the
markup looked like it needed, and which makes a register fifteen unrelated
paragraphs to a screen reader. `teacher-attendance.spec.ts` counts
`getByRole("listitem")` and found 0 of 15. `Panel` is a `<ul>` now and
`PanelRow` an `<li>`, with the link inside the item rather than being it.

**B-43, the worse one.** The register's aside — "mark the exceptions first" —
is there while the register is open and gone once it locks, and `HomeColumns`
returned a bare fragment with no aside and a grid with one. Two different
element types at the main column's position, so **pressing Save remounted the
register form** and its client state went with it: the "Saved" acknowledgement
a teacher had just earned never appeared. Nothing was lost — the row was
written and the queue is in storage — the screen simply stopped saying so,
which on that screen is most of the point. The wrapper is one `div` now
whatever the aside does.

Worth remembering as a *shape* of bug: a layout component that returns a
different tree depending on a prop remounts its children when that prop flips,
and the damage lands in whatever client state was underneath.

Two process notes from chasing them. The re-run after the B-42 fix **also**
failed, against a preview server still holding the previous build because
Playwright reused one this session had started — rebuild *and* restart before
believing a workflow result. And a cold `next start` answers the first
`/teach` in **28 seconds** against 0.3–4.6 warm, which is enough on its own to
blow a 60-second test budget.

Dependencies naming a whole phase mean all its required rows. Default order is
the plan sequence; after recording a concrete blocker, independent ready rows
may proceed. Every done row needs branch, delivery commit, evidence and remaining
limitations. Add fix rows rather than deleting historical records.

## Original implementation history

## Phase 0 — setup (done by Janmejay + Claude, 2026-09-16)

| # | What | Status |
|---|---|---|
| 0.1 | Repo `veerpatta/vppsone` created, private | done |
| 0.2 | Next.js 16 app scaffolded, Supabase + zod installed | done |
| 0.3 | Vercel project linked, env vars set to schoolfees-dev | done |
| 0.4 | Plan, rules and sources written | done |

### Applied to schoolfees-dev

Migrations are applied through the Supabase MCP, and the file is named for the
version the MCP recorded (D-22), so this list and
`supabase_migrations.schema_migrations` agree.

| Version | File | Task |
|---|---|---|
| 20260917093746 | `create_qa_fixture_runs` | R0.2 |
| 20260917110132 | `collection_request_title_is_authored` | R1.3 |
| 20260916191746 | `create_vppsone_schema` | 1.1 |
| 20260916191757 | `create_staff_profiles` | 1.1 |
| 20260916191935 | `expose_vppsone_to_postgrest` | 1.1 |
| 20260916201212 | `create_subjects_and_class_aliases` | 1.4 |
| 20260916202429 | `staff_language_allows_bilingual` | 1.7 |
| 20260916204801 | `create_class_teachers_and_calendar` | 1.5 |
| 20260916205631 | `create_enrolments` | 1.6 |
| 20260916210606 | `create_timetable_versions_and_slots` | 2.2–2.3 |
| 20260917021218 | `create_attendance_and_notes` | 3.1–3.6 |
| 20260917025818 | `create_substitutions` | 4.1–4.4 |
| 20260917033652 | `create_collection` | 5.1–5.4 |
| 20260917033722 | `create_vppsone_documents_bucket` | 5.3 |
| 20260917041039 | `create_assessments` | 6.1–6.5 |
| 20260917051014 | `create_jobs` | 7.1 |
| 20260917051208 | `create_job_message_templates` | 7.2 |
| 20260917093746 | `create_qa_fixture_runs` | R0.2 |

## Phase 1 — foundation

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 1.1 | Supabase clients, Auth, login, middleware, `vppsone` schema, `staff_role`, `staff_profiles`, permissions | done | `p1-1-foundation` | `50f674d` ([#1](https://github.com/veerpatta/vppsone/pull/1)) | Creating the schema was not enough — PostgREST answered `PGRST106 Invalid schema: vppsone` until it was exposed, so that is now its own migration (D-19). A proxy that bounced any signed-in visitor off `/login` looped forever against a session whose profile was deactivated; the login page decides that now, from the profile rather than the JWT (D-23). The env badge and a bare `/dashboard` exist but the shell is 1.2's; `requirePermission()` throws rather than rendering an error screen until 1.2 gives it one |
| 1.2 | App shell: mobile layout, bottom nav, top bar, tokens, env badge | done | `p1-2-shell` | | Ledger Calm tokens ported from the fee app into Tailwind v4 `@theme`. Signed-in screens live under `src/app/(app)/` so the guard is structural. Nav is derived from `can()`, and each item carries a `ready` flag with a test that it matches a real page file — the phase ships over several deploys and a tab without a route is a 404 with the school on it. `requirePermission()` now redirects to `/access-denied`; actions use `assertPermission()`, which throws, because `redirect()` in an action is a thrown signal a try/catch would swallow |
| 1.3 | Master data — staff | done | `p1-3-staff` | | List with client-side search (a few dozen staff, so the whole list ships once and search works in a corridor), create, edit, deactivate. `short_name` is disabled in the edit form, absent from the update schema, and refused by the action — three layers over the database trigger. Phone numbers normalise to ten digits and refuse anything not starting 6–9 rather than guessing. Nobody can deactivate themselves |
| 1.4 | Master data — subjects, class aliases | done | `p1-4-subjects-classes` | | Subjects with an immutable code, and a per-class label editor where each row saves itself (nineteen classes, filled in over more than one sitting). **The fee app.s RLS gates `public.classes` on its own `public.users.role`, so the cookie client reads zero rows and no error** — fee reads now go through the service-role client after `assertPermission`, since rule 2 forbids adding a policy there (D-32). `orphanedAliases()` is what notices a class that has gone, because no FK points into `public` |
| 1.5 | Master data — class teachers, academic calendar | done | `p1-5-class-teachers-calendar` | | Class teachers are replaced, never edited: a handover closes the outgoing row on the day *before* the new one starts, and a partial unique index allows exactly one open row per class. The calendar stores only the days that are not ordinary — a few dozen rows, not 365 — and a range is expanded to one row per day so "is school open on the 14th" stays a lookup. **`exam` and `event` keep school open but stop the timetable**, which is the distinction that decides whether a register is taken (D-39) |
| 1.6 | Enrolments from `public.students` + consistency check | done | `p1-6-enrolments` | | One row per child per session, because `public.students` holds only today and an academic record needs history. No FK can point into `public` (rule 2), so the screen is the enforcement: it reconciles both sides on every load and names five kinds of difference. A vanished student is the one a rebuild will not resolve — their attendance and marks are here — so the row is kept for a person (D-43) |
| 1.7 | Per-account language: Hindi / English / Bilingual | done | `p1-7-language` | | Janmejay's call mid-phase: the app was hard-coded bilingual, which made every label twice as long for everyone and gave nobody the screen they wanted. Strings are now pairs in `src/messages/`, rendered per reader (PLAN §3a, D-35). Validation messages ride through Zod as JSON because the domain cannot know who is reading. The login screen uses a device cookie, since signed out there is no profile (D-36). `raj@vpps.co.in` is `en` |

## Phase 2 — timetable

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 2.1 | Parser port from `timetable2025/scripts/data.js` + fixture tests | done | `p2-1-parser` | | Ported with behaviour intact; every count SOURCES.md pins matched on the first run — 768 cells, 30 parallel, 60 shared, 19 teachers, 23 subjects. Two deliberate changes: the parser now reports *problems* (short row, duplicate class, unclosed bracket, empty brackets) because 2.2 has to show the school what is wrong before anybody publishes, and `SHORT_SUBJECTS` is not ported at all — it belongs at render, and applying it at parse produces labels matching no subject row |
| 2.2 | Import dry run, resolve against master data | done | `p2-1-parser` | | Resolves every cell against the 1.3/1.4 master data and groups what is missing **by the screen that fixes it**. Keeps going after the first unknown name — a run that stopped would make the school fix one, re-upload, and find the next, nineteen times. An unmapped class is reported once rather than also reporting its eight subjects |
| 2.3 | Versions: upload → check → draft → publish | done | `p2-1-parser` | | A partial unique index allows exactly one published version per session; publish archives the old one **first**, because the other order is refused by that index. `teaching_assignments` is regenerated last, so an interruption leaves stale assignments (visible, fixable) rather than assignments for a timetable that is not live |
| 2.4 | Views: class / teacher / day / free | done | `p2-1-parser` | | Four grids, filtered in the browser over the whole published timetable. `freeTeachers()` takes the whole roster rather than deriving it from the timetable — somebody with no periods is the *most* free, which is the bug the old planner needed a hard-coded reserve list to work around. A clash is one teacher in two different *subjects*; a combined class is not a clash |

## Phase 3 — teacher workspace

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 3.1 | `/teach` shell + Today | done | `p3-teacher-workspace` | | The card answers one question above the fold — is there anything I have not done. It names **three kinds of nothing** (school closed, no class of your own, everything already in), because a card that counts rows renders all three as an empty box and only one means "you are finished" (D-59). Today's periods come from the published timetable, matched to the sheet's own day header rather than to `=== "Monday"`: a retyped block would otherwise silently show a teacher a free day |
| 3.2 | Attendance screen | done | `p3-teacher-workspace` | | Four big targets per child, not a dropdown — forty children are marked standing up. Every tap goes straight to `localStorage`; the flush is **one request for the whole register**, so a signal drop cannot half-mark a class; and the upsert on `(register, student)` makes a second submit produce the same rows. Verified against dev: two submits → 1 register, 14 marks. The queue is a `useSyncExternalStore` external store rather than component state (D-57) |
| 3.3 | Corrections + office on-behalf | done | `p3-teacher-workspace` | | A submitted register is a record: changing a mark carries a reason and two names. **Nobody approves their own** — with one approver that means a request can sit, which is the right failure. The mark is rewritten *after* the request is marked approved, so an interruption leaves an approved request with an unchanged mark (visible, fixable) rather than a changed mark nobody signed. `on_behalf_of` names the teacher stood in for, never the person pressing the button (D-54) |
| 3.4 | Notes | done | `p3-teacher-workspace` | | Per student and per class, typed by the six seeded `note_kinds`. Kind first, text second — the order the register margin already uses — so a note is findable by what it was about. Remove is your own only, enforced in the query rather than checked beforehand, so a tampered id cannot reach somebody else's note |
| 3.5 | Student card | done | `p3-teacher-workspace` | | Attendance % (late counts as present, approved leave leaves the denominator), notes, and the fee standing read from the fee app's **own** `v_student_directory` — VPPS One does not model fees and must not appear to. Fees and late fees are shown as separate figures and never summed (D-33), and only to `collection:view` (D-56). Marks were the one thing PLAN 3.5 named that was absent — a placeholder would have been a promise the data could not keep (D-60). They arrived in Phase 6.3 as term summaries, built with the same `totalsFor()` the report card uses |
| 3.6 | Monthly register PDF | done | `p3-teacher-workspace` | | The paper sheet, as a value: `buildMonthlySheet()` with tests. Columns are the union of "school was open" and "somebody took a register" — an open day with no register is the gap worth seeing, and a register taken on a closed day is still a fact about the children. A blank cell is *not* an absence. It prints rather than rendering a PDF server-side (D-55); `@media print` is A4 landscape, because a month of columns does not cross portrait |

## Phase 4 — substitutions

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 4.1 | Engine port (tests first) | done | `p4-substitutions` | | Ported whole: the tier ladder, the weights, the min-cost flow, half days, fatigue, load spreading and the merge rules, with the original's tests brought across first. **Dropped deliberately**: `createPlanStore` (plans are rows, so pruning is a query and invalidation is `planIsStale()`), and the `DEFAULT_SHIFTS`/`RESERVE_STAFF`/`DUTY_STAFF` constants, which named real teachers in source — rule 6 forbids that and they are rows now (D-61). Four of the original's 34 tests were about its own `data.js` and `i18n.js`, not the engine, and VPPS One tests those elsewhere |
| 4.2 | Planner UI | done | `p4-substitutions` | | One day at a time, in the order a coordinator works: who is away, what that leaves uncovered, the allocation, then publish. Every row carries the engine's own proposal *and* the names it refused, with the reason on them — hiding a blocked teacher makes the staff room look smaller than it is, which is the moment somebody goes back to the paper chart. Half days are first-class: the period picker leads with "whole day" because most absences are, and a teacher away from P5 is an ordinary candidate for P1 |
| 4.3 | Publish → assignments → notify | done | `p4-substitutions` | | Publishing puts the cover on the covering teacher's own Today card; a draft shows nobody, because a teacher who turned up to a class the coordinator had not finished deciding about is the reason nobody trusts the card again. Notification is in-app, not WhatsApp (D-65). Anything set by hand is pinned by construction and survives regenerating, and the pins are handed to the engine as work already done so it never double-books against one (D-66) |
| 4.4 | Shift policies | done | `p4-substitutions` | | `cover_policies`: the periods somebody is on site for, whether they are a duty-holder or office staff, and their automatic cover cap. Everybody is listed whether or not they have a row — absence of one means full day, ordinary teacher, default cap — and clearing a row deletes it rather than writing the defaults in, because "nobody has said" and "somebody decided" should not look the same |
| 4.5 | Test data and a fixture sweep | done | `p4-substitutions` | | Added because the phase could not otherwise be judged: `seed:timetable` publishes the fixture sheet through the app's own parser, `seed:scenarios` seeds one of every state (four absence shapes, a published day and a hard draft day, four cover policies, a month of registers, three corrections, six note kinds). `tests/substitution-fixture.test.ts` runs the engine over the real 768-cell sheet across 42 day × absence-shape permutations and asserts the invariants hold on every one |
| 4.6 | Fix: PostgREST was truncating the timetable | done | `p4-substitutions` | | Found while seeding: the published timetable is 1038 slots and `listSlots()` had been returning 1000 since Phase 2, with no error — thirty-eight lessons missing from every timetable view and invisible to the planner. Reads that can exceed a thousand rows now page through `fetchAllRows()` (D-62) |

## Phase 5 — collection

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 5.1 | Token links + field registry | done | `p5-collection` | | `/r/<token>` is one request, `/t/` is one teacher's own list, `/w/` is where a WhatsApp button lands — public by design, because the school has forty staff and four accounts (D-68). The token is the whole authorization: ~96 bits, one request and no navigation past it, **every rejection the same 404**, and a guess rate limited in Postgres with its own budget so a teacher never spends a guesser's. The field registry and `validateField()` are ported from Sampark with their bilingual errors — a nine-digit phone number is impossible to *submit*, not something the office cleans up later |
| 5.2 | Submissions + review queue | done | `p5-collection` | | Re-answering replaces on (request, student, field): a correction is not a second submission. The queue **splits changes from confirmations** and accepts confirmations in bulk — "this is already right" is a real answer but not a change, and four hundred of them one at a time is a queue nobody finishes (D-73). A repeated phone number carries a neutral count, never a warning (D-71). **Blank means no change, never erase** (D-72) |
| 5.3 | Student records + documents | done | `p5-collection` | | An accepted answer lands in `vppsone.student_records` and **never in the fee app**: `fee_column` is a comparison, not a destination (rule 2, D-69). An approved human answer outranks every import, forever, in code rather than in an editable row (D-70). Documents live in a private bucket and are served through a signed URL that lasts a minute, minted inside the function that checks the permission, with a path keyed by child and a random id rather than the filename (D-75) |
| 5.4 | WhatsApp templates | done | `p5-collection` | | Templates carry the approved wording beside the name AiSensy knows them by, and a send stores the text **as it will read** because a template can be edited afterwards. `mayDispatch()` refuses a parent-facing row outright — D-10 made executable — so the office opens it in their own WhatsApp and marks it sent. Staff messages may go through the provider and still need an `AISENSY_API_KEY` this repo does not carry (rule 8: sending costs money) (D-76) |
| 5.5 | Fix: "9 of 45" read backwards in Hindi | done | `p5-collection` | | Caught on the collection link, which happened to render for a Hindi reader. English counts up from the part, Hindi counts down from the whole (`45 में से 9`), so two numbers around a translated "of" render backwards in one of them — as the attendance register had been doing since Phase 3. `countOf()` now owns the word order (D-77) |

## Phase 6 — assessments and reports

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 6.1 | Assessments admin | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | An exam is not one max mark, so `assessment_subjects` is a paper per class per subject — a Class 5 English paper and a Class 10 English paper are out of different totals, and a single `max_marks` on the exam would make the whole school sit the same one (D-78). Locking is the state that stops entry, and it is one field a coordinator sets, not a date somebody has to remember |
| 6.2 | Marks grid | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | **Three states per cell, never two** (D-79): blank is nobody has entered it, Absent is a child who did not sit the paper, and a number is a number — including nought. The column saves in one request like the attendance register, and a refusal leaves the whole column unwritten rather than half of it. Every change is logged with both sides of it, and an unchanged save writes nothing (D-80). `inputMode="decimal"`, not `type="number"` — a spinner that scroll-changes a mark somebody is reading past is a silent wrong answer |
| 6.3 | Progress view | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | Finished papers stay on the board: dropping them would show a teacher who has entered everything as identical to a teacher nobody asked. Term summaries reach the student card too, using the same `totalsFor()` the report card uses, so two screens about one child cannot disagree about what a missing paper means. **A paper nobody has marked is out of both halves; an absence is a nought it is out of** (D-81) |
| 6.4 | Report card | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | A card is a **snapshot, not a view** — issued cards keep their own copy, because marks change afterwards and recomputing would silently rewrite what a family is holding (D-82). One row per subject, a column per exam. Weight applies to the percentage and never to a printed mark (D-83), and the card says so only when the weights actually differ. `readiness()` says what is missing beside the button rather than refusing. No PDF: the browser's own print is what a school with one printer actually uses, and the grade bands are a **default the school still has to confirm** (D-84) |
| 6.5 | Academic exports | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | CSV built in the browser, with only the log row posted — an export is a copy of the school's records leaving the building, and who took what is the fact worth keeping. Logged *before* the file is handed over, because a log of successful downloads misses the interesting case. BOM and CRLF so Excel opens Hindi correctly, and `marksCsv()` prints "Absent" and "Not entered" as different things rather than both as blank |
| 6.6 | Fix: `weight` was stored, shown and documented but changed no total | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | Found while smoke-testing the seeded card: the form took a weight, the card carried it to every cell, and no arithmetic anywhere used it — a control that did nothing. `totalsFor()` now applies it to the percentage only, and returns `weighted` so a screen can explain a percentage that is not the printed pair divided (D-83). The seed has a child who picked up after the formative, because otherwise every child scores the same share of both papers and the weighting is invisible in the data |

## Phase 7 — automations and cutover

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 7.0 | Passwordless test sign-in, and the two bugs it found | done | `p7-0-sign-in` | | Phases 3–6 all shipped without anybody looking at a signed-in screen. `/auth/confirm` accepts a link Supabase minted, both doors share `admitSignedInUser()`, and `npm run dev:login` issues a one-time link for a `@qa.vpps.local` account — dev only, any other address refused (D-86, D-87). The first pass through it found that the Teach card told every teacher on a good connection that she had no internet (D-88), and that saving a column wrote a "not entered → not entered" log row and an empty marks row for every child the teacher had not reached yet (D-89). Neither was reachable by a probe |
| 7.0b | Fix: `/collection/messages` threw on every load | done | `p7-messages-embed` | | Found by the same sweep as 7.0. `message_sends` points at `staff_profiles` twice — `requested_by` and `staff_profile_id` — so an unqualified embed has no answer and PostgREST refuses the whole select. The screen had been an error card since Phase 5 merged (D-95). `tests/embeds.test.ts` reads the foreign keys out of the migrations and the selects out of the repos and compares them, so the next one is caught before it ships. It was written, seen to pass against the bug, found to be matching nothing because of CRLF, and only then trusted (D-96) |
| 7.1 | Job platform + console | done | `p7-jobs` | | `runJob()` is everything every job has in common, so a job is only the work. **One run at a time is a partial unique index, not a flag** — a lock in memory does not exist when the app is two instances, which on Vercel it always is (D-90). A run that died leaves a `running` row holding that index forever, so stale rows are closed as failures before every attempt. Twice in a day is a skip, not work; the console's button forces it, and only on the second press, after it has told you why (D-91). Two doors in: Vercel's `CRON_SECRET` bearer, or a per-job token that is `HMAC(JOBS_SECRET, job)` — four different tokens, none of them the secret, and a deploy with neither variable set runs nothing at all rather than anything at all (D-92). Every refusal is the same 404 |
| 7.2 | Scheduled jobs | done | `p7-jobs` | | Open today's registers, chase an unsubmitted one, nudge outstanding marks, write the day down. **The two reminders prepare messages and send nothing** — `draft`, staff audience, for the office to send by hand, which is where Phase 5 left every message this app produces (D-10, D-76). Building them turned up that a job which swallows a query error reports a confident zero: "19 classes have no class teacher" was a wrong column name, not a finding, and a second wrong table name was hiding behind the same silence (D-93). Every read now fails loudly. The dedupe is per template, because a teacher nudged about marks has not thereby been asked about her register |
| 7.4 | Production job secrets, and a deep smoke test across every role | done | `p7-smoke` | | `CRON_SECRET` and `JOBS_SECRET` set on Vercel production through the CLI and the deployment redeployed to pick them up — `/api/jobs/*` answers 404 without them and runs the job with them, both verified live. `npm run smoke:roles` opens all 36 screens as all 6 roles and reads the expected answer out of each screen's own guard: **216 combinations, all correct, none throwing** (D-98). Its first run said every role could open everything, which was the test not knowing that a guard firing mid-stream emits a meta refresh rather than a 307 (D-97). `tests/action-guards.test.ts` covers the other door — a Server Action is reachable without its page (D-99). Two real bugs: a Sunday reported 19 registers outstanding (D-101), and a skipped run wrote nothing, so the console could not tell a cron that fired and skipped from one that never fired (D-100) |
| 7.3 | Cutover to live data (PLAN §7) | blocked (Janmejay's call — rule 8) | — | | **Prepared, not done.** It writes to the live fee project and repoints production, which rule 8 makes somebody else's decision. `docs/CUTOVER.md` is the runbook: the six steps, what `expose_vppsone_to_postgrest` does if you skip it, and what rollback does and does not undo. `npm run cutover:check` reads **dev only** and refuses the live ref — it confirms all 34 tables the 15 migrations create exist, that no migration creates anything in `public`, and what master data step 3 has to reproduce for real. Currently green |

## Mobile refresh — 2026-09-30

| What | Status | Branch / commit | Evidence / remaining |
|---|---|---|---|
| Mobile-first visual, accessibility and workload refresh; user-requested centering and animation polish | Implemented in this revision | `main`, this change | `docs/evidence/MOBILE-2026-09-30.md`: unified role navigation, readable/wrapping cards, shared targets, named/nested sheets, localized sessions, adaptive nav clearance, reduced-motion-safe animations, no unnecessary financial shell reads for non-fee roles. Final checks and exact deployment result are recorded at delivery. The isolated browser fixture is ready but Chromium launch is blocked; authenticated/physical acceptance and field-performance evidence remain pending. No database/config cutover |

## Native admin overview correction - 2026-09-30

The user approved the actual native design and all five follow-up refinements at 15:13 UTC, explicitly authorizing commit/main/deployment. This supersedes the earlier design-review hold below. PR 38 now prioritizes pending/unavailable work while retaining compact zero-count links, adds explicit navigation actions, labels absence-derived teaching counts precisely, separates cover-load errors from no plan, uses tracks only for genuine fractions, marks external live workspaces explicitly, and groups secondary destinations under keyboard-operable All screens. Final aggregate/browser verification and production release are in progress; no database/configuration changes.

| What | Status | Branch / commit | Evidence / remaining |
|---|---|---|---|
| Complete the native admin School overview missed by PR 37 | Implemented; verification in progress; release awaiting user design approval | codex/native-admin-overview; this change | docs/evidence/NATIVE-ADMIN-2026-09-30.md: native compact header, attention hierarchy, earlier phone support cards, wrapping workspaces, preserved data/role contracts. Actual local TEST screenshots and final check results are recorded at delivery. No production push until approval. |

### R7-smooth / F8 — desktop, phone and installed workspace

The requested implementation is in [PR 39](https://github.com/veerpatta/vppsone/pull/39)
on `perf/installable-workspace`: original implementation `2c9ef2f`, current-main
integration `741318f`, preserving PR 37's mobile refresh and PR 38's approved native
admin design. D-201–D-203 and `docs/evidence/smoothness-2026-10-01.md` record behavior
and measurements against main `8ff94de`. Teacher/admin HTML/RSC documents shrank
about 50%/39%; navigation timing is mixed, with no universal latency claim.

Final production verification passed all 49 active browser journeys, 68 mobile
fixture checks and 728 screen/role cases. CI passed 8,144 unit tests; final-head CI
and matching hosted deployment metadata are release gates. Install/offline,
scoped manual draft recovery, deliberate worker updates, local desktop details,
online-only payment confirmation and privacy-conscious measurements are delivered.
Client chunk growth remains inside the 10% route budget.

The directory's bounded/fresh-query fix from current main is retained. Integration
also corrected the visible-target helper for clipped skip links and added actual
keyboard focus acceptance; update recovery now waits for reopening explicitly.
Physical Windows/Android/iPhone installation and lifecycle acceptance,
representative field metrics and unrelated R5/R7/R8 parity work remain open.
No database/configuration cutover.


## Remaining non-migration recovery — 2026-10-11

Released in PR 67, main `7aee58853173c03dd0f6402d718baf0a69b56da4`; review CI `38113376477` and main CI `38113879033` passed. Production READY `dpl_xiezbcdnvwYfcZ4M1TgDgKPeLYvg` matches that SHA and the canonical hostname. Fourteen grouped findings were addressed with 12,389 unit tests and 84 browser cases passing. Five correctness findings remain open (day-close concurrency, durable inbox delivery, atomic preparation, mixed seat set/clear, uncertain provider acceptance). See `docs/evidence/remaining-workflow-audit-2026-10-11.md`. Authenticated acceptance requires existing QA sessions or an authorized secure configuration; no credential probing was performed. Original promotion migration/callers remain excluded pending their unresolved approval. No LIVE School Fees or real provider dispatch occurred. Subsequent dev metadata inspection found the receipt fallback's direct session column invalid; the correction below supersedes its earlier mocked session test.

### Receipt session fallback fix — 2026-10-11

Branch `audit/receipt-session-recovery-20261011`, based on main `7aee588`. `lastReceiptDate` now follows the same payment/installment/class inner joins as the receipt list, because `public.receipts` has no `session_label`. The schema-aware test rejects that nonexistent column and reproduced two failures before the fix; all ten targeted cases then passed. Typecheck and port checks passed; the local execution transport disconnected before the full suite/lint/build could complete. The same tested source and regression are submitted through the supported GitHub API, with complete CI required before merge and matching production verification after merge. No migration or DB record writes. Immutable release identifiers are recorded at delivery.


## Durable inbox and provider recovery — 2026-10-11

In progress on `audit/durable-recovery-20261011`, reconciled with main `ccabab7` (PR 71). O02 now persists scoped intent and reuses command identity through normal/departure/reload delivery; PR 71's removal of attendance correction approval is preserved. O05 claims before provider transport and keeps unknown outcomes blocked until human evidence confirms receipt; no provider retry/overwrite/cancellation can erase an unknown attempt. Validation and release identifiers are tracked in `docs/evidence/durable-provider-recovery-2026-10-11.md`. O01/O03/O04 remain pending a valid separate PR 69 DDL approval: the fresh action expired, and metadata still showed no functions. Original promotion approval and LIVE School Fees remain untouched.

## Payment entry parity - 2026-10-11

Approved bounded restoration on isolated branch fix/payment-entry-parity, based on PR 76 main fefd2a0. Missing collector/concession fields, original shortcuts and EMI context, authoritative selected-date preview, original paper receipt, and owner/session-scoped durable interrupted-save recovery are implemented. Genuine review and explicit-only messaging remain. See docs/plans/2026-10-11-payment-entry-parity-design.md and docs/evidence/payment-entry-parity-2026-10-11.md. Seven synthetic component scenarios and nine domain regressions passed; full gates and responsive acceptance are pending. No database/schema/provider writes.
