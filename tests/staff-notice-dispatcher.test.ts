import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("the real database is never reached in this test");
  },
}));
vi.mock("@/modules/substitutions/data/cover-repo", () => ({
  currentBells: async () => ({ periods: [{ index: 2, starts: "10:00", ends: "10:40" }] }),
}));

import { dispatchStaffNotices, staffTransportName, type StaffTransport } from "@/modules/staff-notices/data/dispatcher";
import type { StaffGateFacts } from "@/modules/staff-notices/domain/gates";
import { seededKindsMap } from "@/modules/staff-notices/domain/kinds";

/**
 * The dispatcher with the staff gate in front of it (go-live Phase F), against
 * a fake database and a fake transport: what is sent, what is handed back and
 * why, the digest, and the one-a-second pace. Nothing here reaches AiSensy.
 */

const AT_10 = new Date("2026-11-02T04:30:00.000Z");
const AT_0630 = new Date("2026-11-02T01:00:00.000Z");
const allOn = Object.fromEntries(Object.keys(seededKindsMap()).map((kind) => [kind, true]));

function facts(overrides: Partial<StaffGateFacts> = {}): StaffGateFacts {
  return {
    optInAt: "2026-10-01T05:00:00.000Z",
    optOutAt: null,
    isTestAccount: false,
    isTestSession: false,
    prefEnabled: null,
    kindsEnabled: allOn,
    sentToday: 0,
    recentSameKind: 0,
    pendingSameKind: 0,
    heldForDigest: false,
    monthSent: 0,
    monthCap: 1000,
    allowlisted: false,
    ...overrides,
  };
}

type Claim = Record<string, unknown>;

function claim(kind: string, gate: Partial<StaffGateFacts> | null = {}, extra: Partial<Claim> = {}): Claim {
  return {
    claimed: true,
    attempt_id: `attempt-${kind}`,
    notice: {
      id: `notice-${kind}`,
      kind,
      day: "2026-11-02",
      period: kind.startsWith("cover") ? 2 : null,
      session_label: "2026-27",
      payload:
        kind.startsWith("cover") || kind === "attendance_reminder"
          ? null
          : { request_id: "q1", request_kind: "write_off", amount: 1200, class_label: "5 A", student_name: "Test Child", requested_by_name: "Test Accountant" },
    },
    duty: kind.startsWith("cover") ? { id: "duty-1", class_labels: ["5 A"], subject_code: "MAT", period: 2, day: "2026-11-02" } : null,
    register: kind === "attendance_reminder" ? { class_id: "class-1", class_label: "5 A", day: "2026-11-02" } : null,
    staff: { id: "staff-1", display_name: "Test Teacher", language: "en" },
    destination: "9000000001",
    gate: gate === null ? null : facts(gate),
    student_names: false,
    ...extra,
  };
}

function fakeDb(claims: Claim[]) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const queue = [...claims];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (fn === "sweep_staff_notices") return { data: { released: 0, unknown: 0 }, error: null };
      if (fn === "claim_staff_notice") return { data: queue.shift() ?? { claimed: false, reason: "empty" }, error: null };
      if (fn === "stamp_staff_notice") return { data: true, error: null };
      if (fn === "digest_staff_notices") return { data: 3, error: null };
      return { data: { recorded: true }, error: null };
    },
  };
}

function fakeTransport(name: "mock" | "aisensy" = "aisensy") {
  const sent: Array<{ templateCode: string; params: string[]; destination: string }> = [];
  const transport: StaffTransport = {
    name,
    send: async (input) => {
      sent.push(input);
      return { outcome: "accepted", providerMessageId: `p-${sent.length}`, status: 200 };
    },
  };
  return { transport, sent };
}

const run = (db: ReturnType<typeof fakeDb>, transport: StaffTransport, extra: Record<string, unknown> = {}) =>
  dispatchStaffNotices({ client: db, transport, now: () => AT_10, confined: false, origin: "https://one.example.test", sleep: async () => undefined, ...extra });

const released = (db: ReturnType<typeof fakeDb>) => db.calls.filter((call) => call.fn === "release_staff_notice").map((call) => call.args);

