-- The counted close of a fee desk day. Insert-only: reopening is a new row.
-- It does not lock receipts (that would mean changing the fee RPCs); receipts
-- posted after a close are flagged on /receipts instead. The fee app's own
-- auto-day-close cron (public.collection_closures) is left as it is.

create table if not exists vppsone.fee_day_close_events (
  id uuid primary key default gen_random_uuid(),
  payment_date date not null,
  action text not null,
  session_label text not null,
  expected jsonb not null default '{}'::jsonb,
  denominations jsonb not null default '{}'::jsonb,
  cash_expected numeric(12, 2) not null default 0,
  cash_counted numeric(12, 2) not null default 0,
  upi_checked boolean not null default false,
  receipt_count integer not null default 0,
  reversed_count integer not null default 0,
  note text,
  actor_id uuid references vppsone.staff_profiles (id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint fee_day_close_events_action_known check (action in ('close', 'reopen')),
  constraint fee_day_close_events_counted_or_explained check (
    action <> 'close' or cash_counted = cash_expected or length(btrim(coalesce(note, ''))) >= 5),
  constraint fee_day_close_events_note_short check (note is null or length(note) <= 500)
);
comment on table vppsone.fee_day_close_events is
  'Counted close of a fee desk day. Insert-only: reopening is a new row. Does not lock receipts; receipts posted after a close are flagged on screen.';
create index if not exists fee_day_close_events_by_day_idx on vppsone.fee_day_close_events (payment_date, created_at desc);
alter table vppsone.fee_day_close_events enable row level security;
create policy fee_day_close_events_select on vppsone.fee_day_close_events for select to authenticated
  using ((select vppsone.staff_can('fees:view')));
grant select on vppsone.fee_day_close_events to authenticated;
grant select, insert on vppsone.fee_day_close_events to service_role;
