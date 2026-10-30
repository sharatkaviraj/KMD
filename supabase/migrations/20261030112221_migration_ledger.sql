-- The migration's own bookkeeping (plan §2.1, I-8): what ran, what it mapped,
-- and how far each source has been read.
--
-- Every importer in scripts/migrate/* (Phase 2) is idempotent, dry-run by
-- default, and writes one row here per run. Nothing in the app reads these;
-- they are for the operator and for the importers themselves:
--
--  * migration_runs        one row per run of any migrate script: which
--                          script, dry run or apply, which source project and
--                          snapshot, when it started and finished, how it
--                          ended, and its counts/sums/hashes (never personal
--                          data — I-5). A `cutover` row locks out
--                          load-snapshot for good (plan §2.3).
--  * migration_id_map      source id -> target id for every row an importer
--                          had to re-key (quarantine shells, test-session
--                          copies), so a second run finds the same target and
--                          reconcile can exclude them (plan §2.5).
--  * migration_watermarks  how far each source table has been read, as the
--                          snapshot id and the now() read inside it — never a
--                          wall-clock time recorded beforehand (critique0 #6).
--
-- Service role only: no policy, nothing granted to anon or authenticated.
--
-- Rollback:
--   drop table vppsone.migration_watermarks;
--   drop table vppsone.migration_id_map;
--   drop table vppsone.migration_runs;

create table vppsone.migration_runs (
  id uuid primary key default gen_random_uuid(),
  script text not null check (script ~ '^[a-z0-9][a-z0-9_.-]{0,80}$'),
  kind text not null default 'run' check (kind in ('run', 'dry_run', 'cutover', 'rollback')),
  source_project text not null check (source_project ~ '^[a-z]{20}$'),
  target_project text not null check (target_project ~ '^[a-z]{20}$'),
  snapshot_id text check (snapshot_id is null or char_length(snapshot_id) <= 200),
  snapshot_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'refused')),
  -- Counts, sums and hashes only. Never a name, phone or row (I-5).
  summary jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 1000),
  run_by text not null default session_user,
  check (finished_at is null or finished_at >= started_at),
  check (status = 'running' or finished_at is not null)
);

comment on table vppsone.migration_runs is
  'One row per run of a scripts/migrate/* tool (plan §2.1). A cutover row locks out load-snapshot.';

create index migration_runs_script_started on vppsone.migration_runs (script, started_at desc);

-- At most one cutover, ever.
create unique index migration_runs_one_cutover on vppsone.migration_runs ((kind)) where kind = 'cutover';

create table vppsone.migration_id_map (
  source_project text not null check (source_project ~ '^[a-z]{20}$'),
  source_table text not null check (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  source_id text not null check (char_length(source_id) between 1 and 200),
  target_id text not null check (char_length(target_id) between 1 and 200),
  batch_id uuid references vppsone.migration_runs (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (source_project, source_table, source_id)
);

comment on table vppsone.migration_id_map is
  'Source row -> target row for every row an importer re-keyed (plan §2.1). Reconcile excludes and counts these.';

create index migration_id_map_target on vppsone.migration_id_map (source_table, target_id);
create index migration_id_map_batch on vppsone.migration_id_map (batch_id);

create table vppsone.migration_watermarks (
  source_project text not null check (source_project ~ '^[a-z]{20}$'),
  source_table text not null check (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  snapshot_id text not null check (char_length(snapshot_id) between 1 and 200),
  -- now() read inside the exported snapshot's own transaction.
  snapshot_at timestamptz not null,
  run_id uuid references vppsone.migration_runs (id) on delete restrict,
  row_count bigint check (row_count is null or row_count >= 0),
  content_md5 text check (content_md5 is null or content_md5 ~ '^[0-9a-f]{32}$'),
  updated_at timestamptz not null default now(),
  primary key (source_project, source_table)
);

comment on table vppsone.migration_watermarks is
  'How far each source table has been read: the snapshot itself, not a wall-clock time (critique0 #6).';

alter table vppsone.migration_runs enable row level security;
alter table vppsone.migration_id_map enable row level security;
alter table vppsone.migration_watermarks enable row level security;

revoke all on vppsone.migration_runs from public, anon, authenticated;
revoke all on vppsone.migration_id_map from public, anon, authenticated;
revoke all on vppsone.migration_watermarks from public, anon, authenticated;

grant select, insert, update on vppsone.migration_runs to service_role;
grant select, insert, update, delete on vppsone.migration_id_map to service_role;
grant select, insert, update, delete on vppsone.migration_watermarks to service_role;
