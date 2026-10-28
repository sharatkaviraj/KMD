import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildSummary,
  exportAllTables,
  openSnapshot,
  packSnapshot,
  snapshotBaseName,
  verifySnapshot,
  type InnerManifest,
  type SnapshotDb,
} from "@/modules/archives/data/drive-snapshot";
import { recoveryKeyFingerprint } from "@/modules/archives/domain/recovery-envelope";

const school = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

type Tables = Record<string, Record<string, unknown>[]>;

/** A database that answers the export RPCs from synthetic tables, as Postgres would. */
function database(schemas: { vppsone: Tables; public: Tables }, options: { oneCallFails?: boolean } = {}) {
  const exported = (rows: Record<string, unknown>[]) => {
    const texts = rows.map((row) => JSON.stringify(row)).sort();
    return { rows: `[${texts.join(", ")}]`, count: rows.length, md5: createHash("md5").update(texts.join("\n")).digest("hex") };
  };
  const calls: string[] = [];
  const db: SnapshotDb = {
    rpc: async (fn, args) => {
      calls.push(args ? `${fn}(${String(args.p_schema ?? args.p_table)})` : fn);
      if (fn === "backup_schema_export") {
        if (options.oneCallFails) return { data: null, error: { message: "canceling statement due to statement timeout" } };
        const tables = schemas[args!.p_schema as "vppsone" | "public"];
        return {
          data: Object.entries(tables).map(([table_name, rows]) => {
            const out = exported(rows);
            return { table_name, row_count: out.count, md5: out.md5, rows: out.rows };
          }),
          error: null,
        };
      }
      if (fn === "archive_tables") return { data: Object.keys(schemas.vppsone), error: null };
      if (fn === "backup_public_tables") return { data: Object.keys(schemas.public), error: null };
      if (fn === "archive_table_export") return { data: exported(schemas.vppsone[String(args!.p_table)]!), error: null };
      if (fn === "backup_public_table_export") return { data: exported(schemas.public[String(args!.p_table)]!), error: null };
      return { data: null, error: { message: `unknown ${fn}` } };
    },
  };
  return { db, calls };
}

const synthetic = {
  vppsone: {
    student_documents: [{ id: "d1", file_name: "SYNTHETIC birth certificate.pdf", byte_size: 193 }],
    staff_profiles: [{ id: "s1", display_name: "Synthetic Office" }, { id: "s2", display_name: "Synthetic Teacher" }],
  },
  public: { receipts: [{ id: "r1", amount: "0.50" }], students: [{ id: "c1", full_name: "Synthetic Child" }] },
};

async function snapshot(options: { oneCallFails?: boolean } = {}) {
  const { db, calls } = database(synthetic, options);
  const { lines, tables, consistent } = await exportAllTables(db);
  const inner: InnerManifest = {
    kind: "manifest",
    createdAt: "2026-10-28T22:00:00.000Z",
    schemaVersion: "20261028035840",
    appCommit: "synthetic",
    consistent,
    tables,
    files: [{ kind: "bucket", bucket: "defaulter-voice-notes", name: "c1/note.webm", bytes: 10, sha256: "a".repeat(64), driveCopyId: "1Syntheticcopy0000" }],
  };
  const packed = packSnapshot(inner, lines, school.publicKey);
  const summary = buildSummary({
    inner,
    bundleName: "snapshot-2026-10-28T22-00-00Z.jsonl.gz.sealed",
    keyFingerprint: recoveryKeyFingerprint(school.publicKey),
    packed,
  });
  return { packed, summary, calls, consistent };
}

describe("a Drive snapshot", () => {
  it("reads each schema in one call, so its tables are one moment", async () => {
    const { summary, calls, consistent } = await snapshot();
    expect(calls).toEqual(["backup_schema_export(vppsone)", "backup_schema_export(public)", "archive_schema_version"].slice(0, 2));
    expect(consistent).toEqual({ vppsone: true, public: true });
    expect(summary.tables.map((table) => `${table.schema}.${table.table}`)).toEqual([
      "vppsone.student_documents",
      "vppsone.staff_profiles",
      "public.receipts",
      "public.students",
    ]);
    expect(summary.totals).toEqual({ tables: 4, rows: 5, files: 1 });
  });

  it("falls back to one table at a time, and says it is not one moment", async () => {
    const { summary, calls } = await snapshot({ oneCallFails: true });
    expect(summary.consistent).toEqual({ vppsone: false, public: false });
    expect(calls).toContain("backup_public_table_export(receipts)");
    expect(summary.totals.rows).toBe(5);
  });

  it("opens with the school's key and matches, money exact", async () => {
    const { packed, summary } = await snapshot();
    const opened = openSnapshot(school.privateKey, packed.sealed);
    expect(verifySnapshot(summary, opened)).toEqual({ ok: true, checked: 4, failed: [] });
    expect(opened.tables.find((table) => table.table === "receipts")!.rows).toContain('"amount":"0.50"');
    expect(opened.manifest.files[0]).toMatchObject({ bucket: "defaulter-voice-notes" });
  });

  it("keeps rows, file names and row digests out of the plaintext summary", async () => {
    const { packed, summary } = await snapshot();
    const text = JSON.stringify(summary);
    expect(text).not.toContain("Synthetic Child");
    expect(text).not.toContain("voice");
    expect(text).not.toMatch(/"md5"|"sha256":"[0-9a-f]{64}"/);
    expect(Buffer.from(packed.sealed).includes(Buffer.from("Synthetic Child"))).toBe(false);
  });

  it("is refused by the check when a table is missing or altered", async () => {
    const { packed, summary } = await snapshot();
    const opened = openSnapshot(school.privateKey, packed.sealed);
    const altered = {
      ...opened,
      tables: opened.tables
        .filter((table) => table.table !== "students")
        .map((table) => (table.table === "receipts" ? { ...table, rows: table.rows.replace("0.50", "5.00") } : table)),
    };
    const check = verifySnapshot(summary, altered);
    expect(check.ok).toBe(false);
    expect(check.failed.map((failure) => failure.table)).toEqual(expect.arrayContaining(["public.students", "public.receipts"]));
  });

  it("names files by time, safely", () => {
    expect(snapshotBaseName(new Date("2026-10-28T22:00:05.123Z"))).toBe("snapshot-2026-10-28T22-00-05Z");
  });
});
