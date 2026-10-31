# Quarantine report — phase H dry runs on `wtgxcptmucjerhufzjcf` (31 Oct 2026)

Go-live phase H built the scripts for runbook steps 2, 3 and C8
(`CUTOVER-RUNBOOK-2026-27.md`) and ran each of them **without changing
anything** on One's main database: dry runs, and rehearsals that do every
write in one transaction and then roll it back (`--rollback-only`). Counts
only — no name, number or id of a person appears here.

The only write phase H made to real tables is the owner-approved TEST
hygiene fix in §6 (two TEST-labelled `class_teachers` rows).

State when these ran: marker `dev`; `fee_writes_enabled` missing; public
sign-ups off; backup `backup-20261031T121335Z` (12:13 UTC) on this machine;
no load applied; no cutover row.

## 1. Classification — `classify-dev-vppsone.mjs` (read-only)

| Bucket | Tables | Rows | Labelled 2026-27 | Labelled TEST-2026-27 | What happens |
|---|---|---|---|---|---|
| A real master data | 21 | 365 | 92 | 33 | Real rows promoted (§4); TEST rows get the general rule |
| B test activity | 84 | 29,203 | 1,645 | 13 | **Every row** moved into TEST-2026-27 (§3) |
| R rebuilt | 2 | 932 | 684 | 248 | `enrolments` rebuilt from `public.students` (§5); `teaching_assignments` by the timetable re-seed |
| C never copied | 22 | 884 | 1 | 1 | Left as they are (smoke / QA / day-run machinery, logs, Drive, replica marker) |
| K settings / system | 20 | 96 | 0 | 0 | Never touched |
| Unclassified | 0 | | | | (the quarantine refuses while any exist) |

The largest B tables: `attendance_marks` 17,983, `marks` 5,364,
`timetable_slots` 3,114, `attendance_registers` 978, `staff_notices` 352,
`marks_change_log` 287.

**Classes.** One has 20 classes in 2026-27, live has 19 (TEST-2026-27 and
2027-28: 19 each on both). The 20th is a QA artefact,
`QA Terra 20261027 Isolated` (section `QA`, 1 replica student); `vppsone`
rows on it: enrolments 1, class_teachers 1, assessment_subjects 1,
attendance_registers 5, teaching_assignments 1. The quarantine gives it a
TEST-2026-27 twin class (the only one it has to create); the promotion drops
the real-session master rows on it; the first real load deletes the class
itself (it is not on live).

**The owner's own activity** (the one login outside `@qa.vpps.local`), rows
by table — all of it is quarantined as TEST unless the owner says some of it
is real (plan §4.4, critique0 #19):

| Bucket | Table | Rows |
|---|---|---|
| B | marks | 352 |
| B | attendance_register_revisions | 14 |
| B | attendance_registers | 13 |
| B | notes | 13 |
| B | student_documents | 13 |
| B | collection_submissions | 12 |
| B | student_records | 9 |
| B | substitution_assignments | 7 |
| B | academic_exports | 4 |
| B | attendance_corrections, teacher_leave | 3 each |
| B | message_sends | 2 |
| B | collection_requests, fee_desk_requests, marks_change_log, report_card_issues, report_cards, substitution_plans, teacher_tasks | 1 each |
| A | class_aliases, subjects | 1 each (kept; authorship of master data) |
| C / K | smoke_runs 3, assist_log 2, job_runs 1, teacher_task_previews 1, file_storage_settings 1 | left |

## 2. Convert to production — `convert-to-production.mjs`

Dry run: preflight **passes** (backup present and matching; every
`supabase/migrations` file in the ledger — one is applied under another
name, `20261011092957` = `vx_fee_collector_collects`; every fee-migration in
the ledger; marker `dev`; no cutover).

| Step | Now | Would do |
|---|---|---|
| fee-writes | key missing | set `'false'` |
| test-prefix | TST, One-owned | nothing (done) |
| marker | `dev` | `production` |
| test-accounts | 39 login profiles, all test accounts | nothing (done in phase C) |
| test-phones | 3 test profiles with a number not on the allowlist (2 in the masked 99999 block) | null them |
| smoke-enforce | `*/2 * * * *`; body touches `auth.users` / `auth.sessions` only through `vppsone.smoke_pool`, every seat a `smoke.*@qa.vpps.local` test account | **kept** |
| dispatch-flags | parent_dispatch off, staff_notice_dispatch **on** | both off |

`--rollback-only`: all seven steps applied and checked (`fee_writes_open()`
false after), then reverted in reverse and checked equal to the start, then
rolled back — **REHEARSAL PASSED**.

## 3. Quarantine in place — `quarantine-in-place.mjs`

Dry run (guard would refuse `--apply` today: marker `dev`, fee writes not
`'false'` — expected before step 2; backup ok):

- **Identities:** 20 real classes → TEST twins (1 to create: the QA class
  above); **513 students → `TEST-D-0001…` shells** (every student any
  quarantined row points at who is not already in a TEST class; 0 missing);
  students already in TEST classes kept; **19 real-teacher candidates → 19
  test twins** (`T-<short>`), 19 logins move to the twins, 17 smoke seats
  re-pointed; the owner's references → an existing test admin (0
  placeholders needed).
