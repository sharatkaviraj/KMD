import { describe, expect, it } from "vitest";

import { can, effectivePermissions, rolePermissions } from "@/platform/auth/permissions";
import { cellLock, cleanChanges, diffMatrix, has, matrixFromRows, toggle } from "@/vx/screens/staff/domain/matrix";
import { loginState, maskPhone, tempPasswordFrom } from "@/vx/screens/staff/domain/people";

describe("role matrix", () => {
  it("locks admin and teacher money cells", () => {
    expect(cellLock("admin", "students:view")).toBe("admin");
    expect(cellLock("teacher", "fees:collect")).toBe("teacher_money");
    expect(cellLock("office", "fees:collect")).toBeNull();
  });

  it("builds a matrix from rows, ignoring unknown roles and permissions, admin is everything", () => {
    const m = matrixFromRows([
      { role: "office", permission: "students:view" },
      { role: "office", permission: "students:view" },
      { role: "office", permission: "nope:nope" },
      { role: "ghost", permission: "students:view" },
    ]);
    expect(m.office).toEqual(["students:view"]);
    expect(m.admin.length).toBeGreaterThan(10);
  });

  it("toggles an open cell and refuses a locked one", () => {
    const m = matrixFromRows([]);
    const on = toggle(m, "office", "students:view");
    expect(has(on, "office", "students:view")).toBe(true);
    expect(toggle(m, "teacher", "fees:collect")).toBe(m);
    expect(diffMatrix(m, on)).toEqual([{ role: "office", permission: "students:view", granted: true }]);
  });

  it("validates changes from the browser", () => {
    expect(cleanChanges([{ role: "office", permission: "students:view", granted: false }])).toHaveLength(1);
    expect(cleanChanges([{ role: "teacher", permission: "fees:collect", granted: true }])).toBeNull();
    expect(cleanChanges([{ role: "admin", permission: "students:view", granted: false }])).toBeNull();
    expect(cleanChanges([])).toBeNull();
    expect(cleanChanges("x")).toBeNull();
  });
});

describe("effective permissions", () => {
  it("falls back to the role map without a database row", () => {
    expect(effectivePermissions({ role: "office" })).toEqual(rolePermissions.office);
  });

  it("honours the database matrix, but never gives a teacher money", () => {
    const subject = { role: "teacher" as const, permissions: ["students:view", "fees:collect"] };
    expect(can(subject, "fees:collect")).toBe(false);
    expect(can({ role: "office", permissions: [] }, "students:view")).toBe(false);
    expect(can({ role: "admin", permissions: [] }, "settings:manage")).toBe(true);
  });
});

describe("people", () => {
  it("derives login state", () => {
    expect(loginState({ isActive: false, hasLogin: true, lastSignInAt: "x" })).toBe("disabled");
    expect(loginState({ isActive: true, hasLogin: false, lastSignInAt: null })).toBe("none");
    expect(loginState({ isActive: true, hasLogin: true, lastSignInAt: null })).toBe("never");
    expect(loginState({ isActive: true, hasLogin: true, lastSignInAt: "2026-10-01" })).toBe("active");
  });

  it("masks phones", () => {
    expect(maskPhone("+91 90000 00123")).toBe("90000 ••123");
    expect(maskPhone(null)).toBe("—");
  });

  it("makes a temporary password without look-alikes", () => {
    const pw = tempPasswordFrom(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(pw).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  });
});
