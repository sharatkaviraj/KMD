-- Veer Patta AI, step 3c: a school visit booked on WhatsApp (D-592, D-593).
--
-- A family that wants a child admitted writes "admission" to the school's
-- number, picks a day and morning or afternoon, and types the child's name
-- and class. The office is told the way every hand-off tells it (Messages,
-- and WhatsApp between 6 am and 9 pm), and the visit shows on the Admissions
-- board as an enquiry with its day.
--
-- What this changes, in `vppsone`:
--
--  * `enquiries` gains the visit: `visit_on` and `visit_part` (morning or
--    afternoon, always together), `source` (`office`, which every row so far
--    reads, or `whatsapp`), and `parent_reply_id`, the hand-off a WhatsApp
--    enquiry came with: one enquiry per hand-off. The parent's own words stay
--    in the hand-off (`parent_replies`), as every hand-off's do.
--  * `parent_helper_chats.awaiting` may also read `visit:<yyyymmdd><am|pm>`:
--    after the parent picks a slot, the chat waits 30 minutes for the
--    child's name and class.
--
-- Additive for the data: no row changes, and existing enquiries read
-- source = 'office' with no visit.
--
-- Rollback:
--   update vppsone.parent_helper_chats set awaiting = null, awaiting_until = null where awaiting like 'visit:%';
--   alter table vppsone.parent_helper_chats drop constraint parent_helper_chats_awaiting_check;
--   alter table vppsone.parent_helper_chats add constraint parent_helper_chats_awaiting_check
--     check (awaiting is null or awaiting ~ '^(teacher:[a-z0-9]{4,16}|office)$');
--   alter table vppsone.enquiries drop column parent_reply_id, drop column source, drop column visit_part, drop column visit_on;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.enquiries
  add column visit_on date,
  add column visit_part text,
  add column source text not null default 'office',
  add column parent_reply_id uuid references vppsone.parent_replies(id) on delete set null,
  add constraint enquiries_visit_part_known check (visit_part is null or visit_part in ('morning', 'afternoon')),
  add constraint enquiries_visit_whole check ((visit_on is null) = (visit_part is null)),
  add constraint enquiries_source_known check (source in ('office', 'whatsapp')),
  add constraint enquiries_one_per_handoff unique (parent_reply_id);

comment on column vppsone.enquiries.visit_on is
  'The day the family asked to come and see the school (D-592), with visit_part; null when no visit was asked for.';
comment on column vppsone.enquiries.visit_part is
  'morning or afternoon: the office calls the family to fix the time.';
comment on column vppsone.enquiries.source is
  'office: typed in on the Admissions board. whatsapp: booked by the family with Veer Patta AI.';
comment on column vppsone.enquiries.parent_reply_id is
  'The hand-off the office was given for a WhatsApp booking, in One''s Messages inbox; it carries the parent''s own words.';

alter table vppsone.parent_helper_chats drop constraint parent_helper_chats_awaiting_check;
alter table vppsone.parent_helper_chats add constraint parent_helper_chats_awaiting_check
  check (awaiting is null or awaiting ~ '^(teacher:[a-z0-9]{4,16}|office|visit:[0-9]{8}(am|pm))$');

commit;
