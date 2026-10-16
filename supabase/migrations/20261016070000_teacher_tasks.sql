-- Shared teacher work. All application objects stay in vppsone. Unapplied.
-- Canonical collection/marks/register rows own completion; tasks own delegation.
create table vppsone.teacher_tasks (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  kind text not null check (kind in ('collection','marks','attendance')),
  source_key text not null,
  request_id uuid unique references vppsone.collection_requests(id),
  paper_id uuid references vppsone.assessment_subjects(id),
  class_id uuid,
  day date,
  scope jsonb not null,
  assigned_staff_id uuid not null references vppsone.staff_profiles(id),
  title text not null,
  due_date date,
  -- Like collection_requests.token: capability visible only to service_role.
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text,'-',''),
  revoked_at timestamptz,
  opened_at timestamptz,
  created_by uuid not null references vppsone.staff_profiles(id),
  created_at timestamptz not null default now(),
  check ((kind='collection' and request_id is not null and paper_id is null and day is null)
    or (kind='marks' and paper_id is not null and request_id is null and day is null)
    or (kind='attendance' and class_id is not null and day is not null and request_id is null and paper_id is null))
);
create index teacher_tasks_assignee on vppsone.teacher_tasks(session_label, assigned_staff_id);
create unique index teacher_tasks_current_source on vppsone.teacher_tasks(source_key) where revoked_at is null;
create table vppsone.teacher_task_previews (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references vppsone.staff_profiles(id),
  payload jsonb not null,
  digest text generated always as (md5(payload::text)) stored,
  expires_at timestamptz not null default now() + interval '30 minutes',
  result jsonb,
  created_at timestamptz not null default now()
);
alter table vppsone.teacher_tasks enable row level security;
alter table vppsone.teacher_task_previews enable row level security;
revoke all on vppsone.teacher_tasks, vppsone.teacher_task_previews from anon, authenticated;
grant all on vppsone.teacher_tasks, vppsone.teacher_task_previews to service_role;

create function vppsone.teacher_task_owner(p_staff uuid, p_session text, p_scope jsonb, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from vppsone.staff_profiles sp where sp.id=p_staff and sp.is_active and (sp.is_teaching or sp.role='teacher')
      and (p_kind='collection' or exists (select 1 from vppsone.role_permissions rp where rp.role=sp.role
        and rp.permission=case when p_kind='marks' then 'marks:write' else 'attendance:mark' end))
      and case p_scope->>'kind'
        when 'common' then p_kind='collection'
        when 'class' then p_kind<>'marks' and exists (select 1 from vppsone.class_teachers ct
          where ct.staff_profile_id=p_staff and ct.session_label=p_session and ct.class_id::text=p_scope->>'value'
          and ct.role='class_teacher' and ct.effective_from<=vppsone.school_today()
          and (ct.effective_to is null or ct.effective_to>=vppsone.school_today()))
        when 'house' then p_kind='collection' and exists (select 1 from vppsone.staff_scopes ss
          where ss.staff_profile_id=p_staff and ss.session_label=p_session and ss.kind='house' and ss.value=p_scope->>'value')
        when 'route' then p_kind='collection' and exists (select 1 from vppsone.staff_scopes ss
          where ss.staff_profile_id=p_staff and ss.session_label=p_session and ss.kind='route' and ss.value=p_scope->>'value')
        when 'subject' then p_kind<>'attendance' and exists (select 1 from vppsone.teaching_assignments ta
          where ta.staff_profile_id=p_staff and ta.session_label=p_session and ta.class_id::text=p_scope->>'value'
          and ta.subject_id::text=p_scope->>'subjectId')
        else false end
  );
$$;

