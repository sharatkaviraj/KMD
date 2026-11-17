/**
 * Toilet checks (owner, 17 Nov 2026, D-652): pure rules. No database, no
 * words, no clock of its own: the caller passes "today" as an IST day.
 *
 * Each toilet is checked twice a school day, morning and afternoon, on a
 * paper chart One prints for one toilet and one week (Monday to Saturday).
 * After the week the chart is photographed and uploaded; the uploader taps
 * the boxes left empty on the paper. From that One works out, per toilet and
 * week, whether the chart came in, and which checks were missed.
 */

export const SLOTS = ["morning", "afternoon"] as const;
export type Slot = (typeof SLOTS)[number];

export const USED_BY = ["boys", "girls", "staff", "all"] as const;
export type UsedBy = (typeof USED_BY)[number];

export type Toilet = {
  id: string;
  name: string;
  place: string | null;
  usedBy: UsedBy;
  position: number;
  /** ISO time, so a toilet added on Wednesday owes no chart for the week before. */
  createdAt: string;
  removedAt: string | null;
  updatedAt: string;
};

export type CheckItem = { en: string; hi: string };

export type ToiletSettings = {
  morningAt: string;
  afternoonAt: string;
  checklist: CheckItem[];
  /** True when nothing was saved and One's own defaults are shown. */
  defaults: boolean;
};

export type Missed = { day: string; slot: Slot };

export type Chart = {
  id: string;
  toiletId: string;
  weekStart: string;
  pages: number;
  missed: Missed[];
  note: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  storedAt: string;
};

/** What the paper asks of each check, until the admin changes it. */
export const DEFAULT_CHECKLIST: readonly CheckItem[] = [
  { en: "Floor clean", hi: "फ़र्श साफ़" },
  { en: "Toilet / urinal clean", hi: "शौचालय / मूत्रालय साफ़" },
  { en: "Water there", hi: "पानी है" },
  { en: "Soap / handwash", hi: "साबुन / हैंडवॉश" },
  { en: "Dustbin emptied", hi: "कूड़ादान खाली" },
  { en: "No bad smell", hi: "बदबू नहीं" },
];

export const DEFAULT_TIMES = { morningAt: "09:00", afternoonAt: "13:00" } as const;

export const LIMITS = { name: 60, place: 60, item: 40, items: 8, note: 300, pages: 4, toilets: 60 } as const;

/** How far back the screen and Needs you look for a chart that never came. */
export const LOOK_BACK_WEEKS = 8;

/* ------------------------------------------------------------------- days */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week a day falls in (a Sunday belongs to the week before it). */
export function weekStartOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function isMonday(day: unknown): day is string {
  return isDay(day) && new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
}

/** Monday to Saturday: the six days a chart has rows for. */
export function weekDays(weekStart: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((n) => addDays(weekStart, n));
}

/** The IST day a stored time falls on. */
export function istDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

/** The weeks to show, newest first: this week and the `count - 1` before it. */
export function recentWeeks(today: string, count = LOOK_BACK_WEEKS): string[] {
  const current = weekStartOf(today);
  return Array.from({ length: count }, (_, i) => addDays(current, -7 * i));
}

/* ------------------------------------------------------------------ times */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normaliseTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const t = `${m[1].padStart(2, "0")}:${m[2]}`;
  return TIME.test(t) ? t : null;
}

/* ----------------------------------------------------------------- status */

/**
 * Where one toilet's chart for one week stands.
 *
 *   done       uploaded
 *   this_week  the week is not over yet
 *   due_today  the week is over and today is the Monday after: upload today
 *   late       the Monday after has gone and nothing came
 *   closed     the school was shut every day of that week
 *   not_needed the toilet was not on the list that week
 */
export type ChartState = "done" | "this_week" | "due_today" | "late" | "closed" | "not_needed";

export type WeekRow = {
  toilet: Toilet;
  weekStart: string;
  state: ChartState;
  chart: Chart | null;
  /** The open days of the week, Monday to Saturday. */
  openDays: string[];
  /** The checks the uploader said were empty, on open days only. */
  missed: Missed[];
  /** The two checks of every open day. */
  checks: number;
};

