/** In-memory PostgreSQL proof of the Transport migrations (D-550):
 * supabase/migrations/20261107165000_transport.sql and
 * 20261107165001_transport_role_permissions.sql, against a synthetic schema.
 * No URL, credentials or hosted database accepted: pass a local installed
 * @electric-sql/pglite directory (CI installs it in a disposable folder).
 * Proves the route-name copy, drivers, trips and stops, the session fences,
 * the stale-editor refusal and the grants.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

const db = new PGlite();
const run = (sql) => db.exec(sql);
const q = async (sql, params) => (await db.query(sql, params)).rows;
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"} ${label}`); if (!cond) failures += 1; };
async function refuses(sql, params, code, label) {
  try { await db.query(sql, params); ok(false, `${label} (was accepted)`); }
  catch (error) { ok(String(error.message).includes(code), `${label} -> ${String(error.message).slice(0, 90)}`); }
}

await run(`
  create role anon; create role authenticated; create role service_role;
  create schema vppsone;
  create table vppsone.staff_profiles (id uuid primary key);
  create table vppsone.role_permissions (role text not null, permission text not null, primary key (role, permission),
    constraint role_permissions_shape check (permission ~ '^[a-z_]+:[a-z_]+$'));
  create function vppsone.is_test_session(p text) returns boolean language sql immutable as $$ select p ~ '^(TEST-|UAT-|DEMO-)' $$;
  create function vppsone.current_is_test_account() returns boolean language sql stable as $$ select false $$;
  create function vppsone.is_real_admin() returns boolean language sql stable as $$ select false $$;
  insert into vppsone.staff_profiles values ('00000000-0000-4000-8000-000000000001');
`);
await run(await migration("20261107165000_transport.sql"));
await run(await migration("20261107165001_transport_role_permissions.sql"));
ok((await q("select count(*)::int n from vppsone.role_permissions where permission like 'transport:%'"))[0].n === 4, "four role rows");

// Route names: replace whole, refuse empty / duplicate / nameless.
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
ok((await q("select vppsone.fees_bridge_replace_routes($1::jsonb) n", [JSON.stringify([
  { id: A, name: "Hill Road", code: "R1", isActive: true, placeholder: false },
  { id: B, name: " No Transport ", code: null, isActive: true, placeholder: true },
])]))[0].n === 2, "two routes copied");
ok((await q("select name from vppsone.fees_bridge_routes where id = $1", [B]))[0].name === "No Transport", "names trimmed");
ok((await q("select last_success_at is not null s from vppsone.fees_bridge_route_sync"))[0].s, "success time recorded");
await q("select vppsone.fees_bridge_replace_routes($1::jsonb)", [JSON.stringify([{ id: A, name: "Hill Road North" }, { id: C, name: "River Side" }])]);
const names = (await q("select id, name from vppsone.fees_bridge_routes order by name")).map((r) => r.name);
ok(JSON.stringify(names) === JSON.stringify(["Hill Road North", "River Side"]), `replaced whole: ${names}`);
await refuses("select vppsone.fees_bridge_replace_routes('[]'::jsonb)", [], "transport:bad_routes", "empty list refused");
await refuses("select vppsone.fees_bridge_replace_routes($1::jsonb)", [JSON.stringify([{ id: A, name: "x" }, { id: A, name: "y" }])], "transport:bad_routes", "duplicate id refused");
await refuses("select vppsone.fees_bridge_replace_routes($1::jsonb)", [JSON.stringify([{ id: A, name: "  " }])], "transport:bad_routes", "blank name refused");
ok((await q("select count(*)::int n from vppsone.fees_bridge_routes"))[0].n === 2, "a refused list leaves the copy as it was");

// Drivers and trips.
const actor = "00000000-0000-4000-8000-000000000001";
const [d1] = await q("insert into vppsone.transport_drivers (session_label, full_name, phone, created_by) values ('2026-27', 'Driver One', '9876543210', $1) returning id", [actor]);
const [dTest] = await q("insert into vppsone.transport_drivers (session_label, full_name) values ('TEST-2026-27', 'Test Driver') returning id");
await refuses("insert into vppsone.transport_drivers (session_label, full_name, phone) values ('2026-27', 'X', '12345')", [], "check", "bad phone refused");
await refuses("insert into vppsone.transport_drivers (session_label, full_name) values ('all', 'X')", [], "check", "bad session refused");

const trip = (extra = {}) => JSON.stringify({ shift: "morning", startsAt: "07:05", busName: "Bus 1", vehicleNo: "RJ 30 PA 1", driverId: d1.id,
  helperName: "Helper", helperPhone: "9123456780", stops: [{ routeId: A, stopTime: "07:10" }, { routeId: C }], ...extra });
const [saved] = await q("select vppsone.transport_save_trip($1, '2026-27', $2::jsonb) r", [actor, trip()]);
const tripId = saved.r.id;
ok(Boolean(tripId), "trip saved");
const stops = await q("select route_id, position, stop_time from vppsone.transport_trip_stops where trip_id = $1 order by position", [tripId]);
ok(stops.length === 2 && stops[0].route_id === A && stops[0].position === 1 && stops[1].position === 2 && stops[1].stop_time === null, "stops in order");

// Update: replaces the stops, refuses a stale editor, refuses the wrong session.
const before = (await q("select updated_at::text u from vppsone.transport_trips where id = $1", [tripId]))[0].u;
const [updated] = await q("select vppsone.transport_save_trip($1, '2026-27', $2::jsonb, $3::timestamptz) r", [actor, trip({ id: tripId, stops: [{ routeId: C }] }), before]);
ok(updated.r.id === tripId, "trip updated");
ok((await q("select count(*)::int n from vppsone.transport_trip_stops where trip_id = $1", [tripId]))[0].n === 1, "stops replaced");
await refuses("select vppsone.transport_save_trip($1, '2026-27', $2::jsonb, $3::timestamptz)", [actor, trip({ id: tripId }), before], "transport:changed", "stale editor refused");
await refuses("select vppsone.transport_save_trip($1, 'TEST-2026-27', $2::jsonb)", [actor, trip({ id: tripId, driverId: null })], "transport:not_found", "another session's trip refused");
await refuses("select vppsone.transport_save_trip($1, '2026-27', $2::jsonb)", [actor, trip({ driverId: dTest.id })], "transport:driver_missing", "another session's driver refused");
await refuses("select vppsone.transport_save_trip($1, '2026-27', $2::jsonb)", [actor, trip({ stops: [{ routeId: A }, { routeId: A }] })], "transport:duplicate_stop", "a village twice refused");
await refuses("select vppsone.transport_save_trip($1, '2026-27', $2::jsonb)", [actor, trip({ shift: "night" })], "check", "unknown shift refused");
await refuses("select vppsone.transport_save_trip($1, '2026-27', $2::jsonb)", [actor, trip({ helperPhone: "99" })], "check", "bad helper phone refused");
await refuses("update vppsone.transport_trips set driver_id = $1 where id = $2", [dTest.id, tripId], "foreign key", "composite key keeps a driver in their session");

// Removing a driver leaves the bus without one; removing a trip removes its stops.
await q("delete from vppsone.transport_drivers where id = $1", [d1.id]);
const after = (await q("select driver_id, session_label from vppsone.transport_trips where id = $1", [tripId]))[0];
ok(after.driver_id === null && after.session_label === "2026-27", "driver removed: trip kept, session kept");
await q("delete from vppsone.transport_trips where id = $1", [tripId]);
ok((await q("select count(*)::int n from vppsone.transport_trip_stops"))[0].n === 0, "trip removed: its stops go too");

// Grants: nothing for anon/authenticated, everything for service_role.
const grants = await q(`select grantee, count(*)::int n from information_schema.role_table_grants
  where table_schema = 'vppsone' and table_name in ('fees_bridge_routes','fees_bridge_route_sync','transport_drivers','transport_trips','transport_trip_stops')
  group by grantee order by grantee`);
ok(!grants.some((g) => g.grantee === "anon" || g.grantee === "authenticated"), `no anon/authenticated grants: ${JSON.stringify(grants)}`);
const policies = await q("select tablename, policyname, permissive from pg_policies where schemaname = 'vppsone' order by tablename");
ok(policies.length === 3 && policies.every((p) => p.permissive === "RESTRICTIVE"), `three restrictive fences: ${policies.map((p) => p.tablename)}`);
const fnGrants = await q(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'vppsone' and p.proname in ('transport_save_trip','fees_bridge_replace_routes')`);
ok(fnGrants.length === 2 && fnGrants.every((f) => !f.auth && f.svc), `functions: service role only ${JSON.stringify(fnGrants)}`);

await db.close();
console.log(failures ? `\n${failures} FAILED` : "\nPASS: transport migrations proved on a synthetic schema.");
process.exit(failures ? 1 : 0);
