-- Fake data for the Admissions screen (UI P10 part 2). Applied to
-- schoolfees-dev (wtgxcptmucjerhufzjcf) only. Every name and number here is
-- invented; none is a real child or parent. Re-running replaces the seeded
-- enquiries (they carry notes = 'vx-seed') and upserts the seat counts.

delete from vppsone.enquiries where notes = 'vx-seed';

insert into vppsone.enquiries (session_label, stage, child_name, class_label, parent_name, phone, notes, created_at, stage_changed_at)
values
  ('2026-27', 'enquiry', 'Advik Senara',    'SKG',      'Pankaj Senara',    '9000000101', 'vx-seed', now() - interval '2 days', now() - interval '2 days'),
  ('2026-27', 'enquiry', 'Myra Kumbhalgarhi', 'Class 1', 'Suresh Kumbhalgarhi', '9000000102', 'vx-seed', now() - interval '5 days', now() - interval '5 days'),
  ('2026-27', 'enquiry', 'Reyansh Talwar',  'Class 7',  'Dilip Talwar',     '9000000103', 'vx-seed', now() - interval '1 day',  now() - interval '1 day'),
  ('2026-27', 'enquiry', 'Kiara Ranawat',   'JKG',      'Naveen Ranawat',   '9000000104', 'vx-seed', now() - interval '9 days', now() - interval '9 days'),
  ('2026-27', 'enquiry', 'Laksh Gehlotra',  'Class 9',  'Bhagwan Gehlotra', '9000000105', 'vx-seed', now() - interval '3 days', now() - interval '3 days'),
  ('2026-27', 'visited', 'Aadhya Bhatiwal', 'Nursery',  'Mahendra Bhatiwal','9000000106', 'vx-seed', now() - interval '6 days', now() - interval '4 days'),
  ('2026-27', 'visited', 'Vihaan Jainwal',  'Class 3',  'Sandeep Jainwal',  '9000000107', 'vx-seed', now() - interval '4 days', now() - interval '2 days'),
  ('2026-27', 'visited', 'Prisha Davera',   '11 Commerce', 'Hitesh Davera', '9000000108', 'vx-seed', now() - interval '8 days', now() - interval '6 days'),
  ('2026-27', 'visited', 'Rudransh Solara', 'Class 7',  'Gajendra Solara',  '9000000109', 'vx-seed', now() - interval '2 days', now() - interval '1 day'),
  ('2026-27', 'form',    'Ishaan Regara',   'Class 2',  'Mukesh Regara',    '9000000110', 'vx-seed', now() - interval '7 days', now() - interval '3 days'),
  ('2026-27', 'form',    'Kavya Senwal',    'Class 2',  'Manish Senwal',    '9000000111', 'vx-seed', now() - interval '12 days', now() - interval '8 days'),
  ('2026-27', 'form',    'Tanishka Meenal', 'Class 8',  'Ramesh Meenal',    '9000000112', 'vx-seed', now() - interval '5 days', now() - interval '2 days');

-- Seats per class for the current session: a round number above today's roll
-- so the board shows a believable "seats left" without inventing a policy.
insert into vppsone.class_seats (session_label, class_id, seats)
select c.session_label, c.id, greatest(25, (ceil((coalesce(n.cnt, 0) + 4) / 5.0) * 5)::int)
from public.classes c
left join (
  select class_id, count(*) cnt from public.students where status = 'active' group by class_id
) n on n.class_id = c.id
where c.session_label = '2026-27'
on conflict (session_label, class_id) do update set seats = excluded.seats, updated_at = now();
