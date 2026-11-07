import { byClassLabel } from "@/modules/academics/domain/class-order";
import { dayLabel } from "@/platform/dates";
import type { TaskKind, TaskSummary } from "./tasks";

/*
 * Collecting from teachers, the Sampark way (D-520). Pure: the office board,
 * the send list and the WhatsApp words are all decided here, so a test can
 * read them without a database or a browser.
 *
 * The board answers three questions an office person actually has:
 *   1. Who still needs their link?      (never sent, never opened)
 *   2. Who should I remind today?       (has the link, still pending, not reminded today)
 *   3. What have teachers sent me?      (answers waiting for a check)
 */

/** A message row as the board reads it: one per send attempt, newest wins nothing. */
export type SendRecord = { taskId: string; state: string | null; round: string | null; at: string | null };

/** What the office has done about telling one teacher. `lastDay` is the school day of the last message. */
export type Told = { sent: boolean; remindedToday: boolean; check: boolean; lastAt: string | null; lastDay: string | null };

const DELIVERED = new Set(["manual_opened", "accepted", "human_confirmed"]);
const SCHOOL_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

/** The day at school (Amet) an instant fell on. */
export function schoolDayOf(at: string | null): string | null {
  if (!at) return null;
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? null : SCHOOL_DAY.format(when);
}

/**
 * Whether a teacher has been told, from the task's message rows. `check` is a
 * provider result nobody knows yet: the app refuses another send until a
 * person looks (the reconcile step on the task's own sheet), so the board
 * must not offer one either.
 */
export function toldOf(records: readonly SendRecord[], today: string): Told {
  let lastAt: string | null = null;
  let sent = false;
  let remindedToday = false;
  let check = false;
  for (const r of records) {
    if (r.state === "unknown") check = true;
    if (!r.state || !DELIVERED.has(r.state)) continue;
    sent = true;
    if (r.round === `reminder:${today}`) remindedToday = true;
    if (r.at && (!lastAt || r.at > lastAt)) lastAt = r.at;
  }
  return { sent, remindedToday, check, lastAt, lastDay: schoolDayOf(lastAt) };
}

/** One teacher's share of an ask, with what the office has done about it. */
export type BoardTask = TaskSummary & { told: Told; group: string | null };

/** Where one teacher stands, in the order the office acts on it. */
export type TeacherStep = "reassign" | "check" | "to-approve" | "not-sent" | "sent" | "opened" | "started" | "done";

export function teacherStep(t: BoardTask): TeacherStep {
  if (t.state === "to-assign") return "reassign";
  if (t.state === "complete") return "done";
  if (t.told.check) return "check";
  if (t.state === "to-approve") return "to-approve";
  if (t.answered > 0) return "started";
  if (t.openedAt) return "opened";
  return t.told.sent ? "sent" : "not-sent";
}

const STEP_ORDER: TeacherStep[] = ["reassign", "check", "to-approve", "not-sent", "sent", "opened", "started", "done"];

/** Still owes the link: waiting, never told, never opened, nothing unresolved. */
export function needsLink(t: BoardTask): boolean {
  return t.state === "waiting" && !t.told.sent && !t.openedAt && !t.told.check;
}

/**
 * Has the link, has not finished, and nobody has nudged them today. A link
 * sent this morning is not a reminder yet: it waits a day, unless the work is
 * due today or already late.
 */
export function needsReminder(t: BoardTask, today: string): boolean {
  if (t.state !== "waiting" || t.told.check || t.told.remindedToday || !(t.told.sent || t.openedAt)) return false;
  return !t.told.lastDay || t.told.lastDay < today || (!!t.dueDate && t.dueDate <= today);
}

/** Something on this teacher's work is waiting for the office. */
export function needsOffice(t: BoardTask, today: string): boolean {
  return t.state === "to-assign" || t.told.check || needsLink(t) || needsReminder(t, today) || answersToCheck(t) > 0;
}

/** Answers a teacher sent that nobody has accepted or sent back yet. */
export function answersToCheck(t: BoardTask): number {
  if (t.kind !== "collection" || t.state === "revoked") return 0;
  return Math.max(0, t.answered - (t.approved ?? 0) - (t.rejected ?? 0));
}

export function isLate(t: BoardTask, today: string): boolean {
  return (t.state === "waiting" || t.state === "to-assign") && !!t.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) && t.dueDate < today;
}

