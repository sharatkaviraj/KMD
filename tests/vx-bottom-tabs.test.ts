import { describe, expect, it } from "vitest";

import { bottomFor } from "@/vx/nav";
import { activeTab } from "@/vx/shell/bottom-bar";

/*
 * Which phone tab is lit (XNav and the role frames): the tab's own screens,
 * nothing on the centre action's screen, Menu on a screen with no tab (UI-78).
 */

const all = () => true;

describe("activeTab", () => {
  it("lights Progress, not Today, on the coordinator's progress pages (M-AcadProgress)", () => {
    const tabs = bottomFor("academic", all);
    expect(activeTab(tabs, "/academics/progress")).toBe("/academics/progress");
    expect(activeTab(tabs, "/academics/progress/class/7")).toBe("/academics/progress");
  });

  it("lights nothing on the centre action's own screen (M-AcadAttendance, M-TchAttend)", () => {
    expect(activeTab(bottomFor("academic", all), "/academics/attendance")).toBeNull();
    expect(activeTab(bottomFor("teacher", all), "/teach/attendance")).toBeNull();
    expect(activeTab(bottomFor("accountant", all), "/payments")).toBeNull();
  });

  it("lights the role's home only on the home itself", () => {
    expect(activeTab(bottomFor("academic", all), "/academics")).toBe("/academics");
    expect(activeTab(bottomFor("admin", all), "/")).toBe("/");
    expect(activeTab(bottomFor("admin", all), "/students/abc")).toBe("/students");
  });

  it("lights Menu on a screen with no tab of its own (UI-78)", () => {
    expect(activeTab(bottomFor("admin", all), "/fee-setup")).toBe("/menu");
    expect(activeTab(bottomFor("academic", all), "/calendar")).toBe("/menu");
  });

  it("draws the teacher's More as a grid and notes with the design's pen", () => {
    const tabs = bottomFor("teacher", all);
    expect(tabs.find((t) => t.key === "more")?.icon).toBe("grid");
    expect(tabs.find((t) => t.key === "notes")?.icon).toBe("note");
  });
});

describe("a screen under the accountant's Today but reached from Menu (smoke 20 Oct)", () => {
  it("lights Menu on Cheques, UPI & refunds, and Today only on Today", () => {
    const tabs = bottomFor("accountant", all);
    expect(activeTab(tabs, "/accounts/books")).toBe("/menu");
    expect(activeTab(tabs, "/accounts")).toBe("/accounts");
  });

  it("lights a teacher's More on Marks and remarks, never Today (smoke 20 Oct)", () => {
    const tabs = bottomFor("teacher", all);
    expect(activeTab(tabs, "/teach")).toBe("/teach");
    expect(activeTab(tabs, "/teach/marks")).toBe("/teach/more");
    expect(activeTab(tabs, "/teach/more")).toBe("/teach/more");
  });
});

describe("the centre button (UX review, 6 Nov 2026)", () => {
  it("prints a word under the centre button for every role", () => {
    for (const menu of ["admin", "teacher", "accountant", "academic", "exam"] as const) {
      const centre = bottomFor(menu, all).find((t) => t.center);
      expect(centre?.short?.en, menu).toBeTruthy();
      expect(centre?.short?.hi, menu).toBeTruthy();
    }
  });

  it("gives a teacher without a class Marks, not a dead-end Attendance", () => {
    const centre = (o?: { teacherHasClass?: boolean }) => bottomFor("teacher", all, o).find((t) => t.center);
    expect(centre()?.href).toBe("/teach/attendance");
    expect(centre({ teacherHasClass: true })?.href).toBe("/teach/attendance");
    expect(centre({ teacherHasClass: false })?.href).toBe("/teach/marks");
    expect(centre({ teacherHasClass: false })?.short?.en).toBe("Marks");
    // Other roles are untouched by the flag.
    expect(bottomFor("academic", all, { teacherHasClass: false }).find((t) => t.center)?.href).toBe("/academics/attendance");
  });
});
