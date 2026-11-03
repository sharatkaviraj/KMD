import type { Provider } from "@/modules/mcp/domain/redirects";
import type { AccessRow, McpStore, RedeemResult, RevokeReason, ToolCallRow } from "@/modules/mcp/domain/store";

/**
 * An in-memory twin of One's Postgres store with the same single-use
 * semantics as the SQL functions in
 * `supabase/migrations/20261103150000_ai_connection_mcp.sql`.
 *
 * The SQL serialises a redemption with `select … for update` on the code or
 * refresh-token row; a concurrent second redemption blocks, then sees
 * `used_at` set and takes the reuse branch. Here every check-and-set runs
 * synchronously from the method's first line to its last write — there is no
 * `await` inside — so two calls started together still run one after the
 * other, exactly as the row lock makes them. That is what lets the
 * concurrency tests mean something.
 */

type Connection = {
  id: string;
  staffProfileId: string;
  authUserId: string;
  clientId: string;
  provider: Provider;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  revokeReason: string | null;
  revokedBy: string | null;
};

type Code = {
  connectionId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
  usedAt: number | null;
};

type Token = {
  id: string;
  kind: "access" | "refresh";
  connectionId: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
  usedAt: number | null;
  replacedBy: string | null;
  revokedAt: number | null;
};

export type FakeStore = McpStore & {
  now: number;
  clients: Map<string, { clientId: string; clientName: string | null; redirectUris: string[]; createdAt: number }>;
  connections: Map<string, Connection>;
  codes: Map<string, Code>;
  tokens: Map<string, Token>;
  calls: (ToolCallRow & { createdAt: number })[];
  killSwitch: boolean | "unreadable";
  /** Staff active flags the grant check reads (`staff_profiles`). */
  staffUsers: Map<string, { authUserId: string; isActive: boolean }>;
  advance(ms: number): void;
};

let seq = 0;
const id = (prefix: string) => `${prefix}-${(seq += 1).toString().padStart(6, "0")}`;
const iso = (ms: number) => new Date(ms).toISOString();

