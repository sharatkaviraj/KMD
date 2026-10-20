/**
 * The teacher app's rules (design TchHome, TchAttend, TchClass, TchMore).
 * Pure: no React, no database, no clock of its own — the caller passes "now".
 * Unit-tested in `tests/vx-teach.test.ts`.
 */

import { p, type Pair } from "@/vx/text";

export type Mark = "present" | "absent" | "half_day" | "late" | "leave";

/* ------------------------------------------------------------ the register */

/**
 * One tap on a child's card. The design's cycle is Present → Absent →
 * Leave → Present; RULES G renames the teacher's "leave" to Half-day (leave
 * is the office's word for an approved absence), so the cycle is
 * Present → Absent → Half-day → Present. A mark the teacher cannot make by
 * tapping (late, leave from the office) goes back to Present.
 */
export function nextTap(mark: Mark | undefined): Mark {
  switch (mark ?? "present") {
    case "present":
      return "absent";
    case "absent":
      return "half_day";
    default:
      return "present";
  }
}

export type MarkCounts = { present: number; absent: number; halfDay: number; leave: number; late: number; total: number };

export function countMarks(ids: readonly string[], marks: Readonly<Record<string, Mark>>): MarkCounts {
  const c: MarkCounts = { present: 0, absent: 0, halfDay: 0, leave: 0, late: 0, total: ids.length };
  for (const id of ids) {
    const m = marks[id] ?? "present";
    if (m === "present") c.present += 1;
    else if (m === "absent") c.absent += 1;
    else if (m === "half_day") c.halfDay += 1;
    else if (m === "leave") c.leave += 1;
    else c.late += 1;
  }
  return c;
}

/**
 * "Same as yesterday": yesterday's marks for the children on today's roll.
 * A child who was late yesterday starts present today (late is about one
 * morning); a child with no mark yesterday starts present.
 */
/**
 * The register's banner while marking, from the live counts (B14): "Everyone
 * is marked Present" only while nobody is absent; otherwise what is marked,
 * so a phone (where the counters are hidden) sees the change at once.
 */
export function markedLine(present: number, absent: number, half: number): Pair {
  const parts = [`${present} present`, absent ? `${absent} absent` : null, half ? `${half} half day or leave` : null].filter(Boolean).join(", ");
  const hi = [`${present} उपस्थित`, absent ? `${absent} अनुपस्थित` : null, half ? `${half} आधा दिन या छुट्टी` : null].filter(Boolean).join(", ");
  return p(`Marked so far: ${parts}.`, `अब तक: ${hi}।`);
}

export function copyYesterday(ids: readonly string[], yesterday: Readonly<Record<string, Mark>>): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  for (const id of ids) {
    const m = yesterday[id];
    out[id] = !m || m === "late" ? "present" : m;
  }
  return out;
}

/** Children absent on at least `threshold` of the registers given (the month view). */
export function absentOften(
  marks: readonly { studentId: string; status: Mark }[],
  threshold = 3,
): { studentId: string; absent: number }[] {
  const count = new Map<string, number>();
  for (const m of marks) if (m.status === "absent") count.set(m.studentId, (count.get(m.studentId) ?? 0) + 1);
  return [...count.entries()]
    .filter(([, n]) => n >= threshold)
    .map(([studentId, absent]) => ({ studentId, absent }))
    .sort((a, b) => b.absent - a.absent || a.studentId.localeCompare(b.studentId));
}

export type MonthCell = { day: string; date: number; weekday: number } | null;

/** A Monday-first month grid for "YYYY-MM": leading blanks, then the days. */
export function monthGrid(month: string): MonthCell[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: MonthCell[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d += 1) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    cells.push({ day, date: d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() });
  }
  return cells;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The calendar day before `day` (YYYY-MM-DD). */
export function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The last day of "YYYY-MM". "-31" for every month sent "2026-09-31" to
 * Postgres and the month view crashed for September (BUG-03).
 */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}

/* ------------------------------------------------- telling children apart */

