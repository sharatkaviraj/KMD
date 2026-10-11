# Remaining non-migration workflow audit — 11 October 2026

Base: released main `585e593f4118d163344a8de2aa647866d642c079` (PR #66).
Branch: `audit/nonmigration-remaining-20261011`.
This record concerns source implementation and synthetic local validation.
Authenticated database journeys and staff acceptance are separate gates.

## Boundaries and integration

The original checkout at `C:\Users\AnandKumari\Documents\Codex\2026-10-10\task-2`
was read only. Selected auth, inbox, receipt/day-close source changes and their
three regression files were copied into this isolated checkout, with the
timetable fixture's verified permissions response. Further faults were tested
here and corrected. No environment files or credentials were copied.

No migration, pending promotion caller, `.gitignore` change or generated output
is in this batch. No database record was read or changed during this audit;
provider fetches and WhatsApp popups in tests are mocked. The protected LIVE
School Fees project `vgqyilgstjvgohrsiwkb` was not contacted. The known dev ref is
`wtgxcptmucjerhufzjcf` (`schoolfees-dev`); that is metadata, not permission to
apply the unresolved migration.

One permitted approval inspection attempt failed before showing a browser
surface (Windows platform directory unavailable). It approved/cancelled nothing.
No further stale-approval retries or session-file inspection were attempted.

## Findings and closure counts

Fourteen grouped findings have source fixes and local regressions in this batch.
Five further correctness findings remain open below. These counts describe this
batch's findings, not completion of all school workflows. No full matrix group
is being declared accepted from mocked data alone.

| ID | Finding and resulting behavior | Evidence / closure |
|---|---|---|
| C01 | Matrix RPC failure/malformed data cannot restore revoked default grants. All eight roles refuse authorization until permissions are verified. Admin's documented full-access policy after a successful read is preserved. | `matrix-auth-failure.test.ts`, 20 cases; implemented |
| C02 | An inbox decision stays available to the departure transport until acknowledgment; repeated taps and duplicate simultaneous flushes are guarded; Undo stops when sending starts. Failed departure acknowledgment can retry in the same surviving component. | `inbox-delivery.test.tsx`, 9 cases; implemented within O02 limits |
| C03 | Departure route uses each action's permission rather than requiring attendance correction permission for everything. Denied/unknown/refused/rejected requests have explicit non-success responses. | `inbox-departure-route.test.ts`, 14 cases; implemented |
| C04 | Uncertain inbox transport no longer promises that nothing changed. It asks the person to reload before retrying. | Inbox regression and shared bilingual text; implemented |
| C05 | Day-close history and last receipt date are session-scoped; history pages through every event in batches of 200. Failed pages and pending-reversal reads are not interpreted as an open day/no request. | `fee-day-close-read-recovery.test.ts`, 5 cases, `receipt-read-recovery.test.ts`; implemented |
| C06 | Close refuses incomplete receipt lists and blank sessions; persisted cash denomination counts are finite. Repeated already-closed and failed reopen paths refuse success. | `fee-day-close-actions.test.ts`, 17 cases; implemented within O01 limits |
| C07 | Failed receipt lookup/payment/send/reversal reads propagate; all payment lines are inspected in filters of at most 200 rather than silently dropping IDs after 50. The existing 500-receipt cap reports truncation truthfully. | `receipt-read-recovery.test.ts`, 9 cases, including 401 IDs and 500/501 rows; implemented |
| C08 | Opening WhatsApp writes no sent status. A blocked/closed popup, Keep in To send, or reload leaves the row queued. Explicit I sent it is required to record a manual send. | `manual-outbox-recovery.test.ts`, `manual-outbox-ui-recovery.test.tsx` (7), six real UI browser fixture cases; implemented |
| C09 | Wrong-number checks fail closed on read error/missing data and inspect flags beyond the first page. Confirmation repeats the check. | Manual outbox server tests; implemented |
| C10 | Confirmation and Undo require an affected row; confirmation guards stale/status predicates; Undo matches the exact sent timestamp and manual-only null provider ID. | Manual outbox server tests, 19 cases total; implemented |
| C11 | Failed outbox/count/recipient/group reads cannot render a confident empty or partial list. | `outbox-read-recovery.test.ts`, 11 cases; implemented |
| C12 | Notice approval/decline and fee batch preparation check final transition errors and zero rows. After queueing, failure explicitly warns that messages may already be queued. Stable request IDs are retained on retry. | `outbox-preparation-recovery.test.ts`, 8 cases; five failures reproduced before fix, now pass; implemented within O03 limits |
| C13 | Seat actions keep settings permission/preview guards and derive session/classes on the server; reject mixed unknown classes, duplicate classes and missing session before any save. | `admissions-seats-recovery.test.ts`, 15 cases; three additional failures reproduced before fix, now pass; implemented within O04 limits |
| C14 | Provider acceptance follows the documented HTTP contract without turning null into the literal string "null". Accepted responses without ID retain the existing empty provider marker, which remains ineligible for manual Undo. | `provider-adapter-recovery.test.ts`, 16 mocked cases; implemented within O05 limits |

The first deeper sweep found eleven failing behavior assertions before the
inbox/history/guard/count fixes, followed by seven manual-send failures. The
preparation and seat sweep reproduced eight more failures. Corrected test
assumptions are not counted as bugs: admin with a successfully read empty matrix
retains the explicit admin policy, and AiSensy HTTP 200 does not promise a
messageId. The [AiSensy API reference](https://wiki.aisensy.com/en/articles/11501889-api-reference-docs)
defines acceptance; this audit does not equate acceptance with delivery/read.

## Open correctness findings — do not hide behind green unit tests

| ID / severity | Status and evidence | Specific remaining work |
|---|---|---|
| O01 / P1 | **Reproduced with synthetic action-level interleaving:** two close callers can both read open history and insert close events. The characterization test intentionally asserts the existing two-insert behavior; it is not a proof of atomicity. | Design a separately reviewed database transaction/serialization keyed by session and payment date; verify simultaneous closes/reopens and posting interleavings in an authorized dev fixture. This batch changes no DB function or ledger. |
| O02 / P1 source concern | Keepalive is best effort. Retaining a held entry in memory enables surviving-page retries but cannot guarantee persistence through a closed browser/process. Normal action plus departure transport can overlap; effect deduplication depends on each underlying command. | Durable commands scoped to staff/session and database idempotency, with before/after-commit disconnect tests. Do not claim exactly-once delivery across restart. |
| O03 / P1 source concern | A campaign can be queued before notice/batch metadata fails or another decision wins. Stable request IDs prevent a simple retry from creating a new request, but do not make approval/cancellation plus queue insertion one transaction. | Atomic owned-schema transition/queue command and two-reviewer/fault integration tests; separately review its migration. This batch makes partial success visible, not atomic. |
| O04 / P2 source concern | `saveSeats` upserts non-null limits and then deletes cleared limits in two statements. A mixed set/clear can partially persist if the second statement fails. | Atomic owned-schema set/clear command and a failed-clear regression in an authorized dev fixture. The new action validation prevents invalid batches; it cannot roll back a completed first statement. |
| O05 / P1 source concern | Provider timeout or lost response is not evidence of rejection. Existing failed status/retry behavior plus non-transactional dispatch/recording can duplicate an externally accepted send. No actual external event was exercised. | Define an explicit uncertain outcome/reconciliation policy and atomic claims; verify using a provider sandbox/mock callback with durable records. Do not automatically retry an unknown acceptance as confirmed rejection. |

Promotion apply/undo is additionally **blocked and excluded**. The original
`supabase/migrations/20261010180438_atomic_promotion_recovery.sql` remains subject
to the original unresolved destructive-SQL approval. The local file alone does
not certify the exact queued payload. Recovery requires supported approval UI
or cancellation/status tooling in the original task, then review of the exact
SQL and rollback before approval. Do not apply a duplicate or infer approval
from inability to see the card.

## Complete QA.md matrix: layer covered and acceptance not run

All 13 A–M groups have existing local/domain or fixture coverage rerun in the
full unit suite. All 13 remain partial at school workflow acceptance level;
zero authenticated DB groups were newly accepted in this audit. Relevant files
below are examples of the executed coverage, not claims that every matrix cell
was exercised. Real database/e2e scripts are deliberately not run because they
provision/mutate fixtures or access records outside the current audit boundary.

| Group | Executed local evidence | Not run / remaining acceptance |
|---|---|---|
| A Auth/home | `permissions`, `role-expectations`, `start-destination`, `proxy-redirects`, `matrix-auth-failure`; eight-role shell browser fixtures | Real login/logout/expired session/account switch with persisted DB permission revocation |
| B Navigation/apps | `apps`, `app-origins`, `navigation`, `mobile-navigation`, `navigation-feedback`; More/keyboard/sheet browser cases | Actual sibling-app authorization and browser history across authenticated handoffs |
| C Directory | `directory`, `directory-repo-bounds`, `class-scope`, `class-order`, Student 360 streaming/failure/retry browser fixtures | Actual large directory pages, cross-session persisted selection/back-scroll and source reconciliation |
| D Attendance | Attendance domain, entry points, edit-window/alerts and outbox recovery regressions; register-sheet | Real DB reload, quota/private storage, browser restart, expired auth and two-tab persisted conflict |
| E Corrections/notes | `corrections-domain`, `correction-repo-recovery`, `notes-domain`, inbox faults and departure route | Database transaction failure/independent approval with persisted marks/history; O02 |
| F Timetable/cover | Parser/import/class-access, substitution engine/fixture/plan, cover receipts | Real publish interruption, concurrent/stale plans and downstream saved Today cards |
| G Requests | Collection validation/requests, audience/frozen membership, fan-out/rounds/authored | Actual token expiry, partial multi-class fan-out persisted resumption and master reconciliation |
| H Review | Precedence/record-precedence, collection decision domain and inbox refusal/guards | Concurrent reviewers and lost-response replay against before/after records; O02/O03 |
| I Photos/files | Photo placement and filename identity rules, external IDs | Actual camera/rotation/storage-full/corrupt upload, prior blob retained and cleanup evidence |
| J Marks/reports | Marks command, assessments/academics/report-scheme and totals domains | Persisted lock/concurrent save, issue snapshot after later edits and physical printer |
| K Imports/exports | Sampark identity/import, workbook/external IDs/export labels | Actual large import/export readback, failed-row download and formula/encoding validation with file fixtures |
| L Jobs/messages | Jobs/messages/parent-policy; mocked slow/429/500/timeout; manual popup/confirm browser checks | Durable dispatch/callback/retry idempotency, job stale locks, physical Android WhatsApp; O03/O05 |
| M Fees/admissions | Fee role/session/source-boundary tests, payment draft recovery browser, receipt read/close faults, admissions seat guards | Persisted money/receipt parity, real sandbox posting/reversal, close serialization and mixed seat atomicity; O01/O04 |

Physical Windows/Android/iPhone installation/lifecycle, camera/WhatsApp/printer,
and representative field performance are untested here. Automated responsive
checks do not establish staff usability acceptance. Theme parity comparison is
skipped because this isolated environment has no School Fees reference checkout.

## Validation and release

Final local results and hosted commit verification are filled after the gates
complete. Raw JSON and browser failure artifacts stay outside the repository.
Final units: **12,389 passed / 138 files**, zero failed (150 new cases in 12 new
unit files). The responsive suite passed **80/80** in 5.9 minutes, including six
explicit manual confirmation cases (English, Hindi, both; 390 and 1440 px).
The initial full unit run passed 12,378/137 before the final eleven
preparation/seat cases were added. Port check passed for 726 ported files;
theme check explicitly skipped its unavailable reference comparison.

Two validation attempts require honest follow-up: concurrently running typecheck
and build removed `.next/types` during the typecheck, so final checks are rerun
sequentially. One desktop fallback payment-draft browser case timed out at 60 s
while other heavy checks were active (other three passed); it is retained as a
failed attempt and the complete four-case suite is rerun after those checks.

The sequential final typecheck passed. Final lint passed with four pre-existing
warnings (three PDF image alt warnings and one unused navigation type).
The complete payment-draft rerun passed **4/4 in 57.4 seconds**, both fallback
and IndexedDB storage at 390 and 1440 px, with unchanged test timeout and
assertions. The original timeout artifact is retained outside the checkout.
Final unit JSON is `../remaining-full-suite-final.json`; browser result folders
are `../remaining-mobile-browser-results` and
`../remaining-payment-draft-final-results`. The failed attempt remains under
`../remaining-payment-draft-results`.

Final production build passed (webpack compile 2.3 minutes, TypeScript 17.4 s,
140 generated pages). Build used only the CI placeholder URL/key and dev label,
with no real database configuration. All eight route bundle budgets passed:
login 230.8, teach 234.6, attendance 246.7, dashboard 225.0, students 223.6,
fee payments 231.8, fee transactions 265.5, preferences 226.6 KiB gzip.
The final source/diff check contains zero migration or promotion caller changes.
Review-head CI, main CI and matching hosted deployment are subsequent gates;
their immutable run/commit/deployment identifiers are recorded in the external
release receipt after successful verification.

Rollback for this application-only batch is a reviewed revert to its base
`585e593`; it does not undo user records already changed through the application.
No schema rollback is part of this release.
