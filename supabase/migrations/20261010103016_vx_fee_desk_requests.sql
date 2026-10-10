-- A receipt reversal or a write-off asked for by staff who cannot do it
-- themselves, for an admin to decide under "Needs you". The money moves only
-- through the fee RPCs, and only when an admin acts.

create table if not exists vppsone.fee_desk_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null default 'pending',
  session_label text not null,
  student_id uuid not null,
  receipt_id uuid,
  receipt_number text,
  amount numeric(12, 2) not null,
  reason_code text not null,
  note text,
  requested_by uuid references vppsone.staff_profiles (id) on delete set null,
  requested_by_name text,
  decided_by uuid references vppsone.staff_profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  constraint fee_desk_requests_kind_known check (kind in ('reversal', 'write_off')),
  constraint fee_desk_requests_status_known check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  constraint fee_desk_requests_amount_positive check (amount > 0),
  constraint fee_desk_requests_reversal_has_receipt check (kind <> 'reversal' or receipt_id is not null),
  constraint fee_desk_requests_note_short check (note is null or length(note) <= 500)
);
comment on table vppsone.fee_desk_requests is
  'A receipt reversal or a write-off asked for by staff who cannot do it themselves. An admin decides; the money moves only through the fee RPCs.';
create unique index if not exists fee_desk_requests_one_pending_reversal
  on vppsone.fee_desk_requests (receipt_id) where kind = 'reversal' and status = 'pending';
create unique index if not exists fee_desk_requests_one_pending_write_off
  on vppsone.fee_desk_requests (student_id, session_label) where kind = 'write_off' and status = 'pending';
create index if not exists fee_desk_requests_pending_idx on vppsone.fee_desk_requests (created_at desc) where status = 'pending';
alter table vppsone.fee_desk_requests enable row level security;
create policy fee_desk_requests_select on vppsone.fee_desk_requests for select to authenticated
  using ((select vppsone.staff_can('fees:view')));
grant select on vppsone.fee_desk_requests to authenticated;
grant select, insert, update on vppsone.fee_desk_requests to service_role;
