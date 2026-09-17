# VPPS One — deep smoke and acceptance protocol

Active with PLAN revision 2. This is planned coverage, **not a test-pass report**.
Current execution is in `QA-BASELINE-2026-09-17.md`. R0 builds missing tooling;
R8 executes the entire suite and publishes a release report.

## Fixtures and runner

- Use only the configured dev ref `wtgxcptmucjerhufzjcf`. Existing scripts protect
  their dev target; keep that property. Read env internally, never print keys,
  cookies or one-time login links into committed evidence.
- Maintain named QA accounts for admin, office, academic coordinator, exam
  coordinator, teacher and view-only; add a second teacher with disjoint classes,
  inactive account and teacher without assignment. Account provisioning must
  remain an explicit dev fixture setup rather than hidden in assertions.
- Each run gets a deterministic seed and unique run ID. Build 0/1/40-child
  classes, long Hindi/English names, duplicate names with distinct IDs, missing
  contact/photo, transferred/leaving students and ≥1,205 list rows. Generate
  large synthetic data in `vppsone`-owned fixtures; never bulk-edit fee `public`
  tables from this repo to make a scenario possible.
- Seed holiday, weekend, event/exam day, normal day; current/prior session;
  published/draft/stale timetable; absences and impossible cover; blank/zero/
  absent/partial/complete/locked marks; pending/approved/rejected corrections;
  open/closed/overdue collection, conflicting reviews and partial batch failures.
- Mock messaging provider outcomes (success, slow, timeout, 429, 500, duplicate
  callback). Never use real recipients as failure fixtures.
- Add a browser runner (e.g. Playwright) and axe checks during R0, only after
  checking installed framework testing guidance. Proposed commands: `qa:seed`,
  `qa:reset`, `smoke:workflows`, `qa:a11y`, `qa:performance`; implement and
  document them before claiming they run.
- **Implemented so far:** `npm run verify:origins` (R0.1) fetches each origin in
  `src/platform/config/app-origins.ts` and fails unless the response identifies
  itself; `-- --json` writes a machine-readable record for `docs/evidence/`.
  It refuses to run if the table does not cover every app id, because a run that
  checked nothing must not exit 0.
- Independent expected-role fixtures encode product requirements. Do not derive
  the sole expected result from the same guard/permission code under test.
- Each case has timeout, role, route, fixture ID, expected/actual, elapsed time,
  retry count, screenshot/trace for failure and cleanup outcome. Missing fixtures,
  zero discovered tests, partial execution and unhandled errors fail the run.

## Test layers

1. `npm run check`: current typegen/typecheck, lint, Vitest and production build.
2. Domain invariants: frozen audiences, financial source mapping, weighted marks,
   dates, precedence, validation, queue versions and idempotency.
3. Database/integration: constraints, transactions, backfills, large reads,
   duplicate/reordered calls, concurrent decisions and intentional failures.
4. Existing `npm run smoke:roles` against production-built localhost or deployed
   test app: all guarded screens × roles, plus independent role assertions.
5. Browser workflows below: real clicks/typing/saves/reload/Back; verify persisted
   values and downstream screens, not just 200 responses or success toast.
6. Responsive/accessibility/performance and physical staff acceptance.

## Workflow matrix

