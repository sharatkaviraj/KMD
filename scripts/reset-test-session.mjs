#!/usr/bin/env node
/**
 * Reset One's own activity in the TEST session — and nothing else (go-live
 * phase H; plan §4.5; critique1 B15).
 *
 *   node scripts/reset-test-session.mjs --session TEST-2026-27            # dry run: what would go
 *   node scripts/reset-test-session.mjs --session TEST-2026-27 --apply    # delete it (one transaction)
 *
 * The session is NAMED, never chosen: there is no default, and the only label
 * accepted is `TEST-2026-27` (lib/quarantine-rules.mjs TEST_SESSION) — not
 * "the test session", not a pattern, not whatever sorts first (rule 3a).
 *
 * What goes: every bucket-B `vppsone` row (lib/quarantine-rules.mjs) labelled
 * TEST-2026-27 — attendance, marks, notes, records, cover, notices, sends,
 * collection, fees-desk requests… — and, first, every row that points at one
 * of them through a foreign key (attendance marks of a TEST register, marks
 * of a TEST assessment, …), children before parents.
 *
 * What stays: the TEST bed itself — TEST classes and students (public), the
 * TEST timetable and teaching assignments, class aliases, class teachers,
 * cover policies, calendar days, enrolments (A / R tables), the TEST-D-
 * shells, the test accounts — and every fee row. Fee-side TEST postings are
 * not touched here (they are the fee module's, and numbered TST).
 *
 * The 2026-08 pitfall: a bulk import once moved 372 real students into TEST.
 * So --apply refuses when the TEST classes hold more than --max-students
 * (default 150; live has 79) — a reset then would sweep real children's
 * activity. It also reports, counts only, the TEST students whose phone is
 * not on the test allowlist (critique1 B15: the 79 live TEST students arrive
 * with real numbers; the owner decides whether to null or allowlist them).
 *
 * Works on production: everything it deletes is TEST-labelled (D-346: QA
 * tooling is confined to the TEST session, not banned).
 */

import process from "node:process";

import { isMain, loadOneEnv, parseArgs } from "./migrate/lib/env.mjs";
import { openOneDb } from "./migrate/lib/one-db.mjs";
import { TABLES, TEST_SESSION } from "./migrate/lib/quarantine-rules.mjs";
import { quoteIdent } from "./migrate/lib/quarantine-sql.mjs";
import { readVppsoneCatalog } from "./migrate/lib/vppsone-catalog.mjs";

/** B tables that are the TEST bed's own setup, not activity: kept by a reset. */
export const RESET_KEEP = new Set(["timetable_versions", "timetable_slots"]);

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const refusal = resetSessionRefusal(args.session);
  if (refusal) throw new Error(refusal);
  const apply = Boolean(args.apply);
  const maxStudents = Number(args["max-students"] ?? 150);
  console.log(`reset-test-session: ${apply ? "APPLY" : "dry run"} — session ${TEST_SESSION}`);

  const sql = await openOneDb(loadOneEnv());
  try {
    const catalog = await readVppsoneCatalog(sql);
    const fks = await sql`
      select cc.relname as child, a.attname as column, pc.relname as parent, pa.attname as parent_column
      from pg_constraint con
      join pg_class cc on cc.oid = con.conrelid join pg_class pc on pc.oid = con.confrelid
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
      where con.contype = 'f' and array_length(con.conkey, 1) = 1
        and cc.relnamespace = 'vppsone'::regnamespace and pc.relnamespace = 'vppsone'::regnamespace`;
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
    for (const b of blockers) console.log(`  !! ${b}`);

    const [{ students, off_list: offList }] = await sql.unsafe(`
      select count(*)::int as students,
        count(*) filter (where coalesce(s.primary_phone, s.secondary_phone, s.guardian_phone) is not null
          and right(regexp_replace(coalesce(s.primary_phone, s.secondary_phone, s.guardian_phone), '\\D', '', 'g'), 10)
              not in (select right(regexp_replace(r.phone_e164, '\\D', '', 'g'), 10) from vppsone.message_test_recipients r))::int as off_list
      from public.students s join public.classes c on c.id = s.class_id where c.session_label = $1`, [TEST_SESSION]);
    console.log(`  ${TEST_SESSION} students: ${students} (refuses above ${maxStudents}); with a number not on the test allowlist: ${offList}`);

    const run = async (tx, write) => {
      const counts = new Map();
      for (const step of order) {
        const relation = `vppsone.${quoteIdent(step.table)}`;
        const r = write
          ? await tx.unsafe(`delete from ${relation} where ${step.where}`)
          : await tx.unsafe(`select count(*)::int as n from ${relation} where ${step.where}`);
        counts.set(step.table, (counts.get(step.table) ?? 0) + (write ? r.count : r[0].n));
      }
      return counts;
    };
    if (!apply) {
      const counts = await sql.begin("read only", (tx) => run(tx, false));
      let total = 0;
      for (const [table, n] of counts) if (n) { console.log(`    ${table}: ${n}`); total += n; }
      console.log(`  would delete ${total} row(s) of TEST activity (children first; the TEST bed and every fee row stay)`);
      return;
    }
    if (blockers.length) throw new Error(`refusing: ${blockers.join("; ")}`);
    if (students > maxStudents) {
      throw new Error(`${students} students sit in ${TEST_SESSION} classes (more than ${maxStudents}): real children may have been moved into TEST (the 2026-08 bulk import). Refusing.`);
    }
    const counts = await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '10s'");
      return run(tx, true);
    });
    console.log(`  RESET: ${[...counts.values()].reduce((a, b) => a + b, 0)} row(s) of TEST activity deleted`);
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
