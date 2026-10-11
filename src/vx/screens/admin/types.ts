import type { Pair } from "@/vx/text";
import type { ClassBoardRow, InboxType, MarkStatus } from "@/vx/screens/admin/logic";

/** Shapes the admin screens hand from server to client. Plain data only. */

export type InboxKind = "not_marked" | "cover" | "submission" | "confirmations" | "refund" | "job";

export type InboxFact = { label: Pair; value: string };

export type CoverCandidate = { id: string; name: string; detail: string; free: boolean };

export type InboxItem = {
  id: string;
  type: InboxType;
  kind: InboxKind;
  /** ISO time the item arose, for "Today 9:20". */
  at: string | null;
  urgent: boolean;
  badge: Pair;
  title: Pair;
  sub: Pair;
  body?: Pair;
  facts: InboxFact[];
  footnote?: Pair;
  /** Where the full screen for this item is. */
  href?: string;
  /* kind-specific payloads */
  classIds?: string[];
  remindable?: number;
  submissionIds?: string[];
  needKey?: string;
  day?: string;
  dayRevision?: number;
  candidates?: CoverCandidate[];
};

export type BoardData = {
  day: string;
  rows: ClassBoardRow[];
  halfDayCredit: number;
  schoolOpen: boolean;
  bells: { index: number; starts: string; ends: string }[];
};

export type SheetData = {
  classId: string;
  label: string;
  day: string;
  roll: { studentId: string; fullName: string; rollNo: string | null }[];
  saved: Record<string, MarkStatus>;
  revision: number;
  teacherName: string | null;
  teacherAway: boolean;
  savedBy: string | null;
  savedAt: string | null;
};

export type TimelineItem = {
  time: string;
  title: Pair;
  sub?: Pair;
  state: "done" | "now" | "next" | "alert";
};
