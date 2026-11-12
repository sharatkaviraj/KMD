-- Thirteen staff copies reworded for Meta's review (D-581, 12 Nov 2026).
--
-- Of the 40 staff and teacher-task copies sent to Meta for approval on
-- 12 Nov (D-573), Meta re-filed 12 as marketing after approving them as
-- utility (about 7 times the price, and Meta holds some back from people
-- who get many) and turned one down as the wrong category (the Hindi
-- "online payment to check"). Meta never takes a name twice, so each is
-- reworded under the next name, _v2: no "open the app" lines, and each one
-- says whose work it is. The wording is in
-- src/modules/whatsapp/domain/staff-hub-templates.ts (`version`).
--
-- Rows only, all `not_submitted`: nothing is sent to anyone. The hourly
-- template check sends them to Meta by itself. The _v1 rows stay as history:
-- One no longer sends under those names, and the send policy refuses any
-- template Meta has filed as marketing (platform/whatsapp/policy.ts).
--
-- Rollback, only while none is approved and in use: remove the 13 rows whose
-- key ends in _v2 below.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en, label_hi) values
  ('vpps_staff_cover_cancelled_hi_v2', 'vpps_staff_cover_cancelled_hi_v2', 'hi', 'staff_notice', 6, array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], 'none', false, 'Cover cancelled, on the hub (hi, reworded)', 'कवर ड्यूटी रद्द'),
  ('vpps_staff_weekly_summary_hi_v2', 'vpps_staff_weekly_summary_hi_v2', 'hi', 'staff_notice', 3, array['name', 'summary', 'from']::text[], 'none', false, 'Weekly academic summary, on the hub (hi, reworded)', 'साप्ताहिक शैक्षणिक रिपोर्ट'),
  ('vpps_staff_notice_hi_v2', 'vpps_staff_notice_hi_v2', 'hi', 'staff_notice', 1, array['text']::text[], 'none', false, 'Staff notice, on the hub (hi, reworded)', 'विद्यालय स्टाफ़ के लिए सूचना'),
  ('vpps_staff_notice_en_v2', 'vpps_staff_notice_en_v2', 'en', 'staff_notice', 1, array['text']::text[], 'none', false, 'Staff notice, on the hub (en, reworded)', 'विद्यालय स्टाफ़ के लिए सूचना'),
  ('vpps_staff_online_payment_check_hi_v2', 'vpps_staff_online_payment_check_hi_v2', 'hi', 'staff_notice', 4, array['name', 'amount', 'student or class', 'link']::text[], 'none', false, 'Online payment needs review, on the hub (hi, reworded)', 'ऑनलाइन भुगतान दर्ज करना है'),
  ('vpps_staff_money_request_hi_v2', 'vpps_staff_money_request_hi_v2', 'hi', 'staff_notice', 6, array['name', 'what', 'amount', 'student or class', 'asked by', 'link']::text[], 'none', false, 'Reversal or write-off requested, on the hub (hi, reworded)', 'फ़ीस रिकॉर्ड की मंज़ूरी'),
  ('vpps_staff_money_request_en_v2', 'vpps_staff_money_request_en_v2', 'en', 'staff_notice', 6, array['name', 'what', 'amount', 'student or class', 'asked by', 'link']::text[], 'none', false, 'Reversal or write-off requested, on the hub (en, reworded)', 'फ़ीस रिकॉर्ड की मंज़ूरी'),
  ('vpps_staff_money_decision_hi_v2', 'vpps_staff_money_decision_hi_v2', 'hi', 'staff_notice', 6, array['name', 'what', 'decision', 'amount', 'student or class', 'link']::text[], 'none', false, 'Reversal or write-off decided, on the hub (hi, reworded)', 'फ़ीस रिकॉर्ड पर निर्णय'),
  ('vpps_staff_system_check_hi_v2', 'vpps_staff_system_check_hi_v2', 'hi', 'staff_notice', 5, array['name', 'day', 'count', 'what', 'link']::text[], 'none', false, 'System check, on the hub (hi, reworded)', 'सिस्टम जाँच की चेतावनी'),
  ('vpps_staff_system_check_en_v2', 'vpps_staff_system_check_en_v2', 'en', 'staff_notice', 5, array['name', 'day', 'count', 'what', 'link']::text[], 'none', false, 'System check, on the hub (en, reworded)', 'सिस्टम जाँच की चेतावनी'),
  ('vpps_staff_digest_hi_v2', 'vpps_staff_digest_hi_v2', 'hi', 'staff_notice', 4, array['name', 'count', 'what', 'link']::text[], 'none', false, 'Several messages at once, on the hub (hi, reworded)', 'आपकी स्टाफ़ सूचनाएँ'),
  ('vpps_staff_digest_en_v2', 'vpps_staff_digest_en_v2', 'en', 'staff_notice', 4, array['name', 'count', 'what', 'link']::text[], 'none', false, 'Several messages at once, on the hub (en, reworded)', 'आपकी स्टाफ़ सूचनाएँ'),
  ('vpps_staff_task_hi_v2', 'vpps_staff_task_hi_v2', 'hi', 'teacher_task', 3, array['teacher', 'task', 'due']::text[], 'none', true, 'Teacher task, on the hub (hi, reworded)', 'नया कार्य सौंपा गया')

on conflict (key) do nothing;

commit;
