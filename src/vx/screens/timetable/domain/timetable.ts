import { p, type Pair } from "@/vx/text";

/*
 * Timetable & substitutions (design `Timetable`). Pure: the week grids,
 * pending edits laid over the live timetable, clashes, a teacher's load,
 * and how many periods a leave leaves without a teacher. No database import.
 */

export const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEK)[number];
export const WEEK_SHORT: Record<Weekday, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat" };
export const PERIODS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
/** The break falls after the fourth period (index 3) on the school's bells. */
export const BREAK_AFTER = 3;

export type Slot = {
  day: string;
  period: number;
  classId: string;
  classLabel: string;
  subjectId: string;
  subjectCode: string;
  staffProfileId: string;
  teacherShortName: string;
  parallel: boolean;
  shared: boolean;
};

export type PendingChange = {
  id: string;
  day: string;
  period: number;
  classId: string;
  classLabel: string;
  fromSubjectCode: string | null;
  fromTeacher: string | null;
  subjectId: string;
  subjectCode: string;
  staffProfileId: string;
  teacherShortName: string;
  createdBy: string | null;
  createdAt: string;
};

/** The weekday name of an ISO date, or null on a Sunday. */
export function weekdayOf(isoDay: string): Weekday | null {
  const d = new Date(`${isoDay}T00:00:00Z`).getUTCDay();
  return d === 0 ? null : WEEK[d - 1];
}

