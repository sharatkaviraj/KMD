/**
 * The rules that decide what a mirror load may touch (plan §2.3, §2.4;
 * critique0 #2, #3, #7, #18; owner override T1). Pure: no database.
 *
 * Every rule here is used by BOTH load-snapshot.mjs (to decide what to write)
 * and reconcile.mjs (to decide what to compare), so the two can never
 * disagree about what "equal to live" means.
 *
 *  - Tables the mirror never touches on either side (SKIP_TABLES).
 *  - Terminal-state import (TERMINAL_RULES): a fees row that One's own
 *    reconciler, webhook or outbox drain would act on is imported only in a
 *    state those loops ignore, so One never posts a fees payment or re-sends a
 *    fees receipt notice.
 *  - One-owned settings: app_settings keys One decides (never inserted,
 *    updated or deleted by the mirror), and single cells listed in
 *    `vppsone.one_owned_fee_settings` (kept at One's value).
 *  - TEST-session rows (T1): found by session label and followed down every
 *    foreign key. On every run but the first they are not touched on either
 *    side.
 *  - Protected rows: quarantine shells (`students.admission_no LIKE
 *    'TEST-D-%'`), anything named in `vppsone.migration_id_map`, and every row
 *    keyed on those. Never updated or deleted; reconcile excludes and counts
 *    them (critique0 #18).
 */

import { pkKey } from "./rows.mjs";

/** Same definition as vppsone.is_test_session_label() and isTestAcademicSessionLabel(). */
export function isTestSessionLabel(label) {
  return typeof label === "string" && /^(test|uat|demo)-[0-9]{4}-[0-9]{2}$/i.test(label);
}

/**
 * Never loaded and never deleted, on either side:
 *  - backup_runs: each database's own backup history (plan §2.4).
 *  - workbook_materialized_view_refresh_queue: a work queue; the loader
 *    refreshes the matviews itself.
 *  - office_sync_events: realtime nudges for open screens. Copying them would
 *    broadcast fees-side events to One's screens; they carry no money.
 */
export const SKIP_TABLES = new Set(["backup_runs", "workbook_materialized_view_refresh_queue", "office_sync_events"]);

/**
 * Non-terminal rows and what they become. Each target is a value the table's
 * own CHECK constraint allows (read from wtgx on 30 Oct). `rewrite: null`
 * means the table has no terminal state that would be true, so the row is not
 * imported at all.
 *
 *  online_payment_orders     open/pending/paid/review_required -> abandoned.
 *      One's reconcileOpenOrders scans open/superseded/paid; abandoned is
 *      ignored. The fees app stays the owner of that order and posts it in its
 *      own ledger; tail-sync brings the result (critique0 #2c).
 *  online_payment_intents    link_pending/link_created/paid/review_required -> cancelled.
 *  online_payment_events     pending/failed -> ignored (the reconciler re-processes
 *      pending and failed inbox rows).
 *  online_payment_captures   pending/review_required -> NOT imported. The only
 *      terminal value is `applied`, which would claim a receipt that does not
 *      exist; a review_required capture would appear in One's review screen and
 *      could be posted twice (critique0 #2).
 *  notification_outbox       queued/processing/failed -> suppressed
 *      (notification_outbox_claim takes queued, failed and stale processing;
 *      critique0 #3).
 */
export const TERMINAL_RULES = {
  online_payment_orders: {
    column: "status",
    terminal: ["accounted", "superseded", "abandoned", "failed"],
    rewrite: "abandoned",
  },
  online_payment_intents: {
    column: "status",
    terminal: ["accounted", "superseded", "cancelled", "expired", "failed"],
    rewrite: "cancelled",
  },
  online_payment_events: {
    column: "status",
    terminal: ["processed", "ignored"],
    rewrite: "ignored",
  },
  online_payment_captures: {
    column: "application_status",
    terminal: ["applied"],
    rewrite: null,
  },
  notification_outbox: {
    column: "status",
    terminal: ["provider_accepted", "delivered", "suppressed", "uncertain"],
    rewrite: "suppressed",
    clear: ["locked_until"],
  },
};

/**
 * The row as it is imported: `{ row, action }` where action is 'keep',
 * 'rewritten' or 'dropped'. Never mutates the input.
 */
