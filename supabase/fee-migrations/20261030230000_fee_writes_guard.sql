-- ============================================================================
-- VPPS One fee-migration (One-only): the fee writes switch, enforced in the
-- database (D-345; plan §2.7; critique0 #24).
--
-- Why this differs from the fees app: the fees app has no such switch. On
-- One's database the real fee data arrives by a nightly mirror of the fees app
-- (Phase 2) long before One is the system of record (T0). Until then a payment,
-- waiver or reversal posted in One against a real student would be silently
-- overwritten by the next mirror load — or worse, survive it and double a
-- family's money. An app-side flag alone does not stop that: the money RPCs
-- stay callable by `authenticated` over PostgREST (critique0 #24). So the RPCs
-- themselves ask first.
--
-- THE RULE — vppsone.fee_writes_allowed(p_student_id uuid default null):
--   1. A student in a TEST session (class -> session_label matches
--      vppsone.is_test_session_label) is ALWAYS writable. Testing happens on
--      this production database, under TEST-2026-27, during mirror mode too
--      (D-346, owner override T1).
--   2. Otherwise refused when public.app_settings 'fee_writes_enabled' = 'false'.
--   3. Otherwise refused when vppsone.is_production() and the key is not 'true'
--      (unset counts as not 'true': production fails closed).
--   4. Otherwise allowed (today: marker 'dev', key unset — nothing changes).
-- vppsone.fee_writes_allowed_for_session(label) is the same rule for a write
-- that names a session rather than a student.
-- A refusal raises SQLSTATE 'VPP01' with a sentence staff can read.
--
-- GUARDED (a guard line is inserted at the top of each body — enumerated from
-- the catalog: every public/private function that inserts, updates or deletes
-- payments, receipts, receipt_adjustments, payment_adjustments,
-- student_late_fee_waivers, refund_requests, student_repayment_*, installments
-- or student_fee_overrides; no family-payment, write-off, carry-forward or
-- prev-year import function exists in SQL on this database — those writes are
-- made by the app through the fee client and are refused there):
--   private.post_student_payment_core(uuid, date, payment_mode, integer, text, text, text, text, uuid, integer, integer)   by student
--     (covers public.post_student_payment_with_adjustments and
--      public.online_payment_apply_capture / online_payment_apply_order_capture,
--      which post only through it)
--   public.post_student_payment(uuid, date, payment_mode, integer, text, text, text, text, uuid)                            by student
--   public.post_corrected_payment(uuid, date, payment_mode, jsonb, uuid, text, text, text, text)                            by student
--   public.undo_recent_payment(uuid, text)                                         by the receipt's student
--   public.reverse_receipt_admin(uuid, text)                                       by the receipt's student
--   public.waive_late_fee(uuid, integer, text, text, uuid, uuid, boolean)          by student
--   private.online_waive_late_fees(uuid, text, date)                               by student
--   public.void_late_fee_waiver(uuid, text)                                        by the waiver's student
--   public.process_refund_with_adjustment(uuid)                                    by the refund's student
--   public.create_student_repayment_plan(uuid, text, text, integer, date, text, integer, uuid, uuid, date[])  by student
--   public.reschedule_student_repayment_plan(uuid, integer, date, text, integer, uuid, date[])                 by the plan's student
--   public.cancel_student_repayment_plan(uuid, text)                               by the plan's student
--   public.sync_repayment_plan_late_fees(text, boolean, date)                      by session, skipped for a dry run
--   public.import_student_batch_row(… 23 args) and (… 26 args)                     by the class's session
--
-- HOW: the bodies are not retyped here. vppsone.inject_fee_function_preamble()
-- inserts the guard as the first statement after the body's top-level `begin`
-- (each body has exactly one column-0 `begin` line — checked), replays the
-- function's own pg_get_functiondef() with that one change, and then proves
-- that removing the inserted lines gives back the original body byte for byte.
-- CREATE OR REPLACE keeps the oid, owner and grants. Re-running is a no-op:
-- a body that already carries the marker is skipped.
--
-- Not covered here, by design: the nightly EMI late-fee cron calls
-- sync_repayment_plan_late_fees for the active session and will be refused
-- (and log an error) while writes are off on production — correct during
-- mirror mode. The mirror loader itself writes rows, not RPCs.
--
-- Direct table writes over PostgREST and the switch key itself are guarded by
-- the follow-up 20261030230200_fee_writes_table_guard.sql (which also restates
-- fee_writes_allowed_for_session through vppsone.fee_writes_open()).
--
-- Proof: scripts/migrate/verify-fee-writes-guard.sql (one DO block that ends
-- by raising, so everything it did rolls back) — run through the MCP.
--
-- Rollback: for each function above,
--   select vppsone.remove_fee_function_preamble('<regprocedure>', '-- [vppsone:fee-writes-guard]');
-- then drop the functions created here.
-- ============================================================================

create or replace function vppsone.fee_writes_allowed_for_session(p_session_label text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_setting text;
begin
  if vppsone.is_test_session_label(p_session_label) then
    return true;
  end if;

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

create or replace function vppsone.fee_writes_allowed(p_student_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select vppsone.fee_writes_allowed_for_session(
    (select c.session_label
       from public.students s
       join public.classes c on c.id = s.class_id
      where s.id = p_student_id)
  );
$$;

comment on function vppsone.fee_writes_allowed(uuid) is
  'May fee money be written for this student now? TEST-session students always; others per app_settings.fee_writes_enabled and vppsone.is_production() (D-345).';

create or replace function vppsone.assert_fee_writes_allowed_for_session(p_session_label text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not vppsone.fee_writes_allowed_for_session(p_session_label) then
    raise exception 'Fee changes are switched off on this database until go-live (fee_writes_enabled). Only TEST-session students can be changed.'
      using errcode = 'VPP01',
            hint = 'An owner sets app_settings.fee_writes_enabled = ''true'' at T0 (D-345).';
  end if;
end;
$$;

create or replace function vppsone.assert_fee_writes_allowed(p_student_id uuid)
returns void
language sql
stable
security definer
set search_path = ''
as $$
  select vppsone.assert_fee_writes_allowed_for_session(
    (select c.session_label
       from public.students s
       join public.classes c on c.id = s.class_id
      where s.id = p_student_id)
  );
$$;

-- The guarded functions run as their own owners or as the caller; either way
-- they must be able to call the guard. The app reads it through the service
-- role. Nobody else needs it.
revoke all on function vppsone.fee_writes_allowed_for_session(text) from public, anon;
revoke all on function vppsone.fee_writes_allowed(uuid) from public, anon;
revoke all on function vppsone.assert_fee_writes_allowed_for_session(text) from public, anon;
revoke all on function vppsone.assert_fee_writes_allowed(uuid) from public, anon;
grant execute on function vppsone.fee_writes_allowed_for_session(text) to authenticated, service_role;
grant execute on function vppsone.fee_writes_allowed(uuid) to authenticated, service_role;
grant execute on function vppsone.assert_fee_writes_allowed_for_session(text) to authenticated, service_role;
grant execute on function vppsone.assert_fee_writes_allowed(uuid) to authenticated, service_role;

/* ------------------------------------------------- the preamble injector */

create or replace function vppsone.inject_fee_function_preamble(
  p_function regprocedure,
  p_marker text,
  p_preamble text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_src text;
  v_def text;
  v_insert text;
  v_new text;
  v_at integer;
  v_after text;
begin
  if p_marker !~ '^-- \[vppsone:[a-z0-9-]+\]$' then
    raise exception 'marker must look like -- [vppsone:name], got %', p_marker;
  end if;

  select p.prosrc into strict v_src from pg_catalog.pg_proc p where p.oid = p_function;

  if position(p_marker in v_src) > 0 then
    return 'already: ' || p_function::text;
  end if;

  if (select count(*) from regexp_matches(v_src, E'\nbegin\n', 'g')) <> 1 then
    raise exception '% does not have exactly one column-0 begin line; not rewriting it', p_function;
  end if;

  v_at := position(E'\nbegin\n' in v_src);
  v_insert := '  ' || p_marker || E'\n' || p_preamble || E'\n  -- [/vppsone]\n';
  v_new := substr(v_src, 1, v_at + 6) || v_insert || substr(v_src, v_at + 7);

  v_def := pg_catalog.pg_get_functiondef(p_function);
  if (length(v_def) - length(replace(v_def, v_src, ''))) <> length(v_src) then
    raise exception '% body does not appear exactly once in its definition; not rewriting it', p_function;
  end if;

  execute replace(v_def, v_src, v_new);

  select p.prosrc into strict v_after from pg_catalog.pg_proc p where p.oid = p_function;
  if v_after <> v_new or replace(v_after, v_insert, '') <> v_src then
    raise exception '% was not rewritten exactly as intended', p_function;
  end if;

  return 'guarded: ' || p_function::text;
end;
$$;

create or replace function vppsone.remove_fee_function_preamble(p_function regprocedure, p_marker text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_src text;
  v_def text;
  v_start integer;
  v_end integer;
  v_new text;
begin
  select p.prosrc into strict v_src from pg_catalog.pg_proc p where p.oid = p_function;
  v_start := position('  ' || p_marker || E'\n' in v_src);
  if v_start = 0 then
    return 'absent: ' || p_function::text;
  end if;
  v_end := position(E'  -- [/vppsone]\n' in substr(v_src, v_start));
  if v_end = 0 then
    raise exception '% has the marker but no end marker', p_function;
  end if;
  v_new := substr(v_src, 1, v_start - 1) || substr(v_src, v_start + v_end - 1 + length(E'  -- [/vppsone]\n'));
  v_def := pg_catalog.pg_get_functiondef(p_function);
  execute replace(v_def, v_src, v_new);
  return 'removed: ' || p_function::text;
end;
$$;

-- These rewrite fee functions. Only the database owner (postgres, through a
-- migration) may run them.
revoke all on function vppsone.inject_fee_function_preamble(regprocedure, text, text) from public, anon, authenticated, service_role;
revoke all on function vppsone.remove_fee_function_preamble(regprocedure, text) from public, anon, authenticated, service_role;

/* ------------------------------------------------------------ the guards */

select vppsone.inject_fee_function_preamble(f::regprocedure, '-- [vppsone:fee-writes-guard]', g)
from (values
  ('private.post_student_payment_core(uuid, date, payment_mode, integer, text, text, text, text, uuid, integer, integer)',
   '  perform vppsone.assert_fee_writes_allowed(p_student_id);'),
  ('public.post_student_payment(uuid, date, payment_mode, integer, text, text, text, text, uuid)',
   '  perform vppsone.assert_fee_writes_allowed(p_student_id);'),
  ('public.post_corrected_payment(uuid, date, payment_mode, jsonb, uuid, text, text, text, text)',
   '  perform vppsone.assert_fee_writes_allowed(p_student_id);'),
  ('public.undo_recent_payment(uuid, text)',
   '  perform vppsone.assert_fee_writes_allowed((select r.student_id from public.receipts r where r.id = p_receipt_id));'),
  ('public.reverse_receipt_admin(uuid, text)',
   '  perform vppsone.assert_fee_writes_allowed((select r.student_id from public.receipts r where r.id = p_receipt_id));'),
  ('public.waive_late_fee(uuid, integer, text, text, uuid, uuid, boolean)',
   '  perform vppsone.assert_fee_writes_allowed(p_student_id);'),
  ('private.online_waive_late_fees(uuid, text, date)',
   '  perform vppsone.assert_fee_writes_allowed(p_student_id);'),
  ('public.void_late_fee_waiver(uuid, text)',
   '  perform vppsone.assert_fee_writes_allowed((select w.student_id from public.student_late_fee_waivers w where w.id = p_waiver_id));'),
  ('public.process_refund_with_adjustment(uuid)',
   '  perform vppsone.assert_fee_writes_allowed((select q.student_id from public.refund_requests q where q.id = p_refund_request_id));'),
  ('public.create_student_repayment_plan(uuid, text, text, integer, date, text, integer, uuid, uuid, date[])',
   '  perform vppsone.assert_fee_writes_allowed(p_student_id);'),
  ('public.reschedule_student_repayment_plan(uuid, integer, date, text, integer, uuid, date[])',
   '  perform vppsone.assert_fee_writes_allowed((select pl.student_id from public.student_repayment_plans pl where pl.id = p_plan_id));'),
  ('public.cancel_student_repayment_plan(uuid, text)',
   '  perform vppsone.assert_fee_writes_allowed((select pl.student_id from public.student_repayment_plans pl where pl.id = p_plan_id));'),
  ('public.sync_repayment_plan_late_fees(text, boolean, date)',
   '  if not coalesce(p_dry_run, false) then perform vppsone.assert_fee_writes_allowed_for_session(p_session_label); end if;'),
  ('public.import_student_batch_row(uuid, integer, text, uuid, text, date, text, text, text, text, text, uuid, student_status, text, integer, integer, integer, integer, jsonb, integer, integer, text, boolean)',
   '  perform vppsone.assert_fee_writes_allowed_for_session((select c.session_label from public.classes c where c.id = p_class_id));'),
  ('public.import_student_batch_row(uuid, integer, text, uuid, text, date, text, text, text, text, text, uuid, student_status, text, integer, integer, integer, integer, jsonb, integer, integer, text, boolean, text, integer, integer)',
   '  perform vppsone.assert_fee_writes_allowed_for_session((select c.session_label from public.classes c where c.id = p_class_id));')
) as t(f, g);

-- The switch is a One-owned key: the mirror never copies it from the fees app
-- (registered in vppsone.one_owned_fee_settings by the deployment-marker
-- migration). It is not created here: unset means "dev: allowed; production:
-- refused", which is the state we want until the orchestrator sets it.
