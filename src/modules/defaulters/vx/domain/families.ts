/**
 * Dues & calls (design `Dues`), as pure functions. Unit-tested in
 * `tests/vx-fee-desk-dues.test.ts`.
 *
 * The rule that shapes every number here (RULES.md B): **pending today**, **not
 * due yet** and **late fee** are three different amounts and are never added
 * together. A family whose only debt today is a late fee is not on the call
 * list.
 */

export type DuesStudent = {
  studentId: string;
  fullName: string;
  fatherName: string | null;
  fatherPhone: string | null;
  classLabel: string;
  transportRouteId: string | null;
  /** Fees whose due date has passed, late fee excluded. */
  overdueAmount: number;
  /** Every fee still owed this session (overdue and not yet due), late fee excluded. */
  totalPending: number;
  /** Late fee still owed. Kept apart. */
  lateFee: number;
  /**
   * Fees on installments due today or later, read off the installment rows —
   * the same rule as Reports (due-rule.ts). When given it replaces
   * totalPending − overdue, which also counted a child whose fees were never
   * set up as installments (TEST: 507 such seed children, ₹1.13 Cr, so Dues
   * read "₹117 L not due yet" against Reports' ₹4.4 L; 6 Nov 2026).
   */
  notDueYet?: number;
  daysOverdue: number;
  familyGroupId?: string | null;
  lastPaymentDate?: string | null;
  /** Installment numbers with an overdue balance (1–4; 0 = last session's balance). */
  overdueInstallments?: number[];
};

export type ContactSummary = {
  lastContactedAt: string | null;
  lastOutcome?: string | null;
  lastChannel?: string | null;
  snoozeUntil?: string | null;
};

export type DuesFamily = {
  key: string;
  fatherName: string;
  phone: string | null;
  kids: DuesStudent[];
  pendingToday: number;
  notDueYet: number;
  lateFee: number;
  /** The oldest overdue among the children. */
  days: number;
  usesBus: boolean;
  /** Installment numbers overdue in any child. */
  overdueInstallments: number[];
  lastContact: ContactSummary | null;
};

function digits(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}

/** One family: the fee app's family group, else the father's phone, else the child alone. */
export function familyKeyOf(s: Pick<DuesStudent, "studentId" | "familyGroupId" | "fatherPhone">): string {
  if (s.familyGroupId) return `g:${s.familyGroupId}`;
  const phone = digits(s.fatherPhone);
  if (phone.length === 10) return `p:${phone}`;
  return `s:${s.studentId}`;
}

function newer(a: ContactSummary | null, b: ContactSummary | null | undefined): ContactSummary | null {
  if (!b || !b.lastContactedAt) return a;
  if (!a || !a.lastContactedAt) return b;
  return b.lastContactedAt > a.lastContactedAt ? b : a;
}

export function groupFamilies(students: readonly DuesStudent[], contacts?: ReadonlyMap<string, ContactSummary>): DuesFamily[] {
  const map = new Map<string, DuesFamily>();
  for (const s of students) {
    const key = familyKeyOf(s);
    const f =
      map.get(key) ??
      ({
        key,
        fatherName: s.fatherName?.trim() || s.fullName,
        phone: s.fatherPhone,
        kids: [],
        pendingToday: 0,
        notDueYet: 0,
        lateFee: 0,
        days: 0,
        usesBus: false,
        overdueInstallments: [],
        lastContact: null,
      } satisfies DuesFamily);
    f.kids.push(s);
    const overdue = Math.max(0, Math.round(s.overdueAmount));
    f.pendingToday += overdue;
    f.notDueYet += Math.max(0, Math.round(s.notDueYet ?? s.totalPending - overdue));
    f.lateFee += Math.max(0, Math.round(s.lateFee));
    f.days = Math.max(f.days, s.daysOverdue || 0);
    f.usesBus = f.usesBus || Boolean(s.transportRouteId);
    if (!f.phone && s.fatherPhone) f.phone = s.fatherPhone;
    for (const n of s.overdueInstallments ?? []) if (!f.overdueInstallments.includes(n)) f.overdueInstallments.push(n);
    f.lastContact = newer(f.lastContact, contacts?.get(s.studentId));
    map.set(key, f);
  }
  for (const f of map.values()) f.overdueInstallments.sort((a, b) => a - b);
  return [...map.values()];
}