- **Row changes, 36,939 in total**, by group (one transaction each):
  timetable 5,637 · attendance 20,690 · exams and marks 8,461 · records and
  notes 405 · collection 142 · messages and notices 1,578 · fees desk 26.
  Includes: relabels (978 registers, 352 staff notices, 42 sends, …), 12
  enquiry phones nulled, 42 send numbers emptied and 42 sends cancelled, 45
  staff notices suppressed, 46 notice-attempt destinations emptied, 10 + 2
  tokens rotated, 6 campaigns / 1 reminder batch cancelled, 3 report schedules
  switched off, 19 sensitive record answers nulled; append-only
  `report_card_issues` 1, `student_record_history` 15, `exam_activity` 10
  rewritten by delete + insert-copy.
- `verify-quarantine.sql` today: 87 of 232 checks fail (expected before).

`--rollback-only --with-promote` (every write of the quarantine **and** the
promotion in one transaction, then the checks, then ROLLBACK; ~1 minute of
locks on the touched tables):

- identities: 1 TEST class, 513 shells, 19 twins, 19 logins moved, 17 smoke
  seats re-pointed, 553 `migration_id_map` rows; 36,965 rows changed in 93
  tables; with promote: 6 rows dropped, 4 authors nulled, 19 profiles made real;
- **`verify-quarantine.sql`: 230 of 232 pass** — the two that fail are
  "marker is not production" and "fee_writes_enabled is not false", which
  only step 2 makes true;
- **a re-run would change 0 rows** (idempotent);
- **69 tables written** (triggers included: `public.audit_logs`,
  `public.classes`, `public.students`, `public.users`,
  `public.workbook_materialized_view_refresh_queue`, and 64 `vppsone`
  tables) — **every one is in the backup manifest and restored by
  `backup-one --restore`** (none in `RESTORE_KEEP` except the run log). So
  the rollback of step 3 restores **both** schemas; the runbook now says so,
  and step 4's rollback restores `public` from a second backup taken after
  step 3 (3b), never step 1's.
- **REHEARSAL PASSED**.

## 4. Promote master data — `promote-master-data.mjs`

Dry run (real session `2026-27`; live classes read through the sealed
reader: 57):

| Table | Real rows | Change |
|---|---|---|
| role_permissions | 103 | equal to the migration seed: 0 removed, 0 added |
| class_teachers | 20 | drop 4 (inserted by the QA fixture), drop 1 (the QA class) |
| cover_policies | 4 | drop 1 (about a test-account teacher) |
| calendar_events | 14 | 1 `created_by`, 1 `updated_by` QA author nulled |
| parent_message_policies | 4 | 1 QA author nulled |
| report_schemes | 1 | QA approver nulled (trigger off for that statement) |
| academic_calendar_days 14, bell_schedules 1, class_aliases 19, class_seats 19, collection_fields 17, exam_rooms 15, fee_reminder_rules 4, message_templates 28, note_kinds 6, subjects 23 | | kept as they are |

