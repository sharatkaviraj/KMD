import { describe, expect, it } from "vitest";

import { menuGroups, pinnedTiles } from "@/app/(app)/menu/menu-items";
import { can, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";

/*
 * The phone Menu (F13) offers only what the reader's permissions open, in the
 * design's groups, with the design's four pins until the reader picks others.
 */

const as = (role: StaffRole) => (p: StaffPermission) => can({ role }, p);

describe("menuGroups", () => {
  it("draws the design's groups for the admin", () => {
    const groups = menuGroups("admin", () => true);
    expect(groups.map((g) => g.title.en)).toEqual(["Daily", "People", "Academics", "Money", "Messages", "System"]);
    expect(groups[0].tiles.map((x) => x.label.en)).toEqual(["Attendance", "Substitutions", "Collect fee", "Dues & calls"]);
  });

  it("never offers a tile its screen would refuse", () => {
    const allowed = new Set<StaffPermission>(["students:view", "attendance:mark_on_behalf"]);
    const tiles = menuGroups("admin", (p) => allowed.has(p)).flatMap((g) => g.tiles);
    expect(tiles.every((x) => allowed.has(x.permission))).toBe(true);
    expect(tiles.map((x) => x.key)).toEqual(["attendance", "students"]);
  });

  it("gives other menus their own nav as tiles, and no money to a teacher", () => {
    const tiles = menuGroups("teacher", as("teacher")).flatMap((g) => g.tiles);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.some((x) => x.permission.startsWith("fees:"))).toBe(false);
  });
});

describe("pinnedTiles", () => {
  const groups = menuGroups("admin", () => true);

  it("starts with the design's four pins", () => {
    expect(pinnedTiles(groups, null, "admin").map((x) => x.label.en)).toEqual(["Collect fee", "Attendance", "Dues & calls", "Timetable"]);
  });

  it("keeps the reader's own pins, dropping any that no longer open", () => {
    expect(pinnedTiles(groups, ["reports", "gone", "students"], "admin").map((x) => x.key)).toEqual(["reports", "students"]);
  });

  it("fills from the first tiles when a default pin is not allowed", () => {
    const noFees = menuGroups("admin", (p) => !p.startsWith("fees:"));
    expect(pinnedTiles(noFees, null, "admin")).toHaveLength(4);
    expect(pinnedTiles(noFees, null, "admin").some((x) => x.permission.startsWith("fees:"))).toBe(false);
  });
});
