-- ============================================================================
-- D-648 (16 Nov 2026): the night's copy gets the time it needs.
--
-- Every connection to this database stops a statement after two minutes
-- (statement_timeout = 2min, from the server's configuration file), and the
-- jobs pg_cron starts are no exception. The copy alone takes about a minute
-- (runs 1 to 5 took 60 to 71 seconds), and the night's job runs One's class
-- lists, the money views and the screen-clearing request after it in the
-- same statement: the first trial of vppsone.fees_copy_nightly(), started at
-- 06:45:46 UTC on 16 Nov, was stopped at 06:47:46 and undid itself whole
-- (nothing changed). Tonight's job would have done the same every night, and
-- One's copy would have gone stale until the registers closed at 50 hours.
--
-- So each copy job sets its own limit first, in the same command. pg_cron
-- here sends a job's command over an ordinary connection
-- (cron.use_background_workers = off), and Postgres starts a fresh timer for
-- each statement of a multi-statement command, so the SET governs the
-- statement after it, and only on that job's own connection:
--   'fees-copy-nightly'  20 minutes
--   'fees-copy-audit'    10 minutes
-- A run that hangs still ends, at night, long before anyone opens One.
--
-- The schedules are unchanged (D-457: once a night).
--
-- Rollback: set each job's command back to its bare select.
-- ============================================================================

do $guard$
begin
  if (select count(*) from cron.job j
       where j.jobname in ('fees-copy-nightly', 'fees-copy-audit')) <> 2 then
    raise exception 'D-648: the two copy jobs are not both scheduled; nothing changed.';
  end if;
end
$guard$;

select cron.alter_job(j.jobid,
         command := 'set statement_timeout = ''20min''; select vppsone.fees_copy_nightly();')
  from cron.job j
 where j.jobname = 'fees-copy-nightly';

select cron.alter_job(j.jobid,
         command := 'set statement_timeout = ''10min''; select vppsone.fees_copy_audit(100000);')
  from cron.job j
 where j.jobname = 'fees-copy-audit';
