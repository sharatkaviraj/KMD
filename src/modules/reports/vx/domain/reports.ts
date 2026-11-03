import { isPendingOn, usualDueDate } from "@/modules/fees/domain/due-rule";

/*
 * Report arithmetic for the redesigned Reports screen, pure.
 *
 * The two rules that every fee number here obeys (RULES B):
 *  - "Pending today" (installments already due) and "Not due yet" are two
 *    figures and are never added together.
 *  - A late fee is its own line and is never added to the fee pending. A
 *    family whose only debt is a late fee is not a defaulter.
 */

export type InstallmentBalance = {
  studentId: string;
  studentName: string;
  admissionNo: string | null;
  fatherName: string | null;
  fatherPhone: string | null;
  classId: string | null;
  classLabel: string;
  installmentNo: number;
  dueDate: string;
  pendingAmount: number;
  lateFeePending: number;
  /** `public.students.status`: active, inactive, left, graduated. */
  studentStatus: string | null;
  /** Last session's balance carried forward: always pending today. */
  isCarryForward?: boolean;
};

export type DefaulterRow = {
  studentId: string;
  studentName: string;
  admissionNo: string | null;
  fatherName: string | null;
  fatherPhone: string | null;
  classId: string | null;
  classLabel: string;
  /** Fees from installments already due. Never includes the late fee. */
  pending: number;
  /** Separate. Never added to `pending`. */
  lateFee: number;
  installmentsDue: number[];
  left: boolean;
};

export function isLeft(status: string | null | undefined) {
  return status === "left" || status === "inactive" || status === "graduated";
}

/**
 * Defaulters as of `today`: one row per student with fees pending on
 * installments due BEFORE today (due-rule.ts: the due date itself is free, as
 * on the Payment Desk and Dues & calls). A student owing only a late fee is
 * left out. Students who left are included only when asked for.
 */