describe("the gate stands in front of every send", () => {
  it("sends a notice that passes, with the stamp before the provider and the finish after", async () => {
    const db = fakeDb([claim("money_request")]);
    const { transport, sent } = fakeTransport();
    const summary = await run(db, transport);

    expect(summary).toMatchObject({ claimed: 1, accepted: 1, suppressed: 0, held: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].templateCode).toBe("vx_staff_money_request_v1");
    expect(sent[0].params.join(" ")).not.toContain("Test Child");
    const order = db.calls.map((call) => call.fn);
    expect(order.indexOf("stamp_staff_notice")).toBeLessThan(order.indexOf("finish_staff_notice"));
  });

  it.each([
    ["no consent", { optInAt: null }, "no_consent"],
    ["an opt-out", { optOutAt: "2026-10-20T00:00:00.000Z" }, "opted_out"],
    ["the kind switched off", { kindsEnabled: { ...allOn, money_request: false } }, "kind_off"],
    ["their own switch off", { prefEnabled: false }, "pref_off"],
    ["a TEST session off the allowlist", { isTestSession: true }, "not_test_recipient"],
    ["a test account off the allowlist", { isTestAccount: true }, "not_test_recipient"],
    ["the daily limit", { sentToday: 8 }, "daily_cap"],
    ["the month's cap", { monthSent: 1000 }, "month_cap"],
  ] as const)("hands the claim back, unsent, on %s", async (_label, gate, reason) => {
    const db = fakeDb([claim("money_request", gate)]);
    const { transport, sent } = fakeTransport();
    const summary = await run(db, transport);

    expect(sent).toHaveLength(0);
    expect(summary.suppressed).toBe(1);
    expect(released(db)).toEqual([expect.objectContaining({ p_action: "suppress", p_reason: reason, p_attempt: "attempt-money_request" })]);
    expect(db.calls.some((call) => call.fn === "stamp_staff_notice")).toBe(false);
  });

  it("holds until 07:00 outside the window, but sends cover at once", async () => {
    const db = fakeDb([claim("money_request"), claim("cover_assigned")]);
    const { transport, sent } = fakeTransport();
    const summary = await run(db, transport, { now: () => AT_0630 });

    expect(summary).toMatchObject({ held: 1, accepted: 1 });
    expect(released(db)[0]).toMatchObject({ p_action: "defer", p_reason: "outside_window", p_until: "2026-11-02T01:30:00.000Z" });
    expect(sent.map((s) => s.templateCode)).toEqual(["vppsone_cover_assigned"]);
  });

  it("sends nothing on unreadable facts: held five minutes", async () => {
    const db = fakeDb([claim("money_request", null)]);
    const { transport, sent } = fakeTransport();
    await run(db, transport);
    expect(sent).toHaveLength(0);
    expect(released(db)[0]).toMatchObject({ p_action: "defer", p_reason: "gate_unreadable" });
  });

  it("on a confined deployment, only an allowlisted number receives anything", async () => {
    const off = fakeDb([claim("cover_assigned")]);
    const a = fakeTransport();
    await run(off, a.transport, { confined: true });
    expect(a.sent).toHaveLength(0);
    expect(released(off)[0]).toMatchObject({ p_reason: "not_test_recipient" });

    const on = fakeDb([claim("cover_assigned", { allowlisted: true })]);
    const b = fakeTransport();
    await run(on, b.transport, { confined: true });
    expect(b.sent).toHaveLength(1);
  });

  it("refuses a rendered message that would carry a phone number", async () => {
    const db = fakeDb([
      claim("staff_broadcast", {}, {
        notice: { id: "n", kind: "staff_broadcast", day: "2026-11-02", period: null, session_label: "2026-27", payload: { hi: "कॉल 9000000002", en: "call 9000000002" } },
      }),
    ]);
    const { transport, sent } = fakeTransport();
    await run(db, transport);
    expect(sent).toHaveLength(0);
    expect(released(db)[0]).toMatchObject({ p_action: "suppress", p_reason: "render_refused" });
  });

  it("hands back a kind it does not know", async () => {
    const db = fakeDb([claim("teacher_task")]);
    const { transport, sent } = fakeTransport();
    await run(db, transport);
    expect(sent).toHaveLength(0);
    expect(released(db)[0]).toMatchObject({ p_reason: "kind_unknown" });
  });
});

describe("the digest and the pace", () => {
  it("sends one digest for a burst and folds the rest into it after the stamp", async () => {
    const db = fakeDb([claim("money_request", { pendingSameKind: 4 })]);
    const { transport, sent } = fakeTransport();
    const summary = await run(db, transport);

    expect(sent).toHaveLength(1);
    expect(sent[0].templateCode).toBe("vx_staff_digest_v1");
    expect(sent[0].params[1]).toBe("5");
    expect(summary.digested).toBe(3);
    const order = db.calls.map((call) => call.fn);
    expect(order.indexOf("stamp_staff_notice")).toBeLessThan(order.indexOf("digest_staff_notices"));
    expect(order.indexOf("digest_staff_notices")).toBeLessThan(order.indexOf("finish_staff_notice"));
  });

  it("waits so AiSensy is asked at most once a second", async () => {
    const db = fakeDb([claim("cover_assigned"), claim("cover_changed"), claim("cover_cancelled")]);
    const { transport } = fakeTransport("aisensy");
    const sleep = vi.fn(async () => undefined);
    await run(db, transport, { sleep });
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of sleep.mock.calls as unknown as Array<[number]>) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(1000);
    }
  });

  it("does not pace the mock", async () => {
    const db = fakeDb([claim("cover_assigned"), claim("cover_changed")]);
    const { transport } = fakeTransport("mock");
    const sleep = vi.fn(async () => undefined);
    await run(db, transport, { sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("never a real send from a test run", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("the AiSensy transport is never chosen under a test runner, even when declared", () => {
    vi.stubEnv("STAFF_NOTICE_TRANSPORT", "aisensy");
    vi.stubEnv("AISENSY_API_KEY", "test-key-not-real");
    expect(staffTransportName()).toBe("disabled");
  });

  it("names AiSensy's endpoint with a vppsone source", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/staff-notices/data/dispatcher.ts"), "utf8");
    expect(source).toContain('source: "vppsone/staff-notice"');
    expect(source).toContain("evaluateStaffSend(");
  });
});
