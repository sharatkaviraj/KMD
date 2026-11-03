-- Monitoring: the health pack and the staff alert it sends (go-live Phase G;
-- plan §9.1; critique1 B9).
--
--  1. `vppsone.ops_health_counts(p_hours)` — counts only, never a row, a name
--     or a phone (I-5). Read by the `health` job (`/api/jobs/health`) and by
--     `scripts/migrate/health.mjs`; `src/modules/ops-health/domain/health.ts`
--     decides what is a problem. Each count is read on its own: one that
--     cannot be read (cron missing, a table renamed) comes back as JSON null
--     and the job reports it as "could not be read", never as zero.
--     Service role only.
--  2. A new staff outbox kind, `ops_alert` (template `vx_staff_ops_alert_v1`):
--     the health job queues one for every real admin (`settings:manage`) when
--     something needs looking at. Off in `staff_notice_kinds_enabled` like
--     every new kind (plan Q15) — the owner turns it on by name
--     (docs/cutover/ADMIN-OPS-SHEET.md). Consent, the window, the daily limit
--     and the month cap apply as to every other kind.
--
-- Nothing is sent by this migration; no fee table is changed (the function
-- only reads `public`).
--
-- Rollback:
--   drop function vppsone.ops_health_counts(integer);
--   delete from vppsone.message_templates where code = 'vx_staff_ops_alert_v1';
--   update vppsone.runtime_flags set value = value - 'ops_alert' where key = 'staff_notice_kinds_enabled';
--   re-add staff_notices_kind_known without 'ops_alert' (20261031101234).

/* ------------------------------------------------------- the health pack */

create or replace function vppsone.ops_health_counts(p_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 14)));
  v_month date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_out jsonb := jsonb_build_object(
    'at', now(),
    'window_hours', greatest(1, least(coalesce(p_hours, 24), 24 * 14)),
    'month_start', date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date
  );
  v_n bigint;
  v_t timestamptz;
  v_s text;
