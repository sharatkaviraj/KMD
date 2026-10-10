/**
 * The redesigned Payment Desk's arithmetic (docs/design-handoff PayDesk).
 *
 * Pure: no database, no React. Everything here describes what the ledger
 * already does, so the desk can show it before the cashier presses Save:
 *
 *  - `post_student_payment_with_adjustments` allocates the amount against
 *    each row's `total_pending` (fees + late fee) in the order plan rows →
 *    due date → installment number, and refuses more than the total pending
 *    after any waiver.
 *  - `private.workbook_installment_snapshot` then reads every rupee of the
 *    session as one pool that settles the rows in that same order, **each
 *    row's fees first, then its late fee**, and charges an installment's late
 *    fee only when the money dated on or before its due date did not cover
 *    everything up to and including its fees.
 *
 * So the split shown here is the one the ledger will hold once the receipt is
 * posted — including the back-dated case, where a payment dated before a due
 * date that clears that installment means its late fee is never charged.
 */

export type DeskLedgerRow = {
  id: string;
  installmentNo: number;
  /** "Installment 2", or the carry-forward label for last session's balance. */
  label: string;
  isCarryForward: boolean;
  /** YYYY-MM-DD. */
  dueDate: string;
  /** Fees charged on the row (never a late fee). */
  charge: number;
  /** Fees settled on the row so far. */
  feesPaid: number;
  /** Fees still owed. */
  feesPending: number;
  /** Late fee still owed on the row, after waivers. */
  lateFeePending: number;
  /** Late fee the rule charged before any waiver. */
  lateFeeRaw: number;
  /** Late fee waived on the row. */
  lateFeeWaived: number;
  lateFeeStatus: "none" | "pending" | "waived" | "paid";
  /** 0 when an active EMI plan covers the row (settled first), else 1. */
  planPriority: number;
};

const TIGHT = (n: number) => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));

/** The counter's order: plan rows, then oldest due date, then installment number. */
export function orderForSettlement<T extends Pick<DeskLedgerRow, "planPriority" | "dueDate" | "installmentNo">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.planPriority !== b.planPriority) return a.planPriority - b.planPriority;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.installmentNo - b.installmentNo;
  });
}

/** Overdue on `onDate`: last session's balance always is; an installment once its due date has passed. */
export function isOverdueOn(row: Pick<DeskLedgerRow, "isCarryForward" | "dueDate">, onDate: string): boolean {
  return row.isCarryForward || row.dueDate < onDate;
}

export type DeskTotals = {
  /** Overdue fees only. Never contains a late fee. */
  pendingToday: number;
  /** Fees on installments not due yet. Never added to `pendingToday`. */
  notDueYet: number;
  /** Late fee, kept apart. */
  lateFee: number;
  /** Fees pending today + late fee — labelled that way wherever it shows. */
  canTakeToday: number;
  /** Every fee and late fee still owed this session. */
  wholeYear: number;
};

export function deskTotals(rows: readonly DeskLedgerRow[], today: string): DeskTotals {
  let pendingToday = 0;
  let notDueYet = 0;
  let lateFee = 0;
  for (const row of rows) {
    if (isOverdueOn(row, today)) pendingToday += TIGHT(row.feesPending);
    else notDueYet += TIGHT(row.feesPending);
    lateFee += TIGHT(row.lateFeePending);
  }
  return { pendingToday, notDueYet, lateFee, canTakeToday: pendingToday + lateFee, wholeYear: pendingToday + notDueYet + lateFee };
}

export type HelperChip =
  | { kind: "overdue"; amount: number; withLate: boolean }
  | { kind: "upto"; installmentNo: number; amount: number; withLate: boolean }
  | { kind: "year"; amount: number; withLate: boolean };

/**
 * Amounts the helper chips fill in. They only fill the box — nothing is
 * ticked. Each is what it takes to clear the rows up to that point in the
 * counter's order, so "Up to Installment 3" really does clear Installment 3,
 * late fees on the way included unless the cashier is waiving them.
 */
