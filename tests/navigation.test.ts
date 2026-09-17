import fs, { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  activeNavHref,
  allowedFor,
  homeFor,
  MAX_TABS,
  MORE_ITEM,
  navigationFor,
  NAV_ITEMS,
  NON_NAV_SCREENS,
  overflowFor,
  sidebarFor,
} from "@/platform/config/navigation";
import {
  can,
  staffPermissions,
  staffRoles,
  type StaffRole,
} from "@/platform/auth/permissions";

describe("the navigation map", () => {
  it("names only permissions that exist", () => {
    for (const item of NAV_ITEMS) {
      expect(
        staffPermissions,
        `${item.href} needs ${item.permission}, which is not a permission`,
      ).toContain(item.permission);
    }
  });

  it("gives every item both halves of a label", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.hi, `${item.href} has no Hindi label`).toBeTruthy();
      expect(item.label.en, `${item.href} has no English label`).toBeTruthy();
      // A pair whose halves are identical is a translation nobody did.
      expect(item.label.hi).not.toBe(item.label.en);
    }
  });

  it("has no duplicate hrefs", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  /**
   * The `ready` flag exists because Phase 1 ships over several merges and each
   * one deploys. These two tests are what keep it honest in both directions: a
   * tab that is shown but has no route is a 404 with the school's name on it,
   * and a route that exists but is never shown is a screen nobody can reach.
   */
  describe("the ready flag matches what is actually built", () => {
    const appDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/app/(app)",
    );

    const pageFor = (href: string) =>
      path.join(appDir, href.replace(/^\//, ""), "page.tsx");

    it.each(NAV_ITEMS.filter((item) => item.ready).map((i) => [i.href, i.href]))(
      "%s is ready, so its page exists",
      (_label, href) => {
        expect(existsSync(pageFor(href)), `${href} is ready but has no page.tsx`).toBe(
          true,
        );
      },
    );

    it.each(NAV_ITEMS.filter((item) => !item.ready).map((i) => [i.href, i.href]))(
      "%s is not ready, so its page does not exist yet",
      (_label, href) => {
        expect(
          existsSync(pageFor(href)),
          `${href} has a page.tsx — flip ready: true so staff can reach it`,
        ).toBe(false);
      },
    );
  });
});

describe("every screen is reachable", () => {
  const appDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/app/(app)",
  );

  /**
   * Every top-level screen under `(app)` is either a tab or explicitly listed
   * as not one.
   *
   * The `ready` flag only guards items already in NAV_ITEMS, so a screen left
   * out of the list entirely was invisible to it — which is exactly how
   * /timetable shipped with no way to reach it. This is the check that would
   * have caught that.
   */
  const screens = fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
    .map((entry) => `/${entry.name}`)
    .filter((href) =>
      fs.existsSync(path.join(appDir, href.slice(1), "page.tsx")),
    );

  it("finds the screens it is supposed to be checking", () => {
    expect(screens.length).toBeGreaterThan(3);
    expect(screens).toContain("/timetable");
  });

  it.each(screens)("%s is a tab or is declared not to be", (href) => {
    const isTab = NAV_ITEMS.some((item) => item.href === href);
    const isDeclared = (NON_NAV_SCREENS as readonly string[]).includes(href);
    // The More hub is a tab the bar produces rather than one in the list.
    const isMore = href === MORE_ITEM.href;

    expect(
      isTab || isDeclared || isMore,
      `${href} has no nav item and is not in NON_NAV_SCREENS — nobody can reach it`,
    ).toBe(true);
  });

  it("does not declare a screen that does not exist", () => {
    for (const href of NON_NAV_SCREENS) {
      expect(screens, `${href} is declared but has no page`).toContain(href);
    }
  });

  it("never declares a screen that is also a tab", () => {
    for (const href of NON_NAV_SCREENS) {
      expect(NAV_ITEMS.map((item) => item.href)).not.toContain(href);
    }
  });
});

