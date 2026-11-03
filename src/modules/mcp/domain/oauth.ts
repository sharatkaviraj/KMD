import { z } from "zod";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_SCOPES,
  CLIENT_ID_BYTES,
  LIMITS,
  REGISTRATIONS_PER_HOUR,
  RESOURCE_SCOPES,
} from "@/modules/mcp/domain/constants";
import { isValidCodeVerifier, isValidS256Challenge, randomToken, s256, sha256Hex } from "@/modules/mcp/domain/crypto";
import { json, methodNotAllowed, NO_STORE, oauthError, readBody, readForm, mediaType, singleParams } from "@/modules/mcp/domain/http";
import {
  authorizationServerMetadata,
  canonicalOrigin,
  endpointsFor,
  isOurResource,
  protectedResourceMetadata,
  type DeploymentEnv,
} from "@/modules/mcp/domain/origin";
import { redirectProvider, type Provider } from "@/modules/mcp/domain/redirects";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import type { McpStore, OAuthClient, RedeemResult } from "@/modules/mcp/domain/store";

/**
 * One's own small OAuth 2.1 authorization server for the MCP endpoint (plan
 * §5.2 option B). Each handler takes a Web `Request` and returns a Web
 * `Response`; storage and the environment are injected, so the Next.js route
 * files are one-line adapters and the same code could run in a Worker.
 */

export type OAuthDeps = {
  store: McpStore;
  env: DeploymentEnv;
  /** Server time; injectable for tests. */
  now?: () => number;
};

const CORS_PUBLIC = { "Access-Control-Allow-Origin": "*" } as const;

function unknownHost(): Response {
  return json({ error: "invalid_request", error_description: "This host does not serve the AI connection." }, 404);
}

/* ------------------------------------------------------------- metadata */

/** RFC 9728, at the bare well-known path and with `/api/mcp` appended. */
export function handleProtectedResourceMetadata(request: Request, deps: Pick<OAuthDeps, "env">): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  const origin = canonicalOrigin(request.url, deps.env);
  if (!origin) return unknownHost();
  return json(protectedResourceMetadata(origin), 200, CORS_PUBLIC);
}

/** RFC 8414. */
export function handleAuthorizationServerMetadata(request: Request, deps: Pick<OAuthDeps, "env">): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  const origin = canonicalOrigin(request.url, deps.env);
  if (!origin) return unknownHost();
  return json(authorizationServerMetadata(origin), 200, CORS_PUBLIC);
}

/* --------------------------------------------------------- registration */

const RegistrationSchema = z.object({
  redirect_uris: z.array(z.string().max(LIMITS.redirectUri)).min(1).max(LIMITS.redirectUris),
  client_name: z.string().max(400).optional(),
  token_endpoint_auth_method: z.string().max(64).optional(),
  grant_types: z.array(z.string().max(64)).max(5).optional(),
  response_types: z.array(z.string().max(64)).max(5).optional(),
  scope: z.string().max(LIMITS.scope).optional(),
});

/** Display text only: control characters removed, trimmed, capped. */
export function cleanClientName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f) && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069)) out += ch;
  }
  const trimmed = out.trim().slice(0, LIMITS.clientName);
  return trimmed || null;
}

/**
 * RFC 7591 dynamic registration, public clients only. Every redirect URI
 * must be on the allowlist (`redirects.ts`): the three provider callbacks
 * everywhere, loopback only on a confined deployment. Unknown metadata is
 * ignored, as the RFC asks; registrations are capped per hour in the store.
 */
