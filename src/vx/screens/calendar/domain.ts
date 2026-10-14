import type { IconName } from "@/vx/icons";
import { addDays, monthRange } from "@/vx/screens/academics/domain";
import { p, type Pair } from "@/vx/text";

/* Pure rules for the school calendar (tests/vx-calendar.test.ts). */

export type CalEvent = {
  id: string;
  kind: string;
  title: string;
  titleHi: string | null;
  startsOn: string;
  endsOn: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  place: string | null;
  classIds: string[];
  details: string | null;
  createdBy: string | null;
  cancelled: boolean;
};

export type CalHoliday = { id: string; day: string; kind: string; label: string | null; labelHi: string | null };

export const EVENT_KINDS = ["holiday", "exam", "event", "ptm", "meeting", "fee_due"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function asKind(kind: string): EventKind {
  return (EVENT_KINDS as readonly string[]).includes(kind) ? (kind as EventKind) : kind === "vacation" ? "holiday" : "event";
}

export type GridDay = { day: string; inMonth: boolean; weekday: number };

/** The month as Monday-first weeks, padded with the neighbouring months' days. */
export function monthWeeks(month: string): GridDay[][] {
  const { first, last } = monthRange(month);
  const dow = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  let start = addDays(first, -dow(first));
  const end = addDays(last, 6 - dow(last));
  const weeks: GridDay[][] = [];
  while (start <= end) {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      week.push({ day, inMonth: day.slice(0, 7) === month, weekday: i });
    }
    weeks.push(week);
    start = addDays(start, 7);
  }
  return weeks;
}

/** Events on a day, timed ones in time order after the all-day ones. */
export function eventsOn(events: CalEvent[], day: string): CalEvent[] {
  return events
    .filter((e) => !e.cancelled && e.startsOn <= day && e.endsOn >= day)
    .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || (a.startsAt ?? "").localeCompare(b.startsAt ?? "") || a.title.localeCompare(b.title));
}

/** School days in a month: not Sunday, not a holiday or vacation. */
export function schoolDays(month: string, closed: Set<string>): number {
  const { first, last } = monthRange(month);
  let n = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const sunday = new Date(`${d}T12:00:00Z`).getUTCDay() === 0;
    if (!sunday && !closed.has(d)) n += 1;
  }
  return n;
}

/** Count per kind for the legend chips; holidays counted from the calendar days. */
export function kindCounts(events: CalEvent[], holidays: CalHoliday[]): Record<string, number> {
  const out: Record<string, number> = { holiday: holidays.filter((h) => h.kind === "holiday" || h.kind === "vacation").length };
  for (const e of events) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}

/** "Mon 5 Oct – Fri 9 Oct", "Sat 17 Oct · 12:00–13:30". */
export function whenLabel(e: Pick<CalEvent, "startsOn" | "endsOn" | "allDay" | "startsAt" | "endsAt">, fmt: (day: string) => string): string {
  const days = e.startsOn === e.endsOn ? fmt(e.startsOn) : `${fmt(e.startsOn)} – ${fmt(e.endsOn)}`;
  if (e.allDay || !e.startsAt) return days;
  return `${days} · ${e.startsAt}${e.endsAt ? `–${e.endsAt}` : ""}`;
}

export type HolidayRun = { from: string; to: string; kind: string; label: string | null; labelHi: string | null; days: number };

/** Consecutive closed days with the same name, folded into one run ("Diwali break, 20–24 Oct"). */
export function holidayRuns(holidays: CalHoliday[]): HolidayRun[] {
  const sorted = [...holidays].filter((h) => h.kind === "holiday" || h.kind === "vacation").sort((a, b) => a.day.localeCompare(b.day));
  const runs: HolidayRun[] = [];
  for (const h of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.label === h.label && addDays(last.to, 1) === h.day) {
      last.to = h.day;
      last.days += 1;
      if (h.kind === "vacation") last.kind = "vacation";
      continue;
    }
    runs.push({ from: h.day, to: h.day, kind: h.kind, label: h.label, labelHi: h.labelHi, days: 1 });
  }
  return runs;
}

