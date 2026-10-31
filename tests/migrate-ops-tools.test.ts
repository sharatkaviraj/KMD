import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanRoots, scanSource, whereCell } from "../scripts/migrate/lib/env-scan.mjs";
import { ANNOTATIONS as ANNOTATIONS_RAW, APP_ROOTS, inventoryRows, renderInventory, VERCEL_PRODUCTION } from "../scripts/migrate/env-names-diff.mjs";
import { compareTable, dataFileName, isMoneyColumn, restoreSchemaName } from "../scripts/migrate/backup-one.mjs";
import { probeOrigin, probeVerdict } from "../scripts/migrate/health.mjs";

const ANNOTATIONS = ANNOTATIONS_RAW as Record<string, string[] | undefined>;

/**
 * The go-live operations tools (Phase G): the env-name scan, the backup's
 * pure parts and the health probe's guard. No database, no network.
 */

describe("env-scan: which names a codebase reads", () => {
  it("finds every way the two repos read a variable", () => {
    const source = [
      "const a = process.env.ALPHA_ONE;",
      'const b = process.env["BRAVO_TWO"];',
      "const c = process.env?.CHARLIE;",
      "const { DELTA, ECHO: echo, FOXTROT = 'x' } = process.env;",
      'getOptionalEnvVar("GOLF_KEY"); getRequiredEnvVar(`HOTEL`);',
      "function f(env = process.env) { return env.RAZORPAY_KEY_ID?.trim(); }",
      'export const requiredEnvVars = ["INDIA_URL", "JULIET_KEY"] as const;',
      " * `process.env.NEXT_PUBLIC_*` is a family in a comment",
      "const notEnv = config.KILO;",
    ].join("\n");
    expect([...scanSource(source)].sort()).toEqual([
      "ALPHA_ONE",
      "BRAVO_TWO",
      "CHARLIE",
      "DELTA",
      "ECHO",
      "FOXTROT",
      "GOLF_KEY",
      "HOTEL",
      "INDIA_URL",
      "JULIET_KEY",
      "RAZORPAY_KEY_ID",
    ]);
  });

  it("shortens a long file list for a table cell", () => {
    expect(whereCell(undefined)).toBe("—");
    expect(whereCell(new Set(["b.ts", "a.ts", "c.ts", "d.ts"]))).toBe("`a.ts`, `b.ts` +2");
  });

  it("every name One's code reads has an owner and a status (a new one fails here before it reaches C5)", () => {
    const one: Map<string, Set<string>> = scanRoots(process.cwd(), APP_ROOTS);
    expect(one.size).toBeGreaterThan(20);
    const unsettled = [...one.keys()].filter((name) => !ANNOTATIONS[name]);
    expect(unsettled).toEqual([]);
    for (const name of [...VERCEL_PRODUCTION.one, ...VERCEL_PRODUCTION.fees]) expect(ANNOTATIONS[name], name).toBeDefined();
  });

  it("the inventory carries names only, and the critique's missing names are on it", () => {
    const rows = inventoryRows({ one: new Map(), fees: new Map() });
    const text: string = renderInventory(rows, [], { feesCommit: "8a0cd47c", date: "31 Oct 2026" });
    for (const name of [
      "NEXT_PUBLIC_SCHOOL_NAME",
      "NEXT_PUBLIC_SCHOOL_PHONE",
      "NEXT_PUBLIC_SCHOOL_ADDRESS",
      "NEXT_PUBLIC_SCHOOL_EMAIL",
      "REPAYMENT_PLANS",
      "AISENSY_CAMPAIGN_PREFIX",
      "AISENSY_WEBHOOK_SECRET",
      "LOCALE_SWITCHER_ENABLED",
      "SCHOOLFEES_DOC_TOKEN",
      "ANTHROPIC_API_KEY",
      "NEXT_PUBLIC_SENTRY_DSN",
      "VERCEL_OIDC_TOKEN",
      "QA_LOGIN_KEY",
    ]) {
      expect(ANNOTATIONS[name], name).toBeDefined();
    }
    expect(text).not.toMatch(/=\s*["']?[A-Za-z0-9_-]{20,}/);
  });

  it("the committed inventory lists every name One reads", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/cutover/ENV-INVENTORY.md"), "utf8");
    const one: Map<string, Set<string>> = scanRoots(process.cwd(), APP_ROOTS);
    for (const name of one.keys()) expect(doc, name).toContain(`| \`${name}\` |`);
    expect(doc).toContain("Unsettled names: none.");
  });
});

describe("backup-one: the pure parts", () => {
  it("sums only number columns named like money", () => {
    expect(isMoneyColumn({ name: "total_amount", type: "numeric(12,2)" })).toBe(true);
    expect(isMoneyColumn({ name: "amount_paise", type: "bigint" })).toBe(true);
    expect(isMoneyColumn({ name: "late_fee_waived", type: "integer" })).toBe(true);
    expect(isMoneyColumn({ name: "amount_note", type: "text" })).toBe(false);
    expect(isMoneyColumn({ name: "attempts", type: "integer" })).toBe(false);
  });

  it("names files and the throw-away schema safely", () => {
    expect(dataFileName("public", "receipts")).toBe("public.receipts.copy.gz");
    expect(() => dataFileName("public", "x; drop table y")).toThrow();
    const name = restoreSchemaName(new Date("2026-10-31T10:00:00Z"), "ab12");
    expect(name).toBe("restore_test_20261031_ab12");
    expect(name).not.toMatch(/^(public|vppsone)$/);
  });

  it("a restored table is equal only on rows, every money sum and the content hash", () => {
    const expected = { rows: 3, sums: { amount: "300" }, sha256: "h1" };
    expect(compareTable(expected, { rows: 3, sums: { amount: "300" }, sha256: "h1" })).toEqual([]);
    expect(compareTable(expected, { rows: 2, sums: { amount: "300" }, sha256: "h1" })).toEqual(["rows 3 → 2"]);
    expect(compareTable(expected, { rows: 3, sums: { amount: "299" }, sha256: "h1" })).toEqual(["sum(amount) 300 → 299"]);
    expect(compareTable(expected, { rows: 3, sums: {}, sha256: "h2" })).toEqual(["sum(amount) 300 → null", "content hash differs"]);
  });

  it("dumps through One's own connection only, read-only, into the private folder", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/migrate/backup-one.mjs"), "utf8");
    expect(source).toContain('import { openOneDb } from "./lib/one-db.mjs"');
    expect(source).toContain('sql.begin("isolation level repeatable read read only"');
    expect(source).toContain("runDir(runId)");
    expect(source).not.toMatch(/fees-readonly|vgqyilgstjvgohrsiwkb/);
    // The restore test drops its schema and rolls back.
    expect(source).toMatch(/drop schema \$\{quoteIdent\(schema\)\} cascade/);
    expect(source).toContain("throw ROLLBACK");
  });
});

describe("health: the webhook probe", () => {
  it("probes One's own hosts only", () => {
    expect(probeOrigin("https://one.vpps.co.in")).toBe("https://one.vpps.co.in");
    expect(probeOrigin("https://vpps-one.vercel.app/x")).toBe("https://vpps-one.vercel.app");
    expect(probeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of ["https://schoolfees-two.vercel.app", "https://fees.vpps.co.in", "http://one.vpps.co.in", "nonsense"]) {
      expect(() => probeOrigin(bad), bad).toThrow();
    }
  });

  it("only a 401 on a bad signature is healthy", () => {
    expect(probeVerdict(401).ok).toBe(true);
    expect(probeVerdict(404)).toMatchObject({ ok: false });
    expect(probeVerdict(200)).toMatchObject({ ok: false });
    expect(probeVerdict(500)).toMatchObject({ ok: false });
  });
});
