/**
 * The rules of the in-place quarantine on One's main database (go-live
 * phase H; plan §0.1 "Phase 4 quarantines in place", §4.1–§4.6; critique0
 * #16, #17, #19, #20; critique1 A4, B15, B21). Pure: no database, so every
 * decision is pinned by tests/migrate-quarantine.test.ts.
 *
 * Until go-live every `vppsone` row on `wtgxcptmucjerhufzjcf` is test
 * activity: 50 QA / smoke / day-run logins and the owner were the only users
 * (plan §0.1). Dev student ids EQUAL live ids (the replica keeps primary
 * keys), so a row left pointing at its student would attach to a real child
 * the moment the real data is loaded. Hence, per table:
 *
 *   A  real master data     — kept for real 2026-27 and signed by the owner
 *                             (promote-master-data.mjs). Its TEST rows get
 *                             the general rule below.
 *   K  settings / system    — never touched (the marker, the run log, flags,
 *                             the allowlist, the One-owned settings).
 *   B  test activity        — EVERY row moved into TEST-2026-27, in place:
 *                             relabelled, re-pointed at TEST classes, TEST
 *                             students or TEST-D- shells and test-account
 *                             profiles, phones/destinations/tokens nulled,
 *                             sends and notices made terminal.
 *   R  rebuilt              — derived rows rebuilt from source after the load
 *                             (enrolments: rebuild-enrolments.mjs; teaching
 *                             assignments: the timetable re-seed). TEST rows
 *                             get the general rule.
 *   C  never copied         — smoke / QA / day-run machinery, the replica
 *                             marker, SamPark import rows, job and assist
 *                             logs, Drive bookkeeping. Left as they are (the
 *                             smoke lab keeps working for test accounts).
 *
 * The general rule (applied to B tables whole, and to TEST-labelled rows of
 * A and R tables): no TEST row points at a real class, a real student or a
 * real staff profile.
 *
 * A table missing from TABLES is UNCLASSIFIED: classify reports it and the
 * quarantine refuses to run (fail closed) — a new table must be placed here.
 */

import { devId, uuidV5 } from "./uuid5.mjs";

export const TEST_SESSION = "TEST-2026-27";
export const SHELL_PREFIX = "TEST-D-";

/** Same definition as vppsone.is_test_session_label() and import-rules.mjs. */
export function isTestSessionLabel(label) {
  return typeof label === "string" && /^(test|uat|demo)-[0-9]{4}-[0-9]{2}$/i.test(label);
}

/*
 * Per-table specs for B:
 *   appendOnly  rewritten by insert-copy + delete (new id devId(table, id)),
 *               with the table's named triggers off for those statements
 *   relabelSet  extra SET fragments applied with the relabel (SQL, constant)
 *   scrub       [{ column, to }] to: 'null' | 'empty' | 'token' | 'emptyArray'
 *   terminal    { set, where }: rows still live become terminal
 *   staffArrays uuid[] columns that hold staff profile ids (no foreign key)
 *   classArrays uuid[] columns that hold class ids
 */