export function importTransform(table, row) {
  const rule = TERMINAL_RULES[table];
  if (!rule) return { row, action: "keep" };
  const value = row?.[rule.column];
  if (rule.terminal.includes(value)) return { row, action: "keep" };
  if (rule.rewrite === null) return { row: null, action: "dropped" };
  const next = { ...row, [rule.column]: rule.rewrite };
  for (const column of rule.clear ?? []) if (column in next) next[column] = null;
  return { row: next, action: "rewritten" };
}

/* --------------------------------------------------------- One-owned */

/** app_settings keys One decides on its own database (brief A2). */
const ONE_OWNED_APP_SETTING_EXACT = new Set([
  "whatsapp_receipt_notice_enabled",
  "whatsapp_reversal_notice_enabled",
  "receipt_suffix_floor",
  "staff_whatsapp_month_cap",
  "fee_writes_enabled",
]);

export function isOneOwnedAppSetting(key) {
  return typeof key === "string" && (key.startsWith("online_payment_") || ONE_OWNED_APP_SETTING_EXACT.has(key));
}

/** How `vppsone.one_owned_fee_settings.row_key` names a row, per table. */
export const ROW_KEY_COLUMN = { app_settings: "key", fee_policy_configs: "academic_session_label" };

/**
 * From the `vppsone.one_owned_fee_settings` rows: { table: [{ rowKeyColumn, rowKey, column }] }.
 * An app_settings `value` cell owns the whole row (handled by isOwnedRow).
 */
export function ownedCellRules(oneOwnedRows = []) {
  const out = {};
  for (const entry of oneOwnedRows) {
    const rowKeyColumn = ROW_KEY_COLUMN[entry.source_table];
    if (!rowKeyColumn) continue;
    (out[entry.source_table] ??= []).push({ rowKeyColumn, rowKey: entry.row_key, column: entry.column_name });
  }
  return out;
}

/** Is this whole row One's, so the mirror neither inserts, updates nor deletes it? */
export function isOwnedRow(table, row, cellRules = {}) {
  if (table !== "app_settings") return false;
  if (isOneOwnedAppSetting(row?.key)) return true;
  return (cellRules.app_settings ?? []).some((rule) => rule.rowKey === row?.key && rule.column === "value");
}

/** The source row with One-owned cells set to the target's values. */
export function applyOwnedCells(table, sourceRow, targetRow, cellRules = {}) {
  const rules = (cellRules[table] ?? []).filter((rule) => !(table === "app_settings" && rule.column === "value"));
  if (!targetRow || rules.length === 0) return { row: sourceRow, kept: 0 };
  let kept = 0;
  let row = sourceRow;
  for (const rule of rules) {
    if (sourceRow?.[rule.rowKeyColumn] === rule.rowKey && sourceRow[rule.column] !== targetRow[rule.column]) {
      row = row === sourceRow ? { ...sourceRow } : row;
      row[rule.column] = targetRow[rule.column];
      kept += 1;
    }
  }
  return { row, kept };
}

/* --------------------------------------------- following foreign keys */

/** Foreign keys between two `public` tables (auth.users parents are not followed). */
export function publicFks(meta) {
  return (meta.fks ?? []).filter((fk) => (fk.parentSchema ?? "public") === "public");
}

/**
 * Grow `seed` (Map table -> Set pk) down every foreign key: a child row whose
 * key points at a marked parent row is marked too. Repeats to a fixed point.
 *
 * rowsByTable: Map table -> rows; meta.tables[t].pk; meta.fks: [{ child,
 * childCols, parent, parentCols }] (public tables only are followed).
 */
