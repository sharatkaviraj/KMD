import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentStaff } from "@/platform/auth/current-staff";

/**
 * PR #144 review: the collection actions write by a bare `id` — a request, a
 * queued message — through the service-role client, which the database's
 * `test_session_fence` never sees. A test account with collection:manage
 * could close a real request, rotate its parents' link, or send a real queued
 * message; and the school-wide writes (fields, parent policy) had no fence at
 * all. Each now checks the record's own session, or refuses a test account.
 * Synthetic ids, mocked clients.
 */

const REAL = "11111111-1111-4111-8111-111111111111";
const TEST = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  staff: null as CurrentStaff | null,
  sessions: new Map<string, string>(),
  calls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/platform/auth/current-staff", () => ({
  getCurrentStaff: async () => state.staff,
  assertPermission: async () => state.staff,
}));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => undefined }));
vi.mock("@/modules/academics/data/academics-repo", () => ({
  resolveSessionLabel: async () => "TEST-2026-27",
  classLabelMap: async () => new Map(),
}));
// vppsone rows by id -> their own session_label, as the fence reads them.
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let id = "";
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          id = value;
          return query;
        },
        maybeSingle: async () => ({
          data: state.sessions.has(id) ? { session_label: state.sessions.get(id) } : null,
          error: null,
        }),
      };
      return query;
    },
  }),
}));
const record = (name: string) => async () => {
  state.calls.push(name);
};
vi.mock("@/modules/collection/data/requests-repo", () => ({
  createRequest: record("createRequest"),
  rotateToken: record("rotateToken"),
  setRequestStatus: record("setRequestStatus"),
}));
vi.mock("@/modules/collection/data/fields-repo", () => ({
  setFieldActive: record("setFieldActive"),
  upsertField: record("upsertField"),
}));
vi.mock("@/modules/collection/data/messages-repo", () => ({
  cancelSend: record("cancelSend"),
  confirmDispatchReceived: record("confirmDispatchReceived"),
  dispatch: async () => {
    state.calls.push("dispatch");
    return { ok: true };
  },
  getSend: async (id: string) => ({ id, audience: "staff", status: "queued" }),
  listTemplates: async () => [],
  markSentByHand: record("markSentByHand"),
  queueSend: record("queueSend"),
  setTemplateActive: record("setTemplateActive"),
  upsertTemplate: record("upsertTemplate"),
}));
vi.mock("@/modules/collection/data/parent-messages-repo", () => ({
  clearRouteFlag: record("clearRouteFlag"),
  flagRoute: async () => ({ withdrawn: 0 }),
  markApproved: record("markApproved"),
  markStale: record("markStale"),
  routeFlagged: async () => false,
  savePolicy: async () => {
    state.calls.push("savePolicy");
    return "saved";
  },
  staleness: async () => ({ reasons: [] }),
}));

function as(role: CurrentStaff["role"], isTestAccount: boolean) {
  state.staff = {
    id: "44444444-4444-4444-8444-444444444444",
    userId: "u",
    email: null,
    displayName: "QA",
    shortName: "QA",
    role,
    isTeaching: false,
    isActive: true,
    language: "en",
    preferredStart: null,
    permissions: ["collection:manage", "jobs:run"],
    isTestAccount,
  };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  state.calls = [];
  state.sessions = new Map([
    [REAL, "2026-27"],
    [TEST, "TEST-2026-27"],
  ]);
});

const actions = await import("@/app/(app)/collection/actions");
const idle = { status: "idle" } as never;

describe("a test account naming a real collection record", () => {
  beforeEach(() => as("admin", true));

  it("cannot close a real request, nor rotate its parents' link", async () => {
    await actions.setRequestStatusAction(form({ id: REAL, status: "closed" }));
    await actions.rotateTokenAction(form({ id: REAL }));
    expect(state.calls).toEqual([]);

    await actions.setRequestStatusAction(form({ id: TEST, status: "closed" }));
    await actions.rotateTokenAction(form({ id: TEST }));
    expect(state.calls).toEqual(["setRequestStatus", "rotateToken"]);
  });

  it("cannot send, mark or cancel a real queued message", async () => {
    const refused = await actions.sendMessageAction(idle, form({ id: REAL }));
    await actions.markSentAction(form({ id: REAL }));
    await actions.cancelSendAction(form({ id: REAL }));
    expect(refused.status).toBe("error");
    expect(state.calls).toEqual([]);

    await actions.sendMessageAction(idle, form({ id: TEST }));
    expect(state.calls).toEqual(["dispatch"]);
  });

  it("cannot make a school-wide change", async () => {
    await actions.retireFieldAction(form({ id: REAL, active: "false" }));
    await actions.clearRouteFlagAction(form({ id: REAL, note: "fixed" }));
    const policy = await actions.saveParentPolicyAction(idle, form({ category: "general", approvalRequired: "on" }));
    expect(policy.status).toBe("error");
    expect(state.calls).toEqual([]);
  });
});

describe("a real administrator", () => {
  it("still works on real records", async () => {
    as("admin", false);
    await actions.setRequestStatusAction(form({ id: REAL, status: "closed" }));
    await actions.sendMessageAction(idle, form({ id: REAL }));
    await actions.retireFieldAction(form({ id: REAL, active: "false" }));
    expect(state.calls).toEqual(["setRequestStatus", "dispatch", "setFieldActive"]);
  });
});
