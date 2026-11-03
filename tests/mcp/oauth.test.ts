import { describe, expect, it } from "vitest";

import { base64url, isValidCodeVerifier, randomToken, s256, sha256Hex, verifyPkce } from "@/modules/mcp/domain/crypto";
import {
  handleAuthorizationServerMetadata,
  handleProtectedResourceMetadata,
  handleRegister,
  handleRevoke,
  handleToken,
  validateAuthorizeRequest,
} from "@/modules/mcp/domain/oauth";
import { canonicalOrigin, isOurResource } from "@/modules/mcp/domain/origin";
import { isLoopbackRedirect, PROVIDER_REDIRECTS, redirectProvider } from "@/modules/mcp/domain/redirects";
import { authorizationErrorUrl } from "@/modules/mcp/domain/consent";

import {
  ADMIN,
  authorizeQuery,
  CLAUDE_REDIRECT,
  CONFINED_ENV,
  connect,
  consent,
  exchange,
  MCP_URL,
  mcpRequest,
  ORIGIN,
  PROD_ENV,
  register,
  setup,
  tokenRequest,
  type Tokens,
} from "./harness";
import { handleMcp } from "@/modules/mcp/domain/mcp";

/* ---------------------------------------------------------------- PKCE */

describe("PKCE S256", () => {
  it("matches the RFC 7636 appendix B example", async () => {
    // Verifier and challenge from RFC 7636 Appendix B.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await s256(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(await verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
  });

  it("refuses a wrong verifier, a plain challenge and malformed input", async () => {
    const verifier = randomToken(48);
    const challenge = await s256(verifier);
    expect(await verifyPkce(randomToken(48), challenge)).toBe(false);
    expect(await verifyPkce(verifier, verifier.slice(0, 43))).toBe(false); // "plain" is never accepted
    expect(await verifyPkce("short", challenge)).toBe(false);
    expect(await verifyPkce(verifier, "not a challenge")).toBe(false);
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
  });

  it("makes 256-bit tokens and stores only a hex SHA-256", async () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
    expect(await sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(base64url(new Uint8Array([251, 255]))).toBe("-_8");
  });
});

/* ------------------------------------------------------------ redirects */

