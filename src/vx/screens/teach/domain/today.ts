/**
 * Today's and More's rules for the teacher (smoke school day, 20 Oct 2026).
 * Pure: no React, no database, no clock of its own — the caller passes the
 * school's day. Unit-tested in `tests/vx-teach-today.test.ts`.
 */

import { p, type Pair } from "@/vx/text";

/* --------------------------------------------------------- closed days */

/** One academic-calendar row, as Today needs it: the kind and the name the office typed. */
export type CalendarEntry = { kind: string; labelEn: string | null; labelHi: string | null };

/** Why school is shut on a day. Null when it is open. */
export type ClosedWhy = { kind: "holiday"; name: Pair | null } | { kind: "sunday" } | null;

/**
 * The reason a closed day is closed, from its calendar row: the holiday's
 * own name when the office gave one ("Dussehra"), Sunday, or a holiday with
 * no name. "No school today" with no reason made teachers phone the office
 * to ask whether the app was broken (smoke 20 Oct).
 */
export function closedWhy(day: string, open: boolean, entry: CalendarEntry | undefined): ClosedWhy {
  if (open) return null;
  const en = entry?.labelEn?.trim() || "";
  const hi = entry?.labelHi?.trim() || "";
  if (entry && entry.kind !== "instructional" && (en || hi)) return { kind: "holiday", name: p(en || hi, hi || en) };
  if (!entry && new Date(`${day}T00:00:00Z`).getUTCDay() === 0) return { kind: "sunday" };
  return { kind: "holiday", name: null };
}

/** "Today is a holiday — Dussehra" / "आज दशहरा की छुट्टी है". */
export function closedTitle(why: Exclude<ClosedWhy, null>): Pair {
  if (why.kind === "sunday") return p("Today is Sunday — school is closed", "आज रविवार है — स्कूल बंद है");
  if (why.name) return p(`Today is a holiday — ${why.name.en}`, `आज ${why.name.hi ?? why.name.en} की छुट्टी है`);
  return p("Today is a school holiday", "आज स्कूल की छुट्टी है");
}

/** The short tag on a day chip or a timetable day: "Holiday · Dussehra" / "छुट्टी · दशहरा". */
export function closedTag(why: Exclude<ClosedWhy, null>): Pair {
  if (why.kind === "sunday") return p("Sunday", "रविवार");
  if (why.name) return p(`Holiday · ${why.name.en}`, `छुट्टी · ${why.name.hi ?? why.name.en}`);
  return p("Holiday", "छुट्टी");
}

/**
 * The last open school day before `today`, looking back at most `max` days,
 * for "Mark Mon 19 Oct" on a holiday. Null when none is found.
 */
export function lastOpenDay(today: string, isOpen: (day: string) => boolean, max = 10): string | null {
  let d = today;
  for (let i = 0; i < max; i += 1) {
    d = shiftDay(d, -1);
    if (isOpen(d)) return d;
  }
  return null;
}

function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------- leave */

export type LeaveStatus = "asked" | "approved" | "declined" | "cancelled";
export type LeaveState = "waiting" | "passed" | "approved" | "declined" | "cancelled";

/**
 * How a leave request reads to the teacher. A request still "asked" after
 * its last day is not "Pending": the day has gone and nobody answered
 * (smoke 20 Oct, a request for 13–14 Oct still said "बाकी").
 */
export function leaveState(row: { status: string; to_day: string }, today: string): LeaveState {
  if (row.status === "asked") return row.to_day < today ? "passed" : "waiting";
  if (row.status === "approved" || row.status === "declined" || row.status === "cancelled") return row.status;
  return "waiting";
}

export const LEAVE_STATE_TEXT: Record<LeaveState, Pair> = {
  waiting: p("Waiting for the office", "ऑफ़िस के जवाब का इंतज़ार"),
  passed: p("Date passed — no answer", "तारीख निकल गई — जवाब नहीं आया"),
  approved: p("Approved", "मंज़ूर"),
  declined: p("Not approved", "मंज़ूर नहीं"),
  cancelled: p("Cancelled", "रद्द"),
};