export function buildDefaulters(
  rows: readonly InstallmentBalance[],
  today: string,
  { includeLeft = false, classId = "" }: { includeLeft?: boolean; classId?: string } = {},
): DefaulterRow[] {
  const byStudent = new Map<string, DefaulterRow>();
  for (const r of rows) {
    if (!isPendingOn(r, today)) continue;
    if (classId && r.classId !== classId) continue;
    const left = isLeft(r.studentStatus);
    if (left && !includeLeft) continue;
    let row = byStudent.get(r.studentId);
    if (!row) {
      row = {
        studentId: r.studentId,
        studentName: r.studentName,
        admissionNo: r.admissionNo,
        fatherName: r.fatherName,
        fatherPhone: r.fatherPhone,
        classId: r.classId,
        classLabel: r.classLabel,
        pending: 0,
        lateFee: 0,
        installmentsDue: [],
        left,
      };
      byStudent.set(r.studentId, row);
    }
    const pending = Math.max(0, r.pendingAmount);
    row.pending += pending;
    row.lateFee += Math.max(0, r.lateFeePending);
    if (pending > 0) row.installmentsDue.push(r.installmentNo);
  }
  return [...byStudent.values()]
    .filter((r) => r.pending > 0)
    .map((r) => ({ ...r, installmentsDue: [...new Set(r.installmentsDue)].sort((a, b) => a - b) }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

export type DefaulterSection = { classId: string | null; classLabel: string; rows: DefaulterRow[]; pending: number; lateFee: number };

/** Defaulters grouped by class in the given class order, each with its own totals. */
export function sectionDefaulters(rows: readonly DefaulterRow[], classOrder: readonly string[]): DefaulterSection[] {
  const map = new Map<string, DefaulterSection>();
  for (const r of rows) {
    const key = r.classLabel;
    let s = map.get(key);
    if (!s) {
      s = { classId: r.classId, classLabel: r.classLabel, rows: [], pending: 0, lateFee: 0 };
      map.set(key, s);
    }
    s.rows.push(r);
    s.pending += r.pending;
    s.lateFee += r.lateFee;
  }
  const rank = (label: string) => {
    const i = classOrder.indexOf(label);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...map.values()].sort((a, b) => rank(a.classLabel) - rank(b.classLabel));
}

export type ClasswiseCell = { amount: number; students: number };

export type ClasswiseRow = {
  classId: string | null;
  classLabel: string;
  /** Per installment number. `due` = due on or before today; `notDue` = later. */
  cells: Record<number, { due: ClasswiseCell | null; notDue: ClasswiseCell | null }>;
  pendingToday: number;
  notDueYet: number;
  lateFee: number;
  /** Children with fees pending today in this class, each counted once. */
  studentsPendingToday: number;
};

export type Classwise = {
  rows: ClasswiseRow[];
  installmentNos: number[];
  /** The date most children's installment falls due on (never the earliest outlier). */
  dueDates: Record<number, string>;
  /** Installments whose children do not all share one due date. */
  dueVaries: Record<number, boolean>;
  /** Installments with something pending today, and with something not due yet. */
  dueNos: number[];
  notDueNos: number[];
  /** Children with fees pending today, each counted once (not once per installment). */
  studentsPendingToday: number;
};

/**
 * Pending by class and installment, with what is due today and what is not
 * due yet kept in separate cells and separate totals. Students who left are
 * counted (they still owe) only when `includeLeft`.
 */
export function buildClasswise(
  rows: readonly InstallmentBalance[],
  today: string,
  { includeLeft = true }: { includeLeft?: boolean } = {},
): Classwise {
  const map = new Map<string, ClasswiseRow>();
  const students = new Map<string, Set<string>>();
  const pendingByClass = new Map<string, Set<string>>();
  const pendingAll = new Set<string>();
  const instNos = new Set<number>();
  const datesByInst = new Map<number, string[]>();
  const dueNos = new Set<number>();
  const notDueNos = new Set<number>();
  for (const r of rows) {
    if (!includeLeft && isLeft(r.studentStatus)) continue;
    instNos.add(r.installmentNo);
    if (!r.isCarryForward) datesByInst.set(r.installmentNo, [...(datesByInst.get(r.installmentNo) ?? []), r.dueDate]);
    let row = map.get(r.classLabel);
    if (!row) {
      row = { classId: r.classId, classLabel: r.classLabel, cells: {}, pendingToday: 0, notDueYet: 0, lateFee: 0, studentsPendingToday: 0 };
      map.set(r.classLabel, row);
    }
    const pending = Math.max(0, r.pendingAmount);
    row.lateFee += Math.max(0, r.lateFeePending);
    if (pending <= 0) continue;
    // Due BEFORE today, as on the Desk and Dues (due-rule.ts).
    const isDue = isPendingOn(r, today);
    (isDue ? dueNos : notDueNos).add(r.installmentNo);
    if (isDue) {
      const set = pendingByClass.get(r.classLabel) ?? new Set<string>();
      set.add(r.studentId);
      pendingByClass.set(r.classLabel, set);
      row.studentsPendingToday = set.size;
      pendingAll.add(r.studentId);
    }
    const slot = (row.cells[r.installmentNo] ??= { due: null, notDue: null });
    const key = `${r.classLabel}|${r.installmentNo}|${isDue ? "d" : "n"}`;
    let set = students.get(key);
    if (!set) {
      set = new Set();
      students.set(key, set);
    }
    set.add(r.studentId);
    if (isDue) {
      slot.due = { amount: (slot.due?.amount ?? 0) + pending, students: set.size };
      row.pendingToday += pending;
    } else {
      slot.notDue = { amount: (slot.notDue?.amount ?? 0) + pending, students: set.size };
      row.notDueYet += pending;
    }
  }
  const dueDates: Record<number, string> = {};
  const dueVaries: Record<number, boolean> = {};
  for (const [n, dates] of datesByInst) {
    const usual = usualDueDate(dates);
    if (usual.date) dueDates[n] = usual.date;
    dueVaries[n] = usual.varies;
  }
  const byNo = (a: number, b: number) => a - b;
  return {
    rows: [...map.values()],
    installmentNos: [...instNos].sort(byNo),
    dueDates,
    dueVaries,
    dueNos: [...dueNos].sort(byNo),
    notDueNos: [...notDueNos].sort(byNo),
    studentsPendingToday: pendingAll.size,
  };
}

/** The students behind one heat-table cell, largest first. */
export function cellStudents(
  rows: readonly InstallmentBalance[],
  today: string,
  classLabel: string,
  installmentNo: number,
  { includeLeft = true }: { includeLeft?: boolean } = {},
) {
  return rows
    .filter((r) => r.classLabel === classLabel && r.installmentNo === installmentNo && r.pendingAmount > 0)
    .filter((r) => includeLeft || !isLeft(r.studentStatus))
    .map((r) => ({
      studentId: r.studentId,
      studentName: r.studentName,
      fatherName: r.fatherName,
      fatherPhone: r.fatherPhone,
      pending: r.pendingAmount,
      lateFee: r.lateFeePending,
      due: isPendingOn(r, today),
      left: isLeft(r.studentStatus),
    }))
    .sort((a, b) => b.pending - a.pending || a.studentName.localeCompare(b.studentName));
}

export type CollectionReceipt = {
  paymentDate: string;
  paymentMode: string;
  amount: number;
  classId: string | null;
  reversed: boolean;
};

export const COLLECTION_MODES = ["upi", "cash", "cheque", "bank_transfer"] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];

/**
 * The column a receipt's money falls in. `online` (a Razorpay Pay now payment,
 * always UPI since the fees app's #86) is filed under UPI, as the fees app's
 * day strip does — never Cash, and never left out of the mode split.
 */
export function collectionModeOf(paymentMode: string): string {
  return paymentMode === "online" ? "upi" : paymentMode;
}

export type CollectionBucket = {
  key: string;
  receipts: number;
  byMode: Record<CollectionMode, number>;
  total: number;
};

/** Every date from `from` to `to` inclusive. */
export function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (t <= end && out.length < 400) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

/**
 * Money collected, by day (or by month for long ranges), with each payment
 * mode as its own column. Reversed receipts and discount close-outs are not
 * collection. Every day in the range gets a bucket so a holiday shows as a gap
 * rather than vanishing.
 */
export function bucketCollection(
  receipts: readonly CollectionReceipt[],
  from: string,
  to: string,
  { mode = "", classId = "", by }: { mode?: string; classId?: string; by?: "day" | "month" } = {},
): CollectionBucket[] {
  const days = daysInRange(from, to);
  const grain = by ?? (days.length > 62 ? "month" : "day");
  const keyOf = (date: string) => (grain === "month" ? date.slice(0, 7) : date);
  const buckets = new Map<string, CollectionBucket>();
  const empty = (key: string): CollectionBucket => ({ key, receipts: 0, byMode: { upi: 0, cash: 0, cheque: 0, bank_transfer: 0 }, total: 0 });
  for (const d of days) {
    const k = keyOf(d);
    if (!buckets.has(k)) buckets.set(k, empty(k));
  }
  for (const r of receipts) {
    if (r.reversed || r.paymentMode === "discount") continue;
    if (r.paymentDate < from || r.paymentDate > to) continue;
    const column = collectionModeOf(r.paymentMode);
    if (mode && column !== mode) continue;
    if (classId && r.classId !== classId) continue;
    const b = buckets.get(keyOf(r.paymentDate));
    if (!b) continue;
    b.receipts += 1;
    b.total += r.amount;
    if ((COLLECTION_MODES as readonly string[]).includes(column)) b.byMode[column as CollectionMode] += r.amount;
  }
  return [...buckets.values()];
}

export function sumBuckets(buckets: readonly CollectionBucket[]): CollectionBucket {
  return buckets.reduce<CollectionBucket>(
    (acc, b) => ({
      key: "total",
      receipts: acc.receipts + b.receipts,
      total: acc.total + b.total,
      byMode: {
        upi: acc.byMode.upi + b.byMode.upi,
        cash: acc.byMode.cash + b.byMode.cash,
        cheque: acc.byMode.cheque + b.byMode.cheque,
        bank_transfer: acc.byMode.bank_transfer + b.byMode.bank_transfer,
      },
    }),
    { key: "total", receipts: 0, total: 0, byMode: { upi: 0, cash: 0, cheque: 0, bank_transfer: 0 } },
  );
}

export type CollectionRange = "today" | "week" | "month" | "custom";

/** Inclusive date range for a preset, measured from the school's today. */
export function rangeFor(preset: CollectionRange, today: string, custom?: { from?: string; to?: string }): { from: string; to: string } {
  const t = Date.parse(`${today}T00:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") return { from: iso(t - 6 * 86_400_000), to: today };
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = valid(custom?.from) ?? `${today.slice(0, 7)}-01`;
  const to = valid(custom?.to) ?? today;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** The text a class teacher receives for their own class (Hindi first). */
export function teacherListText(section: DefaulterSection, today: string, schoolName: string): string {
  const head = `${schoolName}\nबकाया फीस सूची · ${section.classLabel} · ${today}\nFees pending · ${section.classLabel}`;
  const lines = section.rows.map((r, i) => `${i + 1}. ${r.studentName}${r.fatherName ? ` (${r.fatherName})` : ""} — ₹${r.pending.toLocaleString("en-IN")}${r.lateFee ? ` · late fee ₹${r.lateFee.toLocaleString("en-IN")}` : ""}`);
  return [head, "", ...lines, "", `कुल / Total ₹${section.pending.toLocaleString("en-IN")} · late fee separate ₹${section.lateFee.toLocaleString("en-IN")}`].join("\n");
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const validDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** 1 April of the session's first year ("2026-27" → 2026-04-01); the month start otherwise. */
export function sessionStart(sessionLabel: string, today: string): string {
  const m = /(\d{4})-\d{2}$/.exec(sessionLabel.trim());
  const start = m ? `${m[1]}-04-01` : `${today.slice(0, 7)}-01`;
  return start <= today ? start : `${today.slice(0, 7)}-01`;
}

/** The collection screen's date range for a preset. */
export function collectionRange(preset: "month" | "last" | "session" | "custom", today: string, sessionLabel: string, custom: { from?: string; to?: string }) {
  if (preset === "last") {
    const firstThis = dayMs(`${today.slice(0, 7)}-01`);
    const lastPrev = iso(firstThis - 86_400_000);
    return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
  }
  if (preset === "session") return { from: sessionStart(sessionLabel, today), to: today };
  if (preset === "custom") {
    const from = validDate(custom.from) ?? `${today.slice(0, 7)}-01`;
    const to = validDate(custom.to) ?? today;
    const [a, b] = from <= to ? [from, to] : [to, from];
    // A year at most, so a mistyped date cannot pull the whole history.
    return { from: dayMs(b) - dayMs(a) > 366 * 86_400_000 ? iso(dayMs(b) - 366 * 86_400_000) : a, to: b };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
