import type { StaffPermission } from "@/platform/auth/permissions";
import type { IconName } from "@/vx/icons";
import { groupsFor, type DesignMenu } from "@/vx/nav";
import type { Pair } from "@/vx/text";

/*
 * The phone Menu's tiles (F13-Menu, redrawn D-519). The admin's are grouped
 * by the job they do, each pointed at the screen that does it and shown only
 * with the permission that screen is guarded on. The other menus show their
 * own nav items as tiles. Every tile carries one plain line saying what it
 * opens, because the people reading it judge a button by what is written on
 * it (owner, 7 Nov 2026: "easy to understand and quickly usable"). Pure data;
 * tested in tests/vx-menu-items.test.ts.
 */

export type MenuTile = { key: string; label: Pair; icon: IconName; href: string; permission: StaffPermission; hint?: Pair };

/** Each group's colour on the Menu: its icons, its heading and its jump chip. */
export type MenuTone = "daily" | "people" | "studies" | "money" | "messages" | "records" | "work";

export type MenuGroup = {
  /** The section's id on the page (`menu-<id>`), and its jump chip. */
  id: string;
  title: Pair;
  /** The jump chip's word. */
  short: Pair;
  icon: IconName;
  tone: MenuTone;
  tiles: MenuTile[];
};

const t = (key: string, en: string, hi: string, icon: IconName, href: string, permission: StaffPermission, hintEn: string, hintHi: string): MenuTile => ({
  key,
  label: { en, hi },
  icon,
  href,
  permission,
  hint: { en: hintEn, hi: hintHi },
});

