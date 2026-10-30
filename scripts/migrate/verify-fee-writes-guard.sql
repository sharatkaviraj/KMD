-- Dry-run proof of the fee writes switch (D-345) and the TEST receipt prefix
-- (D-346), on One's main database wtgxcptmucjerhufzjcf. Run it through the
-- Supabase MCP `execute_sql`. NEVER run it against vgqyilgstjvgohrsiwkb.
--
-- It is one DO block that ENDS BY RAISING. The raise rolls back everything the
-- block did — the settings it flipped, the deployment marker it flipped, the
-- one-rupee TEST receipt it posted — and carries the results out in the error
-- message. So "ERROR: DRY-RUN RESULT (rolled back): {...}" is the expected
-- output; the test is what the JSON says. Nothing it does survives.
--
-- What it proves:
--   A. fee_writes_enabled = 'false':
--      - a direct PostgREST-shaped call to the money RPC
--        (post_student_payment_with_adjustments, as a signed-in admin) for a
--        real-session student is refused with SQLSTATE VPP01;
--      - the same call for a TEST-2026-27 student still posts, and its receipt
--        number starts with TST;
--      - so does undo_recent_payment for a real receipt (refused).
--   B. key unset, marker 'production'  -> real refused, TEST allowed.
--   C. key 'true', marker 'production' -> real allowed.
--   D. key unset, marker 'dev'         -> real allowed (today's state).
-- Expected: A_real_rpc = "refused VPP01", A_test_prefix = "TST",
-- A_undo_real = "refused VPP01", B_real = false, B_test = true, C_real = true,
-- D_real = true.
--
-- Personal data: it picks students and a receipt by session only and prints
-- no name, phone or id — just booleans, SQLSTATEs and a three-letter prefix.

do $$
declare
  r jsonb := '{}'::jsonb;
  v_real uuid;
  v_test uuid;
  v_admin uuid;
  v_real_receipt uuid;
  v_num text;
begin
  select s.id into v_real
  from public.students s join public.classes c on c.id = s.class_id
  where c.session_label = '2026-27' and s.status = 'active'
  order by s.id limit 1;

  select s.id into v_test
  from public.students s join public.classes c on c.id = s.class_id
  where c.session_label = 'TEST-2026-27' and s.status = 'active'
  order by s.id limit 1;

  select r0.id into v_real_receipt
  from public.receipts r0 join public.students s on s.id = r0.student_id join public.classes c on c.id = s.class_id
  where c.session_label = '2026-27'
  order by r0.created_at desc limit 1;

  select p.user_id into v_admin
  from vppsone.staff_profiles p join auth.users u on u.id = p.user_id
  where u.email = 'qa.admin@qa.vpps.local' and p.role = 'admin' and p.is_active;

  r := r || jsonb_build_object(
    'have_real', v_real is not null, 'have_test', v_test is not null,
    'have_real_receipt', v_real_receipt is not null, 'have_admin', v_admin is not null,
    'marker_before', (select d.environment from vppsone.deployment d where d.id = 1),
    'key_before', coalesce((select a.value from public.app_settings a where a.key = 'fee_writes_enabled'), '(unset)'));

  /* A. the switch is off */
  insert into public.app_settings (key, value) values ('fee_writes_enabled', 'false')
  on conflict (key) do update set value = excluded.value;

  r := r || jsonb_build_object(
    'A_allowed_real', vppsone.fee_writes_allowed(v_real),
    'A_allowed_test', vppsone.fee_writes_allowed(v_test));

  -- Exactly what PostgREST does for a signed-in user's rpc() call.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';

  begin
    perform * from public.post_student_payment_with_adjustments(
      v_real, current_date, 'cash', 1, null, 'fee-writes guard dry run', 'dry run', 'SVP', gen_random_uuid(), 0, 0);
    r := r || '{"A_real_rpc": "ALLOWED - WRONG"}'::jsonb;
  exception
    when sqlstate 'VPP01' then r := r || '{"A_real_rpc": "refused VPP01"}'::jsonb;
    when others then r := r || jsonb_build_object('A_real_rpc', 'other ' || sqlstate || ': ' || left(sqlerrm, 120));
  end;

  begin
    perform * from public.undo_recent_payment(v_real_receipt, 'fee-writes guard dry run');
    r := r || '{"A_undo_real": "ALLOWED - WRONG"}'::jsonb;
  exception
    when sqlstate 'VPP01' then r := r || '{"A_undo_real": "refused VPP01"}'::jsonb;
    when others then r := r || jsonb_build_object('A_undo_real', 'other ' || sqlstate || ': ' || left(sqlerrm, 120));
  end;

  begin
    select x.receipt_number into v_num
    from public.post_student_payment_with_adjustments(
      v_test, current_date, 'cash', 1, null, 'fee-writes guard dry run', 'dry run', 'SVP', gen_random_uuid(), 0, 0) x;
    r := r || jsonb_build_object('A_test_rpc', 'posted', 'A_test_prefix', left(v_num, 3));
  exception
    when others then r := r || jsonb_build_object('A_test_rpc', 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  /* B. key unset, marker production */
  delete from public.app_settings where key = 'fee_writes_enabled';
  update vppsone.deployment set environment = 'production' where id = 1;
  r := r || jsonb_build_object(
    'B_real', vppsone.fee_writes_allowed(v_real),
    'B_test', vppsone.fee_writes_allowed(v_test),
    'B_test_session', vppsone.fee_writes_allowed_for_session('TEST-2026-27'));

  /* C. key 'true', marker production */
  insert into public.app_settings (key, value) values ('fee_writes_enabled', 'true');
  r := r || jsonb_build_object('C_real', vppsone.fee_writes_allowed(v_real));

  /* D. key unset, marker dev */
  delete from public.app_settings where key = 'fee_writes_enabled';
  update vppsone.deployment set environment = 'dev' where id = 1;
  r := r || jsonb_build_object('D_real', vppsone.fee_writes_allowed(v_real));

  raise exception 'DRY-RUN RESULT (rolled back): %', r::text;
end;
$$;
