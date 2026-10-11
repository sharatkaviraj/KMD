# Durable inbox and uncertain provider recovery — 11 October 2026

Base: main ccabab7e0677e084ef4943057647d6a5a1946ce1 (PR 71).
Branch: audit/durable-recovery-20261011. Release checks are pending.

## O02: device persistence and command identity

Inbox decisions persist identifiers and intent before hiding a row. Account, academic session and school day form the storage scope. Normal delivery, departure and reload reuse the same command. Only an explicit successful response removes the device copy. Current authority and scope are checked again at the API and action boundaries. Preview never replays work.

Submissions use the existing transaction command ID, cover uses its existing command, and attendance reminders retain the business-key uniqueness already enforced by their one queue insertion. PR 71 removed attendance correction approval; this branch preserves that removal and refuses old correction beacons.

Cross-tab removal cancels the local undo timer and restores visibility. Earlier decisions belonging to the current account stay visible for review without automatic replay; clearing reviewed device copies does not undo server effects. Storage refusal blocks new transport. Failed work stays recoverable; choosing the opposite decision cannot silently replay the earlier one.

## O05: claim before transport, unknown before retry

A single conditional update writes an attempt marker before contacting the provider. Matching source text, recipient, template, optional source timestamp and provider-null state prevent another request obtaining the same claim. Result recording must match the exact attempt.

Lost response, server error and result-write failure retain the marker and block another provider/manual send or cancellation. Legacy failed rows without confirmed refusal evidence are also blocked. Explicit provider/local pretransport refusal releases the claim. A human can record verified receipt with evidence and an actor; this records receipt without transport. Wrong-number withdrawal preserves uncertain attempts and their evidence. Accepted responses without provider IDs retain the existing non-null empty marker.

Synthetic tests exercise concurrency, refusal, persistence failure, manual overwrite, legacy unknown and evidence preservation. A separate disposable PostgreSQL 17 CI job tests 24 simultaneous claims and post-crash/result/overwrite invariants. It accepts loopback only and contains no hosted database URL or provider operation.

## Validation and limits

A pre-reconciliation full unit run passed 12,443 tests in 141 files. After reconciling PR 71, 12,356 tests passed and one unchanged admin overview case exceeded its five-second deadline under concurrent browser/compiler work; its isolated rerun is pending. New browser cases use synthetic fixture records, intercepted requests, real browser storage and reloads at 390/1440 widths in all three languages. Final counts and CI/deployment identifiers will be recorded at delivery. Typecheck, lint, build and route budgets must pass before merge. No authenticated hosted acceptance or physical phone/provider delivery is claimed.

## Remaining transaction gate

O01 day close, O03 campaign preparation and O04 mixed seat set/clear have separately reviewed proposals in PR 69. Its exact-head disposable PostgreSQL job 38116255233 passed 50 invariants, and application CI 38116255139 passed.

The separate dev DDL action timed out during approval review, then its one supported identical retry returned Invalid or expired requestState. A delivered approval card is not approval. Metadata checks after both attempts found all three functions absent. No third retry, function invocation or caller release occurred. The original promotion approval is untouched. A valid fresh approval must complete before integrating those callers.

The unapproved local migration 20261011060633_owned_workflow_transactions.sql is excluded from this release. No LIVE School Fees operations, personal-record QA reads, real sends, credential probes or security changes were performed.

## Rollback

Before any provider attempt, this application's source can be reverted. After an unknown attempt exists, keep the marker and evidence and disable provider dispatch before rolling application code back: older dispatch code lacks the durable guard. Rolling back application source never proves a message was not delivered. Persisted inbox copies may be retained for review; their removal is not a server undo.


Validation checkpoint 07:02 UTC: reconciled-source typecheck passed after deleting one stale generated type for PR 71's removed route. Isolated provider/admin regressions passed 36/36; provider dispatch safety passed 8/8; inbox storage tests passed 20/20. All six phone/desktop bilingual reload cases passed, and the newly corrected cross-tab case passed separately. That case exposed a timer recreating a removed device copy without a storage event; delivery and departure now reread the durable copy before transport. Lint and clean CI/build/budgets remain pending. The unapproved transaction migration is not staged.
