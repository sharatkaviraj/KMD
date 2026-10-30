-- Proves the test-session fence (supabase/migrations/20261030155339_test_session_visibility.sql)
-- under real JWT claims. Run as postgres (SQL editor / MCP execute_sql). It
-- changes nothing: everything happens inside BEGIN … ROLLBACK, and the last
-- statement returns one row per case with pass = true/false.
--
-- Accounts are picked by role, never by name: the owner's account (the one
-- active admin outside @qa.vpps.local), a QA admin, and a QA teacher. Inside
-- the transaction the QA admin and teacher are flipped to test accounts, which
-- is what scripts/mark-qa-test-accounts.mjs does for real.
--
-- Cases
--   A  real admin reads notes in both 2026-27 and TEST-2026-27
--   B  a non-test teacher reads no TEST-2026-27 note
--   C  a test teacher reads no 2026-27 note, and TEST notes it may see
--   D  a test admin reads no 2026-27 note (critique0 #14: role admin is not enough)
--   E  a test account cannot insert a 2026-27 row (WITH CHECK), can insert a TEST one
--   F  a test admin cannot change any test flag through set_test_account
--   G  nobody signed in changes is_test_account by a direct UPDATE
--   H  the real admin cannot change its own flag; can change another's, and it is logged
--   I  child tables: a test account reads no 2026-27 attendance mark or mark
--   J  a test admin's JWT changes a TEST student, not a real one (public.students)
--   K  ... a TEST installment, not a real one (the money-row guard)
--   L  ... cannot insert a payment for a real student
--   M  ... cannot change active_session_label
--   N  change_staff_authority refuses a test admin changing a real profile

begin;

create temp table fence_results (case_id text, detail text, pass boolean) on commit drop;
grant all on fence_results to authenticated;

create temp table fence_ids on commit drop as
select
  (select sp.user_id from vppsone.staff_profiles sp join auth.users u on u.id = sp.user_id
    where sp.role = 'admin' and sp.is_active and u.email not like '%@qa.vpps.local' order by sp.created_at limit 1) as real_admin,
  (select sp.user_id from vppsone.staff_profiles sp join auth.users u on u.id = sp.user_id
    where sp.role = 'admin' and sp.is_active and u.email like '%@qa.vpps.local' order by sp.created_at limit 1) as qa_admin,
  (select sp.user_id from vppsone.staff_profiles sp join auth.users u on u.id = sp.user_id
    where sp.role = 'teacher' and sp.is_active and u.email like '%@qa.vpps.local' order by sp.created_at limit 1) as qa_teacher,
  (select sp.id from vppsone.staff_profiles sp join auth.users u on u.id = sp.user_id
    where sp.role = 'teacher' and sp.is_active and u.email like '%@qa.vpps.local' order by sp.created_at offset 1 limit 1) as other_profile,
  (select c.id from public.classes c where c.session_label = 'TEST-2026-27' order by c.id limit 1) as test_class;
grant select on fence_ids to authenticated;

-- Since scripts/mark-qa-test-accounts.mjs --apply the QA accounts ARE test
-- accounts. B needs a non-test teacher and H a non-test profile to flip, so
-- start these two as real staff (as postgres; rolled back with the rest).
update vppsone.staff_profiles set is_test_account = false
where user_id = (select qa_teacher from fence_ids) or id = (select other_profile from fence_ids);

-- A permissive insert policy for the duration, so WITH CHECK can be exercised
-- (One's own writes are service role; nothing in the app inserts as authenticated).
create policy fence_probe_insert on vppsone.class_aliases for insert to authenticated with check (true);
grant insert on vppsone.class_aliases to authenticated;

/* A: real admin */
select set_config('request.jwt.claims', json_build_object('sub', real_admin, 'role', 'authenticated')::text, true) from fence_ids;
set local role authenticated;
insert into fence_results
select 'A', format('real admin: is_real_admin=%s, notes real=%s test=%s', vppsone.is_real_admin(),
         count(*) filter (where not vppsone.is_test_session(session_label)),
         count(*) filter (where vppsone.is_test_session(session_label))),
       vppsone.is_real_admin() and count(*) filter (where vppsone.is_test_session(session_label)) > 0
         and count(*) filter (where not vppsone.is_test_session(session_label)) > 0
from vppsone.notes;
reset role;

/* B: a non-test teacher */
select set_config('request.jwt.claims', json_build_object('sub', qa_teacher, 'role', 'authenticated')::text, true) from fence_ids;
set local role authenticated;
insert into fence_results
select 'B', format('teacher (not test): class_aliases test rows=%s, real rows=%s',
         count(*) filter (where vppsone.is_test_session(session_label)),
         count(*) filter (where not vppsone.is_test_session(session_label))),
       count(*) filter (where vppsone.is_test_session(session_label)) = 0
         and count(*) filter (where not vppsone.is_test_session(session_label)) > 0
from vppsone.class_aliases;
reset role;

/* Flip the QA admin and the QA teacher to test accounts (as postgres). */
update vppsone.staff_profiles set is_test_account = true
where user_id in (select qa_admin from fence_ids union all select qa_teacher from fence_ids);

select set_config('request.jwt.claims', json_build_object('sub', qa_teacher, 'role', 'authenticated')::text, true) from fence_ids;
set local role authenticated;

/* E: WITH CHECK, as the test teacher */
do $$
declare v_class uuid := (select test_class from fence_ids);
begin
  begin
    insert into vppsone.class_aliases (class_id, session_label, timetable_label) values (v_class, '2026-27', 'FENCE-PROBE-REAL');
    insert into fence_results values ('E', 'test account inserted a 2026-27 row', false);
  exception when insufficient_privilege then
    insert into fence_results values ('E', 'test account refused a 2026-27 row', true);
  end;
  begin
    insert into vppsone.class_aliases (class_id, session_label, timetable_label) values (v_class, 'TEST-2026-27', 'FENCE-PROBE-TEST');
    insert into fence_results values ('E', 'test account inserted a TEST-2026-27 row', true);
  exception when others then
    insert into fence_results values ('E', 'test account refused a TEST row: ' || sqlerrm, false);
  end;
end $$;

/* C: test teacher reads its own TEST probe row and no real row */
insert into fence_results
select 'C', format('test teacher: class_aliases real rows=%s, test rows=%s',
         count(*) filter (where not vppsone.is_test_session(session_label)),
         count(*) filter (where vppsone.is_test_session(session_label))),
       count(*) filter (where not vppsone.is_test_session(session_label)) = 0
         and count(*) filter (where vppsone.is_test_session(session_label)) > 0
from vppsone.class_aliases;

/* I: child and grandchild tables */
insert into fence_results
select 'I', format('test teacher: real attendance_marks=%s, real marks=%s',
         (select count(*) from vppsone.attendance_marks m join vppsone.attendance_registers r on r.id = m.register_id where not vppsone.is_test_session(r.session_label)),
         (select count(*) from vppsone.marks)),
       (select count(*) from vppsone.attendance_marks) = 0 and (select count(*) from vppsone.marks) = 0;

/* G: no direct UPDATE of the flag */
do $$
begin
  update vppsone.staff_profiles set is_test_account = false where user_id = (select qa_teacher from fence_ids);
  insert into fence_results values ('G', 'direct update did not raise', false);
exception when insufficient_privilege then
  insert into fence_results values ('G', 'direct update of is_test_account refused', true);
end $$;
reset role;

/* D and F: test admin */
select set_config('request.jwt.claims', json_build_object('sub', qa_admin, 'role', 'authenticated')::text, true) from fence_ids;
set local role authenticated;
insert into fence_results
select 'D', format('test admin: is_real_admin=%s, can_see_test=%s, real class_aliases=%s',
         vppsone.is_real_admin(), vppsone.can_see_test_sessions(),
         count(*) filter (where not vppsone.is_test_session(session_label))),
       not vppsone.is_real_admin() and vppsone.can_see_test_sessions()
         and count(*) filter (where not vppsone.is_test_session(session_label)) = 0
from vppsone.class_aliases;
insert into fence_results
select 'F', 'test admin set_test_account -> ' || (r ->> 'reason'), r ->> 'reason' = 'not_real_admin'
from (select vppsone.set_test_account((select other_profile from fence_ids), true, 'probe') as r) x;
reset role;

/* H: real admin */
select set_config('request.jwt.claims', json_build_object('sub', real_admin, 'role', 'authenticated')::text, true) from fence_ids;
set local role authenticated;
insert into fence_results
select 'H', 'real admin on itself -> ' || (r ->> 'reason'), r ->> 'reason' = 'self'
from (select vppsone.set_test_account((select id from vppsone.staff_profiles where user_id = (select real_admin from fence_ids)), true, 'probe') as r) x;
insert into fence_results
select 'H', 'real admin without a reason -> ' || (r ->> 'reason'), r ->> 'reason' = 'reason_required'
from (select vppsone.set_test_account((select other_profile from fence_ids), true, '  ') as r) x;
insert into fence_results
select 'H', 'real admin on another -> ' || r::text, (r ->> 'ok')::boolean and (r ->> 'changed')::boolean
from (select vppsone.set_test_account((select other_profile from fence_ids), true, 'probe') as r) x;
reset role;
-- Logged once IN THIS TRANSACTION (changed_at = now(), the transaction's
-- start): mark-qa-test-accounts.mjs --apply logged its own row earlier.
insert into fence_results
select 'H', format('logged rows=%s, flag now=%s',
         (select count(*) from vppsone.staff_authority_changes where staff_profile_id = (select other_profile from fence_ids) and reason like 'is_test_account: false -> true.%' and changed_at = now()),
         (select is_test_account from vppsone.staff_profiles where id = (select other_profile from fence_ids))),
       (select count(*) from vppsone.staff_authority_changes where staff_profile_id = (select other_profile from fence_ids) and reason like 'is_test_account: false -> true.%' and changed_at = now()) = 1
         and (select is_test_account from vppsone.staff_profiles where id = (select other_profile from fence_ids));

/* J–N: a test account's writes to the fee tables (fee-migration 20261031000200)
   and to real staff (migration 20261030172156). Every write here is a no-op
   update or a refused insert, and the transaction rolls back anyway. */
create temp table fence_fee_ids on commit drop as
select
  (select sp.id from vppsone.staff_profiles sp where sp.user_id = (select qa_admin from fence_ids)) as qa_admin_profile,
  (select sp.id from vppsone.staff_profiles sp where sp.user_id = (select real_admin from fence_ids)) as real_admin_profile,
  (select s.id from public.students s join public.classes c on c.id = s.class_id
    where not vppsone.is_test_session(c.session_label) order by s.id limit 1) as real_student,
  (select s.id from public.students s join public.classes c on c.id = s.class_id
    where vppsone.is_test_session(c.session_label) order by s.id limit 1) as test_student,
  (select i.id from public.installments i join public.students s on s.id = i.student_id join public.classes c on c.id = s.class_id
    where not vppsone.is_test_session(c.session_label) order by i.id limit 1) as real_installment,
  (select i.id from public.installments i join public.students s on s.id = i.student_id join public.classes c on c.id = s.class_id
    where vppsone.is_test_session(c.session_label) order by i.id limit 1) as test_installment;
grant select on fence_fee_ids to authenticated;

update vppsone.staff_profiles set is_test_account = true where user_id = (select qa_admin from fence_ids);
select set_config('request.jwt.claims', json_build_object('sub', qa_admin, 'role', 'authenticated')::text, true) from fence_ids;
set local role authenticated;
do $$
declare ids record; n int;
begin
  select * into ids from fence_fee_ids;
  begin
    update public.students set updated_at = updated_at where id = ids.real_student;
    get diagnostics n = row_count;
    insert into fence_results values ('J', 'test admin, real student: rows=' || n, n = 0);
  exception when others then insert into fence_results values ('J', 'test admin, real student refused: ' || sqlerrm, true);
  end;
  begin
    update public.students set updated_at = updated_at where id = ids.test_student;
    get diagnostics n = row_count;
    insert into fence_results values ('J', 'test admin, TEST student: rows=' || n, n = 1);
  exception when others then insert into fence_results values ('J', 'test admin, TEST student refused: ' || sqlerrm, false);
  end;
  begin
    update public.installments set student_id = student_id where id = ids.real_installment;
    get diagnostics n = row_count;
    insert into fence_results values ('K', 'test admin, real installment: rows=' || n, n = 0);
  exception when others then insert into fence_results values ('K', 'test admin, real installment refused: ' || sqlerrm, true);
  end;
  begin
    update public.installments set student_id = student_id where id = ids.test_installment;
    get diagnostics n = row_count;
    insert into fence_results values ('K', 'test admin, TEST installment: rows=' || n, ids.test_installment is null or n = 1);
  exception when others then insert into fence_results values ('K', 'test admin, TEST installment refused: ' || sqlerrm, false);
  end;
  -- The guard runs BEFORE the row's own constraints: a refused insert says so,
  -- an allowed one gets as far as the next NOT NULL.
  begin
    insert into public.payments (student_id) values (ids.real_student);
    insert into fence_results values ('L', 'test admin inserted a real payment', false);
  exception when others then insert into fence_results values ('L', 'real payment insert: ' || sqlerrm, sqlerrm like 'A test account%');
  end;
  begin
    update public.app_settings set value = value where key = 'active_session_label';
    get diagnostics n = row_count;
    insert into fence_results values ('M', 'test admin, active_session_label: rows=' || n, n = 0);
  exception when others then insert into fence_results values ('M', 'test admin, active_session_label refused: ' || sqlerrm, true);
  end;
end;
$$;
reset role;
-- change_staff_authority is the service role's command; the actor is passed in.
insert into fence_results
select 'N', 'test admin demotes the real admin -> ' || coalesce(r ->> 'reason', r::text), r ->> 'reason' = 'test_account'
from (select vppsone.change_staff_authority((select qa_admin_profile from fence_fee_ids), (select real_admin_profile from fence_fee_ids), 'view_only', false, 'probe') as r) x;

select case_id, detail, pass from fence_results order by case_id;

rollback;
