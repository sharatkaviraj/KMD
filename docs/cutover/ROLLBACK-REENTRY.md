# Rollback re-entry — putting One's fee changes back into the fees app

Plan §12.3 step 5; critique1 A11, B12. Used only if the owner decides to roll
back after cutover (Q16): One stops taking fee writes, the fees app becomes the
system of record again, and everything One changed since the cutover watermark
has to be re-entered there.

`node scripts/migrate/rollback-export.mjs` (read-only on One) lists those
changes. Its `detail.csv` — in `%USERPROFILE%\.vppsone-migration\rollback-<ts>\`,
never in the repo — has one line per change with a **procedure id** (`R1` …
`R12`, below), sorted in re-entry order. `detail.ndjson` holds the before and
after rows. TEST-session changes are counted apart and are never re-entered.

Everything here is an owner-approved step on the **fees** app (CLAUDE.md
rule 8: a write to the live fee database). Nothing in this repo performs it.

## Before starting

1. **One stops first.** `app_settings.fee_writes_enabled = 'false'` on One;
   One's online payment switches off (One-owned `online_payment_*` keys); the
   One deployment's crons paused. Run `rollback-export.mjs` *after* that, so
   the sheet is final.
2. **Start from the fees app's current state, not from T0** (critique1 B12).
   The fees database kept running its own crons through the parallel period:
   the EMI late-fee charge (`sync_repayment_plan_late_fees`,
   `student_repayment_emi_late_fees`), auto day close (`collection_closures`),
   defaulter recovery state, matview refresh. Take a fresh read-only
   `extract-live.mjs` run and its control totals before re-entering anything,
   and again after each procedure.
3. **Online links One created** are One's. Cancel any still-open One link at
   Razorpay from One (not from the fees app) before the fees app's own online
   flow is switched back on.

## Order and procedures

Re-enter in this order: a student must exist (and a leaver must have left)
before money is posted against them; concessions and plans change what an
installment owes, so they come before the receipts that settle it.

### R1 — admissions, leavers, student edits
Fees screen: **Students** (add / edit). Carry: admission no, class, status,
`joined_on` / `left_on`, transport route, contacts. A leaver's `left_on` makes
the fees app cancel unpaid installments — do it **before** R5, or receipts
allocate to installments that should not exist. Admissions first, then edits,
then leavers, each by `at`.

### R2 — concessions and fee overrides
Fees screens: **Students → fee override**, conventional discount assignment.
Carry the override amounts / policy and reason. Re-check the student's
installments after each: the fees app regenerates them.

### R3 — family links
Fees screen: **Students → family**. Recreate the group and its members before
any family payment in R5 (`post_family_payment` needs the group).

### R4 — EMI plans
Fees RPC `create_student_repayment_plan(p_student_id, p_session_label,
p_scope, p_monthly_amount, p_first_due_date, p_reason,
p_expected_opening_balance, p_client_request_id, p_supersedes_plan_id,
p_due_dates)` via the fees EMI screen. **Reuse One's plan
`client_request_id`** so a retried entry is idempotent. Pass the opening
balance the fees app computes *now* (it will differ from One's if the fees
EMI cron charged late fees meanwhile — do not add One's EMI late-fee rows on
top; the fees cron charges its own, see R7). Plans before EMI receipts.

### R5 — receipts, allocations, online payments
Fees RPC `post_student_payment(p_student_id, p_payment_date, p_payment_mode,
p_total_amount, p_reference_number, p_remarks, p_received_by,
p_receipt_prefix, p_client_request_id)` through the fees **Payments** desk, or
`post_family_payment` for a family receipt.
- **Reuse One's `client_request_id`**: the fees app's
  `receipts_student_client_request_id_unique` makes a repeat a no-op, so a
  half-finished re-entry can be re-run safely.
- Carry payment date, mode, amount, reference (for online: the Razorpay
  `provider_payment_id`), received by; put One's receipt number in the
  remarks. The fees app numbers it in its own `SVP` series — the two numbers
  will differ, and the sheet is the cross-reference.
- Allocation (`receipt allocations`) is the fees app's own: compare the fees
  allocation with One's `payments` rows in `detail.ndjson`; if they differ,
  `post_corrected_payment` with explicit allocations.
- A date the fees app has already closed (`collection_closures`, auto day
  close) must be reopened in the fees **Finance controls** before posting, or
  posted on the re-entry day with the original date in the remarks — owner's
  call, recorded on the sheet.
- One-only captures: a payment One applied is re-entered here as a receipt;
  the fees capture/intent rows are not recreated.

### R6 — write-offs
`post_student_payment` with `p_payment_mode = 'discount'` (fees **Payments →
write-off**), the same amount and reason, after R5 (a write-off closes what
the receipts left).

### R7 — late-fee waivers
Fees RPC `waive_late_fee(p_student_id, p_amount, p_remarks, p_session_label,
p_client_request_id, p_installment_id, p_include_collected)`; a voided waiver
with `void_late_fee_waiver`. **Before each**, read the student's late fee in
the fees app now: the fees EMI late-fee cron may already have charged (or not
charged) what One waived. Waive only what is charged and was waived in One —
never re-create One's `student_repayment_emi_late_fees` rows.

### R8 — reversals and adjustments
`reverse_receipt_admin(p_receipt_id, p_reason)` against the **fees** receipt
created in R5 (look it up by the `client_request_id`), `post_corrected_payment`
or `post_student_payment_with_adjustments` for an adjusted posting. After R5
and R6, since they act on receipts that must exist.

### R9 — refunds
Create the refund request in the fees **Finance controls**, then
`process_refund_with_adjustment(p_refund_request_id)`. After R5/R8.

### R10 — contacts and promises
Fees **Defaulters** screen: the call log, outcomes, promise dates, no-call
flags. Information only, any order; carry the outcome and the snooze date.

### R11 — reminder sends and notices
**Never re-send.** The fees app has no way to record a send without sending,
and its cadence does not know One's sends, so it would message the same
families again. Instead: keep the fees `schedule.auto` campaigns off until the
longest campaign cadence has passed since One's last send (the sheet's newest
`whatsapp_reminder_sends.at`), or set `whatsapp_snoozed_until` per student in
the fees collection flags to One's last send + cadence. Receipt and reversal
notices One sent are not re-sent either.

### R12 — anything else
Read the `detail.ndjson` row and decide by hand; write the decision on the
sheet.

## After

- `reconcile.mjs --live` against One's frozen copy is not the check any more
  (One stopped); compare the fees control totals before re-entry + the sheet's
  money with the fees control totals after.
- Keep the sheet with the owner's sign-off. It holds personal data: it stays in
  the private folder and is deleted when the owner says the rollback is closed.
