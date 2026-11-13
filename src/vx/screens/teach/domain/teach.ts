/**
 * The teacher app's rules (design TchHome, TchAttend, TchClass, TchMore).
 * Pure: no React, no database, no clock of its own — the caller passes "now".
 * Unit-tested in `tests/vx-teach.test.ts`.
 */

import { p, type Pair } from "@/vx/text";

export type Mark = "present" | "absent" | "half_day" | "late" | "leave";

/* ------------------------------------------------------------ the register */

/**
 * One tap on a child's card: Present ⇄ Absent. Any other mark (half day,
 * late, leave from the office) goes back to Present.
 *
 * The cycle used to be Present → Absent → Half-day → Present, and a teacher
 * who tapped the wrong child and tapped again to undo it saved a half day
 * instead (20 Oct smoke run: "दोबारा दबाया तो आधा दिन हो गया"). Half-day is
 * now its own explicit choice on an away child's card — `halfDaySwap`.
 */
export function nextTap(mark: Mark | undefined): Mark {
  return (mark ?? "present") === "present" ? "absent" : "present";
}

/**
 * The "Half-day" / "Absent all day" choice on an away child's card. A child
 * on Leave is offered a half day, not "absent all day": Leave is already the
 * whole day away, and taps on the card still reach Present and Absent (D-603).
 */
export function halfDaySwap(mark: Mark | undefined): Mark {
  return mark === "half_day" ? "absent" : "half_day";
}

/**
 * The name of the register's yellow group (D-603): "Half-day" while it holds
 * only half days, "Leave" while only children on leave, both when it holds
 * both. A child on Leave was read as "Half-day" until 13 Nov.
 */
export function halfOrLeave(c: { halfDay: number; leave: number }): Pair {
  return c.leave ? (c.halfDay ? p("Half-day or leave", "आधा दिन या छुट्टी") : p("Leave", "छुट्टी")) : p("Half-day", "आधा दिन");
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

// One rule for every vx screen (moved to the shared domain, smoke 20 Oct).
export { shownSr, tellApart } from "@/vx/domain/tell-apart";

/* --------------------------------------------------------- finding a child */

const DEV_VOWEL: Record<string, string> = { "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o" };
const DEV_SIGN: Record<string, string> = { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o" };
const DEV_CONS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
};
const NUKTA = "़";
const VIRAMA = "्";
const NASAL = new Set(["ं", "ँ", "ः"]);

/**
 * A name typed on a Hindi keyboard, in English letters: "ईशान" → "ishaan",
 * "ध्रुव" → "dhruv". Rough on purpose — it only has to land near the English
 * spelling the school stored, and `nameKey` forgives the rest.
 */
export function devToLatin(text: string): string {
  // The dot under ज़ or फ़ changes nothing a search needs: drop it.
  const chars = [...text.normalize("NFD")].filter((c) => c !== NUKTA);
  let out = "";
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    const cons = DEV_CONS[c];
    if (cons) {
      out += cons;
      const next = chars[i + 1];
      if (next && DEV_SIGN[next]) {
        out += DEV_SIGN[next];
        i += 1;
      } else if (next === VIRAMA) {
        i += 1;
      } else if (next && (DEV_CONS[next] || DEV_VOWEL[next] || NASAL.has(next))) {
        out += "a";
      }
      // A consonant at the end of a word keeps no vowel: "राघव" is "raghav".
      continue;
    }
    if (DEV_VOWEL[c]) out += DEV_VOWEL[c];
    else if (c === "ं" || c === "ँ") out += "n";
    else if (c === "ः") out += "h";
    else if (DEV_SIGN[c]) out += DEV_SIGN[c];
    else if (!/[ऀ-ॿ]/.test(c)) out += c;
  }
  return out;
}

/**
 * A spelling-forgiving key for a word of a name: lower case, Hindi letters in
 * English, and the spellings Indian names are written several ways folded
 * together ("Ishaan"/"Ishan", "Namoona"/"Namuna", "Shiv"/"Siv").
 */
export function nameKey(word: string): string {
  let s = devToLatin(word).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [from, to] of [["chh", "c"], ["ch", "c"], ["sh", "s"], ["kh", "k"], ["gh", "g"], ["th", "t"], ["dh", "d"], ["ph", "f"], ["bh", "b"], ["jh", "j"], ["w", "v"], ["z", "j"], ["q", "k"], ["ee", "i"], ["oo", "u"], ["ou", "u"]] as const) {
    s = s.split(from).join(to);
  }
  return s.replace(/(.)\1+/g, "$1");
}

