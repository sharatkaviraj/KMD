#!/usr/bin/env node
/**
 * Quarantine One's test activity IN PLACE on its main database (go-live
 * phase H; runbook step 3; plan §0.1 "Phase 4 quarantines in place", §4.3;
 * critique0 #16, #17, #19; critique1 B15).
 *
 *   node scripts/migrate/quarantine-in-place.mjs                  # dry run: counts per table, blockers, guard verdict
 *   node scripts/migrate/quarantine-in-place.mjs --rollback-only  # every write, then ROLLBACK (rehearsal; nothing persists)
 *       [--with-promote] [--with-reset]   # … then promote-master-data and reset-test-session in the same transaction
 *   … [--accept-held <short,…>]           # held timetable profiles the owner has confirmed are the real teacher
 *   node scripts/migrate/quarantine-in-place.mjs --apply          # for real (the orchestrator, after step 2)
 *
 * Every `vppsone` row on `wtgxcptmucjerhufzjcf` is test activity until
 * go-live, and dev student ids EQUAL live ids. So before any real data is
 * loaded, every bucket-B row (lib/quarantine-rules.mjs) — and every
 * TEST-labelled row of an A or R table — is made to point at test data only:
 *
 *  1. identities (one transaction): a TEST-2026-27 twin class for a real
 *     class that has none (id uuid v5 'dev:classes:<id>'); a `TEST-D-####`
 *     shell in public.students for every referenced student who is not in a
 *     TEST class (uuid v5 'dev:students:<id>', masked name kept, every phone,
 *     email and address null, the TEST twin class); a test TWIN profile for
 *     each real-teacher candidate (short name 'T-<short>'), to which the
 *     candidate's QA / smoke login moves; a placeholder test profile per role
 *     for any other real profile (the owner) when no test account of that
 *     role exists — no login; the owner links one later. Every new identity
 *     (shell, twin class, twin / placeholder profile) and every class / staff
 *     re-map is recorded in vppsone.migration_id_map; row-level re-points are
 *     not (each table's count is in the run row and apply.json). A held
 *     profile (lib/quarantine-rules.mjs splitCandidates) gets no twin.
 *  2. per table group (one transaction each, a savepoint per table, the
 *     table's named triggers off for its statements): session_label →
 *     TEST-2026-27; class / student / staff ids → the maps above; every
 *     phone, destination and token nulled or rotated; message_sends →
 *     cancelled with sent_at null; staff_notices → suppressed; queues,
 *     campaigns, tasks and links → cancelled / revoked; record answers to
 *     phone / identifier / address fields nulled. Append-only tables
 *     (report_card_issues, student_record_history, exam_activity) are
 *     rewritten by delete + insert-copy of the changed rows with their ids
 *     KEPT (nothing is mapped), the named triggers off for those statements.
 *
 * Idempotent: ids are uuid v5, every UPDATE's WHERE only finds rows not yet
 * moved, tokens are rotated once ('q' + 31 hex). A re-run reports 0.
 *
 * --apply refuses (lib/quarantine-rules.mjs decideQuarantineGuard) unless the
 * marker is 'production' and fee_writes_enabled is 'false' (so only after
 * convert-to-production), a backup-one run from the last 24 h is on this
 * machine, no load has been applied, no cutover row exists and every table is
 * classified, every reference-shaped column is re-pointable, and no held
 * real-teacher profile waits for the owner (--accept-held). --rollback-only
 * lifts the marker, fee-writes, backup and held guards (nothing persists).
 * Undo: backup-one --restore <step 1 run> (both schemas: the shells and twin
 * classes are in public), then step 2 again (runbook step 3 rollback).
 *
 * Output: counts only — never a name, a phone or an id of a person.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";
import { isMain, loadOneEnv, newRunId, parseArgs, runDir } from "./lib/env.mjs";
import { readGuardState } from "./lib/guards.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { RESTORE_KEEP } from "./backup-one.mjs";
import { decideQuarantineGuard, parseAcceptHeld, restoreCoverageOf, TABLES, TEST_SESSION } from "./lib/quarantine-rules.mjs";
import { countSql, planTableOps, quoteIdent, updateSql, whereParams } from "./lib/quarantine-sql.mjs";
import { backupState, planIdentities, readBackupManifest } from "./lib/quarantine-state.mjs";

/** Table groups: one transaction each, in this order. Anything not listed runs in the last. */
export const GROUPS = [
  ["timetable", /^(timetable_|teaching_assignments$|class_teachers$|class_aliases$|class_seats$|cover_|substitution_|bell_schedules$|staff_scopes$|team_supervision_rules$)/],
  ["attendance", /^attendance_/],
  ["exams and marks", /^(assessment|marks|exam_|report_card|report_schemes$|promotion_marks$)/],
  ["records and notes", /^(student_|notes$|note_replies$|support_plan|record_commands$|data_quality_skips$|photo_proposals$|admission_details$|enquiries$|academic_|calendar_)/],
  ["collection", /^collection_/],
  ["messages and notices", /^(message_|parent_|staff_notice|teacher_|fee_reminder_batches$)/],
  ["fees desk", /^(acc_|fee_)/],
  ["other", /./],
];