export async function handleRegister(request: Request, deps: OAuthDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!canonicalOrigin(request.url, deps.env)) return unknownHost();
  if (mediaType(request) !== "application/json") return oauthError("invalid_client_metadata", "Send application/json.");
  const text = await readBody(request);
  if (text === null) return oauthError("invalid_client_metadata", "Request too large.");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "Body is not JSON.");
  }
  const parsed = RegistrationSchema.safeParse(raw);
  if (!parsed.success) return oauthError("invalid_client_metadata", "redirect_uris (1–5 strings) is required; other fields must be well formed.");
  const meta = parsed.data;

  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== "none") {
    return oauthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method \"none\") are supported.");
  }
  if (meta.grant_types && (!meta.grant_types.includes("authorization_code") || meta.grant_types.some((g) => g !== "authorization_code" && g !== "refresh_token"))) {
    return oauthError("invalid_client_metadata", "grant_types may be authorization_code and refresh_token only.");
  }
  if (meta.response_types && meta.response_types.some((r) => r !== "code")) {
    return oauthError("invalid_client_metadata", "response_types may be code only.");
  }
  if (meta.scope !== undefined && parseScopes(meta.scope) === null) {
    return oauthError("invalid_client_metadata", "Unknown scope.");
  }

  const allowLoopback = isConfinedDeployment(deps.env);
  const unique = [...new Set(meta.redirect_uris)];
  if (unique.some((uri) => redirectProvider(uri, { allowLoopback }) === null)) {
    return oauthError("invalid_redirect_uri", "A redirect URI is not one this server accepts.");
  }

  const clientId = randomToken(CLIENT_ID_BYTES);
  const clientName = cleanClientName(meta.client_name);
  const stored = await deps.store.registerClient({ clientId, clientName, redirectUris: unique, maxPerHour: REGISTRATIONS_PER_HOUR });
  if (!stored.ok) return json({ error: "temporarily_unavailable", error_description: "Too many registrations; try again later." }, 429, { "Retry-After": "600" });

  const issuedAt = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  return json(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      ...(clientName ? { client_name: clientName } : {}),
      redirect_uris: unique,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: RESOURCE_SCOPES.join(" "),
    },
    201,
  );
}

/* ------------------------------------------------------------ authorize */

/** Space-separated scopes, each one the server knows; null when any is not. */
export function parseScopes(value: string): string[] | null {
  if (value.length > LIMITS.scope) return null;
  const parts = value.split(" ").filter(Boolean);
  if (parts.some((scope) => !(AUTHORIZATION_SCOPES as readonly string[]).includes(scope))) return null;
  return [...new Set(parts)];
}

export type AuthorizeRequest = {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  provider: Provider;
  codeChallenge: string;
  state: string | null;
  /** What the connection is granted: the resource scopes. */
  scopes: string[];
  resource: string;
};

export type AuthorizeDecision =
  | { kind: "ok"; request: AuthorizeRequest }
  /** Shown as a page. The redirect URI was not validated, so nothing is sent to it. */
  | { kind: "show_error"; reason: "bad_request" | "unknown_client" | "bad_redirect" }
  /** The redirect URI is validated; the error goes back to it with `state` and `iss`. */
  | { kind: "redirect_error"; redirectUri: string; error: string; description: string; state: string | null };

/**
 * Validate an authorization request (RFC 6749 §4.1.1, OAuth 2.1, RFC 7636,
 * RFC 8707). The client and the exact redirect URI come first: until both are
 * proven, an error is a page in One, never a redirect (§4.1.2.1). The
 * redirect URI is checked against the allowlist again here, because the
 * client table is shared by every deployment of this database.
 */
export function validateAuthorizeRequest(
  query: URLSearchParams,
  client: OAuthClient | null,
  context: { resource: string; allowLoopback: boolean },
): AuthorizeDecision {
  const params = singleParams(query);
  if (!params) return { kind: "show_error", reason: "bad_request" };

  const clientId = params.get("client_id");
  if (!clientId || !client || client.clientId !== clientId) return { kind: "show_error", reason: "unknown_client" };

  const redirectUri = params.get("redirect_uri");
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) return { kind: "show_error", reason: "bad_redirect" };
  const provider = redirectProvider(redirectUri, { allowLoopback: context.allowLoopback });
  if (!provider) return { kind: "show_error", reason: "bad_redirect" };

  const rawState = params.get("state");
  const state = rawState === undefined ? null : rawState;
  const fail = (error: string, description: string): AuthorizeDecision => ({
    kind: "redirect_error",
    redirectUri,
    error,
    description,
    state: state !== null && state.length <= LIMITS.state ? state : null,
  });

  if (state !== null && state.length > LIMITS.state) return fail("invalid_request", "state is too long.");
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (params.get("code_challenge_method") !== "S256") return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  const codeChallenge = params.get("code_challenge");
  if (!isValidS256Challenge(codeChallenge)) return fail("invalid_request", "code_challenge must be an S256 challenge.");

  const resource = params.get("resource");
  if (resource !== undefined && !isOurResource(resource, context.resource)) {
    return fail("invalid_target", "resource must be this server's MCP URL.");
  }

  const scopeParam = params.get("scope");
  if (scopeParam !== undefined && parseScopes(scopeParam) === null) return fail("invalid_scope", "Unknown scope requested.");

  return {
    kind: "ok",
    request: {
      clientId,
      clientName: client.clientName,
      redirectUri,
      provider,
      codeChallenge,
      state,
      scopes: [...RESOURCE_SCOPES],
      resource: context.resource,
    },
  };
}

