import type { StaffPermission } from "@/platform/auth/permissions";
import type { IconName } from "@/vx/icons";
import type { BadgeKey, DesignMenu } from "@/vx/nav";
import type { Pair } from "@/vx/text";

/**
 * The "+" in the middle of every phone bar, and "Quick actions" at the top of
 * the desk side menu (D-643). The owner, 15 Nov 2026: the teacher's big
 * Attendance button becomes a "+" for every role, holding the things each
 * person does every day, the admin's best of all.
 *
 * One list per menu, worked out on the server and handed to the bar as plain
 * data: the catalogue never ships in the bundle every screen carries, and
 * every entry names the permission its screen is guarded on, so the "+" can
 * never offer a page that ends on "access denied".
 *
 * Plain object literals on purpose (no helper calls), so nothing here runs
 * where it is not used.
 */

export type QuickTone = "pri" | "acc" | "info" | "ok" | "warn" | "plain";

export type QuickItem = {
  key: string;
  label: Pair;
  /** One line under the label: what happens when it is tapped. */
  hint: Pair;
  icon: IconName;
  tone: QuickTone;
  href: string;
  /** A count beside it, from the badges the shell already reads. */
  badge?: BadgeKey;
};

/** The permission (or every one of the permissions) the screen is guarded on. */
type QuickDef = QuickItem & { permission: StaffPermission | readonly StaffPermission[] };

export type QuickSet = {
  /** The person's first job of the day, as one big card on top. */
  hero: QuickItem | null;
  /** The hero's live line, asked for when the sheet opens: a class teacher's register. */
  live: "register" | null;
  tiles: QuickItem[];
  /** Two columns with a hint under each (most people), or three compact ones (the admin's nine). */
  layout: "roomy" | "compact";
  /** "Find a student" at the top, which opens the search. */
  search: boolean;
  /** Quick substitute with AI (photo or speak) above the tiles. */
  coverAi: boolean;
  /** A help line at the foot. */
  help: QuickItem | null;
};