export function groupOf(table) {
  return GROUPS.find(([, re]) => re.test(table))[0];
}

const rel = (table) => `vppsone.${quoteIdent(table)}`;

/** Every op of every table, grouped. */
export function planAll(identities) {
  const groups = new Map(GROUPS.map(([name]) => [name, []]));
  for (const info of Object.values(identities.catalog).sort((a, b) => a.table.localeCompare(b.table))) {
    if (!TABLES[info.table]) continue;
    const ops = planTableOps(info, identities.maps);
    if (!ops.length) continue;
    groups.get(groupOf(info.table)).push({ info, ops, appendOnly: Boolean(TABLES[info.table].appendOnly) });
  }
  return groups;
}

export async function countOps(tx, entry) {
  const out = [];
  for (const op of entry.ops) {
    const [{ n }] = await tx.unsafe(countSql(op, rel(entry.info.table)), whereParams(op));
    out.push({ kind: op.kind, column: op.column, n });
  }
  return out;
}

/* ------------------------------------------------------------ identities */

export async function writeIdentities(tx, identities, runRowId) {
  const { classPlan, studentPlan, staffPlan } = identities;
  const done = { classes: 0, shells: 0, twins: 0, placeholders: 0, logins: 0, smokeSeats: 0, idMap: 0 };
  for (const c of classPlan.created) {
    const r = await tx`
      insert into public.classes (id, session_label, class_name, section, stream_name, sort_order, status)
      values (${c.id}, ${TEST_SESSION}, ${c.class_name}, ${c.section}, ${c.stream_name}, ${c.sort_order}, ${c.status})
      on conflict (id) do nothing`;
    done.classes += r.count;
  }
  for (const s of studentPlan.shells) {
    // Masked name kept (it is the replica's); every phone, email, address and
    // identifier left null.
    const r = await tx`
      insert into public.students (id, admission_no, full_name, class_id, status, notes)
      values (${s.id}, ${s.admission_no}, ${s.full_name}, ${s.class_id}, ${s.status},
              'TEST-D shell made by quarantine-in-place (go-live phase H). Test data.')
      on conflict (id) do nothing`;
    done.shells += r.count;
  }
  for (const p of [...staffPlan.twins, ...staffPlan.placeholders]) {
    const r = await tx`
      insert into vppsone.staff_profiles (id, display_name, short_name, role, is_teaching, is_active, preferred_language, is_test_account)
      values (${p.id}, ${p.display_name}, ${p.short_name}, ${p.role}, ${p.is_teaching}, true, ${p.preferred_language}, true)
      on conflict (id) do nothing`;
    if (staffPlan.twins.includes(p)) done.twins += r.count;
    else done.placeholders += r.count;
  }
  // The candidate's QA / smoke login moves to its twin: a test sign-in never
  // acts as the profile the promotion makes real (critique0 #16, critique1 A4).
  for (const t of staffPlan.twins) {
    if (!t.moveUserFrom) continue;
    const off = await tx`update vppsone.staff_profiles set user_id = null where id = ${t.source} and user_id = ${t.moveUserFrom}`;
    if (off.count) {
      await tx`update vppsone.staff_profiles set user_id = ${t.moveUserFrom} where id = ${t.id} and user_id is null`;
      done.logins += 1;
    }
    const seat = await tx`update vppsone.smoke_pool set staff_profile_id = ${t.id}, linked_existing = false where staff_profile_id = ${t.source}`;
    done.smokeSeats += seat.count;
  }
  const mapRows = [
    ...classPlan.created.map((c) => ["public.classes", c.source, c.id]),
    ...studentPlan.shells.map((s) => ["public.students", s.source, s.id]),
    ...staffPlan.twins.map((t) => ["vppsone.staff_profiles", t.source, t.id]),
    ...staffPlan.placeholders.map((p) => ["vppsone.staff_profiles", p.source, p.id]),
    // Re-points onto rows that already existed: recorded for the audit, under
    // names lib/import-rules.mjs protectedRows() ignores (it protects only
    // public.* targets — an existing TEST class must stay loadable).
    ...[...classPlan.map].filter(([s, t]) => !classPlan.created.some((c) => c.id === t) && s !== t).map(([s, t]) => ["vppsone.class_map", s, t]),
    ...[...staffPlan.map].filter(([s, t]) => !staffPlan.twins.some((x) => x.id === t) && s !== t).map(([s, t]) => ["vppsone.staff_map", s, t]),
  ];
  for (const [table, source, target] of mapRows) {
    const r = await tx`
      insert into vppsone.migration_id_map (source_project, source_table, source_id, target_id, batch_id)
      values (${ONE_MAIN_PROJECT_REF}, ${table}, ${source}, ${target}, ${runRowId})
      on conflict do nothing`;
    done.idMap += r.count;
  }
  return done;
}

