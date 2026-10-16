-- Authored locally; unapplied. Reuses the existing PRIVATE vppsone-photos bucket.
-- The collection answer is the only task progress authority. A proposal is its
-- immutable uploaded-byte attachment, never a second task or official portrait.
insert into vppsone.collection_fields(key,label_hi,label_en,input_type,mode,is_active,sort_order)
values('student_photo','विद्यार्थी का फोटो','Student photograph','text','collect',true,90)
on conflict(key) do nothing;

create table vppsone.photo_proposals (
  command_id uuid primary key,
  request_id uuid not null references vppsone.collection_requests(id),
  student_id uuid not null,
  field_id uuid not null references vppsone.collection_fields(id),
  actor_staff_id uuid not null references vppsone.staff_profiles(id),
  capability_hash text not null,
  payload jsonb not null,
  expected_current uuid,
  decision text not null default 'pending' check(decision in('pending','accepted','rejected')),
  decided_by uuid references vppsone.staff_profiles(id),
  created_at timestamptz not null default now()
);
create index photo_proposals_request on vppsone.photo_proposals(request_id,student_id);
alter table vppsone.photo_proposals enable row level security;
revoke all on vppsone.photo_proposals from anon,authenticated;
grant all on vppsone.photo_proposals to service_role;

create function vppsone.guard_photo_answer() returns trigger
language plpgsql security definer set search_path='' as $$
declare p vppsone.photo_proposals%rowtype;
begin
  if not exists(select 1 from vppsone.collection_fields f where f.id=new.field_id and f.key='student_photo') then return new; end if;
  select * into p from vppsone.photo_proposals where command_id::text=new.value
    and request_id=new.request_id and student_id=new.student_id and field_id=new.field_id;
  if not found then raise exception 'photos:unbound'; end if;
  if tg_op='UPDATE' and old.status<>'pending' and (new.value is distinct from old.value or new.status is distinct from old.status) then raise exception 'photos:decided'; end if;
  if new.status::text is distinct from p.decision then raise exception 'photos:use_photo_review'; end if;
  if new.status<>'pending' and (new.decided_by is distinct from p.decided_by or not exists(
    select 1 from vppsone.staff_profiles s where s.id=new.decided_by and s.is_active and s.role='admin')) then raise exception 'photos:admin_required'; end if;
  if new.status='accepted' and not exists(select 1 from vppsone.student_photos s where s.command_id=p.command_id and s.student_id=p.student_id) then raise exception 'photos:unplaced'; end if;
  return new;
end; $$;
create trigger photo_answer_bound before insert or update on vppsone.collection_submissions
for each row execute function vppsone.guard_photo_answer();

