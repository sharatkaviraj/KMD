import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanRoots, scanSource, whereCell } from "../scripts/migrate/lib/env-scan.mjs";
import {
  ANNOTATIONS as ANNOTATIONS_RAW,
  APP_ROOTS,
  inventoryRows,
  namesFromVercelLs,
  renderInventory,
  VERCEL_PRODUCTION,
  vercelDrift,
} from "../scripts/migrate/env-names-diff.mjs";
import {
  columnProblems,
  compareTable,
  dataFileName,
  isMoneyColumn,
  RESTORE_KEEP,
  RESTORE_SAFE_STATE,
  restoreOrder,
  restoreSchemaName,
  restoreSelection,
  sortedDigest,
} from "../scripts/migrate/backup-one.mjs";
import { decideRestoreGuard } from "../scripts/migrate/lib/guards.mjs";
import { COLD_ROUTES, coldRouteVerdict, probeOrigin, probeVerdict } from "../scripts/migrate/health.mjs";

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

describe("backup-one --restore: the pure parts", () => {
  const manifest = {
    tables: [
      { schema: "public", table: "students", columns: [] },
      { schema: "public", table: "app_settings", columns: [] },
      { schema: "vppsone", table: "deployment", columns: [] },
      { schema: "vppsone", table: "migration_runs", columns: [] },
      { schema: "vppsone", table: "staff_profiles", columns: [] },
    ],
  };

  it("restores both schemas by default, never the marker or the run record", () => {
    const all = restoreSelection(manifest);
    expect(all.selected.map((t) => `${t.schema}.${t.table}`)).toEqual(["public.students", "public.app_settings", "vppsone.staff_profiles"]);
    expect(all.kept.sort()).toEqual(Object.keys(RESTORE_KEEP).sort());
    expect(restoreSelection(manifest, { schemas: ["public"] }).selected).toHaveLength(2);
    expect(restoreSelection(manifest, { tables: ["vppsone.staff_profiles"] }).selected.map((t) => t.table)).toEqual(["staff_profiles"]);
    expect(() => restoreSelection(manifest, { tables: ["public.nope"] })).toThrow(/Not in the backup/);
    expect(() => restoreSelection(manifest, { schemas: ["auth"] })).toThrow(/--schema/);
  });

  it("refills parents first and breaks live's installments cycle on a nullable key, by name", () => {
    const fks = [
      { name: "installments_student_id_fkey", child: "public.installments", parent: "public.students", childCols: ["student_id"], nullable: false },
      { name: "installments_carry_forward_balance_id_fkey", child: "public.installments", parent: "public.student_carry_forward_balances", childCols: ["carry_forward_balance_id"], nullable: true },
      { name: "student_carry_forward_balances_backing_installment_id_fkey", child: "public.student_carry_forward_balances", parent: "public.installments", childCols: ["backing_installment_id"], nullable: true },
      { name: "student_carry_forward_balances_import_row_id_fkey", child: "public.student_carry_forward_balances", parent: "public.prev_year_import_rows", childCols: ["import_row_id"], nullable: true },
      { name: "prev_year_import_rows_applied_installment_id_fkey", child: "public.prev_year_import_rows", parent: "public.installments", childCols: ["applied_installment_id"], nullable: true },
      { name: "student_repayment_plans_superseded_by_plan_id_fkey", child: "public.student_repayment_plans", parent: "public.student_repayment_plans", childCols: ["superseded_by_plan_id"], nullable: true },
      { name: "outside", child: "public.students", parent: "auth.users", childCols: ["created_by"], nullable: true },
    ];
    const tables = ["public.students", "public.installments", "public.student_carry_forward_balances", "public.prev_year_import_rows", "public.student_repayment_plans"];
    const { order, deferred } = restoreOrder(tables, fks);
    expect(deferred.map((fk) => fk.name)).toEqual(["installments_carry_forward_balance_id_fkey"]);
    const at = (t: string) => order.indexOf(t);
    expect(order).toHaveLength(tables.length);
    expect(at("public.students")).toBeLessThan(at("public.installments"));
    expect(at("public.installments")).toBeLessThan(at("public.prev_year_import_rows"));
    expect(at("public.prev_year_import_rows")).toBeLessThan(at("public.student_carry_forward_balances"));
    // A cycle with no nullable key cannot be refilled: refused, never guessed.
    expect(() =>
      restoreOrder(["s.a", "s.b"], [
        { name: "a_b", child: "s.a", parent: "s.b", childCols: ["b"], nullable: false },
        { name: "b_a", child: "s.b", parent: "s.a", childCols: ["a"], nullable: false },
      ]),
    ).toThrow(/NOT NULL/);
  });

  it("refuses a backed-up table today's columns cannot take", () => {
    const backedUp = { columns: [{ name: "id", type: "uuid" }, { name: "amount", type: "integer" }] };
    const col = (name: string, type: string, extra: Record<string, boolean> = {}) => ({ name, type, notNull: false, hasDefault: false, generated: false, ...extra });
    expect(columnProblems(backedUp, { columns: [col("id", "uuid"), col("amount", "integer"), col("note", "text")] })).toEqual([]);
    expect(columnProblems(backedUp, { columns: [col("id", "uuid"), col("amount", "integer"), col("flag", "boolean", { notNull: true, hasDefault: true })] })).toEqual([]);
    expect(columnProblems(backedUp, { columns: [col("id", "uuid")] })).toEqual(["column amount is gone"]);
    expect(columnProblems(backedUp, { columns: [col("id", "uuid"), col("amount", "bigint")] })).toEqual(["column amount is bigint, was integer"]);
    expect(columnProblems(backedUp, { columns: [col("id", "uuid"), col("amount", "integer"), col("must", "text", { notNull: true })] })).toEqual([
      "new column must is NOT NULL without a default",
    ]);
    expect(columnProblems(backedUp, undefined)).toEqual(["the table no longer exists"]);
  });

  it("compares content as a set when a second pass reordered the rows", () => {
    const a = Buffer.from("1\tx\n2\ty\n3\tz\n");
    const b = Buffer.from("2\ty\n3\tz\n1\tx\n");
    expect(sortedDigest(a)).toBe(sortedDigest(b));
    expect(sortedDigest(a)).not.toBe(sortedDigest(Buffer.from("1\tx\n2\ty\n")));
    expect(sortedDigest(Buffer.from(""))).toBe(sortedDigest(Buffer.alloc(0)));
  });

  it("never switches anything on: fee writes false and both dispatches off after any restore", () => {
    expect(RESTORE_SAFE_STATE.map((s) => s.table)).toEqual(["public.app_settings", "vppsone.runtime_flags"]);
    expect(RESTORE_SAFE_STATE[0].sql).toContain("'fee_writes_enabled', 'false'");
    expect(RESTORE_SAFE_STATE[1].sql).toContain("set enabled = false where key in ('parent_dispatch', 'staff_notice_dispatch')");
  });

  it("the guard: never after the cutover line; --apply only on production with fee writes shut", () => {
    expect(decideRestoreGuard({ environment: "production", hasCutover: false, feeWritesOpen: false }).ok).toBe(true);
    expect(decideRestoreGuard({ environment: "production", hasCutover: true, feeWritesOpen: false }).ok).toBe(false);
    expect(decideRestoreGuard({ environment: "production", hasCutover: true, feeWritesOpen: false, rollbackOnly: true }).ok).toBe(false);
    expect(decideRestoreGuard({ environment: "dev", hasCutover: false, feeWritesOpen: false }).ok).toBe(false);
    expect(decideRestoreGuard({ environment: "production", hasCutover: false, feeWritesOpen: true }).ok).toBe(false);
    expect(decideRestoreGuard({ environment: "production", hasCutover: false, feeWritesOpen: null }).ok).toBe(false);
    // A rehearsal rolls back: the marker and fee-writes guards are lifted.
    expect(decideRestoreGuard({ environment: "dev", hasCutover: false, feeWritesOpen: true, rollbackOnly: true }).ok).toBe(true);
  });

  it("writes in one transaction: locks before the guard, TRUNCATE not session_replication_role, orphans and the record", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/migrate/backup-one.mjs"), "utf8");
    const write = source.slice(source.indexOf("async function writeRestore"), source.indexOf("async function restore("));
    expect(write.indexOf("in access exclusive mode")).toBeLessThan(write.indexOf("decideRestoreGuard("));
    expect(write).toContain("set local lock_timeout = '10s'");
    expect(write).toContain("truncate table");
    expect(write).not.toMatch(/set (local )?session_replication_role/);
    expect(write).toContain("set constraints all immediate");
    expect(write).toContain("orphans after the restore");
    expect(write).toContain("'backup-one-restore', 'rollback'");
    expect(write).toContain("throw new RestoreRehearsal(outcome)");
    // load-snapshot then counts an undone load as not applied.
    const guards = readFileSync(path.join(process.cwd(), "scripts/migrate/lib/guards.mjs"), "utf8");
    expect(guards).toContain("u.script = 'backup-one-restore' and u.kind = 'rollback'");
  });
});

