import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3 (D-340; PR #143 review): staff management and the test-account
 * flag. A test account manages only test accounts — its new colleagues are
 * test accounts, and it cannot change a real profile's record, role or
 * access. `setTestAccountAction` is a real admin's, never on themselves,
 * never while previewing, always with a reason. Synthetic ids, mocked repo
 * and rpc; nothing reaches a database.
 */

const state = vi.hoisted(() => ({
  actor: null as null | { id: string; userId: string; role: string; isTestAccount?: boolean; language: string },
  previewing: false,
  testProfiles: new Set<string>(),
  created: vi.fn(),
  updated: vi.fn(),
  authority: vi.fn(),
  rpc: vi.fn(),
  rpcResult: { data: { ok: true }, error: null } as { data: unknown; error: unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/platform/auth/current-staff", () => ({
  assertPermission: async () => {
    if (!state.actor) throw new Error("Not signed in.");
    return state.actor;
  },
}));
vi.mock("@/vx/view-as", () => ({
  assertNotPreviewing: async () => {
    if (state.previewing) throw new Error("Previewing: nothing is saved.");
  },
}));
vi.mock("@/platform/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      state.rpc(name, args);
      return state.rpcResult;
    },
  }),
}));
vi.mock("@/modules/staff/data/staff-repo", () => ({
  actorMayManage: async (actor: { isTestAccount?: boolean }, targetId: string) =>
    actor.isTestAccount !== true || state.testProfiles.has(targetId),
  changeStaffAuthority: async (input: unknown) => {
    state.authority(input);
    return { ok: true, changed: true };
  },
  createStaff: async (input: unknown, by: string, options: unknown) => {
    state.created(input, by, options);
    return { id: "new" };
  },
  findByShortName: async () => null,
  getStaffById: async (id: string) => ({
    id,
    userId: null,
    displayName: "Someone",
    shortName: "SOME",
    role: "teacher",
    isActive: true,
    isTeaching: true,
  }),
  updateStaff: async (id: string, input: unknown) => state.updated(id, input),
}));

import { createStaffAction, setStaffActiveAction, setTestAccountAction, updateStaffAction } from "@/app/(app)/staff/actions";

const REAL = "11111111-1111-4111-8111-111111111111";
const TEST = "22222222-2222-4222-8222-222222222222";
const SELF = "33333333-3333-4333-8333-333333333333";

function as(role: string, isTestAccount: boolean) {
  state.actor = { id: SELF, userId: "u", role, isTestAccount, language: "en" };
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const PROFILE = { displayName: "Probe Person", role: "teacher", phone: "", whatsappPhone: "", preferredLanguage: "en" };
const IDLE = { status: "idle" as const, fieldErrors: {}, message: null };

beforeEach(() => {
  vi.clearAllMocks();
  state.previewing = false;
  state.testProfiles = new Set([TEST]);
  state.rpcResult = { data: { ok: true }, error: null };
});

describe("a test account manages only test accounts", () => {
  it("a profile a test admin creates is a test account; a real admin's is not", async () => {
    as("admin", true);
    await expect(createStaffAction(IDLE, form({ ...PROFILE, shortName: "PRB" }))).rejects.toThrow("NEXT_REDIRECT /staff");
    expect(state.created).toHaveBeenLastCalledWith(expect.anything(), "u", { isTestAccount: true });

    as("admin", false);
    await expect(createStaffAction(IDLE, form({ ...PROFILE, shortName: "PRC" }))).rejects.toThrow("NEXT_REDIRECT /staff");
    expect(state.created).toHaveBeenLastCalledWith(expect.anything(), "u", { isTestAccount: false });
  });

  it("a test admin cannot edit a real profile, and can edit a test one", async () => {
    as("admin", true);
    const refused = await updateStaffAction(IDLE, form({ ...PROFILE, id: REAL }));
    expect(refused.status).toBe("error");
    expect(refused.message?.en).toMatch(/test account can change only test accounts/i);
    expect(state.updated).not.toHaveBeenCalled();

    await expect(updateStaffAction(IDLE, form({ ...PROFILE, id: TEST }))).rejects.toThrow(`NEXT_REDIRECT /staff/${TEST}`);
    expect(state.updated).toHaveBeenCalledWith(TEST, expect.anything());
  });

  it("a test admin cannot switch a real profile's access off", async () => {
    as("admin", true);
    await expect(setStaffActiveAction(form({ id: REAL, isActive: "false" }))).rejects.toThrow(/test account/i);
    expect(state.authority).not.toHaveBeenCalled();
  });
});

describe("setTestAccountAction", () => {
  it("refuses a test admin", async () => {
    as("admin", true);
    await expect(setTestAccountAction(form({ id: REAL, isTestAccount: "true", reason: "qa" }))).rejects.toThrow();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses while previewing another role", async () => {
    as("admin", false);
    state.previewing = true;
    await expect(setTestAccountAction(form({ id: REAL, isTestAccount: "true", reason: "qa" }))).rejects.toThrow(/Previewing/);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses without a reason, and on oneself", async () => {
    as("admin", false);
    await expect(setTestAccountAction(form({ id: REAL, isTestAccount: "true", reason: "  " }))).rejects.toThrow();
    await expect(setTestAccountAction(form({ id: SELF, isTestAccount: "true", reason: "qa" }))).rejects.toThrow();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("calls set_test_account with the reason, and maps the database's refusal", async () => {
    as("admin", false);
    await expect(setTestAccountAction(form({ id: REAL, isTestAccount: "true", reason: "QA login" }))).resolves.toBeUndefined();
    expect(state.rpc).toHaveBeenCalledWith("set_test_account", { p_profile_id: REAL, p_value: true, p_reason: "QA login" });

    state.rpcResult = { data: { ok: false, reason: "not_real_admin" }, error: null };
    await expect(setTestAccountAction(form({ id: REAL, isTestAccount: "false", reason: "QA login" }))).rejects.toThrow();
  });
});
