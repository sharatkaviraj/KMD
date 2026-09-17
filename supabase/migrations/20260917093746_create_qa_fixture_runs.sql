-- VPPS One — QA fixture bookkeeping (task R0.2).
--
-- PLAN §5 R0 asks for fixtures that are "removable by run ID", and QA.md for a
-- run that can prove its own cleanup. Both need the seeder to remember what it
-- did, and remembering it in a file on one laptop is not remembering it.
--
-- So a fixture run writes an **undo log** as it goes: one row per write, with
-- enough to reverse it. An insert is reversed by deleting the key; an update is
-- reversed by writing `previous` back. That is what makes it safe for the
-- seeder to touch rows it did not create — binding a QA login to a staff
-- profile that already exists, for instance — because the old value is kept
-- rather than assumed to be null.
--
-- These two tables are bookkeeping, not product data. Nothing in `src/` reads
-- them; `scripts/qa-fixture.mjs` owns them, and that script refuses to run
-- against anything but the dev project (rule 3). They live in `vppsone`
-- because rule 1 says everything this app creates does.

-- ---------------------------------------------------------------------------
-- qa_runs — one row per `npm run qa:seed`
-- ---------------------------------------------------------------------------

create table vppsone.qa_runs (
  -- Human-chosen and human-typed: `qa:reset --run <id>`. A uuid would be
  -- correct and unusable at a terminal, so this is a short readable id the
  -- seeder derives from the clock, e.g. `r20260917-0942`.
  run_id text primary key,

  -- What made this run deterministic. Two runs with the same seed pick the
  -- same teachers, the same class and the same children; a run that cannot say
  -- what its seed was cannot be repeated, and an unrepeatable fixture makes an
  -- intermittent failure unarguable.
  seed text not null,

  -- Null until the run finishes. A row that never got one is a seed that died
  -- halfway, which is exactly the state `qa:reset` has to be able to clear.
  finished_at timestamptz,

  -- `seed` | `reset`. Plain text for the same reason `job_runs.job` is: adding
  -- a fixture mode should not need a migration.
  kind text not null default 'seed',

  note text,
  started_at timestamptz not null default now()
);

comment on table vppsone.qa_runs is
  'One row per QA fixture run. Dev-only bookkeeping written by scripts/qa-fixture.mjs; no application code reads it.';

create index qa_runs_recent_idx on vppsone.qa_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- qa_undo — how to put it back
-- ---------------------------------------------------------------------------

create table vppsone.qa_undo (
  id bigint generated always as identity primary key,

  run_id text not null references vppsone.qa_runs (run_id) on delete cascade,

  -- Reversal order. Rows are undone by descending `seq`, because a fixture
  -- writes a staff profile before the class-teacher row that points at it and
  -- deleting them in insertion order would hit the foreign key.
  seq integer not null,

  -- Schema-qualified, e.g. `vppsone.class_teachers`. The reset resolves it at
  -- run time rather than trusting a bare name to mean the right schema.
  table_name text not null,

  -- `insert` — reverse by deleting `key`.
  -- `update` — reverse by writing `previous` back over `key`.
  -- `delete` — reverse by inserting `previous`.
  action text not null,

  -- The primary key, as an object: `{"id": "…"}`, or a composite.
  key jsonb not null,

  -- The whole row as it was **before** this write, or null for an insert.
  -- Whole, not the changed columns: a partial snapshot restores a row that
  -- looks right and is not, and this is the only copy.
  previous jsonb,

  created_at timestamptz not null default now(),

  constraint qa_undo_action_is_known
    check (action in ('insert', 'update', 'delete')),

  -- An update or delete with nothing to put back is not reversible, and
  -- finding that out during a reset is finding it out too late.
  constraint qa_undo_reversal_has_a_previous
    check (action = 'insert' or previous is not null)
);

comment on table vppsone.qa_undo is
  'What a QA fixture run changed, and how to reverse it. Undone in descending seq order.';

create index qa_undo_by_run_idx on vppsone.qa_undo (run_id, seq desc);

-- No authenticated grants and no select policy on either table: this is test
-- scaffolding, the service-role client is the only thing that touches it, and
-- a signed-in member of staff has no reason to read it.
alter table vppsone.qa_runs enable row level security;
alter table vppsone.qa_undo enable row level security;
grant all on vppsone.qa_runs to service_role;
grant all on vppsone.qa_undo to service_role;
