-- ============================================================================
-- VPPS One fee-migration (One-only): One's online payments carry `vp1_`
-- references, and One never records or posts money on a fees app `vpps_` one
-- (go-live Phase E, plan §7.3, critique0 #2 and #32).
--
-- Why this differs from the fees app: Razorpay sends every event on the
-- school's one account to every registered webhook, so after cutover both apps
-- hear about every payment. The fees app mints `vpps_<intent uuid hex>` for a
-- Payment Link and `vpps_o_<uuid hex>` for a checkout order, and its own
-- check is `reference_id.startsWith('vpps_')`. One mints `vp1_…` and
-- `vp1_o_…` instead, so:
--   * the fees app reads every One payment as "not our link" and leaves it;
--   * One reads every fees payment as not its own — on the Payment Link path
--     by the same prefix check (REFERENCE_PREFIX = 'vp1_' in capture-check.ts),
--     and on the ORDER path, which matched on provider_order_id alone, by the
--     refusals below. A fees order brought in by the data load would
--     otherwise have been posted by One as well as by the fees app.
-- The app refuses `vpps_` too (processOrderPayment, reconcileOpenOrders, the
-- intents pass, applyCapture, applyOrderCapture); this is the database's half,
-- so a direct call or a future code path cannot post one either.
--
-- Lengths: `vp1_` + 32 hex = 36 characters, `vp1_o_` + 32 hex = 38, inside the
-- 40 Razorpay allows and the tables' own char_length(...) <= 40 checks.
--
-- WHAT changes:
--   public.online_payment_open_intent   mints 'vp1_'   (was 'vpps_')
--   public.online_payment_open_order    mints 'vp1_o_' (was 'vpps_o_')
--   public.online_payment_record_capture        refuses a vpps_ reference or a
--                                               link held by a vpps_ intent:
--                                               {recorded:false, reason:'not_ours'}
--   public.online_payment_record_order_capture  refuses an order whose
--                                               provider_receipt is vpps_…
--   public.online_payment_apply_capture         refuses a capture on a vpps_
--                                               intent: {applied:false, status:'not_ours'}
--   public.online_payment_apply_order_capture   refuses a capture on a vpps_o_ order
--
-- HOW: the two minting lines are swapped by vppsone.replace_in_fee_function()
-- (created here): it requires the old text exactly once, replays the
-- function's own pg_get_functiondef() with that one change, and proves that
-- swapping back gives the original body byte for byte. The four refusals are
-- first statements, put in by vppsone.inject_fee_function_preamble()
-- (20261030230000_fee_writes_guard.sql). CREATE OR REPLACE keeps the oid,
-- owner and grants. Re-running is a no-op.
--
-- Proof: scripts/migrate/verify-online-vp1-and-floor.sql (rolls back).
--
-- Rollback:
--   select vppsone.undo_replace_in_fee_function('public.online_payment_open_intent(uuid,uuid,smallint[],boolean,text,timestamp with time zone,text)',
--          '''vpps_'' || replace(v_id::text', '''vp1_'' /* [vppsone:vp1-ownership] */ || replace(v_id::text');
--   select vppsone.undo_replace_in_fee_function('public.online_payment_open_order(uuid,jsonb,text,text)',
--          '''vpps_o_'' || replace(gen_random_uuid()::text', '''vp1_o_'' /* [vppsone:vp1-ownership] */ || replace(gen_random_uuid()::text');
--   select vppsone.remove_fee_function_preamble('<each of the four>', '-- [vppsone:vp1-ownership]');
-- ============================================================================

create or replace function vppsone.replace_in_fee_function(
  p_function regprocedure,
  p_marker text,
  p_old text,
  p_new text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_src text;
  v_def text;
  v_new text;
  v_after text;
begin
  if p_marker !~ '^\[vppsone:[a-z0-9-]+\]$' then
    raise exception 'marker must look like [vppsone:name], got %', p_marker;
  end if;
  if position(p_marker in p_new) = 0 then
    raise exception 'the new text must carry the marker %', p_marker;
  end if;

  select p.prosrc into strict v_src from pg_catalog.pg_proc p where p.oid = p_function;

  if position(p_new in v_src) > 0 then
    return 'already: ' || p_function::text;
  end if;

  if (length(v_src) - length(replace(v_src, p_old, ''))) <> length(p_old) then
    raise exception '% does not contain the old text exactly once; not rewriting it', p_function;
  end if;

  v_new := replace(v_src, p_old, p_new);

  v_def := pg_catalog.pg_get_functiondef(p_function);
  if (length(v_def) - length(replace(v_def, v_src, ''))) <> length(v_src) then
    raise exception '% body does not appear exactly once in its definition; not rewriting it', p_function;
  end if;

  execute replace(v_def, v_src, v_new);

  select p.prosrc into strict v_after from pg_catalog.pg_proc p where p.oid = p_function;
  if v_after <> v_new or replace(v_after, p_new, p_old) <> v_src then
    raise exception '% was not rewritten exactly as intended', p_function;
  end if;

  return 'replaced: ' || p_function::text;
end;
$$;

comment on function vppsone.replace_in_fee_function(regprocedure, text, text, text) is
  'One-only fee-function edits (go-live Phase E): swap one exact piece of a fee function''s body, proven reversible.';

create or replace function vppsone.undo_replace_in_fee_function(
  p_function regprocedure,
  p_old text,
  p_new text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_src text;
  v_def text;
begin
  select p.prosrc into strict v_src from pg_catalog.pg_proc p where p.oid = p_function;
  if position(p_new in v_src) = 0 then
    return 'not present: ' || p_function::text;
  end if;
  if (length(v_src) - length(replace(v_src, p_new, ''))) <> length(p_new) then
    raise exception '% contains the new text more than once; not undoing it', p_function;
  end if;
  v_def := pg_catalog.pg_get_functiondef(p_function);
  execute replace(v_def, v_src, replace(v_src, p_new, p_old));
  return 'restored: ' || p_function::text;
end;
$$;

revoke all on function vppsone.replace_in_fee_function(regprocedure, text, text, text) from public, anon, authenticated, service_role;
revoke all on function vppsone.undo_replace_in_fee_function(regprocedure, text, text) from public, anon, authenticated, service_role;

/* ------------------------------------------------------- One mints vp1_ */

select vppsone.replace_in_fee_function(
  'public.online_payment_open_intent(uuid,uuid,smallint[],boolean,text,timestamp with time zone,text)',
  '[vppsone:vp1-ownership]',
  '''vpps_'' || replace(v_id::text',
  '''vp1_'' /* [vppsone:vp1-ownership] */ || replace(v_id::text'
);

select vppsone.replace_in_fee_function(
  'public.online_payment_open_order(uuid,jsonb,text,text)',
  '[vppsone:vp1-ownership]',
  '''vpps_o_'' || replace(gen_random_uuid()::text',
  '''vp1_o_'' /* [vppsone:vp1-ownership] */ || replace(gen_random_uuid()::text'
);

/* ----------------------------------- and never records or posts vpps_ money */

select vppsone.inject_fee_function_preamble(f::regprocedure, '-- [vppsone:vp1-ownership]', g)
from (values
  ('public.online_payment_record_capture(jsonb)',
   $g$  -- The fees app's link (go-live Phase E): its money is the fees app's to record.
  if left(coalesce(v_reference_id, ''), 5) = 'vpps_'
     or (v_link_id is not null and exists (
       select 1 from public.online_payment_intents i
       where i.provider_link_id = v_link_id and left(i.provider_reference_id, 5) = 'vpps_')) then
    return jsonb_build_object('recorded', false, 'reason', 'not_ours');
  end if;$g$),
  ('public.online_payment_record_order_capture(jsonb)',
   $g$  -- The fees app's order (go-live Phase E): its money is the fees app's to record.
  if exists (
    select 1 from public.online_payment_orders o
    where o.provider_order_id = v_order_id and left(o.provider_receipt, 5) = 'vpps_') then
    return jsonb_build_object('recorded', false, 'reason', 'not_ours');
  end if;$g$),
  ('public.online_payment_apply_capture(uuid,text)',
   $g$  -- A capture on the fees app's link (go-live Phase E) is never posted here.
  if exists (
    select 1 from public.online_payment_captures c
    join public.online_payment_intents i on i.id = c.intent_id
    where c.id = p_capture_id and left(i.provider_reference_id, 5) = 'vpps_') then
    return jsonb_build_object('applied', false, 'status', 'not_ours');
  end if;$g$),
  ('public.online_payment_apply_order_capture(uuid,text)',
   $g$  -- A capture on the fees app's order (go-live Phase E) is never posted here.
  if exists (
    select 1 from public.online_payment_captures c
    join public.online_payment_orders o on o.id = c.order_id
    where c.id = p_capture_id and left(o.provider_receipt, 5) = 'vpps_') then
    return jsonb_build_object('applied', false, 'status', 'not_ours');
  end if;$g$)
) as t(f, g);
