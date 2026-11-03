#!/usr/bin/env node
/**
 * Everything One changed in the fee data since the cutover watermark, for a
 * rollback to the fees app (plan §12.3 step 5; critique1 A11, B12).
 * Read-only on One; never touches the fees database.
 *
 *   node scripts/migrate/rollback-export.mjs [--watermark <run-id>] [--since <iso>]
 *
 * Driven by One's own `public.audit_logs` (the fee triggers One inherited
 * write it for 42 tables, with before/after rows), plus a timestamp scan of
 * the tables the fee schema does not audit (receipts' online siblings,
 * WhatsApp sends, school notices, waivers, outbox, …), so nothing One posted
 * is missed — not only receipts:
 *   receipts and write-offs (payment_mode 'discount'), waivers, reversals and
 *   adjustments, refunds, EMI plans, family links, concessions and fee
 *   overrides, admissions / leavers / student edits, contacts and promises,
 *   reminder sends and notices, online payments.
 *
 * Output:
 *   terminal          counts per category and per table/action (no names)
 *   private folder    %USERPROFILE%\.vppsone-migration\rollback-<ts>\
 *                       detail.ndjson   one line per change (before/after rows)
 *                       detail.csv      procedure (R1…R12, docs/cutover/ROLLBACK-REENTRY.md),
 *                                       category, table, id, action, when, by — in re-entry order
 *                       summary.json    the counts
 * TEST-session changes are counted separately and are not part of the
 * re-entry list. Re-entering anything in the fees app is an owner-approved
 * step (Q16); this script only lists.
 *
 * Note (critique1 B12): the fees database kept changing on its own during the
 * parallel run (EMI late-fee cron, auto day close), so re-entry starts from the
 * fees app's current state, not from a frozen T0.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { readCatalog } from "./lib/catalog.mjs";
import { isMain, loadOneEnv, newRunId, parseArgs, runDir } from "./lib/env.mjs";
import { isTestSessionLabel } from "./lib/import-rules.mjs";
import { CHANGE_COLUMNS } from "./lib/live-read.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { ident, prepareTransaction } from "./lib/one-target.mjs";
import { afterWatermark } from "./lib/tail.mjs";
import { resolveWatermark } from "./lib/watermark.mjs";

/**
 * Each category's re-entry procedure in docs/cutover/ROLLBACK-REENTRY.md,
 * in the order they are re-entered (`R1` first). detail.csv carries the id,
 * so every line of the sheet points at the steps for it.
 */
export const ROLLBACK_PROCEDURES = {
  admissions: "R1",
  leavers: "R1",
  "student edits": "R1",
  "concessions and fee overrides": "R2",
  "family links": "R3",
  "EMI plans": "R4",
  receipts: "R5",
  "receipt allocations": "R5",
  "online payments": "R5",
  "write-offs": "R6",
  "late-fee waivers": "R7",
  "reversals and adjustments": "R8",
  refunds: "R9",
  "contacts and promises": "R10",
  "reminder sends and notices": "R11",
  other: "R12",
};

/** The procedure id for a category (R12, by hand, when unknown). Pure. */
export function rollbackProcedure(category) {
  return ROLLBACK_PROCEDURES[category] ?? "R12";
}

/** Which re-entry list a change belongs to. Pure. */
export function rollbackCategory(table, row, action, before) {
  switch (table) {
    case "receipts":
      return row?.payment_mode === "discount" ? "write-offs" : "receipts";
    case "payments":
      return "receipt allocations";
    case "student_late_fee_waivers":
      return "late-fee waivers";
    case "payment_adjustments":
    case "receipt_adjustments":
    case "receipt_finance_adjustments":
    case "payment_adjustment_reviews":
      return "reversals and adjustments";
    case "refund_requests":
      return "refunds";
    case "student_family_groups":
    case "student_family_members":
    case "family_payments":
      return "family links";
    case "student_conventional_discount_assignments":
    case "student_fee_overrides":
      return "concessions and fee overrides";
    case "students":
      if (action === "INSERT") return "admissions";
      if (before && row && before.left_on !== row.left_on) return "leavers";
      return "student edits";
    case "defaulter_contacts":
    case "defaulter_recovery_state":
    case "student_collection_flags":
      return "contacts and promises";
    case "whatsapp_reminder_sends":
    case "school_notice_sends":
    case "whatsapp_campaign_runs":
      return "reminder sends and notices";
    default:
      if (table.startsWith("student_repayment_")) return "EMI plans";
      if (table.startsWith("online_payment_")) return "online payments";
      return "other";
  }
}

/** Is this change about a TEST-session row? Pure. */
export function isTestChange(row, { testStudents, testClasses }) {
  if (!row) return false;
  for (const [column, value] of Object.entries(row)) {
    if (/(^|_)session_label$/.test(column) && isTestSessionLabel(value)) return true;
  }
  if (row.student_id && testStudents.has(String(row.student_id))) return true;
  if (row.class_id && testClasses.has(String(row.class_id))) return true;
  return false;
}

