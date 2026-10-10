-- Fake bookkeeping rows for the redesigned Accounts, Books and Reports screens.
-- Dev only (schoolfees-dev, wtgxcptmucjerhufzjcf). Writes vppsone.acc_* only;
-- fee (`public`) rows are read to pick receipts, never changed.
-- Payer names and cheque numbers are invented. Runs once: every block is
-- guarded by "not already seeded".

do $$
declare
  acct uuid := 'c96ffb1a-e9ef-4ced-abb5-54587bbb4908'; -- QA Accountant
  adm uuid := '1520b49a-5e25-4a53-8f3d-210a4d35fbeb';  -- QA Admin
  slip uuid;
  batch uuid := gen_random_uuid();
  r record;
  n int := 0;
begin
  if exists (select 1 from vppsone.acc_cheques) then
    raise notice 'vx accounts seed already applied';
    return;
  end if;

  -- Cheques: details on the four latest cheque receipts; two in the bag,
  -- one deposited, one cleared.
  insert into vppsone.acc_deposit_slips (slip_no, bank_label, deposited_on, total_amount, cheque_count, note, created_by)
  select 'DS-2026-001', 'SBI Amet', (max(payment_date) + 1), sum(total_amount)::int, count(*)::int, 'Seed slip', acct
  from (select payment_date, total_amount from public.receipts where payment_mode = 'cheque' order by payment_date, id limit 2) x
  returning id into slip;

  for r in select id, payment_date, total_amount from public.receipts where payment_mode = 'cheque' order by payment_date, id loop
    n := n + 1;
    insert into vppsone.acc_cheques (receipt_id, cheque_no, bank_name, cheque_date, created_by)
    values (r.id, lpad((480100 + n * 37)::text, 6, '0'), (array['SBI Amet', 'Bank of Baroda Rajsamand', 'PNB Amet', 'HDFC Udaipur'])[1 + (n - 1) % 4], r.payment_date, acct);
    if n = 1 then
      insert into vppsone.acc_cheque_events (receipt_id, status, deposit_slip_id, created_by) values (r.id, 'deposited', slip, acct);
      insert into vppsone.acc_cheque_events (receipt_id, status, note, created_by) values (r.id, 'cleared', 'Seed: credited', acct);
    elsif n = 2 then
      insert into vppsone.acc_cheque_events (receipt_id, status, deposit_slip_id, created_by) values (r.id, 'deposited', slip, acct);
    else
      insert into vppsone.acc_cheque_events (receipt_id, status, created_by) values (r.id, 'in_bag', acct);
    end if;
  end loop;

  -- UPI statement: one line that matches a real UPI receipt by amount and day,
  -- one with no receipt, and one that is not a fee.
  insert into vppsone.acc_upi_lines (batch_id, txn_at, amount, payer, utr, uploaded_by)
  select batch, (payment_date::timestamp + interval '10 hours 12 minutes') at time zone 'Asia/Kolkata', total_amount::int, 'KAMLA DEVI TEST', 'SEEDUTR000101', acct
  from public.receipts where payment_mode = 'upi' order by payment_date desc, id limit 1;
  insert into vppsone.acc_upi_lines (batch_id, txn_at, amount, payer, utr, uploaded_by)
  values
    (batch, now() - interval '1 day', 4250, 'RAMESH TEST KUMAR', 'SEEDUTR000102', acct),
    (batch, now() - interval '1 day 2 hours', 1180, 'STATIONERY MART TEST', 'SEEDUTR000103', acct);
  insert into vppsone.acc_upi_events (line_id, action, note, created_by)
  select id, 'not_fee', 'Seed: shop payment', acct from vppsone.acc_upi_lines where utr = 'SEEDUTR000103';

  -- Requests: a refund waiting, a reversal declined, a fee change approved.
  insert into vppsone.acc_requests (kind, student_id, amount, title, reason, payload, requested_by, requested_at)
  select 'refund', student_id, least(500, credit_balance::int), 'Refund advance', 'Paid twice', '{"method":"cash"}'::jsonb, acct, now() - interval '3 hours'
  from public.v_student_financial_state where credit_balance > 0 order by student_id limit 1;
  insert into vppsone.acc_requests (kind, title, reason, requested_by, requested_at, decision, decision_note, decided_by, decided_at)
  values
    ('reversal', 'Reverse a duplicate receipt', 'Entered twice at the counter', acct, now() - interval '2 days', 'declined', 'Not a duplicate: two installments', adm, now() - interval '1 day'),
    ('fee_change', 'Route fee for a new stop', 'Parents were told the town route fee', acct, now() - interval '5 days', 'approved', 'Will change in Fee setup', adm, now() - interval '4 days');

  -- Report schedules (recorded only; nothing sends them).
  insert into vppsone.acc_report_schedules (report_key, title, recipients, frequency, weekday, send_time, format, active, created_by)
  values
    ('collection', 'Daily collection', array['Principal'], 'daily', null, '18:00', 'pdf', true, adm),
    ('classwise', 'Pending by class', array['Class teachers'], 'weekly', 1, '08:00', 'pdf', true, adm),
    ('defaulters', 'Defaulter list', array['Class teachers'], 'monthly', null, '08:00', 'pdf', false, adm);
end $$;
