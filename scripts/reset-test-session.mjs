#!/usr/bin/env node
/**
 * Reset One's own activity in the TEST session — and nothing else (go-live
 * phase H; plan §4.5; critique1 B15).
 *
 *   node scripts/reset-test-session.mjs --session TEST-2026-27                    # dry run: what would go, and the verdict
 *   node scripts/reset-test-session.mjs --session TEST-2026-27 --rollback-only    # every delete, then ROLLBACK (rehearsal)
 *   node scripts/reset-test-session.mjs --session TEST-2026-27 --apply            # delete it (one transaction)
 *   node scripts/reset-test-session.mjs --session TEST-2026-27 --null-test-phones [--apply | --rollback-only]
 *
 * The session is NAMED, never chosen: there is no default, and the only label
 * accepted is `TEST-2026-27` (lib/quarantine-rules.mjs TEST_SESSION) — not
 * "the test session", not a pattern, not whatever sorts first (rule 3a).
 *
 * What goes: every bucket-B `vppsone` row (lib/quarantine-rules.mjs) labelled
 * TEST-2026-27 — attendance, marks, notes, records, cover, notices, sends,
 * collection, fees-desk requests… — and, first, every row that points at one
 * of them through a foreign key (attendance marks of a TEST register, marks
 * of a TEST assessment, …), children before parents. A table's BEFORE DELETE
 * guard triggers (the append-only exam_activity, report_card_issues and
 * student_record_history; marks_class_lock) are off for that one DELETE and
 * back on after it, inside the transaction (lib/quarantine-rules.mjs
 * resetStatements) — after the quarantine those tables hold TEST rows too.
 *
 * What stays: the TEST bed itself — TEST classes and students (public), the
 * TEST timetable and teaching assignments, class aliases, class teachers,
 * cover policies, calendar days, enrolments (A / R tables), the TEST-D-
 * shells, the test accounts — and every fee row. Fee-side TEST postings are
 * not touched here (they are the fee module's, and numbered TST).
 *
 * The 2026-08 pitfall: a bulk import once moved 372 real students into TEST.
 * So --apply refuses when the TEST classes hold more than --max-students
 * (default 150; live has 79) students — not counting the quarantine's own
 * TEST-D- shells (~513 after step 3, each in migration_id_map) — since a
 * reset then would sweep real children's activity. The dry run prints the
 * same verdict.
 *
 * --null-test-phones (critique1 B15, runbook after step 4): the first load
 * brings live's TEST students once, with real numbers. This nulls every
 * phone of a student in a TEST-2026-27 class that is not on
 * vppsone.message_test_recipients (shells have none). Same session and
 * student-count guard; `public.students` only, TEST classes only. The
 * owner may instead allowlist the numbers — then this is not run.
 *
 * Works on production: everything it deletes is TEST-labelled (D-346: QA
 * tooling is confined to the TEST session, not banned).
 */

import process from "node:process";

import { isMain, loadOneEnv, parseArgs } from "./migrate/lib/env.mjs";
import { openOneDb } from "./migrate/lib/one-db.mjs";
import { decideReset, resetStatements, TABLES, TEST_SESSION } from "./migrate/lib/quarantine-rules.mjs";
import { quoteIdent } from "./migrate/lib/quarantine-sql.mjs";
import { readVppsoneCatalog } from "./migrate/lib/vppsone-catalog.mjs";

/** B tables that are the TEST bed's own setup, not activity: kept by a reset. */
export const RESET_KEEP = new Set(["timetable_versions", "timetable_slots"]);

/** The phone columns of public.students --null-test-phones clears. */
export const STUDENT_PHONE_COLUMNS = ["primary_phone", "secondary_phone", "guardian_phone", "emergency_contact_phone"];

/** The one label a reset accepts. Pure. */
export function resetSessionRefusal(label) {
  if (label === undefined || label === true || label === "") return `name the session: --session ${TEST_SESSION}`;
  if (label !== TEST_SESSION) return `only ${TEST_SESSION} can be reset (got '${label}')`;
  return null;
}

/**
 * The delete plan: for each root table, every FK child path first. `fks`:
 * catalog foreign keys inside vppsone. Returns [{ table, where }] in delete
 * order (children first). Pure.
 */
/**
 * @param {{ table: string, where: string }[]} roots
 * @param {(table: string) => { children: { table: string, column: string, parentColumn: string }[] }} describe
 * @param {number} [depth]
 * @returns {{ table: string, where: string }[]}
 */
