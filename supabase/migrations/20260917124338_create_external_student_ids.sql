-- VPPS One — which child in another app is this child.
--
-- **S-10 / B-15.** SamPark keys its students on its own text id ('S1001'),
-- not on `public.students.id`, so there is no arithmetic that turns one into
-- the other. `apps.ts` has therefore never emitted a SamPark deep link: it
-- sends the reader to SamPark's search box, because guessing by name is the
-- one thing PARITY.md says never to do.
--
-- This is the table that ends the guessing. Nothing populates it yet — the
-- matcher belongs with the student source tooling in R4.1 — and until a row
-- exists the link keeps degrading to search, which is the same honest
-- behaviour it has today.

create table vppsone.external_student_ids (
  -- `AppId` from `src/platform/config/app-origins.ts`. Text, not an enum: a
  -- fourth app should cost a row, not a migration.
  app_id text not null,

  -- The other app's own id, exactly as it holds it.
  external_id text not null,

  -- `public.students.id`, with no foreign key (rule 2, D-5).
  student_id uuid not null,

  -- **Which dataset that uuid belongs to.**
  --
  -- Load-bearing. VPPS One reads schoolfees-dev and both siblings read live,
  -- so a uuid here is only meaningful against the dataset it was matched in.
  -- A deep link built from a dev-matched row while pointed at live data would
  -- not 404 — it would open a different child, which is worse than not
  -- linking at all. The resolver refuses a row whose environment is not the
  -- one being read.
  source_environment text not null,

  -- How the pair was established: 'admission_no', 'sr_no', 'hand'. Kept
  -- because a wrong mapping is found by asking how it was made, and a matcher
  -- that silently changes rule leaves no trace otherwise.
  matched_on text,

  note text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (app_id, external_id)
);

comment on table vppsone.external_student_ids is
  'Which child in another app is this child. Only usable against the dataset in source_environment (S-10).';
comment on column vppsone.external_student_ids.source_environment is
  'The dataset student_id belongs to. A mapping matched on dev says nothing about a child on live.';

-- One child, one id per app, in each direction. Without this a re-run of a
-- matcher quietly builds a second mapping and the link starts depending on
-- row order.
create unique index external_student_ids_one_per_student
  on vppsone.external_student_ids (app_id, source_environment, student_id);

create index external_student_ids_student_idx
  on vppsone.external_student_ids (student_id);

alter table vppsone.external_student_ids enable row level security;
create policy external_student_ids_select_authenticated
  on vppsone.external_student_ids for select to authenticated using (true);
grant select on vppsone.external_student_ids to authenticated;
grant all on vppsone.external_student_ids to service_role;
