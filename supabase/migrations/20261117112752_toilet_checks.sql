-- Toilet checks (owner, 17 Nov 2026, D-652).
--
-- Janmejay: "I want to add a toilet maintenance module in which toilets will
-- be checked twice a day, maintenance chart will be printed, that chart will
-- be uploaded on the application."
--
-- The check itself happens on paper: One prints a weekly chart for each
-- toilet (Mon to Sat, a morning and an afternoon row per day), the person who
-- checks ticks it on the wall, and after the week somebody photographs the
-- sheet and uploads it here against that toilet and that week. While
-- uploading they tap only the boxes that were left empty on the paper, so
-- One can say which checks were missed without anybody typing the chart in.
--
--  * toilets:          the school's toilets, per session.
--  * toilet_settings:  the two check times and the tick list printed on the
--                      chart, per session (no row = One's defaults).
--  * toilet_charts:    one uploaded photo set for one toilet and one week,
--                      with the checks the uploader said were missed. A new
--                      upload for the same week replaces the old one, which
--                      stays (replaced_at), so nothing uploaded is lost.
--  * bucket toilet-charts: the photos, private, JPEG only, server only.
--
-- Session-labelled like everything else in One, so TEST-2026-27 has its own
-- toilets and charts and a test account never touches the real ones. Writes
-- are service role from server actions that check toilets:upload or
-- toilets:manage and the session first (assertSessionWritable); the
-- restrictive test_session_fence policies hold the PostgREST path as on the
-- other tables. Nothing is ever deleted: a toilet is removed with
-- removed_at, a wrong photo with removed_at, an old one with replaced_at.
-- Nothing here reads or writes the fee tables.
--
-- Rollback: take away vppsone.toilet_chart_store, the three tables and the
-- storage policy toilet_charts_server_only (the bucket can stay empty; the
-- role_permissions rows are the next migration).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

/* ---------------------------------------------------------------- toilets */

create table vppsone.toilets (
  id uuid primary key default gen_random_uuid(),
  session_label text not null check (session_label ~ '^(TEST-|UAT-|DEMO-)?[0-9]{4}-[0-9]{2}$'),
  name text not null check (length(btrim(name)) between 1 and 60),
  place text check (place is null or length(btrim(place)) between 1 and 60),
  used_by text not null default 'all' check (used_by in ('boys', 'girls', 'staff', 'all')),
  position smallint not null default 0 check (position between 0 and 999),
  removed_at timestamptz,
  created_by uuid references vppsone.staff_profiles(id) on delete set null,
  updated_by uuid references vppsone.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- What the charts' composite key points at, so a chart can only name a
  -- toilet of its own session.
  unique (id, session_label)
);
create unique index toilets_one_name on vppsone.toilets (session_label, lower(btrim(name))) where removed_at is null;
create index toilets_session on vppsone.toilets (session_label, position);
comment on table vppsone.toilets is
  'The school''s toilets, per session, for the twice-a-day checks (D-652). Removed with removed_at, never deleted.';

/* --------------------------------------------------------------- settings */

create table vppsone.toilet_settings (
  session_label text primary key check (session_label ~ '^(TEST-|UAT-|DEMO-)?[0-9]{4}-[0-9]{2}$'),
  morning_at time not null default '09:00',
  afternoon_at time not null default '13:00',
  -- [{ "en": "Floor clean", "hi": "फ़र्श साफ़" }, ...]; null prints One's own list.
  checklist jsonb check (
    checklist is null
    or (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) between 1 and 8)
  ),
  updated_by uuid references vppsone.staff_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (morning_at < afternoon_at)
);
comment on table vppsone.toilet_settings is
  'The two check times and the tick list printed on the toilet chart, per session (D-652). No row means One''s defaults.';

/* ----------------------------------------------------------------- charts */

create table vppsone.toilet_charts (
  -- The phone's own id for this upload, so a retried upload is the same row.
  id uuid primary key,
  session_label text not null check (session_label ~ '^(TEST-|UAT-|DEMO-)?[0-9]{4}-[0-9]{2}$'),
  toilet_id uuid not null,
  -- The Monday the chart's week starts on.
  week_start date not null check (extract(isodow from week_start) = 1),
  upload_state text not null default 'uploading' check (upload_state in ('uploading', 'stored')),
  pages text[] not null check (cardinality(pages) between 1 and 4),
  -- The checks left empty on the paper: [{ "day": "2026-11-17", "slot": "morning" }, ...]
  missed jsonb not null default '[]'::jsonb check (jsonb_typeof(missed) = 'array' and jsonb_array_length(missed) <= 14),
  note text check (note is null or length(note) <= 300),
  uploaded_by uuid references vppsone.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  stored_at timestamptz,
  -- A newer upload for the same toilet and week took its place.
  replaced_at timestamptz,
  replaced_by uuid,
  -- A wrong photo taken off by somebody with toilets:manage.
  removed_at timestamptz,
  removed_by uuid references vppsone.staff_profiles(id) on delete set null,
  foreign key (toilet_id, session_label) references vppsone.toilets (id, session_label)
);
create unique index toilet_charts_one_per_week on vppsone.toilet_charts (toilet_id, week_start)
  where upload_state = 'stored' and replaced_at is null and removed_at is null;