export type CollectCounts = { toSend: string[]; toRemind: string[]; answers: number; late: number; open: number; attention: number };

/** The three next steps, as the task ids each one acts on. */
export function collectCounts(tasks: readonly BoardTask[], today: string): CollectCounts {
  const live = tasks.filter((t) => t.state !== "revoked");
  return {
    toSend: live.filter(needsLink).map((t) => t.id),
    toRemind: live.filter((t) => needsReminder(t, today)).map((t) => t.id),
    answers: live.reduce((sum, t) => sum + answersToCheck(t), 0),
    late: live.filter((t) => isLate(t, today)).length,
    open: live.filter((t) => t.state !== "complete").length,
    attention: live.filter((t) => needsOffice(t, today)).length,
  };
}

/** One request the office made: every teacher who got a part of it. */
export type Ask = {
  key: string;
  kind: TaskKind;
  title: string;
  dueDate: string | null;
  createdAt: string | null;
  tasks: BoardTask[];
  done: number;
  answered: number;
  expected: number;
  finished: boolean;
  toSend: string[];
  toRemind: string[];
};

/**
 * Tasks made by one press of "Give work" share their title, kind and the
 * moment they were written (one transaction, one `now()`), so that is what
 * groups them back into the request the office remembers making.
 */
export function groupAsks(tasks: readonly BoardTask[], today: string): Ask[] {
  const asks = new Map<string, Ask>();
  for (const t of tasks) {
    if (t.state === "revoked") continue;
    const key = `${t.kind}|${t.title}|${t.createdAt ?? t.id}`;
    const ask = asks.get(key) ?? { key, kind: t.kind, title: t.title, dueDate: t.dueDate, createdAt: t.createdAt ?? null, tasks: [], done: 0, answered: 0, expected: 0, finished: false, toSend: [], toRemind: [] };
    ask.tasks.push(t);
    if (t.state === "complete") ask.done += 1;
    ask.answered += t.answered;
    ask.expected += t.expected;
    if (needsLink(t)) ask.toSend.push(t.id);
    if (needsReminder(t, today)) ask.toRemind.push(t.id);
    if (t.dueDate && (!ask.dueDate || t.dueDate < ask.dueDate)) ask.dueDate = t.dueDate;
    asks.set(key, ask);
  }
  const list = [...asks.values()];
  for (const ask of list) {
    ask.finished = ask.done === ask.tasks.length;
    ask.tasks.sort((a, b) => STEP_ORDER.indexOf(teacherStep(a)) - STEP_ORDER.indexOf(teacherStep(b)) || (a.teacherName ?? "").localeCompare(b.teacherName ?? "") || byClassLabel(a.group ?? "", b.group ?? ""));
  }
  const newest = (a: Ask, b: Ask) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  return [...list.filter((a) => !a.finished).sort(newest), ...list.filter((a) => a.finished).sort(newest)];
}

/* ---------------------------------------------------------------- phones */

/**
 * The ten digits WhatsApp needs, by the database's own rule
 * (`teacher_task_delivery_snapshot`): the WhatsApp number when there is one,
 * else the phone; +91 and a leading 0 dropped; a mobile starts 6–9.
 */
