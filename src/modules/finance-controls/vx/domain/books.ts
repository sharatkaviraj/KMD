/*
 * The accountant's books, as pure functions (AccHome, AccBooks).
 *
 * Nothing here reads a database: the data layer hands over rows and these
 * decide what they mean — where a cheque is, which receipt a bank line
 * probably is, how today compares with a usual day. Kept apart so the rules
 * have tests and the screens cannot each invent their own.
 */

export type ChequeStatus = "to_deposit" | "in_bag" | "deposited" | "cleared" | "bounced";

export type ChequeEvent = {
  receiptId: string;
  status: Exclude<ChequeStatus, "to_deposit">;
  createdAt: string;
  depositSlipId?: string | null;
  reason?: string | null;
};

/**
 * A cheque's state is its latest event. No event yet means the cheque was
 * taken at the counter and still has to go to the bank.
 */
export function chequeStatus(events: readonly ChequeEvent[]): ChequeStatus {
  if (events.length === 0) return "to_deposit";
  const latest = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest.status;
}

/** Cheques that still have to reach the bank: not yet deposited, cleared or bounced. */
export function isWaitingForBank(status: ChequeStatus) {
  return status === "to_deposit" || status === "in_bag";
}

/** What may follow what. A bounced or cleared cheque is finished. */
export function canMoveCheque(from: ChequeStatus, to: Exclude<ChequeStatus, "to_deposit">): boolean {
  switch (to) {
    case "in_bag":
      return from === "to_deposit";
    case "deposited":
      return from === "to_deposit" || from === "in_bag";
    case "cleared":
    case "bounced":
      return from === "deposited";
    default:
      return false;
  }
}

