# Schema parity: One's main DB vs the fees app's live DB

Checked 30 Oct 2026 (PR-1 foundation, plan §1.3 / §1.5, critique1 B1).

- **Live (fees):** `vgqyilgstjvgohrsiwkb` — read only, catalog SELECTs through
  the Supabase MCP. No row data was read; nothing was written.
- **One:** `wtgxcptmucjerhufzjcf` — One's main database (D-338).
- **Tool:** `scripts/migrate/catalog-fingerprint.sql` (one SELECT; a jsonb of
  `{kind: {object: md5}}`) and `scripts/migrate/catalog-diff.mjs`. Scope: the
  `public` and `private` schemas, plus `storage.objects` policies, triggers on
  `auth.users`, publication membership, extensions and buckets. Function
  bodies are compared with whitespace collapsed: live's were written from
  Windows (CRLF) and the replica's are LF, which is not a difference in what
  they do (that alone made 20 functions look changed on the first pass).

Counts and object names only below.

## Fixed on `wtgxcptmucjerhufzjcf` (supabase/fee-migrations/)

| Found | Fix | Ledger name |
|---|---|---|
| 45 functions executable by PUBLIC (so by `anon`) on One that live has revoked — among them `post_student_payment*`, `post_corrected_payment`, `undo_recent_payment`, `reverse_receipt_admin`, `waive_late_fee`, refunds | `20261030200000_parity_revoke_public_execute.sql` — revoke PUBLIC only; every other grantee row was already equal | `fee_20261030200000_parity_revoke_public_execute` |
| `student_photos: *` storage policies were the old "any signed-in user" ones (fees `20260525133208`), not live's permission-scoped ones | `20260813170000_student_photo_storage_rls.sql` — fees original, verbatim | `fee_20260813170000_student_photo_storage_rls` |
| `nightly_backups: admin read` storage policy missing | `20260525142048_nightly_backup_bucket.sql` — fees original, verbatim, idempotent | `fee_20260525142048_nightly_backup_bucket` |
| `public.office_sync_events` not in the `supabase_realtime` publication, so `OfficeSyncListener` never heard anything | `20261030200100_parity_office_sync_realtime.sql` — the fees original's block | `fee_20261030200100_parity_office_sync_realtime` |

After the fixes: function EXECUTE grants per role are equal on both
databases except for live's three staff-alert functions (below); storage
policies on `storage.objects` are equal (7 = 7); publication membership for
the fee schema is equal (`supabase_realtime: office_sync_events`).

## Residual differences

