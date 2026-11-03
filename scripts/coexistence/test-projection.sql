-- Run only against the isolated synthetic PostgreSQL test database, after
-- loading the unapplied migration into this SAME rolled-back transaction.
do $$
declare
  snap jsonb;
  changed jsonb;
  result jsonb;
  before_receipts bigint;
  before_payments bigint;
  proof_count integer:=0;
begin
  select count(*) into before_receipts from public.receipts;
  select count(*) into before_payments from public.payments;
  snap:=jsonb_build_object('version',1,'snapshotId','00000000-0000-4000-8000-000000000005',
    'sourceProjectRef','vgqyilgstjvgohrsiwkb','revision','1','complete',true,
    'capturedAt',clock_timestamp(),'asOfDate',(clock_timestamp() at time zone 'Asia/Kolkata')::date,
    'activeSessionLabel','TEST-2026-27',
    'sessions',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-000000000001',
      'session_label','TEST-2026-27','status','active','is_current',true)),
    'classes',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-000000000002',
      'session_label','TEST-2026-27','class_name','Synthetic class')),
    'students',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-000000000003',
      'session_label','TEST-2026-27','class_id','00000000-0000-4000-8000-000000000002','full_name','Synthetic student')),
    'households',jsonb_build_array(jsonb_build_object('id','student:00000000-0000-4000-8000-000000000003',
      'session_label','TEST-2026-27')),
    'counts',jsonb_build_object('sessions',1,'classes',1,'students',1,'households',1));
  result:=vppsone.fees_bridge_apply_snapshot(snap,repeat('a',64));
  if result->>'applied'<>'true' or (select count(*) from vppsone.fees_bridge_students)<>1 then raise exception 'first apply failed'; end if;
  proof_count:=proof_count+1;
  result:=vppsone.fees_bridge_apply_snapshot(snap,repeat('a',64));
  if result->>'replayed'<>'true' or (select count(*) from vppsone.fees_bridge_runs)<>1 then raise exception 'replay failed'; end if;
  proof_count:=proof_count+1;
  begin
    perform vppsone.fees_bridge_apply_snapshot(snap,repeat('b',64));
    raise exception 'expected conflict not raised';
  exception when raise_exception then
    if sqlerrm<>'bridge_fence_payload_conflict' then raise; end if;
  end;
  proof_count:=proof_count+1;
  changed:=snap || jsonb_build_object('revision','2','snapshotId','00000000-0000-4000-8000-000000000006');
  changed:=jsonb_set(changed,'{students,0,class_id}','"00000000-0000-4000-8000-000000000099"');
  begin
    perform vppsone.fees_bridge_apply_snapshot(changed,repeat('b',64));
    raise exception 'expected orphan not raised';
  exception when foreign_key_violation then null;
  end;
  if (select last_revision from vppsone.fees_bridge_state)<>1 or
    (select class_id::text from vppsone.fees_bridge_students limit 1)<>'00000000-0000-4000-8000-000000000002' then
    raise exception 'failed generation changed current data';
  end if;
  proof_count:=proof_count+1;
  changed:=snap || jsonb_build_object('revision','2','snapshotId','00000000-0000-4000-8000-000000000006');
  perform vppsone.fees_bridge_apply_snapshot(changed,repeat('a',64));
  if (select last_revision from vppsone.fees_bridge_state)<>2 then raise exception 'unchanged data fence did not advance'; end if;
  proof_count:=proof_count+1;
  begin
    perform vppsone.fees_bridge_apply_snapshot(snap,repeat('a',64));
    raise exception 'expected stale fence not raised';
  exception when raise_exception then
    if sqlerrm<>'bridge_stale_fence' then raise; end if;
  end;
  proof_count:=proof_count+1;
  begin
    perform vppsone.fees_bridge_apply_snapshot(changed-'version',repeat('b',64));
    raise exception 'expected contract rejection not raised';
  exception when raise_exception then
    if sqlerrm<>'bridge_invalid_contract' then raise; end if;
  end;
  proof_count:=proof_count+1;
  if (select live_read_ready or enabled from vppsone.fees_bridge_state) then raise exception 'app published without identity acceptance'; end if;
  proof_count:=proof_count+1;
  if (select count(*) from public.receipts)<>before_receipts or (select count(*) from public.payments)<>before_payments then
    raise exception 'projection changed financial records';
  end if;
  proof_count:=proof_count+1;
  if has_table_privilege('authenticated','vppsone.fees_bridge_students','select') or
    has_function_privilege('anon','vppsone.fees_bridge_apply_snapshot(jsonb,text)','execute') then
    raise exception 'projection exposed directly';
  end if;
  proof_count:=proof_count+1;
  -- Equal source content still verifies typed columns used by the application,
  -- and does not silently bless a corrupted derived field.
  update vppsone.fees_bridge_students set full_name='Corrupted derived name';
  changed:=snap || jsonb_build_object('revision','3','snapshotId','00000000-0000-4000-8000-000000000007');
  begin
    perform vppsone.fees_bridge_apply_snapshot(changed,repeat('a',64));
    raise exception 'expected typed corruption rejection not raised';
  exception when raise_exception then
    if sqlerrm<>'bridge_projection_verification_failed' then raise; end if;
  end;
  update vppsone.fees_bridge_students set full_name='Synthetic student';
  proof_count:=proof_count+1;
  update vppsone.fees_bridge_students set fields=jsonb_set(fields,'{full_name}','"Corrupted payload"');
  begin
    perform vppsone.fees_bridge_apply_snapshot(changed,repeat('a',64));
    raise exception 'expected fields corruption rejection not raised';
  exception when raise_exception then
    if sqlerrm<>'bridge_projection_verification_failed' then raise; end if;
  end;
  update vppsone.fees_bridge_students set fields=jsonb_set(fields,'{full_name}','"Synthetic student"');
  proof_count:=proof_count+1;
  -- A complete replacement retires the missing display identity and does not
  -- cascade into the existing One academic or financial records.
  changed:=jsonb_set(changed,'{students,0,id}','"00000000-0000-4000-8000-000000000008"');
  perform vppsone.fees_bridge_apply_snapshot(changed,repeat('c',64));
  if not exists(select 1 from vppsone.fees_bridge_retired_students where id='00000000-0000-4000-8000-000000000003') then
    raise exception 'retired identity missing';
  end if;
  proof_count:=proof_count+1;
  changed:=snap || jsonb_build_object('revision','4','snapshotId','00000000-0000-4000-8000-000000000009');
  perform vppsone.fees_bridge_apply_snapshot(changed,repeat('a',64));
  if exists(select 1 from vppsone.fees_bridge_retired_students where id='00000000-0000-4000-8000-000000000003') then
    raise exception 'revived identity also retired';
  end if;
  proof_count:=proof_count+1;
  begin
    update vppsone.fees_bridge_state set enabled=true,live_read_ready=true where id;
    raise exception 'expected TEST publication rejection not raised';
  exception when raise_exception then
    if sqlerrm<>'bridge_test_identity_collision' then raise; end if;
  end;
  proof_count:=proof_count+1;
  raise notice 'projection SQL checks passed: %',proof_count;
end;
$$;
