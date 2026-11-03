/**
 * Row helpers shared by every migrate tool. Pure.
 *
 * Both sides of a comparison are Postgres JSON: the fees side comes through
 * PostgREST (row_to_json), One's side through `to_jsonb(t)::text`. The only
 * differences between the two serialisations are key order and nested key
 * order, which `canonical()` removes. Timestamps are compared as text, so both
 * sides must be read in UTC (load-snapshot sets `timezone = 'UTC'`; PostgREST
 * on Supabase answers in UTC).
 */

import { createHash } from "node:crypto";

/** JSON with object keys sorted at every depth. */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

/** A row restricted to `columns` (in that order), missing keys as null. */
export function project(row, columns) {
  const out = {};
  for (const column of columns) out[column] = row?.[column] ?? null;
  return out;
}

/** The primary-key string of a row: one value as text, several as a JSON array. */
export function pkKey(row, pkColumns) {
  if (pkColumns.length === 1) return String(row?.[pkColumns[0]]);
  return JSON.stringify(pkColumns.map((column) => row?.[column] ?? null));
}

/** Compare two pk strings so that keyed output is stable. */
export function comparePk(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function md5(text) {
  return createHash("md5").update(text).digest("hex");
}

/**
 * Ordered md5 of a set of rows: sorted by pk, each row canonical over
 * `columns`. Equal sets of rows give equal hashes on both sides.
 */
export function orderedMd5(rows, pkColumns, columns) {
  const hash = createHash("md5");
  const keyed = rows.map((row) => [pkKey(row, pkColumns), row]).sort((a, b) => comparePk(a[0], b[0]));
  for (const [, row] of keyed) {
    hash.update(canonical(columns ? project(row, columns) : row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/** Index rows by pk. Throws on a duplicate pk (a broken extract). */
export function indexByPk(rows, pkColumns, label = "rows") {
  const map = new Map();
  for (const row of rows) {
    const key = pkKey(row, pkColumns);
    if (map.has(key)) throw new Error(`${label}: duplicate primary key in input.`);
    map.set(key, row);
  }
  return map;
}
