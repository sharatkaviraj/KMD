import { describe, expect, it } from "vitest";

import {
  can,
  canAny,
  isStaffRole,
  permissionsFor,
  resolveStaffRole,
  roleLabels,

  rolePermissions,
  staffPermissions,
  staffRoles,
  type StaffPermission,
  type StaffRole,
} from "@/platform/auth/permissions";

/**
 * The expected matrix, written out rather than derived from `rolePermissions`
 * — a test that computes its expectation from the code it is testing proves
 * only that the code equals itself.
 *
 * Every role appears, and every role's list is complete: the sets are asserted
 * below to be exactly the role's, so an accidental grant fails here as loudly
 * as an accidental revoke.
 */
const expectedPermissions: Record<StaffRole, readonly StaffPermission[]> = {
  // "everything" — also asserted separately against the full list, so adding a
  // permission to the platform cannot quietly leave admin without it.
  admin: staffPermissions,

  office: [
    "dashboard:view",
    "staff:view",
    "staff:manage",
    "academics:view",
    "academics:manage",
    "timetable:view",
    "substitutions:view",
    "attendance:view",
    "attendance:mark_on_behalf",
    "attendance:correct",
    "notes:view",
    "collection:view",
    "collection:manage",
    "documents:view",
    "documents:manage",
    "assessments:view",
    "marks:view",
    "reports:view",
    // The way to School Fees and SamPark. PLAN §3 puts Apps on the office's
    // navigation; it does not grant anything in either destination, which
    // decides for itself.
    "apps:view",
    // The searchable roster. PLAN section 3 puts Students on the admin and
    // office navigation and nowhere else.
    "students:view",
  ],

  academic_coordinator: [
    "dashboard:view",
    "staff:view",
    "academics:view",
    "academics:manage",
    "timetable:view",
    "timetable:manage",
    "substitutions:view",
    "substitutions:manage",
    "attendance:view",
    "notes:view",
    "assessments:view",
    "marks:view",
    "reports:view",
  ],

  exam_coordinator: [
    "dashboard:view",
    "staff:view",
    "academics:view",
    "timetable:view",
    "attendance:view",
    "assessments:view",
    "assessments:manage",
    "marks:view",
    "marks:write",
    "reports:view",
  ],

  teacher: [
    "dashboard:view",
    "timetable:view",
    "substitutions:view",
    "attendance:view",
    "attendance:mark",
    "notes:view",
    "notes:write",
    "assessments:view",
    "marks:view",
    "marks:write",
  ],

  // `attendance:view` was here until R1.2. PLAN section 3 gives this role
  // "read-only information; no editable forms or per-child actions", and that
  // permission guards six screens that are one or the other (B-22). The
  // attendance *figures* it is promised are a count on its own Home, read
  // under `dashboard:view`.
  view_only: ["dashboard:view", "timetable:view"],
};

describe("the role and permission lists", () => {
  it("matches the vppsone.staff_role enum", () => {
    // The enum in supabase/migrations/20260916191757_create_staff_profiles.sql.
    // If these drift, a role exists in the database that the app silently
    // resolves to view_only.
    expect([...staffRoles]).toEqual([
      "admin",
      "office",
      "academic_coordinator",
      "exam_coordinator",
      "teacher",
      "view_only",
    ]);
  });

  it("has no duplicate permissions", () => {
    expect(new Set(staffPermissions).size).toBe(staffPermissions.length);
  });

  it("names every permission surface:verb", () => {
    for (const permission of staffPermissions) {
      expect(permission, `${permission} is not surface:verb`).toMatch(
        /^[a-z]+:[a-z_]+$/,
      );
    }
  });

  it("gives every role a permission list and both labels", () => {
    for (const role of staffRoles) {
      expect(rolePermissions[role], `${role} has no permissions`).toBeDefined();
      expect(roleLabels[role]?.hi, `${role} has no Hindi label`).toBeTruthy();
      expect(roleLabels[role]?.en, `${role} has no English label`).toBeTruthy();
    }
  });

  it("grants only permissions that exist", () => {
    for (const role of staffRoles) {
      for (const permission of rolePermissions[role]) {
        expect(
          staffPermissions,
          `${role} is granted ${permission}, which is not a permission`,
        ).toContain(permission);
      }
    }
  });

  it("grants nothing twice within a role", () => {
    for (const role of staffRoles) {
      const granted = rolePermissions[role];
      expect(new Set(granted).size, `${role} lists a permission twice`).toBe(
        granted.length,
      );
    }
  });
});

