#!/usr/bin/env node
/**
 * A data backup of One's main database, and the proof that it restores
 * (go-live Phase G, plan §9.2; critique1 B8).
 *
 *   npm run migrate:backup-one                          # dump public + vppsone
 *   npm run migrate:backup-one -- --restore-test <run>  # restore that dump, compare, throw it away
 *   npm run migrate:backup-one -- --restore <run> [--schema public|vppsone] [--tables s.t,…]
 *                                                       # dry run: what a restore would do
 *     … --restore <run> --rollback-only                 # do all of it, then roll back (rehearsal)
 *     … --restore <run> --apply                         # put the tables back (cutover rollback)
 *
 * **Restore** (the rollback of cutover steps 3 and 4). Dry run by default:
 * READ ONLY — every file checked against its manifest hash, today's columns
 * against the backup's, the refill order, blockers, the guard verdict.
 * --apply, in ONE transaction on One's project: the tables locked (ACCESS
 * EXCLUSIVE, 10 s lock timeout) and THEN the guard (lib/guards.mjs
 * decideRestoreGuard: never after a cutover row; only with the marker at
 * production and fee_writes_open() false); the named user triggers off
 * (never session_replication_role); every table emptied by one TRUNCATE
 * (which refuses if a table outside still points in — an empty one is
 * emptied along); COPY back parents first, a foreign-key cycle closed by a
 * second-pass UPDATE (restoreOrder); every table compared with the manifest
 * on rows, money sums and content; RESTORE_SAFE_STATE forced (fee writes
 * 'false', parent and staff dispatch off — a backup from before step 2 may
 * hold them on); triggers back on; an orphan count on every foreign key that
 * touches the restore (any aborts); owned sequences moved forward only;
 * matviews refreshed; the guard re-read; a `backup-one-restore` /
 * `rollback` migration_runs row naming the loads it undid (load-snapshot then
 * counts them as not applied). RESTORE_KEEP (the marker, migration_runs) is
 * never rewritten. --rollback-only does all of it and rolls back, lifting the
 * marker and fee-writes guards (never the cutover one).
 *
 * The project is on Supabase's free plan: no point-in-time recovery and no
 * managed backups (plan §0.1). What there is:
 *   1. the nightly Drive backup (D-334, job `drive-backup`): every record and
 *      stored file, sealed, in the school's Drive folder;
 *   2. this script, before every real load and at T0: a consistent copy of
 *      every table's rows that stays on this machine.
 *
 * **Dump.** One `REPEATABLE READ READ ONLY` transaction on One's project
 * (lib/one-db.mjs refuses any other — never the fees database), so every
 * table is read at the same instant. Per table in `public` and `vppsone`:
 * `COPY (<columns>) TO STDOUT` (text format; generated columns left out, as
 * a restore regenerates them) into a gzip file, with the row count, the
 * SHA-256 of the uncompressed stream, and the sum of every money-like column,
 * computed in the same snapshot. Written to
 *   %USERPROFILE%\.vppsone-migration\backup-<run>\  (never the repo: rows hold
 *   personal data — I-5)
 * with `manifest.json` (counts, sums, hashes, column lists — no rows). A
 * `migration_runs` row (`backup-one`) records the counts and the manifest's
 * hash, so the conversion script can check a backup exists (phase H).
 *
 * **Restore test.** In ONE transaction on One's project: create a throw-away
 * schema `restore_test_<date>_<hex>` (no grant to anyone: it is created and
 * dropped inside the transaction, so no other session ever sees it), create
 * every table from the manifest's column types, `COPY … FROM STDIN` each file
 * back, then compare per table: row count, every money sum, and the SHA-256
 * of the table dumped again (byte-for-byte the same stream, or it fails).
 * Then `DROP SCHEMA … CASCADE` and ROLLBACK — nothing persists but a
 * `migration_runs` row (`backup-one-restore-test`) with the verdict.
 * `restore-test.json` goes next to the manifest.
 *
 * Not in this backup (by design): `auth.*` (users and password hashes —
 * covered by the Drive backup and the loader's sealed auth extract), Storage
 * files (the Drive backup copies them), and the schema itself (rebuilt from
 * `supabase/migrations/`, `supabase/fee-migrations/` and the fee baseline;
 * the manifest keeps each table's column list and types).
 *
 * Output on the terminal: counts, sums and hashes only.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import { ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";
import { matviewOrder, MATVIEW_ORDER_SQL } from "./lib/catalog.mjs";
import { decideRestoreGuard, readGuardState } from "./lib/guards.mjs";
import { isMain, loadOneEnv, newRunId, parseArgs, runDir } from "./lib/env.mjs";
import { openOneDb } from "./lib/one-db.mjs";

export const BACKUP_SCHEMAS = ["public", "vppsone"];

/** A column whose sum is worth comparing: a number named like money. */
const MONEY_NAME = /(amount|rupees|paise|total|paid|due|fee|discount|balance|waive|waiver|charge|fine|refund|concession|net|gross)/i;
const NUMERIC_TYPES = new Set(["smallint", "integer", "bigint", "numeric", "real", "double precision"]);

export function isMoneyColumn(column) {
  const base = String(column.type).replace(/\(.*\)$/, "");
  return NUMERIC_TYPES.has(base) && MONEY_NAME.test(column.name);
}

