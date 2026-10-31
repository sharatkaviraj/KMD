#!/usr/bin/env node
/**
 * Classify every `vppsone` row on One's main database into the plan's
 * buckets (go-live phase H; plan §4.1; runbook step 3). READ ONLY: one
 * `READ ONLY` transaction on One's project, and the live classes list
 * through the sealed select-only reader (D-339). Counts only.
 *
 *   node scripts/migrate/classify-dev-vppsone.mjs
 *
 * Per table (lib/quarantine-rules.mjs TABLES):
 *   A promote   real master data kept for the real session (its real rows),
 *   K keep      settings and system tables, never touched,
 *   B quarantine test activity: every row moves into TEST-2026-27,
 *   R rebuilt   enrolments / teaching assignments, rebuilt from source,
 *   C never     smoke / QA / day-run machinery, logs, replica marker.
 * plus TEST rows already in A/R tables (they get the general rule), and
 * UNCLASSIFIED tables (the quarantine refuses while any exist).
 *
 * Also listed:
 *  - One's real-session classes with no class of the same (name, section,
 *    stream) on live (plan §4.2: dev has 20 for 2026-27, live 19) — by class
 *    name, which is not personal data;
 *  - activity by the owner's own account (the one auth user outside
 *    @qa.vpps.local), per table, for the owner to say whether any of it is
 *    real (plan §4.4, critique0 #19) — counts only.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";
import { isMain, loadOneEnv, newRunId, runDir } from "./lib/env.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { classesWithoutLivePartner, TABLES, unclassified } from "./lib/quarantine-rules.mjs";
import { quoteIdent } from "./lib/quarantine-sql.mjs";
import { readClasses, readLiveClasses } from "./lib/quarantine-state.mjs";
import { readRealSession } from "./lib/real-session.mjs";
import { readVppsoneCatalog } from "./lib/vppsone-catalog.mjs";

const rel = (table) => `vppsone.${quoteIdent(table)}`;

export async function classify(tx) {
  const catalog = await readVppsoneCatalog(tx);
  const session = await readRealSession(tx);
  const tables = [];
  for (const info of Object.values(catalog).sort((a, b) => a.table.localeCompare(b.table))) {
    const bucket = TABLES[info.table]?.bucket ?? "UNCLASSIFIED";
    const [c] = await tx.unsafe(
      info.hasSession
        ? `select count(*)::int as total,
                  count(*) filter (where vppsone.is_test_session_label(session_label))::int as test,
                  count(*) filter (where session_label = $1)::int as real_session
           from ${rel(info.table)}`
        : `select count(*)::int as total, 0 as test, 0 as real_session from ${rel(info.table)} where $1::text is not null`,
      [session],
    );
    tables.push({ table: info.table, bucket, hasSession: info.hasSession, ...c });
  }

  const owners = await tx`
    select u.id::text as user_id, p.id::text as profile_id from auth.users u
    left join vppsone.staff_profiles p on p.user_id = u.id
    where lower(u.email) not like '%@qa.vpps.local'`;
  const ownerActivity = [];
  for (const owner of owners) {
    for (const info of Object.values(catalog)) {
      const parts = [
        ...(owner.profile_id ? info.staffCols.map((c) => `t.${quoteIdent(c)} = '${owner.profile_id}'::uuid`) : []),
        ...info.authCols.map((c) => `t.${quoteIdent(c)} = '${owner.user_id}'::uuid`),
      ];
      if (!parts.length || info.table === "staff_profiles") continue;
      const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${rel(info.table)} as t where ${parts.join(" or ")}`);
      if (n) ownerActivity.push({ table: info.table, bucket: TABLES[info.table]?.bucket ?? "UNCLASSIFIED", rows: n });
    }
  }

  const classes = await readClasses(tx);
  const live = await readLiveClasses();
  const extra = live.classes ? classesWithoutLivePartner(classes, live.classes, session) : null;
  const refsToExtra = [];
  if (extra?.length) {
    for (const info of Object.values(catalog)) {
      if (!info.classCols.length) continue;
      const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${rel(info.table)} where class_id = any($1::uuid[])`, [`{${extra.map((c) => c.id).join(",")}}`]);
      if (n) refsToExtra.push({ table: info.table, rows: n });
    }
  }
  const [{ n: extraStudents }] = extra?.length
    ? await tx.unsafe(`select count(*)::int as n from public.students where class_id = any($1::uuid[])`, [`{${extra.map((c) => c.id).join(",")}}`])
    : [{ n: 0 }];

  return {
    session,
    tables,
    unclassified: unclassified(Object.keys(catalog)),
    owners: owners.length,
    ownerActivity: ownerActivity.sort((a, b) => a.table.localeCompare(b.table)),
    classCounts: Object.fromEntries(
      [...new Set(classes.map((c) => c.session_label))].sort().map((s) => [s, classes.filter((c) => c.session_label === s).length]),
    ),
    liveClassCounts: live.classes
      ? Object.fromEntries([...new Set(live.classes.map((c) => c.session_label))].sort().map((s) => [s, live.classes.filter((c) => c.session_label === s).length]))
      : null,
    liveError: live.error ?? null,
    extraClasses: extra?.map((c) => ({ class_name: c.class_name, section: c.section, stream_name: c.stream_name, status: c.status })) ?? null,
    refsToExtra,
    extraStudents,
  };
}

async function main() {
  const sql = await openOneDb(loadOneEnv());
  let report;
  try {
    report = await sql.begin("read only", (tx) => classify(tx));
  } finally {
    await sql.end();
  }
  console.log(`classify-dev-vppsone: READ ONLY on ${ONE_MAIN_PROJECT_REF}; real session ${report.session}`);
  const byBucket = {};
  for (const t of report.tables) {
    const b = (byBucket[t.bucket] ??= { tables: 0, rows: 0, realSession: 0, test: 0 });
    b.tables += 1;
    b.rows += t.total;
    b.realSession += t.real_session;
    b.test += t.test;
  }
  for (const [bucket, b] of Object.entries(byBucket).sort()) {
    console.log(`  ${bucket.padEnd(12)} ${String(b.tables).padStart(3)} tables ${String(b.rows).padStart(7)} rows (${b.realSession} labelled ${report.session}, ${b.test} TEST)`);
  }
  for (const t of report.tables.filter((x) => x.total)) {
    console.log(`    ${t.bucket} ${t.table}: ${t.total}${t.hasSession ? ` (${t.real_session} ${report.session}, ${t.test} TEST)` : ""}`);
  }
  if (report.unclassified.length) console.log(`  !! UNCLASSIFIED: ${report.unclassified.join(", ")}`);
  console.log(`  classes in One: ${Object.entries(report.classCounts).map(([s, n]) => `${s} ${n}`).join(", ")}; on live: ${report.liveClassCounts ? Object.entries(report.liveClassCounts).map(([s, n]) => `${s} ${n}`).join(", ") : `UNAVAILABLE (${report.liveError})`}`);
  if (report.extraClasses) {
    console.log(`  ${report.session} classes with no live partner: ${report.extraClasses.length}`);
    for (const c of report.extraClasses) console.log(`    "${c.class_name}" section ${c.section ?? "-"} stream ${c.stream_name ?? "-"} (${c.status}); ${report.extraStudents} student(s) in it; vppsone rows on it: ${report.refsToExtra.map((r) => `${r.table} ${r.rows}`).join(", ") || "none"}`);
  }
  console.log(`  logins outside @qa.vpps.local: ${report.owners}; their activity (owner review, plan §4.4):`);
  for (const a of report.ownerActivity) console.log(`    [${a.bucket}] ${a.table}: ${a.rows}`);
  const runId = `classify-${newRunId()}`;
  writeFileSync(path.join(runDir(runId), "classify.json"), JSON.stringify(report, null, 2));
  console.log(`  report: %USERPROFILE%\\.vppsone-migration\\${runId}\\classify.json`);
  if (report.unclassified.length) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`classify-dev-vppsone: ${error.message}`);
    process.exitCode = 2;
  });
}
