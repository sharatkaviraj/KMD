/**
 * The Students list's views and badges. Pure — no database, no React — so the
 * rules are unit-tested in `tests/vx-students-logic.test.ts`.
 *
 * Two views over the same children: **School** (everyone's default — class,
 * attendance, a few facts) and **Fees** (only for `fees:view` — the money
 * columns and the fee chips). A row shows at most three badges; the rest wait
 * behind "+N details". Every badge is a fact with a source, never a judgement:
 * no "weak", no "at risk".
 */

import type { StudentSegment } from "@/vx/screens/admin/logic";

/* ----------------------------------------------------------------- views */

export type StudentView = "school" | "fees";

export const STUDENT_VIEWS: readonly StudentView[] = ["school", "fees"];

/** The cookie that remembers a person's last chosen view. */
export const STUDENT_VIEW_COOKIE = "vx_students_view";

export function parseStudentView(value: string | null | undefined): StudentView | null {
  return (STUDENT_VIEWS as readonly string[]).includes(value ?? "") ? (value as StudentView) : null;
}

/**
 * The cookie's value: the view, keyed to the staff profile that chose it, so
 * a shared office computer never hands one person's choice to the next. A dot
 * between them, because a dot needs no cookie encoding and a uuid has none.
 */
export function studentViewCookieValue(staffId: string, view: StudentView): string {
  return `${staffId}.${view}`;
}

/** The remembered view for this person, or null when the cookie is absent, malformed or someone else's. */
export function readStudentViewCookie(raw: string | null | undefined, staffId: string): StudentView | null {
  if (!raw || !staffId) return null;
  const at = raw.lastIndexOf(".");
  if (at <= 0) return null;
  if (raw.slice(0, at) !== staffId) return null;
  return parseStudentView(raw.slice(at + 1));
}

/**
 * Which view a request opens in.
 *
 * Without `fees:view` it is always School. Otherwise an explicit `?view=` wins;
 * then a fee chip in the URL (`?seg=pending`) — a chip only exists in the Fees
 * view, so an old link keeps working; then what the person last chose; and a
 * person who never chose gets Fees, the list the design draws for the office
 * (D01/F05; the design wins over D-253's School default, UI-85).
 */
export function resolveStudentView(input: {
  param: string | null | undefined;
  seg: StudentSegment;
  remembered: StudentView | null;
  seesMoney: boolean;
}): StudentView {
  if (!input.seesMoney) return "school";
  const explicit = parseStudentView(input.param);
  if (explicit) return explicit;
  if (input.seg !== "all") return "fees";
  return input.remembered ?? "fees";
}

/* ---------------------------------------------------------------- sorting */

export type StudentSortKey = "name" | "class" | "pending" | "notdue" | "paid";

export type StudentSort = { key: StudentSortKey; dir: 1 | -1 };

const SORT_KEYS: readonly StudentSortKey[] = ["name", "class", "pending", "notdue", "paid"];

/** The design's first click: names and classes A→Z, money largest first. */
export function defaultSortDir(key: StudentSortKey): 1 | -1 {
  return key === "name" || key === "class" ? 1 : -1;
}

export function parseStudentSort(key: string | null | undefined, dir: string | null | undefined): StudentSort {
  const k = (SORT_KEYS as readonly string[]).includes(key ?? "") ? (key as StudentSortKey) : "name";
  const d = dir === "desc" ? -1 : dir === "asc" ? 1 : defaultSortDir(k);
  return { key: k, dir: d };
}

/** Clicking a column: the same column flips, another starts in its own direction. */
export function nextSort(current: StudentSort, key: StudentSortKey): StudentSort {
  return current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: defaultSortDir(key) };
}

/**
 * How a column can be sorted honestly here. When the whole list is on this
 * page, any column sorts in place, either way. Across pages only the database
 * can order the list, and it orders by name or by class, A→Z; the money
 * figures are worked out after paging, so they do not sort at all then.
 */
export function sortMode(key: StudentSortKey, onePage: boolean): "page" | "server" | null {
  if (onePage) return "page";
  return key === "name" || key === "class" ? "server" : null;
}

type SortableRow = { name: string; classLabel: string; classOrder?: number; money: { pendingToday: number; notDueYet: number; percent: number } | null };

