import type { Provider } from "@/modules/mcp/domain/redirects";

/**
 * What the connection card says, from One's own records only (plan §8.1).
 * One cannot see whether the connector is still installed in Claude or
 * ChatGPT, so no state says "connected and working": the most it says is
 * "allowed", with when it was last used.
 */

export type ConnectionListRow = {
  id: string;
  staffProfileId: string;
  staffName: string;
  provider: Provider;
  createdAt: string;
  /** When its code was redeemed; null = consented to but never redeemed (holds no token). */
  activatedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  lastUsedAt: string | null;
  calls30d: number;
};

export type ConnectionStatus = "allowed" | "idle" | "disconnected" | "reconnect_required";

/** The idle line: allowed, but not used for this many days. */
export const IDLE_DAYS = 30;

const DISCONNECT_REASONS = new Set(["disconnected_by_self", "disconnected_by_admin", "revoked_by_client", "replaced"]);

/** Activated (its code redeemed), not revoked, inside its 90 days. A pending grant is never live. */
export function isLive(row: Pick<ConnectionListRow, "revokedAt" | "expiresAt" | "activatedAt">, now: number): boolean {
  return Boolean(row.activatedAt) && !row.revokedAt && Date.parse(row.expiresAt) > now;
}

export function connectionStatus(row: ConnectionListRow, now: number): ConnectionStatus {
  if (isLive(row, now)) {
    const since = Date.parse(row.lastUsedAt ?? row.createdAt);
    return now - since > IDLE_DAYS * 86_400_000 ? "idle" : "allowed";
  }
  // Ended on purpose — by the person, an admin, or the provider — is
  // "disconnected". Ended by expiry (90 days), a disabled login, a role change
  // or a security stop (a reused code or refresh token) needs a fresh consent.
  if (row.revokedAt && row.revokeReason && DISCONNECT_REASONS.has(row.revokeReason)) return "disconnected";
  return "reconnect_required";
}

export type CardState =
  /** This account may not connect (role not yet eligible, D7; or a QA account). */
  | { kind: "unavailable" }
  /** The school's switch is off; live connections are still listed so they can be disconnected. */
  | { kind: "switched_off"; live: ConnectionListRow[] }
  | { kind: "not_connected" }
  | { kind: "allowed"; live: ConnectionListRow[] }
  | { kind: "disconnected"; last: ConnectionListRow }
  | { kind: "reconnect_required"; last: ConnectionListRow };

export function connectionCardState(input: {
  eligible: boolean;
  /** `null` = the switch could not be read, which is off. */
  switchOn: boolean | null;
  rows: readonly ConnectionListRow[];
  now: number;
}): CardState {
  // A pending grant (consented, code never redeemed) is not a connection yet.
  const rows = input.rows.filter((row) => row.activatedAt);
  const live = rows.filter((row) => isLive(row, input.now));
  if (!input.eligible) return { kind: "unavailable" };
  if (input.switchOn !== true) return { kind: "switched_off", live };
  if (live.length > 0) return { kind: "allowed", live };
  const latest = [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!latest) return { kind: "not_connected" };
  return connectionStatus(latest, input.now) === "disconnected" ? { kind: "disconnected", last: latest } : { kind: "reconnect_required", last: latest };
}
