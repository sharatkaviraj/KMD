import { describe, expect, it } from "vitest";

import { activeKey, groupsFor, type NavGroup } from "@/vx/nav";

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

describe("the teacher's desk sidebar reaches every More screen (teacher day, 6 Nov, teacher 20)", () => {
  const real = groupsFor("teacher", () => true);
  const at = (path: string) => {
    const [pathname, query] = path.split("?") as [string, string | undefined];
    return activeKey(real, pathname, new URLSearchParams(query ?? ""));
  };
  it("lists Timetable, My tasks, Help and My profile", () => {
    const keys = real.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toEqual(expect.arrayContaining(["timetable", "tasks", "help", "profile"]));
  });
  it("lights the item for the More view that is open", () => {
    expect(at("/teach/more?view=help")).toBe("help");
    expect(at("/teach/more?view=profile")).toBe("profile");
    expect(at("/teach/more?view=timetable")).toBe("timetable");
  });
  it("lights the catch-all for the other More views", () => {
    expect(at("/teach/more")).toBe("more");
    expect(at("/teach/more?view=news")).toBe("more");
  });
  it("lights My tasks on a task", () => {
    expect(at("/teach/tasks")).toBe("tasks");
    expect(at("/teach/tasks/abc")).toBe("tasks");
  });
});
