-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261028140100_online_payments.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: the pg_cron block(s) are REMOVED.
--   The fees original unschedules and re-schedules a pg_cron job whose command
--   calls https://schoolfees-two.vercel.app/api/cron/... — the PRODUCTION fees
--   app. Applied here it would make One's database a caller of the fees app's
--   production endpoints whenever Vault holds the same secret name (plan §1.5,
--   critique0 #23). One schedules its own jobs, against its own routes, at
--   cutover (plan §11). Nothing else in the file is changed.
-- ============================================================================
-- Online fee payments through Razorpay Payment Links.
--
-- A parent taps Pay now on a WhatsApp reminder, `/pay/[code]` opens on the
-- send's own pay code, and a Razorpay Standard Payment Link takes the money.
-- This migration is everything the DATABASE must guarantee about that money:
--
--   1. One canonical quote. `private.online_payment_quote` reads the same
--      snapshot, in the same order, that the posting engine allocates over, so
--      the amount a parent is asked for clears exactly the rows it names.
--   2. A versioned intent is written BEFORE a provider link exists, and at most
--      one is open per student (a unique partial index decides the race between
--      two phones).
--   3. A verified capture is posted exactly once, through the SAME posting
--      engine the Payment Desk uses. The engine's body moves into
--      `private.post_student_payment_core`; the desk's public RPC keeps its
--      signature and its permission check and calls it. The online entry point
--      is `public.online_payment_apply_capture`, service_role only, and the core
--      admits it only while a verified, unapplied capture for that very student
--      is named in this transaction.
--   4. Money is never lost and never over-credited. A capture whose dues moved
--      (cash at the counter, a waiver, a fee edit) is RECORDED and marked
--      `review_required`, never posted against a different allocation.
--   5. A receipt posted any other way supersedes the student's open intent, so
--      a family who paid cash is not also offered the old link.
--
-- Nothing here messages anyone, creates a provider link, or posts a payment on
-- its own. The three switches seeded below are all 'false'.

begin;

-- ---------------------------------------------------------------- switches

-- Runtime switches, flippable without a deploy. The webhook intake and the
-- reconciler are deliberately NOT switched: during a rollback, money already
-- paid must still be received, verified and shown to the office.
insert into public.app_settings (key, value) values
  ('online_payment_links_enabled', 'false'),
  ('online_payment_auto_posting_enabled', 'false'),
  ('online_payment_receipts_enabled', 'false')
on conflict (key) do nothing;

create or replace function private.online_setting_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select lower(s.value) = 'true' from public.app_settings s where s.key = p_key),
    false
  );
$$;

revoke all on function private.online_setting_on(text) from public, anon, authenticated;
grant execute on function private.online_setting_on(text) to service_role;

-- ---------------------------------------------------------------- the send's scope

-- What a reminder's Pay now button actually covers, written at send time from
-- the numbers that built the message — never parsed back out of its text.
alter table public.whatsapp_reminder_sends
  add column if not exists pay_scope jsonb;

comment on column public.whatsapp_reminder_sends.pay_scope is
  'The exact scope behind this send''s Pay now link: {studentIds, installments, lastYear, '
  'situation, amount}. Written from the figures that built the message. The pay page offers '
  'an online payment only for a one-student scope, and re-quotes it from the ledger.';

-- ---------------------------------------------------------------- tables

create table public.online_payment_intents (
  id uuid primary key default gen_random_uuid(),
  -- Opaque, random, no student detail. Goes into the provider's notes and the
  -- receipt remark so the office can find an intent from either side.
  public_ref text not null unique check (public_ref ~ '^[A-Za-z0-9_-]{20,64}$'),
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_mode text not null check (provider_mode in ('test', 'live')),
  status text not null default 'link_pending' check (status in (
    'link_pending',     -- written, provider link not confirmed yet
    'link_created',     -- the parent can pay
    'paid',             -- a verified capture is recorded, not yet posted
    'accounted',        -- posted; receipt_id is set
    'review_required',  -- money arrived and could not be posted safely
    'superseded',       -- dues moved or another payment was posted
    'cancelled',
    'expired',
    'failed'            -- the provider refused to create the link
  )),
  student_id uuid not null references public.students (id),
  session_label text not null,
  send_id uuid references public.whatsapp_reminder_sends (id),
  scope_installment_nos smallint[] not null default '{}',
  scope_include_carry_forward boolean not null default false,
  quote jsonb not null,
  quote_version integer not null default 1,
  quote_hash text not null,
  -- The ledger is whole rupees. The provider boundary is paise, derived here
  -- and nowhere else, so it cannot be rounded on the way.
  amount_rupees integer not null check (amount_rupees >= 1),
  amount_paise bigint generated always as (amount_rupees::bigint * 100) stored,
  currency text not null default 'INR' check (currency = 'INR'),
  expires_at timestamptz not null,
  provider_reference_id text not null unique check (char_length(provider_reference_id) <= 40),
  provider_link_id text unique,
  provider_short_url text,
  link_attempts integer not null default 0,
  last_error text,
  superseded_reason text,
  -- When the provider's link was seen closed (cancelled by us, expired, or
  -- found never to exist). Null on a closed intent means the reconciler still
  -- has to make sure the link cannot take money.
  provider_cancelled_at timestamptz,
  last_reconciled_at timestamptz,
  receipt_id uuid references public.receipts (id),
  accounted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.online_payment_intents is
  'One versioned online-payment intent per quote. Written before any provider link exists. '
  'At most one open (link_pending | link_created) per student.';

-- The race between two phones, or two taps, is decided here.
create unique index online_payment_intents_one_open_per_student
  on public.online_payment_intents (student_id)
  where status in ('link_pending', 'link_created');

create index online_payment_intents_status_idx
  on public.online_payment_intents (status, updated_at);

create index online_payment_intents_send_idx
  on public.online_payment_intents (send_id)
  where send_id is not null;

-- The inbox. A verified webhook is recorded here before it is acknowledged;
-- duplicates collide on the provider's event id.
create table public.online_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay',
  provider_event_id text not null unique,
  event_type text not null,
  account_id text,
  provider_payment_id text,
  provider_link_id text,
  payload_sha256 text not null,
  -- Ids, amounts and statuses only. Contact numbers, e-mail addresses and VPAs
  -- in the provider payload are never stored.
  facts jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index online_payment_events_pending_idx
  on public.online_payment_events (received_at)
  where status in ('pending', 'failed');