/** @type {Record<string, { bucket: string, why?: string, appendOnly?: boolean, relabelSet?: string, scrub?: { column: string, to: string }[], terminal?: { set: string, where: string }, staffArrays?: string[], classArrays?: string[] }>} */
export const TABLES = {
  // ---------------------------------------------------------------- A
  subjects: { bucket: "A", why: "subject master" },
  class_aliases: { bucket: "A", why: "timetable labels of the real classes" },
  class_seats: { bucket: "A", why: "seat counts per class" },
  bell_schedules: { bucket: "A", why: "bells" },
  cover_policies: { bucket: "A", why: "cover policy" },
  academic_calendar_days: { bucket: "A", why: "school calendar" },
  calendar_events: { bucket: "A", why: "school calendar events" },
  report_schemes: { bucket: "A", why: "report-card schemes" },
  note_kinds: { bucket: "A", why: "note kinds" },
  message_templates: { bucket: "A", why: "message templates" },
  school_settings: { bucket: "A", why: "school settings" },
  role_permissions: { bucket: "A", why: "reset to the migration seed, never copied" },
  class_teachers: { bucket: "A", why: "class teachers (QA fixture rows and pure-QA teachers dropped)" },
  exam_rooms: { bucket: "A", why: "exam rooms" },
  collection_fields: { bucket: "A", why: "record fields (qa_ keys are QA fixtures)" },
  attendance_rules: { bucket: "A", why: "attendance rules" },
  team_supervision_rules: { bucket: "A", why: "supervision rules" },
  fee_reminder_rules: { bucket: "A", why: "fee reminder rules" },
  parent_message_policies: { bucket: "A", why: "parent message policy" },
  staff_scopes: { bucket: "A", why: "staff scopes" },
  staff_profiles: { bucket: "A", why: "real teacher profiles promoted; every other profile is a test account" },
  // ---------------------------------------------------------------- K
  deployment: { bucket: "K", why: "the production marker" },
  deployment_history: { bucket: "K", why: "marker history" },
  migration_runs: { bucket: "K", why: "the run log" },
  migration_id_map: { bucket: "K", why: "the id map" },
  migration_watermarks: { bucket: "K", why: "load watermarks" },
  runtime_flags: { bucket: "K", why: "runtime switches (convert-to-production sets them)" },
  message_test_recipients: { bucket: "K", why: "the owner's test allowlist" },
  one_owned_fee_settings: { bucket: "K", why: "One-owned fee settings" },
  fee_role_map: { bucket: "K", why: "role map seed (D-350)" },
  file_storage_settings: { bucket: "K", why: "storage settings" },
  file_storage_settings_history: { bucket: "K", why: "storage settings history" },
  assist_settings: { bucket: "K", why: "assist settings" },
  school_settings_history: { bucket: "K", why: "settings history" },
  tail_receipts_review: { bucket: "K", why: "tail-sync review (empty until T0)" },
  staff_send_pace: { bucket: "K", why: "send pacing counter" },
  staff_notice_prefs: { bucket: "K", why: "per-person notice preferences" },
  staff_ui_preferences: { bucket: "K", why: "per-person UI preferences" },
  staff_authority_changes: { bucket: "K", why: "staff audit trail" },
  role_permission_changes: { bucket: "K", why: "permission audit trail" },
  staff_photos: { bucket: "K", why: "staff photos (by profile)" },
  // ---------------------------------------------------------------- R
  enrolments: { bucket: "R", why: "rebuilt from public.students after the load (rebuild-enrolments.mjs)" },
  teaching_assignments: { bucket: "R", why: "rebuilt by the timetable re-seed" },
  // ---------------------------------------------------------------- C
  smoke_findings: { bucket: "C", why: "smoke lab" },
  smoke_passes: { bucket: "C", why: "smoke lab" },
  smoke_pool: { bucket: "C", why: "smoke lab" },
  smoke_runs: { bucket: "C", why: "smoke lab" },
  qa_dayrun_accounts: { bucket: "C", why: "day-run tombstones" },
  qa_dayrun_pairs: { bucket: "C", why: "day-run tombstones" },
  qa_dayrun_runs: { bucket: "C", why: "day-run tombstones" },
  qa_dayrun_sessions: { bucket: "C", why: "day-run tombstones" },
  qa_runs: { bucket: "C", why: "QA fixture log" },
  qa_undo: { bucket: "C", why: "QA fixture undo log" },
  data_replica: { bucket: "C", why: "the replica marker" },
  external_student_ids: { bucket: "C", why: "dev-only id links" },
  sampark_import_batches: { bucket: "C", why: "SamPark import" },
  sampark_import_rows: { bucket: "C", why: "SamPark import" },
  job_runs: { bucket: "C", why: "job log" },
  assist_log: { bucket: "C", why: "assist log" },
  drive_folders: { bucket: "C", why: "Drive bookkeeping" },
  drive_object_copies: { bucket: "C", why: "Drive bookkeeping" },
  drive_snapshots: { bucket: "C", why: "Drive bookkeeping" },
  rate_limits: { bucket: "C", why: "rate-limit counters" },
  restore_drills: { bucket: "C", why: "restore drill log" },
  teacher_task_previews: { bucket: "C", why: "preview cache" },
  // ---------------------------------------------------------------- B
  academic_exports: { bucket: "B" },
  acc_cheque_events: { bucket: "B" },
  acc_cheques: { bucket: "B" },
  acc_counter_queue: { bucket: "B" },
  acc_deposit_slips: { bucket: "B" },
  acc_reminder_pauses: { bucket: "B" },
  // recipients are role labels ("Principal"), not numbers; a test-made
  // schedule must not start mailing real reports.
  acc_report_schedules: { bucket: "B", terminal: { set: "active = false", where: "active" } },
  acc_requests: { bucket: "B" },
  acc_upi_events: { bucket: "B" },
  acc_upi_lines: { bucket: "B" },
  admission_details: { bucket: "B" },
  archives: { bucket: "B" },
  assessment_subjects: { bucket: "B" },
  assessments: { bucket: "B" },
  attendance_corrections: { bucket: "B" },
  attendance_marks: { bucket: "B" },
  attendance_register_revisions: { bucket: "B" },
  attendance_registers: { bucket: "B" },
  bulk_changes: { bucket: "B" },
  calendar_notices: {
    bucket: "B",
    terminal: { set: "status = 'cancelled'", where: "status in ('awaiting_approval', 'approved')" },
  },
  collection_request_fields: { bucket: "B" },
  collection_request_members: { bucket: "B" },
  collection_requests: {
    bucket: "B",
    scrub: [
      { column: "contact_phone", to: "null" },
      { column: "token", to: "token" },
    ],
  },
  collection_round_fields: { bucket: "B" },
  collection_rounds: { bucket: "B" },
  collection_submissions: { bucket: "B" },
  cover_commands: { bucket: "B" },
  cover_days: { bucket: "B" },
  cover_duties: { bucket: "B", staffArrays: ["absent_staff_ids"] },
  data_quality_skips: { bucket: "B" },
  document_upload_sessions: { bucket: "B" },
  enquiries: { bucket: "B", scrub: [{ column: "phone", to: "null" }] },
  exam_activity: { bucket: "B", appendOnly: true },
  exam_class_locks: { bucket: "B" },
  exam_duties: { bucket: "B" },
  exam_grace: { bucket: "B" },
  exam_marks_links: {
    bucket: "B",
    scrub: [{ column: "token", to: "token" }],
    terminal: { set: "revoked_at = now()", where: "revoked_at is null" },
  },
  exam_moderation: { bucket: "B" },
  exam_plans: { bucket: "B" },
  exam_question_papers: { bucket: "B" },
  exam_rechecks: { bucket: "B" },
  exam_reminders: { bucket: "B" },
  exam_seats: { bucket: "B" },
  exam_slots: { bucket: "B" },
  fee_call_promises: { bucket: "B" },
  fee_day_close_events: { bucket: "B" },
  fee_desk_requests: { bucket: "B" },
  fee_reminder_batches: {
    bucket: "B",
    terminal: { set: "status = 'cancelled'", where: "status in ('queued', 'scheduled', 'prepared')" },
  },
  marks: { bucket: "B" },
  marks_change_log: { bucket: "B" },
  marks_commands: { bucket: "B" },
  message_campaigns: {
    bucket: "B",
    classArrays: ["class_ids"],
    terminal: { set: "status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())", where: "status <> 'cancelled'" },
  },
  message_sends: {
    bucket: "B",
    // to_phone is NOT NULL: emptied. send_status has no 'suppressed' (critique0 #17).
    scrub: [
      { column: "to_phone", to: "empty" },
      { column: "to_name", to: "null" },
    ],
    terminal: {
      set: "status = 'cancelled', sent_at = null, provider_message_id = null",
      where: "status <> 'cancelled' or sent_at is not null or provider_message_id is not null",
    },
  },
  note_replies: { bucket: "B" },
  notes: { bucket: "B" },
  parent_message_queue: {
    bucket: "B",
    terminal: { set: "status = 'cancelled', sent_at = null, cancelled_at = coalesce(cancelled_at, now())", where: "status <> 'cancelled' or sent_at is not null" },
  },
  parent_replies: { bucket: "B", scrub: [{ column: "from_phone", to: "empty" }] },
  parent_reply_answers: { bucket: "B" },
  parent_route_flags: { bucket: "B", scrub: [{ column: "phone", to: "empty" }] },
  photo_proposals: { bucket: "B" },
  promotion_marks: { bucket: "B" },
  record_commands: { bucket: "B" },
  report_card_issues: { bucket: "B", appendOnly: true },
  report_card_remarks: { bucket: "B" },
  report_cards: { bucket: "B" },
  staff_notice_attempts: {
    bucket: "B",
    scrub: [
      { column: "destination", to: "empty" },
      { column: "link", to: "null" },
      { column: "params", to: "null" },
    ],
  },
  staff_notice_reads: { bucket: "B" },
  staff_notices: {
    bucket: "B",
    terminal: { set: "status = 'suppressed', next_attempt_at = null", where: "status <> 'suppressed' or next_attempt_at is not null" },
  },
  student_documents: { bucket: "B" },
  student_followups: { bucket: "B" },
  student_photos: { bucket: "B" },
  student_record_history: { bucket: "B", appendOnly: true },
  student_records: { bucket: "B" },
  substitution_assignments: { bucket: "B" },
  substitution_plans: { bucket: "B" },
  support_plan_steps: { bucket: "B" },
  support_plans: { bucket: "B" },
  teacher_absence_history: { bucket: "B" },
  teacher_absences: { bucket: "B" },
  teacher_leave: { bucket: "B" },
  teacher_tasks: {
    bucket: "B",
    scrub: [{ column: "token", to: "token" }],
    terminal: { set: "revoked_at = now()", where: "revoked_at is null" },
  },
  timetable_changes: { bucket: "B" },
  timetable_slots: { bucket: "B" },
  // dev's two edited 2026-27 versions move to TEST, archived: TEST already
  // has its published version (one published per session), and the real
  // 2026-27 timetable is re-seeded from the fixture (critique1 A4).
  timetable_versions: {
    bucket: "B",
    relabelSet:
      "status = case when status = 'published' then 'archived'::vppsone.timetable_status else status end, " +
      "archived_at = case when status = 'published' then coalesce(archived_at, now()) else archived_at end",
  },
};