export function helperChips(rows: readonly DeskLedgerRow[], today: string, opts: { waiveLate: boolean }): HelperChip[] {
  const ordered = orderForSettlement(rows).filter((r) => r.feesPending + (opts.waiveLate ? 0 : r.lateFeePending) > 0);
  const chips: HelperChip[] = [];
  const seen = new Set<number>();
  const withLate = !opts.waiveLate && ordered.some((r) => r.lateFeePending > 0);
  const push = (chip: HelperChip) => {
    if (chip.amount <= 0 || seen.has(chip.amount)) return;
    seen.add(chip.amount);
    chips.push(chip);
  };
  let cum = 0;
  let lastOverdueCum = 0;
  const upTo: HelperChip[] = [];
  for (const row of ordered) {
    cum += TIGHT(row.feesPending) + (opts.waiveLate ? 0 : TIGHT(row.lateFeePending));
    if (isOverdueOn(row, today)) lastOverdueCum = cum;
    else if (!row.isCarryForward && upTo.length < 2) upTo.push({ kind: "upto", installmentNo: row.installmentNo, amount: cum, withLate });
  }
  push({ kind: "overdue", amount: lastOverdueCum, withLate });
  upTo.forEach(push);
  push({ kind: "year", amount: cum, withLate });
  return chips;
}

export type WalkLineState = "cleared" | "part" | "ahead" | "untouched";

export type WalkLine = {
  row: DeskLedgerRow;
  /** Fees + the late fee this payment is asked for, before it. */
  before: number;
  feesPaid: number;
  lateFeePaid: number;
  feesAfter: number;
  lateFeeAfter: number;
  /** Back-dated on time: this payment clears the row by its due date, so no late fee. */
  lateFeeDropped: boolean;
  /** The cashier is waiving the late fee on this row. */
  lateFeeWaived: boolean;
  state: WalkLineState;
};

export type PaymentWalk = {
  amount: number;
  lines: WalkLine[];
  /** Rows already paid in full, by label. */
  alreadyPaid: string[];
  /** The most the ledger will accept: everything owed, less a waiver. */
  maxAmount: number;
  overMax: boolean;
  /** Late fee to pass to the waiver (the whole pending late fee) when waiving. */
  waiverAmount: number;
  /** Money left once every row is clear: becomes the student's credit. */
  credit: number;
  after: { pendingToday: number; notDueYet: number; lateFee: number };
};

/**
 * Where `amount` goes, oldest first, the way the pooled settlement will read
 * it once posted. `paymentDate` is the date the parent paid (back-dating is
 * allowed); `today` decides what counts as pending today afterwards.
 */
export function walkPayment(
  rows: readonly DeskLedgerRow[],
  amount: number,
  opts: { paymentDate: string; today: string; waiveLate: boolean },
): PaymentWalk {
  const total = TIGHT(amount);
  const ordered = orderForSettlement(rows);
  const owing = ordered.filter((r) => r.feesPending + r.lateFeePending > 0);
  const alreadyPaid = ordered.filter((r) => r.feesPending + r.lateFeePending <= 0).map((r) => r.label);
  const lateTotal = owing.reduce((s, r) => s + TIGHT(r.lateFeePending), 0);
  const feesTotal = owing.reduce((s, r) => s + TIGHT(r.feesPending), 0);
  const maxAmount = feesTotal + (opts.waiveLate ? 0 : lateTotal);

  let rem = total;
  let clearSoFar = true;
  const lines: WalkLine[] = owing.map((row) => {
    const fees = TIGHT(row.feesPending);
    const late = TIGHT(row.lateFeePending);
    const feesPaid = Math.min(rem, fees);
    rem -= feesPaid;
    const feesCleared = feesPaid === fees;
    let lateAsked = late;
    let lateFeeWaived = false;
    let lateFeeDropped = false;
    if (late > 0 && opts.waiveLate) {
      lateAsked = 0;
      lateFeeWaived = true;
    } else if (late > 0 && opts.paymentDate <= row.dueDate && clearSoFar && feesCleared) {
      lateAsked = 0;
      lateFeeDropped = true;
    }
    const lateFeePaid = Math.min(rem, lateAsked);
    rem -= lateFeePaid;
    clearSoFar = clearSoFar && feesCleared && lateFeePaid === lateAsked;
    const feesAfter = fees - feesPaid;
    const lateFeeAfter = lateAsked - lateFeePaid;
    const paid = feesPaid + lateFeePaid;
    const left = feesAfter + lateFeeAfter;
    const state: WalkLineState = paid === 0 ? (left === 0 ? "cleared" : "untouched") : left === 0 ? "cleared" : isOverdueOn(row, opts.paymentDate) ? "part" : "ahead";
    return { row, before: fees + lateAsked, feesPaid, lateFeePaid, feesAfter, lateFeeAfter, lateFeeDropped, lateFeeWaived, state };
  });

  const after = { pendingToday: 0, notDueYet: 0, lateFee: 0 };
  for (const line of lines) {
    if (isOverdueOn(line.row, opts.today)) after.pendingToday += line.feesAfter;
    else after.notDueYet += line.feesAfter;
    after.lateFee += line.lateFeeAfter;
  }

  return {
    amount: total,
    lines,
    alreadyPaid,
    maxAmount,
    overMax: total > maxAmount,
    waiverAmount: opts.waiveLate ? lateTotal : 0,
    credit: total > maxAmount ? 0 : rem,
    after,
  };
}

