/**
 * The load plan: what a mirror load would insert, update and delete, decided
 * once and used by both `--dry-run` and `--apply` (plan §2.3). Pure.
 *
 *   planLoad({ meta, source, target, idMap, oneOwned, firstLoad, feesRef })
 *
 *  - source / target: Map table -> rows (Postgres JSON on both sides).
 *  - meta: One's catalog (lib/catalog.mjs): tables[t] = { columns, pk,
 *    uniques }, fks = [{ name, child, childCols, parent, parentSchema,
 *    parentCols, onDelete, nullable }].
 *
 * Per table, a source row is:
 *   dropped      by a terminal rule (never imported)
 *   rekeyed      named in migration_id_map from the fees project (skipped)
 *   owned        a One-owned app_settings row (never touched)
 *   test         a TEST-session row on either side, unless firstLoad (T1)
 *   protected    its pk is a protected target row (counted as a conflict)
 *   insert / update / unchanged
 * and a target row missing from the source is deleted unless it is protected,
 * test, owned, or still referenced by a row that stays (a blocked delete).
 *
 * Then, over the final state: predicted foreign-key orphans per constraint,
 * duplicate values per unique constraint, the insert order (parents first)
 * and the foreign-key columns that must be written in a second pass because
 * they close a cycle (e.g. installments <-> student_carry_forward_balances).
 */

import {
  applyOwnedCells,
  classifyTestRows,
  importTransform,
  isOwnedRow,
  ownedCellRules,
  protectedRows,
  publicFks,
  rekeyedSourceRows,
  SKIP_TABLES,
} from "./import-rules.mjs";
import { canonical, comparePk, pkKey, project } from "./rows.mjs";

/** Columns compared and written: One's columns that the source also has, minus generated ones. */
export function comparableColumns(tableMeta, sourceRows) {
  const sourceColumns = new Set(sourceRows.length ? Object.keys(sourceRows[0]) : tableMeta.columns.map((c) => c.name));
  return tableMeta.columns.filter((c) => !c.generated && sourceColumns.has(c.name)).map((c) => c.name);
}

/**
 * @param {{ meta: any, source: Map<string, any[]>, target: Map<string, any[]>, idMap?: any[], oneOwned?: any[], firstLoad?: boolean, feesRef?: string }} options
 * @returns {any}
 */