const SKIP_SCAN = new Set(["audit_logs", "workbook_materialized_view_refresh_queue", "office_sync_events", "backup_runs", "user_activity_events", "notion_sync_log"]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = await openOneDb(loadOneEnv());
  let collected;
  try {
    collected = await sql.begin("read only", async (tx) => {
      await prepareTransaction(tx);
      const watermark =
        typeof args.since === "string"
          ? { newestChangeAt: args.since, auditMaxCreatedAt: args.since, auditIdsAtMax: [], source: "--since" }
          : await resolveWatermark({ watermarkRun: typeof args.watermark === "string" ? args.watermark : null, sql: tx });
      const meta = await readCatalog(tx);

      const classes = await tx`select id::text, session_label from public.classes`;
      const testClasses = new Set(classes.filter((c) => isTestSessionLabel(c.session_label)).map((c) => c.id));
      const students = await tx`select id::text, class_id::text from public.students`;
      const testStudents = new Set(students.filter((s) => testClasses.has(s.class_id)).map((s) => s.id));

      const changes = [];
      const audit = await tx.unsafe(
        `select id::text, table_name, record_id::text, action::text, created_at, changed_by::text, before_data, after_data
         from public.audit_logs where created_at >= $1 order by created_at`,
        [watermark.auditMaxCreatedAt],
      );
      const audited = new Set();
      for (const a of audit) {
        const asText = { ...a, created_at: new Date(a.created_at).toISOString() };
        if (!afterWatermark(asText, watermark)) continue;
        audited.add(`${a.table_name}:${a.record_id}`);
        const row = a.after_data ?? a.before_data;
        changes.push({ source: "audit", table: a.table_name, id: a.record_id, action: String(a.action).toUpperCase(), at: asText.created_at, by: a.changed_by, before: a.before_data, after: a.after_data, row });
      }

      for (const [table, t] of Object.entries(meta.tables)) {
        if (SKIP_SCAN.has(table) || t.pk.length !== 1) continue;
        const columns = CHANGE_COLUMNS.filter((c) => t.columns.some((col) => col.name === c));
        if (!columns.length) continue;
        const where = columns.map((c) => `${ident(c)} > $1`).join(" or ");
        const rows = await tx.unsafe(`select to_jsonb(x)::text as j from public.${ident(table)} x where ${where}`, [watermark.newestChangeAt]);
        for (const { j } of rows) {
          const row = JSON.parse(j);
          const id = String(row[t.pk[0]]);
          if (audited.has(`${table}:${id}`)) continue;
          const created = row.created_at && Date.parse(row.created_at) > Date.parse(watermark.newestChangeAt);
          changes.push({ source: "scan", table, id, action: created ? "INSERT" : "UPDATE", at: row.updated_at ?? row.created_at ?? null, by: null, before: null, after: row, row });
        }
      }
      return { watermark, changes, testStudents, testClasses };
    });
  } finally {
    await sql.end();
  }

  const { watermark, changes, testStudents, testClasses } = collected;
  const summary = { watermark: { newestChangeAt: watermark.newestChangeAt, source: watermark.source }, categories: {}, perTable: {}, test: {} };
  const detail = [];
  for (const change of changes) {
    const test = isTestChange(change.row, { testStudents, testClasses }) || isTestChange(change.before, { testStudents, testClasses });
    const key = `${change.table}.${change.action}`;
    if (test) {
      summary.test[key] = (summary.test[key] ?? 0) + 1;
      continue;
    }
    const category = rollbackCategory(change.table, change.after ?? change.row, change.action, change.before);
    summary.categories[category] = (summary.categories[category] ?? 0) + 1;
    summary.perTable[key] = (summary.perTable[key] ?? 0) + 1;
    detail.push({ procedure: rollbackProcedure(category), category, ...change });
  }
  // In re-entry order (R1 … R12), then by time within a procedure.
  const rank = (p) => Number(String(p).slice(1));
  detail.sort((a, b) => rank(a.procedure) - rank(b.procedure) || String(a.at ?? "").localeCompare(String(b.at ?? "")));

  const dir = runDir(`rollback-${newRunId()}`);
  writeFileSync(path.join(dir, "detail.ndjson"), detail.map((d) => JSON.stringify(d)).join("\n") + (detail.length ? "\n" : ""));
  const csv = ["procedure,category,table,id,action,at,by,source", ...detail.map((d) => [d.procedure, d.category, d.table, d.id, d.action, d.at ?? "", d.by ?? "", d.source].join(","))];
  writeFileSync(path.join(dir, "detail.csv"), csv.join("\n") + "\n");
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`rollback-export: changes in One since ${watermark.newestChangeAt} (${watermark.source}); read-only.`);
  for (const [category, n] of Object.entries(summary.categories).sort()) console.log(`  ${category}: ${n}`);
  for (const [key, n] of Object.entries(summary.perTable).sort()) console.log(`    ${key}: ${n}`);
  const testTotal = Object.values(summary.test).reduce((a, b) => a + b, 0);
  console.log(`  TEST-session changes (not for re-entry): ${testTotal}`);
  console.log(`rollback-export: detail sheet written to the private folder ${path.basename(dir)}.`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`rollback-export: ${error.message}`);
    process.exit(1);
  });
}