create function vppsone.teacher_task_access(p_id uuid, p_staff uuid default null, p_token text default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vppsone.teacher_tasks t where t.id=p_id and t.revoked_at is null
    and ((p_staff is not null and t.assigned_staff_id=p_staff) or (p_token is not null and t.token=p_token))
    and vppsone.teacher_task_owner(t.assigned_staff_id,t.session_label,t.scope,t.kind)
    and (t.kind<>'collection' or exists (select 1 from vppsone.collection_requests r
      where r.id=t.request_id and r.status='open' and r.archived_at is null and r.assigned_staff_id=t.assigned_staff_id))
    and (t.kind<>'collection' or not exists (
      select 1 from vppsone.collection_request_members cm where cm.request_id=t.request_id and not exists (
        select 1 from vppsone.enrolments e join public.students s on s.id=e.student_id
        where e.student_id=cm.student_id and e.session_label=t.session_label and e.status='enrolled'
          and case t.scope->>'kind'
            when 'common' then true
            when 'class' then e.class_id::text=t.scope->>'value'
            when 'subject' then e.class_id::text=t.scope->>'value'
            when 'house' then to_jsonb(s)->>'house'=t.scope->>'value'
            when 'route' then to_jsonb(s)->>'transport_route_id'=t.scope->>'value'
            else false end))));
$$;

