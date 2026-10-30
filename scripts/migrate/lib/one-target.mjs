/**
 * Reads of One's own `public` and `vppsone` bookkeeping, shared by
 * load-snapshot, reconcile, tail-sync and rollback-export. Each takes an open
 * `postgres` connection or transaction. Rows come back as Postgres JSON
 * (`to_jsonb(t)::text`), the same serialisation PostgREST gives the fees side,
 * so lib/rows.mjs can compare them; callers run inside a transaction that set
 * `timezone = 'UTC'`.
 */

export function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Not a plain identifier: ${name}`);
  return `"${name}"`;
}

/** Every row of public.<table> as JSON objects. */
export async function readPublicRows(sql, table) {
  const rows = await sql.unsafe(`select to_jsonb(t)::text as j from public.${ident(table)} t`);
  return rows.map((r) => JSON.parse(r.j));
}

/** Map table -> rows for every table named that exists in `meta`. */
export async function readPublicTables(sql, meta, tables) {
  const out = new Map();
  for (const table of tables) if (meta.tables[table]) out.set(table, await readPublicRows(sql, table));
  return out;
}

export async function readIdMap(sql) {
  return sql`select source_project, source_table, source_id, target_id from vppsone.migration_id_map`;
}

export async function readOneOwned(sql) {
  return sql`select source_table, row_key, column_name from vppsone.one_owned_fee_settings`;
}

/** `set local` for a migrate transaction: UTC text for timestamps, no statement timeout. */
export async function prepareTransaction(tx) {
  await tx.unsafe("set local timezone = 'UTC'");
  await tx.unsafe("set local statement_timeout = 0");
}
