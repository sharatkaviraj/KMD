/**
 * What the redesigned Payment Desk's server code hands its screen. Types only,
 * so the client components can import them without pulling in a database
 * client.
 */

import type { DeskLedgerRow, DeskMode, RecentReceipt } from "@/modules/payments/vx/domain/desk";
import type { GridStudent } from "@/modules/payments/vx/domain/bulk-grid";
import type { RepaymentPlanCollectionContext } from "@/modules/repayment-plans/domain/types";

export type DeskClass = { id: string; label: string; short: string };

export type DeskListStudent = {
  id: string;
  name: string;
  sr: string;
  classId: string;
  classLabel: string;
  father: string | null;
  phone: string | null;
  pendingToday: number;
  lateFee: number;
};

export type DeskBoot = {
  sessionLabel: string;
  today: string;
  sessionStart: string;
  /** A writable session that may take money, and Fee Setup is ready. */
  canPost: boolean;
  blocking: { title: string; detail: string; actionLabel: string | null; actionHref: string | null } | null;
  modes: DeskMode[];
  classes: DeskClass[];
  students: DeskListStudent[];
  todayCollection: { count: number; amount: number };
  lateFeeFlat: number;
  me: { id?: string; name: string; isAdmin: boolean; canWaive: boolean; canRemove: boolean; canBulk: boolean };
};

export type DeskSibling = { id: string; name: string; classLabel: string };

export type DeskStudent = {
  id: string;
  name: string;
  sr: string;
  classLabel: string;
  father: string | null;
  phone: string | null;
  route: string | null;
  isNew: boolean;
  onPlan: boolean;
  repaymentPlan?: RepaymentPlanCollectionContext | null;
  rows: DeskLedgerRow[];
  receipts: RecentReceipt[];
  siblings: DeskSibling[];
  plan: { tuition: number; transport: number; academic: number; installments: number } | null;
  /** Read at this moment, for "frozen at" lines. */
  readAt: string;
};

export type DeskStudentResult = { ok: true; student: DeskStudent } | { ok: false; message: string; repairable: boolean };

export type DeskReceipt = {
  id: string;
  receiptNumber: string;
  studentId: string;
  studentName: string;
  sr: string;
  classLabel: string;
  father: string | null;
  phone: string | null;
  paymentDate: string;
  createdAt: string;
  mode: string;
  reference: string | null;
  notes: string | null;
  receivedBy: string | null;
  total: number;
  lines: { label: string; amount: number }[];
  lateFeePaid: number;
  concession?: number;
  lateFeeWaived: number;
  isReversed: boolean;
  /** Everything still owed right after this receipt, frozen at posting. */
  outstandingAfter: number;
};

export type DeskSaveResult =
  | { status: "saved"; receipt: DeskReceipt | null; receiptId: string; receiptNumber: string; student: DeskStudent | null; balanceAfter: { pendingToday: number; dueToday: number; notDueYet: number; lateFee: number } | null; todayCollection?: { count: number; amount: number } | null }
  | {
      status: "duplicate";
      kind: "near-duplicate" | "daily-amount";
      receiptId: string | null;
      receiptNumber: string | null;
      createdAt: string | null;
      amount: number | null;
      mode: string | null;
      message: string;
    }
  | { status: "error"; message: string }
  /** The post failed in a way that may have happened after the money was written, and the check could not run. */
  | { status: "uncertain"; message: string };

/** The desk's "did it post?" check after a save's answer never arrived. */
export type DeskCheckResult =
  | Extract<DeskSaveResult, { status: "saved" }>
  | { status: "not_saved" }
  | { status: "unknown"; message: string };

export type BulkBoot = {
  sessionLabel: string;
  today: string;
  sessionStart: string;
  students: GridStudent[];
  modes: DeskMode[];
  canBulk: boolean;
  me: string;
  /** Today's receipts for the top bar's pill; null when the total could not be read. */
  todayCollection?: { count: number; amount: number } | null;
};

export type BulkServerRow = {
  id: string;
  rowNumber: number;
  sr: string | null;
  studentName: string | null;
  amount: number | null;
  paymentDate: string | null;
  mode: string | null;
  remarks: string | null;
  status: "pending" | "valid" | "warning" | "error";
  messages: string[];
  receiptNumber: string | null;
  postError: string | null;
};

export type BulkBatch = { batchId: string; rows: BulkServerRow[] };
