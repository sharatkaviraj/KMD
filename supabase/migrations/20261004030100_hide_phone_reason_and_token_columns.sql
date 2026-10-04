-- P1, second half: three columns stop being readable straight from PostgREST.
--
--  - `staff_profiles.phone` and `whatsapp_phone`: a colleague's number is for
--    the people who keep the staff list, not for every account that can sign in.
--  - `teacher_absences.reason`: why a teacher is away is between them and the
--    person arranging cover. The new absence command does not ask for one.
--  - `collection_requests.token` and `contact_phone`: a token is the whole
--    authorization for its link (see the table comment), and any signed-in JWT
--    could list every one.
--
-- Separate from the row policies because the app read these through the cookie
-- client until the same pull request moved those reads behind a permission and
-- onto the service role. Applying this before that code is deployed breaks the
-- staff list, the cover planner and the collection list; applying it after
-- breaks nothing. Every embed in the app names only display_name, short_name and
-- preferred_language from staff_profiles, which stay readable.

-- Column privileges replace the table-wide SELECT. Every column not named here
-- is still readable under the row policy; these are read by the app through
-- the service role, after the permission that shows them.

revoke select on vppsone.staff_profiles from authenticated;
grant select (
  id, user_id, display_name, short_name, role, is_teaching, is_active,
  preferred_language, preferred_start, created_by, created_at, updated_at
) on vppsone.staff_profiles to authenticated;

revoke select on vppsone.teacher_absences from authenticated;
grant select (
  id, session_label, staff_profile_id, day, periods, created_by, created_at, updated_at
) on vppsone.teacher_absences to authenticated;

revoke select on vppsone.collection_requests from authenticated;
grant select (
  id, session_label, title_hi, title_en, class_id, class_label, assigned_staff_id,
  due_date, status, reason_hi, reason_en, opened_at, closed_at, created_by,
  created_at, updated_at, round_id, audience_kind, audience_label, sent_at, sent_by,
  reminded_at, reminded_by, reminder_count, archived_at, token_rotated_at
) on vppsone.collection_requests to authenticated;
