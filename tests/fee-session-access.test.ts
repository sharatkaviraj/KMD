import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { staffRoles } from "@/platform/auth/permissions";

const state = vi.hoisted(() => ({ staff: null as CurrentStaff | null, nativeGuard: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw Error(`redirect:${href}`); } }));
vi.mock("@/platform/auth/current-staff", () => ({
  getCurrentStaff: async () => state.staff,
  requireStaff: async () => state.staff,
  requirePermission: state.nativeGuard,
}));
import { getAuthenticatedStaff, requireAuthenticatedStaff, requireAnyStaffPermission, requireStaffPermission } from "@/modules/fees/platform/session";

const feeReaders = new Set(["admin", "office", "accountant", "fee_collector"]);
beforeEach(() => {
  vi.clearAllMocks();
  state.staff = null;
  state.nativeGuard.mockImplementation(async () => {
    if (!state.staff || !feeReaders.has(state.staff.role)) throw Error("native-fees-denied");
    return state.staff;
  });
});
function asRole(role: CurrentStaff["role"]) {
  state.staff = { id: "qa-profile", userId: "qa-user", email: "staff@qa.vpps.local", displayName: "QA", shortName: "QA", role, isTeaching: false, isActive: true, language: "en", preferredStart: null };
}

describe("native access precedes the ported fee role", () => {
  it.each(staffRoles)("returns a fee session only for an authorized %s", async role => {
    asRole(role);
    const session = await getAuthenticatedStaff();
    expect(Boolean(session)).toBe(feeReaders.has(role));
  });
  it.each(staffRoles)("checks native fee access before requiring a %s session", async role => {
    asRole(role);
    if (feeReaders.has(role)) expect((await requireAuthenticatedStaff("/fees/defaulters")).id).toBe("qa-user");
    else await expect(requireAuthenticatedStaff("/fees/defaulters")).rejects.toThrow("native-fees-denied");
    expect(state.nativeGuard).toHaveBeenCalledWith("fees:view", "/fees/defaulters");
  });
  it.each(["teacher", "academic_coordinator", "exam_coordinator", "view_only"] as const)(
    "%s cannot start fee reads through either ported permission guard", async role => {
      asRole(role);
      const read = vi.fn();
      const startRead = async (any: boolean) => {
        if (any) await requireAnyStaffPermission(["defaulters:view", "fees:view"], { onDenied: "redirect" });
        else await requireStaffPermission("defaulters:view", { onDenied: "redirect" });
        read();
      };
      await expect(startRead(false)).rejects.toThrow("native-fees-denied");
      await expect(startRead(true)).rejects.toThrow("native-fees-denied");
      expect(read).not.toHaveBeenCalled();
    },
  );
  it("keeps office payment entry refused after native fee access succeeds", async () => {
    asRole("office");
    await expect(requireStaffPermission("payments:write", { onDenied: "redirect" })).rejects.toThrow("redirect:/access-denied?permission=payments%3Awrite");
  });
  it("returns no fee session for a signed-out request", async () => {
    expect(await getAuthenticatedStaff()).toBeNull();
    await expect(requireAuthenticatedStaff()).rejects.toThrow("native-fees-denied");
  });
});