/**
 * Late fees as of the payment date: the ones already owed on that date, and
 * the ones a back-dated payment can still avoid (due on or after that date).
 */
export function lateFeesOn(rows: readonly DeskLedgerRow[], paymentDate: string) {
  const owed = rows.filter((r) => r.lateFeePending > 0);
  return {
    due: owed.filter((r) => r.dueDate < paymentDate),
    avoidable: owed.filter((r) => r.dueDate >= paymentDate),
  };
}

/** "₹7,000", "7000", "7,000.00" → 7000. Anything after a decimal point is ignored. */
export function parseAmountInput(text: string): number {
  const whole = String(text ?? "").split(".")[0];
  const digits = whole.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const n = Number(digits.slice(0, 9));
  return Number.isFinite(n) ? n : 0;
}

/** The first day of the session a payment may be dated: 1 April of the session's first year. */
export function sessionStartDate(sessionLabel: string): string {
  const match = /(\d{4})\s*-\s*\d{2}/.exec(sessionLabel ?? "");
  return match ? `${match[1]}-04-01` : "1900-01-01";
}

export type DeskMode = "cash" | "upi" | "bank_transfer" | "cheque";

export type DeskProblem =
  | { key: "amount" }
  | { key: "over"; max: number }
  | { key: "date-invalid" }
  | { key: "date-future" }
  | { key: "date-before-session"; start: string }
  | { key: "cheque-no" }
  | { key: "cheque-bank" }
  | { key: "waive-reason" }
  | { key: "nothing-owed" };

export type DeskDraft = {
  amount: number;
  paymentDate: string;
  mode: DeskMode;
  chequeNo: string;
  chequeBank: string;
  waiveLate: boolean;
  waiveReason: string;
};

/** Everything that stops "Review & save", in the order the cashier should fix it. */
export function deskProblems(
  draft: DeskDraft,
  walk: Pick<PaymentWalk, "maxAmount" | "overMax">,
  ctx: { today: string; sessionStart: string; lateFeeOwed: number },
): DeskProblem[] {
  const problems: DeskProblem[] = [];
  if (walk.maxAmount <= 0) problems.push({ key: "nothing-owed" });
  if (!draft.amount) problems.push({ key: "amount" });
  else if (walk.overMax && walk.maxAmount > 0) problems.push({ key: "over", max: walk.maxAmount });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.paymentDate) || Number.isNaN(Date.parse(`${draft.paymentDate}T00:00:00Z`))) problems.push({ key: "date-invalid" });
  else if (draft.paymentDate > ctx.today) problems.push({ key: "date-future" });
  else if (draft.paymentDate < ctx.sessionStart) problems.push({ key: "date-before-session", start: ctx.sessionStart });
  if (draft.mode === "cheque" && !/^\d{6}$/.test(draft.chequeNo.trim())) problems.push({ key: "cheque-no" });
  if (draft.mode === "cheque" && !draft.chequeBank.trim()) problems.push({ key: "cheque-bank" });
  if (draft.waiveLate && ctx.lateFeeOwed > 0 && !draft.waiveReason.trim()) problems.push({ key: "waive-reason" });
  return problems;
}

/** What goes in `reference_number`: the cheque number for a cheque, else the UTR / UPI ref. */
export function composeReference(draft: { mode: DeskMode; reference: string; chequeNo: string }): string {
  if (draft.mode === "cheque") return draft.chequeNo.trim();
  if (draft.mode === "cash") return "";
  return draft.reference.trim().replace(/\s+/g, " ");
}

