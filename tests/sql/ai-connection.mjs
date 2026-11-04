/** In-memory PostgreSQL proof of the AI connection's SQL functions
 * (supabase/migrations/20261104022925_ai_connection_mcp.sql) against a
 * synthetic schema. No URL, credentials or hosted database accepted: pass a
 * local installed @electric-sql/pglite directory (CI installs it in a
 * disposable folder). One connection, so this proves behaviour and grants;
 * the two-connection lock proofs are tests/sql/ai-connection-locks.py.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const db = new PGlite();
await db.exec(await readFile(new URL("./ai-connection-fixture.sql", import.meta.url), "utf8"));
await db.exec(await readFile(new URL("../../supabase/migrations/20261104022925_ai_connection_mcp.sql", import.meta.url), "utf8"));

const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hex = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const b64 = () => randomBytes(32).toString("base64url"); // 43 characters, like an S256 challenge
const RESOURCE = "https://one.vpps.co.in/api/mcp";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const ADMIN = id(1), ADMIN_USER = id(2), OTHER = id(3), OTHER_USER = id(4);

await db.query("insert into auth.users values ($1),($2)", [ADMIN_USER, OTHER_USER]);
await db.query(
  "insert into vppsone.staff_profiles(id,user_id,display_name,short_name,role) values ($1,$2,'Synthetic Admin','SA','admin'),($3,$4,'Synthetic Teacher','ST','teacher')",
  [ADMIN, ADMIN_USER, OTHER, OTHER_USER],
);
await db.query("insert into vppsone.role_permissions values ('admin','dashboard:view'),('teacher','attendance:view')");

// Everything below runs as the only role the app uses for these functions.
await db.exec("set role service_role");
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.result;

/* -------------------------------------------------------- registration */
const register = (clientId, source, { env = "production", perSource = 5, perHour = 100, reuse = 600, uris = [CALLBACK] } = {}) =>
  one("select vppsone.ai_register_client($1,'Claude',$2,$3,$4,$5,$6,$7) result", [clientId, uris, source, env, perSource, perHour, reuse]);

const srcA = hex(), srcB = hex();
const first = await register("client-aaaaaaaaaaaaaaaaaaaaaa", srcA);
assert.equal(first.ok, true); assert.equal(first.reused, false);
const again = await register("client-bbbbbbbbbbbbbbbbbbbbbb", srcA);
assert.equal(again.reused, true); assert.equal(again.client_id, "client-aaaaaaaaaaaaaaaaaaaaaa");
for (let i = 0; i < 4; i += 1) assert.equal((await register(`client-c${i}cccccccccccccccccccc`, srcA, { reuse: 0 })).ok, true);
assert.deepEqual(await register("client-dddddddddddddddddddddd", srcA, { reuse: 0 }), { ok: false, reason: "rate_limited" });
assert.equal((await register("client-eeeeeeeeeeeeeeeeeeeeee", srcB, { reuse: 0 })).ok, true);
assert.equal((await register("client-ffffffffffffffffffffff", srcA, { env: "preview", reuse: 0 })).ok, true);
assert.deepEqual(await register("client-gggggggggggggggggggggg", hex(), { reuse: 0, perHour: 6 }), { ok: false, reason: "rate_limited" });
assert.equal(await one("select count(*)::int result from vppsone.ai_oauth_clients where source_hash !~ '^[0-9a-f]{64}$'"), 0);
console.log("PASS: registration reuses per source, limits per source and per environment, stores hashes only");

/* ------------------------------------------------ consent and exchange */
const CLIENT = "client-aaaaaaaaaaaaaaaaaaaaaa";
async function grant(staff = ADMIN, user = ADMIN_USER) {
  const code = hex(), challenge = b64();
  const created = await one("select vppsone.ai_create_grant($1,$2,$3,'claude',array['one.read'],$4,$5,$6,$7,60,90) result", [staff, user, CLIENT, code, CALLBACK, challenge, RESOURCE]);
  assert.equal(created.ok, true, JSON.stringify(created));
  return { code, challenge, connection: created.connection_id };
}
const exchange = (g, overrides = {}) =>
  one("select vppsone.ai_exchange_code($1,$2,$3,$4,$5,$6,$7,900) result", [
    g.code, overrides.challenge ?? g.challenge, overrides.client ?? CLIENT, overrides.redirect ?? CALLBACK, overrides.resource ?? RESOURCE, hex(), hex(),
  ]);