/* --------------------------------------------------------------- tables */

async function setTriggers(tx, info, on) {
  for (const trigger of info.triggers) {
    await tx.unsafe(`alter table ${rel(info.table)} ${on ? "enable" : "disable"} trigger ${quoteIdent(trigger)}`);
  }
}

/** Update in place: the table's named triggers off for these statements only. */
export async function writeTable(tx, entry) {
  const { info, ops } = entry;
  const counts = [];
  await setTriggers(tx, info, false);
  for (const op of ops) {
    const r = await tx.unsafe(updateSql(op, rel(info.table)), op.params);
    counts.push({ kind: op.kind, column: op.column, n: r.count });
  }
  await setTriggers(tx, info, true);
  return counts;
}

/**
 * Append-only (plan §0.1): the rows that change are copied into a temporary
 * table and changed there, then the originals are deleted and the copy
 * inserted — the table's named triggers off for those statements only, so
 * the append-only rule is never relaxed for anyone else. Ids are kept (they
 * are bigint on student_record_history; nothing outside points in — the
 * planner refuses an append-only table that is referenced).
 */
export async function rewriteAppendOnly(tx, entry) {
  const { info, ops } = entry;
  if (!info.pk.length || info.pk.length > 1) throw new Error(`${info.table}: an append-only rewrite needs a one-column primary key.`);
  const pk = quoteIdent(info.pk[0]);
  const ids = new Set();
  for (const op of ops) {
    for (const r of await tx.unsafe(`select t.${pk}::text as id from ${rel(info.table)} as t where ${op.where}`, whereParams(op))) ids.add(r.id);
  }
  if (!ids.size) return ops.map((op) => ({ kind: op.kind, column: op.column, n: 0 }));
  const keys = `{${[...ids].sort().join(",")}}`;
  const copy = quoteIdent(`q_copy_${info.table}`);
  await tx.unsafe(`create temporary table ${copy} on commit drop as select * from ${rel(info.table)} where ${pk}::text = any($1::text[])`, [keys]);
  const counts = [];
  for (const op of ops) {
    const r = await tx.unsafe(updateSql(op, `pg_temp.${copy}`), op.params);
    counts.push({ kind: op.kind, column: op.column, n: r.count });
  }
  await setTriggers(tx, info, false);
  const removed = await tx.unsafe(`delete from ${rel(info.table)} where ${pk}::text = any($1::text[])`, [keys]);
  const columns = info.columns.map((c) => quoteIdent(c.name)).join(", ");
  const inserted = await tx.unsafe(`insert into ${rel(info.table)} (${columns}) overriding system value select ${columns} from pg_temp.${copy}`);
  await setTriggers(tx, info, true);
  await tx.unsafe(`drop table pg_temp.${copy}`);
  if (inserted.count !== ids.size || removed.count !== ids.size) throw new Error(`${info.table}: removed ${removed.count}, copied back ${inserted.count}, expected ${ids.size}`);
  counts.push({ kind: "rewritten", column: info.pk[0], n: ids.size });
  return counts;
}

