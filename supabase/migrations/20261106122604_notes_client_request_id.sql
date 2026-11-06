-- VPPS One — a note saved twice files once (20-teacher school day, 6 Nov 2026).
--
-- `createNoteAction` inserted `notes` rows with no idempotency key. On a slow
-- day a save took 30-90 s; a teacher who left the screen while it said "Still
-- saving" came back to her draft ("not saved yet"), saved it again, and the
-- child got two identical notes, each with its own follow-up to the class
-- teacher. Six of ten teacher seats hit it in the smoke run.
--
-- The composer now gives every draft one id, keeps it in the stored draft and
-- sends it with every save of that draft. The server stores it here and, when
-- the id is already filed for that writer, returns the original note instead
-- of inserting (src/vx/screens/notes/actions.ts). Same shape as
-- `teacher_leave_request_once` (20261103192446).
--
-- Additive: the column is nullable and nothing is backfilled; the partial
-- index leaves out every existing row and every note written elsewhere.
--
-- Rollback:
--   drop index if exists vppsone.notes_request_once;
--   alter table vppsone.notes drop column if exists client_request_id;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.notes
  add column if not exists client_request_id uuid;

comment on column vppsone.notes.client_request_id is
  'The composer''s id for one draft, kept across its retries. A repeat save with the same id returns the note already filed instead of a second one. NULL for notes from before it and from other screens.';

create unique index if not exists notes_request_once
  on vppsone.notes (written_by, client_request_id)
  where client_request_id is not null;

notify pgrst, 'reload schema';

commit;
