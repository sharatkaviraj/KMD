import type { Provider } from "@/modules/mcp/domain/redirects";

/**
 * What the core needs from durable storage. The production implementation is
 * One's Postgres (`src/modules/mcp/data/store.ts`, SQL functions in
 * `supabase/migrations/20261103150000_ai_connection_mcp.sql`); the tests use an
 * in-memory twin with the same single-use semantics
 * (`tests/mcp/fake-store.ts`).
 *
 * Every method that decides single use — `exchangeCode`, `rotateRefresh` —
 * must be atomic in the store: the core never reads a row, decides, and then
 * writes. Nothing here may be served from a cache.
 */

export type OAuthClient = {
  clientId: string;
  clientName: string | null;
  redirectUris: readonly string[];
};

export type ConnectionRow = {
  id: string;
  staffProfileId: string;
  authUserId: string;
  clientId: string;
  provider: Provider;
  scopes: readonly string[];
  expiresAt: string;
  revokedAt: string | null;
};

export type AccessRow = {
  kind: "access" | "refresh";
  resource: string;
  scopes: readonly string[];
  expiresAt: string;
  revokedAt: string | null;
  connection: ConnectionRow;
};

export type IssuedTokens = {
  status: "ok";
  connectionId: string;
  scopes: readonly string[];
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

/** `replayed`: the code or refresh token had been used; the store has revoked the whole connection. */
export type RedeemResult = IssuedTokens | { status: "invalid" } | { status: "replayed" };

export type ToolCallRow = {
  staffProfileId: string;
  connectionId: string;
  provider: Provider;
  /** A registry name or `unknown` — never client text. */
  tool: string;
  /** `ok`, `refused:<reason>` or `error:<code>`. */
  outcome: string;
  rowCount: number | null;
  durationMs: number;
};

export type RevokeReason =
  | "disconnected_by_self"
  | "disconnected_by_admin"
  | "staff_disabled"
  | "inactive"
  | "not_eligible"
  | "test_not_admin"
  | "qa_account"
  | "staff_mismatch"
  | "revoked_by_client";

export interface McpStore {
  /** RFC 7591 registration, rate-limited inside the store. */
  registerClient(input: { clientId: string; clientName: string | null; redirectUris: readonly string[]; maxPerHour: number }): Promise<{ ok: true } | { ok: false; reason: "rate_limited" }>;
  getClient(clientId: string): Promise<OAuthClient | null>;

  /** Consent: connection (≤ `grantDays`) and its single-use code (`codeTtlSeconds`), atomically. */
  createGrant(input: {
    staffProfileId: string;
    authUserId: string;
    clientId: string;
    provider: Provider;
    scopes: readonly string[];
    codeHash: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
    codeTtlSeconds: number;
    grantDays: number;
  }): Promise<{ ok: true; connectionId: string } | { ok: false; reason: string }>;

  /**
   * Consume a code and issue the first pair, atomically. The store compares
   * the code's bound client, redirect URI, S256 challenge and resource with
   * what is presented (`verifierChallenge` is S256 of the presented verifier).
   */
  exchangeCode(input: {
    codeHash: string;
    verifierChallenge: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    accessHash: string;
    refreshHash: string;
    accessTtlSeconds: number;
  }): Promise<RedeemResult>;

  /** Mark the presented refresh token used and issue a new pair, atomically. */
  rotateRefresh(input: {
    /** Hash of the refresh token presented. */
    presentedHash: string;
    clientId: string;
    resource: string;
    /** Hashes of the new pair. */
    accessHash: string;
    refreshHash: string;
    accessTtlSeconds: number;
  }): Promise<RedeemResult>;

  /** Steps 1–2 of every call: a token by hash, with its connection. */
  resolveToken(tokenHash: string): Promise<AccessRow | null>;

  /** RFC 7009: only for the client the token was issued to. */
  revokeToken(tokenHash: string, clientId: string): Promise<void>;
  revokeConnection(connectionId: string, reason: RevokeReason, byStaffProfileId?: string | null): Promise<void>;
  revokeStaffConnections(staffProfileId: string, reason: RevokeReason, byStaffProfileId?: string | null): Promise<number>;

  /** The `ai_connection` runtime flag. Absent, unreadable or failing is `false`. */
  killSwitchOn(): Promise<boolean>;
  /** Calls in the last hour and 24 hours, from the log. */
  callCounts(staffProfileId: string): Promise<{ hour: number; day: number }>;
  logToolCall(row: ToolCallRow): Promise<void>;
}
