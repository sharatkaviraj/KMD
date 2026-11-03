-- Dry-run proof of go-live Phase E's three fee-migrations, on One's main
-- database wtgxcptmucjerhufzjcf: `vp1_` ownership (20261031120000), the
-- receipt suffix floor and the online session prefix (20261031120100), and
-- the switches off (20261031120200). Run it through the Supabase MCP
-- `execute_sql`. NEVER run it against vgqyilgstjvgohrsiwkb.
--
-- One DO block that ENDS BY RAISING, like verify-fee-writes-guard.sql: the
-- raise rolls back every row it wrote (switches flipped, a fake fees intent,
-- order and captures, the TEST receipts it posted) and carries the results
-- out in the error message. "ERROR: DRY-RUN RESULT (rolled back): {...}" is
-- the expected output; the test is what the JSON says. Run before the
-- migrations are applied, prepend the three files to the same execute_sql
-- call: they roll back with it.
--
-- Expected:
--   bodies: open_intent_vp1 = open_order_vp1 = true, floor_core = floor_desk =
--     floor_corrected = true, prefix_apply = prefix_order_apply = true
--   switches_off = 7 (and staff_whatsapp_off = true)
--   intent_ref_prefix = "vp1_", intent_ref_length = 36 (when a TEST student
--     with dues exists: intent_opened = "true")
--   fees_link_by_reference = fees_link_by_link_id = fees_order = "not_ours"
--   fees_apply_link = fees_apply_order = "not_ours"
--   own_capture_recorded = true, own_apply = true, own_receipt_suffix = "5001"
--     (posted by the online path, numbered in the band) — when an intent opened
--   floor_first_suffix / floor_second_suffix: the next two TEST desk receipts
--     are each one above the day's highest, and never below 5001
--   floor_unset_suffix: with the key removed the next is the day's highest + 1
--   floor_bad_value = floor_9999 = "refused VPP02"
--
-- Run on 31 Oct 2026 (the three files prepended, all rolled back): every
-- expected value, with own_receipt_prefix "TST" and suffixes 5001 (online),
-- 5002, 5003 (desk, as qa.admin), 5004 (floor removed). Run again after the
-- three were applied: the same, without the files prepended.
--
-- Personal data: students are picked by session only; nothing prints a name,
-- phone or id — booleans, prefixes, suffixes and SQLSTATEs.

do $$
declare
  r jsonb := '{}'::jsonb;
  v_test uuid;
  v_open jsonb;
  v_intent public.online_payment_intents;
  v_send uuid;
  v_fees_intent uuid;
  v_fees_order uuid;
  v_cap uuid;
  v_res jsonb;
  v_num text;
  v_num2 text;
  v_src text;
  v_ref text;
  v_admin uuid;
