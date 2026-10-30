import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { AuthSessionMissingError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), client: vi.fn(), target: vi.fn(), staff: vi.fn(),
  headers: vi.fn(), cookies: vi.fn(), admit: vi.fn(), language: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.target }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/platform/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/platform/auth/current-staff", () => ({ getCurrentStaff: mocks.staff }));
vi.mock("@/platform/auth/admit", () => ({ admitSignedInUser: mocks.admit }));
vi.mock("@/platform/deployment/tool-access", () => ({ toolAccountAccess: async () => ({ ok: true }) }));
vi.mock("@/platform/i18n/language-cookie", () => ({ writeLanguageCookie: mocks.language }));
vi.mock("@/vx/view-as", () => ({ VIEW_AS_COOKIE: "vx_view_as" }));

import { DAYRUN, accountForAlias } from "../src/platform/auth/dayrun-policy";
import {
  administerDayrun, dayrunHash, endDayrunSession, redeemDayrunPair,
  requestDayrunPair, requireDayrunOwner,
} from "../src/platform/auth/dayrun-server";
const { admitSignedInUser: admitActual } = await vi.importActual<typeof import("../src/platform/auth/admit")>("../src/platform/auth/admit");

const NOW = new Date("2026-10-18T20:00:00Z");
const PAIR_ID = "3020e46b-8fc9-4f4c-b9a0-cdf9514f1311";
const SECRET = "a".repeat(43);
const SESSION_ID = "synthetic-role-session";
const AUTH_COOKIE = "sb-synthetic-auth-token";
const OWNER_SESSION = "synthetic-owner-session";
const PROJECT_AUTH_COOKIE = "sb-wtgxcptmucjerhufzjcf-auth-token";
const ROLE_ACTIONS = [["request", requestDayrunPair], ["redeem", redeemDayrunPair]] as const;
type Result = { data: unknown; error: Error | null };
type Claims = { claims: { sub?: string; session_id?: string } };
type BufferedCookie = { name: string; value: string; options: CookieOptions };
type CookieBridge = { getAll: () => { name: string; value: string }[]; setAll: (cookies: BufferedCookie[]) => void };

function request(path: string, options: { origin?: string | null; urlOrigin?: string; cookie?: string; form?: Record<string, string> } = {}) {
  const origin = options.origin === undefined ? DAYRUN.roleOrigin : options.origin;
  const headers = new Headers({ cookie: options.cookie ?? `${DAYRUN.cookie}=${PAIR_ID}.${SECRET}` });
  if (origin !== null) headers.set("origin", origin);
  return new NextRequest(`${options.urlOrigin ?? DAYRUN.roleOrigin}${path}`, {
    method: "POST", headers, body: options.form ? new URLSearchParams(options.form) : undefined,
  });
}

