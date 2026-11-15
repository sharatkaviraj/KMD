import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { hintFor, menuGroups, pinnedTiles, settingsLinks } from "@/app/(app)/menu/menu-items";
import { can, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { bottomFor, groupsFor, type DesignMenu } from "@/vx/nav";

/*
 * The phone Menu (F13, redrawn D-519) offers only what the reader's
 * permissions open, in coloured groups, every tile saying what it opens, with
 * four shortcuts until the reader picks others, and Settings first.
 */

const as = (role: StaffRole) => (p: StaffPermission) => can({ role }, p);
const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

describe("menuGroups", () => {
  it("draws the admin's groups, each with its own id, chip word, icon and colour", () => {
    const groups = menuGroups("admin", () => true);
    expect(groups.map((g) => g.title.en)).toEqual(["Daily work", "Children & staff", "Studies & exams", "Fees & money", "Messages", "School records"]);
    expect(groups.map((g) => g.id)).toEqual(["daily", "people", "studies", "money", "messages", "records"]);
    expect(new Set(groups.map((g) => g.tone)).size).toBe(groups.length);
    expect(groups[0].tiles.map((x) => x.label.en)).toEqual(["Attendance", "Cover for absent teachers", "Collect fee", "Dues & calls", "Needs you", "Chats with parents"]);
  });

  it("says, under every admin tile, what it opens, in both languages", () => {
    for (const tile of menuGroups("admin", () => true).flatMap((g) => g.tiles)) {
      expect(tile.hint?.en, tile.key).toBeTruthy();
      expect(tile.hint?.hi, tile.key).toBeTruthy();
      expect(tile.label.hi, tile.key).toBeTruthy();
    }
  });

  it("has no Settings tile in the list: Settings is the card at the top", () => {
    const keys = menuGroups("admin", () => true).flatMap((g) => g.tiles.map((x) => x.href));
    expect(keys).not.toContain("/settings");
  });

  it("never offers a tile its screen would refuse", () => {
    const allowed = new Set<StaffPermission>(["students:view", "attendance:mark_on_behalf"]);
    const tiles = menuGroups("admin", (p) => allowed.has(p)).flatMap((g) => g.tiles);
    expect(tiles.every((x) => allowed.has(x.permission))).toBe(true);
    expect(tiles.map((x) => x.key)).toEqual(["attendance", "students"]);
  });

  it("offers an admin tile only with the permission the sidebar asks for the same screen", () => {
    const nav = new Map(groupsFor("admin", () => true).flatMap((g) => g.items).map((i) => [i.href, i.permission]));
    for (const tile of menuGroups("admin", () => true).flatMap((g) => g.tiles)) {
      const guard = nav.get(tile.href);
      if (guard) expect(tile.permission, tile.href).toBe(guard);
    }
  });

  it("gives other menus their own nav as tiles, and no money to a teacher", () => {
    const tiles = menuGroups("teacher", as("teacher")).flatMap((g) => g.tiles);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.some((x) => x.permission.startsWith("fees:"))).toBe(false);
  });

  it("says what every screen opens on the other menus too", () => {
    for (const menu of ["teacher", "accountant", "academic", "exam"] as DesignMenu[]) {
      for (const tile of menuGroups(menu, () => true).flatMap((g) => g.tiles)) {
        expect(hintFor(tile.href)?.en, `${menu}:${tile.href}`).toBeTruthy();
        expect(tile.hint, `${menu}:${tile.href}`).toEqual(hintFor(tile.href));
      }
    }
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

  it("does not spend the default shortcuts on what the bottom bar already opens", () => {
    const acc = menuGroups("accountant", as("accountant"));
    const bar = bottomFor("accountant", as("accountant")).map((t) => t.href);
    const pins = pinnedTiles(acc, null, "accountant", bar);
    expect(pins).toHaveLength(4);
    expect(pins.some((x) => bar.includes(x.href))).toBe(false);
  });

  it("still fills four from the bar's own screens when nothing else is left", () => {
    const acc = menuGroups("accountant", as("accountant"));
    const everything = acc.flatMap((g) => g.tiles.map((x) => x.href));
    expect(pinnedTiles(acc, null, "accountant", everything)).toHaveLength(4);
  });
});

describe("settings on the Menu", () => {
  it("sends an admin to the school's settings and everyone else to their own", () => {
    expect(settingsLinks(true).school).toBe("/settings");
    expect(settingsLinks(false).school).toBeNull();
    expect(settingsLinks(false).mine).toBe("/preferences");
  });

  it("gives the school's settings only with settings:manage, and puts the Settings card before the shortcuts", () => {
    expect(read("src/app/(app)/menu/page.tsx")).toContain('schoolSettings={allowed("settings:manage")}');
    const screen = read("src/app/(app)/menu/menu-screen.tsx");
    expect(screen.indexOf('id="menu-settings"')).toBeGreaterThan(0);
    expect(screen.indexOf('id="menu-settings"')).toBeLessThan(screen.indexOf('id="menu-shortcuts"'));
  });

  it("asks once before signing out", () => {
    const screen = read("src/app/(app)/menu/menu-screen.tsx");
    expect(screen).toContain("<Confirm");
    expect(screen).toContain("await logoutAction()");
  });
});
