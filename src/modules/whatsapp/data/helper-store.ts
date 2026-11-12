import "server-only";

import { dayStartIst, monthStartIst } from "@/modules/assist/domain/cost";
import type { AbsenceReason } from "@/modules/whatsapp/domain/helper-absence";
import { childFactsFromRow, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { EMPTY_CHAT, type ChatPatch, type ChatState, type TurnRoute } from "@/modules/whatsapp/domain/helper-plan";
import type { HandoffTarget } from "@/modules/whatsapp/domain/helper-replies";
import { isHelperLanguage, type MessageKind } from "@/modules/whatsapp/domain/helper-text";
import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * Veer Patta AI's reads and writes in One's database (D-574), all in
 * `vppsone` through the service role. Nothing here stores what a parent wrote
 * except a hand-off, which is the parent's message put in front of the school
 * on purpose (`parent_replies`, One's Messages inbox). A note that a child
 * will be away keeps the days and a word for why, never the words (D-588).
 */

type Db = ReturnType<typeof whatsappDb>;

export const DEFAULT_HELPER_NAME = "Veer Patta AI";
/** No family in the school has more children than this at once; a longer list is a mistake, not a family. */
const MAX_CHILDREN = 6;

export type HelperSettings = { helperName: string; practiceStudentIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The settings row, or null when it could not be read (then the helper stays out of the chat). */
export async function readHelperSettings(db: Db = whatsappDb()): Promise<HelperSettings | null> {
  try {
    const { data, error } = await db
      .from("parent_helper_settings")
      .select("helper_name, practice_student_ids")
      .eq("id", 1)
      .maybeSingle<{ helper_name: string | null; practice_student_ids: string[] | null }>();
    if (error) return null;
    const name = data?.helper_name?.trim();
    return {
      helperName: name && name.length >= 2 ? name.slice(0, 40) : DEFAULT_HELPER_NAME,
      practiceStudentIds: (data?.practice_student_ids ?? []).filter((id) => UUID.test(id)).slice(0, MAX_CHILDREN),
    };
  } catch {
    return null;
  }
}

/**
 * Each child's facts, read fresh for every message. Null when any read
 * failed: an answer built on half a family is worse than the office's.
 * `parent_helper_child` answers null for a child outside a test year (step
 * 1), and such a child is simply left out.
 */
export async function readChildFacts(studentIds: readonly string[], db: Db = whatsappDb()): Promise<ChildFacts[] | null> {
  const ids = [...new Set(studentIds)].filter((id) => UUID.test(id)).slice(0, MAX_CHILDREN);
  if (ids.length === 0) return [];
  try {
    const answers = await Promise.all(ids.map((id) => db.rpc("parent_helper_child", { p_student_id: id })));
    if (answers.some((answer) => answer.error)) return null;
    return answers.map((answer) => childFactsFromRow(answer.data)).filter((child): child is ChildFacts => child !== null);
  } catch {
    return null;
  }
}

type ChatRow = {
  language: string | null;
  awaiting: string | null;
  awaiting_until: string | null;
  greeted_at: string | null;
  last_turn_at: string | null;
};

/** What the helper remembers about this number; an empty memory when there is none or it cannot be read. */
export async function readChat(from: string, db: Db = whatsappDb()): Promise<ChatState> {
  try {
    const { data, error } = await db
      .from("parent_helper_chats")
      .select("language, awaiting, awaiting_until, greeted_at, last_turn_at")
      .eq("from_e164", from)
      .maybeSingle<ChatRow>();
    if (error || !data) return EMPTY_CHAT;
    return {
      language: isHelperLanguage(data.language) ? data.language : null,
      awaiting: data.awaiting,
      awaitingUntil: data.awaiting_until,
      greetedAt: data.greeted_at,
      lastTurnAt: data.last_turn_at,
    };
  } catch {
    return EMPTY_CHAT;
  }
}

export async function saveChat(from: string, patch: ChatPatch, at: Date, db: Db = whatsappDb()): Promise<void> {
  const row: Record<string, unknown> = { from_e164: from, last_turn_at: at.toISOString(), updated_at: at.toISOString() };
  if (patch.language !== undefined) row.language = patch.language;
  if (patch.awaiting !== undefined) row.awaiting = patch.awaiting;
  if (patch.awaitingUntil !== undefined) row.awaiting_until = patch.awaitingUntil;
  if (patch.greetedAt !== undefined) row.greeted_at = patch.greetedAt;
  await db.from("parent_helper_chats").upsert(row, { onConflict: "from_e164" });
}

/**
 * The turn's row, written BEFORE the helper claims the chat: its unique
 * message id is what stops a repeated forward being answered twice.
 */
export async function startTurn(
  row: {
    providerMessageId: string;
    from: string;
    receivedAt: string;
    kind: Exclude<MessageKind, "ignore">;
    /** A parent of the practice family or of a real one (D-590); the column's default, true, when not said. */
    practice?: boolean;
  },
  db: Db = whatsappDb(),
): Promise<"started" | "duplicate" | "failed"> {
  try {
    const { error } = await db.from("parent_helper_turns").insert({
      provider_message_id: row.providerMessageId,
      from_e164: row.from,
      received_at: row.receivedAt,
      kind: row.kind,
      ...(row.practice === undefined ? {} : { practice: row.practice }),
    });
    if (!error) return "started";
    return error.code === "23505" ? "duplicate" : "failed";
  } catch {
    return "failed";
  }
}

export type TurnFinish = {
  status: "not_claimed" | "answered" | "failed";
  reason?: string | null;
  intent?: string | null;
  route?: TurnRoute | null;
  model?: string | null;
  costUsd?: number;
  handoff?: HandoffTarget | null;
  parentReplyId?: string | null;
  replyMessageId?: string | null;
  latencyMs?: number | null;
  /** The school answer this reply used, or the list row its question was added to (D-589). */
  lessonId?: string | null;
  lessonRole?: "used" | "asked" | null;
};

export async function finishTurn(providerMessageId: string, finish: TurnFinish, db: Db = whatsappDb()): Promise<void> {
  try {
    await db
      .from("parent_helper_turns")
      .update({
        status: finish.status,
        reason: finish.reason ? finish.reason.slice(0, 120) : null,
        intent: finish.intent && /^[a-z_]{2,30}$/.test(finish.intent) ? finish.intent : null,
        route: finish.route ?? null,
        model: finish.model ?? null,
        cost_usd: Math.max(0, Number(finish.costUsd ?? 0)),
        handoff: finish.handoff ?? null,
        parent_reply_id: finish.parentReplyId ?? null,
        reply_message_id: finish.replyMessageId ?? null,
        latency_ms: finish.latencyMs === null || finish.latencyMs === undefined ? null : Math.max(0, Math.round(finish.latencyMs)),
        // Written only with a lesson, so a turn without one writes what it always did.
        ...(finish.lessonId ? { lesson_id: finish.lessonId, lesson_role: finish.lessonRole ?? null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("provider_message_id", providerMessageId);
  } catch {
    // The ledger is the record, not the answer: a failed update never stops the reply.
  }
}

/** The school's AI spend this month (One's helper and this one together) and this number's answers today. */
export async function readBudget(from: string, now: Date, db: Db = whatsappDb()): Promise<{ spentUsd: number; turnsToday: number } | null> {
  try {
    const { data, error } = await db
      .rpc("parent_helper_budget", {
        p_from: from,
        p_month_start: monthStartIst(now).toISOString(),
        p_day_start: dayStartIst(now).toISOString(),
      })
      .single<{ spent_usd: number | string; turns_today: number }>();
    if (error || !data) return null;
    return { spentUsd: Number(data.spent_usd ?? 0), turnsToday: Number(data.turns_today ?? 0) };
  } catch {
    return null;
  }
}

/**
 * Who answers a hand-off. The class teacher is the child's own (read with the
 * facts); accounts is an accountant, the principal's office an admin; the
 * office is everyone who opens Messages, so nobody in particular. Only staff
 * of the child's own kind: a test account for a test-year child, real staff
 * for a real one (the owner's rule, 8 Nov 2026).
 */
export async function pickHandoffStaff(
  target: HandoffTarget,
  child: ChildFacts | null,
  sessionLabel: string,
  db: Db = whatsappDb(),
): Promise<string | null> {
  if (target === "office") return null;
  if (target === "class_teacher") {
    const teacher = child?.classTeacher;
    return teacher && staffBelongsToSession(teacher.isTest, sessionLabel) ? teacher.staffId : null;
  }
  const roles = target === "accounts" ? ["accountant", "admin"] : ["admin"];
  try {
    const { data, error } = await db
      .from("staff_profiles")
      .select("id, role, is_test_account, created_at")
      .in("role", roles)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(50)
      .returns<Array<{ id: string; role: string; is_test_account: boolean | null }>>();
    if (error || !data) return null;
    const ofKind = data.filter((row) => staffBelongsToSession(row.is_test_account, sessionLabel));
    for (const role of roles) {
      const found = ofKind.find((row) => row.role === role);
      if (found) return found.id;
    }
    return null;
  } catch {
    return null;
  }
}

/** The parent's message, in One's Messages inbox. Null when it could not be written. */
export async function insertHandoff(
  row: {
    sessionLabel: string;
    fromName: string;
    fromPhone: string;
    studentId: string | null;
    studentLabel: string | null;
    regarding: string;
    body: string;
    receivedAt: string;
    assignedStaffId: string | null;
  },
  db: Db = whatsappDb(),
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("parent_replies")
      .insert({
        session_label: row.sessionLabel,
        from_name: row.fromName.slice(0, 120) || "Parent",
        from_phone: row.fromPhone,
        student_id: row.studentId,
        student_label: row.studentLabel,
        regarding: row.regarding.slice(0, 200),
        body: row.body.slice(0, 4000),
        received_at: row.receivedAt,
        assigned_staff_id: row.assignedStaffId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return null;
    return data.id;
  } catch {
    return null;
  }
}

export type AbsenceRow = {
  studentId: string;
  sessionLabel: string;
  days: readonly string[];
  reason: AbsenceReason;
  /** The hand-off the note came with. */
  parentReplyId: string | null;
  practice: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A parent's word that a child will be away (D-588): one row per day, which
 * the class's register shows as "Parent informed". A day already noted keeps
 * its first note. An absent alert still waiting in Messages → To send for one
 * of those days is stopped, because the parent told the school first; that
 * step is best effort, as the register's own save stops it again. True when
 * the days are kept.
 */
export async function saveAbsenceNotes(row: AbsenceRow, db: Db = whatsappDb()): Promise<boolean> {
  const days = [...new Set(row.days)].filter((day) => DAY.test(day));
  if (!UUID.test(row.studentId) || days.length === 0) return false;
  try {
    const { error } = await db.from("parent_absence_notes").upsert(
      days.map((day) => ({
        student_id: row.studentId,
        session_label: row.sessionLabel,
        day,
        reason: row.reason,
        parent_reply_id: row.parentReplyId,
        practice: row.practice,
      })),
      { onConflict: "student_id,day", ignoreDuplicates: true },
    );
    if (error) return false;
  } catch {
    return false;
  }
  try {
    await db
      .from("parent_message_queue")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("session_label", row.sessionLabel)
      .eq("kind", "absent_alert")
      .eq("status", "queued")
      .eq("student_id", row.studentId)
      .in("day", days);
  } catch {
    // The register's next save drops it too.
  }
  return true;
}
