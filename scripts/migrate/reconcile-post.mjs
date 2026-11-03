#!/usr/bin/env node
/**
 * The money check of the parallel run (plan §12.1; PARALLEL-RUN.md check 5;
 * the first rollback trigger in ROLLBACK-2026-27.md). Read-only on One; the
 * fees database is never opened (after T0 the two diverge by design — One
 * takes the desk, the fees app only the tail — so reconcile.mjs, "One equal
 * to fees", no longer applies).
 *
 *   node scripts/migrate/reconcile-post.mjs --baseline          # once, at C3, right after the cutover row
 *   node scripts/migrate/reconcile-post.mjs --as-of <today IST> # every morning of the parallel run
 *
 * The line is the `cutover` row in `vppsone.migration_runs` (C3). --baseline
 * freezes One's ledger as of that line — receipts per real session and mode,
 * their allocations, EMI late-fee installments, the session money summary —
 * in a `reconcile-post` migration_runs row (counts and sums only), and
 * refuses a second baseline for the same cutover. The daily run reads the
 * same figures again in one REPEATABLE READ READ ONLY transaction and checks
 * (lib/reconcile-post.mjs):
 *   baseline unchanged, and baseline + One's desk postings + tail postings =
 *   One's receipts now, per real session and mode; no receipt number twice;
 *   no posting at or under receipt_suffix_floor; every posted tail row's
 *   receipt exists, after the line, for its amount.
 * EMI late fees charged after the line, the money summary's change, pending
 * tail rows and TEST sessions are printed on their own lines.
 *
 * --as-of must be today's IST date: the figures are read now and cannot be
 * evaluated at another date. A receipt's session is its student's class's
 * (one class per student within a session; this is a parallel-run tool,
 * 13 Dec – 10 Jan, not for the April rollover).
 *
 * Exit 0 all equal, 1 any difference (a rollback trigger — stop and call the
 * owner), 2 could not run (no cutover row, no baseline).
 * Output: counts and sums only; the report goes to
 * %USERPROFILE%\.vppsone-migration\reconcile-post-<run>\report.json.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { sessionMoneySummary } from "./lib/control-totals.mjs";
import { isMain, loadOneEnv, newRunId, parseArgs, runDir } from "./lib/env.mjs";
import { isTestSessionLabel } from "./lib/import-rules.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { baselineOf, comparePostCutover, ledgerFromRows } from "./lib/reconcile-post.mjs";
import { ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";

/** The IST calendar date of an instant. */
export function istDate(at = new Date()) {
  return new Date(at.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** The money summary's headline figures per real session (info: the matview caps at base, so it is not a sum of receipts). */
function moneyHeadlines(viewRows) {
  const labels = [...new Set(viewRows.map((r) => r.session_label))].filter((l) => l && !isTestSessionLabel(l)).sort();
  return Object.fromEntries(
    labels.map((label) => {
      const { money } = sessionMoneySummary(viewRows, label);
      return [label, { totalPaid: money.totalPaid, totalFeesPending: money.totalFeesPending, totalLateFeePending: money.totalLateFeePending, totalDiscountCloseouts: money.totalDiscountCloseouts }];
    }),
  );
}

export async function readLedger(tx, cut) {
  const receipts = await tx`
    select coalesce(c.session_label, 'unknown') as session_label, r.payment_mode::text as mode, (r.created_at <= ${cut}) as frozen,
           count(*)::int as count, coalesce(sum(r.total_amount), 0)::bigint as sum
    from public.receipts r join public.students s on s.id = r.student_id left join public.classes c on c.id = s.class_id
    group by 1, 2, 3`;
  const allocations = await tx`
    select coalesce(c.session_label, 'unknown') as session_label, (r.created_at <= ${cut}) as frozen,
           count(*)::int as count, coalesce(sum(p.amount), 0)::bigint as sum
    from public.payments p join public.receipts r on r.id = p.receipt_id
    left join public.installments i on i.id = p.installment_id left join public.classes c on c.id = i.class_id
    group by 1, 2`;
  const emi = await tx`
    select coalesce(c.session_label, 'unknown') as session_label, (i.created_at <= ${cut}) as frozen,
           count(*)::int as count, coalesce(sum(i.amount_due), 0)::bigint as sum
    from public.installments i left join public.classes c on c.id = i.class_id
    where i.is_emi_late_fee
    group by 1, 2`;
  const postings = await tx`
    select coalesce(c.session_label, 'unknown') as session_label, r.payment_mode::text as mode,
           exists (select 1 from vppsone.tail_receipts_review t where t.status = 'posted' and t.posted_receipt_id = r.id) as tail,
           count(*)::int as count, coalesce(sum(r.total_amount), 0)::bigint as sum
    from public.receipts r join public.students s on s.id = r.student_id left join public.classes c on c.id = s.class_id
    where r.created_at > ${cut}
    group by 1, 2, 3`;
  return { receipts, allocations, emi, postings };
}

export async function readIntegrity(tx, cut) {
  const [floorRow] = await tx`select value from public.app_settings where key = 'receipt_suffix_floor'`;
  const floor = /^\s*\d+\s*$/.test(floorRow?.value ?? "") ? Number(floorRow.value) : null;
  const [row] = await tx`
    with real_after as (
      select r.* from public.receipts r join public.students s on s.id = r.student_id left join public.classes c on c.id = s.class_id
      where r.created_at > ${cut} and coalesce(c.session_label, '') !~* '^(test|uat|demo)-[0-9]{4}-[0-9]{2}$'
    )
    select
      (select count(*)::int from (select receipt_number from public.receipts group by 1 having count(*) > 1) d) as duplicate_numbers,
      (select count(*)::int from real_after r
        where ${floor}::int is not null and substring(r.receipt_number from '-([0-9]+)$')::bigint <= ${floor}::int) as at_or_under_floor,
      (select count(*)::int from real_after r
        where r.total_amount <> coalesce((select sum(p.amount) from public.payments p where p.receipt_id = r.id), 0)) as allocation_differs,
      (select count(*)::int from vppsone.tail_receipts_review t left join public.receipts r on r.id = t.posted_receipt_id
        where t.status = 'posted' and r.id is null) as tail_missing,
      (select count(*)::int from vppsone.tail_receipts_review t join public.receipts r on r.id = t.posted_receipt_id
        where t.status = 'posted' and r.total_amount <> t.total_amount) as tail_amount_differs,
      (select count(*)::int from vppsone.tail_receipts_review t join public.receipts r on r.id = t.posted_receipt_id
        where t.status = 'posted' and r.created_at <= ${cut}) as tail_before_line,
      (select count(*)::int from vppsone.tail_receipts_review t where t.status = 'pending') as tail_pending`;
  return {
    floor,
    duplicateNumbers: row.duplicate_numbers,
    atOrUnderFloor: row.at_or_under_floor,
    allocationDiffers: row.allocation_differs,
    tailMissing: row.tail_missing,
    tailAmountDiffers: row.tail_amount_differs,
    tailBeforeLine: row.tail_before_line,
    tailPending: row.tail_pending,
  };
}

export async function readViewRows(tx) {
  return tx`
    select session_label, record_status, total_paid, outstanding_amount, late_fee_outstanding_amount, base_charge_total, total_due,
           late_fee_total, late_fee_waiver_amount, discount_amount, total_discount_closeouts, overdue_installment_count
    from public.v_workbook_student_financials`;
}

const fmt = (v) => `${v.count} / ₹${v.sum}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baselineMode = Boolean(args.baseline);
  const today = istDate();
  if (!baselineMode) {
    if (typeof args["as-of"] !== "string") throw new Error(`--as-of is required (today: ${today}).`);
    if (args["as-of"] !== today) throw new Error(`--as-of ${args["as-of"]} is not today (${today} IST): the figures are read now.`);
  }

  const sql = await openOneDb(loadOneEnv());
  try {
    const read = await sql.begin("isolation level repeatable read read only", async (tx) => {
      await tx.unsafe("set local timezone = 'UTC'");
      const cuts = await tx`select id::text, finished_at from vppsone.migration_runs where kind = 'cutover' and status = 'succeeded' order by finished_at`;
      if (cuts.length !== 1) return { refused: cuts.length === 0 ? "no cutover row (C3) yet: before T0 the nightly reconcile.mjs is the check." : `${cuts.length} cutover rows; C3 writes exactly one.` };
      const cut = cuts[0];
      const [base] = await tx`
        select summary from vppsone.migration_runs
        where script = 'reconcile-post' and kind = 'run' and status = 'succeeded' and summary ->> 'cutover_id' = ${cut.id}
        order by finished_at desc limit 1`;
      const rows = await readLedger(tx, cut.finished_at);
      const integrity = await readIntegrity(tx, cut.finished_at);
      const money = moneyHeadlines(await readViewRows(tx));
      return { cut, base: base?.summary ?? null, rows, integrity, money };
    });
    if (read.refused) {
      console.error(`reconcile-post: ${read.refused}`);
      process.exitCode = 2;
      return;
    }
    const ledger = ledgerFromRows(read.rows);
    const cutAt = new Date(read.cut.finished_at).toISOString();

    if (baselineMode) {
      if (read.base) {
        console.error(`reconcile-post: a baseline for cutover ${read.cut.id} exists already; it is taken once.`);
        process.exitCode = 2;
        return;
      }
      const baseline = baselineOf(ledger);
      await sql`
        insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at, finished_at, status, summary, note)
        values ('reconcile-post', 'run', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${read.cut.id}, ${cutAt}, now(), 'succeeded',
                ${sql.json({ cutover_id: read.cut.id, cut_at: cutAt, baseline, money_summary: read.money })},
                'The frozen baseline of the parallel run: One''s ledger at the cutover line (Phase G).')`;
      const sessions = [...new Set(Object.keys(baseline.receipts).map((k) => k.split("|")[0]))].sort();
      console.log(`reconcile-post --baseline: frozen at the cutover line ${cutAt} — real sessions ${sessions.join(", ") || "none"}`);
      for (const [key, v] of Object.entries(baseline.receipts).sort()) console.log(`  ${key}: ${fmt(v)}`);
      return;
    }

    if (!read.base) {
      console.error(`reconcile-post: no baseline for cutover ${read.cut.id}. Take it once: --baseline (CUTOVER-RUNBOOK C3).`);
      process.exitCode = 2;
      return;
    }
    const verdict = comparePostCutover({ baseline: read.base.baseline, ledger, integrity: read.integrity });
    console.log(`reconcile-post --as-of ${today}: line ${cutAt}; real sessions only (TEST apart). Read-only.`);
    for (const s of verdict.sessions) {
      console.log(`  ${s.session}: baseline ${fmt(s.baseline)} + desk ${fmt(s.desk)} + tail ${fmt(s.tail)} = now ${fmt(s.now)}; EMI late fees charged since the line ${fmt(s.emiAfter)}`);
    }
    for (const c of verdict.checks) {
      console.log(`  ${c.ok ? "ok" : "!!"} ${c.name}${c.ok ? "" : `: ${JSON.stringify(c.detail).slice(0, 400)}`}`);
    }
    for (const [label, now] of Object.entries(read.money)) {
      const then = read.base.money_summary?.[label];
      if (then) console.log(`  info ${label} money summary: paid ${then.totalPaid} → ${now.totalPaid}; fees pending ${then.totalFeesPending} → ${now.totalFeesPending}`);
    }
    for (const note of verdict.notes) console.log(`  note: ${note}`);
    const test = Object.entries(ledger.test.receiptsNow).map(([k, v]) => `${k} ${fmt(v)}`).join("; ");
    if (test) console.log(`  TEST (never fails the run): ${test}`);

    const dir = runDir(`reconcile-post-${newRunId()}`);
    writeFileSync(
      path.join(dir, "report.json"),
      JSON.stringify({ asOf: today, cutAt, cutoverId: read.cut.id, ok: verdict.ok, checks: verdict.checks, sessions: verdict.sessions, notes: verdict.notes, integrity: read.integrity, money: read.money }, null, 2),
    );
    console.log(`  ${verdict.ok ? "EQUAL" : "DIFFERENCE — a rollback trigger: stop and call the owner (ROLLBACK-2026-27.md)"}`);
    if (!verdict.ok) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`reconcile-post: ${error.message}`);
    process.exitCode = 2;
  });
}