const D = {
  /* ---------------------------------------------------------- teachers */
  attendance: {
    key: "attendance",
    label: { en: "Mark attendance", hi: "हाज़िरी लगाएँ" },
    hint: { en: "Your class, today", hi: "आपकी कक्षा, आज" },
    icon: "calCheck",
    tone: "pri",
    href: "/teach/attendance",
    permission: "attendance:mark",
  },
  teachMarks: {
    key: "marks",
    label: { en: "Enter marks", hi: "अंक भरें" },
    hint: { en: "Tests and exams", hi: "टेस्ट और परीक्षा" },
    icon: "clipboard",
    tone: "info",
    href: "/teach/marks",
    permission: "marks:write",
  },
  teachNote: {
    key: "note",
    label: { en: "Write a note", hi: "नोट लिखें" },
    hint: { en: "Type or speak", hi: "लिखें या बोलें" },
    icon: "notePen",
    tone: "acc",
    href: "/teach/notes?sheet=add",
    permission: "notes:write",
  },
  needs: {
    key: "needs",
    label: { en: "Needs you", hi: "आपके लिए" },
    hint: { en: "Work waiting for you", hi: "जो काम बाकी हैं" },
    icon: "ticks",
    tone: "warn",
    href: "/needs",
    permission: "dashboard:view",
    badge: "needs",
  },
  leave: {
    key: "leave",
    label: { en: "Ask for leave", hi: "छुट्टी माँगें" },
    hint: { en: "Tell the office", hi: "ऑफ़िस को बताएँ" },
    icon: "calMinus",
    tone: "plain",
    href: "/teach/more?sheet=leave",
    permission: "attendance:view",
  },
  myTimetable: {
    key: "timetable",
    label: { en: "My timetable", hi: "मेरी समय-सारणी" },
    hint: { en: "Your periods", hi: "आपके पीरियड" },
    icon: "clock",
    tone: "info",
    href: "/teach/more?view=timetable",
    permission: "attendance:view",
  },
  notices: {
    key: "notices",
    label: { en: "Notices", hi: "सूचनाएँ" },
    hint: { en: "From the office", hi: "ऑफ़िस की ओर से" },
    icon: "megaphone",
    tone: "ok",
    href: "/teach/more?view=news",
    permission: "attendance:view",
  },
  teachHelp: {
    key: "help",
    label: { en: "How do I use One?", hi: "वन कैसे चलाएँ?" },
    hint: { en: "Short help with pictures", hi: "चित्रों के साथ छोटी मदद" },
    icon: "help",
    tone: "plain",
    href: "/teach/more?view=help",
    permission: "attendance:view",
  },

  /* ---------------------------------------------------------- fee desk */
  collect: {
    key: "collect",
    label: { en: "Collect fee", hi: "फीस जमा करें" },
    hint: { en: "Find the child, take the fee, print the receipt", hi: "बच्चा चुनें, फीस लें, रसीद छापें" },
    icon: "rupee",
    tone: "pri",
    href: "/payments",
    permission: "fees:collect",
  },
  receipt: {
    key: "receipt",
    label: { en: "Find a receipt", hi: "रसीद ढूँढें" },
    hint: { en: "Look up or reprint", hi: "देखें या फिर छापें" },
    icon: "receipt",
    tone: "info",
    href: "/receipts",
    permission: "fees:view",
  },
  dues: {
    key: "dues",
    label: { en: "Call about dues", hi: "बकाया के लिए कॉल" },
    hint: { en: "Families who owe", hi: "जिनकी फीस बाकी है" },
    icon: "phone",
    tone: "warn",
    href: "/dues",
    permission: "fees:view",
    badge: "dues",
  },
  reminders: {
    key: "reminders",
    label: { en: "Fee reminders", hi: "फीस रिमाइंडर" },
    hint: { en: "WhatsApp to families", hi: "परिवारों को व्हाट्सऐप" },
    icon: "bell",
    tone: "ok",
    href: "/reminders",
    permission: "fees:view",
  },
  books: {
    key: "books",
    label: { en: "Cheques & UPI", hi: "चेक व यूपीआई" },
    hint: { en: "Bank and refunds", hi: "बैंक और वापसी" },
    icon: "swap",
    tone: "acc",
    href: "/accounts/books",
    permission: "fees:view",
  },
  families: {
    key: "families",
    label: { en: "Families", hi: "परिवार" },
    hint: { en: "Brothers and sisters", hi: "भाई-बहन एक साथ" },
    icon: "home",
    tone: "plain",
    href: "/families",
    permission: "fees:view",
  },

  /* ------------------------------------------- the admin and the office */
  officeCollect: {
    key: "collect",
    label: { en: "Collect fee", hi: "फीस जमा" },
    hint: { en: "Opens the Payment Desk", hi: "पेमेंट डेस्क खुलेगा" },
    icon: "rupee",
    tone: "pri",
    href: "/payments",
    permission: "fees:collect",
  },
  officeMark: {
    key: "mark",
    label: { en: "Attendance", hi: "हाज़िरी" },
    hint: { en: "Any class, today", hi: "कोई भी कक्षा, आज" },
    icon: "calCheck",
    tone: "acc",
    href: "/attendance",
    permission: "attendance:mark_on_behalf",
  },
  notice: {
    key: "notice",
    label: { en: "Send a notice", hi: "सूचना भेजें" },
    hint: { en: "To parents or staff", hi: "अभिभावकों या स्टाफ़ को" },
    icon: "megaphone",
    tone: "info",
    href: "/messages?compose=1",
    permission: "messages:send",
  },
  certificate: {
    key: "certificate",
    label: { en: "Certificate", hi: "प्रमाण पत्र" },
    hint: { en: "Pick the student", hi: "विद्यार्थी चुनें" },
    icon: "fileText",
    tone: "info",
    href: "/students",
    permission: ["certificates:issue", "students:view"],
  },
  admit: {
    key: "admit",
    label: { en: "New admission", hi: "नया दाख़िला" },
    hint: { en: "Add a student", hi: "नया विद्यार्थी जोड़ें" },
    icon: "userPlus",
    tone: "ok",
    href: "/admissions/new",
    permission: "fees:manage",
  },
  cover: {
    key: "cover",
    label: { en: "Substitute", hi: "सब्स्टिट्यूट" },
    hint: { en: "Cover an absent teacher", hi: "अनुपस्थित शिक्षक की जगह" },
    icon: "swap",
    tone: "warn",
    href: "/substitutions/arrange",
    permission: "substitutions:manage",
  },
  officeNote: {
    key: "note",
    label: { en: "Write a note", hi: "नोट लिखें" },
    hint: { en: "About a child", hi: "किसी बच्चे के बारे में" },
    icon: "notePen",
    tone: "plain",
    href: "/notes?add=1",
    permission: "notes:view",
  },
  officeDues: {
    key: "dues",
    label: { en: "Dues & calls", hi: "बकाया कॉल" },
    hint: { en: "Families who still owe", hi: "जिनकी फीस बाकी है" },
    icon: "phone",
    tone: "warn",
    href: "/dues",
    permission: "fees:view",
    badge: "dues",
  },
  dayBook: {
    key: "receipts",
    label: { en: "Today's receipts", hi: "आज की रसीदें" },
    hint: { en: "And closing the day", hi: "और दिन का हिसाब" },
    icon: "receipt",
    tone: "acc",
    href: "/receipts",
    permission: "fees:view",
  },
  officeReminders: {
    key: "reminders",
    label: { en: "Fee reminders", hi: "फीस रिमाइंडर" },
    hint: { en: "WhatsApp to families", hi: "परिवारों को व्हाट्सऐप" },
    icon: "bell",
    tone: "ok",
    href: "/reminders",
    permission: "fees:view",
  },

  /* ------------------------------------------------------- coordinators */
  arrangeCover: {
    key: "cover",
    label: { en: "Cover for absent teachers", hi: "अनुपस्थित शिक्षकों की व्यवस्था" },
    hint: { en: "Arrange today's substitutes", hi: "आज के सब्स्टिट्यूट लगाएँ" },
    icon: "swap",
    tone: "pri",
    href: "/substitutions/arrange",
    permission: "substitutions:manage",
  },
  everyRegister: {
    key: "attendance",
    label: { en: "Attendance", hi: "हाज़िरी" },
    hint: { en: "Every class, today", hi: "सभी कक्षाएँ, आज" },
    icon: "calCheck",
    tone: "acc",
    href: "/academics/attendance",
    permission: ["attendance:view", "academics:view"],
  },
  inbox: {
    key: "inbox",
    label: { en: "Needs you", hi: "आपके लिए" },
    hint: { en: "Approvals and changes", hi: "मंज़ूरी और बदलाव" },
    icon: "inbox",
    tone: "warn",
    href: "/inbox",
    permission: "attendance:correct",
    badge: "inbox",
  },
  marksResults: {
    key: "exams",
    label: { en: "Marks & results", hi: "अंक व परिणाम" },
    hint: { en: "Which classes are done", hi: "किन कक्षाओं के पूरे हुए" },
    icon: "clipboard",
    tone: "info",
    href: "/exams",
    permission: "assessments:view",
  },
  timetable: {
    key: "timetable",
    label: { en: "Timetable", hi: "समय सारणी" },
    hint: { en: "Who teaches when", hi: "कौन कब पढ़ाता है" },
    icon: "clock",
    tone: "plain",
    href: "/timetable",
    permission: "timetable:view",
  },
  marksTracker: {
    key: "tracker",
    label: { en: "Marks tracker", hi: "अंक ट्रैकर" },
    hint: { en: "Which papers still need marks", hi: "किन पेपरों के अंक बाकी हैं" },
    icon: "clipboard",
    tone: "pri",
    href: "/exams",
    permission: "assessments:view",
    badge: "marks",
  },
  board: {
    key: "board",
    label: { en: "Board readiness", hi: "बोर्ड की तैयारी" },
    hint: { en: "Classes 10 and 12", hi: "कक्षा 10 और 12" },
    icon: "award",
    tone: "acc",
    href: "/exam-office/board",
    permission: "outcomes:view",
  },
  official: {
    key: "official",
    label: { en: "Official results", hi: "आधिकारिक परिणाम" },
    hint: { en: "Board and state results", hi: "बोर्ड और राज्य के परिणाम" },
    icon: "award",
    tone: "info",
    href: "/exam-office/official-results",
    permission: "outcomes:view",
  },
  calendar: {
    key: "calendar",
    label: { en: "Calendar", hi: "कैलेंडर" },
    hint: { en: "Holidays and exam days", hi: "छुट्टियाँ और परीक्षा के दिन" },
    icon: "calendar",
    tone: "ok",
    href: "/calendar",
    permission: "academics:view",
  },
} satisfies Record<string, QuickDef>;