export function planLoad({ meta, source, target, idMap = [], oneOwned = [], firstLoad = false, feesRef }) {
  const loadable = [...source.keys()].filter((t) => meta.tables[t] && !SKIP_TABLES.has(t)).sort();
  const notInOne = [...source.keys()].filter((t) => !meta.tables[t]).sort();
  const skipped = [...source.keys()].filter((t) => SKIP_TABLES.has(t)).sort();
  const cellRules = ownedCellRules(oneOwned);

  // 1. Import transforms on the source.
  const transformed = new Map();
  const transformCounts = {};
  for (const table of loadable) {
    const rows = [];
    const counts = { rewritten: 0, dropped: 0 };
    for (const row of source.get(table)) {
      const result = importTransform(table, row);
      if (result.action === "dropped") counts.dropped += 1;
      else {
        if (result.action === "rewritten") counts.rewritten += 1;
        rows.push(result.row);
      }
    }
    transformed.set(table, rows);
    transformCounts[table] = counts;
  }

  // Target rows for every loadable table (missing = empty).
  const targetRows = new Map(loadable.map((t) => [t, target.get(t) ?? []]));
  // Parents outside the load still count for orphans and protection.
  for (const [t, rows] of target) if (!targetRows.has(t) && meta.tables[t]) targetRows.set(t, rows);

  // 2. Classifications.
  const testSource = classifyTestRows(transformed, meta);
  const testTarget = classifyTestRows(targetRows, meta);
  const protectedTarget = protectedRows(targetRows, meta, idMap);
  const rekeyed = rekeyedSourceRows(idMap, feesRef);

  // 3. Per-table diff.
  const tables = {};
  const finalState = new Map();
  for (const table of loadable) {
    const tableMeta = meta.tables[table];
    const pk = tableMeta.pk;
    const columns = comparableColumns(tableMeta, transformed.get(table));
    const targetByPk = new Map(targetRows.get(table).map((row) => [pkKey(row, pk), row]));
    const sourceByPk = new Map();
    const plan = {
      table,
      columns,
      insert: [],
      update: [],
      delete: [],
      unchanged: 0,
      // Keys each side contributes to an equality check (reconcile.mjs).
      compared: { source: [], target: [] },
      counts: { ...transformCounts[table], rekeyed: 0, owned: 0, ownedCells: 0, test: 0, protectedConflict: 0, protectedKept: 0, testKept: 0, ownedKept: 0, blockedDelete: 0 },
    };
    const tSrc = testSource.get(table) ?? new Set();
    const tTgt = testTarget.get(table) ?? new Set();
    const prot = protectedTarget.get(table) ?? new Set();
    const rk = rekeyed.get(table) ?? new Set();
    const final = new Map(targetByPk);

    for (const raw of transformed.get(table)) {
      const key = pkKey(raw, pk);
      sourceByPk.set(key, raw);
      if (rk.has(key)) {
        plan.counts.rekeyed += 1;
        continue;
      }
      const targetRow = targetByPk.get(key);
      if (isOwnedRow(table, raw, cellRules) || (targetRow && isOwnedRow(table, targetRow, cellRules))) {
        plan.counts.owned += 1;
        continue;
      }
      if (prot.has(key)) {
        plan.counts.protectedConflict += 1;
        continue;
      }
      if (!firstLoad && (tSrc.has(key) || tTgt.has(key))) {
        plan.counts.test += 1;
        continue;
      }
      const { row, kept } = applyOwnedCells(table, raw, targetRow, cellRules);
      plan.counts.ownedCells += kept;
      plan.compared.source.push(key);
      if (targetRow) plan.compared.target.push(key);
      if (!targetRow) {
        plan.insert.push(key);
        final.set(key, row);
      } else if (canonical(project(row, columns)) !== canonical(project(targetRow, columns))) {
        plan.update.push(key);
        final.set(key, { ...targetRow, ...project(row, columns) });
      } else {
        plan.unchanged += 1;
      }
      sourceByPk.set(key, row);
    }

    for (const [key, row] of targetByPk) {
      if (sourceByPk.has(key)) continue;
      if (prot.has(key)) plan.counts.protectedKept += 1;
      else if (tTgt.has(key)) plan.counts.testKept += 1; // even on a first load: One's own test rows stay
      else if (isOwnedRow(table, row, cellRules)) plan.counts.ownedKept += 1;
      else {
        plan.delete.push(key);
        plan.compared.target.push(key);
        final.delete(key);
      }
    }
    plan.rows = sourceByPk; // the rows to stage (after transforms and owned cells)
    tables[table] = plan;
    finalState.set(table, final);
  }
  for (const [t, rows] of targetRows) {
    if (!finalState.has(t)) finalState.set(t, new Map(rows.map((row) => [pkKey(row, meta.tables[t].pk), row])));
  }

  // 4. Blocked deletes: a row that stays must not lose its parent.
  const blocked = blockReferencedDeletes({ meta, tables, finalState, targetRows });

  // 5. Predicted orphans, external references, unique conflicts.
  const { orphans, external } = predictOrphans({ meta, finalState, loaded: new Set(loadable) });
  const uniqueConflicts = predictUniqueConflicts({ meta, finalState, loaded: loadable });

  // 6. Order and deferred columns.
  const { order, deferred } = loadOrder(meta, loadable);

  for (const plan of Object.values(tables)) {
    plan.insert.sort(comparePk);
    plan.update.sort(comparePk);
    plan.delete.sort(comparePk);
  }

  return { tables, loadable, notInOne, skipped, blocked, orphans, external, uniqueConflicts, order, deferred, testSource, testTarget, protectedTarget };
}

function tupleOf(row, cols) {
  const values = cols.map((c) => row?.[c] ?? null);
  return values.some((v) => v === null) ? null : JSON.stringify(values);
}

export function blockReferencedDeletes({ meta, tables, finalState, targetRows }) {
  const blocked = [];
  for (let changed = true, guard = 0; changed && guard < 20; guard += 1) {
    changed = false;
    for (const fk of publicFks(meta)) {
      const parentPlan = tables[fk.parent];
      if (!parentPlan || parentPlan.delete.length === 0 || !finalState.has(fk.child)) continue;
      const parentPk = meta.tables[fk.parent].pk;
      const parentTarget = new Map((targetRows.get(fk.parent) ?? []).map((row) => [pkKey(row, parentPk), row]));
      const deletedTuples = new Map();
      for (const key of parentPlan.delete) {
        const tuple = tupleOf(parentTarget.get(key), fk.parentCols);
        if (tuple) deletedTuples.set(tuple, key);
      }
      if (deletedTuples.size === 0) continue;
      for (const row of finalState.get(fk.child).values()) {
        const tuple = tupleOf(row, fk.childCols);
        if (!tuple || !deletedTuples.has(tuple)) continue;
        const key = deletedTuples.get(tuple);
        deletedTuples.delete(tuple);
        parentPlan.delete = parentPlan.delete.filter((k) => k !== key);
        parentPlan.counts.blockedDelete += 1;
        finalState.get(fk.parent).set(key, parentTarget.get(key));
        blocked.push({ table: fk.parent, constraint: fk.name });
        changed = true;
      }
    }
  }
  return blocked;
}