/** Collection-submission answers that may hold a phone or an identifier. */
export const SENSITIVE_FIELD = /(phone|mobile|whatsapp|aadhaar|aadhar|apaar|email|address|contact)/i;

export function bucketOf(table) {
  return TABLES[table]?.bucket ?? null;
}

/** Tables in the database that TABLES does not place (the quarantine refuses while any exist). */
export function unclassified(tableNames) {
  return [...tableNames].filter((t) => !TABLES[t]).sort();
}

/** The SQL value a scrubbed column becomes. Pure; `to` from TABLES. */
export function scrubValue(to) {
  switch (to) {
    case "null":
      return "null";
    case "empty":
      return "''";
    case "emptyArray":
      return "'{}'";
    // 'q' + 31 hex characters: within every token CHECK (12–64;
    // [A-Za-z0-9_-]{16,64}), unique, never the link that was sent, and
    // recognisable, so a re-run rotates nothing twice.
    case "token":
      return "'q' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 31)";
    default:
      throw new Error(`Unknown scrub target: ${to}`);
  }
}

/** The WHERE that finds a row whose column still needs scrubbing. */
export function scrubNeeded(column, to) {
  const c = `"${column}"`;
  switch (to) {
    case "null":
      return `${c} is not null`;
    case "empty":
      return `${c} is distinct from ''`;
    case "emptyArray":
      return `${c} is distinct from '{}'`;
    case "token":
      return `${c} !~ '^q[0-9a-f]{31}$'`;
    default:
      throw new Error(`Unknown scrub target: ${to}`);
  }
}

