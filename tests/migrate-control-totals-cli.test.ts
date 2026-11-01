import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repoRoot } from "../scripts/migrate/lib/env.mjs";

describe("control-totals CLI compares every supplied session", () => {
  // Keep private operator/test output outside the checkout, on its drive.
  const home = mkdtempSync(path.join(path.dirname(repoRoot), "vppsone-totals-test-"));
  const run = "test-totals-20261101";
  const runPath = path.join(home, run);
  mkdirSync(runPath);
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  const summary = { headcount: { studentsOnRoll: 2 }, money: { studentCount: 2, totalExpectedFees: 100, totalPaid: 40, totalFeesPending: 60 } };
  const totals = { "2026-27": summary, "TEST-2026-27": summary };

  function runCli(mcp?: unknown, extracted: object = totals) {
    writeFileSync(path.join(runPath, "control-totals.json"), JSON.stringify(extracted));
    const args = ["scripts/migrate/control-totals.mjs", "--run", run];
    if (mcp !== undefined) {
      const file = path.join(home, "mcp.json");
      writeFileSync(file, JSON.stringify(mcp));
      args.push("--mcp", file);
    }
    return spawnSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, VPPSONE_MIGRATION_HOME: home },
    });
  }

  it("exits nonzero if an extracted session has no MCP comparison", () => {
    const result = runCli({ "2026-27": summary });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("no figures for TEST-2026-27");
  });

  it("exits nonzero if a supplied MCP session has no extracted totals", () => {
    const result = runCli(totals, { "2026-27": summary });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("session TEST-2026-27 is missing from the extract");
  });

  it("passes only when all provided sessions match", () => {
    const result = runCli(totals);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.match(/MATCH on every field/g)).toHaveLength(2);
  });

  it("still fails for a numerical difference", () => {
    const result = runCli({ ...totals, "TEST-2026-27": { ...summary, money: { ...summary.money, totalPaid: 41 } } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("MISMATCH money.totalPaid");
  });

  it.each([null, []])("refuses a malformed MCP comparison: %j", (mcp) => {
    const result = runCli(mcp);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("object keyed by session label");
  });

  it("keeps print-only mode available without claiming a comparison", () => {
    const result = runCli();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("TEST-2026-27: on roll 2");
    expect(result.stdout).not.toContain("MATCH");
  });
});
