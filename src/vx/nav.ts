import type { StaffPermission, StaffRole } from "@/platform/auth/permissions";
import type { IconName } from "@/vx/icons";
import type { Pair } from "@/vx/text";

/**
 * One nav config drives everything (PLAN A.5): the desktop sidebar, the phone
 * bottom bar, the phone Menu page, the search palette and the role homes.
 * Items, labels, Hindi sub-labels and order are copied from the design's
 * `XSide.dc.html` and `XNav.dc.html`.
 *
 * Every item names the permission that shows it, so the nav can never offer
 * a screen the page guard would refuse.
 */

export type DesignMenu = "admin" | "teacher" | "accountant" | "academic" | "exam";

export type NavEntry = {
  key: string;
  label: Pair;
  icon: IconName;
  href: string;
  permission: StaffPermission;
  /** A count shown as a red badge, looked up by this key. */
  badge?: BadgeKey;
};

export type NavGroup = { title?: Pair; items: NavEntry[] };

export type BadgeKey = "inbox" | "notes" | "dues" | "books" | "marks" | "news";

/** Eight app roles onto the design's five menus (docs/ui/DECISIONS.md UI-7). */
export function designMenuFor(role: StaffRole): DesignMenu {
  switch (role) {
    case "teacher":
      return "teacher";
    case "accountant":
    case "fee_collector":
      return "accountant";
    case "academic_coordinator":
      return "academic";
    case "exam_coordinator":
      return "exam";
    default:
      return "admin";
  }
}

const L = (en: string, hi?: string): Pair => (hi ? { en, hi } : { en });

