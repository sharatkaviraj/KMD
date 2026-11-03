#!/usr/bin/env node
/**
 * Dry-run `20261030120000_online_payment_late_fee_policy.sql` against the DEV
 * database, end to end, and leave nothing behind.
 *
 * One transaction: apply the online migrations it builds on, then the policy,
 * and drive the real posting engine through it with synthetic `TEST-` students
 * — a child with a late fee still owed, a child whose late fee was already paid
 * at the desk, a replay, the policy switched off, and a posting refused half
 * way — then ROLL BACK. Nothing is committed, ever.
 *
 * It refuses the production project outright, by ref, before connecting.
 *
 *   node scripts/verify-online-late-fee-waiver-dryrun.mjs --env "<path to .env.local>"
 *
 * Reads exactly two keys from that file — SUPABASE_DEV_PROJECT_REF and
 * SUPABASE_DEV_DB_PASSWORD — and prints neither. As in the other online dry
 * runs, `'online'::payment_mode` posts as `'upi'` here.
 *
 * ONE (go-live Phase E): ported from the fees app and adapted to One's main
 * database, wtgxcptmucjerhufzjcf, which is production and the only test bed
 * (D-338, D-346). Three changes, nothing else:
 *   - it connects through scripts/migrate/lib/one-db.mjs (the session pooler,
 *     `SUPABASE_DEV_DB_PASSWORD` from .env.local, printed nowhere), which
 *     refuses every project but wtgx and refuses the fees app's live database
 *     by name;
 *   - it does NOT apply the migrations: they are on wtgx already, as the
 *     fee-migrations fee_20261028140100_online_payments_no_cron, fee_20261029020128_online_payments_server_grants, fee_20261029190000_online_payment_orders, fee_20261030120000_online_payment_late_fee_policy, fee_20261031120000_online_vp1_ownership, fee_20261031120100_receipt_suffix_floor (and One's own changes to them —
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



const sql = await openOneDb(loadOneEnv());
const startedAt = Date.now();
let seq = 0;
const ref20 = () => `dryWaiveRef${String(++seq).padStart(4, "0")}AAAAAAAAAA`;

try {
  await sql.begin(async (tx) => {
    await assertApplied(tx, ["fee_20261028140100_online_payments_no_cron","fee_20261029020128_online_payments_server_grants","fee_20261029190000_online_payment_orders","fee_20261030120000_online_payment_late_fee_policy","fee_20261031120000_online_vp1_ownership","fee_20261031120100_receipt_suffix_floor"]);
    await tx`update public.app_settings set value = 'true'
             where key in ('online_payment_links_enabled', 'online_payment_auto_posting_enabled', 'online_payment_checkout_enabled')`;

    // ONE: the fees migration seeds the policy 'true'; on One every online
    // switch starts 'false' (fee-migration 20261031120200) and is set to its
    // C7 value at cutover (docs/cutover/RAZORPAY.md). So: off as One left it,
    // then on inside this transaction, as C7 sets it for 2026-27.
    const [{ v: seeded }] = await tx`select value as v from public.app_settings where key = 'online_payment_waive_late_fees'`;
    check("the policy is off on One until C7", seeded === "false", seeded);
    await tx`update public.app_settings set value = 'true' where key = 'online_payment_waive_late_fees'`;

    const today = (await tx`select private.ist_today()::text as d`)[0].d;
    const snap = async (id) => (await tx`
      select coalesce(sum(total_pending) filter (where total_pending > 0), 0)::int as owed_raw,
             coalesce(sum(greatest(final_late_fee, 0)), 0)::int as late_fees,
             coalesce(sum(greatest(late_fee_pending, 0)), 0)::int as late_pending,
             coalesce(sum(greatest(late_fee_settled_amount, 0)), 0)::int as late_settled,
             coalesce(sum(greatest(pending_amount, 0)), 0)::int as fees_pending
      from private.workbook_installment_snapshot(${id}, ${today}, true)`)[0];
    const owed = async (id) => (await tx`select private.online_student_owed(${id}, ${today}) as n`)[0].n;
    const waivers = async (id) => (await tx`
      select count(*)::int as n, coalesce(sum(amount), 0)::int as total
      from public.student_late_fee_waivers where student_id = ${id} and source = 'online_payment' and voided_at is null`)[0];

    // Synthetic students with a late fee still owed and no money yet.
    const lateStudents = await tx`
      select s.id, s.admission_no
      from public.students s
      join public.classes c on c.id = s.class_id
      where s.admission_no like 'TEST-%' and c.session_label = 'TEST-2026-27' and s.status = 'active'
        and not exists (select 1 from public.receipts r where r.student_id = s.id)
        and not exists (select 1 from public.student_repayment_plans p where p.student_id = s.id and p.lifecycle = 'active')
        and (select coalesce(sum(late_fee_pending), 0) from private.workbook_installment_snapshot(s.id, ${today}, true)) > 0
      order by s.admission_no limit 4`;
    check("four synthetic TEST students with a late fee owed exist", lateStudents.length === 4 && lateStudents.every((s) => s.admission_no.startsWith("TEST-")), lateStudents.map((s) => s.admission_no));
    const [a, b, c, d] = lateStudents;

    // ---- what a child may pay, with the policy on
    const sa = await snap(a.id);
    check("owed: the late fee comes off what a child may pay online", (await owed(a.id)) === Math.max(0, sa.owed_raw - sa.late_fees), { owed: await owed(a.id), ...sa });
    await tx`update public.app_settings set value = 'false' where key = 'online_payment_waive_late_fees'`;
    check("owed: with the policy off it is the whole balance, as before", (await owed(a.id)) === sa.owed_raw, sa);
    await tx`update public.app_settings set value = 'true' where key = 'online_payment_waive_late_fees'`;

    const makeSend = async (ids, code) => {
      const [row] = await tx`
        insert into public.whatsapp_reminder_sends
          (student_id, session_label, sent_on, campaign_name, destination, due_amount, template_params, status,
           language, destination_role, pay_code, pay_code_expires_on, pay_scope)
        values (${ids[0]}, 'TEST-2026-27', ${today}, ${"dryrun_" + code}, '919999999999', 100, '[]'::jsonb, 'sent',
                'hi', 'primary', ${code}, ${today}::date + 21,
                ${tx.json({ studentIds: ids, installments: [1, 2, 3], lastYear: false, situation: "fee_due", amount: 100 })})
        returning id`;
      return row.id;
    };
    const open = async (send, lines) => (await tx`select public.online_payment_open_order(${send}, ${tx.json(lines)}, 'test', ${ref20()}) as r`)[0].r;
    const facts = (over) => tx.json({
      provider_mode: "test", currency: "INR", provider_status: "captured", captured: true, method: "upi",
      fee_paise: 0, tax_paise: 0, captured_at: new Date().toISOString(), ...over,
    });
    let orderSeq = 0;
    const payOnline = async (send, lines) => {
      const opened = await open(send, lines);
      if (!opened.ok) return { opened };
      orderSeq += 1;
      const orderId = `order_DRYWAIVE${String(orderSeq).padStart(4, "0")}`;
      const paymentId = `pay_DRYWAIVE${String(orderSeq).padStart(4, "0")}`;
      await tx`select public.online_payment_order_recorded(${opened.order.id}, ${orderId})`;
      const [{ r: cap }] = await tx`select public.online_payment_record_order_capture(${facts({ provider_payment_id: paymentId, provider_order_id: orderId, amount_paise: opened.order.amount_paise })}) as r`;
      const [{ r: applied }] = await tx`select public.online_payment_apply_order_capture(${cap.capture.id}) as r`;
      return { opened, cap, applied, paymentId };
    };

    // ---- bounds: the page's fees-only figure is exactly what an order may carry
    const sendA = await makeSend([a.id], "dryWaiveCodeAAAAAAAAAAAAAAAA");
    const [{ p: page }] = await tx`select public.online_payment_pay_page(${sendA}) as p`;
    const pageLateFees = page.children[0].rows.reduce((sum, row) => sum + Math.max(0, row.late_fee), 0);
    check("page: whole session less every late fee charged is what the database will accept",
      page.children[0].whole_session - pageLateFees === (await owed(a.id)), { whole: page.children[0].whole_session, pageLateFees, owed: await owed(a.id) });
    const owedA = await owed(a.id);
    check("bounds: one rupee over the fees-only balance is refused", (await open(sendA, [{ index: 0, amount_rupees: owedA + 1 }])).reason === "amount_out_of_range", owedA);

    // ---- a child with a late fee still owed pays part of their fees online
    const before = await snap(a.id);
    const paid = await payOnline(sendA, [{ index: 0, amount_rupees: 100 }]);
    check("post: the payment posts", paid.applied?.applied === true && paid.applied.receipts.length === 1, paid.applied ?? paid.opened);
    const waivedA = await waivers(a.id);
    check("waive: every late fee of the child is forgiven, marked as an online payment's", waivedA.total === before.late_fees && waivedA.n > 0, { waivedA, before });
    check("waive: the receipt says how much was waived", paid.applied.receipts[0].late_fee_waived === before.late_fees, paid.applied.receipts[0]);
    const after = await snap(a.id);
    check("ledger: no late fee is left on the child", after.late_pending === 0 && after.late_fees === 0, after);
    check("ledger: the money went to fees, not to a late fee", after.fees_pending === before.fees_pending - 100, { before: before.fees_pending, after: after.fees_pending });
    check("ledger: what they owe online fell by exactly the payment", (await owed(a.id)) === owedA - 100, { owedA, now: await owed(a.id) });
    const [{ reason }] = await tx`select reason from public.student_late_fee_waivers where student_id = ${a.id} and source = 'online_payment' limit 1`;
    check("waive: the reason names the payment and the policy", reason.includes(paid.paymentId) && /not taken this year/.test(reason), reason);

    // ---- replays forgive nothing twice
    const [{ r: replay }] = await tx`select public.online_payment_apply_order_capture(${paid.cap.capture.id}) as r`;
    check("replay: applying again posts nothing", replay.applied === true && replay.duplicate === true, replay);
    const [{ n: again }] = await tx`select private.online_waive_late_fees(${a.id}, ${paid.paymentId}, ${today}) as n`;
    check("replay: waiving again for the same payment forgives nothing", again === 0 && (await waivers(a.id)).total === waivedA.total, again);

    // ---- a late fee the family already PAID is forgiven too, and becomes fees
    const [admin] = await tx`select id from public.users where role = 'admin' and is_active = true limit 1`;
    check("an admin staff user exists for the desk", Boolean(admin), null);
    const firstLate = (await tx`
      select installment_id, total_pending, final_late_fee
      from private.workbook_installment_snapshot(${b.id}, ${today}, true)
      where late_fee_pending > 0 order by settlement_rank limit 1`)[0];
    const rowsAhead = (await tx`
      select coalesce(sum(total_pending), 0)::int as n
      from private.workbook_installment_snapshot(${b.id}, ${today}, true)
      where settlement_rank < (select settlement_rank from private.workbook_installment_snapshot(${b.id}, ${today}, true) where installment_id = ${firstLate.installment_id})
        and total_pending > 0`)[0].n;
    await tx.unsafe("set local role authenticated");
    await tx.unsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: admin.id, role: "authenticated" })}', true)`);
    const [desk] = await tx`select * from public.post_student_payment_with_adjustments(${b.id}, ${today}, 'cash'::payment_mode, ${rowsAhead + firstLate.total_pending})`;
    await tx.unsafe("reset role");
    check("desk: cash clears the first late installment, its late fee included", Boolean(desk?.receipt_number), desk);
    const bBefore = await snap(b.id);
    check("desk: the child now has a late fee that was PAID", bBefore.late_settled > 0, bBefore);
    const owedB = await owed(b.id);
    check("owed: a paid late fee also comes off, as the waiver will move it onto fees",
      owedB === Math.max(0, bBefore.owed_raw - bBefore.late_fees), { owedB, ...bBefore });

    const sendB = await makeSend([b.id], "dryWaiveCodeBBBBBBBBBBBBBBBB");
    const paidB = await payOnline(sendB, [{ index: 0, amount_rupees: owedB }]);
    check("post: the whole fees-only balance posts — not refused as too much", paidB.applied?.applied === true, paidB.applied ?? paidB.opened);
    const bAfter = await snap(b.id);
    check("waive: the paid late fee was forgiven along with the owed one", (await waivers(b.id)).total === bBefore.late_fees, { waived: await waivers(b.id), bBefore });
    check("ledger: the child owes nothing this session, and no late fee", bAfter.owed_raw === 0 && bAfter.late_fees === 0, bAfter);

    // ---- a posting refused half way takes its waiver back with it
    await tx.unsafe(`create function pg_temp.refuse_one() returns trigger language plpgsql as $$
      begin
        if new.student_id = '${d.id}' then raise exception 'dry run: refuse this child'; end if;
        return new;
      end $$`);
    await tx.unsafe("create trigger dry_refuse_one before insert on public.receipts for each row execute function pg_temp.refuse_one()");
    const sendCD = await makeSend([c.id, d.id], "dryWaiveCodeCCCCCCCCCCCCCCCC");
    const cBefore = await snap(c.id);
    const refused = await payOnline(sendCD, [{ index: 0, amount_rupees: 100 }, { index: 1, amount_rupees: 100 }]);
    check("refuse: the second child's posting fails, so the capture waits for a person", refused.applied?.applied === false && refused.applied.status === "review_required", refused.applied);
    check("refuse: the first child's waiver was taken back with it", (await waivers(c.id)).n === 0 && (await snap(c.id)).late_pending === cBefore.late_pending, { waived: await waivers(c.id), cBefore });
    await tx.unsafe("drop trigger dry_refuse_one on public.receipts");

    // ---- with the policy off, nothing is forgiven
    await tx`update public.app_settings set value = 'false' where key = 'online_payment_waive_late_fees'`;
    const sendD = await makeSend([d.id], "dryWaiveCodeDDDDDDDDDDDDDDDD");
    const dBefore = await snap(d.id);
    const paidD = await payOnline(sendD, [{ index: 0, amount_rupees: 100 }]);
    check("off: the payment posts as before", paidD.applied?.applied === true, paidD.applied ?? paidD.opened);
    check("off: no late fee is forgiven", (await waivers(d.id)).n === 0 && paidD.applied.receipts[0].late_fee_waived === 0, await waivers(d.id));
    check("off: the late fee is still there", (await snap(d.id)).late_fees === dBefore.late_fees, dBefore);

    // ---- the source check, and the others untouched
    const [{ src }] = await tx`select pg_get_constraintdef(oid) as src from pg_constraint where conname = 'student_late_fee_waivers_source_check'`;
    check("source: 'online_payment' joins the six existing sources", ["manual", "payment_desk", "migration", "grandfather", "repayment_plan", "manual_collected", "online_payment"].every((s) => src.includes(`'${s}'`)), src);

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
