import "server-only";

import { classLabelMap } from "@/modules/academics/data/academics-repo";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import {
  decidedLabel,
  suggestionCard,
  wordsForCard,
  type RegisterMark,
  type SuggestionCard,
  type SuggestionKind,
  type SuggestionReader,
  type SuggestionRoute,
  type SuggestionStatus,
} from "@/modules/whatsapp/domain/parent-suggestions";
import { childBasics } from "@/vx/screens/teach/students";
import { p, type Pair } from "@/vx/text";

import { staffNames, type SuggestionRow } from "./parent-suggestions";

/**
 * A parent's suggestions (D-598) as the screens draw them: the child's name
 * and class, one line on what the parent said, the parent's own words from
 * the hand-off, and, once decided, what and by whom. Shared by Needs you
 * and the class teacher's Today, which have each already decided who is
 * asking and which suggestions they may see.
 */

export type ParentNoteView = {
  id: string;
  /**
   * The suggestion as it stands: its id, and when it was last taken back. A
   * screen hides what it decided; one undone waits again as a new item.
   */
  key: string;
  kind: SuggestionKind;
  route: SuggestionRoute;
  status: SuggestionStatus;
  studentId: string | null;
  childName: string;
  classLabel: string | null;
  title: Pair;
  line: Pair;
  change: SuggestionCard["change"];
  /** The parent's own words, from the hand-off in Messages; null when it is gone. */
  words: string | null;
  /** The parent's WhatsApp number, for the office to call about a visit or a changed detail. */
  phone: string | null;
  /** The owner's number standing in for a family (practice mode). */
  practice: boolean;
  urgent: boolean;
  createdAt: string;
  /** Once decided: what was chosen and by whom ("Leave · Test Teacher"), and when. */
  decided: Pair | null;
  decidedAt: string | null;
};

const NO_NAME = p("A child", "एक बच्चा");

/** "+919000000001" -> "+91 90000 00001"; anything else as it came. */
export function phoneForCard(e164: string | null | undefined): string | null {
  const raw = String(e164 ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}` : raw;
}

export async function parentNoteViews(rows: readonly SuggestionRow[], sessionLabel: string, today: string): Promise<ParentNoteView[]> {
  if (rows.length === 0) return [];
  const studentIds = rows.map((row) => row.studentId).filter((id): id is string => Boolean(id));
  // A name or a class that cannot be read leaves the card standing, with a plainer line.
  const [children, classes, deciders] = await Promise.all([
    studentIds.length ? childBasics(studentIds).catch(() => new Map<string, { fullName: string }>()) : Promise.resolve(new Map<string, { fullName: string }>()),
    classLabelMap(sessionLabel).catch(() => new Map<string, string>()),
    staffNames(rows.map((row) => row.decidedBy ?? "")).catch(() => new Map<string, string>()),
  ]);
  return rows.map((row) => {
    const childName =
      row.kind === "visit"
        ? String(row.payload.child_name ?? "").trim() || NO_NAME.en
        : (row.studentId ? children.get(row.studentId)?.fullName?.trim() : null) || NO_NAME.en;
    const classLabel = row.classId ? (classes.get(row.classId) ?? null) : null;
    const card = suggestionCard({ kind: row.kind, payload: row.payload, childName, classLabel, today });
    const mark: RegisterMark | null = row.decision && (row.decision.mark === "leave" || row.decision.mark === "absent") ? row.decision.mark : null;
    return {
      id: row.id,
      key: row.undoneAt ? `${row.id}:${Date.parse(row.undoneAt) || 0}` : row.id,
      kind: row.kind,
      route: row.route,
      status: row.status,
      studentId: row.studentId,
      childName,
      classLabel,
      title: card.title,
      line: card.line,
      change: card.change,
      words: wordsForCard(row.handoff?.body),
      phone: row.kind === "absence" ? null : phoneForCard(row.handoff?.fromPhone),
      practice: row.practice,
      urgent: card.urgent,
      createdAt: row.createdAt,
      decided:
        row.status === "applied" || row.status === "dismissed"
          ? decidedLabel({ status: row.status, kind: row.kind, mark, by: row.decidedBy ? (deciders.get(row.decidedBy) ?? null) : null })
          : null,
      decidedAt: row.decidedAt,
    };
  });
}

/**
 * Who this person is to a parent's suggestions in Needs you (D-598), or null
 * when they decide none there. Nobody decides one in a session of the other
 * kind (a real admin in the test year, a test account in the real one): the
 * database refuses that too.
 */
export function parentReaderFor(staff: CurrentStaff, sessionLabel: string): SuggestionReader | null {
  if (!staffBelongsToSession(staff.isTestAccount, sessionLabel)) return null;
  const reader: SuggestionReader = {
    admin: staff.role === "admin",
    correctsAttendance: can(staff, "attendance:correct"),
    office: can(staff, "collection:manage"),
    feeDesk: can(staff, "fees:manage"),
  };
  return reader.admin || reader.correctsAttendance || reader.office || reader.feeDesk ? reader : null;
}
