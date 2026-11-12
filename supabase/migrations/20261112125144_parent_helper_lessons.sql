-- Veer Patta AI, step 3: "teach it once" and the weekly report (D-589, D-590).
--
-- When the helper cannot answer a general question about the school (winter
-- timings, the Saturday uniform, a bus route), it passes the parent to the
-- office as before, and now also puts the question on a list in One, written
-- by Claude as one short general line with no names and nothing about the
-- family. An admin writes the school's answer once; from the next message on,
-- the helper answers that question itself, in the parent's language. Or the
-- admin says a person always answers it, and it stops coming back to the list.
--
-- What this adds, all in `vppsone`, service role only:
--
--  * `parent_helper_lessons`: one row per question. `practice` keeps the
--    practice family's questions (the owner's number standing for the TEST
--    children) apart from real families': an answer taught for one is used
--    for that kind of chat only. `fingerprint` is the question folded to
--    lower case and plain words by the app, so the same question asked again
--    finds the row it is already on instead of making a new one.
--  * `parent_helper_note_lesson(...)`: the helper's one write per answer.
--    'used' counts an answer the helper gave from a school answer; 'asked'
--    counts a question again (by the row the helper named, else by its
--    fingerprint) or lists it for the first time. Atomic, one round trip.
--  * Three columns on `parent_helper_turns`, for the weekly report:
--    `practice` (every turn so far is the practice family's, so existing rows
--    read true), and `lesson_id` / `lesson_role`, the lesson a turn used or
--    added to.
--
-- Nothing here stores a parent's words: a lesson's question is Claude's
-- general wording, which the app refuses when it names any child, parent or
-- teacher of the family that wrote, or carries a long number, an address or
-- a link. Nothing here sends a message.
--
-- Rollback (by hand; the code that runs today does not read any of it):
--   drop function if exists vppsone.parent_helper_note_lesson(boolean, text, uuid, text, text, text);
--   alter table vppsone.parent_helper_turns
--     drop constraint if exists parent_helper_turns_lesson_role_known,
--     drop column if exists lesson_role,
--     drop column if exists lesson_id,
--     drop column if exists practice;
--   drop table if exists vppsone.parent_helper_lessons;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table vppsone.parent_helper_lessons (
  id uuid primary key default gen_random_uuid(),
  practice boolean not null,
  question text not null
    constraint parent_helper_lessons_question_size check (char_length(btrim(question)) between 6 and 160),
  fingerprint text not null
    constraint parent_helper_lessons_fingerprint_size check (char_length(fingerprint) between 3 and 160),
  answer text
    constraint parent_helper_lessons_answer_size check (answer is null or char_length(btrim(answer)) between 2 and 600),
  status text not null default 'waiting'
    constraint parent_helper_lessons_status_known check (status in ('waiting', 'answered', 'by_people')),
  topic text
    constraint parent_helper_lessons_topic_shape check (topic is null or topic ~ '^[a-z_]{2,30}$'),
  asked_count integer not null default 1
    constraint parent_helper_lessons_asked_count_range check (asked_count between 0 and 1000000),
  first_asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  used_count integer not null default 0
    constraint parent_helper_lessons_used_count_range check (used_count between 0 and 1000000),
  last_used_at timestamptz,
  answered_by uuid constraint parent_helper_lessons_answered_by_fkey references vppsone.staff_profiles(id) on delete set null,
  answered_at timestamptz,
  closed_by uuid constraint parent_helper_lessons_closed_by_fkey references vppsone.staff_profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parent_helper_lessons_answered_has_answer check (status <> 'answered' or answer is not null)
);

comment on table vppsone.parent_helper_lessons is
  'Veer Patta AI (D-589): questions the helper could not answer, in Claude''s general wording with no names, and the school''s answer once an admin writes it. practice keeps the practice family''s apart from real families''.';
comment on column vppsone.parent_helper_lessons.fingerprint is
  'The question folded to lower case and plain words by the app: the same question asked again finds this row.';
comment on column vppsone.parent_helper_lessons.status is
  'waiting: on the list for an admin. answered: the helper answers it from answer. by_people: a person always answers it; the helper hands it off and does not list it again.';

-- One open row per question and kind. An answered question may be asked
-- again in a way its answer does not cover, which lists it afresh.
create unique index parent_helper_lessons_open_question
  on vppsone.parent_helper_lessons (practice, fingerprint)
  where status in ('waiting', 'by_people');
create index parent_helper_lessons_kind
  on vppsone.parent_helper_lessons (practice, status, last_asked_at desc);

alter table vppsone.parent_helper_lessons enable row level security;
revoke all on vppsone.parent_helper_lessons from anon, authenticated;
grant all on vppsone.parent_helper_lessons to service_role;

alter table vppsone.parent_helper_turns
  add column practice boolean not null default true,
  add column lesson_id uuid references vppsone.parent_helper_lessons(id) on delete set null,
  add column lesson_role text,
  add constraint parent_helper_turns_lesson_role_known check (lesson_role is null or lesson_role in ('used', 'asked'));

comment on column vppsone.parent_helper_turns.practice is
  'Veer Patta AI (D-590): a parent of the practice family (the owner''s number standing for TEST children) or of a real one. Every turn before this column was practice; a member of staff''s own turns (an answer, a link code) keep the default.';
comment on column vppsone.parent_helper_turns.lesson_id is
  'Veer Patta AI (D-589): the lesson this answer used (lesson_role used) or added the question to (asked).';

create index parent_helper_turns_week on vppsone.parent_helper_turns (practice, received_at);

create function vppsone.parent_helper_note_lesson(
  p_practice boolean,
  p_role text,
  p_lesson_id uuid,
  p_question text,
  p_fingerprint text,
  p_topic text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_practice is null then
    return null;
  end if;

  -- An answer the helper gave from what the school taught it.
  if p_role = 'used' then
    update vppsone.parent_helper_lessons l
       set used_count = l.used_count + 1, last_used_at = now(), updated_at = now()
     where l.id = p_lesson_id and l.practice = p_practice and l.status = 'answered'
    returning l.id into v_id;
    return v_id;
  end if;

  if p_role is distinct from 'asked' then
    return null;
  end if;

  -- The question again: the row the helper named, if it is still open.
  if p_lesson_id is not null then
    update vppsone.parent_helper_lessons l
       set asked_count = l.asked_count + 1, last_asked_at = now(), updated_at = now()
     where l.id = p_lesson_id and l.practice = p_practice and l.status in ('waiting', 'by_people')
    returning l.id into v_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if p_question is null or p_fingerprint is null
     or char_length(btrim(p_question)) not between 6 and 160
     or char_length(p_fingerprint) not between 3 and 160 then
    return null;
  end if;

  -- New, or the same words as an open row.
  insert into vppsone.parent_helper_lessons as l (practice, question, fingerprint, topic)
  values (p_practice, btrim(p_question), p_fingerprint, case when p_topic ~ '^[a-z_]{2,30}$' then p_topic end)
  on conflict (practice, fingerprint) where status in ('waiting', 'by_people')
  do update set asked_count = l.asked_count + 1, last_asked_at = now(), updated_at = now()
  returning l.id into v_id;
  return v_id;
end;
$$;

comment on function vppsone.parent_helper_note_lesson(boolean, text, uuid, text, text, text) is
  'Veer Patta AI (D-589): used counts an answer given from a school answer; asked counts an open question again (by id, else by fingerprint) or lists it. Returns the lesson id, or null when nothing matched.';

revoke all on function vppsone.parent_helper_note_lesson(boolean, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function vppsone.parent_helper_note_lesson(boolean, text, uuid, text, text, text) to service_role;

commit;
