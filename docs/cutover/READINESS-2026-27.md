# VPPS One readiness — 2026-27

Updated 1 November 2026. **HOLD: not ready for final go-live approval.**
This report incorporates the supplied 31 October Codex handoff, the existing
1 November operator evidence, and this continuation's code repairs and
read-only checks. No cutover, real-data load, account reclassification,
provider configuration, fee-switch change, campaign or message is authorized
or performed by this continuation.

## What the verification established

The following are **31 October handoff results**, not tests rerun here. The
original `verify-20261031` extract, journal and `taskB` PDF comparisons are on
the other operator's machine and were not found locally. The supplied handoff
is now available; the earlier local report's statement that it was missing
is superseded.

| Check | Recorded result |
|---|---|
| Source snapshot vs fees MCP | Watermark 31 Oct 15:07:05 UTC; every control-total field matched for 2026-27 and TEST. A 16:49 UTC re-read was unchanged. This proves source extraction parity, not a successful load into One. |
| 2026-27 | On roll 507; counted 510; expected ₹1,32,30,750; paid ₹62,80,609; pending ₹69,43,141; 715 receipts = ₹65,63,109. |
| Other money totals | Late fee charged / waived / pending ₹3,75,000 / ₹8,63,000 / ₹3,68,750; discount ₹14,95,600; write-offs ₹17,250. |
| Change from 30 Oct | Seven receipts added ₹57,325. A separate fees-side duplicate correction reduced expected fees by ₹36,200 and reversed ₹11,700; two duplicate students became inactive. This continuation did not perform that correction. |
| TEST | 76 on roll / 77 counted; 67 receipts = ₹2,77,481. |
| Conversion / quarantine | Seven conversion steps reverted; quarantine + promote + reset rehearsed 35,675 changes, 246/248 checks. The remaining two checks require conversion. These were rehearsals, not committed cleanup. |
| Load plan | 66,880 inserts / 7,473 updates / 7,980 deletes; zero predicted orphans, conflicts or email clashes. Every planned fee-table count matched the extract. Actual SQL load stopped at the first table on JSON encoding. |
| Accounts | Ten fees users: six map to existing One accounts; four new. Existing auth rows/passwords are preserved. Four of the six matching One profiles are TEST accounts, requiring an owner decision below. |
| Receipts | Thirteen compared; amount, number, date, installment, late-fee/waiver lines and words match. Seven pixel-identical after school-header configuration. Two real one-tap online receipts have the mode-label defect repaired in this change. Four arithmetic examples remain an owner decision. |
| App / provider dry runs | TEST fence 6/6 at desktop and 375 px; `/rv` without names; default late-fee waiver visible, Save not pressed; Razorpay SQL dry runs 48/56/34 checks, rolled back. These are not Razorpay provider transactions or physical-phone acceptance. |

## Repairs and current validation