/** The rows in the chosen order; ties keep the name order the server sent. */
export function sortStudentRows<T extends SortableRow>(rows: readonly T[], sort: StudentSort): T[] {
  const value = (row: T): number | string => {
    switch (sort.key) {
      case "class":
        return row.classOrder ?? row.classLabel.toLowerCase();
      case "pending":
        return row.money?.pendingToday ?? -1;
      case "notdue":
        return row.money?.notDueYet ?? -1;
      case "paid":
        return row.money?.percent ?? -1;
      default:
        return row.name.toLowerCase();
    }
  };
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0) * sort.dir || a.i - b.i)
    .map((x) => x.row);
}

/* ------------------------------------------------------- class by search */

function classKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/^class\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The search box finds a class too ("Name, SR no., class or parent"): a query
 * that is exactly one class's name — "Class 7", "7", "ukg", "11 science" —
 * filters to that class. Anything else stays a name/SR/parent search.
 */
export function classFromQuery(q: string, classes: readonly { id: string; label: string }[]): { id: string; label: string } | null {
  const key = classKey(q);
  if (!key) return null;
  const hits = classes.filter((c) => classKey(c.label) === key);
  return hits.length === 1 ? hits[0] : null;
}

/* ------------------------------------------------------------ money line */

export type MoneyStatus = { kind: "pending"; amount: number } | { kind: "track"; amount: number } | { kind: "paid" };

/**
 * One child's money in the design's three words: an amount pending today,
 * "On track" with what falls due later, or "Paid up". The late fee is never
 * added in (RULES B); a child who owes only a late fee reads "Paid up" for fees.
 */
export function moneyStatus(money: { pendingToday: number; notDueYet: number }): MoneyStatus {
  if (money.pendingToday > 0) return { kind: "pending", amount: money.pendingToday };
  if (money.notDueYet > 0) return { kind: "track", amount: money.notDueYet };
  return { kind: "paid" };
}

/* ------------------------------------------------------ return to place */

/** sessionStorage key for the list's scroll position when a profile is opened. */
export const STUDENTS_SCROLL_KEY = "vx:students:scroll";

