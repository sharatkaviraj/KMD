import { p, type Pair } from "@/vx/text";

/*
 * Settings, backups & glossary (design `Settings`). Pure: the profile's
 * shape and checks, how an activity row reads, the glossary, the list of
 * classic screens. No database import.
 */

export const SETTINGS_STATES = ["home", "school", "prefs", "session", "activity", "backups", "restore", "archive", "master", "integrations", "glossary"] as const;
export type SettingsState = (typeof SETTINGS_STATES)[number];

export function isSettingsState(value: unknown): value is SettingsState {
  return typeof value === "string" && (SETTINGS_STATES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------ the profile */

export const FOOTER_MAX = 160;
/** A logo or signature is kept as a small data URL; larger files are refused. */
export const IMAGE_MAX_BYTES = 200 * 1024;

export type SchoolProfile = {
  nameEn: string;
  nameHi: string;
  address: string;
  affiliation: string;
  phone: string;
  footer: string;
  logo: string | null;
  signature: string | null;
};

export const EMPTY_PROFILE: SchoolProfile = { nameEn: "", nameHi: "", address: "", affiliation: "", phone: "", footer: "", logo: null, signature: null };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A data URL for a PNG/JPEG/WebP image under the size limit, or null. */
export function cleanImage(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) return null;
  const bytes = Math.floor((m[2].length * 3) / 4);
  return bytes <= IMAGE_MAX_BYTES ? value : null;
}

/** What is stored, from whatever arrived: unknown keys dropped, every field bounded. */
export function cleanProfile(input: unknown, fallback: SchoolProfile = EMPTY_PROFILE): SchoolProfile {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    nameEn: str(o.nameEn, 120) || fallback.nameEn,
    nameHi: str(o.nameHi, 120),
    address: str(o.address, 300),
    affiliation: str(o.affiliation, 40),
    phone: str(o.phone, 20),
    footer: str(o.footer, FOOTER_MAX),
    logo: o.logo === undefined ? fallback.logo : cleanImage(o.logo),
    signature: o.signature === undefined ? fallback.signature : cleanImage(o.signature),
  };
}

export type ProfileProblem = "name" | "phone" | "footer";

export function profileProblems(profile: SchoolProfile): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  if (!profile.nameEn.trim()) out.push("name");
  const digits = profile.phone.replace(/\D/g, "");
  if (profile.phone && (digits.length < 10 || digits.length > 12)) out.push("phone");
  if (profile.footer.length > FOOTER_MAX) out.push("footer");
  return out;
}

export const PROFILE_PROBLEMS: Record<ProfileProblem, Pair> = {
  name: p("Write the school's name.", "स्कूल का नाम लिखें।"),
  phone: p("The office phone needs ten digits.", "फ़ोन नंबर 10 अंकों का हो।"),
  footer: p(`Keep the footer under ${FOOTER_MAX} letters.`, `फ़ुटर ${FOOTER_MAX} अक्षरों से छोटा रखें।`),
};

/** The fields that changed, for the history row and the toast. */
export function changedFields(before: SchoolProfile, after: SchoolProfile): (keyof SchoolProfile)[] {
  return (Object.keys(after) as (keyof SchoolProfile)[]).filter((k) => before[k] !== after[k]);
}

/* ------------------------------------------------------------ activity log */

export type ActivityArea = "money" | "students" | "marks" | "attendance" | "settings" | "signin" | "staff";

export const AREA_LABELS: Record<ActivityArea, Pair> = {
  money: p("Money", "पैसा"),
  students: p("Students", "विद्यार्थी"),
  marks: p("Marks", "अंक"),
  attendance: p("Attendance", "हाज़िरी"),
  settings: p("Settings", "सेटिंग्स"),
  signin: p("Sign-in", "लॉगिन"),
  staff: p("Staff", "स्टाफ़"),
};

/** The design's colour for each area's tag (`Settings` · activity). */
export const AREA_TONES: Record<ActivityArea, "ok" | "info" | "acc" | "warn" | "mut"> = {
  money: "acc",
  students: "info",
  marks: "warn",
  attendance: "ok",
  settings: "mut",
  signin: "ok",
  staff: "info",
};

