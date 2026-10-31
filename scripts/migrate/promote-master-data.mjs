#!/usr/bin/env node
/**
 * Promote One's real master data (bucket A) for the real 2026-27, in place
 * (go-live phase H; runbook step 3; plan §4.2; critique0 #20; critique1 A4).
 *
 *   node scripts/migrate/promote-master-data.mjs                   # dry run: the owner's sign-off list (counts)
 *   node scripts/migrate/promote-master-data.mjs --rollback-only   # every write, then the checks, then ROLLBACK
 *   node scripts/migrate/promote-master-data.mjs --apply           # for real, then the timetable re-seed
 *
 * Runs AFTER quarantine-in-place (every TEST row already points at test
 * data). On the real session's rows of the A tables (lib/quarantine-rules.mjs):
 *
 *  - role_permissions are reset to the migration seed (the base map in
 *    20261004031630 lines 47-155 plus every *_role_permissions.sql — the
 *    reading tests/scoped-reads.test.ts pins to permissions.ts), never dev's;
 *  - a row ABOUT a QA / smoke / day-run profile (class teacher, cover policy,
 *    staff scope of a test account that is not a real-teacher candidate), a
 *    row the QA fixture inserted (vppsone.qa_undo), and a row on a class with
 *    no live partner (the 20th dev class) are DROPPED;
 *  - a row merely WRITTEN by such a profile or a @qa.vpps.local login keeps
 *    its content and loses the author (nullable author columns set null);
 *  - QA fixture record fields (collection_fields key 'qa_%') are switched off
 *    (records still point at them, so they are not deleted);
 *  - the real-teacher candidates become real profiles: is_test_account false,
 *    no login (user_id null — their QA / smoke login already moved to a test
 *    twin), no phone, no WhatsApp opt-in. The real staff sign in again;
 *  - promoted text is scanned for 'qa.vpps.local', 'vercel.app' and '99999'
 *    (counts per column; the owner reviews them, nothing is rewritten);
 *  - then the real timetable is re-seeded from
 *    tests/fixtures/timetable-2026-27.csv by `seed-timetable.mjs
 *    --production-promote` (the dev versions went to TEST in the quarantine).
 *
 * --apply refuses unless the marker is 'production', fee_writes_enabled is
 * 'false', a quarantine-in-place run succeeded, no cutover row exists, the
 * live classes could be read, and no TEST row points at a candidate.
 * The sign-off list with the candidates' short and display names goes ONLY
 * to %USERPROFILE%\.vppsone-migration\promote-<run>\ (never the terminal or
 * the repo). Undo: backup-one --restore <step 1 run> (runbook step 3).
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";
import { isMain, loadOneEnv, newRunId, parseArgs, repoRoot, runDir } from "./lib/env.mjs";
import { readGuardState } from "./lib/guards.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import {
  classesWithoutLivePartner,
  permissionDiff,
  PROMOTE_SUBJECT_STAFF,
  PROMOTE_TEXT_FLAGS,
  promoteCandidates,
  rolePermissionSeed,
  TABLES,
} from "./lib/quarantine-rules.mjs";
import { quoteIdent, uuidArray } from "./lib/quarantine-sql.mjs";
import { fixtureTeacherShortNames, readClasses, readLiveClasses, readProfiles } from "./lib/quarantine-state.mjs";
import { readRealSession } from "./lib/real-session.mjs";
import { readVppsoneCatalog } from "./lib/vppsone-catalog.mjs";

const rel = (table) => `vppsone.${quoteIdent(table)}`;

/** The A tables whose real rows are promoted (role_permissions and staff_profiles have their own steps). */
function promotedTables(catalog) {
  return Object.values(catalog)
    .filter((info) => TABLES[info.table]?.bucket === "A" && !["role_permissions", "staff_profiles"].includes(info.table))
    .sort((a, b) => a.table.localeCompare(b.table));
}