type Key = keyof typeof D;

type Plan = {
  /** Hero candidates in order: the first this person may open. */
  hero: Key[];
  tiles: Key[];
  layout: QuickSet["layout"];
  /** At most this many tiles: a full grid, never a crowded one. */
  max: number;
  help?: Key;
};

const PLANS: Record<DesignMenu, Plan> = {
  // Nine for the office in a three-by-three grid, in the order the day uses them.
  admin: {
    hero: [],
    tiles: ["officeCollect", "officeMark", "notice", "certificate", "admit", "cover", "officeNote", "officeDues", "dayBook", "officeReminders"],
    layout: "compact",
    max: 9,
  },
  teacher: {
    hero: ["attendance", "teachMarks"],
    tiles: ["teachNote", "teachMarks", "needs", "leave", "myTimetable", "notices"],
    layout: "roomy",
    max: 6,
    help: "teachHelp",
  },
  accountant: {
    hero: ["collect"],
    tiles: ["receipt", "dues", "reminders", "books", "families", "needs"],
    layout: "roomy",
    max: 6,
  },
  academic: {
    hero: ["arrangeCover"],
    tiles: ["everyRegister", "inbox", "officeNote", "notice", "marksResults", "timetable"],
    layout: "roomy",
    max: 6,
  },
  exam: {
    hero: ["marksTracker"],
    tiles: ["needs", "notice", "board", "official", "calendar", "timetable"],
    layout: "roomy",
    max: 6,
  },
};