/** Monday..Saturday of the week holding `isoDay` (a Sunday shows the week ahead). */
export function weekDates(isoDay: string): string[] {
  const d = new Date(`${isoDay}T00:00:00Z`);
  const dow = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + (dow === 0 ? 1 : 1 - dow));
  return WEEK.map((_, i) => {
    const x = new Date(monday);
    x.setUTCDate(monday.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

export const cellKey = (day: string, period: number) => `${day}|${period}`;

/** The live timetable with every pending edit laid over it: one edit replaces the whole cell. */
export function applyChanges(slots: readonly Slot[], changes: readonly PendingChange[]): Slot[] {
  if (changes.length === 0) return [...slots];
  const replaced = new Set(changes.map((c) => `${c.classId}|${c.day}|${c.period}`));
  const kept = slots.filter((s) => !replaced.has(`${s.classId}|${s.day}|${s.period}`));
  return [
    ...kept,
    ...changes.map((c) => ({
      day: c.day,
      period: c.period,
      classId: c.classId,
      classLabel: c.classLabel,
      subjectId: c.subjectId,
      subjectCode: c.subjectCode,
      staffProfileId: c.staffProfileId,
      teacherShortName: c.teacherShortName,
      parallel: false,
      shared: false,
    })),
  ];
}

/** One class's week: day|period → the slots in that cell (more than one for a parallel elective). */
export function classGrid(slots: readonly Slot[], classId: string): Map<string, Slot[]> {
  const grid = new Map<string, Slot[]>();
  for (const s of slots) {
    if (s.classId !== classId) continue;
    const key = cellKey(s.day, s.period);
    grid.set(key, [...(grid.get(key) ?? []), s]);
  }
  return grid;
}

/** One teacher's week: day|period → what they teach then (a shared block lists every class). */
export function teacherGrid(slots: readonly Slot[], staffId: string): Map<string, Slot[]> {
  const grid = new Map<string, Slot[]>();
  for (const s of slots) {
    if (s.staffProfileId !== staffId) continue;
    const key = cellKey(s.day, s.period);
    grid.set(key, [...(grid.get(key) ?? []), s]);
  }
  return grid;
}

export type Load = { perDay: number[]; total: number; most: number; free: number };

/** Periods a teacher teaches each weekday (a shared block counts once). */
export function teacherLoad(slots: readonly Slot[], staffId: string): Load {
  const seen = new Set<string>();
  const perDay = WEEK.map(() => 0);
  for (const s of slots) {
    if (s.staffProfileId !== staffId) continue;
    const key = cellKey(s.day, s.period);
    const i = WEEK.indexOf(s.day as Weekday);
    if (i < 0 || seen.has(key)) continue;
    seen.add(key);
    perDay[i] += 1;
  }
  const total = perDay.reduce((a, b) => a + b, 0);
  return { perDay, total, most: Math.max(0, ...perDay), free: WEEK.length * PERIODS.length - total };
}

export type Clash = { staffProfileId: string; teacherShortName: string; classLabel: string; subjectCode: string };

/**
 * Whether putting this teacher in this class at this time double-books them:
 * the cells they already teach then, in any other class.
 */
export function clashFor(slots: readonly Slot[], change: { day: string; period: number; classId: string; staffProfileId: string }): Clash | null {
  const other = slots.find((s) => s.staffProfileId === change.staffProfileId && s.day === change.day && s.period === change.period && s.classId !== change.classId && !s.shared);
  return other ? { staffProfileId: other.staffProfileId, teacherShortName: other.teacherShortName, classLabel: other.classLabel, subjectCode: other.subjectCode } : null;
}

/** Every double-booking in a timetable: a teacher in two classes at once (shared blocks excepted). */
export function allClashes(slots: readonly Slot[]): { day: string; period: number; staffProfileId: string; classLabels: string[] }[] {
  const at = new Map<string, Slot[]>();
  for (const s of slots) {
    if (s.shared) continue;
    const key = `${s.staffProfileId}|${s.day}|${s.period}`;
    at.set(key, [...(at.get(key) ?? []), s]);
  }
  const out: { day: string; period: number; staffProfileId: string; classLabels: string[] }[] = [];
  for (const list of at.values()) {
    const classes = [...new Set(list.map((s) => s.classLabel))];
    if (classes.length > 1) out.push({ day: list[0].day, period: list[0].period, staffProfileId: list[0].staffProfileId, classLabels: classes });
  }
  return out;
}

/** Teachers free at a time: not teaching any class then. */
export function freeAt(slots: readonly Slot[], staffIds: readonly string[], day: string, period: number): string[] {
  const busy = new Set(slots.filter((s) => s.day === day && s.period === period).map((s) => s.staffProfileId));
  return staffIds.filter((id) => !busy.has(id));
}

/** Who teaches a subject anywhere in the timetable — the first people to offer for it. */
export function teachersOf(slots: readonly Slot[], subjectId: string): Set<string> {
  return new Set(slots.filter((s) => s.subjectId === subjectId).map((s) => s.staffProfileId));
}

/* -------------------------------------------------------------- colours */

export type SubjectFamily = "science" | "maths" | "english" | "languages" | "social" | "computer" | "activity" | "other";

export const FAMILY_LABELS: Record<SubjectFamily, Pair> = {
  science: p("Science", "विज्ञान"),
  maths: p("Maths", "गणित"),
  english: p("English", "अंग्रेज़ी"),
  languages: p("Languages", "भाषाएँ"),
  social: p("Social sci.", "सामाजिक"),
  computer: p("Computer", "कंप्यूटर"),
  activity: p("Activity", "गतिविधि"),
  other: p("Other", "अन्य"),
};

/** Hue per family; the screen draws a tinted cell with a solid left edge. */
export const FAMILY_HUES: Record<SubjectFamily, number> = {
  science: 150,
  maths: 221,
  english: 200,
  languages: 28,
  social: 40,
  computer: 180,
  activity: 350,
  other: 260,
};

export function subjectFamily(codeOrName: string): SubjectFamily {
  const s = codeOrName.toLowerCase();
  if (/sci|phy|chem|bio|evs/.test(s)) return "science";
  if (/math/.test(s)) return "maths";
  if (/eng/.test(s)) return "english";
  if (/hin|san|skt|urdu|rajas|lang/.test(s)) return "languages";
  if (/sst|soc|hist|geo|civ|eco|pol/.test(s)) return "social";
  if (/comp|it\b|cs\b|ict/.test(s)) return "computer";
  if (/pe\b|phys.*edu|sport|game|art|draw|music|dance|act|yoga|lib/.test(s)) return "activity";
  return "other";
}

/* ---------------------------------------------------------------- leave */

export type LeaveSpan = "full" | "first_half" | "second_half";

export const SPAN_LABELS: Record<LeaveSpan, Pair> = {
  full: p("Full day", "पूरा दिन"),
  first_half: p("First half · P1–P4", "पहला आधा"),
  second_half: p("Second half · P5–P8", "दूसरा आधा"),
};

export function spanPeriods(span: LeaveSpan): number[] {
  if (span === "first_half") return PERIODS.filter((i) => i <= BREAK_AFTER);
  if (span === "second_half") return PERIODS.filter((i) => i > BREAK_AFTER);
  return [...PERIODS];
}

/** School days (Monday–Saturday) from `from` to `to`, inclusive, at most 31. */
export function schoolDays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 31) {
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** How many of a teacher's periods a leave leaves without them. */
export function periodsNeedingCover(slots: readonly Slot[], staffId: string, from: string, to: string, span: LeaveSpan): number {
  const allowed = new Set(spanPeriods(span));
  let n = 0;
  for (const day of schoolDays(from, to)) {
    const weekday = weekdayOf(day);
    if (!weekday) continue;
    const periods = new Set(slots.filter((s) => s.staffProfileId === staffId && s.day === weekday && allowed.has(s.period)).map((s) => s.period));
    n += periods.size;
  }
  return n;
}

export type LeaveProblem = "who" | "dates" | "order" | "too_long";

export const LEAVE_PROBLEMS: Record<LeaveProblem, Pair> = {
  who: p("Pick the teacher.", "शिक्षक चुनें।"),
  dates: p("Pick the dates.", "तारीख़ चुनें।"),
  order: p("The last day is before the first.", "अंतिम दिन पहले दिन से पहले है।"),
  too_long: p("Leave longer than 31 days is a staff matter, not a cover one.", "31 दिन से लंबी छुट्टी यहाँ नहीं।"),
};

export function leaveProblems(input: { staffId: string; from: string; to: string }): LeaveProblem[] {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!input.staffId) return ["who"];
  if (!iso.test(input.from) || !iso.test(input.to)) return ["dates"];
  if (input.to < input.from) return ["order"];
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000;
  if (days > 31) return ["too_long"];
  return [];
}

/* -------------------------------------------------------------- publish */

/** The teachers a set of edits touches, and what changed for each — one notice each. */
export function affectedTeachers(changes: readonly PendingChange[], slots: readonly Slot[]): Map<string, PendingChange[]> {
  const out = new Map<string, PendingChange[]>();
  const add = (id: string, c: PendingChange) => out.set(id, [...(out.get(id) ?? []), c]);
  for (const c of changes) {
    add(c.staffProfileId, c);
    for (const s of slots) {
      if (s.classId === c.classId && s.day === c.day && s.period === c.period && s.staffProfileId !== c.staffProfileId) add(s.staffProfileId, c);
    }
  }
  return out;
}

/** One teacher's notice, Hindi then English. */
export function changeNotice(name: string, changes: readonly PendingChange[], subjectName: (code: string) => string): { hi: string; en: string } {
  const lines = changes.map((c) => `${c.classLabel}, ${WEEK_SHORT[c.day as Weekday] ?? c.day} P${c.period + 1}: ${subjectName(c.subjectCode)} (${c.teacherShortName})`);
  return {
    hi: `नमस्ते ${name}, समय-सारणी में बदलाव:\n${lines.join("\n")}`,
    en: `Hello ${name}, timetable changes:\n${lines.join("\n")}`,
  };
}
