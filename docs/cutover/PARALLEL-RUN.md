# Parallel run — the daily checks (13 Dec – 10 Jan)

Go-live Phase G (plan §12.1–12.2, §12.4). Every morning before the desk opens
(08:00–08:45 IST), the Operator runs these and the Accountant signs the day.
Everything here is **read-only on the fees database** (the sealed reader,
D-339) and counts only. Results go in the day's line of the log at the end
(copy it into the office file); per-student detail stays in
`%USERPROFILE%\.vppsone-migration\`, never in the repo.

## Every day

| # | Check | Command / screen | Pass | If not |
|---|---|---|---|---|
| 1 | The health pack | `npm run migrate:health -- --probe https://one.vpps.co.in` — **until T+7 this is the only alert** (the `ops_alert` WhatsApp needs staff dispatch, which starts at T+7): the Operator runs it at **08:00 and again at 16:00 IST** every day (the go/no-go names who); from T+7, once `ops_alert` is on, the 08:00 WhatsApp replaces the 16:00 run | exit 0; probe 401; cold doors refused | each `!!` line: `ADMIN-OPS-SHEET.md` "When the system check says…" |
| 2 | The fees app is quiet | `node scripts/migrate/fees-quiet-check.mjs` | no fees desk receipts, no fees reminder sends or school notices, 0 automatic campaigns; tail payments listed | a fees desk receipt = someone used the old desk: find out who, re-enter it in One from the fees receipt (tail review) and tell them |
| 3 | The tail comes in | `node scripts/migrate/tail-sync.mjs --apply` | new tail rows = the tail payments in check 2 | stop and compare by `provider_payment_id` |
| 4 | Tail receipts posted | **No screen yet** (open gap): SQL editor, `select status, count(*), sum(total_amount) from vppsone.tail_receipts_review group by 1;` and the pending ids | 0 `pending` older than a day | the Accountant posts each at One's desk (mode as the fees receipt, the fees receipt number as the reference); the Operator then marks the row `posted` with `posted_receipt_id`, `resolved_by`, `resolved_at` (or `duplicate` / `rejected` with a note) |
| 5 | Money adds up | `npm run migrate:reconcile-post -- --as-of <today IST>` (One only; the baseline was frozen at C3 with `--baseline`). Not `reconcile.mjs`: after T0 One and the fees app differ by design | exit 0 — per real session and mode, baseline + One's desk postings + tail postings = One's receipts now, and the baseline itself unchanged (receipts, allocations, EMI late fees from before the line); no receipt number twice; none at or under the floor; every posted tail row's receipt exists for its amount. Printed apart: EMI late fees charged since the line, the money summary's change, TEST | exit 1 is a **rollback trigger** (`ROLLBACK-2026-27.md`) — stop and call the owner; a `note:` line (allocations ≠ total, pending tail) the Accountant explains in the log |
| 6 | The online invariant | the reconcile's online section; One → Fees → Online payments → *Review* | captured = on receipts + in review + waiting; every applied capture has its receipt; 0 in review older than a day | the Accountant resolves each `review_required` (see the admin sheet) |
| 7 | Day close matches the cash | One → Receipts → Day close for yesterday | closed by the Accountant; cash counted = cash total | a gap is written down and signed, and is a rollback trigger if unexplained |
| 8 | No duplicate parent messages | the SQL below | 0 rows | a duplicate is a **rollback trigger** — `parent_dispatch` off first |
| 9 | Staff WhatsApp (from T+7) | Messages → Staff | no `failed`/`unknown` left from yesterday; month count under 80% of the cap | settle unknowns; `STAFF-WHATSAPP.md` §4 |
| 10 | Backups | health line *Drive backup overdue* ok; weekly (Mondays): `npm run migrate:backup-one` + `--restore-test` | last Drive run under 30 h; restore OK | re-run the Drive job from Jobs; a failed restore stops any risky change |

