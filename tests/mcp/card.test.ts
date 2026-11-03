import { describe, expect, it } from "vitest";

import { connectionCardState, connectionStatus, type ConnectionListRow } from "@/modules/mcp/domain/card";

const NOW = Date.UTC(2026, 10, 3, 6, 0);
const DAY = 86_400_000;

function row(overrides: Partial<ConnectionListRow> = {}): ConnectionListRow {
  return {
    id: "c1",
    staffProfileId: "s1",
    staffName: "Test Admin",
    provider: "claude",
    createdAt: new Date(NOW - 2 * DAY).toISOString(),
    expiresAt: new Date(NOW + 88 * DAY).toISOString(),
    revokedAt: null,
    revokeReason: null,
    lastUsedAt: new Date(NOW - 3_600_000).toISOString(),
    calls30d: 4,
    ...overrides,
  };
}

/** Plan §8.1: every state from One's records; never "connected and working". */
describe("the connection card", () => {
  it("is unavailable for an account that may not connect", () => {
    expect(connectionCardState({ eligible: false, switchOn: true, rows: [row()], now: NOW }).kind).toBe("unavailable");
  });

  it("says switched off when the switch is off or unreadable, and still lists live connections to disconnect", () => {
    for (const switchOn of [false, null]) {
      const state = connectionCardState({ eligible: true, switchOn, rows: [row()], now: NOW });
      expect(state).toMatchObject({ kind: "switched_off", live: [{ id: "c1" }] });
    }
  });

  it("is not connected with no rows", () => {
    expect(connectionCardState({ eligible: true, switchOn: true, rows: [], now: NOW }).kind).toBe("not_connected");
  });

  it("is allowed with a last-used time, and idle after 30 days unused", () => {
    expect(connectionCardState({ eligible: true, switchOn: true, rows: [row()], now: NOW }).kind).toBe("allowed");
    expect(connectionStatus(row(), NOW)).toBe("allowed");
    expect(connectionStatus(row({ lastUsedAt: new Date(NOW - 31 * DAY).toISOString() }), NOW)).toBe("idle");
    expect(connectionStatus(row({ lastUsedAt: null, createdAt: new Date(NOW - 31 * DAY).toISOString() }), NOW)).toBe("idle");
  });

  it("says disconnected when ended by the person, an admin or the provider", () => {
    for (const reason of ["disconnected_by_self", "disconnected_by_admin", "revoked_by_client"]) {
      const state = connectionCardState({ eligible: true, switchOn: true, rows: [row({ revokedAt: new Date(NOW - DAY).toISOString(), revokeReason: reason })], now: NOW });
      expect(state.kind, reason).toBe("disconnected");
    }
  });

  it("says reconnect required after expiry or a security stop", () => {
    for (const ended of [
      { expiresAt: new Date(NOW - 1).toISOString() },
      { revokedAt: new Date(NOW - DAY).toISOString(), revokeReason: "refresh_reuse" },
      { revokedAt: new Date(NOW - DAY).toISOString(), revokeReason: "staff_disabled" },
      { revokedAt: new Date(NOW - DAY).toISOString(), revokeReason: "not_eligible" },
    ]) {
      expect(connectionCardState({ eligible: true, switchOn: true, rows: [row(ended)], now: NOW }).kind).toBe("reconnect_required");
    }
  });

  it("reads the newest ended connection when none is live", () => {
    const older = row({ id: "old", createdAt: new Date(NOW - 50 * DAY).toISOString(), revokedAt: new Date(NOW - 40 * DAY).toISOString(), revokeReason: "disconnected_by_self" });
    const newer = row({ id: "new", createdAt: new Date(NOW - 10 * DAY).toISOString(), revokedAt: new Date(NOW - DAY).toISOString(), revokeReason: "refresh_reuse" });
    expect(connectionCardState({ eligible: true, switchOn: true, rows: [older, newer], now: NOW })).toMatchObject({ kind: "reconnect_required", last: { id: "new" } });
  });
});
