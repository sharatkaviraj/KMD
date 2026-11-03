-- School Office, second pass: several school document kinds, each with its own
-- approved template, series and reprint-first rule; a verification code frozen
-- into every new issue; and a minimal public check. No financial mutation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Kinds the school issues itself. A TC is a document kind here; changing a
-- student's status to left stays with the existing leaving workflow.
alter table vppsone.school_certificate_templates
  add column kind text not null default 'study' check (kind in ('study','character','dob','tc'));
alter table vppsone.school_certificate_templates
  add constraint school_certificate_template_kind_matches check (coalesce(template->>'kind','study')=kind);
drop index vppsone.school_certificate_template_active;
create unique index school_certificate_template_active_kind on vppsone.school_certificate_templates(kind) where active;

alter table vppsone.school_certificate_issues
  add column kind text not null default 'study' check (kind in ('study','character','dob','tc')),
  add column verify_code text generated always as (snapshot->>'verifyCode') stored;
alter table vppsone.school_certificate_issues
  add constraint school_certificate_issue_kind_matches check (coalesce(snapshot->>'kind','study')=kind),
  add constraint school_certificate_verify_code_shape check (verify_code is null or verify_code ~ '^[a-f0-9]{16}$');
create unique index school_certificate_verify_code on vppsone.school_certificate_issues(verify_code) where verify_code is not null;
create index school_certificate_student_kind on vppsone.school_certificate_issues(student_id,session_label,kind,issued_at desc);
create index school_certificate_tray on vppsone.school_certificate_issues(session_label,issued_at desc) where status='prepared' and artifact_state='ready';

create or replace function vppsone.school_certificate_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'certificate:immutable'; end if;
 if new.snapshot is distinct from old.snapshot or new.serial<>old.serial or new.student_id<>old.student_id
   or new.session_label<>old.session_label or new.enrolment_id<>old.enrolment_id or new.template_version<>old.template_version
   or new.issued_at<>old.issued_at or new.issued_by<>old.issued_by or new.supersedes is distinct from old.supersedes
   or new.reason is distinct from old.reason or new.kind<>old.kind then raise exception 'certificate:immutable'; end if;
 if old.artifact_state='ready' and (new.artifact_state<>old.artifact_state or new.storage_path is distinct from old.storage_path
    or new.artifact_sha256 is distinct from old.artifact_sha256 or new.artifact_bytes is distinct from old.artifact_bytes) then
   raise exception 'certificate:artifact_immutable'; end if;
 if new.status<>old.status and not (old.status='prepared' and new.status in('issued','superseded','cancelled')
   or old.status='issued' and new.status in('superseded','cancelled')) then raise exception 'certificate:invalid_transition'; end if;
 return new;
end;
$$;

