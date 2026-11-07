-- Transport: routes, drivers and bus trips (owner, 7 Nov 2026, D-520).
--
-- Janmejay: "I can only see On bus ... there are so many transport routes ...
-- see the students on different times of routes, and assign drivers on the
-- routes, so I can know which driver is going on which route."
--
-- Fees stays the authority for which route a child is on (students.
-- transport_route_id, copied nightly into fees_bridge_students). What One adds
-- is everything Fees never held:
--
--  * fees_bridge_routes: the route NAMES, copied from Fees' machine-only
--    GET /api/one/v1/sync/routes (Fees PR 151). Names, codes and flags only,
--    never a fee. Replaced whole by fees_bridge_replace_routes(), never edited
--    here. TEST sessions keep reading their own local route list.
--  * transport_drivers: who drives (name, phone), per session.
--  * transport_trips: one bus run at one time of day (morning pickup,
--    afternoon drop, or another run), with its driver, helper and bus.
--  * transport_trip_stops: the routes (villages) that run reaches, in order,
--    each with an optional time. A route's children ride every trip that
--    stops there.
--
-- Session-labelled like everything else in One, so TEST-2026-27 has its own
-- drivers and trips and a test account can never touch the real ones. One's
-- writes are service role (D-179), so the app's assertSessionWritable is the
-- fence that counts; the restrictive test_session_fence policies below hold
-- the PostgREST path as on the 87 other tables (20261030155339). Nothing here
-- reads or writes the fee tables.
--
-- Rollback:
--   drop function vppsone.transport_save_trip(uuid, text, jsonb, timestamptz);
--   drop function vppsone.fees_bridge_replace_routes(jsonb);
--   drop table vppsone.transport_trip_stops, vppsone.transport_trips,
--              vppsone.transport_drivers, vppsone.fees_bridge_route_sync,
--              vppsone.fees_bridge_routes;
--   (and the rows of 20261107165001_transport_role_permissions.sql)
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

/* ----------------------------------------------------------- route names */

create table vppsone.fees_bridge_routes (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 200),
  code text check (code is null or length(code) <= 50),
  is_active boolean not null default true,
  -- Fees' "No Transport" row: a placeholder, not a bus (isSentinelNoTransportRoute).
  placeholder boolean not null default false,
  refreshed_at timestamptz not null default now()
);
comment on table vppsone.fees_bridge_routes is
  'Transport route names copied from Fees (GET /api/one/v1/sync/routes). Replaced whole by fees_bridge_replace_routes(); never edited in One. No fee column.';

create table vppsone.fees_bridge_route_sync (
  id boolean primary key default true check (id),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$')
);
comment on table vppsone.fees_bridge_route_sync is
  'When One last asked Fees for route names, so a page that finds a name missing asks at most once in ten minutes.';
insert into vppsone.fees_bridge_route_sync (id) values (true);

-- The list Fees answered replaces the copy, all of it or none of it. An empty
-- list is refused rather than taken to mean "the school has no routes".
create function vppsone.fees_bridge_replace_routes(p_routes jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_routes) is distinct from 'array'
     or jsonb_array_length(p_routes) = 0
     or jsonb_array_length(p_routes) > 500 then
    raise exception 'transport:bad_routes';
  end if;
  if exists (
       select 1 from jsonb_array_elements(p_routes) as r
        where nullif(r->>'id', '') is null or nullif(btrim(coalesce(r->>'name', '')), '') is null
     )
     or (select count(distinct r->>'id') from jsonb_array_elements(p_routes) as r) <> jsonb_array_length(p_routes) then
    raise exception 'transport:bad_routes';
  end if;

  insert into vppsone.fees_bridge_routes as t (id, name, code, is_active, placeholder, refreshed_at)
  select (r->>'id')::uuid,
         btrim(r->>'name'),
         nullif(btrim(coalesce(r->>'code', '')), ''),
         coalesce((r->>'isActive')::boolean, true),
         coalesce((r->>'placeholder')::boolean, false),
         now()
    from jsonb_array_elements(p_routes) as r
  on conflict (id) do update
    set name = excluded.name, code = excluded.code, is_active = excluded.is_active,
        placeholder = excluded.placeholder, refreshed_at = excluded.refreshed_at;
  get diagnostics v_count = row_count;

  delete from vppsone.fees_bridge_routes as t
   where not exists (select 1 from jsonb_array_elements(p_routes) as r where (r->>'id')::uuid = t.id);

  update vppsone.fees_bridge_route_sync
     set last_success_at = now(), last_error_code = null
   where id;

  return v_count;