Duplicate-message query (One's SQL editor, read-only):

```sql
-- the same family, the same kind, the same day, more than once — reminders and notices
select session_label, student_id::text, notice_kind, sent_on, count(*)
from public.whatsapp_reminder_sends
where status = 'sent' and sent_on >= (now() at time zone 'Asia/Kolkata')::date - 1
group by 1, 2, 3, 4 having count(*) > 1
union all
select session_label, student_id::text, notice_kind, sent_on, count(*)
from public.school_notice_sends
where status = 'sent' and sent_on >= (now() at time zone 'Asia/Kolkata')::date - 1
group by 1, 2, 3, 4 having count(*) > 1;
-- receipt notices: one per receipt
select receipt_id, count(*) from public.notification_outbox
where status in ('provider_accepted', 'delivered') and created_at > now() - interval '2 days'
group by 1 having count(*) > 1;
```
(Ids only on screen; never paste a row into chat.)

## Every week (Mondays, with check 10)

Two things no script here can read, so a person looks:

| # | Check | Who | Where | Pass | If not |
|---|---|---|---|---|---|
| W1 | **AiSensy wallet** | Owner | AiSensy dashboard → Wallet / Billing | the balance covers at least two more weeks at this month's rate (`AiSensy total this month` in the health pack ÷ days so far) | top up before the next reminder run; until then no new category (the plan's sends stop when the wallet is empty, silently for the desk) |
| W2 | **Supabase advisors** on `wtgxcptmucjerhufzjcf` | Operator | Supabase dashboard → Advisors → Security and Performance (or the MCP's `get_advisors`, both types) | no new **ERROR**-level security finding since last week (an RLS-disabled table, an exposed function); new WARNs written in the log | an ERROR is fixed in a migration that week; a new performance WARN goes to the next PR |

Also weekly: set `aisensy_month_plan_cap` once (`ADMIN-OPS-SHEET.md`) so the
health pack judges the AiSensy total against the plan's allowance.

## What gets switched on, and when (plan §12.2)

| Day | What | How |
|---|---|---|
| T0 14:00 | Parent receipts | category `receipt` (`CUTOVER-RUNBOOK-2026-27.md` step 9) |
| T+1 | Reversal notices | category `reversal` |
| T+3 | The first manual reminder run from One | category `fee_reminder`; a run from the reminder screen, never automatic |
| T+7 | Staff WhatsApp for cover and registers | `STAFF_NOTICE_TRANSPORT=aisensy`, `staff_notice_dispatch` on, consent recorded (`STAFF-WHATSAPP.md` §4) |
| T+7 | `fee_statement`, `school_notice` | one category at a time |
| T+14 | The other staff kinds (one by one), possibly one automatic campaign | `staff_notice_kinds_enabled`; the owner's yes for an automatic one |

Each only after the day before was clean on checks 1, 5, 8.

## Sign-off (plan §12.4) — all of these, then the owner signs

- [ ] 28 days without an unexplained difference (check 5).
- [ ] At least 20 day closes matched to cash (check 7).
- [ ] Every online capture posted or resolved (check 6).
- [ ] The tail is empty: past the latest fees Path A expiry and Path B + 21
      days (`fees-quiet-check.mjs` TAIL END), and nothing new in check 3 for a
      week.
- [ ] No duplicate parent messages (check 8, every day).
- [ ] Each role's acceptance recorded (`TRAINING-SHEET.md`, the signed sheets).
- [ ] A tested restore in the last 7 days (check 10).

Afterwards (owner): remove the fees webhook in Razorpay; rotate the Razorpay
keys (they were once pasted in chat, and the fees app holds the same pair);
optionally rotate the AiSensy key; clear `receipt_suffix_floor` only by a
written decision; remove the admin-only fees link; retiring the fees app is a
separate decision.

## The log

| Date | 1 health (08:00 / 16:00) | 2 quiet | 3–4 tail | 5 reconcile-post | 6 online | 7 day close | 8 dupes | 9 staff | 10 backup | W1–W2 (Mon) | Signed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 14 Dec | | | | | | | | | | | |
