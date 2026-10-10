-- VPPS One redesign — fake data for Messages and Timetable (schoolfees-dev only).
-- Invented names and unallocated 90000-series phone numbers. Idempotent:
-- fixed ids, ON CONFLICT DO NOTHING. Sends are seeded already sent/failed so
-- nothing here is ever picked up by a dispatcher.

insert into vppsone.message_campaigns (id, session_label, kind, title, body_hi, body_en, language, audience, class_ids, audience_label, recipient_count, cost_paise, status, client_request_id, created_by, created_at)
values
  ('7a000000-0000-4000-8000-000000000001', '2026-27', 'holiday', 'Dussehra holidays', 'प्रिय अभिभावक, विद्यालय 20 से 24 अक्टूबर तक दशहरा अवकाश हेतु बंद रहेगा।', 'Dear parent, school stays closed 20 to 24 October for Dussehra.', 'both', 'school', '{}', 'Whole school', 4, 352, 'queued', '7a000000-0000-4000-8000-0000000000c1', '1520b49a-5e25-4a53-8f3d-210a4d35fbeb', now() - interval '2 days'),
  ('7a000000-0000-4000-8000-000000000002', '2026-27', 'ptm', 'Parent-teacher meeting', 'प्रिय अभिभावक, शनिवार को सुबह 10 बजे अभिभावक-शिक्षक बैठक है।', 'Dear parent, the parent-teacher meeting is on Saturday at 10 am.', 'both', 'school', '{}', 'Whole school', 3, 264, 'queued', '7a000000-0000-4000-8000-0000000000c2', '1520b49a-5e25-4a53-8f3d-210a4d35fbeb', now() - interval '6 days')
on conflict do nothing;

insert into vppsone.message_sends (id, session_label, template_id, to_phone, to_name, variables, rendered_hi, rendered_en, status, error, requested_by, requested_at, sent_at, category, campaign_id)
select s.id::uuid, '2026-27', 'a4644a23-0d4d-4395-9b5c-ef4a521cd6e0', s.phone, s.name, array[c.body_hi || E'\n\n' || c.body_en], c.body_hi, c.body_en, s.status::vppsone.send_status, s.err, c.created_by, c.created_at,
       case when s.status = 'sent' then c.created_at + interval '2 minutes' end, 'general', c.id
from (values
  ('7a000000-0000-4000-8000-000000000101', '7a000000-0000-4000-8000-000000000001', '9000000101', 'Test Parent Asha', 'sent', null),
  ('7a000000-0000-4000-8000-000000000102', '7a000000-0000-4000-8000-000000000001', '9000000102', 'Test Parent Bhola', 'sent', null),
  ('7a000000-0000-4000-8000-000000000103', '7a000000-0000-4000-8000-000000000001', '9000000103', 'Test Parent Chanda', 'failed', 'Number is not on WhatsApp'),
  ('7a000000-0000-4000-8000-000000000104', '7a000000-0000-4000-8000-000000000001', '9000000104', 'Test Parent Dinesh', 'sent', null),
  ('7a000000-0000-4000-8000-000000000201', '7a000000-0000-4000-8000-000000000002', '9000000101', 'Test Parent Asha', 'sent', null),
  ('7a000000-0000-4000-8000-000000000202', '7a000000-0000-4000-8000-000000000002', '9000000102', 'Test Parent Bhola', 'sent', null),
  ('7a000000-0000-4000-8000-000000000203', '7a000000-0000-4000-8000-000000000002', '9000000105', 'Test Parent Esha', 'sent', null)
) as s(id, campaign, phone, name, status, err)
join vppsone.message_campaigns c on c.id = s.campaign::uuid
on conflict do nothing;

insert into vppsone.parent_replies (id, session_label, from_name, from_phone, student_label, campaign_id, regarding, body, received_at, status)
values
  ('7a000000-0000-4000-8000-000000000301', '2026-27', 'Test Parent Asha', '9000000101', 'Test Student A · Class 5', '7a000000-0000-4000-8000-000000000001', 'Dussehra holidays', 'Will the school bus run on 25 October?', now() - interval '1 day', 'open'),
  ('7a000000-0000-4000-8000-000000000302', '2026-27', 'Test Parent Bhola', '9000000102', 'Test Student B · Class 8', '7a000000-0000-4000-8000-000000000002', 'Parent-teacher meeting', 'मैं शनिवार को 11 बजे आ सकता हूँ, क्या ठीक है?', now() - interval '5 days', 'open'),
  ('7a000000-0000-4000-8000-000000000303', '2026-27', 'Test Parent Esha', '9000000105', 'Test Student E · Class 10', '7a000000-0000-4000-8000-000000000002', 'Parent-teacher meeting', 'Thank you, noted.', now() - interval '5 days', 'done')
on conflict do nothing;

insert into vppsone.teacher_leave (id, session_label, staff_profile_id, from_day, to_day, span, note, status, requested_by, created_at)
values
  ('7a000000-0000-4000-8000-000000000401', '2026-27', 'b7e485e7-356b-4f9b-a77a-e34432dd24d0', current_date + 3, current_date + 4, 'full', 'Family function (test)', 'asked', 'b7e485e7-356b-4f9b-a77a-e34432dd24d0', now() - interval '3 hours'),
  ('7a000000-0000-4000-8000-000000000402', '2026-27', '29d76340-1929-4848-ad4f-8a3ae5653a43', current_date + 6, current_date + 6, 'first_half', 'Doctor visit (test)', 'asked', '29d76340-1929-4848-ad4f-8a3ae5653a43', now() - interval '1 hour')
on conflict do nothing;