type Tellable = { id: string; name: string; admissionNo?: string | null; fatherName?: string | null };

/**
 * A short line for each child whose name another child in the list also has
 * ("SR 1234 · father Ramesh"), so two "Ansh"es on a register or a marks
 * sheet are never confused. Children with a name of their own get nothing,
 * which keeps the register as short as it was.
 */
export function tellApart(rows: readonly Tellable[]): Map<string, Pair> {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(norm(r.name), (seen.get(norm(r.name)) ?? 0) + 1);
  const out = new Map<string, Pair>();
  for (const r of rows) {
    if ((seen.get(norm(r.name)) ?? 0) < 2) continue;
    const en = [r.admissionNo ? `SR ${r.admissionNo}` : null, r.fatherName ? `father ${r.fatherName}` : null].filter(Boolean).join(" · ");
    const hi = [r.admissionNo ? `SR ${r.admissionNo}` : null, r.fatherName ? `पिता ${r.fatherName}` : null].filter(Boolean).join(" · ");
    if (en) out.set(r.id, p(en, hi));
  }
  return out;
}

/** A child matches a search by any word of the name, the roll number or the SR number. */
export function childMatches(child: { name: string; rollNo: string | null; admissionNo?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((child.rollNo ?? "").toLowerCase() === q || (child.admissionNo ?? "").toLowerCase() === q) return true;
  return q.split(/\s+/).every((w) => child.name.toLowerCase().includes(w));
}

/* -------------------------------------------------------- the week */

/**
 * A teacher's week, one row per day and period. A combined
 * period (Classes 11 Sci, Com and Arts at once) is one period, not three —
 * "92 periods a week" counted it once per class (BUG-07, ST-14).
 */
export function mergeCombinedSlots<T extends { day: string; period: number; classLabel: string; subjectCode: string }>(slots: readonly T[]): T[] {
  const merged = new Map<string, { slot: T; labels: string[] }>();
  for (const s of slots) {
    const key = `${s.day}|${s.period}`;
    const cur = merged.get(key);
    if (!cur) merged.set(key, { slot: s, labels: [s.classLabel] });
    else if (!cur.labels.includes(s.classLabel)) cur.labels.push(s.classLabel);
  }
  // "Class 11 Science · 11 Commerce · 11 Arts": the word "Class" once.
  return [...merged.values()].map(({ slot, labels }) => ({ ...slot, classLabel: [labels[0], ...labels.slice(1).map((l) => l.replace(/^class\s+/i, ""))].join(" · ") }));
}

/**
 * When the parents' absent message goes. The school sends the queue from
 * its office; before 10 am it is the 10 am round, after that the office sends
 * it as soon as it can. "10 am" on a register saved at 11 pm promised a time
 * that had already passed (BUG-16, ST-12).
 */
export function alertWhen(nowMinutes: number, day: string, today: string): Pair {
  if (day === today && nowMinutes < 600) return p("at 10 am", "सुबह 10 बजे");
  return p("from the school office", "स्कूल ऑफ़िस से");
}

/* -------------------------------------------------------- marks to fill */

export type PaperToFill = { status: "done" | "in_progress" | "not_started" | "empty"; dueOn: string | null; classSort?: number; subjectCode?: string };

/**
 * The marks screen's order: papers past their due date and not finished
 * first, then the other unfinished ones by due date, then the finished ones.
 * Every open exam's papers are listed — none is picked by its label.
 */
export function orderPapersToFill<T extends PaperToFill>(cards: readonly T[], today: string): T[] {
  const rank = (c: T) => (c.status === "done" ? 2 : c.dueOn && c.dueOn < today ? 0 : 1);
  return [...cards].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") ||
      (a.classSort ?? 0) - (b.classSort ?? 0) ||
      (a.subjectCode ?? "").localeCompare(b.subjectCode ?? ""),
  );
}

/* ------------------------------------------------------------- the day */

export type TimedPeriod = { period: number; starts: string; ends: string };
export type PeriodPhase = "done" | "now" | "next" | "later";

