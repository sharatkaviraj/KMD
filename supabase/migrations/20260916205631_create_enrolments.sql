-- VPPS One — enrolments: the academic record.
--
-- `public.students` holds where a child is **today**: one `class_id`, one
-- `status`, overwritten when they move up a year. That is what a fee app
-- needs. It is not what an academic record needs — "which class was this
-- child in when they sat that exam" has no answer in it, and by the time the
-- question is asked the row has already changed.
--
-- So VPPS One keeps its own row per child per session, built from
-- `public.students` once and then owned here. Rule 2 is why it has to be a
-- copy: the fee app's table cannot gain a column or a history table.

create type vppsone.enrolment_status as enum ('enrolled', 'left', 'promoted');

create table vppsone.enrolments (
  id uuid primary key default gen_random_uuid(),

  -- `public.students.id` and `public.classes.id`, both without a foreign key:
  -- a constraint into the fee app's schema would be a write into it
  -- (rule 2, D-5). The consistency check on /enrolments is what notices a
  -- student who has since gone.
  student_id uuid not null,
  class_id uuid not null,

  session_label text not null,

  -- Copied from the fee app at build time, editable here afterwards: a roll
  -- number is an academic fact about a year, and the fee app overwrites it.
  roll_no text,

  status vppsone.enrolment_status not null default 'enrolled',
  enrolled_on date,
  left_on date,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A leaving date on a row that still says "enrolled" is a contradiction
  -- somebody would eventually have to resolve by guessing.
  constraint enrolments_left_on_needs_status
    check (left_on is null or status <> 'enrolled')
);

comment on table vppsone.enrolments is
  'Which child was in which class in which session. Built from public.students, which holds only today; this is the academic record that keeps history.';
comment on column vppsone.enrolments.roll_no is
  'The roll number as of this session. Copied from the fee app at build time and editable here afterwards.';

-- One row per child per session. A child cannot be in two classes in the same
-- year, and a rebuild must update rather than duplicate.
create unique index enrolments_one_per_student_per_session
  on vppsone.enrolments (student_id, session_label);

-- "Who is in this class" — the register's first query, every period of every
-- day. Partial, because a left student is not on the register.
create index enrolments_by_class_idx
  on vppsone.enrolments (session_label, class_id)
  where status = 'enrolled';

-- "Where has this child been" — the student card in task 3.5.
create index enrolments_by_student_idx
  on vppsone.enrolments (student_id);

create trigger enrolments_set_updated_at
  before update on vppsone.enrolments
  for each row execute function vppsone.set_updated_at();

alter table vppsone.enrolments enable row level security;

create policy enrolments_select_authenticated
  on vppsone.enrolments for select to authenticated using (true);

grant select on vppsone.enrolments to authenticated;
grant all on vppsone.enrolments to service_role;
