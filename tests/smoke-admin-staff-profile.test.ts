import { describe, expect, it, vi } from "vitest";

/* Smoke run, 20 Oct (dev group 17): /staff/roles threw React #441; a bad id reached the database. */

const calls = vi.hoisted(() => ({ getStaff: vi.fn(), permission: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
}));
vi.mock("@/platform/auth/current-staff", () => ({ requirePermission: async (key: string) => { calls.permission(key); return { id: "a", role: "admin", language: "en" }; } }));
vi.mock("@/modules/staff/data/staff-repo", () => ({ getStaffById: calls.getStaff }));
vi.mock("@/app/(app)/staff/actions", () => ({ setStaffActiveAction: vi.fn() }));

import StaffDetailPage from "@/app/(app)/staff/[id]/page";

const call = (id: string) => StaffDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as never);

describe("/staff/[id]", () => {
  it("sends /staff/roles to the roles view", async () => {
    await expect(call("roles")).rejects.toThrow("NEXT_REDIRECT /staff?view=roles");
  });

  it("an id that is not a profile id is not found, without a database read", async () => {
    await expect(call("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(calls.permission).toHaveBeenCalledWith("staff:view");
    expect(calls.getStaff).not.toHaveBeenCalled();
  });

  it("a well-formed id nobody has is not found", async () => {
    calls.getStaff.mockResolvedValue(null);
    await expect(call("11111111-1111-4111-8111-111111111111")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