/**
 * What goes in the receipt's remarks. The posting RPC has one notes field, so
 * the cheque's bank and date and the waiver's reason ride there, each on its
 * own labelled part, ahead of the cashier's own note.
 */
export function composeRemarks(draft: {
  mode: DeskMode;
  chequeBank: string;
  chequeDate: string;
  waiveLate: boolean;
  waiveReason: string;
  waiveNote: string;
  notes: string;
}): string {
  const parts: string[] = [];
  if (draft.mode === "cheque") {
    const bank = draft.chequeBank.trim();
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(draft.chequeDate) ? `, dated ${draft.chequeDate}` : "";
    parts.push(`Cheque: ${bank || "bank not given"}${dated}; subject to clearing.`);
  }
  if (draft.waiveLate && draft.waiveReason.trim()) {
    const note = draft.waiveNote.trim();
    parts.push(`Late fee waived: ${draft.waiveReason.trim()}${note ? ` (${note})` : ""}.`);
  }
  if (draft.notes.trim()) parts.push(draft.notes.trim());
  return parts.join(" ").slice(0, 1000);
}

export type RecentReceipt = {
  id: string;
  receiptNumber: string;
  amount: number;
  mode: string;
  paymentDate: string;
  /** ISO timestamp the receipt was posted. */
  createdAt: string | null;
  isReversed: boolean;
};

export const DUPLICATE_WINDOW_MS = 10 * 60_000;

/**
 * The duplicate guard: same student (the caller passes only this student's
 * receipts), same amount and same mode, posted in the last ten minutes and not
 * reversed. The server keeps its own stricter checks; this one is what lets
 * the desk say so before the cashier presses Save.
 */
export function findRecentDuplicate(
  receipts: readonly RecentReceipt[],
  attempt: { amount: number; mode: string },
  nowMs: number,
): RecentReceipt | null {
  const hits = receipts
    .filter((r) => !r.isReversed && r.amount === attempt.amount && r.mode === attempt.mode && r.createdAt)
    .filter((r) => {
      const at = Date.parse(r.createdAt as string);
      return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at <= DUPLICATE_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(b.createdAt as string) - Date.parse(a.createdAt as string));
  return hits[0] ?? null;
}

/**
 * "Pending today" and the late fee for a row of the class list, from the
 * per-student financial view: installment k's fees count once its due date
 * (from Fee Setup) has passed; whatever base balance is not in installments
 * 1–4 is last session's carry-forward, which is always overdue.
 */
export function listPending(
  student: { instPending: readonly number[]; baseOutstanding: number; lateOutstanding: number },
  dueDates: readonly string[],
  today: string,
): { pendingToday: number; lateFee: number } {
  let inInstallments = 0;
  let pendingToday = 0;
  student.instPending.forEach((value, i) => {
    const v = TIGHT(value);
    inInstallments += v;
    const due = dueDates[i];
    if (due && due < today) pendingToday += v;
  });
  const carry = Math.max(0, TIGHT(student.baseOutstanding) - inInstallments);
  return { pendingToday: pendingToday + carry, lateFee: TIGHT(student.lateOutstanding) };
}

/** The class picker's short labels: "Nursery" → "Nur", "Class 7" → "7", "11 Commerce" → "11 C". */
export function shortClassLabel(label: string): string {
  const t = String(label ?? "").trim();
  if (/^nursery$/i.test(t)) return "Nur";
  const cls = /^class\s+(\d+)$/i.exec(t);
  if (cls) return cls[1];
  const stream = /^(\d+)\s+([A-Za-z])[A-Za-z]*$/.exec(t);
  if (stream) return `${stream[1]} ${stream[2].toUpperCase()}`;
  return t.length > 5 ? t.slice(0, 5) : t;
}

/** "9829012512" → "98290 ••512": enough to recognise, not enough to copy. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length < 6) return "";
  return `${digits.slice(0, 5)} ••${digits.slice(-3)}`;
}

/** Search the class list by name, SR no., father's name, or the phone's last digits (3+). */
export function matchesDeskSearch(
  student: { name: string; sr: string; father: string | null; classLabel: string; phone: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${student.name} ${student.father ?? ""} ${student.classLabel} sr ${student.sr}`.toLowerCase();
  if (hay.includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 && digits.length === q.replace(/\s/g, "").length && String(student.phone ?? "").replace(/\D/g, "").includes(digits);
}
