/*
 * Needs you, for everyone (D-630..D-635).
 *
 * The owner (15 Nov 2026) asked for a Needs you that teachers, accountants,
 * the exam office and the admin all have: what is waiting, what is done, in
 * an order the AI helps arrange, with reminders. The jobs themselves are NOT
 * stored here. Each list is built, every time it is opened, from the records
 * the person's Today screen already reads (registers, covers, marks, tasks,
 * notices, the counter, the books), so a job is never "done" here while its
 * own screen says otherwise. This keeps only what those records do not know:
 *
 *   1. `needs_reminders`  a person's own to-do ("kal subah 9 baje ... phone
 *                         karna") and "remind me later" on a job of theirs.
 *   2. `needs_seen`       the jobs a person's list held each day, so a job
 *                         that has left the list can show under "Done today",
 *                         and the menu can count what is waiting without
 *                         building the whole list again.
 *   3. `needs_plans`      the order the AI suggested for a day's list, kept
 *                         so the AI is asked once per change, not per visit.
 *   4. `needs_sync(...)`  one call that records a fresh list and returns
 *                         what has left it today.
 *
 * Nothing here changes a register, a mark, a fee or a message: a job is done
 * on its own screen, and this only notices that it has gone. The AI is shown
 * kinds and numbers, never a name or a title (D-633). Service role only, like
 * every One write; the app checks the person first. Additive: three new
 * tables and one function, and no fee table is touched.
 */

begin;

/* -------------------------------------------- own to-dos and reminders */

create table vppsone.needs_reminders (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references vppsone.staff_profiles (id),
  session_label text not null,

  -- 'own': the person's own to-do, in their own words.
  -- 'snooze': "remind me later" on a job from their list, named by its key.
  kind text not null,
  item_key text,
  title text,
  -- The words the time was read from ("kal subah 9 baje"), said back to them.
  heard text,
  remind_at timestamptz,

  done_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint needs_reminders_kind_known check (kind in ('own', 'snooze')),
  constraint needs_reminders_session_sane check (char_length(session_label) between 4 and 40),
  constraint needs_reminders_own_has_title check (kind <> 'own' or char_length(btrim(coalesce(title, ''))) between 1 and 200),
  constraint needs_reminders_snooze_has_job check (kind <> 'snooze' or (item_key is not null and remind_at is not null)),
  constraint needs_reminders_key_sane check (item_key is null or char_length(item_key) between 1 and 160),
  constraint needs_reminders_heard_sane check (heard is null or char_length(heard) <= 200)
);

comment on table vppsone.needs_reminders is
  'Needs you (D-632): a person''s own to-do, or "remind me later" on a job of theirs. The job itself lives on its own screen; this only holds the person''s words and the time to bring it back.';

create index needs_reminders_open_idx
  on vppsone.needs_reminders (staff_profile_id, session_label, remind_at)
  where done_at is null and cancelled_at is null;

create trigger needs_reminders_set_updated_at
  before update on vppsone.needs_reminders
  for each row execute function vppsone.set_updated_at();

alter table vppsone.needs_reminders enable row level security;
revoke all on vppsone.needs_reminders from public, anon, authenticated;
grant all on vppsone.needs_reminders to service_role;

/* ------------------------------------------ what each day's list held */

create table vppsone.needs_seen (
  staff_profile_id uuid not null references vppsone.staff_profiles (id),
  session_label text not null,
  day date not null,
  item_key text not null,
  kind text not null,
  lane text not null,
  -- The job's name as the list said it, {"en": ..., "hi": ...}, for Done today.
  title jsonb not null,
  -- A job put off with "remind me later": when it comes back, so the menu's
  -- count includes it from then.
  wake_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when a complete read of the person's list no longer holds the job.
  done_at timestamptz,

  constraint needs_seen_pkey primary key (staff_profile_id, session_label, day, item_key),
  constraint needs_seen_session_sane check (char_length(session_label) between 4 and 40),
  constraint needs_seen_key_sane check (char_length(item_key) between 1 and 160),
  constraint needs_seen_kind_sane check (char_length(kind) between 1 and 40),
  constraint needs_seen_lane_known check (lane in ('now', 'today', 'later', 'waiting')),
  constraint needs_seen_title_object check (jsonb_typeof(title) = 'object')
);

comment on table vppsone.needs_seen is
  'Needs you (D-631): the jobs a person''s list held on a day. A job that a complete read no longer finds is marked done; it is never a record that the work itself was done, which only its own screen knows.';

alter table vppsone.needs_seen enable row level security;
revoke all on vppsone.needs_seen from public, anon, authenticated;
grant all on vppsone.needs_seen to service_role;

/* ------------------------------------------- the AI's order for a day */

