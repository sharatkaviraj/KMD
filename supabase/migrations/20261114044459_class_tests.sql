/*
 * Class tests (D-609): any test a teacher takes, any day, out of any marks,
 * kept apart from the school's exams.
 *
 * The owner (14 Nov 2026): teachers "randomly take different exams as well
 * ... they need to be uploaded as well to track the student progress. But
 * they are not added to the main ... sometimes they are added, sometimes
 * they are not". So a class test is its own record, never an `assessments`
 * row: results, report cards, the exam office's trackers, the parent helper
 * and every view over `assessments` keep reading exactly the exams they read
 * today, and a class test cannot reach a result by accident.
 *
 * A class test may name ONE school exam it helps fill (`counts_in`, "Count
 * in Test I"). That is a note for the teacher's Test I sheet, which offers to
 * fill her boxes from the counted tests; she checks every number and sends
 * Test I through `save_marks` as always. Nothing here writes `marks`.
 *
 *   1. `class_tests`        one test: class, subject, day, out of, the exam
 *                           it counts in (or none), open or finished.
 *   2. `class_test_marks`   one child's mark in it. NULL value and absent
 *                           false is a box somebody cleared: blank, not 0.
 *   3. `save_class_test_marks(jsonb)`  one save, in one transaction, for the
 *                           sheet the exam papers use (draft, finish, change).
 *
 * Who may save is decided by the app before the call (the test's teacher, a
 * teacher of that class and subject, or the exam office); the function checks
 * the test, the roll, the marks and the counts. Service role only, like the
 * other exam writes. It only adds tables and a function, and no fee
 * table is touched.
 */

begin;

/* ----------------------------------------------------------- the tests */

create table vppsone.class_tests (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  -- `public.classes.id` / the roster projection's class, with no FK (rule 2, D-5).
  class_id uuid not null,
  class_label text not null,

  subject_id uuid not null references vppsone.subjects (id),
  subject_code text not null,

  title text not null,
  held_on date not null,

  max_marks numeric not null,
  mark_step numeric not null default 1,

  -- The school exam this test helps fill, or none (progress only).
  counts_in uuid references vppsone.assessments (id),

  status text not null default 'open',
  revision integer not null default 0,
  finished_at timestamptz,
  finished_by uuid references vppsone.staff_profiles (id),

  -- Taken off the lists by its teacher. The row stays for good: a mark once
  -- typed is a record of what a child did.
  removed_at timestamptz,
  removed_by uuid references vppsone.staff_profiles (id),

  created_by uuid not null references vppsone.staff_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint class_tests_title_sane check (char_length(btrim(title)) between 1 and 80),
  constraint class_tests_max_sane check (max_marks > 0 and max_marks <= 500),
  constraint class_tests_step_sane check (mark_step in (0.5, 1)),
  constraint class_tests_status_known check (status in ('open', 'finished')),
  constraint class_tests_finished_together check ((status = 'finished') = (finished_at is not null)),
  constraint class_tests_removed_together check ((removed_at is null) = (removed_by is null))
);

comment on table vppsone.class_tests is
  'A test a teacher takes for her class, any day, out of any marks (D-609). Never a column on a result by itself; counts_in names the school exam whose sheet may be filled from it, with the teacher''s check.';
comment on column vppsone.class_tests.counts_in is
  'The school exam (assessments.id) this test helps fill, e.g. Test I; NULL = progress only.';

create index class_tests_class_subject_idx
  on vppsone.class_tests (session_label, class_id, subject_id, held_on desc)
  where removed_at is null;

create index class_tests_counts_in_idx
  on vppsone.class_tests (counts_in, class_id, subject_id)
  where counts_in is not null and removed_at is null;

create index class_tests_creator_idx
  on vppsone.class_tests (created_by, session_label, held_on desc)
  where removed_at is null;

create trigger class_tests_set_updated_at
  before update on vppsone.class_tests
  for each row execute function vppsone.set_updated_at();

alter table vppsone.class_tests enable row level security;
revoke all on vppsone.class_tests from public, anon, authenticated;
grant all on vppsone.class_tests to service_role;

/* ----------------------------------------------------------- the marks */

create table vppsone.class_test_marks (
  id uuid primary key default gen_random_uuid(),
  class_test_id uuid not null references vppsone.class_tests (id),
  student_id uuid not null,

  value numeric,
  absent boolean not null default false,

  entered_by uuid references vppsone.staff_profiles (id),
  entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A row holds a mark, an absence, or neither (a box somebody cleared,
  -- which reads as blank); never a mark and an absence together.
  constraint class_test_marks_one_answer check (not (value is not null and absent)),
  constraint class_test_marks_not_negative check (value is null or value >= 0)
);

comment on table vppsone.class_test_marks is
  'One child''s mark in one class test (D-609). NULL value with absent false is a cleared box: blank, never a zero.';

create unique index class_test_marks_unique
  on vppsone.class_test_marks (class_test_id, student_id);

create index class_test_marks_student_idx
  on vppsone.class_test_marks (student_id);

create trigger class_test_marks_set_updated_at
  before update on vppsone.class_test_marks
  for each row execute function vppsone.set_updated_at();

alter table vppsone.class_test_marks enable row level security;
revoke all on vppsone.class_test_marks from public, anon, authenticated;
grant all on vppsone.class_test_marks to service_role;

/* ------------------------------------------------------------ one save */

