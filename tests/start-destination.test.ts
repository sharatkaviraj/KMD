import { describe, expect, it } from "vitest";

import { staffRoles, type StaffRole } from "@/platform/auth/permissions";
import { allowedFor, homeFor } from "@/platform/config/navigation";
import { appsFor } from "@/platform/config/apps";
import {
  appStartValue,
  landingFor,
  resolveStart,
  startHref,
  startOptionsFor,
} from "@/platform/config/start";

/**
 * Where an account starts, and the two ways that could go wrong.
 *
 * The product requirement — accounts staff open School Fees by default — is a
 * short step from the mistake the design package warns about twice: inventing
 * an `accountant` role, or deriving one from an email address. So the tests
 * here are mostly about what the mechanism **refuses**:
 *
 *  - a preference cannot name a screen the role may not open;
 *  - a preference cannot name an app the registry does not offer that role;
 *  - a preference the role has since lost is ignored, not honoured;
 *  - a valid deep link beats the preference, including for accounts staff.
 */

const SCHOOLFEES = appStartValue("schoolfees");

describe("what each role may choose as a start screen", () => {
  it.each(staffRoles)("%s is only offered screens it can already open", (role) => {
    const allowed = new Set(allowedFor(role).map((item) => item.href));
    const apps = new Set(appsFor(role).map((app) => appStartValue(app.id)));

    for (const option of startOptionsFor(role)) {
      if (option.kind === "route") {
        expect(allowed.has(option.value), `${role} offered ${option.value}`).toBe(true);
      } else {
        expect(apps.has(option.value), `${role} offered ${option.value}`).toBe(true);
      }
    }
  });

  it("offers School Fees to the roles the registry already offers it to", () => {
    for (const role of ["admin", "office"] as const) {
      expect(startOptionsFor(role).map((option) => option.value)).toContain(SCHOOLFEES);
    }
  });

  it("offers no sibling app to a role without apps:view", () => {
    // A teacher has no errand in either app, so she cannot land in one —
    // which is the same rule the Apps hub applies, not a second one.
    for (const role of [
      "teacher",
      "academic_coordinator",
      "exam_coordinator",
      "view_only",
    ] as const) {
      expect(startOptionsFor(role).every((option) => option.kind === "route")).toBe(true);
    }
  });

  it("never offers an option twice", () => {
    for (const role of staffRoles) {
      const values = startOptionsFor(role).map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("resolving a stored preference", () => {
  it("is the role's Home when nothing is stored", () => {
    for (const role of staffRoles) {
      expect(resolveStart(role, null)).toBeNull();
      expect(resolveStart(role, "")).toBeNull();
      expect(resolveStart(role, "   ")).toBeNull();
      expect(startHref(role, null)).toBe(homeFor(role));
    }
  });

  it("sends accounts staff to the fee app's own home", () => {
    const resolved = resolveStart("office", SCHOOLFEES);

    expect(resolved?.kind).toBe("app");
    // The registry builds it from a verified origin; this asserts the shape
    // rather than the hostname, which `app-origins.test.ts` owns.
    expect(startHref("office", SCHOOLFEES)).toMatch(/^https:\/\/[^/]+\/protected\/dashboard$/);
  });

  it("ignores a preference the role may not use", () => {
    // The same stored string, two roles. A teacher moved into the office is
    // not the same person as an office account moved out of it, and honouring
    // a value the role has lost is how somebody ends up on /access-denied
    // every morning.
    expect(resolveStart("teacher", SCHOOLFEES)).toBeNull();
    expect(startHref("teacher", SCHOOLFEES)).toBe("/teach");

    expect(resolveStart("view_only", "/collection")).toBeNull();
    expect(startHref("view_only", "/collection")).toBe("/dashboard");
  });

  it("tolerates surrounding whitespace on a stored value", () => {
    // The column's check constraint cannot store one, so this is only
    // defensiveness — but a value that survives a round trip through a form
    // should not silently become "your Home" because of a space.
    expect(resolveStart("office", ` ${SCHOOLFEES} `)?.kind).toBe("app");
  });

  it.each([
    "app:",
    "app:nothing",
    "app:vppsone",
    "https://evil.example",
    "//evil.example",
    "/../etc",
    "/students/../jobs",
    "dashboard",
  ])("refuses %s", (stored) => {
    expect(resolveStart("admin", stored)).toBeNull();
    expect(startHref("admin", stored)).toBe("/dashboard");
  });
});

describe("where a sign-in actually lands", () => {
  const accounts: { role: StaffRole; preferredStart: string | null } = {
    role: "office",
    preferredStart: SCHOOLFEES,
  };

  it("prefers a valid deep link over the start screen", () => {
    // The half worth guarding. Somebody who followed a link to a register and
    // had to sign in on the way is asking for that register — bouncing them to
    // the fee desk instead would lose what they clicked.
    expect(landingFor({ ...accounts, requested: "/teach/register" })).toBe(
      "/teach/register",
    );
    expect(
      landingFor({ ...accounts, requested: "/teach/attendance?class=5A&day=2026-09-17" }),
    ).toBe("/teach/attendance?class=5A&day=2026-09-17");
  });

  it("falls back to the start screen when there is no deep link", () => {
    expect(landingFor({ ...accounts, requested: null })).toContain("/protected/dashboard");
    expect(landingFor({ ...accounts, requested: "" })).toContain("/protected/dashboard");
  });

  it.each([
    ["a protocol-relative URL", "//evil.example/steal"],
    ["a backslash protocol-relative URL", "/\\evil.example/steal"],
    ["an absolute URL", "https://evil.example"],
    ["a scheme-only value", "javascript:alert(1)"],
    ["a relative path", "dashboard"],
    ["a header split", "/dashboard\nLocation: https://evil.example"],
  ])("refuses %s as a deep link", (_label, requested) => {
    expect(landingFor({ ...accounts, requested })).toContain("/protected/dashboard");

    // And the same refusal for an account with no preference, so the fallback
    // being external is not what is doing the work here.
    expect(landingFor({ role: "teacher", preferredStart: null, requested })).toBe("/teach");
  });

  it("leaves a teacher on her own day", () => {
    expect(landingFor({ role: "teacher", preferredStart: null, requested: null })).toBe(
      "/teach",
    );
  });
});
