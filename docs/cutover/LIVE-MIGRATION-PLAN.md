# Live migration plan — VPPS One onto the School Fees database

Prepared 20 October 2026; revised the same day after an independent review.
**Nothing in this document has been run against the live project
`vgqyilgstjvgohrsiwkb`.** It was built from the repository, the DEV ledger and
DEV's catalogue (`wtgxcptmucjerhufzjcf`, read-only queries). It supersedes step
1 and the rollback of `docs/CUTOVER.md`, whose "nothing touches `public`" claim
is wrong (see §2). Running any step here is the owner's decision (CLAUDE.md
rule 8, PLAN §7).

---

## 1. What is being moved

79 files in `supabase/migrations/` plus one fee-side change kept outside them
(`docs/cutover/fee-collector-posts-payments.sql`). On DEV all 79 are applied,
in the same order as their filenames.

Facts about DEV's ledger that matter for live:

- **Six versions differ from the filenames** (the Supabase MCP stamps its own
  time): `create_data_replica_log` 20260922032714, `current_staff_role_reads_vppsone`
  20260922052006, `teacher_tasks` 20261016125715, `profile_photos` 20261016125729,
  `teacher_task_delivery` 20261017043313, `overnight_qa_app_sessions`
  20261018191452. `vx_fee_collector_role_permissions` is recorded as
  `vx_fee_collector_collects`. The relative order is identical.
- **What DEV ran is not always byte-identical to the file.** 67 of 79 files
  match DEV's recorded statements exactly (comments and whitespace ignored);
  the 12 others differ only in wording (§5).
- DEV also carries five earlier "School One" migrations in the fee app's own
  schemas (20260916150000–160100: `staff_role_enum_additions`,
  `school_one_foundation_tables`, `school_one_foundation_rls`,
  `school_one_permissions_additive`, `staff_directory_uses_staff_assign`) and
  the D-261 fee-collector change (`dev_fee_collector_posts_payments`). The five
  are not in this repo; whether live has them is pre-flight P3.

## 2. Classification

