-- The staff WhatsApp timers on One's database (go-live Phase F; critique1 A10;
-- docs/cutover/STAFF-WHATSAPP.md §5). An OPERATOR step at cutover, run as
-- postgres in the SQL editor of `wtgxcptmucjerhufzjcf` — never a migration,
-- never from the app. Not run by any phase.
--
-- What it schedules (pg_cron + pg_net, times in UTC):
--
--   staff-notices-dispatch   */5 * * * *   /api/jobs/staff-notices
--       The outbox's retry tick: the 07:00 hold, the 30-minute digest hold, a
--       retry after a refusal, and anything a job queued but did not send all
--       wait for it. Vercel's daily 02:00 UTC cron is not enough on its own.
--   staff-fee-day-summary    30 13 * * *   /api/jobs/fee-day-summary    (19:00 IST)
--   staff-fee-day-not-closed 30 14 * * *   /api/jobs/fee-day-not-closed (20:00 IST)
--       Also in vercel.json. On Vercel's Hobby plan a cron fires anywhere in
--       its hour, which would send "day not closed" at any time up to 21:00;
--       these fire on the minute whatever the plan. Running both is harmless:
--       each notice is keyed by session and day, so a second run queues
--       nothing.
--
-- Before running it:
--   1. `vppsone.deployment.environment` is 'production' (the lockdown). The
--      script reads it first and refuses otherwise — a dev-marked or
--      unreadable marker means the cutover has not reached this step.
--   2. Three job tokens are in Vault, by name (never in this file, never in a
--      commit). Each is `jobTokenFor(JOBS_SECRET, '<job>')`, the first 32 hex
--      characters of HMAC-SHA256 — `src/modules/jobs/domain/token.ts`:
--        VPPS_STAFF_NOTICES_JOB_TOKEN        for 'staff-notices'
--        VPPS_FEE_DAY_SUMMARY_JOB_TOKEN      for 'fee-day-summary'
--        VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN   for 'fee-day-not-closed'
--      e.g. select vault.create_secret('<token>', 'VPPS_STAFF_NOTICES_JOB_TOKEN');
--   3. The site answers at https://one.vpps.co.in.
--
-- Idempotent: each job is unscheduled by name if it exists, then scheduled
-- again. The tokens are read from Vault when each job fires, so rotating a
-- secret needs no re-run. To remove the timers:
--   select cron.unschedule(jobname) from cron.job
--   where jobname in ('staff-notices-dispatch', 'staff-fee-day-summary', 'staff-fee-day-not-closed');
--
-- Check afterwards (expect three rows, active):
--   select jobname, schedule, active from cron.job where jobname like 'staff-%';

do $$
declare
  v_env text;
  v_missing text[];
  v_job record;
begin
  -- 1. Where this is running, read first.
  begin
    select d.environment into v_env from vppsone.deployment d where d.id = 1;
  exception when others then
    v_env := null;
  end;
  if v_env is distinct from 'production' then
    raise exception 'Refused: vppsone.deployment.environment is %, not production. Schedule the staff timers after the lockdown (STAFF-WHATSAPP.md §5).',
      coalesce(quote_literal(v_env), 'unreadable');
  end if;

  -- 2. Every token in Vault by name.
  select array_agg(w.secret_name order by w.secret_name) into v_missing
  from unnest(array['VPPS_STAFF_NOTICES_JOB_TOKEN', 'VPPS_FEE_DAY_SUMMARY_JOB_TOKEN', 'VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN']) as w(secret_name)
  where not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = w.secret_name and coalesce(s.decrypted_secret, '') <> ''
  );
  if v_missing is not null then
    raise exception 'Refused: no Vault secret named %. Store each job token first (STAFF-WHATSAPP.md §5).', array_to_string(v_missing, ', ');
  end if;

  -- 3. Unschedule what is there, then schedule.
  for v_job in
    select * from (values
      ('staff-notices-dispatch', '*/5 * * * *', 'staff-notices', 'VPPS_STAFF_NOTICES_JOB_TOKEN'),
      ('staff-fee-day-summary', '30 13 * * *', 'fee-day-summary', 'VPPS_FEE_DAY_SUMMARY_JOB_TOKEN'),
      ('staff-fee-day-not-closed', '30 14 * * *', 'fee-day-not-closed', 'VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN')
    ) as j(jobname, schedule, job, secret)
  loop
    if exists (select 1 from cron.job c where c.jobname = v_job.jobname) then
      perform cron.unschedule(v_job.jobname);
    end if;
    perform cron.schedule(
      v_job.jobname,
      v_job.schedule,
      format(
        $cmd$select net.http_get(
  url := 'https://one.vpps.co.in/api/jobs/%s?token=' ||
    (select decrypted_secret from vault.decrypted_secrets where name = %L),
  timeout_milliseconds := 55000
);$cmd$,
        v_job.job,
        v_job.secret
      )
    );
  end loop;
end $$;

select jobname, schedule, active from cron.job where jobname like 'staff-%' order by jobname;