export function propagateDown(seed, rowsByTable, meta) {
  const marked = new Map();
  for (const [table, set] of seed) marked.set(table, new Set(set));
  const fks = publicFks(meta).filter((fk) => rowsByTable.has(fk.child) && rowsByTable.has(fk.parent));

  for (let changed = true, guard = 0; changed && guard < 50; guard += 1) {
    changed = false;
    for (const fk of fks) {
      const parentMarked = marked.get(fk.parent);
      if (!parentMarked || parentMarked.size === 0) continue;
      const parentPk = meta.tables[fk.parent]?.pk;
      const childPk = meta.tables[fk.child]?.pk;
      if (!parentPk || !childPk) continue;

      const markedTuples = new Set();
      for (const row of rowsByTable.get(fk.parent)) {
        if (parentMarked.has(pkKey(row, parentPk))) markedTuples.add(JSON.stringify(fk.parentCols.map((c) => row[c] ?? null)));
      }
      if (markedTuples.size === 0) continue;

      const childMarked = marked.get(fk.child) ?? new Set();
      for (const row of rowsByTable.get(fk.child)) {
        const values = fk.childCols.map((c) => row[c] ?? null);
        if (values.some((v) => v === null)) continue;
        if (!markedTuples.has(JSON.stringify(values))) continue;
        const key = pkKey(row, childPk);
        if (!childMarked.has(key)) {
          childMarked.add(key);
          changed = true;
        }
      }
      marked.set(fk.child, childMarked);
    }
  }
  return attachAuditRows(marked, rowsByTable, meta);
}

/**
 * audit_logs has no foreign key: a row names its subject by `table_name` +
 * `record_id`. An audit row about a marked row is marked with it, so One's
 * own audit trail of TEST-session (or protected) activity is never deleted.
 */
export function attachAuditRows(marked, rowsByTable, meta) {
  const audit = rowsByTable.get("audit_logs");
  const auditPk = meta.tables.audit_logs?.pk;
  if (!audit || !auditPk) return marked;
  const out = marked.get("audit_logs") ?? new Set();
  for (const row of audit) {
    const subject = marked.get(row.table_name);
    if (subject && row.record_id != null && subject.has(String(row.record_id))) out.add(pkKey(row, auditPk));
  }
  if (out.size) marked.set("audit_logs", out);
  return marked;
}

const SESSION_COLUMN = /(^|_)session_label$/;

/**
 * TEST-session rows (T1): any row with a *session_label column holding a test
 * label, any app_settings key scoped to a test session (`…:TEST-2026-27`), and
 * everything keyed on those through foreign keys (students in TEST classes,
 * their installments, receipts, payments, waivers, family rows, sends, …).
 */
export function classifyTestRows(rowsByTable, meta) {
  const seed = new Map();
  for (const [table, rows] of rowsByTable) {
    const pk = meta.tables[table]?.pk;
    if (!pk) continue;
    const set = new Set();
    for (const row of rows) {
      const bySession = Object.keys(row).some((column) => SESSION_COLUMN.test(column) && isTestSessionLabel(row[column]));
      const bySettingKey = table === "app_settings" && typeof row.key === "string" && isTestSessionLabel(row.key.split(":").at(-1));
      if (bySession || bySettingKey) set.add(pkKey(row, pk));
    }
    if (set.size) seed.set(table, set);
  }
  return propagateDown(seed, rowsByTable, meta);
}

export const QUARANTINE_SHELL_PREFIX = "TEST-D-";

/**
 * Protected target rows: quarantine shells, rows named in migration_id_map
 * (by target id, single-column primary keys), and everything keyed on them.
 * idMap rows: { source_project, source_table: 'public.x' | 'vppsone.x', source_id, target_id }.
 */
export function protectedRows(targetRowsByTable, meta, idMap = []) {
  const seed = new Map();
  const add = (table, key) => {
    if (!seed.has(table)) seed.set(table, new Set());
    seed.get(table).add(key);
  };
  for (const row of targetRowsByTable.get("students") ?? []) {
    if (typeof row.admission_no === "string" && row.admission_no.startsWith(QUARANTINE_SHELL_PREFIX)) add("students", String(row.id));
  }
  for (const entry of idMap) {
    const [schema, table] = String(entry.source_table).split(".");
    if (schema !== "public" || !targetRowsByTable.has(table)) continue;
    if ((meta.tables[table]?.pk ?? []).length !== 1) continue;
    add(table, String(entry.target_id));
  }
  return propagateDown(seed, targetRowsByTable, meta);
}

/** Source pks that were re-keyed into One (Map table -> Set source pk). */
export function rekeyedSourceRows(idMap = [], feesProjectRef) {
  const out = new Map();
  for (const entry of idMap) {
    if (entry.source_project !== feesProjectRef) continue;
    const [schema, table] = String(entry.source_table).split(".");
    if (schema !== "public") continue;
    if (!out.has(table)) out.set(table, new Set());
    out.get(table).add(String(entry.source_id));
  }
  return out;
}
