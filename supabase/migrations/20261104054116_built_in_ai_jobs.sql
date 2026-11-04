-- Built-in Gemini pilot. Only VPPS One's server can use this ledger or bucket.
-- No browser role can list, read or change objects; the server mints individual
-- upload tokens only after authenticating and authorising the operation.
create table vppsone.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references vppsone.staff_profiles (id),
  action text not null check (action ~ '^[a-z][a-z0-9-]{1,39}$'),
  session_label text not null check (session_label = 'TEST-2026-27'),
  target_id uuid not null,
  target_revision integer not null check (target_revision >= 0),
  roster_stamp text,
  input_paths text[] not null check (cardinality(input_paths) between 1 and 4),
  model text not null,
  model_version text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  thinking_tokens integer not null default 0 check (thinking_tokens >= 0),
  estimated_cost_inr numeric(12,6) not null default 0 check (estimated_cost_inr >= 0),
  attempts jsonb not null default '[]',
  raw_output jsonb,
  reviewed_data jsonb,
  final_applied_data jsonb,
  status text not null default 'draft' check (status in ('draft','applied','discarded','failed')),
  error text,
  created_at timestamptz not null default now(),
  parse_started_at timestamptz,
  parsed_at timestamptz,
  applied_at timestamptz,
  purged_at timestamptz
);
alter table vppsone.ai_jobs enable row level security;
revoke all on vppsone.ai_jobs from public, anon, authenticated;
grant select, insert, update on vppsone.ai_jobs to service_role;
create index ai_jobs_staff_created_idx on vppsone.ai_jobs (staff_profile_id, created_at);
create index ai_jobs_retention_idx on vppsone.ai_jobs (created_at) where purged_at is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-inputs', 'ai-inputs', false, 2097152, array['image/jpeg','audio/webm','audio/mp4']);

-- Restrictive so an unrelated, broad permissive storage policy cannot expose
-- this bucket. The service role bypasses RLS, including for signed uploads.
create policy ai_inputs_server_only on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'ai-inputs') with check (bucket_id <> 'ai-inputs');

-- Serialize reservations per person. In particular, 51 parallel requests
-- cannot all observe the same count and then get usable upload tokens.
create function vppsone.reserve_ai_job(
  p_staff uuid, p_action text, p_target uuid, p_revision integer,
  p_pages integer, p_model text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_day timestamptz := date_trunc('day', v_now at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if p_pages is null or p_pages not between 1 and 4 then
    raise exception 'invalid page count';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('builtin-ai:' || p_staff::text, 0));
  if (select count(*) from vppsone.ai_jobs where staff_profile_id = p_staff and created_at >= v_day) >= 50 then
    return null;
  end if;
  insert into vppsone.ai_jobs (id, staff_profile_id, action, session_label, target_id, target_revision, input_paths, model, created_at)
  values (v_id, p_staff, p_action, 'TEST-2026-27', p_target, p_revision,
    array(select v_id::text || '/' || i::text || '.jpg' from generate_series(1, p_pages) i), p_model, v_now);
  return v_id;
end;
$$;
revoke all on function vppsone.reserve_ai_job(uuid, text, uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function vppsone.reserve_ai_job(uuid, text, uuid, integer, integer, text) to service_role;
