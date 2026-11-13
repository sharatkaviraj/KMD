-- Veer Patta AI: a class teacher decides a parent's "my child will be away"
-- note from WhatsApp (D-602; the owner's idea 4, 12 Nov 2026).
--
-- When the helper tells a class teacher that a parent says their child will
-- be away, the alert carries three buttons: Mark Leave, Mark Absent and
-- Not now. While the teacher's chat with the school is open the alert is
-- typed, with reply buttons. Otherwise it is this approved message, whose
-- quick replies carry the note's own id back when tapped. A tap decides the
-- note as that teacher, exactly as the same button in One does
-- (`decide_parent_suggestions` with via 'whatsapp', 20261113021008): the
-- database checks again that they may, and that it still waits. Alerts go
-- only from 6 am to 9 pm, as every hand-off's do (D-578).
--
-- What this adds: two registry rows, `not_submitted`, Hindi and English. The
-- hourly template check sends each to Meta once by itself (the hub's
-- `POST /v1/templates`, quick replies included); nothing is sent to anyone.
-- Until Meta approves them, a teacher whose chat is closed gets the ordinary
-- staff alert, and the note waits for them in One.
--
-- Nothing here sends to a real person while practice mode is on or real
-- recipients are off: every message still passes `checkWhatsAppSend`.
--
-- Rollback: take out the two rows by key ('vpps_staff_away_note_hi_v1',
-- 'vpps_staff_away_note_en_v1') while they still read `not_submitted`. Once
-- Meta has them, leave them: a row Meta knows is how One reads its status.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en, label_hi) values
  ('vpps_staff_away_note_hi_v1', 'vpps_staff_away_note_hi_v1', 'hi', 'parent_helper', 4, array['name', 'student', 'away', 'message']::text[], 'none', false, 'A parent says a child will be away, with Mark Leave, Mark Absent and Not now (hi)', 'अभिभावक का छुट्टी का संदेश'),
  ('vpps_staff_away_note_en_v1', 'vpps_staff_away_note_en_v1', 'en', 'parent_helper', 4, array['name', 'student', 'away', 'message']::text[], 'none', false, 'A parent says a child will be away, with Mark Leave, Mark Absent and Not now (en)', 'अभिभावक का छुट्टी का संदेश')
on conflict (key) do nothing;

commit;