/** DS-0001, DS-0002 … from the slip numbers already used. */
export function nextSlipNumber(existing: readonly string[]): string {
  let max = 0;
  for (const value of existing) {
    const match = /^DS-(\d+)$/.exec(value.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `DS-${String(max + 1).padStart(4, "0")}`;
}

export type UpiStatementLine = {
  txnAt: string;
  amount: number;
  payer: string;
  utr: string;
};

export type ParsedStatement = {
  rows: UpiStatementLine[];
  errors: { line: number; text: string; reason: string }[];
};

function parseStatementDate(raw: string): string | null {
  const value = raw.trim();
  // 2026-10-08 or 2026-10-08 10:41 / 2026-10-08T10:41
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(value);
  if (m) {
    const [, y, mo, d, h = "12", mi = "00"] = m;
    return toIstIso(Number(y), Number(mo), Number(d), Number(h), Number(mi));
  }
  // 08/10/2026 or 8-10-2026, optionally with 10:41
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(value);
  if (m) {
    const [, d, mo, y, h = "12", mi = "00"] = m;
    return toIstIso(Number(y), Number(mo), Number(d), Number(h), Number(mi));
  }
  return null;
}

function toIstIso(y: number, mo: number, d: number, h: number, mi: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // Date.UTC normalizes impossible dates (31 February becomes a March day).
  // Check the bank's calendar date before converting school time to UTC.
  const wallTime = Date.UTC(y, mo - 1, d, h, mi);
  const calendar = new Date(wallTime);
  if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== mo - 1 || calendar.getUTCDate() !== d) return null;
  const utc = wallTime - (5 * 60 + 30) * 60 * 1000;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * A bank statement pasted or uploaded as CSV: date, amount, payer, UTR — in
 * that order, comma, semicolon or tab separated. A header row and blank lines
 * are skipped; a bad line is reported, never guessed at.
 */
export function parseUpiStatement(text: string): ParsedStatement {
  const rows: UpiStatementLine[] = [];
  const errors: ParsedStatement["errors"] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const cells = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (index === 0 && /date/i.test(cells[0] ?? "")) return;
    if (cells.length < 4) {
      errors.push({ line: index + 1, text: line, reason: "Needs date, amount, payer and UPI ref" });
      return;
    }
    const [dateCell, amountCell, payerCell, utrCell] = cells;
    const txnAt = parseStatementDate(dateCell);
    if (!txnAt) {
      errors.push({ line: index + 1, text: line, reason: "Date not understood" });
      return;
    }
    const amount = Number(amountCell.replace(/[₹,\s]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      errors.push({ line: index + 1, text: line, reason: "Amount must be whole rupees above 0" });
      return;
    }
    const utr = utrCell.replace(/\s+/g, "");
    if (utr.length < 6 || utr.length > 30) {
      errors.push({ line: index + 1, text: line, reason: "UPI ref looks wrong" });
      return;
    }
    const payer = payerCell.slice(0, 80) || "Unknown payer";
    rows.push({ txnAt, amount, payer, utr });
  });
  return { rows, errors };
}

export type ReceiptCandidate = {
  id: string;
  receiptNumber: string;
  paymentDate: string;
  amount: number;
  referenceNumber: string | null;
  studentName: string;
  classLabel: string | null;
};

export type MatchSuggestion = ReceiptCandidate & { score: number; why: "ref" | "amount_day" | "amount" };

function dayOf(iso: string): string {
  // Statement times are instants; receipts carry a school-day date.
  const ist = new Date(new Date(iso).getTime() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function daysApart(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
}

/**
 * Which receipts a bank line probably is. The amount must be equal — a UPI
 * payment is one student's one receipt (one student per payment) — and then
 * the UTR written on the receipt wins outright, then the nearest day.
 * Receipts already matched to another line are never offered again.
 */
export function suggestUpiMatches(
  line: Pick<UpiStatementLine, "txnAt" | "amount" | "utr">,
  receipts: readonly ReceiptCandidate[],
  alreadyMatched: ReadonlySet<string>,
  limit = 5,
): MatchSuggestion[] {
  const day = dayOf(line.txnAt);
  const utr = line.utr.toLowerCase();
  const out: MatchSuggestion[] = [];
  for (const r of receipts) {
    if (alreadyMatched.has(r.id) || r.amount !== line.amount) continue;
    const ref = (r.referenceNumber ?? "").toLowerCase();
    if (ref && utr && (ref.includes(utr) || (ref.length >= 6 && utr.includes(ref)))) {
      out.push({ ...r, score: 100, why: "ref" });
      continue;
    }
    const gap = daysApart(day, r.paymentDate);
    if (gap <= 3) out.push({ ...r, score: 60 - gap * 10, why: "amount_day" });
    else if (gap <= 10) out.push({ ...r, score: 10, why: "amount" });
  }
  return out.sort((a, b) => b.score - a.score || a.paymentDate.localeCompare(b.paymentDate)).slice(0, limit);
}

export type UpiLineState = "open" | "matched" | "not_fee";

export type UpiEvent = { lineId: string; action: "match" | "unmatch" | "not_fee"; receiptId: string | null; createdAt: string };

/** A line's state and matched receipt from its latest event. */
export function upiLineState(events: readonly UpiEvent[]): { state: UpiLineState; receiptId: string | null } {
  if (events.length === 0) return { state: "open", receiptId: null };
  const latest = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latest.action === "match") return { state: "matched", receiptId: latest.receiptId };
  if (latest.action === "not_fee") return { state: "not_fee", receiptId: null };
  return { state: "open", receiptId: null };
}

/**
 * What a usual day has collected: the mean of the same weekday over the
 * previous weeks, counting only days that took money (a holiday is not a
 * usual day). Null when there is no such day to compare with.
 */
export function usualDayTotal(
  dayTotals: readonly { date: string; total: number }[],
  today: string,
  weeks = 8,
): number | null {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - weeks * 7 * 86_400_000).toISOString().slice(0, 10);
  const byDay = new Map<string, number>();
  for (const row of dayTotals) {
    if (row.date >= today || row.date < from) continue;
    if (new Date(`${row.date}T00:00:00Z`).getUTCDay() !== weekday) continue;
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.total);
  }
  const values = [...byDay.values()].filter((v) => v > 0);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Percent above (+) or below (−) the usual day, rounded; null without a usual day. */
export function versusUsual(today: number, usual: number | null): number | null {
  if (!usual) return null;
  return Math.round(((today - usual) / usual) * 100);
}

/**
 * Points for the "collected today" line: running total against the minutes
 * of the counter day (8:00 to 17:30), scaled to a w×h box, y down.
 */
export function cumulativeSpark(
  receipts: readonly { postedAt: string; amount: number }[],
  { width = 200, height = 58, openMinute = 8 * 60, closeMinute = 17 * 60 + 30 } = {},
): { line: string; area: string; endY: number } {
  const sorted = [...receipts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const total = sorted.reduce((s, r) => s + r.amount, 0);
  const span = closeMinute - openMinute;
  let cum = 0;
  const pts: [number, number][] = [[0, height]];
  for (const r of sorted) {
    const ist = new Date(new Date(r.postedAt).getTime() + (5 * 60 + 30) * 60 * 1000);
    const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const x = Math.max(0, Math.min(width, ((minute - openMinute) / span) * width));
    cum += r.amount;
    const y = total ? height - (cum / total) * (height - 6) : height;
    pts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  const endY = pts[pts.length - 1][1];
  const line = pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  const lastX = pts[pts.length - 1][0];
  return { line, area: `0,${height} ${line} ${lastX},${height}`, endY };
}

export type RequestKind = "late_fee_waiver" | "reversal" | "refund" | "fee_change" | "other";

export type RequestStatus = "waiting" | "seen" | "approved" | "declined" | "withdrawn";

export function requestStatus(r: {
  decision: "approved" | "declined" | null;
  withdrawnAt: string | null;
  remindedAt: string | null;
}): RequestStatus {
  if (r.withdrawnAt) return "withdrawn";
  if (r.decision === "approved") return "approved";
  if (r.decision === "declined") return "declined";
  return "waiting";
}

/** Reminding the admin more than once an hour is nagging; the button waits. */
export function canRemind(r: { remindedAt: string | null; requestedAt: string }, now: Date = new Date()): boolean {
  const last = r.remindedAt ?? r.requestedAt;
  return now.getTime() - Date.parse(last) >= 60 * 60 * 1000;
}

/** Mask a phone to its last three digits, the way the counter reads them aloud. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 3) return "";
  return `••${digits.slice(-3)}`;
}
