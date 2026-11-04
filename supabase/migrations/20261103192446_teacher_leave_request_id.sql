-- VPPS One — a retried leave request files once (MCP feasibility §10).
--
-- `requestLeaveVx` inserted `teacher_leave` rows with no idempotency key, so
-- a send whose answer was lost — a dropped connection, a phone that slept —
-- and was tapped again filed the same leave twice, and each row queued its
-- own office notice through `teacher_leave_staff_notices`.
--
-- The leave sheet now generates one id per submission and keeps it across
-- retries of that same submission. The server stores it here and, when the
-- id is already filed for that person, returns the original rows instead of
-- inserting (src/vx/screens/teach/actions.ts).
--
-- One submission is one row per run of school days, so the key is the id
-- *and* the run's first day: the runs of one request never share a
-- `from_day`. The person is in the key too, so an id is only ever matched
-- against that person's own requests.
--
-- Additive and backfill-safe: the column is nullable and nothing is
-- backfilled. Existing rows, and rows written by the office's own leave
-- screens, keep NULL, which the partial index leaves out.
--
-- Rollback:
--   drop index if exists vppsone.teacher_leave_request_once;
--   alter table vppsone.teacher_leave drop column if exists client_request_id;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.teacher_leave
  add column if not exists client_request_id uuid;

comment on column vppsone.teacher_leave.client_request_id is
  'The leave sheet''s id for one submission, kept across its retries. A repeat with the same id returns the rows already filed instead of filing again. NULL for rows from before it and from other screens.';

create unique index if not exists teacher_leave_request_once
  on vppsone.teacher_leave (staff_profile_id, client_request_id, from_day)
  where client_request_id is not null;

-- The app writes the column through PostgREST, which must see it at once.
notify pgrst, 'reload schema';

commit;
