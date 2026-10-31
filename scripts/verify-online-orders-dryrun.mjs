#!/usr/bin/env node
/**
 * Dry-run the one-tap orders migration against the DEV database, end to end,
 * and leave nothing behind.
 *
 * One transaction: apply the online-payments migrations the orders build on
 * (`20261028140100`, `20261029020128`) and then `20261029190000`, and drive the
 * real posting engine through every money path the orders add — the pay-page
 * read, every open_order refusal, supersession, captures that do and do not
 * match, a two-child posting, a replay, the permission walls, a counter
 * payment racing an online one — against existing synthetic `TEST-` students,
 * and then ROLL BACK. Nothing is committed, ever.
 *
 * It refuses the production project outright, by ref, before connecting.
 *
 *   node scripts/verify-online-orders-dryrun.mjs --env "<path to .env.local>"
 *
 * Reads exactly two keys from that file — SUPABASE_DEV_PROJECT_REF and
 * SUPABASE_DEV_DB_PASSWORD — and prints neither.
 *
 * As in `verify-online-payments-dryrun.mjs`, `'online'::payment_mode` posts as
 * `'upi'` here: Postgres refuses an enum value inside the transaction that adds
 * it.
 *
 * ONE (go-live Phase E): ported from the fees app and adapted to One's main
 * database, wtgxcptmucjerhufzjcf, which is production and the only test bed
 * (D-338, D-346). Three changes, nothing else:
 *   - it connects through scripts/migrate/lib/one-db.mjs (the session pooler,
 *     `SUPABASE_DEV_DB_PASSWORD` from .env.local, printed nowhere), which
 *     refuses every project but wtgx and refuses the fees app's live database
 *     by name;
 *   - it does NOT apply the migrations: they are on wtgx already, as the
 *     fee-migrations fee_20261028140100_online_payments_no_cron, fee_20261029020128_online_payments_server_grants, fee_20261029190000_online_payment_orders, fee_20261031120000_online_vp1_ownership, fee_20261031120100_receipt_suffix_floor (and One's own changes to them —
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
let seq = 0;
const ref20 = () => `dryOrderRef${String(++seq).padStart(4, "0")}AAAAAAAAAA`;

try {
  await sql.begin(async (tx) => {
    await assertApplied(tx, ["fee_20261028140100_online_payments_no_cron","fee_20261029020128_online_payments_server_grants","fee_20261029190000_online_payment_orders","fee_20261031120000_online_vp1_ownership","fee_20261031120100_receipt_suffix_floor"]);
    await tx`update public.app_settings set value = 'true'
             where key in ('online_payment_links_enabled', 'online_payment_auto_posting_enabled', 'online_payment_checkout_enabled')`;

    const students = await tx`
      select s.id, s.admission_no, s.full_name
      from public.students s
      join public.classes c on c.id = s.class_id
      where s.admission_no like 'TEST-%' and c.session_label = 'TEST-2026-27' and s.status = 'active'
        and not exists (select 1 from public.receipts r where r.student_id = s.id)
        and not exists (select 1 from public.student_repayment_plans p where p.student_id = s.id and p.lifecycle = 'active')
      order by s.admission_no limit 4`;
    check("four synthetic TEST students exist", students.length === 4 && students.every((s) => s.admission_no.startsWith("TEST-")), students.map((s) => s.admission_no));
    const [a, b, c, d] = students;

    const [admin] = await tx`select id from public.users where role = 'admin' and is_active = true limit 1`;
    check("an admin staff user exists for the desk path", Boolean(admin), null);

    const today = (await tx`select private.ist_today()::text as d`)[0].d;
    const owed = async (id) => (await tx`select private.online_student_owed(${id}, ${today}) as n`)[0].n;
    const owedA = await owed(a.id);
    const owedB = await owed(b.id);
    check("each child owes something this session", owedA >= 200 && owedB >= 200, { owedA, owedB });

    const makeSend = async (ids, code) => {
      const [row] = await tx`
        insert into public.whatsapp_reminder_sends
          (student_id, session_label, sent_on, campaign_name, destination, due_amount, template_params, status,
           language, destination_role, pay_code, pay_code_expires_on, pay_scope)
        values (${ids[0]}, 'TEST-2026-27', ${today}, ${"dryrun_" + code}, '919999999999', 100, '[]'::jsonb, 'sent',
                'hi', 'primary', ${code}, ${today}::date + 21,
                ${tx.json({ studentIds: ids, installments: [1], lastYear: false, situation: "fee_due", amount: 100 })})
        returning id`;
      return row.id;
    };
    const send1 = await makeSend([a.id, b.id], "dryRunCodeAAAAAAAAAAAAAAAAAA");
    const send2 = await makeSend([c.id, d.id], "dryRunCodeBBBBBBBBBBBBBBBBBB");

    // ---- the pay page
    const [{ p: page }] = await tx`select public.online_payment_pay_page(${send1}) as p`;
    check("page: two children, first names and class only", page.ok === true && page.children.length === 2
      && page.children[0].first_name === a.full_name.trim().split(" ")[0] && typeof page.children[0].class_label === "string", page.children.map((k) => k.first_name));
    check("page: no admission number or phone anywhere in the payload",
      !JSON.stringify(page).includes(a.admission_no) && !JSON.stringify(page).includes("919999999999"), null);
    check("page: whole_session equals what the core will accept", page.children[0].whole_session === owedA && page.children[1].whole_session === owedB, { page: page.children.map((k) => k.whole_session), owedA, owedB });
    check("page: every row is listed, paid or not, and late fee kept apart",
      page.children[0].rows.length >= 4 && page.children[0].rows.every((r) => "late_fee_pending" in r && "fees_pending" in r), page.children[0].rows.length);
    check("page: clear_to_date never exceeds whole_session", page.children.every((k) => k.clear_to_date <= k.whole_session), null);
    check("page: checkout reads as enabled", page.checkout_enabled === true && page.min_line_rupees === 100, null);

    // ---- open_order refusals
    const open = async (send, lines) => (await tx`select public.online_payment_open_order(${send}, ${tx.json(lines)}, 'test', ${ref20()}) as r`)[0].r;
    check("refuse: an index outside the reminder", (await open(send1, [{ index: 2, amount_rupees: 100 }])).reason === "bad_line", null);
    check("refuse: the same child twice", (await open(send1, [{ index: 0, amount_rupees: 100 }, { index: 0, amount_rupees: 100 }])).reason === "bad_line", null);
    check("refuse: under ₹100", (await open(send1, [{ index: 0, amount_rupees: 99 }])).reason === "amount_out_of_range", null);
    check("refuse: more than the whole session", (await open(send1, [{ index: 0, amount_rupees: owedA + 1 }])).reason === "amount_out_of_range", null);
    check("refuse: paise", (await open(send1, [{ index: 0, amount_rupees: 100.5 }])).reason === "whole_rupees_only", null);
    check("refuse: no lines", (await open(send1, [])).reason === "no_lines", null);
    await tx`update public.app_settings set value = '150' where key = 'online_payment_order_max_rupees'`;
    check("refuse: over the order cap", (await open(send1, [{ index: 0, amount_rupees: 100 }, { index: 1, amount_rupees: 100 }])).reason === "order_over_cap", null);
    await tx`update public.app_settings set value = '100000' where key = 'online_payment_order_max_rupees'`;
    await tx`update public.app_settings set value = 'false' where key = 'online_payment_checkout_enabled'`;
    check("refuse: checkout switched off", (await open(send1, [{ index: 0, amount_rupees: 100 }])).reason === "switched_off", null);
    await tx`update public.app_settings set value = 'true' where key = 'online_payment_checkout_enabled'`;

    // ---- opening, supersession, recording
    const first = await open(send1, [{ index: 0, amount_rupees: 100 }, { index: 1, amount_rupees: 150 }]);
    check("open: two lines make one order for the total", first.ok === true && first.order.amount_rupees === 250 && first.order.provider_receipt.length <= 40, first);
    check("open: One mints a vp1_o_ order receipt, never the fees app's vpps_o_ (D-354)", first.order.provider_receipt.startsWith("vp1_o_"), first.order.provider_receipt.slice(0, 6));
    const second = await open(send1, [{ index: 0, amount_rupees: 100 }, { index: 1, amount_rupees: 150 }]);
    const [firstNow] = await tx`select status, superseded_reason from public.online_payment_orders where id = ${first.order.id}`;
    check("open: a second tap supersedes the first order", second.ok === true && firstNow.status === "superseded", firstNow);
    const orderId = second.order.id;
    const [{ r: recorded }] = await tx`select public.online_payment_order_recorded(${orderId}, 'order_DRYRUN0001') as r`;
    check("record: the Razorpay order id is kept and the order is open", recorded.status === "open" && recorded.provider_order_id === "order_DRYRUN0001", recorded.status);
    await expectError(tx, "record: an order never takes a second Razorpay order id",
      () => tx`select public.online_payment_order_recorded(${orderId}, 'order_DRYRUN0002')`, /different Razorpay order/);

    // ---- captures
    const facts = (over) => tx.json({
      provider_payment_id: "pay_DRYORDGOOD1", provider_order_id: "order_DRYRUN0001", provider_mode: "test",
      amount_paise: 25000, currency: "INR", provider_status: "captured", captured: true, method: "upi",
      fee_paise: 0, tax_paise: 0, captured_at: new Date().toISOString(), ...over,
    });
    const [{ r: authOnly }] = await tx`select public.online_payment_record_order_capture(${facts({ provider_payment_id: "pay_DRYORDAUTH1", provider_status: "authorized", captured: false })}) as r`;
    check("capture: authorised-only money is not recorded", authOnly.recorded === false, authOnly);
    const [{ r: unknown }] = await tx`select public.online_payment_record_order_capture(${facts({ provider_payment_id: "pay_DRYORDUNKN1", provider_order_id: "order_NOTOURS01" })}) as r`;
    check("capture: an unknown order is kept, in review", unknown.capture.application_status === "review_required" && /unknown_order/.test(unknown.capture.review_reason), unknown.capture.review_reason);
    const [{ r: cap }] = await tx`select public.online_payment_record_order_capture(${facts({})}) as r`;
    check("capture: a verified capture on our order is pending", cap.recorded === true && cap.capture.application_status === "pending" && cap.capture.order_id === orderId, cap.capture);
    const [{ r: capAgain }] = await tx`select public.online_payment_record_order_capture(${facts({})}) as r`;
    check("capture: the same payment twice is one capture", capAgain.duplicate === true && capAgain.capture.id === cap.capture.id, null);

    // ---- the walls, as service_role
    await tx.unsafe("create temp table dry_ids(k text primary key, v text)");
    await tx.unsafe("grant all on dry_ids to service_role, authenticated, anon");
    await tx.unsafe("set local role service_role");
    await expectError(tx, "wall: service_role cannot use the desk RPC",
      () => tx`select * from public.post_student_payment_with_adjustments(${a.id}, ${today}, 'cash'::payment_mode, 100)`, /permission to post payments/);
    await expectError(tx, "wall: the core refuses without a verified capture",
      () => tx`select * from private.post_student_payment_core(${a.id}, ${today}, 'cash'::payment_mode, 100)`, /permission to post payments/);
    await tx`select set_config('vpps.online_capture_id', ${cap.capture.id}, true)`;
    await expectError(tx, "wall: the core refuses a student who is not on the order",
      () => tx`select * from private.post_student_payment_core(${c.id}, ${today}, 'cash'::payment_mode, 100)`, /permission to post payments/);
    await tx`select set_config('vpps.online_capture_id', '', true)`;

    // ---- posting
    const [{ r: applied }] = await tx`select public.online_payment_apply_order_capture(${cap.capture.id}) as r`;
    check("post: both children posted, one receipt each", applied.applied === true && applied.receipts.length === 2, applied);
    const receipts = await tx`
      select r.student_id, r.total_amount, r.reference_number, r.payment_mode::text as mode,
             (select coalesce(sum(p.amount), 0)::int from public.payments p where p.receipt_id = r.id) as allocated
      from public.receipts r where r.id in ${tx(applied.receipts.map((x) => x.receipt_id))}`;
    const byStudent = Object.fromEntries(receipts.map((r) => [r.student_id, r]));
    check("post: each receipt carries exactly its child's line",
      byStudent[a.id]?.total_amount === 100 && byStudent[b.id]?.total_amount === 150
      && receipts.every((r) => r.allocated === r.total_amount && r.reference_number === "pay_DRYORDGOOD1"), receipts);
    const [state] = await tx`
      select o.status, (select count(*)::int from public.notification_outbox n where n.receipt_id in ${tx(applied.receipts.map((x) => x.receipt_id))}) as outbox,
             (select count(*)::int from public.online_payment_order_lines l where l.order_id = o.id and l.receipt_id is not null) as lines_receipted
      from public.online_payment_orders o where o.id = ${orderId}`;
    check("post: order accounted, both lines receipted, two receipt notices queued", state.status === "accounted" && state.lines_receipted === 2 && state.outbox === 2, state);
    const [{ r: replay }] = await tx`select public.online_payment_apply_order_capture(${cap.capture.id}) as r`;
    check("post: applying twice posts nothing new", replay.applied === true && replay.duplicate === true, replay);
    check("ledger: each child now owes exactly the line less", (await owed(a.id)) === owedA - 100 && (await owed(b.id)) === owedB - 150, null);
    await tx.unsafe("reset role");

    // ---- a counter payment racing the online one: all or nothing
    const owedD = await owed(d.id);
    const race = await open(send2, [{ index: 0, amount_rupees: 100 }, { index: 1, amount_rupees: owedD }]);
    check("race: an order for one child's part and the other's whole balance opens", race.ok === true, race);
    await tx`select public.online_payment_order_recorded(${race.order.id}, 'order_DRYRUN0003')`;
    const [{ r: raceCap }] = await tx`select public.online_payment_record_order_capture(${facts({ provider_payment_id: "pay_DRYORDRACE1", provider_order_id: "order_DRYRUN0003", amount_paise: (100 + owedD) * 100 })}) as r`;
    check("race: the online money is recorded, pending", raceCap.capture.application_status === "pending", raceCap.capture);
    await tx.unsafe("set local role authenticated");
    await tx.unsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: admin.id, role: "authenticated" })}', true)`);
    const [desk] = await tx`select * from public.post_student_payment_with_adjustments(${d.id}, ${today}, 'cash'::payment_mode, 1)`;
    check("race: the desk takes ₹1 cash from the second child meanwhile", Boolean(desk?.receipt_number), desk);
    await expectError(tx, "wall: staff cannot read the order tables", () => tx`select count(*) from public.online_payment_orders`, /permission denied/);
    await expectError(tx, "wall: staff cannot open orders", () => tx`select public.online_payment_open_order(${send2}, '[]'::jsonb, 'test', ${ref20()})`, /permission denied/);
    await tx.unsafe("reset role");
    const [{ n: cBefore }] = await tx`select count(*)::int as n from public.receipts where student_id = ${c.id}`;
    const [{ r: raceApply }] = await tx`select public.online_payment_apply_order_capture(${raceCap.capture.id}) as r`;
    check("race: the whole capture waits for review", raceApply.applied === false && raceApply.status === "review_required" && /dues_changed/.test(raceApply.reason), raceApply);
    const [{ n: cAfter }] = await tx`select count(*)::int as n from public.receipts where student_id = ${c.id}`;
    check("race: the child whose line still fitted got NO receipt either", cAfter === cBefore, { cBefore, cAfter });

    // ---- mismatched provider facts on our own order
    const mis = await open(send2, [{ index: 0, amount_rupees: 100 }]);
    await tx`select public.online_payment_order_recorded(${mis.order.id}, 'order_DRYRUN0004')`;
    const [{ r: wrong }] = await tx`select public.online_payment_record_order_capture(${facts({ provider_payment_id: "pay_DRYORDMODE1", provider_order_id: "order_DRYRUN0004", provider_mode: "live", amount_paise: 10050 })}) as r`;
    check("capture: wrong environment, amount and paise are review, not posting",
      wrong.capture.application_status === "review_required" && /wrong_mode/.test(wrong.capture.review_reason)
      && /wrong_amount/.test(wrong.capture.review_reason) && /fractional_rupee/.test(wrong.capture.review_reason), wrong.capture.review_reason);
    const [{ r: wrongApply }] = await tx`select public.online_payment_apply_order_capture(${wrong.capture.id}) as r`;
    check("post: a capture in review is never posted", wrongApply.applied === false, wrongApply);

    // ---- the rate limit
    let limited = null;
    for (let i = 0; i < 16 && !limited; i += 1) {
      const result = await open(send1, [{ index: 0, amount_rupees: 100 }]);
      if (!result.ok) limited = result.reason;
    }
    check("refuse: more than fifteen orders an hour for one reminder", limited === "too_many_orders", limited);

    // ---- grants and reconciliation
    await tx.unsafe("set local role service_role");
    await expectError(tx, "grant: service_role cannot delete an order", () => tx`delete from public.online_payment_orders`, /permission denied/);
    await expectError(tx, "grant: service_role cannot delete an order line", () => tx`delete from public.online_payment_order_lines`, /permission denied/);
    const [recon] = await tx`select sum(captures)::int as captures, sum(applied)::int as applied, sum(in_review)::int as in_review,
                                    sum(awaiting_posting)::int as pending, sum(applied_paise)::bigint as applied_paise, sum(receipted_paise)::bigint as receipted_paise
                             from public.v_online_payment_reconciliation`;
    check("reconciliation: every capture is applied, in review or waiting", recon.captures === recon.applied + recon.in_review + recon.pending, recon);
    check("reconciliation: applied order money equals the receipts on its lines", Number(recon.applied_paise) === Number(recon.receipted_paise), recon);
    await tx.unsafe("reset role");
    await tx.unsafe("set local role anon");
    await expectError(tx, "grant: anon cannot read the pay page function", () => tx`select public.online_payment_pay_page(${send1})`, /permission denied/);
    await tx.unsafe("reset role");

    // ---- the Payment Link path still posts through the replaced guard
    const [legacy] = await tx`
      select s.id from public.students s
      join public.classes c on c.id = s.class_id
      where s.admission_no like 'TEST-%' and c.session_label = 'TEST-2026-27' and s.status = 'active'
        and s.id not in ${tx([a.id, b.id, c.id, d.id])}
        and not exists (select 1 from public.receipts r where r.student_id = s.id)
        and not exists (select 1 from public.student_repayment_plans p where p.student_id = s.id and p.lifecycle = 'active')
      order by s.admission_no limit 1`;
    await tx.unsafe("create or replace function private.ist_today() returns date language sql stable as $$ select date '2026-04-01' $$");
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const [{ r: intent }] = await tx`select public.online_payment_open_intent(${legacy.id}, null, '{1}'::smallint[], false, 'test', ${expires}::timestamptz, ${ref20()}) as r`;
    check("legacy: a Payment Link intent still opens", intent.ok === true, intent);
    await tx`select public.online_payment_link_recorded(${intent.intent.id}, 'plink_DRYORDLEG1', 'https://rzp.io/i/dry')`;
    const [{ r: legacyCap }] = await tx`select public.online_payment_record_capture(${tx.json({
      provider_payment_id: "pay_DRYORDLEG01", provider_link_id: "plink_DRYORDLEG1", provider_mode: "test",
      amount_paise: intent.intent.amount_rupees * 100, currency: "INR", provider_status: "captured", captured: true,
      method: "upi", fee_paise: 0, tax_paise: 0, captured_at: "2026-04-01T10:00:00+05:30",
    })}) as r`;
    await tx.unsafe("set local role service_role");
    const [{ r: legacyApplied }] = await tx`select public.online_payment_apply_capture(${legacyCap.capture.id}) as r`;
    check("legacy: a Payment Link capture still posts through the replaced guard", legacyApplied.applied === true && Boolean(legacyApplied.receipt_number), legacyApplied);
    await tx.unsafe("reset role");

    throw new Rollback();
  });
} catch (caught) {
  if (!(caught instanceof Rollback)) {
    console.log(JSON.stringify({ rolledBack: true, results: results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}`), error: caught.message, detail: caught.detail ?? null }, null, 2));
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