create index online_payment_events_payment_idx
  on public.online_payment_events (provider_payment_id)
  where provider_payment_id is not null;

-- One row per provider payment, however many events mention it.
create table public.online_payment_captures (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay',
  provider_payment_id text not null unique,
  intent_id uuid references public.online_payment_intents (id),
  provider_link_id text,
  provider_mode text not null check (provider_mode in ('test', 'live')),
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null,
  provider_status text not null,
  method text,
  fee_paise bigint,
  tax_paise bigint,
  captured_at timestamptz,
  verified_at timestamptz not null default now(),
  application_status text not null default 'pending'
    check (application_status in ('pending', 'applied', 'review_required')),
  review_reason text,
  receipt_id uuid unique references public.receipts (id),
  applied_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index online_payment_captures_status_idx
  on public.online_payment_captures (application_status, created_at);

create index online_payment_captures_intent_idx
  on public.online_payment_captures (intent_id);

-- Parent messages that must survive a crash between posting and sending.
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('receipt_notice')),
  dedupe_key text not null unique,
  receipt_id uuid references public.receipts (id),
  student_id uuid references public.students (id),
  session_label text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in (
    'queued', 'processing', 'provider_accepted', 'delivered', 'failed', 'suppressed', 'uncertain'
  )),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_outbox_due_idx
  on public.notification_outbox (next_attempt_at)
  where status in ('queued', 'failed', 'processing');

-- Append-only history of every decision made about online money.
create table public.online_payment_audit (
  id bigint generated always as identity primary key,
  intent_id uuid,
  capture_id uuid,
  event_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  actor text not null default 'system',
  created_at timestamptz not null default now()
);

create index online_payment_audit_intent_idx on public.online_payment_audit (intent_id, created_at);
create index online_payment_audit_capture_idx on public.online_payment_audit (capture_id, created_at);

create or replace function private.online_payment_audit_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'online_payment_audit is append-only.';
end;
$$;

create trigger online_payment_audit_append_only
  before update or delete on public.online_payment_audit
  for each row execute function private.online_payment_audit_is_append_only();

-- Server-side only. Staff read these through the admin client after a
-- permission check; nothing in the browser reaches them.
alter table public.online_payment_intents enable row level security;
alter table public.online_payment_events enable row level security;
alter table public.online_payment_captures enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.online_payment_audit enable row level security;

revoke all on public.online_payment_intents from anon, authenticated;
revoke all on public.online_payment_events from anon, authenticated;
revoke all on public.online_payment_captures from anon, authenticated;
revoke all on public.notification_outbox from anon, authenticated;
revoke all on public.online_payment_audit from anon, authenticated;

-- Explicit, because this project's default privileges do not hand new tables
-- to service_role. No DELETE anywhere: money records are corrected, not removed.
grant select, insert, update on public.online_payment_intents to service_role;
grant select, insert, update on public.online_payment_events to service_role;
grant select, insert, update on public.online_payment_captures to service_role;
grant select, insert, update on public.notification_outbox to service_role;
grant select, insert on public.online_payment_audit to service_role;

-- ---------------------------------------------------------------- the quote

-- The canonical quote: what a parent is asked to pay for a scope, and the rows
-- it clears.
--
-- It walks `private.workbook_installment_snapshot` in the posting engine's own
-- order — EMI plan rows first, then due date, then installment number — over
-- `total_pending`, which is what the engine allocates against. So a quote that
-- is `eligible` is, by construction, an amount the engine will lay exactly
-- over the quoted rows and nothing else.
--
-- Not eligible, with a reason, when:
--   nothing_due                nothing owed in the scope
--   emi_plan_active            plan rows sort first; EMI policy is the desk's
--   earlier_dues_not_selected  an older owed row is outside the scope, and the
--                              engine would settle it first
--   late_fee_pending           a late fee is owed inside the scope. A late fee
--                              is not a fee: it is never folded into a fees
--                              figure, and waiving it is a staff decision
create or replace function private.online_payment_quote(
  p_student_id uuid,
  p_installment_nos smallint[],
  p_include_carry_forward boolean,
  p_as_of date
)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_plan_id uuid;
  v_row record;
  v_lines jsonb := '[]'::jsonb;
  v_reasons text[] := '{}';
  v_total integer := 0;
  v_fees integer := 0;
  v_late integer := 0;
  v_seen_unselected_owed boolean := false;
  v_prefix_broken boolean := false;
  v_hash_source text := '';
begin
  select p.id into v_plan_id
  from public.student_repayment_plans as p
  where p.student_id = p_student_id
    and p.lifecycle = 'active'
  limit 1;

  for v_row in
    select
      snapshot_row.installment_id,
      snapshot_row.installment_no,
      snapshot_row.due_date,
      snapshot_row.pending_amount,
      snapshot_row.late_fee_pending,
      snapshot_row.total_pending,
      coalesce(installment.is_carry_forward, false) as is_carry_forward,
      case when plan_item.installment_id is null then 1 else 0 end as plan_priority
    from private.workbook_installment_snapshot(p_student_id, p_as_of, true) as snapshot_row
    join public.installments as installment
      on installment.id = snapshot_row.installment_id
    left join public.student_repayment_plan_items as plan_item
      on plan_item.installment_id = snapshot_row.installment_id
      and plan_item.plan_id = v_plan_id
    where snapshot_row.total_pending > 0
    order by
      case when plan_item.installment_id is null then 1 else 0 end asc,
      snapshot_row.due_date asc,
      snapshot_row.installment_no asc
  loop
    if (v_row.is_carry_forward and coalesce(p_include_carry_forward, false))
       or (not v_row.is_carry_forward
           and v_row.installment_no = any(coalesce(p_installment_nos, '{}'::smallint[]))) then
      if v_seen_unselected_owed then
        v_prefix_broken := true;
      end if;
      v_lines := v_lines || jsonb_build_object(
        'installment_id', v_row.installment_id,
        'installment_no', v_row.installment_no,
        'due_date', v_row.due_date,
        'carry_forward', v_row.is_carry_forward,
        'fees_pending', v_row.pending_amount,
        'late_fee_pending', v_row.late_fee_pending,
        'total_pending', v_row.total_pending
      );
      v_total := v_total + v_row.total_pending;
      v_fees := v_fees + v_row.pending_amount;
      v_late := v_late + v_row.late_fee_pending;
      v_hash_source := v_hash_source || v_row.installment_id::text || ':' || v_row.total_pending || ';';
    else
      v_seen_unselected_owed := true;
    end if;
  end loop;

  if v_total <= 0 then v_reasons := array_append(v_reasons, 'nothing_due'); end if;
  if v_plan_id is not null then v_reasons := array_append(v_reasons, 'emi_plan_active'); end if;
  if v_prefix_broken then v_reasons := array_append(v_reasons, 'earlier_dues_not_selected'); end if;
  if v_late > 0 then v_reasons := array_append(v_reasons, 'late_fee_pending'); end if;

  return jsonb_build_object(
    'version', 1,
    'student_id', p_student_id,
    'as_of', p_as_of,
    'installment_nos', to_jsonb(coalesce(p_installment_nos, '{}'::smallint[])),
    'include_carry_forward', coalesce(p_include_carry_forward, false),
    'lines', v_lines,
    'fees_total', v_fees,
    'late_fee_total', v_late,
    'total', v_total,
    'reasons', to_jsonb(v_reasons),
    'eligible', cardinality(v_reasons) = 0,
    -- The rows and what each owes, not the date: the same dues quoted
    -- tomorrow are the same quote.
    'hash', md5('v1|' || v_hash_source)
  );
