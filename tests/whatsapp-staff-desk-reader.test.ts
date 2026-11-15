import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D-639: Veer Patta AI's staff desks read as the person they answer as.
 *
 * A WhatsApp message arrives on the hub's webhook, with no cookie. Under the
 * fees bridge every `public` read (the session list, class names, children's
 * names) is a roster read, and the projection refuses one that names no
 * reader. From the day the bridge came on, every desk answer was "⚠️ Sorry,
 * that could not be read just now" (`parent_helper_turns.reason`
 * `session_unreadable`), because the session list was read with nobody behind
 * it.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), staff: vi.fn(), session: vi.fn(), state: vi.fn() }));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn(), whatsappDb: vi.fn() }));
vi.mock("@/modules/mcp/data/staff", () => ({ resolveStaffForUser: mocks.resolve }));
// Not `importActual`: loading the real module here can bind the projection to
// it before the mock exists, and then the webhook's "nobody signed in" is a
// cookies() call outside a request instead of null.
vi.mock("@/platform/auth/current-staff", () => ({
  getCurrentStaff: mocks.staff,
  testAccountFlags: (flag: boolean) => ({ isTestAccount: flag, confined: false }),
}));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: mocks.session }));
vi.mock("@/platform/fees-bridge/state", () => ({ readFeesBridgeState: mocks.state }));
vi.mock("@/platform/env", async (importActual) => ({
  ...(await importActual<typeof import("@/platform/env")>()),
  getServerSupabaseUrl: () => "https://one.supabase.co",
}));

import { readAsStaff } from "@/modules/whatsapp/data/staff-desk";
import type { LinkedStaff } from "@/modules/whatsapp/domain/staff-desk";
import { mintVerifiedActor } from "@/platform/auth/verified-actor";
import { verifiedActorInContext } from "@/platform/auth/verified-actor-context";
import { createProjectionFetch } from "@/platform/fees-bridge/projection-fetch";

const SEAT: LinkedStaff = {
  staffId: "staff-test-admin",
  userId: "user-test-admin",
  name: "Test Admin",
  role: "admin",
  isTest: true,
  language: "en",
  permissions: [],
  isTeaching: false,
};

function actorFor(staff: LinkedStaff, overrides: { id?: string; isActive?: boolean } = {}) {
  return mintVerifiedActor({
    id: overrides.id ?? staff.staffId,
    userId: staff.userId ?? "none",
    email: null,
    displayName: staff.name,
    shortName: staff.name,
    role: staff.role,
    isTeaching: staff.isTeaching,
    isActive: overrides.isActive ?? true,
    language: "en",
    preferredStart: null,
    permissions: [],
    isTestAccount: staff.isTest,
    confined: false,
  });
}

const SESSIONS_READ = "https://one.supabase.co/rest/v1/classes?select=session_label";

describe("Veer Patta AI's staff desk reads as the person (D-639)", () => {
  beforeEach(() => {
    vi.stubEnv("FEES_BRIDGE_ENABLED", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    // The webhook: nobody signed in, no session pill.
    mocks.staff.mockResolvedValue(null);
    mocks.session.mockResolvedValue(null);
    mocks.state.mockResolvedValue({ active_session_label: "2026-27" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("a session-list read with nobody behind it is refused, which is what every desk answer hit", async () => {
    const underlying = vi.fn().mockResolvedValue(Response.json([]));
    const response = await createProjectionFetch(underlying, { privileged: true })(SESSIONS_READ, { headers: { "Accept-Profile": "public" } });
    expect(response.status).toBe(409);
    expect(underlying).not.toHaveBeenCalled();
  });

  it("the same read as the owner's practice seat goes to One's own TEST records", async () => {
    const staff = { ...SEAT };
    const actor = actorFor(staff);
    mocks.resolve.mockResolvedValue(actor);
    const underlying = vi.fn().mockResolvedValue(Response.json([{ session_label: "TEST-2026-27" }]));
    const response = await readAsStaff(staff, async () => {
      expect(verifiedActorInContext()).toBe(actor);
      return createProjectionFetch(underlying, { privileged: true })(SESSIONS_READ, { headers: { "Accept-Profile": "public" } });
    });
    expect(response.status).toBe(200);
    expect(underlying).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledWith("user-test-admin");
    // Nothing from a cookie counts.
    expect(mocks.staff).not.toHaveBeenCalled();
    expect(verifiedActorInContext()).toBeNull();
  });

  it("resolves the person once for the several reads of one answer", async () => {
    const staff = { ...SEAT };
    mocks.resolve.mockResolvedValue(actorFor(staff));
    await readAsStaff(staff, async () => 1);
    await readAsStaff(staff, async () => 2);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });

  it("refuses a person who cannot be read as themselves, and reads nothing", async () => {
    const read = vi.fn(async () => "read");
    const noSignIn = { ...SEAT, userId: null };
    await expect(readAsStaff(noSignIn, read)).rejects.toThrow(/could not be read as themselves/);

    const otherProfile = { ...SEAT };
    mocks.resolve.mockResolvedValueOnce(actorFor(otherProfile, { id: "someone-else" }));
    await expect(readAsStaff(otherProfile, read)).rejects.toThrow(/could not be read as themselves/);

    const inactive = { ...SEAT };
    mocks.resolve.mockResolvedValueOnce(actorFor(inactive, { isActive: false }));
    await expect(readAsStaff(inactive, read)).rejects.toThrow(/could not be read as themselves/);

    const unreadable = { ...SEAT };
    mocks.resolve.mockRejectedValueOnce(new Error("Could not read the staff profile."));
    await expect(readAsStaff(unreadable, read)).rejects.toThrow(/could not be read as themselves/);

    expect(read).not.toHaveBeenCalled();
  });
});
