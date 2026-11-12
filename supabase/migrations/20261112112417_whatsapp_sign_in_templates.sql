-- The two sign-in code templates on the school's hub (D-587, 12 Nov 2026).
--
-- Meta's AUTHENTICATION kind: Meta writes the words (the code, "for your
-- security, do not share this code", "this code expires in 10 minutes") and
-- the Copy code button. One fills one blank, the code, in the body and the
-- button (src/modules/whatsapp/data/sign-in-codes.ts). The submission is
-- SIGN_IN_HUB_SUBMISSIONS in src/modules/whatsapp/domain/hub-templates.ts.
--
-- Added only now because the hub that understands an AUTHENTICATION
-- submission is deployed (build 2026-11-12.sign-in-codes-2): a row in place
-- earlier would have been sent to the old hub by the hourly job, refused, and
-- left for an admin to send again.
--
-- Rows only, `not_submitted`: nothing is sent to anyone. The hourly template
-- check sends them to Meta by itself. `url_button` is false: Meta lists the
-- Copy code button as a URL button, but One never adds a link to it.
--
-- Rollback, only while neither is approved and in use: remove the two rows.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, category, body_params, param_names, header, url_button, label_en, label_hi) values
  ('vpps_sign_in_code_hi_v1', 'vpps_sign_in_code_hi_v1', 'hi', 'staff_login', 'authentication', 1, array['code']::text[], 'none', false, 'Sign-in code for staff, on the hub (hi)', 'साइन-इन कोड'),
  ('vpps_sign_in_code_en_v1', 'vpps_sign_in_code_en_v1', 'en', 'staff_login', 'authentication', 1, array['code']::text[], 'none', false, 'Sign-in code for staff, on the hub (en)', 'साइन-इन कोड')
on conflict (key) do nothing;

commit;
