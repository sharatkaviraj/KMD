#!/usr/bin/env node
/**
 * The receipt-band preflight before cutover steps C3 (first posting in One)
 * and C7 (online switches on). Read-only on One's database; writes nothing.
 *
 *   node scripts/migrate/online-preflight.mjs
 *
 * Exit 0 when `app_settings.receipt_suffix_floor = '5000'` and
 * `vppsone.receipt_suffix_floor()` returns 5000; exit 2 otherwise — the
 * operator does not go on to C3/C7 (docs/cutover/RAZORPAY.md §4). The rule
 * is `lib/online-preflight.mjs#receiptFloorVerdict`.
 */

import process from "node:process";

import { isMain, loadOneEnv } from "./lib/env.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { receiptFloorVerdict } from "./lib/online-preflight.mjs";

async function main() {
  const sql = await openOneDb(loadOneEnv());
  let verdict;
  try {
    verdict = await sql.begin("read only", async (tx) => {
      const [setting] = await tx`select value from public.app_settings where key = 'receipt_suffix_floor'`;
      let functionValue;
      try {
        // A savepoint, so a refusal (VPP02) does not end the read-only transaction.
        const [row] = await tx.savepoint((sp) => sp`select vppsone.receipt_suffix_floor() as floor`);
        functionValue = row?.floor;
      } catch (error) {
        functionValue = error instanceof Error ? error : new Error(String(error));
      }
      return receiptFloorVerdict({ settingValue: setting?.value ?? null, functionValue });
    });
  } finally {
    await sql.end();
  }
  for (const problem of verdict.problems) console.log(`  NO-GO ${problem}`);
  console.log(`online-preflight: ${verdict.ok ? "GO — One numbers its receipts from 5001" : "NO-GO — set the floor before C3/C7"}.`);
  if (!verdict.ok) process.exit(2);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`online-preflight: ${error.message}`);
    process.exit(1);
  });
}
