-- VPPS One — the job platform (Phase 7.1).

create type vppsone.job_status as enum ('running', 'ok', 'failed', 'skipped');
create type vppsone.job_trigger as enum ('schedule', 'manual');

-- ---------------------------------------------------------------------------
-- job_runs — one row per attempt, including the ones that failed
-- ---------------------------------------------------------------------------
--
-- A scheduled job nobody can see is a job nobody trusts. The first question
-- after "did the registers open this morning?" is "when did that last work",
-- and that question needs a row per *attempt* — a table that only recorded
-- successes would be silent on precisely the morning somebody is asking.

create table vppsone.job_runs (
  id uuid primary key default gen_random_uuid(),

  -- Not an enum: the job list lives in `src/modules/jobs/domain/jobs.ts`, and
  -- adding a job should not need a migration. An unknown name here is a row
  -- describing a job that has been removed, which is history, not corruption.
  job text not null,

  status vppsone.job_status not null default 'running',
  trigger vppsone.job_trigger not null,

  -- Null for a scheduled run: nobody triggered it, which is the point.
  triggered_by uuid references vppsone.staff_profiles (id) on delete set null,

  -- The school day this run was *for*, which is not always the day it ran on.
  -- A register-opening job retried at 00:05 the next morning is still about
  -- yesterday, and the retry has to be able to say so.
  for_day date,

  -- What it did, in numbers. Kept as jsonb rather than columns because every
  -- job counts something different, and a table with a column per job's
  -- favourite number is a table that gets a migration every time one changes.
  summary jsonb not null default '{}'::jsonb,

  error text,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint job_runs_finished_when_done
    check ((status = 'running') = (finished_at is null))
);

comment on table vppsone.job_runs is
  'One row per attempt at a scheduled job, successes and failures alike. What the jobs console reads.';

-- **One run of a job at a time, enforced here rather than in code.** Two
-- overlapping register-opening runs would each find no register and each
-- create one. A lock held in the application is a lock that does not exist
-- when the application is two instances, which on Vercel it always is.
create unique index job_runs_one_at_a_time
  on vppsone.job_runs (job)
  where status = 'running';

create index job_runs_recent_idx on vppsone.job_runs (job, started_at desc);
create index job_runs_day_idx on vppsone.job_runs (job, for_day, status);

alter table vppsone.job_runs enable row level security;
create policy job_runs_select_authenticated
  on vppsone.job_runs for select to authenticated using (true);
grant select on vppsone.job_runs to authenticated;
grant all on vppsone.job_runs to service_role;
