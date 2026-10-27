-- The AI helper (D-324): Claude drafts, a person decides.
--
-- Two tables, both private to the server:
--  * assist_settings — one row the admin edits on Settings → AI helper: a
--    master switch, a monthly budget in US dollars, a per-person daily cap
--    and the features that are switched off.
--  * assist_log — one row per draft: who asked, which feature, which model,
--    the tokens and the estimated cost, and what the person did with it
--    (kept, edited, discarded). No prompt and no answer is stored: the log is
--    for the budget and for knowing which features are worth their cost,
--    never a second copy of what staff wrote about children.
--
-- RLS on with no policies, and nothing granted to anon or authenticated: the
-- app reads and writes these with the service role after its own permission
-- check, as it does the smoke lab tables.
--
-- Rollback: drop function vppsone.assist_usage_by_staff(timestamptz);
-- drop function vppsone.assist_usage_summary(timestamptz);
-- drop function vppsone.assist_budget_state(uuid, timestamptz, timestamptz);
-- drop table vppsone.assist_log; drop table vppsone.assist_settings;

create table vppsone.assist_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  monthly_budget_usd numeric(8, 2) not null default 25
    check (monthly_budget_usd >= 0 and monthly_budget_usd <= 1000),
  daily_cap_per_staff integer not null default 60
    check (daily_cap_per_staff between 0 and 1000),
  disabled_features text[] not null default '{}',
  updated_by uuid references vppsone.staff_profiles (id),
  updated_at timestamptz not null default now()
);

comment on table vppsone.assist_settings is
  'AI helper settings (D-324). One row. monthly_budget_usd stops new drafts once the estimated spend this month (IST) reaches it; daily_cap_per_staff limits drafts per person per IST day.';

insert into vppsone.assist_settings (id) values (1) on conflict do nothing;

create table vppsone.assist_log (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references vppsone.staff_profiles (id),
  feature text not null check (feature ~ '^[a-z]{2,20}$'),
  task text not null check (task ~ '^[a-z]{2,20}\.[a-z]{2,20}$'),
  model text not null check (char_length(model) between 3 and 60),
  outcome text not null check (outcome in ('drafted', 'refused', 'failed')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  decision text check (decision in ('kept', 'edited', 'discarded')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint assist_log_decided check ((decision is null) = (decided_at is null))
);

comment on table vppsone.assist_log is
  'One row per AI helper request (D-324): tokens, estimated cost and what the person did with the draft. Never the prompt or the answer.';

create index assist_log_created on vppsone.assist_log (created_at);
create index assist_log_staff_created on vppsone.assist_log (staff_profile_id, created_at);

alter table vppsone.assist_settings enable row level security;
alter table vppsone.assist_log enable row level security;

revoke all on vppsone.assist_settings, vppsone.assist_log from anon, authenticated;
grant all on vppsone.assist_settings, vppsone.assist_log to service_role;

-- The two numbers every request is checked against, in one round trip.
create function vppsone.assist_budget_state(
  p_staff uuid,
  p_month_start timestamptz,
  p_day_start timestamptz
)
returns table (spent_usd numeric, staff_today integer)
language sql
stable
set search_path = ''
as $$
  select
    coalesce((select sum(l.cost_usd) from vppsone.assist_log l where l.created_at >= p_month_start), 0),
    (select count(*)::integer from vppsone.assist_log l
       where l.staff_profile_id = p_staff and l.created_at >= p_day_start);
$$;

-- Settings → AI helper: one line per feature since a moment.
create function vppsone.assist_usage_summary(p_since timestamptz)
returns table (
  feature text,
  uses integer,
  cost_usd numeric,
  kept integer,
  edited integer,
  discarded integer,
  refused integer,
  failed integer
)
language sql
stable
set search_path = ''
as $$
  select
    l.feature,
    count(*)::integer,
    coalesce(sum(l.cost_usd), 0),
    count(*) filter (where l.decision = 'kept')::integer,
    count(*) filter (where l.decision = 'edited')::integer,
    count(*) filter (where l.decision = 'discarded')::integer,
    count(*) filter (where l.outcome = 'refused')::integer,
    count(*) filter (where l.outcome = 'failed')::integer
  from vppsone.assist_log l
  where l.created_at >= p_since
  group by l.feature
  order by count(*) desc;
$$;

-- Settings → AI helper: who uses it most, since a moment.
create function vppsone.assist_usage_by_staff(p_since timestamptz)
returns table (staff_profile_id uuid, uses integer, cost_usd numeric)
language sql
stable
set search_path = ''
as $$
  select l.staff_profile_id, count(*)::integer, coalesce(sum(l.cost_usd), 0)
  from vppsone.assist_log l
  where l.created_at >= p_since
  group by l.staff_profile_id
  order by count(*) desc
  limit 20;
$$;

revoke all on function vppsone.assist_budget_state(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function vppsone.assist_usage_summary(timestamptz) from public, anon, authenticated;
revoke all on function vppsone.assist_usage_by_staff(timestamptz) from public, anon, authenticated;
grant execute on function vppsone.assist_budget_state(uuid, timestamptz, timestamptz) to service_role;
grant execute on function vppsone.assist_usage_summary(timestamptz) to service_role;
grant execute on function vppsone.assist_usage_by_staff(timestamptz) to service_role;
