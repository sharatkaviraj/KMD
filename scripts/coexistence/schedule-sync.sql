-- Install DORMANT schedules on One only. Set the dedicated
-- FEES_BRIDGE_CRON_SECRET in Vault through the private operator launcher first.
-- Activate only after the deployed POST endpoint and initial sync are verified.
-- Supabase Cron/pg_net docs: https://supabase.com/docs/guides/cron/quickstart
begin;
do $$
begin
  if not exists(select 1 from vppsone.deployment where id=1 and environment='production')
    or not exists(select 1 from public.app_settings where key='fee_writes_enabled' and value='false')
    or not exists(select 1 from vppsone.migration_runs where script='coexistence-identities' and status='succeeded') then
    raise exception 'bridge_schedule_identity_preflight_failed';
  end if;
  if (select count(*) from vault.secrets where name='FEES_BRIDGE_CRON_SECRET')<>1 then
    raise exception 'bridge_schedule_secret_missing';
  end if;
  if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC') then
    raise exception 'bridge_schedule_requires_utc_cron';
  end if;
end;
$$;

-- No frequent `fees-bridge-sync` job. The roster is copied once a night
-- (owner's decision, 6 Nov 2026, D-457); the every-minute job overlapped
-- itself and helped saturate the database. Migration 20261106162701 removed it.
-- The nightly `?verify=1` run below is a complete sync on its own.
select cron.schedule('fees-bridge-nightly-verify','30 20 * * *',$cron$
  select net.http_post(
    url:='https://one.vpps.co.in/api/jobs/fees-bridge-sync?verify=1',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='FEES_BRIDGE_CRON_SECRET')),
    body:='{}'::jsonb,timeout_milliseconds:=110000);
$cron$);
-- Limit only this integration's scheduler history. Financial and other
-- application job history is outside this operation's scope.
select cron.schedule('fees-bridge-cron-history','45 20 * * *',$cron$
  delete from cron.job_run_details where end_time<now()-interval '14 days'
    and jobid in(select jobid from cron.job where jobname in
      ('fees-bridge-nightly-verify','fees-bridge-cron-history'));
$cron$);
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname in
    ('fees-bridge-nightly-verify','fees-bridge-cron-history') loop
    perform cron.alter_job(j.jobid,active:=false);
  end loop;
end;
$$;
commit;
