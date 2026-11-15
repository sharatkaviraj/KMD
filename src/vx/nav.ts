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

export type BadgeKey = "inbox" | "needs" | "notes" | "dues" | "books" | "marks" | "news" | "chats";

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

/** Parents' WhatsApp messages (D-616): in every menu of someone who answers parents. One object, so the shell carries its words once. */
const CHATS: NavEntry = { key: "chats", label: L("Chats with parents", "अभिभावकों से चैट"), icon: "message", href: "/chats", permission: "chats:reply", badge: "chats" };

const MENUS: Record<DesignMenu, NavGroup[]> = {
  admin: [
    {
      items: [
        { key: "today", label: L("Today", "आज"), icon: "home", href: "/", permission: "dashboard:view" },
        { key: "inbox", label: L("Needs you", "आपके लिए"), icon: "inbox", href: "/inbox", permission: "attendance:correct", badge: "inbox" },
        CHATS,
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
        // Razorpay money: the fees app's /protected/payments/online (go-live Phase E).
        { key: "online", label: L("Online payments", "ऑनलाइन भुगतान"), icon: "globe", href: "/fees/payments/online", permission: "fees:accounts" },
        { key: "feesetup", label: L("Fee setup", "फीस ढाँचा"), icon: "sliders", href: "/fee-setup", permission: "fees:view" },
        { key: "reports", label: L("Reports", "रिपोर्ट"), icon: "chart", href: "/reports", permission: "fees:reports" },
        // The whole year in one file for ChatGPT (7 Nov 2026); admin's alone until Staff → Roles gives it.
        { key: "aireport", label: L("AI report", "AI रिपोर्ट"), icon: "database", href: "/reports/ai", permission: "reports:ai" },
      ],
    },
    {
      title: L("Academics", "पढ़ाई"),
      items: [
        { key: "exams", label: L("Exams & marks", "परीक्षा व अंक"), icon: "clipboard", href: "/exams", permission: "assessments:view" },
        { key: "board", label: L("Board readiness", "बोर्ड की तैयारी"), icon: "clipboard", href: "/exam-office/board", permission: "outcomes:view" },
        { key: "officialresults", label: L("Official results", "आधिकारिक परिणाम"), icon: "award", href: "/exam-office/official-results", permission: "outcomes:view" },
        { key: "timetable", label: L("Timetable", "समय सारणी"), icon: "clock", href: "/timetable", permission: "timetable:view" },
        { key: "calendar", label: L("Calendar", "कैलेंडर"), icon: "calendar", href: "/calendar", permission: "academics:view" },
        { key: "notes", label: L("Notes on children", "बच्चों के नोट्स"), icon: "note", href: "/notes", permission: "notes:view", badge: "notes" },
      ],
    },
    {
      title: L("People", "लोग"),
      items: [
        { key: "admissions", label: L("Admissions", "दाख़िले"), icon: "userPlus", href: "/admissions", permission: "fees:manage" },
        { key: "schooloffice", label: L("School Office", "विद्यालय कार्यालय"), icon: "fileText", href: "/school-office", permission: "certificates:view" },
        // Brothers and sisters with their fees together (owner, 8 Nov 2026).
        { key: "families", label: L("Families", "परिवार"), icon: "home", href: "/families", permission: "fees:view" },
        { key: "studenttools", label: L("Promote & import", "प्रमोशन व इम्पोर्ट"), icon: "upload", href: "/student-tools", permission: "fees:manage" },
        // Children on each bus route, the bus times and the drivers (D-550).
        { key: "transport", label: L("Transport", "परिवहन"), icon: "bus", href: "/transport", permission: "transport:view" },
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
        // Needs you (D-630): what is waiting on this person, in order. Second in every list; the phone bar is unchanged.
        { key: "needs", label: L("Needs you", "आपके लिए"), icon: "ticks", href: "/needs", permission: "dashboard:view", badge: "needs" },
        { key: "attendance", label: L("Attendance", "हाज़िरी"), icon: "calCheck", href: "/teach/attendance", permission: "attendance:mark" },
        { key: "class", label: L("My class & subjects", "मेरी कक्षा"), icon: "users", href: "/teach/class", permission: "attendance:view" },
        { key: "marks", label: L("Marks", "अंक"), icon: "clipboard", href: "/teach/marks", permission: "marks:write" },
        { key: "notes", label: L("Notes on children", "बच्चों के नोट्स"), icon: "note", href: "/teach/notes", permission: "notes:write", badge: "notes" },
        // Parents' WhatsApp messages for the teacher's class (D-616); on the phone it is
        // a tile on More and the "parents waiting" card, not a bar tab.
        CHATS,
        // Timetable, My tasks, Help and My profile were reachable on a desk
        // only through the More page (teacher day, 6 Nov 2026, teacher 20).
        // The phone bar picks its tabs by key, so it is unchanged.
        { key: "timetable", label: L("My timetable", "मेरी समय-सारणी"), icon: "clock", href: "/teach/more?view=timetable", permission: "attendance:view" },
        { key: "tasks", label: L("My tasks", "मेरे काम"), icon: "inbox", href: "/teach/tasks", permission: "attendance:view" },
        { key: "more", label: L("Notices, links & leave", "सूचना व लिंक"), icon: "megaphone", href: "/teach/more", permission: "attendance:view", badge: "news" },
        { key: "help", label: L("Help", "मदद"), icon: "help", href: "/teach/more?view=help", permission: "attendance:view" },
        { key: "profile", label: L("My profile", "मेरी प्रोफ़ाइल"), icon: "user", href: "/teach/more?view=profile", permission: "attendance:view" },
      ],
    },
  ],
  accountant: [
    {
      items: [
        { key: "home", label: L("Today", "आज"), icon: "home", href: "/accounts", permission: "fees:view" },
        // Needs you (D-630): what is waiting on this person, in order. Second in every list; the phone bar is unchanged.
        { key: "needs", label: L("Needs you", "आपके लिए"), icon: "ticks", href: "/needs", permission: "dashboard:view", badge: "needs" },
        { key: "collect", label: L("Payment Desk", "फीस जमा"), icon: "rupee", href: "/payments", permission: "fees:collect" },
        { key: "fees", label: L("Receipts & day close", "रसीदें"), icon: "receipt", href: "/receipts", permission: "fees:view" },
        { key: "dues", label: L("Dues & calls", "बकाया"), icon: "phone", href: "/dues", permission: "fees:view", badge: "dues" },
        CHATS,
        { key: "families", label: L("Families", "परिवार"), icon: "home", href: "/families", permission: "fees:view" },
        { key: "reminders", label: L("Fee reminders", "फीस रिमाइंडर"), icon: "bell", href: "/reminders", permission: "fees:view" },
        { key: "books", label: L("Cheques, UPI & refunds", "चेक व यूपीआई"), icon: "swap", href: "/accounts/books", permission: "fees:view", badge: "books" },
        { key: "online", label: L("Online payments", "ऑनलाइन भुगतान"), icon: "globe", href: "/fees/payments/online", permission: "fees:accounts" },
        { key: "reports", label: L("Reports", "रिपोर्ट"), icon: "chart", href: "/reports", permission: "fees:reports" },
        { key: "aireport", label: L("AI report", "AI रिपोर्ट"), icon: "database", href: "/reports/ai", permission: "reports:ai" },
        { key: "feesetup", label: L("Fee setup (view)", "फीस ढाँचा"), icon: "sliders", href: "/fee-setup", permission: "fees:view" },
      ],
    },
  ],
  academic: [
    {
      items: [
        { key: "home", label: L("Today", "आज"), icon: "home", href: "/academics", permission: "dashboard:view" },
        // Cover is this role's core morning job and was reachable only through
        // a Timetable tab (day-run 6 Nov 2026, AC-02).
        { key: "cover", label: L("Cover for absent teachers", "अनुपस्थित की व्यवस्था"), icon: "swap", href: "/timetable?view=subs", permission: "substitutions:manage" },
        { key: "inbox", label: L("Needs you", "आपके लिए"), icon: "inbox", href: "/inbox", permission: "attendance:correct", badge: "inbox" },
        CHATS,
        { key: "progress", label: L("Student progress", "प्रगति"), icon: "trend", href: "/academics/progress", permission: "marks:view" },
        { key: "attendance", label: L("Attendance", "हाज़िरी"), icon: "calCheck", href: "/academics/attendance", permission: "attendance:view" },
        { key: "notes", label: L("Notes on children", "बच्चों के नोट्स"), icon: "note", href: "/notes", permission: "notes:view", badge: "notes" },
        { key: "exams", label: L("Marks & results", "अंक व परिणाम"), icon: "clipboard", href: "/exams", permission: "assessments:view" },
        { key: "timetable", label: L("Timetable", "समय सारणी"), icon: "clock", href: "/timetable", permission: "timetable:view" },
        { key: "calendar", label: L("Calendar", "कैलेंडर"), icon: "calendar", href: "/calendar", permission: "academics:view" },
        { key: "messages", label: L("Notices", "सूचनाएँ"), icon: "megaphone", href: "/messages", permission: "messages:send" },
        { key: "aireport", label: L("AI report", "AI रिपोर्ट"), icon: "database", href: "/reports/ai", permission: "reports:ai" },
      ],
    },
  ],
  exam: [
    {
      items: [
        { key: "home", label: L("Today", "आज"), icon: "home", href: "/exam-office", permission: "assessments:manage" },
        // Needs you (D-630): what is waiting on this person, in order. Second in every list; the phone bar is unchanged.
        { key: "needs", label: L("Needs you", "आपके लिए"), icon: "ticks", href: "/needs", permission: "dashboard:view", badge: "needs" },
        { key: "plan", label: L("Date sheet & seating", "डेटशीट व बैठक"), icon: "calendar", href: "/exam-office/plan", permission: "assessments:manage" },
        { key: "exams", label: L("Marks tracker", "अंक ट्रैकर"), icon: "clipboard", href: "/exams", permission: "assessments:view", badge: "marks" },
        { key: "results", label: L("Results & report cards", "परिणाम"), icon: "award", href: "/exam-office/results", permission: "assessments:manage" },
        { key: "board", label: L("Board readiness", "बोर्ड की तैयारी"), icon: "clipboard", href: "/exam-office/board", permission: "outcomes:view" },
        { key: "officialresults", label: L("Official results", "आधिकारिक परिणाम"), icon: "award", href: "/exam-office/official-results", permission: "outcomes:view" },
        { key: "calendar", label: L("Calendar", "कैलेंडर"), icon: "calendar", href: "/calendar", permission: "academics:view" },
        CHATS,
        { key: "messages", label: L("Notices", "सूचनाएँ"), icon: "megaphone", href: "/messages", permission: "messages:send" },
        { key: "aireport", label: L("AI report", "AI रिपोर्ट"), icon: "database", href: "/reports/ai", permission: "reports:ai" },
      ],
    },
  ],
};

