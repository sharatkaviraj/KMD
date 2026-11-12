-- One's staff notices and teacher tasks on the school's WhatsApp hub (owner,
-- 12 Nov 2026: "Yes submit them"). D-573.
--
-- The staff templates were written for AiSensy: one name per message, one
-- English body, most starting with the person's name ("{{1}}, ...") and
-- ending with a link ("... {{6}}"). Meta refuses a body that starts or ends
-- with a blank, and a Hindi reader would get English words around Hindi
-- values. So the hub gets its own copy of each, one name per message and
-- language (vpps_staff_<slug>_<hi|en>_v1), with a title, the school's name,
-- one labelled line per value and a closing line. The blanks keep the old
-- order, so the renderers are unchanged; One sends under these names at the
-- last step (src/modules/whatsapp/domain/staff-hub-templates.ts, staffHubKey).
--
-- Rows only, all `not_submitted`: nothing is sent to anyone. The hourly
-- template check (pg_cron job 'whatsapp-templates') sends a never-sent row to
-- Meta for approval by itself, up to 15 an hour; Settings -> WhatsApp ->
-- Send for approval sends the rest. The parents' school notices (absent
-- today, school closed, exam schedule, PTM) already have rows
-- (20261109062459) and go as they are. The old AiSensy-era staff rows stay as
-- history; Settings counts a feature against its hub names once it has them.
--
-- Rollback, only while none is approved and in use: remove the 40 rows whose
-- key starts with vpps_staff_ (their names are listed below).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en, label_hi) values
  ('vpps_staff_cover_assigned_hi_v1', 'vpps_staff_cover_assigned_hi_v1', 'hi', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover assigned, on the hub (hi)', 'आपके लिए व्यवस्था'),
  ('vpps_staff_cover_assigned_en_v1', 'vpps_staff_cover_assigned_en_v1', 'en', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover assigned, on the hub (en)', 'आपके लिए व्यवस्था'),
  ('vpps_staff_cover_changed_hi_v1', 'vpps_staff_cover_changed_hi_v1', 'hi', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover changed, on the hub (hi)', 'व्यवस्था में बदलाव'),
  ('vpps_staff_cover_changed_en_v1', 'vpps_staff_cover_changed_en_v1', 'en', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover changed, on the hub (en)', 'व्यवस्था में बदलाव'),
  ('vpps_staff_cover_cancelled_hi_v1', 'vpps_staff_cover_cancelled_hi_v1', 'hi', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover cancelled, on the hub (hi)', 'व्यवस्था रद्द'),
  ('vpps_staff_cover_cancelled_en_v1', 'vpps_staff_cover_cancelled_en_v1', 'en', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover cancelled, on the hub (en)', 'व्यवस्था रद्द'),
  ('vpps_staff_cover_needed_hi_v1', 'vpps_staff_cover_needed_hi_v1', 'hi', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover refused, on the hub (hi)', 'व्यवस्था चाहिए'),
  ('vpps_staff_cover_needed_en_v1', 'vpps_staff_cover_needed_en_v1', 'en', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover refused, on the hub (en)', 'व्यवस्था चाहिए'),
  ('vpps_staff_register_not_saved_hi_v1', 'vpps_staff_register_not_saved_hi_v1', 'hi', 'staff_notice', 4, array['name', 'day', 'class', 'link']::text[], 'none', false, 'Register not saved, on the hub (hi)', 'हाज़िरी दर्ज नहीं हुई'),
  ('vpps_staff_register_not_saved_en_v1', 'vpps_staff_register_not_saved_en_v1', 'en', 'staff_notice', 4, array['name', 'day', 'class', 'link']::text[], 'none', false, 'Register not saved, on the hub (en)', 'हाज़िरी दर्ज नहीं हुई'),
  ('vpps_staff_marks_pending_hi_v1', 'vpps_staff_marks_pending_hi_v1', 'hi', 'staff_notice', 2, array['Teacher name', 'Which papers']::text[], 'none', false, 'Marks reminder, on the hub (hi)', 'अंक बाकी'),
  ('vpps_staff_marks_pending_en_v1', 'vpps_staff_marks_pending_en_v1', 'en', 'staff_notice', 2, array['Teacher name', 'Which papers']::text[], 'none', false, 'Marks reminder, on the hub (en)', 'अंक बाकी'),
  ('vpps_staff_weekly_summary_hi_v1', 'vpps_staff_weekly_summary_hi_v1', 'hi', 'staff_notice', 3, array['name', 'summary', 'from']::text[], 'none', false, 'Weekly academic summary, on the hub (hi)', 'साप्ताहिक शैक्षणिक सारांश'),
  ('vpps_staff_weekly_summary_en_v1', 'vpps_staff_weekly_summary_en_v1', 'en', 'staff_notice', 3, array['name', 'summary', 'from']::text[], 'none', false, 'Weekly academic summary, on the hub (en)', 'साप्ताहिक शैक्षणिक सारांश'),
  ('vpps_staff_notice_hi_v1', 'vpps_staff_notice_hi_v1', 'hi', 'staff_notice', 1, array['text']::text[], 'none', false, 'Staff notice, on the hub (hi)', 'स्टाफ़ सूचना'),
  ('vpps_staff_notice_en_v1', 'vpps_staff_notice_en_v1', 'en', 'staff_notice', 1, array['text']::text[], 'none', false, 'Staff notice, on the hub (en)', 'स्टाफ़ सूचना'),
  ('vpps_staff_online_payment_check_hi_v1', 'vpps_staff_online_payment_check_hi_v1', 'hi', 'staff_notice', 4, array['name', 'amount', 'student or class', 'link']::text[], 'none', false, 'Online payment needs review, on the hub (hi)', 'ऑनलाइन भुगतान जाँचें'),
  ('vpps_staff_online_payment_check_en_v1', 'vpps_staff_online_payment_check_en_v1', 'en', 'staff_notice', 4, array['name', 'amount', 'student or class', 'link']::text[], 'none', false, 'Online payment needs review, on the hub (en)', 'ऑनलाइन भुगतान जाँचें'),
  ('vpps_staff_online_payment_hi_v1', 'vpps_staff_online_payment_hi_v1', 'hi', 'staff_notice', 5, array['name', 'amount', 'student or class', 'receipt', 'link']::text[], 'none', false, 'Online payment received, on the hub (hi)', 'ऑनलाइन भुगतान मिला'),
  ('vpps_staff_online_payment_en_v1', 'vpps_staff_online_payment_en_v1', 'en', 'staff_notice', 5, array['name', 'amount', 'student or class', 'receipt', 'link']::text[], 'none', false, 'Online payment received, on the hub (en)', 'ऑनलाइन भुगतान मिला'),
  ('vpps_staff_day_collection_hi_v1', 'vpps_staff_day_collection_hi_v1', 'hi', 'staff_notice', 6, array['name', 'day', 'total', 'receipts', 'by mode', 'link']::text[], 'none', false, 'Day''s collection, on the hub (hi)', 'दिन का फ़ीस संग्रह'),
  ('vpps_staff_day_collection_en_v1', 'vpps_staff_day_collection_en_v1', 'en', 'staff_notice', 6, array['name', 'day', 'total', 'receipts', 'by mode', 'link']::text[], 'none', false, 'Day''s collection, on the hub (en)', 'दिन का फ़ीस संग्रह'),
  ('vpps_staff_day_not_closed_hi_v1', 'vpps_staff_day_not_closed_hi_v1', 'hi', 'staff_notice', 5, array['name', 'day', 'receipts', 'total', 'link']::text[], 'none', false, 'Day not closed, on the hub (hi)', 'दिन बंद नहीं हुआ'),
  ('vpps_staff_day_not_closed_en_v1', 'vpps_staff_day_not_closed_en_v1', 'en', 'staff_notice', 5, array['name', 'day', 'receipts', 'total', 'link']::text[], 'none', false, 'Day not closed, on the hub (en)', 'दिन बंद नहीं हुआ'),
  ('vpps_staff_money_request_hi_v1', 'vpps_staff_money_request_hi_v1', 'hi', 'staff_notice', 6, array['name', 'what', 'amount', 'student or class', 'asked by', 'link']::text[], 'none', false, 'Reversal or write-off requested, on the hub (hi)', 'निर्णय चाहिए'),
  ('vpps_staff_money_request_en_v1', 'vpps_staff_money_request_en_v1', 'en', 'staff_notice', 6, array['name', 'what', 'amount', 'student or class', 'asked by', 'link']::text[], 'none', false, 'Reversal or write-off requested, on the hub (en)', 'निर्णय चाहिए'),
  ('vpps_staff_money_decision_hi_v1', 'vpps_staff_money_decision_hi_v1', 'hi', 'staff_notice', 6, array['name', 'what', 'decision', 'amount', 'student or class', 'link']::text[], 'none', false, 'Reversal or write-off decided, on the hub (hi)', 'अनुरोध पर निर्णय'),
  ('vpps_staff_money_decision_en_v1', 'vpps_staff_money_decision_en_v1', 'en', 'staff_notice', 6, array['name', 'what', 'decision', 'amount', 'student or class', 'link']::text[], 'none', false, 'Reversal or write-off decided, on the hub (en)', 'अनुरोध पर निर्णय'),
  ('vpps_staff_leave_request_hi_v1', 'vpps_staff_leave_request_hi_v1', 'hi', 'staff_notice', 4, array['name', 'teacher', 'dates', 'link']::text[], 'none', false, 'Leave requested, on the hub (hi)', 'छुट्टी का अनुरोध'),
  ('vpps_staff_leave_request_en_v1', 'vpps_staff_leave_request_en_v1', 'en', 'staff_notice', 4, array['name', 'teacher', 'dates', 'link']::text[], 'none', false, 'Leave requested, on the hub (en)', 'छुट्टी का अनुरोध'),
  ('vpps_staff_leave_decided_hi_v1', 'vpps_staff_leave_decided_hi_v1', 'hi', 'staff_notice', 4, array['name', 'dates', 'decision', 'link']::text[], 'none', false, 'Leave decided, on the hub (hi)', 'छुट्टी पर निर्णय'),
  ('vpps_staff_leave_decided_en_v1', 'vpps_staff_leave_decided_en_v1', 'en', 'staff_notice', 4, array['name', 'dates', 'decision', 'link']::text[], 'none', false, 'Leave decided, on the hub (en)', 'छुट्टी पर निर्णय'),
  ('vpps_staff_system_check_hi_v1', 'vpps_staff_system_check_hi_v1', 'hi', 'staff_notice', 5, array['name', 'day', 'count', 'what', 'link']::text[], 'none', false, 'System check, on the hub (hi)', 'सिस्टम जाँच'),
  ('vpps_staff_system_check_en_v1', 'vpps_staff_system_check_en_v1', 'en', 'staff_notice', 5, array['name', 'day', 'count', 'what', 'link']::text[], 'none', false, 'System check, on the hub (en)', 'सिस्टम जाँच'),
  ('vpps_staff_digest_hi_v1', 'vpps_staff_digest_hi_v1', 'hi', 'staff_notice', 4, array['name', 'count', 'what', 'link']::text[], 'none', false, 'Several messages at once, on the hub (hi)', 'आपके लिए नए संदेश'),
  ('vpps_staff_digest_en_v1', 'vpps_staff_digest_en_v1', 'en', 'staff_notice', 4, array['name', 'count', 'what', 'link']::text[], 'none', false, 'Several messages at once, on the hub (en)', 'आपके लिए नए संदेश'),
  ('vpps_staff_task_hi_v1', 'vpps_staff_task_hi_v1', 'hi', 'teacher_task', 3, array['teacher', 'task', 'due']::text[], 'none', true, 'Teacher task, on the hub (hi)', 'नया कार्य'),
  ('vpps_staff_task_en_v1', 'vpps_staff_task_en_v1', 'en', 'teacher_task', 3, array['teacher', 'task', 'due']::text[], 'none', true, 'Teacher task, on the hub (en)', 'नया कार्य'),
  ('vpps_staff_task_reminder_hi_v1', 'vpps_staff_task_reminder_hi_v1', 'hi', 'teacher_task', 3, array['teacher', 'task', 'due']::text[], 'none', true, 'Task reminder, on the hub (hi)', 'कार्य की याद'),
  ('vpps_staff_task_reminder_en_v1', 'vpps_staff_task_reminder_en_v1', 'en', 'teacher_task', 3, array['teacher', 'task', 'due']::text[], 'none', true, 'Task reminder, on the hub (en)', 'कार्य की याद')

on conflict (key) do nothing;

commit;