/** Everything the promotion decides, read in the caller's transaction. */
export async function planPromotion(tx) {
  const catalog = await readVppsoneCatalog(tx);
  const session = await readRealSession(tx);
  const [profiles, classes, shortNames, live] = await Promise.all([readProfiles(tx), readClasses(tx), fixtureTeacherShortNames(), readLiveClasses()]);
  const candidates = promoteCandidates(profiles, shortNames);
  const candidateIds = new Set(candidates.map((p) => p.id));
  // QA / smoke / day-run identities: every test account that is not a candidate (twins and placeholders included).
  const qaProfiles = profiles.filter((p) => p.is_test_account && !candidateIds.has(p.id)).map((p) => p.id);
  const qaUsers = (await tx`select id::text from auth.users where lower(email) like '%@qa.vpps.local'`).map((r) => r.id);
  const qaInserted = await tx`select table_name, key ->> 'id' as id from vppsone.qa_undo where action = 'insert' and key ? 'id'`;
  const extraClasses = live.classes ? classesWithoutLivePartner(classes, live.classes, session).map((c) => c.id) : null;

  const tables = [];
  for (const info of promotedTables(catalog)) {
    const real = info.hasSession ? `t.session_label = '${session.replace(/'/g, "''")}'` : "true";
    const [{ n: rows }] = await tx.unsafe(`select count(*)::int as n from ${rel(info.table)} as t where ${real}`);
    const drops = [];
    const subject = PROMOTE_SUBJECT_STAFF[info.table];
    if (subject && qaProfiles.length) drops.push({ why: "about a QA / smoke / day-run profile", where: `t.${quoteIdent(subject)} = any('${uuidArray(qaProfiles)}'::uuid[])` });
    const fixtureIds = qaInserted.filter((r) => r.table_name === `vppsone.${info.table}`).map((r) => r.id);
    if (fixtureIds.length && info.columnNames.has("id")) drops.push({ why: "inserted by the QA fixture", where: `t.id::text = any('{${fixtureIds.join(",")}}'::text[])` });
    if (extraClasses?.length && info.classCols.length) drops.push({ why: "on a class with no live partner", where: `t.class_id = any('${uuidArray(extraClasses)}'::uuid[])` });
    const dropWhere = drops.length ? `(${real}) and (${drops.map((d) => `(${d.where})`).join(" or ")})` : null;
    const dropCounts = [];
    for (const d of drops) {
      const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${rel(info.table)} as t where (${real}) and ${d.where}`);
      if (n) dropCounts.push({ why: d.why, n });
    }
    // Authors: every other staff / auth reference to a QA identity.
    const authors = [];
    const authorCols = [
      ...info.staffCols.filter((c) => c !== subject).map((c) => ({ c, ids: qaProfiles })),
      ...info.authCols.map((c) => ({ c, ids: qaUsers })),
    ];
    for (const { c, ids } of authorCols) {
      if (!ids.length) continue;
      const where = `(${real}) and t.${quoteIdent(c)} = any('${uuidArray(ids)}'::uuid[])${dropWhere ? ` and not (${dropWhere})` : ""}`;
      const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${rel(info.table)} as t where ${where}`);
      if (n) authors.push({ column: c, n, nullable: !info.notNull.has(c), where });
    }
    // Text flags (critique0 #20), counted per column, never shown.
    const flags = [];
    for (const col of info.columns.filter((c) => /^(text|character varying|jsonb|json|text\[\])/.test(c.type))) {
      for (const f of PROMOTE_TEXT_FLAGS) {
        const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${rel(info.table)} as t where (${real}) and t.${quoteIdent(col.name)}::text ~* '${f.pattern}'`);
        if (n) flags.push({ column: col.name, flag: f.name, n });
      }
    }
    tables.push({ table: info.table, triggers: info.triggers, rows, dropWhere, dropCounts, authors, flags });
  }

  const seed = rolePermissionSeed(
    readdirSync(path.join(repoRoot, "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((name) => ({ name, text: readFileSync(path.join(repoRoot, "supabase", "migrations", name), "utf8") })),
  );
  const current = (await tx`select role::text, permission from vppsone.role_permissions`).map((r) => `${r.role} ${r.permission}`);
  const perms = permissionDiff(current, seed);

  // A TEST row must never point at a profile about to become real (critique0 #16).
  let testRefsToCandidates = 0;
  if (candidates.length) {
    for (const info of Object.values(catalog)) {
      if (!info.staffCols.length || ["staff_profiles"].includes(info.table)) continue;
      const bucket = TABLES[info.table]?.bucket;
      const scope = bucket === "B" ? "true" : (bucket === "A" || bucket === "R") && info.hasSession ? "vppsone.is_test_session_label(t.session_label)" : null;
      if (!scope) continue;
      for (const c of info.staffCols) {
        const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${rel(info.table)} as t where (${scope}) and t.${quoteIdent(c)} = any($1::uuid[])`, [uuidArray([...candidateIds])]);
        testRefsToCandidates += n;
      }
    }
  }
  const qaFields = await tx`select count(*)::int as n from vppsone.collection_fields where key like 'qa\\_%' and is_active`;

  // The re-seed: does every timetable teacher and class resolve to a real profile and a real class label?
  const aliases = (await tx`select lower(timetable_label) as l from vppsone.class_aliases where session_label = ${session}`).map((r) => r.l);
  const { parseTimetable } = await import("../../src/modules/timetable/domain/parse-timetable.ts");
  const parsed = parseTimetable(readFileSync(path.join(repoRoot, "tests", "fixtures", "timetable-2026-27.csv"), "utf8"));
  const candidateShorts = new Set(candidates.map((p) => p.short_name.toLowerCase()));
  const reseed = {
    teachers: shortNames.length,
    teachersResolved: shortNames.filter((s) => candidateShorts.has(s.toLowerCase())).length,
    classes: parsed.classNames.length,
    classesResolved: parsed.classNames.filter((c) => aliases.includes(c.toLowerCase())).length,
  };

  return { session, candidates, qaProfiles, tables, perms, testRefsToCandidates, qaFields: qaFields[0].n, live, extraClasses, reseed };
}