/* ------------------------------------------------------------ the guards */

/**
 * quarantine-in-place --apply. Fail closed on every input:
 *  - the marker is 'production' and fee_writes_enabled is literally 'false'
 *    (so it can only follow convert-to-production, runbook step 2);
 *  - a backup-one run from the last 24 hours whose manifest is on this
 *    machine and matches its run row (runbook step 1 — the only way back);
 *  - no cutover row, and no applied load (after the first real load a
 *    whole-table quarantine would sweep real activity; re-running it then
 *    needs a restore first);
 *  - no unclassified table.
 * `rollbackOnly` (every write rolled back) lifts the marker, fee-writes and
 * backup guards — nothing persists — never the others.
 */
/**
 * @param {{ environment?: string | null, feeWritesEnabled?: string | null, hasCutover?: boolean, previousApplied?: number,
 *   backup?: { ok: boolean, reason?: string } | null, unclassifiedTables?: string[], rollbackOnly?: boolean }} state
 */
export function decideQuarantineGuard({ environment, feeWritesEnabled, hasCutover, previousApplied, backup, unclassifiedTables = [], rollbackOnly = false }) {
  const reasons = [];
  if (!rollbackOnly && environment !== "production") reasons.push(`vppsone.deployment says '${environment ?? "unreadable"}', not 'production': run convert-to-production first (runbook step 2).`);
  if (!rollbackOnly && String(feeWritesEnabled ?? "").trim() !== "false") {
    reasons.push(`app_settings.fee_writes_enabled is ${feeWritesEnabled == null ? "missing" : `'${feeWritesEnabled}'`}, not 'false'.`);
  }
  if (!rollbackOnly && !backup?.ok) reasons.push(`no usable backup: ${backup?.reason ?? "not checked"} (runbook step 1: npm run migrate:backup-one).`);
  if (hasCutover) reasons.push("vppsone.migration_runs has a cutover row: One is the system of record; quarantine is over.");
  if ((previousApplied ?? 0) > 0) {
    reasons.push(`${previousApplied} applied load(s) exist: after the first real load a whole-table quarantine would sweep real activity. Restore the step-1 backup first (runbook step 3 rollback).`);
  }
  if (unclassifiedTables.length) reasons.push(`unclassified vppsone tables: ${unclassifiedTables.join(", ")} — place them in scripts/migrate/lib/quarantine-rules.mjs.`);
  return { ok: reasons.length === 0, reasons };
}

