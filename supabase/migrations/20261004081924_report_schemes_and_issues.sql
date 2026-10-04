-- P8: a report card is issued once, against an approved scheme, from papers
-- their teachers have submitted — and a correction is a new revision that
-- keeps the old one.
--
-- Before this, issuing upserted one row per child and term: a reissue
-- silently replaced what a family had been handed, the grade bands were a
-- constant nobody at the school had confirmed, a card could be issued while
-- papers were still being marked, and nothing recorded which marks, which
-- attendance or which rules it was made from.
--
-- The plan (§13): calculate from a pinned scheme; show absent, exempt and
-- incomplete as what they are, never a silent number; round at an agreed
-- boundary; count attendance over the reporting period and say how many days
-- were not recorded; freeze the approved revision with its sources, approver
-- and reason; a later correction prepares an amended report rather than
-- replacing the old one.

-- ---------------------------------------------------------------------------
-- The scheme: the school's rules for one term's cards
-- ---------------------------------------------------------------------------

create table vppsone.report_schemes (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  term text not null,
  revision integer not null,
  status text not null default 'draft',
  /** [{from, label, hi, en}], highest first. A percentage at or above `from` takes the band. */
  grade_bands jsonb not null,
  /** Decimal places the percentage is rounded to — half up — before it is graded. */
  percent_decimals smallint not null default 1,
  /** The overall percentage a card calls a pass, or null when the school does not print one. */
  pass_percent numeric(5, 2),
  attendance_from date,
  attendance_to date,
  header_en text,
  header_hi text,
  /** [{en, hi}] — the signature lines printed at the foot of the card. */
  signatories jsonb not null default '[]'::jsonb,
  approved_by uuid references vppsone.staff_profiles (id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_schemes_status_known check (status in ('draft', 'approved')),
  constraint report_schemes_approved_together check ((status = 'approved') = (approved_at is not null)),
  constraint report_schemes_decimals_sane check (percent_decimals between 0 and 2),
  constraint report_schemes_pass_sane check (pass_percent is null or (pass_percent >= 0 and pass_percent <= 100)),
  constraint report_schemes_period_ordered check (
    attendance_from is null or attendance_to is null or attendance_to >= attendance_from
  )
);

comment on table vppsone.report_schemes is
  'How one term''s report cards are worked out and what they print. A card is issued only against an approved revision, and keeps which one.';

create unique index report_schemes_revision_unique on vppsone.report_schemes (session_label, term, revision);
-- At most one revision being edited at a time.
create unique index report_schemes_one_draft on vppsone.report_schemes (session_label, term) where status = 'draft';

create trigger report_schemes_set_updated_at
  before update on vppsone.report_schemes
  for each row execute function vppsone.set_updated_at();

-- An approved scheme is a record: cards were issued from it. The one
-- exception is a synthetic term the verifier made (`QA-…`), which it removes
-- when it is done; a real term never starts so.
create or replace function vppsone.report_schemes_stay_approved()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved' and not (tg_op = 'DELETE' and old.term like 'QA-%') then
    raise exception 'report_scheme:approved_is_final';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger report_schemes_stay_approved
  before update or delete on vppsone.report_schemes
  for each row execute function vppsone.report_schemes_stay_approved();

alter table vppsone.report_schemes enable row level security;
create policy report_schemes_select_staff
  on vppsone.report_schemes for select to authenticated
  using ((select vppsone.staff_can('reports:view')));
grant select on vppsone.report_schemes to authenticated;
grant all on vppsone.report_schemes to service_role;

-- ---------------------------------------------------------------------------
-- The issued card, every revision of it
-- ---------------------------------------------------------------------------

create table vppsone.report_card_issues (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  term text not null,
  student_id uuid not null,
  revision integer not null,
  status text not null default 'issued',
  /** The card as printed: every number, grade and label, kept as it was. */
  card jsonb not null,
  /** Null only for a card issued before schemes existed. */
  scheme_id uuid references vppsone.report_schemes (id) on delete restrict,
  /** What it was made from: each paper's entry revision, the attendance period and what was not recorded. */
  sources jsonb not null default '{}'::jsonb,
  kind text not null default 'issue',
  reason text,
  issued_by uuid references vppsone.staff_profiles (id) on delete restrict,
  issued_at timestamptz not null default now(),
  supersedes uuid references vppsone.report_card_issues (id),
  command_id uuid not null,
  payload_hash text,
  constraint report_card_issues_status_known check (status in ('issued', 'superseded')),
  constraint report_card_issues_kind_known check (kind in ('issue', 'reissue', 'imported')),
  constraint report_card_issues_reissue_says_why check (kind <> 'reissue' or (reason is not null and btrim(reason) <> ''))
);

comment on table vppsone.report_card_issues is
  'Every report card handed out, every revision of it. A reissue supersedes the old revision and says why; nothing is overwritten.';

create unique index report_card_issues_revision_unique
  on vppsone.report_card_issues (session_label, term, student_id, revision);
create unique index report_card_issues_one_current
  on vppsone.report_card_issues (session_label, term, student_id) where status = 'issued';
create unique index report_card_issues_command_unique on vppsone.report_card_issues (command_id);

-- Only one change is ever made to an issued row: it is superseded. Nothing
-- is deleted — except a synthetic term the verifier made (`QA-…`).
create or replace function vppsone.report_card_issues_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.term like 'QA-%' then
      return old;
    end if;
    raise exception 'report_card:issued_is_final';
  end if;
  if new.card is distinct from old.card or new.sources is distinct from old.sources
     or new.revision is distinct from old.revision or new.student_id is distinct from old.student_id
     or new.issued_by is distinct from old.issued_by or new.issued_at is distinct from old.issued_at
     or not (old.status = 'issued' and new.status = 'superseded') then
    raise exception 'report_card:issued_is_final';
  end if;
  return new;
end;
$$;

create trigger report_card_issues_append_only
  before update or delete on vppsone.report_card_issues
  for each row execute function vppsone.report_card_issues_append_only();

alter table vppsone.report_card_issues enable row level security;
-- The same scope as the old table (P1): reports:view, and a child the reader
-- may see.
create policy report_card_issues_select_scoped
  on vppsone.report_card_issues for select to authenticated
  using (
    (select vppsone.staff_can('reports:view'))
    and (
      (select vppsone.reads_every_class())
      or exists (
        select 1 from vppsone.enrolments e
        where e.student_id = report_card_issues.student_id
          and e.session_label = report_card_issues.session_label
          and (e.class_id::text || '|' || e.session_label) = any (coalesce((select vppsone.my_class_keys()), '{}'::text[]))
      )
    )
  );
grant select on vppsone.report_card_issues to authenticated;
grant all on vppsone.report_card_issues to service_role;

-- ---------------------------------------------------------------------------
-- The command
-- ---------------------------------------------------------------------------

create or replace function vppsone.issue_report_card(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_command uuid;
  v_actor uuid;
  v_session text := p->>'session_label';
  v_term text := p->>'term';
  v_student uuid;
  v_scheme uuid;
  v_expected integer;
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_hash text := p->>'payload_hash';
  v_card jsonb := p->'card';
  v_sources jsonb := coalesce(p->'sources', '{}'::jsonb);
  v_fault text := p->>'fault';
  v_previous vppsone.report_card_issues%rowtype;
  v_current vppsone.report_card_issues%rowtype;
  v_actor_name text;
  v_scheme_row vppsone.report_schemes%rowtype;
  v_latest_scheme uuid;
  v_class uuid;
  v_unsubmitted text[];
  v_moved text[];
  v_revision integer;
  v_id uuid;
begin
  begin
    v_command := (p->>'command_id')::uuid;
    v_actor := (p->>'actor_staff_id')::uuid;
    v_student := (p->>'student_id')::uuid;
    v_scheme := (p->>'scheme_id')::uuid;
    v_expected := coalesce((p->>'expected_revision')::integer, 0);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;
  if v_command is null or v_actor is null or v_student is null or v_scheme is null
     or v_session is null or v_term is null or v_hash is null or jsonb_typeof(v_card) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:report:' || v_session || ':' || v_term || ':' || v_student::text));

  select * into v_previous from vppsone.report_card_issues where command_id = v_command;
  if found then
    if v_previous.payload_hash = v_hash and v_previous.issued_by = v_actor then
      return jsonb_build_object(
        'ok', true, 'issue_id', v_previous.id, 'revision', v_previous.revision,
        'issued_at', v_previous.issued_at, 'kind', v_previous.kind, 'replayed', true
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'id_reused');
  end if;

  -- 1. Releasing a card is the exam office's.
  select display_name into v_actor_name from vppsone.staff_profiles where id = v_actor and is_active;
  if v_actor_name is null or not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and rp.permission = 'assessments:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  -- 2. The approved scheme for this term — the latest one.
  select * into v_scheme_row from vppsone.report_schemes where id = v_scheme;
  select id into v_latest_scheme from vppsone.report_schemes
  where session_label = v_session and term = v_term and status = 'approved'
  order by revision desc limit 1;
  if v_scheme_row.id is null or v_scheme_row.status <> 'approved'
     or v_scheme_row.session_label <> v_session or v_scheme_row.term <> v_term then
    return jsonb_build_object('ok', false, 'reason', 'no_approved_scheme');
  end if;
  if v_latest_scheme is distinct from v_scheme then
    return jsonb_build_object('ok', false, 'reason', 'scheme_changed');
  end if;

  -- 3. Every paper the child's class sat this term has been submitted by its
  -- teacher, and none has moved since the card was worked out.
  select class_id into v_class from vppsone.enrolments
  where student_id = v_student and session_label = v_session;
  if v_class is null then
    return jsonb_build_object('ok', false, 'reason', 'not_enrolled');
  end if;

  select coalesce(array_agg(s.subject_code order by s.subject_code), '{}') into v_unsubmitted
  from vppsone.assessment_subjects s
  join vppsone.assessments a on a.id = s.assessment_id
  where s.class_id = v_class and a.session_label = v_session and a.term = v_term
    and a.status <> 'draft' and s.entry_status <> 'submitted';
  if cardinality(v_unsubmitted) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'papers_not_submitted', 'papers', to_jsonb(v_unsubmitted));
  end if;

  if coalesce((v_card->'totals'->>'missing')::integer, 0) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;

  select coalesce(array_agg(s.subject_code order by s.subject_code), '{}') into v_moved
  from jsonb_array_elements(coalesce(v_sources->'papers', '[]'::jsonb)) src
  join vppsone.assessment_subjects s on s.id = (src->>'id')::uuid
  where s.entry_revision <> (src->>'entry_revision')::integer;
  if cardinality(v_moved) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'marks_moved', 'papers', to_jsonb(v_moved));
  end if;

  -- 4. The revision the page showed.
  select * into v_current from vppsone.report_card_issues
  where session_label = v_session and term = v_term and student_id = v_student and status = 'issued'
  for update;
  if coalesce(v_current.revision, 0) <> v_expected then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'current_revision', coalesce(v_current.revision, 0));
  end if;
  if v_current.id is not null and v_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  -- 5. Supersede, then issue. The old revision stays, and says what replaced it.
  v_revision := coalesce(v_current.revision, 0) + 1;
  if v_current.id is not null then
    update vppsone.report_card_issues set status = 'superseded' where id = v_current.id;
  end if;

  if v_fault = 'after_supersede' and vppsone.flag_enabled('fault_injection') then
    raise exception 'report_card:injected_fault:after_supersede';
  end if;

  insert into vppsone.report_card_issues (
    session_label, term, student_id, revision, status, card, scheme_id, sources, kind, reason,
    issued_by, supersedes, command_id, payload_hash
  ) values (
    v_session, v_term, v_student, v_revision, 'issued', v_card, v_scheme, v_sources,
    case when v_current.id is null then 'issue' else 'reissue' end, v_reason,
    v_actor, v_current.id, v_command, v_hash
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'issue_id', v_id, 'revision', v_revision, 'issued_at', now(),
    'kind', case when v_current.id is null then 'issue' else 'reissue' end,
    'actor_name', v_actor_name, 'replayed', false
  );
end;
$$;

revoke all on function vppsone.issue_report_card(jsonb) from public;
grant execute on function vppsone.issue_report_card(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- What was already issued becomes revision 1, kept as it was
-- ---------------------------------------------------------------------------

insert into vppsone.report_card_issues (
  session_label, term, student_id, revision, status, card, kind, issued_by, issued_at, command_id
)
select session_label, term, student_id, 1, 'issued', payload, 'imported', generated_by, generated_at, gen_random_uuid()
from vppsone.report_cards;

comment on table vppsone.report_cards is
  'Superseded by report_card_issues (P8), which keeps every revision. Kept, not dropped: its rows were imported as revision 1.';
