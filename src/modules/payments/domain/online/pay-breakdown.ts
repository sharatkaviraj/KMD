/**
 * The one-tap pay page, as pure rules: what each child's card shows, what each
 * amount box may hold, and what a tap on Pay sends.
 *
 * The figures come from `public.online_payment_pay_page` — the installment
 * snapshot, read live — and the database repeats every bound when the order is
 * opened. These rules exist so the parent is told BEFORE tapping, in their own
 * language, rather than refused after.
 *
 * Money rules held here:
 *  - A late fee is never folded into a fees figure: each row shows its fees
 *    still to pay and its late fee still to pay separately.
 *  - "Clear dues to date" is everything due up to the reminder's date: last
 *    year's balance + fees due + late fee (`MONEY_GLOSSARY.clearDuesToDate`).
 *  - "Whole session" is everything this child still owes this session, the
 *    most a line may carry (`MONEY_GLOSSARY.wholeSessionBalance`). No advance.
 *  - At least ₹100 a line, unless the child's whole balance is less — then
 *    exactly that.
 */

export const MIN_LINE_RUPEES = 100;
export const MAX_CHILDREN = 4;

export type PayPageRow = {
  installment_no: number;
  label: string | null;
  due_date: string;
  carry_forward: boolean;
  charged: number;
  paid: number;
  fees_pending: number;
  late_fee: number;
  late_fee_paid: number;
  late_fee_pending: number;
  total_pending: number;
  status: string | null;
};

export type PayPageChild = {
  index: number;
  first_name: string;
  class_label: string;
  session_label: string;
  rows: PayPageRow[];
  last_year_pending: number;
  fees_pending: number;
  late_fee_pending: number;
  clear_to_date: number;
  whole_session: number;
};

export type PayPageOrder = {
  public_ref: string;
  status: string;
  amount_rupees: number;
  created_at: string;
  receipts: Array<{ line_no: number; receipt_number: string; amount: number }>;
};

export type PayPageData = {
  ok: true;
  session_label: string;
  sent_at: string;
  today: string;
  children: PayPageChild[];
  orders: PayPageOrder[];
  checkout_enabled: boolean;
  min_line_rupees: number;
  order_max_rupees: number;
};

export type RowState = "paid" | "overdue" | "part_paid" | "upcoming";

/**
 * What a row still asks for. While late fees are waived on online payment
 * (`online_payment_waive_late_fees`, this year only) that is its fees alone:
 * the parent is never shown, nor asked for, a late fee.
 */
function rowPending(row: PayPageRow, waiveLateFees: boolean): number {
  return waiveLateFees ? row.fees_pending : row.total_pending;
}

/** What a row's chip says, from its own figures rather than a status string. */
export function rowState(row: PayPageRow, todayIso: string, waiveLateFees = false): RowState {
  if (rowPending(row, waiveLateFees) <= 0) return "paid";
  if (row.due_date < todayIso) return "overdue";
  if (row.paid > 0) return "part_paid";
  return "upcoming";
}

/**
 * What a child can pay online. With late fees waived on payment, every late fee
 * the child is charged comes off — the pending part disappears, and the part
 * already paid moves onto their fees (20261030120000). This is the same figure
 * the database's `private.online_student_owed` bounds an order by.
 */
export function payableFigures(
  child: Pick<PayPageChild, "rows" | "clear_to_date" | "whole_session" | "late_fee_pending">,
  waiveLateFees = false,
): { dueSoFar: number; wholeYear: number; lateFee: number } {
  if (!waiveLateFees) {
    return {
      dueSoFar: Math.max(0, Math.trunc(child.clear_to_date)),
      wholeYear: Math.max(0, Math.trunc(child.whole_session)),
      lateFee: Math.max(0, Math.trunc(child.late_fee_pending)),
    };
  }
  const lateFeesCharged = child.rows.reduce((sum, row) => sum + Math.max(0, row.late_fee), 0);
  return {
    dueSoFar: Math.max(0, Math.trunc(child.clear_to_date) - lateFeesCharged),
    wholeYear: Math.max(0, Math.trunc(child.whole_session) - lateFeesCharged),
    lateFee: 0,
  };
}

export function lineBounds(child: Pick<PayPageChild, "whole_session">): { min: number; max: number } {
  const max = Math.max(0, Math.trunc(child.whole_session));
  return { min: Math.min(MIN_LINE_RUPEES, max), max };
}

/**
 * The amount a child's box opens on: clear dues to date, raised to the minimum
 * when what is due is a few rupees but more is owed later in the session.
 * Zero when the child owes nothing at all.
 */
export function prefillAmount(child: Pick<PayPageChild, "clear_to_date" | "whole_session">): number {
  const { min, max } = lineBounds(child);
  if (max <= 0) return 0;
  const due = Math.max(0, Math.trunc(child.clear_to_date));
  if (due <= 0) return 0;
  return Math.min(max, Math.max(min, due));
}

