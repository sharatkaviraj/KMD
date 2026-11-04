import { describe, expect, it } from "vitest";

import { AI_CONNECTION_ROLES, aiConnectionEligibility } from "@/modules/mcp/domain/eligibility";
import { handleMcp } from "@/modules/mcp/domain/mcp";
import type { StaffRole } from "@/platform/auth/permissions";

import { ADMIN, CONFINED_ENV, connect, mcpRequest, setup, TEACHER, toolCall, type Harness } from "./harness";

type CallResult = { status: number; result?: { isError: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> }; error?: { code: number } };

async function call(h: Harness, token: string, name: string, args?: unknown): Promise<CallResult> {
  const response = await handleMcp(mcpRequest(h, token, toolCall(name, args)), h.mcp);
  if (response.status !== 200) return { status: response.status };
  const json = (await response.json()) as { result?: CallResult["result"]; error?: CallResult["error"] };
  return { status: 200, ...json };
}

/**
 * Grant a connection to someone the pilot no longer allows — as happens when
 * an admin's role changes after consent, or a teacher stage is rolled back —
 * by writing the grant directly, as the database would hold it.
 */
async function connectBypassingConsent(h: Harness, actor: typeof TEACHER) {
  return connect(h, actor);
}

describe("every tool call runs the whole pipeline", () => {
  it("runs a tool for an eligible admin and logs one metadata-only row", async () => {
    const h = setup();
    const tokens = await connect(h);
    const result = await call(h, tokens.access_token, "who_is_away", { date: "2026-11-03" });
    expect(result.result?.isError).toBe(false);
    expect(h.runtimeCalls).toEqual([`absences:${ADMIN.id}:2026-27:2026-11-03`]);
    expect(h.store.calls).toHaveLength(1);
    const row = h.store.calls[0];
    expect(Object.keys(row).sort()).toEqual(["connectionId", "createdAt", "durationMs", "outcome", "provider", "rowCount", "staffProfileId", "tool"]);
    expect(row).toMatchObject({ staffProfileId: ADMIN.id, provider: "claude", tool: "who_is_away", outcome: "ok", rowCount: 3 });
  });

  it("logs no argument, name or free text — even for a refused call", async () => {
    const h = setup();
    const tokens = await connect(h);
    await call(h, tokens.access_token, "who_is_away", { date: "2026-11-03", note: "SECRET-TEXT", staff: "Somebody Named" });
    await call(h, tokens.access_token, "who_is_away", { date: "2026-11-03" });
    await call(h, tokens.access_token, "SECRET-TOOL-NAME", { x: 1 });
    const logged = JSON.stringify(h.store.calls);
    for (const text of ["SECRET-TEXT", "Somebody Named", "2026-11-03", "SECRET-TOOL-NAME", "Away Whole", "Hospital"]) expect(logged).not.toContain(text);
    expect(h.store.calls.map((row) => `${row.tool}:${row.outcome}`)).toEqual(["who_is_away:refused:invalid_arguments", "who_is_away:ok", "unknown:refused:unknown_tool"]);
  });

  it("refuses every tool while the kill switch is off, and when it cannot be read", async () => {
    const h = setup();
    const tokens = await connect(h);
    for (const state of [false, "unreadable"] as const) {
      h.store.killSwitch = state;
      const result = await call(h, tokens.access_token, "get_context");
      expect(result.status).toBe(200);
      expect(result.result?.isError).toBe(true);
      expect(result.result?.content[0].text).toMatch(/switched the AI connection off/);
    }
    expect(h.runtimeCalls).toEqual([]);
    expect(h.store.calls.map((row) => row.outcome)).toEqual(["refused:switched_off", "refused:switched_off"]);
  });

  it("refuses an inactive staff member with 401 and revokes their connection", async () => {
    const h = setup();
    const tokens = await connect(h);
    h.staff.set(ADMIN.userId, { ...ADMIN, isActive: false });
    const result = await call(h, tokens.access_token, "get_context");
    expect(result.status).toBe(401);
    const connection = [...h.store.connections.values()][0];
    expect(connection.revokeReason).toBe("inactive");
    expect(h.store.calls.at(-1)?.outcome).toBe("refused:inactive");
    // And it stays refused.
    expect((await call(h, tokens.access_token, "get_context")).status).toBe(401);
  });

  it("refuses and revokes when the staff profile is gone or no longer this connection's", async () => {
    const gone = setup();
    const t1 = await connect(gone);
    gone.staff.delete(ADMIN.userId);
    expect((await call(gone, t1.access_token, "get_context")).status).toBe(401);
    expect([...gone.store.connections.values()][0].revokeReason).toBe("inactive");

    const moved = setup();
    const t2 = await connect(moved);
    moved.staff.set(ADMIN.userId, { ...ADMIN, id: "33333333-3333-4333-8333-333333333333" });
    expect((await call(moved, t2.access_token, "get_context")).status).toBe(401);
    expect([...moved.store.connections.values()][0].revokeReason).toBe("staff_mismatch");
  });

  it("does not let a non-admin connect or call (admins first, D7)", async () => {
    expect(aiConnectionEligibility({ role: "teacher", isActive: true })).toEqual({ ok: false, reason: "not_eligible" });
    expect(aiConnectionEligibility({ role: "office", isActive: true })).toEqual({ ok: false, reason: "not_eligible" });
    expect(aiConnectionEligibility({ role: "admin", isActive: true })).toEqual({ ok: true });

    // A teacher holding a grant anyway (role changed after consent) is refused at the call and the grant ended.
    const h = setup();
    const tokens = await connectBypassingConsent(h, TEACHER);
    const result = await call(h, tokens.access_token, "who_is_away");
    expect(result.status).toBe(401);
    expect([...h.store.connections.values()][0].revokeReason).toBe("not_eligible");
    expect(h.runtimeCalls).toEqual([]);
  });

  it("refuses a role demoted after consent on the next call", async () => {
    const h = setup();
    const tokens = await connect(h);
    expect((await call(h, tokens.access_token, "get_context")).result?.isError).toBe(false);
    h.staff.set(ADMIN.userId, { ...ADMIN, role: "office" });
    expect((await call(h, tokens.access_token, "get_context")).status).toBe(401);
  });

  it("keeps non-admins out of TEST, on a confined deployment too (D11)", async () => {
    // Every account on a confined deployment is a test account; a teacher there is refused before any read.
    expect(aiConnectionEligibility({ role: "teacher", isActive: true, isTestAccount: true })).toEqual({ ok: false, reason: "test_not_admin" });
    expect(aiConnectionEligibility({ role: "office", isActive: true, isTestAccount: true })).toEqual({ ok: false, reason: "test_not_admin" });
    expect(aiConnectionEligibility({ role: "admin", isActive: true, isTestAccount: true })).toEqual({ ok: true });

    const h = setup({ env: CONFINED_ENV });
    const tokens = await connect(h, TEACHER);
    const result = await call(h, tokens.access_token, "get_context");
    expect(result.status).toBe(401);
    expect([...h.store.connections.values()][0].revokeReason).toBe("test_not_admin");
    expect(h.runtimeCalls).toEqual([]);
  });

  it("gives an admin on a confined deployment the TEST session, and says so", async () => {
    const h = setup({ env: CONFINED_ENV });
    const tokens = await connect(h, ADMIN);
    const result = await call(h, tokens.access_token, "get_context");
    expect(result.result?.structuredContent).toMatchObject({ sessionLabel: "TEST-2026-27", testSession: true, role: "Admin" });
  });

  it("with the teacher stage switched on, keeps every tool's own permission and scope, and TEST for admins", async () => {
    // The one-line change D7 anticipates, made for this test only.
    const roles = AI_CONNECTION_ROLES as StaffRole[];
    roles.push("teacher");
    try {
      const h = setup();
      const tokens = await connect(h, TEACHER);
      // Any active staff may see who is away (the screen's own rule)…
      expect((await call(h, tokens.access_token, "who_is_away")).result?.isError).toBe(false);
      // …but the school board needs every class, and pending leave needs substitutions:manage.
      expect((await call(h, tokens.access_token, "school_day_summary")).result?.content[0].text).toMatch(/every class/);
      expect((await call(h, tokens.access_token, "pending_leave")).result?.content[0].text).toMatch(/role/);
      // A matrix edit takes effect on the next call: no substitutions:view, no cover plan.
      h.staff.set(TEACHER.userId, { ...TEACHER, permissions: ["dashboard:view"] });
      expect((await call(h, tokens.access_token, "cover_plan")).result?.content[0].text).toMatch(/role/);
      expect(h.store.calls.map((row) => row.outcome)).toEqual(["ok", "refused:scope", "refused:permission", "refused:permission"]);

      // Should the session rule ever hand a real teacher TEST, the pipeline refuses before reading.
      const fenced = setup({ session: () => "TEST-2026-27" });
      const t2 = await connect(fenced, TEACHER);
      expect((await call(fenced, t2.access_token, "who_is_away")).result?.isError).toBe(true);
      expect(fenced.runtimeCalls).toEqual([]);

      // And a teacher on a confined deployment — a test account there — is still refused outright.
      const confined = setup({ env: CONFINED_ENV });
      const t3 = await connect(confined, TEACHER);
      expect((await call(confined, t3.access_token, "who_is_away")).status).toBe(401);
    } finally {
      roles.pop();
    }
    expect(AI_CONNECTION_ROLES).toEqual(["admin"]);
  });

  it("refuses when there is no session, without reading anything", async () => {
    const h = setup({ session: () => null });
    const tokens = await connect(h);
    const result = await call(h, tokens.access_token, "who_is_away");
    expect(result.result?.isError).toBe(true);
    expect(h.store.calls.at(-1)?.outcome).toBe("refused:no_session");
    expect(h.runtimeCalls).toEqual([]);
  });

  it("rejects unknown fields, tampered types and identity arguments", async () => {
    const h = setup();
    const tokens = await connect(h);
    const bad: unknown[] = [
      { date: "2026-11-03", staff_id: ADMIN.id },
      { date: "2026-11-03", sessionLabel: "TEST-2026-27" },
      { date: "2026-11-03", role: "admin" },
      { date: "2026-11-03", act_as: "someone" },
      { date: "2026-11-03", school: "x" },
      { date: 20261103 },
      { date: "03-11-2026" },
      { date: "2026-02-30" },
      { date: "2026-11-03'; drop table x;--" },
      { date: "2025-01-01" }, // outside the window
      ["2026-11-03"],
      "2026-11-03",
    ];
    for (const args of bad) {
      const result = await call(h, tokens.access_token, "who_is_away", args);
      expect(result.result?.isError, JSON.stringify(args)).toBe(true);
    }
    expect(h.runtimeCalls).toEqual([]);
    expect(new Set(h.store.calls.map((row) => row.outcome))).toEqual(new Set(["refused:invalid_arguments"]));
    expect((await call(h, tokens.access_token, "get_context", { anything: 1 })).result?.isError).toBe(true);
    expect((await call(h, tokens.access_token, "pending_leave", { sessionLabel: "2026-27" })).result?.isError).toBe(true);
  });

  it("answers an unknown tool with a JSON-RPC error", async () => {
    const h = setup();
    const tokens = await connect(h);
    const result = await call(h, tokens.access_token, "delete_everything");
    expect(result.error?.code).toBe(-32602);
  });

  it("limits each staff member to 60 calls an hour and 400 a day", async () => {
    const h = setup();
    const tokens = await connect(h);
    for (let i = 0; i < 60; i += 1) expect((await call(h, tokens.access_token, "get_context")).result?.isError).toBe(false);
    const limited = await call(h, tokens.access_token, "get_context");
    expect(limited.result?.isError).toBe(true);
    expect(limited.result?.content[0].text).toMatch(/limit/);
    expect(h.store.calls.at(-1)?.outcome).toBe("refused:rate_limited");
    // Knocking again does not extend the limit; an hour later it is open again.
    h.store.advance(61 * 60_000);
    const fresh = await connect(h); // the access token above has expired by now
    expect((await call(h, fresh.access_token, "get_context")).result?.isError).toBe(false);

    // The daily cap counts the last 24 hours.
    const day = setup();
    const t = await connect(day);
    for (let i = 0; i < 400; i += 1) day.store.calls.push({ staffProfileId: ADMIN.id, connectionId: "c", provider: "claude", tool: "get_context", outcome: "ok", rowCount: 1, durationMs: 1, createdAt: day.store.now - 2 * 3_600_000 });
    expect((await call(day, t.access_token, "get_context")).result?.isError).toBe(true);
  });

  it("checks the limit before any refusal, so refused calls count and cannot flood the log (L4)", async () => {
    const h = setup();
    const tokens = await connect(h);
    h.store.killSwitch = false; // every call is refused…
    for (let i = 0; i < 60; i += 1) await call(h, tokens.access_token, i % 2 ? "get_context" : "no_such_tool", i % 3 ? undefined : { junk: "x" });
    expect(h.store.calls).toHaveLength(60); // …and each refusal counted
    // From here on the token is limited: 200 more knocks write ONE more row, and reach nothing else.
    let switchReads = 0;
    const original = h.store.killSwitchOn.bind(h.store);
    h.store.killSwitchOn = async () => {
      switchReads += 1;
      return original();
    };
    for (let i = 0; i < 200; i += 1) {
      const result = await call(h, tokens.access_token, "no_such_tool");
      expect(result.result?.content[0].text).toMatch(/limit/);
    }
    expect(h.store.calls).toHaveLength(61);
    expect(h.store.calls.at(-1)?.outcome).toBe("refused:rate_limited");
    expect(switchReads).toBe(0);
    expect(h.runtimeCalls).toEqual([]);
  });

  it("re-reads everything on every call: nothing carries over", async () => {
    const h = setup();
    const tokens = await connect(h);
    expect((await call(h, tokens.access_token, "get_context")).result?.isError).toBe(false);
    h.store.killSwitch = false;
    expect((await call(h, tokens.access_token, "get_context")).result?.isError).toBe(true);
    h.store.killSwitch = true;
    expect((await call(h, tokens.access_token, "get_context")).result?.isError).toBe(false);
  });

  it("re-checks the token for each call in a batch", async () => {
    const h = setup();
    const tokens = await connect(h);
    const connection = [...h.store.connections.values()][0];
    let reads = 0;
    const original = h.store.resolveToken.bind(h.store);
    h.store.resolveToken = async (hash) => {
      reads += 1;
      if (reads === 3) await h.store.revokeConnection(connection.id, "disconnected_by_admin", null);
      return original(hash);
    };
    const response = await handleMcp(mcpRequest(h, tokens.access_token, [toolCall("get_context", undefined, 1), toolCall("get_context", undefined, 2)]), h.mcp);
    expect(response.status).toBe(401);
  });
});