| Class | Meaning | Files |
|---|---|---|
| **A** | `vppsone`-only DDL; apply as is | everything not listed below |
| **B** | `vppsone` DDL plus rows live needs (permissions, note kinds, collection fields, templates, flags) | 20260917021218, 20260917033652, 20260917051208, 20261004031630, 20261004035559, 20261004040755, 20261004084641, 20261010100247, 20261010102233, 20261010102401, 20261010102943, 20261011092957, 20261016080000, 20261016090000 |
| **C** | Touches the fee app or shared platform settings | 20260916191935 (PostgREST setting on role `authenticator`), 20260917033722 / 20261004121311 / 20261004124254 (Storage buckets), **20260922100000 (replaces `private.current_staff_role()`)**, **20261006043431 (SECURITY DEFINER writer to `public.defaulter_recovery_state`)**, **`docs/cutover/fee-collector-posts-payments.sql` (replaces `public.has_permission(text)`)** |
| **D-skip** | Dev/QA only; **never apply on live** | 20261020103153 `smoke_lab`, 20261020105658 `smoke_lab_enforcement` and 20261020110015 `smoke_lab_ban_date` (Smoke Lab accounts, passes, findings, and a pg_cron job that bans pool accounts — the app also switches the lab off on live); 20260917093746 `create_qa_fixture_runs`; 20261004101241 `record_history_qa_cleanup` (would let `qa_*` history rows be deleted); **20261018191000 `overnight_qa_app_sessions`** (the revoked launcher: dev UUIDs, the owner's e-mail, the dev project ref; its tombstone triggers make it impossible to remove once applied) |
| **D-keep** | Dev-flavoured but required | 20260922091500 `create_data_replica_log` — 20261004031630's policy loop names `data_replica`; on live it stays empty, which means "not a replica" |

Verified against every file: nothing outside the three D-skip files refers to
`qa_runs`, `qa_undo`, `qa_dayrun_*` or the `qa\_` clause; skipping 20261004101241
leaves 20261004100729's stricter append-only trigger. The app tolerates the
skips: no application code reads `qa_runs`/`qa_undo`, and the overnight check
(`qa_dayrun_access_allowed`) is called only for six hard-coded DEV QA user ids
(`src/platform/supabase/middleware.ts`, `src/platform/auth/current-staff.ts`);
the dayrun routes in the build fail closed ("Dayrun unavailable") on live.

Kept on purpose, noted for the owner: 20261004081924 lets an approved report
scheme whose term starts with `QA-` be deleted (a test exception inside a
product trigger). It is harmless unless someone names a real term `QA-…`.

## 3. Pre-flight (read-only, on live, the day before)

Run as `select`s through the Supabase MCP, passing `project_id:
vgqyilgstjvgohrsiwkb` explicitly on every call, by the person authorised to
touch live. Record every answer in the cutover log. Any failed check stops the
cutover.

| # | Check | How (read-only) | Must be |
|---|---|---|---|
| P0 | Backup | Dashboard → Database → Backups: a backup or PITR point from today; locally `pg_dump --schema-only -n public -n private` saved | both exist |
| P1 | Identity | `get_project vgqyilgstjvgohrsiwkb` | the live School Fees project |
| P2 | Nothing of ours yet | `select count(*) from information_schema.schemata where schema_name = 'vppsone'` | 0 (if 1, stop: something was applied already) |
| P3 | Role labels | `select enum_range(null::public.staff_role)` | contains admin, office, academic_coordinator, exam_coordinator, teacher, view_only, accountant, fee_collector. If the School One labels are missing, the fee app's own migrations that add them go first — they belong to the fee repo |
| P4 | Fee functions to be replaced | `select pg_get_functiondef('private.current_staff_role()'::regprocedure);` `select pg_get_functiondef('public.has_permission(text)'::regprocedure);` and `select p.oid::regprocedure, pg_get_userbyid(p.proowner), p.proacl, p.prosecdef, p.proconfig, obj_description(p.oid, 'pg_proc') from pg_proc p where p.oid in ('private.current_staff_role()'::regprocedure, 'public.has_permission(text)'::regprocedure);` plus `select current_user;` | bodies, owner, grants and comments saved verbatim to the log (this is the M2 rollback); `current_user` equals the owner |
| P5 | Fee tables our functions read | `select table_name from information_schema.tables where table_schema = 'public' and table_name in ('students','classes','users','receipts','payments','installments','defaulter_contacts','student_family_members','defaulter_recovery_state')` | all 9 |
| P6 | Columns our functions read | `select table_name, column_name from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('students','house'),('students','transport_route_id'),('students','guardian_phone'),('students','date_of_birth'),('students','address'),('classes','id'),('classes','session_label'),('classes','class_name'),('classes','section'),('classes','stream_name'),('users','id'),('users','role'),('users','is_active'),('defaulter_contacts','id'),('defaulter_contacts','student_id'),('defaulter_contacts','session_label'),('defaulter_contacts','contacted_at'),('defaulter_contacts','snooze_until'),('defaulter_contacts','outcome'),('student_family_members','student_id'),('student_family_members','family_group_id'),('student_family_members','academic_session_label'),('student_family_members','created_at'),('receipts','id'),('receipts','student_id'),('receipts','payment_date'),('payments','receipt_id'),('payments','student_id'),('payments','installment_id'),('installments','id'),('installments','student_id'),('installments','class_id'),('defaulter_recovery_state','recovery_stage'),('defaulter_recovery_state','family_group_id'),('defaulter_recovery_state','promise_resolved_outcome'),('defaulter_recovery_state','promise_resolved_at'),('defaulter_recovery_state','last_resolved_contact_id'),('defaulter_recovery_state','promise_kept_count'),('defaulter_recovery_state','promise_broken_count'))` and `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.defaulter_recovery_state'::regclass and contype = 'c'` | all columns present (only `house`/`transport_route_id`/`guardian_phone`/`date_of_birth`/`address` may be absent, with a note); the check constraints allow `promise_due`, `standard`, `kept`, `broken`. The defaulter function is plpgsql, so a missing column would only fail when it first runs |
| P7 | Unique key the defaulter writer upserts on | `select indexdef from pg_indexes where schemaname = 'public' and tablename = 'defaulter_recovery_state'` | unique on `(student_id, session_label)` |
| P8 | Exposed schemas | `select rolconfig from pg_roles where rolname = 'authenticator'` **and** Dashboard → API → Exposed schemas | both written down (see M3) |
| P9 | Bucket names free | `select id from storage.buckets where id in ('vppsone-documents','vppsone-photos','vppsone-archives')` | 0 rows |
| P10 | Everything that keys on fee roles | `select p.oid::regprocedure from pg_proc p where p.prosrc ~ '(current_staff_role|has_permission)';` then `select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies where coalesce(qual,'') \|\| coalesce(with_check,'') ~ '<the function names from the first query>'` — all schemas, `storage` included | reviewed. After M2 every active VPPS One login resolves a fee role through these: a VPPS One `teacher` gets the fee `teacher` arm (`fees:view`, `ledger:view`, `finance:view`, `students:edit_basic`), reachable with that teacher's own token through PostgREST. The owner accepts that list or narrows the arms first |
| P11 | Baseline for "fee app unchanged" | `select table_name from information_schema.tables where table_schema = 'public' order by 1;` `select count(*) from public.students;` `select count(*) from public.receipts;` | saved |
| P12 | Postgres version | `select version()` on live and on DEV | live 15 or later, and the same major version as DEV (17) — `alter role authenticator` behaves differently before 16 |
| P13 | The role that applies migrations | On DEV: `select distinct pg_get_userbyid(relowner) from pg_class where relnamespace = 'vppsone'::regnamespace;` and `select * from pg_default_acl where defaclnamespace = 'vppsone'::regnamespace;` | live's `current_user` (P4) is the same role; Gate M1 re-checks `pg_default_acl` |
| P14 | How the fee app deploys its own migrations | ask the fee app's maintainer | if `supabase db push` or branching: live's ledger will gain ~76 VPPS One rows dated the cutover day, and the fee repo's next push will fail with "Remote migration versions not found" unless they repair or ignore those rows. Agreed before M1 |
| P15 | D-207 decision | owner | whether a fee user made inactive in `public.users` but active in `vppsone.staff_profiles` keeps fee authority (20260922100000 falls back to `vppsone` when the `public.users` branch finds no *active* row) |

Off the database: AiSensy templates approved on the live account
(`vppsone_attendance_reminder`, `vppsone_marks_reminder`, `vx_school_notice`,
`vx_staff_notice`, `vppsone_weekly_summary`, six `vppsone_teacher_task*_v1`), or
messaging stays off; fresh `CRON_SECRET`/`JOBS_SECRET`; the live keys.

## 4. Order and phases

Apply **one file per `apply_migration` call**, with `project_id:
vgqyilgstjvgohrsiwkb`, as the same role throughout (P13), named after the file.
No file opens its own transaction (the overnight file, which does, is skipped)
and no file adds an enum value and uses it in the same file, so one call per
file keeps every enum addition committed before its first use. After each phase
run its gate; a failed gate stops the cutover and goes to §6.

**Phase M1 — the `vppsone` schema.** Every file from 20260916191746 to
20261020020829 in filename order, **except** 20260916191935 (moved to M3),
20260922100000 and 20261006043431 (moved to M2), and the three D-skip files.
Use the repository files (§5). The three bucket files stay in place: their
bucket inserts are part of schema files later files depend on, and P9 showed
the names are free. Verified: nothing applied in M1 refers to
`private.current_staff_role`, `has_permission`, `refresh_defaulter_recovery_state`,
`pgrst`, `authenticator` or `db_schemas`; the defaulter function needs only
`vppsone.staff_can` (20261004031630, in M1). Filename order already satisfies
the enum and dependency constraints (20260918043934 before 20261004031630;
20261004051001 before 20261004051300; 20260917142719 and 20260922091500 before
20261004031630; 20261004121311 before 20261016080000) — do not reorder.

Gate M1 (numbers from DEV on 20 Oct, less the skips):

- `vppsone` base tables = **120** (DEV 126 − `qa_runs`, `qa_undo`, four
  `qa_dayrun_*`); views = **5**; `select count(*) from pg_proc where pronamespace
  = 'vppsone'::regnamespace` = **90** after M1 (**91** after M2); no relation
  named `qa_%`.
- `pg_get_functiondef('vppsone.student_record_history_append_only()'::regprocedure)`
  has **no** `qa\_` exception.
- `pg_default_acl` for `vppsone` matches DEV's (P13).
- `vppsone.role_permissions` compared row by row with DEV's; every difference
  explained (DEV may carry matrix edits made through `/settings`).
- `select id from storage.buckets where id like 'vppsone-%'` returns the three.
- Nothing new in `public` (compare P11).
- Snapshot `select * from vppsone.fee_contract_fingerprints()` (arrives with
  20261004125936) into the log as the fee-contract baseline.

**Phase M2 — fee-side functions (owner approval; P10 and P15 decided).**

1. 20260922100000 `current_staff_role_reads_vppsone` — replaces
   `private.current_staff_role()` so VPPS One logins without a `public.users`
   row resolve a fee role. If live's body (P4) differs from the one the file
   assumes, carry the `vppsone` fallback into live's body instead of pasting.
2. `docs/cutover/fee-collector-posts-payments.sql` — replaces
   `public.has_permission(text)`, adding `payments:write` and `receipts:print`
   to `fee_collector` (this applies to the fee app's own fee collectors too).
   Splice the two entries into live's body (P4); never paste DEV's whole body.
3. 20261006043431 `native_defaulter_recovery_refresh` — the SECURITY DEFINER
   writer to `public.defaulter_recovery_state`. P5–P7 must have passed; diff it
   against the fee app's own refresh logic.

Gate M2 — one `execute_sql` call per user, as
`select set_config('request.jwt.claims', '{"sub":"<auth uuid>","role":"authenticated"}', true); select private.current_staff_role(), public.has_permission('payments:write');`:

- (a) a fee-app accountant with a `public.users` row: role unchanged from before M2;
- (b) a fee-app fee collector: `payments:write` is true;
- (c) a random uuid: null / false.
- `vppsone.fee_contract_fingerprints()` compared with the M1 snapshot: the diff
  names exactly `private.current_staff_role()` and `public.has_permission(text)`.
- After M4 has inserted the first admin profile, repeat with that admin's
  uuid: role `admin`.
- Open the fee app as its accountant: the same screens and totals as before.

**Phase M3 — expose the schema.** Two cases, from P8:

- If the dashboard's Exposed schemas list equals `rolconfig`'s (or `rolconfig`
  has no `pgrst.db_schemas` and the dashboard has only `public, graphql_public`):
  apply 20260916191935 unmodified.
- If the dashboard lists more than `rolconfig` does: **do not edit the file.**
  Either add `vppsone` in the dashboard and record 20260916191935 as satisfied
  by that, or first `alter role authenticator set pgrst.db_schemas = '<exact
  dashboard list>'` and then apply the file unmodified. Record in the log that
  the dashboard setting is no longer authoritative once a role-level value
  exists.

Gate M3: `select rolconfig from pg_roles where rolname = 'authenticator'` lists
`vppsone` and every schema recorded in P8; the app's first request does not
answer `PGRST106`.

**Phase M4 — data and configuration not in migrations.** First admin row in
`vppsone.staff_profiles` (inserted by the owner; no real personal data in the
repo); school settings and receipt footer; bell timings after enrolments exist
(20261004035559 seeds them from enrolments, empty on live); `runtime_flags` stay
at the migration defaults (`staff_notice_dispatch=false`, `parent_dispatch=false`)
until the owner turns them on; never copy DEV rows (`external_student_ids`,
`data_replica`, QA accounts).

Then `docs/CUTOVER.md` §§2–6: point Production (only) at live, seed master
data, build enrolments, check the fee app (Gate M2's checks, not "nothing
moved"), watch one morning of jobs. `auto-day-close` must keep running in
exactly one deployment.

## 5. The twelve files whose text differs from what DEV ran

Compared statement by statement (`--` and `/* */` comments and whitespace
removed, each fragment hashed; DEV's catalogue checked where they differed).
**None differs in DDL, function bodies, policies, grants or constraints.**
Decision: **apply the repository files** on live; the differences below are
wording only and the repository's wording is the reviewed one.

| File | Difference | Effect on a fresh database |
|---|---|---|
| 20261004031630 staff_authority_and_scoped_reads, 20261004035559 bells_and_team_rules, 20261004041934 staff_notice_outbox, 20261004051300 attendance_whole_roster_save, 20261004062800 marks_draft_submit, 20261004081924 report_schemes_and_issues, 20261004084641 parent_message_policy | comments and layout only | none |
| 20261004040755 atomic_cover_command | same 258 statements; four plpgsql helpers created after, not before, `commit_cover_command` (plpgsql bodies are not resolved at creation) | none |
| 20260916204801 create_class_teachers_and_calendar, 20260916210606 create_timetable_versions_and_slots | `COMMENT ON` text ("PLAN §4" vs "PLAN 4") | comment text only |
| 20260922100000 current_staff_role_reads_vppsone | `COMMENT ON FUNCTION` text; body, `stable`, `security definer`, `search_path` identical | comment text only |
| 20260917033652 create_collection | two `COMMENT ON` texts, and two `collection_fields.help_en` seed strings ("— the last four only" vs ", the last four only"; the transport hint likewise) | two help sentences read with a dash instead of a comma |

DEV's ledger records 20260922100000 as 20260922052006 (§1); on live it is
applied once, by name, in M2.

## 6. Rollback

Phase by phase, from the last one done. **Order matters: M2 is undone before
anything touches `vppsone`.**

| Phase | Undo | Notes |
|---|---|---|
| Production env vars | point Production back at DEV and redeploy | anything staff entered on live stays in live's `vppsone` |
| M4 | nothing to undo; rows stay in `vppsone` | — |
| M3 | if P8 had no `pgrst.db_schemas`: `alter role authenticator reset pgrst.db_schemas;` otherwise `alter role authenticator set pgrst.db_schemas = '<P8 value>';` then `notify pgrst, 'reload config'; notify pgrst, 'reload schema';` | if the dashboard route was used instead, remove `vppsone` there |
| M2 | restore `private.current_staff_role()` and `public.has_permission(text)` by running the `CREATE OR REPLACE` text `pg_get_functiondef` returned in P4, as the owner P4 recorded; re-apply the saved comments. **Never `DROP`** — fee policies depend on `has_permission`. Then `drop function vppsone.refresh_defaulter_recovery_state(text, date);` | Proof: `vppsone.fee_contract_fingerprints()` diff against the M1 snapshot is empty, and `pg_get_functiondef` of both no longer mentions `vppsone`. Rows our refresh wrote to `defaulter_recovery_state` stay; they are the fee app's own shape |
| M1 | **Precondition: M2 rolled back and proven as above.** While M2's body is live, `private.current_staff_role()` reads `vppsone.staff_profiles`; it is a SQL function, so Postgres records no dependency, `drop schema` would succeed, and every fee permission check would then fail with "relation does not exist" — the fee app down. With that precondition met, leave the schema in place (inert). Only if it must go: `drop schema vppsone cascade;` and delete the three buckets after confirming they are empty, via Dashboard → Storage or the Storage API | Not inert in one respect: ~31 foreign keys from `vppsone` to `auth.users` are `on delete set null`, so deleting a fee-app user updates `vppsone` rows. Benign |

Never re-run individual files to "repair" (§7).

## 7. Things that must not happen

- Never apply the D-skip files on live: 20261018191000 (overnight QA),
  20261004101241 (QA history cleanup), 20260917093746 (QA fixture runs),
  20261020103153 (Smoke Lab). Gate M1's counts already exclude the Smoke Lab's
  four tables and one function (they were added to DEV after the counts).
- Never re-run a file after it succeeded. In particular 20261010103349 after
  20261011090858 silently restores the weaker notes policy (health and family
  notes become readable more widely), and 20261010100247 / 20261010102233 /
  20261011092957 re-grant permissions an admin may have removed.
- Never drop `vppsone` or `vppsone.staff_profiles` while M2's body is live (§6).
- Never `supabase db push`; never copy DEV data; never run anything here from a
  preview deployment.
- `auto-day-close` must keep running in exactly one deployment while both apps
  write one fee database.
- `vppsone.archive_schema_version()` reports the highest version in the shared
  ledger, fee app's included; read it as "latest migration on this database",
  not "latest VPPS One migration".
