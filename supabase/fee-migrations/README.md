# `supabase/fee-migrations/` — fee-schema SQL that One owns

`wtgxcptmucjerhufzjcf` is One's own database (D-338). Its `public` and
`private` schemas hold the fee engine that was copied from the fees app, and
from 30 Oct One may change them. Those changes live here, **not** in
`supabase/migrations/`, which stays `vppsone`-only (rule 1).

Two kinds of file live in this folder:

1. **Catch-up copies of the fees app's migrations.** The fees app keeps
   shipping fee-schema changes to its own database (`vgqyilgstjvgohrsiwkb`).
   One's database has to meet the same schema, so each fees migration is
   copied here under its **original fees version and name**, with a header
   saying where it came from and what (if anything) was changed. The body
   below the header is the fees original; the only edits allowed are the
   ones the header lists.
2. **One-only fee-schema changes** (the fee-writes switch, the TEST receipt
   prefix, parity repairs). These carry a One timestamp and a header saying
   why they differ from the fees app. They never exist in the fees repo, and
   nothing here is ever applied to the fees database.

Every file starts with a header block saying which of the two it is and why
it differs from the fees app. A file without one is a review failure.

## How a file is applied

Through the Supabase MCP, never `supabase db push` (see `docs/SETUP.md`,
"Migrations are applied through the Supabase MCP"). The MCP's
`apply_migration` takes a name and stamps its own version (the time it ran),
so the ledger `supabase_migrations.schema_migrations` records:

| Kind | Ledger `name` | Ledger `version` |
|---|---|---|
| Fees catch-up | `fee_<fees version>_<fees name>` | the MCP's own timestamp |
| Fees catch-up with cron removed | `fee_<fees version>_<fees name>_no_cron` | the MCP's own timestamp |
| One-only fee change | `fee_<file version>_<file name>` | the MCP's own timestamp |

So `select name from supabase_migrations.schema_migrations where name like 'fee_%'`
lists everything this folder has put on the database, and the file for a ledger
row is the one whose basename follows the `fee_` prefix (minus `_no_cron`).

The file is the source of truth. If a database ever has to be rebuilt, the
files replay in filename order after the schema dump they were caught up from.

**Never apply anything in this folder to `vgqyilgstjvgohrsiwkb`** (the live fee
database). It is a read-only source for One (I-2, I-3). `scripts/target-guard.mjs`
names it `FEES_SOURCE_PROJECT_REF` and every One tool refuses it.

## Why the `cron.schedule` blocks were stripped

Two fees migrations schedule pg_cron jobs:

- `20261026120020_whatsapp_scheduled_runs_timer.sql` — the 09:30 IST
  scheduled-campaign timer;
- `20261028140100_online_payments.sql` — the online-payments reconciler.

Both jobs call `https://schoolfees-two.vercel.app/api/cron/...`, the
**production fees app**, whenever Vault holds a secret of the expected name.
Applied to One's database as written they would make One a caller of the fees
app's production endpoints (plan §1.5, critique0 #23). So the copies here have
those blocks removed, and are recorded in the ledger with the suffix
`_no_cron`. One schedules its own jobs, against its own routes, at cutover
(plan §11).

After applying any fee migration, assert:

```sql
select count(*) from cron.job
 where command ilike '%schoolfees-two%' or command ilike '%vercel.app%';
-- must be 0
```

Checked 30 Oct 2026 after the catch-up: 5 jobs (matview refresh, sibling-group
refresh, EMI late fee, workbook enqueue, `smoke-enforce`), none with an HTTP
call at all.

## Applied to `wtgxcptmucjerhufzjcf`