begin
  /* the bodies */
  select prosrc into v_src from pg_proc where oid = 'public.online_payment_open_intent(uuid,uuid,smallint[],boolean,text,timestamp with time zone,text)'::regprocedure;
  r := r || jsonb_build_object('open_intent_vp1', v_src like '%''vp1_'' /* [vppsone:vp1-ownership] */%' and v_src not like '%''vpps_'' ||%');
  select prosrc into v_src from pg_proc where oid = 'public.online_payment_open_order(uuid,jsonb,text,text)'::regprocedure;
  r := r || jsonb_build_object('open_order_vp1', v_src like '%''vp1_o_'' /* [vppsone:vp1-ownership] */%' and v_src not like '%''vpps_o_'' ||%');
  r := r || jsonb_build_object(
    'floor_core', (select prosrc like '%vppsone.receipt_suffix_floor()%' from pg_proc where oid = 'private.post_student_payment_core(uuid,date,payment_mode,integer,text,text,text,text,uuid,integer,integer)'::regprocedure),
    'floor_desk', (select prosrc like '%vppsone.receipt_suffix_floor()%' from pg_proc where oid = 'public.post_student_payment(uuid,date,payment_mode,integer,text,text,text,text,uuid)'::regprocedure),
    'floor_corrected', (select prosrc like '%vppsone.receipt_suffix_floor()%' from pg_proc where oid = 'public.post_corrected_payment(uuid,date,payment_mode,jsonb,uuid,text,text,text,text)'::regprocedure),
    'prefix_apply', (select prosrc like '%vppsone.online_receipt_prefix(v_intent.student_id)%' and prosrc not like '%''SVP'',%' from pg_proc where oid = 'public.online_payment_apply_capture(uuid,text)'::regprocedure),
    'prefix_order_apply', (select prosrc like '%vppsone.online_receipt_prefix(v_line.student_id)%' and prosrc not like '%''SVP'',%' from pg_proc where oid = 'public.online_payment_apply_order_capture(uuid,text)'::regprocedure),
    'switches_off', (select count(*) from public.app_settings where value = 'false' and key in (
      'online_payment_links_enabled', 'online_payment_checkout_enabled', 'online_payment_auto_posting_enabled',
      'online_payment_receipts_enabled', 'online_payment_checkout_all_sessions', 'online_payment_checkout_modal_enabled',
      'online_payment_waive_late_fees')),
    'staff_whatsapp_off', (select value = 'false' from public.app_settings where key = 'online_payment_staff_whatsapp_enabled'));

  /* switches on, inside this block only */
  insert into public.app_settings (key, value) values
    ('online_payment_links_enabled', 'true'), ('online_payment_auto_posting_enabled', 'true'),
    ('receipt_suffix_floor', '5000')
  on conflict (key) do update set value = excluded.value;

  /* One mints vp1_: open an intent for the first TEST student with something due */
  for v_test in
    select s.id from public.students s join public.classes c on c.id = s.class_id
    where c.session_label = 'TEST-2026-27' and s.status = 'active' order by s.id limit 60
  loop
    v_open := public.online_payment_open_intent(
      v_test, null, array[1, 2, 3, 4]::smallint[], false, 'test',
      now() + interval '2 days', 'dryrun' || md5(v_test::text || clock_timestamp()::text));
    exit when coalesce((v_open->>'ok')::boolean, false);
  end loop;
  r := r || jsonb_build_object('intent_opened', coalesce(v_open->>'ok', 'no TEST student'));
  if coalesce((v_open->>'ok')::boolean, false) then
    v_intent := jsonb_populate_record(null::public.online_payment_intents, v_open->'intent');
    r := r || jsonb_build_object(
      'intent_ref_prefix', left(v_intent.provider_reference_id, 4),
      'intent_ref_length', length(v_intent.provider_reference_id));
  end if;

  /* a fees app link, as the importer would leave it, and money on it */
  v_ref := 'vpps_' || md5('dry-run-fees-intent');
  insert into public.online_payment_intents (
    public_ref, provider_mode, status, student_id, session_label, quote, quote_hash,
    amount_rupees, expires_at, provider_reference_id, provider_link_id)
  select 'dryrunfees' || md5('a'), 'test', 'cancelled', s.id, c.session_label, '{}'::jsonb, 'x',
         100, now() + interval '1 day', v_ref, 'plink_DRYRUNFEES1'
  from public.students s join public.classes c on c.id = s.class_id
  where c.session_label = 'TEST-2026-27' order by s.id limit 1
  returning id into v_fees_intent;

  v_res := public.online_payment_record_capture(jsonb_build_object(
    'provider_payment_id', 'pay_DRYRUNFEES1', 'provider_link_id', null, 'reference_id', v_ref,
    'provider_mode', 'test', 'amount_paise', 10000, 'currency', 'INR', 'provider_status', 'captured', 'captured', true));
  r := r || jsonb_build_object('fees_link_by_reference', coalesce(v_res->>'reason', v_res::text));
  v_res := public.online_payment_record_capture(jsonb_build_object(
    'provider_payment_id', 'pay_DRYRUNFEES2', 'provider_link_id', 'plink_DRYRUNFEES1', 'reference_id', null,
    'provider_mode', 'test', 'amount_paise', 10000, 'currency', 'INR', 'provider_status', 'captured', 'captured', true));
  r := r || jsonb_build_object('fees_link_by_link_id', coalesce(v_res->>'reason', v_res::text));

  /* a fees app order */
  select id into v_send from public.whatsapp_reminder_sends order by created_at limit 1;
  if v_send is not null then
    insert into public.online_payment_orders (public_ref, provider_mode, send_id, amount_rupees, provider_receipt, provider_order_id, status)
    values ('dryrunfees' || md5('b'), 'test', v_send, 100, 'vpps_o_' || md5('dry-run-fees-order'), 'order_DRYRUNFEES1', 'abandoned')
    returning id into v_fees_order;
    v_res := public.online_payment_record_order_capture(jsonb_build_object(
      'provider_payment_id', 'pay_DRYRUNFEES3', 'provider_order_id', 'order_DRYRUNFEES1',
      'provider_mode', 'test', 'amount_paise', 10000, 'currency', 'INR', 'provider_status', 'captured', 'captured', true));
    r := r || jsonb_build_object('fees_order', coalesce(v_res->>'reason', v_res::text));
  else
    r := r || '{"fees_order": "no send to hang an order on"}'::jsonb;
  end if;

  /* captures already in the table (as an import before this fix could have left them) are never posted */
  insert into public.online_payment_captures (provider_payment_id, intent_id, provider_mode, amount_paise, currency, provider_status, application_status)
  values ('pay_DRYRUNFEES4', v_fees_intent, 'test', 10000, 'INR', 'captured', 'pending') returning id into v_cap;
  v_res := public.online_payment_apply_capture(v_cap, 'dry-run');
  r := r || jsonb_build_object('fees_apply_link', coalesce(v_res->>'status', v_res::text));
  if v_fees_order is not null then
    insert into public.online_payment_captures (provider_payment_id, order_id, provider_order_id, provider_mode, amount_paise, currency, provider_status, application_status)
    values ('pay_DRYRUNFEES5', v_fees_order, 'order_DRYRUNFEES1', 'test', 10000, 'INR', 'captured', 'pending') returning id into v_cap;
    v_res := public.online_payment_apply_order_capture(v_cap, 'dry-run');
    r := r || jsonb_build_object('fees_apply_order', coalesce(v_res->>'status', v_res::text));
  end if;

  /* One's own money on its vp1_ link still records and posts, in the band */
  if v_intent.id is not null then
    update public.online_payment_intents set status = 'link_created', provider_link_id = 'plink_DRYRUNONE1' where id = v_intent.id;
    v_res := public.online_payment_record_capture(jsonb_build_object(
      'provider_payment_id', 'pay_DRYRUNONE1', 'provider_link_id', 'plink_DRYRUNONE1', 'reference_id', v_intent.provider_reference_id,
      'provider_mode', 'test', 'amount_paise', v_intent.amount_rupees * 100, 'currency', 'INR', 'provider_status', 'captured', 'captured', true));
    r := r || jsonb_build_object('own_capture_recorded', v_res->>'recorded', 'own_capture_status', v_res->'capture'->>'application_status');
    begin
      v_res := public.online_payment_apply_capture(((v_res->'capture')->>'id')::uuid, 'dry-run');
      r := r || jsonb_build_object('own_apply', v_res->>'applied');
      select receipt_number into v_num from public.receipts where id = (select receipt_id from public.online_payment_captures where provider_payment_id = 'pay_DRYRUNONE1');
      r := r || jsonb_build_object('own_receipt_prefix', left(v_num, 3), 'own_receipt_suffix', right(v_num, 4));
    exception when others then
      r := r || jsonb_build_object('own_apply', 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
    end;
  end if;

  /* the floor, on the desk's posting function, as the signed-in QA admin
     (exactly what PostgREST does for a staff member's rpc() call) */
  select s.id into v_test from public.students s join public.classes c on c.id = s.class_id
  where c.session_label = 'TEST-2026-27' and s.status = 'active' order by s.id limit 1;
  select p.user_id into v_admin
  from vppsone.staff_profiles p join auth.users u on u.id = p.user_id
  where u.email = 'qa.admin@qa.vpps.local' and p.role = 'admin' and p.is_active;
  r := r || jsonb_build_object('have_admin', v_admin is not null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  begin
    select x.receipt_number into v_num from public.post_student_payment_with_adjustments(
      v_test, current_date, 'cash', 1, null, 'suffix floor dry run', 'dry run', 'SVP', gen_random_uuid(), 0, 0) x;
    select x.receipt_number into v_num2 from public.post_student_payment_with_adjustments(
      v_test, current_date, 'cash', 1, null, 'suffix floor dry run', 'dry run', 'SVP', gen_random_uuid(), 0, 0) x;
    r := r || jsonb_build_object('floor_prefix', left(v_num, 3), 'floor_first_suffix', right(v_num, 4), 'floor_second_suffix', right(v_num2, 4));
  exception when others then
    r := r || jsonb_build_object('floor_first_suffix', 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
  execute 'reset role';
  -- Back to the owner with no JWT, as the MCP runs: the claims would otherwise
  -- make the next statement the test admin's.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.app_settings where key = 'receipt_suffix_floor';
  r := r || jsonb_build_object('floor_unset_value', vppsone.receipt_suffix_floor());
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  begin
    select x.receipt_number into v_num from public.post_student_payment_with_adjustments(
      v_test, current_date, 'cash', 1, null, 'suffix floor dry run', 'dry run', 'SVP', gen_random_uuid(), 0, 0) x;
    -- Unset, the next is still the day's highest + 1: removing the key never
    -- reaches back below numbers already issued.
    r := r || jsonb_build_object('floor_unset_suffix', right(v_num, 4));
  exception when others then
    r := r || jsonb_build_object('floor_unset_suffix', 'error ' || sqlstate || ': ' || left(sqlerrm, 160));
  end;
  execute 'reset role';
  -- Back to the owner with no JWT, as the MCP runs: the claims would otherwise
  -- make the next statement the test admin's.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into public.app_settings (key, value) values ('receipt_suffix_floor', '50x0')
  on conflict (key) do update set value = excluded.value;
  begin
    perform vppsone.receipt_suffix_floor();
    r := r || '{"floor_bad_value": "ACCEPTED - WRONG"}'::jsonb;
  exception
    when sqlstate 'VPP02' then r := r || '{"floor_bad_value": "refused VPP02"}'::jsonb;
  end;
  update public.app_settings set value = '9999' where key = 'receipt_suffix_floor';
  begin
    perform vppsone.receipt_suffix_floor();
    r := r || '{"floor_9999": "ACCEPTED - WRONG"}'::jsonb;
  exception
    when sqlstate 'VPP02' then r := r || '{"floor_9999": "refused VPP02"}'::jsonb;
  end;

  raise exception 'DRY-RUN RESULT (rolled back): %', r;
end;
$$;
