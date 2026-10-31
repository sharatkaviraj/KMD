import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Two things tests/e2e/test-session.spec.ts found in a browser (Phase C):
 *  - the pill printed a `?session=` the server had refused — a test account
 *    asking for 2026-27 saw "2026-27" in the pill over TEST-2026-27 data;
 *  - the confined banner was hidden from accounts that are test accounts by
 *    profile, though the build is confined for them too.
 */

const { sessionThisViewerMayOpen } = await import("@/ui/shell/session-pill");
const { testAccountFlags } = await import("@/platform/auth/current-staff");

describe("the pill and a ?session= in the URL", () => {
  const testOnly = [{ session_label: "TEST-2026-27" }];

  it("shows the URL's session only when the viewer's list has it", () => {
    expect(sessionThisViewerMayOpen("2026-27", testOnly)).toBeNull();
    expect(sessionThisViewerMayOpen("TEST-2026-27", testOnly)).toBe("TEST-2026-27");
  });

  it("before the list loads, trusts the server's label, not the URL", () => {
    expect(sessionThisViewerMayOpen("2026-27", [])).toBeNull();
    expect(sessionThisViewerMayOpen(null, testOnly)).toBeNull();
  });
});

describe("the confined banner", () => {
  it("is on for every account on a confined build, and off on Vercel production", () => {
    expect(testAccountFlags(true, {})).toEqual({ isTestAccount: true, confined: true });
    expect(testAccountFlags(false, { VERCEL_ENV: "preview" })).toEqual({ isTestAccount: true, confined: true });
    expect(testAccountFlags(true, { VERCEL_ENV: "production" })).toEqual({ isTestAccount: true, confined: false });
    expect(testAccountFlags(false, { VERCEL_ENV: "production" })).toEqual({ isTestAccount: false, confined: false });
  });
});
