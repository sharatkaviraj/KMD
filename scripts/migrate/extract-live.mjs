#!/usr/bin/env node
/**
 * Copy the fees app's live data out, read-only (plan §2.2; D-339; I-3, I-5).
 *
 *   node scripts/migrate/extract-live.mjs                 # every public table + views + auth
 *   node scripts/migrate/extract-live.mjs --run <id>      # name the run folder
 *   node scripts/migrate/extract-live.mjs --tables a,b    # a subset (rehearsal only)
 *   node scripts/migrate/extract-live.mjs --no-auth       # skip auth users
 *
 * Reads `vgqyilgstjvgohrsiwkb` only through lib/fees-readonly.mjs (REST,
 * sealed to select / storage reads). Nothing in this file can write anywhere
 * but the private run folder.
 *
 * Output — `%USERPROFILE%\.vppsone-migration\<run>\` (outside the repo):
 *   tables/<t>.ndjson         every row of every public base table, by primary key
 *   views/<v>.ndjson          v_workbook_student_financials, v_online_payment_reconciliation
 *   secrets/auth-users.json.enc   auth.users + identities for public.users ids,
 *                             AES-GCM sealed (lib/secrets-box.mjs); deleted after a load
 *   control-totals.json       per session, the MCP's own definitions (lib/control-totals.mjs)
 *   manifest.json             tables, columns, keys, counts, ordered md5s, the watermark
 *
 * Consistency: fingerprint (counts + max change timestamps + newest audit row)
 * before and after; the read is repeated until the two are equal
 * (`--max-attempts`, default 5). The watermark is the stable fingerprint: the
 * newest change timestamp over all tables and the newest audit_logs row
 * (created_at + the ids at that instant). audit_logs ids are uuids, so the
 * timestamp, not the id, orders the tail (tail-sync.mjs).
 *
 * The terminal gets counts, sums and hashes only.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { sessionMoneySummary } from "./lib/control-totals.mjs";
import { isMain, loadFeesSecrets, newRunId, parseArgs, runDir } from "./lib/env.mjs";
import { openFeesReadOnly } from "./lib/fees-readonly.mjs";
import {
  auditWatermark,
  EXTRACT_VIEWS,
  fingerprintDrift,
  liveFingerprint,
  readAllRows,
  relationsFromOpenApi,
  writeNdjson,
} from "./lib/live-read.mjs";
import { orderedMd5 } from "./lib/rows.mjs";
import { writeSecretJson } from "./lib/secrets-box.mjs";
import { FEES_SOURCE_PROJECT_REF } from "../target-guard.mjs";

/** The newest of every change timestamp in a fingerprint. Pure. */
export function newestChange(fingerprint) {
  let newest = null;
  for (const entry of Object.values(fingerprint ?? {})) {
    for (const value of Object.values(entry.max ?? {})) {
      if (value && (!newest || Date.parse(value) > Date.parse(newest))) newest = value;
    }
  }
  return newest;
}

/** Only the auth users behind public.users, with their identities. Pure. */
export function pickAuthUsers(authUsers, publicUserIds) {
  const wanted = new Set(publicUserIds.map(String));
  return authUsers.filter((user) => wanted.has(String(user.id)));
}

