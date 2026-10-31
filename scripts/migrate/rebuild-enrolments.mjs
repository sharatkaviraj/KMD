#!/usr/bin/env node
/**
 * Rebuild the real session's `vppsone.enrolments` from the loaded
 * `public.students`, and report the classes with no current class teacher
 * (go-live phase H; runbook C8; critique1 B21).
 *
 *   node scripts/migrate/rebuild-enrolments.mjs           # dry run: counts by status, classes without a class teacher
 *   node scripts/migrate/rebuild-enrolments.mjs --apply   # write (one transaction)
 *
 * The rule (lib/quarantine-rules.mjs planEnrolments): every student of the
 * session's classes who is on roll (`active`) is enrolled in their class;
 * every student who `left` has a `left` enrolment with left_on; nobody else.
 * So the count equals on roll + left. Existing rows keep their id and roll
 * number and are corrected in place; rows whose student is no longer in the
 * session are deleted. The session is the app's own choice
 * (pickSessionLabel, rule 3a) and never a TEST session; TEST-2026-27
 * enrolments are not touched.
 *
 * Mirror mode keeps admitting students in the fees app, so this runs after
 * the final load (C1), not before.
 *
 * --apply refuses (decideEnrolmentRebuild) unless the marker is 'production',
 * fee_writes_enabled is 'false', and a first load or a cutover row exists —
 * before that public.students is the masked replica. Counts only.
 */

import process from "node:process";

import { ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";
import { isMain, loadOneEnv, newRunId, parseArgs } from "./lib/env.mjs";
import { readGuardState } from "./lib/guards.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { decideEnrolmentRebuild, planEnrolments } from "./lib/quarantine-rules.mjs";
import { readRealSession } from "./lib/real-session.mjs";

async function readPlan(tx) {
  const session = await readRealSession(tx);
  const students = await tx`
    select s.id::text, s.class_id::text, s.status::text, s.left_on::text, s.joined_on::text
    from public.students s join public.classes c on c.id = s.class_id
    where c.session_label = ${session}`;
  const existing = await tx`
    select id::text, student_id::text, class_id::text, status::text, left_on::text
    from vppsone.enrolments where session_label = ${session}`;
  const plan = planEnrolments(students, existing);
  const byStudentStatus = {};
  for (const s of students) byStudentStatus[s.status] = (byStudentStatus[s.status] ?? 0) + 1;
  const byEnrolment = {};
  for (const e of existing) byEnrolment[e.status] = (byEnrolment[e.status] ?? 0) + 1;
  const noClassTeacher = await tx`
    select c.class_name from public.classes c
    where c.session_label = ${session}
      and not exists (
        select 1 from vppsone.class_teachers ct
        where ct.class_id = c.id and ct.session_label = c.session_label
          and (ct.effective_from is null or ct.effective_from <= vppsone.school_today())
          and (ct.effective_to is null or ct.effective_to >= vppsone.school_today()))
    order by c.sort_order, c.class_name`;
  const [{ n: classes }] = await tx`select count(*)::int as n from public.classes where session_label = ${session}`;
  return { session, plan, byStudentStatus, byEnrolment, existing: existing.length, noClassTeacher: noClassTeacher.map((r) => r.class_name), classes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  console.log(`rebuild-enrolments: ${apply ? "APPLY" : "dry run"} on ${ONE_MAIN_PROJECT_REF}`);
  const sql = await openOneDb(loadOneEnv());
  try {
    const r = await sql.begin("read only", (tx) => readPlan(tx));
    const onRoll = r.byStudentStatus.active ?? 0;
    const left = r.byStudentStatus.left ?? 0;
    console.log(`  session ${r.session}: students ${Object.entries(r.byStudentStatus).map(([s, n]) => `${s} ${n}`).join(", ")}; enrolments today ${r.existing} (${Object.entries(r.byEnrolment).map(([s, n]) => `${s} ${n}`).join(", ") || "none"})`);
    console.log(`  target: ${r.plan.total} enrolments = on roll ${onRoll} + left ${left} (${Object.entries(r.plan.byStatus).map(([s, n]) => `${s} ${n}`).join(", ")})`);
    console.log(`  to insert ${r.plan.insert.length}, to correct ${r.plan.update.length}, to delete ${r.plan.remove.length}`);
    console.log(`  classes with no current class teacher: ${r.noClassTeacher.length} of ${r.classes}${r.noClassTeacher.length ? ` (${r.noClassTeacher.join(", ")})` : ""}`);

    const [{ first_loads: firstLoads }] = await sql`
      select count(*)::int as first_loads from vppsone.migration_runs r
      where r.script = 'load-snapshot' and r.kind = 'run' and r.status = 'succeeded' and (r.summary ->> 'firstLoad') = 'true'
        and not exists (select 1 from vppsone.migration_runs u where u.script = 'backup-one-restore' and u.kind = 'rollback'
                        and u.status = 'succeeded' and coalesce(u.summary -> 'undid_runs', '[]'::jsonb) @> to_jsonb(array[r.id::text]))`;
    const state = await readGuardState(sql);
    const guard = decideEnrolmentRebuild({ ...state, firstLoads });
    console.log(`  guard for --apply: ${guard.ok ? "would pass" : `would refuse — ${guard.reasons.join("; ")}`}`);
    const rollbackOnly = Boolean(args["rollback-only"]);
    if (!apply && !rollbackOnly) return;
    // --rollback-only: every write, the count check, then ROLLBACK (lifts the guard; nothing persists).
    if (!rollbackOnly && !guard.ok) throw new Error(`refusing: ${guard.reasons.join("; ")}`);

    const runId = `rebuild-enrolments-${newRunId()}`;
    const ROLLBACK = new Error("rehearsal");
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '10s'");
      await tx.unsafe("lock table vppsone.enrolments in exclusive mode");
      const again = await readPlan(tx);
      const p = again.plan;
      for (const row of p.insert) {
        await tx`
          insert into vppsone.enrolments (student_id, class_id, session_label, status, enrolled_on, left_on)
          values (${row.student_id}, ${row.class_id}, ${again.session}, ${row.status}, ${row.enrolled_on}, ${row.left_on})`;
      }
      for (const row of p.update) {
        await tx`update vppsone.enrolments set class_id = ${row.class_id}, status = ${row.status}, left_on = ${row.left_on} where id = ${row.id}`;
      }
      if (p.remove.length) await tx`delete from vppsone.enrolments where id = any(${p.remove}::uuid[])`;
      const [{ n }] = await tx`select count(*)::int as n from vppsone.enrolments where session_label = ${again.session}`;
      if (n !== p.total) throw new Error(`after the rebuild ${n} enrolments, expected ${p.total}; rolled back`);
      if (rollbackOnly) {
        console.log(`  REHEARSAL: ${n} enrolments after the writes = ${p.total} expected; rolling back`);
        throw ROLLBACK;
      }
      await tx`
        insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, finished_at, status, summary, note)
        values ('rebuild-enrolments', 'run', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${runId}, now(), 'succeeded',
                ${tx.json({ session: again.session, total: p.total, byStatus: p.byStatus, inserted: p.insert.length, corrected: p.update.length, deleted: p.remove.length, noClassTeacher: again.noClassTeacher.length })},
                'Runbook C8: real enrolments rebuilt from public.students (phase H).')`;
    }).catch((error) => {
      if (error !== ROLLBACK) throw error;
    });
    console.log(rollbackOnly ? "  REHEARSAL PASSED (rolled back; nothing changed)" : `  REBUILT; run ${runId}`);
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`rebuild-enrolments: ${error.message}`);
    process.exitCode = 2;
  });
}
