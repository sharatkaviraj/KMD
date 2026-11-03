/**
 * The reads every phase-H script shares: the catalog, the guard inputs, the
 * backup on this machine, the school's timetable teachers, and the identity
 * maps the quarantine and the promotion are built on. Each takes an open
 * `postgres` connection or transaction. Nothing here writes.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { ONE_MAIN_PROJECT_REF } from "../../target-guard.mjs";
import { repoRoot, runDir } from "./env.mjs";
import {
  checkBackup,
  planClassMap,
  planStaffMap,
  planStudentMap,
  splitCandidates,
  TABLES,
  unclassified,
} from "./quarantine-rules.mjs";
import { mapParams, scopeOf, uuidArray } from "./quarantine-sql.mjs";
import { readVppsoneCatalog, unlistedRefColumns } from "./vppsone-catalog.mjs";

export const FIXTURE_TIMETABLE = path.join(repoRoot, "tests", "fixtures", "timetable-2026-27.csv");

/** The teacher short names of the school's timetable sheet, through the app's own parser. */
export async function fixtureTeacherShortNames(file = FIXTURE_TIMETABLE) {
  const { buildTeacherMap, parseTimetable } = await import("../../../src/modules/timetable/domain/parse-timetable.ts");
  const parsed = parseTimetable(readFileSync(file, "utf8"));
  return Object.keys(buildTeacherMap(parsed));
}

/** The manifest of a backup run on this machine, or null. */
export function readBackupManifest(runId) {
  let dir;
  try {
    dir = runDir(runId, { create: false });
  } catch {
    return null;
  }
  const file = path.join(dir, "manifest.json");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}

/** Is there a usable backup-one run from the last 24 h (runbook step 1)? */
export async function backupState(sql, { now = new Date(), maxAgeHours = 24 } = {}) {
  const runs = await sql`
    select snapshot_id, finished_at, summary from vppsone.migration_runs
    where script = 'backup-one' and kind = 'run' and status = 'succeeded' and target_project = ${ONE_MAIN_PROJECT_REF}
    order by finished_at desc limit 20`;
  return checkBackup(
    runs.map((r) => ({ ...r, summary: typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary })),
    readBackupManifest,
    { now, maxAgeHours },
  );
}

export async function readProfiles(sql) {
  return sql`
    select p.id::text, p.user_id::text, p.role::text, p.short_name, p.display_name, p.is_active, p.is_teaching,
           p.is_test_account, p.preferred_language, p.created_at, p.phone is not null or p.whatsapp_phone is not null as has_phone,
           lower(split_part(u.email, '@', 2)) as email_domain,
           exists (select 1 from vppsone.qa_dayrun_accounts d where d.staff_profile_id = p.id) as in_dayrun
    from vppsone.staff_profiles p left join auth.users u on u.id = p.user_id`;
}

export async function readClasses(sql) {
  return sql`select id::text, session_label, class_name, section, stream_name, sort_order, status::text from public.classes`;
}

/** Distinct values of `column` (uuid or uuid[]) in the rows the quarantine owns. */
async function distinctRefs(sql, info, column, isArray) {
  const scope = scopeOf(info);
  if (!scope) return [];
  const expr = isArray ? `unnest(t."${column}")` : `t."${column}"`;
  const rows = await sql.unsafe(`select distinct ${expr}::text as v from vppsone."${info.table}" as t where ${scope}`);
  return rows.map((r) => r.v).filter(Boolean);
}

/**
 * Everything the quarantine decides before it writes: the catalog, the
 * candidates, and the class, student and staff maps (with the rows to create).
 */
