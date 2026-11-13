-- Veer Patta AI answers a member of staff as their role (D-607).
--
-- The owner, 13 Nov 2026: a number that belongs to the admin, a teacher or
-- the accountant must be answered as that person, with that role's menu,
-- not as a parent. Two additions make that possible:
--
--  1. `parent_helper_chats.hat`: which way this chat is answered now. For a
--     member of staff it is null (their own role) or 'parent' (they chose to
--     write to the school as a parent). For the owner's test number it is the
--     role he is trying (admin, office, accountant, fee_collector, teacher,
--     academic_coordinator, exam_coordinator, view_only) or 'parent'. Never
--     what anybody wrote.
--
--  2. `vppsone.staff_helper_fees`: the fee figures an accountant, the office
--     or an admin asks for on WhatsApp, for a TEST session only (the practice
--     records, which are One's own). A real year's figures come from the Fees
--     app, which a webhook cannot read on anybody's behalf, so a real year
--     returns null and the reply points to One. The money rules are the
--     Fees app's: fees and late fees are separate and never added; a
--     write-off (payment_mode 'discount') is not collection; a reversed
--     receipt counts only what was not reversed; money counts students on
--     the roll or who have paid something.
--
-- Read-only, service role only. Additive: a nullable column, a check, and a
-- function. Rollback: the column can stay (nothing else reads it); the
-- function can be left unused.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.parent_helper_chats
  add column if not exists hat text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'parent_helper_chats_hat_shape'
      and conrelid = 'vppsone.parent_helper_chats'::regclass
  ) then
    alter table vppsone.parent_helper_chats
      add constraint parent_helper_chats_hat_shape check (hat is null or hat ~ '^[a-z_]{3,32}$');
  end if;
end;
$$;

comment on column vppsone.parent_helper_chats.hat is
  'Veer Patta AI (D-607): how this chat is answered now. Null: as the person the number belongs to (a parent, or a member of staff as their role). ''parent'': a member of staff writing as a parent. On the owner''s test number, the role being tried (admin, office, accountant, fee_collector, teacher, academic_coordinator, exam_coordinator, view_only) or ''parent''.';

create or replace function vppsone.staff_helper_fees(p_session_label text, p_day date, p_query text default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with guard as (
    -- The practice records only. A real year's money is the Fees app's.
    select p_session_label as label
    where p_session_label ~* '^(TEST|UAT|DEMO)-' and p_day is not null
  ),
  paid as (
    -- Money in, net of reversals. A write-off is not collection.
    select r.payment_date as day, r.payment_mode::text as mode,
           greatest(r.total_amount - coalesce(t.reversed_amount, 0), 0) as net
    from public.receipts r
    join public.students s on s.id = r.student_id
    join public.classes c on c.id = s.class_id
    join guard g on c.session_label = g.label
    left join public.v_receipt_reversal_totals t on t.receipt_id = r.id
    where r.payment_mode::text <> 'discount'
  ),
  money as (
    -- Students on the roll, or who have paid something (a child who left owing still owes).
    select f.*
    from public.v_workbook_student_financials f
    join guard g on f.session_label = g.label
    where f.record_status::text = 'active' or coalesce(f.total_paid, 0) > 0
  ),
  q as (
    select nullif(btrim(coalesce(p_query, '')), '') as text
  ),
  found as (
    select f.student_id, f.admission_no, f.student_name, f.class_label, f.record_status::text as status,
           coalesce(f.base_outstanding_amount, 0) as fees_pending,
           coalesce(f.late_fee_outstanding_amount, 0) as late_pending,
           coalesce(f.total_paid, 0) as total_paid,
           f.last_payment_date, f.last_payment_amount,
           coalesce(f.overdue_installment_count, 0) as overdue_installments,
           f.next_due_date, f.next_due_amount,
           lower(coalesce(f.admission_no, '')) = lower(q.text) as exact
    from public.v_workbook_student_financials f
    join guard g on f.session_label = g.label
    cross join q
    where q.text is not null and length(q.text) between 2 and 60
      and (
        lower(coalesce(f.admission_no, '')) = lower(q.text)
        or f.student_name ilike '%' || replace(replace(replace(q.text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
  )
  select case when not exists (select 1 from guard) then null else jsonb_build_object(
    'day', p_day,
    'today', (
      select jsonb_build_object(
        'total', coalesce(sum(p.net), 0),
        'count', count(*) filter (where p.net > 0),
        'by_mode', coalesce((
          select jsonb_agg(jsonb_build_object('mode', m.mode, 'total', m.total, 'count', m.n) order by m.total desc)
          from (
            select p2.mode, sum(p2.net) as total, count(*) filter (where p2.net > 0) as n
            from paid p2
            where p2.day = p_day
            group by p2.mode
            having sum(p2.net) > 0
          ) m
        ), '[]'::jsonb))
      from paid p
      where p.day = p_day
    ),
    'last_day', (
      select jsonb_build_object('day', d.day, 'total', sum(p.net), 'count', count(*) filter (where p.net > 0))
      from (select max(p0.day) as day from paid p0 where p0.day < p_day and p0.net > 0) d
      join paid p on p.day = d.day
      group by d.day
    ),
    'month', (
      select jsonb_build_object('total', coalesce(sum(p.net), 0), 'count', count(*) filter (where p.net > 0))
      from paid p
      where p.day >= date_trunc('month', p_day)::date and p.day <= p_day
    ),
    'session', (
      select jsonb_build_object(
        'collected', (select coalesce(sum(p.net), 0) from paid p),
        'fees_pending', coalesce(sum(m.base_outstanding_amount) filter (where m.base_outstanding_amount > 0), 0),
        'late_pending', coalesce(sum(m.late_fee_outstanding_amount) filter (where m.late_fee_outstanding_amount > 0), 0),
        'with_dues', count(*) filter (where m.base_outstanding_amount > 0),
        'overdue', count(*) filter (where m.base_outstanding_amount > 0 and coalesce(m.overdue_installment_count, 0) > 0),
        'late_only', count(*) filter (where coalesce(m.base_outstanding_amount, 0) <= 0 and m.late_fee_outstanding_amount > 0),
        'students', count(*))
      from money m
    ),
    'query', (select q.text from q),
    'match_count', (select count(*) from found),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
          'student_id', x.student_id, 'admission_no', x.admission_no, 'name', x.student_name,
          'class_label', x.class_label, 'status', x.status,
          'fees_pending', x.fees_pending, 'late_pending', x.late_pending, 'total_paid', x.total_paid,
          'last_payment_date', x.last_payment_date, 'last_payment_amount', x.last_payment_amount,
          'overdue_installments', x.overdue_installments,
          'next_due_date', x.next_due_date, 'next_due_amount', x.next_due_amount)
        order by x.exact desc, x.student_name)
      from (select * from found order by exact desc, student_name limit 6) x
    ), '[]'::jsonb)
  ) end;
$$;

comment on function vppsone.staff_helper_fees(text, date, text) is
  'Veer Patta AI (D-607): fee figures for a member of staff on WhatsApp, TEST sessions only (null otherwise). Today''s, the last day''s, the month''s and the session''s collection net of reversals and without write-offs; fees pending and late fees pending kept apart; up to six students matching an admission number or a name. Service role only.';

revoke all on function vppsone.staff_helper_fees(text, date, text) from public, anon, authenticated;
grant execute on function vppsone.staff_helper_fees(text, date, text) to service_role;

commit;
