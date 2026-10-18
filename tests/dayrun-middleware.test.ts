import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createClient }));
vi.mock("@/platform/env", () => ({
  hasRequiredEnvVars: true,
  getServerSupabaseUrl: () => "https://wtgxcptmucjerhufzjcf.supabase.co",
  getRequiredEnvVar: () => "synthetic-public-key-for-mocked-client",
}));

import { updateSession } from "../src/platform/supabase/middleware";
import { DAYRUN, accountForAlias } from "../src/platform/auth/dayrun-policy";

function fixture(userId: string | null, allowed: unknown, error: Error | null = null) {
  const rpc = vi.fn(async () => ({ data: allowed, error }));
  const schema = vi.fn(() => ({ rpc }));
  const signOut = vi.fn();
  const getClaims = vi.fn(async () => ({ data: userId ? { claims: { sub: userId, session_id: "synthetic-session" } } : null, error: null }));
  mocks.createClient.mockReturnValue({ schema, auth: { getClaims, signOut } });
  return { rpc, schema, signOut, getClaims };
}
function request(path: string, origin: string = DAYRUN.roleOrigin) {
  return new NextRequest(new URL(path, origin));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in dayrun middleware tests"); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("private dayrun lease middleware", () => {
  test.each(DAYRUN.aliases)("denies a revoked or expired %s lease before a private route", async (alias) => {
    const f = fixture(accountForAlias(alias)!.userId!, false);
    const response = await updateSession(request("/fees/payments?next=https://evil.test&token=synthetic"));
    expect(f.schema).toHaveBeenCalledExactlyOnceWith("vppsone");
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("qa_dayrun_access_allowed");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${DAYRUN.roleOrigin}/login/dayrun`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(f.signOut).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each(DAYRUN.aliases)("fails closed on %s lease lookup errors", async (alias) => {
    const f = fixture(accountForAlias(alias)!.userId!, true, new Error("synthetic lease lookup failure"));
    const response = await updateSession(request("/api/private-operation"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${DAYRUN.roleOrigin}/login/dayrun`);
    expect(f.signOut).not.toHaveBeenCalled();
  });
  test.each([null, undefined, "true", 1])("does not treat a non-boolean lease result as authorization: %s", async (allowed) => {
    fixture(accountForAlias("teacher")!.userId!, allowed);
    const response = await updateSession(request("/teach/attendance"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${DAYRUN.roleOrigin}/login/dayrun`);
  });
  test.each(DAYRUN.aliases)("preserves a permitted existing/unleased or active %s session", async (alias) => {
    const f = fixture(accountForAlias(alias)!.userId!, true);
    const response = await updateSession(request("/teach?class=synthetic"));
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("qa_dayrun_access_allowed");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(f.signOut).not.toHaveBeenCalled();
  });
  test.each([DAYRUN.ownerUserId, "synthetic-ordinary-teacher", "synthetic-unrelated-qa-user"])("never applies dayrun lease lookup or sign-out to ordinary user %s", async (userId) => {
    const f = fixture(userId, false, new Error("must not be consulted"));
    const response = await updateSession(request("/dashboard", DAYRUN.origin));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(f.schema).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.signOut).not.toHaveBeenCalled();
  });
  test.each([DAYRUN.origin, DAYRUN.roleOrigin])("denial redirects only within the incoming host: %s", async (origin) => {
    fixture(accountForAlias("admin")!.userId!, false);
    const response = await updateSession(request("/dashboard?next=https://evil.test", origin));
    expect(response.headers.get("location")).toBe(`${origin}/login/dayrun`);
  });

  test.each([
    "/login/dayrun", "/login/dayrun/request", "/login/dayrun/redeem", "/login/dayrun/end",
    "/login", "/auth/confirm", "/r/synthetic-token", "/t/synthetic-token", "/w/synthetic-token", "/api/jobs/synthetic-job",
  ])("keeps public recovery/End and existing public routes accessible: %s", async (path) => {
    const f = fixture(accountForAlias("teacher")!.userId!, false, new Error("revoked lease"));
    const response = await updateSession(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.signOut).not.toHaveBeenCalled();
  });
  test.each(["/login/dayrun/end-extra", "/login/dayrun/end/private", "/login/dayrun/private"])("does not widen public access to lookalike paths: %s", async (path) => {
    const f = fixture(accountForAlias("teacher")!.userId!, false);
    const response = await updateSession(request(path));
    expect(response.status).toBe(307); expect(f.rpc).toHaveBeenCalled();
  });
  test("signed-out End remains accessible without querying any lease", async () => {
    const f = fixture(null, false);
    const response = await updateSession(request("/login/dayrun/end"));
    expect(response.status).toBe(200); expect(f.rpc).not.toHaveBeenCalled();
  });
  test("ordinary signed-out private-route redirect retains its original next parameter", async () => {
    const f = fixture(null, true);
    const response = await updateSession(request("/teach?class=synthetic"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${DAYRUN.roleOrigin}/login?next=${encodeURIComponent("/teach?class=synthetic")}`);
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