describe("redirect URIs match exactly", () => {
  it("accepts the provider callbacks verbatim", () => {
    for (const entry of PROVIDER_REDIRECTS) expect(redirectProvider(entry.uri, { allowLoopback: false })).toBe(entry.provider);
  });

  it.each([
    "https://claude.ai/api/mcp/auth_callback/",
    "https://claude.ai/api/mcp/auth_callback?x=1",
    "https://claude.ai/api/mcp/auth_callback#frag",
    "https://CLAUDE.ai/api/mcp/auth_callback",
    "http://claude.ai/api/mcp/auth_callback",
    "https://claude.ai.evil.com/api/mcp/auth_callback",
    "https://evil.com/https://claude.ai/api/mcp/auth_callback",
    "https://claude.ai:443/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callbac",
    "https://claude.ai/api/mcp/AUTH_CALLBACK",
    " https://claude.ai/api/mcp/auth_callback",
    "https://user@claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect/../evil",
    "https://chatgpt.com/connector/oauth/abc123",
    "https://chatgpt.com.evil.com/connector_platform_oauth_redirect",
  ])("refuses the near miss %s", (uri) => {
    expect(redirectProvider(uri, { allowLoopback: true })).toBeNull();
  });

  it("accepts loopback only when allowed, and only in canonical form", () => {
    expect(redirectProvider("http://localhost:3118/callback", { allowLoopback: false })).toBeNull();
    expect(redirectProvider("http://localhost:3118/callback", { allowLoopback: true })).toBe("local");
    expect(redirectProvider("http://127.0.0.1:51234/callback", { allowLoopback: true })).toBe("local");
    for (const bad of ["http://LOCALHOST:3118/callback", "https://localhost:3118/callback", "http://localhost:80@evil.com/", "http://localhost.evil.com:3118/cb", "http://127.0.0.2:3118/cb", "http://localhost:3118/cb#x", "http://[::1]:3118/cb"]) {
      expect(isLoopbackRedirect(bad), bad).toBe(false);
    }
  });

  it("registration refuses any redirect URI off the allowlist", async () => {
    const h = setup();
    const response = await handleRegister(
      new Request(`${ORIGIN}/api/mcp/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT, "https://evil.example/cb"] }),
      }),
      h.oauth,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_redirect_uri");
    expect(h.store.clients.size).toBe(0);
  });

  it("registration refuses loopback on production and accepts it on a confined deployment", async () => {
    const prod = setup({ env: PROD_ENV });
    await expect(register(prod, ["http://localhost:3118/callback"])).rejects.toThrow(/400/);
    const confined = setup({ env: CONFINED_ENV });
    await expect(register(confined, ["http://localhost:3118/callback"])).resolves.toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("registration is public-client only, caps names and rate-limits", async () => {
    const h = setup();
    const confidential = await handleRegister(
      new Request(`${ORIGIN}/api/mcp/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT], token_endpoint_auth_method: "client_secret_basic" }) }),
      h.oauth,
    );
    expect(confidential.status).toBe(400);

    const named = await handleRegister(
      new Request(`${ORIGIN}/api/mcp/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT], client_name: `‮evil${"x".repeat(300)}` }) }),
      h.oauth,
    );
    const body = (await named.json()) as { client_name: string; token_endpoint_auth_method: string };
    expect(body.client_name.length).toBeLessThanOrEqual(80);
    expect(body.client_name).not.toContain("‮");
    expect(body.token_endpoint_auth_method).toBe("none");

    for (let i = 0; i < 40; i += 1) await register(h).catch(() => undefined);
    expect(h.store.clients.size).toBe(30);
    await expect(register(h)).rejects.toThrow(/429/);
  });
});

/* ------------------------------------------------------------ authorize */

describe("the authorization request", () => {
  const RESOURCE = MCP_URL;

  async function client() {
    const h = setup();
    const clientId = await register(h);
    return { h, clientId, stored: await h.store.getClient(clientId) };
  }

  it("shows an error page — never a redirect — for an unknown client or an unregistered redirect URI", async () => {
    const { clientId, stored } = await client();
    const challenge = await s256(randomToken(48));
    expect(validateAuthorizeRequest(authorizeQuery({ client_id: "nope", redirect_uri: CLAUDE_REDIRECT, code_challenge: challenge }), null, { resource: RESOURCE, allowLoopback: false }))
      .toEqual({ kind: "show_error", reason: "unknown_client" });
    for (const redirect of ["https://evil.example/cb", "https://claude.ai/api/mcp/auth_callback/", "https://chatgpt.com/connector_platform_oauth_redirect"]) {
      expect(validateAuthorizeRequest(authorizeQuery({ client_id: clientId, redirect_uri: redirect, code_challenge: challenge }), stored, { resource: RESOURCE, allowLoopback: false }).kind).toBe("show_error");
    }
    const repeated = authorizeQuery({ client_id: clientId, redirect_uri: CLAUDE_REDIRECT, code_challenge: challenge });
    repeated.append("redirect_uri", "https://evil.example/cb");
    expect(validateAuthorizeRequest(repeated, stored, { resource: RESOURCE, allowLoopback: false })).toEqual({ kind: "show_error", reason: "bad_request" });
  });

  it("refuses a loopback redirect a confined deployment registered when production is asked", async () => {
    const h = setup({ env: CONFINED_ENV });
    const clientId = await register(h, ["http://localhost:3118/callback"]);
    const stored = await h.store.getClient(clientId);
    const query = authorizeQuery({ client_id: clientId, redirect_uri: "http://localhost:3118/callback", code_challenge: await s256(randomToken(48)) });
    expect(validateAuthorizeRequest(query, stored, { resource: RESOURCE, allowLoopback: false }).kind).toBe("show_error");
    expect(validateAuthorizeRequest(query, stored, { resource: RESOURCE, allowLoopback: true }).kind).toBe("ok");
  });

  it("sends protocol errors back to the validated redirect with state", async () => {
    const { clientId, stored } = await client();
    const base = { client_id: clientId, redirect_uri: CLAUDE_REDIRECT, state: "s1" };
    const cases: [Record<string, string>, string][] = [
      [{ ...base, response_type: "token", code_challenge: await s256(randomToken(48)) }, "unsupported_response_type"],
      [{ ...base, code_challenge_method: "plain", code_challenge: await s256(randomToken(48)) }, "invalid_request"],
      [{ ...base }, "invalid_request"],
      [{ ...base, code_challenge: await s256(randomToken(48)), resource: "https://evil.example/api/mcp" }, "invalid_target"],
      [{ ...base, code_challenge: await s256(randomToken(48)), scope: "one.read one.write" }, "invalid_scope"],
    ];
    for (const [params, error] of cases) {
      const decision = validateAuthorizeRequest(authorizeQuery(params), stored, { resource: RESOURCE, allowLoopback: false });
      expect(decision, error).toMatchObject({ kind: "redirect_error", redirectUri: CLAUDE_REDIRECT, error, state: "s1" });
    }
  });

  it("accepts the resource in canonical or upper-case-host form, never another", () => {
    expect(isOurResource(MCP_URL, MCP_URL)).toBe(true);
    expect(isOurResource("HTTPS://ONE.VPPS.CO.IN/api/mcp", MCP_URL)).toBe(true);
    expect(isOurResource(`${MCP_URL}/`, MCP_URL)).toBe(true);
    for (const bad of [`${MCP_URL}?x=1`, `${MCP_URL}#f`, "https://one.vpps.co.in/api/mcpx", "https://one.vpps.co.in", "https://vppsone.vercel.app/api/mcp"]) {
      expect(isOurResource(bad, MCP_URL), bad).toBe(false);
    }
  });

  it("passes state through and adds iss on success and on error", async () => {
    const h = setup();
    const clientId = await register(h);
    const { redirect } = await consent(h, ADMIN, clientId, { state: "opaque state ✓" });
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CLAUDE_REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("opaque state ✓");
    expect(redirect.searchParams.get("iss")).toBe(ORIGIN);
    expect(redirect.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const denied = new URL(authorizationErrorUrl(CLAUDE_REDIRECT, "access_denied", "no", "s2", ORIGIN));
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.get("state")).toBe("s2");
    expect(denied.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("stores only the code's hash, bound to the request, for 60 seconds, on a 90-day grant", async () => {
    const h = setup();
    const clientId = await register(h);
    const { code } = await consent(h, ADMIN, clientId);
    expect(h.store.codes.has(code)).toBe(false);
    const stored = h.store.codes.get(await sha256Hex(code))!;
    expect(stored).toMatchObject({ clientId, redirectUri: CLAUDE_REDIRECT, resource: MCP_URL });
    expect(stored.expiresAt - h.store.now).toBe(60_000);
    const connection = h.store.connections.get(stored.connectionId)!;
    expect(connection.expiresAt - connection.createdAt).toBe(90 * 86_400_000);
  });
});

/* ---------------------------------------------------------------- token */

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("the token endpoint", () => {
  it("exchanges a code once, with PKCE, for a 15-minute access token and a refresh token", async () => {
    const h = setup();
    const clientId = await register(h);
    const { code, verifier } = await consent(h, ADMIN, clientId);
    const response = await exchange(h, { code, verifier, clientId });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await json(response);
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 900, scope: "one.read" });
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only hashes at rest.
    expect(h.store.tokens.has(body.access_token as string)).toBe(false);
  });

  it("refuses a wrong verifier, and the code is then spent and its connection ended", async () => {
    const h = setup();
    const clientId = await register(h);
    const { code, verifier } = await consent(h, ADMIN, clientId);
    const wrong = await exchange(h, { code, verifier: randomToken(48), clientId });
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).error).toBe("invalid_grant");
    const retry = await exchange(h, { code, verifier, clientId });
    expect((await json(retry)).error).toBe("invalid_grant");
    expect([...h.store.connections.values()][0].revokedAt).not.toBeNull();
  });

  it("refuses a code for another client or redirect URI", async () => {
    const h = setup();
    const clientId = await register(h);
    const other = await register(h, ["https://chatgpt.com/connector_platform_oauth_redirect"]);
    const first = await consent(h, ADMIN, clientId);
    expect((await json(await exchange(h, { ...first, clientId: other, redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect" }))).error).toBe("invalid_grant");
    const second = await consent(h, ADMIN, clientId);
    expect((await json(await exchange(h, { ...second, clientId, redirectUri: "https://claude.com/api/mcp/auth_callback" }))).error).toBe("invalid_grant");
  });

  it("refuses an expired code (60 s)", async () => {
    const h = setup();
    const clientId = await register(h);
    const { code, verifier } = await consent(h, ADMIN, clientId);
    h.store.advance(61_000);
    expect((await json(await exchange(h, { code, verifier, clientId }))).error).toBe("invalid_grant");
  });

  it("treats a reused code as replay: refused, and the connection and every token from it revoked", async () => {
    const h = setup();
    const clientId = await register(h);
    const { code, verifier } = await consent(h, ADMIN, clientId);
    const first = (await json(await exchange(h, { code, verifier, clientId }))) as unknown as Tokens;
    const replay = await exchange(h, { code, verifier, clientId });
    expect(replay.status).toBe(400);
    expect((await json(replay)).error).toBe("invalid_grant");
    const connection = [...h.store.connections.values()][0];
    expect(connection.revokeReason).toBe("code_reuse");
    expect([...h.store.tokens.values()].every((token) => token.revokedAt !== null)).toBe(true);
    // The first exchange's access token no longer opens anything.
    const call = await handleMcp(mcpRequest(h, first.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp);
    expect(call.status).toBe(401);
  });

  it("lets exactly one of two concurrent redemptions win", async () => {
    const h = setup();
    const clientId = await register(h);
    const { code, verifier } = await consent(h, ADMIN, clientId);
    const responses = await Promise.all([exchange(h, { code, verifier, clientId }), exchange(h, { code, verifier, clientId })]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 400]);
    // Exactly one pair was ever issued; the loser's reuse then revoked it (RFC 6749 §4.1.2).
    expect([...h.store.tokens.values()].filter((token) => token.kind === "access")).toHaveLength(1);
    expect([...h.store.connections.values()][0].revokeReason).toBe("code_reuse");
  });

  it("rotates refresh tokens: the old one is spent, the new pair works", async () => {
    const h = setup();
    const tokens = await connect(h);
    h.store.advance(16 * 60_000);
    const refreshed = await handleToken(tokenRequest(h, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId }), h.oauth);
    expect(refreshed.status).toBe(200);
    const next = (await json(refreshed)) as unknown as Tokens;
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.access_token).not.toBe(tokens.access_token);
    const old = h.store.tokens.get(await sha256Hex(tokens.refresh_token))!;
    expect(old.usedAt).not.toBeNull();
    expect(old.replacedBy).toBe(h.store.tokens.get(await sha256Hex(next.refresh_token))!.id);
    const ping = await handleMcp(mcpRequest(h, next.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp);
    expect(ping.status).toBe(200);
  });

  it("treats a used refresh token as replay: the whole connection is revoked", async () => {
    const h = setup();
    const tokens = await connect(h);
    const refresh = () => handleToken(tokenRequest(h, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId }), h.oauth);
    const next = (await json(await refresh())) as unknown as Tokens;
    const replay = await refresh();
    expect(replay.status).toBe(400);
    expect((await json(replay)).error).toBe("invalid_grant");
    expect([...h.store.connections.values()][0].revokeReason).toBe("refresh_reuse");
    // The pair issued by the legitimate rotation is dead too.
    const stillWorks = await handleToken(tokenRequest(h, { grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: tokens.clientId }), h.oauth);
    expect((await json(stillWorks)).error).toBe("invalid_grant");
    expect((await handleMcp(mcpRequest(h, next.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp)).status).toBe(401);
  });

  it("lets one of two concurrent refreshes rotate and treats the other as replay", async () => {
    const h = setup();
    const tokens = await connect(h);
    const refresh = () => handleToken(tokenRequest(h, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId }), h.oauth);
    const statuses = (await Promise.all([refresh(), refresh()])).map((response) => response.status).sort();
    expect(statuses).toEqual([200, 400]);
    expect([...h.store.connections.values()][0].revokeReason).toBe("refresh_reuse");
  });

  it("never lets a refresh token outlive the 90-day grant", async () => {
    const h = setup();
    const tokens = await connect(h);
    const refreshTokenRow = h.store.tokens.get(await sha256Hex(tokens.refresh_token))!;
    const connection = h.store.connections.get(refreshTokenRow.connectionId)!;
    expect(refreshTokenRow.expiresAt).toBe(connection.expiresAt);
    h.store.advance(90 * 86_400_000 + 1000);
    const late = await handleToken(tokenRequest(h, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId }), h.oauth);
    expect((await json(late)).error).toBe("invalid_grant");
  });

  it("caps the last access token at the grant's end", async () => {
    const h = setup();
    const tokens = await connect(h);
    h.store.advance(90 * 86_400_000 - 5 * 60_000);
    const refreshed = (await json(await handleToken(tokenRequest(h, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId }), h.oauth))) as unknown as Tokens;
    expect(refreshed.expires_in).toBe(300);
  });

  it("refuses a refresh from another client without spending the token", async () => {
    const h = setup();
    const tokens = await connect(h);
    const other = await register(h);
    const wrong = await handleToken(tokenRequest(h, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: other }), h.oauth);
    expect((await json(wrong)).error).toBe("invalid_grant");
    const right = await handleToken(tokenRequest(h, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId }), h.oauth);
    expect(right.status).toBe(200);
  });

  it("answers RFC 6749 errors as no-store JSON", async () => {
    const h = setup();
    const clientId = await register(h);
    const unknownClient = await handleToken(tokenRequest(h, { grant_type: "authorization_code", client_id: "nope", code: "x" }), h.oauth);
    expect(unknownClient.status).toBe(401);
    expect((await json(unknownClient)).error).toBe("invalid_client");
    const grant = await handleToken(tokenRequest(h, { grant_type: "password", client_id: clientId }), h.oauth);
    expect((await json(grant)).error).toBe("unsupported_grant_type");
    expect(grant.headers.get("cache-control")).toBe("no-store");
    const target = await handleToken(tokenRequest(h, { grant_type: "authorization_code", client_id: clientId, resource: "https://evil.example/api/mcp" }), h.oauth);
    expect((await json(target)).error).toBe("invalid_target");
    const asJson = await handleToken(new Request(`${ORIGIN}/api/mcp/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), h.oauth);
    expect((await json(asJson)).error).toBe("invalid_request");
    const twice = await handleToken(new Request(`${ORIGIN}/api/mcp/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=refresh_token&client_id=${clientId}&client_id=x` }), h.oauth);
    expect((await json(twice)).error).toBe("invalid_request");
  });
});

/* --------------------------------------------------------- revocation */

describe("RFC 7009 revocation", () => {
  it("revoking the refresh token ends the grant; another client's request changes nothing", async () => {
    const h = setup();
    const tokens = await connect(h);
    const other = await register(h);
    const revoke = (clientId: string) =>
      handleRevoke(new Request(`${ORIGIN}/api/mcp/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.refresh_token, client_id: clientId }).toString() }), h.oauth);
    expect((await revoke(other)).status).toBe(200);
    expect([...h.store.connections.values()][0].revokedAt).toBeNull();
    expect((await revoke(tokens.clientId)).status).toBe(200);
    expect([...h.store.connections.values()][0].revokeReason).toBe("revoked_by_client");
    expect((await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp)).status).toBe(401);
  });
});

