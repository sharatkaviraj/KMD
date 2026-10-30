-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261029190000_online_payment_orders.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added.
-- ============================================================================
-- One-tap online payment: Razorpay Orders + Standard Checkout on /pay/[code].
--
-- The parent sees each child's full fee breakdown, sets an amount per child
-- (₹100 minimum, at most that child's whole remaining balance for the session),
-- and pays all of it in ONE Razorpay checkout. Each child is then an ordinary
-- individual posting through `private.post_student_payment_core`, with its own
-- receipt. Nothing here posts for a family as one: every child is posted alone.
--
-- ADDITIVE. The Payment Link path (`online_payment_intents`, `open_intent`,
-- `record_capture`, `apply_capture`, the supersede trigger) is untouched, as are
-- `private.post_student_payment_core` and the desk RPC. The one replaced money
-- function is `private.online_posting_in_progress`, which gains an order branch;
-- its legacy branch is kept word for word.
--
-- THE POSTING RULE FOR ORDERS IS "STILL FITS", deliberately not "same quote".
-- A custom amount has no quote to compare. Each child's line posts when
-- 0 < line <= what that child still owes on the capture date — the same ceiling
-- the core enforces. Time only ever adds late fees, so a line stops fitting only
-- after a counter payment, a waiver or a fee edit; then the WHOLE capture goes
-- to review and no child is posted (all-or-nothing).

begin;

-- ---------------------------------------------------------------- switches

insert into public.app_settings (key, value) values
  ('online_payment_checkout_enabled', 'false'),
  ('online_payment_order_max_rupees', '100000')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- tables

-- One row per tap on "Pay": a Razorpay Order for the total of the lines.
create table public.online_payment_orders (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique check (public_ref ~ '^[A-Za-z0-9_-]{20,64}$'),
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_mode text not null check (provider_mode in ('test', 'live')),
  send_id uuid not null references public.whatsapp_reminder_sends (id),
  status text not null default 'pending' check (status in (
    'pending', 'open', 'paid', 'accounted', 'review_required', 'superseded', 'abandoned', 'failed'
  )),
  amount_rupees integer not null check (amount_rupees >= 1),
  amount_paise bigint generated always as (amount_rupees::bigint * 100) stored,
  currency text not null default 'INR' check (currency = 'INR'),
  provider_receipt text not null unique check (char_length(provider_receipt) <= 40),
  provider_order_id text unique check (provider_order_id is null or provider_order_id ~ '^order_[A-Za-z0-9]+$'),
  last_error text,
  superseded_reason text,
  last_reconciled_at timestamptz,
  accounted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index online_payment_orders_send_idx on public.online_payment_orders (send_id, created_at desc);
create index online_payment_orders_watch_idx on public.online_payment_orders (status, created_at)
  where status in ('pending', 'open', 'superseded', 'paid');

comment on table public.online_payment_orders is
  'One Razorpay Order per tap on Pay on /pay/[code]. Money records: never deleted.';

-- One row per child on an order. Each carries its own receipt once posted.
create table public.online_payment_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.online_payment_orders (id),
  line_no smallint not null check (line_no between 1 and 4),
  student_id uuid not null references public.students (id),
  session_label text not null,
  amount_rupees integer not null check (amount_rupees >= 1),
  max_rupees integer not null check (max_rupees >= amount_rupees),
  receipt_id uuid unique references public.receipts (id),
  created_at timestamptz not null default now(),
  unique (order_id, student_id),
  unique (order_id, line_no)
);

create index online_payment_order_lines_student_idx on public.online_payment_order_lines (student_id);

-- A capture belongs to an intent (Payment Link) OR to an order, never both.
-- An order capture's receipts are on its lines; its own receipt_id stays null.
alter table public.online_payment_captures
  add column order_id uuid references public.online_payment_orders (id),
  add column provider_order_id text;
alter table public.online_payment_captures
  add constraint online_payment_captures_one_target check (intent_id is null or order_id is null);
create index online_payment_captures_order_idx on public.online_payment_captures (order_id)
  where order_id is not null;

alter table public.online_payment_orders enable row level security;
alter table public.online_payment_order_lines enable row level security;

-- Production's default privileges grant service_role ALL on new tables.
-- Money records take no DELETE or TRUNCATE from anyone.
revoke all on table public.online_payment_orders from public, anon, authenticated, service_role;
revoke all on table public.online_payment_order_lines from public, anon, authenticated, service_role;
grant select, insert, update on table public.online_payment_orders to service_role;
grant select, insert, update on table public.online_payment_order_lines to service_role;

-- ---------------------------------------------------------------- what a child owes

-- Everything the child still owes this session, as the posting core counts it:
-- the sum of `total_pending` over every owed row (last year's balance, every
-- installment including future ones, late fees). The most a line may carry.
create or replace function private.online_student_owed(p_student_id uuid, p_as_of date)
returns integer
language sql
stable
set search_path = public, private
as $$
  select coalesce(sum(snapshot_row.total_pending) filter (where snapshot_row.total_pending > 0), 0)::integer
  from private.workbook_installment_snapshot(p_student_id, p_as_of, true) as snapshot_row;
$$;

revoke all on function private.online_student_owed(uuid, date) from public, anon, authenticated;
grant execute on function private.online_student_owed(uuid, date) to service_role;

-- ---------------------------------------------------------------- the pay page

-- Everything the parent's page shows, for one send. Service role only: the page
-- is public and reaches this only through the send's 160-bit pay code.
--
-- Per child it returns the FIRST NAME and class only — never the admission
-- number, a parent's name or a phone — and every installment row, paid ones
-- included, with fees and late fee kept apart.
--
-- `clear_to_date` is what clears everything due up to the horizon: the later of
-- today and the last due date among the installments the reminder named. The
-- page pre-fills it. `whole_session` is the most a line may carry.
create or replace function public.online_payment_pay_page(p_send_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, private
as $$
declare
  v_send record;
  v_ids uuid[];
  v_scope_nos smallint[];
  v_today date := private.ist_today();
  v_children jsonb := '[]'::jsonb;
  v_index integer := 0;
  v_student_id uuid;
  v_child jsonb;
  v_horizon date;
  v_orders jsonb;
begin
  select id, session_label, pay_scope, created_at
  into v_send
  from public.whatsapp_reminder_sends
  where id = p_send_id;
  if v_send.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_send');
  end if;

  select coalesce(array_agg(value::uuid order by ordinality), '{}')
  into v_ids
  from jsonb_array_elements_text(coalesce(v_send.pay_scope->'studentIds', '[]'::jsonb)) with ordinality;

  select coalesce(array_agg(value::smallint), '{}')
  into v_scope_nos
  from jsonb_array_elements_text(coalesce(v_send.pay_scope->'installments', '[]'::jsonb));

  if cardinality(v_ids) < 1 or cardinality(v_ids) > 4 then
    return jsonb_build_object('ok', false, 'reason', 'scope_size', 'children', cardinality(v_ids));
  end if;

  foreach v_student_id in array v_ids loop
    select greatest(v_today, coalesce(max(snapshot_row.due_date), v_today))
    into v_horizon
    from private.workbook_installment_snapshot(v_student_id, v_today, true) as snapshot_row
    join public.installments as installment on installment.id = snapshot_row.installment_id
    where not coalesce(installment.is_carry_forward, false)
      and snapshot_row.installment_no = any(v_scope_nos);

    select jsonb_build_object(
      'index', v_index,
      'first_name', split_part(trim(coalesce(student.full_name, '')), ' ', 1),
      'class_label', coalesce(max(snapshot_row.class_label), max(snapshot_row.class_name), ''),
      'session_label', v_send.session_label,
      'rows', coalesce(jsonb_agg(jsonb_build_object(
          'installment_no', snapshot_row.installment_no,
          'label', snapshot_row.installment_label,
          'due_date', snapshot_row.due_date,
          'carry_forward', coalesce(installment.is_carry_forward, false),
          'charged', snapshot_row.base_charge,
          'paid', coalesce(snapshot_row.fee_settled_amount, 0),
          'fees_pending', snapshot_row.pending_amount,
          'late_fee', coalesce(snapshot_row.final_late_fee, 0),
          'late_fee_paid', coalesce(snapshot_row.late_fee_settled_amount, 0),
          'late_fee_pending', snapshot_row.late_fee_pending,
          'total_pending', snapshot_row.total_pending,
          'status', snapshot_row.balance_status
        ) order by coalesce(installment.is_carry_forward, false) desc, snapshot_row.due_date, snapshot_row.installment_no)
        filter (where snapshot_row.installment_id is not null), '[]'::jsonb),
      'last_year_pending', coalesce(sum(snapshot_row.total_pending) filter (
          where coalesce(installment.is_carry_forward, false) and snapshot_row.total_pending > 0), 0),
      'fees_pending', coalesce(sum(snapshot_row.pending_amount) filter (
          where not coalesce(installment.is_carry_forward, false) and snapshot_row.pending_amount > 0), 0),
      'late_fee_pending', coalesce(sum(snapshot_row.late_fee_pending) filter (
          where snapshot_row.late_fee_pending > 0), 0),
      'clear_to_date', coalesce(sum(snapshot_row.total_pending) filter (
          where snapshot_row.total_pending > 0 and snapshot_row.due_date <= v_horizon), 0),
      'whole_session', coalesce(sum(snapshot_row.total_pending) filter (
          where snapshot_row.total_pending > 0), 0)
    )
    into v_child
    from public.students as student
    left join private.workbook_installment_snapshot(v_student_id, v_today, true) as snapshot_row on true
    left join public.installments as installment on installment.id = snapshot_row.installment_id
    where student.id = v_student_id
    group by student.id, student.full_name;

    v_children := v_children || jsonb_build_array(coalesce(v_child, jsonb_build_object('index', v_index)));
    v_index := v_index + 1;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'public_ref', o.public_ref,
      'status', o.status,
      'amount_rupees', o.amount_rupees,
      'created_at', o.created_at,
      'receipts', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'line_no', line.line_no,
            'receipt_number', receipt.receipt_number,
            'amount', receipt.total_amount
          ) order by line.line_no), '[]'::jsonb)
        from public.online_payment_order_lines as line
        join public.receipts as receipt on receipt.id = line.receipt_id
        where line.order_id = o.id
      )
    ) order by o.created_at desc), '[]'::jsonb)
  into v_orders
  from (
    select * from public.online_payment_orders
    where send_id = p_send_id
    order by created_at desc
    limit 5
  ) as o;

  return jsonb_build_object(
    'ok', true,
    'session_label', v_send.session_label,
    'sent_at', v_send.created_at,
    'today', v_today,
    'children', v_children,
    'orders', v_orders,
    'checkout_enabled', private.online_setting_on('online_payment_checkout_enabled')
      and private.online_setting_on('online_payment_links_enabled'),
    'min_line_rupees', 100,
    'order_max_rupees', coalesce((
      select nullif(value, '')::integer from public.app_settings where key = 'online_payment_order_max_rupees'
    ), 100000)
  );
