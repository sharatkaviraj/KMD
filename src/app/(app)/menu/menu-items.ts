import type { StaffPermission } from "@/platform/auth/permissions";
import type { IconName } from "@/vx/icons";
import { groupsFor, type DesignMenu } from "@/vx/nav";
import type { Pair } from "@/vx/text";

/*
 * The phone Menu's tiles (F13-Menu). The admin's are the design's own list
 * (App.dc.html `MENU`), each pointed at the screen that does that job and
 * shown only with the permission that screen is guarded on. The other menus
 * show their own nav items as tiles. Pure data; tested in
 * tests/vx-menu-items.test.ts.
 */

export type MenuTile = { key: string; label: Pair; icon: IconName; href: string; permission: StaffPermission };
export type MenuGroup = { title: Pair; tiles: MenuTile[] };

const t = (key: string, en: string, hi: string, icon: IconName, href: string, permission: StaffPermission): MenuTile => ({ key, label: { en, hi }, icon, href, permission });

const ADMIN: MenuGroup[] = [
  {
    title: { en: "Daily", hi: "रोज़ के काम" },
    tiles: [
      t("attendance", "Attendance", "उपस्थिति", "calCheck", "/attendance", "attendance:mark_on_behalf"),
      t("subs", "Substitutions", "व्यवस्था कालांश", "swap", "/timetable?view=subs", "substitutions:manage"),
      t("collect", "Collect fee", "फीस जमा", "rupee", "/payments", "fees:collect"),
      t("dues", "Dues & calls", "बकाया व कॉल", "phone", "/dues", "fees:view"),
    ],
  },
  {
    title: { en: "People", hi: "लोग" },
    tiles: [
      t("students", "Students", "विद्यार्थी", "users", "/students", "students:view"),
      t("schooloffice", "School Office", "विद्यालय कार्यालय", "fileText", "/school-office", "certificates:view"),
      t("families", "Families", "परिवार", "home", "/student-tools?view=families", "fees:manage"),
      t("staff", "Staff & roles", "स्टाफ व अधिकार", "shield", "/staff", "staff:view"),
      t("admissions", "Admissions", "प्रवेश", "userPlus", "/admissions", "fees:manage"),
    ],
  },
  {
    title: { en: "Academics", hi: "पढ़ाई" },
    tiles: [
      t("exams", "Marks & exams", "अंक व परीक्षा", "clipboard", "/exams", "assessments:view"),
      t("cards", "Report cards", "रिपोर्ट कार्ड", "grad", "/exam-office/results", "assessments:manage"),
      t("board", "Board readiness", "बोर्ड की तैयारी", "clipboard", "/exam-office/board", "outcomes:view"),
      t("officialresults", "Official results", "आधिकारिक परिणाम", "award", "/exam-office/official-results", "outcomes:view"),
      t("timetable", "Timetable", "समय-सारणी", "clock", "/timetable", "timetable:view"),
      t("calendar", "Calendar", "शैक्षणिक कैलेंडर", "calendar", "/calendar", "academics:view"),
      t("notes", "Notes on children", "बच्चों के नोट्स", "edit", "/notes", "notes:view"),
    ],
  },
  {
    title: { en: "Money", hi: "फीस व हिसाब" },
    tiles: [
      t("feesetup", "Fee setup", "फीस ढांचा", "sliders", "/fee-setup", "fees:view"),
      t("receipts", "Receipts", "रसीदें", "receipt", "/receipts", "fees:view"),
      t("reminders", "Fee reminders", "फीस रिमाइंडर", "bell", "/reminders", "fees:view"),
      t("approvals", "Approvals & refunds", "स्वीकृति व रिफंड", "undo", "/inbox", "attendance:correct"),
      t("reports", "Reports", "रिपोर्ट", "chart", "/reports", "fees:reports"),
      t("aireport", "AI report", "AI रिपोर्ट", "database", "/reports/ai", "reports:ai"),
      t("transport", "Transport", "परिवहन", "bus", "/students?view=fees&seg=bus", "fees:view"),
    ],
  },
  {
    title: { en: "Messages", hi: "संदेश" },
    tiles: [
      t("notice", "WhatsApp notices", "व्हाट्सऐप सूचना", "megaphone", "/messages?compose=1", "messages:send"),
      t("sent", "Sent messages", "भेजे गए संदेश", "message", "/messages", "messages:send"),
    ],
  },
  {
    title: { en: "System", hi: "सिस्टम" },
    tiles: [
      t("import", "Import data", "डेटा आयात", "upload", "/student-tools?view=import", "fees:manage"),
      t("master", "Master data", "कक्षा, रूट, छूट", "database", "/settings?s=master", "settings:manage"),
      t("activity", "Activity log", "गतिविधि", "activity", "/settings?s=activity", "settings:manage"),
      t("backups", "Backups & archive", "बैकअप", "archive", "/settings?s=backups", "settings:manage"),
      t("settings", "Settings", "सेटिंग्स", "settings", "/settings", "settings:manage"),
      t("glossary", "Money words", "शब्दों का अर्थ", "book", "/settings?s=glossary", "settings:manage"),
    ],
  },
];

/** The design's first four pins, when the reader has chosen none. */
const ADMIN_PINS = ["collect", "attendance", "dues", "timetable"];

/** The tiles this reader may open, grouped as the design groups them. */
export function menuGroups(menu: DesignMenu, allowed: (p: StaffPermission) => boolean): MenuGroup[] {
  if (menu === "admin") {
    return ADMIN.map((g) => ({ ...g, tiles: g.tiles.filter((x) => allowed(x.permission)) })).filter((g) => g.tiles.length > 0);
  }
  const items = groupsFor(menu, allowed).flatMap((g) => g.items);
  return items.length ? [{ title: { en: "Your work", hi: "आपका काम" }, tiles: items.map((i) => ({ key: i.key, label: i.label, icon: i.icon, href: i.href, permission: i.permission })) }] : [];
}

/** Four pins: the reader's own choice where it still opens, else the design's defaults, else the first tiles. */
export function pinnedTiles(groups: MenuGroup[], chosen: readonly string[] | null, menu: DesignMenu): MenuTile[] {
  const all = groups.flatMap((g) => g.tiles);
  const byKey = new Map(all.map((x) => [x.key, x]));
  const want = chosen && chosen.length ? chosen : menu === "admin" ? ADMIN_PINS : [];
  const picked = want.map((k) => byKey.get(k)).filter((x): x is MenuTile => Boolean(x));
  for (const x of all) {
    if (picked.length >= 4) break;
    if (!chosen?.length && !picked.includes(x)) picked.push(x);
  }
  return picked.slice(0, 4);
}
