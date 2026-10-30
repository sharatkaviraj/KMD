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
 * "Ignored" is checked against the reconcilers' ACTUAL filters (ported from
 * fees orders.ts reconcileOpenOrders and service.ts reconcileOnlinePayments;
 * RECONCILER_FILTERS below, pinned by a test that runs them over imported
 * rows), not against this file's own list of terminal states:
 *
 *  online_payment_orders     open/pending/paid/review_required/superseded -> abandoned.
 *      reconcileOpenOrders fails `pending` orders older than 10 minutes and
 *      re-checks open/superseded/paid orders created in the last 24 hours at
 *      Razorpay — so `superseded` is NOT safe to import as it is. The fees app
 *      stays the owner of that order and posts it in its own ledger;
 *      tail-sync brings the result (critique0 #2c).
 *  online_payment_intents    link_pending/link_created/paid/review_required -> cancelled,
 *      AND every intent that is not `accounted` gets `provider_cancelled_at`
 *      (its own updated_at, else created_at — deterministic, so a reload and
 *      reconcile see the same value). The intent reconciler picks up
 *      link_pending/link_created, and superseded/expired/cancelled/failed
 *      whose provider_cancelled_at is null — it would then record their
 *      captures and cancel a fees-owned Razorpay link.
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
    terminal: ["accounted", "abandoned", "failed"],
    rewrite: "abandoned",
  },
  online_payment_intents: {
    column: "status",
    terminal: ["accounted", "superseded", "cancelled", "expired", "failed"],
    rewrite: "cancelled",
    // Closed for the reconciler too: provider_cancelled_at set on every
    // non-accounted intent that lacks it.
    stamp: { column: "provider_cancelled_at", unlessStatus: ["accounted"], from: ["updated_at", "created_at"] },
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
  let next = row;
  if (!rule.terminal.includes(value)) {
    if (rule.rewrite === null) return { row: null, action: "dropped" };
    next = { ...row, [rule.column]: rule.rewrite };
    for (const column of rule.clear ?? []) if (column in next) next[column] = null;
  }
  const stamp = rule.stamp;
  if (stamp && !stamp.unlessStatus.includes(next?.[rule.column]) && (next?.[stamp.column] ?? null) === null) {
    const at = stamp.from.map((c) => next?.[c]).find((v) => v !== null && v !== undefined) ?? "1970-01-01T00:00:00+00:00";
    next = next === row ? { ...row } : next;
    next[stamp.column] = at;
  }
  return { row: next, action: next === row ? "keep" : "rewritten" };
}

/**
 * The fees reconcilers' own selection filters, as One will port them
 * (fees src/modules/payments/data/online/orders.ts reconcileOpenOrders and
 * service.ts reconcileOnlinePayments, main 8a0cd47c). An imported row must
 * match none of them. `now` and created_at are ignored on purpose: an import
 * can land within 24 hours of the row's creation. Pure.
 */
/** @type {Record<string, Array<(row: any) => boolean>>} */
export const RECONCILER_FILTERS = {
  online_payment_orders: [
    // .eq("status","pending").lt("created_at", now-10min) -> online_payment_order_failed
    (row) => row.status === "pending",
    // .in("status",["open","superseded","paid"]).gte("created_at", now-24h)
    (row) => ["open", "superseded", "paid"].includes(row.status),
  ],
  online_payment_intents: [
    // status.in.(link_pending,link_created),
    (row) => ["link_pending", "link_created"].includes(row.status),
    // and(status.in.(superseded,expired,cancelled,failed),provider_cancelled_at.is.null)
    (row) => ["superseded", "expired", "cancelled", "failed"].includes(row.status) && (row.provider_cancelled_at ?? null) === null,
  ],
  online_payment_events: [
    // the inbox drain: status pending/failed, attempts < 12
    (row) => ["pending", "failed"].includes(row.status),
  ],
  online_payment_captures: [(row) => ["pending", "review_required"].includes(row.application_status)],
  notification_outbox: [(row) => ["queued", "processing", "failed"].includes(row.status)],
};

/** Would any of One's ported reconcilers pick this imported row up? Pure. */
export function reconcilerWouldPickUp(table, row) {
  return (RECONCILER_FILTERS[table] ?? []).some((filter) => row && filter(row));
}

/* ------------------------------------------------- tables not in One */