const conn = (connection) => db.query("select * from vppsone.ai_connections where id=$1", [connection]).then((r) => r.rows[0]);
const listed = () => one("select count(*)::int result from vppsone.ai_connection_list(null, 200)");

assert.equal((await one("select vppsone.ai_create_grant($1,$2,$3,'claude',array['one.read'],$4,$5,$6,$7,60,90) result", [ADMIN, OTHER_USER, CLIENT, hex(), CALLBACK, b64(), RESOURCE])).ok, false, "a grant for someone else's auth user");
assert.equal((await one("select vppsone.ai_create_grant($1,$2,$3,'claude',array['one.read'],$4,$5,$6,$7,60,90) result", [ADMIN, ADMIN_USER, CLIENT, hex(), "https://evil.example/cb", b64(), RESOURCE])).ok, false, "an unregistered redirect");

const pending = await grant();
assert.equal((await conn(pending.connection)).activated_at, null);
assert.equal(await listed(), 0, "a pending grant is not listed");
assert.equal(await one("select count(*)::int result from vppsone.ai_tokens"), 0);

const mismatched = await grant();
assert.equal((await exchange(mismatched, { challenge: b64() })).status, "invalid");
assert.equal((await conn(mismatched.connection)).revoke_reason, "code_mismatch");

const good = await grant();
const issued = await exchange(good);
assert.equal(issued.status, "ok");
assert.notEqual((await conn(good.connection)).activated_at, null);
assert.equal((await conn(pending.connection)).revoke_reason, "replaced", "redeeming ends the other pending grant");
assert.equal(await listed(), 1);
assert.equal((await exchange(good)).status, "replayed");
assert.equal((await conn(good.connection)).revoke_reason, "code_reuse");
assert.equal(await one("select count(*)::int result from vppsone.ai_tokens where connection_id=$1 and revoked_at is null", [good.connection]), 0);
console.log("PASS: consent is pending; a good code activates and replaces; mismatch and reuse revoke");

/* ----------------------------------------------------------- refresh */
const live = await grant();
const accessHash = hex(), refreshHash = hex();
assert.equal((await one("select vppsone.ai_exchange_code($1,$2,$3,$4,$5,$6,$7,900) result", [live.code, live.challenge, CLIENT, CALLBACK, RESOURCE, accessHash, refreshHash])).status, "ok");
const access = await one("select vppsone.ai_resolve_access($1) result", [accessHash]);
assert.equal(access.kind, "access"); assert.equal(access.connection.id, live.connection); assert.equal(access.resource, RESOURCE);
const rotate = (hash, client = CLIENT) => one("select vppsone.ai_rotate_refresh($1,$2,$3,$4,$5,900) result", [hash, client, RESOURCE, hex(), hex()]);
assert.equal((await rotate(refreshHash, "client-eeeeeeeeeeeeeeeeeeeeee")).status, "invalid", "another client");
assert.equal((await db.query("select used_at from vppsone.ai_tokens where token_hash=$1", [refreshHash])).rows[0].used_at, null, "not consumed");
assert.equal((await rotate(refreshHash)).status, "ok");
const old = (await db.query("select used_at, replaced_by, expires_at from vppsone.ai_tokens where token_hash=$1", [refreshHash])).rows[0];
assert.notEqual(old.used_at, null); assert.notEqual(old.replaced_by, null);
assert.equal(await one("select bool_and(t.expires_at <= c.expires_at) result from vppsone.ai_tokens t join vppsone.ai_connections c on c.id=t.connection_id"), true, "no token outlives its grant");
assert.equal((await rotate(refreshHash)).status, "replayed");
assert.equal((await conn(live.connection)).revoke_reason, "refresh_reuse");
console.log("PASS: refresh rotates once, refuses another client without consuming, replay revokes the grant");