/*
 * p: { actor_staff_id, test_id, kind: draft | submit | reopen,
 *      entries: [{ student_id, state: blank | value | absent, value }] }
 *
 * Answers { ok: true, revision, entry_status: open | submitted, saved_at,
 * changed, counts } or { ok: false, reason[, student_id | blank] }, the
 * shapes the marks sheet already reads. A save repeated after a lost answer
 * writes the same values again, so it needs no command ledger: every entry
 * says what the cell IS, never what to add.
 */
create or replace function vppsone.save_class_test_marks(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := nullif(p->>'actor_staff_id', '')::uuid;
  v_test uuid := nullif(p->>'test_id', '')::uuid;
  v_kind text := coalesce(p->>'kind', '');
  t vppsone.class_tests%rowtype;
  v_roster uuid[];
  e jsonb;
  v_student uuid;
  v_state text;
  v_value numeric;
  v_changed integer := 0;
  v_rows integer;
  v_blank uuid[];
  v_entered integer;
  v_absent integer;
begin
  if v_actor is null or v_test is null or v_kind not in ('draft', 'submit', 'reopen') then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  select * into t from vppsone.class_tests where id = v_test for update;
  if not found or t.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_kind = 'reopen' then
    if t.status = 'finished' then
      update vppsone.class_tests
        set status = 'open', finished_at = null, finished_by = null, revision = revision + 1
        where id = t.id
        returning * into t;
    end if;
    return jsonb_build_object('ok', true, 'revision', t.revision, 'entry_status', 'open', 'saved_at', now(), 'changed', 0);
  end if;

  -- A finished test is changed only after "Change marks" (reopen); a draft
  -- arriving late from another phone must not edit it behind her back.
  if t.status = 'finished' and v_kind = 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'paper_submitted');
  end if;

  select coalesce(array_agg(r), '{}'::uuid[]) into v_roster
    from vppsone.attendance_roster(t.session_label, t.class_id, t.held_on) r;

  for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]'::jsonb)) loop
    v_student := nullif(e->>'student_id', '')::uuid;
    v_state := coalesce(e->>'state', '');
    v_value := case when e->>'value' is null then null else (e->>'value')::numeric end;
    if v_student is null or not (v_student = any(v_roster)) then
      return jsonb_build_object('ok', false, 'reason', 'not_on_roster', 'student_id', v_student);
    end if;
    if v_state = 'value' then
      if v_value is null or v_value < 0 or v_value > t.max_marks
         or (v_value / t.mark_step) <> trunc(v_value / t.mark_step) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'student_id', v_student);
      end if;
      insert into vppsone.class_test_marks (class_test_id, student_id, value, absent, entered_by)
        values (t.id, v_student, v_value, false, v_actor)
        on conflict (class_test_id, student_id) do update
          set value = excluded.value, absent = false, entered_by = excluded.entered_by, entered_at = now()
          where vppsone.class_test_marks.value is distinct from excluded.value
             or vppsone.class_test_marks.absent;
      get diagnostics v_rows = row_count;
    elsif v_state = 'absent' then
      insert into vppsone.class_test_marks (class_test_id, student_id, value, absent, entered_by)
        values (t.id, v_student, null, true, v_actor)
        on conflict (class_test_id, student_id) do update
          set value = null, absent = true, entered_by = excluded.entered_by, entered_at = now()
          where not vppsone.class_test_marks.absent;
      get diagnostics v_rows = row_count;
    elsif v_state = 'blank' then
      -- Cleared: the row stays, holding neither a mark nor Absent, which
      -- reads as blank (the exam marks table's rule, P7).
      update vppsone.class_test_marks
        set value = null, absent = false, entered_by = v_actor, entered_at = now()
        where class_test_id = t.id and student_id = v_student
          and (value is not null or absent);
      get diagnostics v_rows = row_count;
    else
      return jsonb_build_object('ok', false, 'reason', 'bad_request');
    end if;
    v_changed := v_changed + v_rows;
  end loop;

  -- Children with no mark and no absence, among the class on the test's day.
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_blank
    from unnest(v_roster) as r(id)
    where not exists (
      select 1 from vppsone.class_test_marks m
      where m.class_test_id = t.id and m.student_id = r.id
        and (m.value is not null or m.absent)
    );

  if v_kind = 'submit' and cardinality(v_blank) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'incomplete', 'blank', to_jsonb(v_blank));
  end if;

  select count(*) filter (where not m.absent), count(*) filter (where m.absent)
    into v_entered, v_absent
    from vppsone.class_test_marks m
    where m.class_test_id = t.id and m.student_id = any(v_roster)
      and (m.value is not null or m.absent);

  update vppsone.class_tests
    set revision = revision + 1,
        status = case when v_kind = 'submit' then 'finished' else status end,
        finished_at = case when v_kind = 'submit' then now() else finished_at end,
        finished_by = case when v_kind = 'submit' then v_actor else finished_by end
    where id = t.id
    returning * into t;

  return jsonb_build_object(
    'ok', true,
    'revision', t.revision,
    'entry_status', case when t.status = 'finished' then 'submitted' else 'open' end,
    'saved_at', now(),
    'changed', v_changed,
    'counts', jsonb_build_object('entered', v_entered, 'absent', v_absent, 'exempt', 0, 'blank', cardinality(v_blank), 'total', cardinality(v_roster))
  );
end;
$$;

revoke all on function vppsone.save_class_test_marks(jsonb) from public, anon, authenticated;
grant execute on function vppsone.save_class_test_marks(jsonb) to service_role;

commit;