describe("navigationFor()", () => {
  it.each(staffRoles)("only offers %s what it may open", (role) => {
    // The point of deriving nav from permissions: a tab a role cannot use is
    // never rendered, so nobody taps into an access-denied screen.
    for (const item of navigationFor(role)) {
      expect(
        can({ role }, item.permission),
        `${role} was offered ${item.href} without ${item.permission}`,
      ).toBe(true);
    }
  });

  it("never offers more than five tabs", () => {
    // A sixth tab on a 360px phone puts every tab under 60px, which is below
    // a comfortable thumb.
    for (const role of staffRoles) {
      expect(navigationFor(role).length).toBeLessThanOrEqual(MAX_TABS);
    }
  });

  it("gives every role a home to land on", () => {
    // The app redirects to /dashboard after sign-in, so a role with no
    // dashboard tab would land somewhere it cannot see.
    for (const role of staffRoles) {
      expect(
        navigationFor(role).some((item) => item.href === "/dashboard"),
        `${role} has no dashboard`,
      ).toBe(true);
    }
  });

  /**
   * The rule the five-tab cap must not break: a screen a role may open has to
   * be reachable *somewhere*. The old test asserted `slice(0, 5)`, which is
   * how `/substitutions` became the sixth item and silently vanished for
   * admin, office and the academic coordinator the day it was added.
   */
  it.each(staffRoles)("leaves %s nothing it may open but cannot reach", (role) => {
    const reachable = new Set([
      ...navigationFor(role).map((item) => item.href),
      ...overflowFor(role).map((item) => item.href),
    ]);

    for (const item of allowedFor(role)) {
      expect(
        reachable.has(item.href),
        `${role} may open ${item.href} but no tab and no More entry leads there`,
      ).toBe(true);
    }
  });

  it("gives admin every ready item there is, across the bar and More", () => {
    const everything = NAV_ITEMS.filter((item) => item.ready).map((item) => item.href);
    const offered = [
      ...navigationFor("admin").filter((item) => item.href !== MORE_ITEM.href),
      ...overflowFor("admin"),
    ].map((item) => item.href);

    // Sorted: since R1.2 the order is the role's own (B-04), and it is asserted
    // on its own below. What this one is for is that nothing goes *missing*
    // between the bar and the hub.
    expect([...offered].sort()).toEqual([...everything].sort());
  });

  it("only shows More when something would not have fitted", () => {
    // A teacher opens four screens, so a fifth tab reading "More" over an
    // empty page would be a tab that does nothing.
    expect(navigationFor("teacher").map((item) => item.href)).not.toContain(
      MORE_ITEM.href,
    );
    expect(overflowFor("teacher")).toEqual([]);

    expect(navigationFor("admin").map((item) => item.href)).toContain(MORE_ITEM.href);
    expect(overflowFor("admin").length).toBeGreaterThan(0);
  });

  it("gives a teacher no master-data tabs", () => {
    const hrefs = navigationFor("teacher").map((item) => item.href);
    expect(hrefs).not.toContain("/staff");
    expect(hrefs).not.toContain("/academics");
  });
});

describe("activeNavHref()", () => {
  /**
   * A fixture rather than `navigationFor("admin")`: this function's job is
   * matching paths, and pinning it to whichever tabs happen to be `ready`
   * would make it fail every time a task flips a flag.
   */
  const items = [
    { href: "/dashboard" },
    { href: "/staff" },
    { href: "/academics" },
  ];

  it("matches a tab exactly", () => {
    expect(activeNavHref("/staff", items)).toBe("/staff");
  });

  it("keeps a child route on its parent's tab", () => {
    // Otherwise opening a staff member drops the highlight entirely and the
    // bar looks like nothing is selected.
    expect(activeNavHref("/staff/abc-123", items)).toBe("/staff");
    expect(activeNavHref("/staff/abc-123/edit", items)).toBe("/staff");
  });

  it("prefers the longest match", () => {
    const nested = [
      { href: "/academics" },
      { href: "/academics/subjects" },
    ];

    expect(activeNavHref("/academics/subjects", nested)).toBe(
      "/academics/subjects",
    );
  });

  it("does not match a path that merely starts with the same letters", () => {
    // `/staffroom` is not `/staff`.
    expect(activeNavHref("/staffroom", items)).toBeNull();
  });

  it("returns null for a path with no tab", () => {
    expect(activeNavHref("/access-denied", items)).toBeNull();
  });
});

