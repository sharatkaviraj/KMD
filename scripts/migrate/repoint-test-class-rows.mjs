#!/usr/bin/env node
/**
 * TEST data hygiene: no TEST-labelled `vppsone` row may point at a real class
 * (go-live phase H, carried from phase C; the owner approved resolving it).
 *
 *   node scripts/migrate/repoint-test-class-rows.mjs                 # dry run: what would move
 *   node scripts/migrate/repoint-test-class-rows.mjs --apply         # move them; the before-state goes in the run row
 *   node scripts/migrate/repoint-test-class-rows.mjs --revert <run>  # put them back from that run row
 *
 * Found on 31 Oct: two `class_teachers` rows labelled TEST-2026-27 (made by
 * the QA fixture on 22 Sep) point at REAL 2026-27 classes, so QA teachers 1
 * and 2 held a real class (`my_class_keys()` matches class id + session).
 * Each is re-pointed at the TEST-2026-27 class with the same (class_name,
 * section, stream_name). A TEST class that already has a current class
 * teacher of the same role keeps it; the moved row is closed (effective_to =
 * yesterday, never before it began) instead of colliding with
 * class_teachers_one_current_per_class.
 *
 * The same rule is part of quarantine-in-place.mjs (lib/quarantine-sql.mjs
 * planTestClassOps), so the quarantine leaves no TEST row on a real class.
 *
 * It touches TEST-labelled rows only — never a real row — so it needs neither
 * the production marker nor a backup: --revert is its undo, from the
 * before-state it records. A real class with no TEST twin is reported, never
 * created here (that is the quarantine's job).
 */

import process from "node:process";

import { ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";
import { isMain, loadOneEnv, newRunId, parseArgs } from "./lib/env.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { planClassMap } from "./lib/quarantine-rules.mjs";
import { countSql, planTestClassOps, quoteIdent, updateSql, whereParams } from "./lib/quarantine-sql.mjs";
import { readClasses } from "./lib/quarantine-state.mjs";
import { readVppsoneCatalog } from "./lib/vppsone-catalog.mjs";

const rel = (table) => `vppsone.${quoteIdent(table)}`;

async function plan(tx) {
  const catalog = await readVppsoneCatalog(tx);
  const classes = await readClasses(tx);
  const { map, created } = planClassMap(classes);
  const createdIds = new Set(created.map((c) => c.id));
  const usable = new Map([...map].filter(([, t]) => !createdIds.has(t)));
  const untwinned = new Map([...map].filter(([, t]) => createdIds.has(t)));
  const entries = [];
  for (const info of Object.values(catalog).sort((a, b) => a.table.localeCompare(b.table))) {
    const ops = planTestClassOps(info, usable);
    if (ops.length) entries.push({ info, ops });
  }
  // TEST rows on a real class that has no TEST twin: reported, not moved.
  const orphaned = [];
  for (const info of Object.values(catalog)) {
    for (const op of planTestClassOps(info, untwinned)) {
      if (op.kind !== "class") continue;
      const [{ n }] = await tx.unsafe(countSql(op, rel(info.table)), whereParams(op));
      if (n) orphaned.push(`${info.table}.${op.column} ${n}`);
    }
  }
  return { entries, orphaned };
}

async function apply(sql, { write }) {
  const runId = `repoint-test-class-${newRunId()}`;
  await sql.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout = '10s'");
    const { entries, orphaned } = await plan(tx);
    const before = [];
    const counts = [];
    for (const { info, ops } of entries) {
      const found = [];
      for (const op of ops) {
        const [{ n }] = await tx.unsafe(countSql(op, rel(info.table)), whereParams(op));
        found.push({ op, n });
      }
      if (!found.some((f) => f.n)) continue;
      if (!info.pk.length) throw new Error(`${info.table} has no primary key to record the before-state by.`);
      // Keyed by the primary key, as text, so the revert writes back exactly what was there.
      const cols = [...info.pk, ...new Set(ops.map((o) => o.column))].map((c) => `t.${quoteIdent(c)}::text as ${quoteIdent(c)}`).join(", ");
      const where = ops.map((o) => `(${o.where})`).join(" or ");
      const params = ops.some((o) => o.where.includes("$2")) ? ops[0].params : ops[0].params.slice(0, 1);
      const rows = await tx.unsafe(`select ${cols} from ${rel(info.table)} as t where ${where}`, params);
      before.push({ table: info.table, pk: info.pk, rows: rows.map((r) => ({ ...r })) });
      for (const { op, n } of found) {
        if (write && n) await tx.unsafe(updateSql(op, rel(info.table)), op.params);
        counts.push({ table: info.table, kind: op.kind, column: op.column, n });
      }
    }
    for (const c of counts) if (c.n) console.log(`  ${c.table}: ${c.kind} ${c.column} ${c.n}`);
    if (!counts.some((c) => c.n)) console.log("  nothing to move: no TEST-labelled row points at a real class that has a TEST twin");
    for (const o of orphaned) console.log(`  !! TEST rows on a real class with no TEST twin (left for quarantine-in-place): ${o}`);
    if (!write) return;
    if (!counts.some((c) => c.n)) return;
    await tx`
      insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, finished_at, status, summary, note)
      values ('repoint-test-class-rows', 'run', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${runId}, now(), 'succeeded',
              ${tx.json({ counts, before })},
              'TEST-labelled rows moved off real classes onto their TEST twins (phase H; owner-approved). Undo: --revert with this row id.')`;
    console.log(`  APPLIED; run ${runId} (the before-state is in its migration_runs row)`);
  });
}

async function revert(sql, runRef) {
  await sql.begin(async (tx) => {
    const [row] = await tx`
      select id, summary from vppsone.migration_runs
      where script = 'repoint-test-class-rows' and kind = 'run' and status = 'succeeded' and (id::text = ${runRef} or snapshot_id = ${runRef})`;
    if (!row) throw new Error(`No repoint-test-class-rows run ${runRef}.`);
    const summary = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary;
    let n = 0;
    for (const { table, pk, rows } of summary.before ?? []) {
      for (const r of rows) {
        const keys = pk.map((c) => r[c]);
        const cols = Object.keys(r).filter((c) => !pk.includes(c));
        const sets = cols.map((c, i) => `${quoteIdent(c)} = $${pk.length + i + 1}`).join(", ");
        const match = pk.map((c, i) => `${quoteIdent(c)}::text = $${i + 1}`).join(" and ");
        const res = await tx.unsafe(`update ${rel(table)} set ${sets} where ${match}`, [...keys, ...cols.map((c) => r[c])]);
        n += res.count;
      }
    }
    await tx`
      insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, finished_at, status, summary, note)
      values ('repoint-test-class-rows', 'rollback', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${String(row.id)}, now(), 'succeeded',
              ${tx.json({ restored: n })}, 'Reverted the TEST class re-point of that run.')`;
    console.log(`  REVERTED: ${n} row(s) put back`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = await openOneDb(loadOneEnv());
  try {
    if (args.revert) {
      if (typeof args.revert !== "string") throw new Error("--revert takes the run id (or migration_runs id).");
      console.log(`repoint-test-class-rows: REVERT ${args.revert}`);
      return await revert(sql, args.revert);
    }
    console.log(`repoint-test-class-rows: ${args.apply ? "APPLY" : "dry run"} on ${ONE_MAIN_PROJECT_REF}`);
    await apply(sql, { write: Boolean(args.apply) });
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`repoint-test-class-rows: ${error.message}`);
    process.exitCode = 2;
  });
}
