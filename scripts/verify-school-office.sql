-- Rollback-only School Office regression checks. One production database only;
-- all document/return fixtures belong to existing TEST actors and TEST students.
-- No source/financial/provider writes. Bridge-failure checks use subtransactions
-- and never publish the temporary flag values to another transaction.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
declare actor uuid; teacher uuid; actor_user uuid; student uuid; student2 uuid; real_actor uuid;
 facts jsonb; a jsonb; b jsonb; replay jsonb; roster jsonb; r1 jsonb; r2 jsonb; adapter jsonb; preview jsonb;
 command uuid:=gen_random_uuid(); reprint_command uuid:=gen_random_uuid(); issue_a uuid; issue_b uuid;
 batch uuid:=gen_random_uuid(); imported uuid:=gen_random_uuid(); namespace text:='QA-'||gen_random_uuid()::text;
 source_revision text; path text; n bigint; checks text[]:=array[]::text[];
begin
 if (select environment from vppsone.deployment limit 1)<>'production' then raise exception 'Expected verified One production marker'; end if;
 select id,user_id into actor,actor_user from vppsone.staff_profiles where is_active and is_test_account and role='office' and user_id is not null order by id limit 1;
 select id into teacher from vppsone.staff_profiles where is_active and is_test_account and role='teacher' order by id limit 1;
 if actor is null or teacher is null then raise exception 'Existing TEST office/teacher profiles required'; end if;
 perform set_config('vppsone.qa_office_user',actor_user::text,true);
 roster:=vppsone.school_office_roster(actor,'TEST-2026-27','government:import',true);
 select value into r1 from jsonb_array_elements(roster) where value->>'identityVerified'='true' order by value->>'studentId' limit 1;
 select value into r2 from jsonb_array_elements(roster) where value->>'identityVerified'='true' and value->>'studentId'<>r1->>'studentId' order by value->>'studentId' limit 1;
 student:=(r1->>'studentId')::uuid; student2:=(r2->>'studentId')::uuid; source_revision:=r1->>'sourceRevision';
 if student is null or student2 is null then raise exception 'Two verified existing TEST enrolments required'; end if;
 facts:=vppsone.school_certificate_facts(actor,student,'TEST-2026-27',true);
 if facts->>'identityVerified'<>'true' or facts->>'sourceCurrent'<>'true' then raise exception 'TEST facts unavailable'; end if;
 a:=vppsone.school_certificate_reserve(actor,student,'TEST-2026-27',command,repeat('a',64),facts,jsonb_build_object('name','Synthetic QA School'),1,true,null,null,true);
 issue_a:=(a->'issue'->>'id')::uuid;
 if a->'issue'->>'serial' not like 'TEST/VPPS/STUDY/TEST-2026-27/%' then raise exception 'Missing TEST numbering'; end if;
 replay:=vppsone.school_certificate_reserve(actor,student,'TEST-2026-27',command,repeat('a',64),null,null,0,true,null,null,true);
 if replay->'issue'->>'id'<>issue_a::text then raise exception 'Replay allocated another issue'; end if;
 checks:=array_append(checks,'certificate reservation replay keeps serial and snapshot');
 b:=vppsone.school_certificate_reserve(actor,student,'TEST-2026-27',gen_random_uuid(),repeat('b',64),facts,jsonb_build_object('name','Synthetic QA School'),1,true,null,null,true);
 issue_b:=(b->'issue'->>'id')::uuid;
 replay:=vppsone.school_certificate_current(actor,student,'TEST-2026-27',gen_random_uuid(),repeat('c',64),true,issue_a);
 if replay->>'id'<>issue_a::text or issue_a=issue_b then raise exception 'Exact recovery selected newer issue'; end if;
 checks:=array_append(checks,'recovery selects displayed reserved issue with newer issue present');
 replay:=vppsone.school_certificate_current(actor,student,'TEST-2026-27',reprint_command,repeat('d',64),true,null);
 update vppsone.school_certificate_issues set status='cancelled' where id=(replay->>'id')::uuid;
 if (vppsone.school_certificate_current(actor,student,'TEST-2026-27',reprint_command,repeat('d',64),true,null)->>'id') is distinct from replay->>'id' then raise exception 'Delayed reprint retry changed issue'; end if;
 checks:=array_append(checks,'reprint receipt survives subsequent cancellation');
 begin
  update vppsone.school_certificate_issues set snapshot=snapshot||'{"serial":"altered"}'::jsonb where id=issue_a;
  raise exception 'Expected immutable snapshot refusal';
 exception when raise_exception then if sqlerrm<>'certificate:immutable' then raise; end if; end;
 path:='certificates/TEST-2026-27/'||student::text||'/'||issue_a::text||'.pdf';
 perform vppsone.school_certificate_finish(actor,issue_a,path,repeat('e',64),100,true);
 perform vppsone.school_certificate_finish(actor,issue_a,path,repeat('e',64),100,true);
 begin
  perform vppsone.school_certificate_finish(actor,issue_a,path,repeat('f',64),101,true);
  raise exception 'Expected immutable artifact refusal';
 exception when raise_exception then if sqlerrm<>'certificate:artifact_immutable' then raise; end if; end;
 checks:=array_append(checks,'snapshot and completed artifact immutable; finish retry idempotent');
 if vppsone.school_office_actor_allowed(actor,'certificates:issue','2026-27',true)
  or vppsone.school_office_actor_allowed(teacher,'certificates:issue','TEST-2026-27',true)
  or vppsone.school_office_actor_allowed(actor,'certificates:manage','TEST-2026-27',true) then raise exception 'TEST/role fence failed'; end if;
 checks:=array_append(checks,'TEST session, teacher and certificate-management fences');
 select id into real_actor from vppsone.staff_profiles where is_active and not is_test_account and role='admin' order by id limit 1;
 if real_actor is null then raise exception 'Existing real administrator required for source-gate check'; end if;
 for n in 1..3 loop
  begin
   if n=1 then update vppsone.fees_bridge_state set enabled=false where id;
   elsif n=2 then update vppsone.fees_bridge_state set last_checked_at=now()-interval '1 hour' where id;
   else update vppsone.fees_bridge_state set last_error_code='qa_rollback_only' where id; end if;
   perform vppsone.school_certificate_facts(real_actor,gen_random_uuid(),'2026-27',false);
   raise exception 'Expected source failure';
  exception when raise_exception then if sqlerrm<>'certificate:source_unavailable' then raise; end if; end;
 end loop;
 checks:=array_append(checks,'real new issue refuses disabled stale and errored bridge');
 adapter:=jsonb_build_object('portal','psp','module',namespace,'sessionLabel','TEST-2026-27','schoolCode','QA','version',1,'mode','manual_reference');
 a:=vppsone.school_return_reserve(actor,batch,repeat('1',64),adapter,jsonb_build_object('rows',jsonb_build_array(r1,r2),'sourceRevision',source_revision,'counts',jsonb_build_object('ready',2)),'export',null,null,true);
 perform vppsone.school_return_finish(actor,batch,'batches/'||batch::text||'/reference.csv',repeat('2',64),'reference.csv','text/csv',true);
 if (select state from vppsone.school_return_batches where id=batch)<>'exported' then raise exception 'Export incorrectly submitted'; end if;
 checks:=array_append(checks,'prepared reference file is not portal submission or acceptance');
 -- A service fixture bypasses format configuration only inside this rollback.
 -- The command under test must still check every preview revision.
 insert into vppsone.school_external_records(portal,module,school_code,session_label,student_id,external_id,updated_by)
 values('psp',namespace,'QA','TEST-2026-27',student,'QA-A',actor),('psp',namespace,'QA','TEST-2026-27',student2,'QA-B',actor);
 preview:=jsonb_build_array(jsonb_build_object('studentId',student,'state','ready','changes',jsonb_build_object('registrationStatus','verified'),'expectedRevision',1,'sourceRevision',source_revision),
  jsonb_build_object('studentId',student2,'state','unchanged','changes','{}'::jsonb,'expectedRevision',1,'sourceRevision',source_revision));
 insert into vppsone.school_return_batches(id,session_label,portal,module,direction,state,actor_id,request_hash,adapter,payload,file_path,parent_batch_id)
 values(imported,'TEST-2026-27','psp',namespace,'import','staged',actor,repeat('3',64),adapter,jsonb_build_object('preview',preview,'sourceRevision',source_revision),'batches/'||imported::text||'/returned.csv',batch);
 update vppsone.school_external_records set revision=2 where portal='psp' and module=namespace and student_id=student2;
 begin
  perform vppsone.school_return_apply(actor,imported,gen_random_uuid(),1,true);
  raise exception 'Expected unchanged-row revision refusal';
 exception when raise_exception then if sqlerrm<>'office:stale_preview' then raise; end if; end;
 if (select registration_status from vppsone.school_external_records where portal='psp' and module=namespace and student_id=student) is not null then raise exception 'Failed preview partially applied'; end if;
 checks:=array_append(checks,'stale unchanged row rejects entire import without partial mutation');
 perform set_config('vppsone.school_office_checks',array_to_json(checks)::text,true);
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('vppsone.qa_office_user'),true);
do $$ begin
 if not exists(select 1 from vppsone.school_certificate_issues where session_label='TEST-2026-27') then raise exception 'Office RLS hid own TEST records'; end if;
 if exists(select 1 from vppsone.school_certificate_issues where session_label='2026-27') then raise exception 'TEST reader saw real certificate'; end if;
 begin
  perform vppsone.school_certificate_facts(gen_random_uuid(),gen_random_uuid(),'TEST-2026-27',true);
  raise exception 'Expected direct RPC denial';
 exception when insufficient_privilege then null; end;
 begin
  delete from vppsone.school_certificate_issues where session_label='TEST-2026-27';
  raise exception 'Expected direct table write denial';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select jsonb_build_object('rollback_only',true,'checks',current_setting('vppsone.school_office_checks')::jsonb||'["authenticated TEST SELECT scoped; direct RPC and table writes denied"]'::jsonb) as school_office_verification;
rollback;