end;
$$;

revoke all on function private.online_payment_quote(uuid, smallint[], boolean, date)
  from public, anon, authenticated;
grant execute on function private.online_payment_quote(uuid, smallint[], boolean, date)
  to service_role;

create or replace function private.ist_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- The quote, for the reminder sender and the pay page. Service role only.
create or replace function public.online_payment_quote_for(
  p_student_id uuid,
  p_installment_nos smallint[],
  p_include_carry_forward boolean
)
returns jsonb
language sql
set search_path = public, private
as $$
  select private.online_payment_quote(
    p_student_id, p_installment_nos, p_include_carry_forward, private.ist_today()
  );
$$;

revoke all on function public.online_payment_quote_for(uuid, smallint[], boolean)
  from public, anon, authenticated;
grant execute on function public.online_payment_quote_for(uuid, smallint[], boolean)
  to service_role;

-- ---------------------------------------------------------------- the posting core

-- Who may reach the core without a staff permission: the online entry point,
-- for exactly the student whose verified, unapplied capture it named in this
-- transaction. SECURITY INVOKER on purpose, so current_user is the caller.
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
  );
end;
$$;

revoke all on function private.online_posting_in_progress(uuid) from public, anon;
grant execute on function private.online_posting_in_progress(uuid) to authenticated, service_role;

-- The posting engine, moved here verbatim from
-- `public.post_student_payment_with_adjustments` as it stood in production on
-- 2026-10-28 (20260811073129 + the `total_pending` line of 20260812120000).
-- The ONLY change is the first guard, which also admits
-- `private.online_posting_in_progress`.
--
-- **Edit the allocation here, not in the public RPC.** A migration that
-- string-patches the posting rule must now target this function.
create or replace function private.post_student_payment_core(
  p_student_id uuid,
  p_payment_date date,
  p_payment_mode payment_mode,
  p_total_amount integer,
  p_reference_number text default null::text,
  p_remarks text default null::text,
  p_received_by text default null::text,
  p_receipt_prefix text default 'SVP'::text,
  p_client_request_id uuid default null::uuid,
  p_quick_discount_amount integer default 0,
  p_quick_late_fee_waiver_amount integer default 0
)
returns table (receipt_id uuid, receipt_number text, allocated_total integer)
language plpgsql
set search_path to 'public'
as $function$
declare
  balance_row record;
  v_payment_allocation integer;
  v_discount_allocation integer;
  v_waiver_allocation integer;
  v_remaining_payment integer;
  v_remaining_discount integer;
  v_remaining_waiver integer;
  v_daily_sequence integer;
  v_candidate_receipt_number text;
  v_candidate_receipt_id uuid;
  v_existing_receipt_number text;
  v_existing_total_amount integer;
  v_total_pending integer;
  v_revised_pending integer;
  v_normalized_prefix text;
  v_pending_after integer;
  v_receipt_notes text;
  v_workbook_snapshot jsonb;
  v_plan_id uuid;
  v_plan_balance_before integer := 0;
  v_plan_contribution integer := 0;
