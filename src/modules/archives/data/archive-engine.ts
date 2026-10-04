import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Building an archive and proving it restores (P11, D-238).
 *
 * Takes a service-role client as an argument rather than importing one, so
 * the app (through `archive-repo.ts`) and `scripts/verify-archive.mjs` run the
 * very same code. No `server-only` here for that reason; nothing in a browser
 * imports it, and it holds no key of its own.
 *
 * An archive is a copy — every `vppsone` table as the canonical JSON text
 * Postgres wrote (never re-parsed, so 0.50 stays 0.50) and every document and
 * photograph byte — in the private `vppsone-archives` bucket, under one
 * manifest of counts, digests and checksums. Nothing is deleted.
 */

export const ARCHIVES_BUCKET = "vppsone-archives";

/**
 * What the engine needs of a client: the RPCs and Storage. Structural, so a
 * client bound to either schema — the app's, or a script's — fits.
 */
export type ArchiveClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  storage: SupabaseClient["storage"];
};

export type TableEntry = {
  name: string;
  rows: number;
  /** Postgres's md5 of the rows, as archived — the drill must reproduce it. */
  md5: string;
  /** sha256 of the file's bytes. */
  sha256: string;
  bytes: number;
  path: string;
};

export type ObjectEntry = { bucket: string; name: string; bytes: number; sha256: string; path: string };

