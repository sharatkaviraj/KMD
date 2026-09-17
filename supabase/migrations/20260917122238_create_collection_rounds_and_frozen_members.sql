-- VPPS One — collection rounds, and the roster frozen at the moment of asking.
--
-- **The bug this exists to fix (B-07, S-02).** A request's roll and its
-- prefilled values were re-read from `enrolments` and `student_records` every
-- time the link was opened. So moving a child between classes after a link went
-- out changed who the teacher was being asked about, and an office correction
-- changed what "old value" meant on the review screen — the teacher is shown
-- one thing, answers it, and the queue compares her answer against something
-- she never saw.
--
-- A request is a question that was asked at a moment. This freezes the moment.

/* ------------------------------------------------------------- the round */

create table vppsone.collection_rounds (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  -- Authored text: one half is enough (R1.3, D-129).
  title_hi text,
  title_en text,

  -- What was asked for, as chosen. Kept as the *description* of the audience
  -- rather than as its result: the result is `collection_request_members`, and
  -- keeping both means the board can say "Class 6, children with no phone
  -- number" long after the children in question have changed.
  --
  -- { kind, classIds[], houses[], routes[], studentIds[], gaps[] }
  audience jsonb not null default '{}'::jsonb,

  due_date date,

  -- Why these children and not a whole class. Without it a subset reads to a
  -- teacher as a broken list, which is worse than not sending it.
  reason_hi text,
  reason_en text,

  -- `class_teacher` | `incharge`. Plain text rather than an enum, following
  -- the rule below: a third way of choosing recipients should cost nothing.
  recipient_mode text not null default 'class_teacher',

  status text not null default 'draft',

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A round nobody can read the title of is a link that does not say what is
  -- being asked.
  constraint collection_rounds_has_a_title
    check (coalesce(nullif(btrim(title_hi), ''), nullif(btrim(title_en), '')) is not null)
);

comment on table vppsone.collection_rounds is
  'One round of asking: an audience, some fields, a due date. Its links are collection_requests rows carrying round_id.';
comment on column vppsone.collection_rounds.audience is
  'What was asked for, as chosen. The result is collection_request_members, frozen at issue.';

create index collection_rounds_session_idx
  on vppsone.collection_rounds (session_label, created_at desc);

create trigger collection_rounds_set_updated_at
  before update on vppsone.collection_rounds
  for each row execute function vppsone.set_updated_at();

alter table vppsone.collection_rounds enable row level security;
create policy collection_rounds_select_authenticated
  on vppsone.collection_rounds for select to authenticated using (true);
grant select on vppsone.collection_rounds to authenticated;
grant all on vppsone.collection_rounds to service_role;

/* --------------------------------------------- a request inside a round */

alter table vppsone.collection_requests
  -- ON DELETE SET NULL, not CASCADE: a link outlives the round it came from.
  -- Deleting a round must not delete the answers a teacher already sent.
  add column round_id uuid references vppsone.collection_rounds (id) on delete set null,

  -- class | house | route | master | list.
  --
  -- **Plain text, no enum and no check.** A fifth kind should cost nothing:
  -- an enum would need a migration, and the resolver, the board, the token
  -- routes and the review queue all carry this value through unchanged. An
  -- unrecognised kind is a row from a later version, not corruption.
  add column audience_kind text not null default 'class',

  -- How the group reads on screen and in the message: "Class 6", "Rana
  -- Pratap", "Amet City", "All classes".
  add column audience_label text,

  -- The number this link was actually sent to, when it is not the teacher's
  -- saved one. Null means "use the profile's". The office often knows a better
  -- number for one round, and typing it here must not change every future one.
  add column contact_phone text,

  -- Handing a link over happens once, so this is both "when" and "whether".
  add column sent_at timestamptz,
  add column sent_by uuid references vppsone.staff_profiles (id) on delete set null,

  -- A chase happens again every week the answers do not arrive, so the useful
  -- facts are the most recent one and how many there have been. Deliberately a
  -- different shape from sent_at.
  add column reminded_at timestamptz,
  add column reminded_by uuid references vppsone.staff_profiles (id) on delete set null,
  add column reminder_count integer not null default 0,

  -- Hidden from the boards, kept in the database. A request that collected
  -- answers cannot be deleted — submissions reference it — so archiving is the
  -- honest version of the same intent: the clutter goes, the evidence does not.
  add column archived_at timestamptz,

  -- When this link's token was last replaced. Never read by the resolver:
  -- rotation overwrites `token`, so the old URL is dead the instant the new one
  -- is born. This exists only so a screen can say "rotated 3 Sep".
  add column token_rotated_at timestamptz;

-- A house or a bus route spans classes, so neither has one.
alter table vppsone.collection_requests alter column class_id drop not null;
alter table vppsone.collection_requests alter column class_label drop not null;

-- Every existing request is a class request, and its label is its class.
update vppsone.collection_requests
set audience_label = coalesce(audience_label, class_label)
where audience_label is null;

alter table vppsone.collection_requests alter column audience_label set not null;

-- A class request still needs its class: dropping NOT NULL above must not let
-- one be created without one.
alter table vppsone.collection_requests
  add constraint collection_requests_class_kind_has_a_class
  check (audience_kind <> 'class' or class_id is not null);

-- **One link per group per round.** This is what makes Resume safe: a fan-out
-- that failed halfway is finished by creating the scopes that are missing, and
-- a double-tapped Resume racing itself hits this index instead of minting a
-- second token for a group that already has one.
create unique index collection_requests_round_scope_idx
  on vppsone.collection_requests (round_id, audience_kind, audience_label)
  where round_id is not null;

create index collection_requests_round_idx
  on vppsone.collection_requests (round_id);

/* ----------------------------------------- who was asked, and what we held */

create table vppsone.collection_request_members (
  request_id uuid not null
    references vppsone.collection_requests (id) on delete cascade,

  -- `public.students.id`, with no FK (rule 2, D-5).
  student_id uuid not null,

  -- The roll number as it was when the link went out. A child's roll number
  -- changes; the sheet the teacher is looking at does not.
  roll_no text,

  -- **The prefilled values exactly as sent.** This is the diff base: every
  -- answer is compared against it to decide what changed, so "old value → new
  -- value" on the review screen still refers to what the teacher actually saw,
  -- however many times the record has been corrected since.
  snapshot jsonb not null default '{}'::jsonb,

  -- One line about this child on this link — "number belongs to an uncle",
  -- "photo is blurred". A column rather than a key in `snapshot`, which is the
  -- obvious home and the wrong one: `snapshot` is the diff base, and a key in
  -- there that is not a field is a key something will eventually read as one.
  ask_note text,

  created_at timestamptz not null default now(),

  primary key (request_id, student_id)
);

comment on table vppsone.collection_request_members is
  'Who was in scope and what we held, frozen at the moment the link was issued. Moving a child afterwards cannot change what was asked (S-02).';
comment on column vppsone.collection_request_members.snapshot is
  'Prefilled values exactly as sent. The diff base for review — never re-derived.';

create index collection_request_members_student_idx
  on vppsone.collection_request_members (student_id);

alter table vppsone.collection_request_members enable row level security;
create policy collection_request_members_select_authenticated
  on vppsone.collection_request_members for select to authenticated using (true);
grant select on vppsone.collection_request_members to authenticated;
grant all on vppsone.collection_request_members to service_role;