export function resetOrder(roots, describe, depth = 0) {
  const out = [];
  for (const { table, where } of roots) {
    if (depth > 6) throw new Error(`foreign keys nest deeper than 6 under ${table}`);
    const info = describe(table);
    const children = [];
    for (const child of info.children) {
      if (child.table === table) continue;
      children.push({
        table: child.table,
        where: `${quoteIdent(child.column)} in (select ${quoteIdent(child.parentColumn)} from vppsone.${quoteIdent(table)} where ${where})`,
      });
    }
    out.push(...resetOrder(children, describe, depth + 1));
    out.push({ table, where });
  }
  return out;
}

/** The SQL that counts a TEST student who is not a quarantine shell (shells are TEST-D- AND in migration_id_map). */
const NOT_A_SHELL = `not (s.admission_no like 'TEST-D-%' and exists (select 1 from vppsone.migration_id_map m
  where m.source_table = 'public.students' and m.target_id = s.id::text))`;

/** A phone column whose last ten digits are not on the test allowlist. */
export function offListSql(column) {
  const c = `s.${quoteIdent(column)}`;
  return `(${c} is not null and not exists (select 1 from vppsone.message_test_recipients r
    where right(regexp_replace(r.phone_e164, '\\D', '', 'g'), 10) = right(regexp_replace(${c}, '\\D', '', 'g'), 10)))`;
}

/** Everything the reset decides, read in the caller's connection or transaction. */
export async function planReset(sql, { maxStudents = 150 } = {}) {
  const catalog = await readVppsoneCatalog(sql);
  const fks = await sql`
    select cc.relname as child, a.attname as column, pc.relname as parent, pa.attname as parent_column
    from pg_constraint con
    join pg_class cc on cc.oid = con.conrelid join pg_class pc on pc.oid = con.confrelid
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
    where con.contype = 'f' and array_length(con.conkey, 1) = 1
      and cc.relnamespace = 'vppsone'::regnamespace and pc.relnamespace = 'vppsone'::regnamespace`;
  const triggerRows = await sql`
    select c.relname as table, tg.tgname as trigger from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relnamespace = 'vppsone'::regnamespace and not tg.tgisinternal and (tg.tgtype & 8) <> 0 and (tg.tgtype & 2) <> 0
    order by 1, 2`;
  const deleteTriggers = new Map();
  for (const r of triggerRows) deleteTriggers.set(r.table, [...(deleteTriggers.get(r.table) ?? []), r.trigger]);
  const describe = (table) => ({
    children: fks.filter((f) => f.parent === table).map((f) => ({ table: f.child, column: f.column, parentColumn: f.parent_column })),
  });
  const roots = Object.values(catalog)
    .filter((info) => TABLES[info.table]?.bucket === "B" && info.hasSession && !RESET_KEEP.has(info.table))
    .sort((a, b) => a.table.localeCompare(b.table))
    .map((info) => ({ table: info.table, where: `session_label = '${TEST_SESSION}'` }));
  const all = resetOrder(roots, describe);
  // A table a reset keeps (not B, or RESET_KEEP) may point at TEST activity
  // only if no row actually does: those are checked, never deleted.
  const kept = (t) => TABLES[t]?.bucket !== "B" || RESET_KEEP.has(t);
  const order = all.filter((s) => !kept(s.table));
  const blockers = [];
  for (const step of all.filter((s) => kept(s.table))) {
    const [{ n }] = await sql.unsafe(`select count(*)::int as n from vppsone.${quoteIdent(step.table)} where ${step.where}`);
    if (n) blockers.push(`${step.table} (${n} row(s), kept by a reset) points at TEST activity`);
  }
  const [counts] = await sql.unsafe(
    `select count(*) filter (where ${NOT_A_SHELL})::int as students,
            count(*) filter (where not (${NOT_A_SHELL}))::int as shells,
            count(*) filter (where ${NOT_A_SHELL} and (${STUDENT_PHONE_COLUMNS.map(offListSql).join(" or ")}))::int as off_list
     from public.students s join public.classes c on c.id = s.class_id where c.session_label = $1`,
    [TEST_SESSION],
  );
  const verdict = decideReset({ blockers, students: counts.students, shells: counts.shells, maxStudents });
  return { order, deleteTriggers, blockers, students: counts.students, shells: counts.shells, offList: counts.off_list, maxStudents, verdict };
}

/** Count (write false) or delete (write true) every step; returns Map table -> rows. */
export async function runReset(tx, plan, { write }) {
  const counts = new Map();
  for (const step of plan.order) {
    let n;
    if (write) {
      const statements = resetStatements(step, plan.deleteTriggers);
      for (const statement of statements) {
        const r = await tx.unsafe(statement);
        if (statement.startsWith("delete")) n = r.count;
      }
    } else {
      [{ n }] = await tx.unsafe(`select count(*)::int as n from vppsone.${quoteIdent(step.table)} where ${step.where}`);
    }
    counts.set(step.table, (counts.get(step.table) ?? 0) + n);
  }
  return counts;
}

