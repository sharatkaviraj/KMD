-- Veer Patta AI: a member of staff links their own WhatsApp (D-581).
--
-- A hand-off (D-578) tells the child's class teacher, or the accountant, on
-- WhatsApp. That needs their WhatsApp number, and until now One had nobody's:
-- the office would have had to type every number into the staff record. Now
-- each person links their own, from My profile (teachers) or Preferences:
--
--  1. They tap "Link my WhatsApp". One makes a one-time code for them alone:
--     eight letters and digits, good for 30 minutes.
--  2. WhatsApp opens on their phone with a short message holding the code,
--     addressed to the school's number. They press Send.
--  3. The hub forwards the message to One, which finds the code and writes
--     down the number it came from as their WhatsApp number, with their
--     consent: sending the code from that phone is the yes.
--
-- The number is never typed, so it cannot be mistyped, and it is theirs:
-- only the person holding that phone could have sent the code from it. A test
-- account takes only a number on the test list (`message_test_recipients`),
-- the rule every staff message already keeps: a test account's number is a
-- test number or nothing.
--
-- The yes is the person's own, so it is recorded as `whatsapp_opt_in_source`
-- 'self', as on Preferences. How it was given stays here: the used code keeps
-- the number it came from, and One's screens read "linked from your phone"
-- when the number on file is that number. No existing table or rule changes.
--
-- What this adds, all in `vppsone`, service role only:
--
--  * `staff_whatsapp_links`: the codes. Each is used once; an unused one runs
--    out after 30 minutes. One clears a person's other open codes when they
--    make a new one, and again once one is used.
--  * `link_staff_whatsapp(code, from)`: the one place a code becomes a link,
--    in one transaction.
--
-- Nothing here sends anything. Whether One answers the message on WhatsApp is
-- the helper's own switch and practice mode, as for every other message.
--
-- Rollback:
--   drop function if exists vppsone.link_staff_whatsapp(text, text);
--   drop table if exists vppsone.staff_whatsapp_links;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

comment on column vppsone.staff_profiles.whatsapp_opt_in_source is
  'How the consent was given: form (paper, at training), self (the person themselves: on /preferences, or by sending their Link my WhatsApp code from that phone, D-581, kept in staff_whatsapp_links) or admin_recorded (/staff, the admin records consent collected in person).';

create table vppsone.staff_whatsapp_links (
  code text primary key check (code ~ '^[A-HJKMNP-Z2-9]{8}$'),
  staff_profile_id uuid not null references vppsone.staff_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at timestamptz,
  used_from text check (used_from is null or used_from ~ '^\+91[6-9][0-9]{9}$'),
  check ((used_at is null) = (used_from is null)),
  check (expires_at > created_at)
);

comment on table vppsone.staff_whatsapp_links is
  'Link my WhatsApp (D-581): one-time codes a member of staff sends from their phone to the school''s number, so One learns their WhatsApp number from WhatsApp itself. A used row keeps which number it linked and when.';

create index staff_whatsapp_links_staff on vppsone.staff_whatsapp_links (staff_profile_id, created_at desc);

alter table vppsone.staff_whatsapp_links enable row level security;

revoke all on vppsone.staff_whatsapp_links from public, anon, authenticated;
grant select, insert, update, delete on vppsone.staff_whatsapp_links to service_role;

create function vppsone.link_staff_whatsapp(p_code text, p_from text)
returns table (outcome text, staff_profile_id uuid, display_name text, preferred_language text, is_test_account boolean)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_link vppsone.staff_whatsapp_links%rowtype;
  v_staff record;
begin
  if p_from is null or p_from !~ '^\+91[6-9][0-9]{9}$' then
    return query select 'bad_number'::text, null::uuid, null::text, null::text, null::boolean;
    return;
  end if;
  if v_code !~ '^[A-HJKMNP-Z2-9]{8}$' then
    return query select 'no_code'::text, null::uuid, null::text, null::text, null::boolean;
    return;
  end if;

  select l.* into v_link from vppsone.staff_whatsapp_links l where l.code = v_code for update;
  if not found then
    return query select 'no_code'::text, null::uuid, null::text, null::text, null::boolean;
    return;
  end if;

  select s.id, s.display_name, s.preferred_language, coalesce(s.is_test_account, false) as is_test_account, s.is_active
    into v_staff
    from vppsone.staff_profiles s
   where s.id = v_link.staff_profile_id
     for update;

  if v_link.used_at is not null then
    -- The same message forwarded twice, or sent twice: it is linked already.
    if v_link.used_from = p_from then
      return query select 'already_linked'::text, v_staff.id, v_staff.display_name, v_staff.preferred_language, v_staff.is_test_account;
    else
      return query select 'used'::text, null::uuid, null::text, null::text, null::boolean;
    end if;
    return;
  end if;

  if v_link.expires_at <= now() then
    return query select 'expired'::text, v_staff.id, null::text, v_staff.preferred_language, null::boolean;
    return;
  end if;

  if not coalesce(v_staff.is_active, false) then
    return query select 'inactive'::text, null::uuid, null::text, null::text, null::boolean;
    return;
  end if;

  if v_staff.is_test_account
     and not exists (select 1 from vppsone.message_test_recipients r where r.phone_e164 = p_from) then
    return query select 'not_test_number'::text, v_staff.id, null::text, v_staff.preferred_language, true;
    return;
  end if;

  -- Their own yes, given from that phone: 'self', as on Preferences.
  update vppsone.staff_profiles s
     set whatsapp_phone = right(p_from, 10),
         whatsapp_opt_in_at = now(),
         whatsapp_opt_in_source = 'self',
         whatsapp_opt_in_recorded_by = v_staff.id,
         whatsapp_opt_out_at = null
   where s.id = v_staff.id;

  update vppsone.staff_whatsapp_links l
     set used_at = now(), used_from = p_from
   where l.code = v_code;

  return query select 'linked'::text, v_staff.id, v_staff.display_name, v_staff.preferred_language, v_staff.is_test_account;
end;
$$;

comment on function vppsone.link_staff_whatsapp(text, text) is
  'Link my WhatsApp (D-581): the code a member of staff sent from their phone, and the number it came from. linked: the number is now their WhatsApp number, with their own yes (source self). Otherwise one of bad_number, no_code, used, already_linked, expired, inactive, not_test_number, and nothing changed.';

revoke all on function vppsone.link_staff_whatsapp(text, text) from public, anon, authenticated;
grant execute on function vppsone.link_staff_whatsapp(text, text) to service_role;

commit;
