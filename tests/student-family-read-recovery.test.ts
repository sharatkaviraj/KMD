import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ results: [] as { data: unknown; error: null | { message: string } }[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = { select: () => query, eq: async () => state.results.shift() }; return query;
} }) }));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/modules/fees/platform/supabase/cache-safe", () => ({ getCacheSafeClient: vi.fn(), cacheSafeUnstableCache: (fn: unknown) => fn }));
import { getStudentFamilyMembersDetail } from "@/modules/students-fees/data/queries";
beforeEach(() => { state.results = []; });
describe("family membership read failures", () => {
  it("returns an empty family only for a successful absent membership", async () => {
    state.results = [{ data: [], error: null }];
    await expect(getStudentFamilyMembersDetail("qa-child")).resolves.toEqual({ familyGroupId: null, members: [] });
  });
  it("refuses an unavailable membership instead of declaring no siblings", async () => {
    state.results = [{ data: null, error: { message: "QA membership unavailable" } }];
    await expect(getStudentFamilyMembersDetail("qa-child")).rejects.toThrow("QA membership unavailable");
  });
  it("refuses a failed linked-members read instead of returning only the child", async () => {
    state.results = [{ data: [{ family_group_id: "qa-family" }], error: null }, { data: null, error: { message: "QA linked members unavailable" } }];
    await expect(getStudentFamilyMembersDetail("qa-child")).rejects.toThrow("QA linked members unavailable");
  });
});