/**
 * Is there a backup-one run from the last `maxAgeHours` whose manifest is on
 * this machine? `runs`: migration_runs rows (script 'backup-one', status
 * 'succeeded') newest first, `{ snapshot_id, finished_at, summary }`.
 * `manifestOf(runId)` returns `{ text, sha256 } | null`. Pure given those.
 */
export function checkBackup(runs, manifestOf, { now = new Date(), maxAgeHours = 24 } = {}) {
  const fresh = runs.filter((r) => now.getTime() - new Date(r.finished_at).getTime() <= maxAgeHours * 3600e3);
  if (!fresh.length) return { ok: false, reason: `no succeeded backup-one run in the last ${maxAgeHours} h` };
  for (const run of fresh) {
    const manifest = manifestOf(run.snapshot_id);
    if (!manifest) continue;
    const expected = run.summary?.manifest_sha256;
    if (expected && manifest.sha256 !== expected) {
      return { ok: false, reason: `backup ${run.snapshot_id}: manifest.json does not match the run row's manifest_sha256` };
    }
    const schemas = run.summary?.schemas ?? [];
    if (!schemas.includes("vppsone") || !schemas.includes("public")) {
      return { ok: false, reason: `backup ${run.snapshot_id} does not cover both public and vppsone` };
    }
    return { ok: true, runId: run.snapshot_id, finishedAt: run.finished_at };
  }
  return { ok: false, reason: `a backup-one run exists in the last ${maxAgeHours} h but its manifest is not in %USERPROFILE%\\.vppsone-migration on this machine` };
}

/**
 * Does a backup-one --restore put back every table the quarantine wrote?
 * `written`: "schema.table" names (pg_stat_xact_user_tables in the
 * rehearsal); `manifestTables`: the backup's tables; `keep`: backup-one's
 * RESTORE_KEEP (never restored — the run log is meant to stay). Returns the
 * schemas a rollback must restore and the tables it would miss. Pure.
 */
export function restoreCoverageOf(written, manifestTables, keep) {
  const inBackup = new Set(manifestTables.map((t) => `${t.schema}.${t.table}`));
  const missed = [];
  const schemas = new Set();
  for (const t of written) {
    if (t === "vppsone.migration_runs") continue; // the run log: kept on purpose
    if (!inBackup.has(t) || keep[t]) missed.push(t);
    else schemas.add(t.split(".")[0]);
  }
  return { schemas: [...schemas].sort(), missed: missed.sort() };
}

/* ------------------------------------------------------------- the maps */

/** "Class 1" / null / null → one key, as public.classes' own uniqueness. */
export function classKey(row) {
  return [row.class_name, row.section ?? "", row.stream_name ?? ""].map((s) => String(s).trim().toLowerCase()).join("|");
}

/**
 * Real class → TEST-2026-27 class with the same (class_name, section,
 * stream_name). A real class with no TEST twin gets a new TEST class
 * (id devId('classes', id)) — created only if something in scope points at it.
 * `classes`: every public.classes row { id, session_label, class_name, section, stream_name, sort_order, status }.
 */
/**
 * @param {any[]} classes
 * @param {{ referenced?: Set<string> | null }} [options]
 */
export function planClassMap(classes, { referenced = null } = {}) {
  const testByKey = new Map();
  for (const c of classes) if (c.session_label === TEST_SESSION) testByKey.set(classKey(c), c.id);
  const map = new Map();
  const created = [];
  for (const c of classes) {
    if (isTestSessionLabel(c.session_label)) continue;
    if (referenced && !referenced.has(c.id)) continue;
    const twin = testByKey.get(classKey(c));
    if (twin) {
      map.set(c.id, twin);
      continue;
    }
    const id = devId("classes", c.id);
    map.set(c.id, id);
    created.push({ id, source: c.id, session_label: TEST_SESSION, class_name: c.class_name, section: c.section ?? null, stream_name: c.stream_name ?? null, sort_order: c.sort_order ?? 0, status: c.status ?? "active" });
  }
  return { map, created };
}

