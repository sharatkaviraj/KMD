#!/usr/bin/env node
/**
 * Is One's copy equal to the fees app's data? Read-only on both sides
 * (plan §2.5; critique0 #18; critique1 A8).
 *
 *   node scripts/migrate/reconcile.mjs [--run <id>]     # One against the extract that was loaded
 *   node scripts/migrate/reconcile.mjs --live           # One against live, read now
 *     --as-of YYYY-MM-DD    the date both sides' late fees are evaluated at
 *     --no-storage          skip the bucket listing
 *     --allow-stale-matview go on (with a warning) when either side's matviews
 *                           are not of the as-of day
 *
 * The fees side is the run's NDJSON (default, the snapshot a load used) or a
 * fresh read through the sealed client (--live). One's side is one READ ONLY
 * transaction over lib/one-db.mjs.
 *
 * What "equal" means is decided by the same code the loader uses
 * (lib/diff.mjs planLoad, lib/import-rules.mjs): terminal-state rewrites
 * applied to the fees rows, One-owned settings left out, and — REAL SESSIONS
 * ONLY — TEST-session rows (either side) and protected rows (TEST-D- shells,
 * migration_id_map targets, everything keyed on them) excluded and counted
 * separately (critique0 #18).
 *
 * Checks (each OK or MISMATCH):
 *   1. every table: row count, an ordered md5, and the loader's diff (0/0/0);
 *   2. the session money summary per real session, the MCP's definitions;
 *   3. per-class rollups;
 *   4. a per-student checksum over v_workbook_student_financials (first 20
 *      differing student ids printed — ids, not names);
 *   5. receipts: count and sum per mode per date, highest suffix per
 *      (prefix, date), distinct numbers = rows;
 *   6. the online invariant: captured = on receipts + in review + waiting;
 *   7. WhatsApp: sends per status and kind, school notices, outbox;
 *   8. EMI late fees per session as their own line;
 *   9. storage: objects and bytes per copied bucket;
 *  10. live data One has no place for (tables with rows, columns) beyond the
 *      NOT_MIGRATED allow-list;
 *  11. the year split per real session (the MCP's yearSplit);
 *  12. event twins (critique1 A7): every fees event 'processed' after the
 *      watermark has a One twin that is not 'ignored', or its payment is in
 *      One as a capture or in vppsone.tail_receipts_review.
 * TEST-session figures are printed for information and never fail the run.
 *
 * Freshness: reconcile refuses unless the fees matviews were fresh at the
 * extract (manifest.matviewFreshness; the queue's pending flag with --live)
 * and One's were refreshed on the as-of day with nothing pending.
 *
 * As-of: late fees depend on the date. Both sides are read from their
 * student-financials matviews, which are evaluated on the day they were last
 * refreshed, and the fees side cannot be evaluated at another date through a
 * read-only client. So --as-of must equal the source's IST date (the extract
 * day, or today with --live); reconcile refuses otherwise rather than compare
 * two different days. Run it the same day as the extract and load.
 *
 * Exit 1 on any mismatch. Output: counts, sums and md5s only.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { readCatalog } from "./lib/catalog.mjs";
import { planLoad } from "./lib/diff.mjs";
import { isMain, latestRunId, loadFeesSecrets, loadOneEnv, newRunId, parseArgs, runDir } from "./lib/env.mjs";
import { openFeesReadOnly } from "./lib/fees-readonly.mjs";
import { sessionYearSplit } from "./lib/control-totals.mjs";
import { unmigratedSourceData } from "./lib/import-rules.mjs";
import { EXTRACT_VIEWS, readAllRows, readNdjson, readRunTables, relationsFromOpenApi, viewKey } from "./lib/live-read.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { ident, prepareTransaction, readIdMap, readOneOwned, readPublicTables } from "./lib/one-target.mjs";
import {
  checksumMismatches,
  countBy,
  differingKeys,
  emiLateFees,
  eventTwinViolations,
  moneyBySession,
  oneMatviewFresh,
  onlineInvariant,
  receiptFigures,
  studentChecksums,
} from "./lib/reconcile-checks.mjs";
import { resolveWatermark } from "./lib/watermark.mjs";
import { orderedMd5, pkKey } from "./lib/rows.mjs";
import { COPIED_BUCKETS, listBucket, storageTotals } from "./lib/storage-list.mjs";
import { FEES_SOURCE_PROJECT_REF } from "../target-guard.mjs";

function istDate(iso) {
  return new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);
}

async function readSource(args) {
  if (args.live) {
    const fees = openFeesReadOnly(loadFeesSecrets());
    const { tables, views } = relationsFromOpenApi(await fees.openApi());
    const source = new Map();
    for (const t of tables) source.set(t.name, await readAllRows(fees, t.name, t.pk));
    const viewRows = {};
    for (const v of views.filter((x) => EXTRACT_VIEWS.includes(x.name))) viewRows[v.name] = await readAllRows(fees, v.name, viewKey(v));
    let storage = null;
    if (!args["no-storage"]) {
      storage = {};
      for (const bucket of COPIED_BUCKETS) storage[bucket] = storageTotals(await listBucket(fees.storage.from(bucket)));
    }
    const tableInfo = tables.map((t) => ({ name: t.name, columns: t.columns, rowCount: source.get(t.name).length }));
    // No fingerprint on a live read: the queue's own pending flag is the test.
    const queue = source.get("workbook_materialized_view_refresh_queue") ?? [];
    const freshness = queue.length && !queue.some((r) => r.pending === true) ? { ok: true } : { ok: false, reason: queue.length ? "a fees matview refresh is pending" : "no fees refresh-queue row" };
    return { label: "live (read now)", source, viewRows, storage, tableInfo, freshness, sourceDate: istDate(new Date().toISOString()) };
  }
  const runId = typeof args.run === "string" ? args.run : latestRunId();
  if (!runId) throw new Error("No extract run found; pass --run or --live.");
  const run = runDir(runId, { create: false });
  const manifest = JSON.parse(readFileSync(path.join(run, "manifest.json"), "utf8"));
  if (manifest.sourceProject !== FEES_SOURCE_PROJECT_REF) throw new Error("The run's manifest is not from the fees project.");
  const source = await readRunTables(run, manifest);
  const viewRows = {};
  // null when the run predates a view (v_workbook_installment_balances): that check is skipped, not failed.
  for (const name of EXTRACT_VIEWS) viewRows[name] = await readNdjson(path.join(run, "views", `${name}.ndjson`));
  let storage = null;
  if (!args["no-storage"]) {
    const fees = openFeesReadOnly(loadFeesSecrets());
    storage = {};
    for (const bucket of COPIED_BUCKETS) storage[bucket] = storageTotals(await listBucket(fees.storage.from(bucket)));
  }
  const freshness = manifest.matviewFreshness ?? { ok: false, reason: "the run predates the freshness record (extract again)" };
  return { label: `extract ${runId}`, run, source, viewRows, storage, tableInfo: manifest.tables, freshness, sourceDate: istDate(manifest.finishedAt) };
}

async function readOne(sql, source) {
  return sql.begin("read only", async (tx) => {
    await prepareTransaction(tx);
    const meta = await readCatalog(tx);
    const names = new Set([...source.keys()]);
    for (const fk of meta.fks) if ((fk.parentSchema ?? "public") === "public") names.add(fk.parent);
    const target = await readPublicTables(tx, meta, [...names]);
    const idMap = await readIdMap(tx);
    const oneOwned = await readOneOwned(tx);
    const views = {};
    for (const name of EXTRACT_VIEWS) {
      const rows = await tx.unsafe(`select to_jsonb(v)::text as j from public.${ident(name)} v`);
      views[name] = rows.map((r) => JSON.parse(r.j));
    }
    const storageRows = await tx`
      select bucket_id, count(*)::int as count, coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes
      from storage.objects where bucket_id = any(${COPIED_BUCKETS}) and name not like '%.emptyFolderPlaceholder'
      group by bucket_id`;
    const storage = Object.fromEntries(COPIED_BUCKETS.map((b) => [b, { count: 0, bytes: 0 }]));
    for (const r of storageRows) storage[r.bucket_id] = { count: r.count, bytes: Number(r.bytes) };
    const queue = meta.tables.workbook_materialized_view_refresh_queue
      ? await tx`select pending, last_refreshed_at::text as last_refreshed_at from public.workbook_materialized_view_refresh_queue`
      : [];
    const reviewRows = await tx`select evidence from vppsone.tail_receipts_review`;
    let watermark = null;
    try {
      watermark = await resolveWatermark({ sql: tx });
    } catch {
      watermark = null;
    }
    return { meta, target, idMap, oneOwned, views, storage, queue, reviewRows, watermark };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = await readSource(args);
  const asOf = typeof args["as-of"] === "string" ? args["as-of"] : src.sourceDate;
  if (asOf !== src.sourceDate) {
    throw new Error(
      `--as-of ${asOf} is not the source's date (${src.sourceDate}). The fees side's late fees are as of ${src.sourceDate} and a read-only client cannot evaluate them at another date; extract again on ${asOf}.`,
    );
  }

  // Both sides' money figures come from matviews: both must be of the as-of
  // day, or a match (or a mismatch) means nothing.
  const allowStale = Boolean(args["allow-stale-matview"]);
  if (!src.freshness?.ok) {
    const text = `the fees matviews in ${src.label} were not fresh (${src.freshness?.reason ?? "unknown"})`;
    if (!allowStale) throw new Error(`${text}; extract again, or pass --allow-stale-matview.`);
    console.log(`warning: ${text}; going on (--allow-stale-matview).`);
  }

  const sql = await openOneDb(loadOneEnv());
  let one;
  try {
    one = await readOne(sql, src.source);
  } finally {
    await sql.end();
  }
  const oneFresh = oneMatviewFresh(one.queue, asOf);
  if (!oneFresh.ok) {
    if (!allowStale) throw new Error(`${oneFresh.reason}; refresh them (a load does) and run again, or pass --allow-stale-matview.`);
    console.log(`warning: ${oneFresh.reason}; going on (--allow-stale-matview).`);
  }

  const plan = planLoad({ meta: one.meta, source: src.source, target: one.target, idMap: one.idMap, oneOwned: one.oneOwned, firstLoad: false, feesRef: FEES_SOURCE_PROJECT_REF });
  const report = { asOf, source: src.label, checks: {}, test: {}, protected: {} };
  const mismatches = [];
  const line = (ok, text) => {
    console.log(`${ok ? "OK      " : "MISMATCH"} ${text}`);
    if (!ok) mismatches.push(text);
  };

  console.log(`reconcile: ${src.label} vs One; as of ${asOf}; real sessions only (TEST and protected rows reported separately).`);

  // 1. Tables.
  const comparedRows = {};
  for (const table of plan.loadable) {
    const p = plan.tables[table];
    const pk = one.meta.tables[table].pk;
    const targetByPk = new Map((one.target.get(table) ?? []).map((row) => [pkKey(row, pk), row]));
    const left = p.compared.source.map((k) => p.rows.get(k));
    const right = p.compared.target.map((k) => targetByPk.get(k));
    comparedRows[table] = { left, right };
    const leftMd5 = orderedMd5(left, pk, p.columns);
    const rightMd5 = orderedMd5(right, pk, p.columns);
    const ok = p.insert.length === 0 && p.update.length === 0 && p.delete.length === 0 && p.counts.protectedConflict === 0 && leftMd5 === rightMd5;
    report.checks[`table.${table}`] = { ok, fees: { rows: left.length, md5: leftMd5 }, one: { rows: right.length, md5: rightMd5 }, missing: p.insert.length, differ: p.update.length, extra: p.delete.length };
    if (!ok) line(false, `table ${table}: fees ${left.length} / One ${right.length}; missing in One ${p.insert.length}, different ${p.update.length}, extra in One ${p.delete.length}, protected clashes ${p.counts.protectedConflict}`);
    report.test[table] = { fees: plan.testSource.get(table)?.size ?? 0, one: plan.testTarget.get(table)?.size ?? 0 };
    const protectedCount = plan.protectedTarget.get(table)?.size ?? 0;
    if (protectedCount) report.protected[table] = protectedCount;
  }
  const tableFailures = Object.values(report.checks).filter((c) => !c.ok).length;
  line(tableFailures === 0, `tables: ${plan.loadable.length - tableFailures} of ${plan.loadable.length} equal (count + ordered md5)`);
  if (plan.notInOne.length) console.log(`         not in One's public, not compared: ${plan.notInOne.join(", ")}`);
  // Live data One cannot hold is a difference, not a footnote.
  const unmigrated = unmigratedSourceData(src.tableInfo ?? [], one.meta);
  report.checks.unmigrated = { ok: unmigrated.tables.length === 0 && unmigrated.columns.length === 0, ...unmigrated };
  line(
    report.checks.unmigrated.ok,
    `live data One has no place for: ${unmigrated.tables.map((t) => `${t.table} (${t.rows} rows)`).concat(unmigrated.columns.map((c) => `${c.table}.{${c.columns.join(",")}}`)).join(", ") || "none"} (NOT_MIGRATED aside)`,
  );

  // 2-4. Money, classes, students.
  const feesFin = src.viewRows.v_workbook_student_financials ?? [];
  const oneFin = one.views.v_workbook_student_financials ?? [];
  const protectedStudents = plan.protectedTarget.get("students") ?? new Set();
  const oneFinReal = oneFin.filter((r) => !protectedStudents.has(String(r.student_id)));
  const feesMoney = moneyBySession(feesFin);
  const oneMoney = moneyBySession(oneFinReal);
  for (const label of new Set([...Object.keys(feesMoney), ...Object.keys(oneMoney)])) {
    const a = feesMoney[label]?.summary;
    const b = oneMoney[label]?.summary;
    const diff = differingKeys({ head: a?.headcount, money: a?.money }, { head: b?.headcount, money: b?.money });
    report.checks[`money.${label}`] = { ok: diff.length === 0, fees: a, one: b };
    line(diff.length === 0, `money ${label}: expected ${a?.money.totalExpectedFees}/${b?.money.totalExpectedFees}, paid ${a?.money.totalPaid}/${b?.money.totalPaid}, fees pending ${a?.money.totalFeesPending}/${b?.money.totalFeesPending}, late fee pending ${a?.money.totalLateFeePending}/${b?.money.totalLateFeePending} (fees/One)`);
    const classDiff = differingKeys(
      Object.fromEntries((feesMoney[label]?.classes ?? []).map((c) => [c.key, c])),
      Object.fromEntries((oneMoney[label]?.classes ?? []).map((c) => [c.key, c])),
    );
    report.checks[`classes.${label}`] = { ok: classDiff.length === 0, differingClassIds: classDiff };
    line(classDiff.length === 0, `classes ${label}: ${classDiff.length} class rollup(s) differ`);
  }
  // Year split (the MCP's yearSplit: current year vs carry-forward, on is_carry_forward).
  const feesBalances = src.viewRows.v_workbook_installment_balances;
  if (Array.isArray(feesBalances)) {
    const sideInputs = (balances, tables) => ({ balances, students: tables.get("students") ?? [], classes: tables.get("classes") ?? [], payments: tables.get("payments") ?? [], receipts: tables.get("receipts") ?? [] });
    const feesInputs = sideInputs(feesBalances, src.source);
    const oneInputs = sideInputs(one.views.v_workbook_installment_balances ?? [], one.target);
    for (const label of new Set([...Object.keys(feesMoney), ...Object.keys(oneMoney)])) {
      const a = sessionYearSplit(feesInputs, label);
      const b = sessionYearSplit(oneInputs, label, { exclude: protectedStudents });
      const diff = differingKeys(a, b);
      report.checks[`yearSplit.${label}`] = { ok: diff.length === 0, fees: a, one: b };
      line(diff.length === 0, `year split ${label}: current expected ${a.currentYear.expected}/${b.currentYear.expected}, collected ${a.currentYear.collected}/${b.currentYear.collected}; carry-forward pending ${a.previousYear.pending}/${b.previousYear.pending} (fees/One)`);
    }
  } else {
    console.log("info     year split: this extract has no v_workbook_installment_balances; not compared (extract again).");
  }

  const studentDiff = checksumMismatches(studentChecksums(feesFin), studentChecksums(oneFin, { exclude: protectedStudents }));
  report.checks.students = { ok: studentDiff.length === 0, differing: studentDiff.length, first: studentDiff.slice(0, 20) };
  line(studentDiff.length === 0, `students: ${studentDiff.length} per-student checksum(s) differ${studentDiff.length ? ` — first ids: ${studentDiff.slice(0, 20).join(", ")}` : ""}`);

  // 5. Receipts.
  const r = comparedRows.receipts ?? { left: [], right: [] };
  const ra = receiptFigures(r.left);
  const rb = receiptFigures(r.right);
  const receiptDiff = differingKeys(ra, rb);
  report.checks.receipts = { ok: receiptDiff.length === 0 && ra.distinctNumbers === ra.count && rb.distinctNumbers === rb.count, fees: { count: ra.count, distinct: ra.distinctNumbers }, one: { count: rb.count, distinct: rb.distinctNumbers }, differing: receiptDiff };
  line(report.checks.receipts.ok, `receipts: ${ra.count}/${rb.count} rows, distinct numbers ${ra.distinctNumbers}/${rb.distinctNumbers}; per mode/date and max suffix per prefix/date ${receiptDiff.length ? `differ in ${receiptDiff.join(", ")}` : "equal"}`);

  // 6. Online invariant.
  const caps = comparedRows.online_payment_captures ?? { left: [], right: [] };
  const oa = onlineInvariant(caps.left, new Set(r.left.map((x) => String(x.id))));
  const ob = onlineInvariant(caps.right, new Set(r.right.map((x) => String(x.id))));
  const onlineOk = oa.holds && ob.holds && differingKeys(oa, ob).length === 0;
  report.checks.online = { ok: onlineOk, fees: oa, one: ob };
  line(onlineOk, `online: captured ${oa.captured}/${ob.captured} paise = on receipts ${oa.onReceipts}/${ob.onReceipts} + review ${oa.inReview}/${ob.inReview} + waiting ${oa.waiting}/${ob.waiting}`);

  // 6b. Event twins (critique1 A7): a fees-processed payment never sits in
  // One as 'ignored' with nothing to show for it.
  const twins = eventTwinViolations({
    feesEvents: src.source.get("online_payment_events") ?? [],
    oneEvents: one.target.get("online_payment_events") ?? [],
    oneCaptures: one.target.get("online_payment_captures") ?? [],
    reviewRows: one.reviewRows,
    since: one.watermark?.newestChangeAt ?? null,
  });
  report.checks.eventTwins = { ok: twins.length === 0, violations: twins.length, first: twins.slice(0, 20) };
  line(twins.length === 0, `event twins: ${twins.length} fees-processed payment event(s) after the watermark with no live twin or capture or review row in One${twins.length ? ` — first: ${twins.slice(0, 5).map((t) => `${t.providerEventId} (One ${t.oneTwin})`).join(", ")}` : ""}`);

  // 7. WhatsApp.
  const wa = (table, cols) => {
    const rows = comparedRows[table] ?? { left: [], right: [] };
    const a = countBy(rows.left, cols);
    const b = countBy(rows.right, cols);
    const diff = differingKeys(a, b);
    report.checks[`whatsapp.${table}`] = { ok: diff.length === 0, fees: a, one: b };
    line(diff.length === 0, `${table} per ${cols.join("/")}: ${diff.length ? `differ in ${diff.join(", ")}` : "equal"}`);
  };
  wa("whatsapp_reminder_sends", ["status", "notice_kind"]);
  wa("school_notice_sends", ["status"]);
  wa("notification_outbox", ["status"]);

  // 8. EMI late fees.
  const classSession = (rows) => new Map(rows.map((c) => [String(c.id), c.session_label]));
  const ea = emiLateFees(comparedRows.installments?.left ?? [], classSession(src.source.get("classes") ?? []));
  const eb = emiLateFees(comparedRows.installments?.right ?? [], classSession(one.target.get("classes") ?? []));
  const emiDiff = differingKeys(ea, eb);
  report.checks.emiLateFees = { ok: emiDiff.length === 0, fees: ea, one: eb };
  line(emiDiff.length === 0, `EMI late fees: ${JSON.stringify(ea)} / ${JSON.stringify(eb)}`);

  // 9. Storage.
  if (src.storage) {
    for (const bucket of COPIED_BUCKETS) {
      const a = src.storage[bucket];
      const b = one.storage[bucket];
      const ok = a.count === b.count && a.bytes === b.bytes;
      report.checks[`storage.${bucket}`] = { ok, fees: a, one: b };
      line(ok, `storage ${bucket}: ${a.count}/${b.count} objects, ${a.bytes}/${b.bytes} bytes`);
    }
  }

  // TEST and protected, for information.
  const testMoney = { fees: moneyBySession(feesFin, { test: true }), one: moneyBySession(oneFin, { test: true }) };
  for (const label of new Set([...Object.keys(testMoney.fees), ...Object.keys(testMoney.one)])) {
    const a = testMoney.fees[label]?.summary.money;
    const b = testMoney.one[label]?.summary.money;
    console.log(`info     TEST ${label}: collectable ${a?.studentCount ?? 0}/${b?.studentCount ?? 0}, paid ${a?.totalPaid ?? 0}/${b?.totalPaid ?? 0}, fees pending ${a?.totalFeesPending ?? 0}/${b?.totalFeesPending ?? 0} (fees/One; not compared)`);
  }
  const testRows = Object.entries(report.test).filter(([, v]) => v.fees || v.one);
  console.log(`info     TEST rows (fees/One): ${testRows.map(([t, v]) => `${t} ${v.fees}/${v.one}`).join(", ") || "none"}`);
  console.log(`info     protected rows in One (excluded): ${Object.entries(report.protected).map(([t, n]) => `${t} ${n}`).join(", ") || "none"}`);

  const out = path.join(src.run ?? runDir(`reconcile-${newRunId()}`), `reconcile-${newRunId()}.json`);
  writeFileSync(out, JSON.stringify({ ...report, mismatches: mismatches.length }, null, 2));
  console.log(`reconcile: ${mismatches.length ? `${mismatches.length} MISMATCH(ES)` : "EQUAL"}. Report in the private run folder.`);
  if (mismatches.length) process.exit(1);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`reconcile: ${error.message}`);
    process.exit(1);
  });
}
