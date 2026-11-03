-- Resolve academic identities through the One-owned live projection while
-- preserving the isolated local TEST engine. Never change financial functions.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create view vppsone.fees_identity_students with (security_invoker=true) as
  select s.* from public.students s join public.classes c on c.id=s.class_id
  where not coalesce((select enabled from vppsone.fees_bridge_state where id),false)
     or vppsone.is_test_session(c.session_label)
  union all
  select (jsonb_populate_record(null::public.students,b.fields)).*
  from vppsone.fees_bridge_students b
  where coalesce((select enabled and live_read_ready and last_error_code is null
      and last_checked_at>=clock_timestamp()-interval '5 minutes' from vppsone.fees_bridge_state where id),false)
    and not vppsone.is_test_session(b.session_label)
  union all
  select (jsonb_populate_record(null::public.students,b.fields || jsonb_build_object('status','left'))).*
  from vppsone.fees_bridge_retired_students b
  where coalesce((select enabled and live_read_ready and last_error_code is null
      and last_checked_at>=clock_timestamp()-interval '5 minutes' from vppsone.fees_bridge_state where id),false)
    and not vppsone.is_test_session(b.session_label);

create view vppsone.fees_identity_classes with (security_invoker=true) as
  select c.* from public.classes c
  where not coalesce((select enabled from vppsone.fees_bridge_state where id),false)
     or vppsone.is_test_session(c.session_label)
  union all
  select (jsonb_populate_record(null::public.classes,b.fields)).*
  from vppsone.fees_bridge_classes b
  where coalesce((select enabled and live_read_ready and last_error_code is null
      and last_checked_at>=clock_timestamp()-interval '5 minutes' from vppsone.fees_bridge_state where id),false)
    and not vppsone.is_test_session(b.session_label)
  union all
  select (jsonb_populate_record(null::public.classes,b.fields)).*
  from vppsone.fees_bridge_retired_classes b
  where coalesce((select enabled and live_read_ready and last_error_code is null
      and last_checked_at>=clock_timestamp()-interval '5 minutes' from vppsone.fees_bridge_state where id),false)
    and not vppsone.is_test_session(b.session_label);
revoke all on vppsone.fees_identity_students,vppsone.fees_identity_classes from public,anon,authenticated;
grant select on vppsone.fees_identity_students,vppsone.fees_identity_classes to service_role;

-- An explicit allowlist preserves the latest deployed authorization/body of
-- each academic function, changing only the two identity relation references.
-- Financial gates, receipt functions and financial recovery stay untouched.
do $$
declare signature text; object_id oid; definition text; rewritten text;
begin
  foreach signature in array array[
    'vppsone.apply_sampark_row(uuid,integer,uuid,uuid)',
    'vppsone.claim_staff_notice(text,integer,text,uuid,boolean)',
    'vppsone.create_teacher_tasks(uuid,uuid,text)',
    'vppsone.place_student_photo(jsonb)',
    'vppsone.resolve_sampark_row(jsonb)',
    'vppsone.restart_teacher_task(uuid,uuid)',
    'vppsone.student_in_visible_session(uuid)',
    'vppsone.student_notice_facts(uuid)',
    'vppsone.teacher_task_access(uuid,uuid,text)',
    'vppsone.teacher_task_delivery_snapshot(uuid)'
  ] loop
    object_id:=to_regprocedure(signature);
    if object_id is null then raise exception 'Academic bridge dependency missing: %',signature; end if;
    definition:=pg_get_functiondef(object_id);
    rewritten:=replace(replace(definition,'public.students','vppsone.fees_identity_students'),
      'public.classes','vppsone.fees_identity_classes');
    if definition=rewritten then raise exception 'Academic bridge expected reference missing: %',signature; end if;
    execute rewritten;
  end loop;
end;
$$;
-- In coexistence, an unknown UUID must not inherit real visibility. This also
-- ensures current source-dependent academic policies fail closed on stale data.
create or replace function vppsone.student_in_visible_session(p_student_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_student_id is null or case
    when coalesce((select enabled from vppsone.fees_bridge_state where id),false) then
      exists(select 1 from vppsone.fees_identity_students s
        join vppsone.fees_identity_classes c on c.id=s.class_id
        where s.id=p_student_id and (vppsone.is_real_admin()
          or vppsone.is_test_session(c.session_label)=vppsone.current_is_test_account()))
    else vppsone.is_real_admin() or coalesce(
      (select vppsone.is_test_session(c.session_label)=vppsone.current_is_test_account()
        from public.students s join public.classes c on c.id=s.class_id where s.id=p_student_id),
      not vppsone.current_is_test_account()) end;
$$;
notify pgrst,'reload schema';
commit;