end;
$$;

revoke all on function public.online_payment_pay_page(uuid) from public, anon, authenticated;
grant execute on function public.online_payment_pay_page(uuid) to service_role;

-- ---------------------------------------------------------------- opening an order

-- A tap on Pay. Lines arrive as [{index, amount_rupees}] — an index into the
-- send's own pay_scope.studentIds, never a student id from the browser.
create or replace function public.online_payment_open_order(
  p_send_id uuid,
  p_lines jsonb,
  p_provider_mode text,
  p_public_ref text
)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_send record;
  v_ids uuid[];
  v_today date := private.ist_today();
  v_cap integer;
  v_line record;
  v_seen integer[] := '{}';
  v_total integer := 0;
  v_owed integer;
  v_min integer;
  v_student_id uuid;
  v_order public.online_payment_orders;
  v_line_no smallint := 0;
  v_lines jsonb := '[]'::jsonb;
  v_lock uuid;
begin
  if not (private.online_setting_on('online_payment_checkout_enabled')
          and private.online_setting_on('online_payment_links_enabled')) then
    return jsonb_build_object('ok', false, 'reason', 'switched_off');
  end if;
  if p_provider_mode not in ('test', 'live') then
    raise exception 'Unknown provider mode.';
  end if;

  select id, session_label, pay_scope into v_send
  from public.whatsapp_reminder_sends where id = p_send_id;
  if v_send.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_send');
  end if;

  select coalesce(array_agg(value::uuid order by ordinality), '{}')
  into v_ids
  from jsonb_array_elements_text(coalesce(v_send.pay_scope->'studentIds', '[]'::jsonb)) with ordinality;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > 4 then
    return jsonb_build_object('ok', false, 'reason', 'scope_size');
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1
     or jsonb_array_length(p_lines) > cardinality(v_ids) then
    return jsonb_build_object('ok', false, 'reason', 'no_lines');
  end if;

  if (select count(*) from public.online_payment_orders
      where send_id = p_send_id and created_at > now() - interval '1 hour') >= 15 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_orders');
  end if;

  v_cap := coalesce((
    select nullif(value, '')::integer from public.app_settings where key = 'online_payment_order_max_rupees'
  ), 100000);

  -- Every child's lock, in one fixed order, before any figure is read. The desk
  -- takes the same key, so a counter payment and this cannot interleave.
  for v_lock in select distinct unnest(v_ids) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock::text, 0));
  end loop;

  for v_line in
    select (entry->>'index')::integer as idx, (entry->>'amount_rupees')::numeric as amount
    from jsonb_array_elements(p_lines) as entry
  loop
    if v_line.idx is null or v_line.idx < 0 or v_line.idx >= cardinality(v_ids) or v_line.idx = any(v_seen) then
      return jsonb_build_object('ok', false, 'reason', 'bad_line');
    end if;
    v_seen := array_append(v_seen, v_line.idx);
    if v_line.amount is null or v_line.amount <> trunc(v_line.amount) then
      return jsonb_build_object('ok', false, 'reason', 'whole_rupees_only', 'index', v_line.idx);
    end if;
    v_student_id := v_ids[v_line.idx + 1];
    v_owed := private.online_student_owed(v_student_id, v_today);
    if v_owed <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'nothing_due', 'index', v_line.idx);
    end if;
    -- ₹100 at least, unless the child's whole balance is less: then exactly that.
    v_min := least(100, v_owed);
    if v_line.amount < v_min or v_line.amount > v_owed then
      return jsonb_build_object('ok', false, 'reason', 'amount_out_of_range', 'index', v_line.idx,
                                'min', v_min, 'max', v_owed);
    end if;
    v_total := v_total + v_line.amount::integer;
  end loop;

  if v_total < 1 or v_total > v_cap then
    return jsonb_build_object('ok', false, 'reason', 'order_over_cap', 'max', v_cap);
  end if;

  -- One live order per send: an earlier one the parent walked away from is
  -- superseded. Razorpay cannot cancel an order, so money that still lands on
  -- it is recorded and posted if it still fits (see apply_order_capture).
  update public.online_payment_orders
  set status = 'superseded', superseded_reason = 'new_order', updated_at = now()
  where send_id = p_send_id and status in ('pending', 'open');

  insert into public.online_payment_orders (public_ref, provider_mode, send_id, amount_rupees, provider_receipt)
  values (p_public_ref, p_provider_mode, p_send_id, v_total,
          'vpps_o_' || replace(gen_random_uuid()::text, '-', ''))
  returning * into v_order;

  for v_line in
    select (entry->>'index')::integer as idx, (entry->>'amount_rupees')::integer as amount
    from jsonb_array_elements(p_lines) as entry
    order by (entry->>'index')::integer
  loop
    v_line_no := v_line_no + 1;
    v_student_id := v_ids[v_line.idx + 1];
    insert into public.online_payment_order_lines (order_id, line_no, student_id, session_label, amount_rupees, max_rupees)
    values (v_order.id, v_line_no, v_student_id, v_send.session_label, v_line.amount,
            private.online_student_owed(v_student_id, v_today));
    v_lines := v_lines || jsonb_build_object('index', v_line.idx, 'amount_rupees', v_line.amount);
  end loop;

  perform private.online_audit('order_opened', null, null, null,
    jsonb_build_object('order_id', v_order.id, 'send_id', p_send_id, 'amount_rupees', v_total,
                       'lines', v_lines));

  return jsonb_build_object('ok', true, 'order', jsonb_build_object(
    'id', v_order.id,
    'public_ref', v_order.public_ref,
    'provider_receipt', v_order.provider_receipt,
    'amount_rupees', v_order.amount_rupees,
    'amount_paise', v_order.amount_paise
  ), 'lines', v_lines);
