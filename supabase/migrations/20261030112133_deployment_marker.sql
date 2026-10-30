-- Which kind of database this is, said by the database itself (D-338, D-346).
--
-- wtgxcptmucjerhufzjcf is One's main database AND its only test bed: there is
-- no separate dev project, ever (owner, 30 Oct). "Is this the dev ref?" can no
-- longer tell a guard whether it may write test data, because the dev ref IS
-- production from go-live on. So the database carries one row that says so:
--
--   vppsone.deployment.environment = 'dev'         today
--                                  = 'production'  set by the orchestrator at
--                                                  go-live (Phase 1 lockdown)
--
-- Every QA, smoke-lab, day-run and seed tool reads it. While it says
-- 'production' (and whenever it cannot be read — fail closed), those tools are
-- CONFINED, not banned: they may only create or change test accounts and
-- TEST-session data. `vppsone.is_production()` is the SQL half, used by the fee
-- writes switch (supabase/fee-migrations/…_fee_writes_guard.sql).
--
-- Also here:
--  * staff_profiles.is_test_account — the flag the tools confine themselves to.
--    Phase 3 (PR-3) builds the visibility rules and converts the QA accounts;
--    this migration only adds the column (default false: nobody is a test
--    account until somebody says so) and stops a signed-in user from changing
--    it, so a test admin cannot clear its own flag (critique0 #14).
--  * is_test_session_label(text) — the one SQL definition of "a test session"
--    (TEST-, UAT-, DEMO- prefixes, the same set as isTestAcademicSessionLabel()
--    in src/platform/config/fee-rules.ts).
--  * one_owned_fee_settings — fee-schema settings One owns on this database,
--    which the mirror sync (Phase 2) must never overwrite from the fees app.
--
-- Rollback:
--   drop trigger staff_profiles_test_flag_guard on vppsone.staff_profiles;
--   drop function vppsone.staff_profiles_test_flag_guard();
--   alter table vppsone.staff_profiles drop column is_test_account;
--   drop function vppsone.is_production(); drop function vppsone.is_test_session_label(text);
--   drop table vppsone.one_owned_fee_settings;
--   drop trigger deployment_stamp on vppsone.deployment; drop function vppsone.deployment_stamp();
--   drop table vppsone.deployment_history; drop table vppsone.deployment;

create table vppsone.deployment (
  id smallint primary key default 1 check (id = 1),
  environment text not null check (environment in ('dev', 'production')),
  changed_at timestamptz not null default now(),
  changed_by text not null default current_user
);

comment on table vppsone.deployment is
  'One row: is this database production? Read by every QA/seed/smoke guard; unreadable means production (D-346).';

create table vppsone.deployment_history (
  id bigint generated always as identity primary key,
  environment text not null,
  changed_at timestamptz not null,
  changed_by text not null
);

comment on table vppsone.deployment_history is
  'Every value vppsone.deployment has held, appended by its trigger.';

-- changed_at / changed_by are stamped, not trusted, and every value is kept.
create or replace function vppsone.deployment_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'vppsone.deployment is never deleted; update its environment instead.';
  end if;
  new.changed_at := now();
  new.changed_by := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    session_user::text
  );
  insert into vppsone.deployment_history (environment, changed_at, changed_by)
  values (new.environment, new.changed_at, new.changed_by);
  return new;
end;
$$;

create trigger deployment_stamp
  before insert or update or delete on vppsone.deployment
  for each row execute function vppsone.deployment_stamp();

insert into vppsone.deployment (id, environment) values (1, 'dev');

alter table vppsone.deployment enable row level security;
alter table vppsone.deployment_history enable row level security;
revoke all on vppsone.deployment from public, anon, authenticated;
revoke all on vppsone.deployment_history from public, anon, authenticated;
-- Read by the service role only. Changing it is an owner step done as postgres
-- (SQL editor / MCP), never from the app.
grant select on vppsone.deployment to service_role;
grant select on vppsone.deployment_history to service_role;

create or replace function vppsone.is_production()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- No row, or anything but 'dev', reads as production: fail closed.
  select coalesce((select d.environment <> 'dev' from vppsone.deployment d where d.id = 1), true);
$$;

comment on function vppsone.is_production() is
  'True unless vppsone.deployment says dev. Fail closed (D-346).';

revoke all on function vppsone.is_production() from public, anon, authenticated;
grant execute on function vppsone.is_production() to service_role;
revoke all on function vppsone.deployment_stamp() from public, anon, authenticated;

create or replace function vppsone.is_test_session_label(p_label text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_label ~* '^(test|uat|demo)-[0-9]{4}-[0-9]{2}$', false);
$$;

comment on function vppsone.is_test_session_label(text) is
  'A rehearsal session label (TEST-2026-27). Same prefixes as isTestAcademicSessionLabel() in fee-rules.ts.';

grant execute on function vppsone.is_test_session_label(text) to authenticated, service_role;

/* ------------------------------------------------------------ test accounts */

alter table vppsone.staff_profiles
  add column is_test_account boolean not null default false;

comment on column vppsone.staff_profiles.is_test_account is
  'A test account: sees and writes TEST sessions only (PR-3). QA tooling on production acts only on these (D-346). Changed by the service role only.';

-- A signed-in user never changes the flag, in either direction — not their
-- own and not anybody else's. The service role (scripts, the app's admin
-- client after its own permission check) and postgres can.
create or replace function vppsone.staff_profiles_test_flag_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_role in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' and new.is_test_account is distinct from old.is_test_account then
      raise exception 'is_test_account is changed by an administrator tool, not from a signed-in session.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_profiles_test_flag_guard
  before update on vppsone.staff_profiles
  for each row execute function vppsone.staff_profiles_test_flag_guard();

revoke all on function vppsone.staff_profiles_test_flag_guard() from public, anon, authenticated;

/* ------------------------------------------------- settings One owns here */

create table vppsone.one_owned_fee_settings (
  source_table text not null check (source_table ~ '^[a-z_]+$'),
  row_key text not null check (char_length(row_key) between 1 and 200),
  column_name text not null check (column_name ~ '^[a-z_]+$'),
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  primary key (source_table, row_key, column_name)
);

comment on table vppsone.one_owned_fee_settings is
  'Fee-schema values One owns on this database. The mirror sync (Phase 2) never overwrites these from the fees app.';

alter table vppsone.one_owned_fee_settings enable row level security;
revoke all on vppsone.one_owned_fee_settings from public, anon, authenticated;
grant select, insert, update, delete on vppsone.one_owned_fee_settings to service_role;

insert into vppsone.one_owned_fee_settings (source_table, row_key, column_name, reason) values
  ('app_settings', 'fee_writes_enabled', 'value',
   'The fee writes switch (D-345). Set by One''s owner at T0; the fees app has no such key.');
