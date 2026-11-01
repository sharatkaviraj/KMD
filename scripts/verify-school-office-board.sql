-- ROOT EXECUTION ONLY. Rollback-only synthetic board regression checks.
-- Existing TEST identities only. The sole student update targets a checked
-- TEST-2026-27 public.students row in One's local TEST engine and is rolled back.
-- No real pupil names or identifiers are selected as output. No provider calls.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
<<board_check>>
declare actor uuid; teacher uuid; real_actor uuid; student uuid; class_id uuid;
 cycle_id uuid:=gen_random_uuid(); result_command uuid:=gen_random_uuid(); correction_command uuid:=gen_random_uuid();
 source jsonb; pupil jsonb; config jsonb; registration jsonb; original jsonb; corrected jsonb; replay jsonb; payload jsonb; snapshot jsonb;
 old_source text; current_source text; touched integer; n integer; checks text[]:=array[]::text[];
begin
 select sp.id into actor from vppsone.staff_profiles sp
  where sp.is_active and sp.is_test_account and sp.role in('admin','exam_coordinator')
   and exists(select 1 from vppsone.role_permissions rp where rp.role=sp.role and rp.permission='outcomes:manage') order by sp.id limit 1;
 select id into teacher from vppsone.staff_profiles where is_active and is_test_account and role='teacher' order by id limit 1;
 if actor is null or teacher is null then raise exception 'Existing TEST outcome manager and teacher required'; end if;
 source:=vppsone.school_board_source(actor,'TEST-2026-27','outcomes:manage',true);
 select value into pupil from jsonb_array_elements(source->'roster') where value->>'identityVerified'='true' order by value->>'studentId' limit 1;
 student:=(pupil->>'studentId')::uuid; class_id:=(pupil->>'classId')::uuid; old_source:=source->>'sourceRevision';
 if student is null or class_id is null then raise exception 'Existing verified TEST pupil required'; end if;
 if not exists(select 1 from public.students s join public.classes c on c.id=s.class_id where s.id=student and c.session_label='TEST-2026-27') then raise exception 'TEST source fence failed'; end if;
 config:=jsonb_build_object('authority','class5','label','Synthetic board regression','sessionLabel','TEST-2026-27','attempt','main','attemptLabel','Synthetic main',
  'classIds',jsonb_build_array(class_id::text),'subjects',jsonb_build_array(jsonb_build_object('code','001','label','Synthetic subject')),
  'requirements',jsonb_build_array(jsonb_build_object('key','photo','label','Synthetic evidence','required',true)),
  'sourceReference','Synthetic current circular for rollback checks','verifiedOn',((now() at time zone 'Asia/Kolkata')::date)::text,'responsible','Synthetic coordinator','deadline',null);
 perform vppsone.school_board_command(actor,gen_random_uuid(),cycle_id,'cycle',jsonb_build_object('config',config,'expectedRevision',0),repeat('1',64),true);
 registration:=vppsone.school_board_command(actor,gen_random_uuid(),cycle_id,'candidate',jsonb_build_object('studentId',student,'registration','SYN-'||cycle_id::text,'roll','SYN-'||cycle_id::text,'subjects',jsonb_build_array('001'),'verified',true,'sourceReference','Synthetic registration authority evidence','expectedRevision',0,'cycleRevision',1,'expectedSource',old_source),repeat('2',64),true);
 snapshot:=registration->'student_snapshot';
 if snapshot->>'studentId' is distinct from student::text or snapshot->>'studentName' is distinct from pupil->>'studentName'
  or snapshot->>'classId' is distinct from class_id::text or snapshot->>'classLabel' is distinct from pupil->>'classLabel'
  or snapshot->>'enrolmentStatus'<>'enrolled' or snapshot->>'sourceRevision' is distinct from old_source then raise exception 'Registration snapshot mismatch'; end if;
 payload:=jsonb_build_object('studentId',student,'subjectCode','001','status','available','rawValue','0','rawStatus','SYNTHETIC FAIL','appearance','appeared','sourceReference','Synthetic authority-issued outcome evidence','expectedRevision',0,'candidateRevision',1,'cycleRevision',1,'expectedSource',old_source,'evidence',null);
 original:=vppsone.school_board_command(actor,result_command,cycle_id,'result',payload,repeat('3',64),true);
 if original->>'raw_value'<>'0' then raise exception 'Exact zero lost'; end if;
 checks:=array_append(checks,'verified candidate snapshot and exact zero recorded');

 update public.students s set status='left'
  where s.id=student and exists(select 1 from public.classes c where c.id=s.class_id and c.session_label='TEST-2026-27');
 get diagnostics touched=row_count;
 if touched<>1 then raise exception 'Expected one TEST source row'; end if;
 source:=vppsone.school_board_source(actor,'TEST-2026-27','outcomes:manage',true); current_source:=source->>'sourceRevision';
 if exists(select 1 from jsonb_array_elements(source->'roster') r where r->>'studentId'=student::text) or current_source=old_source then raise exception 'TEST departure did not change current source fence'; end if;
 payload:=payload||jsonb_build_object('expectedRevision',1,'expectedSource',current_source,'rawValue','01','rawStatus','SYNTHETIC CORRECTED');
 corrected:=vppsone.school_board_command(actor,correction_command,cycle_id,'result',payload,repeat('4',64),true);
 replay:=vppsone.school_board_command(actor,correction_command,cycle_id,'result',payload,repeat('4',64),true);
 if corrected->>'revision'<>'2' or corrected->>'supersedes' is distinct from original->>'id' or corrected->>'raw_value'<>'01' or replay->>'id' is distinct from corrected->>'id' then raise exception 'Departed correction/replay mismatch'; end if;
 if (select student_snapshot from vppsone.school_board_candidates where school_board_candidates.cycle_id=board_check.cycle_id) is distinct from snapshot then raise exception 'Snapshot changed'; end if;
 perform vppsone.school_board_command(actor,gen_random_uuid(),cycle_id,'readiness',jsonb_build_object('studentId',student,'key','photo','status','accepted','reference','Synthetic official acknowledgement','expectedRevision',0,'cycleRevision',1,'expectedSource',current_source),repeat('5',64),true);
 checks:=array_append(checks,'departed registered pupil can receive exact superseding outcome and readiness; replay unchanged');

 begin
  perform vppsone.school_board_command(actor,gen_random_uuid(),cycle_id,'candidate',jsonb_build_object('studentId',student,'registration','changed','roll','changed','subjects',jsonb_build_array('001'),'verified',true,'sourceReference','Synthetic changed registration source','expectedRevision',1,'cycleRevision',1,'expectedSource',current_source),repeat('6',64),true);
  raise exception 'Expected departed registration refusal';
 exception when raise_exception then if sqlerrm<>'board:identity' then raise; end if; end;
 begin
  perform vppsone.school_board_command(actor,gen_random_uuid(),cycle_id,'result',payload||jsonb_build_object('studentId',gen_random_uuid(),'expectedRevision',0),repeat('7',64),true);
  raise exception 'Expected unknown identity refusal';
 exception when raise_exception then if sqlerrm<>'board:identity' then raise; end if; end;
 begin
  perform vppsone.school_board_command(actor,gen_random_uuid(),cycle_id,'result',payload||jsonb_build_object('subjectCode','999','expectedRevision',0),repeat('8',64),true);
  raise exception 'Expected subject-scope refusal';
 exception when raise_exception then if sqlerrm<>'board:registration' then raise; end if; end;
 begin
  perform vppsone.school_board_command(actor,gen_random_uuid(),cycle_id,'result',payload||jsonb_build_object('expectedSource',old_source,'expectedRevision',2),repeat('9',64),true);
  raise exception 'Expected stale source refusal';
 exception when raise_exception then if sqlerrm<>'board:source_changed' then raise; end if; end;
 checks:=array_append(checks,'departure grants no registration edit, unknown identity, subject expansion or stale source write');

 begin
  update vppsone.school_board_candidates set student_snapshot=student_snapshot||jsonb_build_object('studentName','Synthetic changed identity') where school_board_candidates.cycle_id=board_check.cycle_id;
  raise exception 'Expected immutable candidate snapshot refusal';
 exception when raise_exception then if sqlerrm<>'board:snapshot_immutable' then raise; end if; end;
 begin
  update vppsone.school_official_results set raw_value='changed' where id=(original->>'id')::uuid;
  raise exception 'Expected immutable outcome refusal';
 exception when raise_exception then if sqlerrm<>'board:immutable' then raise; end if; end;
 source:=vppsone.school_board_source(actor,'TEST-9898-99','outcomes:manage',true);
 if source->'roster'<>'[]'::jsonb or source->>'sourceRevision'<>'test:'||md5('') then raise exception 'Empty TEST source revision mismatch'; end if;
 checks:=array_append(checks,'snapshot/outcome immutable and empty TEST source fence coherent');
 if has_function_privilege('authenticated','vppsone.school_board_command(uuid,uuid,uuid,text,jsonb,text,boolean)','execute')
  or has_function_privilege('authenticated','vppsone.school_board_source(uuid,text,text,boolean)','execute')
  or has_table_privilege('authenticated','vppsone.school_official_results','insert')
  or not has_table_privilege('authenticated','vppsone.school_official_results','select') then raise exception 'Board grant boundary failed'; end if;
 begin
  perform vppsone.school_board_source(teacher,'TEST-2026-27','outcomes:manage',true);
  raise exception 'Expected teacher refusal';
 exception when raise_exception then if sqlerrm<>'office:forbidden' then raise; end if; end;
 checks:=array_append(checks,'teacher and authenticated-write privileges denied');

 -- Metadata-only failure injections below each roll back in their exception
 -- subtransaction. No real student row is read or written by these failures.
 select id into real_actor from vppsone.staff_profiles where is_active and not is_test_account and role='admin' order by id limit 1;
 if real_actor is null then raise exception 'Existing real admin required for freshness-gate check'; end if;
 for n in 1..3 loop
  begin
   if n=1 then update vppsone.fees_bridge_state set enabled=false where id;
   elsif n=2 then update vppsone.fees_bridge_state set last_checked_at=now()-interval '1 hour' where id;
   else update vppsone.fees_bridge_state set last_error_code='synthetic_rollback_only' where id; end if;
   perform vppsone.school_board_source(real_actor,'2026-27','outcomes:manage',false);
   raise exception 'Expected board source outage refusal';
  exception when raise_exception then if sqlerrm<>'office:source_unavailable' then raise; end if; end;
 end loop;
 checks:=array_append(checks,'disabled stale errored live source remains fail closed');
 perform set_config('vppsone.school_board_checks',array_to_json(checks)::text,true);
end; $$;
select current_setting('vppsone.school_board_checks')::jsonb as rollback_checks;
rollback;