/** On the call list: something is pending today. A late fee alone does not count. */
export function isCallable(f: Pick<DuesFamily, "pendingToday">): boolean {
  return f.pendingToday > 0;
}

/** Families whose only money due today is a late fee — named in a note, never called. */
export function lateFeeOnly(families: readonly DuesFamily[]): DuesFamily[] {
  return families.filter((f) => f.pendingToday <= 0 && f.lateFee > 0);
}

/** Oldest and biggest first, as the design sorts the call list. */
export function sortForCalling(families: readonly DuesFamily[]): DuesFamily[] {
  return [...families].sort((a, b) => b.days - a.days || b.pendingToday - a.pendingToday || a.fatherName.localeCompare(b.fatherName));
}

export type ClassBand = "pre" | "p" | "m" | "s";

/** Nursery–UKG, Class 1–5, Class 6–8, Class 9–12. */
export function classBand(classLabel: string): ClassBand {
  const label = classLabel.toLowerCase();
  if (/nursery|lkg|ukg|pre[\s-]?primary|play/.test(label)) return "pre";
  const m = label.match(/(\d{1,2})/);
  const n = m ? Number(m[1]) : NaN;
  if (Number.isFinite(n)) {
    if (n <= 5) return "p";
    if (n <= 8) return "m";
    return "s";
  }
  return "s";
}

export type CallFilters = {
  band: ClassBand | "";
  /** `i2`: only Inst 2 overdue; `i12`: Inst 1 overdue too. */
  inst: "" | "i2" | "i12";
  big: boolean;
  bus: boolean;
  query: string;
};

export const NO_CALL_FILTERS: CallFilters = { band: "", inst: "", big: false, bus: false, query: "" };

export const BIG_FAMILY_AMOUNT = 5000;

export function hasCallFilters(f: CallFilters): boolean {
  return Boolean(f.band || f.inst || f.big || f.bus || f.query.trim());
}

/**
 * Does the family's text match the search? Every word must be found; a word of
 * one or two digits is a class number and must be a whole word, so "class 1"
 * is Class 1 and not Class 10, 11 or 12 (accountant B14). Longer digit runs
 * (a phone's last digits) and letters match anywhere, and repeated spaces
 * count as one.
 */
export function familyMatchesQuery(hay: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return true;
  const text = hay.toLowerCase().replace(/\s+/g, " ");
  const tokens = new Set(text.split(/[\s·,.:;/()+-]+/).filter(Boolean));
  return q.split(" ").every((word) => (/^\d{1,2}$/.test(word) ? tokens.has(word) : text.includes(word)));
}

export function filterFamilies(families: readonly DuesFamily[], f: CallFilters): DuesFamily[] {
  const q = f.query.trim().toLowerCase();
  return families.filter((fam) => {
    if (f.band && !fam.kids.some((k) => classBand(k.classLabel) === f.band)) return false;
    const owesOne = fam.overdueInstallments.includes(1);
    if (f.inst === "i2" && (owesOne || !fam.overdueInstallments.includes(2))) return false;
    if (f.inst === "i12" && !owesOne) return false;
    if (f.big && fam.pendingToday <= BIG_FAMILY_AMOUNT) return false;
    if (f.bus && !fam.usesBus) return false;
    if (q) {
      const hay = [fam.fatherName, fam.phone ?? "", ...fam.kids.flatMap((k) => [k.fullName, k.classLabel])].join(" ").toLowerCase();
      if (!familyMatchesQuery(hay, q)) return false;
    }
    return true;
  });
}

export type AgingBucket = { key: "1-30" | "31-60" | "61-90" | "90+"; amount: number; students: number };

/** Pending today by how late it is. Not-due-yet money is not aged; late fee is not money owed for fees. */
export function agingBuckets(students: readonly DuesStudent[]): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { key: "1-30", amount: 0, students: 0 },
    { key: "31-60", amount: 0, students: 0 },
    { key: "61-90", amount: 0, students: 0 },
    { key: "90+", amount: 0, students: 0 },
  ];
  for (const s of students) {
    const amount = Math.max(0, Math.round(s.overdueAmount));
    if (amount <= 0) continue;
    const d = s.daysOverdue || 0;
    const i = d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3;
    buckets[i].amount += amount;
    buckets[i].students += 1;
  }
  return buckets;
}