Branch: `codex/cutover-verification-fixes`, based on One `da37090`.
[PR #151](https://github.com/veerpatta/vppsone/pull/151) is the delivery record
(code commit `4ea0240`); see it for CI/build/mobile-fixture and merge status.
Two independent local reviews resolved the audit-row ordering and command
issues; these are local agent reviews, not GitHub approval submissions.

- The snapshot loader's eight JSON bindings and tail-sync's two bindings
  now pass arrays/objects directly to postgres.js, preventing double encoding.
  Regression tests exercise every affected write helper with synthetic rows.
- Receipt lookup ports fees `a966a82`'s order-line → applied-capture fallback.
  Direct captures retain priority; unavailable or ambiguous data retains the
  generic label. Balance-after and paid-so-far arithmetic remains unchanged.
- Loader rehearsals report intended sequence positions without calling
  non-transactional `setval`. A second row-plan comparison inside the load
  transaction, before staff-role derivation generates One-owned audit rows,
  must find no residual imported-row changes. This is not a substitute for
  financial/view reconciliation or same-snapshot export checks.
- Migration output supports an explicit private D: folder. A supplied MCP
  comparison file with missing sessions must fail instead of appearing to pass.
  The documented space-separated `--accept-held <list>` now preserves the
  owner's list instead of parsing it as a boolean flag.
- The teacher screen's nested main landmark and stale role-home expectations
  are corrected. Authenticated browser acceptance is still outstanding.

Dependencies were freshly installed from the lockfile (Next 16.4.3), avoiding
the handoff's stale local Next version. **Local: 383 test files / 18,285 tests
pass**, typegen/TypeScript pass, lint 0 errors (15 existing warnings), import
check clean and 430/430 theme tokens match. CI is the build/deployment gate;
no fresh successful full-data load rehearsal or authenticated E2E is claimed.

## A separate, freshly verified load blocker

Read-only catalog/count checks on **1 November, 03:05 UTC** confirm that the
fees source now has **15 public household tables and two private views** absent
from One. **Ten missing tables contain 7,772 rows.** One also lacks **19 columns
in five existing tables**: `online_payment_intents`, `online_payment_orders`,
`school_notice_sends`, `student_family_groups`, `whatsapp_reminder_sends`.

The full REST extractor additionally cannot read
`household_payment_access_scan_progress`: it contains one row and its
`service_role` has no SELECT privilege. The earlier report knew only nine
populated tables / 7,771 rows because REST could not count that table.
No source grants were changed. These are new household data and behavior,
not approved exclusions. The loader's existing structural refusal is correct.

Therefore **a fresh extract and complete load rehearsal remain blocked** after
the JSON repair. Required next engineering work is a reviewed household schema
and behavior port/classification on One, plus a compatible sealed source read
path. Do not discard populated tables/columns, widen live-source permissions,
use a subset extract as a full rehearsal, or bypass structural checks.

Sanitized fresh evidence:
`D:\Codex\scratch\vppsone-cutover-evidence\household-structure-refresh.json`,
`household-catalog-source.json`, `household-catalog-one.json`.
The earlier full catalog comparison is under
`D:\Codex\scratch\vppsone-readiness-2026-11-01\`.

Once that blocker is resolved, use a fresh full extract and contemporaneous
fees MCP summaries for both sessions, then run:

```powershell
$env:VPPSONE_MIGRATION_HOME = 'D:\Codex\scratch\vppsone-migration'
node scripts/migrate/extract-live.mjs --run <fresh-run>
node scripts/migrate/control-totals.mjs --run <fresh-run> --mcp <private-mcp-totals.json>
node scripts/migrate/access-email-check.mjs --before-load
node scripts/migrate/load-snapshot.mjs --run <fresh-run> --first-load
node scripts/migrate/load-snapshot.mjs --run <fresh-run> --first-load --rollback-only --allow-dev-target
```

Require written = planned, zero orphans, no residual in-transaction row-plan
changes, and a deliberate rollback. Record sequence advancement as skipped.
The access-email precheck reads the current databases; it is not bound to the
extract. Transaction rollback does not undo sequence values consumed by
defaults/triggers; explicit `setval` is skipped, not every possible sequence use.
Financial/view reconciliation and all ten export categories remain required
after an approved load; a dry run is not that proof. Purge sealed auth material
from the operator's original `verify-20261031-a` run when it is no longer needed;
that folder is not on this machine and was not purged here.

## Current switches and recovery

Fresh SELECTs in this continuation show marker `dev`, `fee_writes_enabled`
absent, all eight online switches false, `parent_dispatch=false`,
`parent_dispatch_test_only=false`, and `staff_notice_dispatch=true`.
**The database function `fee_writes_open()` returns true under marker `dev`.**
The deployed app's production/confinement rules restrict real-session writes;
this is not database lockdown. Runbook step 2 explicitly closes the database
gate and staff dispatch later. No switch was changed here.

Existing backup `backup-20261101T023829Z` has **228 tables / 51,509 rows**;
restore-test **228/228** equal on rows, money sums and SHA-256. Its two ledger
successes were re-read. Snapshot: 1 Nov 02:37:14 UTC (08:07 IST); freshness ends
**2 Nov 08:07 IST**. Manifest SHA-256:
`3165236318bbff396eaa45630350db40a6fb30a1c95eb6aba10220a7fe9d4ad9`.
Private files are in the earlier evidence root's `private-backups` folder.
This is existing verified backup evidence, not a new backup in this continuation.
Any later T0 requires a new backup and restore-test. See `BACKUP-EVIDENCE.md`.

`backup-one --restore-test` uses a temporary schema. The separate
`backup-one --restore --rollback-only` path still uses forward-only sequence
advancement; its row rollback must not be described as undoing sequence state.
Review that behavior before repeating a supposedly no-persistent-change
restore rehearsal. No restore was run here.

## Provider and receipt-header setup still required

- **C5, owner, One Vercel Production:** set `NEXT_PUBLIC_SCHOOL_ADDRESS`,
  `NEXT_PUBLIC_SCHOOL_PHONE`, `NEXT_PUBLIC_SCHOOL_EMAIL` to the approved school
  values; `APP_MODE=production`, `VPPSONE_ENV=live`, `AISENSY_API_KEY`,
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_ACCOUNT_ID`, and
  `REPAYMENT_PLANS` per `ENV-INVENTORY.md`. Configure One-owned `SENTRY_DSN`
  if chosen; rotate `QA_LOGIN_KEY` at T0. Redeploy, then check printed headers.
- **C6, owner:** One's own `RAZORPAY_WEBHOOK_SECRET` and webhook. Rehearsal
  uses a matching `rzp_test_` key pair only. No test pair was available in
  supplied/earlier evidence, and no live key was used. Follow `RAZORPAY.md`
  for signed callbacks, duplication/recovery and TEST-session posting checks.
- **AiSensy:** the 31 Oct record is 10 approved / 12 pending `_v7` templates.
  Current status could not be refreshed because connected browser access is
  disabled in Work settings. `APPROVED_V7` is empty; no campaigns are created.
  After owner C5 setup and approved Live API campaigns/code registration,
  keep parent dispatch off, enable test-only mode, verify each parent kind
  using only the three approved recipients, then immediately disable test-only
  mode and record delivery outcomes. No send was attempted here.
- **C4:** remove the failing `refresh-sibling-groups-matview` timer using the
  reviewed cron runbook. Staff messaging requires approved templates,
  consent and caps. Until then name the operator for 08:00/16:00 checks.

## Consolidated owner decisions

Please resolve these together after reviewing the evidence. The two new
receipt/access decisions are not covered by the earlier role-precedence approval.

| Decision | Required answer |
|---|---|
| Receipt arithmetic | Keep One's balance-after / paid-so-far semantics, or match fees? The four exact `taskB` numerical examples were not included in the supplied handoff and are unavailable locally. Supply those redacted examples or recreate them after extraction is unblocked before choosing. No values have been invented. |
| Four remapped real fees users on TEST profiles | For each of the office, admin, teacher and view-only profiles: make the existing profile real via a real admin's `set_test_account(..., false)` with a reason, or choose a new real mapping. Resolve before access acceptance; preserve existing passwords. Names/emails stay outside this report. |
| Two held timetable profiles | Confirm each as a real teacher or QA identity; correct identity/name before `--accept-held` promotion. |
| TEST student phones | Null non-allowlisted primary/guardian/emergency numbers, or explicitly approve additions. Recorded scope: 78 of 79 students. |
| Existing owner activity | Quarantine as TEST, or identify exact real items to preserve (including marks/attendance/documents). |
| Date and parallel run | Confirm T0 and four-week parallel run. Sunday 13 Dec is proposed, not agreed. Seven green nightly reconciles remain a mirror-mode gate. |
| Parent categories and notice | Approve/amend proposal: receipts T0, reversals T+1, manual reminders T+3, statements/school notices T+7; resolve the new-address parent notice at least three days before first `_v7`. Nothing is enabled by this proposal. |
| AiSensy campaigns | Approve creation/registration only for approved `_v7` names; leave `_v6` unchanged. |
| Staff WhatsApp | Choose first kinds, template submission, consent and caps, or staff manual monitoring. |
| Recovery plan | Decide Supabase Pro/PITR or accept the current backup arrangement; no purchase is made here. |
| Class teacher | Recheck the one missing assignment after held-profile/promotion decisions; prior evidence identifies a QA class, not a confirmed real vacancy. |

Already approved: D-350 role precedence, no automatic auth profile trigger,
reset links for four new users only after access-email-check, default desk
waiver, the three test recipients, and switching only old New payment links
at cutover. Do not ask for those decisions again.

## Exact later cutover order — not executed

Use `CUTOVER-RUNBOOK-2026-27.md` for checks/rollback at each step. Only after
blockers, acceptance and written owner go:

1. Backup → `npm run migrate:backup-one`, then `-- --restore-test <run>`.
2. Convert → `node scripts/migrate/convert-to-production.mjs --apply`.
3. Quarantine → `node scripts/migrate/quarantine-in-place.mjs --apply [--accept-held <approved-list>]`, then `promote-master-data.mjs --apply` with the same accepted list; verify quarantine; take step 3b backup/restore-test.
4. Fresh full extract + MCP comparison → `load-snapshot.mjs --run <run> --apply --first-load`; purge sealed auth; approved storage copy and TEST-phone decision. Nightly/final repeat loads omit `--first-load`.
5. `reconcile.mjs --run <run> --as-of <extract-IST-date>`, fee-schema parity, access-email-check, all ten same-snapshot export comparisons, accountant acceptance. Any mismatch stops here.
6. C8 → `rebuild-enrolments.mjs --apply`, resolve class teachers; finish C3–C6 settings/cron/provider setup as ordered in the runbook.
7. Owner: fees app → Payments → Online payments → Switches → **New payment links OFF** (`online_payment_links_enabled`). Keep webhook capture, reconciliation, auto-posting and receipt recovery working.
8. `node scripts/migrate/tail-sync.mjs --apply` reads the recorded cutover watermark; review every entry in `vppsone.tail_receipts_review` using `PARALLEL-RUN.md` (there is no review screen). `--watermark <extract-run-id>` is the explicit extract override for dry-run/rehearsal checks, not `--since`.
9. Only after all preceding checks: owner sets `app_settings.fee_writes_enabled='true'` at step 8. This is when real One fee posting starts.
10. Parent categories enabled individually at C9/approved dates, after template/campaign/provider tests and the owner decisions. Monitor and follow `ROLLBACK-2026-27.md` / `ROLLBACK-REENTRY.md` on failure.

## Final status

| Status | Scope |
|---|---|
| Completed | Supplied verification results preserved; fresh structural/switch/backup checks; code repairs and regression coverage; exact post-load runbook checks and this readiness report. PR validation is recorded in PROGRESS. |
| Awaiting external approval | Consolidated owner decisions, header/provider setup, approved templates/campaigns, staff/accountant acceptance, physical A4/office-printer checks, T0 and paid recovery choice. |
| Blocked | Fresh full source extraction and load rehearsal on household schema/reader drift; original four receipt examples; authenticated browser acceptance; provider end-to-end tests. |
| Ready for final go-live approval | **No — HOLD.** No load or production-mode action was taken. Stop at this report. |