function fixture(alias = "teacher") {
  const account = accountForAlias(alias)!;
  const pair = {
    id: PAIR_ID, alias, email: account.email, role: account.role, is_new: false,
    user_id: account.userId!, staff_profile_id: account.staffProfileId!, target_origin: DAYRUN.roleOrigin,
  };
  const owner = { id: DAYRUN.ownerStaffId, userId: DAYRUN.ownerUserId, role: "admin", isActive: true };
  const events: string[] = [];
  const results: Record<string, Result> = {
    qa_dayrun_runs: { data: { enabled: true, revoked_at: null, expires_at: DAYRUN.expiresAt }, error: null },
    qa_dayrun_sessions: { data: { session_id: SESSION_ID }, error: null },
  };
  const rpcResults: Record<string, Result> = {
    qa_dayrun_consume_pair: { data: pair, error: null },
    qa_dayrun_create_pair: { data: { id: PAIR_ID }, error: null },
  };
  const queries: { table: string; eq: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> }[] = [];
  const from = vi.fn((table: string) => {
    const query = {
      table, select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => results[table] ?? { data: null, error: null }),
    };
    queries.push(query);
    return query;
  });
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    void _args;
    events.push(name);
    return rpcResults[name] ?? { data: true, error: null };
  });
  const original = { auth: {
    getClaims: vi.fn(async () => ({ data: null as Claims | null, error: null as Error | null })),
    getUser: vi.fn(async () => ({ data: { user: { id: DAYRUN.ownerUserId as string } }, error: null as Error | null })),
    signOut: vi.fn(async (_options?: { scope: string }) => { void _options; return { error: null as Error | null }; }),
  } };
  const jar = { get: vi.fn((_name: string) => { void _name; return undefined as { value: string } | undefined; }), set: vi.fn(), getAll: vi.fn(() => []) };
  let bridge: CookieBridge;
  const target = { auth: {
    verifyOtp: vi.fn(async () => {
      events.push("verify");
      // Deliberately hostile defaults: the adapter must strip Domain and force Secure + root Path.
      bridge.setAll([{ name: AUTH_COOKIE, value: "synthetic-auth-value", options: { domain: ".vercel.app", secure: false, path: "/wrong", sameSite: "lax" } }]);
      return { data: { user: { id: pair.user_id } }, error: null as Error | null };
    }),
    getClaims: vi.fn(async () => ({ data: { claims: { sub: pair.user_id, session_id: SESSION_ID } } as Claims | null, error: null as Error | null })),
    signOut: vi.fn(async (_options?: { scope: string }) => {
      void _options;
      events.push("local-signout");
      return { error: null as Error | null };
    }),
  } };
  const getUserById = vi.fn(async () => ({ data: { user: { id: pair.user_id, email: pair.email, app_metadata: {} } }, error: null as Error | null }));
  const generateLink = vi.fn(async () => {
    events.push("mint");
    return { data: { user: { id: pair.user_id }, properties: { hashed_token: "synthetic-one-time-hash" } }, error: null as Error | null };
  });
  const admin = { from, rpc, auth: { admin: { getUserById, generateLink } } };
  mocks.admin.mockReturnValue(admin);
  mocks.client.mockResolvedValue(original);
  mocks.target.mockImplementation((_url: string, _key: string, options: { cookies: CookieBridge }) => { bridge = options.cookies; return target; });
  mocks.staff.mockResolvedValue(owner);
  mocks.headers.mockResolvedValue(new Headers({ host: new URL(DAYRUN.origin).host }));
  mocks.cookies.mockResolvedValue(jar);
  mocks.admit.mockImplementation(async () => { events.push("admit"); return { ok: true, staff: { role: account.role, preferredStart: null } }; });
  const setOwner = () => original.auth.getClaims.mockResolvedValue({ data: { claims: { sub: DAYRUN.ownerUserId, session_id: OWNER_SESSION } }, error: null });
  return { account, pair, owner, events, results, rpcResults, queries, rpc, original, target, jar, getUserById, generateLink, setOwner };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", DAYRUN.supabaseOrigin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key-for-mocked-client");
  vi.stubEnv("VPPSONE_ENV", "dev");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in dayrun adapter tests"); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("dayrun redemption adapter", () => {
  test.each(DAYRUN.aliases)("%s emits only the pinned role's host-only Secure cookies after lease and admission", async (alias) => {
    const f = fixture(alias);
    const redirect = vi.spyOn(NextResponse, "redirect");
    mocks.admit.mockImplementation(async () => {
      expect(redirect).not.toHaveBeenCalled();
      expect(f.jar.set).not.toHaveBeenCalled();
      expect(f.events).toContain("qa_dayrun_complete_pair");
      f.events.push("admit");
      return { ok: true, staff: { role: f.account.role, preferredStart: "https://untrusted.test" } };
    });
    const response = await redeemDayrunPair(request("/api/qa/dayrun/redeem"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${DAYRUN.roleOrigin}${f.account.landing}`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const auth = response.cookies.get(AUTH_COOKIE)!;
    expect(auth).toMatchObject({ value: "synthetic-auth-value", secure: true, path: "/" });
    expect(auth.domain).toBeUndefined();
    expect(response.headers.get("set-cookie")).not.toMatch(/Domain=/i);
    expect(response.cookies.get(DAYRUN.cookie)).toMatchObject({ value: "", maxAge: 0, secure: true, httpOnly: true, sameSite: "strict", path: "/" });
    expect(f.events).toEqual(["qa_dayrun_consume_pair", "mint", "verify", "qa_dayrun_complete_pair", "admit"]);
    expect(f.rpc).toHaveBeenCalledWith("qa_dayrun_consume_pair", { p_pair_id: PAIR_ID, p_secret_hash: dayrunHash(SECRET), p_target_origin: DAYRUN.roleOrigin });
    expect(f.getUserById).toHaveBeenCalledWith(f.account.userId);
    expect(f.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: f.account.email });
    expect(f.rpc).toHaveBeenCalledWith("qa_dayrun_complete_pair", { p_pair_id: PAIR_ID, p_session_id: SESSION_ID, p_user_id: f.account.userId });
    expect(mocks.admit).toHaveBeenCalledWith(f.target, f.account.userId, { signOutScope: "local", expectedStaffProfileId: f.account.staffProfileId });
    expect(f.original.auth.signOut).not.toHaveBeenCalled();
    expect(f.jar.set).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    { origin: null }, { origin: "https://evil.test" }, { origin: DAYRUN.origin },
    { origin: DAYRUN.roleOrigin, urlOrigin: DAYRUN.origin },
  ])("rejects unauthorized origin before clients or cookie effects: %j", async (options) => {
    const f = fixture();
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem", options))).rejects.toThrow();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(f.jar.set).not.toHaveBeenCalled();
  });

  test.each([
    { enabled: false, revoked_at: null, expires_at: DAYRUN.expiresAt },
    { enabled: true, revoked_at: NOW.toISOString(), expires_at: DAYRUN.expiresAt },
    { enabled: true, revoked_at: null, expires_at: NOW.toISOString() },
  ])("disabled, revoked or expired persisted run cannot mint: %j", async (run) => {
    const f = fixture(); f.results.qa_dayrun_runs = { data: run, error: null };
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.generateLink).not.toHaveBeenCalled();
  });
  test("hard deadline rejects even if the database says the run is enabled", async () => {
    const f = fixture(); vi.setSystemTime(new Date(DAYRUN.expiresAt));
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow();
    expect(mocks.admin).not.toHaveBeenCalled(); expect(f.generateLink).not.toHaveBeenCalled();
  });
  test("a failed run lookup or malformed pairing cookie cannot mint", async () => {
    const f = fixture(); f.results.qa_dayrun_runs = { data: null, error: new Error("synthetic lookup failure") };
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow();
    f.results.qa_dayrun_runs = { data: { enabled: true, revoked_at: null, expires_at: DAYRUN.expiresAt }, error: null };
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem", { cookie: `${DAYRUN.cookie}=invalid` }))).rejects.toThrow();
    expect(f.generateLink).not.toHaveBeenCalled();
  });

  test.each([DAYRUN.ownerUserId, "synthetic-existing-qa-user"])("preserves an already signed-in role context (%s)", async (sub) => {
    const f = fixture(); f.original.auth.getClaims.mockResolvedValue({ data: { claims: { sub, session_id: "existing-session" } }, error: null });
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow("separate signed-out browser");
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.generateLink).not.toHaveBeenCalled();
    expect(f.original.auth.signOut).not.toHaveBeenCalled(); expect(f.target.auth.signOut).not.toHaveBeenCalled();
  });
  test.each(ROLE_ACTIONS)("%s fails closed when existing-session verification fails", async (_label, action) => {
    const f = fixture(); f.original.auth.getClaims.mockResolvedValue({ data: null, error: new Error("synthetic claims failure") });
    await expect(action(request("/api/qa/dayrun/action", { cookie: `${DAYRUN.cookie}=${PAIR_ID}.${SECRET}; ${PROJECT_AUTH_COOKIE}=existing-auth-context` }))).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.generateLink).not.toHaveBeenCalled();
    expect(f.original.auth.signOut).not.toHaveBeenCalled();
  });
  test.each(ROLE_ACTIONS)("%s permits the SDK's missing-session result only in a genuinely signed-out browser", async (_label, action) => {
    const f = fixture(); f.original.auth.getClaims.mockResolvedValue({ data: null, error: new AuthSessionMissingError() });
    const response = await action(request("/api/qa/dayrun/action"));
    expect(response.status).toBe(303);
    expect(f.original.auth.signOut).not.toHaveBeenCalled();
  });
  for (const [label, action] of ROLE_ACTIONS) {
    test.each([
      [PROJECT_AUTH_COOKIE, null], [`${PROJECT_AUTH_COOKIE}.0`, null], [`${PROJECT_AUTH_COOKIE}.1`, null],
      [PROJECT_AUTH_COOKIE, new AuthSessionMissingError()], [`${PROJECT_AUTH_COOKIE}.0`, new AuthSessionMissingError()], [`${PROJECT_AUTH_COOKIE}.1`, new AuthSessionMissingError()],
    ])(`${label} preserves a present auth cookie even without a verified subject: %s`, async (cookie, error) => {
      const f = fixture(); f.original.auth.getClaims.mockResolvedValue({ data: null, error });
      const redirect = vi.spyOn(NextResponse, "redirect");
      await expect(action(request("/api/qa/dayrun/action", { cookie: `${DAYRUN.cookie}=${PAIR_ID}.${SECRET}; ${cookie}=synthetic-existing-chunk` }))).rejects.toThrow();
      expect(f.rpc).not.toHaveBeenCalled(); expect(f.generateLink).not.toHaveBeenCalled();
      expect(f.original.auth.signOut).not.toHaveBeenCalled(); expect(redirect).not.toHaveBeenCalled();
    });
  }

  test.each([
    { alias: "owner" }, { email: "different@qa.vpps.local" }, { role: "admin" },
    { user_id: "different-user" }, { staff_profile_id: "different-profile" },
    { is_new: true }, { target_origin: DAYRUN.origin },
  ])("unpinned pair cannot mint an auth token: %j", async (change) => {
    const f = fixture(); f.rpcResults.qa_dayrun_consume_pair = { data: { ...f.pair, ...change }, error: null };
    const redirect = vi.spyOn(NextResponse, "redirect");
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow();
    expect(f.generateLink).not.toHaveBeenCalled(); expect(redirect).not.toHaveBeenCalled(); expect(f.jar.set).not.toHaveBeenCalled();
    expect(f.original.auth.signOut).not.toHaveBeenCalled();
  });
  test("auth-directory identity must still match the pinned account", async () => {
    const f = fixture(); f.getUserById.mockResolvedValue({ data: { user: { id: f.pair.user_id, email: "changed@qa.vpps.local", app_metadata: {} } }, error: null });
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow();
    expect(f.generateLink).not.toHaveBeenCalled(); expect(mocks.admit).not.toHaveBeenCalled();
  });
  test("generateLink returning another account cannot reach OTP verification", async () => {
    const f = fixture(); f.generateLink.mockResolvedValue({ data: { user: { id: "wrong-user" }, properties: { hashed_token: "synthetic-wrong-hash" } }, error: null });
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow();
    expect(f.target.auth.verifyOtp).not.toHaveBeenCalled();
  });

  test.each(["complete-false", "complete-error", "admit-refusal", "admit-error", "admit-role", "claims-error", "verified-user"])("failure after verification emits no auth cookie and revokes only the new session: %s", async (failure) => {
    const f = fixture(); const redirect = vi.spyOn(NextResponse, "redirect");
    if (failure === "complete-false") f.rpcResults.qa_dayrun_complete_pair = { data: false, error: null };
    if (failure === "complete-error") f.rpcResults.qa_dayrun_complete_pair = { data: null, error: new Error("synthetic complete failure") };
    if (failure === "admit-refusal") mocks.admit.mockResolvedValue({ ok: false });
    if (failure === "admit-error") mocks.admit.mockRejectedValue(new Error("synthetic admission failure"));
    if (failure === "admit-role") mocks.admit.mockResolvedValue({ ok: true, staff: { role: "admin" } });
    if (failure === "claims-error") f.target.auth.getClaims.mockResolvedValue({ data: null, error: new Error("synthetic verification failure") });
    if (failure === "verified-user") f.target.auth.verifyOtp.mockResolvedValue({ data: { user: { id: "wrong-user" } }, error: null });
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow();
    expect(redirect).not.toHaveBeenCalled(); expect(f.jar.set).not.toHaveBeenCalled();
    expect(f.original.auth.signOut).not.toHaveBeenCalled();
    expect(f.target.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(f.rpc).toHaveBeenCalledWith("qa_dayrun_fail_pair", { p_pair_id: PAIR_ID, p_secret_hash: dayrunHash(SECRET) });
    if (failure !== "claims-error") expect(f.rpc).toHaveBeenCalledWith("qa_dayrun_revoke_session", { p_session_id: SESSION_ID });
    if (failure.startsWith("complete") || failure === "claims-error" || failure === "verified-user") expect(mocks.admit).not.toHaveBeenCalled();
  });

  test("replayed or unconsumed pair cannot invalidate another session or pair", async () => {
    const f = fixture(); f.rpcResults.qa_dayrun_consume_pair = { data: null, error: new Error("synthetic replay") };
    await expect(redeemDayrunPair(request("/api/qa/dayrun/redeem"))).rejects.toThrow();
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["qa_dayrun_consume_pair"]);
    expect(f.target.auth.signOut).not.toHaveBeenCalled(); expect(f.generateLink).not.toHaveBeenCalled();
  });
  test("request sets only an opaque host-only pairing cookie, never an auth cookie", async () => {
    const f = fixture(); const response = await requestDayrunPair(request("/api/qa/dayrun/request"));
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.cookies.get(DAYRUN.cookie)).toMatchObject({ secure: true, httpOnly: true, sameSite: "strict", path: "/", maxAge: 300 });
    expect(response.headers.get("set-cookie")).not.toMatch(/Domain=/i);
    expect(f.generateLink).not.toHaveBeenCalled(); expect(f.original.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("owner authorization preserves Raj's main-host session", () => {
  test("requires verified owner plus persisted active owner session without changing cookies", async () => {
    const f = fixture(); f.setOwner();
    await expect(requireDayrunOwner()).resolves.toEqual(f.owner);
    expect(f.rpc).toHaveBeenCalledWith("qa_dayrun_owner_session_valid", { p_session_id: OWNER_SESSION });
    expect(f.original.auth.signOut).not.toHaveBeenCalled(); expect(f.jar.set).not.toHaveBeenCalled();
  });
  test.each(["staff-id", "user-id", "role", "inactive", "verified-user", "preview", "role-host", "missing-session", "expired-session", "claims-error"])("refuses %s before owner operations", async (failure) => {
    const f = fixture(); f.setOwner();
    if (failure === "staff-id") mocks.staff.mockResolvedValue({ ...f.owner, id: "another-staff" });
    if (failure === "user-id") mocks.staff.mockResolvedValue({ ...f.owner, userId: "another-user" });
    if (failure === "role") mocks.staff.mockResolvedValue({ ...f.owner, role: "teacher" });
    if (failure === "inactive") mocks.staff.mockResolvedValue({ ...f.owner, isActive: false });
    if (failure === "verified-user") f.original.auth.getUser.mockResolvedValue({ data: { user: { id: "another-user" } }, error: null });
    if (failure === "preview") f.jar.get.mockReturnValue({ value: "teacher" });
    if (failure === "role-host") mocks.headers.mockResolvedValue(new Headers({ host: new URL(DAYRUN.roleOrigin).host }));
    if (failure === "missing-session") f.original.auth.getClaims.mockResolvedValue({ data: { claims: { sub: DAYRUN.ownerUserId } }, error: null });
    if (failure === "expired-session") f.rpcResults.qa_dayrun_owner_session_valid = { data: false, error: null };
    if (failure === "claims-error") f.original.auth.getClaims.mockResolvedValue({ data: null, error: new Error("synthetic failure") });
    await expect(administerDayrun(request("/api/qa/dayrun", { origin: DAYRUN.origin, urlOrigin: DAYRUN.origin, form: { operation: "approve", alias: "teacher", pairId: PAIR_ID } }))).rejects.toThrow();
    expect(f.rpc.mock.calls.some(([name]) => name === "qa_dayrun_approve_pair")).toBe(false);
    expect(f.generateLink).not.toHaveBeenCalled(); expect(f.original.auth.signOut).not.toHaveBeenCalled(); expect(f.jar.set).not.toHaveBeenCalled();
  });
});

describe("End session is local and lease scoped", () => {
  test("revokes this lease and uses local sign-out even after the run deadline", async () => {
    const f = fixture(); vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
    f.original.auth.getClaims.mockResolvedValue({ data: { claims: { sub: f.pair.user_id, session_id: SESSION_ID } }, error: null });
    const response = await endDayrunSession(request("/api/qa/dayrun/end"));
    expect(f.queries[0].table).toBe("qa_dayrun_sessions");
    expect(f.queries[0].eq).toHaveBeenCalledWith("run_id", DAYRUN.id);
    expect(f.queries[0].eq).toHaveBeenCalledWith("session_id", SESSION_ID);
    expect(f.rpc).toHaveBeenCalledWith("qa_dayrun_revoke_session", { p_session_id: SESSION_ID });
    expect(f.original.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(mocks.target).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${DAYRUN.roleOrigin}/login/dayrun`);
    expect(response.cookies.get(DAYRUN.cookie)).toMatchObject({ maxAge: 0, secure: true, path: "/" });
  });
  test.each(["unrelated-session", "lease-error", "revoke-error", "owner-host"])("does not sign out an unrelated or unverifiable context: %s", async (failure) => {
    const f = fixture(); f.original.auth.getClaims.mockResolvedValue({ data: { claims: { sub: DAYRUN.ownerUserId, session_id: OWNER_SESSION } }, error: null });
    if (failure === "unrelated-session") f.results.qa_dayrun_sessions = { data: null, error: null };
    if (failure === "lease-error") f.results.qa_dayrun_sessions = { data: null, error: new Error("synthetic lookup failure") };
    if (failure === "revoke-error") f.rpcResults.qa_dayrun_revoke_session = { data: null, error: new Error("synthetic revoke failure") };
    const req = failure === "owner-host" ? request("/api/qa/dayrun/end", { origin: DAYRUN.origin, urlOrigin: DAYRUN.origin }) : request("/api/qa/dayrun/end");
    await expect(endDayrunSession(req)).rejects.toThrow();
    expect(f.original.auth.signOut).not.toHaveBeenCalled(); expect(mocks.target).not.toHaveBeenCalled();
  });
  test.each(["claims", "signout"])("does not report successful End when %s fails", async (failure) => {
    const f = fixture(); f.original.auth.getClaims.mockResolvedValue({ data: { claims: { sub: f.pair.user_id, session_id: SESSION_ID } }, error: null });
    if (failure === "claims") f.original.auth.getClaims.mockResolvedValue({ data: null, error: new Error("synthetic claims failure") });
    if (failure === "signout") f.original.auth.signOut.mockResolvedValue({ error: new Error("synthetic signout failure") });
    await expect(endDayrunSession(request("/api/qa/dayrun/end", { cookie: `${DAYRUN.cookie}=${PAIR_ID}.${SECRET}; ${PROJECT_AUTH_COOKIE}.0=synthetic-existing-chunk` }))).rejects.toThrow();
  });
});