begin
  if not (
    public.has_permission('payments:write')
    or private.online_posting_in_progress(p_student_id)
  ) then
    raise exception 'You do not have permission to post payments.';
  end if;

  if p_total_amount is null or p_total_amount <= 0 then
    raise exception 'Payment amount must be greater than 0.';
  end if;

  v_remaining_discount := greatest(coalesce(p_quick_discount_amount, 0), 0);
  v_remaining_waiver := greatest(coalesce(p_quick_late_fee_waiver_amount, 0), 0);
  v_remaining_payment := p_total_amount;
  v_receipt_notes := nullif(trim(coalesce(p_remarks, '')), '');

  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 0));

  if p_client_request_id is not null then
    select r.id, r.receipt_number, r.total_amount
    into v_candidate_receipt_id, v_existing_receipt_number, v_existing_total_amount
    from public.receipts as r
    where r.student_id = p_student_id
      and r.client_request_id = p_client_request_id
    order by r.created_at desc
    limit 1;

    if v_candidate_receipt_id is not null then
      return query select v_candidate_receipt_id, v_existing_receipt_number, v_existing_total_amount;
      return;
    end if;
  end if;

  select p.id into v_plan_id
  from public.student_repayment_plans as p
  where p.student_id = p_student_id
    and p.lifecycle = 'active'
  limit 1;

  if v_plan_id is not null and (v_remaining_discount > 0 or v_remaining_waiver > 0) then
    raise exception
      'This student is on an EMI plan. Discounts and late-fee waivers cannot be applied at the counter — reschedule the plan instead.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'installment_id', snapshot_row.installment_id,
        'pending_amount', snapshot_row.total_pending,
        'due_date', snapshot_row.due_date,
        'installment_no', snapshot_row.installment_no,
        'plan_priority', case when plan_item.installment_id is null then 1 else 0 end
      )
      order by
        case when plan_item.installment_id is null then 1 else 0 end asc,
        snapshot_row.due_date asc,
        snapshot_row.installment_no asc
    ),
    '[]'::jsonb
  )
  into v_workbook_snapshot
  from private.workbook_installment_snapshot(p_student_id, p_payment_date, true) as snapshot_row
  left join public.student_repayment_plan_items as plan_item
    on plan_item.installment_id = snapshot_row.installment_id
    and plan_item.plan_id = v_plan_id;

  select coalesce(sum(snapshot.pending_amount), 0)
  into v_total_pending
  from jsonb_to_recordset(v_workbook_snapshot) as snapshot(
    installment_id uuid,
    pending_amount integer,
    due_date date,
    installment_no smallint,
    plan_priority integer
  )
  where snapshot.pending_amount > 0;

  if v_plan_id is not null then
    select coalesce(sum(snapshot.pending_amount), 0)
    into v_plan_balance_before
    from jsonb_to_recordset(v_workbook_snapshot) as snapshot(
      installment_id uuid,
      pending_amount integer,
      due_date date,
      installment_no smallint,
      plan_priority integer
    )
    where snapshot.pending_amount > 0
      and snapshot.plan_priority = 0;
  end if;

  v_revised_pending := v_total_pending - v_remaining_discount - v_remaining_waiver;

  if v_total_pending <= 0 then
    raise exception 'No pending dues are available for this student.';
  end if;

  if v_revised_pending <= 0 then
    raise exception 'No payable dues found after discount and late fee waiver.';
  end if;

  if p_total_amount > v_revised_pending then
    raise exception 'Payment amount cannot exceed revised payable amount.';
  end if;

  v_normalized_prefix := coalesce(nullif(trim(coalesce(p_receipt_prefix, '')), ''), 'SVP');

  select coalesce(max((regexp_match(receipt_row.receipt_number, '-([0-9]{4})$'))[1]::integer), 0)
  into v_daily_sequence
  from public.receipts as receipt_row
  where receipt_row.receipt_number like v_normalized_prefix || to_char(p_payment_date, 'YYYYMMDD') || '-%';

  for _attempt in 1..12 loop
    v_daily_sequence := v_daily_sequence + 1;
    v_candidate_receipt_number := v_normalized_prefix || to_char(p_payment_date, 'YYYYMMDD') || '-' || lpad(v_daily_sequence::text, 4, '0');

    begin
      insert into public.receipts (
        receipt_number, student_id, payment_date, payment_mode, total_amount,
        reference_number, notes, received_by, client_request_id
      )
      values (
        v_candidate_receipt_number, p_student_id, p_payment_date, p_payment_mode, p_total_amount,
        nullif(trim(coalesce(p_reference_number, '')), ''),
        v_receipt_notes,
        nullif(trim(coalesce(p_received_by, '')), ''),
        p_client_request_id
      )
      returning id into v_candidate_receipt_id;
      exit;
    exception when unique_violation then
      if p_client_request_id is not null then
        select r.id, r.receipt_number, r.total_amount
        into v_candidate_receipt_id, v_existing_receipt_number, v_existing_total_amount
        from public.receipts as r
        where r.student_id = p_student_id
          and r.client_request_id = p_client_request_id
        order by r.created_at desc
        limit 1;

        if v_candidate_receipt_id is not null then
          return query
          select v_candidate_receipt_id, v_existing_receipt_number, v_existing_total_amount;
          return;
        end if;
      end if;
      continue;
    end;
  end loop;

  if v_candidate_receipt_id is null then
    raise exception 'Unable to generate a unique receipt number. Please retry.';
  end if;

  for balance_row in
    select snapshot.installment_id, snapshot.pending_amount, snapshot.due_date,
           snapshot.installment_no, snapshot.plan_priority
    from jsonb_to_recordset(v_workbook_snapshot) as snapshot(
      installment_id uuid,
      pending_amount integer,
      due_date date,
      installment_no smallint,
      plan_priority integer
    )
    where snapshot.pending_amount > 0
    order by snapshot.plan_priority asc, snapshot.due_date asc, snapshot.installment_no asc
  loop
    exit when v_remaining_payment <= 0 and v_remaining_discount <= 0 and v_remaining_waiver <= 0;

    v_discount_allocation := least(v_remaining_discount, balance_row.pending_amount);
    v_waiver_allocation := least(v_remaining_waiver, balance_row.pending_amount - v_discount_allocation);
    v_payment_allocation := least(v_remaining_payment, balance_row.pending_amount - v_discount_allocation - v_waiver_allocation);

    if v_discount_allocation > 0 then
      insert into public.receipt_adjustments (
        receipt_id, student_id, installment_id, adjustment_type, amount_delta, reason, notes
      )
      values (
        v_candidate_receipt_id, p_student_id, balance_row.installment_id, 'discount',
        v_discount_allocation, 'Payment Desk quick discount', null
      );
      v_remaining_discount := v_remaining_discount - v_discount_allocation;
    end if;

    if v_waiver_allocation > 0 then
      insert into public.receipt_adjustments (
        receipt_id, student_id, installment_id, adjustment_type, amount_delta, reason, notes
      )
      values (
        v_candidate_receipt_id, p_student_id, balance_row.installment_id, 'writeoff',
        v_waiver_allocation, 'Payment Desk late fee waiver', null
      );
      v_remaining_waiver := v_remaining_waiver - v_waiver_allocation;
    end if;

    if v_payment_allocation > 0 then
      v_pending_after := balance_row.pending_amount
        - v_discount_allocation - v_waiver_allocation - v_payment_allocation;
      insert into public.payments (
        receipt_id, student_id, installment_id, amount, notes,
        discount_applied_at_posting, waiver_applied_at_posting,
        pending_before_posting, pending_after_posting
      )
      values (
        v_candidate_receipt_id, p_student_id, balance_row.installment_id, v_payment_allocation,
        null,
        v_discount_allocation, v_waiver_allocation,
        balance_row.pending_amount, v_pending_after
      );
      v_remaining_payment := v_remaining_payment - v_payment_allocation;

      if balance_row.plan_priority = 0 then
        v_plan_contribution := v_plan_contribution + v_payment_allocation;
      end if;
    end if;
  end loop;

  if v_remaining_payment <> 0 or v_remaining_discount <> 0 or v_remaining_waiver <> 0 then
    raise exception 'Unable to allocate payment and concessions cleanly. Please retry.';
  end if;

  if v_plan_id is not null then
    insert into public.student_repayment_receipt_links (
      plan_id, student_id, receipt_id,
      contribution_amount, spillover_amount,
      plan_balance_before, plan_balance_after
    )
    values (
      v_plan_id, p_student_id, v_candidate_receipt_id,
      v_plan_contribution, p_total_amount - v_plan_contribution,
      v_plan_balance_before, v_plan_balance_before - v_plan_contribution
    );
  end if;

  return query select v_candidate_receipt_id, v_candidate_receipt_number, p_total_amount;