/* ---------------------------------------------------------------- token */

function tokenResponse(result: RedeemResult, accessToken: string, refreshToken: string, now: number): Response {
  if (result.status !== "ok") {
    return oauthError(
      "invalid_grant",
      result.status === "replayed"
        ? "This grant was already used, so the connection has been revoked. Connect again from One."
        : "The authorization code or refresh token is invalid, expired or revoked.",
    );
  }
  const expiresIn = Math.max(1, Math.floor((Date.parse(result.accessExpiresAt) - now) / 1000));
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope: result.scopes.filter((scope) => (RESOURCE_SCOPES as readonly string[]).includes(scope)).join(" "),
  });
}

/**
 * The token endpoint: `authorization_code` with S256 PKCE, and
 * `refresh_token` with rotation. Single use, replay detection and the
 * resulting revocation all happen inside one store call each, so two racing
 * requests cannot both succeed. Errors are RFC 6749 §5.2 JSON, `no-store`;
 * a dead code or refresh token is `invalid_grant`, which is what Claude and
 * ChatGPT look for before asking the person to sign in again.
 */
export async function handleToken(request: Request, deps: OAuthDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const origin = canonicalOrigin(request.url, deps.env);
  if (!origin) return unknownHost();
  const { resource } = endpointsFor(origin);
  const now = deps.now?.() ?? Date.now();

  const form = await readForm(request);
  if (!form) return oauthError("invalid_request", "Send one application/x-www-form-urlencoded body with each parameter once.");

  const clientId = form.get("client_id");
  if (!clientId || clientId.length > 64) return oauthError("invalid_client", "client_id is required.", 401);
  const client = await deps.store.getClient(clientId);
  if (!client) return oauthError("invalid_client", "Unknown client.", 401);

  const requestedResource = form.get("resource");
  if (requestedResource !== undefined && !isOurResource(requestedResource, resource)) {
    return oauthError("invalid_target", "resource must be this server's MCP URL.");
  }

  const grantType = form.get("grant_type");
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const [accessHash, refreshHash] = await Promise.all([sha256Hex(accessToken), sha256Hex(refreshToken)]);

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const verifier = form.get("code_verifier");
    if (!code || code.length > LIMITS.code || !redirectUri || redirectUri.length > LIMITS.redirectUri) {
      return oauthError("invalid_request", "code and redirect_uri are required.");
    }
    if (!isValidCodeVerifier(verifier)) return oauthError("invalid_request", "A PKCE code_verifier is required.");
    const result = await deps.store.exchangeCode({
      codeHash: await sha256Hex(code),
      verifierChallenge: await s256(verifier),
      clientId,
      redirectUri,
      resource,
      accessHash,
      refreshHash,
      accessTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    });
    return tokenResponse(result, accessToken, refreshToken, now);
  }

  if (grantType === "refresh_token") {
    const presented = form.get("refresh_token");
    if (!presented || presented.length > LIMITS.token) return oauthError("invalid_request", "refresh_token is required.");
    const scope = form.get("scope");
    if (scope !== undefined && parseScopes(scope) === null) return oauthError("invalid_scope", "Unknown scope requested.");
    const result = await deps.store.rotateRefresh({
      presentedHash: await sha256Hex(presented),
      clientId,
      resource,
      accessHash,
      refreshHash,
      accessTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    });
    return tokenResponse(result, accessToken, refreshToken, now);
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/* ----------------------------------------------------------- revocation */

/**
 * RFC 7009. Always 200 for a well-formed request, whether or not the token
 * existed or belonged to this client, so the endpoint tells a caller nothing.
 */
export async function handleRevoke(request: Request, deps: OAuthDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!canonicalOrigin(request.url, deps.env)) return unknownHost();
  const form = await readForm(request);
  if (!form) return oauthError("invalid_request", "Send one application/x-www-form-urlencoded body with each parameter once.");
  const token = form.get("token");
  const clientId = form.get("client_id");
  if (!token || token.length > LIMITS.token) return oauthError("invalid_request", "token is required.");
  if (!clientId || clientId.length > 64) return oauthError("invalid_client", "client_id is required.", 401);
  await deps.store.revokeToken(await sha256Hex(token), clientId);
  return new Response(null, { status: 200, headers: NO_STORE });
}
