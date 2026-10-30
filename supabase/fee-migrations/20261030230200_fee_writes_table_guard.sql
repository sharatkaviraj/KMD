-- ============================================================================
-- VPPS One fee-migration (One-only): the fee writes switch also guards the
-- money TABLES, and only the database owner can turn it (D-345, D-346;
-- critique0 #24; review of PR #141).
--
-- Why this differs from the fees app: the fees app has no switch at all (see
-- 20261030230000_fee_writes_guard.sql). That file put the guard at the top of
-- the 15 money RPCs. Two doors were still open over PostgREST:
--
--  1. Direct table writes. `authenticated` holds INSERT/UPDATE/DELETE on the
--     money tables (private.post_student_payment_core is SECURITY INVOKER and
--     inserts as the caller, so the grants cannot simply be revoked), and RLS
--     lets anybody with 'payments:write' / 'fees:write' / … write them. So an
--     accountant with the anon key and their own JWT could insert a payment
--     for a real student during mirror mode. Now a BEFORE row trigger on every
--     table that carries fee money for a student asks the same question the
--     RPCs ask — vppsone.assert_fee_writes_allowed(student_id), for the OLD
--     row and for the NEW one — and a statement trigger refuses TRUNCATE.
--     Moving a student across the TEST/real boundary (students.class_id) or
--     relabelling a class across it (classes.session_label) is refused too
--     while real writes are closed: otherwise "move a real student into a TEST
--     class, post, move back" walks round the TEST exemption.
--
--  2. The switch itself. It lives in public.app_settings, which any admin can
--     write over PostgREST ('settings:write' policies; has_permission() is
--     true for every permission of an admin). Now the key `fee_writes_enabled`
--     can be inserted, changed or deleted only by a session that did not come
--     through the API — the owner in the SQL editor / MCP, as postgres — the
--     same rule as vppsone.deployment. Not anon, not authenticated, not even
--     the service role (no app screen sets it).
--
-- WHO THE TABLE TRIGGERS APPLY TO: every request that came through the API
-- (session_user 'authenticator', or a request.jwt.claims role is present):
-- anon, authenticated AND service_role. The rule is the one the app's fetch
-- guard and the RPC preambles already apply, so a write those allow, this
-- allows. Not to the database owner's own sessions (no JWT): migrations, the
-- mirror loader (scripts/migrate/lib/one-db.mjs connects as postgres) and
-- pg_cron. The cron jobs that move money call RPCs, which keep their preamble.
--
-- CHEAP WHEN OPEN: the triggers first ask vppsone.fee_writes_open() (one
-- app_settings row, one deployment row). Today (marker 'dev', key unset) that
-- is true and no per-student lookup happens.
--
-- Proof: scripts/migrate/verify-fee-writes-guard.sql (cases E–H), rolled back.
--
-- Rollback:
--   drop trigger fee_writes_row_guard on each table listed below;
--   drop trigger fee_writes_truncate_guard on each table listed below;
--   drop trigger fee_writes_class_move_guard on public.students;
--   drop trigger fee_writes_class_relabel_guard on public.classes;
--   drop trigger fee_writes_switch_owner_only on public.app_settings;
--   drop function vppsone.fee_money_row_guard(), vppsone.fee_money_truncate_guard(),
--     vppsone.fee_student_class_move_guard(), vppsone.fee_class_relabel_guard(),
--     vppsone.fee_writes_switch_owner_only(), vppsone.request_via_api(),
--     vppsone.fee_writes_open();
--   and restore fee_writes_allowed_for_session from 20261030230000.
-- ============================================================================

/* ------------------------------------------------------------ the rule */

-- Real-session fee writes are open: the key is not 'false', and on a
-- production database it is exactly 'true'.
create or replace function vppsone.fee_writes_open()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_setting text;
begin
  select lower(trim(a.value)) into v_setting
  from public.app_settings a
  where a.key = 'fee_writes_enabled';

  if v_setting = 'false' then
    return false;
  end if;
  if vppsone.is_production() and v_setting is distinct from 'true' then
    return false;
  end if;
  return true;
end;
$$;

comment on function vppsone.fee_writes_open() is
  'Are real-session fee writes open now? app_settings.fee_writes_enabled and vppsone.is_production() (D-345). TEST sessions are writable regardless.';

-- The same rule as before, now said once.
create or replace function vppsone.fee_writes_allowed_for_session(p_session_label text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select vppsone.is_test_session_label(p_session_label) or vppsone.fee_writes_open();
$$;

revoke all on function vppsone.fee_writes_open() from public, anon;
grant execute on function vppsone.fee_writes_open() to authenticated, service_role;

-- Did this statement come through the API (PostgREST / Supabase clients)?
-- session_user is 'authenticator' for every PostgREST request whatever role it
-- switches to, and SECURITY DEFINER does not change session_user. The claims
-- check also catches a postgres session that is impersonating a signed-in user
-- (the verify script does exactly that).
create or replace function vppsone.request_via_api()
returns boolean
language sql
stable
set search_path = ''
as $$
  select session_user::text = 'authenticator'
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> '';
$$;

revoke all on function vppsone.request_via_api() from public, anon;
grant execute on function vppsone.request_via_api() to authenticated, service_role;

/* ------------------------------------------------- money rows, row by row */

create or replace function vppsone.fee_money_row_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if vppsone.request_via_api() and not vppsone.fee_writes_open() then
    if tg_op in ('UPDATE', 'DELETE') then
      perform vppsone.assert_fee_writes_allowed(old.student_id);
    end if;
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.student_id is distinct from old.student_id) then
      perform vppsone.assert_fee_writes_allowed(new.student_id);
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function vppsone.fee_money_truncate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if vppsone.request_via_api() and not vppsone.fee_writes_open() then
    raise exception 'Fee changes are switched off on this database until go-live (fee_writes_enabled). % cannot be truncated.', tg_table_name
      using errcode = 'VPP01';
  end if;
  return null;
end;
$$;

revoke all on function vppsone.fee_money_row_guard() from public, anon, authenticated;
revoke all on function vppsone.fee_money_truncate_guard() from public, anon, authenticated;

-- Every public table that holds fee money for a student (each has student_id;
-- checked against information_schema on 30 Oct). Payment-desk, ledger,
-- waiver, refund, repayment-plan, carry-forward and discount rows.
do $$
declare
  t text;
begin
  foreach t in array array[
    'payments', 'receipts', 'receipt_adjustments', 'payment_adjustments',
    'receipt_finance_adjustments', 'installments', 'student_fee_overrides',
    'student_carry_forward_balances', 'student_late_fee_waivers', 'refund_requests',
    'student_repayment_plans', 'student_repayment_plan_items', 'student_repayment_schedule',
    'student_repayment_emi_late_fees', 'student_repayment_receipt_links',
    'student_conventional_discount_assignments'
  ]
  loop
    execute format('drop trigger if exists fee_writes_row_guard on public.%I', t);
    execute format(
      'create trigger fee_writes_row_guard before insert or update or delete on public.%I '
      'for each row execute function vppsone.fee_money_row_guard()', t);
    execute format('drop trigger if exists fee_writes_truncate_guard on public.%I', t);
    execute format(
      'create trigger fee_writes_truncate_guard before truncate on public.%I '
      'for each statement execute function vppsone.fee_money_truncate_guard()', t);
  end loop;
end;
$$;

/* --------------------------------------- the TEST / real boundary itself */

create or replace function vppsone.fee_student_class_move_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text;
begin
  if new.class_id is not distinct from old.class_id
     or not vppsone.request_via_api()
     or vppsone.fee_writes_open() then
    return new;
  end if;
  select c.session_label into v_old from public.classes c where c.id = old.class_id;
  select c.session_label into v_new from public.classes c where c.id = new.class_id;
  if vppsone.is_test_session_label(v_old) is distinct from vppsone.is_test_session_label(v_new) then
    raise exception 'A student cannot be moved between a TEST session and a real one while fee changes are switched off (fee_writes_enabled).'
      using errcode = 'VPP01';
  end if;
  return new;
end;
$$;

create or replace function vppsone.fee_class_relabel_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_label is not distinct from old.session_label
     or not vppsone.request_via_api()
     or vppsone.fee_writes_open() then
    return new;
  end if;
  if vppsone.is_test_session_label(old.session_label) is distinct from vppsone.is_test_session_label(new.session_label) then
    raise exception 'A class cannot be moved between a TEST session and a real one while fee changes are switched off (fee_writes_enabled).'
      using errcode = 'VPP01';
  end if;
  return new;
end;
$$;

revoke all on function vppsone.fee_student_class_move_guard() from public, anon, authenticated;
revoke all on function vppsone.fee_class_relabel_guard() from public, anon, authenticated;

drop trigger if exists fee_writes_class_move_guard on public.students;
create trigger fee_writes_class_move_guard
  before update of class_id on public.students
  for each row execute function vppsone.fee_student_class_move_guard();

drop trigger if exists fee_writes_class_relabel_guard on public.classes;
create trigger fee_writes_class_relabel_guard
  before update of session_label on public.classes
  for each row execute function vppsone.fee_class_relabel_guard();

/* ------------------------------------------- the switch is the owner's */

create or replace function vppsone.fee_writes_switch_owner_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if ((tg_op <> 'INSERT' and old.key = 'fee_writes_enabled')
      or (tg_op <> 'DELETE' and new.key = 'fee_writes_enabled'))
     and vppsone.request_via_api() then
    raise exception 'fee_writes_enabled is set by the owner in the SQL editor, not from the app or the API (D-345).'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function vppsone.fee_writes_switch_owner_only() from public, anon, authenticated;

drop trigger if exists fee_writes_switch_owner_only on public.app_settings;
create trigger fee_writes_switch_owner_only
  before insert or update or delete on public.app_settings
  for each row execute function vppsone.fee_writes_switch_owner_only();

-- TRUNCATE public.app_settings would unset the key. Unset on production is
-- closed (fail closed); on dev it is already open. So it opens nothing, but
-- the API has no business truncating settings either.
drop trigger if exists fee_writes_switch_truncate_guard on public.app_settings;
create trigger fee_writes_switch_truncate_guard
  before truncate on public.app_settings
  for each statement execute function vppsone.fee_money_truncate_guard();
