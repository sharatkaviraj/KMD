-- Chats with parents, part two (D-617): passing a chat to the desk it belongs
-- to, and the class teachers a chat can go to.
--
-- Veer Patta AI puts each passed-on message at a desk by its topic, and a
-- topic can be wrong: a fee question in a class teacher's chat, a leave note
-- at the accounts desk. Whoever may answer a chat can pass it on, with a line
-- only staff read ("please check the receipt"). The chat then waits at its new
-- desk and that desk is told at once, as for any new message.
--
-- A family has one chat per desk, so a chat passed to a desk where the family
-- already has one joins it: every message moves across in time order, the
-- wait carries over, and the old chat closes with `merged_into` pointing at
-- the one it joined (a screen or a one-tap link to it opens the joined chat).
-- If that desk is wanted again later, the old row starts afresh.
--
-- What this adds, all in `vppsone`, service role only:
--
--  * `parent_chats.merged_into`: the chat this one joined, when it did.
--  * `parent_chat_open`: unchanged, except that it clears `merged_into` when
--    a message reopens a chat that had joined another.
--  * `parent_chat_class_teachers(chat)`: each child's class teacher today, of
--    the chat's own kind (test accounts for a practice chat, real staff for a
--    real one: the owner's rule, 8 Nov 2026), for the "Pass to" choices.
--    It reads the roster (`public.students`, `public.classes`); it writes
--    nothing there.
--  * `parent_chat_pass(...)`: the move, or the join, in one transaction.
--  * An index on `parent_chat_messages.parent_reply_id`, so Messages can find
--    the chat a parent's message went into.
--
-- Nothing here sends anything. Rollback: restore the previous body of
-- `parent_chat_open` (in 20261115034215), then remove the two new functions,
-- the index and the column.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.parent_chats
  add column if not exists merged_into uuid references vppsone.parent_chats(id) on delete set null;

comment on column vppsone.parent_chats.merged_into is
  'Chats with parents (D-617): the chat this one joined when it was passed to a desk where the family already had one. Null otherwise.';

create index if not exists parent_chat_messages_reply
  on vppsone.parent_chat_messages (parent_reply_id) where parent_reply_id is not null;

-- As before (20261115034215), and a chat that had joined another starts afresh.
create or replace function vppsone.parent_chat_open(
  p_parent text,
  p_desk text,
  p_class_teacher uuid,
  p_practice boolean,
  p_session text,
  p_from_name text,
  p_student_ids uuid[],
  p_student_label text,
  p_language text
)
returns uuid
language sql
volatile
set search_path = ''
as $$
  insert into vppsone.parent_chats as c (
    parent_e164, desk, class_teacher_id, practice, session_label, from_name, student_ids, student_label, language
  ) values (
    p_parent,
    p_desk,
    case when p_desk = 'class' then p_class_teacher end,
    coalesce(p_practice, false),
    p_session,
    coalesce(nullif(btrim(left(coalesce(p_from_name, ''), 120)), ''), 'Parent'),
    coalesce(p_student_ids[1:8], '{}'::uuid[]),
    nullif(btrim(left(coalesce(p_student_label, ''), 200)), ''),
    coalesce(p_language, 'hi')
  )
  on conflict (parent_e164, desk, class_teacher_id, practice) do update set
    from_name = case when excluded.from_name <> 'Parent' then excluded.from_name else c.from_name end,
    student_ids = (
      select coalesce(array_agg(s.id order by s.first_at), '{}'::uuid[])
        from (
          select u.id, min(u.n) as first_at
            from unnest(c.student_ids || excluded.student_ids) with ordinality as u(id, n)
           group by u.id
           order by min(u.n)
           limit 8
        ) s
    ),
    student_label = coalesce(excluded.student_label, c.student_label),
    language = excluded.language,
    session_label = excluded.session_label,
    merged_into = null,
    updated_at = now()
  returning c.id;
$$;

-- Each child's class teacher today, of the chat's own kind, in the chat's order.
create or replace function vppsone.parent_chat_class_teachers(p_chat uuid)
returns table (student_id uuid, staff_id uuid, staff_name text)
language sql
stable
set search_path = ''
as $$
  select t.student_id, t.staff_id, t.staff_name
    from (
      select distinct on (s.id)
             s.id as student_id,
             sp.id as staff_id,
             sp.display_name as staff_name,
             u.n as n
        from vppsone.parent_chats pc
        cross join lateral unnest(pc.student_ids) with ordinality as u(id, n)
        join public.students s on s.id = u.id
        join public.classes cl on cl.id = s.class_id
        join vppsone.class_teachers ct
          on ct.class_id = cl.id
         and ct.session_label = cl.session_label
         and ct.role = 'class_teacher'
        join vppsone.staff_profiles sp on sp.id = ct.staff_profile_id and sp.is_active
       where pc.id = p_chat
         and (ct.effective_from is null or ct.effective_from <= vppsone.school_today())
         and (ct.effective_to is null or ct.effective_to >= vppsone.school_today())
         and coalesce(sp.is_test_account, false) = pc.practice
       order by s.id, ct.effective_from desc nulls last
    ) t
   order by t.n;
$$;

comment on function vppsone.parent_chat_class_teachers(uuid) is
  'Chats with parents (D-617): each child''s class teacher today, test accounts for a practice chat and real staff for a real one.';