function mins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Where each of today's periods stands at `nowMinutes` (school wall-clock):
 * the one running is "now", the first still to come is "next".
 */
export function periodPhases(periods: readonly TimedPeriod[], nowMinutes: number): PeriodPhase[] {
  let nextGiven = false;
  return periods.map((p) => {
    const s = mins(p.starts);
    const e = mins(p.ends);
    if (nowMinutes >= e) return "done";
    if (nowMinutes >= s) return "now";
    if (!nextGiven) {
      nextGiven = true;
      return "next";
    }
    return "later";
  });
}

/** Whole minutes until a "HH:MM" from `nowMinutes`; negative once it has passed. */
export function minutesUntil(hhmm: string, nowMinutes: number): number {
  return mins(hhmm) - nowMinutes;
}

/* ------------------------------------------------------- birthdays */

/**
 * Children whose birthday falls in the next `within` days (today is 0).
 * A 29 February birthday is kept on 28 February in a common year.
 */
export function upcomingBirthdays<T extends { dateOfBirth: string | null }>(
  children: readonly T[],
  today: string,
  within = 7,
): (T & { inDays: number; turning: number })[] {
  const [ty, tm, td] = today.split("-").map(Number);
  const base = Date.UTC(ty, tm - 1, td);
  const out: (T & { inDays: number; turning: number })[] = [];
  for (const child of children) {
    if (!child.dateOfBirth || !/^\d{4}-\d{2}-\d{2}/.test(child.dateOfBirth)) continue;
    const [by, bm, bd] = child.dateOfBirth.slice(0, 10).split("-").map(Number);
    for (const year of [ty, ty + 1]) {
      const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const day = bm === 2 && bd === 29 && !leap ? 28 : bd;
      const at = Date.UTC(year, bm - 1, day);
      const inDays = Math.round((at - base) / 86_400_000);
      if (inDays >= 0) {
        if (inDays <= within) out.push({ ...child, inDays, turning: year - by });
        break;
      }
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

/* ------------------------------------------------- needs your attention */

export type AttentionReason = "attendance" | "marks" | "notes";

export const ATTENTION_RULES = { attendanceBelow: 75, minDays: 5, marksBelow: 33, openNotes: 2 } as const;

/** Why a child is on "children who need you" (design TchClass; v_needs_attention). */
export function attentionReasons(input: {
  attendancePct: number | null;
  daysCounted: number;
  lowestSubjectPct: number | null;
  openNotes: number;
}): AttentionReason[] {
  const out: AttentionReason[] = [];
  if (input.attendancePct !== null && input.daysCounted >= ATTENTION_RULES.minDays && input.attendancePct < ATTENTION_RULES.attendanceBelow) out.push("attendance");
  if (input.lowestSubjectPct !== null && input.lowestSubjectPct < ATTENTION_RULES.marksBelow) out.push("marks");
  if (input.openNotes >= ATTENTION_RULES.openNotes) out.push("notes");
  return out;
}

/* ------------------------------------------------------------- leave */

export type LeaveSpan = "full" | "first_half" | "second_half";

/**
 * The days a teacher picked, as contiguous runs — one `teacher_leave` row
 * each. Sundays between two picked days do not break a run.
 */
export function leaveRuns(days: readonly string[]): { from: string; to: string }[] {
  const sorted = [...new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const runs: { from: string; to: string }[] = [];
  for (const day of sorted) {
    const last = runs[runs.length - 1];
    if (last) {
      const gap = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${last.to}T00:00:00Z`)) / 86_400_000;
      const bridged = gap === 2 && new Date(`${addDays(last.to, 1)}T00:00:00Z`).getUTCDay() === 0;
      if (gap === 1 || bridged) {
        last.to = day;
        continue;
      }
    }
    runs.push({ from: day, to: day });
  }
  return runs;
}

/** The four reasons the leave sheet offers (design TchHome `leave`); the English goes into the request's note. */
export const LEAVE_REASONS: { key: string; text: Pair }[] = [
  { key: "unwell", text: p("Unwell", "बीमार") },
  { key: "family", text: p("Family function", "पारिवारिक कार्यक्रम") },
  { key: "personal", text: p("Personal work", "निजी काम") },
  { key: "other", text: p("Other", "अन्य") },
];

/* --------------------------------------------------- messages to parents */

/**
 * A child's gender split for a class card, only when every child has one
 * recorded: "2 girls · 0 boys" for 39 children read as fact (BUG-10, ST-26).
 */
export function genderSplit(genders: readonly (string | null)[]): { girls: number; boys: number } | null {
  if (genders.length === 0) return null;
  let girls = 0;
  let boys = 0;
  for (const g of genders) {
    const v = (g ?? "").trim();
    if (/^f/i.test(v)) girls += 1;
    else if (/^m/i.test(v)) boys += 1;
    else return null;
  }
  return { girls, boys };
}

/** The absent alert a teacher may queue for 10 am (RULES H: Hindi first). */
export function absentAlert(input: { childName: string; classLabel: string; dayLabel: string; school: string }): { hi: string; en: string } {
  return {
    hi: `नमस्ते, ${input.childName} (${input.classLabel}) आज ${input.dayLabel} को स्कूल नहीं आए। कृपया कारण बताएँ। — ${input.school}`,
    en: `Hello, ${input.childName} (${input.classLabel}) is absent from school today, ${input.dayLabel}. Please let us know why. — ${input.school}`,
  };
}

export function birthdayWish(input: { childName: string; school: string }): { hi: string; en: string } {
  return {
    hi: `${input.childName} को जन्मदिन की बहुत-बहुत शुभकामनाएँ! 🎂 — ${input.school}`,
    en: `Wishing ${input.childName} a very happy birthday! 🎂 — ${input.school}`,
  };
}

/** The design's link to a phone call or a WhatsApp chat, from a stored number. */
export function phoneLinks(raw: string | null | undefined): { tel: string; wa: string } | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const local = digits.slice(-10);
  return { tel: `tel:+91${local}`, wa: `https://wa.me/91${local}` };
}

/** Average of percentages, rounded; null for none. */
export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

/* ------------------------------------------------------ roster badges */

export type RosterBadge = { key: "attendance" | "papers" | "support"; tone: "ok" | "warn" | "bad" | "mut"; text: Pair };

/**
 * At most three factual badges for a child on the class teacher's roster
 * (notes §4, D-267), always in this order: attendance as days, papers not
 * entered, the next support review. Each says what is known — "18/20 days",
 * "1 paper not entered", "Support · review 14 Oct" — and none ranks the
 * child: no "lowest", no "weak". Green only for complete and clear; amber
 * for missing or due; red only for a review that is past its date.
 */
export function rosterBadges(
  child: { presentDays: number; daysCounted: number; papersMissing: number; nextReview: string | null },
  today: string,
  dayLabel: (iso: string) => string,
): RosterBadge[] {
  const out: RosterBadge[] = [];
  const days = Math.round(child.presentDays * 10) / 10;
  out.push(
    child.daysCounted === 0
      ? { key: "attendance", tone: "mut", text: p("No attendance yet", "अभी उपस्थिति नहीं") }
      : { key: "attendance", tone: "mut", text: p(`Attendance ${days}/${child.daysCounted} days`, `उपस्थिति ${days}/${child.daysCounted} दिन`) },
  );
  if (child.papersMissing > 0) {
    const n = child.papersMissing;
    out.push({ key: "papers", tone: "warn", text: p(`${n} ${n === 1 ? "paper" : "papers"} not entered`, `${n} पेपर के अंक दर्ज नहीं`) });
  }
  if (child.nextReview) {
    const late = child.nextReview < today;
    out.push({
      key: "support",
      tone: late ? "bad" : child.nextReview === today ? "warn" : "mut",
      text: p(`Support · review ${dayLabel(child.nextReview)}`, `सहायता · समीक्षा ${dayLabel(child.nextReview)}`),
    });
  }
  return out.slice(0, 3);
}