/** The key's consonants, the first letter kept: "ishan" → "isn". For the loosest pass. */
function skeleton(key: string): string {
  return key.slice(0, 1) + key.slice(1).replace(/[aeiouy]/g, "");
}

/** Whether two short strings are at most one edit apart. */
function oneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function wordMatches(query: string, nameWords: readonly string[]): boolean {
  const plain = query.toLowerCase();
  const key = nameKey(query);
  if (!key) return false;
  return nameWords.some((w) => {
    if (w.toLowerCase().includes(plain)) return true;
    const k = nameKey(w);
    if (k.startsWith(key)) return true;
    if (key.length >= 3 && skeleton(k).startsWith(skeleton(key))) return true;
    if (key.length >= 4) {
      for (const len of [key.length - 1, key.length, key.length + 1]) if (oneEdit(key, k.slice(0, len))) return true;
    }
    return false;
  });
}

/**
 * A child matches a search by the number on the card (the roll number, or
 * the child's place in the list when the class has no roll numbers), the SR
 * number, or every word typed — in English or Hindi letters, with a small
 * spelling slip forgiven (20 Oct smoke run: "13", "Ishan" and "ईशान" all
 * found nobody).
 */
export function childMatches(child: { name: string; rollNo: string | null; admissionNo?: string | null; serial?: number | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    if ((child.rollNo ?? "").trim().toLowerCase() === q || Number((child.rollNo ?? "").replace(/\D/g, "")) === n) return true;
    if (child.serial === n && !child.rollNo) return true;
  }
  if ((child.admissionNo ?? "").toLowerCase() === q) return true;
  const words = child.name.split(/\s+/).filter(Boolean);
  return q.split(/\s+/).filter(Boolean).every((w) => wordMatches(w, words));
}

/* --------------------------------------------------------- days and times */

const WD_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_EN_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD_HI = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];
const WD_HI_LONG = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const MO_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MO_EN_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MO_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

/**
 * Days for the register in each reader's language, from fixed tables so the
 * server and the phone write them the same way (the browser's Hindi month
 * names differ from Node's). "Mon 19 Oct" / "सोम 19 अक्टूबर".
 */
export function dayShortP(day: string): Pair {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const wd = d.getUTCDay();
  const m = d.getUTCMonth();
  const n = d.getUTCDate();
  return p(`${WD_EN[wd]} ${n} ${MO_EN[m]}`, `${WD_HI[wd]} ${n} ${MO_HI[m]}`);
}

/** "Monday 19 October" / "सोमवार 19 अक्टूबर". */
export function dayLongP(day: string): Pair {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const wd = d.getUTCDay();
  const m = d.getUTCMonth();
  const n = d.getUTCDate();
  return p(`${WD_EN_LONG[wd]} ${n} ${MO_EN_LONG[m]}`, `${WD_HI_LONG[wd]} ${n} ${MO_HI[m]}`);
}

/** "October 2026" / "अक्टूबर 2026"; `short` drops the year. */
export function monthTitleP(month: string, short = false): Pair {
  const [y, m] = month.split("-").map(Number);
  const en = MO_EN_LONG[(m || 1) - 1];
  const hi = MO_HI[(m || 1) - 1];
  return short ? p(en, hi) : p(`${en} ${y}`, `${hi} ${y}`);
}

/** The month grid's column heads, Monday first. */
export const WEEK_HEADS: Pair[] = [p("M", "सो"), p("T", "मं"), p("W", "बु"), p("T", "गु"), p("F", "शु"), p("S", "श"), p("S", "र")];

/**
 * A saved time with its part of the day, in the school's timezone:
 * "11:02 pm" / "रात 11:02". The card dropped "pm" while the toast kept it,
 * and Hindi read "10:58 pm बजे" (20 Oct smoke run).
 */
export function timeP(iso: string): Pair {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return p("—");
  const ist = new Date(at.getTime() + 330 * 60_000);
  const h = ist.getUTCHours();
  const m = String(ist.getUTCMinutes()).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const part = h >= 4 && h < 12 ? "सुबह" : h >= 12 && h < 16 ? "दोपहर" : h >= 16 && h < 19 ? "शाम" : "रात";
  return p(`${h12}:${m} ${h < 12 ? "am" : "pm"}`, `${part} ${h12}:${m}`);
}

/** "Class 4" in Hindi reads "कक्षा 4"; any other label is kept as it is. */
export function classLabelP(label: string): Pair {
  return p(label, label.replace(/^class\s+/i, "कक्षा "));
}