export function indianMobile(whatsapp: string | null | undefined, phone?: string | null): string | null {
  const raw = whatsapp?.trim() ? whatsapp : phone ?? "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** A click-to-chat link with the message typed in; nothing is sent until the office presses Send. */
export function whatsappLink(mobile: string, text: string): string {
  return `https://wa.me/91${mobile}?text=${encodeURIComponent(text)}`;
}

/* -------------------------------------------------------------- messages */

export type MessageLanguage = "hi" | "en" | "both";
export type TeacherMessage = {
  kind: "initial" | "reminder";
  language: MessageLanguage;
  teacherName: string;
  work: TaskKind;
  title: string;
  students: number;
  fields: { en: string; hi: string }[];
  answered: number;
  expected: number;
  due: string | null;
  url: string;
  today?: string;
};

const SIGN_OFF = { en: "— Veer Patta School office", hi: "— वीर पत्ता विद्यालय कार्यालय" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "9 November" / "9 नवंबर"; a title that is a bare date reads as one. */
function day(iso: string, lang: "en" | "hi"): string {
  return ISO.test(iso) ? dayLabel(iso)[lang] : iso;
}

/** One message per teacher, in the teacher's own language; "both" is English line over Hindi line. */
export function teacherMessage(m: TeacherMessage): string {
  const lines: { en: string; hi: string }[] = [];
  const add = (en: string, hi: string) => lines.push({ en, hi });
  const blank = () => lines.push({ en: "", hi: "" });
  const title = { en: m.work === "attendance" ? day(m.title, "en") : m.title, hi: m.work === "attendance" ? day(m.title, "hi") : m.title };
  add(`Namaste ${m.teacherName},`, `नमस्ते ${m.teacherName} जी,`);
  blank();
  if (m.kind === "initial") {
    if (m.work === "marks") add(`Please enter the marks: ${title.en}`, `कृपया अंक भरें: ${title.hi}`);
    else if (m.work === "attendance") add(`Please mark attendance for ${title.en}.`, `कृपया ${title.hi} की उपस्थिति लगाएँ।`);
    else add(`Please fill in: ${title.en}`, `कृपया भरें: ${title.hi}`);
    // The details asked for, unless the title already is that list.
    const asked = { en: m.fields.map((f) => f.en).join(", "), hi: m.fields.map((f) => f.hi || f.en).join(", ") };
    const say = (lang: "en" | "hi") => (asked[lang] && asked[lang].toLowerCase() !== title[lang].toLowerCase() ? asked[lang] : "");
    const children = m.students > 0;
    if (children || say("en") || say("hi")) {
      add(
        [children ? `${m.students} ${m.students === 1 ? "child" : "children"}` : "", say("en")].filter(Boolean).join(" · "),
        [children ? `${m.students} बच्चे` : "", say("hi")].filter(Boolean).join(" · "),
      );
    }
  } else {
    if (m.work === "attendance") add(`Reminder: attendance for ${title.en} is still pending.`, `याद दिला रहे हैं: ${title.hi} की उपस्थिति अभी बाकी है।`);
    else add(`Reminder: ${title.en} is still pending.`, `याद दिला रहे हैं: ${title.hi} अभी बाकी है।`);
    if (m.expected > 0) {
      if (m.answered > 0) add(`${m.answered} of ${m.expected} done so far — thank you.`, `${m.expected} में से ${m.answered} हो गए — धन्यवाद।`);
      else add("Not started yet.", "अभी शुरू नहीं हुआ।");
    }
  }
  if (m.due && ISO.test(m.due)) {
    const late = m.kind === "reminder" && m.today && m.due < m.today;
    add(late ? `It was due on ${day(m.due, "en")}.` : `Please finish by ${day(m.due, "en")}.`, late ? `अंतिम तिथि ${day(m.due, "hi")} थी।` : `${day(m.due, "hi")} तक पूरा करें।`);
  }
  blank();
  add("Open your list here (no login needed):", "अपनी सूची यहाँ खोलें (लॉगिन की ज़रूरत नहीं):");
  const out: string[] = [];
  for (const line of lines) {
    if (!line.en && !line.hi) { out.push(""); continue; }
    if (m.language !== "hi" && line.en) out.push(line.en);
    if (m.language !== "en" && line.hi) out.push(line.hi);
  }
  out.push(m.url, "", m.language === "en" ? SIGN_OFF.en : m.language === "hi" ? SIGN_OFF.hi : `${SIGN_OFF.en} · ${SIGN_OFF.hi.slice(2)}`);
  return out.join("\n");
}

/* ------------------------------------------------------------ the asking */

export type FieldChoice = { id: string; key: string; labelEn: string; labelHi: string };
export type ChildValues = { id: string; classId: string; values: Record<string, string | null> };

/** How many of these children are missing each detail; the photograph is just another detail. */
export function missingByField(children: readonly ChildValues[], fields: readonly FieldChoice[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) out[f.id] = children.reduce((n, c) => n + (c.values[f.key] ? 0 : 1), 0);
  return out;
}

/** Children missing at least one of the chosen details. */
export function missingAny(children: readonly ChildValues[], fields: readonly FieldChoice[]): string[] {
  return children.filter((c) => fields.some((f) => !c.values[f.key])).map((c) => c.id);
}

/** A name for the work from what it asks for, cut to the 120 the database keeps. */
export function autoTitle(fields: readonly FieldChoice[], language: "en" | "hi"): string {
  const names = fields.map((f) => (language === "hi" ? f.labelHi || f.labelEn : f.labelEn));
  const title = names.join(", ");
  return title.length <= 120 ? title : `${title.slice(0, 117)}…`;
}
