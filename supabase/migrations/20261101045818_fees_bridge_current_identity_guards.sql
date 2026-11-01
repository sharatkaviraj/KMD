-- Historical tombstones are display-only. Current academic commands must not
-- gain authority from a deleted/left student or an old One class membership.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace view vppsone.fees_identity_students with (security_invoker=true) as
  select s.* from public.students s join public.classes c on c.id=s.class_id
  where not coalesce((select enabled from vppsone.fees_bridge_state where id),false)
     or vppsone.is_test_session(c.session_label)
  union all
  select (jsonb_populate_record(null::public.students,b.fields)).*
  from vppsone.fees_bridge_students b
  where coalesce((select enabled and live_read_ready and last_error_code is null
      and last_checked_at>=clock_timestamp()-interval '5 minutes' from vppsone.fees_bridge_state where id),false)
    and not vppsone.is_test_session(b.session_label);

create or replace view vppsone.fees_identity_classes with (security_invoker=true) as
  select c.* from public.classes c
  where not coalesce((select enabled from vppsone.fees_bridge_state where id),false)
     or vppsone.is_test_session(c.session_label)
  union all
  select (jsonb_populate_record(null::public.classes,b.fields)).*
  from vppsone.fees_bridge_classes b
  where coalesce((select enabled and live_read_ready and last_error_code is null
      and last_checked_at>=clock_timestamp()-interval '5 minutes' from vppsone.fees_bridge_state where id),false)
    and not vppsone.is_test_session(b.session_label);

-- TEST keeps its existing rules. A real current action requires a current
-- active source row and an explicitly matching academic enrolment. Source
-- transfers/leavers never rewrite historical enrolments or grant new access.
create view vppsone.fees_action_students with (security_invoker=true) as
  select s.* from vppsone.fees_identity_students s
  join vppsone.fees_identity_classes c on c.id=s.class_id
  where not coalesce((select enabled from vppsone.fees_bridge_state where id),false)
     or vppsone.is_test_session(c.session_label)
     or (s.status::text='active' and exists(
       select 1 from vppsone.enrolments e where e.student_id=s.id
         and e.session_label=c.session_label and e.class_id=s.class_id and e.status='enrolled'));
revoke all on vppsone.fees_action_students from public,anon,authenticated;
grant select on vppsone.fees_action_students to service_role;

-- Keep each deployed function's authorization and command logic. Only its
-- source identity lookup becomes current-action-only; public TEST behavior is
-- preserved by the action view above. History readers use explicit tombstones.
do $$
declare signature text; definition text; rewritten text;
begin
  foreach signature in array array[
    'vppsone.apply_sampark_row(uuid,integer,uuid,uuid)',
    'vppsone.claim_staff_notice(text,integer,text,uuid,boolean)',
    'vppsone.create_teacher_tasks(uuid,uuid,text)',
    'vppsone.place_student_photo(jsonb)',
    'vppsone.resolve_sampark_row(jsonb)',
    'vppsone.restart_teacher_task(uuid,uuid)',
    'vppsone.student_notice_facts(uuid)',
    'vppsone.teacher_task_access(uuid,uuid,text)'
  ] loop
    if to_regprocedure(signature) is null then raise exception 'Academic action dependency missing: %',signature; end if;
    definition:=pg_get_functiondef(to_regprocedure(signature));
    rewritten:=replace(definition,'vppsone.fees_identity_students','vppsone.fees_action_students');
    if definition=rewritten then raise exception 'Academic action expected reference missing: %',signature; end if;
    execute rewritten;
  end loop;
  -- Delivery snapshots only read a class label directly. Their authority is
  -- the guarded task check and canonical roster functions, so no student
  -- relation rewrite applies. Pin those dependencies instead of skipping an
  -- unexpected missing reference for every function in the allowlist.
  definition:=pg_get_functiondef('vppsone.teacher_task_delivery_snapshot(uuid)'::regprocedure);
  if position('vppsone.teacher_task_access(' in definition)=0
    or position('vppsone.paper_roster(' in definition)=0
    or position('vppsone.attendance_roster(' in definition)=0
    or position('vppsone.fees_identity_classes' in definition)=0 then
    raise exception 'Task delivery current authority dependency missing';
  end if;
end;
$$;

create function vppsone.assert_fees_bridge_roster_current(p_ids uuid[],p_class uuid,p_session text)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce((select enabled from vppsone.fees_bridge_state where id),false)
     or vppsone.is_test_session(p_session) then return; end if;
  if not exists(select 1 from vppsone.fees_identity_classes c where c.id=p_class and c.session_label=p_session)
    or exists(select 1 from unnest(p_ids) x(id) where not exists(
      select 1 from vppsone.fees_action_students s where s.id=x.id and s.class_id=p_class)) then
    raise exception 'bridge_academic_membership_changed';
  end if;
end;
$$;
revoke all on function vppsone.assert_fees_bridge_roster_current(uuid[],uuid,text) from public,anon,authenticated;
grant execute on function vppsone.assert_fees_bridge_roster_current(uuid[],uuid,text) to service_role;

-- The same roster is used to render and save. Refuse a drifted roster rather
-- than silently dropping children from a complete-register or exam command.
create or replace function vppsone.attendance_roster(p_session text,p_class uuid,p_day date)
returns setof uuid language plpgsql stable security definer set search_path='' as $$
declare ids uuid[];
begin
  select coalesce(array_agg(e.student_id order by e.student_id),'{}'::uuid[]) into ids
  from vppsone.enrolments e
  where e.session_label=p_session and e.class_id=p_class
    and (e.enrolled_on is null or e.enrolled_on<=p_day)
    and ((e.status in ('enrolled','promoted') and e.left_on is null)
      or (e.left_on is not null and e.left_on>=p_day));
  perform vppsone.assert_fees_bridge_roster_current(ids,p_class,p_session);
  return query select unnest(ids);
end;
$$;

create or replace function vppsone.paper_roster(p_paper uuid)
returns setof uuid language plpgsql stable security definer set search_path='' as $$
declare ids uuid[]; v_class uuid; v_session text;
begin
  select s.class_id,a.session_label into v_class,v_session
    from vppsone.assessment_subjects s join vppsone.assessments a on a.id=s.assessment_id where s.id=p_paper;
  if not found then return; end if;
  select coalesce(array_agg(e.student_id order by e.student_id),'{}'::uuid[]) into ids
  from vppsone.assessment_subjects s join vppsone.assessments a on a.id=s.assessment_id
  join vppsone.enrolments e on e.class_id=s.class_id and e.session_label=a.session_label
  where s.id=p_paper
    and (e.enrolled_on is null or e.enrolled_on<=coalesce(a.ends_on,a.starts_on,vppsone.school_today()))
    and ((e.status in ('enrolled','promoted') and e.left_on is null)
      or (e.left_on is not null and e.left_on>=coalesce(a.starts_on,a.ends_on,vppsone.school_today())));
  perform vppsone.assert_fees_bridge_roster_current(ids,v_class,v_session);
  return query select unnest(ids);
end;
$$;
notify pgrst,'reload schema';
commit;