/** Only the directory can be a profile's return destination. Never an external URL. */
export function studentReturnHref(raw: string | null | undefined): string {
  if (!raw || !/^\/students(?:[?#]|$)/.test(raw)) return "/students";
  try {
    const url = new URL(raw, "https://students.invalid");
    if (url.origin !== "https://students.invalid" || url.pathname !== "/students") return "/students";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/students";
  }
}

/** Keep the directory's filters on real links and on in-place profile tab switches. */
export function studentProfileHref(id: string, returnTo?: string | null, tab?: string): string {
  const params = new URLSearchParams();
  if (tab && tab !== "overview") params.set("tab", tab);
  const back = studentReturnHref(returnTo);
  if (back !== "/students") params.set("returnTo", back);
  const query = params.toString();
  return `/students/${id}${query ? `?${query}` : ""}`;
}

/** Older than this, a saved position is a stale visit, not a return. */
export const SCROLL_TTL_MS = 30 * 60 * 1000;

export type SavedScroll = { url: string; y: number; at: number };

export function savedScroll(url: string, y: number, at: number): string {
  return JSON.stringify({ url, y: Math.max(0, Math.round(y)), at } satisfies SavedScroll);
}

/**
 * Where to scroll back to, or null. Only for the very list that was left —
 * same path, same search, same view, same page — and only recently.
 */
export function scrollToRestore(raw: string | null | undefined, url: string, now: number): number | null {
  if (!raw) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!saved || typeof saved !== "object") return null;
  const { url: was, y, at } = saved as Partial<SavedScroll>;
  if (was !== url || typeof y !== "number" || !Number.isFinite(y) || y <= 0) return null;
  if (typeof at !== "number" || now - at < 0 || now - at > SCROLL_TTL_MS) return null;
  return y;
}

/* ------------------------------------------------------------ attendance */

export type AttendanceFacts = {
  /** Days present, half days at the school's credit (late counts as present). */
  credit: number;
  /** Days on submitted registers, leave not counted. */
  counted: number;
  pct: number | null;
};

/** "17.5" or "18": a half day is the only fraction the register produces. */
export function attendanceDays(value: number): string {
  const rounded = Math.round(value * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The figure a row shows, or null for a child with no submitted register yet. */
export function attendanceFigure(att: AttendanceFacts | null | undefined): { present: string; counted: number; pct: number | null } | null {
  if (!att || att.counted <= 0) return null;
  return { present: attendanceDays(att.credit), counted: att.counted, pct: att.pct === null ? null : Math.round(att.pct) };
}

/* ---------------------------------------------------------------- badges */

export type EmiStatus = "upcoming" | "on_track" | "due" | "behind" | "completed";

/** What is known about one child, as plain facts. Money facts are empty for a reader without `fees:view`. */
export type StudentFacts = {
  attendance: AttendanceFacts | null;
  /** Other children in the same confirmed family. */
  siblings: number;
  /** The fee app's "New" tier — the chip "New this year" reads the same flag. */
  isNew: boolean;
  route: string | null;
  /** The fee app's own Year Clear rule (`isYearCleared`). */
  yearClear: boolean;
  emi: { status: EmiStatus; monthly: number; nextDue: string | null } | null;
  /** RTE / Staff Child / 3rd Child Policy. Office context only. */
  concessions: string[];
};

export type BadgeTone = "ok" | "warn" | "bad" | "mut";

export type StudentBadge =
  | { kind: "attendance"; tone: BadgeTone; present: string; counted: number; pct: number | null }
  | { kind: "siblings"; tone: BadgeTone; count: number }
  | { kind: "new"; tone: BadgeTone }
  | { kind: "route"; tone: BadgeTone; route: string }
  | { kind: "yearClear"; tone: BadgeTone }
  | { kind: "emi"; tone: BadgeTone; status: EmiStatus; monthly: number; nextDue: string | null }
  | { kind: "concession"; tone: BadgeTone; label: string };

export type BadgeKind = StudentBadge["kind"];

/** How many badges a row shows before "+N details". */
export const MAX_BADGES = 3;

/**
 * The order badges are read in, per view. School leads with who the child is
 * (family, new, bus); Fees leads with what the desk acts on. Attendance is the
 * School view's own column and the route the Fees view's, so neither repeats
 * as a badge there. A concession is never a School headline: it is listed
 * after everything else and only ever reaches the details.
 */
const ORDER: Record<StudentView, readonly BadgeKind[]> = {
  school: ["siblings", "new", "route", "yearClear", "emi", "concession"],
  fees: ["emi", "yearClear", "concession", "siblings", "new", "attendance"],
};

/** Kinds that may be shown before "+N details" in each view. */
const HEADLINE: Record<StudentView, ReadonlySet<BadgeKind>> = {
  school: new Set<BadgeKind>(["siblings", "new", "route", "yearClear", "emi"]),
  fees: new Set<BadgeKind>(["emi", "yearClear", "concession", "siblings", "new", "attendance"]),
};

const MONEY_KINDS: ReadonlySet<BadgeKind> = new Set<BadgeKind>(["yearClear", "emi", "concession"]);

function emiTone(status: EmiStatus): BadgeTone {
  // Red only for the one specific overdue state: an EMI whose date has passed unpaid.
  if (status === "behind") return "bad";
  if (status === "due") return "warn";
  if (status === "completed") return "ok";
  return "mut";
}

function badgesOf(facts: StudentFacts, kind: BadgeKind): StudentBadge[] {
  switch (kind) {
    case "attendance": {
      const figure = attendanceFigure(facts.attendance);
      return figure ? [{ kind, tone: "mut", ...figure }] : [];
    }
    case "siblings":
      return facts.siblings > 0 ? [{ kind, tone: "mut", count: facts.siblings }] : [];
    case "new":
      return facts.isNew ? [{ kind, tone: "mut" }] : [];
    case "route":
      return facts.route ? [{ kind, tone: "mut", route: facts.route }] : [];
    case "yearClear":
      return facts.yearClear ? [{ kind, tone: "ok" }] : [];
    case "emi":
      return facts.emi ? [{ kind, tone: emiTone(facts.emi.status), ...facts.emi }] : [];
    case "concession":
      return facts.concessions.filter((label) => label.trim() !== "").map((label) => ({ kind, tone: "mut" as const, label }));
  }
}

/**
 * One row's badges: up to `MAX_BADGES` headline ones in the view's order, and
 * the rest for "+N details". A reader without `fees:view` gets no money badge
 * at all — not even in the details.
 */
export function studentBadges(facts: StudentFacts, options: { view: StudentView; seesMoney: boolean }): { shown: StudentBadge[]; more: StudentBadge[] } {
  const view: StudentView = options.seesMoney ? options.view : "school";
  const all = ORDER[view].filter((kind) => options.seesMoney || !MONEY_KINDS.has(kind)).flatMap((kind) => badgesOf(facts, kind));
  const shown: StudentBadge[] = [];
  const more: StudentBadge[] = [];
  for (const badge of all) {
    if (shown.length < MAX_BADGES && HEADLINE[view].has(badge.kind)) shown.push(badge);
    else more.push(badge);
  }
  return { shown, more };
}