create function vppsone.submit_student_photo(p_request uuid,p_token text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r vppsone.collection_requests%rowtype; t vppsone.teacher_tasks%rowtype;
  prior vppsone.photo_proposals%rowtype; answer vppsone.collection_submissions%rowtype;
  cmd uuid := (p->>'command_id')::uuid; student uuid := (p->>'student_id')::uuid; field uuid;
begin
  -- Same task -> request lock order as record_collection_answers/reassignment.
  select * into t from vppsone.teacher_tasks where request_id=p_request for update;
  if found and not vppsone.teacher_task_access(t.id,t.assigned_staff_id,null) then raise exception 'photos:not_permitted'; end if;
  select * into r from vppsone.collection_requests where id=p_request for update;
  if not found or r.status<>'open' or r.archived_at is not null or r.token is distinct from p_token
    or not exists(select 1 from vppsone.staff_profiles where id=r.assigned_staff_id and is_active)
    or not exists(select 1 from vppsone.collection_request_members where request_id=r.id and student_id=student)
    then raise exception 'photos:not_permitted'; end if;
  select f.id into field from vppsone.collection_fields f join vppsone.collection_request_fields rf on rf.field_id=f.id
    where rf.request_id=r.id and f.key='student_photo';
  if field is null then raise exception 'photos:not_permitted'; end if;
  if cmd is null or p->>'content_type' is distinct from 'image/jpeg' or coalesce((p->>'byte_size')::int,0) not between 1 and 204800
    or coalesce((p->>'width')::int,0) not between 1 and 600 or coalesce((p->>'height')::int,0) not between 1 and 600
    or coalesce(p->>'sha256','') !~ '^[0-9a-f]{64}$'
    or p->>'session_label' is distinct from r.session_label or coalesce(p->>'source','') not in('camera','file','folder')
    or p->>'storage_path' is distinct from 'proposals/'||r.id::text||'/'||student::text||'/'||cmd::text||'.jpg'
    then raise exception 'photos:bad_request'; end if;
  perform pg_advisory_xact_lock(hashtext('vppsone:photo-proposal:'||cmd::text));
  select * into prior from vppsone.photo_proposals where command_id=cmd;
  if found then
    if prior.request_id=r.id and prior.actor_staff_id=r.assigned_staff_id and prior.capability_hash=md5(r.token)
      and prior.payload=p then return jsonb_build_object('ok',true,'proposalId',cmd,'replayed',true); end if;
    raise exception 'photos:id_reused';
  end if;
  select * into answer from vppsone.collection_submissions where request_id=r.id and student_id=student and field_id=field for update;
  if answer.status is not null and answer.status<>'pending' then raise exception 'photos:decided'; end if;
  if answer.value is distinct from nullif(p->>'expected_proposal','') then raise exception 'photos:stale'; end if;
  insert into vppsone.photo_proposals(command_id,request_id,student_id,field_id,actor_staff_id,capability_hash,payload,expected_current)
    values(cmd,r.id,student,field,r.assigned_staff_id,md5(r.token),p,nullif(p->>'expected_current','')::uuid);
  perform vppsone.record_collection_answers(r.id,r.token,jsonb_build_array(jsonb_build_object(
    'studentId',student,'fieldId',field,'value',cmd::text,'previousValue',p->>'expected_current')));
  return jsonb_build_object('ok',true,'proposalId',cmd,'replayed',false);
end; $$;

create function vppsone.review_student_photo(p_actor uuid,p_proposal uuid,p_accept boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare proposal vppsone.photo_proposals%rowtype; t vppsone.teacher_tasks%rowtype;
  answer vppsone.collection_submissions%rowtype; result jsonb; request uuid;
begin
  if not exists(select 1 from vppsone.staff_profiles where id=p_actor and is_active and role='admin') then raise exception 'photos:admin_required'; end if;
  select request_id into request from vppsone.photo_proposals where command_id=p_proposal;
  select * into t from vppsone.teacher_tasks where request_id=request for update;
  if found and not vppsone.teacher_task_access(t.id,t.assigned_staff_id,null) then raise exception 'photos:not_permitted'; end if;
  perform 1 from vppsone.collection_requests where id=request and status='open' and archived_at is null for update;
  if not found then raise exception 'photos:not_permitted'; end if;
  select * into proposal from vppsone.photo_proposals where command_id=p_proposal for update;
  if not found then raise exception 'photos:not_found'; end if;
  select * into answer from vppsone.collection_submissions where request_id=request and student_id=proposal.student_id and field_id=proposal.field_id for update;
  if answer.value is distinct from p_proposal::text then raise exception 'photos:stale'; end if;
  if proposal.decision<>'pending' then
    if (proposal.decision='accepted')=p_accept then return jsonb_build_object('ok',true,'replayed',true); end if;
    raise exception 'photos:decided';
  end if;
  if p_accept then
    result := vppsone.place_student_photo(proposal.payload||jsonb_build_object('actor_staff_id',p_actor,
      'payload_hash',md5(proposal.payload::text),'expected_current',proposal.expected_current));
    if result->>'ok' is distinct from 'true' then return result; end if;
  end if;
  update vppsone.photo_proposals set decision=case when p_accept then 'accepted' else 'rejected' end,decided_by=p_actor where command_id=p_proposal;
  update vppsone.collection_submissions set status=(case when p_accept then 'accepted' else 'rejected' end)::vppsone.submission_status,
    decided_by=p_actor,decided_at=now() where id=answer.id;
  return jsonb_build_object('ok',true,'replayed',false);
end; $$;

revoke all on function vppsone.guard_photo_answer() from public,anon,authenticated;
revoke all on function vppsone.submit_student_photo(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function vppsone.review_student_photo(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.submit_student_photo(uuid,text,jsonb) to service_role;
grant execute on function vppsone.review_student_photo(uuid,uuid,boolean) to service_role;

-- Self photo follows existing self-preference policy. Editing another person
-- requires the current staff:manage matrix grant; no role/activation write.
create table vppsone.staff_photos (
  command_id uuid primary key,
  staff_id uuid not null references vppsone.staff_profiles(id),
  actor_staff_id uuid not null references vppsone.staff_profiles(id),
  payload jsonb not null,
  replaced_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index staff_photos_current on vppsone.staff_photos(staff_id) where replaced_at is null;
alter table vppsone.staff_photos enable row level security;
revoke all on vppsone.staff_photos from anon,authenticated;
grant all on vppsone.staff_photos to service_role;
create function vppsone.save_staff_photo(p_actor uuid,p_staff uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior vppsone.staff_photos%rowtype; current_id uuid; cmd uuid := (p->>'command_id')::uuid;
begin
  if not exists(select 1 from vppsone.staff_profiles s where s.id=p_actor and s.is_active and
    (s.id=p_staff or exists(select 1 from vppsone.role_permissions rp where rp.role=s.role and rp.permission='staff:manage')))
    or not exists(select 1 from vppsone.staff_profiles where id=p_staff)
    then raise exception 'photos:not_permitted'; end if;
  if cmd is null or p->>'content_type' is distinct from 'image/jpeg' or coalesce((p->>'byte_size')::int,0) not between 1 and 204800
    or coalesce((p->>'width')::int,0) not between 1 and 600 or coalesce((p->>'height')::int,0) not between 1 and 600
    or coalesce(p->>'sha256','') !~ '^[0-9a-f]{64}$'
    or p->>'storage_path' is distinct from 'staff/'||p_staff::text||'/'||cmd::text||'.jpg'
    then raise exception 'photos:bad_request'; end if;
  perform pg_advisory_xact_lock(hashtext('vppsone:staff-photo-command:'||cmd::text));
  perform pg_advisory_xact_lock(hashtext('vppsone:staff-photo:'||p_staff::text));
  select * into prior from vppsone.staff_photos where command_id=cmd;
  if found then
    if prior.staff_id=p_staff and prior.actor_staff_id=p_actor and prior.payload=p then return jsonb_build_object('ok',true,'replayed',true); end if;
    raise exception 'photos:id_reused';
  end if;
  select command_id into current_id from vppsone.staff_photos where staff_id=p_staff and replaced_at is null;
  if current_id is distinct from nullif(p->>'expected_current','')::uuid then raise exception 'photos:stale'; end if;
  update vppsone.staff_photos set replaced_at=now() where staff_id=p_staff and replaced_at is null;
  insert into vppsone.staff_photos(command_id,staff_id,actor_staff_id,payload) values(cmd,p_staff,p_actor,p);
  return jsonb_build_object('ok',true,'replayed',false);
end; $$;
revoke all on function vppsone.save_staff_photo(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function vppsone.save_staff_photo(uuid,uuid,jsonb) to service_role;

-- A direct class-teacher avatar edit joins existing assigned photo work first.
-- It can otherwise ask only this teacher, about this one currently owned child.
create function vppsone.ensure_student_photo_task(p_actor uuid,p_student uuid,p_session text) returns uuid
language plpgsql security definer set search_path='' as $$
declare t vppsone.teacher_tasks%rowtype; class uuid; field uuid; request uuid; task uuid; source text; actor_user uuid;
begin
  perform pg_advisory_xact_lock(hashtext('vppsone:teacher-task-create:'||p_session));
  select e.class_id into class from vppsone.enrolments e join vppsone.class_teachers ct on ct.class_id=e.class_id and ct.session_label=e.session_label
    join vppsone.staff_profiles s on s.id=ct.staff_profile_id
    where e.student_id=p_student and e.session_label=p_session and e.status='enrolled' and ct.staff_profile_id=p_actor
      and ct.role='class_teacher' and ct.effective_from<=vppsone.school_today() and (ct.effective_to is null or ct.effective_to>=vppsone.school_today())
      and s.is_active and (s.is_teaching or s.role='teacher') limit 1;
  if class is null then raise exception 'photos:not_permitted'; end if;
  select id into field from vppsone.collection_fields where key='student_photo' and is_active;
  if field is null then raise exception 'photos:unavailable'; end if;
  for t in select tt.* from vppsone.teacher_tasks tt
    join vppsone.collection_request_members rm on rm.request_id=tt.request_id and rm.student_id=p_student
    join vppsone.collection_request_fields rf on rf.request_id=tt.request_id and rf.field_id=field
    where tt.assigned_staff_id=p_actor and tt.session_label=p_session and tt.revoked_at is null order by tt.created_at for update of tt
  loop
    if vppsone.teacher_task_access(t.id,p_actor,null) then return t.id; end if;
  end loop;
  source := 'collection:'||p_session||':'||md5(p_student::text||':'||field::text);
  if exists(select 1 from vppsone.teacher_tasks where source_key=source and revoked_at is null) then raise exception 'photos:assignment_changed'; end if;
  select user_id into actor_user from vppsone.staff_profiles where id=p_actor;
  insert into vppsone.collection_requests(session_label,title_hi,title_en,class_id,class_label,assigned_staff_id,token,status,audience_kind,audience_label,created_by)
    values(p_session,'विद्यार्थी का फोटो','Student photograph',class,'',p_actor,replace(gen_random_uuid()::text,'-',''),'open','class','',actor_user) returning id into request;
  insert into vppsone.collection_request_fields(request_id,field_id) values(request,field);
  insert into vppsone.collection_request_members(request_id,student_id,roll_no,snapshot)
    select request,p_student,e.roll_no,jsonb_build_object('student_photo',(select id::text from vppsone.student_photos where student_id=p_student and replaced_at is null))
    from vppsone.enrolments e where e.student_id=p_student and e.session_label=p_session and e.class_id=class and e.status='enrolled';
  insert into vppsone.teacher_tasks(session_label,kind,source_key,request_id,scope,assigned_staff_id,title,created_by)
    values(p_session,'collection',source,request,jsonb_build_object('kind','class','value',class),p_actor,'Student photograph',p_actor) returning id into task;
  if not vppsone.teacher_task_access(task,p_actor,null) then raise exception 'photos:not_permitted'; end if;
  return task;
end; $$;
revoke all on function vppsone.ensure_student_photo_task(uuid,uuid,text) from public,anon,authenticated;
grant execute on function vppsone.ensure_student_photo_task(uuid,uuid,text) to service_role;