end;
$function$;

revoke all on function private.post_student_payment_core(uuid, date, payment_mode, integer, text, text, text, text, uuid, integer, integer)
  from public, anon;
grant execute on function private.post_student_payment_core(uuid, date, payment_mode, integer, text, text, text, text, uuid, integer, integer)
  to authenticated, service_role;

-- The Payment Desk's RPC: same signature, same permission check, same result.
-- `create or replace` keeps its existing grants.
create or replace function public.post_student_payment_with_adjustments(
  p_student_id uuid,
  p_payment_date date,
  p_payment_mode payment_mode,
  p_total_amount integer,
  p_reference_number text default null::text,
  p_remarks text default null::text,
  p_received_by text default null::text,
  p_receipt_prefix text default 'SVP'::text,
  p_client_request_id uuid default null::uuid,
  p_quick_discount_amount integer default 0,
  p_quick_late_fee_waiver_amount integer default 0
)
returns table (receipt_id uuid, receipt_number text, allocated_total integer)
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Staff only, exactly as before. The online entry point never comes through
  -- here: under a service-role JWT this check refuses, as it always has.
  if not public.has_permission('payments:write') then
    raise exception 'You do not have permission to post payments.';
  end if;

  return query
  select core.receipt_id, core.receipt_number, core.allocated_total
  from private.post_student_payment_core(
    p_student_id, p_payment_date, p_payment_mode, p_total_amount,
    p_reference_number, p_remarks, p_received_by, p_receipt_prefix,
    p_client_request_id, p_quick_discount_amount, p_quick_late_fee_waiver_amount
  ) as core;
end;
$function$;

-- ---------------------------------------------------------------- supersede

create or replace function private.current_online_intent_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(current_setting('vpps.online_intent_id', true), '')::uuid;
exception when others then
  return null;
end;
$$;

-- Any receipt for a student supersedes their open intent — cash, cheque, bulk
-- upload, a write-off, a corrected payment — except the one the online entry
-- point is posting right now. The provider link is cancelled by the
-- reconciler; this only makes sure the pay page stops offering it.
create or replace function private.supersede_open_online_intents()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.online_payment_intents
  set status = 'superseded',
      superseded_reason = 'another_payment_posted',
      updated_at = now()
  where student_id = new.student_id
    and status in ('link_pending', 'link_created')
    and id is distinct from private.current_online_intent_id();
  return null;
end;
$$;

create trigger supersede_online_intents_on_receipt
  after insert on public.receipts
  for each row execute function private.supersede_open_online_intents();

-- ---------------------------------------------------------------- intents

create or replace function private.online_audit(
  p_action text,
  p_intent_id uuid,
  p_capture_id uuid,
  p_event_id uuid,
  p_detail jsonb,
  p_actor text default 'system'
)
returns void
language sql
set search_path = public
as $$
  insert into public.online_payment_audit (action, intent_id, capture_id, event_id, detail, actor)
  values (p_action, p_intent_id, p_capture_id, p_event_id, coalesce(p_detail, '{}'::jsonb), coalesce(p_actor, 'system'));
$$;

