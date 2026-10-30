#!/usr/bin/env node
/**
 * Bring what the fees app wrote after the cutover watermark into One —
 * insert-only (plan §7.8, §12.1; critique0 #6, #7, #8, #11; critique1 A7, B12).
 *
 *   node scripts/migrate/tail-sync.mjs                      # dry run (default)
 *   node scripts/migrate/tail-sync.mjs --apply              # write
 *     --watermark <run-id>   read after that extract's watermark (dry runs, rehearsals)
 *     --allow-dev-target     a rehearsal on a target not marked production
 *
 * Feed: the fees `audit_logs` after the watermark, unioned with a timestamp
 * scan of every table (lib/tail-feed.mjs) — the online, WhatsApp, outbox and
 * waiver tables are not audited by the fees app. Read through the sealed
 * client only.
 *
 * What it writes in One, in one transaction, through a normal postgres
 * session (no trigger is disabled, nothing is deleted, no row is updated
 * except an event's twin):
 *   - fees receipts -> vppsone.tail_receipts_review (one row per fees receipt,
 *     idempotent), with their payments, order lines and captures as evidence.
 *     Never raw receipts or payments rows (critique0 #8).
 *   - online_payment_events -> upsert on provider_event_id, the fees row wins
 *     (Razorpay sends every event to both webhooks — critique1 A7), after the
 *     terminal rule (pending/failed -> ignored).
 *   - online_payment_orders / _intents / unpaid order lines -> inserted when
 *     absent, after the terminal rules.
 *   - whatsapp_reminder_sends / school_notice_sends -> inserted when absent,
 *     every kind, so One's cadence and same-day checks see the fees sends
 *     (critique0 #11). A send whose receipt is not in One is deferred.
 *   - notification_outbox -> NEVER (critique0 #3).
 * Everything else the fees app wrote is reported as an ALERT, and the exit
 * code is 2: someone is still working in the fees app.
 *
 * Guards: --apply only after a cutover row exists in vppsone.migration_runs
 * (the watermark is the cutover load's) and only on production. Writes a
 * migration_runs row. Output: counts only.
 */

import process from "node:process";

import { isMain, loadFeesSecrets, loadOneEnv, parseArgs } from "./lib/env.mjs";
import { openFeesReadOnly } from "./lib/fees-readonly.mjs";
import { decideTailGuard, readGuardState } from "./lib/guards.mjs";
import { importTransform } from "./lib/import-rules.mjs";
import { relationsFromOpenApi } from "./lib/live-read.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { ident, prepareTransaction } from "./lib/one-target.mjs";
import { classifyTailChange, reviewRow, tailAction } from "./lib/tail.mjs";
import { collectFeesChanges } from "./lib/tail-feed.mjs";
import { resolveWatermark } from "./lib/watermark.mjs";
import { FEES_SOURCE_PROJECT_REF, ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";

const INSERTABLE = ["online_payment_orders", "online_payment_intents", "online_payment_order_lines", "whatsapp_reminder_sends", "school_notice_sends"];

async function existingIds(sql, table, ids) {
  const have = new Set();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await sql.unsafe(`select id::text from public.${ident(table)} where id::text = any($1::text[])`, [ids.slice(i, i + 1000)]);
    for (const r of rows) have.add(r.id);
  }
  return have;
}

/** The whole plan, from the feed and what One holds. Read-only on both sides. */
async function plan(sql, changes) {
  const live = (table) => [...(changes.get(table)?.rows.values() ?? [])].filter(Boolean);
  const receipts = live("receipts");
  const receiptModes = new Map(receipts.map((r) => [String(r.id), r.payment_mode]));

  const allReceiptRefs = new Set();
  for (const table of ["online_payment_order_lines", "whatsapp_reminder_sends", "school_notice_sends"]) {
    for (const row of live(table)) if (row.receipt_id) allReceiptRefs.add(String(row.receipt_id));
  }
  const receiptsInOne = await existingIds(sql, "receipts", [...allReceiptRefs]);

  const alerts = {};
  const actions = { review: [], upsert: [], insert: {}, skip: {}, defer: {}, evidence: {} };
  for (const [table, entry] of changes) {
    const ids = [...entry.rows.keys()];
    const inOne = INSERTABLE.includes(table) ? await existingIds(sql, table, ids) : new Set();
    for (const [key, row] of entry.rows) {
      const ops = entry.ops.get(key) ?? new Set();
      const op = row === null ? "DELETE" : ops.has("INSERT") ? "INSERT" : "UPDATE";
      const verdict = classifyTailChange(table, row, { op, receiptModes });
      if (!verdict.expected) {
        alerts[table] ??= {};
        alerts[table][verdict.why] = (alerts[table][verdict.why] ?? 0) + 1;
      }
      if (row === null) continue;
      const action = tailAction(table, row, { existsInOne: inOne.has(key), receiptInOne: (id) => receiptsInOne.has(String(id)) });
      if (action === "review") actions.review.push(row);
      else if (action === "upsert") actions.upsert.push(row);
      else (actions[action][table] ??= []).push(row);
    }
  }
  return { alerts, actions, evidence: { payments: live("payments"), lines: live("online_payment_order_lines"), captures: live("online_payment_captures") } };
}

function counts(actions) {
  const sizes = (group) => Object.fromEntries(Object.entries(group).map(([t, rows]) => [t, rows.length]));
  return { review: actions.review.length, upsertEvents: actions.upsert.length, insert: sizes(actions.insert), skip: sizes(actions.skip), defer: sizes(actions.defer), evidence: sizes(actions.evidence) };
}

