-- ============================================================================
-- D-648 (16 Nov 2026): the Fees link is off in One; the copy runs each night.
--
-- The owner, 16 Nov: One becomes an app of its own. The office keeps using the
-- Fees app for now, and once One is complete all of Fees' data comes across.
-- Until then One's real year is a copy of the Fees app, taken once a night
-- (D-457, D-644: vppsone.fees_copy_run), and the copy was checked against
-- Fees on 16 Nov: every money total and all 19 classes agree.
--
-- In one transaction:
--
--   1. vppsone.fees_bridge_state.enabled = false. The identity views then read
--      the copied public tables for every year, as they always have for TEST,
--      and the six roster and certificate functions answer from the copy
--      (vppsone.fees_source_ready, D-648). The app's own switch,
--      FEES_BRIDGE_ENABLED=false on Vercel, went out with the deploy just
--      before this. Refused unless a copy was applied in the last 50 hours,
--      the same rule fees_source_ready answers by: otherwise every register
--      would say "source unavailable" until the night.
--   2. The link's own nightly check ('fees-bridge-nightly-verify') is paused:
--      there is no link left to check. It is paused rather than taken away,
--      so that turning the link back on is a switch, not a rebuild.
--   3. The copy's two jobs, at night in India:
--        'fees-copy-nightly'  20:30 UTC (02:00 IST)  vppsone.fees_copy_nightly()
--            the copy, then One's class lists, the money views, and the
--            request that clears One's saved screens (/api/jobs/fees-copy-done)
--        'fees-copy-audit'    20:50 UTC (02:20 IST)  vppsone.fees_copy_audit(100000)
--            the Fees audit trail, insert-only, from where it last stopped
--   4. vppsone.fees_copy_cache_tags' comment named its file by the version it
--      had before the database stamped it. Corrected.
--
-- D-645 in the headers of the nightly-copy migration (20261116050933) is this
-- decision, D-648: another change took D-645 the same morning. The comments
-- on those functions were corrected by 20261116051837.
--
-- Nothing here reads from or writes to the Fees app. The copy reads it through
-- a select-only login (D-644) and writes only One's database.
--
-- Rollback (the link back on): set fees_bridge_state.enabled = true, set
-- 'fees-bridge-nightly-verify' active again, unschedule the two copy jobs, and
-- put FEES_BRIDGE_ENABLED=true back on Vercel.
-- ============================================================================

do $guard$
begin
  if not exists (
    select 1 from vppsone.fees_copy_runs r
     where r.mode = 'apply' and r.status = 'applied'
       and r.finished_at >= pg_catalog.clock_timestamp() - interval '50 hours'
  ) then
    raise exception 'D-648: no copy of the Fees app was applied in the last 50 hours; the Fees link stays on.';
  end if;
end
$guard$;

update vppsone.fees_bridge_state set enabled = false where id;

select cron.alter_job(j.jobid, active := false)
  from cron.job j
 where j.jobname = 'fees-bridge-nightly-verify';

select cron.schedule('fees-copy-nightly', '30 20 * * *', 'select vppsone.fees_copy_nightly();');
select cron.schedule('fees-copy-audit', '50 20 * * *', 'select vppsone.fees_copy_audit(100000);');

comment on function vppsone.fees_copy_cache_tags() is
  'D-648: the cache tags /api/jobs/fees-copy-done expires after the night''s copy (every real year and its children). See 20261116051837_fees_copy_cache_tags.sql.';