const MENUS: Record<DesignMenu, NavGroup[]> = {
  admin: [
    {
      items: [
        { key: "today", label: L("Today", "आज"), icon: "home", href: "/", permission: "dashboard:view" },
        { key: "inbox", label: L("Needs you", "आपके लिए"), icon: "inbox", href: "/inbox", permission: "attendance:correct", badge: "inbox" },
        { key: "students", label: L("Students", "विद्यार्थी"), icon: "users", href: "/students", permission: "students:view" },
        { key: "attendance", label: L("Attendance", "हाज़िरी"), icon: "calCheck", href: "/attendance", permission: "attendance:mark_on_behalf" },
      ],
    },
    {
      title: L("Money", "फीस"),
      items: [
        { key: "paydesk", label: L("Payment Desk", "फीस जमा"), icon: "rupee", href: "/payments", permission: "fees:collect" },
        { key: "fees", label: L("Receipts & day close", "रसीदें"), icon: "receipt", href: "/receipts", permission: "fees:view" },
        { key: "dues", label: L("Dues & calls", "बकाया"), icon: "phone", href: "/dues", permission: "fees:view" },
        { key: "reminders", label: L("Fee reminders", "फीस रिमाइंडर"), icon: "bell", href: "/reminders", permission: "fees:view" },
        { key: "feesetup", label: L("Fee setup", "फीस ढाँचा"), icon: "sliders", href: "/fee-setup", permission: "fees:view" },
        { key: "reports", label: L("Reports", "रिपोर्ट"), icon: "chart", href: "/reports", permission: "fees:view" },
      ],
    },
    {
      title: L("Academics", "पढ़ाई"),
      items: [
        { key: "exams", label: L("Exams & marks", "परीक्षा व अंक"), icon: "clipboard", href: "/exams", permission: "assessments:view" },
        { key: "timetable", label: L("Timetable", "समय सारणी"), icon: "clock", href: "/timetable", permission: "timetable:view" },
        { key: "calendar", label: L("Calendar", "कैलेंडर"), icon: "calendar", href: "/calendar", permission: "academics:view" },
        { key: "notes", label: L("Notes on children", "बच्चों के नोट्स"), icon: "note", href: "/notes", permission: "notes:view", badge: "notes" },
      ],
    },
    {
      title: L("People", "लोग"),
      items: [
        { key: "admissions", label: L("Admissions", "दाख़िले"), icon: "userPlus", href: "/admissions", permission: "fees:manage" },
        { key: "studenttools", label: L("Promote & import", "प्रमोशन व इम्पोर्ट"), icon: "upload", href: "/student-tools", permission: "fees:manage" },
        { key: "staff", label: L("Staff & roles", "स्टाफ़"), icon: "shield", href: "/staff", permission: "staff:view" },
      ],
    },
    {
      title: L("System", "सिस्टम"),
      items: [
        { key: "messages", label: L("Messages", "संदेश"), icon: "megaphone", href: "/messages", permission: "messages:send" },
        { key: "settings", label: L("Settings", "सेटिंग्स"), icon: "settings", href: "/settings", permission: "settings:manage" },
      ],
    },
  ],
  teacher: [
    {
      items: [
        { key: "home", label: L("Today", "आज"), icon: "home", href: "/teach", permission: "attendance:view" },
        { key: "attendance", label: L("Attendance", "हाज़िरी"), icon: "calCheck", href: "/teach/attendance", permission: "attendance:mark" },
        { key: "class", label: L("My class & subjects", "मेरी कक्षा"), icon: "users", href: "/teach/class", permission: "attendance:view" },
        { key: "marks", label: L("Marks", "अंक"), icon: "clipboard", href: "/teach/marks", permission: "marks:write" },
        { key: "notes", label: L("Notes on children", "बच्चों के नोट्स"), icon: "note", href: "/teach/notes", permission: "notes:write", badge: "notes" },
        { key: "more", label: L("Notices, links & leave", "सूचना व लिंक"), icon: "megaphone", href: "/teach/more", permission: "attendance:view", badge: "news" },
      ],
    },
  ],
  accountant: [
    {
      items: [
        { key: "home", label: L("Today", "आज"), icon: "home", href: "/accounts", permission: "fees:view" },
        { key: "collect", label: L("Payment Desk", "फीस जमा"), icon: "rupee", href: "/payments", permission: "fees:collect" },
        { key: "fees", label: L("Receipts & day close", "रसीदें"), icon: "receipt", href: "/receipts", permission: "fees:view" },
        { key: "dues", label: L("Dues & calls", "बकाया"), icon: "phone", href: "/dues", permission: "fees:view", badge: "dues" },
        { key: "reminders", label: L("Fee reminders", "फीस रिमाइंडर"), icon: "bell", href: "/reminders", permission: "fees:view" },
        { key: "books", label: L("Cheques, UPI & refunds", "चेक व यूपीआई"), icon: "swap", href: "/accounts/books", permission: "fees:view", badge: "books" },
        { key: "reports", label: L("Reports", "रिपोर्ट"), icon: "chart", href: "/reports", permission: "fees:view" },
        { key: "feesetup", label: L("Fee setup (view)", "फीस ढाँचा"), icon: "sliders", href: "/fee-setup", permission: "fees:view" },
      ],
    },
  ],
  academic: [
    {
      items: [
        { key: "home", label: L("Today", "आज"), icon: "home", href: "/academics", permission: "dashboard:view" },
        { key: "progress", label: L("Student progress", "प्रगति"), icon: "trend", href: "/academics/progress", permission: "marks:view" },
        { key: "attendance", label: L("Attendance", "हाज़िरी"), icon: "calCheck", href: "/academics/attendance", permission: "attendance:view" },
        { key: "notes", label: L("Notes on children", "बच्चों के नोट्स"), icon: "note", href: "/notes", permission: "notes:view", badge: "notes" },
        { key: "exams", label: L("Marks & results", "अंक व परिणाम"), icon: "clipboard", href: "/exams", permission: "assessments:view" },
        { key: "timetable", label: L("Timetable", "समय सारणी"), icon: "clock", href: "/timetable", permission: "timetable:view" },
        { key: "calendar", label: L("Calendar", "कैलेंडर"), icon: "calendar", href: "/calendar", permission: "academics:view" },
      ],
    },
  ],
  exam: [
    {
      items: [
        { key: "home", label: L("Today", "आज"), icon: "home", href: "/exam-office", permission: "assessments:manage" },
        { key: "plan", label: L("Date sheet & seating", "डेटशीट व बैठक"), icon: "calendar", href: "/exam-office/plan", permission: "assessments:manage" },
        { key: "exams", label: L("Marks tracker", "अंक ट्रैकर"), icon: "clipboard", href: "/exams", permission: "assessments:view", badge: "marks" },
        { key: "results", label: L("Results & report cards", "परिणाम"), icon: "award", href: "/exam-office/results", permission: "assessments:manage" },
        { key: "calendar", label: L("Calendar", "कैलेंडर"), icon: "calendar", href: "/calendar", permission: "academics:view" },
        { key: "messages", label: L("Notices", "सूचनाएँ"), icon: "megaphone", href: "/messages", permission: "messages:send" },
      ],
    },
  ],
};