revoke all on function private.online_audit(text, uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function private.online_audit(text, uuid, uuid, uuid, jsonb, text) to service_role;

-- Open (or reuse) the student's intent for a scope, re-quoting from the ledger
-- under the student's lock. Reused when the dues have not moved; otherwise the
-- old one is superseded and a new version written. Service role only.
create or replace function public.online_payment_open_intent(
  p_student_id uuid,
  p_send_id uuid,
  p_installment_nos smallint[],
  p_include_carry_forward boolean,
  p_provider_mode text,
  p_expires_at timestamptz,
  p_public_ref text
)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_session text;
  v_quote jsonb;
  v_existing public.online_payment_intents;
  v_new public.online_payment_intents;
  v_id uuid := gen_random_uuid();
begin
  if not private.online_setting_on('online_payment_links_enabled') then
    return jsonb_build_object('ok', false, 'reason', 'links_disabled');
  end if;
  if p_provider_mode not in ('test', 'live') then
    raise exception 'Unknown provider mode.';
  end if;
  -- Razorpay refuses an expiry under 15 minutes away; six months is its ceiling.
  if p_expires_at < now() + interval '16 minutes' or p_expires_at > now() + interval '180 days' then
    raise exception 'Link expiry is outside the provider window.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 0));

  select class.session_label into v_session
  from public.students as student
  join public.classes as class on class.id = student.class_id
  where student.id = p_student_id;
  if v_session is null then
    return jsonb_build_object('ok', false, 'reason', 'student_not_found');
  end if;

  v_quote := private.online_payment_quote(
    p_student_id, p_installment_nos, p_include_carry_forward, private.ist_today()
  );

  select * into v_existing
  from public.online_payment_intents
  where student_id = p_student_id
    and status in ('link_pending', 'link_created')
  for update;

  if not coalesce((v_quote->>'eligible')::boolean, false) then
    -- Nothing payable any more: the open link must not stay on offer.
    if v_existing.id is not null and (v_quote->'reasons') ? 'nothing_due' then
      update public.online_payment_intents
      set status = 'superseded', superseded_reason = 'nothing_due', updated_at = now()
      where id = v_existing.id;
      perform private.online_audit('intent_superseded', v_existing.id, null, null,
        jsonb_build_object('reason', 'nothing_due'));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_eligible', 'quote', v_quote);
  end if;

  if v_existing.id is not null then
    if v_existing.quote_hash = v_quote->>'hash'
       and v_existing.provider_mode = p_provider_mode
       and v_existing.scope_installment_nos = coalesce(p_installment_nos, '{}'::smallint[])
       and v_existing.scope_include_carry_forward = coalesce(p_include_carry_forward, false)
       and v_existing.expires_at > now() + interval '10 minutes' then
      return jsonb_build_object('ok', true, 'reused', true, 'intent', to_jsonb(v_existing));
    end if;
    update public.online_payment_intents
    set status = 'superseded', superseded_reason = 'quote_changed', updated_at = now()
    where id = v_existing.id;
    perform private.online_audit('intent_superseded', v_existing.id, null, null,
      jsonb_build_object('reason', 'quote_changed', 'old_hash', v_existing.quote_hash,
                         'new_hash', v_quote->>'hash'));
  end if;

  insert into public.online_payment_intents (
    id, public_ref, provider_mode, status, student_id, session_label, send_id,
    scope_installment_nos, scope_include_carry_forward,
    quote, quote_version, quote_hash, amount_rupees, expires_at, provider_reference_id
  )
  values (
    v_id, p_public_ref, p_provider_mode, 'link_pending', p_student_id, v_session, p_send_id,
    coalesce(p_installment_nos, '{}'::smallint[]), coalesce(p_include_carry_forward, false),
    v_quote, (v_quote->>'version')::integer, v_quote->>'hash', (v_quote->>'total')::integer,
    p_expires_at,
    -- 37 characters, inside Razorpay's 40, and unique per intent — which is
    -- what makes an uncertain create safe to retry: a second create with the
    -- same reference is refused, and the link is fetched by it instead.
    'vpps_' || replace(v_id::text, '-', '')
  )
  returning * into v_new;

  perform private.online_audit('intent_opened', v_new.id, null, null,
    jsonb_build_object('amount_rupees', v_new.amount_rupees, 'quote_hash', v_new.quote_hash,
                       'send_id', p_send_id, 'mode', p_provider_mode));

  return jsonb_build_object('ok', true, 'reused', false, 'intent', to_jsonb(v_new));
end;
$$;

revoke all on function public.online_payment_open_intent(uuid, uuid, smallint[], boolean, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.online_payment_open_intent(uuid, uuid, smallint[], boolean, text, timestamptz, text)
  to service_role;

-- The provider confirmed a link for this intent (created, or found by its
-- reference after an uncertain create). A superseded intent keeps its status:
-- the reconciler will cancel the link it now knows about.
create or replace function public.online_payment_link_recorded(
  p_intent_id uuid,
  p_link_id text,
  p_short_url text
)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_intent public.online_payment_intents;
begin
  update public.online_payment_intents
  set provider_link_id = coalesce(provider_link_id, p_link_id),
      provider_short_url = coalesce(provider_short_url, p_short_url),
      status = case when status = 'link_pending' then 'link_created' else status end,
      link_attempts = link_attempts + 1,
      last_error = null,
      updated_at = now()
  where id = p_intent_id
  returning * into v_intent;

  if v_intent.id is null then
    raise exception 'Unknown intent.';
  end if;
  if v_intent.provider_link_id is distinct from p_link_id then
    raise exception 'Intent already carries a different provider link.';
  end if;

  perform private.online_audit('link_recorded', v_intent.id, null, null,
    jsonb_build_object('link_id', p_link_id, 'status', v_intent.status));
  return to_jsonb(v_intent);
end;
$$;

revoke all on function public.online_payment_link_recorded(uuid, text, text) from public, anon, authenticated;
grant execute on function public.online_payment_link_recorded(uuid, text, text) to service_role;

-- The provider answered about a link. `p_definite` = it refused, and nothing
-- exists there: the intent fails and frees the student's slot. Otherwise the
-- outcome is uncertain and the intent stays `link_pending` for a reconcile.
create or replace function public.online_payment_link_failed(
  p_intent_id uuid,
  p_error text,
  p_definite boolean
)
returns void
language plpgsql
set search_path = public, private
as $$
begin
  update public.online_payment_intents
  set status = case when p_definite and status = 'link_pending' then 'failed' else status end,
      last_error = left(coalesce(p_error, ''), 500),
      link_attempts = link_attempts + 1,
      updated_at = now()
  where id = p_intent_id;
  perform private.online_audit(
    case when p_definite then 'link_refused' else 'link_uncertain' end,
    p_intent_id, null, null, jsonb_build_object('error', left(coalesce(p_error, ''), 300)));
end;
$$;

revoke all on function public.online_payment_link_failed(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.online_payment_link_failed(uuid, text, boolean) to service_role;

-- The provider says the link ended (expired or cancelled) or that the office
-- cancelled it. Never used to mark anything PAID.
create or replace function public.online_payment_link_closed(
  p_intent_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
set search_path = public, private
as $$
begin
  if p_status not in ('expired', 'cancelled') then
    raise exception 'A link can only close as expired or cancelled.';
  end if;
  update public.online_payment_intents
  set status = case when status in ('link_pending', 'link_created') then p_status else status end,
      provider_cancelled_at = coalesce(provider_cancelled_at, now()),
      superseded_reason = coalesce(superseded_reason, p_reason),
      updated_at = now()
  where id = p_intent_id;
  perform private.online_audit('link_closed', p_intent_id, null, null,
    jsonb_build_object('status', p_status, 'reason', p_reason));
end;
$$;

revoke all on function public.online_payment_link_closed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.online_payment_link_closed(uuid, text, text) to service_role;

-- ---------------------------------------------------------------- inbox

-- Record a verified webhook. Returns false for a duplicate event id.
create or replace function public.online_payment_record_event(
  p_provider_event_id text,
  p_event_type text,
  p_account_id text,
  p_provider_payment_id text,
  p_provider_link_id text,
  p_payload_sha256 text,
  p_facts jsonb
)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  insert into public.online_payment_events (
    provider_event_id, event_type, account_id, provider_payment_id, provider_link_id,
    payload_sha256, facts
  )
  values (
    p_provider_event_id, p_event_type, p_account_id, p_provider_payment_id, p_provider_link_id,
    p_payload_sha256, coalesce(p_facts, '{}'::jsonb)
  )
  on conflict (provider_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.online_payment_events where provider_event_id = p_provider_event_id;
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end;
$$;

revoke all on function public.online_payment_record_event(text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.online_payment_record_event(text, text, text, text, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------- captures

-- Record a payment the server has FETCHED from the provider and found
-- captured. Never called with a webhook body, a browser redirect or anything
-- a parent typed. Idempotent on the provider payment id.
create or replace function public.online_payment_record_capture(p_facts jsonb)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_payment_id text := nullif(trim(p_facts->>'provider_payment_id'), '');
  v_link_id text := nullif(trim(p_facts->>'provider_link_id'), '');
  v_reference_id text := nullif(trim(p_facts->>'reference_id'), '');
  v_mode text := p_facts->>'provider_mode';
  v_amount bigint := (p_facts->>'amount_paise')::bigint;
  v_currency text := upper(coalesce(p_facts->>'currency', ''));
  v_intent public.online_payment_intents;
  v_capture public.online_payment_captures;
  v_reasons text[] := '{}';
begin
  if v_payment_id is null or v_payment_id !~ '^pay_[A-Za-z0-9]+$' then
    raise exception 'A capture needs a provider payment id.';
  end if;
  if coalesce(p_facts->>'provider_status', '') <> 'captured'
     or coalesce((p_facts->>'captured')::boolean, false) is not true then
    -- Authorised-only, failed or refunded money is not recorded as a capture.
    return jsonb_build_object('recorded', false, 'reason', 'not_captured');
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'A capture needs a positive amount.';
  end if;

  select * into v_capture from public.online_payment_captures where provider_payment_id = v_payment_id;
  if v_capture.id is not null then
    return jsonb_build_object('recorded', true, 'duplicate', true, 'capture', to_jsonb(v_capture));
  end if;

  if v_link_id is not null then
    select * into v_intent from public.online_payment_intents where provider_link_id = v_link_id;
  end if;
  if v_intent.id is null and v_reference_id is not null then
    select * into v_intent from public.online_payment_intents where provider_reference_id = v_reference_id;
  end if;

  if v_intent.id is null then
    v_reasons := array_append(v_reasons, 'unknown_link');
  else
    if v_intent.provider_mode <> v_mode then v_reasons := array_append(v_reasons, 'wrong_mode'); end if;
    if v_currency <> v_intent.currency then v_reasons := array_append(v_reasons, 'wrong_currency'); end if;
    if v_amount <> v_intent.amount_paise then v_reasons := array_append(v_reasons, 'wrong_amount'); end if;
  end if;
  -- The ledger holds whole rupees. A fractional rupee is quarantined, never rounded.
  if v_amount % 100 <> 0 then v_reasons := array_append(v_reasons, 'fractional_rupee'); end if;

  insert into public.online_payment_captures (
    provider_payment_id, intent_id, provider_link_id, provider_mode, amount_paise, currency,
    provider_status, method, fee_paise, tax_paise, captured_at,
    application_status, review_reason
  )
  values (
    v_payment_id, v_intent.id, v_link_id, v_mode, v_amount, v_currency,
    p_facts->>'provider_status', nullif(p_facts->>'method', ''),
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

  if v_intent.id is not null and v_intent.status in ('link_pending', 'link_created') then
    update public.online_payment_intents
    set status = case when cardinality(v_reasons) = 0 then 'paid' else 'review_required' end,
        updated_at = now()
    where id = v_intent.id;
  end if;

  perform private.online_audit('capture_recorded', v_intent.id, v_capture.id, null,
    jsonb_build_object('amount_paise', v_amount, 'method', p_facts->>'method',
                       'review', v_capture.review_reason));

  return jsonb_build_object('recorded', true, 'duplicate', false, 'capture', to_jsonb(v_capture));
end;
$$;

revoke all on function public.online_payment_record_capture(jsonb) from public, anon, authenticated;
grant execute on function public.online_payment_record_capture(jsonb) to service_role;

-- Post a recorded capture through the posting engine, once.
--
-- One transaction: the student's lock, the intent, the capture, a fresh quote
-- as of the day the money was captured, the posting, the receipt, the intent
-- marked accounted and the receipt notice queued. If the fresh quote is not
-- the one the parent paid against, nothing is posted and the capture waits
-- for a person, marked `review_required`.
create or replace function public.online_payment_apply_capture(
  p_capture_id uuid,
  p_actor text default 'system'
)
returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_capture public.online_payment_captures;
  v_intent public.online_payment_intents;
  v_student_id uuid;
  v_payment_date date;
  v_quote jsonb;
  v_reason text;
  v_receipt_id uuid;
  v_receipt_number text;
begin
  -- Lock order everywhere money moves: the student first (the same advisory
  -- key the desk takes), then the intent, then the capture.
  select intent.student_id into v_student_id
  from public.online_payment_captures as capture
  join public.online_payment_intents as intent on intent.id = capture.intent_id
  where capture.id = p_capture_id;

  if v_student_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_student_id::text, 0));
  end if;

  select * into v_capture from public.online_payment_captures where id = p_capture_id for update;
  if v_capture.id is null then
    raise exception 'Unknown capture.';
  end if;
  if v_capture.application_status = 'applied' then
    return jsonb_build_object('applied', true, 'duplicate', true, 'receipt_id', v_capture.receipt_id);
  end if;
  if v_capture.application_status <> 'pending' then
    return jsonb_build_object('applied', false, 'status', v_capture.application_status,
                              'reason', v_capture.review_reason);
  end if;

  select * into v_intent from public.online_payment_intents where id = v_capture.intent_id for update;

  v_payment_date := (coalesce(v_capture.captured_at, now()) at time zone 'Asia/Kolkata')::date;

  if v_intent.id is null then
    v_reason := 'unknown_link';
  elsif v_capture.amount_paise <> v_intent.amount_paise or v_capture.amount_paise % 100 <> 0 then
    v_reason := 'wrong_amount';
  elsif v_intent.status in ('accounted') then
    v_reason := 'intent_already_accounted';
  else
    v_quote := private.online_payment_quote(
      v_intent.student_id, v_intent.scope_installment_nos,
      v_intent.scope_include_carry_forward, v_payment_date
    );
    if not coalesce((v_quote->>'eligible')::boolean, false) then
      v_reason := 'dues_changed:' || coalesce(v_quote->>'reasons', '');
    elsif v_quote->>'hash' <> v_intent.quote_hash then
      v_reason := 'dues_changed';
    end if;
  end if;

  if v_reason is not null then
    update public.online_payment_captures
    set application_status = 'review_required', review_reason = v_reason, updated_at = now()
    where id = v_capture.id;
    if v_intent.id is not null and v_intent.status not in ('accounted') then
      update public.online_payment_intents set status = 'review_required', updated_at = now()
      where id = v_intent.id;
    end if;
    perform private.online_audit('capture_needs_review', v_intent.id, v_capture.id, null,
      jsonb_build_object('reason', v_reason), p_actor);
    return jsonb_build_object('applied', false, 'status', 'review_required', 'reason', v_reason);
  end if;

  perform set_config('vpps.online_capture_id', v_capture.id::text, true);
  perform set_config('vpps.online_intent_id', v_intent.id::text, true);

  begin
    select core.receipt_id, core.receipt_number
    into v_receipt_id, v_receipt_number
    from private.post_student_payment_core(
      v_intent.student_id,
      v_payment_date,
      'online'::payment_mode,
      v_intent.amount_rupees,
      v_capture.provider_payment_id,
      'Online payment via Razorpay · ' || v_intent.public_ref,
      'Razorpay (online)',
      'SVP',
      -- Deterministic per provider payment: the engine's own idempotency key.
      md5('razorpay:' || v_capture.provider_payment_id)::uuid,
      0,
      0
    ) as core;
  exception when others then
    perform set_config('vpps.online_capture_id', '', true);
    perform set_config('vpps.online_intent_id', '', true);
    update public.online_payment_captures
    set application_status = 'review_required',
        review_reason = left('posting_refused: ' || sqlerrm, 300),
        updated_at = now()
    where id = v_capture.id;
    update public.online_payment_intents set status = 'review_required', updated_at = now()
    where id = v_intent.id;
    perform private.online_audit('capture_needs_review', v_intent.id, v_capture.id, null,
      jsonb_build_object('reason', 'posting_refused', 'error', left(sqlerrm, 300)), p_actor);
    return jsonb_build_object('applied', false, 'status', 'review_required', 'reason', 'posting_refused');
  end;

  perform set_config('vpps.online_capture_id', '', true);
  perform set_config('vpps.online_intent_id', '', true);

  update public.online_payment_captures
  set application_status = 'applied', receipt_id = v_receipt_id, applied_at = now(),
      review_reason = null, updated_at = now()
  where id = v_capture.id;

  update public.online_payment_intents
  set status = 'accounted', receipt_id = v_receipt_id, accounted_at = now(), updated_at = now()
  where id = v_intent.id;

  insert into public.notification_outbox (kind, dedupe_key, receipt_id, student_id, session_label, payload)
  values (
    'receipt_notice', 'receipt_notice:' || v_receipt_id::text, v_receipt_id, v_intent.student_id,
    v_intent.session_label,
    jsonb_build_object('receipt_number', v_receipt_number, 'amount', v_intent.amount_rupees,
                       'payment_date', v_payment_date)
  )
  on conflict (dedupe_key) do nothing;

  perform private.online_audit('capture_applied', v_intent.id, v_capture.id, null,
    jsonb_build_object('receipt_id', v_receipt_id, 'receipt_number', v_receipt_number,
                       'amount_rupees', v_intent.amount_rupees, 'payment_date', v_payment_date),
    p_actor);

  return jsonb_build_object('applied', true, 'duplicate', false, 'receipt_id', v_receipt_id,
                            'receipt_number', v_receipt_number);
end;
$$;

revoke all on function public.online_payment_apply_capture(uuid, text) from public, anon, authenticated;
grant execute on function public.online_payment_apply_capture(uuid, text) to service_role;

-- A person decided what to do with a capture in review. Recorded, never
-- deleted: a refund or a manual posting is its own separately authorised act.
create or replace function public.online_payment_resolve_review(
  p_capture_id uuid,
  p_staff_id uuid,
  p_note text
)
returns void
language plpgsql
set search_path = public, private
as $$
begin
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Say what was done with this payment.';
  end if;
  update public.online_payment_captures
  set resolved_by = p_staff_id, resolved_at = now(), resolution_note = left(p_note, 500),
      updated_at = now()
  where id = p_capture_id and application_status = 'review_required';
  perform private.online_audit('review_resolved', null, p_capture_id, null,
    jsonb_build_object('note', left(p_note, 300)), coalesce(p_staff_id::text, 'staff'));
end;
$$;

revoke all on function public.online_payment_resolve_review(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.online_payment_resolve_review(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- outbox

create or replace function public.notification_outbox_claim(p_limit integer, p_lease_seconds integer)
returns setof public.notification_outbox
language sql
set search_path = public
as $$
  update public.notification_outbox as outbox
  set status = 'processing',
      locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      attempts = outbox.attempts + 1,
      updated_at = now()
  where outbox.id in (
    select candidate.id
    from public.notification_outbox as candidate
    where (
        candidate.status in ('queued', 'failed')
        and candidate.next_attempt_at <= now()
        and candidate.attempts < candidate.max_attempts
      )
      or (candidate.status = 'processing' and candidate.locked_until < now())
    order by candidate.next_attempt_at
    limit greatest(least(p_limit, 50), 1)
    for update skip locked
  )
  returning outbox.*;
$$;

revoke all on function public.notification_outbox_claim(integer, integer) from public, anon, authenticated;
grant execute on function public.notification_outbox_claim(integer, integer) to service_role;

create or replace function public.notification_outbox_complete(
  p_id uuid,
  p_status text,
  p_provider_message_id text,
  p_error text,
  p_retry_in_seconds integer
)
returns void
language sql
set search_path = public
as $$
  update public.notification_outbox
  set status = p_status,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      last_error = left(p_error, 500),
      locked_until = null,
      next_attempt_at = case
        when p_status = 'failed' then now() + make_interval(secs => greatest(coalesce(p_retry_in_seconds, 600), 60))
        else next_attempt_at
      end,
      updated_at = now()
  where id = p_id;
$$;

revoke all on function public.notification_outbox_complete(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.notification_outbox_complete(uuid, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------- reconciliation

-- Every captured rupee is either on a receipt or in front of a person.
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
  coalesce(sum(receipt.total_amount)::bigint * 100, 0) as receipted_paise,
  coalesce(sum(capture.fee_paise), 0) as provider_fee_paise,
  coalesce(sum(capture.tax_paise), 0) as provider_tax_paise
from public.online_payment_captures as capture
left join public.receipts as receipt on receipt.id = capture.receipt_id
group by 1, 2;

revoke all on public.v_online_payment_reconciliation from anon, authenticated;
grant select on public.v_online_payment_reconciliation to service_role;

-- ---------------------------------------------------------------- the timer

create or replace function public.online_payments_cron_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select ds.decrypted_secret = p_secret
      from vault.decrypted_secrets ds
      where ds.name = 'VPPS_ONLINE_PAYMENTS_CRON_SECRET'
      limit 1
    ),
    false
  );
$$;

revoke all on function public.online_payments_cron_secret_matches(text) from public;
revoke all on function public.online_payments_cron_secret_matches(text) from anon, authenticated;
grant execute on function public.online_payments_cron_secret_matches(text) to service_role;

-- Every ten minutes: retry the inbox, reconcile open links, cancel superseded
-- ones, drain the receipt outbox. A route with nothing to do answers in one
-- round trip. Silent until Vault holds VPPS_ONLINE_PAYMENTS_CRON_SECRET, so a
-- preview branch or the dev project never calls production.
-- [VPPS One] cron.unschedule block removed (see header).

-- [VPPS One] cron.schedule block removed (see header).

commit;
