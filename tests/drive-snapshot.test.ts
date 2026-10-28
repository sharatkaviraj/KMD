import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildManifest,
  exportAllTables,
  openSnapshot,
  packSnapshot,
  snapshotBaseName,
  verifySnapshot,
  type SnapshotDb,
} from "@/modules/archives/data/drive-snapshot";
import { recoveryKeyFingerprint } from "@/modules/archives/domain/recovery-envelope";

const school = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** A database that answers the export RPCs from synthetic tables, as Postgres would. */
function database(tables: Record<string, Record<string, unknown>[]>, publicTables: Record<string, Record<string, unknown>[]>) {
  const exported = (rows: Record<string, unknown>[]) => {
    const texts = rows.map((row) => JSON.stringify(row)).sort();
    return {
      rows: `[${texts.join(", ")}]`,
      count: rows.length,
      md5: createHash("md5").update(texts.join("\n")).digest("hex"),
    };
  };
  const calls: string[] = [];
  const db: SnapshotDb = {
    rpc: async (fn, args) => {
      calls.push(args ? `${fn}(${String(args.p_table)})` : fn);
      if (fn === "archive_tables") return { data: Object.keys(tables), error: null };
      if (fn === "backup_public_tables") return { data: Object.keys(publicTables), error: null };
      if (fn === "archive_table_export") return { data: exported(tables[String(args!.p_table)]!), error: null };
      if (fn === "backup_public_table_export") return { data: exported(publicTables[String(args!.p_table)]!), error: null };
      return { data: null, error: { message: `unknown ${fn}` } };
    },
  };
  return { db, calls };
}

const synthetic = () =>
  database(
    {
      student_documents: [{ id: "d1", file_name: "SYNTHETIC birth certificate.pdf", byte_size: 193 }],
      staff_profiles: [{ id: "s1", display_name: "Synthetic Office" }, { id: "s2", display_name: "Synthetic Teacher" }],
    },
    { receipts: [{ id: "r1", amount: "0.50" }], students: [{ id: "c1", full_name: "Synthetic Child" }] },
  );

async function snapshot() {
  const { db, calls } = synthetic();
  const { lines, tables } = await exportAllTables(db);
  const packed = packSnapshot(lines, school.publicKey);
  const manifest = buildManifest({
    createdAt: "2026-10-28T22:00:00.000Z",
    bundleName: "snapshot-2026-10-28T22-00-00Z.jsonl.gz.sealed",
    schemaVersion: "20261028090000",
    appCommit: "synthetic",
    keyFingerprint: recoveryKeyFingerprint(school.publicKey),
    packed,
    tables,
    files: [{ kind: "bucket", bucket: "vppsone-photos", name: "a.jpg", bytes: 10, sha256: "a".repeat(64), driveCopyId: "1Syntheticcopy0000" }],
  });
  return { packed, manifest, calls };
}

describe("a Drive snapshot", () => {
  it("holds both schemas, every table, with counts and digests", async () => {
    const { manifest, calls } = await snapshot();
    expect(manifest.tables.map((table) => `${table.schema}.${table.table}`)).toEqual([
      "vppsone.student_documents",
      "vppsone.staff_profiles",
      "public.receipts",
      "public.students",
    ]);
    expect(manifest.totals).toEqual({ tables: 4, rows: 5, files: 1 });
    expect(calls).toContain("backup_public_table_export(receipts)");
  });

  it("opens with the school's key and matches its manifest, money exact", async () => {
    const { packed, manifest } = await snapshot();
    const opened = openSnapshot(school.privateKey, packed.sealed);
    expect(verifySnapshot(manifest, opened)).toEqual({ ok: true, checked: 4, failed: [] });
    const receipts = opened.tables.find((table) => table.table === "receipts")!;
    expect(receipts.rows).toContain('"amount":"0.50"');
  });

  it("puts no record in the manifest or in the clear in the sealed file", async () => {
    const { packed, manifest } = await snapshot();
    expect(JSON.stringify(manifest)).not.toContain("Synthetic Child");
    expect(Buffer.from(packed.sealed).includes(Buffer.from("Synthetic Child"))).toBe(false);
  });

  it("is refused by the check when a table is missing or altered", async () => {
    const { packed, manifest } = await snapshot();
    const opened = openSnapshot(school.privateKey, packed.sealed);
    const altered = {
      ...opened,
      tables: opened.tables
        .filter((table) => table.table !== "students")
        .map((table) => (table.table === "receipts" ? { ...table, rows: table.rows.replace("0.50", "5.00") } : table)),
    };
    const check = verifySnapshot(manifest, altered);
    expect(check.ok).toBe(false);
    expect(check.failed.map((failure) => failure.table)).toEqual(
      expect.arrayContaining(["public.students", "public.receipts"]),
    );
  });

  it("names files by time, safely", () => {
    expect(snapshotBaseName(new Date("2026-10-28T22:00:05.123Z"))).toBe("snapshot-2026-10-28T22-00-05Z");
  });
});
