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

describe("the \"+\" in the middle (UX review, 6 Nov 2026; D-643)", () => {
  it("is a \"+\" with a word under it for every role", () => {
    for (const menu of ["admin", "teacher", "accountant", "academic", "exam"] as const) {
      const centre = bottomFor(menu, all).find((t) => t.center);
      expect(centre?.href, menu).toBe("#quick");
      expect(centre?.icon, menu).toBe("plus");
      expect(centre?.short?.en, menu).toBeTruthy();
      expect(centre?.short?.hi, menu).toBeTruthy();
    }
  });

  it("keeps the bar's four tabs where they were, the \"+\" in the middle", () => {
    expect(bottomFor("teacher", all).map((t) => t.key)).toEqual(["home", "class", "center", "notes", "more"]);
    expect(bottomFor("admin", all).map((t) => t.key)).toEqual(["today", "students", "center", "inbox", "menu"]);
    expect(bottomFor("accountant", all).map((t) => t.key)).toEqual(["home", "fees", "center", "dues", "menu"]);
  });

  it("is left out for a reader whose \"+\" would hold nothing", () => {
    expect(bottomFor("admin", all, { quick: false }).some((t) => t.center)).toBe(false);
    expect(bottomFor("admin", all, { quick: false })).toHaveLength(4);
  });
});