export async function planIdentities(sql, { acceptHeld = [] } = {}) {
  const catalog = await readVppsoneCatalog(sql);
  const notPlaced = unclassified(Object.keys(catalog));
  const [classes, profiles, shortNames] = await Promise.all([readClasses(sql), readProfiles(sql), fixtureTeacherShortNames()]);

  const classIds = new Set();
  const studentIds = new Set();
  for (const info of Object.values(catalog)) {
    if (!TABLES[info.table]) continue;
    for (const c of info.classCols) for (const v of await distinctRefs(sql, info, c, false)) classIds.add(v);
    for (const c of info.classArrays) for (const v of await distinctRefs(sql, info, c, true)) classIds.add(v);
    for (const c of info.studentCols) for (const v of await distinctRefs(sql, info, c, false)) studentIds.add(v);
    for (const c of info.studentArrays) for (const v of await distinctRefs(sql, info, c, true)) studentIds.add(v);
  }

  const students = new Map();
  if (studentIds.size) {
    const rows = await sql.unsafe(
      `select id::text, full_name, class_id::text, status::text from public.students where id = any($1::uuid[])`,
      [uuidArray([...studentIds])],
    );
    for (const r of rows) students.set(r.id, r);
  }
  for (const s of students.values()) classIds.add(s.class_id);

  const classMapPlan = planClassMap(classes, { referenced: classIds });
  const classSession = new Map(classes.map((c) => [c.id, c.session_label]));
  for (const c of classMapPlan.created) classSession.set(c.id, c.session_label);

  const existingRows = await sql`
    select m.source_id, m.target_id, s.admission_no from vppsone.migration_id_map m
    left join public.students s on s.id::text = m.target_id
    where m.source_project = ${ONE_MAIN_PROJECT_REF} and m.source_table = 'public.students'`;
  const existing = new Map(existingRows.map((r) => [r.source_id, { id: r.target_id, admission_no: r.admission_no }]));
  const studentPlan = planStudentMap([...studentIds], { students, classSession, classMap: classMapPlan.map, existing });

  // Held profiles (a day-run made them, or a QA-looking name) are not
  // candidates: they stay test accounts and get no twin (splitCandidates).
  const { candidates, held } = splitCandidates(profiles, shortNames, { acceptHeld });
  const staffPlan = planStaffMap(profiles, candidates);

  const blockers = [];
  if (notPlaced.length) blockers.push(`unclassified vppsone tables: ${notPlaced.join(", ")}`);
  const unlisted = unlistedRefColumns(catalog);
  if (unlisted.length) blockers.push(`reference columns the quarantine would not re-point (list them in lib/quarantine-rules.mjs TABLES): ${unlisted.join(", ")}`);
  const shortTaken = new Map(profiles.map((p) => [String(p.short_name).toLowerCase(), p.id]));
  for (const p of [...staffPlan.twins, ...staffPlan.placeholders]) {
    const holder = shortTaken.get(p.short_name.toLowerCase());
    if (holder && holder !== p.id) blockers.push(`short name ${p.short_name} for a test twin is already another profile's`);
  }
  for (const s of studentPlan.shells) if (!s.class_id) blockers.push(`a TEST-D- shell (${s.admission_no}) has no TEST class: its student no longer exists`);
  for (const info of Object.values(catalog)) {
    if (TABLES[info.table]?.appendOnly && info.referencedBy.length) {
      blockers.push(`append-only ${info.table} is referenced by ${info.referencedBy.join(", ")}: insert-copy + delete would orphan them`);
    }
  }

  return {
    catalog,
    classes,
    profiles,
    shortNames,
    candidates,
    held,
    classPlan: classMapPlan,
    studentPlan,
    staffPlan,
    maps: { classMap: classMapPlan.map, studentMap: studentPlan.map, staffMap: staffPlan.map },
    blockers,
  };
}

/**
 * The live fees database's classes (session, name, section, stream) through
 * the sealed select-only reader (D-339) — never a write, never a person.
 * Returns { classes } or { error } (no secrets file, no network).
 */
export async function readLiveClasses() {
  try {
    const { loadFeesSecrets } = await import("./env.mjs");
    const { openFeesReadOnly } = await import("./fees-readonly.mjs");
    const fees = openFeesReadOnly(loadFeesSecrets());
    const { data, error } = await fees.from("classes").select("session_label, class_name, section, stream_name");
    if (error) return { error: error.message };
    return { classes: data ?? [] };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Bucket-B rows still labelled with a real session (verify-quarantine.sql
 * check 3), per table: [{ table, n }] with n > 0. load-snapshot --first-load
 * refuses while any exist (lib/quarantine-rules.mjs decideFirstLoadQuarantine).
 */
export async function readQuarantineLeftovers(sql) {
  const catalog = await readVppsoneCatalog(sql);
  const out = [];
  for (const info of Object.values(catalog).sort((a, b) => a.table.localeCompare(b.table))) {
    if (TABLES[info.table]?.bucket !== "B" || !info.hasSession) continue;
    const [{ n }] = await sql.unsafe(`select count(*)::int as n from vppsone."${info.table}" as t where not vppsone.is_test_session_label(t.session_label)`);
    if (n) out.push({ table: info.table, n });
  }
  return out;
}

export { mapParams };