export function createFakeStore(start = Date.UTC(2026, 10, 3, 4, 30)): FakeStore {
  const store: FakeStore = {
    now: start,
    clients: new Map(),
    connections: new Map(),
    codes: new Map(),
    tokens: new Map(),
    calls: [],
    killSwitch: true,
    staffUsers: new Map(),
    advance(ms) {
      store.now += ms;
    },

    async registerClient({ clientId, clientName, redirectUris, maxPerHour }) {
      // ai_register_client: count and insert under one advisory lock.
      const recent = [...store.clients.values()].filter((client) => client.createdAt > store.now - 3_600_000).length;
      if (recent >= maxPerHour) return { ok: false, reason: "rate_limited" };
      store.clients.set(clientId, { clientId, clientName, redirectUris: [...redirectUris], createdAt: store.now });
      return { ok: true };
    },

    async getClient(clientId) {
      const client = store.clients.get(clientId);
      return client ? { clientId: client.clientId, clientName: client.clientName, redirectUris: client.redirectUris } : null;
    },

    async createGrant(input) {
      // ai_create_grant: staff active and bound to the auth user; redirect one of the client's.
      if (input.codeTtlSeconds < 1 || input.codeTtlSeconds > 300 || input.grantDays < 1 || input.grantDays > 90) return { ok: false, reason: "bad_request" };
      const staff = store.staffUsers.get(input.staffProfileId);
      if (!staff || !staff.isActive || staff.authUserId !== input.authUserId) return { ok: false, reason: "staff" };
      const client = store.clients.get(input.clientId);
      if (!client || !client.redirectUris.includes(input.redirectUri)) return { ok: false, reason: "client" };
      for (const connection of store.connections.values()) {
        if (connection.staffProfileId === input.staffProfileId && connection.provider === input.provider && connection.revokedAt === null) {
          revoke(connection.id, "replaced", input.staffProfileId);
        }
      }
      const connectionId = id("conn");
      store.connections.set(connectionId, {
        id: connectionId,
        staffProfileId: input.staffProfileId,
        authUserId: input.authUserId,
        clientId: input.clientId,
        provider: input.provider,
        scopes: [...input.scopes],
        createdAt: store.now,
        expiresAt: store.now + input.grantDays * 86_400_000,
        revokedAt: null,
        revokeReason: null,
        revokedBy: null,
      });
      store.codes.set(input.codeHash, {
        connectionId,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        resource: input.resource,
        scopes: [...input.scopes],
        expiresAt: store.now + input.codeTtlSeconds * 1000,
        usedAt: null,
      });
      return { ok: true, connectionId };
    },

    async exchangeCode(input): Promise<RedeemResult> {
      // ai_exchange_code: locked read, reuse → revoke, consume, bindings, issue.
      const code = store.codes.get(input.codeHash);
      if (!code) return { status: "invalid" };
      if (code.usedAt !== null) {
        revoke(code.connectionId, "code_reuse", null);
        return { status: "replayed" };
      }
      code.usedAt = store.now;
      if (code.expiresAt <= store.now) {
        revoke(code.connectionId, "code_expired", null);
        return { status: "invalid" };
      }
      if (
        code.clientId !== input.clientId ||
        code.redirectUri !== input.redirectUri ||
        code.codeChallenge !== input.verifierChallenge ||
        code.resource !== input.resource
      ) {
        revoke(code.connectionId, "code_mismatch", null);
        return { status: "invalid" };
      }
      const connection = store.connections.get(code.connectionId)!;
      if (connection.revokedAt !== null || connection.expiresAt <= store.now) return { status: "invalid" };
      return issue(connection, code.resource, code.scopes, input.accessHash, input.refreshHash, input.accessTtlSeconds);
    },

    async rotateRefresh(input): Promise<RedeemResult> {
      // ai_rotate_refresh: locked read, client check, reuse → revoke, liveness, rotate.
      const old = store.tokens.get(input.presentedHash);
      if (!old || old.kind !== "refresh") return { status: "invalid" };
      const connection = store.connections.get(old.connectionId)!;
      if (connection.clientId !== input.clientId) return { status: "invalid" };
      if (old.usedAt !== null) {
        revoke(old.connectionId, "refresh_reuse", null);
        return { status: "replayed" };
      }
      if (old.revokedAt !== null || old.expiresAt <= store.now || connection.revokedAt !== null || connection.expiresAt <= store.now || old.resource !== input.resource) {
        return { status: "invalid" };
      }
      const result = issue(connection, old.resource, old.scopes, input.accessHash, input.refreshHash, input.accessTtlSeconds);
      old.usedAt = store.now;
      old.replacedBy = store.tokens.get(input.refreshHash)!.id;
      return result;
    },

    async resolveToken(tokenHash): Promise<AccessRow | null> {
      const token = store.tokens.get(tokenHash);
      if (!token) return null;
      const connection = store.connections.get(token.connectionId)!;
      return {
        kind: token.kind,
        resource: token.resource,
        scopes: token.scopes,
        expiresAt: iso(token.expiresAt),
        revokedAt: token.revokedAt === null ? null : iso(token.revokedAt),
        connection: {
          id: connection.id,
          staffProfileId: connection.staffProfileId,
          authUserId: connection.authUserId,
          clientId: connection.clientId,
          provider: connection.provider,
          scopes: connection.scopes,
          expiresAt: iso(connection.expiresAt),
          revokedAt: connection.revokedAt === null ? null : iso(connection.revokedAt),
        },
      };
    },

    async revokeToken(tokenHash, clientId) {
      const token = store.tokens.get(tokenHash);
      if (!token) return;
      if (store.connections.get(token.connectionId)?.clientId !== clientId) return;
      if (token.kind === "refresh") revoke(token.connectionId, "revoked_by_client", null);
      else token.revokedAt ??= store.now;
    },

    async revokeConnection(connectionId, reason: RevokeReason, by) {
      revoke(connectionId, reason, by ?? null);
    },

    async revokeStaffConnections(staffProfileId, reason, by) {
      let n = 0;
      for (const connection of store.connections.values()) {
        if (connection.staffProfileId === staffProfileId && revoke(connection.id, reason, by ?? null)) n += 1;
      }
      return n;
    },

    async killSwitchOn() {
      return store.killSwitch === true;
    },

    async callCounts(staffProfileId) {
      const rows = store.calls.filter(
        (call) => call.staffProfileId === staffProfileId && call.createdAt > store.now - 86_400_000 && call.outcome !== "refused:rate_limited",
      );
      return { hour: rows.filter((call) => call.createdAt > store.now - 3_600_000).length, day: rows.length };
    },

    async logToolCall(row) {
      store.calls.push({ ...row, createdAt: store.now });
    },
  };

  function revoke(connectionId: string, reason: string, by: string | null): boolean {
    const connection = store.connections.get(connectionId);
    if (!connection) return false;
    const done = connection.revokedAt === null;
    if (done) {
      connection.revokedAt = store.now;
      connection.revokeReason = reason;
      connection.revokedBy = by;
    }
    for (const token of store.tokens.values()) if (token.connectionId === connectionId) token.revokedAt ??= store.now;
    return done;
  }

  function issue(connection: Connection, resource: string, scopes: string[], accessHash: string, refreshHash: string, ttl: number): RedeemResult {
    const accessExpires = Math.min(store.now + ttl * 1000, connection.expiresAt);
    const base = { connectionId: connection.id, resource, scopes, usedAt: null, replacedBy: null, revokedAt: null };
    store.tokens.set(accessHash, { ...base, id: id("tok"), kind: "access", expiresAt: accessExpires });
    store.tokens.set(refreshHash, { ...base, id: id("tok"), kind: "refresh", expiresAt: connection.expiresAt });
    return { status: "ok", connectionId: connection.id, scopes, accessExpiresAt: iso(accessExpires), refreshExpiresAt: iso(connection.expiresAt) };
  }

  return store;
}
