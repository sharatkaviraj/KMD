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

/**
 * A class's attendance over many days: every child-day pooled, then one
 * percentage — never an average of daily percentages. The month's "Classes
 * ranked" and the register's "class average" both read this, so one class
 * and one month have one number (smoke 20 Oct: 96.1% beside 96.4%).
 */
export function pooledPct(tallies: Iterable<Pick<Tally, "credit" | "counted">>): number | null {
  let credit = 0;
  let counted = 0;
  for (const t of tallies) {
    credit += t.credit;
    counted += t.counted;
  }
  return presentPct({ credit, counted });
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

/** The design's heat ramp (`--heat`), amber below 85, and a dashed empty tile for "not marked". */
export const BAND_STYLE: Record<Band, { bg: string; fg: string; border?: string }> = {
  top: { bg: "rgb(var(--heat))", fg: "var(--onsolid)" },
  good: { bg: "rgba(var(--heat),.5)", fg: "var(--fg)" },
  fair: { bg: "rgba(var(--heat),.22)", fg: "var(--fg)" },
  low: { bg: "var(--warns)", fg: "var(--warnfg)" },
  none: { bg: "var(--s2)", fg: "var(--mut)", border: "1.5px dashed var(--bds)" },
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

/**
 * The chips under a child's name: "Below 33% in Maths", "Marks dropped 18%",
 * "2 open notes". `subjectHi` names a subject for a Hindi reader (the screens
 * pass the exam office's `subjectPair`); without it the English name is used.
 */
export function attentionChips(row: AttentionFacts, subjectHi: (code: string) => string = subjectName): Chip[] {
  const chips: Chip[] = [];
  if (row.reasons.includes("attendance") && row.attendancePct !== null) {
    const v = Math.round(row.attendancePct);
    chips.push({ tone: "warn", text: p(`Attendance ${v}%`, `उपस्थिति ${v}%`) });
  }
  if (row.reasons.includes("below_33")) {
    const [first, ...rest] = row.below33Subjects;
    // Two subjects read as "Maths & Science" (the design); three or more as "Maths +2".
    const en = rest.length === 1 ? `${subjectName(first)} & ${subjectName(rest[0])}` : `${subjectName(first)}${rest.length ? ` +${rest.length}` : ""}`;
    const hi = rest.length === 1 ? `${subjectHi(first)} व ${subjectHi(rest[0])}` : `${subjectHi(first)}${rest.length ? ` +${rest.length}` : ""}`;
    chips.push({ tone: "bad", text: p(`Below 33% in ${en}`, `${hi} में 33% से कम`) });
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
  // An acronym the school says as letters; the capitals rule below made it
  // "Elga", a word nobody at the school uses (D-524).
  ELGA: "ELGA",
};

/** The timetable's subject code as a person says it. */
export function subjectName(code: string | null | undefined): string {
  if (!code) return "—";
  const named = SUBJECT_NAMES[code];
  if (named) return named;
  // A code kept in capitals ("HINDI") reads as a name ("Hindi") on anything a
  // person reads; a short acronym ("EVS", "GK") stays as it is (coordinators U6).
  return /^[A-Z]{4,}$/.test(code) ? code[0] + code.slice(1).toLowerCase() : code;
}

const STREAM_HI: Record<string, string> = { science: "विज्ञान", sci: "विज्ञान", commerce: "वाणिज्य", com: "वाणिज्य", arts: "कला", humanities: "कला" };

/**
 * A class's name in both languages: "Class 12 Commerce" / "कक्षा 12 वाणिज्य",
 * "Nursery" / "नर्सरी". JKG, SKG, LKG and UKG are said as they are written.
 */
export function classPair(label: string): Pair {
  const t = label.trim();
  if (/^(nursery|nur)$/i.test(t)) return p(t, "नर्सरी");
  const m = /^(?:class\s+)?(\d{1,2})(?:\s+(.+))?$/i.exec(t);
  if (!m) return p(t);
  const stream = m[2] ? (STREAM_HI[m[2].trim().toLowerCase()] ?? m[2].trim()) : "";
  return p(t, `कक्षा ${m[1]}${stream ? ` ${stream}` : ""}`);
}

/**
 * Children whose name another child in the same list also has, so the
 * register can show a second thing (SR or father) to tell them apart.
 */
export function repeatedNames(rows: readonly { studentId: string; name: string }[]): Set<string> {
  const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  const count = new Map<string, number>();
  for (const r of rows) count.set(key(r.name), (count.get(key(r.name)) ?? 0) + 1);
  return new Set(rows.filter((r) => (count.get(key(r.name)) ?? 0) > 1).map((r) => r.studentId));
}

/* ------------------------------------------------- marks, one rule each */

/** One mark as the coordinator's screens read it: one child, one paper. */
export type MarkRow = {
  studentId: string;
  examId: string;
  classId: string;
  subjectId: string;
  subject: string;
  value: number | null;
  absent: boolean;
  exempt: boolean;
  maxMarks: number;
  passMarks: number | null;
};

export type MarksFlags = { below33Subjects: string[]; dropPoints: number | null; dropSubject: string | null };

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The needs-attention list's two marks rules, per child: any subject below
 * 33% in its latest paper, and a drop of 15 points or more since that
 * subject's paper before.
 *
 * Only a mark with a number counts. A blank (not entered yet), an absent and
 * an exempt are not 0% and not a drop — a child with Maths still to be entered
 * is not "below 33% in Maths". And only the exams in `examOrder` count, oldest
 * first: the school's dated exams. A rehearsal exam with no date (a QA run's,
 * with every mark 0) sorted as the newest paper and put a whole class on the
 * list (smoke 20 Oct: "Below 33% in EVS & Maths · Marks dropped 82%" on a
 * child with 82% in EVS).
 */
export function marksFlags(rows: readonly MarkRow[], examOrder: readonly string[]): Map<string, MarksFlags> {
  const rank = new Map(examOrder.map((id, i) => [id, i]));
  const bySubject = new Map<string, { studentId: string; subject: string; at: number; pct: number }[]>();
  for (const r of rows) {
    const at = rank.get(r.examId);
    if (at === undefined || r.value === null || r.absent || r.exempt || !(r.maxMarks > 0)) continue;
    const key = `${r.studentId}|${r.subjectId}`;
    const list = bySubject.get(key) ?? [];
    list.push({ studentId: r.studentId, subject: r.subject, at, pct: round1((100 * Number(r.value)) / r.maxMarks) });
    bySubject.set(key, list);
  }
  const acc = new Map<string, { below: { subject: string; pct: number }[]; drop: number | null; dropSubject: string | null }>();
  for (const list of bySubject.values()) {
    list.sort((a, b) => b.at - a.at);
    const [latest, previous] = list;
    const a = acc.get(latest.studentId) ?? { below: [], drop: null, dropSubject: null };
    if (latest.pct < 33) a.below.push({ subject: latest.subject, pct: latest.pct });
    if (previous && previous.at !== latest.at) {
      const d = round1(previous.pct - latest.pct);
      if (d >= 15 && (a.drop === null || d > a.drop)) {
        a.drop = d;
        a.dropSubject = latest.subject;
      }
    }
    acc.set(latest.studentId, a);
  }
  const out = new Map<string, MarksFlags>();
  for (const [studentId, a] of acc) {
    if (a.below.length === 0 && a.drop === null) continue;
    out.set(studentId, { below33Subjects: a.below.sort((x, y) => x.pct - y.pct).map((x) => x.subject), dropPoints: a.drop, dropSubject: a.dropSubject });
  }
  return out;
}

/** One child's result in one exam, as the report card totals it. */
export type ChildExam = {
  studentId: string;
  examId: string;
  classId: string;
  /** Scored ÷ out of, one decimal; null when no paper has a mark or an absent yet. */
  pct: number | null;
  scored: number;
  outOf: number;
  /** Papers with a number on them. */
  counted: number;
  /** Papers the child missed: each is 0 out of the paper's full marks. */
  absent: number;
  /** Papers with no mark yet: left out until a teacher enters one. */
  missing: number;
  /** Papers below the pass mark, an absent among them. */
  failed: number;
};

/**
 * Each child's result in each exam, by the report card's rule (`totalsFor`
 * in modules/assessments/domain/assessments.ts): an absent is 0 out of the
 * paper's full marks, a blank and an exempt are left out. Before this, an
 * absent was left out like a blank, so a child absent from Maths ranked first
 * in Class 9 on his other papers (smoke 20 Oct).
 */
export function childExams(rows: readonly MarkRow[]): ChildExam[] {
  const by = new Map<string, ChildExam>();
  for (const r of rows) {
    const key = `${r.studentId}|${r.examId}`;
    const c = by.get(key) ?? { studentId: r.studentId, examId: r.examId, classId: r.classId, pct: null, scored: 0, outOf: 0, counted: 0, absent: 0, missing: 0, failed: 0 };
    const max = Number(r.maxMarks) || 0;
    const pass = r.passMarks === null ? null : Number(r.passMarks);
    if (r.exempt) {
      // Excused: neither a mark nor a nought.
    } else if (r.absent) {
      c.absent += 1;
      c.outOf += max;
      if (pass !== null && pass > 0) c.failed += 1;
    } else if (r.value === null) {
      c.missing += 1;
    } else {
      const v = Number(r.value);
      c.counted += 1;
      c.scored += v;
      c.outOf += max;
      if (pass !== null && v < pass) c.failed += 1;
    }
    by.set(key, c);
  }
  return [...by.values()].map((c) => ({ ...c, pct: c.outOf > 0 ? round1((c.scored / c.outOf) * 100) : null }));
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

/**
 * The progress heat map's six bands (AcadProgress): red below 33, amber below
 * 50, then the teal ramp at 65, 75 and 85; nothing entered is a grey tile.
 */
export function heatBand(pct: number | null): { bg: string; fg: string } {
  if (pct === null) return { bg: "var(--s2)", fg: "var(--sub)" };
  if (pct < 33) return { bg: "var(--bads)", fg: "var(--bad)" };
  if (pct < 50) return { bg: "var(--warns)", fg: "var(--warnfg)" };
  if (pct < 65) return { bg: "rgba(var(--heat),.12)", fg: "var(--fg)" };
  if (pct < 75) return { bg: "rgba(var(--heat),.3)", fg: "var(--fg)" };
  if (pct < 85) return { bg: "rgba(var(--heat),.6)", fg: "var(--fg)" };
  return { bg: "rgb(var(--heat))", fg: "var(--onsolid)" };
}

export const HEAT_LEGEND: [string, number][] = [["Below 33", 20], ["33–50", 40], ["50–65", 60], ["65–75", 70], ["75–85", 80], ["85+", 90]];

/** Marks spread bands: how many papers (one child, one subject) fall in each. */
export function spreadBands(pcts: number[]): { label: string; n: number; tone: string }[] {
  const bands: [string, number, number, string][] = [["0–33", 0, 33, "var(--bad)"], ["33–50", 33, 50, "var(--c3)"], ["50–75", 50, 75, "var(--c4)"], ["75–90", 75, 90, "var(--c2)"], ["90+", 90, 1000, "var(--c1)"]];
  return bands.map(([label, lo, hi, tone]) => ({ label, n: pcts.filter((v) => v >= lo && v < hi).length, tone }));
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
  /** The exam the marks figure is about; null when no exam is current. */
  examLabel?: { en: string; hi: string | null } | null;
  lateTeachers: number;
  attention: number;
  attentionNew: number;
  notesOpen: number;
  correctionsMade: number;
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
    // Named after the current exam, not a fixed "Half-yearly" (day-run 6 Nov 2026, AC-08).
    f.examLabel
      ? p(`${f.examLabel.en} marks ${f.marksPct}% entered; ${f.lateTeachers} teachers behind.`, `${f.examLabel.hi ?? f.examLabel.en} अंक ${f.marksPct}% दर्ज; ${f.lateTeachers} शिक्षक पीछे।`)
      : p("No exam is being marked this week.", "इस सप्ताह किसी परीक्षा के अंक नहीं भरे जा रहे।"),
    p(`${f.attention} children need attention (${f.attentionNew} new this week).`, `${f.attention} बच्चों पर ध्यान चाहिए (इस सप्ताह ${f.attentionNew} नए)।`),
    p(`${f.notesOpen} notes waiting for action; ${f.correctionsMade} attendance corrections made.`, `${f.notesOpen} नोट कार्रवाई के लिए; ${f.correctionsMade} हाज़िरी सुधार किए गए।`),
  ];
}

/** An approved template's body with its `{{1}}`, `{{2}}` … filled, as the send actions fill it. */
export function fillTemplate(body: string, variables: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => variables[Number(n) - 1] ?? "");
}

/**
 * The lines the principal gets: "short" is attendance, marks and attention;
 * "detailed" adds notes and corrections; the coordinator's own line, if any,
 * goes last as "From me: …".
 */
export function weeklySummaryLines(f: WeekFacts, opts: { long?: boolean; extra?: string | null } = {}): Pair[] {
  const lines = weeklySummary(f);
  const chosen = opts.long === false ? lines.slice(0, 3) : lines;
  const extra = (opts.extra ?? "").trim().slice(0, 300);
  return extra ? [...chosen, p(`From me: ${extra}`, `मेरी ओर से: ${extra}`)] : chosen;
}

/** The summary as one line for the WhatsApp template's {{2}}. */
export function weeklySummaryLine(f: WeekFacts, opts: { long?: boolean; extra?: string | null } = {}): string {
  return weeklySummaryLines(f, opts)
    .map((pair) => pair.en)
    .join(" ");
}

/**
 * The staff outbox key of one week's summary to one admin: the session and
 * the week's Monday, so pressing Send twice queues it once (the outbox is
 * idempotent on the key).
 */
export function weeklySummaryKey(session: string, monday: string, adminId: string): string {
  return `weekly:${session}:${monday}:${adminId}`;
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