const ADMIN: MenuGroup[] = [
  {
    id: "daily",
    title: { en: "Daily work", hi: "रोज़ के काम" },
    short: { en: "Daily", hi: "रोज़" },
    icon: "sun",
    tone: "daily",
    tiles: [
      t("attendance", "Attendance", "हाज़िरी", "calCheck", "/attendance", "attendance:mark_on_behalf", "Mark or check any class today", "किसी भी कक्षा की हाज़िरी लगाएँ या देखें"),
      t("subs", "Cover for absent teachers", "अनुपस्थित शिक्षक की व्यवस्था", "swap", "/timetable?view=subs", "substitutions:manage", "Who takes whose period today", "आज किसका कालांश कौन लेगा"),
      t("collect", "Collect fee", "फीस जमा करें", "rupee", "/payments", "fees:collect", "Take a payment, print the receipt", "फीस लें और रसीद छापें"),
      t("dues", "Dues & calls", "बकाया व कॉल", "phone", "/dues", "fees:view", "Who still owes; call the parents", "किसकी फीस बाकी है; अभिभावकों को कॉल करें"),
      t("approvals", "Needs you", "आपके लिए", "inbox", "/inbox", "attendance:correct", "Approvals, corrections and refunds waiting", "स्वीकृति, सुधार और रिफ़ंड जो आपकी राह देख रहे हैं"),
    ],
  },
  {
    id: "people",
    title: { en: "Children & staff", hi: "बच्चे व स्टाफ़" },
    short: { en: "People", hi: "लोग" },
    icon: "users",
    tone: "people",
    tiles: [
      t("students", "Students", "विद्यार्थी", "users", "/students", "students:view", "Find any child: details, fees, papers", "कोई भी बच्चा खोजें: जानकारी, फीस, दस्तावेज़"),
      t("admissions", "Admissions", "प्रवेश", "userPlus", "/admissions", "fees:manage", "Add a new child to the school", "नए बच्चे का प्रवेश करें"),
      t("schooloffice", "School Office", "विद्यालय कार्यालय", "fileText", "/school-office", "certificates:view", "Certificates: study, character, birth date, TC", "प्रमाण पत्र: अध्ययन, चरित्र, जन्म तिथि, टीसी"),
      t("families", "Families", "परिवार", "home", "/families", "fees:view", "Brothers and sisters, with their fees together", "भाई-बहन, उनकी फीस एक साथ"),
      t("transport", "Buses & routes", "बस व रूट", "bus", "/transport", "transport:view", "Children on each route, bus times, drivers", "हर रूट के बच्चे, बस का समय, ड्राइवर"),
      t("staff", "Staff & roles", "स्टाफ़ व अधिकार", "shield", "/staff", "staff:view", "Add staff; choose who can do what", "स्टाफ़ जोड़ें; कौन क्या कर सकता है"),
    ],
  },
  {
    id: "studies",
    title: { en: "Studies & exams", hi: "पढ़ाई व परीक्षा" },
    short: { en: "Studies", hi: "पढ़ाई" },
    icon: "book",
    tone: "studies",
    tiles: [
      t("exams", "Marks & exams", "अंक व परीक्षा", "clipboard", "/exams", "assessments:view", "Enter and check marks", "अंक भरें और जाँचें"),
      t("cards", "Report cards", "रिपोर्ट कार्ड", "grad", "/exam-office/results", "assessments:manage", "Each child's result, ready to print", "हर बच्चे का परिणाम, छापने को तैयार"),
      t("timetable", "Timetable", "समय-सारणी", "clock", "/timetable", "timetable:view", "Periods for every class and teacher", "हर कक्षा और शिक्षक के कालांश"),
      t("calendar", "School calendar", "शैक्षणिक कैलेंडर", "calendar", "/calendar", "academics:view", "Holidays, exams and events", "छुट्टियाँ, परीक्षाएँ और कार्यक्रम"),
      t("notes", "Notes on children", "बच्चों के नोट्स", "edit", "/notes", "notes:view", "What teachers noticed about a child", "शिक्षकों ने बच्चों के बारे में क्या लिखा"),
      t("board", "Board readiness", "बोर्ड की तैयारी", "clipboard", "/exam-office/board", "outcomes:view", "Class 10 and 12 board work", "कक्षा 10 व 12 बोर्ड का काम"),
      t("officialresults", "Official results", "आधिकारिक परिणाम", "award", "/exam-office/official-results", "outcomes:view", "Board results as published", "बोर्ड द्वारा जारी परिणाम"),
    ],
  },
  {
    id: "money",
    title: { en: "Fees & money", hi: "फीस व हिसाब" },
    short: { en: "Fees", hi: "फीस" },
    icon: "rupee",
    tone: "money",
    tiles: [
      t("receipts", "Receipts & day close", "रसीदें व दिन बंद", "receipt", "/receipts", "fees:view", "Find or print a receipt; close the day", "रसीद खोजें या छापें; दिन बंद करें"),
      t("reminders", "Fee reminders", "फीस रिमाइंडर", "bell", "/reminders", "fees:view", "Remind parents on WhatsApp", "अभिभावकों को व्हाट्सऐप पर याद दिलाएँ"),
      t("online", "Online payments", "ऑनलाइन भुगतान", "globe", "/fees/payments/online", "fees:accounts", "Fees paid with the Pay now link", "‘अभी भुगतान करें’ लिंक से आई फीस"),
      t("feesetup", "Fee setup", "फीस ढांचा", "sliders", "/fee-setup", "fees:view", "How much each class pays", "हर कक्षा की फीस कितनी है"),
      t("reports", "Reports", "रिपोर्ट", "chart", "/reports", "fees:reports", "Fee collection and dues, to download", "फीस जमा और बकाया, डाउनलोड के लिए"),
      t("aireport", "AI report", "AI रिपोर्ट", "database", "/reports/ai", "reports:ai", "The whole year in one file for ChatGPT", "पूरे साल की एक फ़ाइल, ChatGPT के लिए"),
    ],
  },
  {
    id: "messages",
    title: { en: "Messages", hi: "संदेश" },
    short: { en: "Messages", hi: "संदेश" },
    icon: "message",
    tone: "messages",
    tiles: [
      t("notice", "Send a notice", "सूचना भेजें", "megaphone", "/messages?compose=1", "messages:send", "WhatsApp to parents or staff", "अभिभावकों या स्टाफ़ को व्हाट्सऐप"),
      t("sent", "Messages sent", "भेजे गए संदेश", "message", "/messages", "messages:send", "What went out, and the replies", "क्या भेजा गया, और जवाब"),
      t("helper", "Veer Patta AI", "Veer Patta AI", "sparkle", "/settings/whatsapp/helper", "settings:manage", "The WhatsApp helper's week; teach it answers", "WhatsApp सहायक का हफ़्ता; इसे जवाब सिखाएँ"),
    ],
  },
  {
    id: "records",
    title: { en: "School records", hi: "स्कूल रिकॉर्ड" },
    short: { en: "Records", hi: "रिकॉर्ड" },
    icon: "layers",
    tone: "records",
    tiles: [
      t("import", "Import from Excel", "Excel से इम्पोर्ट", "upload", "/student-tools?view=import", "fees:manage", "Add many students from one sheet", "एक शीट से कई विद्यार्थी जोड़ें"),
      t("master", "Classes, routes & discounts", "कक्षा, रूट व छूट", "database", "/settings?s=master", "settings:manage", "The school's own lists", "स्कूल की अपनी सूचियाँ"),
      t("activity", "Who changed what", "किसने क्या बदला", "activity", "/settings?s=activity", "settings:manage", "Every change, with name and time", "हर बदलाव, नाम और समय के साथ"),
      t("backups", "Backups", "बैकअप", "archive", "/settings?s=backups", "settings:manage", "Safe copies of the school's data", "स्कूल के डेटा की सुरक्षित कॉपी"),
      t("glossary", "Money words", "फीस के शब्द", "book", "/settings?s=glossary", "settings:manage", "What each fee word means", "फीस के हर शब्द का अर्थ"),
    ],
  },
];

