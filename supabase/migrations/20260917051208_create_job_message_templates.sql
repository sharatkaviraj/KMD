-- The two staff templates the reminder jobs prepare messages against (7.2).
--
-- Rows rather than code because a template is wording the school owns and
-- AiSensy has approved, and because a job that had to invent its own text
-- would put a sentence in front of a teacher that nobody signed off. Both are
-- `audience = 'staff'`: a parent-facing reminder is refused by `mayDispatch()`
-- whatever a screen believes (D-10, D-76), and a scheduled job is the last
-- place that rule should be tested.
--
-- `on conflict do nothing` so this is safe on a database where somebody has
-- already edited the wording.

insert into vppsone.message_templates
  (code, label_hi, label_en, body_hi, body_en, variables, has_url_button, audience, sort_order)
values
  (
    'vppsone_attendance_reminder',
    'हाज़िरी की याद',
    'Attendance reminder',
    'नमस्ते {{1}}, आज की हाज़िरी अभी जमा नहीं हुई है। कृपया भर दीजिए।',
    'Hello {{1}}, today''s register has not been submitted yet. Please fill it in.',
    array['Teacher name'],
    false,
    'staff',
    3
  ),
  (
    'vppsone_marks_reminder',
    'बाकी अंकों की याद',
    'Marks reminder',
    'नमस्ते {{1}}, इन पेपरों के अंक अभी बाकी हैं: {{2}}',
    'Hello {{1}}, these papers still have marks outstanding: {{2}}',
    array['Teacher name', 'Which papers'],
    false,
    'staff',
    4
  )
on conflict (code) do nothing;