describe("nav and permissions cannot drift apart", () => {
  it.each(staffRoles)(
    "%s is offered exactly the items its permissions allow",
    (role: StaffRole) => {
      const expected = NAV_ITEMS.filter(
        (item) => item.ready && can({ role }, item.permission),
      ).map((item) => item.href);

      const offered = [
        ...navigationFor(role).filter((item) => item.href !== MORE_ITEM.href),
        ...overflowFor(role),
      ].map((item) => item.href);

      // A set, not a sequence. The order is each role's own since R1.2 and is
      // asserted separately; what must not change is *which* screens a role is
      // offered, which is the half that can only come from the permission map.
      expect([...offered].sort()).toEqual([...expected].sort());
    },
  );

  it.each(staffRoles)("never offers %s a screen it cannot open", (role: StaffRole) => {
    for (const item of overflowFor(role)) {
      expect(
        can({ role }, item.permission),
        `${role} was offered ${item.href} under More without ${item.permission}`,
      ).toBe(true);
    }
  });
});

describe("each role's bar leads with its own work (B-04)", () => {
  /** The first thing on the bar, which is what a thumb reaches without looking. */
  const first = (role: StaffRole) => navigationFor(role)[0]?.href;

  it("opens a teacher's bar on her day, not on a profile card", () => {
    expect(first("teacher")).toBe("/teach");
    expect(homeFor("teacher")).toBe("/teach");
  });

  it("puts SamPark and the other apps on the office's bar", () => {
    // The whole of B-04: the office used to reach its daily work through More,
    // behind Teach, Cover and Timetable — three screens it does not use — while
    // every role got the same order.
    const office = navigationFor("office").map((item) => item.href);

    expect(office).toContain("/students");
    expect(office).toContain("/collection");
    expect(office).toContain("/apps");

    // PLAN section 3 office bar: Home, Students, SamPark, Apps, More.
    expect(office.slice(0, 4)).toEqual([
      "/dashboard",
      "/students",
      "/collection",
      "/apps",
    ]);
  });

  it("gives the academic coordinator cover before the master data", () => {
    const bar = navigationFor("academic_coordinator").map((item) => item.href);

    expect(bar.slice(0, 3)).toEqual(["/dashboard", "/substitutions", "/timetable"]);
  });

  it("gives the exam coordinator exams second", () => {
    expect(navigationFor("exam_coordinator").map((item) => item.href)[1]).toBe(
      "/assessments",
    );
  });

  it.each(staffRoles)("%s starts on a screen it may open", (role: StaffRole) => {
    const home = homeFor(role);
    const item = NAV_ITEMS.find((entry) => entry.href === home);

    expect(item, `${home} is not a nav item`).toBeDefined();
    expect(
      can({ role }, item!.permission),
      `${role} lands on ${home} without ${item!.permission}`,
    ).toBe(true);
  });
});

describe("the desktop sidebar hides nothing", () => {
  it.each(staffRoles)(
    "%s reaches every screen it may open without a More hub",
    (role: StaffRole) => {
      const allowed = NAV_ITEMS.filter(
        (item) => item.ready && can({ role }, item.permission),
      ).map((item) => item.href);

      const grouped = sidebarFor(role).flatMap((group) =>
        group.items.map((item) => item.href),
      );

      // There is no More on the sidebar, so anything missing from a group
      // would simply be unreachable on a wide window.
      expect([...grouped].sort()).toEqual([...allowed].sort());
    },
  );

  it("names every group and never renders an empty one", () => {
    for (const role of staffRoles) {
      for (const group of sidebarFor(role)) {
        expect(group.items.length).toBeGreaterThan(0);
        expect(group.title.en.length).toBeGreaterThan(2);
        expect(group.title.hi.length).toBeGreaterThan(1);
      }
    }
  });

  it("gives the viewer the two screens PLAN §3 names and no more", () => {
    const groups = sidebarFor("view_only");

    expect(groups.flatMap((group) => group.items).map((item) => item.href)).toEqual([
      "/dashboard",
      "/timetable",
    ]);
  });
});
