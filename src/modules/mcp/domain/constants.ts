/**
 * The AI connection's fixed numbers and paths, in one place (plan
 * `docs/plans/2026-11-03-mcp-feasibility.md` §5, owner decisions §9).
 *
 * Everything under `src/modules/mcp/domain/` is the portable core: Web
 * `Request`/`Response`, Web Crypto and injected dependencies only — no
 * Next.js, no Supabase — so the same functions could run behind a
 * Cloudflare Worker later (§8.2). `tests/architecture.test.ts` holds the
 * no-database half of that rule for every `domain/` folder.
 */

/** The MCP endpoint. Its absolute URL on the canonical origin is the OAuth `resource`. */
export const MCP_PATH = "/api/mcp";
/** The consent page: a One page behind the normal sign-in. */
export const AUTHORIZE_PATH = "/mcp/authorize";
export const TOKEN_PATH = "/api/mcp/oauth/token";
export const REGISTER_PATH = "/api/mcp/oauth/register";
export const REVOKE_PATH = "/api/mcp/oauth/revoke";
/** RFC 9728. Served bare and with the MCP path appended (`…/api/mcp`). */
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
/** RFC 8414. The issuer is the bare origin, so the document is at the root. */
export const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";

/** Access tokens: 15 minutes (§5.4). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Authorization codes: single use, 60 seconds. */
export const CODE_TTL_SECONDS = 60;
/** Re-consent every 90 days (D8). A refresh token never outlives its grant. */
export const GRANT_DAYS = 90;

/** Random bytes in every code and token: 256 bits, base64url (43 characters). */
export const TOKEN_BYTES = 32;
/** A client id: 192 bits, base64url (32 characters). */
export const CLIENT_ID_BYTES = 24;

/** What the MCP endpoint (the resource) understands. Read-only in this slice. */
export const RESOURCE_SCOPES = ["one.read"] as const;
export type ResourceScope = (typeof RESOURCE_SCOPES)[number];
/**
 * What the authorization server accepts in a request. `offline_access` is
 * listed so a client that asks for it (Claude appends it when advertised) is
 * not refused; refresh tokens are issued either way, within the grant.
 * The protected-resource document lists only `RESOURCE_SCOPES` — the MCP
 * authorization spec says a resource should not advertise `offline_access`.
 */
export const AUTHORIZATION_SCOPES = [...RESOURCE_SCOPES, "offline_access"] as const;

/**
 * Protocol versions this server speaks, newest first. All three use the
 * `initialize` handshake. 2026-07-28 (no `initialize`, per-request metadata)
 * is not implemented: a request that names it gets `400`, which that
 * revision's clients read as "fall back to initialize".
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
/** What a request with no `MCP-Protocol-Version` header is assumed to be (2025-06-18 spec). */
export const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

/** Per staff member (§5.5): AI traffic must never compete with the desk. */
export const RATE_LIMITS = { perHour: 60, perDay: 400 } as const;
/**
 * Dynamic registration limits, counted separately for production and for
 * Previews (they share the database): new clients per source (hashed client
 * IP) an hour, under a ceiling per hour for the environment. The same source
 * asking for the same redirect set within the reuse window gets its existing
 * client back instead of a new one.
 */
export const REGISTRATIONS_PER_SOURCE_HOUR = 5;
export const REGISTRATIONS_PER_HOUR = 100;
export const REGISTRATION_REUSE_SECONDS = 10 * 60;

/** Request bodies larger than this are refused before parsing. */
export const MAX_BODY_BYTES = 64 * 1024;
/** JSON-RPC batch size (2025-03-26 allowed batches; later versions do not send them). */
export const MAX_BATCH = 10;
/** A tool result is cut well under Claude's ~150,000-character limit (C11). */
export const MAX_RESULT_CHARS = 60_000;

/** Lengths a client controls. */
export const LIMITS = {
  clientName: 80,
  redirectUri: 512,
  redirectUris: 5,
  state: 1024,
  scope: 200,
  resource: 512,
  code: 128,
  token: 128,
} as const;

export const SERVER_INFO = { name: "vpps-one", title: "VPPS One", version: "1.0.0" } as const;
