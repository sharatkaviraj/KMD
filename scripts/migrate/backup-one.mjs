#!/usr/bin/env node
/**
 * A data backup of One's main database, and the proof that it restores
 * (go-live Phase G, plan §9.2; critique1 B8).
 *
 *   npm run migrate:backup-one                          # dump public + vppsone
 *   npm run migrate:backup-one -- --restore-test <run>  # restore that dump, compare, throw it away
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args["restore-test"] === "string") return restoreTest(args["restore-test"]);
  if (args["restore-test"] === true) throw new Error("--restore-test takes the backup's run id (backup-…).");
  return dump();
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`backup-one: ${error.message}`);
    process.exitCode = 2;
  });
}