/** The phone bottom bar: four tabs and a centre action, per menu (XNav). */
const BOTTOM: Record<DesignMenu, { tabs: [string, string, string, string]; center: { label: Pair; icon: IconName; href: string; permission: StaffPermission } }> = {
  admin: { tabs: ["today", "students", "inbox", "menu"], center: { label: L("Quick actions", "जल्दी करें"), icon: "plus", href: "#quick", permission: "dashboard:view" } },
  teacher: { tabs: ["home", "class", "notes", "more"], center: { label: L("Mark attendance", "हाज़िरी लगाएँ"), icon: "calCheck", href: "/teach/attendance", permission: "attendance:mark" } },
  accountant: { tabs: ["home", "fees", "dues", "menu"], center: { label: L("Payment Desk", "फीस जमा"), icon: "rupee", href: "/payments", permission: "fees:collect" } },
  academic: { tabs: ["home", "progress", "notes", "menu"], center: { label: L("Attendance", "हाज़िरी"), icon: "calCheck", href: "/academics/attendance", permission: "attendance:view" } },
  exam: { tabs: ["home", "plan", "results", "menu"], center: { label: L("Marks tracker", "अंक ट्रैकर"), icon: "clipboard", href: "/exams", permission: "assessments:view" } },
};

/**
 * The admin's centre "+" sheet (F03), each with the permission its screen is
 * guarded on. The office and view-only readers share the admin menu, and
 * before these were filtered they were offered actions that end on
 * "access denied" (smoke test, 10 Oct 2026).
 */
export const QUICK_ACTIONS: readonly { key: string; label: Pair; sub: Pair; icon: IconName; tone: "pri" | "acc" | "info" | "ok" | "warn" | "plain"; href: string; permission: StaffPermission }[] = [
  { key: "collect", label: L("Collect fee", "फीस जमा"), sub: L("Opens the Payment Desk", "पेमेंट डेस्क खुलेगा"), icon: "rupee", tone: "pri", href: "/payments", permission: "fees:collect" },
  { key: "mark", label: L("Mark attendance", "हाज़िरी"), sub: L("Any class, today", "कोई भी कक्षा, आज"), icon: "calCheck", tone: "acc", href: "/attendance", permission: "attendance:mark_on_behalf" },
  { key: "notice", label: L("Send notice", "सूचना भेजें"), sub: L("WhatsApp to parents or staff", "अभिभावकों या स्टाफ़ को"), icon: "megaphone", tone: "info", href: "/messages?compose=1", permission: "messages:send" },
  { key: "admit", label: L("Add student", "नया विद्यार्थी"), sub: L("New admission", "नया प्रवेश"), icon: "userPlus", tone: "ok", href: "/admissions/new", permission: "fees:manage" },
  { key: "cover", label: L("Assign substitute", "सब्स्टिट्यूट"), sub: L("Cover an absent teacher", "अनुपस्थित शिक्षक की जगह"), icon: "swap", tone: "warn", href: "/timetable?view=subs", permission: "substitutions:manage" },
  { key: "note", label: L("Add a note", "नोट लिखें"), sub: L("About a child", "किसी बच्चे के बारे में"), icon: "edit", tone: "plain", href: "/notes?add=1", permission: "notes:view" },
];

/** The quick actions this reader may open (the centre "+" sheet and the desktop "New" menu). */
export function quickActionsFor(allowed: (p: StaffPermission) => boolean): string[] {
  return QUICK_ACTIONS.filter((q) => allowed(q.permission)).map((q) => q.key);
}