- Text scan for `qa.vpps.local`, `vercel.app`, `99999` in every promoted
  text / json column: **0 hits**.
- **19 real-teacher profiles** to promote (every timetable teacher's short
  name: 17 are profiles the smoke seats borrowed, 2 are day-run QA teacher
  profiles that carry timetable short names — **the owner should check those
  two names in the sign-off list**). Sign-off list (with names) only in
  `%USERPROFILE%\.vppsone-migration\promote-<run>\sign-off.json`.
- Timetable re-seed from the fixture: 19/19 teachers and 16/16 classes
  resolve. `seed-timetable.mjs --production-promote` refuses today (marker
  `dev`, fee writes unset, no promote run), as it should.

## 5. Enrolments and class teachers (C8) — `rebuild-enrolments.mjs`

Dry run on the replica: students active 513, left 28; enrolments 511
(enrolled). Target **541 = on roll 513 + left 28** → insert 30, correct 0,
delete 0. Classes with no current class teacher: **1 of 20** (the QA class).
`--rollback-only`: 541 after the writes = 541 expected — REHEARSAL PASSED.
`--apply` refuses until the real students are loaded (a first load or a
cutover row), as it should. (After promote drops the 4 QA-fixture class
teachers, more classes may lack one — C8 prints them.)

## 6. Done for real: the two TEST class-teacher rows (owner-approved)

Two `class_teachers` rows labelled TEST-2026-27 (made by the QA fixture on 22
Sep) pointed at **real** 2026-27 classes (Class 1, Class 6), so QA teachers 1
and 2 held a real class. `scripts/migrate/repoint-test-class-rows.mjs
--apply` moved each to the TEST-2026-27 class with the same (name, section,
stream); Class 1's TEST twin already had a current class teacher, so the
moved row was closed (effective_to 30 Oct). Verified by SQL: TEST rows on a
non-TEST class 0, duplicate current class teachers 0. `--revert` was tested
(put back, re-applied); the run row
`repoint-test-class-20261031T135016Z` holds the before-state. The same rule
is part of the quarantine.

## 7. Reset of the TEST session — `scripts/reset-test-session.mjs`

`--session TEST-2026-27` (no default; any other label refused). Dry run:
14 rows of TEST activity would go (notes 6, academic_exports 2,
collection_rounds 2, collection_round_fields 2, student_documents 2); the
TEST bed (timetable, assignments, aliases, enrolments, classes, students)
and every fee row stay. TEST classes hold 79 students (refuses above 150 —
the 2026-08 pitfall). **78 of the 79 TEST students have a number not on the
test allowlist** (critique1 B15 — the owner decides: null them in One, or
allowlist them; on wtgx today they are masked replica numbers, after the
first load they are live's real ones).

## 8. The masked replica in `public`

No purge script: the first real load (`load-snapshot --apply --first-load`)
replaces `public` — every masked row is updated to live's value or, if live
does not have it, deleted by its delete-missing step — **except protected
rows**: the `TEST-D-` shells and the TEST twin class (named in
`vppsone.migration_id_map`) and everything keyed on them. `load-snapshot` now
also writes a `vppsone.data_replica` row saying `REAL fee data loaded by …`
with nothing masked; the newest row answers "is this live data?".

## What the orchestrator runs, in order

1. `npm run migrate:backup-one` (+ `--restore-test`) — the step-1 backup must
   be < 24 h old when the quarantine runs.
2. `convert-to-production.mjs --apply`.
3. `quarantine-in-place.mjs --rollback-only --with-promote` (expect PASSED,
   all 232 checks), then `--apply`; `promote-master-data.mjs --apply`;
   `verify-quarantine.sql`; backup 3b.
4. C8 after the final load: `rebuild-enrolments.mjs --apply`.
