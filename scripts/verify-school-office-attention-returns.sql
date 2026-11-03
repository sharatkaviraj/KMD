-- Rollback-only TEST fixtures; no real identity, source or financial mutation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
declare actor uuid; student uuid; student2 uuid; enrolment uuid; roster jsonb; r1 jsonb; r2 jsonb; snapshot jsonb;
 adapter jsonb; payload jsonb; rows jsonb; receipt jsonb; replay jsonb; source_revision text;
 batch uuid:=gen_random_uuid(); imported uuid:=gen_random_uuid(); old_import uuid:=gen_random_uuid(); apply_command uuid:=gen_random_uuid();
 namespace text:='QA-'||gen_random_uuid()::text; evidence text; checks text[]:=array[]::text[];
begin
 select id into actor from vppsone.staff_profiles where is_active and is_test_account and role='office' and user_id is not null order by id limit 1;
 roster:=vppsone.school_office_roster(actor,'TEST-2026-27','government:import',true);
 select value into r1 from jsonb_array_elements(roster) where value->>'identityVerified'='true' order by value->>'studentId' limit 1;
 select value into r2 from jsonb_array_elements(roster) where value->>'identityVerified'='true' and value->>'studentId'<>r1->>'studentId' order by value->>'studentId' limit 1;
 student:=(r1->>'studentId')::uuid; student2:=(r2->>'studentId')::uuid;
 select id into enrolment from vppsone.enrolments where student_id=student and session_label='TEST-2026-27' and status='enrolled' and left_on is null order by created_at desc limit 1;
 if actor is null or enrolment is null or student2 is null then raise exception 'Verified existing TEST actors and enrolments required'; end if;
 perform vppsone.school_certificate_attention_record(actor,student,'TEST-2026-27',array['identity:identity_unverified'],true);
 update vppsone.enrolments set status='left',left_on=null where id=enrolment and session_label='TEST-2026-27';
 snapshot:=vppsone.school_office_attention(actor,'TEST-2026-27',true);
 if not exists(select 1 from jsonb_array_elements(snapshot->'certificate_candidates') x where x->>'student_id'=student::text) then raise exception 'Unresolved attention missing'; end if;
 update vppsone.enrolments set status='enrolled' where id=enrolment and session_label='TEST-2026-27';
 snapshot:=vppsone.school_office_attention(actor,'TEST-2026-27',true);
 if exists(select 1 from jsonb_array_elements(snapshot->'certificate_candidates') x where x->>'student_id'=student::text) then raise exception 'Resolved blocker still actionable'; end if;
 if not exists(select 1 from vppsone.school_certificate_attention where student_id=student and session_label='TEST-2026-27') then raise exception 'Read wrote attention'; end if;
 perform vppsone.school_certificate_attention_clear(actor,student,'TEST-2026-27',true);
 if exists(select 1 from vppsone.school_certificate_attention where student_id=student and session_label='TEST-2026-27') then raise exception 'Clear failed'; end if;
 checks:=array_append(checks,'attention record/current recheck/clear; resolved logs hidden without GET writes');
 -- Refresh the TEST source fence after the rolled-back fixture enrolment edits.
 roster:=vppsone.school_office_roster(actor,'TEST-2026-27','government:import',true); source_revision:=roster->0->>'sourceRevision';
 select value into r1 from jsonb_array_elements(roster) where value->>'studentId'=student::text;
 select value into r2 from jsonb_array_elements(roster) where value->>'studentId'=student2::text;
 rows:=jsonb_build_array(r1,r2);
 adapter:=jsonb_build_object('portal','psp','module',namespace,'sessionLabel','TEST-2026-27','schoolCode','QA','version',1,'mode','verified_upload','sourceReference','Synthetic supported fixture only','specimenSha256',repeat('9',64));
 insert into vppsone.school_return_adapters(portal,module,session_label,school_code,version,adapter,approved_by)
 values('psp',namespace,'TEST-2026-27','QA',1,adapter,actor);
 perform vppsone.school_return_reserve(actor,batch,repeat('1',64),adapter,jsonb_build_object('rows',rows,'sourceRevision',source_revision,'counts',jsonb_build_object('ready',2)),'export',null,null,true);
 perform vppsone.school_return_finish(actor,batch,'batches/'||batch::text||'/fixture.csv',repeat('2',64),'fixture.csv','text/csv',true);
 payload:=jsonb_build_object('preview',jsonb_build_array(jsonb_build_object('studentId',student,'state','ready','changes',jsonb_build_object('externalId','000017','registrationStatus','verified'),'expectedRevision',0,'sourceRevision',source_revision),
  jsonb_build_object('studentId',student2,'state','unchanged','changes','{}'::jsonb,'expectedRevision',0,'sourceRevision',source_revision)),'sourceRevision',source_revision,'counts',jsonb_build_object('ready',1,'unchanged',1));
 perform vppsone.school_return_reserve(actor,imported,repeat('3',64),adapter,payload,'import',repeat('4',64),batch,true);
 perform vppsone.school_return_finish(actor,imported,'batches/'||imported::text||'/returned.csv',repeat('4',64),'returned.csv','text/csv',true);
 receipt:=vppsone.school_return_apply(actor,imported,apply_command,2,true);
 replay:=vppsone.school_return_apply(actor,imported,apply_command,2,true);
 if receipt<>replay or receipt->>'applied'<>'1' or receipt->>'unchanged'<>'1' then raise exception 'Apply/replay mismatch'; end if;
 if (select external_id from vppsone.school_external_records where portal='psp' and module=namespace and student_id=student)<>'000017' then raise exception 'External text identifier lost'; end if;
 checks:=array_append(checks,'verified returned-file apply preserves leading zeros; unchanged rows and replay');
 -- Older conflicted preview is suppressed by the newer applied import.
 insert into vppsone.school_return_batches(id,session_label,portal,module,direction,state,actor_id,request_hash,adapter,payload,parent_batch_id,created_at)
 values(old_import,'TEST-2026-27','psp',namespace,'import','staged',actor,repeat('5',64),adapter,jsonb_build_object('preview',jsonb_build_array(jsonb_build_object('state','conflict'))),batch,now()-interval '1 hour');
 snapshot:=vppsone.school_office_attention(actor,'TEST-2026-27',true);
 if exists(select 1 from jsonb_array_elements(snapshot->'return_batches') x where x->>'id'=old_import::text) then raise exception 'Old conflict survived newer applied import'; end if;
 checks:=array_append(checks,'latest applied import suppresses older conflicted preview');
 perform vppsone.school_return_outcome(actor,batch,2,'submitted','Synthetic submission acknowledgement',null,null,null,null,'[]'::jsonb,true);
 if (select state from vppsone.school_return_batches where id=batch)<>'submitted' then raise exception 'Submission state wrong'; end if;
 begin
  perform vppsone.school_return_outcome(actor,batch,3,'accepted','Synthetic outcome with no evidence',null,null,null,null,jsonb_build_array(jsonb_build_object('studentId',student,'state','accepted'),jsonb_build_object('studentId',student2,'state','accepted')),true);
  raise exception 'Expected evidence refusal';
 exception when raise_exception then if sqlerrm<>'office:evidence_required' then raise; end if; end;
 evidence:='evidence/'||batch::text||'/synthetic-rollback.pdf';
 insert into storage.objects(bucket_id,name,metadata) values('vppsone-school-office',evidence,jsonb_build_object('mimetype','application/pdf','size',100));
 perform vppsone.school_return_outcome(actor,batch,3,'partially_accepted','Synthetic partial acceptance acknowledgement',evidence,repeat('6',64),'synthetic.pdf','application/pdf',
  jsonb_build_array(jsonb_build_object('studentId',student,'state','accepted'),jsonb_build_object('studentId',student2,'state','not_accepted')),true);
 if (select state from vppsone.school_return_batches where id=batch)<>'partially_accepted' then raise exception 'Partial acceptance lost'; end if;
 begin
  perform vppsone.school_return_outcome(actor,batch,4,'accepted','Synthetic invalid complete acceptance',evidence,repeat('6',64),'synthetic.pdf','application/pdf',
   jsonb_build_array(jsonb_build_object('studentId',student,'state','accepted'),jsonb_build_object('studentId',student2,'state','not_accepted')),true);
  raise exception 'Expected row outcome refusal';
 exception when raise_exception then if sqlerrm<>'office:invalid_outcome' then raise; end if; end;
 checks:=array_append(checks,'submission/partial acceptance distinguished; evidence and exact row outcome required');
 perform set_config('vppsone.school_office_attention_checks',array_to_json(checks)::text,true);
end; $$;
select current_setting('vppsone.school_office_attention_checks')::jsonb as rollback_checks;
rollback;
