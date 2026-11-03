# Admin operations sheet — switches, test accounts, consent, online review

Go-live Phase G (plan §11 "Training", critique1 B20). For the owner and the
admins. Every SQL line runs as postgres in the Supabase SQL editor of
`wtgxcptmucjerhufzjcf` (One's database) — never the fees database. Nothing
here is a migration.

## 1. Kill switches — fastest first

| To stop | Do | Takes effect | Undo |
|---|---|---|---|
| **All parent WhatsApp** | `update vppsone.runtime_flags set enabled = false where key = 'parent_dispatch';` | next send | `enabled = true` |
| One parent category (e.g. reminders) | `update vppsone.runtime_flags set value = value - 'fee_reminder' where key = 'parent_dispatch_categories';` | next send | `value = value \|\| '["fee_reminder"]'::jsonb` |
| **All staff WhatsApp** | `update vppsone.runtime_flags set enabled = false where key = 'staff_notice_dispatch';` | next claim | `enabled = true` |
| One staff kind | `update vppsone.runtime_flags set value = value \|\| '{"<kind>": false}'::jsonb where key = 'staff_notice_kinds_enabled';` | next claim | `true` |
| **All real fee writes** (owner only, D-347) | `update public.app_settings set value = 'false' where key = 'fee_writes_enabled';` | next posting | `'true'` (owner) |
| New online payment links / checkout / auto posting / online receipts | `/fees/payments/online` → Switches (a real admin) | next request | the same screen |
| One's timers | `one-live-cron-jobs.sql`, rollback block | next minute | re-run the script |
| Staff WhatsApp transport | Vercel Production `STAFF_NOTICE_TRANSPORT=disabled`, redeploy | after deploy | `aisensy` |
| Parent provider | remove Vercel Production `MESSAGE_PROVIDER`, redeploy | after deploy | `aisensy` |
| A bad deployment | Vercel → Deployments → promote the previous one | instant | promote back |

See what is on: `select key, enabled, value from vppsone.runtime_flags order by key;`
and `select key, value from public.app_settings where key like 'online_payment_%' or key in ('fee_writes_enabled','receipt_suffix_floor','whatsapp_receipt_notice_enabled');`

## 2. The morning "System check" (health pack)

The `health` job runs at 08:00 IST (Vercel) and 08:00 + 16:00 (pg_cron after
C4), counts only, and records its verdict in Jobs. With the `ops_alert` kind
on, every real admin who gave WhatsApp consent gets **"System check"** when
something needs a person. Turn the kind on once (it is off, like every new
kind):

```sql
update vppsone.runtime_flags set value = value || '{"ops_alert": true}'::jsonb
where key = 'staff_notice_kinds_enabled';
```
(and the template `vx_staff_ops_alert_v1` approved with a Live campaign —
`STAFF-WHATSAPP.md` §6). The same check in a terminal: `npm run migrate:health`.
Until that WhatsApp is live (staff dispatch starts at T+7), **nobody is
alerted automatically**: the Operator runs the terminal check at 08:00 and
16:00 IST (`PARALLEL-RUN.md` check 1).

When the system check says…

| Line | Means | Do |
|---|---|---|
| Razorpay events stuck | the reconciler failed 3+ times on an event | Fees → Online payments; look at the event's error; the reconciler retries every 10 min |
| online payments to review | a parent paid but it could not post (`review_required`) | §5 below |
| receipt messages uncertain / failed | the receipt WhatsApp may not have reached the parent | Fees → WhatsApp → failures desk; never resend blindly |
| database timer failures (job names) | a pg_cron job errored | `select * from cron.job_run_details where status='failed' order by start_time desc limit 20;` — the message names the cause |
| app jobs failed / stuck | a `/api/jobs/*` run failed or died | Jobs screen → the run's error; *Run* again |
| Drive backup overdue | no good nightly backup for 30+ hours | Jobs → `drive-backup` → error; *Run*; check the Drive folder access |
| staff WhatsApp failed / uncertain | Messages → Staff | settle unknowns there |
| fee reminders / school notices / parent messages failed | the provider refused | Fees → WhatsApp → failures desk |
| … this month (n of cap) | 80% of the month's WhatsApp cap used | slow down, or raise the cap (§6) |
| AiSensy total this month | every lane together (reminders, notices, receipt notices, One's parent sends, staff) at 80% of the plan (`aisensy_month_plan_cap`, §6) | slow down; check the wallet (below); the owner decides on a bigger plan |
| Razorpay events waiting over 30 minutes | the 10-minute reconciler is not running (often a wrong timer token — next line) | `select status_code, count(*) from net._http_response group by 1;`; fix the Vault secret by name |
| timer calls One refused or missed | a pg_cron timer called One and got 401/404/5xx or no answer (pg_cron itself says "succeeded") | 401: the Vault token does not match One's `CRON_SECRET`/`JOBS_SECRET` — re-store it (`one-live-cron-jobs.sql` header); 404: route or env missing; 5xx: Jobs screen / Sentry |
| Razorpay webhook probe | a wrong signature was not refused with 401 (404 = `RAZORPAY_WEBHOOK_SECRET` missing on Production; before the cutover line a 404 shows as "not configured yet" and is fine) | owner: Vercel Production env, then Razorpay → Webhooks shows the hook enabled (Razorpay disables a hook that keeps failing) |
| … could not be read | the check itself broke | tell the engineer; treat as unknown, not as fine |

Two weekly checks no script can make (`PARALLEL-RUN.md` W1–W2, Mondays):
the **AiSensy wallet** balance (Owner, AiSensy dashboard → Wallet: covers
two more weeks at this month's rate) and the **Supabase advisors**
(Operator, Supabase dashboard → Advisors, Security and Performance: no new
ERROR-level finding).

## 3. Test accounts

- Testing happens in production, under `TEST-2026-27`, by test accounts
  (`vppsone.staff_profiles.is_test_account`, D-346). A test account sees and
  writes only TEST sessions; real staff never see TEST; a real admin sees both.
- **Make one:** Staff → Add → the person (a mailbox the owner controls) →
  role → tick *Test account* → Create login. Or toggle *Test account* on an
  existing profile (Staff → person); the toggle is audited.
- **Never** tick it on a real member of staff, and never untick it on a QA
  account.
- TEST receipts are numbered `TST…`; TEST parent/staff messages go only to
  numbers in `vppsone.message_test_recipients`:
  `select count(*) from vppsone.message_test_recipients;` (add or remove with
  SQL; never in a migration; never paste a number into chat).
- QA passwordless sign-in (`/login/test`) works on production only for test
  accounts; `QA_LOGIN_KEY` is rotated at T0.

## 4. Staff WhatsApp consent

No consent, no message. At training each person signs the paper form
(`STAFF-WHATSAPP.md` §3, Hindi and English). The admin opens **Staff → the
person → WhatsApp consent → Record consent from the form**, and checks the
WhatsApp number on the profile. Anyone can stop it themselves in
Preferences; an admin can record a no. Keep the forms in the office file.

## 5. Online payments to review (Accountant, Admin)

One → Fees → **Online payments** → *Review*. Each row is money Razorpay
captured that One could not post by itself (amount changed, family unclear,
a fees-app link, fee writes off at the time…).

1. Open it: the amount, the reference (`vp1_…` = One's; `vpps_…` = the old
   app's — post those through the tail, not here), the Razorpay payment id.
2. *Post* to the right student(s) — the receipt is `online` mode with the
   Razorpay id — or *Resolve* with a note (duplicate / refund at Razorpay).
3. Never post it a second time at the desk as cash or UPI.
4. A refund is done in the Razorpay dashboard by the owner, then *Resolve*.

The health pack counts open reviews every morning; the target is 0 older
than a day.

## 6. Caps and numbers

| What | Where | Today |
|---|---|---|
| Parent fee reminders a month | `app_settings.whatsapp_month_message_cap` (fees screen *WhatsApp settings*) | 5,000 (wtgx, 31 Oct) |
| School notices a month | code (`SCHOOL_NOTICE_MONTHLY_BUDGET`) | 3,000 |
| Staff WhatsApp a month | `update vppsone.runtime_flags set value = '1500'::jsonb where key = 'staff_whatsapp_month_cap';` | 1,000 |
| AiSensy plan, every lane together (the health pack warns from 80%) | `update vppsone.runtime_flags set value = '<the plan's monthly messages>'::jsonb, enabled = true where key = 'aisensy_month_plan_cap';` | off (not judged) until the owner sets it |
| Receipt number band | `app_settings.receipt_suffix_floor` | 5000 from C3 until written sign-off |
