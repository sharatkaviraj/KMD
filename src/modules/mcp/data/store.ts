import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import type { Provider } from "@/modules/mcp/domain/redirects";
import type { AccessRow, McpStore, OAuthClient, RedeemResult } from "@/modules/mcp/domain/store";

/**
 * The store in One's Postgres. Every decision about single use, replay and
 * revocation is one SQL function, so it is one transaction
 * (`supabase/migrations/20261103150000_ai_connection_mcp.sql`). The service
 * role is the only caller; RLS has no policy for any browser role.
 */

type ConnectionJson = {
  id: string;
  staff_profile_id: string;
  auth_user_id: string;
  client_id: string;
  provider: Provider;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
};

type AccessJson = {
  kind: "access" | "refresh";
  resource: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  connection: ConnectionJson;
};

type RedeemJson = {
  status: "ok" | "invalid" | "replayed";
  connection_id?: string;
  scopes?: string[];
  access_expires_at?: string;
  refresh_expires_at?: string;
};

function toRedeem(data: unknown): RedeemResult {
  const row = (data ?? {}) as RedeemJson;
  if (row.status === "ok" && row.connection_id && row.access_expires_at && row.refresh_expires_at) {
    return {
      status: "ok",
      connectionId: row.connection_id,
      scopes: row.scopes ?? [],
      accessExpiresAt: row.access_expires_at,
      refreshExpiresAt: row.refresh_expires_at,
    };
  }
  return { status: row.status === "replayed" ? "replayed" : "invalid" };
}

function fail(what: string): never {
  throw new Error(`AI connection store: could not ${what}.`);
}

export function createSupabaseMcpStore(): McpStore {
  const db = () => createAdminClient();

  return {
    async registerClient(input) {
      const { data, error } = await db().rpc("ai_register_client", {
        p_client_id: input.clientId,
        p_client_name: input.clientName,
        p_redirect_uris: [...input.redirectUris],
        p_source_hash: input.sourceHash,
        p_environment: input.environment,
        p_max_per_source: input.maxPerSourceHour,
        p_max_per_hour: input.maxPerHour,
        p_reuse_seconds: input.reuseSeconds,
      });
      if (error) fail("register the client");
      const row = (data ?? {}) as { ok?: boolean; reused?: boolean; client_id?: string; client_name?: string | null; created_at?: string };
      if (row.ok !== true || !row.client_id || !row.created_at) return { ok: false, reason: "rate_limited" };
      return {
        ok: true,
        reused: row.reused === true,
        client: { clientId: row.client_id, clientName: row.client_name ?? null, redirectUris: input.redirectUris, createdAt: row.created_at },
      };
    },

    async getClient(clientId) {
      const { data, error } = await db()
        .from("ai_oauth_clients")
        .select("client_id, client_name, redirect_uris")
        .eq("client_id", clientId)
        .maybeSingle<{ client_id: string; client_name: string | null; redirect_uris: string[] }>();
      if (error) fail("read the client");
      return data ? ({ clientId: data.client_id, clientName: data.client_name, redirectUris: data.redirect_uris } satisfies OAuthClient) : null;
    },

    async createGrant(input) {
      const { data, error } = await db().rpc("ai_create_grant", {
        p_staff_profile_id: input.staffProfileId,
        p_auth_user_id: input.authUserId,
        p_client_id: input.clientId,
        p_provider: input.provider,
        p_scopes: [...input.scopes],
        p_code_hash: input.codeHash,
        p_redirect_uri: input.redirectUri,
        p_code_challenge: input.codeChallenge,
        p_resource: input.resource,
        p_code_ttl_seconds: input.codeTtlSeconds,
        p_grant_days: input.grantDays,
      });
      if (error) fail("create the connection");
      const row = (data ?? {}) as { ok?: boolean; connection_id?: string; reason?: string };
      return row.ok === true && row.connection_id ? { ok: true, connectionId: row.connection_id } : { ok: false, reason: row.reason ?? "refused" };
    },

    async exchangeCode(input) {
      const { data, error } = await db().rpc("ai_exchange_code", {
        p_code_hash: input.codeHash,
        p_verifier_challenge: input.verifierChallenge,
        p_client_id: input.clientId,
        p_redirect_uri: input.redirectUri,
        p_resource: input.resource,
        p_access_hash: input.accessHash,
        p_refresh_hash: input.refreshHash,
        p_access_ttl_seconds: input.accessTtlSeconds,
      });
      if (error) fail("redeem the code");
      return toRedeem(data);
    },

    async rotateRefresh(input) {
      const { data, error } = await db().rpc("ai_rotate_refresh", {
        p_refresh_hash: input.presentedHash,
        p_client_id: input.clientId,
        p_resource: input.resource,
        p_new_access_hash: input.accessHash,
        p_new_refresh_hash: input.refreshHash,
        p_access_ttl_seconds: input.accessTtlSeconds,
      });
      if (error) fail("rotate the refresh token");
      return toRedeem(data);
    },

    async resolveToken(tokenHash) {
      const { data, error } = await db().rpc("ai_resolve_access", { p_token_hash: tokenHash });
      if (error) fail("read the token");
      if (!data) return null;
      const row = data as AccessJson;
      return {
        kind: row.kind,
        resource: row.resource,
        scopes: row.scopes ?? [],
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        connection: {
          id: row.connection.id,
          staffProfileId: row.connection.staff_profile_id,
          authUserId: row.connection.auth_user_id,
          clientId: row.connection.client_id,
          provider: row.connection.provider,
          scopes: row.connection.scopes ?? [],
          expiresAt: row.connection.expires_at,
          revokedAt: row.connection.revoked_at,
        },
      } satisfies AccessRow;
    },

    async revokeToken(tokenHash, clientId) {
      const { error } = await db().rpc("ai_revoke_token", { p_token_hash: tokenHash, p_client_id: clientId });
      if (error) fail("revoke the token");
    },

    async revokeConnection(connectionId, reason, byStaffProfileId) {
      const { error } = await db().rpc("ai_revoke_connection", {
        p_connection_id: connectionId,
        p_reason: reason,
        p_by: byStaffProfileId ?? null,
      });
      if (error) fail("revoke the connection");
    },

    async revokeStaffConnections(staffProfileId, reason, byStaffProfileId) {
      const { data, error } = await db().rpc("ai_revoke_staff_connections", {
        p_staff_profile_id: staffProfileId,
        p_reason: reason,
        p_by: byStaffProfileId ?? null,
      });
      if (error) fail("revoke the connections");
      return typeof data === "number" ? data : 0;
    },

    async killSwitchOn() {
      try {
        const { data, error } = await db()
          .from("runtime_flags")
          .select("enabled")
          .eq("key", "ai_connection")
          .maybeSingle<{ enabled: boolean }>();
        return !error && data?.enabled === true;
      } catch {
        return false;
      }
    },

    async callCounts(staffProfileId) {
      const { data, error } = await db().rpc("ai_call_counts", { p_staff_profile_id: staffProfileId });
      if (error) fail("count the calls");
      const row = (data ?? {}) as { hour?: unknown; day?: unknown; limited_hour?: unknown };
      return { hour: Number(row.hour ?? 0), day: Number(row.day ?? 0), limitedHour: Number(row.limited_hour ?? 0) };
    },

    async logToolCall(row) {
      const { error } = await db().from("ai_tool_calls").insert({
        staff_profile_id: row.staffProfileId,
        connection_id: row.connectionId,
        provider: row.provider,
        tool: row.tool,
        outcome: row.outcome,
        row_count: row.rowCount,
        duration_ms: row.durationMs,
      });
      if (error) fail("log the call");
    },
  };
}
