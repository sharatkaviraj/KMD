-- Veer Patta AI, step 3d (D-594, D-595): parents' files and old chats in the
-- school's Shared Drive.
--
-- Two pg_cron jobs. Both call One's /api/jobs/parent-files with the WhatsApp
-- queue's Bearer secret (Vault: WHATSAPP_QUEUE_CRON_SECRET), the same door as
-- the parent-helper job, and the route checks it in Postgres
-- (whatsapp_queue_secret_matches):
--
--   parent-files            every hour at :17, and only while Veer Patta AI
--                           is switched on (whatsapp_features.parent_helper).
--                           The sweep: parents' photos, voice notes, videos
--                           and documents that the copy started by each
--                           message missed. In practice, only the owner's own
--                           number; the hub's own test mode also holds back
--                           everybody else's files.
--   whatsapp-chat-archive   every day at 21:40 UTC (03:10 in India). Asks the
--                           hub whether a month of chats is due to leave it
--                           (older than six months, or sooner when its free
--                           database passes 40%), writes that month to Drive
--                           as one spreadsheet, and only then lets the hub
--                           remove it. Most days the hub says nothing is due.
--
-- No table, column, grant or policy changes. The files and the chats are
-- never written to One's database (D-576); their Drive folders are rows in
-- vppsone.drive_folders under the keys 'wa-files…' and 'wa-chats', the way
-- the nightly backup keeps '_backups'.
--
-- Rollback:
--   select cron.unschedule('parent-files');
--   select cron.unschedule('whatsapp-chat-archive');

begin;

select cron.schedule(
  'parent-files',
  '17 * * * *',
  $job$
  select net.http_post(
    url := 'https://one.vpps.co.in/api/jobs/parent-files',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'WHATSAPP_QUEUE_CRON_SECRET')
    ),
    body := '{"part": "files"}'::jsonb,
    timeout_milliseconds := 290000
  )
  where exists (
    select 1 from vppsone.runtime_flags f
     where f.key = 'whatsapp_features'
       and f.enabled is true
       and f.value -> 'parent_helper' = 'true'::jsonb
  );
  $job$
);

select cron.schedule(
  'whatsapp-chat-archive',
  '40 21 * * *',
  $job$
  select net.http_post(
    url := 'https://one.vpps.co.in/api/jobs/parent-files',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'WHATSAPP_QUEUE_CRON_SECRET')
    ),
    body := '{"part": "archive"}'::jsonb,
    timeout_milliseconds := 290000
  );
  $job$
);

commit;