describe("normal admission's optional pinned-profile/local-signout contract", () => {
  function admission(profile: Record<string, unknown> | null) {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: profile, error: null })) };
    const signOut = vi.fn(async () => ({ error: null }));
    const client = { from: vi.fn(() => query), auth: { signOut } } as unknown as Parameters<typeof admitActual>[0];
    return { client, signOut, query };
  }
  const profile = { id: "pinned-staff", role: "teacher", is_active: true, preferred_language: "hi", preferred_start: "/teach" };
  test("matching active profile uses normal language and role admission", async () => {
    const f = admission(profile);
    await expect(admitActual(f.client, "pinned-user", { signOutScope: "local", expectedStaffProfileId: "pinned-staff" })).resolves.toEqual({ ok: true, staff: { role: "teacher", preferredStart: "/teach" } });
    expect(f.query.eq).toHaveBeenCalledWith("user_id", "pinned-user"); expect(f.signOut).not.toHaveBeenCalled(); expect(mocks.language).toHaveBeenCalledWith("hi");
  });
  test.each([null, { ...profile, id: "rebound-same-role-profile" }, { ...profile, is_active: false }])("missing, rebound or inactive profile signs out only the new local session: %j", async (value) => {
    const f = admission(value);
    await expect(admitActual(f.client, "pinned-user", { signOutScope: "local", expectedStaffProfileId: "pinned-staff" })).resolves.toMatchObject({ ok: false });
    expect(f.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" }); expect(mocks.language).not.toHaveBeenCalled();
  });
  test("ordinary callers retain their existing admission/sign-out behavior", async () => {
    const f = admission(null);
    await expect(admitActual(f.client, "ordinary-user")).resolves.toMatchObject({ ok: false });
    expect(f.signOut).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
