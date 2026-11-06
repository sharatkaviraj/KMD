import { describe, expect, it } from "vitest";

import { activeKey, type NavGroup } from "@/vx/nav";

const groups = [
  {
    items: [
      { key: "home", href: "/teach" },
      { key: "marks", href: "/teach/marks" },
      { key: "more", href: "/teach/more" },
    ],
  },
] as unknown as NavGroup[];

describe("the teacher's sidebar lights the right item (smoke 6 Nov, teacher 20)", () => {
  it("lights Today only on Today", () => {
    expect(activeKey(groups, "/teach")).toBe("home");
  });
  it("lights the catch-all for a screen under Today with no item of its own", () => {
    expect(activeKey(groups, "/teach/tasks")).toBe("more");
  });
  it("keeps a screen's own item", () => {
    expect(activeKey(groups, "/teach/marks")).toBe("marks");
  });
  it("leaves a role without a catch-all alone", () => {
    const admin = [{ items: [{ key: "home", href: "/" }, { key: "students", href: "/students" }] }] as unknown as NavGroup[];
    expect(activeKey(admin, "/students/x")).toBe("students");
  });
});
