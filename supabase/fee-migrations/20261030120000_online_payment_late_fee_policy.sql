-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261030120000_online_payment_late_fee_policy.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added.
-- ============================================================================
-- Late fees are not taken online this year (owner, 2026-10-30).
--
-- When a parent pays through the one-tap pay page, every late fee charged on
-- that child this session is forgiven — the ones still owed AND the ones the
-- family already paid — and the payment goes to fees. Money already paid
-- against a late fee then settles the child's fees, oldest installment first,
-- exactly as an admin's "forgive a collected late fee" does (20260826120000).
-- Next year the school takes late fees again: turn
-- `online_payment_waive_late_fees` off.
--
-- Scope, as the owner chose it: online one-tap orders only. The Payment Desk,
-- the Payment Link path (`online_payment_apply_capture`) and every WhatsApp
-- reminder are unchanged.
--
-- How:
--  1. `student_late_fee_waivers.source` gains 'online_payment', so these
--     waivers are told apart from a person's.
--  2. `private.online_student_owed` — the ceiling an order opens under and the
--     "still fits" check at posting — subtracts the child's late fees while the
--     setting is on. That is what the child owes once they are forgiven.
--  3. `private.online_waive_late_fees` forgives them, per installment,
--     idempotently per payment.
--  4. `online_payment_apply_order_capture` calls it for each child just before
--     posting that child, inside the same exception block: a posting that is
--     refused takes its waiver back with it.
--
-- `post_student_payment_core`, the desk RPC, `waive_late_fee` and the Payment
-- Link functions are untouched. Rollback: `…_rollback.sql.txt`.

begin;

-- ---------------------------------------------------------------- 1. the source

alter table public.student_late_fee_waivers drop constraint student_late_fee_waivers_source_check;
alter table public.student_late_fee_waivers add constraint student_late_fee_waivers_source_check
  check (source = any (array[
    'manual', 'payment_desk', 'migration', 'grandfather', 'repayment_plan', 'manual_collected', 'online_payment'
  ]));

-- ---------------------------------------------------------------- the switch, on

insert into public.app_settings (key, value) values ('online_payment_waive_late_fees', 'true')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 2. what a child owes

-- Everything the child still owes this session, as the posting core counts it:
-- the sum of `total_pending` over every owed row. While late fees are waived on
-- online payment, less every late fee the child is charged (`final_late_fee`,
-- already net of earlier waivers): the pending part disappears, and the part
-- already paid moves onto the child's fees. The most a line may carry.
create or replace function private.online_student_owed(p_student_id uuid, p_as_of date)
returns integer
language sql
stable
set search_path = public, private
as $$
  select greatest(
    0,
    coalesce(sum(snapshot_row.total_pending) filter (where snapshot_row.total_pending > 0), 0)
    - case
        when private.online_setting_on('online_payment_waive_late_fees')
          then coalesce(sum(greatest(snapshot_row.final_late_fee, 0)), 0)
        else 0
      end
  )::integer
  from private.workbook_installment_snapshot(p_student_id, p_as_of, true) as snapshot_row;
$$;

revoke all on function private.online_student_owed(uuid, date) from public, anon, authenticated;
grant execute on function private.online_student_owed(uuid, date) to service_role;

-- ---------------------------------------------------------------- 3. forgiving them

-- Every late fee on this child's installments, the collected ones included, one
-- waiver per installment. `final_late_fee` is net of earlier waivers, so a
-- second run finds nothing; the request id makes a replayed payment a no-op on
-- its own as well. Returns the rupees forgiven.
create or replace function private.online_waive_late_fees(p_student_id uuid, p_payment_id text, p_as_of date)
returns integer
language plpgsql
set search_path = public, private
as $$
declare
  v_row record;
  v_request uuid;
  v_total integer := 0;
