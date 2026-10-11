# Independent attendance recovery audit, 11 October 2026

Initial test base: remote main `90ddc02c69681e9045059ee442e8b24338223d9a`.
Final branch rebased cleanly onto PRs #62-64 main
`f895efb1edddcd23877030e4b629a0d18988d71a`; attendance implementation commit
`25a50b3bb3b3225434971b7daacef85850f70fb0`, Student 360 error fix
`66866a016bc818474028ff6c4ec8eceeb36644dc`.
Branch: `audit/independent-recovery-20261011`. Local-only handoff; do not deploy
this branch before the final gates and source-independence assessment in
`independent-release-integration-2026-10-11.md`.

## Ownership and boundaries

Original task `01a126ea-0689-70ef-ad85-56ccb4cdf0da` owns promotion queries,
student-tools promotion orchestration, the pending promotion migration,
`current-staff.ts`, Needs-you `admin/inbox.tsx`, receipts close/reopen actions,
receipts data/load, and their existing regressions. All were inspected read-only.

This independent checkout owns only attendance shared actions, attendance
correction repository, teacher attendance actions/UI/data typing, five new
attendance/PDF tests and Student 360 streaming, read-failure and browser tests.
The authorized follow-up adds explicit fee failure/retry to PR #62 while
preserving its concurrent reads, school-first stream and client tab state.
The source checkout was never edited. No migration, database query/mutation,
credential creation, messaging provider call, role grant, main push, or deploy
was performed in this independent audit. Dependency files were copied from the
source's installed node_modules after verifying identical lockfile hashes;
no environment files were copied.

## Reproductions and fixes

The initial three regression files failed 15 assertions and passed 5 on untouched
main. These assertions represent related scenarios, not 15 independent defects.

| Finding | Reproduction | Final behavior |
|---|---|---|
| Shared save omitted preview guard | Direct server action during role preview still called register save | Refuses before save; correction request/decision entry points also guard preview |
| Shared correction omitted owner window | Held-class teacher corrected at 30/31 minutes | Refuses at/after 30 minutes; 29-minute and authorized office correction remain allowed |
| Permission-service failure looked like transport failure | Wrapper permission exception rejected its promise | Returns explicit refusal, so it is not queued as an unanswered network request |
| Restored outbox retained permanent refusals | Refused/stale/roster-changed response followed by reconnect | Removes pending delivery; keeps the editable draft and refusal message |
| Offline storage failure claimed durability | Local draft store rejected write | Reports failure and keeps page open; uncertain saves held only in memory are labelled accordingly |
| Recovery resent an acknowledged save | Restored outbox whose command already had a receipt | Checks command receipt before resending |
| Recent decisions hid waiting requests | 220 newer decisions ahead of an old pending request; 411 pending requests | Pages all pending rows separately from 200 recent decisions; names use <=200-ID chunks |
| Failed student-name lookup produced anonymous queue | Name lookup failed | Surfaces the read failure |
| Stale requested mark was overwritten | Request from Absent, current Half-day, requested Present | Refuses; matching original mark retains expected register revision, and RPC stale responses are surfaced |
| Competing rejection falsely succeeded | Pending-only UPDATE matched zero rows | Requires the changed row returned by PostgREST |
| Queue errors reported a misleading saved count | Queue read/cancellation/insertion each failed after attendance save | Keeps the attendance receipt with a separate queue warning; count reported only on success |

## Validation

Final post-rebase local checks on main base `f895efb` passed: **12,239 tests,
126 files** (118.95 seconds; one worker with the original timeouts), **74**
mobile/desktop browser cases and **4** payment-draft browser cases. Full lint
exited 0 (four existing warnings), production build including TypeScript and
140 static-generation attempts exited 0, all eight route bundle budgets passed,
and port imports found nothing left to rewrite. Theme parity exited 0 with a
skip because the reference School Fees checkout was absent; it is not a verified
theme comparison. Source independence and the original patch dry run passed.

