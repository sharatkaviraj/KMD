-- set_test_account (20261030155339) logged its flag change with format('%s'),
-- and a boolean's output function writes 't' / 'f': the audit row read
-- "is_test_account: f -> t". Same function, logged as 'false -> true'.
-- Found by scripts/verify-test-session-fence.sql case H.
--
-- Rollback: re-run the function from 20261030155339.

create or replace function vppsone.set_test_account(
  p_profile_id uuid,
  p_value boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor vppsone.staff_profiles%rowtype;
  target vppsone.staff_profiles%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_value is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:staff-authority'));

  select * into actor from vppsone.staff_profiles
  where user_id = (select auth.uid()) and is_active;
  if not found or actor.role <> 'admin' or actor.is_test_account then
    return jsonb_build_object('ok', false, 'reason', 'not_real_admin');
  end if;

  select * into target from vppsone.staff_profiles where id = p_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if target.id = actor.id then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;
  if target.is_test_account = p_value then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update vppsone.staff_profiles set is_test_account = p_value where id = target.id;

  -- ::text, not format('%s'): a boolean's output function writes 't'/'f'.
  insert into vppsone.staff_authority_changes (
    staff_profile_id, actor_staff_id, from_role, to_role, from_active, to_active, reason
  ) values (
    target.id, actor.id, target.role, target.role, target.is_active, target.is_active,
    'is_test_account: ' || target.is_test_account::text || ' -> ' || p_value::text || '. ' || v_reason
  );

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

revoke all on function vppsone.set_test_account(uuid, boolean, text) from public, anon;
grant execute on function vppsone.set_test_account(uuid, boolean, text) to authenticated;
