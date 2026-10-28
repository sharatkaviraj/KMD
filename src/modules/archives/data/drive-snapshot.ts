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
 * as canonical JSON text (`archive_table_export` / `backup_public_table_export`
 * — never re-parsed, so 0.50 stays 0.50), with each table's row count and
 * Postgres digest. One line per table, gzipped, sealed for the school's
 * recovery key: the app can write snapshots and cannot read them back.
 *
 * Beside the sealed bundle goes a plaintext manifest — table names, counts,
 * digests and checksums, the file list with their checksums, the schema
 * version — so anyone can see what a snapshot holds and check a download
 * before opening it. The manifest carries no row.
 *
 * Takes its database as an argument (RPCs only) so the tests run it against
 * fixtures; no `server-only`, and it holds no key.
 */

export type SnapshotDb = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type SnapshotTable = {
  schema: "vppsone" | "public";
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

export type SnapshotManifest = {
  version: 1;
  kind: "vppsone-drive-snapshot";
  createdAt: string;
  schemaVersion: string | null;
  appCommit: string | null;
  keyFingerprint: string;
  bundle: {
    name: string;
    format: "jsonl, gzip, sealed (VPPSENC1)";
    plainBytes: number;
    plainSha256: string;
    sealedBytes: number;
    sealedSha256: string;
  };
  tables: SnapshotTable[];
  files: SnapshotFile[];
  totals: { tables: number; rows: number; files: number };
};

type Exported = { rows: string; count: number; md5: string };

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

async function call<T>(db: SnapshotDb, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`Snapshot: ${fn} failed: ${error.message}`);
  return data as T;
}

/** Every table of both schemas, one JSON line each. */
export async function exportAllTables(db: SnapshotDb): Promise<{ lines: string[]; tables: SnapshotTable[] }> {
  const lines: string[] = [];
  const tables: SnapshotTable[] = [];
  const schemas = [
    { schema: "vppsone" as const, list: "archive_tables", exportFn: "archive_table_export" },
    { schema: "public" as const, list: "backup_public_tables", exportFn: "backup_public_table_export" },
  ];
  for (const { schema, list, exportFn } of schemas) {
    const names = await call<string[]>(db, list);
    for (const table of names) {
      const exported = await call<Exported>(db, exportFn, { p_table: table });
      const rowsText = exported.rows;
      lines.push(JSON.stringify({ schema, table, count: Number(exported.count), md5: exported.md5, rows: rowsText }));
      tables.push({
        schema,
        table,
        rows: Number(exported.count),
        md5: exported.md5,
        sha256: sha256(rowsText),
        bytes: Buffer.byteLength(rowsText),
      });
    }
  }
  return { lines, tables };
}

/** The lines as one file, gzipped and sealed. */
export function packSnapshot(lines: string[], recoveryPublicKey: string) {
  const plain = new TextEncoder().encode(lines.join("\n"));
  const sealed = sealForRecovery(recoveryPublicKey, gzipSync(plain, { level: 9 }));
  return { plain, sealed, plainSha256: sha256(plain), sealedSha256: sha256(sealed) };
}

export function buildManifest(input: {
  createdAt: string;
  bundleName: string;
  schemaVersion: string | null;
  appCommit: string | null;
  keyFingerprint: string;
  packed: ReturnType<typeof packSnapshot>;
  tables: SnapshotTable[];
  files: SnapshotFile[];
}): SnapshotManifest {
  return {
    version: 1,
    kind: "vppsone-drive-snapshot",
    createdAt: input.createdAt,
    schemaVersion: input.schemaVersion,
    appCommit: input.appCommit,
    keyFingerprint: input.keyFingerprint,
    bundle: {
      name: input.bundleName,
      format: "jsonl, gzip, sealed (VPPSENC1)",
      plainBytes: input.packed.plain.byteLength,
      plainSha256: input.packed.plainSha256,
      sealedBytes: input.packed.sealed.byteLength,
      sealedSha256: input.packed.sealedSha256,
    },
    tables: input.tables,
    files: input.files,
    totals: {
      tables: input.tables.length,
      rows: input.tables.reduce((sum, table) => sum + table.rows, 0),
      files: input.files.length,
    },
  };
}

export type OpenedTable = { schema: string; table: string; count: number; md5: string; rows: string };

/** Open a sealed bundle with the school's private key: the restore tool's first step. */
export function openSnapshot(privateKey: RecoveryPrivateKey, sealed: Uint8Array): { plainSha256: string; tables: OpenedTable[] } {
  const plain = gunzipSync(openWithRecoveryKey(privateKey, sealed));
  const text = new TextDecoder().decode(plain);
  const tables = text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as OpenedTable);
  return { plainSha256: sha256(plain), tables };
}

export type SnapshotCheck = { ok: boolean; checked: number; failed: { table: string; why: string }[] };

/**
 * Compare an opened bundle with its manifest: the whole file's sha256, and
 * for every table the count, the digest Postgres recorded and the sha256 of
 * the rows text. Writes nothing.
 */
export function verifySnapshot(manifest: SnapshotManifest, opened: ReturnType<typeof openSnapshot>): SnapshotCheck {
  const failed: SnapshotCheck["failed"] = [];
  if (opened.plainSha256 !== manifest.bundle.plainSha256) failed.push({ table: "(bundle)", why: "the bundle's sha256 differs" });
  const byName = new Map(opened.tables.map((table) => [`${table.schema}.${table.table}`, table]));
  for (const expected of manifest.tables) {
    const key = `${expected.schema}.${expected.table}`;
    const found = byName.get(key);
    if (!found) failed.push({ table: key, why: "missing" });
    else if (found.count !== expected.rows || found.md5 !== expected.md5) failed.push({ table: key, why: "count or digest differs" });
    else if (sha256(found.rows) !== expected.sha256) failed.push({ table: key, why: "rows differ" });
  }
  if (byName.size !== manifest.tables.length) failed.push({ table: "(bundle)", why: "table count differs" });
  return { ok: failed.length === 0, checked: manifest.tables.length, failed };
}

/** `snapshot-2026-10-28T22-00-00Z`: sorts by time, safe in any file system. */
export function snapshotBaseName(at: Date): string {
  return `snapshot-${at.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-")}`;
}
