-- Smoke Lab (owner's request, 20 Oct 2026): passwordless role accounts that
-- AI agents use to run a whole school day on the TEST database and file the
-- bugs and improvements they find.
--
-- DEV ONLY. Never apply to the live School Fees project: it is a D-skip file
-- in docs/cutover/LIVE-MIGRATION-PLAN.md, and the app switches the lab off on
-- live in code as well (src/platform/auth/smoke-lab.ts).
--
-- Shape of the safety:
--  * Only `smoke.*@qa.vpps.local` accounts are in the pool, and only those
--    can be signed in through a pass.
--  * A pass is a 256-bit secret shown once; only its sha256 is stored here.
--  * A smoke account's session is honoured only while one of its passes and
--    its run are live: `smoke_access_allowed()` is checked by the middleware
--    on every request (any other account is unaffected and always `true`).
--  * Nothing here is readable by a browser: RLS on, no policies, and the
--    schema's default `select` for `authenticated` revoked. The app reads it
--    with the service role after an admin check.
--
-- Rollback: drop function vppsone.smoke_access_allowed(); drop the four
-- tables (findings, passes, runs, pool), then unlink the pool's teacher
-- profiles (scripts/smoke-pool.mjs --release).

create table vppsone.smoke_pool (
  email text primary key
    check (email ~ '^smoke\.[a-z0-9._-]+@qa\.vpps\.local$'),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  staff_profile_id uuid not null unique references vppsone.staff_profiles (id),
  role vppsone.staff_role not null,
  label text not null check (char_length(label) between 3 and 80),
  linked_existing boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table vppsone.smoke_pool is
  'Smoke Lab test accounts (DEV only). linked_existing: the account was attached to an existing teacher profile rather than given a new one.';

create table vppsone.smoke_runs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  scenario text not null default 'school_day' check (scenario in ('school_day', 'free_explore')),
  school_day date,
  clock_start text check (clock_start is null or clock_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  status text not null default 'open' check (status in ('open', 'closed', 'revoked')),
  expires_at timestamptz not null,
  created_by uuid not null references vppsone.staff_profiles (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references vppsone.staff_profiles (id),
  constraint smoke_runs_window check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  constraint smoke_runs_closed check ((status = 'open') = (closed_at is null))
);

create table vppsone.smoke_passes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references vppsone.smoke_runs (id) on delete cascade,
  pool_email text not null references vppsone.smoke_pool (email) on delete cascade,
  persona text check (persona is null or char_length(persona) <= 120),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  first_used_at timestamptz,
  last_used_at timestamptz,
  uses integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now(),
  unique (run_id, pool_email)
);

create index smoke_passes_pool_live on vppsone.smoke_passes (pool_email, expires_at) where revoked_at is null;

create table vppsone.smoke_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references vppsone.smoke_runs (id) on delete cascade,
  pass_id uuid references vppsone.smoke_passes (id) on delete set null,
  role vppsone.staff_role,
  reporter text check (reporter is null or char_length(reporter) <= 120),
  kind text not null check (kind in ('bug', 'improvement', 'question')),
  severity text not null check (severity in ('P1', 'P2', 'P3')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  screen text check (screen is null or char_length(screen) <= 300),
  steps text check (steps is null or char_length(steps) <= 4000),
  expected text check (expected is null or char_length(expected) <= 2000),
  actual text check (actual is null or char_length(actual) <= 2000),
  evidence text check (evidence is null or char_length(evidence) <= 4000),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
  repeats integer not null default 1 check (repeats >= 1),
  status text not null default 'new'
    check (status in ('new', 'confirmed', 'duplicate', 'not_a_bug', 'fixed', 'verified', 'regressed')),
  triage_note text check (triage_note is null or char_length(triage_note) <= 1000),
  triaged_by uuid references vppsone.staff_profiles (id),
  triaged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, fingerprint)
);

create index smoke_findings_status on vppsone.smoke_findings (status, severity, created_at desc);

create trigger smoke_findings_set_updated_at
  before update on vppsone.smoke_findings
  for each row execute function vppsone.set_updated_at();

alter table vppsone.smoke_pool enable row level security;
alter table vppsone.smoke_runs enable row level security;
alter table vppsone.smoke_passes enable row level security;
alter table vppsone.smoke_findings enable row level security;

revoke all on vppsone.smoke_pool, vppsone.smoke_runs, vppsone.smoke_passes, vppsone.smoke_findings from anon, authenticated;
grant all on vppsone.smoke_pool, vppsone.smoke_runs, vppsone.smoke_passes, vppsone.smoke_findings to service_role;

-- True for every account that is not in the pool (nothing changes for real
-- or ordinary QA staff). For a pool account: true only while it holds a pass
-- that is unrevoked and unexpired, in a run that is open and unexpired.
create function vppsone.smoke_access_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from vppsone.smoke_pool p where p.auth_user_id = auth.uid())
    or exists (
      select 1
      from vppsone.smoke_passes s
      join vppsone.smoke_runs r on r.id = s.run_id
      join vppsone.smoke_pool p on p.email = s.pool_email
      where p.auth_user_id = auth.uid()
        and s.revoked_at is null
        and s.expires_at > now()
        and r.status = 'open'
        and r.expires_at > now()
    );
$$;

revoke all on function vppsone.smoke_access_allowed() from public, anon;
grant execute on function vppsone.smoke_access_allowed() to authenticated, service_role;
