-- See One as a chosen member of staff (D-520, owner request 7 Nov 2026: "as an
-- admin ... I should also have an access to see and select which teacher or
-- which academic coordinator ... and their real data can be shown to me, only
-- the admin").
--
-- The app draws every screen from the chosen person's own profile, role and
-- classes (src/platform/auth/view-as-subject.ts). Most screens read with the
-- service role and filter by that person's id, so they are already right.
-- What this migration adds is the rest: the reads that go through the
-- signed-in administrator's own session, where row level security decides
-- what comes back. Without it a teacher's Students list, seen by an
-- administrator, would show every child in the school instead of hers.
--
-- 1. vppsone.view_as_log: who looked as whom, when, and how it ended. A row
--    is also the grant: the database honours a "see as" request only while
--    the administrator holds an open, unexpired row for that person (two
--    hours, the same as the app's cookie).
--
-- 2. vppsone.view_as_subject_id(): the chosen person, or null. Non-null only
--    when ALL of these hold:
--      - the request carries the `x-vx-view-as` header (the app sets it from
--        its view-as cookie on the signed-in person's own client);
--      - the transaction is READ ONLY. PostgREST opens one for every GET and
--        for every stable function, and a read-only transaction cannot write
--        anything at all, so nothing can ever be saved under somebody else's
--        name. Every write runs read-write and is the administrator's own;
--        the app refuses those too while it is showing another person;
--      - auth.uid() is an active administrator holding an open, unexpired log
--        row for that person, who is active and not an administrator. A test
--        administrator may only look as a test account (a QA key never opens
--        a real person's screens); a real administrator may look as real
--        staff or as a practice account, whose screens show TEST data only.
--
-- 3. The row-security helpers follow it. current_staff_profile_id(),
--    reads_every_class(), staff_can(), staff_can_any() and
--    current_is_test_account() answer for the chosen person (my_class_keys(),
--    my_held_class_keys() and is_active_staff() already go through
--    current_staff_profile_id()). is_admin_staff() and is_real_admin() answer
--    false while showing another person, because that person is never an
--    administrator; so the test-session fence reads as it does for them. With
--    no header, every one of them gives exactly the answer it gave before.
--    my_permissions() is deliberately left alone: it is how the app reads the
--    signed-in administrator's own permissions. The fee schema's helpers are
--    not touched.
--
-- Rollback: re-run the seven helper bodies as they were (current_staff_profile_id,
-- reads_every_class, staff_can, staff_can_any from
-- 20261004031630_staff_authority_and_scoped_reads.sql; is_admin_staff from
-- 20261011090858_vx_sensitive_notes_scope.sql; is_real_admin and
-- current_is_test_account from 20261030155339_test_session_visibility.sql),
-- then drop function
-- vppsone.view_as_end(text), vppsone.view_as_begin(uuid),
-- vppsone.view_as_subject_id(); drop table vppsone.view_as_log.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create table if not exists vppsone.view_as_log (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid not null references vppsone.staff_profiles (id) on delete cascade,
  actor_user_id uuid not null,
  subject_staff_id uuid not null references vppsone.staff_profiles (id) on delete cascade,
  is_test boolean not null default false,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  ended_at timestamptz,
  end_reason text,
  constraint view_as_log_not_self check (actor_staff_id <> subject_staff_id),
  constraint view_as_log_end_reason check (end_reason is null or end_reason in ('back', 'switched', 'signed_out', 'expired')),
  constraint view_as_log_end_pair check ((ended_at is null) = (end_reason is null))
);
comment on table vppsone.view_as_log is
  'D-520: an administrator seeing One as another member of staff. An open, unexpired row is also the grant vppsone.view_as_subject_id() checks. Written only by view_as_begin() / view_as_end().';

create index if not exists view_as_log_open_idx
  on vppsone.view_as_log (actor_user_id, subject_staff_id)
  where ended_at is null;
create index if not exists view_as_log_started_idx
  on vppsone.view_as_log (started_at desc);

alter table vppsone.view_as_log enable row level security;
-- Read on the service role, after the app has checked the reader is an
-- administrator. Written only by the two functions below.
grant select on vppsone.view_as_log to service_role;

create or replace function vppsone.view_as_subject_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_headers text := current_setting('request.headers', true);
  v_raw text;
  v_subject uuid;
begin
  -- The common path: no header, no work.
  if v_headers is null or position('x-vx-view-as' in v_headers) = 0 then
    return null;
  end if;
  -- Only a read-only transaction may ever be drawn as somebody else.
  if current_setting('transaction_read_only', true) is distinct from 'on' then
    return null;
  end if;
  v_raw := v_headers::json ->> 'x-vx-view-as';
  if v_raw is null or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  select l.subject_staff_id into v_subject
  from vppsone.view_as_log l
  join vppsone.staff_profiles a on a.id = l.actor_staff_id
  join vppsone.staff_profiles s on s.id = l.subject_staff_id
  where l.actor_user_id = (select auth.uid())
    and l.subject_staff_id = v_raw::uuid
    and l.ended_at is null
    and l.expires_at > now()
    and a.user_id = l.actor_user_id
    and a.is_active
    and a.role = 'admin'
    and s.is_active
    and s.role <> 'admin'
    and (s.is_test_account or not a.is_test_account)
  order by l.started_at desc
  limit 1;
  return v_subject;
end;
$function$;
comment on function vppsone.view_as_subject_id() is
  'D-520: the member of staff an administrator is seeing One as, in a READ ONLY transaction carrying x-vx-view-as and backed by an open view_as_log row; else null.';
revoke all on function vppsone.view_as_subject_id() from public, anon, authenticated;
grant execute on function vppsone.view_as_subject_id() to service_role;

create or replace function vppsone.view_as_begin(p_subject uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor vppsone.staff_profiles%rowtype;
  v_subject vppsone.staff_profiles%rowtype;
  v_id uuid;
begin
  select * into v_actor from vppsone.staff_profiles sp
  where sp.user_id = (select auth.uid()) and sp.is_active;
  if v_actor.id is null or v_actor.role <> 'admin' then
    raise exception 'Only an administrator can see One as another person.' using errcode = '42501';
  end if;
  select * into v_subject from vppsone.staff_profiles sp where sp.id = p_subject;
  if v_subject.id is null or not v_subject.is_active then
    raise exception 'That person is not an active member of staff.' using errcode = '22023';
  end if;
  if v_subject.id = v_actor.id or v_subject.role = 'admin' then
    raise exception 'Choose a member of staff who is not an administrator.' using errcode = '22023';
  end if;
  if v_actor.is_test_account and not v_subject.is_test_account then
    raise exception 'A test account can only see One as another test account.' using errcode = '42501';
  end if;

  update vppsone.view_as_log
     set ended_at = least(now(), expires_at),
         end_reason = case when expires_at <= now() then 'expired' else 'switched' end
   where actor_user_id = v_actor.user_id and ended_at is null;

  insert into vppsone.view_as_log (actor_staff_id, actor_user_id, subject_staff_id, is_test)
  values (v_actor.id, v_actor.user_id, v_subject.id, v_subject.is_test_account)
  returning id into v_id;
  return v_id;
end;
$function$;
comment on function vppsone.view_as_begin(uuid) is
  'D-520: the signed-in administrator starts seeing One as p_subject (active, not an administrator; a test administrator only as a test account). Ends any view they had open. Two hours.';
revoke all on function vppsone.view_as_begin(uuid) from public, anon;
grant execute on function vppsone.view_as_begin(uuid) to authenticated, service_role;

create or replace function vppsone.view_as_end(p_reason text default 'back')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_reason is null or p_reason not in ('back', 'switched', 'signed_out') then
    raise exception 'Unknown reason for ending the view.' using errcode = '22023';
  end if;
  update vppsone.view_as_log
     set ended_at = least(now(), expires_at),
         end_reason = case when expires_at <= now() then 'expired' else p_reason end
   where actor_user_id = (select auth.uid()) and ended_at is null;
end;
$function$;
comment on function vppsone.view_as_end(text) is
  'D-520: the signed-in person stops seeing One as anybody else (back, switched or signed_out).';
revoke all on function vppsone.view_as_end(text) from public, anon;
grant execute on function vppsone.view_as_end(text) to authenticated, service_role;

-- The helpers. Each keeps its old answer when view_as_subject_id() is null.

create or replace function vppsone.current_staff_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    vppsone.view_as_subject_id(),
    (select sp.id from vppsone.staff_profiles sp
      where sp.user_id = (select auth.uid()) and sp.is_active)
  )
$function$;

create or replace function vppsone.reads_every_class()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from vppsone.staff_profiles sp
    where sp.id = vppsone.current_staff_profile_id() and sp.is_active
      and sp.role in ('admin', 'office', 'academic_coordinator', 'exam_coordinator')
  )
$function$;

create or replace function vppsone.staff_can(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = vppsone.current_staff_profile_id() and sp.is_active and rp.permission = p_permission
  )
$function$;

create or replace function vppsone.staff_can_any(p_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = vppsone.current_staff_profile_id() and sp.is_active and rp.permission = any (p_permissions)
  )
$function$;

create or replace function vppsone.current_is_test_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select sp.is_test_account from vppsone.staff_profiles sp
      where sp.id = vppsone.current_staff_profile_id() and sp.is_active),
    false
  )
$function$;

create or replace function vppsone.is_admin_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select vppsone.view_as_subject_id() is null and exists (
    select 1 from vppsone.staff_profiles sp
    where sp.user_id = (select auth.uid()) and sp.is_active and sp.role = 'admin'
  )
$function$;

create or replace function vppsone.is_real_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select vppsone.view_as_subject_id() is null and exists (
    select 1 from vppsone.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and sp.is_active
      and sp.role = 'admin'
      and not sp.is_test_account
  )
$function$;

commit;
