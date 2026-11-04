-- Built-in AI stays in TEST-2026-27. The new setting controls reservations
-- across photo and voice actions, and the report returns no input or transcript.
alter table vppsone.ai_jobs add column provider text;
alter table vppsone.ai_jobs add column edited boolean;

create table vppsone.builtin_ai_settings (
  id integer primary key check (id = 1),
  daily_limit integer not null default 50 check (daily_limit between 0 and 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references vppsone.staff_profiles(id)
);
insert into vppsone.builtin_ai_settings (id) values (1);
alter table vppsone.builtin_ai_settings enable row level security;
revoke all on vppsone.builtin_ai_settings from public, anon, authenticated;
grant select, update on vppsone.builtin_ai_settings to service_role;

update storage.buckets
set allowed_mime_types = array['image/jpeg','audio/webm','audio/mp4','audio/wav','audio/m4a']
where id = 'ai-inputs' and public is false;

drop function vppsone.reserve_ai_job(uuid, text, uuid, integer, integer, text);
create function vppsone.reserve_ai_job(
  p_staff uuid, p_action text, p_target uuid, p_revision integer,
  p_pages integer, p_model text, p_audio_extension text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_day timestamptz := date_trunc('day', v_now at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_limit integer;
  v_extension text := coalesce(p_audio_extension, 'jpg');
begin
  if p_action not in ('marks-photo','substitution-photo','voice')
     or p_pages is null or p_pages not between 1 and 4
     or (p_action = 'voice' and (p_pages <> 1 or v_extension not in ('webm','m4a','wav')))
     or (p_action <> 'voice' and p_audio_extension is not null)
     or p_action is null then
    raise exception 'invalid AI input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('builtin-ai:' || p_staff::text, 0));
  select daily_limit into v_limit from vppsone.builtin_ai_settings where id = 1;
  if v_limit is null or (select count(*) from vppsone.ai_jobs where staff_profile_id = p_staff and created_at >= v_day) >= v_limit then
    return null;
  end if;
  insert into vppsone.ai_jobs (id, staff_profile_id, action, session_label, target_id, target_revision, input_paths, model, created_at)
  values (v_id, p_staff, p_action, 'TEST-2026-27', p_target, p_revision,
    array(select v_id::text || '/' || i::text || '.' || v_extension from generate_series(1, p_pages) i), p_model, v_now);
  return v_id;
end;
$$;
revoke all on function vppsone.reserve_ai_job(uuid, text, uuid, integer, integer, text, text) from public, anon, authenticated;
grant execute on function vppsone.reserve_ai_job(uuid, text, uuid, integer, integer, text, text) to service_role;

create function vppsone.builtin_ai_usage() returns jsonb
language sql stable security invoker set search_path = '' as $$
with current_month as (
  select date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as start_at
), jobs as materialized (
  select * from vppsone.ai_jobs where created_at >= (select start_at from current_month)
), handled as (
  select provider, count(*) as handled from jobs
  where parsed_at is not null and provider is not null group by provider
), attempts as (
  select a->>'provider' as provider, count(*) as attempts,
    sum(case when jsonb_typeof(a->'costInr') = 'number' then (a->>'costInr')::numeric else 0 end) as cost
  from jobs cross join lateral jsonb_array_elements(
    case when jsonb_typeof(jobs.attempts) = 'array' then jobs.attempts else '[]'::jsonb end
  ) a where a->>'provider' is not null group by a->>'provider'
), providers as (
  select provider, coalesce(handled.handled,0) as handled, coalesce(attempts.attempts,0) as attempts,
         coalesce(attempts.cost,0) as cost
  from handled full join attempts using (provider)
), failures as (
  select created_at, action, provider, error from jobs where status = 'failed'
  order by created_at desc limit 12
)
select jsonb_build_object(
  'actions', (select count(*) from jobs),
  'handled', (select count(*) from jobs where parsed_at is not null),
  'applied', (select count(*) from jobs where status = 'applied'),
  'edited', (select count(*) from jobs where status = 'applied' and edited),
  'costInr', (select coalesce(sum(estimated_cost_inr),0) from jobs),
  'providers', (select coalesce(jsonb_agg(to_jsonb(p) order by provider),'[]'::jsonb) from providers p),
  'failures', (select coalesce(jsonb_agg(to_jsonb(f) order by created_at desc),'[]'::jsonb) from failures f),
  'dailyLimit', (select daily_limit from vppsone.builtin_ai_settings where id = 1)
);
$$;
revoke all on function vppsone.builtin_ai_usage() from public, anon, authenticated;
grant execute on function vppsone.builtin_ai_usage() to service_role;