/** The twelve months of a session, April to March, from its first year ("2026-27", "TEST-2026-27"). */
export function sessionMonths(label: string, fallback: string): string[] {
  const year = Number(/(\d{4})/.exec(label)?.[1] ?? fallback.slice(0, 4));
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = 3 + i;
    out.push(`${year + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Whether a reader scoped to some classes sees an event: whole-school events, or one of theirs. */
export function visibleTo(e: Pick<CalEvent, "classIds">, everyClass: boolean, classIds: Set<string>): boolean {
  return everyClass || e.classIds.length === 0 || e.classIds.some((id) => classIds.has(id));
}

/* ---------------------------------------------------------------- dates */

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const MON_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

function parts(day: string): { y: number; m: number; d: number; w: number } {
  const t = new Date(`${day}T12:00:00Z`);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), w: t.getUTCDay() };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return parts(day).w;
}

/** "Thu 8 Oct". */
export function dayShort(day: string): string {
  const x = parts(day);
  return `${WD[x.w]} ${x.d} ${MON[x.m]}`;
}

/** "Thursday 8 October". */
export function dayLong(day: string): string {
  const x = parts(day);
  return `${WD_LONG[x.w]} ${x.d} ${MON_LONG[x.m]}`;
}

/** "गुरुवार, 8 अक्टूबर". */
export function dayHi(day: string): string {
  const x = parts(day);
  return `${WD_HI[x.w]}, ${x.d} ${MON_HI[x.m]}`;
}

/** A day as a pair: "Thu 8 Oct" / "गुरुवार, 8 अक्टूबर". */
export function dayPair(day: string, long = false): Pair {
  return p(long ? dayLong(day) : dayShort(day), dayHi(day));
}

/** "Oct". */
export function monShort(day: string): string {
  return MON[parts(day).m];
}

/** "October 2026" / "अक्टूबर 2026". */
export function monthTitle(month: string): Pair {
  const x = parts(`${month}-15`);
  return p(`${MON_LONG[x.m]} ${x.y}`, `${MON_HI[x.m]} ${x.y}`);
}

/** Whole days from `a` to `b`. */
export function daysApart(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** "Today", "Tomorrow", "In 9 days", "3 days ago". */
export function relDay(day: string, today: string): Pair {
  const n = daysApart(today, day);
  if (n === 0) return p("Today", "आज");
  if (n === 1) return p("Tomorrow", "कल");
  if (n === -1) return p("Yesterday", "बीता कल");
  return n > 0 ? p(`In ${n} days`, `${n} दिन बाद`) : p(`${-n} days ago`, `${-n} दिन पहले`);
}

function minutes(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "13:30" → "1:30 pm". */
export function time12(t: string | null | undefined): string {
  const x = minutes(t);
  if (x === null) return "";
  const h = Math.floor(x / 60) % 24;
  return `${h % 12 || 12}:${String(x % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "13:30" → "दोपहर 1:30 बजे". */
export function timeHi(t: string | null | undefined): string {
  const x = minutes(t);
  if (x === null) return "";
  const h = Math.floor(x / 60) % 24;
  return `${h < 12 ? "सुबह" : h < 16 ? "दोपहर" : "शाम"} ${h % 12 || 12}:${String(x % 60).padStart(2, "0")} बजे`;
}

/** "10:00" plus 180 minutes → "13:00". */
export function addMinutes(t: string, n: number): string {
  const x = ((minutes(t) ?? 0) + n + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}

/** Minutes from one time to another (end before start counts as zero). */
export function minutesBetween(from: string | null | undefined, to: string | null | undefined): number {
  const a = minutes(from);
  const b = minutes(to);
  return a === null || b === null ? 0 : Math.max(0, b - a);
}

/** "2026-27" → "2026–27"; a prefixed label keeps its prefix. */
export function sessionText(label: string): string {
  return label.replace(/(\d{4})-(\d{2})$/, "$1–$2");
}

/* ---------------------------------------------------------------- kinds */

export type KindStyle = {
  label: Pair;
  /** Bar, dot and accent colour. */
  c: string;
  /** Soft fill. */
  s: string;
  /** Text on the soft fill. */
  f: string;
  icon: IconName;
  /** What the kind is called inside a Hindi notice. */
  noun: string;
  /** The closing line of a notice. */
  close: Pair;
};

/** The design's six kinds (Calendar `TY`): one colour per meaning, everywhere on the calendar. */
export const KIND_STYLE: Record<EventKind, KindStyle> = {
  holiday: { label: p("Holiday", "अवकाश"), c: "var(--bad)", s: "var(--bads)", f: "var(--bad)", icon: "flag", noun: "अवकाश", close: p("", "") },
  exam: { label: p("Exam", "परीक्षा"), c: "var(--info)", s: "var(--infos)", f: "var(--info)", icon: "clipboard", noun: "परीक्षा", close: p("Please help your child prepare.", "कृपया बच्चे की तैयारी में सहयोग करें।") },
  event: { label: p("Event", "कार्यक्रम"), c: "var(--acc)", s: "var(--accs)", f: "var(--accfg)", icon: "star", noun: "कार्यक्रम", close: p("Please note the date.", "कृपया तारीख नोट कर लें।") },
  ptm: { label: p("PTM", "अभिभावक बैठक"), c: "var(--warn)", s: "var(--warns)", f: "var(--warnfg)", icon: "users", noun: "अभिभावक-शिक्षक बैठक", close: p("Please be on time.", "कृपया समय पर पधारें।") },
  meeting: { label: p("Meeting", "बैठक"), c: "var(--pri)", s: "var(--s3)", f: "var(--fg)", icon: "briefcase", noun: "बैठक", close: p("Please be on time.", "कृपया समय पर पहुँचें।") },
  fee_due: { label: p("Fee due", "फीस देय"), c: "var(--sub)", s: "var(--s3)", f: "var(--mut)", icon: "rupee", noun: "शुल्क", close: p("Please pay on time.", "कृपया समय पर शुल्क जमा करें।") },
};

export function kindStyle(kind: string): KindStyle {
  return KIND_STYLE[asKind(kind)];
}

/* -------------------------------------------------------------- notices */

export type NoticeAudience = "parents" | "staff" | "both";

/** The first school day after a closure: the next day, or Monday when that is a Sunday. */
export function reopensOn(lastDay: string): string {
  const next = addDays(lastDay, 1);
  return weekdayOf(next) === 0 ? addDays(next, 1) : next;
}

function greet(audience: NoticeAudience): Pair {
  return audience === "staff" ? p("Dear colleagues,", "प्रिय साथियों,") : p("Dear parent,", "प्रिय अभिभावक,");
}

/** The notice for a holiday or a break, Hindi first (Calendar `msg`). */
export function holidayNotice(label: string, labelHi: string | null, from: string, to: string = from, audience: NoticeAudience = "parents"): Pair {
  const g = greet(audience);
  const range = to !== from;
  const back = reopensOn(to);
  const whenHi = range ? `${dayHi(from)} से ${dayHi(to)} तक` : `${dayHi(from)} को`;
  const whenEn = range ? `from ${dayShort(from)} to ${dayShort(to)}` : `on ${dayShort(from)}`;
  return p(
    `${g.en} school will be closed ${whenEn} for ${label}. School opens as usual on ${dayShort(back)}.`,
    `${g.hi} ${labelHi || label} के अवसर पर ${whenHi} विद्यालय बंद रहेगा। ${dayHi(back)} से विद्यालय सामान्य समय पर खुलेगा।`,
  );
}

/** The notice for an event, exam, PTM, meeting or fee date, Hindi first (Calendar `msg`). */
export function eventNotice(e: Pick<CalEvent, "kind" | "title" | "titleHi" | "startsOn" | "endsOn" | "allDay" | "startsAt" | "place">, audience: NoticeAudience = "parents"): Pair {
  if (asKind(e.kind) === "holiday") return holidayNotice(e.title, e.titleHi, e.startsOn, e.endsOn, audience);
  const k = kindStyle(e.kind);
  const g = greet(audience);
  const range = e.endsOn !== e.startsOn;
  const timed = !e.allDay && !!e.startsAt;
  const place = (e.place ?? "").trim();
  const whenHi = range ? `${dayHi(e.startsOn)} से ${dayHi(e.endsOn)} तक` : `${dayHi(e.startsOn)} को`;
  const whenEn = range ? `from ${dayShort(e.startsOn)} to ${dayShort(e.endsOn)}` : `on ${dayShort(e.startsOn)}`;
  return p(
    `${g.en} ${e.title} is ${whenEn}${timed ? ` at ${time12(e.startsAt)}` : ""}${place ? `, ${place}` : ""}. ${k.close.en}`,
    `${g.hi} विद्यालय में ${k.noun} “${e.titleHi || e.title}” का आयोजन ${whenHi}${timed ? ` ${timeHi(e.startsAt)}` : ""}${place ? `, ${place} में` : ""} किया जाएगा। ${k.close.hi}`,
  );
}

/** Where a notice stands. Nothing here sends: approval makes a To send list a person sends by hand (UI-67, UI-71). */
export type Told =
  | { state: "none" }
  | { state: "asked"; n: number }
  | { state: "approved"; n: number; sent: number; waiting: number; notSent: number }
  | { state: "declined"; n: number };

export type NoticeCounts = { total: number; sent: number; waiting: number; notSent: number };

export function toldOf(notice: { status: string; recipients: number } | null | undefined, counts?: NoticeCounts | null): Told {
  if (!notice) return { state: "none" };
  if (notice.status === "awaiting_approval") return { state: "asked", n: notice.recipients };
  if (notice.status === "cancelled") return { state: "declined", n: notice.recipients };
  const total = counts?.total || notice.recipients;
  const sent = counts?.sent ?? (notice.status === "sent" ? total : 0);
  const notSent = counts?.notSent ?? 0;
  return { state: "approved", n: total, sent, notSent, waiting: Math.max(0, counts?.waiting ?? total - sent - notSent) };
}

/** The small pill on an event row or a holiday row. */
export function toldBadge(t: Told, short = false): { text: Pair; tone: "ok" | "warn" | "bad" | "info" } | null {
  if (t.state === "asked") return { text: short ? p("Saved, not sent", "सहेजी, भेजी नहीं") : p(`Saved, not sent · ${t.n}`, `सहेजी, भेजी नहीं · ${t.n}`), tone: "warn" };
  if (t.state === "declined") return { text: p("Notice turned down", "सूचना अस्वीकृत"), tone: "bad" };
  if (t.state === "approved") {
    if (t.sent === 0) return { text: short ? p("In To send", "भेजने को में") : p(`In To send · ${t.n}`, `भेजने को में · ${t.n}`), tone: "info" };
    if (short) return { text: p("Told", "बताया"), tone: "ok" };
    return { text: t.sent >= t.n ? p(`Told ${t.n}`, `${t.n} को बताया`) : p(`Told ${t.sent} of ${t.n}`, `${t.n} में से ${t.sent} को बताया`), tone: "ok" };
  }
  return null;
}

/* ----------------------------------------------------------- attendance */

/** What the register says about one day, for the reader's classes. */
export type AttendanceFacts = {
  /** Classes whose register is saved. */
  marked: number;
  classes: number;
  /** Children marked present or late in saved registers. */
  present: number;
  /** Children whose day counts in saved registers. */
  counted: number;
  /** Children on the roll of every class in scope. */
  roll: number;
  /** Classes not saved yet, by name. */
  notMarked: string[];
};

export type AttendanceLine = {
  state: "closed" | "future" | "live";
  tone: "mut" | "warn" | "ok";
  icon: IconName;
  pill: Pair;
  line: Pair;
  sub: Pair;
  /** Width of the bar, 0–100: present out of everyone on the roll; unmarked is never present. */
  bar: number | null;
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function attendanceLine(day: string, today: string, closedFor: Pair | null, facts: AttendanceFacts | null): AttendanceLine {
  const sunday = weekdayOf(day) === 0;
  if (closedFor || sunday) {
    const why = closedFor ?? p("Sunday", "रविवार");
    return { state: "closed", tone: "mut", icon: "moon", pill: p("Closed", "बंद"), line: p("School closed", "विद्यालय बंद"), sub: p(`${why.en} · no attendance`, `${why.hi ?? why.en} · हाज़िरी नहीं`), bar: null };
  }
  if (day > today || !facts || facts.classes === 0) {
    return { state: "future", tone: "mut", icon: "clock", pill: p("Not yet", "अभी नहीं"), line: p("Attendance is marked on the day", "हाज़िरी उसी दिन लगती है"), sub: p("Class teachers mark it that morning.", "कक्षा अध्यापक उसी सुबह लगाते हैं।"), bar: null };
  }
  const bar = facts.roll ? Math.round((facts.present / facts.roll) * 1000) / 10 : 0;
  if (facts.marked >= facts.classes) {
    const pctAll = facts.counted ? Math.round((facts.present / facts.counted) * 100) : 0;
    return {
      state: "live",
      tone: "ok",
      icon: "calCheck",
      pill: p("All marked", "सब दर्ज"),
      line: p(`${facts.present} of ${facts.counted} present · ${pctAll}%`, `${facts.counted} में से ${facts.present} उपस्थित · ${pctAll}%`),
      sub: p(`All ${facts.classes} classes marked.`, `सभी ${facts.classes} कक्षाएँ दर्ज।`),
      bar,
    };
  }
  const so = day === today ? " so far" : "";
  const missing = facts.notMarked.length;
  const who = missing <= 3 ? joinNames(facts.notMarked) : `${missing} classes`;
  return {
    state: "live",
    tone: "warn",
    icon: "calCheck",
    pill: p(`${facts.marked} of ${facts.classes} marked`, `${facts.classes} में से ${facts.marked} दर्ज`),
    line: p(`${facts.present} present${so} · ${facts.marked} of ${facts.classes} classes marked`, `${facts.present} उपस्थित · ${facts.classes} में से ${facts.marked} कक्षाएँ दर्ज`),
    sub: p(`${who} ${missing === 1 ? "is" : "are"} not marked yet — they are not counted as present.`, `${missing <= 3 ? facts.notMarked.join(", ") : `${missing} कक्षाएँ`} अभी दर्ज नहीं — इन्हें उपस्थित नहीं गिना गया।`),
    bar,
  };
}

/* ------------------------------------------------------------ calendar items */

/** An event or a run of holidays, as every calendar view draws it. */
export type CalItem = {
  id: string;
  kind: EventKind;
  title: string;
  titleHi: string | null;
  startsOn: string;
  endsOn: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  place: string | null;
  classIds: string[];
  details: string | null;
  cancelled: boolean;
  /** Set for a holiday run: its first day, which is what a notice names. */
  holidayDay: string | null;
};

export function eventItem(e: CalEvent): CalItem {
  return { id: e.id, kind: asKind(e.kind), title: e.title, titleHi: e.titleHi, startsOn: e.startsOn, endsOn: e.endsOn, allDay: e.allDay || !e.startsAt, startsAt: e.allDay ? null : e.startsAt, endsAt: e.allDay ? null : e.endsAt, place: e.place, classIds: e.classIds, details: e.details, cancelled: e.cancelled, holidayDay: null };
}

export function holidayItems(holidays: CalHoliday[]): CalItem[] {
  return holidayRuns(holidays).map((r) => ({
    id: `h-${r.from}`,
    kind: "holiday" as const,
    title: r.label ?? "Holiday",
    titleHi: r.labelHi ?? (r.label ? null : "अवकाश"),
    startsOn: r.from,
    endsOn: r.to,
    allDay: true,
    startsAt: null,
    endsAt: null,
    place: null,
    classIds: [],
    details: null,
    cancelled: false,
    holidayDay: r.from,
  }));
}

/** Items on a day in the design's order: several-day ones first, then by start, then by time. */
export function itemsOn(items: CalItem[], day: string): CalItem[] {
  return items
    .filter((e) => e.startsOn <= day && day <= e.endsOn)
    .sort((a, b) => Number(a.startsOn === a.endsOn) - Number(b.startsOn === b.endsOn) || a.startsOn.localeCompare(b.startsOn) || (minutes(a.startsAt) ?? -1) - (minutes(b.startsAt) ?? -1) || a.id.localeCompare(b.id));
}

/** One event's bar in one day cell: labelled where it starts and at the start of a week. */
export type CellBar = { id: string; kind: EventKind; title: Pair; labelled: boolean; start: boolean; end: boolean };

export function itemTitle(e: Pick<CalItem, "title" | "titleHi">): Pair {
  return p(e.title, e.titleHi ?? undefined);
}

/** `weekday` is Monday-first (0 = Monday), as the grid is laid out. */
export function cellBars(items: CalItem[], day: string, weekday: number, max = 3): { bars: CellBar[]; more: number } {
  const on = itemsOn(items, day);
  return {
    bars: on.slice(0, max).map((e) => ({ id: e.id, kind: e.kind, title: itemTitle(e), labelled: e.startsOn === day || weekday === 0, start: e.startsOn === day, end: e.endsOn === day })),
    more: Math.max(0, on.length - max),
  };
}