end;
$$;
revoke all on function vppsone.fees_bridge_replace_routes(jsonb) from public, anon, authenticated;
grant execute on function vppsone.fees_bridge_replace_routes(jsonb) to service_role;

/* ---------------------------------------------------------------- drivers */

create table vppsone.transport_drivers (
  id uuid primary key default gen_random_uuid(),
  session_label text not null check (session_label ~ '^(TEST-|UAT-|DEMO-)?[0-9]{4}-[0-9]{2}$'),
  full_name text not null check (length(btrim(full_name)) between 1 and 80),
  phone text check (phone is null or phone ~ '^[0-9]{10}$'),
  notes text check (notes is null or length(notes) <= 300),
  created_by uuid references vppsone.staff_profiles(id) on delete set null,
  updated_by uuid references vppsone.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The pair the trips' composite key points at, so a trip can only name a
  -- driver of its own session.
  unique (id, session_label)
);
create index transport_drivers_session on vppsone.transport_drivers (session_label);
comment on table vppsone.transport_drivers is
  'Who drives the school''s buses, per session. Written by One''s Transport screen (transport:manage).';

/* ------------------------------------------------------------------ trips */

create table vppsone.transport_trips (
  id uuid primary key default gen_random_uuid(),
  session_label text not null check (session_label ~ '^(TEST-|UAT-|DEMO-)?[0-9]{4}-[0-9]{2}$'),
  shift text not null check (shift in ('morning', 'afternoon', 'other')),
  starts_at time not null,
  bus_name text not null check (length(btrim(bus_name)) between 1 and 40),
  vehicle_no text check (vehicle_no is null or length(btrim(vehicle_no)) between 1 and 20),
  driver_id uuid,
  helper_name text check (helper_name is null or length(btrim(helper_name)) between 1 and 80),
  helper_phone text check (helper_phone is null or helper_phone ~ '^[0-9]{10}$'),
  notes text check (notes is null or length(notes) <= 300),
  created_by uuid references vppsone.staff_profiles(id) on delete set null,
  updated_by uuid references vppsone.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Removing a driver leaves the bus without one; the trip and its session stay.
  foreign key (driver_id, session_label)
    references vppsone.transport_drivers (id, session_label) on delete set null (driver_id)
);
create index transport_trips_session on vppsone.transport_trips (session_label, shift, starts_at);
create index transport_trips_driver on vppsone.transport_trips (driver_id) where driver_id is not null;
comment on table vppsone.transport_trips is
  'One bus run at one time of day: morning pickup, afternoon drop or another run. Its villages are transport_trip_stops.';

create table vppsone.transport_trip_stops (
  trip_id uuid not null references vppsone.transport_trips(id) on delete cascade,
  -- A Fees transport route id (fees_bridge_routes, or the local list in a TEST
  -- session). Not a foreign key: the names are a copy that is replaced whole.
  route_id uuid not null,
  position smallint not null check (position between 1 and 60),
  stop_time time,
  primary key (trip_id, route_id),
  unique (trip_id, position)
);
create index transport_trip_stops_route on vppsone.transport_trip_stops (route_id);
comment on table vppsone.transport_trip_stops is
  'The routes (villages) a trip reaches, in order, each with an optional time.';

/* --------------------------------------------------------- the one writer */

-- Saves a trip and its stops together, so a bus is never left half-saved.
-- p_trip: { id?, shift, startsAt "HH:MM", busName, vehicleNo?, driverId?,
--           helperName?, helperPhone?, notes?, stops: [{ routeId, stopTime? }] }
-- in the order the bus reaches them. With an id, the trip must already be in
-- p_session; with p_expected (the updated_at the editor opened), a trip
-- somebody else changed meanwhile is refused instead of overwritten.
create function vppsone.transport_save_trip(
  p_actor uuid,
  p_session text,
  p_trip jsonb,
  p_expected timestamptz default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_trip->>'id', '')::uuid;
  v_driver uuid := nullif(p_trip->>'driverId', '')::uuid;
  v_stops jsonb := coalesce(p_trip->'stops', '[]'::jsonb);
  v_current timestamptz;
  v_saved timestamptz;
