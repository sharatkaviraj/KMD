-- Synthetic isolated PostgreSQL acceptance only. Execute after migration3 in
-- the caller's BEGIN...ROLLBACK; never commit this fixture or run it on Fees.
do $$
declare
  session_id uuid:='90000000-0000-4000-8000-000000000001';
  class_a uuid:='90000000-0000-4000-8000-000000000002';
  class_b uuid:='90000000-0000-4000-8000-000000000003';
  student uuid:='90000000-0000-4000-8000-000000000004';
  retired uuid:='90000000-0000-4000-8000-000000000005';
  proofs integer:=0;
begin
  if exists(select 1 from vppsone.fees_bridge_students) then raise exception 'isolated empty projection required'; end if;
  insert into vppsone.fees_bridge_sessions(id,session_label,status,is_current,fields)
    values(session_id,'2026-27','active',true,jsonb_build_object('id',session_id,'session_label','2026-27','status','active','is_current',true));
  insert into vppsone.fees_bridge_classes(id,session_label,class_name,fields)
    values(class_a,'2026-27','Synthetic A',jsonb_build_object('id',class_a,'session_label','2026-27','class_name','Synthetic A')),
          (class_b,'2026-27','Synthetic B',jsonb_build_object('id',class_b,'session_label','2026-27','class_name','Synthetic B'));
  insert into vppsone.fees_bridge_students(id,session_label,class_id,full_name,status,fields)
    values(student,'2026-27',class_a,'Synthetic student','active',jsonb_build_object('id',student,'class_id',class_a,'full_name','Synthetic student','status','active'));
  insert into vppsone.fees_bridge_retired_students(id,session_label,fields)
    values(retired,'2026-27',jsonb_build_object('id',retired,'class_id',class_a,'full_name','Retired synthetic student','status','active'));
  insert into vppsone.enrolments(student_id,class_id,session_label,status)
    values(student,class_a,'2026-27','enrolled'),(retired,class_a,'2026-27','enrolled');
  update vppsone.fees_bridge_state set enabled=true,live_read_ready=true,last_revision=1,
    last_error_code=null,last_checked_at=clock_timestamp(),as_of_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date;
  if not exists(select 1 from vppsone.fees_action_students where id=student)
    or exists(select 1 from vppsone.fees_identity_students where id=retired)
    or exists(select 1 from vppsone.fees_action_students where id=retired) then raise exception 'retired row granted current authority'; end if;
  proofs:=proofs+1;
  perform vppsone.assert_fees_bridge_roster_current(array[student],class_a,'2026-27');
  proofs:=proofs+1;
  begin
    perform vppsone.assert_fees_bridge_roster_current(array[retired],class_a,'2026-27');
    raise exception 'retired roster accepted';
  exception when raise_exception then if sqlerrm<>'bridge_academic_membership_changed' then raise; end if; end;
  proofs:=proofs+1;
  update vppsone.enrolments set class_id=class_b where student_id=student;
  if exists(select 1 from vppsone.fees_action_students where id=student) then raise exception 'transfer mismatch granted authority'; end if;
  begin
    perform vppsone.assert_fees_bridge_roster_current(array[student],class_b,'2026-27');
    raise exception 'transferred roster accepted';
  exception when raise_exception then if sqlerrm<>'bridge_academic_membership_changed' then raise; end if; end;
  proofs:=proofs+1;
  update vppsone.enrolments set class_id=class_a where student_id=student;
  update vppsone.fees_bridge_students set status='left',fields=fields||'{"status":"left"}'::jsonb where id=student;
  if exists(select 1 from vppsone.fees_action_students where id=student)
    or not exists(select 1 from vppsone.fees_identity_students where id=student) then raise exception 'left student action/history separation failed'; end if;
  proofs:=proofs+1;
  update vppsone.fees_bridge_students set status='active',fields=fields||'{"status":"active"}'::jsonb where id=student;
  update vppsone.fees_bridge_state set last_checked_at=clock_timestamp()-interval '27 hours';
  begin
    perform vppsone.assert_fees_bridge_roster_current(array[student],class_a,'2026-27');
    raise exception 'stale roster accepted';
  exception when raise_exception then if sqlerrm<>'bridge_academic_membership_changed' then raise; end if; end;
  proofs:=proofs+1;
  -- TEST intentionally retains the existing local roster policy, including
  -- historical membership, independently of real source freshness.
  perform vppsone.assert_fees_bridge_roster_current(array[retired],class_a,'TEST-2026-27');
  proofs:=proofs+1;
  if has_table_privilege('authenticated','vppsone.fees_action_students','select')
    or has_function_privilege('authenticated','vppsone.assert_fees_bridge_roster_current(uuid[],uuid,text)','execute') then raise exception 'action identities exposed directly'; end if;
  proofs:=proofs+1;
  raise notice 'Current identity proofs: %',proofs;
end;
$$;