/** Only a request nobody has answered can be withdrawn, whatever its dates. */
export function mayCancelLeave(row: { status: string }): boolean {
  return row.status === "asked";
}

/**
 * The leave Today shows: anything not cancelled that still covers today or a
 * later day, soonest first, at most three. A teacher who sent a request saw
 * no trace of it on Today, and nothing when it was approved (smoke 20 Oct).
 */
export function leaveForToday<T extends { status: string; from_day: string; to_day: string }>(rows: readonly T[], today: string): T[] {
  return rows
    .filter((r) => r.status !== "cancelled" && r.to_day >= today)
    .sort((a, b) => a.from_day.localeCompare(b.from_day))
    .slice(0, 3);
}

/** One cover row for the teacher's own absence: who takes it, or nobody yet. */
export type MyCover = { day: string; number: number; classLabels: string[]; coverName: string | null };

/** "P2 Class 10 — Ms Rao takes it" / "P2 कक्षा 10 — Ms Rao लेंगे"; "— not arranged yet" when nobody does. */
export function coverLine(c: MyCover): Pair {
  const cls = classesPair(c.classLabels);
  return c.coverName
    ? p(`P${c.number} ${cls.en} — ${c.coverName} takes it`, `P${c.number} ${cls.hi} — ${c.coverName} लेंगे`)
    : p(`P${c.number} ${cls.en} — not arranged yet`, `P${c.number} ${cls.hi} — अभी किसी को नहीं दी गई`);
}

/**
 * The leave preview's period list with the class in each period:
 * "P2 Class 10 · P3 Class 7 · P4 Class 7". "periods 2, 3, 4 · Class 10,
 * Class 7" did not say which class was when (smoke 20 Oct).
 */
export function periodClassList(periods: readonly { number: number; classLabels: readonly string[] }[]): Pair {
  const parts = periods.map((x) => ({ n: x.number, c: classesPair(x.classLabels) }));
  return p(parts.map((x) => `P${x.n} ${x.c.en}`).join(" · "), parts.map((x) => `P${x.n} ${x.c.hi}`).join(" · "));
}

/* ------------------------------------------------------- class words */

/**
 * A class label in plain words for each reader: "NUR" is Nursery, and a
 * Hindi reader reads "कक्षा 6", not "Class 6". Labels the school typed
 * otherwise pass through.
 */
export function classWord(label: string): Pair {
  const t = label.trim();
  if (/^nur(sery)?$/i.test(t)) return p("Nursery", "नर्सरी");
  if (/^(lkg|jkg)$/i.test(t)) return p(t.toUpperCase(), t.toUpperCase());
  const m = /^class\s+(.+)$/i.exec(t);
  if (m) return p(`Class ${m[1]}`, `कक्षा ${m[1]}`);
  return p(t, t);
}

/** Several classes in one period: "Class 10, Class 7" → "कक्षा 10, कक्षा 7". */
export function classesPair(labels: readonly string[]): Pair {
  const words = labels.map(classWord);
  return p(words.map((w) => w.en).join(", "), words.map((w) => w.hi ?? w.en).join(", "));
}

/**
 * A combined period's classes as words: "Class 1 · 2 · 3 · 4 · 5" reads
 * "Classes 1–5 together" / "कक्षा 1 से 5 एक साथ". It looked like a glitch
 * with the subject code tacked on (smoke 20 Oct). One class passes through.
 */