-- Default wording for the three new kinds, active from the start so the office
-- can use them; every later edit is a new version under the existing manage rule.
insert into vppsone.school_certificate_templates(version,kind,active,approved_via,template)
select v.version, v.kind, true, 'default wording, School Office second pass 2026-11-03', v.template||jsonb_build_object('version',v.version,'kind',v.kind)
from (values
 ((select coalesce(max(version),0)+1 from vppsone.school_certificate_templates),'character',jsonb_build_object(
   'active',true,'titleEn','Character Certificate','titleHi','चरित्र प्रमाण पत्र',
   'bodyEn','This is to certify that {studentName}, {sonDaughter} of {fatherName}, admission/SR number {admissionNo}, has been a student of this school in Class {classLabel} during academic session {sessionLabel}. To the best of my knowledge {heShe} bears {conduct} moral character. I wish {himHer} every success in life.',
   'bodyHi','प्रमाणित किया जाता है कि {studentName}, {putraPutri} श्री {fatherName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} में इस विद्यालय की कक्षा {classLabel} के विद्यार्थी रहे हैं। मेरी जानकारी के अनुसार इनका चरित्र {conduct} है। इनके उज्ज्वल भविष्य के लिए शुभकामनाएँ।',
   'historicalBodyEn','This is to certify that {studentName}, {sonDaughter} of {fatherName}, admission/SR number {admissionNo}, was a student of this school in Class {classLabel} during academic session {sessionLabel}. To the best of my knowledge {heShe} bears {conduct} moral character. I wish {himHer} every success in life.',
   'historicalBodyHi','प्रमाणित किया जाता है कि {studentName}, {putraPutri} श्री {fatherName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} में इस विद्यालय की कक्षा {classLabel} के विद्यार्थी रहे हैं। मेरी जानकारी के अनुसार इनका चरित्र {conduct} है। इनके उज्ज्वल भविष्य के लिए शुभकामनाएँ।',
   'requiredFields',jsonb_build_array('studentName','fatherName','admissionNo','classLabel','sessionLabel'),
   'detailRows',jsonb_build_array(),'language','en','prefix','VPPS/CC','signaturePolicy','manual')),
 ((select coalesce(max(version),0)+2 from vppsone.school_certificate_templates),'dob',jsonb_build_object(
   'active',true,'titleEn','Date of Birth Certificate','titleHi','जन्म तिथि प्रमाण पत्र',
   'bodyEn','This is to certify that, as recorded in the Scholar''s Register of this school, the date of birth of {studentName}, {sonDaughter} of {fatherName}, admission/SR number {admissionNo}, is {dateOfBirth} ({dateOfBirthWords}).',
   'bodyHi','प्रमाणित किया जाता है कि इस विद्यालय की छात्र पंजिका (एसआर) के अनुसार {studentName}, {putraPutri} श्री {fatherName}, प्रवेश/एसआर संख्या {admissionNo}, की जन्म तिथि {dateOfBirth} ({dateOfBirthWords}) है।',
   'historicalBodyEn','This is to certify that, as recorded in the Scholar''s Register of this school, the date of birth of {studentName}, {sonDaughter} of {fatherName}, admission/SR number {admissionNo}, is {dateOfBirth} ({dateOfBirthWords}).',
   'historicalBodyHi','प्रमाणित किया जाता है कि इस विद्यालय की छात्र पंजिका (एसआर) के अनुसार {studentName}, {putraPutri} श्री {fatherName}, प्रवेश/एसआर संख्या {admissionNo}, की जन्म तिथि {dateOfBirth} ({dateOfBirthWords}) है।',
   'requiredFields',jsonb_build_array('studentName','fatherName','admissionNo','dateOfBirth'),
   'detailRows',jsonb_build_array(),'language','en','prefix','VPPS/DOB','signaturePolicy','manual')),
 ((select coalesce(max(version),0)+3 from vppsone.school_certificate_templates),'tc',jsonb_build_object(
   'active',true,'titleEn','Transfer Certificate','titleHi','स्थानांतरण प्रमाण पत्र',
   'bodyEn','Certified that the particulars given below are as recorded in the Scholar''s Register of {schoolName}.',
   'bodyHi','प्रमाणित किया जाता है कि नीचे दिया गया विवरण {schoolName} की छात्र पंजिका के अनुसार है।',
   'historicalBodyEn','Certified that the particulars given below are as recorded in the Scholar''s Register of {schoolName}.',
   'historicalBodyHi','प्रमाणित किया जाता है कि नीचे दिया गया विवरण {schoolName} की छात्र पंजिका के अनुसार है।',
   'requiredFields',jsonb_build_array('studentName','fatherName','admissionNo','dateOfBirth','classLabel','leftOn'),
   'detailRows',jsonb_build_array('studentName','fatherName','motherName','dateOfBirth','dateOfBirthWords','admissionNo','admittedOn','classLabel','sessionLabel','lastResult','leftOn','reasonForLeaving','conduct','remarks'),
   'language','en','prefix','VPPS/TC','signaturePolicy','manual'))
) as v(version,kind,template);

