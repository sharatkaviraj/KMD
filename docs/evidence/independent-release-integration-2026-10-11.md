# Independent non-migration release and integration, 11 October 2026

Final source base: `f895efb1edddcd23877030e4b629a0d18988d71a` (PRs #62-64).
Local branch: `audit/independent-recovery-20261011`.

## Original checkout comparison (read-only)

Source: `C:\Users\AnandKumari\Documents\Codex\2026-10-10\task-2`.
The checkout was never edited, reset, staged or committed by this audit.
Its current tracked non-migration diff was exported to the audit workspace and
`git apply --check` passed against the final audit branch. This command checks
application only; none of the original changes were applied.

| Original pending files | Relationship / integration plan |
|---|---|
| `src/platform/auth/current-staff.ts`, `tests/matrix-auth-failure.test.ts` | No file overlap. Keep the fail-closed permissions fix and its fault-injection tests together in a separate reviewed change. The audit changes do not grant permissions or bypass authentication. |
| `src/vx/screens/admin/inbox.tsx`, `tests/inbox-delivery.test.tsx` | No file overlap. Keep pagehide/in-flight/undo behavior and the component regression together. Review its action imports against PR #63's messaging changes. |
| `src/app/(app)/receipts/actions.ts`, `src/vx/screens/receipts/data.ts`, `src/vx/screens/receipts/load.ts`, `tests/fee-day-close-actions.test.ts` | No file overlap. Integrate the three source files together because the session argument is mandatory; preserve the complete-list refusal and session isolation. |
| `tests/timetable-class-access.test.tsx` | No file overlap. Verify the authorization fixture update with the permissions change, rather than assuming it is needed for the attendance patch. |
| `.gitignore` | No overlap. Review generated-artifact exclusions independently; do not copy all ignored or untracked files. |
| `src/app/(app)/student-tools/actions.ts`, `src/modules/promotion/data/queries.ts`, `supabase/migrations/20261010180438_atomic_promotion_recovery.sql`, `tests/promotion-retry.test.ts`, `scripts/verify-promotion.mjs` | Excluded as a complete promotion-dependent slice. Do not import RPC callers before the unresolved migration is legitimately approved/applied and verified. No approval was retried or bypassed. |
| Original untracked evidence documents | Preserve in the original checkout. Reconcile selected evidence after its executing task has finalized outcomes; an execution ledger with planned reproductions is not completed acceptance. |

## Independent release boundary

The audit's changes use existing attendance register/correction tables and the
existing attendance RPC/expectedRevision contract. They add no SQL, schema,
role, policy, provider dispatch, deployment configuration or promotion import.
The Student 360 changes affect reads and rendering, including propagation of
failed family-membership reads rather than returning an empty sibling list.
They preserve PR #62's concurrent reads, Suspense and client tab state.

PR #63 on main added the `sent` parent-message status and sent columns. The
audit's cancellation update explicitly filters `status = queued`, so it does
not cancel a row marked sent while the register is being saved. Inserts still
use queued status and existing columns. The audit introduces no dependency on
that new migration, and no dependency on the blocked promotion migration.
The main branch's already-merged migration files remain present unchanged.

There is **zero file overlap** with original pending source/test changes.
This establishes source independence and a dry-run-clean integration path.
Publication still requires the final full local gates and exact-head CI; it
does not close known baseline AU-01/IN-01/DC fixes still owned by the original
task or establish complete school acceptance.

## Matrix closure limits

| Matrix row | Feasible evidence in the independent checkout | Still required elsewhere |
|---|---|---|
| Authentication / permission | Existing independent role expectations, role/navigation/class-scope tests; action refusal/preview tests | Actual signed-in denial and permission-service failure with original AU-01 fix |
| Payments / reversal / dues / receipts | Existing payment allocation/grid/domain tests; real synthetic normal/reversed PDF generation; payment draft UI fixture suite where runnable | Database posting/idempotency/money conservation, hosted authenticated PDF |
| Day close / exports | Existing receipt/workbook domain tests | Original DC-01/DC-02 tests/fix; concurrent close DB behavior |
| Admissions / records / import | Existing domain, pagination, record precedence and import tests; PR #64 preserved | Authenticated stable-ID and rejected-row journeys |
| Promotion / undo | Existing pure promotion/student-tools domain coverage only | Blocked migration, retry/undo transaction and rollback drill |
| Attendance / correction / offline | New action/repository and React/storage recovery tests cover AT-01/AT-02 and bounded AT-03; queue fault tests cover error reporting in AT-04 | DB races/roster snapshots; correction-triggered queue reconciliation and delivered-message policy. Queue warning is not atomicity or delivery proof |
| Exams / marks / reports | Existing mark command/domain, report scheme and issued-report domain coverage | Database atomic/versioned saves and authenticated print/locked-exam journeys |
| Timetable / substitution | Existing event/eligibility/publication/cover engine domain coverage | Authenticated multi-actor stale/concurrent publication and original fixture reconciliation |
| Staff / calendar / messages / settings / history | Existing domain tests, PR #63 outbox domain tests, queue error fault injection | Authenticated actions and complete read/error/history behavior; no real dispatch |
| Responsive / recovery | Synthetic browser fixture suite covers widths, languages, themes, keyboard/focus, overflow, reduced motion and UI error/empty states; new real-component Student 360 stream/error/retry cases | Signed-in roles/pages, physical devices/camera/printer/WhatsApp webview and timed school usability |

Do not mark the complete workflow matrix closed merely because its pure/UI
portion passes. The authenticated suite's setup creates/uses QA sessions and
its journeys write shared dev data; it was not run under this read-only/no-auth
boundary. Protected LIVE schoolfees was not accessed.

## Final local checkpoint and publication blocker

- Final full unit run: 12,239/12,239 tests, 126 files, 118.95 seconds.
- Full browser run: 74/74 passed in 6.0 minutes. Payment-draft browser run:
  4/4 passed in 1.0 minute, serially in its own artifact directory.
- TypeScript (including the final build), full lint, production build, port
  imports, diff checks and all eight route bundle budgets passed. The attendance
  route is 246.7 gzip KB. Lint has four existing warnings; theme parity skipped
  because the reference checkout is absent.
- First attempts remain recorded: two browser selector failures caused by
  Suspense's retained hidden subtree, fixed with visible role locators; two
  cold payment loads timed out during concurrent browser runs; five full-unit
  cases timed out under load. Successful reruns retained all assertions and
  original timeouts. No product behavior was weakened to obtain a pass.
- `git apply --check` of the original non-migration tracked patch passed again
  against the final source. Excluded source paths show no diff against main.

Automatic approval review rejected `git push -u origin
audit/independent-recovery-20261011`, stating that external branch publication
preceded the user's full-check/exact-head-CI conditions. Nothing was pushed and
there is no pending approval dialog in this audit. Local gates subsequently
completed, but no push was retried or routed through another tool. Exact-head
CI and main publication remain unverified and require explicit clarification of
review-branch publication authority. The original promotion approval remains
untouched and is unrelated to this local work.

### Authorized publication recovery

After the local gates completed, explicit authorization clarified that review
branch publication must precede exact-head CI. The same push was retried once
and succeeded. [Draft PR #66](https://github.com/veerpatta/vppsone/pull/66) now
holds the independent changes. The preceding rejection above is historical.
Latest main `2d0e8448e83a6642229dfba85176c20e9723eccb` changes only
`docs/ui/DECISIONS.md` and `docs/ui/PROGRESS.md`; it merged cleanly without
altering the application or test source covered by all local gates. Diff
checks and original non-migration patch applicability are rechecked after
this documentation-only reconciliation. Exact-head CI remains the main merge
gate. The branch contains no promotion-dependent change, new migration, or
overlapping original source; the original approval remains untouched.
