import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  GraduationCap,
  Inbox,
  LayoutGrid,
  MoreHorizontal,
  Repeat2,
  Table2,
  Users,
} from "lucide-react";

import { m } from "@/messages";
import type { Localized } from "@/platform/i18n/language";
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
  /** Rendered in whichever language the reader asked for. */
  label: Localized;
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
    label: m.navHome,
    icon: LayoutGrid,
    permission: "dashboard:view",
    ready: true,
  },
  // Second, not fifth: this is the screen a teacher opens every morning, and
  // the second tab is the one a thumb reaches without looking.
  {
    href: "/teach",
    label: m.navTeach,
    icon: ClipboardCheck,
    permission: "attendance:view",
    ready: true,
  },
  // Third, for the same reason: on a day somebody is away this is the screen
  // the coordinator lives on, and it is wanted before the master data is.
  {
    href: "/substitutions",
    label: m.navSubstitutions,
    icon: Repeat2,
    permission: "substitutions:view",
    ready: true,
  },
  {
    href: "/timetable",
    label: m.timetableTitle,
    icon: Table2,
    permission: "timetable:view",
    ready: true,
  },
  {
    href: "/collection",
    label: m.navCollection,
    icon: Inbox,
    permission: "collection:view",
    ready: true,
  },
  {
    href: "/academics",
    label: m.navAcademics,
    icon: GraduationCap,
    permission: "academics:view",
    ready: true,
  },
  {
    href: "/staff",
    label: m.navStaff,
    icon: Users,
    permission: "staff:view",
    ready: true,
  },
];

/**
 * The fifth tab, once a role has more screens than the bar holds.
 *
 * Kept out of `NAV_ITEMS` on purpose: it is not a screen anybody has a
 * permission for, it is what the bar does when it runs out of room. Its own
 * page lists whatever did not fit.
 */
export const MORE_ITEM: NavItem = {
  href: "/more",
  label: m.navMore,
  icon: MoreHorizontal,
  permission: "dashboard:view",
  ready: true,
};

/**
 * Five, because a sixth on a 360px phone gives every tab under 60px — below a
 * comfortable thumb.
 */
export const MAX_TABS = 5;

/**
 * Screens that are deliberately not tabs.
 *
 * The bar holds five, and adding a sixth would put every tab under 60px on a
 * 360px phone. The calendar and the enrolment record are academic master data
 * that the office visits occasionally, so they are reached from the Academics
 * hub rather than from the thumb bar; `/access-denied` is somewhere you are
 * sent, never somewhere you go.
 *
 * `tests/navigation.test.ts` requires every screen under `src/app/(app)/` to
 * be either a nav item or listed here — so a new screen cannot end up
 * unreachable by accident, which is exactly what happened to `/timetable`
 * before this list existed.
 */
export const NON_NAV_SCREENS = [
  "/access-denied",
  "/calendar",
  "/enrolments",
] as const;

/** Everything this role may open, before the bar decides what fits. */
export function allowedFor(role: StaffRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.ready && can({ role }, item.permission));
}

/**
 * The tabs this role sees, in order.
 *
 * Capped at five. When a role may open more screens than that, the fifth
 * becomes a "More" hub rather than the sixth screen simply vanishing — which
 * is what a plain `.slice(0, 5)` did the day `/substitutions` was added, and
 * is the same class of bug as `/timetable` shipping with no tab at all.
 */
export function navigationFor(role: StaffRole): NavItem[] {
  const allowed = allowedFor(role);
  if (allowed.length <= MAX_TABS) return allowed;
  return [...allowed.slice(0, MAX_TABS - 1), MORE_ITEM];
}

/** What the More hub lists — empty when everything already fits on the bar. */
export function overflowFor(role: StaffRole): NavItem[] {
  const allowed = allowedFor(role);
  return allowed.length <= MAX_TABS ? [] : allowed.slice(MAX_TABS - 1);
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
