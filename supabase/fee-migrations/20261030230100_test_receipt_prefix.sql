-- ============================================================================
-- VPPS One fee-migration (One-only): TEST-session receipts are numbered TST,
-- never SVP (D-346; plan Q10; owner override T1).
--
-- Why this differs from the fees app: on the fees app TEST-2026-27 postings
-- share the real `SVP<yyyymmdd>-NNNN` sequence, so every rehearsal receipt
-- burns a real receipt number. On One's database testing happens in
-- production, every day, under TEST-2026-27 — so test postings must have a
-- sequence of their own.
--
-- How the prefix is chosen today (read from the catalog and the app):
--   * The Payment Desk passes `p_receipt_prefix` = the session's
--     fee_policy_configs.receipt_prefix (src/modules/payments/data/queries.ts),
--     falling back to the ACTIVE session's policy when no session is passed.
--   * The online path (online_payment_apply_capture) hard-codes 'SVP' when it
--     calls private.post_student_payment_core.
--   * Every posting function normalises a blank prefix to 'SVP'.
-- So the smallest change that holds for every path is in the database, at the
-- top of the three functions that number receipts:
--     p_receipt_prefix := vppsone.receipt_prefix_for_student(p_student_id, p_receipt_prefix);
-- which leaves a real student's prefix exactly as passed, and gives a
-- TEST-session student its session's own prefix — never one a real session
-- uses, falling back to 'TST'.
--
-- Data: TEST-2026-27's fee_policy_configs.receipt_prefix becomes 'TST' (it was
-- 'SVP'), so the desk shows and passes TST too. That value is One-owned and is
-- registered in vppsone.one_owned_fee_settings: the mirror sync never copies it
-- back from the fees app (where TEST-2026-27 still says SVP).
--
-- Proof: scripts/migrate/verify-fee-writes-guard.sql posts one rupee to a
-- TEST-2026-27 student inside a block that rolls back, and checks the number
-- starts with TST.
--
-- Rollback:
--   select vppsone.remove_fee_function_preamble('<each function>', '-- [vppsone:test-receipt-prefix]');
--   update public.fee_policy_configs set receipt_prefix = 'SVP' where academic_session_label = 'TEST-2026-27';
--   delete from vppsone.one_owned_fee_settings where source_table = 'fee_policy_configs';
--   drop function vppsone.receipt_prefix_for_student(uuid, text);
-- ============================================================================

create or replace function vppsone.receipt_prefix_for_student(p_student_id uuid, p_requested text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session text;
  v_prefix text;
begin
  select c.session_label into v_session
  from public.students s
  join public.classes c on c.id = s.class_id
  where s.id = p_student_id;

  if not vppsone.is_test_session_label(v_session) then
    return p_requested;
  end if;

  select nullif(trim(f.receipt_prefix), '') into v_prefix
  from public.fee_policy_configs f
  where f.academic_session_label = v_session;

  -- A test session never shares a prefix with a real one, whatever its
  -- policy row says.
  if v_prefix is null or exists (
    select 1 from public.fee_policy_configs f
    where not vppsone.is_test_session_label(f.academic_session_label)
      and upper(trim(f.receipt_prefix)) = upper(v_prefix)
  ) or upper(v_prefix) = 'SVP' then
    return 'TST';
  end if;

  return v_prefix;
end;
$$;

comment on function vppsone.receipt_prefix_for_student(uuid, text) is
  'The receipt prefix to post with: unchanged for a real student; the test session''s own prefix (TST) for a TEST-session student (D-346).';

revoke all on function vppsone.receipt_prefix_for_student(uuid, text) from public, anon;
grant execute on function vppsone.receipt_prefix_for_student(uuid, text) to authenticated, service_role;

select vppsone.inject_fee_function_preamble(f::regprocedure, '-- [vppsone:test-receipt-prefix]',
  '  p_receipt_prefix := vppsone.receipt_prefix_for_student(p_student_id, p_receipt_prefix);')
from (values
  ('private.post_student_payment_core(uuid, date, payment_mode, integer, text, text, text, text, uuid, integer, integer)'),
  ('public.post_student_payment(uuid, date, payment_mode, integer, text, text, text, text, uuid)'),
  ('public.post_corrected_payment(uuid, date, payment_mode, jsonb, uuid, text, text, text, text)')
) as t(f);

update public.fee_policy_configs
   set receipt_prefix = 'TST'
 where academic_session_label = 'TEST-2026-27'
   and receipt_prefix is distinct from 'TST';

insert into vppsone.one_owned_fee_settings (source_table, row_key, column_name, reason) values
  ('fee_policy_configs', 'TEST-2026-27', 'receipt_prefix',
   'TEST postings are numbered TST so they never consume real SVP numbers (D-346). The fees app still says SVP; the mirror must not copy it back.')
on conflict do nothing;
