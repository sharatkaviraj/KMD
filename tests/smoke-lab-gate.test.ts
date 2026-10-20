import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * Smoke Lab doors: the middleware keeps a smoke session only while its pass
 * is live, and the pass routes refuse off the test database or without a live
 * pass. Synthetic ids, no network.
 */

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  resolvePass: vi.fn(),
  touchPass: vi.fn(async () => undefined),
  fileFinding: vi.fn(),
  listFindings: vi.fn(async () => []),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  admit: vi.fn(),
  currentClaims: vi.fn(async (): Promise<{ data: unknown }> => ({ data: null })),
  enabled: { value: true },
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/platform/env", () => ({
  hasRequiredEnvVars: true,
  getServerSupabaseUrl: () => "https://wtgxcptmucjerhufzjcf.supabase.co",
  getRequiredEnvVar: () => "synthetic-public-key",
  sanitizeRedirectPath: (p: string | null) => (p && p.startsWith("/") && !p.startsWith("//") ? p : "/dashboard"),
  isSafeInternalPath: (p: string) => p.startsWith("/") && !p.startsWith("//"),
}));
vi.mock("@/platform/auth/smoke-lab", () => ({ smokeLabEnabled: () => mocks.enabled.value }));
vi.mock("@/modules/smoke/data/smoke-repo", () => ({ resolvePass: mocks.resolvePass, touchPass: mocks.touchPass, fileFinding: mocks.fileFinding, listFindings: mocks.listFindings }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { generateLink: mocks.generateLink } } }) }));
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp, getClaims: mocks.currentClaims } }) }));
vi.mock("@/platform/auth/admit", () => ({ admitSignedInUser: mocks.admit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateSession } from "@/platform/supabase/middleware";
import { GET as enter } from "@/app/lab/enter/route";
import { GET as brief } from "@/app/api/lab/brief/route";
import { POST as postFinding } from "@/app/api/lab/findings/route";

const ORIGIN = "https://vppsone.example.test";
const PROFILE = "00000000-0000-4000-8000-0000000000a1";
const livePass = {
  passId: "00000000-0000-4000-8000-0000000000b1",
  runId: "00000000-0000-4000-8000-0000000000c1",
  email: "smoke.teacher1@qa.vpps.local",
  role: "teacher",
  label: "Smoke teacher 1",
  persona: "new teacher",
  staffProfileId: PROFILE,
  run: { title: "QA day", scenario: "school_day", schoolDay: "2026-10-21", clockStart: "07:30", expiresAt: "2026-10-21T12:00:00Z" },
};

function session(email: string | null, allowed: unknown, error: Error | null = null, appMetadata: Record<string, unknown> = {}) {
  const rpc = vi.fn(async () => ({ data: allowed, error }));
  const signOut = vi.fn(async () => ({ error: null }));
  mocks.createServerClient.mockReturnValue({
    schema: vi.fn(() => ({ rpc })),
    auth: { getClaims: vi.fn(async () => ({ data: email ? { claims: { sub: "00000000-0000-4000-8000-0000000000d1", email, app_metadata: appMetadata } } : null })), signOut },
  });
  return { rpc, signOut };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.value = true;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in smoke gate tests"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("the middleware keeps a smoke session only while its pass is live", () => {
  it("signs a smoke account out and sends it to /lab/ended when no pass is live", async () => {
    const s = session("smoke.teacher1@qa.vpps.local", false);
    const res = await updateSession(new NextRequest(new URL("/teach", ORIGIN)));
    expect(s.rpc).toHaveBeenCalledWith("smoke_access_allowed");
    // Every session the account holds, not only this browser's.
    expect(s.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/lab/ended?reason=expired`);
  });

  it("fails closed on a lookup error (without signing out) or a non-boolean answer", async () => {
    const failed = session("smoke.office@qa.vpps.local", true, new Error("synthetic"));
    expect((await updateSession(new NextRequest(new URL("/students", ORIGIN)))).headers.get("location")).toBe(`${ORIGIN}/lab/ended?reason=unavailable`);
    expect(failed.signOut).not.toHaveBeenCalled();
    session("smoke.office@qa.vpps.local", "true");
    expect((await updateSession(new NextRequest(new URL("/students", ORIGIN)))).headers.get("location")).toContain("/lab/ended");
  });

  it("still knows a smoke account that changed its own email, by the flag only the service role sets", async () => {
    const moved = session("somewhere@example.test", false, null, { smoke_lab: true });
    const res = await updateSession(new NextRequest(new URL("/dashboard", ORIGIN)));
    expect(moved.rpc).toHaveBeenCalledWith("smoke_access_allowed");
    expect(res.headers.get("location")).toContain("/lab/ended");
  });

  it("lets a live smoke session through", async () => {
    session("smoke.office@qa.vpps.local", true);
    const res = await updateSession(new NextRequest(new URL("/students", ORIGIN)));
    expect(res.headers.get("location")).toBeNull();
  });

  it("never asks about anybody else, and leaves the pass doors open", async () => {
    const real = session("raj@vpps.co.in", false);
    await updateSession(new NextRequest(new URL("/dashboard", ORIGIN)));
    expect(real.rpc).not.toHaveBeenCalled();
    const qa = session("qa.teacher@qa.vpps.local", false);
    await updateSession(new NextRequest(new URL("/teach", ORIGIN)));
    expect(qa.rpc).not.toHaveBeenCalled();
    const smoke = session("smoke.teacher1@qa.vpps.local", false);
    const res = await updateSession(new NextRequest(new URL("/lab/enter?pass=x", ORIGIN)));
    expect(smoke.rpc).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBeNull();
    const signedOut = session(null, false);
    expect((await updateSession(new NextRequest(new URL("/api/lab/findings", ORIGIN)))).headers.get("location")).toBeNull();
    expect(signedOut.rpc).not.toHaveBeenCalled();
  });
});

describe("/lab/enter", () => {
  it("is a 404 off the test database", async () => {
    mocks.enabled.value = false;
    expect((await enter(new NextRequest(new URL("/lab/enter?pass=x", ORIGIN)))).status).toBe(404);
    expect(mocks.resolvePass).not.toHaveBeenCalled();
  });

  it("refuses a pass that is not live without minting anything", async () => {
    mocks.resolvePass.mockResolvedValue({ ok: false, reason: "revoked" });
    const res = await enter(new NextRequest(new URL("/lab/enter?pass=whatever", ORIGIN)));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/lab/ended?reason=revoked`);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("signs in exactly the pass's account and profile, and sets the run's clock", async () => {
    mocks.resolvePass.mockResolvedValue({ ok: true, pass: livePass });
    mocks.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "synthetic-hash" } }, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "u1", email: livePass.email } }, error: null });
    mocks.admit.mockResolvedValue({ ok: true, staff: { role: "teacher", preferredStart: null } });
    const res = await enter(new NextRequest(new URL("/lab/enter?pass=live&next=/teach/marks", ORIGIN)));
    expect(mocks.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: livePass.email });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "synthetic-hash" });
    expect(mocks.admit).toHaveBeenCalledWith(expect.anything(), "u1", { signOutScope: "local", expectedStaffProfileId: PROFILE });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/teach/marks`);
    expect(res.headers.get("set-cookie")).toContain("vx_qa_now=2026-10-21T07%3A30");
  });

  it("does not switch a browser signed in as real staff, and does not re-mint for the same seat", async () => {
    mocks.resolvePass.mockResolvedValue({ ok: true, pass: livePass });
    mocks.currentClaims.mockResolvedValueOnce({ data: { claims: { sub: "staff-1", email: "raj@vpps.co.in" } } });
    const refused = await enter(new NextRequest(new URL("/lab/enter?pass=live", ORIGIN)));
    expect(refused.headers.get("location")).toBe(`${ORIGIN}/lab/ended?reason=signed_in`);
    expect(mocks.generateLink).not.toHaveBeenCalled();

    mocks.currentClaims.mockResolvedValueOnce({ data: { claims: { sub: "u1", email: livePass.email } } });
    mocks.admit.mockResolvedValue({ ok: true, staff: { role: "teacher", preferredStart: null } });
    const again = await enter(new NextRequest(new URL("/lab/enter?pass=live", ORIGIN)));
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.admit).toHaveBeenCalledWith(expect.anything(), "u1", { signOutScope: "local", expectedStaffProfileId: PROFILE });
    expect(again.headers.get("location")).toBe(`${ORIGIN}/teach`);
  });

  it("refuses when the verified account is not the pass's account", async () => {
    mocks.resolvePass.mockResolvedValue({ ok: true, pass: livePass });
    mocks.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "h" } }, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "u2", email: "someone.else@qa.vpps.local" } }, error: null });
    const res = await enter(new NextRequest(new URL("/lab/enter?pass=live", ORIGIN)));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/lab/ended?reason=unavailable`);
    expect(mocks.admit).not.toHaveBeenCalled();
  });
});

