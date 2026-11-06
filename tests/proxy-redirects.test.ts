import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The proxy's redirect rules, against a stubbed Supabase client.
 *
 * These exist because of a real loop. `updateSession()` knows only whether the
 * request carries a valid JWT; whether somebody is *staff* is a
 * `vppsone.staff_profiles` row that the page reads. When those two disagree —
 * a live session whose profile was deactivated — a proxy-level "signed in, so
 * leave the login page" rule bounces forever against the page's "no usable
 * profile, so go to the login page", and every hop runs the page.
 *
 * Deactivating a signed-in staff member is task 1.3. This pins the fix.
 */

let signedIn = true;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: signedIn ? { claims: { sub: "00000000-0000-0000-0000-000000000001" } } : null,
        error: null,
      }),
    },
  }),
}));

// updateSession() reads these through @/platform/env at call time. A local
// URL, because the target guard refuses an unknown project before the stubbed
// client is even made (P0).
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

const { updateSession } = await import("@/platform/supabase/middleware");

function request(path: string) {
  return new NextRequest(new URL(path, "https://vppsone.test"));
}

function locationOf(response: Response) {
  const location = response.headers.get("location");
  return location ? location.replace("https://vppsone.test", "") : null;
}

describe("signed out", () => {
  beforeEach(() => {
    signedIn = false;
  });

  it.each(["/dashboard", "/", "/teach/attendance", "/anything/at/all"])(
    "sends %s to the login page",
    async (path) => {
      const response = await updateSession(request(path));
      expect(response.status).toBe(307);
      expect(locationOf(response)).toBe(
        `/login?next=${encodeURIComponent(path)}`,
      );
    },
  );

  it("keeps the query string in `next`", async () => {
    const response = await updateSession(request("/teach?class=5A&day=mon"));
    expect(locationOf(response)).toBe(
      `/login?next=${encodeURIComponent("/teach?class=5A&day=mon")}`,
    );
  });

  it("lets the login page through", async () => {
    const response = await updateSession(request("/login"));
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBeNull();
  });

  it("does not stack a `next` onto the login page itself", async () => {
    // Otherwise the redirect target is a login page pointing at a login page.
    const response = await updateSession(request("/login?next=%2Fdashboard"));
    expect(response.status).toBe(200);
  });
});

describe("signed in", () => {
  beforeEach(() => {
    signedIn = true;
  });

  it.each(["/dashboard", "/", "/teach/attendance"])(
    "lets %s through",
    async (path) => {
      const response = await updateSession(request(path));
      expect(response.status).toBe(200);
      expect(locationOf(response)).toBeNull();
    },
  );

  it("does NOT bounce away from the login page", async () => {
    // The regression. A valid JWT is not the same thing as being staff here,
    // and the proxy cannot tell the difference — so it must not try. The login
    // page redirects a signed-in *staff member* itself, from the profile.
    const response = await updateSession(request("/login"));
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBeNull();
  });

  it("does not loop when the page sends an inactive session to /login", async () => {
    // The exact sequence that hung the browser: requireStaff() finds no usable
    // profile and redirects here. If the proxy answered with a redirect of its
    // own, the two would trade 307s until the browser gave up.
    const response = await updateSession(
      request("/login?next=%2Fdashboard&reason=inactive"),
    );
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBeNull();
  });
});