async function listAllAuthUsers(fees) {
  const out = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await fees.authAdmin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth list: ${error.message}`);
    out.push(...(data?.users ?? []));
    if ((data?.users ?? []).length < 1000) return out;
  }
  throw new Error("auth list did not end.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = typeof args.run === "string" ? args.run : newRunId();
  const run = runDir(runId);
  const maxAttempts = Number(args["max-attempts"] ?? 5);
  const startedAt = new Date().toISOString();

  const fees = openFeesReadOnly(loadFeesSecrets());
  const { tables: allTables, views: allViews } = relationsFromOpenApi(await fees.openApi());
  const only = typeof args.tables === "string" ? new Set(args.tables.split(",")) : null;
  const tables = only ? allTables.filter((t) => only.has(t.name)) : allTables;
  const keyless = tables.filter((t) => t.pk.length === 0);
  if (keyless.length) throw new Error(`Tables without a primary key cannot be extracted: ${keyless.map((t) => t.name).join(", ")}.`);
  const views = allViews.filter((v) => EXTRACT_VIEWS.includes(v.name));

  console.log(`extract-live: run ${runId}, ${tables.length} tables, ${views.length} views, from ${FEES_SOURCE_PROJECT_REF} (read-only).`);

  let result = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const before = await liveFingerprint(fees, tables);
    const auditBefore = tables.some((t) => t.name === "audit_logs") ? await auditWatermark(fees) : null;

    const tableEntries = [];
    for (const table of tables) {
      const rows = await readAllRows(fees, table.name, table.pk);
      writeNdjson(path.join(run, "tables", `${table.name}.ndjson`), rows);
      tableEntries.push({
        name: table.name,
        pk: table.pk,
        columns: table.columns,
        changeColumns: table.changeColumns,
        rowCount: rows.length,
        md5: orderedMd5(rows, table.pk),
      });
      if (table.name === "users") result = { ...(result ?? {}), publicUserIds: rows.map((r) => r.id) };
    }
    const viewEntries = [];
    const viewRows = {};
    for (const view of views) {
      const rows = await readAllRows(fees, view.name, view.pk);
      writeNdjson(path.join(run, "views", `${view.name}.ndjson`), rows);
      viewRows[view.name] = rows;
      viewEntries.push({ name: view.name, pk: view.pk, rowCount: rows.length, md5: orderedMd5(rows, view.pk.length ? view.pk : view.columns.slice(0, 1)) });
    }

    const after = await liveFingerprint(fees, tables);
    const auditAfter = auditBefore ? await auditWatermark(fees) : null;
    const moved = fingerprintDrift(before, after);
    const auditMoved = JSON.stringify(auditBefore) !== JSON.stringify(auditAfter);
    const countMismatch = tableEntries.filter((t) => after[t.name]?.count !== t.rowCount).map((t) => t.name);

    if (!moved.length && !auditMoved && !countMismatch.length) {
      result = { ...result, attempt, fingerprint: after, audit: auditAfter, tableEntries, viewEntries, viewRows };
      break;
    }
    console.log(
      `extract-live: attempt ${attempt} not stable (moved: ${[...moved, ...countMismatch].join(", ") || "-"}${auditMoved ? "; audit_logs moved" : ""}); reading again.`,
    );
    if (attempt === maxAttempts) throw new Error(`The live data kept changing for ${maxAttempts} attempts; try again when the desk is quiet.`);
  }

  // Auth: secrets, sealed, only the users public.users names.
  let auth = { users: 0, identities: 0 };
  if (!args["no-auth"] && result.publicUserIds) {
    const users = pickAuthUsers(await listAllAuthUsers(fees), result.publicUserIds);
    // The list leaves identities out; one read per user brings them.
    for (const user of users) {
      if (Array.isArray(user.identities) && user.identities.length) continue;
      const { data, error } = await fees.authAdmin.getUserById(user.id);
      if (error) throw new Error(`auth read: ${error.message}`);
      user.identities = data?.user?.identities ?? [];
    }
    writeSecretJson(run, "auth-users", users);
    auth = { users: users.length, identities: users.reduce((n, u) => n + (u.identities?.length ?? 0), 0), missing: result.publicUserIds.length - users.length };
  }

  // Control totals per session, as the MCP computes them.
  const financial = result.viewRows.v_workbook_student_financials ?? [];
  const sessions = [...new Set(financial.map((r) => r.session_label))].filter(Boolean);
  const controlTotals = Object.fromEntries(sessions.map((label) => [label, sessionMoneySummary(financial, label)]));
  writeFileSync(path.join(run, "control-totals.json"), JSON.stringify(controlTotals, null, 2));

  const watermark = {
    newestChangeAt: newestChange(result.fingerprint),
    auditMaxCreatedAt: result.audit?.auditMaxCreatedAt ?? null,
    auditIdsAtMax: result.audit?.auditIdsAtMax ?? [],
    snapshotId: `rest:${runId}`,
  };
  const manifest = {
    run: runId,
    sourceProject: FEES_SOURCE_PROJECT_REF,
    extractor: "rest",
    startedAt,
    finishedAt: new Date().toISOString(),
    attempts: result.attempt,
    watermark,
    fingerprint: result.fingerprint,
    tables: result.tableEntries,
    views: result.viewEntries,
    auth,
  };
  writeFileSync(path.join(run, "manifest.json"), JSON.stringify(manifest, null, 2));

  const totalRows = result.tableEntries.reduce((n, t) => n + t.rowCount, 0);
  console.log(`extract-live: stable on attempt ${result.attempt}; ${result.tableEntries.length} tables, ${totalRows} rows; auth users ${auth.users} (identities ${auth.identities}).`);
  console.log(`extract-live: watermark newest change ${watermark.newestChangeAt}, audit ${watermark.auditMaxCreatedAt} (${watermark.auditIdsAtMax.length} row(s) at that instant).`);
  for (const [label, summary] of Object.entries(controlTotals)) {
    const m = summary.money;
    console.log(
      `  ${label}: on roll ${summary.headcount.studentsOnRoll}, collectable ${m.studentCount}, expected ${m.totalExpectedFees}, paid ${m.totalPaid}, fees pending ${m.totalFeesPending}, late fee charged/waived/pending ${m.totalLateFeeCharged}/${m.totalLateFeeWaived}/${m.totalLateFeePending}, discount ${m.totalDiscount}, closeouts ${m.totalDiscountCloseouts}`,
    );
  }
  console.log(`extract-live: written to the private run folder ${runId} (never commit it).`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`extract-live: ${error.message}`);
    process.exit(1);
  });
}
