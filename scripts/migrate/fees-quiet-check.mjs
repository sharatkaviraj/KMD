#!/usr/bin/env node
/**
 * Is the fees app quiet? Read-only on both databases (plan §11 go/no-go,
 * §12.1; critique0 #4, #5, #6; critique1 B12).
 *
 *   node scripts/migrate/fees-quiet-check.mjs [--watermark <run-id>]
 *
 * Reports, counts only:
 *   - fees campaigns with schedule.auto = true (must be 0 before T0);
 *   - fees desk receipts (any mode but online) and their sum after the watermark;
 *   - fees reminder sends (notice_kind reminder / fee_statement) and school
 *     notices after the watermark;
 *   - online tail: receipts, captures waiting in the fees review screen;
 *   - open fees pay codes (Path A until pay_code_expires_on, Path B until
 *     created_at + 21 days) and the TAIL END DATE (lib/tail.mjs tailEnd):
 *     the later of the two, or "open-ended" while any pay code has no expiry;
 *   - every other fees write after the watermark outside the tail allow-list.
 * Exit 2 when anything that should be quiet is not.
 *
 * The watermark comes from One's last applied load (read-only), or
 * --watermark <run-id> for an extract.
 */

import process from "node:process";

import { isMain, loadFeesSecrets, loadOneEnv, parseArgs } from "./lib/env.mjs";
import { openFeesReadOnly } from "./lib/fees-readonly.mjs";
import { readAllRows, relationsFromOpenApi } from "./lib/live-read.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { classifyTailChange, tailEnd } from "./lib/tail.mjs";
import { collectFeesChanges } from "./lib/tail-feed.mjs";
import { resolveWatermark } from "./lib/watermark.mjs";

function todayIst() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fees = openFeesReadOnly(loadFeesSecrets());
  let watermark;
  if (typeof args.watermark === "string") {
    watermark = await resolveWatermark({ watermarkRun: args.watermark });
  } else {
    const sql = await openOneDb(loadOneEnv());
    try {
      watermark = await sql.begin("read only", (tx) => resolveWatermark({ sql: tx }));
    } finally {
      await sql.end();
    }
  }
  const asOf = todayIst();
  console.log(`fees-quiet-check: watermark from ${watermark.source} (${watermark.newestChangeAt}); today ${asOf} IST. Read-only.`);
  let noisy = false;

  // Automatic campaigns.
  const campaigns = await readAllRows(fees, "whatsapp_campaigns", ["id"]);
  const auto = campaigns.filter((c) => c?.schedule && (c.schedule.auto === true || c.schedule.auto === "true"));
  console.log(`  fees campaigns with schedule.auto: ${auto.length} of ${campaigns.length}`);
  if (auto.length) noisy = true;

  // The feed after the watermark.
  const { tables } = relationsFromOpenApi(await fees.openApi());
  const changes = await collectFeesChanges(fees, tables, watermark);
  const live = (t) => [...(changes.get(t)?.rows.values() ?? [])].filter(Boolean);
  const receipts = live("receipts");
  const desk = receipts.filter((r) => r.payment_mode !== "online");
  const online = receipts.filter((r) => r.payment_mode === "online");
  const sum = (rows) => rows.reduce((n, r) => n + Number(r.total_amount ?? 0), 0);
  console.log(`  fees desk receipts after watermark: ${desk.length} (sum ${sum(desk)})`);
  console.log(`  fees online receipts after watermark (the tail): ${online.length} (sum ${sum(online)})`);
  if (desk.length) noisy = true;

  const sends = live("whatsapp_reminder_sends").filter((s) => Date.parse(s.created_at) > Date.parse(watermark.newestChangeAt));
  const reminderSends = sends.filter((s) => !["receipt", "reversal"].includes(s.notice_kind));
  const notices = live("school_notice_sends").filter((s) => Date.parse(s.created_at) > Date.parse(watermark.newestChangeAt));
  console.log(`  fees reminder sends after watermark: ${reminderSends.length}; receipt notices ${sends.length - reminderSends.length}; school notices ${notices.length}`);
  if (reminderSends.length || notices.length) noisy = true;

  const captures = await readAllRows(fees, "online_payment_captures", ["id"]);
  const waiting = captures.filter((c) => c.application_status !== "applied");
  console.log(`  fees online captures not applied (fees review screen): ${waiting.length}`);

  // Pay codes and the tail end.
  const allSends = await readAllRows(fees, "whatsapp_reminder_sends", ["id"]);
  const tail = tailEnd(allSends, { asOf });
  console.log(
    `  open fees pay codes: Path A ${tail.openPathA} (latest expiry ${tail.pathAEnd ?? "-"}), Path B ${tail.openPathB} (latest ${tail.pathBEnd ?? "-"}), with no expiry ${tail.openEndedPayCodes}`,
  );
  console.log(`  TAIL END: ${tail.tailEnd ?? (tail.openEndedPayCodes ? "open-ended (pay codes without an expiry)" : "-")}. HDFC static-QR payments are a manual tail with no end date.`);

  // Everything else.
  const receiptModes = new Map(receipts.map((r) => [String(r.id), r.payment_mode]));
  const alerts = {};
  for (const [table, entry] of changes) {
    for (const [key, row] of entry.rows) {
      const ops = entry.ops.get(key) ?? new Set();
      const op = row === null ? "DELETE" : ops.has("INSERT") ? "INSERT" : "UPDATE";
      const verdict = classifyTailChange(table, row, { op, receiptModes });
      if (!verdict.expected) alerts[`${table}: ${verdict.why}`] = (alerts[`${table}: ${verdict.why}`] ?? 0) + 1;
    }
  }
  const alertKeys = Object.keys(alerts).sort();
  console.log(`  fees writes outside the tail allow-list: ${alertKeys.length ? "" : "none"}`);
  for (const key of alertKeys) console.log(`    ALERT ${key}: ${alerts[key]}`);
  if (alertKeys.length) noisy = true;

  console.log(`fees-quiet-check: ${noisy ? "NOT quiet" : "quiet"}.`);
  if (noisy) process.exit(2);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`fees-quiet-check: ${error.message}`);
    process.exit(1);
  });
}
