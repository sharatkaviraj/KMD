import type { ChequeStatus, MatchSuggestion, RequestKind, RequestStatus, UpiLineState } from "@/modules/finance-controls/vx/domain/books";

/* Shapes the accountant's screens receive. Plain data, safe to pass to a Client Component. */

export type ModeTotal = { mode: string; total: number; count: number };

export type FamilyHit = {
  studentId: string;
  studentName: string;
  fatherName: string | null;
  phoneMasked: string;
  classLabel: string;
  admissionNo: string | null;
  /** Fees on installments due by today. Never includes the late fee. */
  pendingToday: number;
  lateFee: number;
  left: boolean;
};

export type QueueEntry = {
  id: string;
  studentId: string;
  familyLabel: string;
  classLabel: string;
  note: string | null;
  arrivedAt: string;
  pendingToday: number;
};

export type AccRequestRow = {
  id: string;
  kind: RequestKind;
  title: string;
  reason: string;
  amount: number | null;
  studentId: string | null;
  studentName: string | null;
  receiptId: string | null;
  requestedAt: string;
  requestedByName: string;
  mine: boolean;
  status: RequestStatus;
  remindedAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  withdrawnAt: string | null;
  canRemind: boolean;
};

export type ChequeRow = {
  receiptId: string;
  receiptNumber: string;
  paymentDate: string;
  amount: number;
  studentId: string;
  studentName: string;
  /** The family's name on the cheque register (the father, from the student record). */
  fatherName?: string | null;
  classLabel: string;
  chequeNo: string | null;
  bank: string | null;
  chequeDate: string | null;
  reference: string | null;
  /** Original immutable receipt text; used only for reviewed draft suggestions. */
  receiptNotes?: string | null;
  status: ChequeStatus;
  statusAt: string | null;
  slipNo: string | null;
  bounceReason: string | null;
  reversed: boolean;
};

export type DepositSlip = { id: string; slipNo: string; bankLabel: string; depositedOn: string; total: number; count: number };

export type UpiLineRow = {
  id: string;
  txnAt: string;
  amount: number;
  payer: string;
  utr: string;
  state: UpiLineState;
  receipt: { id: string; receiptNumber: string; studentName: string; classLabel: string | null; amount: number; paymentDate: string } | null;
  suggestions: MatchSuggestion[];
};

export type AdvanceRow = { studentId: string; studentName: string; classLabel: string; fatherName: string | null; credit: number; refundable: number };

export type FeeRefundRow = { id: string; studentName: string; amount: number; status: string; reason: string; refundDate: string };

export type BooksData = {
  today: string;
  sessionLabel: string;
  canDecide: boolean;
  canWrite: boolean;
  cheques: ChequeRow[];
  slips: DepositSlip[];
  upiLines: UpiLineRow[];
  upiReceiptsUnmatched: number;
  advances: AdvanceRow[];
  feeRefunds: FeeRefundRow[];
  requests: AccRequestRow[];
};

export type AccountsHomeData = {
  today: string;
  tomorrow: string;
  sessionLabel: string;
  collected: {
    total: number;
    count: number;
    lastAt: string | null;
    modes: ModeTotal[];
    spark: { line: string; area: string; endY: number };
    usual: number | null;
    vsUsual: number | null;
    reversedCount: number;
  };
  closure: { status: string; closedAt: string | null; closedByName: string | null } | null;
  queue: QueueEntry[];
  /** Call-backs set for today; `kept` paid something today, `pending` is their fees pending today (never the late fee). */
  followUpsToday: { count: number; next: string | null; kept: number; pending: number };
  chequesToDeposit: { count: number; total: number };
  upiOpen: { count: number; total: number };
  requests: AccRequestRow[];
  reminders: { paused: boolean; familiesPendingToday: number; nextInstallment: string | null };
  cashExpected: { total: number; count: number };
  tomorrowFollowUps: { studentId: string; studentName: string; classLabel: string; pendingToday: number; note: string | null }[];
  chequesForBank: ChequeRow[];
};
