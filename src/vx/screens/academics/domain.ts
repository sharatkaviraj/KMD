import { p, type Pair } from "@/vx/text";

/*
 * Pure rules behind the coordinator's screens (AcadHome, AcadProgress,
 * AcadAttendance). No database here; `data.ts` feeds these, the tests in
 * `tests/vx-academics.test.ts` pin them.
 */

export type AttStatus = "present" | "absent" | "late" | "leave" | "half_day";

export type Tally = {
  present: number;
  absent: number;
  late: number;
  leave: number;
  halfDay: number;
  /** Children whose day counts: everyone except leave. */
  counted: number;
  /** Days of credit: present and late are 1, half day is the session's credit. */
  credit: number;
};

export const EMPTY_TALLY: Tally = { present: 0, absent: 0, late: 0, leave: 0, halfDay: 0, counted: 0, credit: 0 };

/** Count one register's marks. Late is a whole day present; leave is not counted (domain/attendance). */
export function tally(statuses: Iterable<AttStatus>, halfDayCredit = 0.5): Tally {
  const t = { ...EMPTY_TALLY };
  for (const s of statuses) {
    if (s === "present") t.present += 1;
    else if (s === "late") t.late += 1;
    else if (s === "absent") t.absent += 1;
    else if (s === "leave") t.leave += 1;
    else if (s === "half_day") t.halfDay += 1;
  }
  t.counted = t.present + t.late + t.absent + t.halfDay;
  t.credit = t.present + t.late + t.halfDay * halfDayCredit;
  return t;
}

export function addTally(a: Tally, b: Tally): Tally {
  return {
    present: a.present + b.present,
    absent: a.absent + b.absent,
    late: a.late + b.late,
    leave: a.leave + b.leave,
    halfDay: a.halfDay + b.halfDay,
    counted: a.counted + b.counted,
    credit: a.credit + b.credit,
  };
}

/** Percent present, one decimal; null when nothing counted. */
export function presentPct(t: Pick<Tally, "credit" | "counted">): number | null {
  if (!t.counted) return null;
  return Math.round((t.credit / t.counted) * 1000) / 10;
}

/** The attendance heat strip's four bands (AcadHome): 95+, 90–95, 85–90, below 85. */
export type Band = "top" | "good" | "fair" | "low" | "none";

export function attendanceBand(pct: number | null): Band {
  if (pct === null) return "none";
  if (pct >= 95) return "top";
  if (pct >= 90) return "good";
  if (pct >= 85) return "fair";
  return "low";
}

export const BAND_STYLE: Record<Band, { bg: string; fg: string; border?: string }> = {
  top: { bg: "var(--pri)", fg: "var(--prifg)" },
  good: { bg: "color-mix(in srgb, var(--pri) 55%, var(--card))", fg: "var(--prifg)" },
  fair: { bg: "color-mix(in srgb, var(--pri) 22%, var(--card))", fg: "var(--fg)" },
  low: { bg: "var(--warns)", fg: "var(--warnfg)" },
  none: { bg: "transparent", fg: "var(--mut)", border: "1.5px dashed var(--bd)" },
};

/** The four needs-attention rules, as the view names them. */
export type AttentionReason = "attendance" | "below_33" | "dropped" | "notes";

export type AttentionFacts = {
  reasons: AttentionReason[];
  attendancePct: number | null;
  below33Subjects: string[];
  dropPoints: number | null;
  dropSubject: string | null;
  openNotes: number;
};

export type Chip = { tone: "bad" | "warn" | "info" | "acc"; text: Pair };

/** The chips under a child's name: "Below 33% in Maths", "Marks dropped 18%", "2 open notes". */
export function attentionChips(row: AttentionFacts): Chip[] {
  const chips: Chip[] = [];
  if (row.reasons.includes("attendance") && row.attendancePct !== null) {
    const v = Math.round(row.attendancePct);
    chips.push({ tone: "warn", text: p(`Attendance ${v}%`, `उपस्थिति ${v}%`) });
  }
  if (row.reasons.includes("below_33")) {
    const [first, ...rest] = row.below33Subjects;
    const more = rest.length ? ` +${rest.length}` : "";
    chips.push({ tone: "bad", text: p(`Below 33% in ${subjectName(first)}${more}`, `${subjectName(first)} में 33% से कम${more}`) });
  }
  if (row.reasons.includes("dropped") && row.dropPoints !== null) {
    const v = Math.round(row.dropPoints);
    chips.push({ tone: "info", text: p(`Marks dropped ${v}%`, `अंक ${v}% गिरे`) });
  }
  if (row.reasons.includes("notes")) {
    chips.push({ tone: "acc", text: p(`${row.openNotes} open notes`, `${row.openNotes} खुले नोट`) });
  }
  return chips;
}

/** How serious: more rules, then lower attendance, then bigger drop. Highest first. */
export function attentionWeight(row: AttentionFacts): number {
  let w = row.reasons.length * 1000;
  if (row.attendancePct !== null && row.reasons.includes("attendance")) w += Math.max(0, 75 - row.attendancePct) * 4;
  w += row.below33Subjects.length * 30;
  w += row.dropPoints ?? 0;
  w += row.openNotes * 5;
  return w;
}

const SUBJECT_NAMES: Record<string, string> = {
  MATHS: "Maths",
  SST: "Social Sci.",
  EVS: "EVS",
  "Eng Lit": "English Lit.",
};

/** The timetable's subject code as a person says it. */
export function subjectName(code: string | null | undefined): string {
  if (!code) return "—";
  return SUBJECT_NAMES[code] ?? code;
}

/* ------------------------------------------------------------- marks */

