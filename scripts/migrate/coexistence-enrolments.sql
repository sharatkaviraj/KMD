-- Reusable missing-only academic bootstrap, called in the same transaction as
-- an accepted bridge generation, AFTER fees_bridge_state is updated. This is
-- deliberately not the legacy rebuild: existing enrolments are One-owned
-- history and are never updated/deleted, including transfers and leavers.
-- Install via the reviewed bridge migration; do not run standalone on Fees.
create or replace function vppsone.bootstrap_fees_bridge_enrolments(p_snapshot_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare inserted integer; projection_enabled boolean;
begin
  select enabled into projection_enabled from vppsone.fees_bridge_state
  where snapshot_id=p_snapshot_id and last_error_code is null;
  if p_snapshot_id is null or not found then
    raise exception 'bridge_enrolment_generation_mismatch';
  end if;
  -- Shadow bootstrap is validated before the operator enables live academics.
  if not projection_enabled then return 0; end if;
  insert into vppsone.enrolments
    (student_id,class_id,session_label,roll_no,status,enrolled_on,left_on)
  select s.id,s.class_id,s.session_label,s.roll_no,
    case when s.status='left' then 'left'::vppsone.enrolment_status
         else 'enrolled'::vppsone.enrolment_status end,
    s.joined_on,case when s.status='left' then s.left_on else null end
  from vppsone.fees_bridge_students s
  join vppsone.fees_bridge_classes c on c.id=s.class_id and c.session_label=s.session_label
  join vppsone.fees_bridge_sessions ss on ss.session_label=s.session_label
  where not vppsone.is_test_session_label(s.session_label)
    and s.status in ('active','left')
  on conflict (student_id,session_label) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
revoke all on function vppsone.bootstrap_fees_bridge_enrolments(uuid) from public,anon,authenticated;
grant execute on function vppsone.bootstrap_fees_bridge_enrolments(uuid) to service_role;