| Case group | Positive | Negative / edge | Recovery / invariant |
|---|---|---|---|
| A Auth/home | Login each role → correct Home and first task; logout | Wrong password, inactive/no profile, expired session, deep link, forbidden role | No loop; original destination preserved; expiry retains draft; account switch updates navigation and queue |
| B Navigation/apps | Every home/sidebar/bottom/More/Apps link; original app handoff | Missing origin, unsupported student ID, cross-environment link, unavailable destination | Clear fallback/search; Back returns; no copied tokens; original apps stay reachable |
| C Directory | Search by ID/SR/name; filter class/session; detail → Back | Duplicate names, empty/no result, long bilingual names, >1,000 rows | Counts/selection stable across pages; URL filters and scroll retained; no cross-session confusion |
| D Attendance | 40 students, all-present + 3 exceptions, save and reload | Empty roster, holiday, stale enrolment, invalid date, unassigned teacher | Disconnect after click and before response; replay once; two tabs conflict; no false saved indicator |
| E Corrections/notes | Request correction, independent approver, history; add/edit supported notes | Self-approval, stale request, invalid reason, another teacher's class, duplicate call | Approval and mark update atomic; failed transition changes neither; existing history retained |
| F Timetable/cover | Import preview → draft → publish → teacher Today; manual cover | Unknown teacher/class, duplicate rows, combined/parallel periods, half day, impossible cover | No partial publication; pin survives regeneration; no double-booking; stale timetable invalidates plan |
| G Requests | Filter missing phones → preview → teacher batch + master/office → answer/review | Zero audience, unmatched Excel row, duplicate ID, bad phone/date, no fields, closed token | Frozen members/values; partial fan-out resumes same round; blank never erases; master totals reconcile |
| H Review | Confirm unchanged; propose change; approve/reject; source labels | Two reviewers, source conflict, stale original, duplicate submit | Exactly one winner/effect; new authoritative value survives stale retry; audit links actual before/after |
| I Photos/files | Camera/file upload, preview, retake, replace, download | Wrong child, ambiguous filename, missing/large/corrupt file, rotated image, storage full | Keep prior version on failure; resumable items; correct thumbnail; no invisible orphan success |
| J Marks/reports | Enter zero, absent and numeric; paste preview; lock; issue/print | Out of range, invalid decimal, missing paper, weights, wrong class, locked exam | Whole save succeeds/fails consistently; snapshot remains unchanged after later marks; totals agree |
| K Imports/exports | Preview, row matching, commit, export/read back | Bad headers/encoding, SR leading zero, duplicate IDs, formula-looking values, large files | Failed rows downloadable; rerun idempotent; CSV/XLSX Hindi and row counts correct |
| L Jobs/messages | Draft/preview/mock send, progress and job history | Duplicate trigger, provider 429/500/timeout, stale lock, no data, holiday | Only failed items retry; success not sent twice; skipped/failed visible; no actual provider dispatch |
| M Fees handoff | All F-rows in verified fee sandbox; source summaries | Fee-role denial, wrong session/ID, source unavailable, late-fee-only/write-off cases | No native second ledger; principals/totals reconcile; fallback route; real payment/send never used for QA |

## State and concurrency testing

For every mutation: exercise valid input, missing/invalid input, repeated submit,
double-click, timeout before commit, timeout after commit but before response,
reload, stale version, account change and denied role. Use database/failure
fixtures to confirm outcomes, not arbitrary sleeps. A cancellation and retry
must leave intelligible state. Prior progress notes describe multi-step publish
and approval paths; explicitly test their interruption points before calling
them atomic.

Attendance queue: test quota/private-storage errors, malformed JSON, invalid
payload shape, schema version change, tab storage events, browser restart,
expired auth and a different account. A loaded page retaining edits is different
from an app that can open offline; report those capabilities separately.

Dates: IST midnight boundary, leap date, Sunday, holiday/exam/event, school-year
rollover, absent/deactivated/handed-over teacher and a student moving classes.
Pin the clock in deterministic tests. An empty dataset is not proof of a zero
backlog if a dependency query failed.

## Responsive and accessibility acceptance

Run critical workflows at 360×800, 390×844, 430×932, 768×1024 and 1440×900;
cover Hindi, English and both on key forms, and each role at least once on
phone/desktop. Test portrait/landscape, 200% zoom, software-keyboard space,
safe-area padding, keyboard-only flow and reduced motion. Use pairwise coverage
for secondary combinations but explicit full coverage for role mutations.

Check hierarchy, wrapping, scrolling cost, primary action discoverability,
touch targets, focus, error association/announcement, color contrast and last
row visibility. Page-level horizontal overflow fails; a clearly indicated
scrollable timetable is allowed. Automated axe success is not a usability test.

Print attendance and report cards with long names, missing marks, multiple
pages and Hindi. Inspect generated previews/files; actual printer/camera/
Android WhatsApp webview checks require physical evidence and remain pending
when unavailable.

## Performance method

Use the same production build, fixtures, viewport and network profile before/
after. Record cold first load separately from 20 warm samples. Capture route
data time, query count, rows, response/JS/image size, long tasks and save latency.
Use SQL plans on dev for actual query hotspots. Record median and p95, not a
single favorable sample. Use real event/field samples for INP; Lighthouse TBT
is only a lab proxy. PLAN §1/§5 targets are goals, not measurements.

## Defects, reporting and release

P0 = unusable core application, widespread incorrect records or unrecoverable
loss. P1 = routine workflow blocked, duplicate/incorrect save or core parity
missing. P2 = recoverable usability/performance issue. P3 = cosmetic polish.
Security/authorization mistakes still get tested as correctness, even with
test data; they need no separate bureaucracy.

Each defect: ID, severity, observed/source-inferred/hypothesis, role/route,
steps, expected, actual, fixture/run, evidence, fix task, regression and status.
Never relabel a source concern as a reproduced failure.

For a release record source commit, deployment commit/URL, environment, seed,
commands, expected/executed/passed/failed/skipped, evidence paths, open defects,
physical/provider gaps and rollback commit. No P0/P1 can be hidden by green
unit tests. Code deployed, browser verified and staff accepted are distinct.
Reset only rows/files owned by the test run and verify cleanup. Keep failure
artifacts redacted; do not commit tokens or real source-account details.
