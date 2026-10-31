-- The health pack, what review of PR #149 found missing (go-live Phase G;
-- plan §9.1; critique1 B9). `vppsone.ops_health_counts` is replaced with the
-- same counts as 20261031115621 plus:
--
--  * `net_http_failed` — pg_net calls in the window answered >= 400, timed out
--    or failed (status null). Every C4 timer calls One through `net.http_get`,
--    and pg_cron records that call as succeeded whatever One answered, so a
--    wrong or rotated Vault token (401), a missing route (404) or a 500 was
--    invisible to `cron_failed`. pg_net keeps responses about six hours
--    (`pg_net.ttl`), so the 08:00 and 16:00 checks each see the hours before.
--  * `online_events_pending_old` — Razorpay events still pending after 30
--    minutes, whatever their attempts: a reconciler that never runs (a 401
--    above) never raises `attempts`, so `online_events_stuck` stayed 0.
--  * `receipt_notices_month` — fee receipt notices (`notification_outbox`,
--    provider_accepted or delivered) this IST month: AiSensy messages that
--    had no month count.
--  * `one_sends_month` — One's own parent sends by AiSensy this month.
--  * `aisensy_month_total` — every lane together (fee reminders, school
--    notices, receipt notices, One's parent sends, staff), against
--    `aisensy_plan_cap`: the owner-set `vppsone.runtime_flags`
--    `aisensy_month_plan_cap` (added off; on with a number = the plan's
--    monthly allowance). Null when any lane cannot be read.
--  * `cutover_rows` — the C3 line drawn or not; the health job's webhook
--    probe reads a 404 as "not configured yet" before it, a problem after.
--
-- Counts only, service role only (re-asserted below). Nothing is sent and
-- no fee table is changed.
--
-- Rollback: re-run the function from 20261031115621;
--   delete from vppsone.runtime_flags where key = 'aisensy_month_plan_cap';
--   re-add runtime_flags_key_known without it (20261031101234).

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

  -- pg_net calls (the C4 timers) One answered with an error, or not at all.
  begin
    select count(*) into v_n from net._http_response h
    where h.created >= v_since
      and (h.status_code is null or h.status_code >= 400 or coalesce(h.timed_out, false));
    v_out := v_out || jsonb_build_object('net_http_failed', v_n);
  exception when others then v_out := v_out || jsonb_build_object('net_http_failed', null);
  end;

  -- Razorpay events waiting longer than the reconciler's period allows.
  begin
    select count(*) into v_n from public.online_payment_events e
    where e.status = 'pending' and e.received_at < now() - interval '30 minutes';
    v_out := v_out || jsonb_build_object('online_events_pending_old', v_n);
  exception when others then v_out := v_out || jsonb_build_object('online_events_pending_old', null);
  end;

  -- The rest of AiSensy this month: receipt notices and One's parent sends.
  begin
    select count(*) into v_n from public.notification_outbox o
    where o.status in ('provider_accepted', 'delivered')
      and o.updated_at >= (v_month::timestamp at time zone 'Asia/Kolkata');
    v_out := v_out || jsonb_build_object('receipt_notices_month', v_n);
  exception when others then v_out := v_out || jsonb_build_object('receipt_notices_month', null);
  end;
  begin
    select count(*) into v_n from vppsone.message_sends m
    where m.status = 'sent' and m.sent_at >= (v_month::timestamp at time zone 'Asia/Kolkata')
      and coalesce(m.task_transport, 'aisensy') = 'aisensy';
    v_out := v_out || jsonb_build_object('one_sends_month', v_n);
  exception when others then v_out := v_out || jsonb_build_object('one_sends_month', null);
  end;

  -- Every lane together; null if any lane could not be read.
  v_out := v_out || jsonb_build_object(
    'aisensy_month_total',
    (v_out ->> 'parent_reminders_month')::bigint + (v_out ->> 'school_notices_month')::bigint
      + (v_out ->> 'receipt_notices_month')::bigint + (v_out ->> 'one_sends_month')::bigint
      + (v_out ->> 'staff_month')::bigint
  );
  begin
    select case when f.enabled and jsonb_typeof(f.value) = 'number' then (f.value #>> '{}')::numeric::bigint end
      into v_n
    from vppsone.runtime_flags f where f.key = 'aisensy_month_plan_cap';
    v_out := v_out || jsonb_build_object('aisensy_plan_cap', v_n);
  exception when others then v_out := v_out || jsonb_build_object('aisensy_plan_cap', null);
  end;

  begin
    select count(*) into v_n from vppsone.migration_runs r where r.kind = 'cutover' and r.status = 'succeeded';
    v_out := v_out || jsonb_build_object('cutover_rows', v_n);
  exception when others then v_out := v_out || jsonb_build_object('cutover_rows', null);
  end;

  return v_out;
end;
$$;

comment on function vppsone.ops_health_counts(integer) is
  'The health pack (go-live Phase G, plan §9.1): counts only. Null = could not be read. Service role only.';

revoke all on function vppsone.ops_health_counts(integer) from public, anon, authenticated;
grant execute on function vppsone.ops_health_counts(integer) to service_role;

-- The AiSensy plan's monthly allowance: off until the owner sets it (a
-- number, enabled). Off = the total is reported but not judged.
alter table vppsone.runtime_flags drop constraint if exists runtime_flags_key_known;
alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
  key in (
    'cover_command',
    'staff_notice_dispatch',
    'fault_injection',
    'parent_dispatch',
    'parent_dispatch_categories',
    'absent_notice_owner',
    'parent_dispatch_test_only',
    'staff_notice_kinds_enabled',
    'staff_whatsapp_month_cap',
    'staff_notice_student_names',
    'aisensy_month_plan_cap'
  )
);
insert into vppsone.runtime_flags (key, enabled, value, note)
values (
  'aisensy_month_plan_cap', false, null,
  'AiSensy messages a month (IST) the plan allows, every lane together. Set the number and enable it; the system check warns from 80%.'
)
on conflict (key) do nothing;