export function onListThatWeek(toilet: Toilet, weekStart: string): boolean {
  const end = addDays(weekStart, 5);
  if (istDayOf(toilet.createdAt) > end) return false;
  // Taken off the list during the week: that week is not owed either.
  if (toilet.removedAt && istDayOf(toilet.removedAt) <= end) return false;
  return true;
}

export function weekRow(input: {
  toilet: Toilet;
  weekStart: string;
  chart: Chart | null;
  today: string;
  isOpen: (day: string) => boolean;
}): WeekRow {
  const { toilet, weekStart, chart, today } = input;
  const openDays = weekDays(weekStart).filter((d) => input.isOpen(d));
  const open = new Set(openDays);
  const missed = chart ? chart.missed.filter((m) => open.has(m.day)) : [];
  const base = { toilet, weekStart, chart, openDays, missed, checks: openDays.length * 2 };
  if (chart) return { ...base, state: "done" };
  if (!onListThatWeek(toilet, weekStart)) return { ...base, state: "not_needed" };
  if (openDays.length === 0) return { ...base, state: "closed" };
  const saturday = addDays(weekStart, 5);
  if (today <= saturday) return { ...base, state: "this_week" };
  // Sunday and the Monday after: upload it now.
  if (today <= addDays(weekStart, 7)) return { ...base, state: "due_today" };
  return { ...base, state: "late" };
}

export type WeekBoard = {
  weekStart: string;
  rows: WeekRow[];
  uploaded: number;
  /** Charts this week should have: everything except closed and not needed. */
  expected: number;
  missedChecks: number;
};

export function buildWeek(input: {
  toilets: readonly Toilet[];
  charts: readonly Chart[];
  weekStart: string;
  today: string;
  isOpen: (day: string) => boolean;
}): WeekBoard {
  const byToilet = new Map(input.charts.filter((c) => c.weekStart === input.weekStart).map((c) => [c.toiletId, c]));
  const rows = sortToilets(input.toilets)
    .map((toilet) => weekRow({ toilet, weekStart: input.weekStart, chart: byToilet.get(toilet.id) ?? null, today: input.today, isOpen: input.isOpen }))
    // A toilet not on the list that week is left out, unless a chart came for it.
    .filter((row) => row.state !== "not_needed");
  const counted = rows.filter((r) => r.state !== "closed" && r.state !== "not_needed");
  return {
    weekStart: input.weekStart,
    rows,
    uploaded: counted.filter((r) => r.state === "done").length,
    expected: counted.length,
    missedChecks: rows.reduce((n, r) => n + r.missed.length, 0),
  };
}

export function sortToilets<T extends Pick<Toilet, "position" | "name">>(toilets: readonly T[]): T[] {
  return [...toilets].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/* ------------------------------------------------------------------- gaps */

export type Gaps = {
  /** Charts whose week is over and that never came, newest week first. */
  late: { toilet: Toilet; weekStart: string }[];
  /** Due today (the Monday after the week). */
  dueToday: { toilet: Toilet; weekStart: string }[];
  /** Missed checks on last week's charts. */
  missedLastWeek: { toilet: Toilet; weekStart: string; missed: Missed[] }[];
  lastWeek: string;
};

/**
 * What the admin and office should hear about: charts not uploaded in the
 * last eight weeks, and the checks the uploader said were missed last week.
 * Older missed checks stay on the screen but no longer ask for attention.
 */
export function findGaps(input: {
  toilets: readonly Toilet[];
  charts: readonly Chart[];
  today: string;
  isOpen: (day: string) => boolean;
  weeks?: number;
}): Gaps {
  const weeks = recentWeeks(input.today, input.weeks ?? LOOK_BACK_WEEKS);
  const lastWeek = weeks[1];
  const gaps: Gaps = { late: [], dueToday: [], missedLastWeek: [], lastWeek };
  for (const weekStart of weeks) {
    const board = buildWeek({ toilets: input.toilets, charts: input.charts, weekStart, today: input.today, isOpen: input.isOpen });
    for (const row of board.rows) {
      if (row.state === "late") gaps.late.push({ toilet: row.toilet, weekStart });
      if (row.state === "due_today") gaps.dueToday.push({ toilet: row.toilet, weekStart });
      if (weekStart === lastWeek && row.missed.length) gaps.missedLastWeek.push({ toilet: row.toilet, weekStart, missed: row.missed });
    }
  }
  return gaps;
}

export function gapCount(g: Gaps): number {
  return g.late.length + g.dueToday.length + g.missedLastWeek.length;
}

/* ----------------------------------------------------------------- checks */

export type Problem = "name_missing" | "name_long" | "place_long" | "used_by" | "time" | "times_order" | "items_none" | "items_many" | "item_long" | "item_blank";

export type ToiletDraft = { name: string; place: string; usedBy: string };
export type ToiletInput = { name: string; place: string | null; usedBy: UsedBy };

const tidy = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

export function checkToilet(draft: ToiletDraft): { ok: true; value: ToiletInput } | { ok: false; fields: Record<string, Problem> } {
  const fields: Record<string, Problem> = {};
  const name = tidy(draft.name);
  const place = tidy(draft.place);
  if (!name) fields.name = "name_missing";
  else if (name.length > LIMITS.name) fields.name = "name_long";
  if (place.length > LIMITS.place) fields.place = "place_long";
  if (!(USED_BY as readonly string[]).includes(draft.usedBy)) fields.usedBy = "used_by";
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { name, place: place || null, usedBy: draft.usedBy as UsedBy } };
}