end;
$$;

revoke all on function public.online_payment_open_order(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.online_payment_open_order(uuid, jsonb, text, text) to service_role;

create or replace function public.online_payment_order_recorded(p_order_id uuid, p_provider_order_id text)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_order public.online_payment_orders;
begin
  if p_provider_order_id is null or p_provider_order_id !~ '^order_[A-Za-z0-9]+$' then
    raise exception 'A Razorpay order id is required.';
  end if;
  update public.online_payment_orders
  set provider_order_id = p_provider_order_id,
      status = case when status = 'pending' then 'open' else status end,
      updated_at = now()
  where id = p_order_id
    and (provider_order_id is null or provider_order_id = p_provider_order_id)
  returning * into v_order;
  if v_order.id is null then
    raise exception 'Order not found, or already holds a different Razorpay order.';
  end if;
  perform private.online_audit('order_recorded', null, null, null,
    jsonb_build_object('order_id', v_order.id, 'provider_order_id', p_provider_order_id));
  return to_jsonb(v_order);
end;
$$;

revoke all on function public.online_payment_order_recorded(uuid, text) from public, anon, authenticated;
grant execute on function public.online_payment_order_recorded(uuid, text) to service_role;

-- An order that never reached Razorpay, or reached it with no id we kept: no
-- browser ever held its id, so it cannot be paid. The next tap opens a new one.
create or replace function public.online_payment_order_failed(p_order_id uuid, p_error text)
returns void
language sql
set search_path = public, private
as $$
  update public.online_payment_orders
  set status = 'failed', last_error = left(coalesce(p_error, ''), 300), updated_at = now()
  where id = p_order_id and status = 'pending';
$$;

revoke all on function public.online_payment_order_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.online_payment_order_failed(uuid, text) to service_role;

-- Stop watching an order nobody paid. Still recorded and posted if money ever lands.
create or replace function public.online_payment_order_closed(p_order_id uuid, p_status text)
returns void
language plpgsql
set search_path = public, private
as $$
begin
  if p_status not in ('abandoned', 'failed') then
    raise exception 'An order closes as abandoned or failed.';
  end if;
  update public.online_payment_orders
  set status = p_status, updated_at = now()
  where id = p_order_id and status in ('pending', 'open', 'superseded');
end;
$$;

revoke all on function public.online_payment_order_closed(uuid, text) from public, anon, authenticated;
grant execute on function public.online_payment_order_closed(uuid, text) to service_role;

-- ---------------------------------------------------------------- order captures

-- Record a payment the server FETCHED from Razorpay, found captured, and whose
-- `order_id` is one of our orders. Idempotent on the payment id.
create or replace function public.online_payment_record_order_capture(p_facts jsonb)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_payment_id text := nullif(trim(p_facts->>'provider_payment_id'), '');
  v_order_id text := nullif(trim(p_facts->>'provider_order_id'), '');
  v_mode text := p_facts->>'provider_mode';
  v_amount bigint := (p_facts->>'amount_paise')::bigint;
  v_currency text := upper(coalesce(p_facts->>'currency', ''));
  v_order public.online_payment_orders;
  v_capture public.online_payment_captures;
  v_reasons text[] := '{}';
begin
  if v_payment_id is null or v_payment_id !~ '^pay_[A-Za-z0-9]+$' then
    raise exception 'A capture needs a provider payment id.';
  end if;
  if v_order_id is null or v_order_id !~ '^order_[A-Za-z0-9]+$' then
    raise exception 'An order capture needs a Razorpay order id.';
  end if;
  if coalesce(p_facts->>'provider_status', '') <> 'captured'
     or coalesce((p_facts->>'captured')::boolean, false) is not true then
    return jsonb_build_object('recorded', false, 'reason', 'not_captured');
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'A capture needs a positive amount.';
  end if;

  select * into v_capture from public.online_payment_captures where provider_payment_id = v_payment_id;
  if v_capture.id is not null then
    return jsonb_build_object('recorded', true, 'duplicate', true, 'capture', to_jsonb(v_capture));
  end if;

  select * into v_order from public.online_payment_orders where provider_order_id = v_order_id for update;
  if v_order.id is null then
    v_reasons := array_append(v_reasons, 'unknown_order');
  else
    if v_order.provider_mode <> v_mode then v_reasons := array_append(v_reasons, 'wrong_mode'); end if;
    if v_currency <> v_order.currency then v_reasons := array_append(v_reasons, 'wrong_currency'); end if;
    if v_amount <> v_order.amount_paise then v_reasons := array_append(v_reasons, 'wrong_amount'); end if;
    if v_order.status = 'accounted' then v_reasons := array_append(v_reasons, 'order_already_accounted'); end if;
  end if;
  if v_amount % 100 <> 0 then v_reasons := array_append(v_reasons, 'fractional_rupee'); end if;

  insert into public.online_payment_captures (
    provider_payment_id, intent_id, order_id, provider_order_id, provider_link_id, provider_mode,
    amount_paise, currency, provider_status, method, fee_paise, tax_paise, captured_at,
    application_status, review_reason
  )
  values (
    v_payment_id, null, v_order.id, v_order_id, null, v_mode,
    v_amount, v_currency, p_facts->>'provider_status', nullif(p_facts->>'method', ''),
    nullif(p_facts->>'fee_paise', '')::bigint, nullif(p_facts->>'tax_paise', '')::bigint,
    coalesce(nullif(p_facts->>'captured_at', '')::timestamptz, now()),
    case when cardinality(v_reasons) = 0 then 'pending' else 'review_required' end,
    nullif(array_to_string(v_reasons, ','), '')
  )
  on conflict (provider_payment_id) do nothing
  returning * into v_capture;

  if v_capture.id is null then
    select * into v_capture from public.online_payment_captures where provider_payment_id = v_payment_id;
    return jsonb_build_object('recorded', true, 'duplicate', true, 'capture', to_jsonb(v_capture));
  end if;

  if v_order.id is not null and v_order.status <> 'accounted' then
    update public.online_payment_orders
    set status = case when cardinality(v_reasons) = 0 then 'paid' else 'review_required' end,
        updated_at = now()
    where id = v_order.id;
  end if;

  perform private.online_audit('capture_recorded', null, v_capture.id, null,
    jsonb_build_object('order_id', v_order.id, 'amount_paise', v_amount, 'method', p_facts->>'method',
                       'review', v_capture.review_reason));

  return jsonb_build_object('recorded', true, 'duplicate', false, 'capture', to_jsonb(v_capture));
end;
$$;

revoke all on function public.online_payment_record_order_capture(jsonb) from public, anon, authenticated;
grant execute on function public.online_payment_record_order_capture(jsonb) to service_role;

-- Who may reach the core without a staff permission. The legacy branch below
-- is the 20261028140100 text, unchanged; the order branch admits exactly the
-- students on the order of the verified, unapplied capture named in
-- `vpps.online_capture_id` for this transaction.
create or replace function private.online_posting_in_progress(p_student_id uuid)
returns boolean
language plpgsql
stable
set search_path = public, private
as $$
declare
  v_capture_id uuid;
begin
  if current_user not in ('service_role', 'postgres') then
    return false;
  end if;
  begin
    v_capture_id := nullif(current_setting('vpps.online_capture_id', true), '')::uuid;
  exception when others then
    return false;
  end;
  if v_capture_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.online_payment_captures as capture
    join public.online_payment_intents as intent on intent.id = capture.intent_id
    where capture.id = v_capture_id
      and capture.application_status = 'pending'
      and intent.student_id = p_student_id
  ) or exists (
    select 1
    from public.online_payment_captures as capture
    join public.online_payment_order_lines as line on line.order_id = capture.order_id
    where capture.id = v_capture_id
      and capture.application_status = 'pending'
      and line.student_id = p_student_id
  );
