-- One's database timers at cutover (go-live Phase G; plan §11 step C4,
-- critique1 A9/A10/B18, critique0 #23/#25). A RUNBOOK, not a migration: run
-- as postgres in the SQL editor of `wtgxcptmucjerhufzjcf` at step C4 of
-- docs/cutover/CUTOVER-RUNBOOK-2026-27.md, after the lockdown. Never applied
-- by any phase, never from the app. Re-runnable: each job is unscheduled by
-- name if it exists, then scheduled again.
--
-- Why pg_cron and not Vercel: on Vercel's Hobby plan a cron fires anywhere in
-- its hour (critique1 A9) — auto-day-close at "18:30 UTC" could run at 23:59
-- IST and close the wrong day. pg_cron fires on the minute. Vercel's own
-- crons (vercel.json) stay as a daily safety net for One's jobs; every job is
-- idempotent per day, so both firing is harmless. auto-day-close is in
-- exactly ONE place: here (One's vercel.json never schedules it; the fees
-- app's own auto-day-close runs on the fees database, which is not this one).
--
-- ---------------------------------------------------------------------------
-- The full timer list on One's database after this script (times UTC; IST = +5:30)
--
--   KEPT (already on wtgx; this script does not touch them):
--     refresh-workbook-materialized-views  */2 * * * *   public.refresh_workbook_materialized_views_if_requested()
--     enqueue-workbook-refresh-daily       35 18 * * *   public.queue_workbook_materialized_view_refresh()
--     charge-emi-late-fees-daily           50 18 * * *   public.sync_repayment_plan_late_fees()  (One now charges EMI late fees itself)
--     smoke-enforce                        */2 * * * *   vppsone.smoke_enforce()  (kept or removed by convert-to-production, phase H)
--
--   REMOVED by this script:
--     refresh-sibling-groups-matview — calls public.refresh_sibling_groups_if_requested(),
--       which does not exist on wtgx (or on live): it has failed every 2 minutes
--       (720 failures a day on 31 Oct, found by the health pack). Unscheduled
--       here; nothing depends on it.
--
--   ADDED by this script (pg_net GET to https://one.vpps.co.in, 55 s timeout):
--     whatsapp-scheduled-runs     0 4 * * *        /api/fees/cron/whatsapp-scheduled-runs   Bearer Vault VPPS_WHATSAPP_CRON_SECRET  (09:30 IST)
--     online-payments-reconcile   */10 * * * *     /api/fees/cron/online-payments           Bearer Vault VPPS_ONLINE_PAYMENTS_CRON_SECRET
--     auto-day-close              35 18 * * *      /api/fees/cron/auto-day-close            Bearer Vault VPPS_CRON_SECRET (00:05 IST, closes the IST day that ended)
--     fees-nightly-backup         0 18 * * *       /api/fees/cron/nightly-backup            Bearer Vault VPPS_CRON_SECRET (23:30 IST; CSVs to the nightly-backups bucket)
--     staff-notices-dispatch      */5 * * * *      /api/jobs/staff-notices        ?token= Vault VPPS_STAFF_NOTICES_JOB_TOKEN
--     staff-fee-day-summary       30 13 * * *      /api/jobs/fee-day-summary      ?token= Vault VPPS_FEE_DAY_SUMMARY_JOB_TOKEN     (19:00 IST)
--     staff-fee-day-not-closed    30 14 * * *      /api/jobs/fee-day-not-closed   ?token= Vault VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN  (20:00 IST)
--     ops-health                  30 2,10 * * *    /api/jobs/health               ?token= Vault VPPS_HEALTH_JOB_TOKEN              (08:00 and 16:00 IST)
--     (The three staff-* jobs are the same names and commands as
--      scripts/ops/schedule-staff-notices-cron.sql; running either is the same.)
--
--   NOT recreated: the fees app's `notion-fee-sync-daily(-test)`. Notion
--   freezes at T0 (docs/cutover/MCP-AND-NOTION.md, critique1 B18).
--
-- ---------------------------------------------------------------------------
-- Before running it (each is a check in the runbook's C4):
--   1. `vppsone.deployment.environment` = 'production' (the script refuses otherwise).
--   2. These Vault secrets exist, by NAME (values never in this file, a commit or chat):
--        VPPS_WHATSAPP_CRON_SECRET          64 hex; also what public.whatsapp_cron_secret_matches() checks
--        VPPS_ONLINE_PAYMENTS_CRON_SECRET   64 hex; also what public.online_payments_cron_secret_matches() checks
--        VPPS_CRON_SECRET                   the same value as One's Vercel Production CRON_SECRET
--                                           (auto-day-close and nightly-backup accept only CRON_SECRET)
--        VPPS_STAFF_NOTICES_JOB_TOKEN       `npm run jobs:tokens` with One's JOBS_SECRET: the staff-notices token
--        VPPS_FEE_DAY_SUMMARY_JOB_TOKEN     … the fee-day-summary token
--        VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN  … the fee-day-not-closed token
--        VPPS_HEALTH_JOB_TOKEN              … the health token
--      e.g. select vault.create_secret('<value>', 'VPPS_HEALTH_JOB_TOKEN');
--      (rotate with vault.update_secret; the jobs read Vault each time they fire)
--   3. One's Production deployment answers at https://one.vpps.co.in with the
--      C5 env set (docs/cutover/ENV-INVENTORY.md).
--   4. Nothing calls the fees app: checked at the end.
--
-- Check afterwards (the last two SELECTs print it):
--   - 12 active jobs: the 4 kept + the 8 added; no 'refresh-sibling-groups-matview';
--   - 0 jobs whose command mentions schoolfees-two / fees.vpps.co.in / vgqyilgstjvgohrsiwkb;
--   - after 10 minutes: `select j.jobname, d.status, d.start_time from cron.job_run_details d
--       join cron.job j using (jobid) order by d.start_time desc limit 20;` shows
--     online-payments-reconcile and staff-notices-dispatch 'succeeded', and
--     `select status_code, count(*) from net._http_response where created > now() - interval '15 minutes' group by 1;`
--     shows 200s (a 401/404 means a Vault secret does not match the deployment).
--
-- ROLLBACK (docs/cutover/ROLLBACK-2026-27.md step 2) — stops One's timers
-- from writing One's database (critique0 #25): run as postgres:
--
--   select cron.unschedule(jobname) from cron.job
--   where jobname in (
--     'whatsapp-scheduled-runs', 'online-payments-reconcile', 'auto-day-close',
--     'fees-nightly-backup', 'staff-notices-dispatch', 'staff-fee-day-summary',
--     'staff-fee-day-not-closed', 'ops-health',
--     'charge-emi-late-fees-daily'   -- One must stop charging EMI late fees once the fees app is the record again
--   );
--   -- keep: refresh-workbook-materialized-views, enqueue-workbook-refresh-daily (derived data only), smoke-enforce.
--   select jobname from cron.job order by jobname;   -- expect only the kept three (four with smoke-enforce)
--
-- and remove One's Vercel crons that touch money or messages: set
-- STAFF_NOTICE_TRANSPORT=disabled and MESSAGE_PROVIDER unset, or redeploy with
-- the fee-day-summary / fee-day-not-closed / staff-notices entries removed
-- from vercel.json (the runtime_flags kill switches in the rollback stop them
-- first, instantly).

do $$
declare
  v_env text;
  v_missing text[];
  v_job record;
  v_base constant text := 'https://one.vpps.co.in';
begin
  -- 1. Where this is running, read first.
  begin
    select d.environment into v_env from vppsone.deployment d where d.id = 1;
  exception when others then
    v_env := null;
  end;
  if v_env is distinct from 'production' then
    raise exception 'Refused: vppsone.deployment.environment is %, not production. Run the timers at C4, after the lockdown.',
      coalesce(quote_literal(v_env), 'unreadable');
  end if;

  -- 2. Every secret in Vault, by name.
  select array_agg(w.secret_name order by w.secret_name) into v_missing
  from unnest(array[
    'VPPS_WHATSAPP_CRON_SECRET', 'VPPS_ONLINE_PAYMENTS_CRON_SECRET', 'VPPS_CRON_SECRET',
    'VPPS_STAFF_NOTICES_JOB_TOKEN', 'VPPS_FEE_DAY_SUMMARY_JOB_TOKEN', 'VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN',
    'VPPS_HEALTH_JOB_TOKEN'
  ]) as w(secret_name)
  where not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = w.secret_name and coalesce(s.decrypted_secret, '') <> ''
  );
  if v_missing is not null then
    raise exception 'Refused: no Vault secret named %. Store each one first (see the header).', array_to_string(v_missing, ', ');
  end if;

  -- 3. The broken timer from the dev era.
  if exists (select 1 from cron.job where jobname = 'refresh-sibling-groups-matview') then
    perform cron.unschedule('refresh-sibling-groups-matview');
  end if;

  -- 4. Bearer-secret jobs (the ported fee cron routes).
  for v_job in
    select * from (values
      ('whatsapp-scheduled-runs', '0 4 * * *', '/api/fees/cron/whatsapp-scheduled-runs', 'VPPS_WHATSAPP_CRON_SECRET'),
      ('online-payments-reconcile', '*/10 * * * *', '/api/fees/cron/online-payments', 'VPPS_ONLINE_PAYMENTS_CRON_SECRET'),
      ('auto-day-close', '35 18 * * *', '/api/fees/cron/auto-day-close', 'VPPS_CRON_SECRET'),
      ('fees-nightly-backup', '0 18 * * *', '/api/fees/cron/nightly-backup', 'VPPS_CRON_SECRET')
    ) as j(jobname, schedule, route, secret)
  loop
    if exists (select 1 from cron.job c where c.jobname = v_job.jobname) then
      perform cron.unschedule(v_job.jobname);
    end if;
    perform cron.schedule(
      v_job.jobname,
      v_job.schedule,
      format(
        $cmd$select net.http_get(
  url := %L,
  headers := jsonb_build_object('Authorization', 'Bearer ' ||
    (select decrypted_secret from vault.decrypted_secrets where name = %L)),
  timeout_milliseconds := 55000
);$cmd$,
        v_base || v_job.route,
        v_job.secret
      )
    );
  end loop;

  -- 5. Per-job-token jobs (One's /api/jobs/[job]; a token opens one job only).
  for v_job in
    select * from (values
      ('staff-notices-dispatch', '*/5 * * * *', 'staff-notices', 'VPPS_STAFF_NOTICES_JOB_TOKEN'),
      ('staff-fee-day-summary', '30 13 * * *', 'fee-day-summary', 'VPPS_FEE_DAY_SUMMARY_JOB_TOKEN'),
      ('staff-fee-day-not-closed', '30 14 * * *', 'fee-day-not-closed', 'VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN'),
      ('ops-health', '30 2,10 * * *', 'health', 'VPPS_HEALTH_JOB_TOKEN')
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
  url := %L ||
    (select decrypted_secret from vault.decrypted_secrets where name = %L),
  timeout_milliseconds := 55000
);$cmd$,
        v_base || '/api/jobs/' || v_job.job || '?token=',
        v_job.secret
      )
    );
  end loop;
end $$;

select jobname, schedule, active from cron.job order by jobname;

select count(*) as jobs_calling_the_fees_app
from cron.job
where command ilike '%schoolfees-two%' or command ilike '%fees.vpps.co.in%' or command ilike '%vgqyilgstjvgohrsiwkb%';