export type SettingsDraft = { morningAt: string; afternoonAt: string; checklist: { en: string; hi: string }[] };

export function checkSettings(draft: SettingsDraft): { ok: true; value: Omit<ToiletSettings, "defaults"> } | { ok: false; fields: Record<string, Problem> } {
  const fields: Record<string, Problem> = {};
  const morningAt = normaliseTime(draft.morningAt);
  const afternoonAt = normaliseTime(draft.afternoonAt);
  if (!morningAt) fields.morningAt = "time";
  if (!afternoonAt) fields.afternoonAt = "time";
  if (morningAt && afternoonAt && morningAt >= afternoonAt) fields.afternoonAt = "times_order";
  const items = (Array.isArray(draft.checklist) ? draft.checklist : [])
    .map((i) => ({ en: tidy(i?.en), hi: tidy(i?.hi) }))
    .filter((i) => i.en || i.hi);
  if (items.length === 0) fields.checklist = "items_none";
  else if (items.length > LIMITS.items) fields.checklist = "items_many";
  else if (items.some((i) => i.en.length > LIMITS.item || i.hi.length > LIMITS.item)) fields.checklist = "item_long";
  else if (items.some((i) => !i.en && !i.hi)) fields.checklist = "item_blank";
  if (Object.keys(fields).length || !morningAt || !afternoonAt) return { ok: false, fields };
  // A line written in one language only is printed in that language twice rather than left blank.
  return { ok: true, value: { morningAt, afternoonAt, checklist: items.map((i) => ({ en: i.en || i.hi, hi: i.hi || i.en })) } };
}

/** The missed list a phone sent, or null when any entry is not an open day and slot of that week, or repeats one. */
export function cleanMissed(value: unknown, weekStart: string, isOpen: (day: string) => boolean = () => true): Missed[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const days = new Set(weekDays(weekStart));
  const seen = new Set<string>();
  const out: Missed[] = [];
  for (const raw of value) {
    const day = (raw as { day?: unknown })?.day;
    const slot = (raw as { slot?: unknown })?.slot;
    if (!isDay(day) || !days.has(day) || !isOpen(day)) return null;
    if (slot !== "morning" && slot !== "afternoon") return null;
    const key = `${day}:${slot}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ day, slot });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.slot.localeCompare(b.slot));
}

/** A week a chart may be uploaded for: a Monday, not after this week, not before the look-back. */
export function uploadableWeek(weekStart: unknown, today: string): weekStart is string {
  if (!isMonday(weekStart)) return false;
  const current = weekStartOf(today);
  return weekStart <= current && weekStart >= addDays(current, -7 * (LOOK_BACK_WEEKS + 4));
}

/** The storage path of one page: session / toilet / week / chart-page.jpg. */
export function pagePath(input: { sessionLabel: string; toiletId: string; weekStart: string; chartId: string; page: number }): string {
  return `${input.sessionLabel}/${input.toiletId}/${input.weekStart}/${input.chartId}-${input.page}.jpg`;
}

/** JPEG by its first bytes. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