-- Authoritative server preview is saved once. Creation accepts its id and digest,
-- never a browser-supplied replacement roster. No token is minted by a preview.
create function vppsone.prepare_teacher_tasks(p_actor uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v vppsone.teacher_task_previews%rowtype;
begin
  if not exists (select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role
    where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  if jsonb_typeof(p->'groups') is distinct from 'array' or jsonb_array_length(p->'groups') not between 1 and 60 then raise exception 'tasks:bad_request'; end if;
  insert into vppsone.teacher_task_previews(actor_id,payload) values(p_actor,p) returning * into v;
  return jsonb_build_object('id',v.id,'digest',v.digest);
end; $$;

create function vppsone.create_teacher_tasks(p_actor uuid, p_preview uuid, p_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v vppsone.teacher_task_previews%rowtype; g jsonb; member jsonb; f uuid; r uuid; t vppsone.teacher_tasks%rowtype;
  v_key text; v_kind text; v_session text; v_ids uuid[]; v_fields uuid[]; v_result jsonb:='[]'; v_snapshot jsonb;
  v_paper vppsone.assessment_subjects%rowtype; v_user uuid; v_existing uuid;
begin
  select s.user_id into v_user from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role
    where s.id=p_actor and s.is_active and rp.permission='collection:manage';
  if not found then raise exception 'tasks:not_permitted'; end if;
  select * into v from vppsone.teacher_task_previews where id=p_preview and actor_id=p_actor for update;
  if not found or v.digest is distinct from p_digest then raise exception 'tasks:preview_changed'; end if;
  if v.result is not null then return v.result; end if;
  if v.expires_at<now() then raise exception 'tasks:preview_expired'; end if;
  v_session:=v.payload->>'session'; v_kind:=v.payload->>'kind';
  if v_kind not in ('collection','marks','attendance') or v_session is null then raise exception 'tasks:bad_request'; end if;
  -- Serialize task creation, including concurrent different previews of the same work.
  perform pg_advisory_xact_lock(hashtext('vppsone:teacher-task-create:'||v_session));
  for g in select value from jsonb_array_elements(v.payload->'groups') loop
    if not vppsone.teacher_task_owner((g->>'teacherId')::uuid,v_session,g->'scope',v_kind) then raise exception 'tasks:assignment_changed'; end if;
    select array_agg(distinct value::uuid order by value::uuid) into v_ids from jsonb_array_elements_text(g->'studentIds');
    if coalesce(cardinality(v_ids),0) not between 1 and 2000 then raise exception 'tasks:empty_scope'; end if;
    -- Every previewed child must still have precisely the previewed enrolment.
    if v_kind='collection' then
    if v_ids is distinct from (select array_agg((m->>'id')::uuid order by (m->>'id')::uuid) from jsonb_array_elements(g->'members') m) then raise exception 'tasks:selection_changed'; end if;
    for member in select value from jsonb_array_elements(g->'members') loop
      if not exists (select 1 from vppsone.enrolments e join public.students s on s.id=e.student_id
        where e.session_label=v_session and e.status='enrolled' and e.student_id=(member->>'id')::uuid
          and e.class_id::text=member->>'classId'
          and coalesce(to_jsonb(s)->>'house','')=coalesce(member->>'house','')
          and coalesce(to_jsonb(s)->>'transport_route_id','')=coalesce(member->>'routeId','')
          and case g->'scope'->>'kind'
            when 'common' then true
            when 'class' then e.class_id::text=g->'scope'->>'value'
            when 'subject' then e.class_id::text=g->'scope'->>'value'
            when 'house' then to_jsonb(s)->>'house'=g->'scope'->>'value'
            when 'route' then to_jsonb(s)->>'transport_route_id'=g->'scope'->>'value'
            else false end) then raise exception 'tasks:selection_changed'; end if;
    end loop;
    end if;
    if v_kind='collection' then
      select array_agg(distinct value::uuid order by value::uuid) into v_fields from jsonb_array_elements_text(v.payload->'fieldIds');
      if coalesce(cardinality(v_fields),0)=0 or exists (select 1 from unnest(v_fields) id
        where not exists (select 1 from vppsone.collection_fields cf where cf.id=id and cf.is_active)) then raise exception 'tasks:fields_changed'; end if;
      v_key:='collection:'||v_session||':'||md5(array_to_string(v_ids,',')||':'||array_to_string(v_fields,','));
    elsif v_kind='marks' then
      select * into v_paper from vppsone.assessment_subjects where id=(v.payload->>'paperId')::uuid;
      if not found or g->'scope'->>'kind'<>'subject' or v_paper.class_id::text<>g->'scope'->>'value'
        or v_paper.subject_id::text<>g->'scope'->>'subjectId'
        or not exists(select 1 from vppsone.assessments a where a.id=v_paper.assessment_id and a.session_label=v_session and a.status='open')
        then raise exception 'tasks:paper_changed'; end if;
      v_key:='marks:'||v_session||':'||v_paper.id::text;
      if v_ids is distinct from (select array_agg(id order by id) from vppsone.paper_roster(v_paper.id) id) then raise exception 'tasks:selection_changed'; end if;
    else
      if g->'scope'->>'kind'<>'class' or (v.payload->>'day')::date>vppsone.school_today() then raise exception 'tasks:bad_request'; end if;
      v_key:='attendance:'||v_session||':'||(g->'scope'->>'value')||':'||(v.payload->>'day');
      if v_ids is distinct from (select array_agg(id order by id) from vppsone.attendance_roster(v_session,(g->'scope'->>'value')::uuid,(v.payload->>'day')::date) id) then raise exception 'tasks:selection_changed'; end if;
    end if;
    select * into t from vppsone.teacher_tasks where source_key=v_key and revoked_at is null;
    if found then
      if t.assigned_staff_id is distinct from (g->>'teacherId')::uuid then raise exception 'tasks:recipient_changed'; end if;
      -- An existing task is reused, never silently reassigned by another entry point.
      v_result:=v_result||jsonb_build_array(jsonb_build_object('id',t.id,'reused',true,'teacherId',t.assigned_staff_id)); continue;
    end if;
    r:=null;
    if v_kind='collection' then
      -- Adopt an exact existing collection list rather than create duplicate proposals.
      select cr.id into v_existing from vppsone.collection_requests cr
        where coalesce(v.payload->>'freshRound','false')<>'true' and cr.session_label=v_session and cr.status='open' and cr.archived_at is null
          and cr.assigned_staff_id=(g->>'teacherId')::uuid
          and (select array_agg(cm.student_id order by cm.student_id) from vppsone.collection_request_members cm where cm.request_id=cr.id)=v_ids
          and (select array_agg(cf.field_id order by cf.field_id) from vppsone.collection_request_fields cf where cf.request_id=cr.id)=v_fields
          and not exists(select 1 from vppsone.teacher_tasks tt where tt.request_id=cr.id)
        order by cr.created_at limit 1;
      r:=v_existing;
      if r is null then
        insert into vppsone.collection_requests(session_label,title_hi,title_en,class_label,assigned_staff_id,token,due_date,status,audience_kind,audience_label,created_by)
          values(v_session,v.payload->>'title',v.payload->>'title',g->>'label',(g->>'teacherId')::uuid,
            replace(gen_random_uuid()::text,'-',''),(v.payload->>'dueDate')::date,'open','list',g->>'label',v_user) returning id into r;
        foreach f in array v_fields loop insert into vppsone.collection_request_fields(request_id,field_id) values(r,f); end loop;
        -- SQL joins avoid URL/filter limits. Only approved student_records override fee values.
        insert into vppsone.collection_request_members(request_id,student_id,roll_no,snapshot)
          select r,e.student_id,e.roll_no,coalesce((select jsonb_object_agg(cf.key,coalesce(sr.value,to_jsonb(s)->>cf.fee_column))
            from vppsone.collection_fields cf left join vppsone.student_records sr on sr.student_id=e.student_id and sr.field_id=cf.id
            where cf.id=any(v_fields)),'{}'::jsonb)
          from vppsone.enrolments e join public.students s on s.id=e.student_id
          where e.session_label=v_session and e.status='enrolled' and e.student_id=any(v_ids);
      end if;
    end if;
    -- A concurrent roster change must not silently shrink the committed list.
    if v_kind='collection' and v_ids is distinct from (select array_agg(cm.student_id order by cm.student_id)
      from vppsone.collection_request_members cm where cm.request_id=r) then raise exception 'tasks:selection_changed'; end if;
    insert into vppsone.teacher_tasks(session_label,kind,source_key,request_id,paper_id,class_id,day,scope,assigned_staff_id,title,due_date,created_by)
      values(v_session,v_kind,v_key,r,case when v_kind='marks' then v_paper.id end,
        case when v_kind='attendance' then (g->'scope'->>'value')::uuid end,
        case when v_kind='attendance' then (v.payload->>'day')::date end,g->'scope',(g->>'teacherId')::uuid,
        v.payload->>'title',(v.payload->>'dueDate')::date,p_actor) returning * into t;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('id',t.id,'reused',false,'teacherId',t.assigned_staff_id));
  end loop;
  update vppsone.teacher_task_previews set result=v_result where id=v.id;
  return v_result;
end; $$;

-- Narrower policy for this new workflow: only an active administrator can
-- decide its proposals, including through the existing bulk review RPC.
-- A refusal rolls back the entire accept_submissions transaction/official write.
create function vppsone.guard_teacher_task_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and old.status<>'pending' and new.status='pending'
    and exists(select 1 from vppsone.teacher_tasks t where t.request_id=new.request_id) then return old; end if;
  if new.status='pending' and exists(select 1 from vppsone.teacher_tasks t where t.request_id=new.request_id
    and not vppsone.teacher_task_access(t.id,t.assigned_staff_id,null)) then raise exception 'tasks:not_permitted'; end if;
  if new.status<>'pending' and exists(select 1 from vppsone.teacher_tasks t where t.request_id=new.request_id)
    and not exists(select 1 from vppsone.staff_profiles s where s.id=new.decided_by and s.is_active and s.role='admin')
    then raise exception 'tasks:admin_review_required'; end if;
  return new;
end; $$;
create trigger teacher_task_review_admin before insert or update on vppsone.collection_submissions
  for each row execute function vppsone.guard_teacher_task_review();
revoke all on function vppsone.guard_teacher_task_review() from public,anon,authenticated;

-- A task link can only call the same canonical audited writers as login.
create function vppsone.save_teacher_task(p_id uuid, p_staff uuid, p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t vppsone.teacher_tasks%rowtype;
begin
  select * into t from vppsone.teacher_tasks where id=p_id for update;
  if not found or not vppsone.teacher_task_access(p_id,p_staff,p_token) then return jsonb_build_object('ok',false,'reason','not_permitted'); end if;
  if t.kind='marks' then
    if p->>'paper_id' is distinct from t.paper_id::text or p->>'kind' not in ('draft','submit','correction') then return jsonb_build_object('ok',false,'reason','not_permitted'); end if;
    return vppsone.save_marks(p||jsonb_build_object('actor_staff_id',t.assigned_staff_id));
  elsif t.kind='attendance' then
    if p->>'class_id' is distinct from t.class_id::text or p->>'day' is distinct from t.day::text
      or p->>'session_label' is distinct from t.session_label then return jsonb_build_object('ok',false,'reason','not_permitted'); end if;
    return vppsone.save_attendance_register((p-'correction_request_id'-'decision_note')||jsonb_build_object('actor_staff_id',t.assigned_staff_id));
  end if;
  return jsonb_build_object('ok',false,'reason','bad_request');
end; $$;

-- Shared submission handler, including /r links. Upsert preserves decided rows
-- in the transaction, so an offline retry cannot reopen an approved answer.
create function vppsone.record_collection_answers(p_request uuid, p_token text, p_answers jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r vppsone.collection_requests%rowtype; t vppsone.teacher_tasks%rowtype; n integer;
begin
  select * into t from vppsone.teacher_tasks where request_id=p_request for update;
  if found and not vppsone.teacher_task_access(t.id,t.assigned_staff_id,null) then raise exception 'tasks:not_permitted'; end if;
  select * into r from vppsone.collection_requests where id=p_request for update;
  if not found or r.status<>'open' or r.archived_at is not null or r.token is distinct from p_token then raise exception 'tasks:not_permitted'; end if;
  if r.assigned_staff_id is not null and not exists(select 1 from vppsone.staff_profiles s where s.id=r.assigned_staff_id and s.is_active) then raise exception 'tasks:not_permitted'; end if;
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers)>40000 then raise exception 'tasks:bad_request'; end if;
  if exists(select 1 from jsonb_array_elements(p_answers) a where
    not exists(select 1 from vppsone.collection_request_fields f where f.request_id=r.id and f.field_id=(a->>'fieldId')::uuid)
    or not (exists(select 1 from vppsone.collection_request_members m where m.request_id=r.id and m.student_id=(a->>'studentId')::uuid)
      or (not exists(select 1 from vppsone.collection_request_members m where m.request_id=r.id)
        and exists(select 1 from vppsone.enrolments e where e.session_label=r.session_label and e.class_id=r.class_id and e.status='enrolled' and e.student_id=(a->>'studentId')::uuid)))) then raise exception 'tasks:out_of_scope'; end if;
  insert into vppsone.collection_submissions(request_id,student_id,field_id,value,previous_value,status,submitted_at)
    select r.id,(a->>'studentId')::uuid,(a->>'fieldId')::uuid,a->>'value',a->>'previousValue','pending',now()
    from jsonb_array_elements(p_answers) a
    on conflict(request_id,student_id,field_id) do update set value=excluded.value,submitted_at=excluded.submitted_at
    where vppsone.collection_submissions.status='pending';
  get diagnostics n=row_count; return n;
end; $$;

create function vppsone.manage_teacher_task(p_actor uuid, p_id uuid, p_teacher uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t vppsone.teacher_tasks%rowtype;
begin
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role
    where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  select * into t from vppsone.teacher_tasks where id=p_id for update;
  if not found then raise exception 'tasks:not_found'; end if;
  if p_teacher is not null and not vppsone.teacher_task_owner(p_teacher,t.session_label,t.scope,t.kind) then raise exception 'tasks:not_owner'; end if;
  update vppsone.teacher_tasks set assigned_staff_id=coalesce(p_teacher,assigned_staff_id),
    revoked_at=case when p_teacher is null then now() end, opened_at=null,
    token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') where id=p_id;
  if t.request_id is not null then
    update vppsone.collection_requests set assigned_staff_id=coalesce(p_teacher,assigned_staff_id),
      status=case when p_teacher is null then 'closed'::vppsone.request_status else 'open'::vppsone.request_status end,
      token=replace(gen_random_uuid()::text,'-',''),token_rotated_at=now() where id=t.request_id;
  end if;
end; $$;

-- An explicit new round keeps decided proposals immutable. Revoke and create
-- happen in one transaction; failure preserves the previous usable request.
create function vppsone.restart_teacher_task(p_actor uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t vppsone.teacher_tasks%rowtype; v_ids jsonb; v_fields jsonb; v_members jsonb; preview jsonb; result jsonb;
begin
  select * into t from vppsone.teacher_tasks where id=p_id for update;
  if not found or t.kind<>'collection' then raise exception 'tasks:bad_request'; end if;
  if not vppsone.teacher_task_owner(t.assigned_staff_id,t.session_label,t.scope,t.kind) then raise exception 'tasks:assignment_changed'; end if;
  select jsonb_agg(student_id order by student_id) into v_ids from vppsone.collection_request_members where request_id=t.request_id;
  select jsonb_agg(field_id order by field_id) into v_fields from vppsone.collection_request_fields where request_id=t.request_id;
  select jsonb_agg(jsonb_build_object('id',e.student_id,'classId',e.class_id,'house',to_jsonb(s)->>'house','routeId',to_jsonb(s)->>'transport_route_id') order by e.student_id)
    into v_members from vppsone.collection_request_members cm join vppsone.enrolments e on e.student_id=cm.student_id
      and e.session_label=t.session_label and e.status='enrolled' join public.students s on s.id=e.student_id where cm.request_id=t.request_id;
  preview:=vppsone.prepare_teacher_tasks(p_actor,jsonb_build_object('session',t.session_label,'kind','collection','freshRound',true,'title',t.title,'dueDate',null,
    'fieldIds',v_fields,'groups',jsonb_build_array(jsonb_build_object('teacherId',t.assigned_staff_id,'label',t.title,'scope',t.scope,'studentIds',v_ids,'members',v_members))));
  perform vppsone.manage_teacher_task(p_actor,p_id,null);
  result:=vppsone.create_teacher_tasks(p_actor,(preview->>'id')::uuid,preview->>'digest');
  return result->0;
end; $$;
revoke all on function vppsone.restart_teacher_task(uuid,uuid) from public,anon,authenticated;
grant execute on function vppsone.restart_teacher_task(uuid,uuid) to service_role;

revoke all on function vppsone.teacher_task_owner(uuid,text,jsonb,text),vppsone.teacher_task_access(uuid,uuid,text),
  vppsone.prepare_teacher_tasks(uuid,jsonb),vppsone.create_teacher_tasks(uuid,uuid,text),vppsone.save_teacher_task(uuid,uuid,text,jsonb),
  vppsone.record_collection_answers(uuid,text,jsonb),vppsone.manage_teacher_task(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function vppsone.teacher_task_owner(uuid,text,jsonb,text),vppsone.teacher_task_access(uuid,uuid,text),
  vppsone.prepare_teacher_tasks(uuid,jsonb),vppsone.create_teacher_tasks(uuid,uuid,text),vppsone.save_teacher_task(uuid,uuid,text,jsonb),
  vppsone.record_collection_answers(uuid,text,jsonb),vppsone.manage_teacher_task(uuid,uuid,uuid) to service_role;
