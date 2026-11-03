/**
 * The fees app's change feed after a watermark, read-only through the sealed
 * client (critique0 #6).
 *
 * Two sources, unioned:
 *  1. `audit_logs` after the watermark (created_at, with the tie set) — the
 *     fees app's own trigger-written feed for its 42 audited tables. It is the
 *     only place a DELETE or an update that does not move `updated_at` shows.
 *  2. A timestamp scan of every table for rows whose change columns
 *     (updated_at, created_at, received_at, …) are after the watermark's
 *     newest change. The online-payment, WhatsApp, outbox and waiver tables are
 *     NOT audited by the fees app, so without this the feed would miss them.
 *
 * Returns Map table -> { rows: Map pk -> live row | null, ops: Map pk -> Set(op) }.
 */

import { afterWatermark } from "./tail.mjs";
import { pkKey } from "./rows.mjs";

/** CLAUDE.md rule 3b: an `.in()` list goes in the URL; chunk it. */
export const IN_CHUNK = 200;

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

export async function collectFeesChanges(fees, tables, watermark) {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const out = new Map();
  const note = (table, key, row, op) => {
    if (!out.has(table)) out.set(table, { rows: new Map(), ops: new Map() });
    const entry = out.get(table);
    if (row !== undefined) entry.rows.set(key, row);
    else if (!entry.rows.has(key)) entry.rows.set(key, undefined);
    if (!entry.ops.has(key)) entry.ops.set(key, new Set());
    entry.ops.get(key).add(op);
  };

  // 1. Timestamp scan.
  const since = watermark.newestChangeAt;
  for (const table of tables) {
    if (!since) break;
    for (const column of table.changeColumns) {
      for (let from = 0; ; from += 1000) {
        const rows = await must(
          fees.from(table.name).select("*").gt(column, since).order(column, { ascending: true }).range(from, from + 999),
          `scan ${table.name}.${column}`,
        );
        for (const row of rows) note(table.name, pkKey(row, table.pk), row, column === "created_at" ? "INSERT" : "UPDATE");
        if (rows.length < 1000) break;
      }
    }
  }

  // 2. audit_logs after the watermark.
  if (watermark.auditMaxCreatedAt && byName.has("audit_logs")) {
    for (let from = 0; ; from += 1000) {
      const rows = await must(
        fees.from("audit_logs").select("id, table_name, record_id, action, created_at")
          .gte("created_at", watermark.auditMaxCreatedAt).order("created_at", { ascending: true }).range(from, from + 999),
        "audit_logs after watermark",
      );
      for (const row of rows) {
        if (!afterWatermark(row, watermark)) continue;
        if (!byName.has(row.table_name) || row.record_id == null) continue;
        note(row.table_name, String(row.record_id), undefined, String(row.action ?? "UPDATE").toUpperCase());
      }
      if (rows.length < 1000) break;
    }
  }

  // 3. Rows the audit feed named but the scan did not bring: read them by id.
  for (const [table, entry] of out) {
    const meta = byName.get(table);
    if (!meta || meta.pk.length !== 1) continue;
    const missing = [...entry.rows].filter(([, row]) => row === undefined).map(([key]) => key);
    for (let i = 0; i < missing.length; i += IN_CHUNK) {
      const part = missing.slice(i, i + IN_CHUNK);
      const rows = await must(fees.from(table).select("*").in(meta.pk[0], part), `read ${table}`);
      for (const row of rows) entry.rows.set(pkKey(row, meta.pk), row);
    }
    for (const key of missing) if (entry.rows.get(key) === undefined) entry.rows.set(key, null); // gone: deleted
  }
  return out;
}
