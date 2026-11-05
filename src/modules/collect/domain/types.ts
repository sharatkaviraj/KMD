/**
 * The shapes Collect's cards are drawn from, the same whichever ledger
 * adapter supplied them (plan §5: one UI, two adapters). Types only.
 */

import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import type { LedgerMode, TenderLine } from "./cash";

export type CollectStudentRow = {
  id: string;
  name: string;
  sr: string;
  classLabel: string;
  father: string | null;
  /** Full digits, for matching only; the screen shows the last four. */
  phone: string | null;
  /** Fees pending (overdue where the adapter knows only that), never with the late fee. */
  fees: number;
  late: number;
  siblings: number;
};

export type LikelyReason = "sibling_of_last" | "paid_recently" | "overdue_late" | "overdue";
export type LikelyRow = CollectStudentRow & { reason: LikelyReason };

export type CollectReceiptRow = {
  id: string;
  number: string;
  /** Payment date, YYYY-MM-DD. */
  date: string;
  amount: number;
  /** A short mode label as the ledger names it ("Cash", "UPI", "Cash + UPI"). */
  mode: string;
  /** When it was entered (ISO), if known. */
  createdAt: string | null;
  reversed: boolean;
};

export type CollectSibling = {
  id: string;
  name: string;
  classLabel: string;
  /** What the household read says they owe, when it says; the dues read replaces it. */
  outstanding: number | null;
};

export type CollectDues = {
  student: { id: string; name: string; sr: string; classLabel: string; father: string | null; phone: string | null };
  rows: DeskLedgerRow[];
  /** On an EMI plan: the late-fee switch is not offered (Fees decides it). */
  onPlan: boolean;
  /** Newest first. */
  receipts: CollectReceiptRow[];
  /** Receipts this session not in `receipts`. */
  olderReceipts: number;
  /** Linked siblings from the ledger's household (never guessed from a phone). */
  siblings: CollectSibling[];
  /** The household link was readable; false hides the sibling rows and says why nowhere — it is simply not offered. */
  siblingsKnown: boolean;
  /** Modes the session accepts, when the adapter knows. */
  acceptedModes: LedgerMode[] | null;
};

/** One child's payment as the ledger is asked for it. */
export type CollectPost = {
  studentId: string;
  /** Stable per attempt; stored before dispatch; reused on every retry of this child's payment. */
  commandId: string;
  amount: number;
  paymentDate: string;
  paymentMode: LedgerMode | null;
  tenders: TenderLine[] | null;
  /** The late fee being waived (the whole pending late fee), else 0. */
  lateFeeWaiver: number;
  /** Cheque number only (D9: no reference for UPI or bank). */
  reference: string | null;
  remarks: string | null;
  acknowledgeDailyDuplicate: boolean;
  acknowledgeNearDuplicate: boolean;
  /** The bridge's quote hash for exactly this amount, date and waiver. */
  quoteHash: string | null;
};

export type SavedReceipt = {
  receiptId: string;
  receiptNumber: string;
  studentId: string;
  amount: number;
  paymentDate: string;
  /** "cash", "upi", … or "split". */
  paymentMode: string;
  tenders: TenderLine[] | null;
  receivedBy: string | null;
  lateFeeWaived: number;
  /** Everything still owed after it, when the ledger said. */
  remaining: number | null;
  /** Where Print goes: One's receipt page, or the ledger's own print page when One cannot draw it. */
  printHref: string;
  printExternal: boolean;
};

export type PostOutcome =
  | { kind: "saved"; receipt: SavedReceipt }
  | { kind: "duplicate"; near: boolean; message: string; receiptNumber: string | null }
  | { kind: "refused"; code: string; message: string; quoteChanged: boolean }
  /** The answer was lost or unreadable: it may have been saved. Check by command id; never resubmit blind. */
  | { kind: "uncertain"; message: string };

export type StatusOutcome =
  | { kind: "saved"; receipt: SavedReceipt }
  | { kind: "not_saved" }
  | { kind: "unknown"; message: string };

/** The ledger's word on one child's payment before it is posted. */
export type Prepared =
  | {
      ok: true;
      quoteHash: string | null;
      /** Late fee pending on the payment date (before any waiver). */
      lateFee: number;
      /** The most this child may pay on that date with the waiver as chosen. */
      maxPayable: number;
      /** Rows as of the payment date when the adapter re-read them (a backdated local payment). */
      rows: DeskLedgerRow[] | null;
      acceptedModes: LedgerMode[] | null;
    }
  | { ok: false; message: string };
