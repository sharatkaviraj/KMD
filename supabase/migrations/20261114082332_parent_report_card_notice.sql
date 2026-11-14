-- "Results are out": the school's approved message to a parent once a
-- child's report card is issued and the exam released, with one quick reply,
-- Get report card (D-614; the owner, 14 Nov 2026: "Yes get it for approval").
--
-- It names the child, the class and the exam. The quick reply carries the
-- child's own id back when tapped (`vpai:report_card:<child>`), and Veer
-- Patta AI answers the tap as a result ask for that child: the issued card
-- as its PDF, only if every exam on it is released (D-613). The tap opens
-- the 24 hours, so the card itself needs no template.
--
-- What this adds: two registry rows, `not_submitted`, Hindi and English,
-- under `report_delivery` (Settings -> WhatsApp, "Report cards"). The hourly
-- template check sends each to Meta once by itself (the hub's
-- `POST /v1/templates`, the quick reply included); nothing is sent to anyone.
--
-- Nothing here sends to a parent: every message still passes
-- `checkWhatsAppSend` (the feature switch, real recipients, which are off and
-- leave only the owner's number, and practice mode).
--
-- Rollback: take out the two rows by key ('vpps_parent_report_card_hi_v1',
-- 'vpps_parent_report_card_en_v1') while they still read `not_submitted`.
-- Once Meta has them, leave them: a row Meta knows is how One reads its status.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en, label_hi) values
  ('vpps_parent_report_card_hi_v1', 'vpps_parent_report_card_hi_v1', 'hi', 'report_delivery', 3, array['student', 'class', 'exam']::text[], 'none', false, 'Results are out, with Get report card (hi)', 'परीक्षा परिणाम, रिपोर्ट कार्ड भेजें बटन के साथ'),
  ('vpps_parent_report_card_en_v1', 'vpps_parent_report_card_en_v1', 'en', 'report_delivery', 3, array['student', 'class', 'exam']::text[], 'none', false, 'Results are out, with Get report card (en)', 'परीक्षा परिणाम, रिपोर्ट कार्ड भेजें बटन के साथ')
on conflict (key) do nothing;

commit;