export async function writePromotion(tx, plan) {
  const done = { dropped: 0, authorsNulled: 0, permsRemoved: 0, permsAdded: 0, qaFieldsOff: 0, promoted: 0 };
  for (const p of plan.perms.remove) {
    const [role, permission] = p.split(" ");
    done.permsRemoved += (await tx`delete from vppsone.role_permissions where role = ${role} and permission = ${permission}`).count;
  }
  for (const p of plan.perms.add) {
    const [role, permission] = p.split(" ");
    done.permsAdded += (await tx`insert into vppsone.role_permissions (role, permission) values (${role}, ${permission}) on conflict do nothing`).count;
  }
  for (const t of plan.tables) {
    if (!t.dropWhere && !t.authors.some((a) => a.nullable)) continue;
    // The table's named triggers off for these statements only (an approved
    // scheme refuses any edit — report_schemes_stay_approved — and losing a
    // QA approver is not an edit of the scheme).
    for (const trigger of t.triggers) await tx.unsafe(`alter table ${rel(t.table)} disable trigger ${quoteIdent(trigger)}`);
    for (const a of t.authors) {
      if (a.nullable) done.authorsNulled += (await tx.unsafe(`update ${rel(t.table)} as t set ${quoteIdent(a.column)} = null where ${a.where}`)).count;
    }
    if (t.dropWhere) done.dropped += (await tx.unsafe(`delete from ${rel(t.table)} as t where ${t.dropWhere}`)).count;
    for (const trigger of t.triggers) await tx.unsafe(`alter table ${rel(t.table)} enable trigger ${quoteIdent(trigger)}`);
  }
  done.qaFieldsOff = (await tx`update vppsone.collection_fields set is_active = false where key like 'qa\\_%' and is_active`).count;
  if (plan.candidates.length) {
    const ids = plan.candidates.map((p) => p.id);
    done.promoted = (
      await tx`
        update vppsone.staff_profiles set is_test_account = false, user_id = null, phone = null, whatsapp_phone = null,
          whatsapp_opt_in_at = null, whatsapp_opt_in_source = null, whatsapp_opt_in_recorded_by = null, whatsapp_opt_out_at = null
        where id = any(${ids}::uuid[])`
    ).count;
  }
  return done;
}

function printPlan(plan) {
  console.log(`  real session: ${plan.session}; live classes: ${plan.live.classes ? `${plan.live.classes.length} read (sealed reader)` : `UNAVAILABLE — ${plan.live.error}`}; classes with no live partner: ${plan.extraClasses?.length ?? "unknown"}`);
  console.log(`  role_permissions vs the migration seed: ${plan.perms.remove.length} to remove, ${plan.perms.add.length} to add`);
  for (const t of plan.tables) {
    const parts = [`${t.rows} real row(s)`];
    for (const d of t.dropCounts) parts.push(`drop ${d.n} (${d.why})`);
    for (const a of t.authors) parts.push(`author ${a.column} → null ${a.n}${a.nullable ? "" : " (NOT NULL: kept, listed)"}`);
    for (const f of t.flags) parts.push(`text '${f.flag}' in ${f.column}: ${f.n}`);
    if (t.rows || parts.length > 1) console.log(`    ${t.table}: ${parts.join("; ")}`);
  }
  console.log(`  QA fixture record fields still active (switched off): ${plan.qaFields}`);
  console.log(`  real-teacher profiles to promote: ${plan.candidates.length} (sign-off list in the private folder); TEST rows still pointing at them: ${plan.testRefsToCandidates}`);
  console.log(`  timetable re-seed (fixture): teachers resolved ${plan.reseed.teachersResolved}/${plan.reseed.teachers}, classes resolved ${plan.reseed.classesResolved}/${plan.reseed.classes}`);
}

