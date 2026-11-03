#!/usr/bin/env node
/**
 * Print a run's control totals, and compare them with the fees MCP.
 *
 *   node scripts/migrate/control-totals.mjs --run <id>
 *   node scripts/migrate/control-totals.mjs --run <id> --mcp <file.json>
 *
 * `<file.json>` holds what the fees MCP tool `get_session_money_summary`
 * returned, keyed by session label: `{ "2026-27": { headcount, money }, … }`
 * (the tool's own payload, or just those two blocks). The MCP is called by the
 * operator — this script never reaches the fees database or the MCP itself.
 *
 * Exit 1 on any field that differs. Money totals and counts only.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { compareWithMcp } from "./lib/control-totals.mjs";
import { isMain, latestRunId, parseArgs, runDir } from "./lib/env.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = typeof args.run === "string" ? args.run : latestRunId();
  if (!runId) throw new Error("No extract run found; pass --run.");
  const file = path.join(runDir(runId, { create: false }), "control-totals.json");
  if (!existsSync(file)) throw new Error(`Run ${runId} has no control-totals.json.`);
  const ours = JSON.parse(readFileSync(file, "utf8"));

  let failed = false;
  const theirs = typeof args.mcp === "string" ? JSON.parse(readFileSync(args.mcp, "utf8")) : null;
  if (typeof args.mcp === "string" && (!theirs || typeof theirs !== "object" || Array.isArray(theirs))) {
    throw new Error("MCP figures must be an object keyed by session label.");
  }
  for (const [label, summary] of Object.entries(ours)) {
    const m = summary.money;
    console.log(
      `${label}: on roll ${summary.headcount.studentsOnRoll}; collectable ${m.studentCount}; expected ${m.totalExpectedFees}; paid ${m.totalPaid}; fees pending ${m.totalFeesPending}; late fee ${m.totalLateFeeCharged}/${m.totalLateFeeWaived}/${m.totalLateFeePending}; discount ${m.totalDiscount}; closeouts ${m.totalDiscountCloseouts}`,
    );
    if (!theirs) continue;
    if (!theirs[label]) {
      console.log(`  MCP: no figures for ${label} in the file.`);
      failed = true;
      continue;
    }
    const diffs = compareWithMcp(summary, theirs[label]);
    if (diffs.length === 0) console.log("  MCP: MATCH on every field.");
    else {
      failed = true;
      for (const d of diffs) console.log(`  MCP: MISMATCH ${d.field}: ours ${d.ours}, MCP ${d.theirs}`);
    }
  }
  if (theirs) {
    for (const label of Object.keys(theirs)) {
      if (Object.hasOwn(ours, label)) continue;
      console.log(`  MCP: session ${label} is missing from the extract.`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`control-totals: ${error.message}`);
    process.exit(1);
  });
}
