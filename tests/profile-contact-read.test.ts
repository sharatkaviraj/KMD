import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => {
  const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, returns: state.read };
  return { from: () => query };
} }));
import { familyContacts } from "@/vx/screens/family-contact/data";
beforeEach(() => state.read.mockReset());
it("distinguishes no contact history from an unavailable query", async () => {
  state.read.mockResolvedValue({ data: [], error: null }); expect(await familyContacts("synthetic", "QA")).toEqual([]);
  state.read.mockResolvedValue({ data: null, error: { message: "Synthetic failed read" } }); await expect(familyContacts("synthetic", "QA")).rejects.toThrow("Could not read");
});