/** restoreCoverageOf over a backup manifest read from disk; null when there is none. */
export function restoreCoverage(written, manifestFile) {
  if (!manifestFile) return { schemas: [], missed: ["(no backup manifest on this machine)"], written };
  const manifest = JSON.parse(manifestFile.text);
  return { ...restoreCoverageOf(written, manifest.tables, RESTORE_KEEP), written };
}

export const VERIFY_SQL =path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-quarantine.sql");

/** scripts/migrate/verify-quarantine.sql in the caller's transaction: [{ check_name, failing, result }]. */
export async function runVerify(tx) {
  return tx.unsafe(readFileSync(VERIFY_SQL, "utf8"));
}

/** The two checks a rehearsal on a database not yet converted cannot pass. */
const NEEDS_CONVERT = new Set(["marker is not production", "fee_writes_enabled is not false"]);

export async function prepare(tx) {
  await tx.unsafe("set local timezone = 'UTC'");
  await tx.unsafe("set local statement_timeout = 0");
  // A lock that does not come within 10 s fails the run rather than queue
  // every reader of the app behind it.
  await tx.unsafe("set local lock_timeout = '10s'");
}

/** The guard, read inside the transaction that will write. */
export async function guardIn(tx, { rollbackOnly, backup, blockers, held }) {
  const state = await readGuardState(tx);
  return decideQuarantineGuard({ ...state, backup, unclassifiedTables: blockers.filter((b) => b.startsWith("unclassified")), held, rollbackOnly });
}

class Rehearsal extends Error {
  constructor(outcome) {
    super("quarantine rehearsal: rolled back on purpose");
    this.outcome = outcome;
  }
}

