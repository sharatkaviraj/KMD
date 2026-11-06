import type { DaySpan } from "@/modules/receipts/vx/domain/day-close";

/** What the server hands the Receipts screen. Plain data, so it crosses into the client. */

export type DeskRow = {
  id: string;
  receiptNumber: string;
  paymentDate: string;
  createdAt: string;
  paymentMode: string;
  totalAmount: number;
  isReversed: boolean;
  receivedBy: string | null;
  studentFullName: string;
  admissionNo: string;
  classLabel: string;
  /** A reversal is waiting for an admin on this receipt. */
  reversalAsked?: boolean;
};

export type ShareStatus = { status: "not_sent" | "sent" | "delivered" | "read" | "failed"; at: string | null };

export type HistoryEvent = { at: string; kind: "posted" | "asked" | "reversed" | "sent" | "read"; amount?: number; note?: string | null; byName?: string | null; reasonCode?: string | null };

export type SelectedReceipt = {
  id: string;
  receiptNumber: string;
  studentFullName: string;
  admissionNo: string;
  classLabel: string;
  fatherName: string | null;
  fatherPhone: string | null;
  paymentDate: string;
  createdAt: string;
  paymentMode: string;
  referenceNumber: string | null;
  totalAmount: number;
  reversedAmount: number;
  isReversed: boolean;
  receivedBy: string | null;
  sessionLabel: string;
  heads: { label: string; amount: number }[];
  share: ShareStatus;
  history: HistoryEvent[];
  pendingRequest: { at: string; by: string | null; reasonCode: string; note: string | null } | null;
  /** The receipt's own day is closed: reversing it changes a counted day. */
  dayClosed?: boolean;
  /** The latest reversal: when (full ISO), by whom, and its note (B08). */
  reversal?: { at: string; byName: string | null; note: string | null } | null;
  /**
   * Forgiven at the counter with this receipt: a quick discount and a late-fee
   * waiver. Not money received, and a reversal does not undo it (Fees'
   * reverse_receipt_admin leaves receipt_adjustments alone), so the receipt
   * and the reverse sheet both say so (day-run 6 Nov 2026, A-18).
   */
  discountGiven?: number;
  lateFeeWaived?: number;
};

export type CloseEvent = {
  id: string;
  paymentDate: string;
  action: "close" | "reopen";
  cashExpected: number;
  cashCounted: number;
  upiChecked: boolean;
  receiptCount: number;
  reversedCount: number;
  expected: Record<string, number>;
  note: string | null;
  actorName: string | null;
  createdAt: string;
};

export type DeskProps = {
  today: string;
  anchor: string;
  span: DaySpan;
  from: string;
  to: string;
  view: "list" | "close";
  sessionLabel: string;
  rows: DeskRow[];
  truncated: boolean;
  /** The last day with receipts, when the chosen window is empty. */
  lastDate: string | null;
  /** The close in force for the anchor day, if any. */
  closeEvent: CloseEvent | null;
  lastReopen: CloseEvent | null;
  /** Reversals waiting for an admin on the anchor day's receipts. */
  waitingReversals?: { receiptNumber: string; amount: number; mode: string }[];
  selected: SelectedReceipt | null;
  sheet: "reverse" | "send" | null;
  initial: { mode: string; staff: string; query: string };
  perms: { collect: boolean; accounts: boolean; reverse: boolean; reopen: boolean; print: boolean; dayBook: boolean };
};
