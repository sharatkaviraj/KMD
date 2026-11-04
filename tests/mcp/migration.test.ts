import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The SQL half of the security contract, read from the migration itself. The
 * in-memory store in `fake-store.ts` mirrors these functions; this pins that
 * the real ones keep the properties the fake assumes.
 */
const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261103150000_ai_connection_mcp.sql"), "utf8").replace(/\r\n/g, "\n");
const statements = sql.replace(/--[^\n]*/g, "");

function body(name: string): string {
  const start = statements.indexOf(`create function vppsone.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const open = statements.indexOf("$$", start);
  return statements.slice(open, statements.indexOf("$$;", open + 2));
}

const TABLES = ["ai_oauth_clients", "ai_connections", "ai_oauth_codes", "ai_tokens", "ai_tool_calls"];
const FUNCTIONS = [
  "ai_register_client",
  "ai_revoke_connection",
  "ai_create_grant",
  "ai_exchange_code",
  "ai_rotate_refresh",
  "ai_resolve_access",
  "ai_revoke_token",
  "ai_revoke_staff_connections",
  "ai_call_counts",
  "ai_staff_for_user",
  "ai_connection_list",
  "ai_purge",
];

describe("the AI connection migration", () => {
  it("creates everything in vppsone and nothing elsewhere", () => {
    for (const match of statements.matchAll(/create\s+(?:table|function|index|policy|view)\s+(?:if not exists\s+)?([a-z_.]+)/gi)) {
      const name = match[1];
      if (/^ai_[a-z_]+$/.test(name)) continue; // index names
      expect(name, match[0]).toMatch(/^vppsone\./);
    }
  });

  it.each(TABLES)("%s: RLS on, no policy, no grant to browser roles, service role only", (table) => {
    expect(statements).toContain(`alter table vppsone.${table} enable row level security;`);
    expect(statements).not.toMatch(new RegExp(`create policy[^;]*on vppsone\\.${table}`, "i"));
    expect(statements).toMatch(new RegExp(`revoke all on [^;]*vppsone\\.${table}[^;]* from public, anon, authenticated;`));
    expect(statements).not.toMatch(new RegExp(`grant [^;]*on [^;]*vppsone\\.${table}[^;]* to [^;]*(anon|authenticated)`));
  });

  it.each(FUNCTIONS)("%s is executable by service_role only", (fn) => {
    expect(statements).toMatch(new RegExp(`revoke all on function vppsone\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
    expect(statements).toMatch(new RegExp(`grant execute on function vppsone\\.${fn}\\([^)]*\\) to service_role;`));
    expect(statements).not.toMatch(new RegExp(`grant execute on function vppsone\\.${fn}\\([^)]*\\) to [^;]*(anon|authenticated)`));
  });

  it("stores hashes, never token text", () => {
    expect(statements).toMatch(/code_hash text primary key check \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(statements).toMatch(/token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(statements).not.toMatch(/\b(access_token|refresh_token|client_secret)\b\s+text/);
  });

  it("decides single use under a row lock and revokes the grant on reuse", () => {
    const exchange = body("ai_exchange_code");
    expect(exchange).toMatch(/where code_hash = p_code_hash for update/);
    expect(exchange).toMatch(/if v_code\.used_at is not null then\s+perform vppsone\.ai_revoke_connection\(v_code\.connection_id, 'code_reuse'/);
    expect(exchange.indexOf("set used_at = now()")).toBeLessThan(exchange.indexOf("insert into vppsone.ai_tokens"));
    expect(exchange).toMatch(/code_challenge is distinct from p_verifier_challenge/);

    const rotate = body("ai_rotate_refresh");
    expect(rotate).toMatch(/for update/);
    expect(rotate).toMatch(/if v_old\.used_at is not null then\s+perform vppsone\.ai_revoke_connection\(v_old\.connection_id, 'refresh_reuse'/);
    expect(rotate).toMatch(/v_conn\.expires_at\)\s+returning id into v_new/);
  });

  it("makes consent a pending grant and activates it only on redemption, serialised per staff member and provider (L5)", () => {
    const grant = body("ai_create_grant");
    expect(grant).not.toMatch(/ai_revoke_connection|'replaced'/);
    expect(grant).not.toMatch(/activated_at/);
    const exchange = body("ai_exchange_code");
    const lock = exchange.indexOf("pg_advisory_xact_lock(hashtext('vppsone:ai-connection:'");
    expect(lock).toBeGreaterThan(-1);
    // Re-read after the lock, then end the others, then activate, then issue.
    const reread = exchange.indexOf("select * into v_conn", lock);
    const replaced = exchange.indexOf("'replaced'", lock);
    const activate = exchange.indexOf("set activated_at = now()", lock);
    const issue = exchange.indexOf("insert into vppsone.ai_tokens", lock);
    expect(reread).toBeGreaterThan(lock);
    expect(replaced).toBeGreaterThan(reread);
    expect(activate).toBeGreaterThan(replaced);
    expect(issue).toBeGreaterThan(activate);
    expect(body("ai_connection_list")).toMatch(/where c\.activated_at is not null/);
    expect(body("ai_purge")).toMatch(/activated_at is null and created_at < now\(\) - interval '1 day'/);
  });

  it("limits registration per hashed source and per environment, reusing recent identical clients (M1)", () => {
    const register = body("ai_register_client");
    expect(register).toContain("pg_advisory_xact_lock(hashtext('vppsone:ai-register:' || p_environment))");
    expect(register).toMatch(/and source_hash = p_source_hash\s+and redirect_uris = p_redirect_uris\s+and created_at > now\(\) - make_interval\(secs => p_reuse_seconds\)/);
    expect(register).toMatch(/v_source >= p_max_per_source or v_recent >= p_max_per_hour/);
    expect(register).toMatch(/where environment = p_environment and created_at > now\(\) - interval '1 hour'/);
    expect(statements).toContain("source_hash text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$')");
    expect(statements).toContain("environment text not null check (environment in ('production', 'preview'))");
    expect(body("ai_purge")).toMatch(/update vppsone\.ai_oauth_clients set source_hash = null/);
  });

  it("counts refused calls toward the limit and reports rate-limit refusals separately (L4)", () => {
    const counts = body("ai_call_counts");
    expect(counts).toContain("'hour', count(*) filter (where created_at > now() - interval '1 hour' and outcome <> 'refused:rate_limited')");
    expect(counts).toContain("'limited_hour', count(*) filter (where created_at > now() - interval '1 hour' and outcome = 'refused:rate_limited')");
    // Refusals of every other kind are rows like any other call: they count.
    expect(counts).not.toMatch(/outcome = 'ok'|like 'refused:%'/);
  });

  it("caps every grant at 90 days and every code at 5 minutes in the table itself", () => {
    expect(statements).toContain("expires_at <= created_at + interval '90 days'");
    expect(statements).toContain("expires_at <= created_at + interval '5 minutes'");
  });

  it("logs metadata only", () => {
    const table = statements.slice(statements.indexOf("create table vppsone.ai_tool_calls"), statements.indexOf(");", statements.indexOf("create table vppsone.ai_tool_calls")));
    const columns = [...table.matchAll(/^\s+([a-z_]+)\s+(?:bigint|timestamptz|uuid|text|integer)/gm)].map((match) => match[1]);
    expect(columns).toEqual(["id", "created_at", "staff_profile_id", "connection_id", "provider", "tool", "outcome", "row_count", "duration_ms"]);
  });

  it("adds the kill switch OFF, the way D-359 widened the key check", () => {
    expect(statements).toMatch(/runtime_flags_key_known check \([\s\S]*'aisensy_month_plan_cap',\n\s+'ai_connection'\n/);
    expect(statements).toMatch(/'ai_connection', false, null,/);
  });

  it("keeps a used refresh token while its grant could still be used, so replay is recognised", () => {
    const purge = body("ai_purge");
    expect(purge).toContain("delete from vppsone.ai_tool_calls where created_at < now() - make_interval(days => p_keep_days)");
    expect(purge).toMatch(/where expires_at < now\(\) - interval '1 day'\s+or \(revoked_at is not null/);
    expect(purge).toContain("p_keep_days < 30");
  });
});
