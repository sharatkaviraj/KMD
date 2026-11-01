import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentStaff } from "@/platform/auth/current-staff";

const state = vi.hoisted(() => ({
  staff: { role: "accountant", isTestAccount: true, language: "en", shortName: "Synthetic" } as CurrentStaff,
  cookie: null as string | null,
  sessions: [{ id: "synthetic-test", session_label: "TEST-2026-27", status: "active", is_current: false }],
}));
vi.mock("@/platform/auth/current-staff", () => ({ requireStaff: async () => state.staff }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: async () => state.cookie }));
vi.mock("@/modules/fees/platform/session-context/switcher", () => ({
  getSessionSwitcherData: async () => ({ activeSessionLabel: "2026-27", availableSessions: state.sessions }),
}));
vi.mock("@/vx/view-as", () => ({ getViewer: async () => ({ previewing: null }) }));
vi.mock("@/vx/nav", () => ({ homeForRole: () => "/", MENU_HOME: {}, MENU_LABEL: {}, ROLE_PREVIEW_MENUS: [] }));
vi.mock("@/vx/screens/system/session-screen", () => ({ SessionScreen: () => null }));

import SessionPage from "@/app/(app)/preferences/session/page";

beforeEach(() => {
  state.staff.isTestAccount = true;
  state.cookie = null;
  state.sessions = [{ id: "synthetic-test", session_label: "TEST-2026-27", status: "active", is_current: false }];
});

describe("session preferences viewer default", () => {
  it.each([null, "2026-27", "2027-28"])("selects TEST for a test account with cookie %s", async (cookie) => {
    state.cookie = cookie;
    const page = await SessionPage();
    expect(page.props.viewing).toBe("TEST-2026-27");
    expect(page.props.sessions.some((s: { label: string }) => s.label === page.props.viewing)).toBe(true);
  });

  it("preserves an allowed explicit TEST selection", async () => {
    state.cookie = "TEST-2026-27";
    expect((await SessionPage()).props.viewing).toBe("TEST-2026-27");
  });

  it("keeps the active real session for real staff and preserves an allowed alternative", async () => {
    state.staff.isTestAccount = false;
    state.sessions = ["2026-27", "2027-28"].map((session_label) => ({ id: session_label, session_label, status: "active", is_current: session_label === "2026-27" }));
    state.cookie = "TEST-2026-27";
    expect((await SessionPage()).props.viewing).toBe("2026-27");
    state.cookie = "2027-28";
    expect((await SessionPage()).props.viewing).toBe("2027-28");
  });
});