/* ------------------------------------------------ revocation and counts */
const revocable = await grant();
const rAccess = hex(), rRefresh = hex();
await one("select vppsone.ai_exchange_code($1,$2,$3,$4,$5,$6,$7,900) result", [revocable.code, revocable.challenge, CLIENT, CALLBACK, RESOURCE, rAccess, rRefresh]);
await db.query("select vppsone.ai_revoke_token($1,'client-eeeeeeeeeeeeeeeeeeeeee')", [rRefresh]);
assert.equal((await conn(revocable.connection)).revoked_at, null, "another client cannot revoke");
await db.query("select vppsone.ai_revoke_token($1,$2)", [rRefresh, CLIENT]);
assert.equal((await conn(revocable.connection)).revoke_reason, "revoked_by_client");
assert.equal(await one("select vppsone.ai_revoke_staff_connections($1,'staff_disabled',null) result", [ADMIN]), 0, "nothing live left to end");

for (const outcome of ["ok", "refused:unknown_tool", "refused:switched_off", "refused:rate_limited", "refused:rate_limited"]) {
  await db.query("insert into vppsone.ai_tool_calls(staff_profile_id,connection_id,provider,tool,outcome,duration_ms) values ($1,$2,'claude','get_context',$3,1)", [ADMIN, revocable.connection, outcome]);
}
assert.deepEqual(await one("select vppsone.ai_call_counts($1) result", [ADMIN]), { hour: 3, day: 3, limited_hour: 2 });
await assert.rejects(() => db.query("insert into vppsone.ai_tool_calls(staff_profile_id,provider,tool,outcome,duration_ms) values ($1,'claude','x','refused:with arguments 2026-11-03',1)", [ADMIN]));
const staff = await one("select vppsone.ai_staff_for_user($1) result", [ADMIN_USER]);
assert.equal(staff.role, "admin"); assert.deepEqual(staff.permissions, ["dashboard:view"]);
assert.equal(await one("select vppsone.ai_staff_for_user($1) result", [id(999)]), null);
console.log("PASS: RFC 7009 per client, staff revocation, refused calls count, rate-limit refusals apart, metadata-only log");

/* --------------------------------------------------------------- purge */
const stale = await grant();
await db.exec("reset role");
await db.query("update vppsone.ai_connections set created_at = now() - interval '2 days', expires_at = now() + interval '80 days' where id=$1", [stale.connection]);
await db.query("update vppsone.ai_oauth_clients set created_at = now() - interval '2 days' where client_id='client-ffffffffffffffffffffff'");
await db.query("insert into vppsone.ai_tool_calls(created_at,staff_profile_id,provider,tool,outcome,duration_ms) values (now() - interval '200 days',$1,'claude','get_context','ok',1)", [ADMIN]);
await db.exec("set role service_role");
await assert.rejects(() => db.query("select vppsone.ai_purge(7)"), /at least 30 days/);
const purged = await one("select vppsone.ai_purge(180) result");
assert.equal(purged.calls, 1);
assert.ok(purged.connections >= 1, "the never-redeemed grant is gone");
assert.equal(await conn(stale.connection), undefined);
console.log("PASS: purge keeps 180 days of calls and removes never-redeemed grants and unused clients");

/* -------------------------------------------------------------- grants */
await db.exec("reset role");
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => db.query("select * from vppsone.ai_tokens"), /permission denied/, `${role} reads tokens`);
  await assert.rejects(() => db.query("select vppsone.ai_resolve_access('x')"), /permission denied/, `${role} resolves tokens`);
  await assert.rejects(() => db.query("select vppsone.ai_register_client('client-zzzzzzzzzzzzzzzzzzzzzz','x',array['x'],'x','production',5,100,0)"), /permission denied/, `${role} registers`);
  await db.exec("reset role");
}
assert.equal(await one("select count(*)::int result from pg_policies where schemaname='vppsone' and tablename like 'ai\\_%'"), 0);
assert.equal(await one("select bool_and(relrowsecurity) result from pg_class where relnamespace='vppsone'::regnamespace and relname in ('ai_oauth_clients','ai_connections','ai_oauth_codes','ai_tokens','ai_tool_calls')"), true);
console.log("PASS: browser roles reach no table or function; RLS on with no policy");