/**
 * The phone bottom bar: four tabs and the "+" in the middle, per menu (XNav).
 *
 * The middle is a "+" for every role (D-643, the owner, 15 Nov 2026): it
 * opens the person's own quick actions (`src/vx/quick.ts`), the teacher's
 * register first. `own` are the screens the middle button used to open
 * itself: on them no tab is lit, the "+" being their mark, as before.
 */
const BOTTOM: Record<DesignMenu, { tabs: [string, string, string, string]; own: string[] }> = {
  admin: { tabs: ["today", "students", "inbox", "menu"], own: [] },
  teacher: { tabs: ["home", "class", "notes", "more"], own: ["/teach/attendance"] },
  accountant: { tabs: ["home", "fees", "dues", "menu"], own: ["/payments"] },
  academic: { tabs: ["home", "progress", "notes", "menu"], own: ["/academics/attendance"] },
  exam: { tabs: ["home", "plan", "results", "menu"], own: ["/exams"] },
};

/** The "+" itself: what it is called, and the word printed under it. */
const QUICK_CENTER = {
  label: L("Quick actions", "झटपट काम"),
  short: L("Quick", "झटपट"),
  icon: "plus",
  href: "#quick",
} as const satisfies { label: Pair; short: Pair; icon: IconName; href: string };