export type PaperProgress = { paperId: string; classId: string; classLabel: string; subject: string; entered: number; roll: number; submitted: boolean; teacherId: string | null };

/** Share of the marks an exam needs that are in, 0–100. */
export function enteredPct(papers: Pick<PaperProgress, "entered" | "roll" | "submitted">[]): number {
  let need = 0;
  let have = 0;
  for (const paper of papers) {
    need += paper.roll;
    have += paper.submitted ? paper.roll : Math.min(paper.entered, paper.roll);
  }
  return need ? Math.round((have / need) * 100) : 0;
}

export type LateTeacher = { teacherId: string; papers: PaperProgress[]; entered: number; roll: number };

/**
 * Teachers with a paper not yet submitted, the one furthest behind first.
 * A paper with nobody to teach it is left out: there is nobody to remind.
 */
export function lateTeachers(papers: PaperProgress[]): LateTeacher[] {
  const by = new Map<string, LateTeacher>();
  for (const paper of papers) {
    if (paper.submitted || !paper.teacherId || paper.roll === 0) continue;
    const entry = by.get(paper.teacherId) ?? { teacherId: paper.teacherId, papers: [], entered: 0, roll: 0 };
    entry.papers.push(paper);
    entry.entered += Math.min(paper.entered, paper.roll);
    entry.roll += paper.roll;
    by.set(paper.teacherId, entry);
  }
  return [...by.values()].sort((a, b) => a.entered / a.roll - b.entered / b.roll || b.papers.length - a.papers.length);
}

/** Average of percentages, rounded; null when there are none. */
export function average(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return null;
  return Math.round(v.reduce((s, x) => s + x, 0) / v.length);
}

/** "▲ 2", "▼ 3", "= 0" for a change since the previous exam. */
export function deltaLabel(now: number | null, before: number | null): { text: string; tone: "ok" | "bad" | "mut" } {
  if (now === null || before === null) return { text: "—", tone: "mut" };
  const d = Math.round(now - before);
  if (d > 0) return { text: `▲ ${d}`, tone: "ok" };
  if (d < 0) return { text: `▼ ${Math.abs(d)}`, tone: "bad" };
  return { text: "= 0", tone: "mut" };
}

/** Heat-map tone for a subject average: below 40 red, below 55 amber, else teal by strength. */
export function marksTone(pct: number | null): { bg: string; fg: string } {
  if (pct === null) return { bg: "transparent", fg: "var(--mut)" };
  if (pct < 40) return { bg: "var(--bads)", fg: "var(--bad)" };
  if (pct < 55) return { bg: "var(--warns)", fg: "var(--warnfg)" };
  const a = Math.min(0.85, 0.15 + ((pct - 55) / 45) * 0.7);
  return { bg: `rgba(var(--heat),${a.toFixed(2)})`, fg: a > 0.5 ? "var(--onsolid)" : "var(--fg)" };
}

/* ------------------------------------------------------ weekly summary */

export type WeekFacts = {
  coordinator: string;
  weekLabel: string;
  attendancePct: number | null;
  attendanceBefore: number | null;
  classesAlwaysMarked: number;
  classes: number;
  marksPct: number;
  lateTeachers: number;
  attention: number;
  attentionNew: number;
  notesOpen: number;
  correctionsDecided: number;
};

/** The weekly summary for the principal, one line per fact, in the reader's language. */
export function weeklySummary(f: WeekFacts): Pair[] {
  const att = f.attendancePct === null ? "—" : `${f.attendancePct}%`;
  const diff =
    f.attendancePct !== null && f.attendanceBefore !== null
      ? ` (${f.attendancePct - f.attendanceBefore >= 0 ? "+" : ""}${Math.round((f.attendancePct - f.attendanceBefore) * 10) / 10} vs last week)`
      : "";
  return [
    p(`Attendance ${att}${diff}. ${f.classesAlwaysMarked} of ${f.classes} classes marked every day.`, `उपस्थिति ${att}${diff}। ${f.classes} में से ${f.classesAlwaysMarked} कक्षाओं ने रोज़ हाज़िरी ली।`),
    p(`Half-yearly marks ${f.marksPct}% entered; ${f.lateTeachers} teachers behind.`, `अर्धवार्षिक अंक ${f.marksPct}% दर्ज; ${f.lateTeachers} शिक्षक पीछे।`),
    p(`${f.attention} children need attention (${f.attentionNew} new this week).`, `${f.attention} बच्चों पर ध्यान चाहिए (इस सप्ताह ${f.attentionNew} नए)।`),
    p(`${f.notesOpen} notes waiting for action; ${f.correctionsDecided} attendance changes decided.`, `${f.notesOpen} नोट कार्रवाई के लिए; ${f.correctionsDecided} हाज़िरी बदलाव तय।`),
  ];
}

/** The summary as one line for the WhatsApp template's {{2}}. */
export function weeklySummaryLine(f: WeekFacts): string {
  return weeklySummary(f)
    .map((pair) => pair.en)
    .join(" ");
}

/* ------------------------------------------------------------ dates */

/** Monday of the week a day falls in (YYYY-MM-DD in, YYYY-MM-DD out). */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both included. */
export function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Sunday is not a school day; holidays come from the calendar. */
export function isSunday(day: string): boolean {
  return new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
}

/** "2026-10" → first and last day. */
export function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function isMonth(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isDay(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isUuid(value: string | undefined | null): value is string {
  return !!value && /^[0-9a-f-]{36}$/i.test(value);
}

/** Phone digits for a tel: link, or null. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `tel:+91${digits.slice(-10)}`;
}
