#!/usr/bin/env node
/**
 * Dry-run the online-payments migration against the DEV database, end to end,
 * and leave nothing behind.
 *
 * One transaction: apply `20261028140100_online_payments.sql`, then drive the
 * real posting engine through every money path the migration adds — quote,
 * intent, duplicate taps, a verified capture, a duplicate capture, a cash
 * payment racing an online one, wrong amount / mode / unknown link, the
 * permission walls — against an existing synthetic `TEST-` student, and then
 * ROLL BACK. Nothing is committed, ever: the script throws its own sentinel at
 * the end of the transaction, and a failed assertion aborts it the same way.
 *
 * It refuses the production project outright, by ref, before connecting.
 *
 *   node scripts/verify-online-payments-dryrun.mjs --env "<path to .env.local>"
 *
 * Reads exactly two keys from that file — SUPABASE_DEV_PROJECT_REF and
 * SUPABASE_DEV_DB_PASSWORD — and prints neither. `--student <uuid>` picks the
 * TEST student (default: the first active TEST-2026-27 student with no
 * receipts and no EMI plan).
 *
 * Two deliberate differences from the real migration, both forced by running
 * it inside one transaction:
 *   - `'online'::payment_mode` posts as `'upi'`: Postgres refuses to use an enum
 *     value in the transaction that adds it, and `20261028140000` is a separate
 *     migration for exactly that reason.
 *   - `private.ist_today()` is pinned to 2026-04-01, before any 2026-27 due date,
 *     so a synthetic student has an eligible, late-fee-free installment 1.
 *
 * ONE (go-live Phase E): ported from the fees app and adapted to One's main
 * database, wtgxcptmucjerhufzjcf, which is production and the only test bed
 * (D-338, D-346). Three changes, nothing else:
 *   - it connects through scripts/migrate/lib/one-db.mjs (the session pooler,
 *     `SUPABASE_DEV_DB_PASSWORD` from .env.local, printed nowhere), which
 *     refuses every project but wtgx and refuses the fees app's live database
 *     by name;
 *   - it does NOT apply the migrations: they are on wtgx already, as the
 *     fee-migrations fee_20261028140100_online_payments_no_cron, fee_20261029020128_online_payments_server_grants, fee_20261031120000_online_vp1_ownership, fee_20261031120100_receipt_suffix_floor (and One's own changes to them —
 *     `vp1_` references, the receipt floor, TST receipts). It checks they are
 *     in the ledger and drives what is there, so it tests One's functions,
 *     not the fees app's files; `'online'::payment_mode` is used as itself;
 *   - TEST-2026-27 receipts are numbered TST (D-346), so receipts are matched
 *     on TST, and every reference One mints is `vp1_`.
 * Everything still happens inside ONE transaction that ends by throwing, so
 * nothing is committed — on a production database that is the whole point.
 *
 *   node scripts/verify-online-…-dryrun.mjs
 */

import process from "node:process";

import { loadOneEnv } from "./migrate/lib/env.mjs";
import { openOneDb } from "./migrate/lib/one-db.mjs";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : undefined;
}

/** The fee-migrations this dry run drives, by their ledger names on wtgx. */
async function assertApplied(tx, names) {
  const rows = await tx`select name from supabase_migrations.schema_migrations where name = any(${names})`;
  const found = new Set(rows.map((row) => row.name));
  for (const name of names) check(`applied on wtgx: ${name}`, found.has(name), null);
}


class Rollback extends Error {}
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) {
    const error = new Error(`Assertion failed: ${name}`);
    error.detail = detail;
    throw error;
  }
}



async function expectError(tx, name, statement, pattern) {
  await tx.unsafe("savepoint expect_error");
  try {
    await statement();
    await tx.unsafe("release savepoint expect_error");
    check(name, false, "expected an error, none was raised");
  } catch (caught) {
    if (String(caught.message).startsWith("Assertion failed")) throw caught;
    await tx.unsafe("rollback to savepoint expect_error");
    check(name, pattern.test(String(caught.message)), caught.message);
  }
}

const sql = await openOneDb(loadOneEnv());
const startedAt = Date.now();