begin
  for v_row in
    select
      snapshot_row.installment_id,
      snapshot_row.session_label,
      greatest(snapshot_row.final_late_fee, 0)::integer as amount,
      greatest(snapshot_row.late_fee_pending, 0)::integer as still_owed
    from private.workbook_installment_snapshot(p_student_id, p_as_of, true) as snapshot_row
    where snapshot_row.installment_id is not null
      and greatest(snapshot_row.final_late_fee, 0) > 0
    order by snapshot_row.due_date, snapshot_row.installment_no
  loop
    v_request := md5('online-late-fee:' || p_payment_id || ':' || v_row.installment_id::text)::uuid;
    if exists (
      select 1 from public.student_late_fee_waivers
      where student_id = p_student_id and client_request_id = v_request and voided_at is null
    ) then
      continue;
    end if;

    insert into public.student_late_fee_waivers (
      student_id, installment_id, session_label, amount, reason, source, client_request_id, waived_by_label
    ) values (
      p_student_id, v_row.installment_id, v_row.session_label, v_row.amount,
      format(
        'Waived on online payment %s: late fees are not taken this year (owner, 2026-10-30)%s',
        p_payment_id,
        case
          when v_row.amount > v_row.still_owed
            then format('. %s of it was already paid and now counts toward fees', v_row.amount - v_row.still_owed)
          else ''
        end
      ),
      'online_payment', v_request, 'Online payment (automatic)'
    );
    v_total := v_total + v_row.amount;
  end loop;
  return v_total;
end;
$$;

revoke all on function private.online_waive_late_fees(uuid, text, date) from public, anon, authenticated;
grant execute on function private.online_waive_late_fees(uuid, text, date) to service_role;

-- ---------------------------------------------------------------- 4. posting an order

-- As 20261029190000, plus the waiver: for each child, just before that child is
-- posted, while `online_payment_waive_late_fees` is on.
create or replace function public.online_payment_apply_order_capture(
  p_capture_id uuid,
  p_actor text default 'system'
)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_capture public.online_payment_captures;
  v_order public.online_payment_orders;
  v_line record;
  v_lock uuid;
  v_payment_date date;
  v_reason text;
  v_receipt_id uuid;
  v_receipt_number text;
  v_receipts jsonb := '[]'::jsonb;
  v_waive boolean := private.online_setting_on('online_payment_waive_late_fees');
  v_waived integer;