/* ------------------------------------------------------------- metadata */

describe("discovery metadata", () => {
  it("names the canonical resource and issuer on production whatever the Host", async () => {
    const response = handleProtectedResourceMetadata(new Request("https://forged.example/.well-known/oauth-protected-resource/api/mcp"), { env: PROD_ENV });
    expect(await response.json()).toEqual({
      resource: MCP_URL,
      authorization_servers: [ORIGIN],
      scopes_supported: ["one.read"],
      bearer_methods_supported: ["header"],
      resource_name: "VPPS One",
    });
    const as = (await handleAuthorizationServerMetadata(new Request("https://forged.example/.well-known/oauth-authorization-server"), { env: PROD_ENV }).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/mcp/authorize`,
      token_endpoint: `${ORIGIN}/api/mcp/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/mcp/oauth/register`,
      revocation_endpoint: `${ORIGIN}/api/mcp/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(as).not.toHaveProperty("client_id_metadata_document_supported");
  });

  it("uses a confined deployment's own origin only when it is its own", () => {
    expect(canonicalOrigin("https://vppsone-git-x.vercel.app/x", CONFINED_ENV)).toBe("https://vppsone-git-x.vercel.app");
    expect(canonicalOrigin("http://localhost:3000/x", CONFINED_ENV)).toBe("http://localhost:3000");
    expect(canonicalOrigin("https://evil.example/x", CONFINED_ENV)).toBeNull();
    expect(canonicalOrigin("https://evil.example/x", PROD_ENV)).toBe(ORIGIN);
    expect(handleProtectedResourceMetadata(new Request("https://evil.example/.well-known/oauth-protected-resource"), { env: CONFINED_ENV }).status).toBe(404);
  });
});