describe("can() — every role against every permission", () => {
  // Six roles times every permission. The point is the negative half: it is
  // what notices a role that silently gained something.
  for (const role of staffRoles) {
    describe(role, () => {
      const expected = new Set<string>(expectedPermissions[role]);

      for (const permission of staffPermissions) {
        const shouldHave = expected.has(permission);

        it(`${shouldHave ? "grants" : "denies"} ${permission}`, () => {
          expect(can({ role }, permission)).toBe(shouldHave);
        });
      }

      it("grants exactly the expected set and nothing more", () => {
        expect([...permissionsFor(role)].sort()).toEqual(
          [...expectedPermissions[role]].sort(),
        );
      });
    });
  }

  it("gives admin every permission there is", () => {
    for (const permission of staffPermissions) {
      expect(can({ role: "admin" }, permission)).toBe(true);
    }
  });

  it("never gives view_only anything that writes", () => {
    const writes = staffPermissions.filter(
      (permission) => !permission.endsWith(":view"),
    );

    for (const permission of writes) {
      expect(can({ role: "view_only" }, permission)).toBe(false);
    }
  });

  it("keeps marking attendance and marking on behalf apart", () => {
    // A teacher records their own period; the office records it for a teacher
    // who could not. Neither implies the other.
    expect(can({ role: "teacher" }, "attendance:mark")).toBe(true);
    expect(can({ role: "teacher" }, "attendance:mark_on_behalf")).toBe(false);
    expect(can({ role: "office" }, "attendance:mark_on_behalf")).toBe(true);
    expect(can({ role: "office" }, "attendance:mark")).toBe(false);
  });
});

describe("can() with no staff member", () => {
  it("denies null", () => {
    expect(can(null, "dashboard:view")).toBe(false);
  });

  it("denies undefined", () => {
    expect(can(undefined, "dashboard:view")).toBe(false);
  });

  it("denies a role that is not a role", () => {
    // What a row whose enum value the app has not been taught yet looks like
    // if it reaches can() without going through resolveStaffRole().
    const impostor = { role: "headmaster" as StaffRole };
    expect(can(impostor, "dashboard:view")).toBe(false);
  });
});

describe("canAny()", () => {
  it("is true when one of them is granted", () => {
    expect(
      canAny({ role: "teacher" }, ["timetable:manage", "attendance:mark"]),
    ).toBe(true);
  });

  it("is false when none of them are", () => {
    expect(canAny({ role: "view_only" }, ["marks:write", "staff:manage"])).toBe(
      false,
    );
  });

  it("is false for an empty list", () => {
    expect(canAny({ role: "admin" }, [])).toBe(false);
  });

  it("is false with no staff member, whatever is asked for", () => {
    expect(canAny(null, ["dashboard:view"])).toBe(false);
  });
});

describe("resolveStaffRole()", () => {
  it("passes every known role through unchanged", () => {
    for (const role of staffRoles) {
      expect(resolveStaffRole(role)).toBe(role);
    }
  });

  it.each([
    ["an unknown string", "headmaster"],
    ["the empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 3],
    ["an object", { role: "admin" }],
    ["a near miss in the wrong case", "Admin"],
  ])("falls back to view_only for %s", (_label, value) => {
    expect(resolveStaffRole(value)).toBe("view_only");
  });

  it("falls back to the least privilege, not the most", () => {
    // The whole point: a role the code has not been taught must not be able to
    // arrive as an admin.
    const fallback = resolveStaffRole("something_new");
    expect(permissionsFor(fallback)).toEqual(expectedPermissions.view_only);
  });
});

describe("isStaffRole()", () => {
  it("accepts every role", () => {
    for (const role of staffRoles) {
      expect(isStaffRole(role)).toBe(true);
    }
  });

  it.each([["headmaster"], [""], [null], [undefined], [42], [{}], [["admin"]]])(
    "rejects %s",
    (value) => {
      expect(isStaffRole(value)).toBe(false);
    },
  );
});
