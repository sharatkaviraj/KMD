import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  activeNavHref,
  navigationFor,
  NAV_ITEMS,
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
      expect(navigationFor(role).length).toBeLessThanOrEqual(5);
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

  it("gives admin every ready item there is", () => {
    expect(navigationFor("admin").map((item) => item.href)).toEqual(
      NAV_ITEMS.filter((item) => item.ready).slice(0, 5).map((item) => item.href),
    );
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
      )
        .slice(0, 5)
        .map((item) => item.href);

      expect(navigationFor(role).map((item) => item.href)).toEqual(expected);
    },
  );
});