-- Facts for one kind. Optional personal facts are returned only when that
-- kind's active template mentions them anywhere (body, detail rows or required).
create function vppsone.school_certificate_facts_v2(p_actor uuid,p_student uuid,p_session text,p_kind text,p_confined boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare e vppsone.enrolments; s jsonb; c jsonb; t jsonb; current_record boolean; verified boolean; mentioned text;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if p_kind not in ('study','character','dob','tc') then raise exception 'certificate:invalid_kind'; end if;
 if not vppsone.is_test_session(p_session) and not exists(select 1 from vppsone.fees_bridge_state where id and enabled and live_read_ready and last_error_code is null and last_checked_at>=clock_timestamp()-interval '5 minutes') then raise exception 'certificate:source_unavailable'; end if;
 select * into e from vppsone.enrolments where student_id=p_student and session_label=p_session order by created_at desc limit 1;
 select to_jsonb(x) into s from vppsone.fees_identity_students x where x.id=p_student limit 1;
 select to_jsonb(x) into c from vppsone.fees_identity_classes x where x.id=e.class_id and x.session_label=p_session;
 select template into t from vppsone.school_certificate_templates where active and kind=p_kind;
 current_record:=coalesce(e.status::text='enrolled' and e.left_on is null and s->>'status'='active' and (s->>'class_id')::uuid=e.class_id,false);
 verified:=e.id is not null and s is not null and c is not null and (current_record or (e.enrolled_on is not null and e.left_on is not null and e.left_on>=e.enrolled_on));
 mentioned:=coalesce(t::text,'');
 return jsonb_build_object('studentId',p_student,'enrolmentId',coalesce(e.id,'00000000-0000-0000-0000-000000000000'::uuid),
   'classId',coalesce(e.class_id,'00000000-0000-0000-0000-000000000000'::uuid),'studentName',coalesce(s->>'full_name',''),
   'admissionNo',coalesce(s->>'admission_no',''),'classLabel',concat_ws(' ',c->>'class_name',nullif(c->>'section','')),
   'sessionLabel',p_session,'status',case when current_record then 'current' else 'historical' end,
   'enrolledOn',e.enrolled_on,'leftOn',e.left_on,
   'admittedOn',case when position('admittedOn' in mentioned)>0 then s->>'joined_on' end,
   'dateOfBirth',case when position('dateOfBirth' in mentioned)>0 then s->>'date_of_birth' end,
   'fatherName',case when position('fatherName' in mentioned)>0 then s->>'father_name' end,
   'motherName',case when position('motherName' in mentioned)>0 then s->>'mother_name' end,
   'gender',case when position('{sonDaughter}' in mentioned)+position('{heShe}' in mentioned)+position('{himHer}' in mentioned)+position('{hisHer}' in mentioned)+position('{putraPutri}' in mentioned)>0 then s->>'gender' end,
   'identityVerified',verified,'sourceCurrent',s is not null and c is not null,
   'sourceRevision',case when vppsone.is_test_session(p_session) then coalesce(s->>'updated_at','test') else coalesce((select last_revision::text from vppsone.fees_bridge_state where id),'unknown') end,
   'checkedAt',clock_timestamp());
end;
$$;
revoke all on function vppsone.school_certificate_facts_v2(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_facts_v2(uuid,uuid,text,text,boolean) to service_role;

create function vppsone.school_certificate_current_v2(p_actor uuid,p_student uuid,p_session text,p_kind text,p_command uuid,p_request_hash text,p_confined boolean default false,p_issue uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare prior vppsone.school_certificate_commands; issue vppsone.school_certificate_issues;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'certificate:invalid_command'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-command:'||p_command::text,0));
 select * into prior from vppsone.school_certificate_commands where command_id=p_command;
 if found then
   if prior.actor_id<>p_actor or prior.request_hash<>p_request_hash then raise exception 'certificate:command_reused'; end if;
   select * into issue from vppsone.school_certificate_issues where id=prior.issue_id;
   if issue.student_id<>p_student or issue.session_label<>p_session or issue.kind<>p_kind then raise exception 'certificate:command_reused'; end if;
   return to_jsonb(issue);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-student:'||p_student::text||':'||p_session,0));
 select * into issue from vppsone.school_certificate_issues where student_id=p_student and session_label=p_session and kind=p_kind
   and status in('prepared','issued') and (p_issue is null or id=p_issue) order by issued_at desc limit 1;
 if not found then
   if p_issue is not null then raise exception 'certificate:stale_issue'; end if;
   return null;
 end if;
 insert into vppsone.school_certificate_commands(command_id,actor_id,request_hash,issue_id) values(p_command,p_actor,p_request_hash,issue.id);
 return to_jsonb(issue);
end;
$$;
revoke all on function vppsone.school_certificate_current_v2(uuid,uuid,text,text,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_current_v2(uuid,uuid,text,text,uuid,text,boolean,uuid) to service_role;

create function vppsone.school_certificate_reserve_v2(p_actor uuid,p_student uuid,p_session text,p_kind text,p_command uuid,p_request_hash text,
 p_expected_facts jsonb,p_school jsonb,p_expected_template integer,p_purpose text default null,p_extras jsonb default '{}'::jsonb,
 p_new boolean default false,p_supersedes uuid default null,p_reason text default null,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare prior vppsone.school_certificate_commands; issue vppsone.school_certificate_issues; t vppsone.school_certificate_templates;
 facts jsonb; serial_number bigint; serial_text text; instant timestamptz:=clock_timestamp(); field text; extra record; code text;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if p_kind not in ('study','character','dob','tc') then raise exception 'certificate:invalid_kind'; end if;
 if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'certificate:invalid_command'; end if;
 if p_purpose is not null and (length(btrim(p_purpose))<2 or length(p_purpose)>80 or p_purpose ~ '[{}<>]') then raise exception 'certificate:invalid_purpose'; end if;
 if jsonb_typeof(coalesce(p_extras,'{}'::jsonb))<>'object' then raise exception 'certificate:invalid_extras'; end if;
 for extra in select key, value from jsonb_each(coalesce(p_extras,'{}'::jsonb)) loop
   if extra.key not in ('reasonForLeaving','conduct','lastResult','remarks') or jsonb_typeof(extra.value)<>'string'
     or length(extra.value#>>'{}')>200 or (extra.value#>>'{}') ~ '[{}<>]' then raise exception 'certificate:invalid_extras'; end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-command:'||p_command::text,0));
 select * into prior from vppsone.school_certificate_commands where command_id=p_command;
 if found then
   if prior.actor_id<>p_actor or prior.request_hash<>p_request_hash then raise exception 'certificate:command_reused'; end if;
   select * into issue from vppsone.school_certificate_issues where id=prior.issue_id;
   return jsonb_build_object('issue',to_jsonb(issue),'existing',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-student:'||p_student::text||':'||p_session,0));
 if not p_new and p_supersedes is null then
   select * into issue from vppsone.school_certificate_issues where student_id=p_student and session_label=p_session and kind=p_kind
     and status in('prepared','issued') order by issued_at desc limit 1;
   if found then
     insert into vppsone.school_certificate_commands(command_id,actor_id,request_hash,issue_id) values(p_command,p_actor,p_request_hash,issue.id);
     return jsonb_build_object('issue',to_jsonb(issue),'existing',true);
   end if;
 end if;
 select * into t from vppsone.school_certificate_templates where active and kind=p_kind for share;
 if not found then raise exception 'certificate:template_inactive'; end if;
 if t.version<>p_expected_template then raise exception 'certificate:template_changed'; end if;
 facts:=vppsone.school_certificate_facts_v2(p_actor,p_student,p_session,p_kind,p_confined);
 if facts->>'identityVerified'<>'true' or facts->>'sourceCurrent'<>'true' then raise exception 'certificate:identity_unverified'; end if;
 if (facts-'checkedAt') is distinct from (p_expected_facts-'checkedAt') then raise exception 'certificate:source_changed'; end if;
 if p_kind='tc' and facts->>'status'<>'historical' then raise exception 'certificate:not_left'; end if;
 for field in select jsonb_array_elements_text(t.template->'requiredFields') loop
   if nullif(btrim(facts->>field),'') is null then raise exception 'certificate:missing_field:%',field; end if;
 end loop;
 if p_supersedes is not null then
   if not vppsone.school_office_actor_allowed(p_actor,'certificates:manage',p_session,p_confined) or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'certificate:correction_forbidden'; end if;
   select * into issue from vppsone.school_certificate_issues where id=p_supersedes and student_id=p_student and session_label=p_session and kind=p_kind for update;
   if not found or issue.status not in('prepared','issued') then raise exception 'certificate:stale_issue'; end if;
 end if;
 if p_school->>'name' is null or length(p_school->>'name')<2 then raise exception 'certificate:school_missing'; end if;
 insert into vppsone.school_certificate_series(prefix,session_label,is_test,last_number)
   values(t.template->>'prefix',p_session,vppsone.is_test_session(p_session),1)
   on conflict(prefix,session_label,is_test) do update set last_number=vppsone.school_certificate_series.last_number+1
   returning last_number into serial_number;
 serial_text:=case when vppsone.is_test_session(p_session) then 'TEST/' else '' end||(t.template->>'prefix');
 serial_text:=serial_text||'/'||p_session||'/'||lpad(serial_number::text,greatest(4,length(serial_number::text)),'0');
 code:=substr(md5(gen_random_uuid()::text||clock_timestamp()::text),1,16);
 insert into vppsone.school_certificate_issues(student_id,session_label,enrolment_id,template_version,serial,snapshot,issued_by,issued_at,supersedes,reason,kind)
   values(p_student,p_session,(facts->>'enrolmentId')::uuid,t.version,serial_text,
    jsonb_build_object('serial',serial_text,'issuedAt',instant,'issuedOn',(instant at time zone 'Asia/Kolkata')::date,
      'isTest',vppsone.is_test_session(p_session),'school',p_school,'facts',facts,'template',t.template,
      'kind',p_kind,'purpose',nullif(btrim(coalesce(p_purpose,'')),''),'extras',coalesce(p_extras,'{}'::jsonb),'verifyCode',code),
    p_actor,instant,p_supersedes,p_reason,p_kind)
   returning * into issue;
 insert into vppsone.school_certificate_commands(command_id,actor_id,request_hash,issue_id) values(p_command,p_actor,p_request_hash,issue.id);
 insert into vppsone.school_certificate_events(issue_id,actor_id,kind) values(issue.id,p_actor,'prepared');
 return jsonb_build_object('issue',to_jsonb(issue),'existing',false);
end;
$$;
revoke all on function vppsone.school_certificate_reserve_v2(uuid,uuid,text,text,uuid,text,jsonb,jsonb,integer,text,jsonb,boolean,uuid,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_reserve_v2(uuid,uuid,text,text,uuid,text,jsonb,jsonb,integer,text,jsonb,boolean,uuid,text,boolean) to service_role;

create function vppsone.school_certificate_save_template_v2(p_actor uuid,p_kind text,p_template jsonb,p_expected_version integer,p_confined boolean default false)
returns integer language plpgsql set search_path='' as $$
declare current_version integer; new_version integer;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:manage',null,p_confined) then raise exception 'certificate:forbidden'; end if;
 if p_kind not in ('study','character','dob','tc') then raise exception 'certificate:invalid_kind'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-template',0));
 select coalesce(max(version),0) into current_version from vppsone.school_certificate_templates where kind=p_kind;
 if current_version<>p_expected_version then raise exception 'certificate:template_changed'; end if;
 if p_template->>'signaturePolicy'<>'manual' or p_template->>'prefix' !~ '^[A-Z0-9][A-Z0-9/-]{0,39}$' then raise exception 'certificate:invalid_template'; end if;
 if exists(select 1 from vppsone.school_certificate_templates where kind<>p_kind and template->>'prefix'=p_template->>'prefix') then raise exception 'certificate:prefix_in_use'; end if;
 select coalesce(max(version),0)+1 into new_version from vppsone.school_certificate_templates;
 update vppsone.school_certificate_templates set active=false where active and kind=p_kind;
 insert into vppsone.school_certificate_templates(version,kind,active,template,approved_by,approved_via)
 values(new_version,p_kind,coalesce((p_template->>'active')::boolean,false),p_template||jsonb_build_object('version',new_version,'kind',p_kind),p_actor,'authorized template configuration');
 return new_version;
end;
$$;
revoke all on function vppsone.school_certificate_save_template_v2(uuid,text,jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_save_template_v2(uuid,text,jsonb,integer,boolean) to service_role;

-- The v1 entry points keep working for a deployment that has not caught up:
-- they now mean the study kind only, so they cannot read another kind's template.
create or replace function vppsone.school_certificate_facts(p_actor uuid,p_student uuid,p_session text,p_confined boolean default false)
returns jsonb language sql stable set search_path='' as $$
 select vppsone.school_certificate_facts_v2(p_actor,p_student,p_session,'study',p_confined);
$$;
create or replace function vppsone.school_certificate_current(p_actor uuid,p_student uuid,p_session text,p_command uuid,p_request_hash text,p_confined boolean default false,p_issue uuid default null)
returns jsonb language sql set search_path='' as $$
 select vppsone.school_certificate_current_v2(p_actor,p_student,p_session,'study',p_command,p_request_hash,p_confined,p_issue);
$$;
create or replace function vppsone.school_certificate_reserve(p_actor uuid,p_student uuid,p_session text,p_command uuid,p_request_hash text,
 p_expected_facts jsonb,p_school jsonb,p_expected_template integer,p_new boolean default false,p_supersedes uuid default null,p_reason text default null,p_confined boolean default false)
returns jsonb language sql set search_path='' as $$
 select vppsone.school_certificate_reserve_v2(p_actor,p_student,p_session,'study',p_command,p_request_hash,p_expected_facts,p_school,p_expected_template,null,'{}'::jsonb,p_new,p_supersedes,p_reason,p_confined);
$$;
create or replace function vppsone.school_certificate_save_template(p_actor uuid,p_template jsonb,p_expected_version integer,p_confined boolean default false)
returns integer language sql set search_path='' as $$
 select vppsone.school_certificate_save_template_v2(p_actor,'study',p_template,p_expected_version,p_confined);
$$;

revoke all on function vppsone.school_certificate_facts(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function vppsone.school_certificate_current(uuid,uuid,text,uuid,text,boolean,uuid) from public,anon,authenticated;
revoke all on function vppsone.school_certificate_reserve(uuid,uuid,text,uuid,text,jsonb,jsonb,integer,boolean,uuid,text,boolean) from public,anon,authenticated;
revoke all on function vppsone.school_certificate_save_template(uuid,jsonb,integer,boolean) from public,anon,authenticated;

-- Class batches: the enrolled roster an issuer may prepare documents for.
-- Names, SR numbers and classes only; the issue command rereads every fact.
create function vppsone.school_certificate_roster(p_actor uuid,p_session text,p_confined boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if not vppsone.is_test_session(p_session) and not exists(select 1 from vppsone.fees_bridge_state where id and enabled and live_read_ready and last_error_code is null and last_checked_at>=clock_timestamp()-interval '5 minutes') then raise exception 'certificate:source_unavailable'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('studentId',s.id,'studentName',s.full_name,'admissionNo',s.admission_no,'classId',c.id,
     'classLabel',concat_ws(' ',c.class_name,nullif(c.section,''))) order by c.class_name,c.section,s.full_name)
   from vppsone.enrolments e
   join vppsone.fees_identity_students s on s.id=e.student_id
   join vppsone.fees_identity_classes c on c.id=e.class_id and c.session_label=p_session
   where e.session_label=p_session and e.status::text='enrolled' and e.left_on is null),'[]'::jsonb);
end;
$$;
revoke all on function vppsone.school_certificate_roster(uuid,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_roster(uuid,text,boolean) to service_role;

-- The attention card follows study certificates; it reads the study template,
-- not whichever kind was saved last.
create or replace function vppsone.school_office_attention(p_actor uuid,p_session text,p_confined boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare certificates boolean; government boolean; t jsonb; candidates jsonb:='[]'; artifacts jsonb:='[]'; batches jsonb:='[]'; unavailable boolean:=false;
begin
 certificates:=vppsone.school_office_actor_allowed(p_actor,'certificates:view',p_session,p_confined);
 government:=vppsone.school_office_actor_allowed(p_actor,'government:view',p_session,p_confined);
 if p_session is null or p_session !~ '^(TEST-)?[0-9]{4}-[0-9]{2}$' or not(certificates or government) then raise exception 'office:forbidden'; end if;
 if certificates then
  select template||jsonb_build_object('active',active) into t from vppsone.school_certificate_templates where kind='study' order by version desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into artifacts from (
   select id,student_id,student_name,session_label,artifact_state from vppsone.school_certificate_issues
   where session_label=p_session and status in('prepared','issued') and artifact_state in('preparing','failed')
   order by issued_at desc,id desc limit 4
  ) x;
  if exists(select 1 from vppsone.school_certificate_attention where session_label=p_session) then
   if not vppsone.is_test_session(p_session) and not exists(select 1 from vppsone.fees_bridge_state where id and enabled
    and live_read_ready and last_error_code is null and last_checked_at>=clock_timestamp()-interval '5 minutes') then
    unavailable:=true;
   else
    begin
     with logged as materialized (
      select student_id,blocker_codes,last_seen_at from vppsone.school_certificate_attention where session_label=p_session
      order by last_seen_at desc,student_id limit 1000
     ), records as (
      select l.*,e.id enrolment_id,e.class_id,e.enrolled_on,e.left_on,s.id source_id,s.full_name,s.admission_no,
       s.date_of_birth,s.father_name,s.mother_name,c.id source_class_id,concat_ws(' ',c.class_name,nullif(c.section,'')) class_label,
       coalesce(e.status::text='enrolled' and e.left_on is null and s.status::text='active' and s.class_id=e.class_id,false) current_record
      from logged l
      left join lateral(select * from vppsone.enrolments e where e.student_id=l.student_id and e.session_label=p_session order by e.created_at desc,e.id desc limit 1) e on true
      left join vppsone.fees_identity_students s on s.id=l.student_id and exists(
       select 1 from vppsone.fees_identity_classes scope where scope.id=s.class_id
        and vppsone.is_test_session(scope.session_label)=vppsone.is_test_session(p_session))
      left join vppsone.fees_identity_classes c on c.id=e.class_id and c.session_label=p_session
     ), facts as (
      select r.*,
       coalesce((t->'requiredFields')::text,'')||' '||
        case when t->>'language' in('en','both') then coalesce(t->>(case when current_record then 'bodyEn' else 'historicalBodyEn' end),'') else '' end||' '||
        case when t->>'language' in('hi','both') then coalesce(t->>(case when current_record then 'bodyHi' else 'historicalBodyHi' end),'') else '' end optional_text
      from records r
     ), snapshots as (
      select student_id,blocker_codes,last_seen_at,optional_text,
       jsonb_build_object('studentId',student_id,'enrolmentId',coalesce(enrolment_id,'00000000-0000-0000-0000-000000000000'::uuid),
       'classId',coalesce(class_id,'00000000-0000-0000-0000-000000000000'::uuid),'studentName',coalesce(full_name,''),'admissionNo',coalesce(admission_no,''),
       'classLabel',class_label,'sessionLabel',p_session,'status',case when current_record then 'current' else 'historical' end,
       'enrolledOn',enrolled_on,'leftOn',left_on,'dateOfBirth',case when position('dateOfBirth' in optional_text)>0 then date_of_birth end,
       'fatherName',case when position('fatherName' in optional_text)>0 then father_name end,'motherName',case when position('motherName' in optional_text)>0 then mother_name end,
       'identityVerified',enrolment_id is not null and source_id is not null and source_class_id is not null
        and (current_record or (enrolled_on is not null and left_on is not null and left_on>=enrolled_on)),
       'sourceCurrent',source_id is not null and source_class_id is not null,'sourceRevision','attention-current','checkedAt',clock_timestamp()) facts
      from facts
     )
     select coalesce(jsonb_agg(jsonb_build_object('student_id',student_id,'blocker_codes',blocker_codes,'facts',facts)),'[]'::jsonb)
     into candidates from (
      -- Skip resolved logs before limiting the response, so old corrected
      -- records cannot crowd an unresolved student out of the card.
      select * from snapshots f where f.facts->>'sourceCurrent'='false' or exists(
       select 1 from unnest(f.blocker_codes) code where
        (code='identity:identity_unverified' and f.facts->>'identityVerified'='false')
        or (code='template:template_inactive' and t->>'active'='false')
        or (split_part(code,':',2)='missing_field'
         and ((t->'requiredFields') ? split_part(code,':',1) or position('{'||split_part(code,':',1)||'}' in f.optional_text)>0)
         and nullif(btrim(f.facts->>split_part(code,':',1)),'') is null)
      ) order by last_seen_at desc,student_id limit 8
     ) current_candidates;
    exception when others then unavailable:=true; candidates:='[]'; end;
   end if;
  end if;
 end if;
 if government then
  -- State filtering deliberately happens AFTER newest-per-parent selection.
  -- An older conflicted preview cannot survive a newer applied import.
  with latest_imports as materialized (
   select distinct on(coalesce(parent_batch_id,id)) id,parent_batch_id,direction,state,created_at,session_label,payload
   from vppsone.school_return_batches where session_label=p_session and direction='import'
   order by coalesce(parent_batch_id,id),created_at desc,id desc
  ), actionable as (
   select id,parent_batch_id,direction,state,created_at,session_label,
    exists(select 1 from jsonb_array_elements(coalesce(payload->'preview','[]'::jsonb)) r where r->>'state' in('conflict','unmatched')) has_conflicts
   from latest_imports where state in('preparing','staged')
   union all
   select id,parent_batch_id,direction,state,created_at,session_label,false from vppsone.school_return_batches
   where session_label=p_session and direction='export' and state='preparing'
  )
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into batches from (
   select * from actionable where state='preparing' or has_conflicts order by created_at desc,id desc limit 8
  ) x;
 end if;
 return jsonb_build_object('template',t,'certificate_candidates',candidates,'certificate_artifacts',artifacts,
  'return_batches',batches,'certificate_unavailable',unavailable);
end;
$$;

-- Public check behind the QR: status, number, kind, date and the name for the
-- server to mask. No class, parentage, DOB or anything else from the profile.
-- TEST issues answer as unknown so a test document cannot be vouched for.
create function vppsone.school_certificate_verify(p_code text)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_code !~ '^[a-f0-9]{16}$' then null else (
   select jsonb_build_object('status',i.status,'serial',i.serial,'kind',i.kind,'issuedOn',i.snapshot->>'issuedOn',
     'studentName',i.student_name,'school',i.snapshot->'school'->>'name','supersededBy',
     (select n.serial from vppsone.school_certificate_issues n where n.supersedes=i.id and n.status in('prepared','issued') limit 1))
   from vppsone.school_certificate_issues i where i.verify_code=p_code and i.artifact_state='ready' and not coalesce((i.snapshot->>'isTest')::boolean,false)) end;
$$;
revoke all on function vppsone.school_certificate_verify(text) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_verify(text) to service_role;

notify pgrst,'reload schema';
commit;
