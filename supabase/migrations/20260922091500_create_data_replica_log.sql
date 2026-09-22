-- The record of where this database's fee data came from.
--
-- `schoolfees-dev` now carries a de-identified replica of the live fee
-- database: the same 614 students, the same 2,536 instalments and the same
-- totals to the rupee, with every name, phone number, address and government
-- identifier replaced or dropped (scripts/replicate-live.mjs).
--
-- **This table exists so that "is this live data?" is a question with an
-- answer in the database rather than a matter of recognising twelve
-- surnames.** Anything reading this database — a person, a test, an agent —
-- can select one row and know. A database with no row here has not been
-- through the replica pipeline, which is itself the answer.
--
-- It lives in `vppsone` because rule 1 says so: `public` belongs to the fee
-- app, and a table this app invented does not go there.
create table if not exists vppsone.data_replica (
  id uuid primary key default gen_random_uuid(),

  -- Where the rows came from, by project ref, so the answer survives the
  -- environment variables being rewritten.
  source_project text not null,
  target_project text not null,

  -- What was actually moved, and what was deliberately left behind.
  tables_copied integer not null,
  rows_copied integer not null,
  tables_skipped jsonb not null default '{}'::jsonb,

  -- Which columns were masked and how. The honest record of what a reader of
  -- this database is looking at.
  masked_columns jsonb not null default '{}'::jsonb,

  -- Rows the source holds that the source's own rules would now reject, kept
  -- rather than dropped so the money still adds up, and flagged so they can
  -- be found again.
  carried_exceptions jsonb not null default '{}'::jsonb,

  note text,
  created_at timestamptz not null default now()
);

comment on table vppsone.data_replica is
  'One row per replica load. Its presence means the fee data in this database is masked test data copied from another project, never the live original.';

alter table vppsone.data_replica enable row level security;

-- Readable by any signed-in member of staff: knowing whether you are looking
-- at real money is not a privilege, it is the first thing anyone should be
-- able to check. Writing is left to the service role that runs the loader.
drop policy if exists data_replica_readable_by_staff on vppsone.data_replica;
create policy data_replica_readable_by_staff
  on vppsone.data_replica
  for select
  to authenticated
  using (true);
