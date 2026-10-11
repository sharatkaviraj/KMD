-- Sending by hand from Messages → To send.
--
-- Nothing here sends. A person opens their own WhatsApp from the queue with
-- the text filled in (wa.me), presses send there, and the row is marked sent
-- by them (D-10, RULES H). These columns are what that needs:
--
-- * parent_message_queue rows (teacher notes, absent alerts) can now be
--   `sent`, with who and when;
-- * a fee reminder batch and a calendar notice are turned into one message
--   per family when a person prepares them, and remember which campaign that
--   made, so it is never prepared twice.

alter table vppsone.parent_message_queue
  drop constraint if exists parent_message_queue_status_known;
alter table vppsone.parent_message_queue
  add constraint parent_message_queue_status_known check (status in ('queued', 'sent', 'cancelled'));
alter table vppsone.parent_message_queue
  add column if not exists sent_at timestamptz,
  add column if not exists sent_by uuid references vppsone.staff_profiles (id) on delete set null;
alter table vppsone.parent_message_queue
  add constraint parent_message_queue_sent_together check ((status = 'sent') = (sent_at is not null));

comment on table vppsone.parent_message_queue is
  'Messages to parents a teacher asked for. Nothing in VPPS One sends these: a person opens WhatsApp from Messages → To send, sends it, and it is marked sent by them (RULES H; CLAUDE.md rule 8).';

alter table vppsone.fee_reminder_batches
  drop constraint if exists fee_reminder_batches_status_known;
alter table vppsone.fee_reminder_batches
  add constraint fee_reminder_batches_status_known check (status in ('queued', 'scheduled', 'prepared', 'cancelled'));
alter table vppsone.fee_reminder_batches
  add column if not exists campaign_id uuid references vppsone.message_campaigns (id) on delete set null,
  add column if not exists prepared_by uuid references vppsone.staff_profiles (id) on delete set null,
  add column if not exists prepared_at timestamptz;

comment on table vppsone.fee_reminder_batches is
  'A fee reminder batch prepared on /reminders. Nothing sends it: preparing it makes one message per family in Messages → To send, which a person sends by hand (CLAUDE.md rule 8).';

alter table vppsone.calendar_notices
  add column if not exists campaign_id uuid references vppsone.message_campaigns (id) on delete set null,
  add column if not exists decided_by uuid references vppsone.staff_profiles (id) on delete set null,
  add column if not exists decided_at timestamptz;

comment on table vppsone.calendar_notices is
  'A parent or staff notice about a calendar event or holiday. Approving it in Messages → To send makes one message per family or colleague, which a person sends by hand; nothing is sent from here.';
