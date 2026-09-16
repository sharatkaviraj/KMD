import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  LayoutGrid,
  Users,
} from "lucide-react";

import {
  can,
  type StaffPermission,
  type StaffRole,
} from "@/platform/auth/permissions";

/**
 * What the bottom bar offers, and to whom.
 *
 * Each item names the permission that reveals it, so navigation and access
 * come from the same map (`permissions.ts`) rather than from two lists that
 * drift. A role that cannot open a screen never sees its tab — and if it
 * types the URL anyway, `requirePermission()` in the page still refuses.
 * The tab is a convenience; the guard is the rule.
 */

export type NavItem = {
  href: string;
  /** Hindi first — this is what teachers read. */
  label: string;
  labelEn: string;
  icon: LucideIcon;
  permission: StaffPermission;
  /**
   * Whether the screen behind this tab exists yet.
   *
   * The whole phase is being built over several merges, and each one deploys.
   * A tab whose route has not landed is a 404 with a school's name on it, so
   * the item stays in this list — where it documents what is coming — but is
   * not rendered until its task flips this. `tests/navigation.test.ts` checks
   * that every ready item really does have a page file, so the flag cannot be
   * left true by accident or false by forgetting.
   */
  ready: boolean;
};

const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "मुख्य",
    labelEn: "Home",
    icon: LayoutGrid,
    permission: "dashboard:view",
    ready: true,
  },
  {
    href: "/staff",
    label: "स्टाफ़",
    labelEn: "Staff",
    icon: Users,
    permission: "staff:view",
    ready: true,
  },
  {
    href: "/academics",
    label: "शैक्षणिक",
    labelEn: "Academics",
    icon: GraduationCap,
    permission: "academics:view",
    ready: true,
  },
  {
    href: "/calendar",
    label: "कैलेंडर",
    labelEn: "Calendar",
    icon: CalendarDays,
    permission: "academics:view",
    ready: false, // task 1.5
  },
  {
    href: "/enrolments",
    label: "नामांकन",
    labelEn: "Enrolments",
    icon: ClipboardCheck,
    permission: "academics:view",
    ready: false, // task 1.6
  },
];

/**
 * The tabs this role may see, in order.
 *
 * Capped at five: a sixth on a 360px phone gives every tab under 60px, which
 * is below a comfortable thumb. When there are more screens than that, the
 * fifth becomes a "More" hub — the shape the fee app settled on.
 */
export function navigationFor(role: StaffRole): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.ready && can({ role }, item.permission),
  ).slice(0, 5);
}

/**
 * Which tab a path lights up.
 *
 * Longest match wins, so `/staff/new` highlights Staff rather than nothing,
 * and a future `/academics/subjects` does not also light up `/academics` twice.
 */
export function activeNavHref(
  pathname: string,
  // Only the href is read, so the nav bars can pass the trimmed-down items
  // they receive across the server/client boundary without a cast.
  items: readonly { href: string }[],
): string | null {
  let best: string | null = null;

  for (const item of items) {
    const matches =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.length)) {
      best = item.href;
    }
  }

  return best;
}

export { NAV_ITEMS };