begin
  if p_session is null or p_session !~ '^(TEST-|UAT-|DEMO-)?[0-9]{4}-[0-9]{2}$' then
    raise exception 'transport:bad_request';
  end if;
  if jsonb_typeof(v_stops) <> 'array' or jsonb_array_length(v_stops) > 40 then
    raise exception 'transport:bad_request';
  end if;
  if (select count(distinct s->>'routeId') from jsonb_array_elements(v_stops) s) <> jsonb_array_length(v_stops) then
    raise exception 'transport:duplicate_stop';
  end if;
  if v_driver is not null and not exists (
    select 1 from vppsone.transport_drivers d where d.id = v_driver and d.session_label = p_session
  ) then
    raise exception 'transport:driver_missing';
  end if;

  if v_id is null then
    insert into vppsone.transport_trips (session_label, shift, starts_at, bus_name, vehicle_no, driver_id,
                                         helper_name, helper_phone, notes, created_by, updated_by)
    values (p_session, p_trip->>'shift', (p_trip->>'startsAt')::time, btrim(p_trip->>'busName'),
            nullif(btrim(coalesce(p_trip->>'vehicleNo', '')), ''), v_driver,
            nullif(btrim(coalesce(p_trip->>'helperName', '')), ''), nullif(p_trip->>'helperPhone', ''),
            nullif(btrim(coalesce(p_trip->>'notes', '')), ''), p_actor, p_actor)
    returning id, updated_at into v_id, v_saved;
  else
    select updated_at into v_current from vppsone.transport_trips
     where id = v_id and session_label = p_session
     for update;
    if not found then raise exception 'transport:not_found'; end if;
    if p_expected is not null and v_current <> p_expected then raise exception 'transport:changed'; end if;
    update vppsone.transport_trips
       set shift = p_trip->>'shift', starts_at = (p_trip->>'startsAt')::time,
           bus_name = btrim(p_trip->>'busName'),
           vehicle_no = nullif(btrim(coalesce(p_trip->>'vehicleNo', '')), ''), driver_id = v_driver,
           helper_name = nullif(btrim(coalesce(p_trip->>'helperName', '')), ''),
           helper_phone = nullif(p_trip->>'helperPhone', ''),
           notes = nullif(btrim(coalesce(p_trip->>'notes', '')), ''),
           updated_by = p_actor, updated_at = greatest(clock_timestamp(), v_current + interval '1 millisecond')
     where id = v_id
    returning updated_at into v_saved;
    delete from vppsone.transport_trip_stops where trip_id = v_id;
  end if;

  insert into vppsone.transport_trip_stops (trip_id, route_id, position, stop_time)
  select v_id, (s.value->>'routeId')::uuid, s.ordinality::smallint, nullif(s.value->>'stopTime', '')::time
    from jsonb_array_elements(v_stops) with ordinality as s;

  return jsonb_build_object('id', v_id, 'updatedAt', v_saved);
end;
$$;
revoke all on function vppsone.transport_save_trip(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function vppsone.transport_save_trip(uuid, text, jsonb, timestamptz) to service_role;

/* ---------------------------------------------------- access and the fence */

alter table vppsone.fees_bridge_routes enable row level security;
alter table vppsone.fees_bridge_route_sync enable row level security;
alter table vppsone.transport_drivers enable row level security;
alter table vppsone.transport_trips enable row level security;
alter table vppsone.transport_trip_stops enable row level security;

revoke all on vppsone.fees_bridge_routes, vppsone.fees_bridge_route_sync, vppsone.transport_drivers,
  vppsone.transport_trips, vppsone.transport_trip_stops from anon, authenticated;
grant all on vppsone.fees_bridge_routes, vppsone.fees_bridge_route_sync, vppsone.transport_drivers,
  vppsone.transport_trips, vppsone.transport_trip_stops to service_role;

create policy test_session_fence on vppsone.transport_drivers as restrictive for all to authenticated
  using ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()))
  with check ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()));
create policy test_session_fence on vppsone.transport_trips as restrictive for all to authenticated
  using ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()))
  with check ((vppsone.is_test_session(session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()));
create policy test_session_fence on vppsone.transport_trip_stops as restrictive for all to authenticated
  using (exists (select 1 from vppsone.transport_trips p where p.id = transport_trip_stops.trip_id
    and ((vppsone.is_test_session(p.session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()))))
  with check (exists (select 1 from vppsone.transport_trips p where p.id = transport_trip_stops.trip_id
    and ((vppsone.is_test_session(p.session_label) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()))));

commit;
