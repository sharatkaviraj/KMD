# Rollback — the fees app becomes the system of record again

Go-live Phase G (plan §12.3; critique0 #25; critique1 A11, B12). For the
parallel run (13 Dec – 10 Jan) and until written sign-off. Rolling back is
**the owner's call**; re-entering anything in the fees app writes the fees
database through its own screens and needs the owner's approval (Q16) —
nothing in this repo performs it. The per-change procedures (R1–R12) are in
`ROLLBACK-REENTRY.md`; this page is the order of the whole day.

## When

Any one of these, or the owner's call:
- an unexplained money difference (reconcile-post or day close);
- a payment posted twice;
- a receipt number collision;
- a wrong or duplicate parent message;
- One down for more than 2 desk hours (the desk works on the printed fallback
  meanwhile — `TRAINING-SHEET.md`).

## Step 1 — One stops writing (Owner, minutes)

In this order, fastest first (`ADMIN-OPS-SHEET.md` has every switch):

```sql
-- as postgres in One's SQL editor (fee_writes_enabled: the owner only, D-347)
update public.app_settings set value = 'false' where key = 'fee_writes_enabled';
update vppsone.runtime_flags set enabled = false where key in ('parent_dispatch', 'staff_notice_dispatch');
update public.app_settings set value = 'false'
where key in ('online_payment_links_enabled', 'online_payment_checkout_enabled',
              'online_payment_auto_posting_enabled', 'online_payment_receipts_enabled');
```
- **Check:** `select vppsone.fee_writes_open();` → false; the desk shows "fee
  changes are switched off"; Messages shows dispatch off.
- `receipt_suffix_floor` **stays at 5000** — it keeps One's numbers (5001 up)
  apart from the fees app's (below 5000) through the re-entry and beyond.

## Step 2 — One's timers off (Operator)

Run the unschedule block in `docs/cutover/one-live-cron-jobs.sql` (header,
"ROLLBACK"): it removes `whatsapp-scheduled-runs`, `online-payments-reconcile`,
`auto-day-close`, `fees-nightly-backup`, the three `staff-*` timers,
`ops-health` **and `charge-emi-late-fees-daily`**, so One's EMI late-fee
charge and auto day close stop changing One's database once it is no longer
the record (critique0 #25). The matview refresh stays (derived data only).
- **Check:** `select jobname from cron.job order by 1;` → only
  `refresh-workbook-materialized-views`, `enqueue-workbook-refresh-daily`
  (and `smoke-enforce` if kept).

Vercel crons: set `STAFF_NOTICE_TRANSPORT=disabled` and remove
`MESSAGE_PROVIDER` on One Production and redeploy (the runtime flags above
already stop sends; this makes it permanent). Remove
`/api/jobs/fee-day-summary`, `fee-day-not-closed` and `staff-notices` from
`vercel.json` in a PR if the rollback is final.

## Step 3 — One's Razorpay webhook off (Owner)

Razorpay dashboard → Webhooks → disable `https://one.vpps.co.in/api/webhooks/razorpay`.
Cancel any still-open One payment link from One's online screen (not from the
fees app). The fees webhook was never removed.
- **Check:** `npm run migrate:health -- --probe https://one.vpps.co.in` still
  401 (the route itself stays; the dashboard simply stops calling it).

## Step 4 — the desk goes back to the fees app (Owner, Admin)

Staff told; `fees.vpps.co.in` is the desk again. The owner turns the fees
app's **New payment links** back on if online payments should resume there
(`OLD-PAY-NOW.md`, the reverse of C7).

## Step 5 — what One changed, in full (Operator)

```
npm run migrate:backup-one                     # One's state at the moment of rollback, kept
node scripts/migrate/rollback-export.mjs       # read-only on One
```
`rollback-export.mjs` is driven by One's `public.audit_logs` (before/after rows
for the 42 audited fee tables) plus a timestamp scan of the tables the fee
schema does not audit, so **every** fee change since the cutover watermark is
listed — not only receipts (critique0 #25): receipts and write-offs, late-fee
waivers (including `source = 'online_payment'` ones), reversals and
adjustments, refunds, EMI plans, family links, concessions and fee overrides,
admissions, leavers and student edits, contacts and promises, reminder sends
and notices, online payments. TEST-session changes are counted apart and never
re-entered. Output in `%USERPROFILE%\.vppsone-migration\rollback-<ts>\`
(`detail.csv` in re-entry order with a procedure id R1–R12; never the repo).

Start from the fees app's **current** state, not T0 (critique1 B12): the fees
database kept running its own crons (EMI late fee, auto day close, matview
refresh). Take a fresh read-only `extract-live.mjs` run and its control
totals before re-entering, and after each procedure.

## Step 6 — re-entry in the fees app (Accountant, with the owner's approval Q16)

Before the first re-entered receipt, the **owner** switches the fees app's
receipt notices off, so parents are not messaged a second time with a new
number (critique0 #25): fees app → **Admin tools → WhatsApp**
(`/protected/admin-tools/whatsapp`), untick *receipt notice* and *reversal
notice* (`app_settings` `whatsapp_receipt_notice_enabled` /
`whatsapp_reversal_notice_enabled` = false). They go back on only after the last re-entered receipt.

Then `ROLLBACK-REENTRY.md` R1 → R12 in order. The two rules that matter most:

- **Mode.** The fees desk has no `online` mode. A payment One took online is
  re-entered as **`upi`**, with the **Razorpay payment id** (`pay_…`) as the
  reference, and the One receipt number in the note.
- **Numbers.** Re-entered receipts get the fees app's own next numbers (below
  5000); One's receipts are 5001 and up (the suffix band), so no number is
  ever shared. Write the One number in the fees receipt's note, and the fees
  number against the line in `detail.csv`.

## Step 7 — after

- `node scripts/migrate/reconcile.mjs --live` against the re-entered fees app:
  the fees totals equal One's at rollback (both sides' late-fee crons aside —
  compare at a fixed `--as-of`).
- The owner switches the fees receipt notices back on.
- One stays read-only (`fee_writes_enabled = 'false'`), its data kept, until
  the owner decides what next. `load-snapshot` stays locked by the `cutover`
  row: a new mirror would need a new decision (and the row's removal by the
  owner), never a quiet re-run.
- Write down what happened and why in `docs/DECISIONS.md`.