export function predictOrphans({ meta, finalState, loaded }) {
  const orphans = [];
  const external = [];
  for (const fk of meta.fks ?? []) {
    if (!loaded.has(fk.child)) continue;
    const childRows = finalState.get(fk.child);
    if (!childRows) continue;
    if (fk.parentSchema !== "public") {
      const values = new Set();
      for (const row of childRows.values()) {
        const tuple = tupleOf(row, fk.childCols);
        if (tuple) values.add(tuple);
      }
      external.push({ constraint: fk.name, child: fk.child, childCols: fk.childCols, parent: `${fk.parentSchema}.${fk.parent}`, parentCols: fk.parentCols, tuples: values });
      continue;
    }
    const parentRows = finalState.get(fk.parent);
    if (!parentRows) {
      orphans.push({ constraint: fk.name, child: fk.child, parent: fk.parent, count: null, note: "parent table not read" });
      continue;
    }
    const parentTuples = new Set();
    for (const row of parentRows.values()) {
      const tuple = tupleOf(row, fk.parentCols);
      if (tuple) parentTuples.add(tuple);
    }
    let count = 0;
    for (const row of childRows.values()) {
      const tuple = tupleOf(row, fk.childCols);
      if (tuple && !parentTuples.has(tuple)) count += 1;
    }
    if (count) orphans.push({ constraint: fk.name, child: fk.child, parent: fk.parent, count });
  }
  return { orphans, external };
}

export function predictUniqueConflicts({ meta, finalState, loaded }) {
  const out = [];
  for (const table of loaded) {
    for (const cols of meta.tables[table].uniques ?? []) {
      const seen = new Set();
      let dupes = 0;
      for (const row of finalState.get(table).values()) {
        const tuple = tupleOf(row, cols);
        if (!tuple) continue;
        if (seen.has(tuple)) dupes += 1;
        else seen.add(tuple);
      }
      if (dupes) out.push({ table, columns: cols, duplicates: dupes });
    }
  }
  return out;
}

/**
 * Parents before children over the FKs among `tables`. A cycle (or a self
 * reference) is broken by deferring a nullable FK: those columns are written
 * NULL with the row and set in a second pass. A cycle with no nullable FK
 * throws.
 */
export function loadOrder(meta, tables) {
  const set = new Set(tables);
  const edges = publicFks(meta).filter((fk) => set.has(fk.child) && set.has(fk.parent));
  const deferred = {};
  const active = [];
  for (const fk of edges) {
    if (fk.child === fk.parent) {
      if (!fk.nullable) throw new Error(`${fk.name}: a NOT NULL self-reference cannot be loaded in one pass.`);
      for (const c of fk.childCols) (deferred[fk.child] ??= new Set()).add(c);
    } else {
      active.push(fk);
    }
  }

  // Kahn; when stuck, defer the first nullable edge inside what is left.
  const order = [];
  const remaining = new Set(tables);
  let live = active.slice();
  while (remaining.size) {
    const ready = [...remaining].filter((t) => !live.some((fk) => fk.child === t && remaining.has(fk.parent))).sort();
    if (ready.length) {
      for (const t of ready) {
        order.push(t);
        remaining.delete(t);
      }
      continue;
    }
    const breakable = live
      .filter((fk) => remaining.has(fk.child) && remaining.has(fk.parent) && fk.nullable)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!breakable) throw new Error(`A foreign-key cycle with no nullable column among: ${[...remaining].join(", ")}.`);
    for (const c of breakable.childCols) (deferred[breakable.child] ??= new Set()).add(c);
    live = live.filter((fk) => fk !== breakable);
  }
  return { order, deferred: Object.fromEntries(Object.entries(deferred).map(([t, s]) => [t, [...s].sort()])) };
}

/** Counts only: what a plan would do, for the terminal and migration_runs.summary. */
export function summarizePlan(plan) {
  const perTable = {};
  const totals = { insert: 0, update: 0, delete: 0, unchanged: 0 };
  for (const [table, p] of Object.entries(plan.tables)) {
    perTable[table] = { insert: p.insert.length, update: p.update.length, delete: p.delete.length, unchanged: p.unchanged, ...p.counts };
    totals.insert += p.insert.length;
    totals.update += p.update.length;
    totals.delete += p.delete.length;
    totals.unchanged += p.unchanged;
  }
  return {
    totals,
    perTable,
    notInOne: plan.notInOne,
    skipped: plan.skipped,
    blockedDeletes: plan.blocked.length,
    predictedOrphans: plan.orphans,
    uniqueConflicts: plan.uniqueConflicts,
    deferred: plan.deferred,
  };
}
