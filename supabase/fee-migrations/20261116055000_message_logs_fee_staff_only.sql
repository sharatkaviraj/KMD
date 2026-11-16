-- ============================================================================
-- VPPS One fee-migration (One-only): the message and follow-up logs are read
-- by fee staff only, not by every signed-in account (D-648, 16 Nov 2026).
--
-- Why this differs from the fees app: in the fees app every signed-in account
-- is a member of the fee office, so these eight read rules say "anyone signed
-- in" ((select auth.role()) = 'authenticated'). In One every member of staff
-- is signed in: teachers, the office, and the practice accounts. Until 16 Nov
-- these tables held the masked replica's invented people; the night's copy of
-- the fees app (vppsone.fees_copy_run, D-644) now brings the real reminder,
-- delivery and follow-up logs, with parents' numbers and the messages sent to
-- them. Read straight through the API with any staff sign-in, they would show
-- every family's number to every teacher.
--
-- What changes: the same eight rules ask for a fee permission instead.
-- public.has_permission is the fees app's own check (an active public.users
-- row whose role grants it). 'defaulters:view' is in every fee role (admin,
-- accountant, teacher, fee collector, viewer), so whoever read these in the
-- fees app still reads them in One; 'dashboard:view', likewise in every fee
-- role, for the activity log. A One account without a fee role reads nothing,
-- which is what One's own screens already assume: they read these tables with
-- the service key after One's own permission check (fees/platform/supabase).
--
-- Only the USING expression of each existing rule changes (alter policy): no
-- rule is added or removed, and writes, grants and the copy are untouched.
-- Rollback: alter each policy back to ((select auth.role()) = 'authenticated').
-- ============================================================================

alter policy "defaulter_contacts: staff read" on public.defaulter_contacts
  using ((select public.has_permission('defaulters:view')));

alter policy "whatsapp_reminder_sends: staff read" on public.whatsapp_reminder_sends
  using ((select public.has_permission('defaulters:view')));

alter policy "whatsapp_send_attempts: staff read" on public.whatsapp_send_attempts
  using ((select public.has_permission('defaulters:view')));

alter policy "whatsapp_test_sends: staff read" on public.whatsapp_test_sends
  using ((select public.has_permission('defaulters:view')));

alter policy "whatsapp_number_health: staff read" on public.whatsapp_number_health
  using ((select public.has_permission('defaulters:view')));

alter policy "whatsapp_campaign_runs: staff read" on public.whatsapp_campaign_runs
  using ((select public.has_permission('defaulters:view')));

alter policy "whatsapp_run_holdouts: staff read" on public.whatsapp_run_holdouts
  using ((select public.has_permission('defaulters:view')));

alter policy "user_activity_events: staff read" on public.user_activity_events
  using ((select public.has_permission('dashboard:view')));