async function insertRows(tx, table, rows) {
  let inserted = 0;
  const columns = (await tx`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER'`).map((r) => r.column_name);
  for (const raw of rows) {
    const { row, action } = importTransform(table, raw);
    if (action === "dropped") continue;
    const cols = columns.filter((c) => c in row);
    const result = await tx.unsafe(
      `insert into public.${ident(table)} (${cols.map(ident).join(", ")})
       select ${cols.map(ident).join(", ")} from jsonb_populate_record(null::public.${ident(table)}, $1::jsonb)
       on conflict do nothing`,
      [JSON.stringify(row)],
    );
    inserted += result.count;
  }
  return inserted;
}

async function upsertEvents(tx, rows) {
  let n = 0;
  const columns = (await tx`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'online_payment_events' and is_generated = 'NEVER'`).map((r) => r.column_name);
  for (const raw of rows) {
    const { row } = importTransform("online_payment_events", raw);
    const cols = columns.filter((c) => c in row && c !== "id");
    const result = await tx.unsafe(
      `insert into public.online_payment_events (${cols.map(ident).join(", ")})
       select ${cols.map(ident).join(", ")} from jsonb_populate_record(null::public.online_payment_events, $1::jsonb)
       on conflict (provider_event_id) do update set ${cols.filter((c) => c !== "provider_event_id").map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`,
      [JSON.stringify(row)],
    );
    n += result.count;
  }
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  const fees = openFeesReadOnly(loadFeesSecrets());
  const sql = await openOneDb(loadOneEnv());
  try {
    const watermark = await sql.begin("read only", (tx) => resolveWatermark({ watermarkRun: typeof args.watermark === "string" ? args.watermark : null, sql: tx }));
    console.log(`tail-sync: ${apply ? "APPLY" : "dry run"}; watermark from ${watermark.source}: change ${watermark.newestChangeAt}, audit ${watermark.auditMaxCreatedAt}.`);

    const { tables } = relationsFromOpenApi(await fees.openApi());
    const changes = await collectFeesChanges(fees, tables, watermark);
    const result = await sql.begin("read only", async (tx) => {
      await prepareTransaction(tx);
      return plan(tx, changes);
    });
    const summary = counts(result.actions);
    console.log(`tail-sync: ${summary.review} fees receipt(s) for review; ${summary.upsertEvents} event(s) to upsert; insert ${JSON.stringify(summary.insert)}; already in One ${JSON.stringify(summary.skip)}; deferred ${JSON.stringify(summary.defer)}; evidence ${JSON.stringify(summary.evidence)}.`);
    const alertTables = Object.keys(result.alerts);
    for (const table of alertTables) console.log(`  ALERT ${table}: ${Object.entries(result.alerts[table]).map(([why, n]) => `${why} ${n}`).join(", ")}`);

    if (!apply) {
      console.log("tail-sync: dry run, nothing written.");
      if (alertTables.length) process.exit(2);
      return;
    }

    const state = await sql.begin("read only", (tx) => readGuardState(tx));
    const guard = decideTailGuard({ ...state, allowDevTarget: Boolean(args["allow-dev-target"]) });
    if (!guard.ok) {
      console.error(`tail-sync: refusing --apply. ${guard.reasons.join(" ")}`);
      process.exit(1);
    }

    const [runRow] = await sql`
      insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at)
      values ('tail-sync', 'run', ${FEES_SOURCE_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${watermark.snapshotId ?? null}, ${watermark.newestChangeAt})
      returning id`;
    try {
      const written = await sql.begin(async (tx) => {
        await prepareTransaction(tx);
        const out = { review: 0, events: 0, inserted: {} };
        for (const receipt of result.actions.review) {
          const row = reviewRow(receipt, result.evidence, FEES_SOURCE_PROJECT_REF);
          const r = await tx`
            insert into vppsone.tail_receipts_review (source_project, fees_receipt_id, receipt_number, student_id, payment_date,
              payment_mode, total_amount, client_request_id, reference_number, fees_created_at, evidence, run_id)
            values (${row.source_project}, ${row.fees_receipt_id}, ${row.receipt_number}, ${row.student_id}, ${row.payment_date},
              ${row.payment_mode}, ${row.total_amount}, ${row.client_request_id}, ${row.reference_number}, ${row.fees_created_at},
              ${tx.json(row.evidence)}, ${runRow.id})
            on conflict (source_project, fees_receipt_id) do nothing`;
          out.review += r.count;
        }
        out.events = await upsertEvents(tx, result.actions.upsert);
        // Parents first: orders and intents before lines.
        for (const table of INSERTABLE) {
          if (result.actions.insert[table]) out.inserted[table] = await insertRows(tx, table, result.actions.insert[table]);
        }
        return out;
      });
      await sql`update vppsone.migration_runs set status = 'succeeded', finished_at = now(),
        summary = ${sql.json({ ...summary, written, alerts: result.alerts })} where id = ${runRow.id}`;
      console.log(`tail-sync: applied: ${written.review} review row(s), ${written.events} event(s), inserted ${JSON.stringify(written.inserted)}.`);
    } catch (error) {
      await sql`update vppsone.migration_runs set status = 'failed', finished_at = now(), note = ${String(error.message).slice(0, 900)} where id = ${runRow.id}`;
      throw error;
    }
    if (alertTables.length) process.exit(2);
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`tail-sync: ${error.message}`);
    process.exit(1);
  });
}