/**
 * One line for each screen the other menus name (their own nav, `@/vx/nav`),
 * by the address it opens. A screen with no line here simply shows its name.
 */
const HINTS: Record<string, Pair> = {
  "/accounts": { en: "Today's collection and what is left to do", hi: "आज की जमा और बाकी काम" },
  "/academics": { en: "Today's school at a glance", hi: "आज का स्कूल, एक नज़र में" },
  "/exam-office": { en: "Today's exam work", hi: "आज का परीक्षा का काम" },
  "/teach": { en: "Your day: classes and tasks", hi: "आपका दिन: कक्षाएँ और काम" },
  "/payments": { en: "Take a payment, print the receipt", hi: "फीस लें और रसीद छापें" },
  "/receipts": { en: "Find or print a receipt; close the day", hi: "रसीद खोजें या छापें; दिन बंद करें" },
  "/dues": { en: "Who still owes; call the parents", hi: "किसकी फीस बाकी है; अभिभावकों को कॉल करें" },
  "/families": { en: "Brothers and sisters, with their fees together", hi: "भाई-बहन, उनकी फीस एक साथ" },
  "/reminders": { en: "Remind parents on WhatsApp", hi: "अभिभावकों को व्हाट्सऐप पर याद दिलाएँ" },
  "/accounts/books": { en: "Cheques to deposit, UPI to match, refunds", hi: "जमा करने वाले चेक, यूपीआई मिलान, रिफ़ंड" },
  "/fees/payments/online": { en: "Fees paid with the Pay now link", hi: "‘अभी भुगतान करें’ लिंक से आई फीस" },
  "/reports": { en: "Fee collection and dues, to download", hi: "फीस जमा और बकाया, डाउनलोड के लिए" },
  "/reports/ai": { en: "The whole year in one file for ChatGPT", hi: "पूरे साल की एक फ़ाइल, ChatGPT के लिए" },
  "/fee-setup": { en: "How much each class pays", hi: "हर कक्षा की फीस कितनी है" },
  "/transport": { en: "Children on each route, bus times, drivers", hi: "हर रूट के बच्चे, बस का समय, ड्राइवर" },
  "/timetable?view=subs": { en: "Who takes whose period today", hi: "आज किसका कालांश कौन लेगा" },
  "/inbox": { en: "Approvals and corrections waiting", hi: "स्वीकृति और सुधार जो आपकी राह देख रहे हैं" },
  "/needs": { en: "What is waiting for you, in order", hi: "आपके लिए क्या बाकी है, क्रम से" },
  "/academics/progress": { en: "How each class and child is doing", hi: "हर कक्षा और बच्चा कैसा कर रहा है" },
  "/academics/attendance": { en: "Attendance for every class", hi: "हर कक्षा की हाज़िरी" },
  "/notes": { en: "What teachers noticed about a child", hi: "शिक्षकों ने बच्चों के बारे में क्या लिखा" },
  "/exams": { en: "Enter and check marks", hi: "अंक भरें और जाँचें" },
  "/timetable": { en: "Periods for every class and teacher", hi: "हर कक्षा और शिक्षक के कालांश" },
  "/calendar": { en: "Holidays, exams and events", hi: "छुट्टियाँ, परीक्षाएँ और कार्यक्रम" },
  "/messages": { en: "Notices to parents or staff", hi: "अभिभावकों या स्टाफ़ को सूचना" },
  "/exam-office/plan": { en: "Date sheet and seating plan", hi: "डेटशीट और बैठक व्यवस्था" },
  "/exam-office/results": { en: "Each child's result, ready to print", hi: "हर बच्चे का परिणाम, छापने को तैयार" },
  "/exam-office/board": { en: "Class 10 and 12 board work", hi: "कक्षा 10 व 12 बोर्ड का काम" },
  "/exam-office/official-results": { en: "Board results as published", hi: "बोर्ड द्वारा जारी परिणाम" },
  "/teach/attendance": { en: "Mark today's register", hi: "आज की हाज़िरी लगाएँ" },
  "/teach/class": { en: "Your class and subjects", hi: "आपकी कक्षा और विषय" },
  "/teach/marks": { en: "Enter marks for your classes", hi: "अपनी कक्षाओं के अंक भरें" },
  "/teach/notes": { en: "Write a note about a child", hi: "किसी बच्चे के बारे में नोट लिखें" },
  "/teach/more?view=timetable": { en: "Your periods this week", hi: "इस हफ़्ते आपके कालांश" },
  "/teach/tasks": { en: "Things left for you to do", hi: "आपके बचे हुए काम" },
  "/teach/more": { en: "Notices, marks links and leave", hi: "सूचनाएँ, अंक लिंक और छुट्टी" },
  "/teach/more?view=help": { en: "Pictures that show how", hi: "चित्रों से समझें" },
  "/teach/more?view=profile": { en: "Language, text size, alerts", hi: "भाषा, अक्षर का आकार, अलर्ट" },
};

