-- The Fees roster is copied into One once a night, not every minute
-- (owner's decision, 6 Nov 2026, D-457: "a night sync is enough").
--
-- 1. Remove the every-minute `fees-bridge-sync` pg_cron job. It was paused by
--    hand during the 6 Nov outage (it ran each minute for up to 120 s and
--    overlapped itself). Unscheduling it, rather than leaving it inactive,
--    means no later script or person can switch it back on by mistake.
--    `fees-bridge-nightly-verify` (20:30 UTC = 02:00 IST, `?verify=1`) stays:
--    it forces a full snapshot, applies it and acknowledges the events, so it
--    is a complete sync on its own. `fees-bridge-cron-history` stays.
-- 2. A roster checked last night is current until the next night. Four
--    readers refused anything older than five minutes; they now allow 26 hours
--    (a day plus slack), the same figure as BRIDGE_FRESH_FOR_MS in
--    src/platform/fees-bridge/state.ts. The functions are patched in place by
--    exact text, and the migration fails unless each holds the old check
--    exactly once, so a function that has changed shape is never half-edited.
--    Money figures are not affected: canonical financial lookup is still a
--    direct request to Fees.
begin;

do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'fees-bridge-sync' loop
    perform cron.unschedule(j);
  end loop;
end;
$$;

do $$
declare
  f text;
  d text;
  old_check constant text := 'last_checked_at>=clock_timestamp()-interval ''5 minutes''';
  new_check constant text := 'last_checked_at>=clock_timestamp()-interval ''26 hours''';
begin
  foreach f in array array[
    'vppsone.school_certificate_facts_v2(uuid,uuid,text,text,boolean)',
    'vppsone.school_certificate_roster(uuid,text,boolean)',
    'vppsone.school_office_attention(uuid,text,boolean)',
    'vppsone.school_office_roster(uuid,text,text,boolean)'
  ] loop
    d := pg_get_functiondef(f::regprocedure);
    if (length(d) - length(replace(d, old_check, ''))) / length(old_check) <> 1 then
      raise exception 'fees_bridge_nightly_only: % does not hold the five-minute check exactly once', f;
    end if;
    execute replace(d, old_check, new_check);
  end loop;
end;
$$;

commit;
