-- A parent's promise on a call: amount and date. Insert-only. Kept or broken
-- is computed from receipts (src/modules/defaulters/vx), never stored.

alter table vppsone.fee_call_promises
  add constraint fee_call_promises_created_by_fkey foreign key (created_by) references vppsone.staff_profiles (id) on delete set null,
  add constraint fee_call_promises_kind_known check (kind in ('pay', 'visit')),
  add constraint fee_call_promises_amount_non_negative check (amount >= 0),
  add constraint fee_call_promises_note_short check (note is null or length(note) <= 500);
comment on table vppsone.fee_call_promises is
  'A parent''s promise on a call: amount and date. Insert-only. Kept or broken is computed from receipts, never stored.';
create index if not exists fee_call_promises_by_day_idx on vppsone.fee_call_promises (promised_on);
create index if not exists fee_call_promises_by_student_idx on vppsone.fee_call_promises (student_id, created_at desc);
alter table vppsone.fee_call_promises enable row level security;
create policy fee_call_promises_select on vppsone.fee_call_promises for select to authenticated
  using ((select vppsone.staff_can('fees:view')));
grant select on vppsone.fee_call_promises to authenticated;
grant select, insert on vppsone.fee_call_promises to service_role;