end;
$$;

revoke all on function private.online_posting_in_progress(uuid) from public, anon;
grant execute on function private.online_posting_in_progress(uuid) to authenticated, service_role;

-- Post a recorded order capture: every child's line, or none.
--
-- One transaction: every child's lock in a fixed order, the capture, the order,
-- the "still fits" check per line as of the day the money was captured, then
-- each line through the posting core inside ONE exception block — so a refusal
-- on any child rolls back every child's receipt and the capture waits for a
-- person. One receipt notice is queued per child.
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
        'receipt_id', v_receipt_id, 'receipt_number', v_receipt_number, 'amount_rupees', v_line.amount_rupees
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

-- ---------------------------------------------------------------- reconciliation

-- Same columns as before. An order capture's receipts sit on its lines, so
-- "receipted" counts those too; a Payment Link capture is counted as before.
create or replace view public.v_online_payment_reconciliation
with (security_invoker = true)
as
select
  (capture.captured_at at time zone 'Asia/Kolkata')::date as captured_on,
  capture.provider_mode,
  count(*) as captures,
  sum(capture.amount_paise) as captured_paise,
  count(*) filter (where capture.application_status = 'applied') as applied,
  coalesce(sum(capture.amount_paise) filter (where capture.application_status = 'applied'), 0) as applied_paise,
  count(*) filter (where capture.application_status = 'review_required') as in_review,
  coalesce(sum(capture.amount_paise) filter (where capture.application_status = 'review_required'), 0) as in_review_paise,
  count(*) filter (where capture.application_status = 'pending') as awaiting_posting,
  coalesce(sum(capture.amount_paise) filter (where capture.application_status = 'pending'), 0) as awaiting_posting_paise,
  coalesce(sum(coalesce(receipt.total_amount, order_receipts.total))::bigint * 100, 0) as receipted_paise,
  coalesce(sum(capture.fee_paise), 0) as provider_fee_paise,
  coalesce(sum(capture.tax_paise), 0) as provider_tax_paise
from public.online_payment_captures as capture
left join public.receipts as receipt on receipt.id = capture.receipt_id
left join lateral (
  select sum(line_receipt.total_amount) as total
  from public.online_payment_order_lines as line
  join public.receipts as line_receipt on line_receipt.id = line.receipt_id
  where line.order_id = capture.order_id
) as order_receipts on capture.order_id is not null
group by 1, 2;

revoke all on public.v_online_payment_reconciliation from anon, authenticated;
grant select on public.v_online_payment_reconciliation to service_role;

commit;
