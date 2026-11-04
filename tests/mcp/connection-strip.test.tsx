import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CardState, ConnectionListRow } from "@/modules/mcp/domain/card";
import { AiConnectionStrip } from "@/modules/mcp/ui/connection-strip";

/* Today's AI line (owner, 4 Nov): what it says and where it sends, per state. Synthetic rows only. */
const row: ConnectionListRow = {
  id: "00000000-0000-4000-8000-0000000000a1",
  staffProfileId: "00000000-0000-4000-8000-0000000000b1",
  staffName: "Synthetic Admin",
  provider: "claude",
  createdAt: "2026-11-04T03:00:00.000Z",
  activatedAt: "2026-11-04T03:00:30.000Z",
  expiresAt: "2027-02-02T03:00:00.000Z",
  revokedAt: null,
  revokeReason: null,
  lastUsedAt: "2026-11-04T05:12:00.000Z",
  calls30d: 3,
};
const ADDRESS = "https://one.vpps.co.in/api/mcp";
const draw = (state: CardState, canManage = false, address: string | null = ADDRESS) => renderToStaticMarkup(<AiConnectionStrip state={state} language="en" canManage={canManage} address={address} />);
const hrefOf = (html: string) => html.match(/href="([^"]+)"/)?.[1];

describe("AiConnectionStrip", () => {
  it("is not shown to someone the connection is not for", () => {
    expect(draw({ kind: "unavailable" })).toBe("");
  });

  it("puts the Connect Claude button on Today for a person who has not connected", () => {
    const html = draw({ kind: "not_connected" });
    expect(html).toContain("Connect Claude to VPPS One");
    expect(html).toMatch(/<button[^>]*>Connect Claude<\/button>/);
    // Without the address it still sends them to the card rather than offering a button that cannot copy.
    const fallback = draw({ kind: "not_connected" }, false, null);
    expect(fallback).not.toContain("<button");
    expect(hrefOf(fallback)).toBe("/preferences#ai-connection");
  });

  it("says allowed and when it was last used, never 'connected and working'", () => {
    const html = draw({ kind: "allowed", live: [row] });
    expect(html).toContain("Allowed");
    expect(html).toContain("last used 4 Nov, 10:42");
    expect(html).not.toMatch(/working/i);
    expect(draw({ kind: "allowed", live: [{ ...row, lastUsedAt: null }] })).toContain("not used yet");
  });

  it("sends an admin to the school switch when it is off, and anyone else to their card", () => {
    const admin = draw({ kind: "switched_off", live: [] }, true);
    expect(admin).toContain("The school&#x27;s AI switch is off");
    expect(admin).toContain("Turn on");
    expect(hrefOf(admin)).toBe("/settings/ai-connection");
    const other = draw({ kind: "switched_off", live: [] });
    expect(other).toContain("Switched off by the school");
    expect(hrefOf(other)).toBe("/preferences#ai-connection");
  });

  it("asks to reconnect after expiry or a security stop, and to connect after a disconnect", () => {
    const again = draw({ kind: "reconnect_required", last: { ...row, revokedAt: "2026-11-04T06:00:00.000Z", revokeReason: "expired" } });
    expect(again).toContain("Reconnect required");
    expect(again).toContain("Connect Claude");
    expect(draw({ kind: "disconnected", last: { ...row, revokedAt: "2026-11-04T06:00:00.000Z", revokeReason: "disconnected_by_self" } })).toContain("Disconnected");
  });
});
