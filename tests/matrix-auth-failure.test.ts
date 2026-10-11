import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), role: "office", active: true }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/platform/env", () => ({ hasRequiredEnvVars: true }));
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => ({
  auth: { getClaims: async () => ({ data: { claims: { sub: "qa-user", email: "office@qa.vpps.local" } }, error: null }) },
  rpc: state.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
    id: "qa-office", display_name: "QA Office", short_name: "QA", role: state.role, is_teaching: false,
    is_active: state.active, preferred_language: "en", preferred_start: null,
  }, error: null }) }) }) }),
}) }));
import { assertPermission } from "@/platform/auth/current-staff";
beforeEach(() => { vi.resetAllMocks(); state.role = "office"; state.active = true; });
it.each(["database error", "transport failure", "malformed response"])("does not restore revoked attendance:correct on a %s", async (failure) => {
  if (failure === "transport failure") state.rpc.mockRejectedValue(new Error("QA offline"));
  else state.rpc.mockResolvedValue(failure === "database error" ? { data: null, error: { message: "QA unavailable" } } : { data: {}, error: null });
  await expect(assertPermission("attendance:correct")).rejects.toThrow();
});
it("honors a successful empty permission result", async () => {
  state.rpc.mockResolvedValue({ data: [], error: null });
  await expect(assertPermission("attendance:correct")).rejects.toThrow("Permission denied");
});
it("allows an explicitly granted permission", async () => {
  state.rpc.mockResolvedValue({ data: ["attendance:correct"], error: null });
  expect((await assertPermission("attendance:correct")).id).toBe("qa-office");
});
it.each(["admin", "office", "accountant", "fee_collector", "academic_coordinator", "exam_coordinator", "teacher", "view_only"])("%s never regains a grant after a malformed or unavailable matrix", async (role) => {
  state.role = role;
  for (const data of [null, {}, ["fees:collect", 7], [null], "fees:collect"]) {
    state.rpc.mockResolvedValue({ data, error: null });
    await expect(assertPermission("fees:collect")).rejects.toThrow("Could not verify staff permissions");
  }
});
it.each(["fees:collect", "fees:manage", "collection:manage", "attendance:correct", "messages:send"] as const)("admin retains the documented all-permissions policy for %s after a successful matrix read", async (permission) => {
  state.role = "admin"; state.rpc.mockResolvedValue({ data: [], error: null });
  expect((await assertPermission(permission)).role).toBe("admin");
});
it("a revoked grant takes effect on the next request", async () => {
  state.rpc.mockResolvedValueOnce({ data: ["fees:collect"], error: null }).mockResolvedValueOnce({ data: [], error: null });
  expect((await assertPermission("fees:collect")).id).toBe("qa-office");
  await expect(assertPermission("fees:collect")).rejects.toThrow("Permission denied");
});
it("an inactive staff member cannot use a successful explicit grant", async () => {
  state.active = false; state.rpc.mockResolvedValue({ data: ["fees:collect"], error: null });
  await expect(assertPermission("fees:collect")).rejects.toThrow("Not signed in");
});
