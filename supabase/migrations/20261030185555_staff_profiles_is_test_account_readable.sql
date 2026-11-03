-- The signed-in person reads their own `is_test_account` (current-staff.ts
-- selects it beside the profile). 20261004041954 replaced the table-wide
-- SELECT grant with a column list, and 20261030112133 added the column after
-- it, so `authenticated` could not read it: every signed-in page answered
-- "permission denied for table staff_profiles" and sent the person to
-- /login?reason=no-profile. Row visibility is still decided by RLS.
--
-- Found running tests/e2e/test-session.spec.ts against a local next dev
-- (Phase C, 31 Oct). Applied to wtgxcptmucjerhufzjcf through the Supabase MCP.
grant select (is_test_account) on vppsone.staff_profiles to authenticated;