/**
 * Live tables One's `public` does not have, that the mirror deliberately
 * does not carry (table -> reason). Any OTHER live table that One lacks makes
 * load-snapshot --apply refuse — and reconcile report a MISMATCH — as soon as
 * it holds a row, and so does any live column One lacks: nothing is dropped
 * silently (critique of A2). 30 Oct, run 20261030-a2-first: 13 live tables
 * not in One; these two carry rows, the other eleven are empty
 * (docs/cutover/MIGRATION-TOOLS.md lists all 13 with a reason each).
 */
export const NOT_MIGRATED = {
  feature_flags: "The fees app's own feature toggles. One switches features through app_settings and its own code, never these rows.",
  job_runs: "The fees app's cron history. One keeps its own; a fees job run means nothing in One.",
};

/** Live column names One lacks, per table, that may be dropped (none today). */
export const NOT_MIGRATED_COLUMNS = {};

/**
 * What the extract has that One cannot hold. Pure.
 *   manifestTables: [{ name, rowCount, columns }]; meta: One's catalog.
 * Returns { tables: [{ table, rows }], columns: [{ table, columns }] } — only
 * the ones NOT on the allow-lists above: each one stops --apply.
 */
export function unmigratedSourceData(manifestTables, meta) {
  const tables = [];
  const columns = [];
  for (const t of manifestTables) {
    if (SKIP_TABLES.has(t.name)) continue;
    const one = meta.tables[t.name];
    if (!one) {
      if ((t.rowCount ?? 0) > 0 && !NOT_MIGRATED[t.name]) tables.push({ table: t.name, rows: t.rowCount });
      continue;
    }
    const oneCols = new Set(one.columns.map((c) => c.name));
    const allowed = new Set(NOT_MIGRATED_COLUMNS[t.name] ?? []);
    const missing = (t.columns ?? []).filter((c) => !oneCols.has(c) && !allowed.has(c));
    if (missing.length) columns.push({ table: t.name, columns: missing });
  }
  return { tables, columns };
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
  return attachAuditRows(attachOnlineRows(marked, rowsByTable, meta), rowsByTable, meta);
}

/**
 * Two online tables name their subject without a foreign key, so following
 * FKs never reaches them, and One's own TEST-session online testing would be
 * filed as real rows — deleted as "extra in One" by the next mirror load:
 *  - online_payment_events: by provider_payment_id (a marked capture's) or
 *    provider_link_id (a marked intent's or capture's);
 *  - online_payment_audit: by intent_id / capture_id / event_id (plain
 *    columns) pointing at a marked row.
 */
export function attachOnlineRows(marked, rowsByTable, meta) {
  const keysOf = (table) => marked.get(table) ?? new Set();
  const rowsOf = (table) => rowsByTable.get(table) ?? [];
  const pkOf = (table) => meta.tables[table]?.pk;
  const markedRows = (table) => {
    const pk = pkOf(table);
    const keys = keysOf(table);
    return pk && keys.size ? rowsOf(table).filter((row) => keys.has(pkKey(row, pk))) : [];
  };

  const intents = markedRows("online_payment_intents");
  const captures = markedRows("online_payment_captures");
  const paymentIds = new Set(captures.map((c) => c.provider_payment_id).filter(Boolean));
  const linkIds = new Set([...intents, ...captures].map((r) => r.provider_link_id).filter(Boolean));

  const eventPk = pkOf("online_payment_events");
  if (eventPk && (paymentIds.size || linkIds.size)) {
    const out = new Set(keysOf("online_payment_events"));
    for (const e of rowsOf("online_payment_events")) {
      if ((e.provider_payment_id && paymentIds.has(e.provider_payment_id)) || (e.provider_link_id && linkIds.has(e.provider_link_id))) out.add(pkKey(e, eventPk));
    }
    if (out.size) marked.set("online_payment_events", out);
  }

  const auditPk = pkOf("online_payment_audit");
  if (auditPk) {
    const ids = (table) => new Set(markedRows(table).map((r) => String(r.id)));
    const byColumn = { intent_id: ids("online_payment_intents"), capture_id: ids("online_payment_captures"), event_id: ids("online_payment_events") };
    if (Object.values(byColumn).some((s) => s.size)) {
      const out = new Set(keysOf("online_payment_audit"));
      for (const a of rowsOf("online_payment_audit")) {
        if (Object.entries(byColumn).some(([column, set]) => a[column] != null && set.has(String(a[column])))) out.add(pkKey(a, auditPk));
      }
      if (out.size) marked.set("online_payment_audit", out);
    }
  }
  return marked;
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
