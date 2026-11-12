-- Sign in with a WhatsApp code (D-584).
--
-- The sign-in page asks for a mobile number. If that number is on exactly one
-- active member of staff's record (their WhatsApp number, or their phone when
-- no WhatsApp number is on file), One sends a six-digit code to it on
-- WhatsApp from the school's number, through the school's hub, and the
-- person types it back. Email and password stay as the other way in.
--
-- What makes it safe:
--
--  * The page answers the same whichever number is typed: "if this number is
--    on a staff record, a code is on its way". Nobody learns from it whose
--    number is on file. A number on no record, a number on two records, and a
--    number the current setting does not allow all get a row here with no
--    code, so even the limits below count them the same.
--  * A code is good for 10 minutes, once, and five wrong tries end it. Only
--    the newest code for a number works.
--  * At most 3 codes per number in 15 minutes and 10 a day, 30 seconds apart;
--    at most 8 asks from one browser address in 15 minutes and 30 a day; and
--    120 codes an hour for the whole school, so a fault cannot run up Meta's
--    bill (about 14 paise a code).
--  * The code itself is never stored: the app keeps a SHA-256 of the row's
--    id and the code, and compares that. The hub keeps "[Sign-in code sent.
--    The code is hidden.]" in its chats (hub PR 4).
--  * Test accounts are not reachable this way. They keep the QA sign-in page.
--  * `staff_sign_in_settings.mode` decides who can get a code: off, the
--    owner's test number only (`whatsapp_owner_test_number`, the starting
--    point), or every member of staff. An admin changes it in Settings ->
--    WhatsApp. The hub's own AUTH_SEND_MODE is a second, separate gate.
--
-- What this adds, all in `vppsone`, service role only:
--
--  * `staff_sign_in_settings`: one row, the mode.
--  * `staff_sign_in_codes`: every ask, whether a code went or not. Kept 30
--    days (the app clears older rows after each ask), so an admin can see
--    who signed in this way.
--  * `request_staff_sign_in_code(...)`: the one place an ask is decided, in
--    one transaction, under a lock on the number.
--  * `verify_staff_sign_in_code(...)`: the one place a code is checked. It
--    checks the person again (still active, still that number) before it
--    says yes.
--
-- Nothing here sends anything and no existing table or rule changes. It is
-- additive only: undoing it means removing the two functions, then the two
-- tables, that it creates.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table vppsone.staff_sign_in_settings (
  id boolean primary key default true check (id),
  mode text not null default 'owner_only' check (mode in ('off', 'owner_only', 'all_staff')),
  updated_at timestamptz not null default now(),
  updated_by uuid references vppsone.staff_profiles(id) on delete set null
);

comment on table vppsone.staff_sign_in_settings is
  'Sign in with a WhatsApp code (D-584): who can get a code. off; owner_only (the WhatsApp owner test number only); all_staff (any active, non-test member of staff whose number is on exactly one record).';

insert into vppsone.staff_sign_in_settings (id, mode) values (true, 'owner_only') on conflict (id) do nothing;

alter table vppsone.staff_sign_in_settings enable row level security;
revoke all on vppsone.staff_sign_in_settings from public, anon, authenticated;
grant select, update on vppsone.staff_sign_in_settings to service_role;