describe("env-names-diff --vercel", () => {
  it("keeps names only from the CLI's table, and reports drift both ways", () => {
    const text = [
      "Vercel CLI 50.0.0",
      "> Environment Variables found for team/vppsone [200ms]",
      "",
      " name                 value               environments        created",
      " CRON_SECRET          Encrypted           Production          30d ago",
      " NEXT_PUBLIC_SITE_URL Encrypted           Production          30d ago",
      " NAME                 Encrypted           Production          1d ago",
    ].join("\n");
    expect(namesFromVercelLs(text)).toEqual(["CRON_SECRET", "NEXT_PUBLIC_SITE_URL"]);
    expect(vercelDrift(["A", "B"], ["B", "C"])).toEqual({ added: ["C"], removed: ["A"] });
    expect(vercelDrift(VERCEL_PRODUCTION.one, [...VERCEL_PRODUCTION.one])).toEqual({ added: [], removed: [] });
  });
});

describe("health --probe: the test-only doors refuse a stranger", () => {
  it("a refusal is 401/403/404/405 or a redirect to sign-in or the lab's end page; anything else is not", () => {
    expect(coldRouteVerdict(404).ok).toBe(true);
    expect(coldRouteVerdict(405).ok).toBe(true);
    expect(coldRouteVerdict(307, "https://one.vpps.co.in/login?next=%2Flogin%2Ftest%2Fclock").ok).toBe(true);
    expect(coldRouteVerdict(307, "/lab/ended?reason=invalid").ok).toBe(true);
    expect(coldRouteVerdict(307, "/dashboard").ok).toBe(false);
    expect(coldRouteVerdict(200).ok).toBe(false);
    expect(COLD_ROUTES).toEqual(expect.arrayContaining(["/login/test", "/login/dayrun", "/lab/enter"]));
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
