import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  openWithRecoveryKey,
  sealForRecovery,
  type RecoveryPrivateKey,
} from "@/modules/archives/domain/recovery-envelope";

/**
 * A whole-database snapshot for the school's Drive (D-334).
 *
 * Every `vppsone` table and every fee (`public`) table, exported by Postgres
 * as canonical JSON text (never re-parsed, so 0.50 stays 0.50), with each
 * table's row count and Postgres digest. Each schema is read in ONE call
 * (`backup_schema_export`), so its tables come from the same moment; if that
 * call fails (too big, too slow) the tables are read one by one and the
 * manifest says the schema is not one moment.
 *
 * The bundle is one file: a first line with the full manifest — digests,
 * checksums, the list of every stored file — then one line per table;
 * gzipped, sealed for the school's recovery key. The app can write it and
 * cannot read it back.
 *
 * Beside it goes a short plaintext summary — when, which schema version, how
 * many rows in which tables, the bundle's checksum — so anyone can see what a
 * snapshot is and check a download. No row, no file name, no row digest: a
 * digest in the clear would let someone holding a guessed record confirm it.
 *
 * Takes its database as an argument (RPCs only) so the tests run it against
 * fixtures; no `server-only`, and it holds no key.
 */

export type SnapshotDb = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type Schema = "vppsone" | "public";

export type SnapshotTable = {
  schema: Schema;
  table: string;
  rows: number;
  /** Postgres's md5 of the rows, as exported; a restore must reproduce it. */
  md5: string;
  /** sha256 of the exported rows text. */
  sha256: string;
  bytes: number;
};

export type SnapshotFile =
  | { kind: "bucket"; bucket: string; name: string; bytes: number; sha256: string | null; driveCopyId: string | null }
  | { kind: "drive"; documentId: string; driveFileId: string; bytes: number; sha256: string };

/** Inside the sealed bundle, as its first line. */
export type InnerManifest = {
  kind: "manifest";
  createdAt: string;
  schemaVersion: string | null;
  appCommit: string | null;
  /** True when every table of the schema was read in one statement. */
  consistent: Record<Schema, boolean>;
  tables: SnapshotTable[];
  files: SnapshotFile[];
};

/** Beside the bundle, in plain text. */
export type SnapshotSummary = {
  version: 2;
  kind: "vppsone-drive-snapshot";
  createdAt: string;
  schemaVersion: string | null;
  appCommit: string | null;
  keyFingerprint: string;
  consistent: Record<Schema, boolean>;
  bundle: {
    name: string;
    format: "jsonl (manifest, then one line per table), gzip, sealed (VPPSENC1)";
    plainBytes: number;
    plainSha256: string;
    sealedBytes: number;
    sealedSha256: string;
  };
  tables: { schema: Schema; table: string; rows: number }[];
  totals: { tables: number; rows: number; files: number };
};

type Row = { table_name: string; row_count: number; md5: string; rows: string };
type Exported = { rows: string; count: number; md5: string };

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

async function call<T>(db: SnapshotDb, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`Snapshot: ${fn} failed: ${error.message}`);
  return data as T;
}

const PER_TABLE: Record<Schema, { list: string; exportFn: string }> = {
  vppsone: { list: "archive_tables", exportFn: "archive_table_export" },
  public: { list: "backup_public_tables", exportFn: "backup_public_table_export" },
};

async function exportSchema(db: SnapshotDb, schema: Schema): Promise<{ rows: Row[]; consistent: boolean }> {
  try {
    return { rows: await call<Row[]>(db, "backup_schema_export", { p_schema: schema }), consistent: true };
  } catch {
    const names = await call<string[]>(db, PER_TABLE[schema].list);
    const rows: Row[] = [];
    for (const table of names) {
      const exported = await call<Exported>(db, PER_TABLE[schema].exportFn, { p_table: table });
      rows.push({ table_name: table, row_count: exported.count, md5: exported.md5, rows: exported.rows });
    }
    return { rows, consistent: false };
  }
}

/** Every table of both schemas, one JSON line each. */
export async function exportAllTables(db: SnapshotDb) {
  const lines: string[] = [];
  const tables: SnapshotTable[] = [];
  const consistent = { vppsone: false, public: false } as Record<Schema, boolean>;
  for (const schema of ["vppsone", "public"] as const) {
    const exported = await exportSchema(db, schema);
    consistent[schema] = exported.consistent;
    for (const row of exported.rows) {
      const count = Number(row.row_count);
      lines.push(JSON.stringify({ schema, table: row.table_name, count, md5: row.md5, rows: row.rows }));
      tables.push({
        schema,
        table: row.table_name,
        rows: count,
        md5: row.md5,
        sha256: sha256(row.rows),
        bytes: Buffer.byteLength(row.rows),
      });
    }
  }
  return { lines, tables, consistent };
}