/**
 * Student → where TEST rows may point. A student in a TEST class keeps its
 * id (dev TEST students ARE live's TEST students: same ids — critique1 B15).
 * Every other student gets a TEST-D- shell: id devId('students', id), masked
 * name kept, every phone / email / address null, the TEST twin of its class.
 * Numbers: an existing shell keeps its number; new ones continue after the
 * highest, in source-id order (so a re-run numbers the same).
 *
 * students: Map id -> { id, full_name, class_id, status } (null when the id
 * no longer exists); classSession: Map class id -> session label;
 * classMap: real class -> TEST class; existing: Map source id -> { id, admission_no }.
 */
export function planStudentMap(referencedIds, { students, classSession, classMap, existing = new Map(), fallbackClassId = null }) {
  const map = new Map();
  const shells = [];
  const missing = [];
  let next = 0;
  for (const shell of existing.values()) {
    const n = Number(String(shell.admission_no ?? "").slice(SHELL_PREFIX.length));
    if (Number.isFinite(n) && n > next) next = n;
  }
  for (const id of [...new Set(referencedIds)].sort()) {
    const student = students.get(id) ?? null;
    if (student && isTestSessionLabel(classSession.get(student.class_id))) continue;
    const known = existing.get(id);
    if (known) {
      map.set(id, known.id);
      continue;
    }
    const classId = student ? (classMap.get(student.class_id) ?? null) : fallbackClassId;
    if (!student) missing.push(id);
    next += 1;
    const shell = {
      id: devId("students", id),
      source: id,
      admission_no: `${SHELL_PREFIX}${String(next).padStart(4, "0")}`,
      full_name: student?.full_name?.trim() ? student.full_name : `Test student ${String(next).padStart(4, "0")}`,
      class_id: classId,
      status: student?.status ?? "active",
    };
    map.set(id, shell.id);
    shells.push(shell);
  }
  return { map, shells, missing };
}

/**
 * Which profiles are REAL teacher profiles (bucket A, critique1 A4):
 * active teaching profiles whose short name is a teacher of the school's
 * timetable fixture. On dev they are the profiles the smoke seats borrowed
 * (smoke_pool.linked_existing) — their display names may be real staff
 * names. Never the owner's (role admin), never a placeholder or twin.
 */
/**
 * @param {any[]} profiles
 * @param {Iterable<string>} fixtureShortNames
 * @returns {any[]}
 */
export function promoteCandidates(profiles, fixtureShortNames) {
  const names = new Set([...fixtureShortNames].map((s) => String(s).toLowerCase()));
  return profiles.filter(
    (p) =>
      p.is_active &&
      (p.role === "teacher" || p.is_teaching) &&
      names.has(String(p.short_name).toLowerCase()) &&
      !String(p.short_name).startsWith("T-") &&
      !String(p.short_name).startsWith("TEST-"),
  );
}

/**
 * Staff profile → the test-account profile TEST rows point at (critique0 #16):
 *  - a real-teacher candidate → its own test TWIN (id devId('staff_profiles', id),
 *    short name 'T-<short>', same role, is_test_account, no phone). Per
 *    person, not one per role: a TEST timetable or cover rota collapsed onto
 *    one teacher would break its own uniqueness (teaching_assignments,
 *    cover_duties_no_double_booking). The candidate's QA / smoke login moves
 *    to the twin, so test sign-ins never act as the real profile;
 *  - any other real profile (the owner) → an existing test account of the
 *    same role (oldest first), else a PLACEHOLDER test profile for that role
 *    (id uuidV5('dev:staff_profiles:placeholder:<role>'), no login — the
 *    owner links one later);
 *  - a test account that is not a candidate → itself.
 */
export function planStaffMap(profiles, candidates) {
  const candidateIds = new Set(candidates.map((p) => p.id));
  const map = new Map();
  const twins = [];
  const placeholders = new Map();
  const byRole = new Map();
  const sorted = [...profiles].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  for (const p of sorted) {
    if (p.is_test_account && p.is_active && !candidateIds.has(p.id) && !byRole.has(p.role)) byRole.set(p.role, p.id);
  }
  for (const p of candidates) {
    const id = devId("staff_profiles", p.id);
    map.set(p.id, id);
    twins.push({
      id,
      source: p.id,
      moveUserFrom: p.user_id ?? null,
      display_name: `Test ${p.role === "teacher" ? "teacher" : p.role} ${p.short_name}`,
      short_name: `T-${p.short_name}`,
      role: p.role,
      is_teaching: Boolean(p.is_teaching),
      is_active: true,
      preferred_language: p.preferred_language ?? "both",
    });
  }
  for (const p of profiles) {
    if (candidateIds.has(p.id) || p.is_test_account) continue;
    let target = byRole.get(p.role);
    if (!target) {
      target = uuidV5(`dev:staff_profiles:placeholder:${p.role}`);
      if (!placeholders.has(p.role)) {
        placeholders.set(p.role, {
          id: target,
          source: `placeholder:${p.role}`,
          display_name: `Test ${p.role.replace(/_/g, " ")}`,
          short_name: `TEST-${p.role.toUpperCase().replace(/_/g, "-")}`,
          role: p.role,
          is_teaching: p.role === "teacher",
          is_active: true,
          preferred_language: "both",
        });
      }
    }
    map.set(p.id, target);
  }
  return { map, twins, placeholders: [...placeholders.values()] };
}

