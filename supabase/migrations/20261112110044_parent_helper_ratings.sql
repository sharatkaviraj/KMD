-- Veer Patta AI, step 2b: "Did this answer help?" (D-584).
--
-- After a teacher's or the office's answer reaches a parent (D-578), the
-- helper asks once, on two buttons: "Yes, it helped" and "No". A "no" goes
-- to the school office with what the parent asked and the answer that did
-- not help, as a new message in One's Messages and a new hand-off for the
-- office. It is handled as a complaint: a reminder after 3 hours, and an
-- admin is told when it is still unanswered a day later. The office's answer
-- to it is never rated again, so a "no" cannot go round in circles.
--
-- What this adds, to `vppsone.parent_helper_handoffs` only (service role
-- only, as the table already is). Every column is new and empty, so the
-- code that runs today does not notice it:
--
--  * `rating_asked_at`: when the parent was asked. Set by the one run that
--    sends the question, so it is asked once per hand-off.
--  * `rating`, `rated_at`: the parent's tap, `helped` or `not_helped`. A "no"
--    may replace a "yes" (a wrong tap put right); a "yes" never replaces a
--    "no", because the office already has it.
--  * `follow_up_of`: on the office's hand-off for a "no", the hand-off whose
--    answer did not help. At most one each (a unique index), so a second
--    tap never tells the office twice.
--
-- Nothing is stored that is not already in One: the parent's words stay in
-- `parent_replies` and the answers in `parent_reply_answers`, as before.
--
-- Rollback (by hand, never needed by the code that runs today):
--   alter table vppsone.parent_helper_handoffs
--     drop constraint if exists parent_helper_handoffs_rating_known,
--     drop constraint if exists parent_helper_handoffs_rating_together,
--     drop constraint if exists parent_helper_handoffs_follow_up_not_self,
--     drop constraint if exists parent_helper_handoffs_follow_up_not_rated,
--     drop column if exists follow_up_of,
--     drop column if exists rated_at,
--     drop column if exists rating,
--     drop column if exists rating_asked_at;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.parent_helper_handoffs
  add column rating_asked_at timestamptz,
  add column rating text,
  add column rated_at timestamptz,
  add column follow_up_of uuid references vppsone.parent_helper_handoffs(id) on delete set null,
  add constraint parent_helper_handoffs_rating_known check (rating is null or rating in ('helped', 'not_helped')),
  add constraint parent_helper_handoffs_rating_together check ((rating is null) = (rated_at is null)),
  add constraint parent_helper_handoffs_follow_up_not_self check (follow_up_of is null or follow_up_of <> id),
  add constraint parent_helper_handoffs_follow_up_not_rated check (follow_up_of is null or (rating is null and rating_asked_at is null));

comment on column vppsone.parent_helper_handoffs.rating_asked_at is
  'Veer Patta AI (D-584): when the parent was asked "Did this answer help?". Asked once per hand-off, never on the office''s hand-off for a "no".';
comment on column vppsone.parent_helper_handoffs.rating is
  'Veer Patta AI (D-584): the parent''s tap on "Did this answer help?": helped or not_helped. A "no" may replace a "yes"; a "yes" never replaces a "no".';
comment on column vppsone.parent_helper_handoffs.rated_at is
  'Veer Patta AI (D-584): when the rating was kept.';
comment on column vppsone.parent_helper_handoffs.follow_up_of is
  'Veer Patta AI (D-584): on the school office''s hand-off for a "no", the hand-off whose answer did not help. At most one each.';

create unique index parent_helper_handoffs_one_follow_up on vppsone.parent_helper_handoffs (follow_up_of)
  where follow_up_of is not null;

commit;