create table vppsone.needs_plans (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references vppsone.staff_profiles (id),
  session_label text not null,
  day date not null,
  -- The jobs the order was made for (`needSignature`), so a changed list asks again.
  signature text not null,
  -- The jobs' keys, first to last. Empty when the AI gave no usable answer.
  item_order jsonb not null,
  -- key -> one word from NEED_REASONS ("late", "starts_soon", ...).
  reasons jsonb not null default '{}'::jsonb,
  -- 'ai': the AI's order. 'none': it was asked and gave nothing usable, kept
  -- so a failing AI is not asked again on every visit.
  source text not null,
  created_at timestamptz not null default now(),

  constraint needs_plans_session_sane check (char_length(session_label) between 4 and 40),
  constraint needs_plans_signature_sane check (char_length(signature) between 1 and 200),
  constraint needs_plans_order_array check (case when jsonb_typeof(item_order) = 'array' then jsonb_array_length(item_order) <= 60 else false end),
  constraint needs_plans_reasons_object check (jsonb_typeof(reasons) = 'object'),
  constraint needs_plans_source_known check (source in ('ai', 'none'))
);

comment on table vppsone.needs_plans is
  'Needs you (D-633): the order the AI suggested for a person''s list on a day, with a one-word reason per job. It was shown only job kinds and numbers. A suggestion: the app keeps a job that starts within 15 minutes first whatever it says.';

create index needs_plans_latest_idx
  on vppsone.needs_plans (staff_profile_id, session_label, day, created_at desc);

alter table vppsone.needs_plans enable row level security;
revoke all on vppsone.needs_plans from public, anon, authenticated;
grant all on vppsone.needs_plans to service_role;

/* --------------------------------------------------- one list, recorded */

/*
 * Record the jobs a person's list holds now, and return what has left it
 * today. `p_open` is the list: [{key, kind, lane, title: {en, hi}, wake_at}].
 * Only a COMPLETE read (`p_complete`, every source answered) may mark a job
 * done: a list missing a source because its read failed would otherwise
 * tick off every job in it.
 */
create function vppsone.needs_sync(
  p_staff uuid,
  p_session text,
  p_day date,
  p_open jsonb,
  p_complete boolean
)
returns table (seen_key text, seen_kind text, seen_lane text, seen_title jsonb, seen_done_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_staff is null or p_session is null or p_day is null then
    raise exception 'needs_sync: a person, a session and a day are required' using errcode = '22023';
  end if;
  if p_open is null or jsonb_typeof(p_open) <> 'array' then
    raise exception 'needs_sync: the list must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_open) > 200 then
    raise exception 'needs_sync: a list holds at most 200 jobs' using errcode = '22023';
  end if;

  insert into vppsone.needs_seen as s (staff_profile_id, session_label, day, item_key, kind, lane, title, wake_at)
  select distinct on (e.value ->> 'key')
         p_staff, p_session, p_day,
         e.value ->> 'key', e.value ->> 'kind', e.value ->> 'lane', e.value -> 'title',
         nullif(e.value ->> 'wake_at', '')::timestamptz
    from jsonb_array_elements(p_open) as e
   where jsonb_typeof(e.value) = 'object'
     and char_length(coalesce(e.value ->> 'key', '')) between 1 and 160
     and char_length(coalesce(e.value ->> 'kind', '')) between 1 and 40
     and coalesce(e.value ->> 'lane', '') in ('now', 'today', 'later', 'waiting')
     and jsonb_typeof(e.value -> 'title') = 'object'
   order by e.value ->> 'key'
  on conflict on constraint needs_seen_pkey do update
     set kind = excluded.kind,
         lane = excluded.lane,
         title = excluded.title,
         wake_at = excluded.wake_at,
         last_seen_at = now(),
         done_at = null;

  if p_complete then
    update vppsone.needs_seen as s
       set done_at = now()
     where s.staff_profile_id = p_staff
       and s.session_label = p_session
       and s.day = p_day
       and s.done_at is null
       and not exists (
             select 1
               from jsonb_array_elements(p_open) as e
              where jsonb_typeof(e.value) = 'object'
                and e.value ->> 'key' = s.item_key
           );
  end if;

  return query
    select s.item_key, s.kind, s.lane, s.title, s.done_at
      from vppsone.needs_seen as s
     where s.staff_profile_id = p_staff
       and s.session_label = p_session
       and s.day = p_day
       and s.done_at is not null
     order by s.done_at desc, s.item_key
     limit 50;
end;
$$;

comment on function vppsone.needs_sync(uuid, text, date, jsonb, boolean) is
  'Needs you (D-631): records the jobs a person''s list holds now and returns what has left it today. Marks a job done only on a complete read.';

revoke all on function vppsone.needs_sync(uuid, text, date, jsonb, boolean) from public, anon, authenticated;
grant execute on function vppsone.needs_sync(uuid, text, date, jsonb, boolean) to service_role;

commit;