function printPlan(identities, guard, backup) {
  const { classPlan, studentPlan, staffPlan, candidates, held, profiles, shortNames } = identities;
  console.log(`  identities: ${classPlan.map.size} real class(es) → TEST (${classPlan.created.length} TEST twin class(es) to create); ` +
    `${studentPlan.map.size} student(s) → TEST-D- shells (${studentPlan.shells.length} to create, ${studentPlan.missing.length} no longer in public.students); ` +
    `students already in a TEST class kept as they are`);
  console.log(`  staff: ${profiles.length} profiles, ${profiles.filter((p) => p.is_test_account).length} test accounts; timetable teachers ${shortNames.length}; ` +
    `real-teacher candidates ${candidates.length} → ${staffPlan.twins.length} test twin(s) (${staffPlan.twins.filter((t) => t.moveUserFrom).length} login(s) move to the twin); ` +
    `other real profiles → test account by role (${staffPlan.placeholders.length} placeholder(s) to create); ` +
    `HELD (a day-run made them or a QA-looking name; stay test accounts until --accept-held): ${held.length}`);
  console.log(`  backup (last 24 h, on this machine): ${backup.ok ? `ok — ${backup.runId}` : `MISSING — ${backup.reason}`}`);
  for (const b of identities.blockers) console.log(`  !! ${b}`);
  console.log(`  guard for --apply: ${guard.ok ? "would pass" : `would refuse — ${guard.reasons.join(" ")}`}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  const rollbackOnly = Boolean(args["rollback-only"]);
  if (apply && rollbackOnly) throw new Error("Pass --apply or --rollback-only, not both.");
  const mode = rollbackOnly ? "REHEARSAL (every write rolled back)" : apply ? "APPLY" : "dry run";
  const acceptHeld = parseAcceptHeld(args["accept-held"]);
  const runId = `quarantine-${newRunId()}`;
  console.log(`quarantine-in-place: ${mode} on ${ONE_MAIN_PROJECT_REF}`);

  const sql = await openOneDb(loadOneEnv());
  try {
    const backup = await backupState(sql);
    const identities = await planIdentities(sql, { acceptHeld });
    const state = await readGuardState(sql);
    const unclassifiedTables = identities.blockers.filter((b) => b.startsWith("unclassified"));
    const held = identities.held.length;
    // Printed as --apply would see it; a rehearsal lifts the marker, fee-writes, backup and held guards.
    printPlan(identities, decideQuarantineGuard({ ...state, backup, unclassifiedTables, held }), backup);
    const guard = decideQuarantineGuard({ ...state, backup, unclassifiedTables, held, rollbackOnly });
    const groups = planAll(identities);

    if (!apply && !rollbackOnly) {
      const report = {};
      await sql.begin("read only", async (tx) => {
        for (const [name, entries] of groups) {
          let groupTotal = 0;
          const lines = [];
          for (const entry of entries) {
            const counts = await countOps(tx, entry);
            const total = counts.reduce((n, c) => n + c.n, 0);
            groupTotal += total;
            report[entry.info.table] = counts;
            if (total) lines.push(`    ${entry.info.table} [${TABLES[entry.info.table].bucket}${entry.appendOnly ? ", append-only: rewritten" : ""}]: ${counts.filter((c) => c.n).map((c) => `${c.kind} ${c.column} ${c.n}`).join(", ")}`);
          }
          console.log(`  group ${name}: ${groupTotal} row change(s) in ${entries.length} table(s)`);
          for (const l of lines) console.log(l);
        }
      });
      const total = Object.values(report).flat().reduce((n, c) => n + c.n, 0);
      console.log(`  total row changes: ${total}${total === 0 ? " — nothing to do (a re-run after --apply reports this)" : ""}`);
      const checks = await sql.begin("read only", (tx) => runVerify(tx));
      console.log(`  verify-quarantine.sql today: ${checks.filter((c) => c.failing > 0).length} of ${checks.length} checks fail (expected before the quarantine)`);
      const dir = runDir(runId);
      writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ runId, guard, backup, blockers: identities.blockers, counts: report }, null, 2));
      if (identities.blockers.length) process.exitCode = 1;
      return;
    }

    if (identities.blockers.length) throw new Error(`refusing: ${identities.blockers.join(" | ")}`);
    if (!guard.ok) throw new Error(`refusing: ${guard.reasons.join(" ")}`);

    const [runRow] = await sql`
      insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, note)
      values ('quarantine-in-place', ${rollbackOnly ? "dry_run" : "run"}, ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${runId},
              ${rollbackOnly ? "rehearsal (rolled back)" : `backup ${backup.runId}`})
      returning id`;
    const outcome = { identities: null, tables: {}, errors: [] };
    try {
      if (rollbackOnly) {
        // One transaction; a savepoint per table so every failure is reported.
        try {
          await sql.begin(async (tx) => {
            await prepare(tx);
            outcome.identities = await writeIdentities(tx, identities, runRow.id);
            for (const [, entries] of groups) {
              for (const entry of entries) {
                try {
                  outcome.tables[entry.info.table] = await tx.savepoint((sp) => (entry.appendOnly ? rewriteAppendOnly(sp, entry) : writeTable(sp, entry)));
                } catch (error) {
                  outcome.errors.push(`${entry.info.table}: ${error.message}`);
                }
              }
            }
            // --with-promote: promote-master-data's writes too, so the checks
            // run with the real-teacher profiles already real (critique0 #16).
            if (args["with-promote"]) {
              const { planPromotion, writePromotion } = await import("./promote-master-data.mjs");
              outcome.promote = await writePromotion(tx, await planPromotion(tx, { acceptHeld }));
            }
            // Every table this transaction wrote (triggers included — the
            // shells' audit rows, the twins' fee users): each must be one a
            // backup-one --restore puts back, or the runbook's rollback of
            // step 3 would leave it behind.
            const written = await tx`
              select schemaname || '.' || relname as t from pg_stat_xact_user_tables
              where n_tup_ins + n_tup_upd + n_tup_del > 0 order by 1`;
            outcome.restoreCoverage = restoreCoverage(written.map((r) => r.t), backup.runId ? readBackupManifest(backup.runId) : null);
            // Inside the same transaction, before it rolls back: the §4.6
            // checks, and a re-plan that must find nothing left to do.
            outcome.verify = await runVerify(tx);
            const again = await planIdentities(tx, { acceptHeld });
            let left = again.studentPlan.shells.length + again.classPlan.created.length + again.staffPlan.twins.filter((t) => !identities.staffPlan.twins.some((x) => x.id === t.id)).length;
            for (const [, entries] of planAll(again)) for (const entry of entries) for (const c of await countOps(tx, entry)) left += c.n;
            outcome.rerun = left;
            // --with-reset: reset-test-session's deletes on the quarantined
            // state (append-only TEST rows included), proving the reset still
            // works after step 3. Its verdict is reported with the rest.
            if (args["with-reset"]) {
              const { planReset, runReset } = await import("../reset-test-session.mjs");
              const resetPlan = await planReset(tx);
              const r = { verdict: resetPlan.verdict, students: resetPlan.students, shells: resetPlan.shells, deleted: 0, error: null };
              try {
                const deleted = await tx.savepoint((sp) => runReset(sp, resetPlan, { write: true }));
                r.deleted = [...deleted.values()].reduce((a, b) => a + b, 0);
              } catch (error) {
                r.error = error.message;
              }
              outcome.reset = r;
            }
            throw new Rehearsal(outcome);
          });
        } catch (error) {
          if (!(error instanceof Rehearsal)) throw error;
        }
      } else {
        await sql.begin(async (tx) => {
          await prepare(tx);
          const g = await guardIn(tx, { rollbackOnly: false, backup, blockers: identities.blockers, held });
          if (!g.ok) throw new Error(`refusing: ${g.reasons.join(" ")}`);
          outcome.identities = await writeIdentities(tx, identities, runRow.id);
        });
        for (const [name, entries] of groups) {
          if (!entries.length) continue;
          await sql.begin(async (tx) => {
            await prepare(tx);
            const g = await guardIn(tx, { rollbackOnly: false, backup, blockers: identities.blockers, held });
            if (!g.ok) throw new Error(`refusing at group ${name}: ${g.reasons.join(" ")}`);
            for (const entry of entries) {
              outcome.tables[entry.info.table] = await tx.savepoint((sp) => (entry.appendOnly ? rewriteAppendOnly(sp, entry) : writeTable(sp, entry)));
            }
          });
          console.log(`  group ${name}: committed`);
        }
      }
    } catch (error) {
      await sql`update vppsone.migration_runs set status = 'failed', finished_at = now(), note = ${String(error.message).slice(0, 900)} where id = ${runRow.id}`;
      throw error;
    }

    if (!rollbackOnly) outcome.verify = await sql.begin("read only", (tx) => runVerify(tx));
    const failedChecks = (outcome.verify ?? []).filter((c) => c.failing > 0 && !(rollbackOnly && NEEDS_CONVERT.has(c.check_name)));
    const changed = Object.values(outcome.tables).flat().reduce((n, c) => n + c.n, 0);
    const resetFailed = Boolean(outcome.reset && (outcome.reset.error || !outcome.reset.verdict.ok));
    const ok = !outcome.errors.length && !failedChecks.length && (outcome.rerun ?? 0) === 0 && !(outcome.restoreCoverage?.missed.length) && !resetFailed;
    await sql`
      update vppsone.migration_runs set status = ${ok ? "succeeded" : "failed"}, finished_at = now(),
        summary = ${sql.json({
          identities: outcome.identities,
          changed,
          tables: Object.fromEntries(Object.entries(outcome.tables).map(([t, c]) => [t, c.reduce((n, x) => n + x.n, 0)])),
          errors: outcome.errors.length,
          failed_checks: failedChecks.map((c) => c.check_name),
          rerun_changes: outcome.rerun ?? null,
        })}
      where id = ${runRow.id}`;
    writeFileSync(path.join(runDir(runId), `${rollbackOnly ? "rehearsal" : "apply"}.json`), JSON.stringify(outcome, null, 2));
    const i = outcome.identities ?? {};
    console.log(`  identities: ${i.classes ?? 0} TEST class(es), ${i.shells ?? 0} shell(s), ${i.twins ?? 0} twin(s), ${i.placeholders ?? 0} placeholder(s), ${i.logins ?? 0} login(s) moved, ${i.smokeSeats ?? 0} smoke seat(s) re-pointed, ${i.idMap ?? 0} id-map row(s)`);
    console.log(`  rows changed: ${changed} in ${Object.keys(outcome.tables).length} table(s)`);
    for (const e of outcome.errors) console.log(`  !! ${e}`);
    const checks = outcome.verify ?? [];
    console.log(`  verify-quarantine.sql: ${checks.length - checks.filter((c) => c.failing > 0).length} of ${checks.length} checks pass`);
    for (const c of checks.filter((x) => x.failing > 0)) {
      console.log(`  ${rollbackOnly && NEEDS_CONVERT.has(c.check_name) ? "  (expected before step 2)" : "!!"} ${c.check_name}: ${c.failing}`);
    }
    if (outcome.promote) {
      const p = outcome.promote;
      console.log(`  with promote: dropped ${p.dropped}, authors nulled ${p.authorsNulled}, permissions -${p.permsRemoved}/+${p.permsAdded}, profiles promoted ${p.promoted}`);
    }
    if (outcome.rerun !== undefined) console.log(`  a re-run would change: ${outcome.rerun} row(s)`);
    if (outcome.reset) {
      const r = outcome.reset;
      const verdict = r.verdict.ok ? "would pass" : `!! would refuse — ${r.verdict.reasons.join("; ")}`;
      console.log(`  with reset: ${r.error ? `!! FAILED — ${r.error}` : `${r.deleted} TEST row(s) deleted`}; TEST students ${r.students} + ${r.shells} shell(s); reset verdict ${verdict}`);
    }
    if (outcome.restoreCoverage) {
      const c = outcome.restoreCoverage;
      console.log(`  tables written (triggers included): ${c.written.length}; a backup-one --restore of ${c.schemas.join(" + ") || "nothing"} puts them back${c.missed.length ? `; NOT covered: ${c.missed.join(", ")}` : " — all covered"}`);
    }
    console.log(`  ${rollbackOnly ? (ok ? "REHEARSAL PASSED and rolled back" : "REHEARSAL FAILED (rolled back)") : ok ? "QUARANTINED" : "QUARANTINED WITH FAILURES — read the checks above"}; run row ${runRow.id}`);
    if (!rollbackOnly) console.log("  next: node scripts/migrate/promote-master-data.mjs (dry run)");
    if (!ok) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`quarantine-in-place: ${error.message}`);
    process.exitCode = 2;
  });
}