create index toilet_charts_session_week on vppsone.toilet_charts (session_label, week_start);
comment on table vppsone.toilet_charts is
  'A photographed weekly toilet chart for one toilet and one week, with the checks the uploader said were left empty (D-652).';

/* ------------------------------------------------------- the store writer */

-- Makes an uploaded chart the week's chart, in one transaction: checks the
-- missed list against the week, sets the older chart of the same toilet and
-- week aside (replaced_at), and marks this one stored. The app has already
-- checked the photos' bytes. Saying it twice is harmless.
create function vppsone.toilet_chart_store(
  p_id uuid,
  p_session text,
  p_actor uuid,
  p_missed jsonb,
  p_note text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row vppsone.toilet_charts%rowtype;
  v_missed jsonb := coalesce(p_missed, '[]'::jsonb);
  v_now timestamptz := clock_timestamp();
begin
  select * into v_row from vppsone.toilet_charts
   where id = p_id and session_label = p_session
   for update;
  if not found then raise exception 'toilets:not_found'; end if;
  if v_row.uploaded_by is distinct from p_actor then raise exception 'toilets:not_found'; end if;
  if v_row.removed_at is not null then raise exception 'toilets:not_found'; end if;
  if v_row.upload_state = 'stored' then
    return jsonb_build_object('id', v_row.id, 'storedAt', v_row.stored_at, 'again', true);
  end if;

  if jsonb_typeof(v_missed) <> 'array' or jsonb_array_length(v_missed) > 14 then
    raise exception 'toilets:bad_request';
  end if;
  if exists (
       select 1 from jsonb_array_elements(v_missed) m
        where jsonb_typeof(m) <> 'object'
           or coalesce(m->>'slot', '') not in ('morning', 'afternoon')
           or coalesce(m->>'day', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     ) then
    raise exception 'toilets:bad_request';
  end if;
  if exists (
       select 1 from jsonb_array_elements(v_missed) m
        where (m->>'day')::date not between v_row.week_start and v_row.week_start + 5
     ) then
    raise exception 'toilets:bad_request';
  end if;
  if (select count(distinct (m->>'day') || (m->>'slot')) from jsonb_array_elements(v_missed) m) <> jsonb_array_length(v_missed) then
    raise exception 'toilets:bad_request';
  end if;
  if p_note is not null and length(p_note) > 300 then raise exception 'toilets:bad_request'; end if;
  if not exists (
       select 1 from vppsone.toilets t
        where t.id = v_row.toilet_id and t.session_label = p_session and t.removed_at is null
     ) then
    raise exception 'toilets:not_found';
  end if;

  update vppsone.toilet_charts
     set replaced_at = v_now, replaced_by = p_id
   where toilet_id = v_row.toilet_id and week_start = v_row.week_start and id <> p_id
     and upload_state = 'stored' and replaced_at is null and removed_at is null;

  update vppsone.toilet_charts
     set upload_state = 'stored', stored_at = v_now,
         missed = (select coalesce(jsonb_agg(jsonb_build_object('day', m->>'day', 'slot', m->>'slot') order by m->>'day', m->>'slot'), '[]'::jsonb)
                     from jsonb_array_elements(v_missed) m),
         note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  return jsonb_build_object('id', p_id, 'storedAt', v_now, 'again', false);
end;
$$;
revoke all on function vppsone.toilet_chart_store(uuid, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function vppsone.toilet_chart_store(uuid, text, uuid, jsonb, text) to service_role;

/* ---------------------------------------------------- access and the fence */

alter table vppsone.toilets enable row level security;
alter table vppsone.toilet_settings enable row level security;
alter table vppsone.toilet_charts enable row level security;

revoke all on vppsone.toilets, vppsone.toilet_settings, vppsone.toilet_charts from anon, authenticated;
grant all on vppsone.toilets, vppsone.toilet_settings, vppsone.toilet_charts to service_role;

create policy test_session_fence on vppsone.toilets as restrictive for all to authenticated
  using ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()))
  with check ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()));
create policy test_session_fence on vppsone.toilet_settings as restrictive for all to authenticated
  using ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()))
  with check ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()));
create policy test_session_fence on vppsone.toilet_charts as restrictive for all to authenticated
  using ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()))
  with check ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()));

/* ------------------------------------------------------------------ photos */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('toilet-charts', 'toilet-charts', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Restrictive so an unrelated, broad permissive storage policy cannot expose
-- this bucket. The service role bypasses RLS, including for signed uploads.
create policy toilet_charts_server_only on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'toilet-charts') with check (bucket_id <> 'toilet-charts');

/* ------------------------------------------------------------ permissions */

-- The role_permissions rows for toilets:* are in 20261117112806_toilet_role_permissions.sql.

commit;
