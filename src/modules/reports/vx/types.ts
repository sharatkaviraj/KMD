import type { CollectionBucket, ClasswiseRow, DefaulterRow } from "@/modules/reports/vx/domain/reports";
import type { ClassInfo, ReportSchedule } from "@/modules/reports/vx/reports-data";

export type ReportsView = "hub" | "collection" | "defaulters" | "classwise" | "daybook" | "schedule";
export type ReportsSheet = "" | "send" | "export" | "newsch";
export type CollectionPreset = "month" | "last" | "session" | "custom";

export type HubSummary = {
  todayTotal: number;
  todayReceipts: number;
  todayReversed: number;
  spark: number[];
  monthTotal: number;
  monthUpi: number;
  modeShare: { upi: number; cash: number; cheque: number; bank_transfer: number };
  pendingToday: number;
  defaulters: number;
  notDueYet: number;
  lateFeePending: number;
  leftOwing: number;
  leftOwingAmount: number;
  schedules: number;
};

export type CollectionData = {
  preset: CollectionPreset;
  from: string;
  to: string;
  /** Unfiltered receipts, reduced to what the screen filters on. */
  receipts: { date: string; mode: string; amount: number; classId: string | null; reversed: boolean }[];
};

export type CellData = {
  classLabel: string;
  installmentNo: number;
  dueDate: string | null;
  students: { studentId: string; studentName: string; fatherName: string | null; phone: string; pending: number; lateFee: number; due: boolean; left: boolean }[];
};

export type DayBookData = {
  date: string;
  closure: { status: string; closedAt: string | null; closedByName: string | null } | null;
  collected: number;
  paidOut: number;
  receiptCount: number;
  reversedCount: number;
  rows: {
    id: string;
    type: "collection" | "refund" | "correction";
    postedAt: string;
    studentId: string | null;
    studentName: string;
    classLabel: string | null;
    receiptNumber: string | null;
    mode: string | null;
    cashIn: number;
    cashOut: number;
    status: string;
    tone: "good" | "warning" | "neutral" | "accent";
    note: string | null;
  }[];
};

export type ReportsPageData = {
  today: string;
  sessionLabel: string;
  schoolName: string;
  view: ReportsView;
  sheet: ReportsSheet;
  classes: ClassInfo[];
  hub: HubSummary | null;
  collection: CollectionData | null;
  /** All defaulters including students who left; the screen filters. */
  defaulters: (Omit<DefaulterRow, "fatherPhone"> & { phone: string })[] | null;
  classwise: { rows: ClasswiseRow[]; installmentNos: number[]; dueDates: Record<number, string> } | null;
  cell: CellData | null;
  daybook: DayBookData | null;
  schedules: ReportSchedule[];
  /** For the export sheet's whole-session option. */
  sessionFrom: string;
};

export type { CollectionBucket };
