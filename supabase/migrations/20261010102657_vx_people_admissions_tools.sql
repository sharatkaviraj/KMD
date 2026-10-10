-- UI P10 part 2 (People): admissions pipeline, admission details, seats,
-- promotion marks, data-quality skips and the bulk-change log.
--
-- All of it is VPPS One's own record in the `vppsone` schema. Fee tables are
-- not altered: a child's fee record is still created through the ported
-- School Fees student actions, and these tables only hold what the fee app
-- never had (an enquiry before there is a child, the Hindi spelling of a
-- name, which papers the office has seen). `student_id` columns name
-- `public.students.id` without a foreign key (rule 2, D-5).

create table vppsone.enquiries (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  -- enquiry -> visited -> form -> admitted; closed is a family that did not come.
  stage text not null default 'enquiry',
  child_name text not null,
  class_label text,
  parent_name text,
  phone text,
  notes text,
  student_id uuid,
  created_by uuid references vppsone.staff_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  stage_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enquiries_stage check (stage in ('enquiry', 'visited', 'form', 'admitted', 'closed')),
  constraint enquiries_name check (length(btrim(child_name)) between 1 and 120),
  constraint enquiries_admitted_has_student check (stage <> 'admitted' or student_id is not null)
);
comment on table vppsone.enquiries is
  'Families asking about a seat, before there is a student record. Admitted rows point at public.students.id.';
create index enquiries_session_stage on vppsone.enquiries (session_label, stage);

create table vppsone.admission_details (
  student_id uuid primary key,
  session_label text not null,
  name_hi text,
  -- Papers the office has seen: { birth, tc, photo, aadhaar, address } -> boolean.
  docs jsonb not null default '{}'::jsonb,
  enquiry_id uuid references vppsone.enquiries (id) on delete set null,
  admitted_by uuid references vppsone.staff_profiles (id) on delete set null,
  admitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admission_details_docs_object check (jsonb_typeof(docs) = 'object')
);
comment on table vppsone.admission_details is
  'What the admissions desk records beside the fee student row: Hindi name and documents received.';

create table vppsone.class_seats (
  session_label text not null,
  class_id uuid not null,
  seats integer not null,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (session_label, class_id),
  constraint class_seats_range check (seats between 0 and 500)
);
comment on table vppsone.class_seats is
  'How many children a class can take this session. A class with no row has no limit shown.';

create table vppsone.promotion_marks (
  run_id uuid not null,
  entry_id uuid not null,
  student_id uuid not null,
  -- held: stays in the same class. leaving: leaves the roll at year end.
  kind text not null,
  note text,
  marked_by uuid references vppsone.staff_profiles (id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (run_id, entry_id),
  constraint promotion_marks_kind check (kind in ('held', 'leaving'))
);
comment on table vppsone.promotion_marks is
  'Why a promotion entry was set to skip: held back or leaving. The fee run only knows skip.';

create table vppsone.data_quality_skips (
  student_id uuid not null,
  issue text not null,
  skipped_until date not null,
  skipped_by uuid references vppsone.staff_profiles (id) on delete set null,
  skipped_at timestamptz not null default now(),
  primary key (student_id, issue),
  constraint data_quality_skips_issue check (issue in ('father_phone', 'dob', 'mother_name', 'duplicate', 'age', 'address'))
);
comment on table vppsone.data_quality_skips is
  'A data-quality item the office chose to look at later. It comes back after skipped_until.';

create table vppsone.bulk_changes (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  done_by uuid references vppsone.staff_profiles (id) on delete set null,
  done_at timestamptz not null default now(),
  constraint bulk_changes_kind check (kind in ('promote', 'promote_undo', 'import', 'merge', 'split', 'quality'))
);
comment on table vppsone.bulk_changes is
  'Append-only log of school-wide student changes, for the Student tools hub.';
create index bulk_changes_done_at on vppsone.bulk_changes (done_at desc);

-- Reads for the people who run admissions; writes go through server actions
-- that check fees:manage and use the service role.
alter table vppsone.enquiries enable row level security;
alter table vppsone.admission_details enable row level security;
alter table vppsone.class_seats enable row level security;
alter table vppsone.promotion_marks enable row level security;
alter table vppsone.data_quality_skips enable row level security;
alter table vppsone.bulk_changes enable row level security;

create policy enquiries_select_staff on vppsone.enquiries for select to authenticated
  using ((select vppsone.staff_can_any(array['fees:manage', 'students:view'])));
create policy admission_details_select_staff on vppsone.admission_details for select to authenticated
  using ((select vppsone.staff_can_any(array['fees:manage', 'students:view'])));
create policy class_seats_select_staff on vppsone.class_seats for select to authenticated
  using ((select vppsone.staff_can_any(array['fees:manage', 'students:view'])));
create policy promotion_marks_select_staff on vppsone.promotion_marks for select to authenticated
  using ((select vppsone.staff_can_any(array['fees:manage'])));
create policy data_quality_skips_select_staff on vppsone.data_quality_skips for select to authenticated
  using ((select vppsone.staff_can_any(array['fees:manage'])));
create policy bulk_changes_select_staff on vppsone.bulk_changes for select to authenticated
  using ((select vppsone.staff_can_any(array['fees:manage'])));

grant select on vppsone.enquiries, vppsone.admission_details, vppsone.class_seats,
  vppsone.promotion_marks, vppsone.data_quality_skips, vppsone.bulk_changes to authenticated;
grant all on vppsone.enquiries, vppsone.admission_details, vppsone.class_seats,
  vppsone.promotion_marks, vppsone.data_quality_skips, vppsone.bulk_changes to service_role;
