import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ permission: vi.fn(), admin: vi.fn(), row: vi.fn(), sign: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: state.admin }));
import { studentProfilePhoto } from "@/modules/collection/data/photos-repo";
beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: state.row };
  state.from.mockReturnValue(query); state.admin.mockReturnValue({ from: state.from, storage: { from: () => ({ createSignedUrl: state.sign }) } });
  state.permission.mockResolvedValue(undefined); state.row.mockResolvedValue({ data: { storage_path: "synthetic/current.png" }, error: null });
  state.sign.mockResolvedValue({ data: { signedUrl: "https://synthetic.invalid/signed" }, error: null });
});
describe("private student profile photo", () => {
  it("checks the existing permission before any service-role access", async () => {
    state.permission.mockRejectedValue(new Error("Denied"));
    await expect(studentProfilePhoto("synthetic")).rejects.toThrow("Denied");
    expect(state.permission).toHaveBeenCalledWith("collection:manage"); expect(state.admin).not.toHaveBeenCalled();
  });
  it("signs only the current private store for five minutes", async () => {
    expect(await studentProfilePhoto("synthetic")).toBe("https://synthetic.invalid/signed");
    expect(state.from).toHaveBeenCalledWith("student_photos"); expect(state.sign).toHaveBeenCalledWith("synthetic/current.png", 300);
    const query = state.from.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith("student_id", "synthetic"); expect(query.is).toHaveBeenCalledWith("replaced_at", null);
  });
  it("does not sign or consult a second source when no private photograph exists", async () => {
    state.row.mockResolvedValue({ data: null, error: null }); expect(await studentProfilePhoto("synthetic")).toBeNull();
    expect(state.sign).not.toHaveBeenCalled(); expect(state.from).toHaveBeenCalledOnce();
  });
  it("propagates lookup and signing failures so the page can show initials", async () => {
    state.row.mockResolvedValue({ data: null, error: new Error("Failed") }); await expect(studentProfilePhoto("synthetic")).rejects.toThrow("Could not read");
    state.row.mockResolvedValue({ data: { storage_path: "synthetic/current.png" }, error: null }); state.sign.mockResolvedValue({ data: null, error: new Error("Failed") });
    await expect(studentProfilePhoto("synthetic")).rejects.toThrow("Could not open");
  });
});