/** The manifest line and the table lines as one file, gzipped and sealed. */
export function packSnapshot(inner: InnerManifest, tableLines: string[], recoveryPublicKey: string) {
  const plain = new TextEncoder().encode([JSON.stringify(inner), ...tableLines].join("\n"));
  const sealed = sealForRecovery(recoveryPublicKey, gzipSync(plain, { level: 9 }));
  return { plain, sealed, plainSha256: sha256(plain), sealedSha256: sha256(sealed) };
}

export function buildSummary(input: {
  inner: InnerManifest;
  bundleName: string;
  keyFingerprint: string;
  packed: ReturnType<typeof packSnapshot>;
}): SnapshotSummary {
  const { inner } = input;
  return {
    version: 2,
    kind: "vppsone-drive-snapshot",
    createdAt: inner.createdAt,
    schemaVersion: inner.schemaVersion,
    appCommit: inner.appCommit,
    keyFingerprint: input.keyFingerprint,
    consistent: inner.consistent,
    bundle: {
      name: input.bundleName,
      format: "jsonl (manifest, then one line per table), gzip, sealed (VPPSENC1)",
      plainBytes: input.packed.plain.byteLength,
      plainSha256: input.packed.plainSha256,
      sealedBytes: input.packed.sealed.byteLength,
      sealedSha256: input.packed.sealedSha256,
    },
    tables: inner.tables.map((table) => ({ schema: table.schema, table: table.table, rows: table.rows })),
    totals: {
      tables: inner.tables.length,
      rows: inner.tables.reduce((sum, table) => sum + table.rows, 0),
      files: inner.files.length,
    },
  };
}

export type OpenedTable = { schema: string; table: string; count: number; md5: string; rows: string };

/** Open a sealed bundle with the school's private key: the restore tool's first step. */
export function openSnapshot(privateKey: RecoveryPrivateKey, sealed: Uint8Array) {
  const plain = gunzipSync(openWithRecoveryKey(privateKey, sealed));
  const [head, ...rest] = new TextDecoder().decode(plain).split("\n");
  const manifest = JSON.parse(head ?? "{}") as InnerManifest;
  if (manifest.kind !== "manifest") throw new Error("This bundle does not start with its manifest.");
  return { plainSha256: sha256(plain), manifest, tables: rest.map((line) => JSON.parse(line) as OpenedTable) };
}

export type SnapshotCheck = { ok: boolean; checked: number; failed: { table: string; why: string }[] };

/**
 * Compare an opened bundle with the plaintext summary beside it and with its
 * own sealed manifest: the whole file's sha256, then for every table the
 * count, the digest Postgres recorded and the sha256 of the rows text.
 * Writes nothing.
 */
export function verifySnapshot(summary: SnapshotSummary, opened: ReturnType<typeof openSnapshot>): SnapshotCheck {
  const failed: SnapshotCheck["failed"] = [];
  if (opened.plainSha256 !== summary.bundle.plainSha256) failed.push({ table: "(bundle)", why: "the bundle's sha256 differs" });
  const byName = new Map(opened.tables.map((table) => [`${table.schema}.${table.table}`, table]));
  const listed = new Map(summary.tables.map((table) => [`${table.schema}.${table.table}`, table.rows]));
  for (const expected of opened.manifest.tables) {
    const key = `${expected.schema}.${expected.table}`;
    const found = byName.get(key);
    if (!found) failed.push({ table: key, why: "missing" });
    else if (found.count !== expected.rows || found.md5 !== expected.md5) failed.push({ table: key, why: "count or digest differs" });
    else if (sha256(found.rows) !== expected.sha256) failed.push({ table: key, why: "rows differ" });
    else if (listed.get(key) !== expected.rows) failed.push({ table: key, why: "the summary's count differs" });
  }
  if (byName.size !== opened.manifest.tables.length || listed.size !== byName.size) {
    failed.push({ table: "(bundle)", why: "table count differs" });
  }
  return { ok: failed.length === 0, checked: opened.manifest.tables.length, failed };
}

/** `snapshot-2026-10-28T22-00-00Z`: sorts by time, safe in any file system. */
export function snapshotBaseName(at: Date): string {
  return `snapshot-${at.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-")}`;
}
