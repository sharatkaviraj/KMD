-- VPPS One — the schema everything this app owns lives in.
--
-- Rule 1 of CLAUDE.md: nothing VPPS One creates may land in `public`, which
-- belongs to the fee app. Creating one new schema is what makes the cutover
-- additive by construction — it adds nothing to `public`, touches no fee
-- table, and could be dropped whole if it ever had to be (PLAN §2, D-4).
--
-- Applied to schoolfees-dev (wtgxcptmucjerhufzjcf) through the Supabase MCP.
-- `supabase db push` is not usable on this database; see docs/SETUP.md.

create schema if not exists vppsone;

comment on schema vppsone is
  'VPPS One. Everything this app owns. `public` belongs to the fee app and is SELECT-only from here.';

-- `anon` is deliberately absent: nothing in VPPS One is readable signed out.
-- Phase 5 adds parent-facing token links, and those will be served by route
-- handlers using the service-role client, not by an anonymous PostgREST read.
grant usage on schema vppsone to authenticated, service_role;

-- Reads for signed-in staff are still filtered by each table's RLS policies;
-- this grant only makes the tables visible to the role at all. Writes go
-- through server actions on the service-role client, which bypasses RLS after
-- the action has checked the permission itself.
alter default privileges in schema vppsone
  grant select on tables to authenticated;

alter default privileges in schema vppsone
  grant all on tables to service_role;

alter default privileges in schema vppsone
  grant all on sequences to service_role;

alter default privileges in schema vppsone
  grant usage, select on sequences to authenticated;

-- Every table in this schema carries `updated_at`; this keeps it honest
-- without each write remembering to.
create or replace function vppsone.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function vppsone.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at = now(). Attach to every vppsone table that has the column.';