export type AmountChoiceKey = "due_so_far" | "whole_year";

export type AmountChoice = {
  key: AmountChoiceKey;
  amount: number;
  /** The late fee inside this amount, said out loud on the card: never hidden in a fee. */
  lateFee: number;
};

/**
 * The tap-to-pick cards for one child, in the order shown: everything due so
 * far, then the whole year. "Other amount" is always offered beside them and
 * is not a choice here. A card that would repeat another, or that the bounds
 * would refuse, is left out; nothing at all when the child owes nothing.
 */
export function amountChoices(
  child: Pick<PayPageChild, "rows" | "clear_to_date" | "whole_session" | "late_fee_pending">,
  waiveLateFees = false,
): AmountChoice[] {
  const figures = payableFigures(child, waiveLateFees);
  const { min, max } = lineBounds({ whole_session: figures.wholeYear });
  if (max <= 0) return [];
  const choices: AmountChoice[] = [];
  const due = figures.dueSoFar;
  if (due >= min && due > 0 && due < max) choices.push({ key: "due_so_far", amount: due, lateFee: figures.lateFee });
  choices.push({ key: "whole_year", amount: max, lateFee: figures.lateFee });
  return choices;
}

/** Paid so far against what the session asks in all; the bar under the child's name. */
export function paidProgress(
  child: Pick<PayPageChild, "rows" | "clear_to_date" | "whole_session" | "late_fee_pending">,
  waiveLateFees = false,
): {
  paid: number;
  owed: number;
  fraction: number;
} {
  // Money handed over stays paid when a late fee it settled is forgiven: it moves onto fees.
  const paid = child.rows.reduce((sum, row) => sum + Math.max(0, row.paid) + Math.max(0, row.late_fee_paid), 0);
  const owed = payableFigures(child, waiveLateFees).wholeYear;
  const whole = paid + owed;
  return { paid, owed, fraction: whole > 0 ? paid / whole : 1 };
}

/** The send's latest payment that became receipts, for the "received" banner on a reopened link. */
export function lastPaid(data: Pick<PayPageData, "orders">): { amount: number; at: string; receiptNumbers: string[] } | null {
  const order = data.orders.find((entry) => entry.status === "accounted" && entry.receipts.length > 0);
  if (!order) return null;
  return {
    amount: order.receipts.reduce((sum, receipt) => sum + Number(receipt.amount), 0),
    at: order.created_at,
    receiptNumbers: order.receipts.map((receipt) => receipt.receipt_number),
  };
}

/** A child's rows with every fully paid one folded away, so the details stay short. */
export function splitRows(
  child: Pick<PayPageChild, "rows">,
  waiveLateFees = false,
): { settled: PayPageRow[]; open: PayPageRow[] } {
  return {
    settled: child.rows.filter((row) => rowPending(row, waiveLateFees) <= 0),
    open: child.rows.filter((row) => rowPending(row, waiveLateFees) > 0),
  };
}

export type LineError = "not_whole" | "below_min" | "above_max";

export type LineValidation = {
  /** The lines a Pay tap sends: only children with an amount above zero. */
  lines: Array<{ index: number; amount_rupees: number }>;
  total: number;
  errors: Record<number, LineError>;
  ok: boolean;
};

/**
 * Check every box. An empty or zero box means "not paying for this child now",
 * which is allowed; anything else must be whole rupees within the bounds.
 */
export function validateLineAmounts(
  children: Array<Pick<PayPageChild, "index" | "whole_session">>,
  amounts: Record<number, number | null | undefined>,
  orderMaxRupees = Number.POSITIVE_INFINITY,
): LineValidation {
  const lines: LineValidation["lines"] = [];
  const errors: LineValidation["errors"] = {};
  let total = 0;
  for (const child of children) {
    const raw = amounts[child.index];
    if (raw === null || raw === undefined || raw === 0) continue;
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      errors[child.index] = "not_whole";
      continue;
    }
    const { min, max } = lineBounds(child);
    if (raw < min) errors[child.index] = "below_min";
    else if (raw > max) errors[child.index] = "above_max";
    else {
      lines.push({ index: child.index, amount_rupees: raw });
      total += raw;
    }
  }
  const ok = lines.length > 0 && Object.keys(errors).length === 0 && total <= orderMaxRupees;
  return { lines, total, errors, ok };
}

/** Read the RPC payload defensively; null when it is not a usable page. */
export function readPayPageData(value: unknown): PayPageData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<PayPageData>;
  if (data.ok !== true || !Array.isArray(data.children) || data.children.length < 1 || data.children.length > MAX_CHILDREN) {
    return null;
  }
  if (!data.children.every((child) => child && typeof child.first_name === "string" && Array.isArray(child.rows))) return null;
  return data as PayPageData;
}
