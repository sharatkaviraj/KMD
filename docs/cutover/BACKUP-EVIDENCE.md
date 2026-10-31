# Backup and restore evidence — One's main database

Go-live Phase G (plan §9.2; critique1 B8). Counts, money sums and hashes
only; no row, name or phone. The backup files themselves are in the
operator's private folder (`%USERPROFILE%\.vppsone-migration\`), never in the
repo (I-5).

## What protects One's data on the free plan

`wtgxcptmucjerhufzjcf` is on Supabase's **free plan: no point-in-time recovery
and no managed backups** (plan §0.1; Pro is the owner's question Q1). Two
backups exist, and the cutover runbook takes the second before every step
that cannot be undone:

| Backup | What | Where | When | Restore proof |
|---|---|---|---|---|
| **Drive nightly** (D-334, job `drive-backup`) | every record of every table, fees included, and every stored file, sealed (encrypted), with a manifest of counts and checksums | the school's Google Drive folder | nightly 03:30 IST (Vercel cron `0 22 * * *`) | `npm run recovery` / `npm run verify:archive` (D-334) |
| **`backup-one.mjs`** (this phase) | the rows of every table in `public` and `vppsone` in one consistent snapshot: `COPY` text, gzip, and a manifest of counts, money sums and SHA-256 per table | `%USERPROFILE%\.vppsone-migration\backup-<run>\` on the operator's machine | before each real load (runbook step 1), at T0, before any rollback | `--restore-test` (below), every time |

Not in `backup-one.mjs`, on purpose: `auth.*` (users and password hashes —
the Drive backup has them, and the loader keeps its own sealed auth extract),
Storage files (the Drive backup copies them), and the schema (rebuilt from
`supabase/migrations/`, `supabase/fee-migrations/` and the fee baseline; the
manifest keeps each table's columns and types). The fees app's own
`nightly-backup` (CSV of five tables to the `nightly-backups` bucket) is
scheduled on One's database at C4 (`one-live-cron-jobs.sql`).

## The Drive nightly backup ran (checked read-only, 31 Oct 2026)

From `vppsone.job_runs` on wtgx:

| Night (IST) | Job | Status | Tables | Rows | Files | Snapshot |
|---|---|---|---|---|---|---|
| 31 Oct 03:30 | `drive-backup` | ok, scheduled | 220 | 51,240 | 34 (13 unchanged) | `snapshot-2026-10-30T22-00-28Z`, 3,934 KB |
| 30 Oct 03:30 | `drive-backup` | ok, scheduled | 204 | 49,741 | 34 | `snapshot-2026-10-29T22-00-26Z` |
| 29 Oct 03:30 | `drive-backup` | ok, scheduled | 204 | 49,692 | 34 | `snapshot-2026-10-28T22-00-27Z` |
| 31 Oct 03:36 | `document-backup` | ok, scheduled | — | — | 20 verified on Drive | — |

The last successful run was 13 hours before this check. The health pack
watches it from now on (`drive_backup_hours`: a problem past 30 hours).

## `backup-one.mjs`, run for real on 31 Oct 2026

```
npm run migrate:backup-one
npm run migrate:backup-one -- --restore-test backup-20261031T121335Z
```

| | |
|---|---|
| Run | `backup-20261031T121335Z` |
| Snapshot | 2026-10-31 12:13:35 UTC, one `REPEATABLE READ READ ONLY` transaction |
| Tables | 228 (79 `public`, 149 `vppsone`) |
| Rows | 51,482 |
| Size | 17.2 MB raw, 3.0 MB gzip |
| Manifest SHA-256 | `ae79f327906810a4c5b8a41277060886c4b0296304208d3f9ee9616641c76d0c` |
| Ledger | `vppsone.migration_runs`: `backup-one` / `run` / succeeded, and `backup-one-restore-test` / `dry_run` / succeeded, both naming this run |

**Restore test: OK.** Inside one transaction on wtgx: a throw-away schema
`restore_test_20261031_1e9a` (all privileges revoked from `public`, `anon`,
`authenticated`; never committed, so no other session could see it), all 228
tables created from the manifest's column types, every file loaded back with
`COPY … FROM STDIN`, then compared table by table:

- **228 of 228 equal** on row count, on every money-like column's sum, and on
  the SHA-256 of the table dumped again (byte-for-byte the same `COPY`
  stream as the backup file);
- the schema was dropped inside the transaction and the transaction rolled
  back; afterwards `pg_namespace` has **0** `restore_test%` schemas.

The first attempt hung after `public.receipts` (postgres.js leaves the socket
paused when a COPY's last chunk fills its stream buffer and the stream is
piped); it was a read-only transaction, the process was stopped and its
partial folder deleted, and the script now drains each COPY in flowing mode.

The data on 31 Oct is the masked 22 Sep replica plus One's test activity
(`vppsone.data_replica`), so these sums show that the backup and the restore
are exact; they are not real money.

| Schema | Tables | Empty | Rows |
|---|---|---|---|
| `public` | 79 | 38 | 20017 |
| `vppsone` | 149 | 36 | 31465 |

Every table with rows (the empty ones were restored and compared too). Equal = rows, sums and content hash; the prefix is the backup SHA-256 of the table COPY stream.

| Table | Rows | Money sums (source = restored) | Hash |
|---|---|---|---|
| `public.academic_sessions` | 3 | — | equal `23616aeb7e20` |
| `public.app_settings` | 20 | — | equal `8daf8cd3e117` |
| `public.audit_logs` | 8163 | — | equal `cea32b6d4724` |
| `public.classes` | 58 | — | equal `a3a719aa5fd0` |
| `public.collection_closures` | 114 | — | equal `8892198de2f0` |
| `public.conventional_discount_policies` | 9 | fixed_tuition_amount 18000 | equal `bc5c7636102f` |
| `public.defaulter_contacts` | 2310 | — | equal `a8e85eb1ec47` |
| `public.defaulter_recovery_state` | 3 | — | equal `cb7691c51988` |
| `public.fee_policy_configs` | 3 | late_fee_flat_amount 3000; new_student_academic_fee_amount 3300; old_student_academic_fee_amount 1500 | equal `16eea83abc4e` |
| `public.fee_settings` | 57 | annual_base_amount 1371000; late_fee_flat_amount 57000; tuition_fee_amount 1371000 | equal `de6d4ce05538` |
| `public.installments` | 2556 | base_amount 15717500; late_fee_flat_amount 2459000 | equal `d63569f72e0e` |
| `public.office_sync_events` | 34 | — | equal `dd82b43b10bd` |
| `public.payment_adjustments` | 68 | amount_delta -276752 | equal `bddda15093ed` |
| `public.payments` | 1151 | amount 5845440; discount_applied_at_posting 500; waiver_applied_at_posting 2000 | equal `ffea4a023618` |
| `public.prev_year_import_batches` | 1 | confirmed_subtotal 867700; applied_subtotal 867700 | equal `24b5b01f8a2c` |
| `public.prev_year_import_rows` | 82 | prev_year_due 973500; applied_amount 867700 | equal `ec02c6d4a300` |
| `public.promotion_run_entries` | 1521 | credit_balance 15000; opening_credit_amount 15000 | equal `787fd73473fc` |
| `public.promotion_runs` | 3 | credit_carry_forward_total 15000 | equal `3eb83a0b817b` |
| `public.receipt_adjustments` | 17 | amount_delta 16500 | equal `3a6cbf0395aa` |
| `public.receipts` | 669 | total_amount 5802065 | equal `a5cc3c4f2a9c` |
| `public.school_fee_defaults` | 1 | late_fee_flat_amount 1000 | equal `1dad565335fb` |
| `public.setup_progress` | 1 | — | equal `c739b02aec84` |
| `public.student_carry_forward_balances` | 78 | original_amount 900000 | equal `dcace69e207b` |
| `public.student_collection_flags` | 30 | — | equal `e044d69c2800` |
| `public.student_conventional_discount_assignments` | 115 | before_tuition_amount 2411500; resulting_tuition_amount 499750 | equal `1418e25ab7f9` |
| `public.student_family_groups` | 100 | — | equal `7959718af7dc` |
| `public.student_family_members` | 220 | — | equal `952cbad4a6e5` |
| `public.student_fee_overrides` | 510 | custom_annual_base_amount 3198500; discount_amount 1201850; custom_tuition_fee_amount 35000; custom_transport_fee_amount 67200; late_fee_waiver_amount 132000 | equal `a2b3d226e051` |
| `public.student_late_fee_waivers` | 1007 | amount 1005250 | equal `00ea7c288b50` |
| `public.student_repayment_emi_late_fees` | 2 | amount 2000 | equal `2689da02f47b` |
| `public.student_repayment_plan_items` | 16 | snapshot_base_charge 187750; included_base_balance 187750 | equal `8a7637925c21` |
| `public.student_repayment_plans` | 5 | opening_balance 187750; monthly_amount 20625; final_installment_amount 10875 | equal `ced3553ec8b8` |
| `public.student_repayment_receipt_links` | 7 | contribution_amount 15000; spillover_amount 10000; plan_balance_before 122300; plan_balance_after 107300 | equal `30ced0652d73` |
| `public.student_repayment_schedule` | 43 | amount 187750 | equal `7d0f42f084b8` |
| `public.students` | 620 | — | equal `c71f82b299a5` |
| `public.transport_routes` | 29 | default_installment_amount 70500; annual_fee_amount 282000 | equal `edd76a3cc0ef` |
| `public.user_activity_events` | 331 | — | equal `4377dc79a2a5` |
| `public.users` | 49 | — | equal `232ad50eed37` |
| `public.whatsapp_reminder_sends` | 5 | due_amount 88300 | equal `bb617efcf8ca` |
| `public.whatsapp_send_attempts` | 5 | — | equal `9b925a6f17e9` |
| `public.workbook_materialized_view_refresh_queue` | 1 | — | equal `7280352b1886` |
| `vppsone.academic_calendar_days` | 21 | — | equal `ea9061bb7472` |
| `vppsone.academic_exports` | 11 | — | equal `43495e4774ae` |
| `vppsone.acc_cheque_events` | 7 | — | equal `1171f59c2ce0` |
| `vppsone.acc_cheques` | 5 | — | equal `e4005968e5d4` |
| `vppsone.acc_deposit_slips` | 2 | total_amount 44483 | equal `9b8ae7db4e1a` |
| `vppsone.acc_report_schedules` | 3 | — | equal `dd07410a04c0` |
| `vppsone.acc_requests` | 3 | amount 500 | equal `17cf36d1e1af` |
| `vppsone.acc_upi_events` | 2 | — | equal `184cac3b488e` |
| `vppsone.acc_upi_lines` | 4 | amount 13152 | equal `bd8ef258acae` |
| `vppsone.admission_details` | 3 | — | equal `5337c6b891aa` |
| `vppsone.assessment_subjects` | 209 | — | equal `5dce5b45df8e` |
| `vppsone.assessments` | 6 | — | equal `80982c122923` |
| `vppsone.assist_log` | 2 | — | equal `95314a8fec13` |
| `vppsone.assist_settings` | 1 | — | equal `dc0c5ab1f55c` |
| `vppsone.attendance_corrections` | 8 | — | equal `307b07ffebcc` |
| `vppsone.attendance_marks` | 17983 | — | equal `1ee55d215b28` |
| `vppsone.attendance_register_revisions` | 62 | — | equal `fc36a03118bb` |
| `vppsone.attendance_registers` | 978 | — | equal `e8d20a40238d` |
| `vppsone.bell_schedules` | 1 | — | equal `2dbaa09902d1` |
| `vppsone.calendar_events` | 14 | — | equal `7d46c4827d7e` |
| `vppsone.calendar_notices` | 4 | cost_paise 178464 | equal `e8aba050c5ff` |
| `vppsone.class_aliases` | 38 | — | equal `bf240475535d` |
| `vppsone.class_seats` | 19 | — | equal `2a316c00cea5` |
| `vppsone.class_teachers` | 23 | — | equal `85ccc685b32f` |
| `vppsone.collection_fields` | 17 | — | equal `517071422ced` |
| `vppsone.collection_request_fields` | 7 | — | equal `e8d980c577a9` |
| `vppsone.collection_request_members` | 48 | — | equal `d69aa02ed61b` |
| `vppsone.collection_requests` | 10 | — | equal `6474f4e21f87` |
| `vppsone.collection_round_fields` | 6 | — | equal `a92b47b636d8` |
| `vppsone.collection_rounds` | 6 | — | equal `ea1f760a1a45` |
| `vppsone.collection_submissions` | 23 | — | equal `ac08f90ff542` |
| `vppsone.cover_commands` | 16 | — | equal `7fedf8d6e9e4` |
| `vppsone.cover_days` | 4 | — | equal `4d1d01023356` |
| `vppsone.cover_duties` | 26 | — | equal `ab719a6be7cc` |
| `vppsone.cover_policies` | 8 | — | equal `e1ffcaa70915` |
| `vppsone.data_replica` | 1 | — | equal `bc3e86591e22` |
| `vppsone.deployment` | 1 | — | equal `1bfd0058e784` |
| `vppsone.deployment_history` | 1 | — | equal `1bfd0058e784` |
| `vppsone.drive_folders` | 4 | — | equal `eaae28741b56` |
| `vppsone.drive_object_copies` | 13 | — | equal `eeaf925cb376` |
| `vppsone.drive_snapshots` | 4 | — | equal `8386493f9d54` |
| `vppsone.enquiries` | 12 | — | equal `dadf493ae5ee` |
| `vppsone.enrolments` | 587 | — | equal `1f0da30e9cca` |
| `vppsone.exam_activity` | 19 | — | equal `0d7f61920956` |
| `vppsone.exam_plans` | 2 | — | equal `76a408e4bf06` |
| `vppsone.exam_question_papers` | 28 | — | equal `8273dfbcdff6` |
| `vppsone.exam_rechecks` | 3 | — | equal `986d9f731e9a` |
| `vppsone.exam_rooms` | 15 | — | equal `9c39a075b77d` |
| `vppsone.exam_slots` | 28 | — | equal `b2cd275786ad` |
| `vppsone.fee_call_promises` | 6 | amount 99100.00 | equal `79cbb5457589` |
| `vppsone.fee_day_close_events` | 4 | — | equal `389632851763` |
| `vppsone.fee_desk_requests` | 3 | amount 502.00 | equal `29e3a4f44210` |
| `vppsone.fee_reminder_batches` | 1 | — | equal `7e1505eb3136` |
| `vppsone.fee_reminder_rules` | 4 | — | equal `f9cac3133243` |
| `vppsone.fee_role_map` | 8 | — | equal `a235403298a8` |
| `vppsone.file_storage_settings` | 1 | — | equal `6ef88f83e9f9` |
| `vppsone.file_storage_settings_history` | 6 | — | equal `3eebd27f6c88` |
| `vppsone.job_runs` | 186 | — | equal `6314cecc7d66` |
| `vppsone.marks` | 5364 | — | equal `2c16a7c68d1a` |
| `vppsone.marks_change_log` | 287 | — | equal `9400defa20a9` |
| `vppsone.marks_commands` | 55 | — | equal `2dd777c380c4` |
| `vppsone.message_campaigns` | 6 | cost_paise 880 | equal `3af1e969137f` |
| `vppsone.message_sends` | 42 | — | equal `70d87e7e3e14` |
| `vppsone.message_templates` | 28 | — | equal `01bf50a41466` |
| `vppsone.message_test_recipients` | 3 | — | equal `54a08a83e185` |
| `vppsone.note_kinds` | 6 | — | equal `1b36d395203f` |
| `vppsone.note_replies` | 10 | — | equal `ca6d1d28e56e` |
| `vppsone.notes` | 50 | — | equal `bcc78753985e` |
| `vppsone.one_owned_fee_settings` | 12 | — | equal `72dfb5926a10` |
| `vppsone.parent_message_policies` | 4 | — | equal `3e8f16fc5b3b` |
| `vppsone.parent_message_queue` | 8 | — | equal `06b273a50a2c` |
| `vppsone.parent_replies` | 3 | — | equal `caad6df787ad` |
| `vppsone.photo_proposals` | 1 | — | equal `b38728503ade` |
| `vppsone.qa_dayrun_accounts` | 6 | — | equal `96d9f09064de` |
| `vppsone.qa_dayrun_pairs` | 10 | — | equal `a4e84219e232` |
| `vppsone.qa_dayrun_runs` | 1 | — | equal `5d3ac9262ef3` |
| `vppsone.qa_dayrun_sessions` | 10 | — | equal `192fdd90f0bd` |
| `vppsone.qa_runs` | 9 | — | equal `a9d343404fcb` |
| `vppsone.qa_undo` | 35 | — | equal `eb009e378d0c` |
| `vppsone.rate_limits` | 149 | — | equal `73fcdb0a4a21` |
| `vppsone.record_commands` | 130 | — | equal `4e9c17c70020` |
| `vppsone.report_card_issues` | 1 | — | equal `033ec439830e` |
| `vppsone.report_card_remarks` | 3 | — | equal `5da0b6e61557` |
| `vppsone.report_cards` | 1 | — | equal `7b914dc63a76` |
| `vppsone.report_schemes` | 1 | — | equal `dc47f9c2d6cb` |
| `vppsone.role_permissions` | 103 | — | equal `2ac64d0c3091` |
| `vppsone.runtime_flags` | 10 | — | equal `a85740fb7ebb` |
| `vppsone.smoke_findings` | 272 | — | equal `6d0a6e23bc1c` |
| `vppsone.smoke_passes` | 138 | — | equal `3b2d2f189dfd` |
| `vppsone.smoke_pool` | 28 | — | equal `5886864e62e9` |
| `vppsone.smoke_runs` | 11 | — | equal `a4c0475bab74` |
| `vppsone.staff_authority_changes` | 39 | — | equal `61b4af9dbc6d` |
| `vppsone.staff_notice_attempts` | 46 | — | equal `abbb969ee512` |
| `vppsone.staff_notices` | 352 | — | equal `2f93358ec6ac` |
| `vppsone.staff_profiles` | 40 | — | equal `70687f9e67c0` |
| `vppsone.staff_send_pace` | 1 | — | equal `a17b808c1735` |
| `vppsone.student_documents` | 22 | — | equal `01405e29837d` |
| `vppsone.student_followups` | 2 | — | equal `e3a24bd00fa5` |
| `vppsone.student_record_history` | 15 | — | equal `fd56bab116b1` |
| `vppsone.student_records` | 15 | — | equal `1c84a1d69bd5` |
| `vppsone.subjects` | 23 | — | equal `8b7e538db58a` |
| `vppsone.substitution_assignments` | 74 | — | equal `3246599fc151` |
| `vppsone.substitution_plans` | 2 | — | equal `d0510253a74b` |
| `vppsone.support_plan_steps` | 12 | — | equal `b2520f18b88b` |
| `vppsone.support_plans` | 4 | — | equal `a67bef9ba605` |
| `vppsone.teacher_absence_history` | 10 | — | equal `847a3198892f` |
| `vppsone.teacher_absences` | 19 | — | equal `8cb722e31899` |
| `vppsone.teacher_leave` | 8 | — | equal `6307437252d9` |
| `vppsone.teacher_task_previews` | 3 | — | equal `653618e2c72c` |
| `vppsone.teacher_tasks` | 2 | — | equal `3daafa333beb` |
| `vppsone.teaching_assignments` | 345 | — | equal `be78ede703cd` |
| `vppsone.timetable_slots` | 3114 | — | equal `a89e2385d399` |
| `vppsone.timetable_versions` | 3 | — | equal `b8d4e1518669` |

empty tables restored and equal: 74

## The restore (for real, not a test) — `backup-one.mjs --restore`

A restore replaces data; it is the owner's decision. It is the rollback of
cutover steps 3 (quarantine: `--schema vppsone`) and 4 (first load:
`--schema public`), and is one command — dry run by default:

```
npm run migrate:backup-one -- --restore <run> [--schema public|vppsone] [--tables s.t,…]   # dry run
npm run migrate:backup-one -- --restore <run> … --rollback-only                           # rehearsal
npm run migrate:backup-one -- --restore <run> … --apply                                   # for real
```

Before `--apply`: writers stopped (`fee_writes_enabled = 'false'` — the
restore refuses otherwise — and, after C4, One's timers unscheduled), and a
fresh `npm run migrate:backup-one` of the current state, so the restore can
itself be undone. What `--apply` does, in ONE transaction:

1. every file read and checked against its manifest hash before the
   database is opened; today's columns against the backup's (a column gone,
   retyped, or a new NOT NULL one without a default refuses);
2. the tables locked ACCESS EXCLUSIVE (10 s lock timeout, so a busy table
   fails the run instead of queueing the app behind it), **then** the guard
   (`lib/guards.mjs` `decideRestoreGuard`): never once a `cutover` row exists
   (after T0 the way back is `ROLLBACK-2026-27.md`); only with the marker at
   `production` and `fee_writes_open()` false;
3. the **named** user triggers off (never `session_replication_role`, so the
   foreign keys stay on); every table emptied in one `TRUNCATE` — which itself
   refuses if a table outside the restore still points in (an empty one, like
   `private.vpps_student_source_mapping`, is emptied along);
4. `COPY … FROM STDIN` parents first; live's one foreign-key cycle
   (`installments` ↔ `student_carry_forward_balances` ↔
   `prev_year_import_rows`, none deferrable) is closed by loading
   `installments.carry_forward_balance_id` null and setting it in a second
   pass; the two deferrable self-references checked at once (`set constraints
   all immediate`);
5. every table compared with the manifest: rows, every money sum, and the
   content (byte for byte, or as a sorted set where the second pass reordered
   rows) — any difference rolls back;
6. whatever the backup held, `fee_writes_enabled = 'false'` and
   `parent_dispatch` / `staff_notice_dispatch` off; triggers back on;
7. an orphan count on every foreign key touching the restore (a user deleted
   from `auth.users` since the backup would show here) — any orphan rolls
   back; owned sequences moved forward only (a number handed out after the
   backup is never handed out again); matviews refreshed; the guard re-read;
8. a `backup-one-restore` / `rollback` row in `vppsone.migration_runs`
   naming the loads it undid (`undid_runs`): load-snapshot then counts them as
   not applied, so the next load may be `--first-load` again.

Never restored (`RESTORE_KEEP`): `vppsone.deployment` (the production marker
step 2 set) and `vppsone.migration_runs` (the record). A `vppsone` restore
puts back the backup's test-account flags too, so step 2
(`convert-to-production --apply`, phase H) runs again right after it. The
rollback of step 3 restores **both** schemas: phase H's quarantine also
writes `public` (shells in `students`, a TEST twin in `classes`, `users` via
the D-350 trigger, `audit_logs`) — its rehearsal lists every table it wrote
and checks each against the backup manifest (`QUARANTINE-REPORT.md`).
Afterwards: `npm run migrate:health` and step 5's `reconcile.mjs` before
anything is switched back on.

### Rehearsed on wtgx, 31 Oct 2026 (`--rollback-only`)

`npm run migrate:backup-one -- --restore backup-20261031T121335Z --rollback-only`
— both schemas, the whole path, then rolled back:

| | |
|---|---|
| Tables restored and compared | 226 (228 in the backup less the 2 kept) |
| Rows | 51,481 — every table equal on rows, money sums and content |
| Second pass | `installments_carry_forward_balance_id_fkey` |
| Emptied along | `private.vpps_student_source_mapping` (0 rows) |
| Matviews refreshed | `v_workbook_installment_balances`, `v_workbook_student_financials`, `v_student_financial_state` |
| Forced afterwards | `fee_writes_enabled = 'false'`; both dispatches off |
| Time | 37 s (locks held for that long; run it outside desk hours) |
| After the rollback | `fee_writes_enabled` still unset, `staff_notice_dispatch` still on, marker `dev` — nothing persisted but a `backup-one-restore` / `dry_run` row |

The first attempt stopped with "cannot ALTER TABLE student_repayment_plans
because it has pending trigger events" (a deferrable self-reference); the
fix is step 4's `set constraints all immediate`. Its dry run, before that:
226 tables, row counts equal, no blocker; guard "would refuse" (marker `dev`,
fee writes open) — as it must until step 2. Evidence file:
`%USERPROFILE%\.vppsone-migration\backup-20261031T121335Z\restore-rehearsal-20261031T125346Z.json`.

## Retention (D-334)

- Drive snapshots: as D-334 sets them.
- `backup-one` folders: keep the T0 backup and the last three before it until
  sign-off (plan §12.4); afterwards keep the T0 one for the school's records
  and delete the rest. They hold personal data: the operator's machine only,
  disk encryption on, never synced to a personal cloud.