/** Short labels the bottom bar uses where the sidebar label is long. */
const SHORT: Partial<Record<string, Pair>> = {
  "teacher:class": L("Class", "कक्षा"),
  "teacher:notes": L("Notes", "नोट्स"),
  "teacher:more": L("More", "और"),
  "accountant:fees": L("Receipts", "रसीदें"),
  "accountant:dues": L("Dues", "बकाया"),
  "academic:progress": L("Progress", "प्रगति"),
  "academic:notes": L("Notes", "नोट्स"),
  "exam:plan": L("Plan", "योजना"),
  "exam:results": L("Results", "परिणाम"),
};

/** Icons the bottom bar draws differently from the sidebar (XNav: the teacher's More is a grid). */
const SHORT_ICON: Partial<Record<string, IconName>> = {
  "teacher:more": "grid",
};

/** "See the app as" names, as the design's sidebar lists them (XSide). */
export const PREVIEW_LABEL: Record<Exclude<DesignMenu, "admin">, Pair> = {
  teacher: L("Teacher", "अध्यापक"),
  accountant: L("Accountant", "लेखाकार"),
  academic: L("Academic coordinator", "शैक्षणिक समन्वयक"),
  exam: L("Exam coordinator", "परीक्षा प्रभारी"),
};

export const MENU_HOME: Record<DesignMenu, string> = {
  admin: "/",
  teacher: "/teach",
  accountant: "/accounts",
  academic: "/academics",
  exam: "/exam-office",
};

export const MENU_LABEL: Record<DesignMenu, Pair> = {
  admin: L("Admin", "प्रशासक"),
  teacher: L("Teacher", "अध्यापक"),
  accountant: L("Accounts", "लेखा"),
  academic: L("Academics", "शैक्षणिक"),
  exam: L("Exams", "परीक्षा"),
};

export function groupsFor(menu: DesignMenu, allowed: (p: StaffPermission) => boolean): NavGroup[] {
  return MENUS[menu]
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.permission)) }))
    .filter((g) => g.items.length > 0);
}

export type BottomTab = { key: string; label: Pair; icon: IconName; href: string; badge?: BadgeKey; center?: boolean; quick?: string[] };

export function bottomFor(menu: DesignMenu, allowed: (p: StaffPermission) => boolean): BottomTab[] {
  const all = MENUS[menu].flatMap((g) => g.items);
  const spec = BOTTOM[menu];
  const tab = (key: string): BottomTab | null => {
    if (key === "menu") return { key: "menu", label: L("Menu", "मेनू"), icon: "grid", href: "/menu" };
    const item = all.find((i) => i.key === key);
    if (!item || !allowed(item.permission)) return null;
    return { key, label: SHORT[`${menu}:${key}`] ?? item.label, icon: SHORT_ICON[`${menu}:${key}`] ?? item.icon, href: item.href, badge: item.badge };
  };
  const [a, b, c, d] = spec.tabs.map(tab);
  const quick = spec.center.href === "#quick" ? quickActionsFor(allowed) : undefined;
  const center: BottomTab | null =
    allowed(spec.center.permission) && (quick === undefined || quick.length > 0)
      ? { key: "center", label: spec.center.label, icon: spec.center.icon, href: spec.center.href, center: true, quick }
      : null;
  return [a, b, center, c, d].filter((x): x is BottomTab => Boolean(x));
}

/** Which nav key is active for a path: the longest matching href wins. */
export function activeKey(groups: NavGroup[], pathname: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    const h = item.href;
    const match = h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(`${h}/`);
    if (match && (!best || h.length > best.len)) best = { key: item.key, len: h.length };
  }
  return best?.key ?? null;
}

/** Routes the design names but which are reached from within a module rather than the nav. */
export const ROLE_PREVIEW_MENUS: DesignMenu[] = ["teacher", "accountant", "academic", "exam"];

/** Every href any role's menu names, plus the phone Menu page. */
export const VX_HREFS: readonly string[] = [
  ...new Set([...Object.values(MENUS).flatMap((g) => g.flatMap((x) => x.items.map((i) => i.href))), "/menu"]),
];

/** Where a role lands (PLAN P2): admin → `/`, teacher → `/teach`, accountant → `/accounts`, … */
export function homeForRole(role: StaffRole): string {
  return MENU_HOME[designMenuFor(role)];
}