function item(key: Key): QuickItem {
  const { permission: _permission, ...rest } = D[key] as QuickDef;
  void _permission;
  return rest;
}

/**
 * What this person's "+" holds, or null when it would hold nothing (a
 * view-only reader keeps a bar without it).
 *
 * - The hero is the first candidate they may open. A teacher without a class
 *   of her own gets Enter marks, never a register that says "You do not take
 *   attendance" (UX review, 6 Nov 2026).
 * - A tile the hero already is, is not repeated.
 * - With AI cover on, Quick substitute (photo, speak, arrange) replaces the
 *   plain Substitute tile, as it did on the admin's first "+" sheet.
 */
export function quickFor(
  menu: DesignMenu,
  allowed: (permission: StaffPermission) => boolean,
  opts: { teacherHasClass?: boolean; coverAi?: boolean } = {},
): QuickSet | null {
  const plan = PLANS[menu];
  const may = (key: Key) => {
    const need = (D[key] as QuickDef).permission;
    return typeof need === "string" ? allowed(need) : need.every(allowed);
  };
  const heroKeys = menu === "teacher" && opts.teacherHasClass === false ? plan.hero.filter((k) => k !== "attendance") : plan.hero;
  const heroKey = heroKeys.find(may) ?? null;
  const coverAi = Boolean(opts.coverAi) && may("cover");
  const heroHref = heroKey ? D[heroKey].href : null;
  const tiles = plan.tiles
    .filter((k) => may(k) && D[k].href !== heroHref && !(coverAi && D[k].href === "/substitutions/arrange"))
    .slice(0, plan.max)
    .map(item);
  const search = allowed("students:view") || allowed("fees:view");
  const help = plan.help && may(plan.help) ? item(plan.help) : null;
  // A hero that is the cover the AI row already offers is that row instead.
  const hero = heroKey && !(coverAi && D[heroKey].href === "/substitutions/arrange") ? item(heroKey) : null;
  if (!hero && tiles.length === 0 && !coverAi) return null;
  return { hero, live: hero?.key === "attendance" ? "register" : null, tiles, layout: plan.layout, search, coverAi, help };
}

/** Every entry with the permissions it asks for, for the route tests. */
export const QUICK_CATALOGUE: readonly { key: string; href: string; permissions: readonly StaffPermission[] }[] = Object.values(D).map((d: QuickDef) => ({
  key: d.key,
  href: d.href,
  permissions: typeof d.permission === "string" ? [d.permission] : d.permission,
}));