/**
 * The admin's desk "+ New" menu (F03) on Today and Students, each with the
 * permission its screen is guarded on. The phone's "+" has its own, richer
 * lists per role (`src/vx/quick.ts`, D-643). The office and view-only readers share the admin menu, and
 * before these were filtered they were offered actions that end on
 * "access denied" (smoke test, 10 Oct 2026).
 */
export const QUICK_ACTIONS: readonly { key: string; label: Pair; sub: Pair; icon: IconName; tone: "pri" | "acc" | "info" | "ok" | "warn" | "plain"; href: string; permission: StaffPermission }[] = [
  { key: "certificate", label: L("Study certificate", "अध्ययन प्रमाण पत्र"), sub: L("Find a student; details fill automatically", "विद्यार्थी चुनें; जानकारी अपने आप भरेगी"), icon: "fileText", tone: "info", href: "/students", permission: "certificates:issue" },
  { key: "collect", label: L("Collect fee", "फीस जमा"), sub: L("Opens the Payment Desk", "पेमेंट डेस्क खुलेगा"), icon: "rupee", tone: "pri", href: "/payments", permission: "fees:collect" },
  { key: "mark", label: L("Mark attendance", "हाज़िरी"), sub: L("Any class, today", "कोई भी कक्षा, आज"), icon: "calCheck", tone: "acc", href: "/attendance", permission: "attendance:mark_on_behalf" },
  { key: "notice", label: L("Send notice", "सूचना भेजें"), sub: L("WhatsApp to parents or staff", "अभिभावकों या स्टाफ़ को"), icon: "megaphone", tone: "info", href: "/messages?compose=1", permission: "messages:send" },
  { key: "admit", label: L("Add student", "नया विद्यार्थी"), sub: L("New admission", "नया प्रवेश"), icon: "userPlus", tone: "ok", href: "/admissions/new", permission: "fees:manage" },
  { key: "cover", label: L("Assign substitute", "सब्स्टिट्यूट"), sub: L("Cover an absent teacher", "अनुपस्थित शिक्षक की जगह"), icon: "swap", tone: "warn", href: "/substitutions/arrange", permission: "substitutions:manage" },
  { key: "note", label: L("Add a note", "नोट लिखें"), sub: L("About a child", "किसी बच्चे के बारे में"), icon: "edit", tone: "plain", href: "/notes?add=1", permission: "notes:view" },
];