export function combinedClasses(label: string): Pair {
  const parts = label.split("·").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return classWord(label);
  const first = parts[0].replace(/^class\s+/i, "");
  const rest = parts.slice(1).map((s) => s.replace(/^class\s+/i, ""));
  const all = [first, ...rest];
  const nums = all.map((s) => (/^\d+$/.test(s) ? Number(s) : NaN));
  if (nums.every((n) => Number.isFinite(n)) && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) {
    return p(`Classes ${nums[0]}–${nums[nums.length - 1]} together`, `कक्षा ${nums[0]} से ${nums[nums.length - 1]} एक साथ`);
  }
  const en = `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
  const hi = `${all.slice(0, -1).join(", ")} और ${all[all.length - 1]}`;
  return p(`Classes ${en} together`, `कक्षा ${hi} एक साथ`);
}

/** A subject in the reader's words: its name, never a bare code when a name exists. */
export function subjectWord(code: string, names: ReadonlyMap<string, { en: string; hi: string }>): Pair {
  const n = names.get(code);
  if (!n) return p(code, code);
  const en = n.en.trim() || code;
  const hi = n.hi.trim() || en;
  return p(en, hi);
}

/* ------------------------------------------------------- who she is */

/** What Today's help and empty states should talk about: her own class, only periods, or nothing yet. */
export type TeacherKind = "class" | "subject" | "new";

export function teacherKind(input: { classes: number; unassigned: boolean }): TeacherKind {
  if (input.classes > 0) return "class";
  if (input.unassigned) return "new";
  return "subject";
}

/** Her classes for the profile: her own class first, then the school's order (never as text). */
export function profileClasses<T extends { classId: string; held: boolean }>(classes: readonly T[], rank: ReadonlyMap<string, number>): T[] {
  return [...classes].sort((a, b) => Number(b.held) - Number(a.held) || (rank.get(a.classId) ?? 0) - (rank.get(b.classId) ?? 0));
}

/* --------------------------------------------------------- More tiles */

/** Report-card remarks still to write across her classes. */
export function remarksLeft(cards: readonly { done: number; total: number }[]): number {
  return cards.reduce((n, c) => n + Math.max(0, c.total - c.done), 0);
}

/**
 * The Marks tile's line. "Nothing waiting" only when there is truly nothing:
 * no paper to fill and no remark to write (smoke 20 Oct, 41 remarks hid
 * behind "Nothing waiting").
 */
export function marksTileLine(firstOpen: { classLabel: string; entered: number; total: number } | null, remarks: number): Pair {
  const parts: Pair[] = [];
  if (firstOpen) parts.push(p(`${firstOpen.classLabel} · ${firstOpen.entered} of ${firstOpen.total} entered`, `${firstOpen.classLabel} · ${firstOpen.total} में से ${firstOpen.entered} भरे`));
  if (remarks > 0) parts.push(p(`${remarks} report-card ${remarks === 1 ? "remark" : "remarks"} to write`, `${remarks} रिपोर्ट-कार्ड टिप्पणियाँ बाकी`));
  if (parts.length === 0) return p("Nothing waiting", "कुछ बाकी नहीं");
  return p(parts.map((x) => x.en).join(" · "), parts.map((x) => x.hi ?? x.en).join(" · "));
}

/* --------------------------------------------------------------- tasks */

/**
 * What an office task asks, in one line: "The office needs Address and
 * Photo for 1 child · by Fri 23 Oct". The task page showed only a title and
 * a line about approval (smoke 20 Oct).
 */
export function taskAsk(input: { fields: readonly { labelEn: string; labelHi: string }[]; children: number; dueLabel: Pair | null }): Pair {
  const en = input.fields.map((f) => f.labelEn || f.labelHi);
  const hi = input.fields.map((f) => f.labelHi || f.labelEn);
  const list = (xs: string[], and: string) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);
  const kids = input.children === 1 ? p("1 child", "1 बच्चे") : p(`${input.children} children`, `${input.children} बच्चों`);
  const dueEn = input.dueLabel ? ` · by ${input.dueLabel.en}` : "";
  const dueHi = input.dueLabel ? ` · ${input.dueLabel.hi ?? input.dueLabel.en} तक` : "";
  return p(`The office needs ${list(en, "and")} for ${kids.en}${dueEn}`, `ऑफ़िस को ${kids.hi} का ${list(hi, "और")} चाहिए${dueHi}`);
}
