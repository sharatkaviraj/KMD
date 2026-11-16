-- Chats with parents, part three (D-645): a chat finishes by itself.
--
-- Teachers forget to tap Finished. A chat then stays in their list for good,
-- and a parent's "Ok sir, thank you for telling" after the school's answer
-- made the chat wait again: a WhatsApp to the teacher after two minutes,
-- another after three hours, and after a day the admins were told nobody had
-- answered. Nobody owed that parent anything.
--
-- The app now finishes a chat when the parent only says thanks after the
-- school's answer (its word list, or Veer Patta AI's quick read of a few
-- words). This file adds what that needs, and the third way: a chat the
-- school answered that has been quiet for twelve hours finishes by itself.
-- A chat where a parent is waiting is never closed this way, nor one whose
-- answer from school is still waiting to reach the parent. When the parent
-- writes again the chat opens again, as before (`parent_chat_append`).
--
-- What this adds, all in `vppsone`, service role only:
--
--  * `parent_chats.done_reason`: why a chat finished without a person,
--    `thanks` or `quiet`; null when a person finished it. The app reads it
--    only while the chat is finished.
--  * `parent_chat_settings.finish_by_itself` (on) and `quiet_hours` (12),
--    so the switch and the hours change without new code.
--  * `parent_chat_close_quiet(limit)`: finishes the quiet chats, gives a chat
--    an admin took over and never handed back to its desk again (finished or
--    not), and writes a line only staff read ("Finished by itself: quiet for
--    12 hours", "Back with its desk by itself").
--  * A pg_cron job, `parent-chats-quiet`, every ten minutes. It sends nothing
--    and calls nothing outside the database.
--
-- Rollback: unschedule `parent-chats-quiet`, then remove the function and the
-- three columns. Nothing else changes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.parent_chats
  add column if not exists done_reason text
    check (done_reason is null or done_reason in ('thanks', 'quiet'));

comment on column vppsone.parent_chats.done_reason is
  'Chats with parents (D-645): why the chat finished without a person tapping Finished (thanks: the parent only thanked the school; quiet: nobody wrote for quiet_hours). Null when a person finished it. Read only while status is done.';

alter table vppsone.parent_chat_settings
  add column if not exists finish_by_itself boolean not null default true,
  add column if not exists quiet_hours integer not null default 12 check (quiet_hours between 1 and 72);

comment on column vppsone.parent_chat_settings.finish_by_itself is
  'Chats with parents (D-645): a chat the school answered finishes by itself when the parent only says thanks, or after quiet_hours with nobody writing.';
comment on column vppsone.parent_chat_settings.quiet_hours is
  'Chats with parents (D-645): hours without a message after which an answered chat finishes by itself.';

-- The quiet chats: answered (open, not waiting), not joined to another, no
-- message for `quiet_hours`, nobody answering right now, and nothing from
-- school still waiting for the parent. Each is finished once, with a line in
-- the chat; a take-over ends with it.
create or replace function vppsone.parent_chat_close_quiet(p_limit integer default 200)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_on boolean;
  v_hours integer;
  v_count integer := 0;
begin
  select s.enabled and s.finish_by_itself, s.quiet_hours
    into v_on, v_hours
    from vppsone.parent_chat_settings s
   where s.id = 1;
  if not coalesce(v_on, false) then
    return 0;
  end if;
  v_hours := coalesce(v_hours, 12);

  with due as (
    select c.id, c.taken_by
      from vppsone.parent_chats c
     where c.status = 'open'
       and c.merged_into is null
       and c.last_message_at < now() - make_interval(hours => v_hours)
       and (c.live_until is null or c.live_until < now())
       and not exists (
         select 1 from vppsone.parent_chat_messages m
          where m.chat_id = c.id and m.status = 'waiting'
       )
     order by c.last_message_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update of c skip locked
  ),
  closed as (
    update vppsone.parent_chats c set
      status = 'done',
      waiting_since = null,
      nudge_step = null,
      next_nudge_at = null,
      live_until = null,
      taken_by = null,
      taken_at = null,
      done_at = now(),
      done_by = null,
      done_reason = 'quiet',
      updated_at = now()
      from due
     where c.id = due.id
       and c.status = 'open'
    returning c.id, due.taken_by as was_taken
  ),
  noted as (
    insert into vppsone.parent_chat_messages (chat_id, direction, kind, body, meta, status, at)
    select closed.id, 'note', 'event', null,
           jsonb_build_object('event', 'finished_itself', 'reason', 'quiet', 'hours', v_hours, 'handed_back', closed.was_taken is not null),
           'received', now()
      from closed
    returning 1
  )
  select count(*) into v_count from noted;

  -- A finished chat an admin took over and never handed back: after the same
  -- quiet hours its desk has it again, so the parent's next message is theirs.
  with released as (
    update vppsone.parent_chats c set
      taken_by = null,
      taken_at = null,
      updated_at = now()
     where c.id in (
       select d.id
         from vppsone.parent_chats d
        where d.status = 'done'
          and d.taken_by is not null
          and d.merged_into is null
          and d.last_message_at < now() - make_interval(hours => v_hours)
          and (d.live_until is null or d.live_until < now())
        order by d.last_message_at
        limit greatest(1, least(coalesce(p_limit, 200), 1000))
        for update skip locked
     )
     and c.status = 'done'
    returning c.id
  ),
  noted_back as (
    insert into vppsone.parent_chat_messages (chat_id, direction, kind, body, meta, status, at)
    select released.id, 'note', 'event', null,
           jsonb_build_object('event', 'handed_back_itself', 'hours', v_hours),
           'received', now()
      from released
    returning 1
  )
  select v_count + count(*) into v_count from noted_back;

  return v_count;
end;
$$;

comment on function vppsone.parent_chat_close_quiet(integer) is
  'Chats with parents (D-645): finish the answered chats nobody has written in for quiet_hours, hand a forgotten take-over of a quiet chat back to its desk, and note each in the chat. Never a waiting chat, never one with a message still waiting for the parent. Sends nothing.';

revoke all on function vppsone.parent_chat_close_quiet(integer) from public, anon, authenticated;
grant execute on function vppsone.parent_chat_close_quiet(integer) to service_role;

-- Every ten minutes, inside the database: no request, no WhatsApp.
select cron.schedule(
  'parent-chats-quiet',
  '*/10 * * * *',
  $job$select vppsone.parent_chat_close_quiet(200);$job$
);

commit;