The first concurrent full run had five 5-second timeout failures and 12,234
passes, without assertion failures. After browser cleanup, the complete suite
passed with one worker and unchanged timeouts/assertions. The final successful
JSON is `independent-final-suite-serial.json`; the failed first attempt remains
available as `independent-final-suite.json`. The earlier runs below are historical.

- Full unit suite: **12,158 tests passed, 120 files** (173.40 seconds).
- Final focused rerun: **28 tests passed, 5 files** (17.97 seconds), including
  the two additional scope/race tests and two real PDF renderer cases added
  after full-suite discovery.
- Final combined rerun on PR #62 base: **34 tests passed, 6 files** (9.91
  seconds), including all six Student 360 streaming cases.
- Real local PDFs rendered for synthetic normal and reversed receipts using
  the installed renderer, actual bundled fonts/branding, PDF page objects,
  and embedded TrueType fonts. No renderer mock was used.
- Targeted ESLint exited 0 on changed attendance actions/UI/data and all five
  new regression files. TypeScript checking (`tsc --noEmit`) exited 0 after
  route type generation.
- TypeScript checking exited 0 again on the final PR #62 base, including the
  additional Student 360 test. Its six tests passed independently (4.37 seconds).
- `git diff --check` passed.
- Hosted read-only probe with an invalid synthetic receipt ID returned **307**
  to `/login?next=%2Ffees%2Freceipts%2Fnot-a-uuid%2Fpdf`. This proves an access
  redirect only, not successful signed-in hosted PDF generation.
- Existing full-suite coverage passed for role expectations/permissions,
  directory pagination and scope, report schemes, report/receipt/student-tools
  domain logic, attendance and correction domain logic, and mocked provider
  behavior. This is not authenticated end-to-end acceptance.

Raw JSON reports are in the parent task workspace as `independent-suite.json`,
`independent-focused.json`, and `independent-rebased-focused.json`.

## Remaining limits and reconciliation

The unresolved promotion approval was not approved, retried, duplicated or
bypassed. Main still needs the original task's permission, Needs-you, and
day-close changes; this independent branch intentionally does not duplicate them.

No live or dev DB concurrency/rollback test was run here. The correction action
uses the existing expectedRevision RPC and a pre-write original-mark check;
it does not add a database-level original-request snapshot constraint. Queue
synchronization remains outside the attendance transaction. Approval through
the shared correction action still needs separate parent-message-queue
reconciliation, and lost-response receipt recovery does not verify queue state.
Do not treat the new queue warning as an atomicity or delivery guarantee.

Browser mock tests cover React rendering/effect and storage/server-result
behavior. Actual signed-in browser roles, hosted authenticated PDF content,
physical devices/printing, and real messaging remain unverified. No real messages
were sent. The isolated production build is now verified. Combined-original-fix
release validation remains with the main worker after reconciliation. Exact-head
CI is blocked on review-branch publication: auto-review rejected the push before
the local gates were complete. No branch push, PR, main update or deployment occurred.

## PR #62 stream/error inspection

The added Student 360 tests use synthetic child/sibling/notes models, a deferred
fee promise, the actual component/Suspense, mocked Next navigation and i18n, and
DOM clicks. They check immediate school data, attendance-tab/URL persistence
after fee resolution, family loading before sibling data, initial fees-tab
loading, school notes surviving a fee failure handled as null, and the
school-only model without fee tabs/loading.

The follow-up fixes the observed failure-to-empty ambiguity: the server page
maps failed fee reads to an unavailable marker, and the component displays a
bilingual error with retry while school data and the selected tab remain usable.
Successful absent data retains the empty state. Family, profile and financial
snapshot read exceptions now propagate instead of silently becoming absent or
zero data; failed membership/linked-members queries likewise throw rather than
inventing no siblings. The fee reader still authorizes before starting reads.

Page-level tests verify the actual server mapping, its nonblocking school model,
and zero fee reads without fees:view. Reader regressions fault each dependency.
Browser tests exercise the actual client component and CSS with synthetic data;
they do not establish production speed or authenticated journey completion.
See the integration ledger for final gate outcomes and remaining acceptance.