try {
  await sql.begin(async (tx) => {
    const [{ current_ref }] = await tx`select current_database() as current_ref`;
    void current_ref;

    await assertApplied(tx, ["fee_20261028140100_online_payments_no_cron","fee_20261029020128_online_payments_server_grants","fee_20261031120000_online_vp1_ownership","fee_20261031120100_receipt_suffix_floor"]);
    await tx.unsafe(
      "create or replace function private.ist_today() returns date language sql stable as $$ select date '2026-04-01' $$",
    );
    await tx`update public.app_settings set value = 'true' where key in ('online_payment_links_enabled', 'online_payment_auto_posting_enabled')`;

    const studentArg = argValue("--student");
    const [student] = studentArg
      ? await tx`select s.id, s.admission_no from public.students s where s.id = ${studentArg}`
      : await tx`
          select s.id, s.admission_no
          from public.students s
          join public.classes c on c.id = s.class_id
          where s.admission_no like 'TEST-%' and c.session_label = 'TEST-2026-27' and s.status = 'active'
            and not exists (select 1 from public.receipts r where r.student_id = s.id)
            and not exists (select 1 from public.student_repayment_plans p where p.student_id = s.id and p.lifecycle = 'active')
          order by s.admission_no limit 1`;
    check("a synthetic TEST student exists", student && student.admission_no.startsWith("TEST-"), student?.admission_no);
    const sid = student.id;

    const [admin] = await tx`select id from public.users where role = 'admin' and is_active = true limit 1`;
    check("an admin staff user exists for the desk path", Boolean(admin), null);

    // ---- the quote, as postgres (the function's owner)
    const [{ q: q1 }] = await tx`select private.online_payment_quote(${sid}, '{1}'::smallint[], false, date '2026-04-01') as q`;
    check("quote: installment 1 before its due date is eligible", q1.eligible === true && q1.late_fee_total === 0, q1);
    const inst1 = q1.total;
    check("quote: total equals the row's total_pending", inst1 > 0 && q1.lines.length === 1, q1);

    const [{ q: q2 }] = await tx`select private.online_payment_quote(${sid}, '{2}'::smallint[], false, date '2026-04-01') as q`;
    check("quote: installment 2 while 1 is owed is refused (earlier_dues_not_selected)",
      q2.eligible === false && q2.reasons.includes("earlier_dues_not_selected"), q2.reasons);

    const [{ q: q3 }] = await tx`select private.online_payment_quote(${sid}, '{1,2,3}'::smallint[], false, date '2026-10-28') as q`;
    check("quote: passed installments with a late fee are refused (late_fee_pending), late fee kept apart",
      q3.eligible === false && q3.reasons.includes("late_fee_pending") && q3.total === q3.fees_total + q3.late_fee_total,
      { reasons: q3.reasons, fees: q3.fees_total, late: q3.late_fee_total });

    const [{ q: q4 }] = await tx`select private.online_payment_quote(${sid}, '{1}'::smallint[], false, date '2026-04-01') as q`;
    check("quote: the hash is stable for unchanged dues", q4.hash === q1.hash, null);

    // Temp table for role-switched reads.
    await tx.unsafe("create temp table dry_ids(k text primary key, v text)");
    await tx.unsafe("grant all on dry_ids to service_role, authenticated, anon");

    // ---- the walls
    await tx.unsafe("set local role service_role");
    await expectError(tx, "wall: service_role cannot use the desk RPC",
      () => tx`select * from public.post_student_payment_with_adjustments(${sid}, date '2026-04-01', 'cash'::payment_mode, 100)`,
      /You do not have permission to post payments/);
    await expectError(tx, "wall: service_role cannot reach the core without a verified capture",
      () => tx`select * from private.post_student_payment_core(${sid}, date '2026-04-01', 'cash'::payment_mode, 100)`,
      /You do not have permission to post payments/);

    // ---- intents
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const [{ r: open1 }] = await tx`select public.online_payment_open_intent(${sid}, null, '{1}'::smallint[], false, 'test', ${expires}::timestamptz, 'dryRunRefAAAAAAAAAAAAAAAAA') as r`;
    check("intent: opened for the quoted amount", open1.ok === true && open1.reused === false && open1.intent.amount_rupees === inst1, open1);
    check("intent: provider reference fits Razorpay's 40 characters", open1.intent.provider_reference_id.length <= 40, open1.intent.provider_reference_id);
    check("intent: One mints a vp1_ reference, never the fees app's vpps_ (D-354)", open1.intent.provider_reference_id.startsWith("vp1_"), open1.intent.provider_reference_id.slice(0, 4));
    const intent1 = open1.intent.id;

    const [{ r: open2 }] = await tx`select public.online_payment_open_intent(${sid}, null, '{1}'::smallint[], false, 'test', ${expires}::timestamptz, 'dryRunRefBBBBBBBBBBBBBBBBB') as r`;
    check("intent: a second tap reuses the same intent", open2.ok === true && open2.reused === true && open2.intent.id === intent1, open2);

    await expectError(tx, "intent: a second OPEN intent for one student is refused by the index",
      () => tx`insert into public.online_payment_intents (public_ref, provider_mode, student_id, session_label, quote, quote_hash, amount_rupees, expires_at, provider_reference_id)
               values ('dryRunRefCCCCCCCCCCCCCCCCC', 'test', ${sid}, 'TEST-2026-27', '{}'::jsonb, 'x', 1, now() + interval '1 day', 'vpps_dryrun_dup')`,
      /online_payment_intents_one_open_per_student/);

    const [{ r: linked }] = await tx`select public.online_payment_link_recorded(${intent1}, 'plink_DRYRUN0001', 'https://rzp.io/i/dryrun') as r`;
    check("link: recorded, intent can be paid", linked.status === "link_created", linked.status);

    // ---- inbox
    const [{ r: ev1 }] = await tx`select public.online_payment_record_event('evt_DRYRUN0001', 'payment_link.paid', 'acc_dry', 'pay_DRYRUNGOOD01', 'plink_DRYRUN0001', 'sha', '{}'::jsonb) as r`;
    const [{ r: ev2 }] = await tx`select public.online_payment_record_event('evt_DRYRUN0001', 'payment_link.paid', 'acc_dry', 'pay_DRYRUNGOOD01', 'plink_DRYRUN0001', 'sha', '{}'::jsonb) as r`;
    check("inbox: a redelivered event is a duplicate", ev1.duplicate === false && ev2.duplicate === true && ev1.id === ev2.id, { ev1, ev2 });

    // ---- captures
    const facts = (over) => tx.json({
      provider_payment_id: "pay_DRYRUNGOOD01",
      provider_link_id: "plink_DRYRUN0001",
      provider_mode: "test",
      amount_paise: inst1 * 100,
      currency: "INR",
      provider_status: "captured",
      captured: true,
      method: "upi",
      fee_paise: 0,
      tax_paise: 0,
      captured_at: "2026-04-01T10:00:00+05:30",
      ...over,
    });

    const [{ r: authOnly }] = await tx`select public.online_payment_record_capture(${facts({ provider_payment_id: "pay_DRYRUNAUTH01", provider_status: "authorized", captured: false })}) as r`;
    check("capture: authorised-only money is not recorded", authOnly.recorded === false && authOnly.reason === "not_captured", authOnly);

    const [{ r: cap1 }] = await tx`select public.online_payment_record_capture(${facts({})}) as r`;
    check("capture: a verified capture is recorded, pending posting", cap1.recorded === true && cap1.capture.application_status === "pending", cap1);
    const [{ r: cap1again }] = await tx`select public.online_payment_record_capture(${facts({})}) as r`;
    check("capture: the same payment twice is one capture", cap1again.duplicate === true && cap1again.capture.id === cap1.capture.id, null);

    const [{ r: applied }] = await tx`select public.online_payment_apply_capture(${cap1.capture.id}) as r`;
    check("posting: the capture posts once through the engine", applied.applied === true && /^TST20260401-\d{4}$/.test(applied.receipt_number), applied);

    const [receipt] = await tx`select r.total_amount, r.reference_number, r.received_by, r.client_request_id::text as crid, (select coalesce(sum(p.amount), 0)::int from public.payments p where p.receipt_id = r.id) as allocated, (select count(distinct p.installment_id)::int from public.payments p where p.receipt_id = r.id) as rows from public.receipts r where r.id = ${applied.receipt_id}`;
    check("posting: receipt amount, reference and allocation are exact",
      receipt.total_amount === inst1 && receipt.allocated === inst1 && receipt.rows === 1 && receipt.reference_number === "pay_DRYRUNGOOD01",
      receipt);

    const [state] = await tx`select i.status, i.receipt_id::text as rid, (select count(*)::int from public.notification_outbox o where o.receipt_id = i.receipt_id) as outbox from public.online_payment_intents i where i.id = ${intent1}`;
    check("posting: intent accounted and the receipt notice queued in the same transaction",
      state.status === "accounted" && state.rid === applied.receipt_id && state.outbox === 1, state);

    const [{ r: appliedAgain }] = await tx`select public.online_payment_apply_capture(${cap1.capture.id}) as r`;
    check("posting: applying twice returns the same receipt", appliedAgain.duplicate === true && appliedAgain.receipt_id === applied.receipt_id, appliedAgain);

    const [{ q: after }] = await tx`select private.online_payment_quote(${sid}, '{1}'::smallint[], false, date '2026-04-01') as q`;
    check("ledger: installment 1 reads nothing due after posting", after.reasons.includes("nothing_due"), after.reasons);

    // ---- cash racing online
    const [{ r: open3 }] = await tx`select public.online_payment_open_intent(${sid}, null, '{2}'::smallint[], false, 'test', ${expires}::timestamptz, 'dryRunRefDDDDDDDDDDDDDDDDD') as r`;
    check("race: installment 2 is quotable once 1 is paid", open3.ok === true, open3);
    const intent3 = open3.intent.id;
    await tx`select public.online_payment_link_recorded(${intent3}, 'plink_DRYRUN0003', 'https://rzp.io/i/dryrun3')`;
    await tx.unsafe(`insert into dry_ids values ('intent3', '${intent3}'), ('sid', '${sid}'), ('amount3', '${open3.intent.amount_rupees}')`);

    await tx.unsafe("reset role");
    await tx.unsafe("set local role authenticated");
    await tx.unsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: admin.id, role: "authenticated" })}', true)`);
    const [desk] = await tx`select * from public.post_student_payment_with_adjustments(${sid}, date '2026-04-01', 'cash'::payment_mode, ${open3.intent.amount_rupees})`;
    check("desk: a staff cash payment still posts through the wrapper", Boolean(desk?.receipt_number), desk);
    await expectError(tx, "wall: staff cannot read the online tables directly",
      () => tx`select count(*) from public.online_payment_intents`, /permission denied/);
    await expectError(tx, "wall: staff cannot open intents (service_role only)",
      () => tx`select public.online_payment_open_intent(${sid}, null, '{3}'::smallint[], false, 'test', ${expires}::timestamptz, 'dryRunRefEEEEEEEEEEEEEEEEE')`,
      /permission denied/);
    await tx.unsafe("reset role");

    const [superseded] = await tx`select status, superseded_reason from public.online_payment_intents where id = ${intent3}`;
    check("race: the cash receipt superseded the open online intent", superseded.status === "superseded" && superseded.superseded_reason === "another_payment_posted", superseded);

    await tx.unsafe("set local role service_role");
    const [{ r: lateCap }] = await tx`select public.online_payment_record_capture(${facts({ provider_payment_id: "pay_DRYRUNRACE01", provider_link_id: "plink_DRYRUN0003", amount_paise: open3.intent.amount_rupees * 100 })}) as r`;
    check("race: the online money that still arrived is recorded", lateCap.recorded === true, lateCap);
    const [{ r: lateApply }] = await tx`select public.online_payment_apply_capture(${lateCap.capture.id}) as r`;
    check("race: it is NOT posted over the cash — it waits for review", lateApply.applied === false && lateApply.status === "review_required", lateApply);
    const [{ n: deskReceipts }] = await tx`select count(*)::int as n from public.receipts where student_id = ${sid}`;
    check("race: exactly two receipts exist (online 1 + cash 2), no over-credit", deskReceipts === 2, deskReceipts);

    // ---- the provider facts that do not match
    const [{ r: unknown }] = await tx`select public.online_payment_record_capture(${facts({ provider_payment_id: "pay_DRYRUNUNKN01", provider_link_id: "plink_NOTOURS", amount_paise: 12345 })}) as r`;
    check("capture: an unknown link is kept, in review, with a fractional rupee flagged",
      unknown.capture.application_status === "review_required" && /unknown_link/.test(unknown.capture.review_reason) && /fractional_rupee/.test(unknown.capture.review_reason),
      unknown.capture.review_reason);

    // A second synthetic student, so the mismatch cases start from a clean
    // installment 1 rather than whatever the race left behind.
    const [other] = await tx`
      select s.id from public.students s
      join public.classes c on c.id = s.class_id
      where s.admission_no like 'TEST-%' and c.session_label = 'TEST-2026-27' and s.status = 'active'
        and s.id <> ${sid}
        and not exists (select 1 from public.receipts r where r.student_id = s.id)
        and not exists (select 1 from public.student_repayment_plans p where p.student_id = s.id and p.lifecycle = 'active')
      order by s.admission_no limit 1`;
    const [{ r: open5 }] = await tx`select public.online_payment_open_intent(${other.id}, null, '{1}'::smallint[], false, 'test', ${expires}::timestamptz, 'dryRunRefFFFFFFFFFFFFFFFFF') as r`;
    check("intent: a second student's installment 1 opens", open5.ok === true, open5);
    await tx`select public.online_payment_link_recorded(${open5.intent.id}, 'plink_DRYRUN0005', 'https://rzp.io/i/dryrun5')`;
    const [{ r: wrongMode }] = await tx`select public.online_payment_record_capture(${facts({ provider_payment_id: "pay_DRYRUNMODE01", provider_link_id: "plink_DRYRUN0005", provider_mode: "live", amount_paise: (open5.intent.amount_rupees + 1) * 100 })}) as r`;
    check("capture: wrong environment and wrong amount are review, not posting",
      wrongMode.capture.application_status === "review_required" && /wrong_mode/.test(wrongMode.capture.review_reason) && /wrong_amount/.test(wrongMode.capture.review_reason),
      wrongMode.capture.review_reason);
    const [{ r: wrongApply }] = await tx`select public.online_payment_apply_capture(${wrongMode.capture.id}) as r`;
    check("posting: a capture in review is never posted", wrongApply.applied === false, wrongApply);
    const [{ n: otherReceipts }] = await tx`select count(*)::int as n from public.receipts where student_id = ${other.id}`;
    check("posting: the mismatched capture left no receipt", otherReceipts === 0, otherReceipts);

    // ---- outbox
    const claimed = await tx`select * from public.notification_outbox_claim(10, 120)`;
    check("outbox: the queued receipt notice is claimed once", claimed.length === 1 && claimed[0].status === "processing", claimed.length);
    const reclaimed = await tx`select * from public.notification_outbox_claim(10, 120)`;
    check("outbox: a leased job is not handed out twice", reclaimed.length === 0, reclaimed.length);
    await tx`select public.notification_outbox_complete(${claimed[0].id}, 'provider_accepted', 'msg_dry', null, null)`;

    // ---- switches and history
    await tx.unsafe("reset role");
    await tx`update public.app_settings set value = 'false' where key = 'online_payment_links_enabled'`;
    await tx.unsafe("set local role service_role");
    const [{ r: off }] = await tx`select public.online_payment_open_intent(${sid}, null, '{4}'::smallint[], false, 'test', ${expires}::timestamptz, 'dryRunRefGGGGGGGGGGGGGGGGG') as r`;
    check("switch: with links off, no intent is opened", off.ok === false && off.reason === "links_disabled", off);
    await expectError(tx, "audit: service_role holds no UPDATE on history",
      () => tx`update public.online_payment_audit set action = 'x'`, /permission denied/);
    await tx.unsafe("reset role");
    await expectError(tx, "audit: even the owner cannot rewrite history (trigger)",
      () => tx`update public.online_payment_audit set action = 'x'`, /append-only/);
    await tx.unsafe("set local role service_role");
    const [{ n: auditRows }] = await tx`select count(*)::int as n from public.online_payment_audit`;
    check("audit: every decision left a row", auditRows >= 8, auditRows);
    const [recon] = await tx`select sum(captures)::int as captures, sum(applied)::int as applied, sum(in_review)::int as in_review from public.v_online_payment_reconciliation`;
    check("reconciliation: every capture is applied or in review", recon.captures === recon.applied + recon.in_review, recon);
    await tx.unsafe("reset role");

    throw new Rollback();
  });
} catch (caught) {
  if (!(caught instanceof Rollback)) {
    console.log(JSON.stringify({ rolledBack: true, results, error: caught.message, detail: caught.detail ?? null }, null, 2));
    await sql.end({ timeout: 5 });
    process.exit(1);
  }
}

await sql.end({ timeout: 5 });
console.log(JSON.stringify({
  rolledBack: true,
  seconds: Math.round((Date.now() - startedAt) / 100) / 10,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  results: results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}`),
}, null, 2));