create table vppsone.staff_sign_in_codes (
  id uuid primary key,
  phone_key text not null check (phone_key ~ '^[6-9][0-9]{9}$'),
  client_key text not null check (client_key ~ '^[0-9a-f]{16,64}$'),
  outcome text not null check (outcome in ('send', 'no_match', 'shared_number', 'not_allowed')),
  staff_profile_id uuid references vppsone.staff_profiles(id) on delete cascade,
  code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  language text not null default 'hi' check (language in ('hi', 'en')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  attempts smallint not null default 0 check (attempts between 0 and 5),
  used_at timestamptz,
  send_status text not null default 'none' check (send_status in ('none', 'pending', 'accepted', 'refused', 'unknown')),
  send_error text check (send_error is null or char_length(send_error) <= 300),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  check ((outcome = 'send') = (code_hash is not null)),
  check (outcome <> 'send' or staff_profile_id is not null),
  check (used_at is null or outcome = 'send'),
  check (expires_at > created_at)
);

comment on table vppsone.staff_sign_in_codes is
  'Sign in with a WhatsApp code (D-584): every ask. A row with outcome send carries a SHA-256 of its id and the code, never the code. The app clears rows older than 30 days.';

create index staff_sign_in_codes_phone on vppsone.staff_sign_in_codes (phone_key, created_at desc);
create index staff_sign_in_codes_client on vppsone.staff_sign_in_codes (client_key, created_at desc);
create index staff_sign_in_codes_created on vppsone.staff_sign_in_codes (created_at);

alter table vppsone.staff_sign_in_codes enable row level security;
revoke all on vppsone.staff_sign_in_codes from public, anon, authenticated;
grant select, insert, update, delete on vppsone.staff_sign_in_codes to service_role;

create function vppsone.request_staff_sign_in_code(
  p_id uuid,
  p_phone text,
  p_client_key text,
  p_code_hash text,
  p_language text
)
returns table (outcome text, staff_profile_id uuid, phone_key text, retry_after_seconds integer)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_key text;
  v_client text := lower(coalesce(p_client_key, ''));
  v_language text := case when p_language = 'en' then 'en' else 'hi' end;
  v_now timestamptz := clock_timestamp();
  v_mode text;
  v_owner text;
  v_matches uuid[];
  v_outcome text;
  v_staff uuid;
  v_count integer;
  v_oldest timestamptz;
  v_latest timestamptz;
begin
  -- An Indian mobile, typed as 10 digits, with a 0, or with 91 in front. Nothing else.
  if v_digits ~ '^(0|91)?[6-9][0-9]{9}$' then
    v_key := right(v_digits, 10);
  end if;
  if p_id is null or v_key is null then
    return query select 'bad_number'::text, null::uuid, null::text, null::integer;
    return;
  end if;
  if v_client !~ '^[0-9a-f]{16,64}$' or coalesce(p_code_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'request_staff_sign_in_code: malformed client key or code hash' using errcode = '22023';
  end if;

  select s.mode into v_mode from vppsone.staff_sign_in_settings s where s.id;
  if coalesce(v_mode, 'off') = 'off' then
    return query select 'off'::text, null::uuid, null::text, null::integer;
    return;
  end if;

  -- One ask at a time per number, so two taps cannot both slip under a limit.
  perform pg_advisory_xact_lock(hashtextextended('staff_sign_in:' || v_key, 0));

  -- 30 seconds between codes to one number.
  select max(c.created_at) into v_latest from vppsone.staff_sign_in_codes c where c.phone_key = v_key;
  if v_latest is not null and v_latest > v_now - interval '30 seconds' then
    return query select 'limited'::text, null::uuid, null::text,
      greatest(1, ceil(extract(epoch from (v_latest + interval '30 seconds' - v_now)))::integer);
    return;
  end if;

  -- 3 per number in 15 minutes, 10 a day.
  select count(*), min(c.created_at) into v_count, v_oldest
    from vppsone.staff_sign_in_codes c where c.phone_key = v_key and c.created_at > v_now - interval '15 minutes';
  if v_count >= 3 then
    return query select 'limited'::text, null::uuid, null::text,
      greatest(1, ceil(extract(epoch from (v_oldest + interval '15 minutes' - v_now)))::integer);
    return;
  end if;
  select count(*), min(c.created_at) into v_count, v_oldest
    from vppsone.staff_sign_in_codes c where c.phone_key = v_key and c.created_at > v_now - interval '24 hours';
  if v_count >= 10 then
    return query select 'limited'::text, null::uuid, null::text,
      greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::integer);
    return;
  end if;

  -- 8 asks from one address in 15 minutes, 30 a day, whatever numbers they were.
  select count(*), min(c.created_at) into v_count, v_oldest
    from vppsone.staff_sign_in_codes c where c.client_key = v_client and c.created_at > v_now - interval '15 minutes';
  if v_count >= 8 then
    return query select 'limited'::text, null::uuid, null::text,
      greatest(1, ceil(extract(epoch from (v_oldest + interval '15 minutes' - v_now)))::integer);
    return;
  end if;
  select count(*), min(c.created_at) into v_count, v_oldest
    from vppsone.staff_sign_in_codes c where c.client_key = v_client and c.created_at > v_now - interval '24 hours';
  if v_count >= 30 then
    return query select 'limited'::text, null::uuid, null::text,
      greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::integer);
    return;
  end if;

  -- 120 codes an hour for the whole school.
  select count(*) into v_count
    from vppsone.staff_sign_in_codes c where c.outcome = 'send' and c.created_at > v_now - interval '1 hour';
  if v_count >= 120 then
    return query select 'busy'::text, null::uuid, null::text, 600;
    return;
  end if;

  select array_agg(sp.id order by sp.id) into v_matches
    from vppsone.staff_profiles sp
   where sp.is_active
     and not sp.is_test_account
     and sp.user_id is not null
     and private.whatsapp_phone_key(coalesce(sp.whatsapp_phone, sp.phone)) = v_key;

  if coalesce(cardinality(v_matches), 0) = 0 then
    v_outcome := 'no_match';
  elsif cardinality(v_matches) > 1 then
    v_outcome := 'shared_number';
  else
    v_staff := v_matches[1];
    if v_mode = 'owner_only' then
      select private.whatsapp_phone_key(f.value #>> '{}') into v_owner
        from vppsone.runtime_flags f where f.key = 'whatsapp_owner_test_number' and f.enabled;
      v_outcome := case when v_owner is not null and v_owner = v_key then 'send' else 'not_allowed' end;
    else
      v_outcome := 'send';
    end if;
  end if;

  if v_outcome = 'send' then
    -- Only the newest code for a number works.
    update vppsone.staff_sign_in_codes c
       set attempts = 5
     where c.phone_key = v_key and c.outcome = 'send' and c.used_at is null and c.expires_at > v_now;
  end if;

  insert into vppsone.staff_sign_in_codes (id, phone_key, client_key, outcome, staff_profile_id, code_hash, language, created_at, expires_at, send_status)
  values (
    p_id, v_key, v_client, v_outcome,
    case when v_outcome in ('send', 'not_allowed') then v_staff end,
    case when v_outcome = 'send' then lower(p_code_hash) end,
    v_language, v_now, v_now + interval '10 minutes',
    case when v_outcome = 'send' then 'pending' else 'none' end
  );


  return query select v_outcome,
    case when v_outcome = 'send' then v_staff end,
    case when v_outcome = 'send' then v_key end,
    null::integer;
end;
$$;

comment on function vppsone.request_staff_sign_in_code(uuid, text, text, text, text) is
  'Sign in with a WhatsApp code (D-584): decide one ask. Outcomes: bad_number, off, limited, busy (nothing written); no_match, shared_number, not_allowed (a row, no code); send (a row with the code''s hash; the caller sends the code). The caller shows every row-writing outcome the same way.';

create function vppsone.verify_staff_sign_in_code(p_id uuid, p_code_hash text)
returns table (outcome text, staff_profile_id uuid, user_id uuid, tries_left integer)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_row vppsone.staff_sign_in_codes%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_user uuid;
  v_mode text;
  v_owner text;
begin
  if p_id is null then
    return query select 'no_code'::text, null::uuid, null::uuid, 0;
    return;
  end if;

  select * into v_row from vppsone.staff_sign_in_codes c where c.id = p_id for update;
  if not found then
    return query select 'no_code'::text, null::uuid, null::uuid, 0;
    return;
  end if;
  if v_row.used_at is not null then
    return query select 'used'::text, null::uuid, null::uuid, 0;
    return;
  end if;
  if v_row.attempts >= 5 then
    return query select 'locked'::text, null::uuid, null::uuid, 0;
    return;
  end if;
  if v_row.expires_at <= v_now then
    return query select 'expired'::text, null::uuid, null::uuid, 0;
    return;
  end if;

  update vppsone.staff_sign_in_codes c set attempts = c.attempts + 1 where c.id = p_id returning c.attempts into v_attempts;

  -- A row that never had a code answers exactly like a wrong code.
  if v_row.outcome <> 'send' or v_row.code_hash is distinct from lower(coalesce(p_code_hash, '')) then
    return query select case when v_attempts >= 5 then 'locked' else 'wrong' end::text, null::uuid, null::uuid, 5 - v_attempts;
    return;
  end if;

  -- The person again, as they are now: still active, still staff, still that number.
  select sp.user_id into v_user
    from vppsone.staff_profiles sp
   where sp.id = v_row.staff_profile_id
     and sp.is_active
     and not sp.is_test_account
     and sp.user_id is not null
     and private.whatsapp_phone_key(coalesce(sp.whatsapp_phone, sp.phone)) = v_row.phone_key;

  select s.mode into v_mode from vppsone.staff_sign_in_settings s where s.id;
  if v_mode = 'owner_only' then
    select private.whatsapp_phone_key(f.value #>> '{}') into v_owner
      from vppsone.runtime_flags f where f.key = 'whatsapp_owner_test_number' and f.enabled;
  end if;

  update vppsone.staff_sign_in_codes c set used_at = v_now where c.id = p_id;

  if v_user is null then
    return query select 'not_staff'::text, null::uuid, null::uuid, 0;
    return;
  end if;
  if coalesce(v_mode, 'off') = 'off' or (v_mode = 'owner_only' and v_owner is distinct from v_row.phone_key) then
    return query select 'off'::text, null::uuid, null::uuid, 0;
    return;
  end if;

  return query select 'ok'::text, v_row.staff_profile_id, v_user, null::integer;
end;
$$;

comment on function vppsone.verify_staff_sign_in_code(uuid, text) is
  'Sign in with a WhatsApp code (D-584): check one code, once. Outcomes: ok (with the staff profile and auth user), wrong (tries_left), locked, expired, used, no_code, not_staff, off.';

revoke all on function vppsone.request_staff_sign_in_code(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function vppsone.verify_staff_sign_in_code(uuid, text) from public, anon, authenticated;
grant execute on function vppsone.request_staff_sign_in_code(uuid, text, text, text, text) to service_role;
grant execute on function vppsone.verify_staff_sign_in_code(uuid, text) to service_role;

commit;