const MONEY_TABLES = /^(payments|receipts|installments|payment_adjustments|receipt_adjustments|collection_closures|student_fee_overrides|student_carry_forward|student_repayment|student_conventional_discount|fee_|school_fee|conventional_discount|prev_year|defaulter)/;
const STUDENT_TABLES = /^(students|student_family|student_collection_flags|promotion|classes|transport_routes)/;

/** Which area a fee-app audit row belongs to, by its table. */
export function areaForTable(table: string): ActivityArea {
  if (MONEY_TABLES.test(table)) return "money";
  if (STUDENT_TABLES.test(table)) return "students";
  if (table === "users") return "staff";
  return "settings";
}

const ACTION_WORDS: Record<string, string> = { insert: "added", update: "changed", delete: "removed" };

/** "added a receipt", "changed a student" — a fee table and an action as a phrase. */
export function auditPhrase(table: string, action: string): string {
  const noun = table
    .replace(/_/g, " ")
    .replace(/ies$/, "y")
    .replace(/s$/, "");
  return `${ACTION_WORDS[action] ?? action} ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
}

const SKIP_FIELDS = new Set(["updated_at", "created_at", "updated_by", "created_by", "id"]);

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v).slice(0, 60);
};

export type FieldChange = { field: string; before: string; after: string };

/** Top-level fields that differ between two rows, at most `limit`, bookkeeping columns left out. */
export function diffRows(before: unknown, after: unknown, limit = 6): FieldChange[] {
  const a = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const b = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !SKIP_FIELDS.has(k));
  const out: FieldChange[] = [];
  for (const key of keys) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    out.push({ field: key.replace(/_/g, " "), before: show(a[key]), after: show(b[key]) });
    if (out.length >= limit) break;
  }
  return out;
}

export type ActivityEvent = {
  id: string;
  at: string;
  who: string;
  area: ActivityArea;
  text: string;
  changes: FieldChange[];
};

/** Events grouped by school day (Asia/Kolkata), newest day first. */
export function groupByDay(events: ActivityEvent[]): { day: string; events: ActivityEvent[] }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  const map = new Map<string, ActivityEvent[]>();
  for (const e of [...events].sort((x, y) => y.at.localeCompare(x.at))) {
    const day = fmt.format(new Date(e.at));
    map.set(day, [...(map.get(day) ?? []), e]);
  }
  return [...map.entries()].map(([day, list]) => ({ day, events: list }));
}

/**
 * How many events fall on one school day. The day is the IST one: an event at
 * 00:30 IST carries yesterday's UTC date, and cutting the ISO string said
 * "0 changes today" after a night's work (school-day run, admin B17).
 */
export function changesOn(events: readonly Pick<ActivityEvent, "at">[], day: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  return events.filter((e) => fmt.format(new Date(e.at)) === day).length;
}

const COVER_PHRASES: Record<string, string> = {
  absence: "marked a teacher away and arranged cover",
  clear_absence: "marked a teacher back at school",
  assign: "assigned cover",
  release: "released a cover duty",
  refresh: "arranged cover again",
};

/** A cover command in the activity log's words: what was done, and for which day. */
export function coverPhrase(kind: string, day: string): string {
  return `${COVER_PHRASES[kind] ?? "changed cover"} · ${day}`;
}

/** CSV of the log as shown, for Export. */
export function activityCsv(events: ActivityEvent[]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["when,who,area,what,changes"];
  for (const e of events) {
    lines.push([e.at, e.who, e.area, e.text, e.changes.map((c) => `${c.field}: ${c.before} -> ${c.after}`).join("; ")].map(cell).join(","));
  }
  return lines.join("\n");
}

/* ----------------------------------------------------------------- backups */

export type BackupDay = { day: string; files: number; bytes: number };

/** "212 MB", "1.4 GB", "880 KB". */
export function bytesLabel(bytes: number | null | undefined): string {
  const b = Math.max(0, bytes ?? 0);
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/** Whether last night's copy is there: a backup dated today or yesterday (school time). */
export function backupHealth(days: BackupDay[], today: string): "ok" | "late" | "none" {
  if (days.length === 0) return "none";
  const latest = days.map((d) => d.day).sort().at(-1) as string;
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return latest >= yesterday.toISOString().slice(0, 10) ? "ok" : "late";
}

/* ---------------------------------------------------------------- glossary */

/** The tag on each word: which part of the school it belongs to. */
export type GlossaryTag = "money" | "students" | "marks" | "attendance" | "settings";

export type GlossaryEntry = { term: Pair; meaning: Pair; tag: GlossaryTag };

/*
 * Words the app uses, in plain language (design `Settings` · glossary). The
 * design's sample figures (a ₹10-a-day late fee, fixed due dates) are not
 * this school's rules, so those meanings say where the real rule lives.
 */
export const GLOSSARY: GlossaryEntry[] = [
  { tag: "money", term: p("Pending today", "आज बकाया"), meaning: p("Installments past their due date and still unpaid. The money to follow up.", "जिन किस्तों की तारीख निकल चुकी है और जो अभी तक जमा नहीं हुईं।") },
  { tag: "money", term: p("Not due yet", "अभी देय नहीं"), meaning: p("Installments whose due date is still ahead. Never added to pending today.", "जिन किस्तों की तारीख अभी आनी है। इन्हें आज के बकाया में नहीं जोड़ा जाता।") },
  { tag: "money", term: p("Late fee (separate)", "विलंब शुल्क (अलग)"), meaning: p("A charge for paying after a due date, as set in Fee setup. Always shown on its own line, never added into the fee.", "देय तिथि के बाद भरने का शुल्क, जैसा फीस सेटअप में तय है। यह हमेशा अलग दिखता है, फीस में नहीं जुड़ता।") },
  { tag: "money", term: p("Reversal", "रसीद रद्द (रिवर्सल)"), meaning: p("Receipts are never edited. A mistake is fixed with a reversal entry and a new receipt.", "रसीद कभी बदली नहीं जाती। गलती सुधारने के लिए रिवर्सल एंट्री और नई रसीद बनती है।") },
  { tag: "money", term: p("Day close", "दिन बंद"), meaning: p("At day end the cash is counted and the day's book is closed.", "दिन के अंत में नकद गिनकर उस दिन की बही बंद की जाती है।") },
  { tag: "money", term: p("Installment", "किस्त"), meaning: p("One part of the year's fee with its own due date, from Fee setup.", "साल की फीस का एक हिस्सा, अपनी तारीख के साथ, फीस सेटअप से।") },
  { tag: "money", term: p("Receipt", "रसीद"), meaning: p("Proof of one payment, numbered in order and never reused.", "एक भुगतान का प्रमाण, क्रम से क्रमांकित, कभी दोबारा नहीं।") },
  { tag: "money", term: p("Promise", "भुगतान का वादा"), meaning: p("A date a parent gave to pay by. It comes back on that day's call list.", "अभिभावक द्वारा बताई गई भुगतान की तारीख। उस दिन यह कॉल सूची में आता है।") },
  { tag: "students", term: p("Left owing", "बकाया छोड़कर गए"), meaning: p("A student who left the school but still owes fees. They stay in Dues marked “Left”, but are not counted in headcount.", "जो विद्यार्थी स्कूल छोड़ गए पर फीस बाकी है। वे बकाया सूची में “Left” के साथ रहते हैं, गिनती में नहीं।") },
  { tag: "marks", term: p("Sampark link", "संपर्क लिंक"), meaning: p("A personal link a teacher opens to enter marks. No password needed.", "शिक्षक का निजी लिंक, जिससे बिना पासवर्ड अंक भरे जा सकें।") },
  { tag: "attendance", term: p("Not marked (attendance)", "उपस्थिति दर्ज नहीं"), meaning: p("Attendance not taken yet for a student or class. It is never counted as present.", "जिसकी उपस्थिति अभी दर्ज नहीं हुई। उसे कभी उपस्थित नहीं माना जाता।") },
  { tag: "money", term: p("Defaulter", "बकायादार"), meaning: p("A family with fees pending past the due date. A late fee alone does not make a defaulter.", "जिस परिवार की देय तिथि निकल चुकी फीस बाकी है। केवल विलंब शुल्क से कोई बकायादार नहीं बनता।") },
  { tag: "attendance", term: p("Register", "हाज़िरी रजिस्टर"), meaning: p("One class's attendance for one day.", "एक कक्षा की एक दिन की हाज़िरी।") },
  { tag: "attendance", term: p("Substitution", "व्यवस्था"), meaning: p("A colleague covering a period for an absent teacher.", "अनुपस्थित शिक्षक की जगह कोई और पीरियड लेता है।") },
  { tag: "settings", term: p("Session", "सत्र"), meaning: p("The school year, e.g. 2026–27.", "स्कूल का वर्ष, जैसे 2026–27।") },
  { tag: "settings", term: p("Template", "टेम्पलेट"), meaning: p("A WhatsApp message WhatsApp has approved once, reused for every family.", "व्हाट्सऐप द्वारा एक बार स्वीकृत संदेश, हर परिवार के लिए।") },
  { tag: "settings", term: p("Queued", "कतार में"), meaning: p("Saved and waiting. Family messages wait in To send until a person sends each one.", "सहेजा गया और प्रतीक्षा में। परिवारों के संदेश ‘भेजने को’ में रहते हैं, जब तक कोई व्यक्ति हर एक न भेजे।") },
  { tag: "settings", term: p("Archive", "संग्रह"), meaning: p("A sealed copy of every record and document, proved by a restore check.", "सभी रिकॉर्ड और दस्तावेज़ों की मुहरबंद प्रति, जाँच से परखी हुई।") },
  { tag: "settings", term: p("Role", "भूमिका"), meaning: p("What a person may see and do. Admin always has everything; teachers never see money.", "व्यक्ति क्या देख और कर सकता है। प्रशासक सब कुछ; शिक्षक पैसा कभी नहीं।") },
];

export const GLOSSARY_TAGS: Record<GlossaryTag, { label: Pair; tone: "acc" | "info" | "warn" | "ok" | "mut" }> = {
  money: { label: p("Money", "पैसा"), tone: "acc" },
  students: { label: p("Students", "विद्यार्थी"), tone: "info" },
  marks: { label: p("Marks", "अंक"), tone: "warn" },
  attendance: { label: p("Attendance", "हाज़िरी"), tone: "ok" },
  settings: { label: p("Settings", "सेटिंग्स"), tone: "mut" },
};

export function matchesGlossary(entry: GlossaryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [entry.term.en, entry.term.hi ?? "", entry.meaning.en, entry.meaning.hi ?? ""].some((t) => t.toLowerCase().includes(q));
}

/* --------------------------------------------------------- classic screens */

export const CLASSIC_SCREENS: { href: string; label: Pair; sub: string }[] = [
  { href: "/dashboard", label: p("Dashboard", "डैशबोर्ड"), sub: "The previous home screen" },
  { href: "/fees", label: p("School Fees app", "फीस ऐप"), sub: "Every fee screen as it was" },
  { href: "/collection", label: p("Collection rounds", "जानकारी संग्रह"), sub: "Forms, review, photos" },
  { href: "/collection/messages", label: p("Message outbox", "संदेश आउटबॉक्स"), sub: "Every queued message, one by one" },
  { href: "/assessments", label: p("Assessments", "मूल्यांकन"), sub: "Papers, marks and report cards" },
  { href: "/timetable/classic", label: p("Timetable versions", "समय-सारणी संस्करण"), sub: "Imports and published versions" },
  { href: "/substitutions", label: p("Cover", "व्यवस्था"), sub: "The cover command" },
  { href: "/staff/classic", label: p("Staff list", "स्टाफ़ सूची"), sub: "Profiles and edit forms" },
  { href: "/academics", label: p("Academics", "शैक्षणिक"), sub: "Classes, subjects, class teachers" },
  { href: "/archives", label: p("Archives", "संग्रह"), sub: "Build and drill archives" },
  { href: "/jobs", label: p("Scheduled jobs", "निर्धारित कार्य"), sub: "What ran and when" },
  { href: "/preferences", label: p("Preferences", "पसंद"), sub: "Language and start screen" },
];
