-- The needs-attention read for ONE session (D-495).
--
-- `v_needs_attention` aggregates every attendance mark and every exam mark of
-- every session, and only then keeps the session asked for: the filter cannot
-- reach inside its CTEs. That cost ~0.5 s on a quiet database, and on a busy
-- one it ran past the 8 s statement timeout ("Could not read the attention
-- list", Academics and Student progress, 6-7 Nov 2026). Its marks rules are
-- also unused: the app works them out itself from dated exams (`marksFlags`).
--
-- This function narrows to the session first and returns only what the app
-- reads: attendance and open notes, for every enrolled child who has either.
-- Same rules as the view (75 % over at least 5 days; 2+ open non-praise
-- notes). The view stays for anything else that reads it.
create or replace function vppsone.needs_attention_for_session(p_session text)
returns table (
  student_id uuid,
  class_id uuid,
  attendance_pct numeric,
  days_counted bigint,
  open_notes integer,
  reasons text[]
)
language sql stable security invoker set search_path = ''
as $$
  with att as (
    select m.student_id,
           count(c.credit) as days_counted,
           round(100.0 * sum(c.credit) / nullif(count(c.credit), 0), 1) as attendance_pct
    from vppsone.attendance_registers r
    join vppsone.attendance_marks m on m.register_id = r.id
    left join vppsone.attendance_rules ar on ar.session_label = r.session_label
    cross join lateral (
      select case m.status
               when 'present' then 1.0
               when 'late' then 1.0
               when 'half_day' then coalesce(ar.half_day_credit, 0.5)
               when 'absent' then 0.0
               else null
             end as credit
    ) c
    where r.session_label = p_session and r.status = 'submitted' and r.period is null
    group by m.student_id
  ),
  notes_open as (
    select n.student_id, count(*)::integer as open_notes
    from vppsone.notes n
    join vppsone.note_kinds k on k.id = n.kind_id
    where n.session_label = p_session
      and n.student_id is not null
      and n.status in ('open', 'working')
      and k.tone <> 'good'
    group by n.student_id
  )
  select e.student_id,
         e.class_id,
         att.attendance_pct,
         coalesce(att.days_counted, 0) as days_counted,
         coalesce(o.open_notes, 0) as open_notes,
         array_remove(array[
           case when att.attendance_pct < 75 and att.days_counted >= 5 then 'attendance' end,
           case when coalesce(o.open_notes, 0) >= 2 then 'notes' end
         ], null) as reasons
  from vppsone.enrolments e
  left join att on att.student_id = e.student_id
  left join notes_open o on o.student_id = e.student_id
  where e.session_label = p_session
    and e.status = 'enrolled'
    and (att.student_id is not null or o.student_id is not null)
$$;

revoke all on function vppsone.needs_attention_for_session(text) from public, anon, authenticated;
grant execute on function vppsone.needs_attention_for_session(text) to service_role;
