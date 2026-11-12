-- Veer Patta AI, step 2b: a parent's sick-day note shows on the register
-- (D-588).
--
-- A parent writes to the school's number that a child will not come ("Riya
-- bimar hai, aaj nahi aayegi"). The helper already hands that message to the
-- class teacher (step 2, D-578). Now it also keeps one row per day the parent
-- named, so the class's register for that day says "Parent informed" beside
-- the child, the child starts as Absent there (the teacher can still change
-- it), and no "your child is absent" WhatsApp is queued for that parent.
--
-- What this adds, in `vppsone`, service role only:
--
--  * `parent_absence_notes`: one row per child per day. The reason is a word
--    (`sick` or `other`), never the parent's own words: those stay in the
--    hand-off (`parent_replies`), as every hand-off's do. The first note for a
--    day stands; a second message about the same day adds nothing.
--
-- The register and the absent-alert queue read it with the service role, for
-- the classes the reader may already open; nobody signed in reads it directly.
--
-- Rollback:
--   drop table if exists vppsone.parent_absence_notes;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table vppsone.parent_absence_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  session_label text not null check (char_length(session_label) between 4 and 40),
  day date not null,
  reason text not null,
  -- The hand-off the note came with, in One's Messages inbox.
  parent_reply_id uuid references vppsone.parent_replies(id) on delete set null,
  -- Written for the owner's test number standing in for a family.
  practice boolean not null default false,
  created_at timestamptz not null default now(),
  constraint parent_absence_notes_reason_known check (reason in ('sick', 'other')),
  constraint parent_absence_notes_one_per_day unique (student_id, day)
);

comment on table vppsone.parent_absence_notes is
  'Veer Patta AI (D-588): a parent told the school on WhatsApp that a child will be away. One row per child per day, for the register to show "Parent informed" and for no absent alert to be queued. The parent''s words stay in the hand-off (parent_replies).';
comment on column vppsone.parent_absence_notes.reason is
  'sick, or other (a family matter, travel): a word, never the parent''s message.';
comment on column vppsone.parent_absence_notes.parent_reply_id is
  'The hand-off this note came with, in One''s Messages inbox; null once that message is removed.';

create index parent_absence_notes_day on vppsone.parent_absence_notes (day, session_label);

alter table vppsone.parent_absence_notes enable row level security;
revoke all on vppsone.parent_absence_notes from anon, authenticated;
grant all on vppsone.parent_absence_notes to service_role;

commit;
