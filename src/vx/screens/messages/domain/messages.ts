import { p, type Pair } from "@/vx/text";

/*
 * Messages & notices (design `Messages`). Pure: audiences, personalising a
 * notice, cost, and the counts the sent log shows. No database import.
 *
 * Nothing here sends. A family notice is queued one row per family and stops
 * there (D-10); the screen says so rather than drawing a delivery bar it
 * cannot fill.
 */

/** AiSensy charges about 88 paise a template message. */
export const PAISE_PER_MESSAGE = 88;
export const MAX_BODY = 1024;
export const MAX_TITLE = 80;

export const costPaise = (count: number): number => Math.max(0, count) * PAISE_PER_MESSAGE;
export const paiseToRupees = (paise: number): number => Math.round(paise) / 100;

export const NOTICE_KINDS = ["notice", "holiday", "ptm", "fee", "result", "staff"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const KIND_LABELS: Record<NoticeKind, Pair> = {
  notice: p("Notice", "सूचना"),
  holiday: p("Holiday", "छुट्टी"),
  ptm: p("PTM", "अभिभावक बैठक"),
  fee: p("Fee", "फीस"),
  result: p("Result", "परिणाम"),
  staff: p("Staff", "स्टाफ़"),
};

/** Each kind's icon and colours, as the design's sent log draws them. */
export const KIND_ICONS: Record<NoticeKind, "megaphone" | "flag" | "users" | "rupee" | "award" | "briefcase"> = {
  notice: "megaphone",
  holiday: "flag",
  ptm: "users",
  fee: "rupee",
  result: "award",
  staff: "briefcase",
};

export const KIND_TONES: Record<NoticeKind, "acc" | "info" | "warn" | "mut" | "ok" | "bad"> = {
  notice: "acc",
  holiday: "bad",
  ptm: "warn",
  fee: "mut",
  result: "info",
  staff: "mut",
};

export function isNoticeKind(value: unknown): value is NoticeKind {
  return typeof value === "string" && (NOTICE_KINDS as readonly string[]).includes(value);
}

export type NoticeLanguage = "both" | "hi" | "en";
export type Audience = "school" | "classes" | "staff";

/* ---------------------------------------------------------------- families */

export type RollStudent = {
  id: string;
  name: string;
  classId: string;
  classLabel: string;
  parentName: string | null;
  phone: string | null;
};

export type Family = {
  /** The guardian number, ten digits: one message per number, however many children. */
  phone: string;
  parentName: string;
  children: { id: string; name: string; classId: string; classLabel: string }[];
};

/** Ten digits, or null when the number cannot receive WhatsApp. */
export function tenDigits(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * The roll grouped into families by guardian number. Siblings share one
 * message; a child with no usable number is counted, not messaged.
 */
export function buildFamilies(students: RollStudent[]): { families: Family[]; noPhone: number } {
  const byPhone = new Map<string, Family>();
  let noPhone = 0;
  for (const s of students) {
    const phone = tenDigits(s.phone);
    if (!phone) {
      noPhone += 1;
      continue;
    }
    const family = byPhone.get(phone) ?? { phone, parentName: s.parentName?.trim() || "Parent", children: [] };
    family.children.push({ id: s.id, name: s.name, classId: s.classId, classLabel: s.classLabel });
    byPhone.set(phone, family);
  }
  return { families: [...byPhone.values()], noPhone };
}

/** Families with at least one child in the chosen classes (all of them for the whole school). */
export function familiesFor(families: Family[], audience: Audience, classIds: readonly string[]): Family[] {
  if (audience === "school") return families;
  if (audience !== "classes") return [];
  const wanted = new Set(classIds);
  return families.filter((f) => f.children.some((c) => wanted.has(c.classId)));
}

/** How many families a choice of classes reaches, from class-id sets only (no names leave the server). */
export function countFamilies(classSets: readonly (readonly string[])[], audience: Audience, classIds: readonly string[], staffCount: number): number {
  if (audience === "staff") return staffCount;
  if (audience === "school") return classSets.length;
  const wanted = new Set(classIds);
  return classSets.filter((set) => set.some((id) => wanted.has(id))).length;
}

/* ----------------------------------------------------------- personalising */

export const PLACEHOLDERS = ["{parent}", "{student}", "{class}", "{date}"] as const;

export type Personal = { parent: string; student: string; className: string; date: string };

/** The fields one family's copy fills in. With classes chosen, the child in those classes leads. */
export function personalFor(family: Family, classIds: readonly string[], date: string): Personal {
  const wanted = new Set(classIds);
  const lead = family.children.find((c) => wanted.has(c.classId)) ?? family.children[0];
  const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
  return {
    parent: family.parentName,
    student: lead ? firstName(lead.name) : "",
    className: lead?.classLabel ?? "",
    date,
  };
}

export function fill(text: string, personal: Personal): string {
  return text
    .replaceAll("{parent}", personal.parent)
    .replaceAll("{student}", personal.student)
    .replaceAll("{class}", personal.className)
    .replaceAll("{date}", personal.date);
}

/** Bold title, then the body in the chosen language(s), then the school's sign-off. */
export function composeText(input: { title: string; hi: string; en: string; language: NoticeLanguage }, personal: Personal): { hi: string; en: string } {
  const title = input.title.trim();
  const withTitle = (body: string) => (title ? `*${title}*\n${body}` : body);
  const hi = input.language === "en" ? "" : withTitle(fill(input.hi.trim(), personal));
  const en = input.language === "hi" ? "" : input.language === "en" ? withTitle(fill(input.en.trim(), personal)) : fill(input.en.trim(), personal);
  return { hi, en };
}

/** The one string the `{{1}}` template carries for a row. */
export function messageVariable(rendered: { hi: string; en: string }): string {
  return [rendered.hi, rendered.en].filter(Boolean).join("\n\n");
}

/** Placeholders that are not one of the four this screen fills — a typo like {nmae}. */
export function unknownPlaceholders(text: string): string[] {
  const found = text.match(/\{[^{}\s]{1,20}\}/g) ?? [];
  return [...new Set(found.filter((t) => !(PLACEHOLDERS as readonly string[]).includes(t)))];
}

export type ComposeInput = {
  kind: NoticeKind;
  title: string;
  hi: string;
  en: string;
  language: NoticeLanguage;
  audience: Audience;
  classIds: string[];
};

export type ComposeProblem = "title" | "hi" | "en" | "classes" | "too_long" | "placeholder";

export const COMPOSE_PROBLEMS: Record<ComposeProblem, Pair> = {
  title: p("Write a short title.", "छोटा शीर्षक लिखें।"),
  hi: p("Write the message in Hindi.", "संदेश हिंदी में लिखें।"),
  en: p("Write the message in English.", "संदेश अंग्रेज़ी में लिखें।"),
  classes: p("Pick at least one class.", "कम से कम एक कक्षा चुनें।"),
  too_long: p(`Keep each message under ${MAX_BODY} letters.`, `संदेश ${MAX_BODY} अक्षरों से छोटा रखें।`),
  placeholder: p("A {…} word is not one we can fill. Use {parent}, {student}, {class} or {date}.", "{…} शब्द भरा नहीं जा सकता।"),
};

/** What stops a notice from being queued, first problem first. Empty when it can go. */
export function composeProblems(input: ComposeInput): ComposeProblem[] {
  const out: ComposeProblem[] = [];
  if (!input.title.trim() || input.title.trim().length > MAX_TITLE) out.push("title");
  if (input.language !== "en" && !input.hi.trim()) out.push("hi");
  if (input.language !== "hi" && !input.en.trim()) out.push("en");
  if (input.audience === "classes" && input.classIds.length === 0) out.push("classes");
  if (input.hi.length > MAX_BODY || input.en.length > MAX_BODY) out.push("too_long");
  if (unknownPlaceholders(`${input.hi} ${input.en}`).length) out.push("placeholder");
  return out;
}

/* ----------------------------------------------------------- the sent log */

export type SendCounts = { total: number; queued: number; sent: number; failed: number; cancelled: number };

/**
 * Counts per recipient, newest row wins: a resend appends a new row rather
 * than rewriting the failed one, so a number with a failed row and a newer
 * queued row is queued.
 */
export function latestByRecipient<T extends { to_phone: string; status: string; requested_at: string }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const seen = latest.get(row.to_phone);
    if (!seen || row.requested_at > seen.requested_at) latest.set(row.to_phone, row);
  }
  return [...latest.values()];
}