| Kind | Live | One | Objects | Class | Why |
|---|---|---|---|---|---|
| Functions changed | — | — | `private.current_staff_role()`, `public.has_permission(text)` | **expected, One-only** | D-191: the role falls back to `vppsone.staff_profiles`, so One's staff can take money |
| Functions changed | — | — | the 15 money functions guarded by `20261030230000_fee_writes_guard.sql` (3 of them also by `20261030230100_test_receipt_prefix.sql`) | **expected, One-only** | D-345 fee writes switch; D-346 TEST receipts numbered TST. Listed in the file headers |
| Functions changed | — | — | `online_payment_open_intent`, `online_payment_open_order` (mint `vp1_` / `vp1_o_`); `online_payment_record_capture`, `online_payment_record_order_capture`, `online_payment_apply_capture`, `online_payment_apply_order_capture` (refuse `vpps_`; the two apply also post with `vppsone.online_receipt_prefix()` instead of `'SVP'`); `private.post_student_payment_core`, `post_student_payment`, `post_corrected_payment` (day sequence starts at `greatest(highest, vppsone.receipt_suffix_floor())`) | **expected, One-only** | Go-live Phase E, D-354: fee-migrations `20261031120000_online_vp1_ownership`, `20261031120100_receipt_suffix_floor` (ledger 20261031064009, 20261031064037). The swaps carry `/* [vppsone:…] */` markers and are undone by `vppsone.undo_replace_in_fee_function()`; `verify:fee-parity` baseline re-recorded 31 Oct (642 objects, exactly these 9 changed). Proof: `scripts/migrate/verify-online-vp1-and-floor.sql` |
| Relations live has, One has not | 117 | 103 | `class_aliases`, `enrolments`, `feature_flags`, `job_runs`, `staff_access_links`, `staff_directory` (view), `staff_profiles`, `subjects`, `teaching_assignments`, `timetable_slots`, `timetable_versions` | **expected** | The earlier "School One" placeholders the fees ledger carries as `select 1` files (20260916*). One keeps these in `vppsone`. Their constraints (50), indexes (30), policies (11), RLS flags (10), triggers (8) and grants account for every other live-only row in those kinds. Phase 2's importer must skip them |
| ~~Relations live has, One has not~~ | | | `staff_payment_alerts`, `staff_push_subscriptions`, `private.web_push_vapid`; functions `private.queue_staff_payment_alert()`, `public.staff_payment_alert_claim(int,int)`, `public.web_push_vapid_keys(text,text)`; trigger `receipts.queue_staff_payment_alert` | **fixed 31 Oct (Phase D)** | fees `20261030170000_online_payment_staff_alerts` (now on fees `origin/main`) copied to `supabase/fee-migrations/`, its seeded staff phone list blanked (rule 6; `online_payment_*` settings are One-owned, so the load never brings live's). The sender (push + staff WhatsApp) is Phase F app code |
| ~~Relations/columns live has, One has not~~ | | | `whatsapp_send_attempts`, `whatsapp_number_health`; `whatsapp_reminder_sends.failure_cause, delivery_error_code, delivery_error, resolution, resolution_note, resolved_by, resolved_at`; functions `private.whatsapp_phone_key`, `whatsapp_mark_number`, `whatsapp_send_after_write`, `whatsapp_send_before_update`, `whatsapp_send_attempts_are_append_only`; their triggers and 5 indexes | **fixed 31 Oct (Phase D)** | fees `20261030190000_whatsapp_failure_desk` (live applied it after 8a0cd47c) copied verbatim. One adds `service_role` grants on the two tables (`20261031042100_failure_desk_service_grants.sql`): live has them through its default privileges, One has none. The Fix tab that reads them is not ported yet |
| `auth.users` triggers | 1 | 0 | `sync_staff_profile_from_auth_users` | **to-fix, blocked on Q5 / D-207** | Recreating it gives every account made in One's `/staff` (test accounts included) a `public.users` row as `read_only_staff`, and `current_staff_role()` reads `public.users` first — One's admins and accountants would lose `payments:write` (critique1 B2). Decide role precedence, then apply |
| Table grants | 406 | 343 | 227 rows differ only by `MAINTAIN` (live grants it to anon/authenticated/service_role on every table; One's replica granted the explicit list without it) | **expected (accepted)** | `MAINTAIN` is VACUUM/ANALYZE/REFRESH; the refreshes run as the owner. Not added: it would only widen anon |
| Table grants | | | `academic_calendar`, `backup_runs`, `student_external_ids` (authenticated SELECT only on One), `v_online_payment_reconciliation` (service_role SELECT only), `school_notice_sends` (no anon on One) | **expected (One stricter)** | No app path needs the wider grant; widening anon is not parity worth having |
| Table grants | | | 22 rows for `notion_fee_sync_role` | **expected** | That role exists only on live (the fees Notion sync, B18) |
| Schema grants | | | `public`: live has `PUBLIC USAGE`, `notion_fee_sync_role USAGE`, `pg_database_owner CREATE,USAGE`; One has `postgres`/`service_role` `CREATE,USAGE` instead of `USAGE` | **expected** | anon/authenticated USAGE is equal; no fee path depends on PUBLIC USAGE |
| Default privileges | 22 | 0 | `ALTER DEFAULT PRIVILEGES` in `public` for postgres / supabase_admin | **expected (One stricter)** | Every One fee-migration grants explicitly (the 20261029030619 lesson: defaults hand PUBLIC EXECUTE on new functions) |
| Extensions | 8 | 8 | versions differ | **expected** | Project-managed |
| Buckets | 4 | 8 | `vppsone-archives`, `vppsone-documents`, `vppsone-drive-backups`, `vppsone-photos` | **expected, One-only** | The fee buckets themselves are equal |
| Publication | | | `supabase_realtime_messages_publication: realtime.messages_*` partitions | **expected** | Supabase realtime internals, dated partitions |
| Triggers One has, live has not | | | `fee_writes_row_guard` / `fee_writes_truncate_guard` on the 16 money tables, `fee_writes_class_move_guard`, `fee_writes_class_relabel_guard`, `fee_writes_switch_owner_only` (D-347); `test_account_student_guard` on `students`, `test_account_session_row_guard` on `classes` and `academic_sessions`, `test_account_settings_guard` on `app_settings` (Phase 3, fee-migration 20261031000200) | **expected, One-only** | One's fee-writes switch and test-account fence; their functions live in `vppsone` (see `supabase/fee-migrations/README.md`). Added after this table was drawn; not re-diffed |

### Re-checked 31 Oct (Phase D), without the live catalog

The fees side of `catalog-diff` is a catalog SELECT on live through the
Supabase MCP, which Phase D does not use: its rule is that live is read only
through the sealed client (D-339). What was checked instead:

- **Tables and columns**, through the sealed REST reader: a fresh extract
  (`20261031-pd-catchup`, 90 tables, 78,583 rows, stable on attempt 4) and a
  `load-snapshot` dry run against wtgx refused **no live table and no live
  column** (`unmigratedSourceData` empty; only the `NOT_MIGRATED` /
  One-in-`vppsone` tables of the row above remain, all empty or allowed).
  Its sealed auth rows were purged afterwards.
- **Functions, triggers, indexes** on One: `verify:fee-parity` saw exactly the
  objects of the two catch-up files appear (25), and nothing else; baseline
  re-recorded (642 objects).

A full `catalog-diff` (grants, policies, constraints) needs the live
fingerprint pasted through the MCP — an orchestrator step. **It blocks the
first real load** (tracked on the Phase 6 row of `docs/PROGRESS.md`): the
dry run proves tables and columns only, and `20261030170000` reached live
before fees `origin/main`, so live can gain functions, triggers, policies or
grants that no file here carries. The step, both halves read-only:

1. Run `scripts/migrate/catalog-fingerprint.sql` on `vgqyilgstjvgohrsiwkb`
   (MCP `execute_sql`, a SELECT of catalog tables only), save it outside the
   repo, then `node scripts/migrate/catalog-diff.mjs live.json --one-db`.
2. List live's `supabase_migrations.schema_migrations` versions above
   `20261030120000` and confirm each has a file in `supabase/fee-migrations/`
   (today: `20261030170000`, `20261030190000`).
3. Record anything new in the table above.

The Phase D fixer did not run it either: its brief reads live only through
the sealed client, and the sealed reader has no SQL path (no `LIVE_DB_URL`).

Everything else — enums (12 = 12), every other table/view/matview, index,
constraint, policy, trigger and RLS flag in `public`/`private` — is equal.

## Re-running

```sh
# fees side: paste scripts/migrate/catalog-fingerprint.sql into the MCP
# execute_sql for vgqyilgstjvgohrsiwkb, save the JSON as live.json
node scripts/migrate/catalog-diff.mjs live.json --one-db   # One side over the session pooler
```

Exit 1 while anything differs; compare the output with the residual table
above before believing a new difference is new.