-- Pass a chat to another desk: move it, or join the family's chat already
-- there. Returns the chat it now lives in; null when there is no such chat or
-- it had already joined another. A line only staff read says who passed it.
create or replace function vppsone.parent_chat_pass(
  p_chat uuid,
  p_desk text,
  p_class_teacher uuid,
  p_wants_admin boolean,
  p_by uuid,
  p_by_name text,
  p_note text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_src vppsone.parent_chats%rowtype;
  v_dst vppsone.parent_chats%rowtype;
  v_teacher uuid := case when p_desk = 'class' then p_class_teacher end;
  v_wants boolean := p_desk = 'admin' and coalesce(p_wants_admin, false);
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_into uuid;
begin
  if p_desk is null or p_desk not in ('class', 'accounts', 'admin') then
    raise exception 'parent_chat_pass: unknown desk' using errcode = '22023';
  end if;
  if p_desk = 'class' and v_teacher is null then
    raise exception 'parent_chat_pass: the class desk needs its teacher' using errcode = '22023';
  end if;

  select * into v_src from vppsone.parent_chats where id = p_chat for update;
  if not found or v_src.merged_into is not null then
    return null;
  end if;

  -- Already at that desk: only a wish for the principal can be added.
  if v_src.desk = p_desk and v_src.class_teacher_id is not distinct from v_teacher then
    if v_wants and not v_src.wants_admin then
      update vppsone.parent_chats c set wants_admin = true, updated_at = now() where c.id = v_src.id;
    end if;
    return v_src.id;
  end if;

  select * into v_dst
    from vppsone.parent_chats d
   where d.parent_e164 = v_src.parent_e164
     and d.desk = p_desk
     and d.class_teacher_id is not distinct from v_teacher
     and d.practice = v_src.practice
     and d.id <> v_src.id
   for update;

  if not found then
    -- The chat moves. A waiting chat is the new desk's to answer, now.
    update vppsone.parent_chats c set
      desk = p_desk,
      class_teacher_id = v_teacher,
      wants_admin = v_wants or (p_desk = 'admin' and c.wants_admin),
      taken_by = null,
      taken_at = null,
      passed_up_at = null,
      nudged_at = null,
      reminded_at = null,
      nudge_step = case when c.status = 'waiting' then 'first' end,
      next_nudge_at = case when c.status = 'waiting' then v_now end,
      updated_at = now()
    where c.id = v_src.id;
    v_into := v_src.id;
  else
    -- The family already has a chat at that desk: every message joins it.
    update vppsone.parent_chat_messages m set chat_id = v_dst.id where m.chat_id = v_src.id;

    v_status := case
      when v_src.status = 'waiting' or v_dst.status = 'waiting' then 'waiting'
      when v_src.status = 'done' and v_dst.status = 'done' then 'done'
      else 'open'
    end;

    update vppsone.parent_chats d set
      student_ids = (
        select coalesce(array_agg(s.id order by s.first_at), '{}'::uuid[])
          from (
            select u.id, min(u.n) as first_at
              from unnest(d.student_ids || v_src.student_ids) with ordinality as u(id, n)
             group by u.id
             order by min(u.n)
             limit 8
          ) s
      ),
      student_label = coalesce(d.student_label, v_src.student_label),
      topic = coalesce(v_src.topic, d.topic),
      complaint = d.complaint or v_src.complaint,
      wants_admin = p_desk = 'admin' and (d.wants_admin or v_src.wants_admin or v_wants),
      status = v_status,
      waiting_since = case when v_status = 'waiting' then least(
        case when d.status = 'waiting' then d.waiting_since end,
        case when v_src.status = 'waiting' then v_src.waiting_since end
      ) end,
      nudge_step = case when v_status = 'waiting' then 'first' end,
      next_nudge_at = case when v_status = 'waiting' then v_now end,
      nudged_at = null,
      reminded_at = null,
      passed_up_at = null,
      live_until = greatest(d.live_until, v_src.live_until),
      last_parent_at = greatest(d.last_parent_at, v_src.last_parent_at),
      last_staff_at = greatest(d.last_staff_at, v_src.last_staff_at),
      last_message_at = greatest(d.last_message_at, v_src.last_message_at),
      last_preview = case when v_src.last_message_at > d.last_message_at then v_src.last_preview else d.last_preview end,
      last_direction = case when v_src.last_message_at > d.last_message_at then v_src.last_direction else d.last_direction end,
      done_at = case when v_status = 'done' then d.done_at end,
      done_by = case when v_status = 'done' then d.done_by end,
      updated_at = now()
    where d.id = v_dst.id;

    update vppsone.parent_chats c set
      status = 'done',
      waiting_since = null,
      nudge_step = null,
      next_nudge_at = null,
      live_until = null,
      taken_by = null,
      taken_at = null,
      done_at = now(),
      done_by = p_by,
      merged_into = v_dst.id,
      updated_at = now()
    where c.id = v_src.id;
    v_into := v_dst.id;
  end if;

  insert into vppsone.parent_chat_messages (chat_id, direction, kind, body, meta, staff_id, staff_name, status, at)
  values (
    v_into,
    'note',
    'event',
    nullif(btrim(left(coalesce(p_note, ''), 500)), ''),
    jsonb_build_object(
      'event', 'passed',
      'from', v_src.desk,
      'to', p_desk,
      'from_teacher', v_src.class_teacher_id,
      'to_teacher', v_teacher,
      'joined', v_into <> v_src.id
    ),
    p_by,
    nullif(left(coalesce(p_by_name, ''), 80), ''),
    'received',
    v_now
  );

  return v_into;
end;
$$;

comment on function vppsone.parent_chat_pass(uuid, text, uuid, boolean, uuid, text, text) is
  'Chats with parents (D-617): pass a chat to another desk, moving it or joining the family''s chat there. Returns where it now lives.';

revoke all on function vppsone.parent_chat_class_teachers(uuid) from public, anon, authenticated;
revoke all on function vppsone.parent_chat_pass(uuid, text, uuid, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function vppsone.parent_chat_class_teachers(uuid) to service_role;
grant execute on function vppsone.parent_chat_pass(uuid, text, uuid, boolean, uuid, text, text) to service_role;

commit;