export type PromiseInput = {
  studentId: string;
  promisedOn: string;
  amount: number;
  /** When the promise was made, `YYYY-MM-DD` or an ISO timestamp. */
  madeAt: string;
};

export type PaymentFact = { studentId: string; paymentDate: string; amount: number; receiptNumber?: string };

export type PromiseState = "kept" | "due" | "broken" | "upcoming";

/**
 * Kept once the family has paid at least what they promised (anything at all,
 * for a visit with no amount) on or after the day they promised it. Otherwise
 * it is due on its day, broken after it and upcoming before it.
 */
export function promiseState(p: PromiseInput, payments: readonly PaymentFact[], today: string): { state: PromiseState; paid: number; receiptNumber: string | null } {
  const from = p.madeAt.slice(0, 10);
  const mine = payments.filter((x) => x.studentId === p.studentId && x.paymentDate >= from);
  const paid = mine.reduce((s, x) => s + Math.max(0, x.amount), 0);
  const target = Math.max(0, p.amount);
  const kept = target > 0 ? paid >= target : paid > 0;
  if (kept) {
    const last = [...mine].sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1))[0];
    return { state: "kept", paid, receiptNumber: last?.receiptNumber ?? null };
  }
  if (p.promisedOn < today) return { state: "broken", paid, receiptNumber: null };
  if (p.promisedOn === today) return { state: "due", paid, receiptNumber: null };
  return { state: "upcoming", paid, receiptNumber: null };
}

/** Whole-rupee parts that add up exactly; the last part carries the rounding. */
export function splitIntoParts(total: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts));
  const t = Math.max(0, Math.round(total));
  if (t === 0) return Array.from({ length: n }, () => 0);
  const per = Math.floor(t / n / 10) * 10 || Math.floor(t / n);
  const out = Array.from({ length: n }, () => per);
  out[n - 1] = t - per * (n - 1);
  return out;
}

/**
 * The fee app's EMI plan takes one monthly amount, and the RPC builds the
 * calendar from it. The parts the family is shown are therefore that amount
 * repeated, with whatever is left in the last part.
 */
export function monthlyAmountFor(total: number, parts: number): number {
  const n = Math.max(1, Math.floor(parts));
  return Math.ceil(Math.max(0, Math.round(total)) / n);
}

/** Monthly dates from `first`, a Sunday moved to the Monday after. */
export function monthlySchedule(first: string, parts: number): { date: string; movedFromSunday: boolean }[] {
  const [y, m, d] = first.split("-").map(Number);
  const out: { date: string; movedFromSunday: boolean }[] = [];
  for (let i = 0; i < Math.max(1, Math.floor(parts)); i += 1) {
    const lastDay = new Date(Date.UTC(y, m - 1 + i + 1, 0)).getUTCDate();
    const t = new Date(Date.UTC(y, m - 1 + i, Math.min(d, lastDay)));
    const sunday = t.getUTCDay() === 0;
    if (sunday) t.setUTCDate(t.getUTCDate() + 1);
    out.push({ date: t.toISOString().slice(0, 10), movedFromSunday: sunday });
  }
  return out;
}

export const WRITE_OFF_REASONS = ["moved", "hardship", "too_small", "settled"] as const;

export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

export function isWriteOffReason(value: unknown): value is WriteOffReason {
  return typeof value === "string" && (WRITE_OFF_REASONS as readonly string[]).includes(value);
}

/** From ₹1 up to what is still owed. */
export function validWriteOffAmount(amount: number, owed: number): boolean {
  return Number.isFinite(amount) && Number.isInteger(amount) && amount >= 1 && amount <= Math.round(owed);
}

export const CALL_OUTCOMES = ["promised", "visit", "noreach", "wrong", "time"] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export function isCallOutcome(value: unknown): value is CallOutcome {
  return typeof value === "string" && (CALL_OUTCOMES as readonly string[]).includes(value);
}

/**
 * The design's five outcomes, mapped onto the fee app's contact log so the
 * classic Defaulters screen and its cadence engine read the same row.
 */
export function contactOutcomeFor(outcome: CallOutcome): "promised_pay" | "reached" | "no_answer" | "dispute" | "other" {
  switch (outcome) {
    case "promised":
      return "promised_pay";
    case "visit":
      return "reached";
    case "noreach":
      return "no_answer";
    case "time":
      return "dispute";
    case "wrong":
    default:
      return "other";
  }
}