/** The line under a screen's name on the Menu, by the address it opens. */
export function hintFor(href: string): Pair | undefined {
  return HINTS[href];
}

/** The design's first four pins, when the reader has chosen none. */
const ADMIN_PINS = ["collect", "attendance", "dues", "timetable"];

/** The tiles this reader may open, grouped as the design groups them. */
export function menuGroups(menu: DesignMenu, allowed: (p: StaffPermission) => boolean): MenuGroup[] {
  if (menu === "admin") {
    return ADMIN.map((g) => ({ ...g, tiles: g.tiles.filter((x) => allowed(x.permission)) })).filter((g) => g.tiles.length > 0);
  }
  const items = groupsFor(menu, allowed).flatMap((g) => g.items);
  if (!items.length) return [];
  return [
    {
      id: "work",
      title: { en: "Your work", hi: "आपका काम" },
      short: { en: "Your work", hi: "आपका काम" },
      icon: "briefcase",
      tone: "work",
      tiles: items.map((i) => ({ key: i.key, label: i.label, icon: i.icon, href: i.href, permission: i.permission, hint: hintFor(i.href) })),
    },
  ];
}

/**
 * Four pins: the reader's own choice where it still opens, else the design's
 * defaults, else the first tiles. Defaults skip what the bottom bar already
 * shows (`onBar`, by address): the accountant's first four tiles were exactly
 * her four tabs, so her shortcuts saved her nothing (D-519).
 */
export function pinnedTiles(groups: MenuGroup[], chosen: readonly string[] | null, menu: DesignMenu, onBar: readonly string[] = []): MenuTile[] {
  const all = groups.flatMap((g) => g.tiles);
  const byKey = new Map(all.map((x) => [x.key, x]));
  const want = chosen && chosen.length ? chosen : menu === "admin" ? ADMIN_PINS : [];
  const picked = want.map((k) => byKey.get(k)).filter((x): x is MenuTile => Boolean(x));
  if (!chosen?.length) {
    const bar = new Set(onBar);
    for (const x of [...all.filter((t) => !bar.has(t.href)), ...all.filter((t) => bar.has(t.href))]) {
      if (picked.length >= 4) break;
      if (!picked.includes(x)) picked.push(x);
    }
  }
  return picked.slice(0, 4);
}

/** Where "Settings" goes for this reader: the school's settings for an admin, their own for everyone else. */
export function settingsLinks(schoolSettings: boolean): { school: string | null; mine: string; password: string; year: string } {
  return { school: schoolSettings ? "/settings" : null, mine: "/preferences", password: "/preferences/password", year: "/preferences/session" };
}
