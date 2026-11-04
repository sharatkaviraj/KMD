-- Synthetic stand-ins for what 20261104022925_ai_connection_mcp.sql touches
-- outside itself. No real data; disposable databases only.
create schema vppsone; create schema auth;
-- As on Supabase: the service role bypasses RLS; the browser roles do not.
create role anon; create role authenticated; create role service_role bypassrls;
create table auth.users(id uuid primary key);
create table vppsone.staff_profiles(
  id uuid primary key,
  user_id uuid unique references auth.users(id),
  display_name text not null,
  short_name text not null default '',
  role text not null,
  is_teaching boolean not null default false,
  is_active boolean not null default true,
  preferred_language text,
  is_test_account boolean not null default false
);
create table vppsone.role_permissions(role text not null, permission text not null, primary key(role, permission));
create table vppsone.runtime_flags(
  key text primary key,
  enabled boolean not null,
  note text,
  value jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint runtime_flags_key_known check (key in ('cover_command'))
);
grant usage on schema vppsone to anon, authenticated, service_role;
grant all on all tables in schema vppsone to service_role;
