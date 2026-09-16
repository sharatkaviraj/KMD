-- Make the `vppsone` schema reachable from supabase-js.
--
-- PostgREST serves only the schemas it is told to. On this project that was
-- `public, graphql_public`, so every read of a vppsone table came back
--   PGRST106  Invalid schema: vppsone
-- no matter what the grants said. Creating the schema is not enough; it has to
-- be exposed as well.
--
-- This is a PostgREST setting rather than a schema object, which is why it
-- reads oddly for a migration file — but it has to be replayed at cutover
-- exactly like the CREATE SCHEMA above it, or the live app answers PGRST106 on
-- its first request. See docs/SETUP.md and PLAN §7 step 2.
--
-- It is written to be **additive**: it appends `vppsone` to whatever the role
-- already carries and never removes an entry. The fee app keeps `public`.
--
-- Safety: exposing a schema is not the same as granting access to it. `anon`
-- has no USAGE on `vppsone` (see 20260916191746), so a signed-out request gets
-- `42501 permission denied for schema vppsone`; `authenticated` gets through
-- the grant and is then filtered by each table's RLS policy.
--
-- If the project's exposed schemas were ever set from the dashboard
-- (Settings -> API -> Exposed schemas), set them there too — this role setting
-- takes precedence, so a dashboard value that disagrees is silently ignored
-- and the next person to read it will be misled.

do $$
declare
  current_schemas text;
  schema_list text[];
begin
  select option_value
    into current_schemas
    from pg_options_to_table((select rolconfig from pg_roles where rolname = 'authenticator'))
   where option_name = 'pgrst.db_schemas';

  -- Unset means PostgREST is running on the project default.
  current_schemas := coalesce(current_schemas, 'public, graphql_public');

  select array_agg(btrim(entry))
    into schema_list
    from unnest(string_to_array(current_schemas, ',')) as entry
   where btrim(entry) <> '';

  if 'vppsone' = any (schema_list) then
    raise notice 'pgrst.db_schemas already exposes vppsone (%)', current_schemas;
    return;
  end if;

  schema_list := schema_list || 'vppsone';

  execute format(
    'alter role authenticator set pgrst.db_schemas = %L',
    array_to_string(schema_list, ', ')
  );

  raise notice 'pgrst.db_schemas is now %', array_to_string(schema_list, ', ');
end $$;

-- Pick up both the new config and the new tables without waiting for
-- PostgREST's own poll.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
