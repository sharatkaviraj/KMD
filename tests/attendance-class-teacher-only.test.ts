import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { withoutAttendance } from "@/vx/screens/teach/domain/teach";

// Owner, 6 Nov 2026: teachers do not open the school-wide attendance screen,
// and only a class's class teacher sees its attendance. A subject teacher
// still sees the roll, notes and marks of a class she teaches.
const read = (p: string) => readFileSync(p, "utf8");

describe("attendance is the class teacher's", () => {
  it("school-wide attendance needs academics:view first, which teachers lack", () => {
    const page = read("src/app/(app)/academics/attendance/page.tsx");
    expect(page.indexOf('requirePermission("academics:view"')).toBeGreaterThan(-1);
    expect(page.indexOf('requirePermission("academics:view"')).toBeLessThan(page.indexOf('requirePermission("attendance:view"'));
    const perms = read("src/platform/auth/permissions.ts");
    const teacher = perms.slice(perms.indexOf("const teacherPermissions"), perms.indexOf("const viewOnlyPermissions"));
    expect(teacher).not.toContain('"academics:view"');
  });

  it("registers and the month sheet read the held-class scope", () => {
    expect(read("src/modules/attendance/data/teaching-repo.ts")).toMatch(/attendanceScopeFor[\s\S]*heldClassIds\(staff\.id, sessionLabel\)/);
    expect(read("src/app/(app)/teach/register/page.tsx")).toContain("attendanceScopeFor(staff, sessionLabel)");
    const data = read("src/vx/screens/teach/data.ts");
    const load = data.slice(data.indexOf("export async function loadAttendance"), data.indexOf("export async function loadClass"));
    expect(load).toContain("attendanceScopeFor(staff, sessionLabel)");
    expect(load).not.toContain("classScopeFor(");
  });

  it("class and child pages drop attendance for a class not held", () => {
    const data = read("src/vx/screens/teach/data.ts");
    expect(data).toContain("const seesAttendance = readsEveryClass(staff) || held.includes(classId);");
    expect(data).toContain("readsEveryClass(staff) || photoHeld.includes(placement.classId)");
    expect(read("src/app/(app)/page.tsx")).toContain('can(staff, "attendance:view") && readsEveryClass(staff)');
  });

  it("withoutAttendance clears every figure and the attendance reason", () => {
    const out = withoutAttendance({
      classAttendance: 82,
      children: [{ id: "a", attendancePct: 40, daysCounted: 20, presentDays: 8, reasons: ["attendance", "marks"] as ("attendance" | "marks" | "notes")[] }],
    });
    expect(out.classAttendance).toBeNull();
    expect(out.children[0]).toMatchObject({ attendancePct: null, daysCounted: 0, presentDays: 0, reasons: ["marks"] });
  });
});
