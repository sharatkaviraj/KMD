import type { LucideIcon } from "lucide-react";
import {
  BadgeIndianRupee,
  BookOpenCheck,
  ClipboardList,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Inbox,
  LayoutGrid,
  MoreHorizontal,
  Repeat2,
  SquareArrowOutUpRight,
  Table2,
  UserSearch,
  Timer,
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
    href: "/assessments",
    label: m.navAssessments,
    icon: FileText,
    permission: "assessments:view",
    ready: true,
  },
  // Find a child. PLAN section 3 puts Students second on the admin and office
  // bars, ahead of everything the office visits a few times a term.
  {
    href: "/students",
    label: m.studentsTitle,
    icon: UserSearch,
    permission: "students:view",
    ready: true,
  },
  {
    href: "/collection",
    label: m.navCollection,
    icon: Inbox,
    permission: "collection:view",
    ready: true,
  },
  // The way to the other two apps. Above the master data on purpose: the
  // office reaches for School Fees several times a day and for the subject
  // list a few times a year.
  {
    href: "/apps",
    label: m.navApps,
    icon: SquareArrowOutUpRight,
    permission: "apps:view",
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
  /*
   * The fee desk.
   *
   * Ordinary `NAV_ITEMS` rather than a parallel list, so they go through
   * the same five-tab bar, the same grouped sidebar and the same
   * reachability test as everything else. What is behind them is School
   * Fees, unchanged; how you get there is this app's navigation.
   *
   * All three permissions are needed rather than one: `fees:view` opens
   * the desk, `fees:collect` is the Payment Desk, `fees:manage` is the
   * setup a fee_collector should not be offered. A tab nobody in the role
   * can use is a tab that teaches people to ignore the bar.
   */
  {
    href: "/fees/payments",
    label: m.navPaymentDesk,
    icon: BadgeIndianRupee,
    permission: "fees:collect",
    ready: true,
  },
  {
    href: "/fees/transactions",
    label: m.navTransactions,
    icon: BookOpenCheck,
    permission: "fees:view",
    ready: true,
  },
  {
    href: "/fees/defaulters",
    label: m.navDefaulters,
    icon: ClipboardList,
    permission: "fees:view",
    ready: true,
  },
  {
    href: "/fees/students",
    label: m.navFeeStudents,
    icon: UserSearch,
    permission: "fees:view",
    ready: true,
  },
  {
    href: "/fees/reminders",
    label: m.navReminders,
    icon: SquareArrowOutUpRight,
    permission: "fees:manage",
    ready: true,
  },
  {
    href: "/fees/fee-setup",
    label: m.navFeeSetup,
    icon: FileText,
    permission: "fees:manage",
    ready: true,
  },
  {
    href: "/fees/exports",
    label: m.navFeeExports,
    icon: Table2,
    permission: "fees:view",
    ready: true,
  },
  {
    href: "/fees/admin-tools",
    label: m.navFeeAdminTools,
    icon: Timer,
    permission: "fees:manage",
    ready: true,
  },
  // Last on purpose: it is the screen you visit when something did not happen,
  // not one anybody opens daily. Only admin holds `jobs:view`, so for every
  // other role this changes nothing about the bar.
  {
    href: "/jobs",
    label: m.jobsTitle,
    icon: Timer,
    permission: "jobs:view",
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
  // Your own settings. Not a tab for the same reason the calendar is not: it
  // is somewhere you go twice a year, and it is reached from the More hub and
  // from the sign-out corner of the top bar rather than from the thumb bar.
  "/preferences",
  // The fee desk's front door: somewhere you are sent, like `/access-denied`.
  // It resolves the role to its right fee screen and redirects. The fee tabs a
  // person actually navigates to — the Payment Desk, Transactions, Students —
  // are `NAV_ITEMS` entries in the `money` group.
  "/fees",
] as const;

/* ------------------------------------------------- where each role starts */

/**
 * One Home per role (PLAN §3), also used by the school-name link.
 *
 * A teacher's home is her day, not a profile card. Before this she signed in,
 * landed on `/dashboard`, read her own email address back to herself and then
 * tapped a second time to reach the register she came to take — which is the
 * whole of B-03, and is two taps where PLAN §1 asks for none.
 *
 * Everybody else lands on `/dashboard`, which R2.2 turns into their queue.
 * A teacher may still open it; it is simply not where she starts.
 */
export function homeFor(role: StaffRole): string {
  if (role === "teacher") return "/teach";
  /*
   * The fee desk opens on the fee desk.
   *
   * The Payment Desk for an accountant, the follow-up list for a fee
   * collector — the fee app's own rule, and the whole point of the port:
   * somebody who collects money signs in and is already there.
   * `/dashboard` for them is an attention queue about registers and cover,
   * which is nobody's work at the fee counter.
   *
   * The concrete screen rather than `/fees`, which would also work — it
   * redirects by role. But a home has to be somewhere the person can
   * demonstrably open, and `navigation.test.ts` checks exactly that by
   * looking the href up in `NAV_ITEMS`. A redirector is not in that list,
   * so landing on one would make the check unanswerable rather than true.
   */
  if (role === "accountant") return "/fees/payments";
  if (role === "fee_collector") return "/fees/defaulters";
  return "/dashboard";
}

/* --------------------------------------------------- what the bar leads with */

/**
 * The order each role's bar is built in, most-used first.
 *
 * **Not one shared order any more**, which is what B-04 was: every role got
 * Home, Teach, Cover, Timetable, Exams, so the office — who opens SamPark and
 * School Fees several times a day and a timetable a few times a term — reached
 * its daily work through More, behind three screens it does not use.
 *
 * These follow PLAN §3's navigation column. Where a screen it names does not
 * exist yet (Students is R2.3, a teacher's Requests inbox is R3.3) the row is
 * simply shorter; nothing is invented to fill a gap. Anything not listed is
 * still reachable — it falls to More, and the desktop sidebar shows all of it.
 */
const NAV_PRIORITY: Record<StaffRole, readonly string[]> = {
  // "Home, Students, SamPark, Apps, More" — Students arrives in R2.3.
  admin: ["/dashboard", "/students", "/collection", "/apps"],
  office: ["/dashboard", "/students", "/collection", "/apps"],
  // The fee desk. These are the routes that exist today; the fee screens
  // themselves arrive with their own tabs and take the lead here then.
  // The fee desk, in the fee app's own order: collect first.
  accountant: ["/fees/payments", "/fees/transactions", "/fees/defaulters", "/fees/students"],
  fee_collector: ["/fees/defaulters", "/fees/students", "/fees/transactions"],
  // "Today, My classes, Timetable, Requests, More".
  teacher: ["/teach", "/timetable", "/substitutions", "/assessments"],
  // "Home, Cover, Timetable, Classes, More".
  academic_coordinator: ["/dashboard", "/substitutions", "/timetable", "/academics"],
  // "Home, Exams, Marks, Reports, More" — marks and reports have no index
  // route of their own yet, so Exams carries both.
  exam_coordinator: ["/dashboard", "/assessments", "/timetable", "/staff"],
  // "Home, Timetable, Summary" — and the summary is Home until R2.2.
  view_only: ["/dashboard", "/timetable"],
};

/**
 * The icon for a destination, looked up by href.
 *
 * **The nav bars call this themselves rather than being handed icons.**
 * A `LucideIcon` is a forwardRef object, and neither it nor an element built
 * from it survives the trip from a Server Component to a Client Component in
 * a production build — the layout renders its error boundary instead, and
 * only in production, which is a bad afternoon to have twice.
 *
 * This module is pure — messages and the permission map, no database, no
 * request — so a Client Component can import it directly and the icons are
 * a client import like any other. The server sends hrefs and labels; the
 * pictures are already on the other side.
 */
export function navIconFor(href: string): LucideIcon | null {
  if (href === MORE_ITEM.href) return MORE_ITEM.icon;
  return NAV_ITEMS.find((item) => item.href === href)?.icon ?? null;
}

/** Everything this role may open, before the bar decides what fits. */
export function allowedFor(role: StaffRole): NavItem[] {
  const allowed = NAV_ITEMS.filter(
    (item) => item.ready && can({ role }, item.permission),
  );

  const rank = new Map(NAV_PRIORITY[role].map((href, index) => [href, index]));

  // Priority first, then everything else in declaration order. A stable sort,
  // so a screen the role's row does not mention keeps its place relative to
  // its neighbours rather than jumping about when another is added.
  return [...allowed].sort(
    (a, b) =>
      (rank.get(a.href) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.href) ?? Number.MAX_SAFE_INTEGER),
  );
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

/* --------------------------------------------------- the desktop sidebar */

export type NavGroup = { title: Localized; items: NavItem[] };

/**
 * Which group a screen belongs to on a wide window.
 *
 * PLAN §3: "Desktop gets grouped sidebar navigation ... rather than the
 * phone's first-four-items-plus-More limit." A 1440px window has room for
 * every screen a role may open, and hiding four of them behind a More page
 * built for a thumb is the phone's constraint leaking onto a desk.
 *
 * Three groups, in the order a day runs: what you do today, the records you
 * look things up in, and the settings you touch a few times a term.
 */
const GROUP_OF: Record<string, "daily" | "money" | "records" | "setup"> = {
  "/dashboard": "daily",
  "/students": "daily",
  "/teach": "daily",
  "/substitutions": "daily",
  "/collection": "daily",
  // The fee desk. Its own group rather than folded into "daily", because
  // for an accountant these ARE the day and for a teacher they are not
  // there at all — and an admin, who sees both, should be able to tell at
  // a glance which half of the school a link belongs to.
  "/fees/payments": "money",
  "/fees/transactions": "money",
  "/fees/defaulters": "money",
  "/fees/students": "money",
  "/fees/reminders": "money",
  "/fees/fee-setup": "money",
  "/fees/exports": "money",
  "/fees/admin-tools": "money",
  "/timetable": "records",
  "/assessments": "records",
  "/apps": "records",
  "/academics": "setup",
  "/staff": "setup",
  "/jobs": "setup",
};

const GROUP_TITLES = {
  daily: m.navGroupToday,
  money: m.navGroupMoney,
  records: m.navGroupRecords,
  setup: m.navGroupSetup,
} as const;

/**
 * The sidebar, grouped, with everything the role may open.
 *
 * No More entry: nothing is hidden here, so a hub listing "what did not fit"
 * would be an empty page. An empty group is dropped rather than rendered as a
 * heading with nothing under it.
 */
export function sidebarFor(role: StaffRole): NavGroup[] {
  const allowed = allowedFor(role);

  // Every group, in the order a day runs. This list and `GROUP_OF` have to
  // agree: a group named there and missing here drops its items silently,
  // and the sidebar has no More hub to catch them — which is what happened
  // to the eight fee screens the moment "money" was added to one and not
  // the other. `tests/navigation.test.ts` asserts the sidebar holds
  // everything the role may open, which is what said so.
  return (["daily", "money", "records", "setup"] as const)
    .map((group) => ({
      title: GROUP_TITLES[group],
      items: allowed.filter((item) => (GROUP_OF[item.href] ?? "setup") === group),
    }))
    .filter((group) => group.items.length > 0);
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