export type Manifest = {
  version: 1;
  archiveId: string;
  label: string;
  sessionLabel: string;
  createdAt: string;
  schemaVersion: string | null;
  appCommit: string | null;
  tables: TableEntry[];
  objects: ObjectEntry[];
  totals: { tables: number; rows: number; objects: number; bytes: number };
};

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/**
 * JSON with every object's keys sorted. The catalogue keeps the manifest as
 * `jsonb`, which reorders keys; the copy beside the files keeps the order it
 * was written in. Comparing the two as written text would call every archive
 * changed (found by the browser journey, not the verifier, which compared an
 * object with itself).
 */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : item,
  );
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Write every table and object for one archive, and its manifest. */
export async function buildArchive(
  db: ArchiveClient,
  input: { archiveId: string; label: string; sessionLabel: string; appCommit: string | null },
): Promise<Manifest> {
  const storage = db.storage.from(ARCHIVES_BUCKET);
  const { data: names, error: listError } = await db.rpc("archive_tables");
  if (listError) throw new Error(`Could not list the tables: ${listError.message}`);
  const { data: schemaVersion } = await db.rpc("archive_schema_version");

  const tables: TableEntry[] = [];
  for (const name of names as string[]) {
    const { data, error } = await db.rpc("archive_table_export", { p_table: name });
    if (error) throw new Error(`Could not export ${name}: ${error.message}`);
    const exported = data as { rows: string; count: number; md5: string };
    const path = `${input.archiveId}/tables/${name}.json`;
    const body = new TextEncoder().encode(exported.rows);
    const upload = await storage.upload(path, body, { contentType: "application/json", upsert: false });
    if (upload.error) throw new Error(`Could not store ${name}: ${upload.error.message}`);
    tables.push({ name, rows: Number(exported.count), md5: exported.md5, sha256: sha256(body), bytes: body.byteLength, path });
  }

  const { data: listing, error: objectError } = await db.rpc("archive_object_listing");
  if (objectError) throw new Error(`Could not list the documents and photographs: ${objectError.message}`);
  const objects: ObjectEntry[] = [];
  for (const object of listing as { bucket: string; name: string; size: number; mimetype: string | null }[]) {
    const { data: blob, error } = await db.storage.from(object.bucket).download(object.name);
    if (error || !blob) throw new Error(`Could not read ${object.bucket}/${object.name}`);
    const body = await bytesOf(blob);
    const path = `${input.archiveId}/objects/${object.bucket}/${object.name}`;
    const upload = await storage.upload(path, body, { contentType: object.mimetype ?? "application/octet-stream", upsert: false });
    if (upload.error) throw new Error(`Could not copy ${object.bucket}/${object.name}: ${upload.error.message}`);
    objects.push({ bucket: object.bucket, name: object.name, bytes: body.byteLength, sha256: sha256(body), path });
  }

  const manifest: Manifest = {
    version: 1,
    archiveId: input.archiveId,
    label: input.label,
    sessionLabel: input.sessionLabel,
    createdAt: new Date().toISOString(),
    schemaVersion: (schemaVersion as string | null) ?? null,
    appCommit: input.appCommit,
    tables,
    objects,
    totals: {
      tables: tables.length,
      rows: tables.reduce((sum, table) => sum + table.rows, 0),
      objects: objects.length,
      bytes: tables.reduce((sum, table) => sum + table.bytes, 0) + objects.reduce((sum, object) => sum + object.bytes, 0),
    },
  };
  const upload = await storage.upload(`${input.archiveId}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), {
    contentType: "application/json",
    upsert: false,
  });
  if (upload.error) throw new Error(`Could not store the manifest: ${upload.error.message}`);
  return manifest;
}

export type DrillReport = {
  ok: boolean;
  manifestMatches: boolean;
  tables: { checked: number; failed: { name: string; why: "missing" | "checksum" | "reload" }[] };
  objects: { checked: number; failed: { path: string; why: "missing" | "checksum" }[] };
  roundTrip: "ok" | "failed" | "no_objects";
};

/**
 * Prove an archive restores. Every table file is re-hashed and reloaded into a
 * scratch table of the same shape, and must reproduce the digest the archive
 * recorded; every object is re-hashed; and one object is written to a scratch
 * prefix, read back and removed. `manifest` is the catalogue's copy — the
 * drill also checks the copy stored beside the files agrees with it.
 */
export async function drillArchive(db: ArchiveClient, manifest: Manifest, drillId: string): Promise<DrillReport> {
  const storage = db.storage.from(ARCHIVES_BUCKET);
  const report: DrillReport = {
    ok: false,
    manifestMatches: false,
    tables: { checked: 0, failed: [] },
    objects: { checked: 0, failed: [] },
    roundTrip: "no_objects",
  };

  const { data: stored } = await storage.download(`${manifest.archiveId}/manifest.json`);
  if (stored) {
    const copy = JSON.parse(await stored.text()) as Manifest;
    report.manifestMatches = canonical(copy.tables) === canonical(manifest.tables) && canonical(copy.objects) === canonical(manifest.objects);
  }

  for (const table of manifest.tables) {
    report.tables.checked += 1;
    const { data: blob } = await storage.download(table.path);
    if (!blob) {
      report.tables.failed.push({ name: table.name, why: "missing" });
      continue;
    }
    const body = await bytesOf(blob);
    if (sha256(body) !== table.sha256) {
      report.tables.failed.push({ name: table.name, why: "checksum" });
      continue;
    }
    const { data, error } = await db.rpc("restore_drill_table", { p_table: table.name, p_rows: new TextDecoder().decode(body) });
    const reloaded = data as { rows: number; md5: string } | null;
    if (error || !reloaded || Number(reloaded.rows) !== table.rows || reloaded.md5 !== table.md5) {
      report.tables.failed.push({ name: table.name, why: "reload" });
    }
  }

  for (const object of manifest.objects) {
    report.objects.checked += 1;
    const { data: blob } = await storage.download(object.path);
    if (!blob) {
      report.objects.failed.push({ path: object.path, why: "missing" });
      continue;
    }
    if (sha256(await bytesOf(blob)) !== object.sha256) report.objects.failed.push({ path: object.path, why: "checksum" });
  }

  // Bytes written back out and read again, as a restore would.
  const sample = manifest.objects[0];
  if (sample) {
    const { data: blob } = await storage.download(sample.path);
    const scratch = `restore-drill/${drillId}/${sample.bucket}/${sample.name}`;
    if (blob) {
      const body = await bytesOf(blob);
      const written = await storage.upload(scratch, body, { upsert: true });
      const { data: back } = written.error ? { data: null } : await storage.download(scratch);
      report.roundTrip = back && sha256(await bytesOf(back)) === sample.sha256 ? "ok" : "failed";
      await storage.remove([scratch]);
    } else {
      report.roundTrip = "failed";
    }
  }

  report.ok =
    report.manifestMatches && report.tables.failed.length === 0 && report.objects.failed.length === 0 && report.roundTrip !== "failed";
  return report;
}