begin
  for v_lock in
    select distinct line.student_id
    from public.online_payment_captures as capture
    join public.online_payment_order_lines as line on line.order_id = capture.order_id
    where capture.id = p_capture_id
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock::text, 0));
  end loop;

  select * into v_capture from public.online_payment_captures where id = p_capture_id for update;
  if v_capture.id is null then
    raise exception 'Unknown capture.';
  end if;
  if v_capture.application_status = 'applied' then
    return jsonb_build_object('applied', true, 'duplicate', true);
  end if;
  if v_capture.application_status <> 'pending' then
    return jsonb_build_object('applied', false, 'status', v_capture.application_status,
                              'reason', v_capture.review_reason);
  end if;

  select * into v_order from public.online_payment_orders where id = v_capture.order_id for update;
  v_payment_date := (coalesce(v_capture.captured_at, now()) at time zone 'Asia/Kolkata')::date;

  if v_order.id is null then
    v_reason := 'unknown_order';
  elsif v_capture.amount_paise <> v_order.amount_paise or v_capture.amount_paise % 100 <> 0 then
    v_reason := 'wrong_amount';
  elsif v_order.status = 'accounted' then
    v_reason := 'order_already_accounted';
  elsif (select coalesce(sum(amount_rupees), 0) from public.online_payment_order_lines where order_id = v_order.id)
        <> v_order.amount_rupees then
    v_reason := 'lines_do_not_add_up';
  else
    -- What each child owes once their late fees are forgiven (online_student_owed).
    for v_line in
      select line.line_no, line.student_id, line.amount_rupees
      from public.online_payment_order_lines as line
      where line.order_id = v_order.id
      order by line.line_no
    loop
      if v_line.amount_rupees > private.online_student_owed(v_line.student_id, v_payment_date) then
        v_reason := 'dues_changed:line_' || v_line.line_no;
        exit;
      end if;
    end loop;
  end if;

  if v_reason is not null then
    update public.online_payment_captures
    set application_status = 'review_required', review_reason = v_reason, updated_at = now()
    where id = v_capture.id;
    if v_order.id is not null and v_order.status <> 'accounted' then
      update public.online_payment_orders set status = 'review_required', updated_at = now()
      where id = v_order.id;
    end if;
    perform private.online_audit('capture_needs_review', null, v_capture.id, null,
      jsonb_build_object('order_id', v_order.id, 'reason', v_reason), p_actor);
    return jsonb_build_object('applied', false, 'status', 'review_required', 'reason', v_reason);
  end if;

  perform set_config('vpps.online_capture_id', v_capture.id::text, true);

  begin
    for v_line in
      select line.id, line.line_no, line.student_id, line.session_label, line.amount_rupees
      from public.online_payment_order_lines as line
      where line.order_id = v_order.id
      order by line.line_no
    loop
      -- This year a payment online forgives that child's late fees (owner,
      -- 2026-10-30): before posting, so the money goes to fees, and inside this
      -- block, so a refused posting takes the waiver back with it.
      v_waived := 0;
      if v_waive then
        v_waived := private.online_waive_late_fees(v_line.student_id, v_capture.provider_payment_id, v_payment_date);
      end if;

      select core.receipt_id, core.receipt_number
      into v_receipt_id, v_receipt_number
      from private.post_student_payment_core(
        v_line.student_id,
        v_payment_date,
        'online'::payment_mode,
        v_line.amount_rupees,
        v_capture.provider_payment_id,
        'Online payment via Razorpay · ' || v_order.public_ref,
        'Razorpay (online)',
        'SVP',
        -- Deterministic per payment AND child: the engine's own idempotency key.
        md5('razorpay:' || v_capture.provider_payment_id || ':' || v_line.student_id::text)::uuid,
        0,
        0
      ) as core;

      update public.online_payment_order_lines set receipt_id = v_receipt_id where id = v_line.id;

      insert into public.notification_outbox (kind, dedupe_key, receipt_id, student_id, session_label, payload)
      values (
        'receipt_notice', 'receipt_notice:' || v_receipt_id::text, v_receipt_id, v_line.student_id,
        v_line.session_label,
        jsonb_build_object('receipt_number', v_receipt_number, 'amount', v_line.amount_rupees,
                           'payment_date', v_payment_date)
      )
      on conflict (dedupe_key) do nothing;

      v_receipts := v_receipts || jsonb_build_object(
        'line_no', v_line.line_no, 'student_id', v_line.student_id, 'session_label', v_line.session_label,
        'receipt_id', v_receipt_id, 'receipt_number', v_receipt_number, 'amount_rupees', v_line.amount_rupees,
        'late_fee_waived', v_waived
      );
    end loop;
  exception when others then
    perform set_config('vpps.online_capture_id', '', true);
    update public.online_payment_captures
    set application_status = 'review_required',
        review_reason = left('posting_refused: ' || sqlerrm, 300),
        updated_at = now()
    where id = v_capture.id;
    update public.online_payment_orders set status = 'review_required', updated_at = now()
    where id = v_order.id;
    perform private.online_audit('capture_needs_review', null, v_capture.id, null,
      jsonb_build_object('order_id', v_order.id, 'reason', 'posting_refused', 'error', left(sqlerrm, 300)),
      p_actor);
    return jsonb_build_object('applied', false, 'status', 'review_required', 'reason', 'posting_refused');
  end;

  perform set_config('vpps.online_capture_id', '', true);

  update public.online_payment_captures
  set application_status = 'applied', applied_at = now(), review_reason = null, updated_at = now()
  where id = v_capture.id;

  update public.online_payment_orders
  set status = 'accounted', accounted_at = now(), updated_at = now()
  where id = v_order.id;

  perform private.online_audit('capture_applied', null, v_capture.id, null,
    jsonb_build_object('order_id', v_order.id, 'payment_date', v_payment_date, 'receipts', v_receipts),
    p_actor);

  return jsonb_build_object('applied', true, 'duplicate', false, 'receipts', v_receipts);
end;
$$;

revoke all on function public.online_payment_apply_order_capture(uuid, text) from public, anon, authenticated;
grant execute on function public.online_payment_apply_order_capture(uuid, text) to service_role;

commit;
