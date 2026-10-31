-- ============================================================================
-- VPPS One fee-migration (One-only): the receipt suffix floor, and online
-- receipts numbered with their session's own prefix (go-live Phase E, plan
-- §7.4 and §5.2b/c; critique0 #9, critique1 A5).
--
-- Why this differs from the fees app: every fees receipt is copied into One
-- with its number, and One carries on each day's sequence
-- (`<prefix><yyyymmdd>-NNNN`, the next NNNN after the day's highest). From T0
-- until written sign-off the fees app can still issue receipts — the tail of
-- Pay now links already sent, and any re-entry on rollback — and those carry
-- the same SVP prefix and the same days. So One's numbers must sit in a band
-- the fees app never reaches: `app_settings.receipt_suffix_floor = 5000`
-- makes One issue SVP<date>-5001, -5002, … while the fees app's own sequence
-- stays far below. Mandatory from T0 whatever the answer to Q8/Q11
-- (docs/cutover/RAZORPAY.md); unset (the state on this database today) the
-- numbering is exactly the fees app's.
--
-- WHAT changes, in the three functions that number receipts
-- (private.post_student_payment_core, public.post_student_payment,
-- public.post_corrected_payment): the day's starting point becomes
--     greatest(<the day's highest suffix>, vppsone.receipt_suffix_floor())
-- and the next number is that + 1, as before. The four-digit pattern
-- `-([0-9]{4})$` that reads the day's highest is unchanged and reads 5001 like
-- any other suffix; the prefix is untouched, so the receipt_prefix check
-- `^[A-Z0-9][A-Z0-9-]{1,11}$` is not involved. The floor is limited to
-- 0..9998, so the first number it gives (floor + 1) still has four digits.
-- A value that is not a whole number in that range REFUSES the posting (a
-- typo must not silently drop the band and collide with the fees app).
--
-- And the two online apply functions stop hard-coding 'SVP': they post with
-- the student's session's own fee_policy_configs.receipt_prefix (the column
-- exists; the Payment Desk already passes it), falling back to 'SVP'. Today
-- that is SVP for 2026-27 and 2027-28 and TST for TEST-2026-27, which
-- vppsone.receipt_prefix_for_student() (20261030230100) already enforced for
-- TEST — so nothing a parent sees changes, but a future session with its own
-- prefix numbers its online receipts the same as its desk receipts.
--
-- HOW: vppsone.replace_in_fee_function() (20261031120000), one exact swap per
-- function, proven reversible. CREATE OR REPLACE keeps the oid, owner and
-- grants. Re-running is a no-op.
--
-- Proof: scripts/migrate/verify-online-vp1-and-floor.sql posts to a
-- TEST-2026-27 student with the floor at 5000 inside a block that rolls back,
-- and checks the number ends -5001 (then -5002).
--
-- Rollback: vppsone.undo_replace_in_fee_function(<function>, <old>, <new>)
-- with the pairs below; then drop the two vppsone functions.
-- ============================================================================

create or replace function vppsone.receipt_suffix_floor()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw text;
begin
  select nullif(trim(a.value), '') into v_raw
  from public.app_settings a
  where a.key = 'receipt_suffix_floor';

  if v_raw is null then
    return 0;
  end if;
  if v_raw !~ '^[0-9]{1,4}$' or v_raw::integer > 9998 then
    raise exception 'app_settings.receipt_suffix_floor must be a whole number from 0 to 9998, got %', v_raw
      using errcode = 'VPP02';
  end if;
  return v_raw::integer;
end;
$$;

comment on function vppsone.receipt_suffix_floor() is
  'The lowest daily receipt suffix One may issue minus one (app_settings.receipt_suffix_floor; 0 when unset). From T0 to sign-off it is 5000, so One''s receipts never share a number with the fees app''s (plan §7.4).';

revoke all on function vppsone.receipt_suffix_floor() from public, anon;
grant execute on function vppsone.receipt_suffix_floor() to authenticated, service_role;

create or replace function vppsone.online_receipt_prefix(p_student_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(trim(f.receipt_prefix), '')
     from public.students s
     join public.classes c on c.id = s.class_id
     join public.fee_policy_configs f on f.academic_session_label = c.session_label
     where s.id = p_student_id
     limit 1),
    'SVP'
  );
$$;

comment on function vppsone.online_receipt_prefix(uuid) is
  'The receipt prefix an online payment posts with: the student''s session''s fee_policy_configs.receipt_prefix, else SVP (go-live Phase E). A TEST student still ends on TST through receipt_prefix_for_student.';

revoke all on function vppsone.online_receipt_prefix(uuid) from public, anon;
grant execute on function vppsone.online_receipt_prefix(uuid) to authenticated, service_role;

/* --------------------------------------------------------- the floor */

select vppsone.replace_in_fee_function(
  'private.post_student_payment_core(uuid,date,payment_mode,integer,text,text,text,text,uuid,integer,integer)',
  '[vppsone:receipt-suffix-floor]',
  'select coalesce(max((regexp_match(receipt_row.receipt_number, ''-([0-9]{4})$''))[1]::integer), 0)
  into v_daily_sequence',
  'select greatest(coalesce(max((regexp_match(receipt_row.receipt_number, ''-([0-9]{4})$''))[1]::integer), 0), vppsone.receipt_suffix_floor()) /* [vppsone:receipt-suffix-floor] */
  into v_daily_sequence'
);

select vppsone.replace_in_fee_function(
  'public.post_corrected_payment(uuid,date,payment_mode,jsonb,uuid,text,text,text,text)',
  '[vppsone:receipt-suffix-floor]',
  'select coalesce(max((regexp_match(r.receipt_number, ''-([0-9]{4})$''))[1]::integer), 0)
  into v_daily_sequence',
  'select greatest(coalesce(max((regexp_match(r.receipt_number, ''-([0-9]{4})$''))[1]::integer), 0), vppsone.receipt_suffix_floor()) /* [vppsone:receipt-suffix-floor] */
  into v_daily_sequence'
);

select vppsone.replace_in_fee_function(
  'public.post_student_payment(uuid,date,payment_mode,integer,text,text,text,text,uuid)',
  '[vppsone:receipt-suffix-floor]',
  'select coalesce(
    max((regexp_match(receipt_row.receipt_number, ''-([0-9]{4})$''))[1]::integer),
    0
  )
  into daily_sequence',
  'select greatest(coalesce(
    max((regexp_match(receipt_row.receipt_number, ''-([0-9]{4})$''))[1]::integer),
    0
  ), vppsone.receipt_suffix_floor()) /* [vppsone:receipt-suffix-floor] */
  into daily_sequence'
);

/* ------------------------------------- online receipts: the session prefix */

select vppsone.replace_in_fee_function(
  'public.online_payment_apply_capture(uuid,text)',
  '[vppsone:online-receipt-prefix]',
  '''Razorpay (online)'',
      ''SVP'',',
  '''Razorpay (online)'',
      vppsone.online_receipt_prefix(v_intent.student_id) /* [vppsone:online-receipt-prefix] */,'
);

select vppsone.replace_in_fee_function(
  'public.online_payment_apply_order_capture(uuid,text)',
  '[vppsone:online-receipt-prefix]',
  '''Razorpay (online)'',
        ''SVP'',',
  '''Razorpay (online)'',
        vppsone.online_receipt_prefix(v_line.student_id) /* [vppsone:online-receipt-prefix] */,'
);

/* --------------------------------------------- One owns the setting's value */

insert into vppsone.one_owned_fee_settings (source_table, row_key, column_name, reason) values
  ('app_settings', 'receipt_suffix_floor', 'value',
   'One''s receipt band (plan §7.4): 5000 from T0 to sign-off. The fees app has no such key; the mirror never writes it.')
on conflict do nothing;