describe("the agent API", () => {
  it("refuses without a live pass", async () => {
    mocks.resolvePass.mockResolvedValue({ ok: false, reason: "invalid" });
    expect((await brief(new NextRequest(new URL("/api/lab/brief", ORIGIN)))).status).toBe(401);
    // A pass in the URL is not read by the API at all.
    mocks.resolvePass.mockClear();
    await brief(new NextRequest(new URL("/api/lab/brief?pass=live", ORIGIN)));
    expect(mocks.resolvePass).toHaveBeenCalledWith(null);
    const res = await postFinding(new NextRequest(new URL("/api/lab/findings", ORIGIN), { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect(mocks.fileFinding).not.toHaveBeenCalled();
  });

  it("gives the role its own steps and files a valid finding", async () => {
    mocks.resolvePass.mockResolvedValue({ ok: true, pass: livePass });
    const b = await (await brief(new NextRequest(new URL("/api/lab/brief", ORIGIN), { headers: { authorization: "Bearer live" } }))).json();
    expect(b.account.role).toBe("teacher");
    expect(b.yourSteps.every((s: { role: string }) => s.role === "teacher" || s.role === "all")).toBe(true);
    expect(JSON.stringify(b)).not.toContain("live\"");

    const bad = await postFinding(new NextRequest(new URL("/api/lab/findings", ORIGIN), { method: "POST", headers: { authorization: "Bearer live" }, body: JSON.stringify({ kind: "bug", severity: "P9", title: "x" }) }));
    expect(bad.status).toBe(400);

    mocks.fileFinding.mockResolvedValue({ id: "f1", repeat: false });
    const good = await postFinding(new NextRequest(new URL("/api/lab/findings", ORIGIN), { method: "POST", headers: { authorization: "Bearer live" }, body: JSON.stringify({ kind: "bug", severity: "P2", title: "Count differs on Today", screen: "/teach" }) }));
    expect(good.status).toBe(201);
    expect(mocks.fileFinding).toHaveBeenCalledWith(livePass, expect.objectContaining({ title: "Count differs on Today", screen: "/teach" }));
  });
});
