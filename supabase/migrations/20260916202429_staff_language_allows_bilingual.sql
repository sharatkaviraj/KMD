-- Language is a choice each staff member makes, not a decision the app makes
-- for everyone.
--
-- The column started as `hi | en`, but every screen was written with both
-- languages side by side regardless of it — so the column was stored and never
-- read. This adds the third option and makes the column mean something:
--
--   hi    Hindi only
--   en    English only
--   both  Hindi with English beneath it — what the app used to do for everybody
--
-- The default stays `hi`: most of the teaching staff read Hindi, and an admin
-- sets anything else when they create the profile (D-35).

alter table vppsone.staff_profiles
  drop constraint staff_profiles_preferred_language_known;

alter table vppsone.staff_profiles
  add constraint staff_profiles_preferred_language_known
  check (preferred_language in ('hi', 'en', 'both'));

comment on column vppsone.staff_profiles.preferred_language is
  'Which language this staff member reads the app in: hi, en, or both (Hindi with English beneath). Per account, not per app.';