/* -------------------------------------------------------- promotion */

/**
 * The column naming the person an A row is ABOUT (as opposed to who wrote
 * it). A real row about a QA / smoke / day-run profile is dropped; one merely
 * written by such a profile keeps its content and loses the author.
 */
export const PROMOTE_SUBJECT_STAFF = {
  class_teachers: "staff_profile_id",
  cover_policies: "staff_profile_id",
  staff_scopes: "staff_profile_id",
};

/**
 * One's classes of `session` with no class of the same (name, section,
 * stream) in the live fees database: the extra dev class (plan §4.2: "dev
 * has 20 classes for 2026-27 and live has 19"). Pure.
 */
/**
 * @param {any[]} oneClasses
 * @param {any[]} liveClasses
 * @param {string} session
 * @returns {any[]}
 */
export function classesWithoutLivePartner(oneClasses, liveClasses, session) {
  const live = new Set(liveClasses.filter((c) => c.session_label === session).map(classKey));
  return oneClasses.filter((c) => c.session_label === session && !live.has(classKey(c)));
}

/** Text the promoted master data must not carry (critique0 #20). */
export const PROMOTE_TEXT_FLAGS = [
  { name: "qa.vpps.local", pattern: "qa\\.vpps\\.local" },
  { name: "vercel.app", pattern: "vercel\\.app" },
  { name: "99999", pattern: "99999" },
];

/**
 * The role → permission seed as the migrations write it: the base map in
 * `*_staff_authority_and_scoped_reads.sql` (20261004031630, lines 47-155)
 * plus every `*_role_permissions.sql` addition — the same reading
 * tests/scoped-reads.test.ts pins equal to src/platform/auth/permissions.ts.
 * files: [{ name, text }].
 */
export function rolePermissionSeed(files) {
  const picked = files.filter((f) => f.name.endsWith("_staff_authority_and_scoped_reads.sql") || f.name.endsWith("_role_permissions.sql"));
  const out = new Set();
  for (const f of picked) {
    for (const [, role, permission] of f.text.matchAll(/\('([a-z_]+)', '([a-z_]+:[a-z_]+)'\)/g)) out.add(`${role} ${permission}`);
  }
  return out;
}

/** What to delete and insert to make `current` ("role perm" strings) equal the seed. */
export function permissionDiff(current, seed) {
  const now = new Set(current);
  return {
    remove: [...now].filter((k) => !seed.has(k)).sort(),
    add: [...seed].filter((k) => !now.has(k)).sort(),
  };
}

/**
 * seed-timetable --production-promote: the one path on which the timetable
 * seeder writes the REAL session on production (critique1 A4; plan §4.2).
 * Every input must be read and exact — unlike toolScope(), an unreadable
 * marker does not count as production here, it counts as "no":
 *  - the marker reads exactly 'production' (step 2 done);
 *  - fee_writes_enabled reads exactly 'false' (before T0);
 *  - a promote-master-data run has succeeded (the real teacher profiles exist);
 *  - no cutover row (after T0 the timetable is the school's to edit).
 */
