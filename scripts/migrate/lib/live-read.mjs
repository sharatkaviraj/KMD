/**
 * Reading the fees app's live database through the sealed client
 * (lib/fees-readonly.mjs) — the REST extractor (plan §2.2 as amended: there is
 * no live Postgres password, so no exported snapshot).
 *
 * Consistency without a snapshot (critique0 #6 adapted): a fingerprint —
 * per table the exact row count and the maximum of every change timestamp it
 * has, plus the newest audit_logs row — is taken before and after the full
 * read. The read counts only if the two fingerprints are equal; otherwise the
 * whole read is repeated. Equal fingerprints mean no audited write, no insert
 * and no timestamped update landed anywhere while the rows were read.
 */

import { appendFileSync, createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

/** Columns whose maximum moves when a row is written. */
export const CHANGE_COLUMNS = [
  "updated_at", "created_at", "received_at", "processed_at", "posted_at", "charged_at",
  "ran_at", "waived_at", "voided_at", "applied_at", "resolved_at", "verified_at",
];

/** Views the extract also reads (control totals, year split, online invariant). */
export const EXTRACT_VIEWS = ["v_workbook_student_financials", "v_workbook_installment_balances", "v_online_payment_reconciliation"];

/**
 * A stable order for paging a view PostgREST reports no key for: a page by
 * range over an unordered matview can repeat or skip rows. installment_id is
 * unique in v_workbook_installment_balances (2,448 rows, 2,448 distinct) and
 * student_id in v_workbook_student_financials (620 / 620) — wtgx, 30 Oct.
 */
export const VIEW_KEYS = {
  v_workbook_installment_balances: ["installment_id"],
  v_workbook_student_financials: ["student_id"],
};

/** The key to page a view by: PostgREST's, else VIEW_KEYS. */
export function viewKey(view) {
  return view.pk?.length ? view.pk : VIEW_KEYS[view.name] ?? [];
}

/**
 * Tables and views from PostgREST's OpenAPI document. Every view and matview
 * in this schema is named `v_*` and no base table is (checked against One's
 * catalog on 30 Oct), so the prefix is the split. Pure over the document.
 */
export function relationsFromOpenApi(doc) {
  const tables = [];
  const views = [];
  for (const [name, def] of Object.entries(doc?.definitions ?? {})) {
    const props = def?.properties ?? {};
    const columns = Object.keys(props);
    const pk = columns.filter((c) => /<pk\/>/.test(props[c]?.description ?? ""));
    const entry = { name, columns, pk, changeColumns: CHANGE_COLUMNS.filter((c) => columns.includes(c)) };
    (name.startsWith("v_") ? views : tables).push(entry);
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  views.sort((a, b) => a.name.localeCompare(b.name));
  return { tables, views };
}

async function must(promise, what) {
  const { data, error, count } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return { data, count };
}

/** Exact count + max of each change column + audit_logs newest row. */
export async function liveFingerprint(fees, tables) {
  const out = {};
  for (const table of tables) {
    const { count } = await must(fees.from(table.name).select("*", { count: "exact", head: true }), `count ${table.name}`);
    const max = {};
    for (const column of table.changeColumns) {
      const { data } = await must(
        fees.from(table.name).select(column).not(column, "is", null).order(column, { ascending: false }).limit(1),
        `max ${table.name}.${column}`,
      );
      max[column] = data?.[0]?.[column] ?? null;
    }
    out[table.name] = { count, max };
  }
  return out;
}

/** The ids of audit_logs rows at the newest created_at (the watermark's tie set). */
export async function auditWatermark(fees) {
  const { data } = await must(
    fees.from("audit_logs").select("created_at").order("created_at", { ascending: false }).limit(1),
    "audit_logs newest",
  );
  const at = data?.[0]?.created_at ?? null;
  if (!at) return { auditMaxCreatedAt: null, auditIdsAtMax: [] };
  const { data: tie } = await must(fees.from("audit_logs").select("id").eq("created_at", at), "audit_logs tie");
  return { auditMaxCreatedAt: at, auditIdsAtMax: tie.map((r) => r.id).sort() };
}

/** Equal fingerprints, field by field. Returns the tables that moved. */
export function fingerprintDrift(before, after) {
  const moved = [];
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const name of names) {
    if (JSON.stringify(before?.[name]) !== JSON.stringify(after?.[name])) moved.push(name);
  }
  return moved.sort();
}

/**
 * Every row of a table, paginated by primary key: keyset (`pk > last`) for a
 * one-column key, ordered ranges for a composite key, plain ranges for a
 * relation with no key (views only). PostgREST truncates at 1000 rows, so a
 * short page is the end.
 */
export async function readAllRows(fees, table, pk, { pageSize = 1000 } = {}) {
  const rows = [];
  if (pk.length === 1) {
    const [key] = pk;
    let last = null;
    for (;;) {
      let query = fees.from(table).select("*").order(key, { ascending: true }).limit(pageSize);
      if (last !== null) query = query.gt(key, last);
      const { data } = await must(query, `read ${table}`);
      rows.push(...data);
      if (data.length < pageSize) return rows;
      last = data[data.length - 1][key];
    }
  }
  for (let from = 0; ; from += pageSize) {
    let query = fees.from(table).select("*");
    for (const key of pk) query = query.order(key, { ascending: true });
    const { data } = await must(query.range(from, from + pageSize - 1), `read ${table}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

/* --------------------------------------------------------------- NDJSON */

export function writeNdjson(file, rows) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "");
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    appendFileSync(file, rows.slice(i, i + chunk).map((row) => JSON.stringify(row)).join("\n") + "\n");
  }
}

export async function readNdjson(file) {
  if (!existsSync(file)) return null;
  const rows = [];
  const lines = readline.createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
}

/** Every table of a run: Map table -> rows. */
export async function readRunTables(run, manifest, { only } = {}) {
  const out = new Map();
  for (const table of manifest.tables) {
    if (only && !only.has(table.name)) continue;
    out.set(table.name, (await readNdjson(path.join(run, "tables", `${table.name}.ndjson`))) ?? []);
  }
  return out;
}
