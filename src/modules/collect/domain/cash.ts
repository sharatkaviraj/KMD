/**
 * The payment card's money arithmetic (plan §3.3 card 4): cash received and
 * change, the notes counter, and Cash + UPI as one payment with two tender
 * lines (owner decision D7). UPI and bank transfer need no reference (D9).
 * Pure.
 */

export type CollectMode = "cash" | "upi" | "split" | "bank_transfer" | "cheque";
export type LedgerMode = "cash" | "upi" | "bank_transfer" | "cheque";
export type TenderLine = { mode: LedgerMode; amount: number };

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

/** Positive: give this back. Negative: the parent is short by this. */
export function changeDue(received: number, total: number): number {
  return whole(received) - whole(total);
}

/**
 * "Received from the parent" chips: the exact amount, then the next round
 * figures a parent hands over (₹100, ₹500, ₹1,000, ₹2,000 steps), at most 3.
 */
export function receivedSuggestions(total: number): number[] {
  const t = whole(total);
  if (!t) return [];
  const ups = [100, 500, 1000, 2000].map((step) => Math.ceil((t + 1) / step) * step).filter((v) => v > t);
  return [...new Set(ups)].slice(0, 3);
}

export const NOTE_DENOMINATIONS = [500, 200, 100, 50, 20, 10] as const;
export type NoteCount = Partial<Record<(typeof NOTE_DENOMINATIONS)[number], number>>;

export function notesTotal(counts: NoteCount): number {
  return NOTE_DENOMINATIONS.reduce((sum, d) => sum + d * whole(counts[d] ?? 0), 0);
}

export function bumpNote(counts: NoteCount, denomination: (typeof NOTE_DENOMINATIONS)[number], by: number): NoteCount {
  return { ...counts, [denomination]: Math.max(0, whole(counts[denomination] ?? 0) + Math.trunc(by)) };
}

export type SplitCheck =
  | { ok: true; cash: number; upi: number }
  | { ok: false; reason: "empty" | "zero" | "covers_all"; cash: number | null; upi: number | null };

/** Cash + UPI: the cashier types the cash part; UPI is the rest. Both must be more than zero. */
export function checkSplit(total: number, cashPart: number | null): SplitCheck {
  const t = whole(total);
  if (cashPart === null || !Number.isFinite(cashPart)) return { ok: false, reason: "empty", cash: null, upi: null };
  const cash = whole(cashPart);
  if (cash <= 0) return { ok: false, reason: "zero", cash, upi: t - cash };
  if (cash >= t) return { ok: false, reason: "covers_all", cash, upi: 0 };
  return { ok: true, cash, upi: t - cash };
}

/** Round cash parts under the total to offer as chips: at most 4, smallest first. */
export function splitSuggestions(total: number): number[] {
  const t = whole(total);
  const half = Math.floor(t / 2 / 100) * 100;
  return [...new Set([500, 1000, 2000, 3000, 5000, half].filter((v) => v > 0 && v < t))].sort((a, b) => a - b).slice(-4);
}

/**
 * What the ledger is sent: one mode, or (Cash + UPI) two tender lines that add
 * up to the amount, cash first. Null when a split is not yet valid.
 */
export function ledgerTender(mode: CollectMode, total: number, cashPart: number | null):
  | { paymentMode: LedgerMode; tenders: null }
  | { paymentMode: null; tenders: TenderLine[] }
  | null {
  if (mode !== "split") return { paymentMode: mode, tenders: null };
  const split = checkSplit(total, cashPart);
  if (!split.ok) return null;
  return { paymentMode: null, tenders: [{ mode: "cash", amount: split.cash }, { mode: "upi", amount: split.upi }] };
}

/**
 * Split a family payment's tender lines across the children it pays for:
 * the cash part goes to the children in order, then UPI. Each child's lines
 * add up to that child's amount, so each receipt states its own tender.
 * A child whose share is all one mode gets a single-mode payment.
 */
export function tendersByChild(amounts: readonly number[], tender: { cash: number; upi: number }): Array<{ paymentMode: LedgerMode; tenders: null } | { paymentMode: null; tenders: TenderLine[] }> {
  let cashLeft = whole(tender.cash);
  return amounts.map((raw) => {
    const amount = whole(raw);
    const cash = Math.min(cashLeft, amount);
    cashLeft -= cash;
    const upi = amount - cash;
    if (cash > 0 && upi > 0) return { paymentMode: null, tenders: [{ mode: "cash", amount: cash }, { mode: "upi", amount: upi }] };
    return { paymentMode: cash > 0 ? "cash" : "upi", tenders: null };
  });
}

/** Cheque details the card asks for: a six-digit number and a bank. The date is optional. */
export function chequeReady(cheque: { number: string; bank: string }): boolean {
  return /^\d{6}$/.test(cheque.number.trim()) && cheque.bank.trim().length > 0;
}

/** "05/11/2026" as typed → "2026-11-05", or "" when it is not a real date. */
export function chequeDateIso(typed: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(typed ?? "").trim());
  if (!m) return "";
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? "" : iso;
}

/** Digits typed into the cheque-date box, shaped as DD/MM/YYYY while typing. */
export function shapeChequeDate(typed: string): string {
  const d = String(typed ?? "").replace(/\D/g, "").slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
}
