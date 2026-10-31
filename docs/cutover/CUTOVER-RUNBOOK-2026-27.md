# Cutover runbook — One takes over the 2026-27 fee data

Go-live Phase G (plan §11, adapted to plan §0.1: One's main database is
`wtgxcptmucjerhufzjcf` — read every "vppsone-live" in the plan as that
project). This is the operator's script for the day. Each step has **who**,
**the exact command or screen**, **the check** that must pass before the next
step, and **its rollback**. A step whose check fails stops the cutover: go to
its rollback, then to `ROLLBACK-2026-27.md` if the step cannot be undone on
its own.

**Roles.** *Owner* — the only person who changes the fee switch, the fees app's
screens, Vercel Production env, Razorpay/AiSensy dashboards and the Supabase
dashboard. *Operator* — runs the scripts from a clone of this repo on the
office machine (`.env.local` for wtgx; secrets file for the fees read-only
reader). *Accountant* — checks figures and signs. *Admin* — One's admin
screens.

**Never, on any step:** a write to the fees database `vgqyilgstjvgohrsiwkb`
(scripts only read it through the sealed reader, D-339), a change to the fees
repo or its Vercel project by tooling, a secret value in chat or a commit.

## The owner-approved sequence (31 Oct 2026)

The owner fixed the order of the steps that cannot be undone:

| # | Step | Who | Undo |
|---|---|---|---|
| 1 | **Backup** | Operator | nothing to undo (read-only) |
| 2 | **Convert to production** | Operator (owner's yes) | `convert-to-production.mjs --revert` per step |
| 3 | **Quarantine** One's test activity | Operator | restore from step 1's backup |
| 4 | **First load** (`--first-load`) | Operator | restore `public` from step 1's backup |
| 5 | **Reconcile** | Operator, Accountant | read-only |
| 6 | Owner turns **OFF the fees app's New payment links** | Owner | owner turns it back on |
| 7 | **Tail-sync** | Operator | delete the run's tail review rows |
| 8 | **Enable real fee writes** (owner-only key) | Owner | set the key back to `false` |
| 9 | **Parent message categories, one by one** | Owner | remove the category / dispatch off |

The plan's F1–C9 hang off that spine below. If the first load (4) is taken
days before T0 (mirror mode), steps 4–5 repeat every night with the nightly
load (no `--first-load`) until the 7-green-reconciles gate; the **T0 load is
the last one**, then steps 6–9 run on T0.

Scripts marked **(phase H)** — `convert-to-production.mjs`,
`classify-dev-vppsone.mjs`, `quarantine-in-place.mjs`,
`promote-master-data.mjs`, `verify-quarantine.sql` — are built and dry-run in
go-live phase H; until that PR is merged the step cannot run.

---

## Go / no-go — T-3 (Thu 10 Dec) and T-1 (Sat 12 Dec)

T0 is proposed for **Sunday 13 Dec 2026** (Q3; the owner confirms). Every
line must be yes at T-1, or T0 moves.

| Check | How | Who |
|---|---|---|
| Every `_v7` parent template and every staff template the first week needs is approved **and** has a Live API campaign | AiSensy dashboard; `APPROVED_V7` deployed (`AISENSY-TEMPLATES.md`) | Owner |
| Razorpay checklist done | `RAZORPAY.md` §1–§6 | Owner |
| The fees app has no automatic campaigns | `node scripts/migrate/fees-quiet-check.mjs` → `fees campaigns with schedule.auto: 0` | Operator |
| Vault secrets exist (by name) | `select name from vault.secrets where name like 'VPPS_%' order by 1;` — the seven names in `one-live-cron-jobs.sql` | Owner |
| Public sign-ups are **OFF** on wtgx (Q21, D-355 (1)) | Dashboard → Authentication → Sign In / Providers → "Allow new users to sign up" off; `load-snapshot --apply` refuses otherwise | Owner |
| Auth on wtgx (plan §9.4, critique1 B17): Site URL `https://one.vpps.co.in` and redirect `https://one.vpps.co.in/**`; custom SMTP from `vpps.co.in` with SPF and DKIM (or the default sender's rate limit accepted in writing); the reset and magic-link emails in Hindi and English. One stays on the same project, so **existing One sessions do not end at C5** (the plan's "new JWT secret" applied to a new project) | Supabase dashboard → Authentication; send a reset to a test account and read it | Owner |
| Real staff have One logins; test accounts exist and are marked | `/staff`; `select count(*) filter (where is_test_account), count(*) from vppsone.staff_profiles where is_active;` | Admin |
| Training done | `TRAINING-SHEET.md` signed per role; `ADMIN-OPS-SHEET.md` walked through | Admin |
| **7 green nightly reconciles in a row** (mirror mode) | `reconcile.mjs` exit 0 seven nights running, reports in the run folders | Operator, Accountant |
| Env inventory settled | `npm run migrate:env-names -- --check` exit 0; `ENV-INVENTORY.md` "To do at C5" list ready | Operator |
| Health pack quiet (except known items) | `npm run migrate:health` | Operator |
| A fresh backup restores | `npm run migrate:backup-one` then `-- --restore-test <run>` → OK | Operator |
| A read-only `pg_dump` of fees live, offline | plan I-3 (read-only session, exported snapshot) | Operator |
| Parents told about the new pay address | `PARENT-NOTICE.md` sent (school notice) at least 3 days before the first `_v7` | Owner |
| The owner's written go | in the office file | Owner |

---

## Saturday 12 Dec — the desk stops

### F1 — 18:00 IST, the desk stops (Owner, Admin)
- Staff told: from now on One; the fees app is for lookups only.
- **Check:** the last fees receipt of the day is printed and filed.
- **Rollback:** none needed; the desk can reopen in the fees app.

### F2 — 18:00–20:00, last day close in the fees app (Accountant)
- Close the day in the fees app as usual (its own auto day close also runs at
  00:00 IST on the fees database — not One's).
- **Check:** cash counted equals the fees day total; signed.
- **Rollback:** none.

---

## Sunday 13 Dec — T0

Timings are targets; the freeze window allows 3 hours of work (rehearsal 2
measures them).

### Step 1 — Backup (07:30, Operator) — owner sequence 1

```
npm run migrate:backup-one
npm run migrate:backup-one -- --restore-test <run printed above>
```
- **Check:** the restore test prints `OK` (every table equal on rows, money
  sums and content hash; the throw-away schema gone). A `backup-one` row is in
  `vppsone.migration_runs`. Also: last night's `drive-backup` is `ok`
  (`npm run migrate:health` shows `Drive backup overdue` ok).
- **Rollback:** none (read-only on the database; the folder can be deleted).
- Note the run id in the log: it is the restore point for steps 2–4.

### Step 2 — Convert to production (07:45, Operator with the owner's yes) — owner sequence 2

```
node scripts/migrate/convert-to-production.mjs            # dry run: read the checklist   (phase H)
node scripts/migrate/convert-to-production.mjs --apply    # (phase H)
```
It sets `app_settings.fee_writes_enabled='false'`, the TEST receipt prefix if
missing, `vppsone.deployment.environment='production'`, converts every
`@qa.vpps.local` / smoke / day-run profile to a test account (never bans),
and turns `parent_dispatch` and `staff_notice_dispatch` off.
- **Check:** `select environment from vppsone.deployment;` → `production`;
  `select vppsone.fee_writes_open();` → `false`;
  `select key, enabled from vppsone.runtime_flags where key in ('parent_dispatch','staff_notice_dispatch');` → both off;
  the script's checklist all ticked.
- **Rollback:** `node scripts/migrate/convert-to-production.mjs --revert <step>`
  (phase H), step by step in reverse.

### Step 3 — Quarantine (08:00, Operator) — owner sequence 3

```
node scripts/migrate/classify-dev-vppsone.mjs                       # read-only counts   (phase H)
node scripts/migrate/quarantine-in-place.mjs                        # dry run            (phase H)
node scripts/migrate/quarantine-in-place.mjs --apply                # (phase H)
node scripts/migrate/promote-master-data.mjs --apply                # (phase H)
psql … -f scripts/migrate/verify-quarantine.sql                     # (phase H)
```
Relabels every dev-era `vppsone` row to `TEST-2026-27`, re-points it at TEST
classes and `TEST-D-` shell students, nulls phones and tokens on them,
promotes the real master data (bucket A), and maps every re-keyed id in
`vppsone.migration_id_map`. It refuses unless the marker is `production` and
fee writes are `false` (so it can only follow step 2).
- **Check:** `verify-quarantine.sql` — every check passes (zero rows labelled
  `2026-27` that point at a dev student, zero phone numbers on quarantined
  rows, both `class_teachers` TEST rows handled — `ct_mismatch = 0`). The
  owner signs the promote list.
- **Rollback:** restore the `vppsone` tables from step 1's backup
  (`BACKUP-EVIDENCE.md`, "The restore procedure"), then re-run step 3.

### Step 4 — First load / final load = C1 (08:30, Operator) — owner sequence 4

```
node scripts/migrate/extract-live.mjs --run t0-<date>                         # read-only on fees live
node scripts/migrate/control-totals.mjs --run t0-<date>                       # vs the fees MCP figures
node scripts/migrate/load-snapshot.mjs --run t0-<date>                        # dry run: read the plan
node scripts/migrate/load-snapshot.mjs --run t0-<date> --apply --first-load   # first ever load
node scripts/migrate/load-snapshot.mjs --run t0-<date> --purge-secrets        # sealed auth rows deleted
node scripts/migrate/storage-copy.mjs --apply                                  # photos, documents
```
(`--first-load` only on the first ever load; it brings live's TEST-2026-27 rows
once. Later loads omit it.) The extract's snapshot is the **watermark**; its
control-totals hash is the cutover baseline.
- **Check:** load-snapshot prints written = planned for every table, 0
  orphans, matviews refreshed; `select summary->'watermark' from
  vppsone.migration_runs where script='load-snapshot' order by finished_at desc limit 1;`
  is the extract's; `vppsone.data_replica` says real data.
- **Rollback:** the load is one transaction — a failure leaves nothing. After
  a commit: restore `public` from step 1's backup (restore procedure), then
  start again at step 4. `replicate-live.mjs` refuses production and is never
  the way back.

### Step 5 — Reconcile = C2 (09:15, Operator, Accountant) — owner sequence 5

```
node scripts/migrate/reconcile.mjs --run t0-<date> --as-of <IST date of the extract>
npm run verify:fee-parity
node scripts/migrate/access-email-check.mjs        # Q6: must print ok (exit 0) before any access email (C5a)
```
- **Check:** reconcile exit 0 — **exact**: counts, ordered md5 per table, the
  session money summary equal to the fees MCP's `get_session_money_summary`,
  per-class rollups, per-student checksums, receipts per mode per date,
  highest suffix per prefix and date, the online invariant. The Accountant
  compares 10 real students' dues in One with the fees app on screen (C8).
  `verify:fee-parity` clean.
- **Rollback:** read-only. A mismatch stops the cutover: no step after this
  one runs; the desk stays on the fees app (`ROLLBACK-2026-27.md` is not
  needed — nothing was switched on).

### C3 — the cutover line and One's settings (09:45, Owner in the SQL editor)

```sql
-- 1. Receipt numbers from 5001 (RAZORPAY.md §4) — before any posting in One
insert into public.app_settings (key, value) values ('receipt_suffix_floor', '5000')
on conflict (key) do update set value = excluded.value;

-- 2. The cutover line: locks load-snapshot out for good, opens tail-sync
insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at, finished_at, status, summary, note)
select 'cutover', 'cutover', r.source_project, r.target_project, r.snapshot_id, r.snapshot_at, now(), 'succeeded',
       jsonb_build_object('load_run', r.id, 'watermark', r.summary->'watermark'),
       'T0: One is the system of record for 2026-27 fees.'
from vppsone.migration_runs r
where r.script = 'load-snapshot' and r.kind = 'run' and r.status = 'succeeded'
order by r.finished_at desc limit 1;
```
```
node scripts/migrate/online-preflight.mjs     # must answer GO
```
- **Check:** one `cutover` row (`select count(*) from vppsone.migration_runs where kind='cutover';` → 1);
  online-preflight GO; `load-snapshot.mjs --apply` now refuses (try the dry
  run: its guard verdict says "cutover row").
- **Rollback:** before anything is posted in One: `delete from
  vppsone.migration_runs where kind = 'cutover';` and remove the floor key.
  After postings: `ROLLBACK-2026-27.md` (the floor stays until sign-off).

### C4 — One's timers (10:00, Owner/Operator in the SQL editor)

1. Store the seven Vault secrets by name (`one-live-cron-jobs.sql` header;
   job tokens from `npm run jobs:tokens` with One's `JOBS_SECRET`).
2. Run `docs/cutover/one-live-cron-jobs.sql` as postgres.
- **Check:** its last two SELECTs: 12 active jobs, none named
  `refresh-sibling-groups-matview`, and **0** jobs calling the fees app; after
  10 minutes `cron.job_run_details` shows `online-payments-reconcile` and
  `staff-notices-dispatch` succeeded and `net._http_response` shows 200s.
  `auto-day-close` exists **once** (exactly one place).
- **Rollback:** the unschedule block in the script's header.

### C5 — Production env and redeploy (10:15, Owner)

Set on One's Vercel **Production** the names in `ENV-INVENTORY.md` → "To do at
C5" (`VPPSONE_ENV=live` with `APP_MODE=production` together, `AISENSY_API_KEY`,
`RAZORPAY_KEY_ID` / `_SECRET` / `_ACCOUNT_ID`, `REPAYMENT_PLANS`,
`NEXT_PUBLIC_SCHOOL_PHONE` / `_ADDRESS` / `_EMAIL`), rotate `QA_LOGIN_KEY`,
then redeploy. `MESSAGE_PROVIDER` and `STAFF_NOTICE_TRANSPORT` stay unset for
now (no parent or staff WhatsApp yet).
- **Check:** `https://one.vpps.co.in` loads; a real admin signs in; a test
  account signs in and sees TEST only; `/login/test` works for a test account
  only; `npm run migrate:health` quiet.
- **Rollback:** Vercel → Deployments → promote the previous deployment
  (instant), then remove the added names.

### C5a — access emails (10:30, Admin)
`node scripts/migrate/access-email-check.mjs` must print `ok`. Then a
password-reset / sign-in link to the 4 fees users with no One account, and to
nobody else (D-355 (3)). Staff who already use One keep their login and session (same project).

### C6 — One's Razorpay webhook (10:45, Owner)
Razorpay dashboard → Webhooks → add `https://one.vpps.co.in/api/webhooks/razorpay`
with a new secret; put that secret in Vercel Production
`RAZORPAY_WEBHOOK_SECRET`; redeploy. The fees webhook stays.
- **Check:** `npm run migrate:health -- --probe https://one.vpps.co.in` →
  "401 on a bad signature".
- **Rollback:** disable the webhook in the Razorpay dashboard.

### Step 6 — the fees app's New payment links OFF = C7 (11:00, Owner) — owner sequence 6

1. One's online switches (`/fees/payments/online` → Switches, a real admin):
   per `RAZORPAY.md` §5 — links, checkout, auto-posting, receipts on;
   `checkout_all_sessions` per Q14; modal off.
2. The owner pays ₹100 live on a TEST student in One: posted once in One
   (`TST<date>-5001`), and in the fees app only an `ignored` event row
   (checked read-only).
3. **The owner turns OFF the fees app's "New payment links"** — fees app →
   Payments → Online payments → Switches (`online_payment_links_enabled`).
   Every other fees switch stays (`OLD-PAY-NOW.md`).
- **Check:** in the fees app the switch shows off (its `online_payment_audit`
  has the `switch_changed` row — read-only check); a fees Pay now page shows
  the static QR, not Razorpay; `fees-quiet-check.mjs` prints the **TAIL END**
  date — write it in the log.
- **Rollback:** the owner turns the fees switch back on; One's switches off.

### Step 7 — Tail-sync (11:15, Operator) — owner sequence 7

```
node scripts/migrate/tail-sync.mjs              # dry run
node scripts/migrate/tail-sync.mjs --apply
```
Brings every fees receipt, capture and event after the watermark into
`vppsone.tail_receipts_review` (evidence, never raw `receipts`/`payments`),
and upserts `online_payment_events` on `provider_event_id`.
- **Check:** counts printed equal `fees-quiet-check.mjs`'s tail counts;
  between F1 and now there should be **none** from the desk (online only).
- **Rollback:** the tail rows are a review list; nothing is posted until
  staff post them. As postgres: `delete from vppsone.tail_receipts_review
  where run_id = '<run>' and status = 'pending';` (the run id is printed).
  There is no review screen yet — `PARALLEL-RUN.md` check 4 says how they
  are posted meanwhile.

### Step 8 — Enable real fee writes = C3's key (11:30, OWNER ONLY) — owner sequence 8

The key can be changed only by a session that did not come through the API
(D-347) — the owner, as postgres, in the Supabase SQL editor:

```sql
select vppsone.fee_writes_open();                         -- false
update public.app_settings set value = 'true' where key = 'fee_writes_enabled';
select vppsone.fee_writes_open();                         -- true
```
- **Check:** the Accountant opens the Payment Desk on a real student and the
  "fee changes are switched off" notice is gone (do not post a test amount on
  a real child); a TEST-student receipt still numbers `TST<date>-5001…`; the
  first real receipt on Monday numbers `SVP<date>-5001` (the floor).
- **Rollback:** `update public.app_settings set value = 'false' where key = 'fee_writes_enabled';`
  — every money RPC refuses real students again at once (fee-migration
  `20261030230000_fee_writes_guard`).

### C8 — enrolments and class teachers (12:00, Admin)
Rebuild 2026-27 enrolments (the count equals on roll plus left, plan B21);
every class has its class teacher (`my_class_keys` non-empty for each teacher
seat). **Check:** counts match the reconcile's.

### Step 9 — Parent message categories, one by one = C9 (14:00, Owner) — owner sequence 9

Before the first: Vercel Production `MESSAGE_PROVIDER=aisensy`, redeploy;
`select count(*) from vppsone.message_test_recipients;` as expected.

```sql
-- once: dispatch on with NO category (nothing goes yet)
update vppsone.runtime_flags set enabled = true where key = 'parent_dispatch';

-- T0, 14:00: receipts only
update vppsone.runtime_flags set value = '["receipt"]'::jsonb where key = 'parent_dispatch_categories';
```
Then, each only after the previous one ran a day clean (health pack quiet,
no duplicate-message query hits — `PARALLEL-RUN.md`):

| When | Add | SQL |
|---|---|---|
| T0 14:00 | `receipt` | above |
| T0+1 | `reversal` | `update vppsone.runtime_flags set value = value || '["reversal"]'::jsonb where key = 'parent_dispatch_categories';` |
| T+3 | `fee_reminder` — the first manual reminder run from One (no reminder on T0 or T0+1) | same, `'["fee_reminder"]'` |
| T+7 | `fee_statement`, `school_notice` | same |
| T+7 or later | `absent_notice` — only after Q13 names its one owner (`runtime_flags.absent_notice_owner`) | same |
| later | `collection_request`, `report_delivery`, `general` | same, one at a time |

- **Check after each:** Messages → the day's sends are only that category;
  `npm run migrate:health` quiet (`parent messages failed` 0).
- **Rollback:** remove the category —
  `update vppsone.runtime_flags set value = value - '<category>' where key = 'parent_dispatch_categories';`
  — or everything at once: `update vppsone.runtime_flags set enabled = false where key = 'parent_dispatch';`
  (instant, next send).

### After 14:00
- `update vppsone.runtime_flags set enabled = true where key = 'staff_notice_dispatch';`
  only on T+7 with `STAFF_NOTICE_TRANSPORT=aisensy` (STAFF-WHATSAPP.md §4).
- The admin-only "Fees app (read-only)" link stays for the parallel run.
- Tell the owner: the fees MCP and Notion now show figures frozen at T0
  (`MCP-AND-NOTION.md`).
- Floor support on T+1 and T+2. The printed desk fallback is at the desk
  (`TRAINING-SHEET.md`).
- From T+1: `PARALLEL-RUN.md` every day.

## Timings to measure at rehearsal 2 (10 Dec)

| Step | Target | Rehearsal 1 | Rehearsal 2 |
|---|---|---|---|
| 1 Backup + restore test | 5 min (31 Oct: under 2 min for 51k rows) | | |
| 2 Convert | 5 min | | |
| 3 Quarantine + promote + verify | 20 min | | |
| 4 Extract + load + storage | 45 min | | |
| 5 Reconcile + parity | 20 min | | |
| C3–C6 | 45 min | | |
| 6–8 | 30 min | | |
| Total in the freeze | under 3 h | | |