/* ------------------------------------------------------ the parent message */

/**
 * Whether the parent-WhatsApp switch starts on (20 Oct smoke run: it was on
 * for every save and came back on for every correction, after the teacher
 * had turned it off).
 *
 * - The first save of today's register: on — the school's 10 am message.
 * - The first save of a past day: off — a message a day late is not news.
 * - A correction: on only if messages for this register are still waiting,
 *   so saving a small change neither messages a family the teacher already
 *   chose not to message nor silently stops the ones she chose to send.
 *
 * Whatever the teacher picks in the sheet stays picked (`chosen`).
 */
export function alertsDefault(input: { mode: "mark" | "change"; isToday: boolean; queued: number; chosen?: boolean | null; admin?: "off" | "ask_off" | "ask_on" }): boolean {
  // The admin's Settings → Parent messages: "off" means no message at all,
  // whatever the phone remembers; "ask_off" starts today's switch off.
  if (input.admin === "off") return false;
  if (typeof input.chosen === "boolean") return input.chosen;
  if (input.mode === "change") return input.queued > 0;
  return input.isToday && input.admin !== "ask_off";
}

/**
 * The children whose mark in a kept draft differs from what the register
 * holds. A draft that changes nothing is not offered back.
 */
export function draftChanges(ids: readonly string[], base: Readonly<Record<string, Mark>>, draft: Readonly<Record<string, Mark>>): string[] {
  return ids.filter((id) => draft[id] !== undefined && (draft[id] ?? "present") !== (base[id] ?? "present"));
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

/**
 * A class insight with every attendance figure taken out, for a reader who
 * may see the class but not its attendance — a subject teacher (owner, 6 Nov
 * 2026: only the class teacher sees her class's attendance).
 */
export function withoutAttendance<C extends { attendancePct: number | null; daysCounted: number; presentDays: number; reasons: readonly AttentionReason[] }, T extends { children: readonly C[]; classAttendance: number | null }>(insight: T): T {
  return {
    ...insight,
    classAttendance: null,
    children: insight.children.map((c) => ({ ...c, attendancePct: null, daysCounted: 0, presentDays: 0, reasons: c.reasons.filter((r) => r !== "attendance") })),
  };
}

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

/** One leave submission's id and the exact request it was made for. */
export type LeaveSubmission = { id: string; request: string };

/**
 * The id a leave send carries (`requestLeaveVx`): the same one for every try
 * of the same request, so a send whose answer was lost and is tapped again
 * files once; a fresh one as soon as the request differs in any way — another
 * day, span, reason or note is another request and must file on its own.
 */
export function leaveSubmissionFor(
  previous: LeaveSubmission | null,
  input: { days: readonly string[]; span: string; reason: string; note: string },
  newId: () => string,
): LeaveSubmission {
  const request = JSON.stringify([[...input.days], input.span, input.reason, input.note]);
  return previous && previous.request === request ? previous : { id: newId(), request };
}

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

/**
 * The absent alert a teacher may queue for 10 am (RULES H: Hindi first).
 *
 * Give `day` (and the school's `today`) and the date is written in each
 * language — "सोमवार 19 अक्टूबर" in the Hindi, "Monday 19 October" in the
 * English — and a past day says "was absent on", never "today": a register
 * marked a day late sent "is absent from school today, 19 Oct" (20 Oct smoke
 * run). `dayLabel` alone is the older call and is written as given.
 */
export function absentAlert(input: { childName: string; classLabel: string; school: string; dayLabel?: string; day?: string; today?: string }): { hi: string; en: string } {
  const label = input.day ? dayLongP(input.day) : p(input.dayLabel ?? "", input.dayLabel ?? "");
  const past = Boolean(input.day && input.today && input.day < input.today);
  const hiDay = label.hi ?? label.en;
  if (past) {
    return {
      hi: `नमस्ते, ${input.childName} (${classLabelP(input.classLabel).hi}) ${hiDay} को स्कूल नहीं आए थे। कृपया कारण बताएँ। — ${input.school}`,
      en: `Hello, ${input.childName} (${input.classLabel}) was absent from school on ${label.en}. Please let us know why. — ${input.school}`,
    };
  }
  return {
    hi: `नमस्ते, ${input.childName} (${input.day ? classLabelP(input.classLabel).hi : input.classLabel}) आज ${hiDay} को स्कूल नहीं आए। कृपया कारण बताएँ। — ${input.school}`,
    en: `Hello, ${input.childName} (${input.classLabel}) is absent from school today, ${label.en}. Please let us know why. — ${input.school}`,
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
