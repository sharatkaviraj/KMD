-- Veer Patta AI sends a family its child's report card (D-613, exams step 4).
--
-- `parent_helper_child` (20261112041158) gains two things on each released
-- result and two on the child:
--
--  * on a result, its exam `code` and each subject's `code`, so the one-line
--    summary can name the subjects the card calls strongest and to practise;
--  * on a result, `card`: the term's report card as the school ISSUED it, its
--    figures and the exams it carries. Never a preview: a card the office has
--    not issued is not sent, and nothing here reads marks still being entered;
--  * on the child, `released_codes`: every exam released for the child's class, so a card
--    goes only when every exam on it is out (a Term 1 card reissued after a
--    later, unreleased exam is held back);
--  * on the child, `pending_results`: up to two exams the child sat whose results are not
--    out yet, by name and the day the plan gives, so the helper can say when
--    they come. No mark, no subject.
--
-- Everything else is byte-for-byte the function as it was, and it is still
-- for test-year children only. Additive: `create or replace`, the same
-- signature, so the grants stand.

create or replace function vppsone.parent_helper_child(p_student_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'Asia/Kolkata')::date as d
  ),
  kid as (
    select s.id, s.full_name, s.class_id, s.status::text as status,
           c.session_label, c.class_name, c.section, c.stream_name
    from public.students s
    join public.classes c on c.id = s.class_id
    where s.id = p_student_id
      -- Step 1: test-year children only. A real family's fees come from the
      -- Fees app through its own connection, never from this replica.
      and c.session_label ~* '^(TEST|UAT|DEMO)-'
  )
  select case when not exists (select 1 from kid) then null else jsonb_build_object(
    'today', (select d from today),
    'student', (
      select jsonb_build_object(
        'id', k.id, 'full_name', k.full_name, 'class_id', k.class_id, 'status', k.status,
        'session_label', k.session_label, 'class_name', k.class_name, 'section', k.section, 'stream_name', k.stream_name)
      from kid k
    ),
    -- Fees only in `pending`; the late fee is its own column, never added in.
    'installments', coalesce((
      select jsonb_agg(jsonb_build_object(
          'installment_no', b.installment_no, 'due_date', b.due_date, 'pending', b.pending_amount,
          'late_pending', b.late_fee_pending, 'applied', b.applied_amount, 'carry_forward', b.is_carry_forward)
        order by b.due_date, b.installment_no)
      from public.v_workbook_installment_balances b
      join kid k on k.id = b.student_id and b.session_label = k.session_label
    ), '[]'::jsonb),
    -- The five latest receipts. A write-off is not a payment and is left out;
    -- a reversed receipt stays, marked.
    'receipts', coalesce((
      select jsonb_agg(q.r order by q.d desc, q.n desc)
      from (
        select jsonb_build_object(
            'number', r.receipt_number, 'date', r.payment_date, 'amount', r.total_amount,
            'mode', r.payment_mode::text,
            'reversed', r.total_amount > 0 and coalesce(t.reversed_amount, 0) >= r.total_amount) as r,
          r.payment_date as d, r.receipt_number as n
        from public.receipts r
        join kid k on k.id = r.student_id
        left join public.v_receipt_reversal_totals t on t.receipt_id = r.id
        where r.payment_mode::text <> 'discount'
        order by r.payment_date desc, r.receipt_number desc
        limit 5
      ) q
    ), '[]'::jsonb),
    'attendance', (
      select jsonb_build_object(
        'attendance_pct', a.attendance_pct, 'days_counted', a.days_counted,
        'absent_days', a.absent_days, 'late_days', a.late_days)
      from vppsone.v_student_attendance a
      join kid k on k.id = a.student_id and a.session_label = k.session_label
    ),
    -- The daily register's last 30 days, submitted registers only.
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', g.day, 'status', m.status::text) order by g.day desc)
      from vppsone.attendance_marks m
      join vppsone.attendance_registers g on g.id = m.register_id
      join kid k on k.id = m.student_id and g.session_label = k.session_label
      where g.status = 'submitted' and g.period is null and g.day >= (select d from today) - 30
    ), '[]'::jsonb),
    -- What the school has finished: results released, the child's class locked.
    'results', coalesce((
      select jsonb_agg(q.e order by q.s desc nulls last)
      from (
        select jsonb_build_object(
            'label', a.label_en, 'label_hi', a.label_hi, 'term', a.term, 'code', a.code,
            'subjects', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'name', coalesce(sub.name_en, s2.subject_code), 'name_hi', sub.name_hi, 'max', s2.max_marks,
                  'code', s2.subject_code,
                  'value', mk.value, 'absent', coalesce(mk.absent, false), 'exempt', coalesce(mk.exempt, false))
                order by s2.sort_order, sub.sort_order)
              from vppsone.assessment_subjects s2
              left join vppsone.subjects sub on sub.id = s2.subject_id
              left join vppsone.marks mk on mk.assessment_subject_id = s2.id and mk.student_id = k.id
              where s2.assessment_id = a.id and s2.class_id = k.class_id
            ), '[]'::jsonb),
            -- The term's report card as the school ISSUED it (D-613): its
            -- figures for the one-line summary, and the exams on it, so a
            -- card is sent only when every exam it carries is released.
            'card', (
              select jsonb_build_object(
                  'revision', r.revision,
                  'percent', r.card->'totals'->'percent',
                  'grade', r.card->'grade',
                  'status', r.card->'status',
                  'passed', r.card->'passed',
                  'rank', r.card->'rank',
                  'rank_of', r.card->'rankOf',
                  'strengths', coalesce(r.card->'insight'->'strengths', '[]'::jsonb),
                  'focus', coalesce(r.card->'insight'->'focus', '[]'::jsonb),
                  'trend', r.card->'insight'->'trend',
                  'growth', r.card->'insight'->'growth',
                  'codes', coalesce((
                    select jsonb_agg(distinct m.value->>'assessmentCode')
                    from jsonb_array_elements(
                      case when jsonb_typeof(r.card->'rows') = 'array' then r.card->'rows' else '[]'::jsonb end
                      || case when jsonb_typeof(r.card->'apart') = 'array' then r.card->'apart' else '[]'::jsonb end) w,
                      jsonb_array_elements(case when jsonb_typeof(w.value->'marks') = 'array' then w.value->'marks' else '[]'::jsonb end) m
                  ), '[]'::jsonb))
              from vppsone.report_card_issues r
              where r.student_id = k.id and r.session_label = k.session_label and r.term = a.term and r.status = 'issued'
              order by r.revision desc
              limit 1
            )) as e,
          a.starts_on as s
        from vppsone.assessments a
        join kid k on k.session_label = a.session_label
        join vppsone.exam_class_locks l on l.assessment_id = a.id and l.class_id = k.class_id
        join vppsone.exam_plans p on p.assessment_id = a.id
        where p.results_published_at is not null
           or (p.results_publish_at is not null and p.results_publish_at <= now())
        order by a.starts_on desc nulls last
        limit 3
      ) q
    ), '[]'::jsonb),
    -- Every exam whose results this child's class has had released (D-613).
    'released_codes', coalesce((
      select jsonb_agg(distinct a.code)
      from vppsone.assessments a
      join kid k on k.session_label = a.session_label
      join vppsone.exam_class_locks l on l.assessment_id = a.id and l.class_id = k.class_id
      join vppsone.exam_plans p on p.assessment_id = a.id
      where p.results_published_at is not null
         or (p.results_publish_at is not null and p.results_publish_at <= now())
    ), '[]'::jsonb),
    -- Exams the child sat whose results are not out for the class yet (D-613):
    -- only their names and the day the plan gives, never a mark.
    'pending_results', coalesce((
      select jsonb_agg(q.e order by q.s desc nulls last)
      from (
        select jsonb_build_object(
            'label', a.label_en, 'label_hi', a.label_hi, 'term', a.term,
            'results_on', p.results_on, 'publish_at', p.results_publish_at) as e,
          a.starts_on as s
        from vppsone.assessments a
        join kid k on k.session_label = a.session_label
        left join vppsone.exam_plans p on p.assessment_id = a.id
        where a.status::text <> 'draft'
          and exists (
            select 1
            from vppsone.assessment_subjects s2
            join vppsone.marks mk on mk.assessment_subject_id = s2.id and mk.student_id = k.id
            where s2.assessment_id = a.id and s2.class_id = k.class_id)
          and not (
            exists (select 1 from vppsone.exam_class_locks l where l.assessment_id = a.id and l.class_id = k.class_id)
            and coalesce(p.results_published_at is not null or (p.results_publish_at is not null and p.results_publish_at <= now()), false))
        order by a.starts_on desc nulls last
        limit 2
      ) q
    ), '[]'::jsonb),
    'class_teacher', (
      select jsonb_build_object('staff_id', sp.id, 'name', sp.display_name, 'is_test', coalesce(sp.is_test_account, false))
      from vppsone.class_teachers ct
      join vppsone.staff_profiles sp on sp.id = ct.staff_profile_id
      join kid k on ct.class_id = k.class_id and ct.session_label = k.session_label
      where ct.role = 'class_teacher' and sp.is_active
        and (ct.effective_from is null or ct.effective_from <= (select d from today))
        and (ct.effective_to is null or ct.effective_to >= (select d from today))
      order by ct.effective_from desc nulls last
      limit 1
    ),
    -- The next 30 days of the child's own session calendar.
    'calendar', coalesce((
      select jsonb_agg(jsonb_build_object(
          'date', e.starts_on, 'until', e.ends_on, 'title', e.title, 'title_hi', e.title_hi, 'kind', e.kind)
        order by e.starts_on)
      from vppsone.calendar_events e
      join kid k on e.session_label = k.session_label
      where e.cancelled_at is null
        and coalesce(e.ends_on, e.starts_on) >= (select d from today)
        and e.starts_on <= (select d from today) + 30
        and (e.class_ids is null or cardinality(e.class_ids) = 0 or k.class_id = any(e.class_ids))
    ), '[]'::jsonb)
  ) end;
$$;

comment on function vppsone.parent_helper_child(uuid) is
  'Veer Patta AI (D-574): one TEST child''s facts in one read. Results only when released and the class locked; the issued report card per term and the exams still to come (D-613).';
