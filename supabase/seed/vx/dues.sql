-- Fake seed for /dues (schoolfees-dev only). A few call promises (due today,
-- broken, upcoming, a visit) against students picked by subselect, and one
-- pending write-off request for a student who left. No names are stored: the
-- screens read the (de-identified) student from the fee tables.
-- Insert-only and re-runnable: guarded by the '[seed]' marker in the note.

with picked as (
  select s.id, row_number() over (order by s.admission_no) as n
  from public.students s
  join public.classes c on c.id = s.class_id
  where c.session_label = '2026-27' and s.status = 'active'
  order by s.admission_no
  limit 5
)
insert into vppsone.fee_call_promises (session_label, student_id, kind, promised_on, amount, note, created_by_name, created_at)
select '2026-27', p.id,
  case when p.n = 4 then 'visit' else 'pay' end,
  case p.n when 1 then date '2026-10-10' when 2 then date '2026-10-07' when 3 then date '2026-10-14'
           when 4 then date '2026-10-10' else date '2026-10-12' end,
  case when p.n = 4 then 0 else 1000 * p.n end,
  '[seed] Promised on a call.', 'Test Desk Clerk', timestamptz '2026-10-05T06:00:00Z'
from picked p
where not exists (select 1 from vppsone.fee_call_promises where note like '[seed]%');

insert into vppsone.fee_desk_requests (kind, status, session_label, student_id, amount, reason_code, note, requested_by_name)
select 'write_off', 'pending', '2026-27', s.id, 500, 'too_small', '[seed] Small balance after leaving.', 'Test Desk Clerk'
from public.students s
join public.classes c on c.id = s.class_id
where c.session_label = '2026-27' and s.status = 'left'
  and not exists (select 1 from vppsone.fee_desk_requests where note like '[seed]%')
order by s.admission_no
limit 1;