export function decidePromoteSeed({ environment, feeWritesEnabled, promoteRuns, hasCutover }) {
  const reasons = [];
  if (environment !== "production") reasons.push(`the marker reads '${environment ?? "unreadable"}', not 'production'`);
  if (feeWritesEnabled !== "false") reasons.push(`fee_writes_enabled reads ${feeWritesEnabled == null ? "nothing" : `'${feeWritesEnabled}'`}, not 'false'`);
  if (!(promoteRuns > 0)) reasons.push("no promote-master-data run has succeeded");
  if (hasCutover !== false) reasons.push(hasCutover ? "a cutover row exists" : "could not read whether a cutover row exists");
  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------- convert steps */

export const CONVERT_STEPS = ["fee-writes", "test-prefix", "marker", "test-accounts", "test-phones", "smoke-enforce", "dispatch-flags"];

/**
 * Does vppsone.smoke_enforce() act on test seats only? It must touch
 * auth.users / auth.sessions ONLY through `vppsone.smoke_pool` (whose email
 * CHECK confines it to smoke.*@qa.vpps.local), and every pool row must be a
 * qa.vpps.local login whose profile is a test account. Pure over the
 * function body and the pool's facts.
 */
export function smokeEnforceIsConfined(body, pool) {
  const reasons = [];
  const text = String(body ?? "");
  if (!text) reasons.push("the function body could not be read");
  const updates = [...text.matchAll(/update\s+auth\.users[\s\S]*?;/gi)].map((m) => m[0]);
  const deletes = [...text.matchAll(/delete\s+from\s+auth\.sessions[\s\S]*?;/gi)].map((m) => m[0]);
  for (const stmt of [...updates, ...deletes]) {
    if (!/in\s*\(\s*select\s+auth_user_id\s+from\s+vppsone\.smoke_pool\s*\)/i.test(stmt)) {
      reasons.push("a statement on auth.users / auth.sessions is not limited to vppsone.smoke_pool");
    }
  }
  if (/\b(insert\s+into|delete\s+from|update)\s+(public|vppsone)\./i.test(text.replace(/update\s+auth\.users/gi, ""))) {
    reasons.push("the function writes to public or vppsone");
  }
  const notQa = pool.filter((p) => !/^smoke\.[a-z0-9._-]+@qa\.vpps\.local$/.test(String(p.email ?? "").toLowerCase()));
  if (notQa.length) reasons.push(`${notQa.length} smoke_pool row(s) are not smoke.*@qa.vpps.local`);
  const realProfile = pool.filter((p) => p.staff_profile_id && p.is_test_account === false);
  if (realProfile.length) reasons.push(`${realProfile.length} smoke_pool row(s) point at a profile that is not a test account`);
  return { confined: reasons.length === 0, reasons };
}

/* ------------------------------------------------------ enrolments (C8) */

/**
 * rebuild-enrolments --apply: only once the REAL students are in `public`
 * (a first load or a cutover row — before that `public.students` is the
 * masked replica), on production, with fee writes still shut (C8 runs on T0
 * before the owner opens them; afterwards the app keeps enrolments itself).
 */
export function decideEnrolmentRebuild({ environment, feeWritesEnabled, hasCutover, firstLoads }) {
  const reasons = [];
  if (environment !== "production") reasons.push(`the marker reads '${environment ?? "unreadable"}', not 'production'`);
  if (String(feeWritesEnabled ?? "") !== "false") reasons.push(`fee_writes_enabled is ${feeWritesEnabled == null ? "missing" : `'${feeWritesEnabled}'`}, not 'false'`);
  if (!hasCutover && !(firstLoads > 0)) reasons.push("no first load and no cutover row: public.students is still the masked replica");
  return { ok: reasons.length === 0, reasons };
}

/**
 * What rebuild-enrolments writes for one session: every student of the
 * session's classes on roll or left (critique1 B21 — the count equals on
 * roll + left), enrolled in their class; status 'left' with left_on for a
 * left student; nothing for a student who is neither. Existing rows are
 * updated in place (their id and roll number kept); rows whose student is not
 * in the session any more are deleted. Pure.
 * students: [{ id, class_id, status, left_on, joined_on }]; existing: [{ id, student_id, class_id, status, left_on }].
 */
export function planEnrolments(students, existing, { onRoll = ["active"], left = ["left"] } = {}) {
  const want = new Map();
  for (const s of students) {
    if (onRoll.includes(s.status)) want.set(s.id, { student_id: s.id, class_id: s.class_id, status: "enrolled", left_on: null, enrolled_on: s.joined_on ?? null });
    else if (left.includes(s.status)) want.set(s.id, { student_id: s.id, class_id: s.class_id, status: "left", left_on: s.left_on ?? null, enrolled_on: s.joined_on ?? null });
  }
  const have = new Map(existing.map((e) => [e.student_id, e]));
  const insert = [];
  const update = [];
  const remove = [];
  for (const [id, w] of want) {
    const e = have.get(id);
    if (!e) insert.push(w);
    else if (e.class_id !== w.class_id || e.status !== w.status || (e.left_on ?? null) !== (w.left_on ?? null)) update.push({ id: e.id, ...w });
  }
  for (const e of existing) if (!want.has(e.student_id)) remove.push(e.id);
  const byStatus = {};
  for (const w of want.values()) byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
  return { insert, update, remove, total: want.size, byStatus };
}