/** --null-test-phones: count (write false) or null (write true) each phone column off the allowlist. */
export async function nullTestPhones(tx, { write }) {
  const out = {};
  for (const column of STUDENT_PHONE_COLUMNS) {
    const where = `s.class_id in (select id from public.classes where session_label = $1) and ${offListSql(column)}`;
    if (write) {
      out[column] = (await tx.unsafe(`update public.students as s set ${quoteIdent(column)} = null where ${where}`, [TEST_SESSION])).count;
    } else {
      [{ n: out[column] }] = await tx.unsafe(`select count(*)::int as n from public.students as s where ${where}`, [TEST_SESSION]);
    }
  }
  return out;
}

class Rehearsal extends Error {
  constructor(result) {
    super("reset rehearsal: rolled back on purpose");
    this.result = result;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const refusal = resetSessionRefusal(args.session);
  if (refusal) throw new Error(refusal);
  const apply = Boolean(args.apply);
  const rollbackOnly = Boolean(args["rollback-only"]);
  if (apply && rollbackOnly) throw new Error("Pass --apply or --rollback-only, not both.");
  const phones = Boolean(args["null-test-phones"]);
  const maxStudents = Number(args["max-students"] ?? 150);
  const mode = rollbackOnly ? "REHEARSAL (rolled back)" : apply ? "APPLY" : "dry run";
  console.log(`reset-test-session: ${mode}${phones ? " — null TEST phones off the allowlist" : ""} — session ${TEST_SESSION}`);

  const sql = await openOneDb(loadOneEnv());
  try {
    const plan = await planReset(sql, { maxStudents });
    for (const b of plan.blockers) console.log(`  !! ${b}`);
    console.log(`  ${TEST_SESSION} students: ${plan.students} (refuses above ${maxStudents}), plus ${plan.shells} TEST-D- shell(s) not counted; with a number not on the test allowlist: ${plan.offList}`);
    console.log(`  verdict for --apply: ${plan.verdict.ok ? "would pass" : `would refuse — ${plan.verdict.reasons.join("; ")}`}`);
    const guardedTables = plan.order.filter((s) => plan.deleteTriggers.has(s.table)).map((s) => s.table);
    if (guardedTables.length) console.log(`  delete-guard triggers switched off per statement for: ${[...new Set(guardedTables)].join(", ")}`);

    if (!apply && !rollbackOnly) {
      if (phones) {
        const counts = await sql.begin("read only", (tx) => nullTestPhones(tx, { write: false }));
        console.log(`  would null: ${Object.entries(counts).map(([c, n]) => `${c} ${n}`).join(", ")}`);
        return;
      }
      const counts = await sql.begin("read only", (tx) => runReset(tx, plan, { write: false }));
      let total = 0;
      for (const [table, n] of counts) if (n) { console.log(`    ${table}: ${n}`); total += n; }
      console.log(`  would delete ${total} row(s) of TEST activity (children first; the TEST bed and every fee row stay)`);
      if (!plan.verdict.ok) process.exitCode = 1;
      return;
    }
    if (!plan.verdict.ok) throw new Error(`refusing: ${plan.verdict.reasons.join("; ")}`);

    const work = async (tx) => {
      await tx.unsafe("set local lock_timeout = '10s'");
      // Re-read inside the transaction that writes: the verdict must hold here.
      const again = await planReset(tx, { maxStudents });
      if (!again.verdict.ok) throw new Error(`refusing: ${again.verdict.reasons.join("; ")}`);
      const result = phones ? await nullTestPhones(tx, { write: true }) : await runReset(tx, again, { write: true });
      if (rollbackOnly) throw new Rehearsal(result);
      return result;
    };
    let result;
    try {
      result = await sql.begin(work);
    } catch (error) {
      if (!(error instanceof Rehearsal)) throw error;
      result = error.result;
    }
    const total = result instanceof Map ? [...result.values()].reduce((a, b) => a + b, 0) : Object.values(result).reduce((a, b) => a + b, 0);
    if (phones) console.log(`  ${rollbackOnly ? "REHEARSAL: would null" : "NULLED"}: ${Object.entries(result).map(([c, n]) => `${c} ${n}`).join(", ")}`);
    else {
      for (const [table, n] of result) if (n) console.log(`    ${table}: ${n}`);
      console.log(`  ${rollbackOnly ? "REHEARSAL PASSED (rolled back)" : "RESET"}: ${total} row(s) of TEST activity ${rollbackOnly ? "would be " : ""}deleted`);
    }
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`reset-test-session: ${error.message}`);
    process.exitCode = 2;
  });
}