/** "public.receipts" → the file name in the backup folder. */
export function dataFileName(schema, table) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Refusing an unusual table name: ${schema}.${table}`);
  }
  return `${schema}.${table}.copy.gz`;
}

/** The throw-away schema's name: never one that exists, never `public` or `vppsone`. */
export function restoreSchemaName(now = new Date(), suffix = randomBytes(2).toString("hex")) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `restore_test_${day}_${suffix}`;
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Compare one restored table with the manifest. Returns a list of
 * differences (empty = equal).
 */
export function compareTable(expected, restored) {
  const diffs = [];
  if (expected.rows !== restored.rows) diffs.push(`rows ${expected.rows} → ${restored.rows}`);
  for (const [column, sum] of Object.entries(expected.sums ?? {})) {
    if ((restored.sums?.[column] ?? null) !== sum) diffs.push(`sum(${column}) ${sum} → ${restored.sums?.[column] ?? "null"}`);
  }
  if (expected.sha256 !== restored.sha256) diffs.push("content hash differs");
  return diffs;
}

/** SHA-256, line count (= rows in COPY text format) and size of a COPY stream's bytes. */
export function digestCopy(buffer) {
  let rows = 0;
  for (let at = buffer.indexOf(10); at !== -1; at = buffer.indexOf(10, at + 1)) rows += 1;
  return { sha256: createHash("sha256").update(buffer).digest("hex"), rows, bytes: buffer.length };
}

/**
 * `COPY … TO STDOUT` into memory, read in flowing mode.
 *
 * Not piped: postgres.js pauses the socket when its stream's buffer is full
 * and resumes it only from `_read()`, which a Readable stops calling once the
 * end has been pushed — so a COPY whose last chunk filled the buffer leaves
 * the connection paused and the next query hangs for ever (seen on the first
 * run, after `public.receipts`). A 'data' listener empties the buffer as each
 * chunk arrives, so the pause never happens. One's largest table is a few
 * megabytes; memory is not the constraint.
 */
async function copyOut(tx, statement) {
  const readable = await tx.unsafe(statement).readable();
  const chunks = [];
  await new Promise((resolve, reject) => {
    readable.on("data", (chunk) => chunks.push(chunk));
    readable.once("end", resolve);
    readable.once("error", reject);
  });
  return Buffer.concat(chunks);
}

async function listTables(tx) {
  const tables = await tx`
    select n.nspname as schema, c.relname as table
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${BACKUP_SCHEMAS}) and c.relkind = 'r'
    order by n.nspname, c.relname`;
  const columns = await tx`
    select n.nspname as schema, c.relname as table, a.attname as name,
           format_type(a.atttypid, a.atttypmod) as type, a.attnum as position
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${BACKUP_SCHEMAS}) and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    order by n.nspname, c.relname, a.attnum`;
  const byTable = new Map();
  for (const column of columns) {
    const key = `${column.schema}.${column.table}`;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key).push({ name: column.name, type: column.type });
  }
  return tables.map((t) => ({ schema: t.schema, table: t.table, columns: byTable.get(`${t.schema}.${t.table}`) ?? [] }));
}

/** Count and money sums of a relation (the source table, or its restored copy). */
async function countAndSums(tx, relation, columns) {
  const money = columns.filter(isMoneyColumn);
  const selects = ["count(*)::bigint as rows", ...money.map((c, i) => `sum(${quoteIdent(c.name)})::text as s${i}`)];
  const [row] = await tx.unsafe(`select ${selects.join(", ")} from ${relation}`);
  return {
    rows: Number(row.rows),
    sums: Object.fromEntries(money.map((c, i) => [c.name, row[`s${i}`] ?? null])),
  };
}

async function dump() {
  const runId = `backup-${newRunId()}`;
  const dir = runDir(runId);
  const startedAt = new Date().toISOString();
  const sql = await openOneDb(loadOneEnv());
  let manifest;
  try {
    manifest = await sql.begin("isolation level repeatable read read only", async (tx) => {
      const [{ snapshot_at: snapshotAt, txid }] = await tx`select now() as snapshot_at, txid_current_if_assigned()::text as txid`;
      const tables = await listTables(tx);
      const out = [];
      for (const t of tables) {
        if (t.columns.length === 0) continue;
        const relation = `${quoteIdent(t.schema)}.${quoteIdent(t.table)}`;
        const columnList = t.columns.map((c) => quoteIdent(c.name)).join(", ");
        const file = dataFileName(t.schema, t.table);
        const data = await copyOut(tx, `copy ${relation} (${columnList}) to stdout`);
        const copied = digestCopy(data);
        writeFileSync(path.join(dir, file), gzipSync(data, { level: 6 }));
        const checked = await countAndSums(tx, relation, t.columns);
        if (checked.rows !== copied.rows) {
          throw new Error(`${t.schema}.${t.table}: COPY gave ${copied.rows} lines but count(*) is ${checked.rows}.`);
        }
        out.push({
          schema: t.schema,
          table: t.table,
          file,
          columns: t.columns,
          rows: copied.rows,
          bytes: copied.bytes,
          gzBytes: statSync(path.join(dir, file)).size,
          sha256: copied.sha256,
          sums: checked.sums,
        });
      }
      return { snapshotAt: new Date(snapshotAt).toISOString(), txid, tables: out };
    });
  } catch (error) {
    await sql.end();
    throw error;
  }

  const finishedAt = new Date().toISOString();
  const totals = {
    tables: manifest.tables.length,
    rows: manifest.tables.reduce((n, t) => n + t.rows, 0),
    bytes: manifest.tables.reduce((n, t) => n + t.bytes, 0),
    gzBytes: manifest.tables.reduce((n, t) => n + t.gzBytes, 0),
  };
  const full = {
    kind: "one-backup",
    format: "copy-text-gzip/1",
    project: ONE_MAIN_PROJECT_REF,
    schemas: BACKUP_SCHEMAS,
    runId,
    startedAt,
    finishedAt,
    snapshotAt: manifest.snapshotAt,
    totals,
    tables: manifest.tables,
  };
  const text = JSON.stringify(full, null, 2);
  writeFileSync(path.join(dir, "manifest.json"), text);
  const manifestSha = createHash("sha256").update(text).digest("hex");

  try {
    await sql`
      insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at, finished_at, status, summary, note)
      values ('backup-one', 'run', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${runId}, ${manifest.snapshotAt},
              now(), 'succeeded', ${sql.json({ ...totals, manifest_sha256: manifestSha, schemas: BACKUP_SCHEMAS })},
              'Data backup of public + vppsone to the operator''s private folder (Phase G).')`;
  } finally {
    await sql.end();
  }

  console.log(`backup-one: ${runId} — snapshot ${manifest.snapshotAt}`);
  console.log(`  ${totals.tables} tables, ${totals.rows} rows, ${(totals.bytes / 1e6).toFixed(1)} MB raw, ${(totals.gzBytes / 1e6).toFixed(1)} MB gzip`);
  console.log(`  manifest sha256 ${manifestSha}`);
  console.log(`  folder: %USERPROFILE%\\.vppsone-migration\\${runId}\\ (private; never the repo)`);
  console.log(`  next: npm run migrate:backup-one -- --restore-test ${runId}`);
}

async function restoreTest(runId) {
  const dir = runDir(runId, { create: false });
  const manifestFile = path.join(dir, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`No manifest in ${runId}.`);
  const manifestText = readFileSync(manifestFile, "utf8");
  const manifest = JSON.parse(manifestText);
  if (manifest.kind !== "one-backup" || manifest.project !== ONE_MAIN_PROJECT_REF) throw new Error("Not a backup of One's project.");

  const schema = restoreSchemaName();
  const startedAt = new Date().toISOString();
  const sql = await openOneDb(loadOneEnv());
  const results = [];
  let dropped = false;
  const ROLLBACK = new Error("restore test: rolled back on purpose");
  try {
    await sql.begin(async (tx) => {
      const [{ exists }] = await tx`select exists (select 1 from pg_namespace where nspname = ${schema}) as exists`;
      if (exists) throw new Error(`${schema} already exists; refusing to touch it.`);
      await tx.unsafe(`create schema ${quoteIdent(schema)}`);
      await tx.unsafe(`revoke all on schema ${quoteIdent(schema)} from public, anon, authenticated`);

      for (const t of manifest.tables) {
        const relation = `${quoteIdent(schema)}.${quoteIdent(`${t.schema}__${t.table}`)}`;
        const definition = t.columns.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(", ");
        await tx.unsafe(`create table ${relation} (${definition})`);
        const columnList = t.columns.map((c) => quoteIdent(c.name)).join(", ");
        const writable = await tx.unsafe(`copy ${relation} (${columnList}) from stdin`).writable();
        await pipeline(Readable.from([gunzipSync(readFileSync(path.join(dir, t.file)))]), writable);

        const again = digestCopy(await copyOut(tx, `copy ${relation} (${columnList}) to stdout`));
        const checked = await countAndSums(tx, relation, t.columns);
        const restored = { rows: checked.rows, sums: checked.sums, sha256: again.sha256 };
        results.push({ table: `${t.schema}.${t.table}`, rows: t.rows, diffs: compareTable(t, restored) });
      }

      await tx.unsafe(`drop schema ${quoteIdent(schema)} cascade`);
      dropped = true;
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) {
      await sql.end();
      throw error;
    }
  }

  const [{ left }] = await sql`select count(*)::int as left from pg_namespace where nspname = ${schema}`;
  const failed = results.filter((r) => r.diffs.length > 0);
  const verdict = {
    runId,
    schema,
    startedAt,
    finishedAt: new Date().toISOString(),
    manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    tables: results.length,
    rows: results.reduce((n, r) => n + r.rows, 0),
    equalTables: results.length - failed.length,
    failed: failed.map((r) => ({ table: r.table, diffs: r.diffs })),
    droppedInTransaction: dropped,
    schemaLeftAfterRollback: left,
    ok: failed.length === 0 && results.length === manifest.tables.length && left === 0,
  };
  writeFileSync(path.join(dir, "restore-test.json"), JSON.stringify(verdict, null, 2));
  try {
    await sql`
      insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at, finished_at, status, summary, note)
      values ('backup-one-restore-test', 'dry_run', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${runId}, ${manifest.snapshotAt},
              now(), ${verdict.ok ? "succeeded" : "failed"},
              ${sql.json({ tables: verdict.tables, rows: verdict.rows, equal_tables: verdict.equalTables, failed: verdict.failed.length, manifest_sha256: verdict.manifestSha256, schema })},
              'Restore test into a throw-away schema, compared and rolled back (Phase G).')`;
  } finally {
    await sql.end();
  }

  console.log(`backup-one --restore-test ${runId}: ${verdict.ok ? "OK" : "FAILED"}`);
  console.log(`  restored ${verdict.tables} tables / ${verdict.rows} rows into ${schema}; ${verdict.equalTables} equal on rows, money sums and content hash`);
  for (const f of verdict.failed.slice(0, 20)) console.log(`  !! ${f.table}: ${f.diffs.join("; ")}`);
  console.log(`  schema dropped in the transaction: ${dropped ? "yes" : "no"}; present after rollback: ${left}`);
  if (!verdict.ok) process.exitCode = 1;
}

/* ------------------------------------------------------------ the restore */

/**
 * Tables a restore never rewrites, and why: they hold the cutover's control
 * state, not school data. Nothing references them from outside in a way
 * TRUNCATE would refuse (they are parents only).
 */
export const RESTORE_KEEP = {
  "vppsone.deployment": "the production marker step 2 set; a restore must not undo it",
  "vppsone.migration_runs": "the record of what was done (the backup, the loads, this restore); append-only",
};

/**
 * What a restore never leaves switched on, whatever the backup held: applied
 * after the rows are back and compared, so the backup's own values are what
 * the comparison saw. Step 2 turned these off; a backup taken before it may
 * hold them on.
 */
export const RESTORE_SAFE_STATE = [
  {
    table: "public.app_settings",
    sql: "insert into public.app_settings (key, value) values ('fee_writes_enabled', 'false') on conflict (key) do update set value = 'false'",
    what: "fee_writes_enabled = 'false'",
  },
  {
    table: "vppsone.runtime_flags",
    sql: "update vppsone.runtime_flags set enabled = false where key in ('parent_dispatch', 'staff_notice_dispatch')",
    what: "parent_dispatch and staff_notice_dispatch off",
  },
];

/**
 * The manifest's tables a restore covers: `schemas` (default both) and, if
 * given, only `tables` ("schema.table"), less RESTORE_KEEP. Pure.
 *
 * @param {{ tables: any[] }} manifest
 * @param {{ schemas?: string[], tables?: string[] | null }} [options]
 */
export function restoreSelection(manifest, { schemas = BACKUP_SCHEMAS, tables = null } = {}) {
  for (const schema of schemas) {
    if (!BACKUP_SCHEMAS.includes(schema)) throw new Error(`--schema is one of ${BACKUP_SCHEMAS.join(", ")} (or leave it out for both).`);
  }
  const known = new Set(manifest.tables.map((t) => `${t.schema}.${t.table}`));
  const wanted = tables ? new Set(tables) : null;
  const unknown = wanted ? [...wanted].filter((key) => !known.has(key)) : [];
  if (unknown.length) throw new Error(`Not in the backup: ${unknown.join(", ")} (name tables as schema.table).`);
  const selected = [];
  const kept = [];
  for (const t of manifest.tables) {
    const key = `${t.schema}.${t.table}`;
    if (!schemas.includes(t.schema) || (wanted && !wanted.has(key))) continue;
    if (RESTORE_KEEP[key]) kept.push(key);
    else selected.push(t);
  }
  return { selected, kept };
}

/**
 * The order to refill tables in — every parent before its children — and the
 * foreign keys that must wait for a second pass because they close a cycle
 * (live's `installments` ↔ `student_carry_forward_balances` ↔
 * `prev_year_import_rows`; none is deferrable). A table that cannot be placed
 * gives up one NULLABLE foreign key into another unplaced table, the first by
 * name, until it can. `fks`: { name, child, parent, childCols, nullable } with
 * "schema.table" names. Self-references need nothing: a whole table is one
 * COPY, and its foreign keys are checked at the end of that statement. Pure.
 */
export function restoreOrder(tableKeys, fks) {
  const remaining = new Set(tableKeys);
  let active = fks.filter((fk) => fk.child !== fk.parent && remaining.has(fk.child) && remaining.has(fk.parent));
  const order = [];
  const deferred = [];
  while (remaining.size) {
    const ready = [...remaining].filter((t) => active.every((fk) => fk.child !== t || !remaining.has(fk.parent))).sort();
    if (ready.length) {
      for (const t of ready) {
        order.push(t);
        remaining.delete(t);
      }
      continue;
    }
    const cut = active
      .filter((fk) => remaining.has(fk.child) && remaining.has(fk.parent) && fk.nullable)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!cut) throw new Error(`These tables reference each other through NOT NULL foreign keys: ${[...remaining].sort().join(", ")}.`);
    deferred.push(cut);
    active = active.filter((fk) => fk !== cut);
  }
  return { order, deferred };
}

/**
 * Why a backed-up table cannot be COPYed back into today's table: a column
 * gone or retyped, or a new NOT NULL column without a default. Pure.
 */
export function columnProblems(backedUp, current) {
  if (!current) return ["the table no longer exists"];
  const now = new Map(current.columns.map((c) => [c.name, c]));
  const problems = [];
  for (const c of backedUp.columns) {
    const there = now.get(c.name);
    if (!there) problems.push(`column ${c.name} is gone`);
    else if (there.generated) problems.push(`column ${c.name} is now generated`);
    else if (there.type !== c.type) problems.push(`column ${c.name} is ${there.type}, was ${c.type}`);
  }
  const had = new Set(backedUp.columns.map((c) => c.name));
  for (const c of current.columns) {
    if (!had.has(c.name) && !c.generated && c.notNull && !c.hasDefault) problems.push(`new column ${c.name} is NOT NULL without a default`);
  }
  return problems;
}

/**
 * SHA-256 over a COPY stream's lines in sorted order: the same rows in any
 * physical order give the same digest. A table whose cyclic foreign key was
 * filled by a second-pass UPDATE comes back in another physical order, so the
 * restore compares it this way. Pure.
 */
export function sortedDigest(buffer) {
  const lines = [];
  let start = 0;
  for (let at = buffer.indexOf(10); at !== -1; at = buffer.indexOf(10, start)) {
    lines.push(buffer.subarray(start, at));
    start = at + 1;
  }
  if (start < buffer.length) lines.push(buffer.subarray(start));
  lines.sort(Buffer.compare);
  const hash = createHash("sha256");
  for (const line of lines) hash.update(line).update("\n");
  return hash.digest("hex");
}

/** Tables, columns, keys, triggers and sequences of both schemas, and every foreign key touching them. */
async function readRestoreCatalog(tx) {
  const [row] = await tx`
    select jsonb_build_object(
      'tables', coalesce((
        select jsonb_object_agg(n.nspname || '.' || c.relname, jsonb_build_object(
          'columns', (
            select jsonb_agg(jsonb_build_object(
              'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
              'hasDefault', a.atthasdef or a.attidentity <> '', 'generated', a.attgenerated <> ''
            ) order by a.attnum)
            from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          ),
          'pk', (
            select jsonb_agg(a.attname order by k.ord)
            from pg_constraint con
            cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
            where con.conrelid = c.oid and con.contype = 'p'
          ),
          'triggers', coalesce((
            select jsonb_agg(tg.tgname order by tg.tgname) from pg_trigger tg where tg.tgrelid = c.oid and not tg.tgisinternal
          ), '[]'::jsonb),
          'sequences', coalesce((
            select jsonb_agg(jsonb_build_object('column', a.attname, 'sequence', pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname)))
            from pg_attribute a
            where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
              and pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) is not null
          ), '[]'::jsonb)
        ))
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any(${BACKUP_SCHEMAS}) and c.relkind = 'r'
      ), '{}'::jsonb),
      'fks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', con.conname,
          'child', cn.nspname || '.' || cc.relname,
          'parent', pn.nspname || '.' || pc.relname,
          'childCols', (select jsonb_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum),
          'parentCols', (select jsonb_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum),
          'nullable', (select bool_and(not a.attnotnull) from pg_attribute a where a.attrelid = con.conrelid and a.attnum = any(con.conkey))
        ) order by con.conname)
        from pg_constraint con
        join pg_class cc on cc.oid = con.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
        join pg_class pc on pc.oid = con.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
        where con.contype = 'f' and (cn.nspname = any(${BACKUP_SCHEMAS}) or pn.nspname = any(${BACKUP_SCHEMAS}))
      ), '[]'::jsonb)
    ) as meta`;
  return typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
}

/** "public.receipts" → "public"."receipts". */
const relationOf = (key) => {
  const at = key.indexOf(".");
  return `${quoteIdent(key.slice(0, at))}.${quoteIdent(key.slice(at + 1))}`;
};

/**
 * Everything a restore must know before it writes, read in the transaction
 * that will write (or a READ ONLY one for the dry run): the order, the
 * second-pass foreign keys, column problems, and blockers — tables outside
 * the restore that point at it and are not empty (TRUNCATE would refuse
 * them; an empty one is emptied along, which changes nothing).
 */
async function planRestore(tx, selected) {
  const meta = await readRestoreCatalog(tx);
  const keys = selected.map((t) => `${t.schema}.${t.table}`);
  const inSet = new Set(keys);
  const blockers = [];
  for (const t of selected) {
    const problems = columnProblems(t, meta.tables[`${t.schema}.${t.table}`]);
    if (problems.length) blockers.push(`${t.schema}.${t.table}: ${problems.join("; ")}`);
  }
  const alsoEmptied = new Set();
  for (const fk of meta.fks) {
    if (!inSet.has(fk.parent) || inSet.has(fk.child)) continue;
    const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${relationOf(fk.child)}`);
    if (n === 0) alsoEmptied.add(fk.child);
    else blockers.push(`${fk.child} (${n} rows, not in this restore) points at ${fk.parent} through ${fk.name}: restore it too (--tables), or restore the whole schema`);
  }
  const { order, deferred } = restoreOrder(keys, meta.fks);
  for (const fk of deferred) {
    if (!meta.tables[fk.child]?.pk?.length) blockers.push(`${fk.child} closes a foreign-key cycle (${fk.name}) and has no primary key for the second pass`);
  }
  const rowsNow = {};
  for (const key of keys) {
    if (!meta.tables[key]) continue;
    const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${relationOf(key)}`);
    rowsNow[key] = n;
  }
  return { meta, order, deferred, blockers, alsoEmptied: [...alsoEmptied].sort(), rowsNow };
}

/** Read a backed-up table's file and check it against the manifest before anything is written. */
function readBackedUp(dir, t) {
  const data = gunzipSync(readFileSync(path.join(dir, t.file)));
  const digest = digestCopy(data);
  if (digest.sha256 !== t.sha256 || digest.rows !== t.rows) {
    throw new Error(`${t.schema}.${t.table}: the backup file does not match its manifest (rows ${digest.rows}/${t.rows}); refusing.`);
  }
  return data;
}

/** Thrown at the end of a --rollback-only restore so the transaction rolls back. */
class RestoreRehearsal extends Error {
  constructor(outcome) {
    super("restore rehearsal: rolled back on purpose");
    this.outcome = outcome;
  }
}

/** The writes, in the caller's transaction. Returns what was done; throws on any difference. */
async function writeRestore(tx, { dir, manifest, selected, rollbackOnly, apply }) {
  await tx.unsafe("set local timezone = 'UTC'");
  await tx.unsafe("set local statement_timeout = 0");
  // A lock that does not come within 10 s fails the run rather than queue
  // every reader of the app behind it.
  await tx.unsafe("set local lock_timeout = '10s'");

  const plan = await planRestore(tx, selected);
  if (plan.blockers.length) throw new Error(`refusing: ${plan.blockers.join(" | ")}`);
  const byKey = new Map(selected.map((t) => [`${t.schema}.${t.table}`, t]));
  const everything = [...plan.order, ...plan.alsoEmptied];

  // 1. Locks first, then the guard, so nothing it read can change under the restore.
  await tx.unsafe(`lock table ${everything.map(relationOf).join(", ")} in access exclusive mode`);
  // The guard's own tables: reads go on (the app reads the marker), writes wait.
  const guardTables = ["vppsone.deployment", "vppsone.migration_runs", "public.app_settings"].filter((key) => !everything.includes(key));
  await tx.unsafe(`lock table ${guardTables.map(relationOf).join(", ")} in exclusive mode`);
  const guard = decideRestoreGuard({ ...(await readGuardState(tx)), rollbackOnly });
  if (!guard.ok) throw new Error(`refusing: ${guard.reasons.join(" ")}`);

  // 2. The named user triggers off (never session_replication_role, which
  //    would switch the foreign keys off too), then every table emptied in
  //    one TRUNCATE — which itself refuses if anything outside still points in.
  for (const key of everything) {
    for (const trigger of plan.meta.tables[key]?.triggers ?? []) {
      await tx.unsafe(`alter table ${relationOf(key)} disable trigger ${quoteIdent(trigger)}`);
    }
  }
  await tx.unsafe(`truncate table ${everything.map(relationOf).join(", ")}`);

  // 3. Refill parents first. A table with a second-pass foreign key is
  //    COPYed into a temporary twin and inserted with those columns null.
  const deferredBy = new Map();
  for (const fk of plan.deferred) {
    if (!deferredBy.has(fk.child)) deferredBy.set(fk.child, []);
    deferredBy.get(fk.child).push(fk);
  }
  const stages = new Map();
  const files = new Map();
  for (const key of plan.order) {
    const t = byKey.get(key);
    const data = readBackedUp(dir, t);
    files.set(key, data);
    const columnList = t.columns.map((c) => quoteIdent(c.name)).join(", ");
    const waits = deferredBy.get(key);
    if (!waits) {
      const writable = await tx.unsafe(`copy ${relationOf(key)} (${columnList}) from stdin`).writable();
      await pipeline(Readable.from([data]), writable);
      continue;
    }
    const stage = quoteIdent(`restore_stage_${stages.size}`);
    stages.set(key, stage);
    await tx.unsafe(`create temporary table ${stage} (${t.columns.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(", ")}) on commit drop`);
    const writable = await tx.unsafe(`copy ${stage} (${columnList}) from stdin`).writable();
    await pipeline(Readable.from([data]), writable);
    const later = new Set(waits.flatMap((fk) => fk.childCols));
    const select = t.columns.map((c) => (later.has(c.name) ? "null" : quoteIdent(c.name))).join(", ");
    await tx.unsafe(`insert into ${relationOf(key)} (${columnList}) overriding system value select ${select} from ${stage}`);
  }
  for (const [key, waits] of deferredBy) {
    const pk = plan.meta.tables[key].pk;
    const stage = stages.get(key);
    for (const fk of waits) {
      const set = fk.childCols.map((c) => `${quoteIdent(c)} = s.${quoteIdent(c)}`).join(", ");
      const match = pk.map((c) => `t.${quoteIdent(c)} = s.${quoteIdent(c)}`).join(" and ");
      const any = fk.childCols.map((c) => `s.${quoteIdent(c)} is not null`).join(" or ");
      await tx.unsafe(`update ${relationOf(key)} t set ${set} from ${stage} s where ${match} and (${any})`);
    }
  }
  // The deferrable foreign keys (two self-references) are checked now, not
  // at commit: a table with pending trigger events cannot have its triggers
  // switched back on, and a failure belongs here, before the comparison.
  await tx.unsafe("set constraints all immediate");

  // 4. Compare every table with the manifest — rows, every money sum, and
  //    the content (byte for byte, or as a sorted set after a second pass).
  const results = [];
  for (const key of plan.order) {
    const t = byKey.get(key);
    const columnList = t.columns.map((c) => quoteIdent(c.name)).join(", ");
    const again = await copyOut(tx, `copy ${relationOf(key)} (${columnList}) to stdout`);
    const checked = await countAndSums(tx, relationOf(key), t.columns);
    let sha256 = digestCopy(again).sha256;
    if (sha256 !== t.sha256 && sortedDigest(again) === sortedDigest(files.get(key))) sha256 = t.sha256;
    results.push({ table: key, rows: t.rows, diffs: compareTable(t, { rows: checked.rows, sums: checked.sums, sha256 }) });
  }
  const failed = results.filter((r) => r.diffs.length);
  if (failed.length) throw new Error(`restored tables differ from the backup: ${failed.slice(0, 10).map((r) => `${r.table} (${r.diffs.join("; ")})`).join(", ")}`);

  // 5. Nothing left switched on (RESTORE_SAFE_STATE), triggers back on.
  const forced = [];
  for (const state of RESTORE_SAFE_STATE) {
    if (!byKey.has(state.table)) continue;
    await tx.unsafe(state.sql);
    forced.push(state.what);
  }
  for (const key of everything) {
    for (const trigger of plan.meta.tables[key]?.triggers ?? []) {
      await tx.unsafe(`alter table ${relationOf(key)} enable trigger ${quoteIdent(trigger)}`);
    }
  }

  // 6. Orphans: every foreign key with either end in the restore (a parent
  //    such as auth.users is not restored; a user deleted since the backup
  //    would leave rows pointing at nothing). Any orphan aborts.
  const touched = new Set(everything);
  const orphans = [];
  for (const fk of plan.meta.fks) {
    if (!touched.has(fk.child) && !touched.has(fk.parent)) continue;
    const notNull = fk.childCols.map((c) => `c.${quoteIdent(c)} is not null`).join(" and ");
    const match = fk.childCols.map((c, i) => `p.${quoteIdent(fk.parentCols[i])} = c.${quoteIdent(c)}`).join(" and ");
    const [{ n }] = await tx.unsafe(
      `select count(*)::int as n from ${relationOf(fk.child)} c where ${notNull} and not exists (select 1 from ${relationOf(fk.parent)} p where ${match})`,
    );
    if (n) orphans.push(`${fk.name} ${n}`);
  }
  if (orphans.length) throw new Error(`orphans after the restore: ${orphans.join(", ")}`);

  // 7. Owned sequences never move backwards (a number handed out after the
  //    backup is never handed out again), matviews refreshed in dependency
  //    order when `public` was restored, and the refresh queue told so.
  //    setval is not transactional; never moving back keeps a rehearsal harmless.
  for (const key of plan.order) {
    for (const { column, sequence } of plan.meta.tables[key]?.sequences ?? []) {
      await tx.unsafe(
        `select setval($1::regclass, v, true) from (
           select greatest(coalesce((select max(${quoteIdent(column)}) from ${relationOf(key)}), 0), coalesce(pg_sequence_last_value($1::regclass), 0)) as v
         ) x where v > 0`,
        [sequence],
      );
    }
  }
  let refreshed = [];
  if (plan.order.some((key) => key.startsWith("public."))) {
    refreshed = matviewOrder(await tx.unsafe(MATVIEW_ORDER_SQL));
    for (const view of refreshed) await tx.unsafe(`refresh materialized view public.${quoteIdent(view)}`);
    if (plan.meta.tables["public.workbook_materialized_view_refresh_queue"]) {
      await tx.unsafe("update public.workbook_materialized_view_refresh_queue set pending = false, last_refreshed_at = now()");
    }
  }

  // 8. The guard again, as the restore leaves it.
  const after = await readGuardState(tx);
  if (apply && (after.environment !== "production" || after.feeWritesOpen !== false)) {
    throw new Error(`after the restore the marker is '${after.environment}' and fee_writes_open() is ${after.feeWritesOpen}; rolled back.`);
  }

  // Loads the restore undid: load-snapshot counts them as not applied (lib/guards.mjs).
  const undid = plan.order.some((key) => key.startsWith("public."))
    ? (await tx`
        select id::text from vppsone.migration_runs
        where script = 'load-snapshot' and kind = 'run' and status = 'succeeded' and finished_at > ${manifest.snapshotAt}
        order by finished_at`).map((r) => r.id)
    : [];

  const outcome = {
    tables: results.length,
    rows: results.reduce((n, r) => n + r.rows, 0),
    equalTables: results.length,
    alsoEmptied: plan.alsoEmptied,
    secondPass: plan.deferred.map((fk) => fk.name),
    forced,
    refreshed,
    undidRuns: undid,
  };
  if (rollbackOnly) throw new RestoreRehearsal(outcome);
  await tx`
    insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at, finished_at, status, summary, note)
    values ('backup-one-restore', 'rollback', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${manifest.runId}, ${manifest.snapshotAt},
            now(), 'succeeded',
            ${tx.json({ tables: outcome.tables, rows: outcome.rows, schemas: [...new Set(selected.map((t) => t.schema))], undid_runs: undid, forced, also_emptied: plan.alsoEmptied, second_pass: outcome.secondPass })},
            'Tables put back to this backup (cutover rollback, Phase G).')`;
  return outcome;
}

async function restore(runId, args) {
  const apply = Boolean(args.apply);
  const rollbackOnly = Boolean(args["rollback-only"]);
  if (apply && rollbackOnly) throw new Error("Pass --apply or --rollback-only, not both.");
  const dir = runDir(runId, { create: false });
  const manifestFile = path.join(dir, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`No manifest in ${runId}.`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (manifest.kind !== "one-backup" || manifest.project !== ONE_MAIN_PROJECT_REF) throw new Error("Not a backup of One's project.");

  const schemas = typeof args.schema === "string" ? [args.schema] : BACKUP_SCHEMAS;
  const tables = typeof args.tables === "string" ? args.tables.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const { selected, kept } = restoreSelection(manifest, { schemas, tables });
  if (!selected.length) throw new Error("Nothing to restore.");
  // Every file is read and checked against the manifest before the database is opened.
  for (const t of selected) readBackedUp(dir, t);

  const mode = rollbackOnly ? "REHEARSAL (every write rolled back)" : apply ? "APPLY" : "dry run";
  const startedAt = new Date().toISOString();
  console.log(`backup-one --restore ${runId}: ${mode} — ${selected.length} tables of ${schemas.join(" + ")}, backup of ${manifest.snapshotAt}`);
  if (kept.length) console.log(`  never restored: ${kept.map((k) => `${k} (${RESTORE_KEEP[k]})`).join("; ")}`);

  const sql = await openOneDb(loadOneEnv());
  try {
    if (!apply && !rollbackOnly) {
      await sql.begin("read only", async (tx) => {
        const plan = await planRestore(tx, selected);
        const guard = decideRestoreGuard({ ...(await readGuardState(tx)), rollbackOnly: false });
        const backupRows = selected.reduce((n, t) => n + t.rows, 0);
        const nowRows = Object.values(plan.rowsNow).reduce((n, v) => n + v, 0);
        const changed = selected.filter((t) => plan.rowsNow[`${t.schema}.${t.table}`] !== t.rows);
        console.log(`  rows now ${nowRows}; in the backup ${backupRows}; ${changed.length} table(s) differ in count`);
        for (const t of changed.slice(0, 20)) console.log(`    ${t.schema}.${t.table}: ${plan.rowsNow[`${t.schema}.${t.table}`] ?? "missing"} now → ${t.rows}`);
        console.log(`  refill order: ${plan.order.length} tables; second-pass foreign keys: ${plan.deferred.map((fk) => fk.name).join(", ") || "none"}`);
        if (plan.alsoEmptied.length) console.log(`  emptied along (empty, point in): ${plan.alsoEmptied.join(", ")}`);
        for (const b of plan.blockers) console.log(`  !! ${b}`);
        console.log(`  guard for --apply: ${guard.ok ? "would pass" : `would refuse — ${guard.reasons.join(" ")}`}`);
        console.log(`  afterwards, whatever the backup held: ${RESTORE_SAFE_STATE.filter((s) => selected.some((t) => `${t.schema}.${t.table}` === s.table)).map((s) => s.what).join("; ") || "nothing forced"}`);
        if (plan.blockers.length) process.exitCode = 1;
      });
      return;
    }

    let outcome;
    try {
      outcome = await sql.begin((tx) => writeRestore(tx, { dir, manifest, selected, rollbackOnly, apply }));
    } catch (error) {
      if (!(error instanceof RestoreRehearsal)) throw error;
      outcome = error.outcome;
    }
    const verdict = { runId, mode: rollbackOnly ? "rollback-only" : "apply", startedAt, finishedAt: new Date().toISOString(), schemas, tables: tables ?? "all", ...outcome };
    writeFileSync(path.join(dir, `restore-${rollbackOnly ? "rehearsal" : "apply"}-${newRunId()}.json`), JSON.stringify(verdict, null, 2));
    if (rollbackOnly) {
      await sql`
        insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at, finished_at, status, summary, note)
        values ('backup-one-restore', 'dry_run', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${runId}, ${manifest.snapshotAt},
                now(), 'succeeded', ${sql.json({ tables: outcome.tables, rows: outcome.rows, second_pass: outcome.secondPass, also_emptied: outcome.alsoEmptied, forced: outcome.forced })},
                'Restore rehearsed in one transaction and rolled back (Phase G).')`;
    }
    console.log(`  ${rollbackOnly ? "REHEARSAL PASSED and rolled back" : "RESTORED"}: ${outcome.tables} tables / ${outcome.rows} rows equal to the backup on rows, money sums and content`);
    console.log(`  second pass: ${outcome.secondPass.join(", ") || "none"}; emptied along: ${outcome.alsoEmptied.join(", ") || "none"}; matviews refreshed: ${outcome.refreshed.length}`);
    console.log(`  forced afterwards: ${outcome.forced.join("; ") || "nothing"}; loads undone: ${outcome.undidRuns.length}`);
    if (!rollbackOnly && schemas.includes("vppsone")) {
      console.log("  next: re-run step 2 (convert-to-production --apply): the backup predates it, so its test-account conversions are undone.");
    }
  } finally {
    await sql.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args["restore-test"] === "string") return restoreTest(args["restore-test"]);
  if (args["restore-test"] === true) throw new Error("--restore-test takes the backup's run id (backup-…).");
  if (typeof args.restore === "string") return restore(args.restore, args);
  if (args.restore === true) throw new Error("--restore takes the backup's run id (backup-…).");
  return dump();
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`backup-one: ${error.message}`);
    process.exitCode = 2;
  });
}
