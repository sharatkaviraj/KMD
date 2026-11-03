-- ============================================================================
-- VPPS One fee-migration (One-only): a TEST ACCOUNT writes fee rows only for
-- TEST-session students, over every API path (Phase 3, D-340, owner T1;
-- PR #143 review).
--
-- Why this differs from the fees app: the fees app has no test accounts. On
-- One's database test accounts are real logins (the 39 QA / Smoke Lab /
-- day-run profiles), and D-350 derives their public.users role from their One
-- role — so a test admin is fee role admin, a test accountant is accountant,
-- a test fee collector is fee_collector. Fee RLS is permission-only (no
-- session condition), so their JWT could INSERT / UPDATE / DELETE real fee
-- rows over PostgREST directly, past the app's fence, and the D-347 triggers
-- only ask whether real writes are open (fee_writes_enabled), which they will
-- be from go-live.
--
-- Why not give test accounts view_only instead (the review's option b): the
-- app's fee screens write through the signed-in person's own client, so a
-- view_only test accountant could not post a TEST payment — and testing in
-- TEST-2026-27 is what test accounts are for (T1). The role stays; the
-- session is fenced, row by row:
--
--  * vppsone.fee_money_row_guard() (every money table, D-347) now also
--    refuses, whenever a test account is signed in, an OLD or NEW row whose
--    student is not in a TEST session — fee_writes_enabled or not.
--  * public.students: a test account may insert, change or delete a student
--    only in a TEST class (old and new class).
--  * public.classes, public.academic_sessions: only TEST-labelled rows. This
--    also stops a test admin making TEST-2026-27 the current session (the
--    single-current trigger updates the real rows, and is refused).
--  * public.app_settings: a test account writes only keys that name a TEST
--    session (the reminder screen's per-session "last used" key); never
--    active_session_label or the school's WhatsApp switches.
--
-- WHO: requests that came through the API (vppsone.request_via_api()) AND
-- carry a signed-in test account (vppsone.current_is_test_account(): the
-- JWT's auth.uid() → an active staff profile with is_test_account). The
-- service role has no auth.uid() and is fenced by the app; the owner's own
-- sessions (migrations, the mirror loader, pg_cron) are not touched. A real
-- account pays one indexed lookup (staff_profiles.user_id is unique).
--
-- Proof: scripts/verify-test-session-fence.sql, cases J–N, rolled back.
--
-- Rollback:
--   drop trigger test_account_student_guard on public.students;
--   drop trigger test_account_session_row_guard on public.classes;
--   drop trigger test_account_session_row_guard on public.academic_sessions;
--   drop trigger test_account_settings_guard on public.app_settings;
--   drop function vppsone.test_account_student_guard(),
--     vppsone.test_account_session_row_guard(),
--     vppsone.test_account_settings_guard(),
--     vppsone.assert_test_account_may_write_student(uuid),
--     vppsone.assert_test_account_may_write_session(text);
--   and restore vppsone.fee_money_row_guard() from 20261030230200.
-- ============================================================================

create or replace function vppsone.assert_test_account_may_write_session(p_session_label text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not vppsone.is_test_session(p_session_label) then
    raise exception 'A test account changes only TEST-session data.'
      using errcode = '42501',
            hint = 'Sign in with a real account to change a real session (D-340).';
  end if;
end;
$$;

-- No student, no class or no session: refused (fail closed for a test account).
create or replace function vppsone.assert_test_account_may_write_student(p_student_id uuid)
returns void
language sql
stable
security definer
set search_path = ''
as $$
  select vppsone.assert_test_account_may_write_session(
    (select c.session_label
       from public.students s
       join public.classes c on c.id = s.class_id
      where s.id = p_student_id)
  );
$$;

revoke all on function vppsone.assert_test_account_may_write_session(text) from public, anon;
revoke all on function vppsone.assert_test_account_may_write_student(uuid) from public, anon;
grant execute on function vppsone.assert_test_account_may_write_session(text) to authenticated, service_role;
grant execute on function vppsone.assert_test_account_may_write_student(uuid) to authenticated, service_role;

/* ------------------------------------------- money rows: the D-347 guard + */

create or replace function vppsone.fee_money_row_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if vppsone.request_via_api() then
    -- A test account: TEST-session students only, old row and new.
    if vppsone.current_is_test_account() then
      if tg_op in ('UPDATE', 'DELETE') then
        perform vppsone.assert_test_account_may_write_student(old.student_id);
      end if;
      if tg_op in ('INSERT', 'UPDATE') then
        perform vppsone.assert_test_account_may_write_student(new.student_id);
      end if;
    end if;
    -- Everybody: real-session writes only while they are open (D-345).
    if not vppsone.fee_writes_open() then
      if tg_op in ('UPDATE', 'DELETE') then
        perform vppsone.assert_fee_writes_allowed(old.student_id);
      end if;
      if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.student_id is distinct from old.student_id) then
        perform vppsone.assert_fee_writes_allowed(new.student_id);
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

/* ------------------------------------------------------------- students */

create or replace function vppsone.test_account_student_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if vppsone.request_via_api() and vppsone.current_is_test_account() then
    if tg_op in ('UPDATE', 'DELETE') then
      select c.session_label into v_label from public.classes c where c.id = old.class_id;
      perform vppsone.assert_test_account_may_write_session(v_label);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      select c.session_label into v_label from public.classes c where c.id = new.class_id;
      perform vppsone.assert_test_account_may_write_session(v_label);
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function vppsone.test_account_student_guard() from public, anon, authenticated;

drop trigger if exists test_account_student_guard on public.students;
create trigger test_account_student_guard
  before insert or update or delete on public.students
  for each row execute function vppsone.test_account_student_guard();

/* ------------------------------------- classes and academic sessions */

create or replace function vppsone.test_account_session_row_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if vppsone.request_via_api() and vppsone.current_is_test_account() then
    if tg_op in ('UPDATE', 'DELETE') then
      perform vppsone.assert_test_account_may_write_session(old.session_label);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform vppsone.assert_test_account_may_write_session(new.session_label);
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function vppsone.test_account_session_row_guard() from public, anon, authenticated;

drop trigger if exists test_account_session_row_guard on public.classes;
create trigger test_account_session_row_guard
  before insert or update or delete on public.classes
  for each row execute function vppsone.test_account_session_row_guard();

drop trigger if exists test_account_session_row_guard on public.academic_sessions;
create trigger test_account_session_row_guard
  before insert or update or delete on public.academic_sessions
  for each row execute function vppsone.test_account_session_row_guard();

/* ------------------------------------------------------------ settings */

create or replace function vppsone.test_account_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if vppsone.request_via_api() and vppsone.current_is_test_account() then
    if (tg_op <> 'INSERT' and old.key !~* '(TEST|UAT|DEMO)-[0-9]{4}-[0-9]{2}')
       or (tg_op <> 'DELETE' and new.key !~* '(TEST|UAT|DEMO)-[0-9]{4}-[0-9]{2}') then
      raise exception 'A test account changes only settings that belong to a TEST session.'
        using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function vppsone.test_account_settings_guard() from public, anon, authenticated;

drop trigger if exists test_account_settings_guard on public.app_settings;
create trigger test_account_settings_guard
  before insert or update or delete on public.app_settings
  for each row execute function vppsone.test_account_settings_guard();
