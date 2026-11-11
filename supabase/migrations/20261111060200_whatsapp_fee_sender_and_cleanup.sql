-- One and the Fees app kept apart on WhatsApp, and One keeps only what is its
-- own (owner, 11 Nov 2026: "keep both the apps separate", and "yes, fix them"
-- for the gaps found in the review of the school's WhatsApp hub). D-570, D-571.
--
--  * `whatsapp_fee_sender` in `runtime_flags`: who sends fee reminders,
--    receipts, reversal notices and fee statements to parents. `fees` = the
--    Fees app, from its own AiSensy number, and One refuses them
--    (platform/whatsapp/policy.ts FEES_APP_FEATURES). Only `one`, written on
--    the owner's word once the Fees app has stopped sending them, lets One.
--    Until this row exists One reads a missing row as `fees`, so applying it
--    changes nothing about what One sends.
--  * The copies One had made of messages that were not replies to One, and of
--    statuses for messages One never sent, are removed: the hub keeps the
--    originals in its own inbox.
--
-- The rest of the 11 Nov change (statuses, hourly template check) is
-- 20261111060151. This half deletes rows, so the Supabase connector asks the
-- owner to confirm it; apply it with `npx supabase db push --linked` or with
-- the owner present, then `git mv` this file to the recorded version.
--
-- Rollback:
--   delete from vppsone.runtime_flags where key = 'whatsapp_fee_sender';
--   (restore runtime_flags_key_known from 20261109062459.)

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------- who sends what

alter table vppsone.runtime_flags drop constraint if exists runtime_flags_key_known;
alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
  key in (
    'cover_command',
    'staff_notice_dispatch',
    'fault_injection',
    'parent_dispatch',
    'parent_dispatch_categories',
    'absent_notice_owner',
    'parent_dispatch_test_only',
    'staff_notice_kinds_enabled',
    'staff_whatsapp_month_cap',
    'staff_notice_student_names',
    'aisensy_month_plan_cap',
    'ai_connection',
    'whatsapp_dry_run',
    'whatsapp_features',
    'whatsapp_real_recipients',
    'whatsapp_owner_test_number',
    'whatsapp_daily_limit',
    'whatsapp_month_plan_cap',
    'whatsapp_fee_sender'
  )
);

insert into vppsone.runtime_flags (key, enabled, value, note) values
  ('whatsapp_fee_sender', true, '"fees"'::jsonb,
   'Who sends fee reminders, receipts, reversal notices and fee statements to parents. "fees" = the Fees app from its own number, and One refuses them. "one" only on the owner''s word, once the Fees app has stopped sending them.')
on conflict (key) do nothing;

-- --------------------------------------------- only what is One's, kept

delete from vppsone.whatsapp_message_events e
 where e.message_id is null and e.event = 'status';

-- A reply to One quotes a message One sent, or comes within 7 days after One
-- messaged that number (platform/whatsapp/store.ts isReplyToOne).
delete from vppsone.whatsapp_inbound i
 where i.reply_to_message_id is null
   and not exists (
     select 1 from vppsone.whatsapp_messages m
      where m.to_e164 = i.from_e164
        and m.provider_message_id is not null
        and m.created_at <= i.received_at
        and m.created_at >= i.received_at - interval '7 days'
   );

commit;