/** The desk "New" menu's actions this reader may open. */
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

export type BottomTab = {
  key: string;
  label: Pair;
  icon: IconName;
  href: string;
  badge?: BadgeKey;
  center?: boolean;
  short?: Pair;
  /** The "+": screens it stands for, where no tab is lit. */
  own?: string[];
};

/**
 * The bar for a menu: two tabs, the "+", two tabs. `quick: false` leaves the
 * "+" out for a reader it would hold nothing for (view only), as an empty
 * sheet would be a button that leads nowhere.
 */
export function bottomFor(menu: DesignMenu, allowed: (p: StaffPermission) => boolean, opts: { quick?: boolean } = {}): BottomTab[] {
  const all = MENUS[menu].flatMap((g) => g.items);
  const spec = BOTTOM[menu];
  const tab = (key: string): BottomTab | null => {
    if (key === "menu") return { key: "menu", label: L("Menu", "मेनू"), icon: "grid", href: "/menu" };
    const item = all.find((i) => i.key === key);
    if (!item || !allowed(item.permission)) return null;
    return { key, label: SHORT[`${menu}:${key}`] ?? item.label, icon: SHORT_ICON[`${menu}:${key}`] ?? item.icon, href: item.href, badge: item.badge };
  };
  const [a, b, c, d] = spec.tabs.map(tab);
  const center: BottomTab | null =
    opts.quick !== false && allowed("dashboard:view")
      ? { key: "center", label: QUICK_CENTER.label, icon: QUICK_CENTER.icon, href: QUICK_CENTER.href, center: true, short: QUICK_CENTER.short, own: spec.own }
      : null;
  return [a, b, center, c, d].filter((x): x is BottomTab => Boolean(x));
}

/**
 * Which nav key is active for a path: the longest matching href wins. An href
 * with a query (`/teach/more?view=help`) matches only that path with those
 * values in `search`, and then beats the bare path.
 */
export function activeKey(groups: NavGroup[], pathname: string, search?: { get(key: string): string | null } | null): string | null {
  let best: { key: string; len: number } | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    const [h, query] = item.href.split("?") as [string, string | undefined];
    const want = query ? [...new URLSearchParams(query)] : [];
    const match = query
      ? pathname === h && want.every(([k, v]) => search?.get(k) === v)
      : h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(`${h}/`);
    if (match && (!best || item.href.length > best.len)) best = { key: item.key, len: item.href.length };
  }
  // A teacher's screen under Today with no item of its own (My tasks) lights
  // "Notices, links & leave", her catch-all, as the phone bar does (smoke 6 Nov, teacher 20).
  const items = groups.flatMap((g) => g.items);
  const home = best ? items.find((i) => i.key === best!.key) : undefined;
  if (best?.key === "home" && home && pathname !== home.href && items.some((i) => i.key === "more")) return "more";
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
