import type { Pair } from "@/vx/text";
import type { ClassBoardRow, InboxType, MarkStatus } from "@/vx/screens/admin/logic";

/** Shapes the admin screens hand from server to client. Plain data only. */

export type InboxKind = "not_marked" | "cover" | "submission" | "confirmations" | "refund" | "job" | "leave" | "parent" | "toilets";

export type InboxFact = { label: Pair; value: string };

export type CoverCandidate = { id: string; name: string; detail: string; free: boolean };

/**
 * A parent's suggestion (D-598): what Veer Patta AI read in a WhatsApp
 * message that may belong in a record, decided here at once (Leave or
 * Absent, Add to Admissions, Apply, or Not now) and undone from the toast or
 * from "Decided today".
 */
export type ParentInboxItem = {
  suggestionId: string;
  kind: "absence" | "visit" | "record";
  /** The child's id, for the photo; null for a visit (a child not yet at the school). */
  studentId: string | null;
  childName: string;
  classLabel: string | null;
  /** The parent's own words, from the hand-off in Messages. */
  words: string | null;
  /** A record change: the value now and the one the parent asks for, side by side. */
  change: { field: Pair; was: string | null; becomes: string } | null;
  /** The parent's WhatsApp number, for a visit or a changed detail. */
  phone: string | null;
  /** The owner's number standing in for a family. */
  practice: boolean;
};

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
  /** A leave request decided here: its id, and whether all its days have passed. */
  leaveId?: string;
  leavePast?: boolean;
  /** A Fees refund request this reader may decide here (review F01). */
  feesRefund?: { id: string; kind: "refund_approval" | "refund_processing"; sessionLabel: string; amount: number; actionable: boolean };
  /** A parent's suggestion this reader may decide here (D-598). */
  parent?: ParentInboxItem;
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