class Rehearsal extends Error {}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  const rollbackOnly = Boolean(args["rollback-only"]);
  if (apply && rollbackOnly) throw new Error("Pass --apply or --rollback-only, not both.");
  const runId = `promote-${newRunId()}`;
  console.log(`promote-master-data: ${rollbackOnly ? "REHEARSAL (every write rolled back)" : apply ? "APPLY" : "dry run"} on ${ONE_MAIN_PROJECT_REF}`);
  const sql = await openOneDb(loadOneEnv());
  try {
    const plan = await sql.begin("read only", (tx) => planPromotion(tx));
    printPlan(plan);
    const dir = runDir(runId);
    // The sign-off list: names stay in the private folder (I-5), never the terminal.
    writeFileSync(
      path.join(dir, "sign-off.json"),
      JSON.stringify({ runId, session: plan.session, candidates: plan.candidates.map((p) => ({ short_name: p.short_name, display_name: p.display_name, role: p.role })), tables: plan.tables.map((t) => ({ table: t.table, rows: t.rows, drops: t.dropCounts, authors: t.authors.map((a) => ({ column: a.column, n: a.n })), flags: t.flags })), perms: plan.perms, reseed: plan.reseed }, null, 2),
    );
    console.log(`  sign-off list: %USERPROFILE%\\.vppsone-migration\\${runId}\\sign-off.json`);

    const state = await readGuardState(sql);
    const [{ quarantined }] = await sql`select exists (select 1 from vppsone.migration_runs where script = 'quarantine-in-place' and kind = 'run' and status = 'succeeded') as quarantined`;
    const reasons = [];
    if (!rollbackOnly && state.environment !== "production") reasons.push(`marker is '${state.environment}', not 'production'`);
    if (!rollbackOnly && String(state.feeWritesEnabled ?? "") !== "false") reasons.push("fee_writes_enabled is not 'false'");
    if (!rollbackOnly && !quarantined) reasons.push("no succeeded quarantine-in-place run");
    if (state.hasCutover) reasons.push("a cutover row exists");
    if (!plan.live.classes) reasons.push("the live classes could not be read");
    if (!rollbackOnly && plan.testRefsToCandidates) reasons.push(`${plan.testRefsToCandidates} TEST row(s) still point at a candidate (run quarantine-in-place)`);
    if (plan.reseed.teachersResolved < plan.reseed.teachers || plan.reseed.classesResolved < plan.reseed.classes) reasons.push("the timetable re-seed would not resolve every teacher and class");
    console.log(`  guard for --apply: ${reasons.length ? `would refuse — ${reasons.join("; ")}` : "would pass"}`);
    if (!apply && !rollbackOnly) {
      if (reasons.length) process.exitCode = 1;
      return;
    }
    if (reasons.length) throw new Error(`refusing: ${reasons.join("; ")}`);

    let done;
    let checks = null;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("set local lock_timeout = '10s'");
        const again = await planPromotion(tx);
        done = await writePromotion(tx, again);
        if (rollbackOnly) {
          // The quarantine checks with the candidates now real (critique0 #16).
          checks = await tx.unsafe(readFileSync(path.join(repoRoot, "scripts", "migrate", "verify-quarantine.sql"), "utf8"));
          throw new Rehearsal();
        }
        await tx`
          insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, finished_at, status, summary, note)
          values ('promote-master-data', 'run', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${runId}, now(), 'succeeded',
                  ${tx.json({ ...done, session: again.session, reseed: again.reseed })}, 'Bucket A promoted for the real session (phase H). The timetable re-seed follows.')`;
      });
    } catch (error) {
      if (!(error instanceof Rehearsal)) throw error;
    }
    console.log(`  ${rollbackOnly ? "would write" : "wrote"}: dropped ${done.dropped}, authors nulled ${done.authorsNulled}, permissions -${done.permsRemoved}/+${done.permsAdded}, QA fields off ${done.qaFieldsOff}, profiles promoted ${done.promoted}`);
    if (rollbackOnly) {
      const failing = (checks ?? []).filter((c) => c.failing > 0 && !["marker is not production", "fee_writes_enabled is not false"].includes(c.check_name));
      console.log(`  verify-quarantine.sql with the candidates real: ${failing.length ? failing.map((c) => `${c.check_name} ${c.failing}`).join("; ") : "every data check passes"}`);
      console.log(`  ${failing.length ? "REHEARSAL FAILED" : "REHEARSAL PASSED"} (rolled back; the timetable re-seed is not rehearsed here — it runs only on production)`);
      if (failing.length) process.exitCode = 1;
      return;
    }
    console.log("  re-seeding the real timetable: node scripts/seed-timetable.mjs --production-promote");
    const seeded = spawnSync(process.execPath, ["--import", "./scripts/alias-hook.mjs", "scripts/seed-timetable.mjs", "--production-promote"], { cwd: repoRoot, stdio: "inherit" });
    if (seeded.status !== 0) {
      console.error("  !! the timetable re-seed failed; the promotion itself is committed. Fix and run: npm run seed:timetable -- --production-promote");
      process.exitCode = 1;
      return;
    }
    console.log("  PROMOTED. Next: psql -f scripts/migrate/verify-quarantine.sql; the owner signs the list.");
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`promote-master-data: ${error.message}`);
    process.exitCode = 2;
  });
}
