import "server-only";

import { dayStartIst, monthStartIst } from "@/modules/assist/domain/cost";
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
 * on purpose (`parent_replies`, One's Messages inbox). What a parent says
 * about a child is only ever a suggestion for a person at school to decide
 * (D-598, `./parent-suggestions`); nothing here changes a child's record.
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
  /** Where the turn's time went (D-605), written beside `latencyMs`. */
  stages?: TurnStages | null;
};

/**
 * Where one turn's time went, each in whole milliseconds (D-605), so a slow
 * answer can be pinned on the part that was slow instead of guessed at.
 * Only the parts the turn reached are there.
 */
export type TurnStages = {
  /** The parent's message (WhatsApp's own time, to the second) to One starting on it: Meta, the hub and the hand-off to One. */
  before?: number;
  /** One's own checks before asking the hub: the switches, the settings and today's count. */
  checks?: number;
  /** The hub's answer to "One answers this", which is also when the parent sees the blue ticks and the typing dots. */
  claim?: number;
  /** The parent's message to the hub's yes: how long the parent waited for the dots. */
  dots?: number;
  /** Waiting for the family's records and the chat after the claim (they are read beside it). */
  family?: number;
  /** Working out the answer: the rules, Claude and a receipt. */
  compose?: number;
  /** Claude's part of compose. */
  ai?: number;
  /** Making the receipt PDFs, part of compose: side by side, so first start to last finish (D-606). */
  receipt?: number;
  /** Making the report card PDFs, part of compose, the same way (D-613). */
  reportCard?: number;
  /**
   * Answers that waited for this parent, sent before the reply: for a bare
   * "ok", the whole of it; otherwise only what the reply, already worked out,
   * was held back for them (they are sent while it is worked out).
   */
  waiting?: number;
  /** The hub's answer to the reply, Meta's included. */
  send?: number;
  /** More receipts' PDFs, sent one after another once the reply has gone (D-606); not part of the answer's time. */
  more?: number;
};

/** The stages as the ledger keeps them: whole, non-negative milliseconds, nothing else. */
export function stagesForLedger(stages: TurnStages | null | undefined): Record<string, number> | null {
  if (!stages) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stages)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.max(0, Math.round(value));
  }
  return Object.keys(out).length > 0 ? out : null;
}

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
        ...(stagesForLedger(finish.stages) ? { stages_ms: stagesForLedger(finish.stages) } : {}),
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