| File | Ledger name | Verified |
|---|---|---|
| `20261026080221_two_reads_every_screen_waited_on.sql` | `fee_20261026080221_two_reads_every_screen_waited_on` | body = fees original |
| `20261026120000_whatsapp_reminder_profile.sql` | `fee_20261026120000_whatsapp_reminder_profile` | body = fees original |
| `20261026120020_whatsapp_scheduled_runs_timer.sql` | `fee_20261026120020_whatsapp_scheduled_runs_timer_no_cron` | cron blocks removed; a `select 1` no-op |
| `20261026120040_school_notice_sends.sql` | `fee_20261026120040_school_notice_sends` | body = fees original |
| `20261027090000_whatsapp_cron_secret_check.sql` | `fee_20261027090000_whatsapp_cron_secret_check` | body = fees original |
| `20261028140000_online_payment_mode.sql` | `fee_20261028140000_online_payment_mode` | body = fees original |
| `20261028140100_online_payments.sql` | `fee_20261028140100_online_payments_no_cron` | cron block removed, rest = fees original |
| `20261029020128_online_payments_server_grants.sql` | `fee_20261029020128_online_payments_server_grants` | body = fees original |
| `20261029030619_guarded_staff_reads_not_callable_by_anon.sql` | `fee_20261029030619_guarded_staff_reads_not_callable_by_anon` | body = fees original |
| `20261029190000_online_payment_orders.sql` | `fee_20261029190000_online_payment_orders` | body = fees original |
| `20261030120000_online_payment_late_fee_policy.sql` | `fee_20261030120000_online_payment_late_fee_policy` | body = fees original |

"Verified" means: with SQL comments and whitespace removed, the md5 of each
file equals the md5 of the statements the ledger recorded for it, and (for the
unchanged ones) equals the fees repo's file at `8a0cd47c`. Spot checks: the five
online-payment / notice tables exist, `payment_mode` has `online`, the 19
`online_payment_*` functions exist, and `anon` cannot execute
`get_dashboard_analytics(text)`.

## Added by PR-1 foundation (30 Oct), applied to `wtgxcptmucjerhufzjcf`

| File | Kind | Ledger version |
|---|---|---|
| `20260525142048_nightly_backup_bucket.sql` | fees copy, verbatim (parity) | 20261030111402 |
| `20260813170000_student_photo_storage_rls.sql` | fees copy, verbatim (parity) | 20261030111416 |
| `20261030200000_parity_revoke_public_execute.sql` | One-only: match live's revokes | 20261030111438 |
| `20261030200100_parity_office_sync_realtime.sql` | One-only: realtime publication | 20261030111442 |
| `20261030230000_fee_writes_guard.sql` | One-only: D-345 switch in 15 money functions | 20261030112459 |
| `20261030230100_test_receipt_prefix.sql` | One-only: TEST receipts numbered TST | 20261030112612 |
| `20261030230200_fee_writes_table_guard.sql` | One-only: the switch also guards direct writes to the 16 money tables, TEST/real boundary moves, and only the owner (no JWT) can set `fee_writes_enabled` | 20261030121509 |

The two catch-up copies were found missing by the schema parity check
(`docs/cutover/SCHEMA-PARITY.md`): the masked replica copied tables and
functions but never storage policies or publication membership.

`vppsone.inject_fee_function_preamble()` (created by the guard file) is how a
One-only change is put into an existing fee function without retyping its
body: it inserts lines after the body's single top-level `begin`, replays the
function's own definition, and proves that removing those lines gives the
original back. Use it for the next such change rather than copying a
5,000-line body by hand; `remove_fee_function_preamble()` undoes it.

One-only files added later are listed in `docs/PROGRESS.md` with the ledger
version the MCP stamped, the same as `supabase/migrations/` (D-22).

## `vppsone` objects created by files in this folder

Rule 1 puts One's objects in `vppsone`, and `supabase/migrations/` is
`vppsone`-only — but a fee-migration that guards or derives fee rows needs
helper functions, and those live in `vppsone` too (never `public`). So some
files here create `vppsone` objects alongside their `public` triggers. Schema
and parity tooling that reads only `supabase/migrations/` for `vppsone` must
also read these:

| File | `vppsone` objects |
|---|---|
| `20261030230000_fee_writes_guard.sql` | `fee_writes_allowed*`, `assert_fee_writes_allowed*`, `inject/remove_fee_function_preamble` |
| `20261030230200_fee_writes_table_guard.sql` | `fee_writes_open`, `request_via_api`, the money/boundary/switch trigger functions |
| `20261031000100_fee_user_from_staff_profile.sql` (D-350, ledger 20261030163950) | table `fee_role_map`, `sync_fee_user_from_staff_profile`, `staff_profiles_sync_fee_user` and its trigger on `vppsone.staff_profiles` |
| `20261031000200_test_account_fee_write_fence.sql` (ledger 20261030172225) | `assert_test_account_may_write_session/student`, `test_account_student_guard`, `test_account_session_row_guard`, `test_account_settings_guard`; replaces `fee_money_row_guard` |

`scripts/verify-fee-parity.mjs` compares `public`/`private` with live, so these
`vppsone` helpers never show as drift; the `public` triggers they back are
One-only and listed in `docs/cutover/SCHEMA-PARITY.md`.

## Added by go-live Phase D (31 Oct), applied to `wtgxcptmucjerhufzjcf`

Live got two fees migrations after fees `main` 8a0cd47c; both are on fees
`origin/main` (b96525ba) now, and `load-snapshot` refused the first real load
until One had their tables and columns.

| File | Kind | Ledger name | Ledger version |
|---|---|---|---|
| `20261030170000_online_payment_staff_alerts.sql` | fees copy; the seeded staff phone list blanked (rule 6) | `fee_20261030170000_online_payment_staff_alerts` | 20261031042015 |
| `20261030190000_whatsapp_failure_desk.sql` | fees copy, body verbatim | `fee_20261030190000_whatsapp_failure_desk` | 20261031042059 |
| `20261031042100_failure_desk_service_grants.sql` | One-only: service_role on the two failure-desk tables (live has it through default privileges, One has none) | `fee_20261031042100_failure_desk_service_grants` | 20261031042122 |

## Added by go-live Phase E (31 Oct), applied to `wtgxcptmucjerhufzjcf`

All One-only. Proof, rolled back, before and after applying:
`scripts/migrate/verify-online-vp1-and-floor.sql` (D-354).

| File | What | Ledger name | Ledger version |
|---|---|---|---|
| `20261031120000_online_vp1_ownership.sql` | One mints `vp1_` / `vp1_o_`; the four record/apply functions refuse `vpps_` (critique0 #2). Creates `vppsone.replace_in_fee_function()` / `undo_replace_in_fee_function()` for exact, reversible swaps inside a fee body | `fee_20261031120000_online_vp1_ownership` | 20261031064009 |
| `20261031120100_receipt_suffix_floor.sql` | `app_settings.receipt_suffix_floor` in the three numbering functions (`vppsone.receipt_suffix_floor()`, 0 when unset, refuses a bad value with VPP02); the two online apply functions post with `vppsone.online_receipt_prefix()` instead of `'SVP'` | `fee_20261031120100_receipt_suffix_floor` | 20261031064037 |
| `20261031120200_online_switches_default_off.sql` | the seven online switches (and the staff-alert one) `'false'`, registered One-owned | `fee_20261031120200_online_switches_default_off` | 20261031064046 |

Checked after applying: grants unchanged on all nine rewritten functions
(service_role only on the online ones, authenticated + service_role on the
posting ones, never anon); the two new `vppsone` functions executable by
authenticated and service_role, not anon; the two rewrite helpers by nobody
but the owner; `cron.job` still calls nothing on `schoolfees-two` or
`vercel.app`; `verify:fee-parity` saw exactly the nine functions change and
its baseline was re-recorded (642 objects).

`vppsone` objects: `replace_in_fee_function`, `undo_replace_in_fee_function`,
`receipt_suffix_floor`, `online_receipt_prefix`.

## Phase D, checked after applying

Neither fees file schedules a cron job. Checked after applying: `cron.job`
holds nothing that calls `schoolfees-two` or `vercel.app` (0); `anon` cannot
read `whatsapp_send_attempts` or execute `staff_payment_alert_claim` /
`web_push_vapid_keys`; `service_role` can read and update both failure-desk
tables. The app code behind them (the failure desk's Fix tab; the staff
payment alerts' push and WhatsApp sender, go-live Phase 8, plan §8.4) is not ported yet — until
it is, the tables fill from their triggers alone.
