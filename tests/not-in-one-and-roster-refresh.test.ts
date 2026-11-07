import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ staff: vi.fn(), canonical: vi.fn(), preview: vi.fn(), state: vi.fn(), sync: vi.fn(), routes: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ getCurrentStaff: mocks.staff }));
vi.mock("@/platform/fees-bridge/policy", () => ({ usesCanonicalFees: mocks.canonical }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: mocks.preview }));
vi.mock("@/modules/coexistence/data/sync", () => ({ runFeesBridgeSync: mocks.sync }));
vi.mock("@/modules/transport/data/routes", () => ({ refreshRouteCopy: mocks.routes }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.state }) }) }) }) }));

import { cleanFromPath, notInOneHref } from "@/platform/fees-bridge/not-in-one";
import { notInOneTopic } from "@/vx/not-in-one";
import { ROSTER_REFRESH_COOLDOWN_MS, rosterRefreshWait } from "@/platform/fees-bridge/roster-refresh";
import { POST } from "@/app/api/fees-bridge/roster/refresh/route";

describe("not in One yet", () => {
  it("keeps only a plain One path, never a host or query", () => {
    expect(cleanFromPath("/reports?x=1")).toBe("/reports");
    for (const bad of ["https://evil.test/x", "//evil.test", "/a b", "/x<script>", "", null]) expect(cleanFromPath(bad)).toBe("");
    expect(notInOneHref("/accounts/books")).toBe("/not-in-one?from=%2Faccounts%2Fbooks");
    expect(notInOneHref("https://fees.vpps.co.in/protected")).toBe("/not-in-one");
  });
  it("names the screen asked for", () => {
    expect(notInOneTopic("/reports").en).toBe("Fee reports and exports");
    expect(notInOneTopic("/admissions/new").en).toBe("Adding a new student");
    expect(notInOneTopic("/admissions/11111111-1111-4111-8111-111111111111").en).toMatch(/Editing/);
    expect(notInOneTopic("/receipts/SVP-1/reverse").en).toMatch(/Reversing/);
    expect(notInOneTopic("/fees/whatever").en).toBe("This Fees screen");
  });
});

describe("Refresh roster now", () => {
  const now = Date.parse("2026-11-06T10:00:00Z");
  it("waits ten minutes after the last check or attempt", () => {
    expect(rosterRefreshWait([null, undefined], now)).toBe(0);
    expect(rosterRefreshWait(["2026-11-06T09:55:00Z", "2026-11-06T09:00:00Z"], now)).toBe(5 * 60_000);
    expect(rosterRefreshWait([new Date(now - ROSTER_REFRESH_COOLDOWN_MS).toISOString()], now)).toBe(0);
  });

  const admin = { role: "admin", isActive: true, isTestAccount: false };
  const ask = (origin = "https://one.vpps.co.in") => POST(new Request("https://one.vpps.co.in/api/fees-bridge/roster/refresh",
    { method: "POST", headers: { origin, host: "one.vpps.co.in" } }));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.staff.mockResolvedValue(admin); mocks.canonical.mockReturnValue(true); mocks.preview.mockResolvedValue(undefined);
    mocks.state.mockResolvedValue({ data: { last_checked_at: "2026-11-05T20:30:00Z", last_attempt_at: null }, error: null });
    mocks.sync.mockResolvedValue({ revision: 5, acknowledged: 2 });
    mocks.routes.mockResolvedValue({ ok: true, count: 3 });
  });
  it("runs one unforced copy for a real admin", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: true, busy: false });
    expect(mocks.sync).toHaveBeenCalledWith();
  });
  it("fetches the transport route names with it, and a failure there changes nothing", async () => {
    await ask();
    expect(mocks.routes).toHaveBeenCalledTimes(1);
    expect(mocks.routes).toHaveBeenCalledWith({ force: true });
    mocks.routes.mockRejectedValueOnce(new Error("transport_routes_unreachable"));
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: true, busy: false });
  });
  it("refuses another origin, other roles, test accounts and a preview", async () => {
    expect((await ask("https://evil.test")).status).toBe(403);
    for (const who of [{ ...admin, role: "accountant" }, { ...admin, isTestAccount: true }, null]) {
      mocks.staff.mockResolvedValueOnce(who);
      expect((await ask()).status).toBe(403);
    }
    mocks.preview.mockRejectedValueOnce(new Error("previewing"));
    expect((await ask()).status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.routes).not.toHaveBeenCalled();
  });
  it("refuses within ten minutes of the last copy, without calling Fees", async () => {
    mocks.state.mockResolvedValue({ data: { last_checked_at: new Date(Date.now() - 60_000).toISOString(), last_attempt_at: null }, error: null });
    const response = await ask();
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "cooldown", waitMinutes: 9 });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.routes).not.toHaveBeenCalled();
  });
  it("says when Fees could not be reached", async () => {
    mocks.sync.mockRejectedValue(new Error("bridge_source_503"));
    const response = await ask();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "bridge_source_503" });
  });
});