begin
  -- Online payments: Razorpay events the reconciler keeps failing on, and
  -- captures that could not be posted (open items, any age).
  begin
    select count(*) into v_n from public.online_payment_events e
    where e.status in ('pending', 'failed') and e.attempts >= 3;
    v_out := v_out || jsonb_build_object('online_events_stuck', v_n);
  exception when others then v_out := v_out || jsonb_build_object('online_events_stuck', null);
  end;
  begin
    select count(*) into v_n from public.online_payment_captures c
    where c.application_status = 'review_required';
    v_out := v_out || jsonb_build_object('online_captures_review', v_n);
  exception when others then v_out := v_out || jsonb_build_object('online_captures_review', null);
  end;

  -- The fee receipt outbox: uncertain is open (did it go?); failed in the window.
  begin
    select count(*) into v_n from public.notification_outbox o where o.status = 'uncertain';
    v_out := v_out || jsonb_build_object('outbox_uncertain', v_n);
  exception when others then v_out := v_out || jsonb_build_object('outbox_uncertain', null);
  end;
  begin
    select count(*) into v_n from public.notification_outbox o
    where o.status = 'failed' and o.updated_at >= v_since;
    v_out := v_out || jsonb_build_object('outbox_failed', v_n);
  exception when others then v_out := v_out || jsonb_build_object('outbox_failed', null);
  end;

  -- pg_cron runs that failed in the window, and which jobs (job names are
  -- the operator's own labels, never personal data).
  begin
    select count(*) into v_n from cron.job_run_details d
    where d.status = 'failed' and d.start_time >= v_since;
    v_out := v_out || jsonb_build_object('cron_failed', v_n);
    v_out := v_out || jsonb_build_object('cron_failed_jobs', coalesce((
      select jsonb_agg(x.jobname order by x.jobname) from (
        select distinct coalesce(j.jobname, 'job ' || d.jobid::text) as jobname
        from cron.job_run_details d left join cron.job j on j.jobid = d.jobid
        where d.status = 'failed' and d.start_time >= v_since
        limit 20
      ) x
    ), '[]'::jsonb));
  exception when others then
    v_out := v_out || jsonb_build_object('cron_failed', null, 'cron_failed_jobs', null);
  end;

  -- One's own jobs: failed in the window, and "running" for more than 15
  -- minutes (a job that died without writing its end; STALE_AFTER_MS).
  begin
    select count(*) into v_n from vppsone.job_runs j
    where j.status = 'failed' and j.started_at >= v_since;
    v_out := v_out || jsonb_build_object('job_runs_failed', v_n);
    select count(*) into v_n from vppsone.job_runs j
    where j.status = 'running' and j.started_at < now() - interval '15 minutes';
    v_out := v_out || jsonb_build_object('job_runs_stale', v_n);
  exception when others then
    v_out := v_out || jsonb_build_object('job_runs_failed', null, 'job_runs_stale', null);
  end;

  -- The D-334 Drive backup: hours since its last successful run.
  begin
    select max(j.finished_at) into v_t from vppsone.job_runs j
    where j.job = 'drive-backup' and j.status = 'ok';
    v_out := v_out || jsonb_build_object(
      'drive_backup_hours',
      case when v_t is null then -1 else floor(extract(epoch from (now() - v_t)) / 3600)::bigint end
    );
  exception when others then v_out := v_out || jsonb_build_object('drive_backup_hours', null);
  end;

  -- Staff WhatsApp: failed in the window, and unknown (open: did it go?).
  begin
    select count(*) into v_n from vppsone.staff_notices s
    where s.status = 'failed' and s.updated_at >= v_since;
    v_out := v_out || jsonb_build_object('staff_failed', v_n);
    select count(*) into v_n from vppsone.staff_notices s where s.status = 'unknown';
    v_out := v_out || jsonb_build_object('staff_unknown', v_n);
  exception when others then
    v_out := v_out || jsonb_build_object('staff_failed', null, 'staff_unknown', null);
  end;

  -- Parent WhatsApp: fee reminders and school notices that failed in the
  -- window, and One's own parent sends (message_sends) that failed.
  begin
    select count(*) into v_n from public.whatsapp_reminder_sends w
    where w.status = 'failed' and w.updated_at >= v_since;
    v_out := v_out || jsonb_build_object('parent_reminders_failed', v_n);
  exception when others then v_out := v_out || jsonb_build_object('parent_reminders_failed', null);
  end;
  begin
    select count(*) into v_n from public.school_notice_sends w
    where w.status = 'failed' and w.updated_at >= v_since;
    v_out := v_out || jsonb_build_object('school_notices_failed', v_n);
  exception when others then v_out := v_out || jsonb_build_object('school_notices_failed', null);
  end;
  begin
    select count(*) into v_n from vppsone.message_sends m
    where m.status = 'failed' and m.updated_at >= v_since;
    v_out := v_out || jsonb_build_object('one_sends_failed', v_n);
  exception when others then v_out := v_out || jsonb_build_object('one_sends_failed', null);
  end;

  -- AiSensy this month (IST) against the caps. The fee reminders' cap is the
  -- fee app's own setting (`whatsapp_month_message_cap`, 4,000 when unset —
  -- whatsapp-settings.ts); school notices have a budget in code; staff have
  -- `staff_whatsapp_month_cap`. Billed sends only (status 'sent').
  begin
    select count(*) into v_n from public.whatsapp_reminder_sends w
    where w.status = 'sent' and w.sent_on >= v_month;
    v_out := v_out || jsonb_build_object('parent_reminders_month', v_n);
  exception when others then v_out := v_out || jsonb_build_object('parent_reminders_month', null);
  end;
  begin
    select a.value into v_s from public.app_settings a where a.key = 'whatsapp_month_message_cap';
    v_out := v_out || jsonb_build_object(
      'parent_reminders_cap',
      case when v_s ~ '^\s*\d{1,9}\s*$' then trim(v_s)::bigint else null end
    );
  exception when others then v_out := v_out || jsonb_build_object('parent_reminders_cap', null);
  end;
  begin
    select count(*) into v_n from public.school_notice_sends w
    where w.status = 'sent' and w.sent_on >= v_month;
    v_out := v_out || jsonb_build_object('school_notices_month', v_n);
  exception when others then v_out := v_out || jsonb_build_object('school_notices_month', null);
  end;
  begin
    v_out := v_out || jsonb_build_object('staff_month', vppsone.staff_whatsapp_month_sent());
  exception when others then v_out := v_out || jsonb_build_object('staff_month', null);
  end;
  begin
    select case when f.enabled and jsonb_typeof(f.value) = 'number' then (f.value #>> '{}')::numeric::bigint end
      into v_n
    from vppsone.runtime_flags f where f.key = 'staff_whatsapp_month_cap';
    v_out := v_out || jsonb_build_object('staff_cap', v_n);
  exception when others then v_out := v_out || jsonb_build_object('staff_cap', null);
  end;

  return v_out;
end;
$$;

comment on function vppsone.ops_health_counts(integer) is
  'The health pack (go-live Phase G, plan §9.1): counts only. Null = could not be read. Service role only.';

revoke all on function vppsone.ops_health_counts(integer) from public, anon, authenticated;
grant execute on function vppsone.ops_health_counts(integer) to service_role;

/* ------------------------------------------------- the ops_alert kind */

alter table vppsone.staff_notices drop constraint if exists staff_notices_kind_known;
alter table vppsone.staff_notices add constraint staff_notices_kind_known check (
  kind in (
    'cover_assigned', 'cover_changed', 'cover_cancelled', 'cover_escalation', 'attendance_reminder',
    'marks_reminder', 'weekly_summary', 'staff_broadcast', 'online_review', 'online_payment',
    'day_collection', 'day_not_closed', 'money_request', 'money_decision', 'leave_requested', 'leave_decided',
    'ops_alert'
  )
);

-- Off until the owner names it, as every new kind (plan Q15). Only added
-- when the map does not mention it, so a later owner choice is kept.
update vppsone.runtime_flags
set value = value || '{"ops_alert": false}'::jsonb
where key = 'staff_notice_kinds_enabled' and not (value ? 'ops_alert');

insert into vppsone.message_templates (
  code, label_hi, label_en, body_hi, body_en, variables, has_url_button, audience, is_active, sort_order, wa_category
) values
  ('vx_staff_ops_alert_v1', 'सिस्टम जाँच', 'System check', '{{1}} जी, {{2}} की सिस्टम जाँच में {{3}} बातें देखनी हैं: {{4}}। देखें: {{5}}', '{{1}}, the system check for {{2}} found {{3}} things to look at: {{4}}. Details: {{5}}', array['name', 'day', 'count', 'what', 'link']::text[], false, 'staff', true, 964, 'utility')
on conflict (code) do nothing;