export function countSends(rows: { status: string }[]): SendCounts {
  const counts: SendCounts = { total: rows.length, queued: 0, sent: 0, failed: 0, cancelled: 0 };
  for (const row of rows) {
    if (row.status === "queued" || row.status === "draft") counts.queued += 1;
    else if (row.status === "sent") counts.sent += 1;
    else if (row.status === "failed") counts.failed += 1;
    else if (row.status === "cancelled") counts.cancelled += 1;
  }
  return counts;
}

/** "This week" (last seven days) or "Earlier", as the sent log groups notices. */
export function logBucket(createdAt: string, now: Date = new Date()): "week" | "earlier" {
  const age = now.getTime() - new Date(createdAt).getTime();
  return age < 7 * 24 * 3600 * 1000 ? "week" : "earlier";
}

/* --------------------------------------------------------------- templates */

/** "Unit test datesheet" → "unit_test_datesheet", as WhatsApp names templates. */
export function templateSlug(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * A template written with named fields, in the numbered form WhatsApp wants:
 * "Dear {parent}, {student}…" → "Dear {{1}}, {{2}}…" and ["parent", "student"].
 * The same name gets the same number in both languages.
 */
export function numberPlaceholders(hi: string, en: string): { hi: string; en: string; variables: string[] } {
  const variables: string[] = [];
  const swap = (text: string) =>
    text.replace(/\{(parent|student|class|date|amount)\}/g, (_m, name: string) => {
      let index = variables.indexOf(name);
      if (index < 0) {
        variables.push(name);
        index = variables.length - 1;
      }
      return `{{${index + 1}}}`;
    });
  const outHi = swap(hi);
  const outEn = swap(en);
  return { hi: outHi, en: outEn, variables };
}

export type TemplateState = "approved" | "waiting" | "off";

export function templateState(row: { isActive: boolean; waCategory: string | null }): TemplateState {
  if (row.isActive) return "approved";
  return row.waCategory ? "waiting" : "off";
}

export const TEMPLATE_STATE_LABELS: Record<TemplateState, Pair> = {
  approved: p("Ready to use", "उपयोग के लिए तैयार"),
  waiting: p("Waiting for WhatsApp approval", "व्हाट्सऐप स्वीकृति बाकी"),
  off: p("Turned off", "बंद"),
};

/* ----------------------------------------------------------------- replies */

export const QUICK_REPLIES: Pair[] = [
  p("Thank you, we got your message.", "धन्यवाद, आपका संदेश मिल गया।"),
  p("The class teacher will call you.", "कक्षा अध्यापक आपको कॉल करेंगे।"),
  p("Okay, we have noted your time.", "ठीक है, आपका समय नोट कर लिया है।"),
  p("Please visit the office between 9 am and 2 pm.", "कृपया कार्यालय में 9 से 2 बजे के बीच आएँ।"),
];

/** A quick reply as one message: Hindi first, then English. */
export function quickReplyText(pair: Pair): string {
  return pair.hi ? `${pair.hi}\n${pair.en}` : pair.en;
}

export type ReplyFilter = "open" | "unassigned" | "done";

export function matchesReply(row: { status: string; assignedStaffId: string | null }, filter: ReplyFilter): boolean {
  if (filter === "done") return row.status === "done";
  if (filter === "unassigned") return row.status === "open" && !row.assignedStaffId;
  return row.status === "open";
}
