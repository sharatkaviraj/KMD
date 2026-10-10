-- UI redesign: the accountant's books (AccHome, AccBooks, Reports, FeeSetup).
--
-- Everything here is VPPS One's own bookkeeping *about* fee rows, never a fee
-- row itself. Receipts, refunds and waivers stay in `public` and are written
-- only by the ported fee module. These tables hold what the fee app never
-- recorded: the cheque's number and where it physically is, the deposit slip
-- it went to the bank on, the bank's UPI statement and which receipt each
-- line matched, the accountant's requests to the admin, the counter queue and
-- report schedules.
--
-- Fee ids (`receipt_id`, `student_id`) are stored with no foreign key (rule 2).
-- Event tables are append-only: the latest event is the state, and a mistake
-- is corrected by a later event, never an update.

create table vppsone.acc_deposit_slips (
  id uuid primary key default gen_random_uuid(),
  slip_no text not null unique,
  bank_label text not null,
  deposited_on date not null,
  total_amount integer not null check (total_amount >= 0),
  cheque_count integer not null check (cheque_count > 0),
  note text,
  created_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table vppsone.acc_cheques (
  id uuid primary key default gen_random_uuid(),
  -- `public.receipts.id` of a cheque receipt. One set of details per receipt.
  receipt_id uuid not null unique,
  cheque_no text not null check (length(trim(cheque_no)) between 3 and 12),
  bank_name text not null check (length(trim(bank_name)) between 2 and 80),
  cheque_date date,
  created_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table vppsone.acc_cheque_events (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  status text not null check (status in ('in_bag', 'deposited', 'cleared', 'bounced')),
  deposit_slip_id uuid references vppsone.acc_deposit_slips (id) on delete restrict,
  reason text,
  note text,
  created_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint acc_cheque_events_deposit_has_slip check (status <> 'deposited' or deposit_slip_id is not null),
  constraint acc_cheque_events_bounce_has_reason check (status <> 'bounced' or reason is not null)
);
create index acc_cheque_events_receipt on vppsone.acc_cheque_events (receipt_id, created_at desc);

create table vppsone.acc_upi_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  txn_at timestamptz not null,
  amount integer not null check (amount > 0),
  payer text not null,
  utr text not null check (length(trim(utr)) between 6 and 30),
  bank_label text not null default 'School account',
  uploaded_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  constraint acc_upi_lines_once unique (utr, amount)
);
create index acc_upi_lines_txn on vppsone.acc_upi_lines (txn_at desc);

create table vppsone.acc_upi_events (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references vppsone.acc_upi_lines (id) on delete restrict,
  action text not null check (action in ('match', 'unmatch', 'not_fee')),
  receipt_id uuid,
  note text,
  created_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint acc_upi_events_match_has_receipt check (action <> 'match' or receipt_id is not null)
);
create index acc_upi_events_line on vppsone.acc_upi_events (line_id, created_at desc);

create table vppsone.acc_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('late_fee_waiver', 'reversal', 'refund', 'fee_change', 'other')),
  student_id uuid,
  receipt_id uuid,
  amount integer check (amount is null or amount >= 0),
  title text not null check (length(trim(title)) between 3 and 200),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  requested_at timestamptz not null default now(),
  reminded_at timestamptz,
  withdrawn_at timestamptz,
  decision text check (decision in ('approved', 'declined')),
  decision_note text,
  decided_by uuid references vppsone.staff_profiles (id) on delete restrict,
  decided_at timestamptz,
  constraint acc_requests_decided_together check ((decision is null) = (decided_at is null)),
  constraint acc_requests_not_both check (decision is null or withdrawn_at is null)
);
create index acc_requests_open on vppsone.acc_requests (requested_at desc) where decision is null and withdrawn_at is null;

create table vppsone.acc_counter_queue (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  family_label text not null,
  note text,
  arrived_at timestamptz not null default now(),
  served_at timestamptz,
  left_at timestamptz,
  added_by uuid not null references vppsone.staff_profiles (id) on delete restrict
);
create index acc_counter_queue_waiting on vppsone.acc_counter_queue (arrived_at) where served_at is null and left_at is null;

create table vppsone.acc_reminder_pauses (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  paused boolean not null,
  created_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index acc_reminder_pauses_day on vppsone.acc_reminder_pauses (day, created_at desc);

create table vppsone.acc_report_schedules (
  id uuid primary key default gen_random_uuid(),
  report_key text not null check (report_key in ('collection', 'defaulters', 'classwise', 'daybook')),
  title text not null,
  recipients text[] not null check (cardinality(recipients) > 0),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday smallint check (weekday between 0 and 6),
  send_time time not null default '18:00',
  format text not null default 'pdf' check (format in ('pdf', 'excel')),
  active boolean not null default true,
  last_sent_at timestamptz,
  created_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table vppsone.acc_cheques is 'Cheque number and bank for a cheque receipt in public.receipts. Not a fee row.';
comment on table vppsone.acc_cheque_events is 'Append-only: where a cheque is (in the bag, deposited, cleared, bounced). Latest event is its state.';
comment on table vppsone.acc_upi_events is 'Append-only: a bank statement UPI line matched to a receipt, unmatched, or marked not a fee.';
comment on table vppsone.acc_requests is 'An accountant asks the admin: waive a late fee, reverse a receipt, refund, change a fee. The decision is recorded here; the fee write happens in the fee module.';

do $$
declare t text;
begin
  foreach t in array array['acc_deposit_slips', 'acc_cheques', 'acc_cheque_events', 'acc_upi_lines', 'acc_upi_events',
                           'acc_requests', 'acc_counter_queue', 'acc_reminder_pauses', 'acc_report_schedules']
  loop
    execute format('alter table vppsone.%I enable row level security', t);
    execute format('create policy %I on vppsone.%I for select to authenticated using ((select vppsone.staff_can_any(array[''fees:view''])))', t || '_select_fees', t);
    execute format('grant select on vppsone.%I to authenticated', t);
    execute format('grant all on vppsone.%I to service_role', t);
  end loop;
end $$;
