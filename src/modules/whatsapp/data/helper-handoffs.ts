import "server-only";

import { hasConsent } from "@/modules/staff-notices/domain/gates";
import {
  MAX_PEOPLE_PER_ALERT,
  peopleFor,
  staffLanguage,
  type AlertKind,
  type HandoffAction,
  type StaffLanguage,
} from "@/modules/whatsapp/domain/helper-handoff";
import type { HandoffTarget } from "@/modules/whatsapp/domain/helper-replies";
import { isHelperLanguage, type HelperLanguage } from "@/modules/whatsapp/domain/helper-text";
import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { toE164 } from "@/platform/whatsapp/numbers";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * Veer Patta AI's hand-offs in One's database (D-578): who a parent's message
 * is for, the WhatsApp messages that told them, and each answer's way back to
 * the parent. All in `vppsone`, through the service role. The parent's words
 * stay where step 1 put them (`parent_replies`, One's Messages inbox), and an
 * answer's words where every answer from Messages goes (`parent_reply_answers`).
 */

type Db = ReturnType<typeof whatsappDb>;

const TARGETS: readonly HandoffTarget[] = ["class_teacher", "accounts", "office", "principal"];
const ACTIONS: readonly HandoffAction[] = ["alert", "remind", "pass_up"];

export type Handoff = {
  id: string;
  parentReplyId: string;
  parentE164: string;
  language: HelperLanguage;
  target: HandoffTarget;
  topic: string;
  complaint: boolean;
  practice: boolean;
  classTeacherId: string | null;
  aboutName: string;
  level: number;
  reminders: number;
  levelAlertedAt: string | null;
  nextAction: HandoffAction | null;
  nextActionAt: string | null;
  answeredAt: string | null;
  closedAt: string | null;
  /** From the Messages inbox row the hand-off came with. */
  sessionLabel: string;
  studentLabel: string | null;
  fromName: string;
  body: string;
  /** Somebody marked it done in Messages. */
  replyDone: boolean;
};

type HandoffRow = {
  id: string;
  parent_reply_id: string;
  parent_e164: string;
  language: string;
  target: string;
  topic: string;
  complaint: boolean;
  practice: boolean;
  class_teacher_id: string | null;
  about_name: string;
  level: number;
  reminders: number;
  level_alerted_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  answered_at: string | null;
  closed_at: string | null;
  parent_replies: { session_label: string; student_label: string | null; from_name: string; body: string; status: string } | null;
};

const HANDOFF_COLUMNS =
  "id, parent_reply_id, parent_e164, language, target, topic, complaint, practice, class_teacher_id, about_name, level, reminders, " +
  "level_alerted_at, next_action, next_action_at, answered_at, closed_at, " +
  "parent_replies!inner(session_label, student_label, from_name, body, status)";

function handoffFromRow(row: HandoffRow | null): Handoff | null {
  const reply = row?.parent_replies;
  if (!row || !reply) return null;
  const target = TARGETS.find((value) => value === row.target);
  if (!target || !isHelperLanguage(row.language)) return null;
  const action = ACTIONS.find((value) => value === row.next_action) ?? null;
  return {
    id: row.id,
    parentReplyId: row.parent_reply_id,
    parentE164: row.parent_e164,
    language: row.language,
    target,
    topic: row.topic,
    complaint: row.complaint === true,
    practice: row.practice === true,
    classTeacherId: row.class_teacher_id,
    aboutName: row.about_name,
    level: Number(row.level) || 0,
    reminders: Number(row.reminders) || 0,
    levelAlertedAt: row.level_alerted_at,
    nextAction: action,
    nextActionAt: action ? row.next_action_at : null,
    answeredAt: row.answered_at,
    closedAt: row.closed_at,
    sessionLabel: reply.session_label,
    studentLabel: reply.student_label,
    fromName: reply.from_name,
    body: reply.body,
    replyDone: reply.status === "done",
  };
}

export type NewHandoff = {
  parentReplyId: string;
  parentE164: string;
  language: HelperLanguage;
  target: HandoffTarget;
  topic: string;
  complaint: boolean;
  practice: boolean;
  classTeacherId: string | null;
  aboutName: string;
  nextAction: HandoffAction | null;
  nextActionAt: string | null;
};

/** The hand-off's row, written once the parent has been told it was passed on. Null when it could not be written. */
export async function createHandoff(row: NewHandoff, db: Db = whatsappDb()): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("parent_helper_handoffs")
      .insert({
        parent_reply_id: row.parentReplyId,
        parent_e164: row.parentE164,
        language: row.language,
        target: row.target,
        topic: /^[a-z_]{2,30}$/.test(row.topic) ? row.topic : "request",
        complaint: row.complaint,
        practice: row.practice,
        class_teacher_id: row.classTeacherId,
        about_name: row.aboutName.trim().slice(0, 80) || "-",
        next_action: row.nextAction,
        next_action_at: row.nextAction ? row.nextActionAt : null,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return null;
    return data.id;
  } catch {
    return null;
  }
}

export async function readHandoff(id: string, db: Db = whatsappDb()): Promise<Handoff | null> {
  try {
    const { data, error } = await db.from("parent_helper_handoffs").select(HANDOFF_COLUMNS).eq("id", id).maybeSingle<HandoffRow>();
    if (error) return null;
    return handoffFromRow(data);
  } catch {
    return null;
  }
}

/** The hand-off behind a message in One's Messages inbox, if the helper made one. */
export async function readHandoffForReply(parentReplyId: string, db: Db = whatsappDb()): Promise<Handoff | null> {
  try {
    const { data, error } = await db
      .from("parent_helper_handoffs")
      .select(HANDOFF_COLUMNS)
      .eq("parent_reply_id", parentReplyId)
      .maybeSingle<HandoffRow>();
    if (error) return null;
    return handoffFromRow(data);
  } catch {
    return null;
  }
}

export type HandoffPatch = {
  level?: number;
  reminders?: number;
  levelAlertedAt?: string | null;
  nextAction?: HandoffAction | null;
  nextActionAt?: string | null;
  answeredAt?: string | null;
  closedAt?: string | null;
};

export async function updateHandoff(id: string, patch: HandoffPatch, db: Db = whatsappDb()): Promise<boolean> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.level !== undefined) row.level = patch.level;
  if (patch.reminders !== undefined) row.reminders = patch.reminders;
  if (patch.levelAlertedAt !== undefined) row.level_alerted_at = patch.levelAlertedAt;
  if (patch.nextAction !== undefined) {
    // The table insists the two go together.
    row.next_action = patch.nextAction;
    row.next_action_at = patch.nextAction ? (patch.nextActionAt ?? null) : null;
  }
  if (patch.answeredAt !== undefined) row.answered_at = patch.answeredAt;
  if (patch.closedAt !== undefined) row.closed_at = patch.closedAt;
  try {
    const { error } = await db.from("parent_helper_handoffs").update(row).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/** The hand-offs whose next step is due, each held for ten minutes (`parent_helper_take_due`). */
export async function takeDueHandoffs(limit: number, db: Db = whatsappDb()): Promise<string[]> {
  try {
    const { data, error } = await db.rpc("parent_helper_take_due", { p_limit: limit });
    if (error || !Array.isArray(data)) return [];
    return data.map((value: unknown) => (typeof value === "string" ? value : (value as { parent_helper_take_due?: string })?.parent_helper_take_due))
      .filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

/** A member of staff who may be told about a hand-off. */
export type Person = {
  staffId: string;
  name: string;
  role: string;
  /** Their WhatsApp number, or null when One has none for them. */
  e164: string | null;
  /** They said yes to WhatsApp from the school app (linked from their phone, Preferences, the form) and have not stopped it (D-582). */
  consented: boolean;
  language: StaffLanguage;
  isClassTeacher: boolean;
};

type StaffRow = {
  id: string;
  display_name: string | null;
  short_name: string | null;
  role: string;
  phone: string | null;
  whatsapp_phone: string | null;
  preferred_language: string | null;
  is_active: boolean;
  is_test_account: boolean | null;
  whatsapp_opt_in_at: string | null;
  whatsapp_opt_out_at: string | null;
};

const STAFF_COLUMNS =
  "id, display_name, short_name, role, phone, whatsapp_phone, preferred_language, is_active, is_test_account, whatsapp_opt_in_at, whatsapp_opt_out_at";

function personFrom(row: StaffRow, isClassTeacher: boolean): Person {
  return {
    staffId: row.id,
    name: (row.display_name ?? row.short_name ?? "").trim().slice(0, 80) || "-",
    role: row.role,
    e164: toE164(row.whatsapp_phone ?? "") ?? toE164(row.phone ?? ""),
    consented: hasConsent({ optInAt: row.whatsapp_opt_in_at, optOutAt: row.whatsapp_opt_out_at }) === "yes",
    language: staffLanguage(row.preferred_language),
    isClassTeacher,
  };
}

/**
 * Who to tell at this level, at most three: the class teacher, or the people
 * in the roles `peopleFor` names, oldest account first. Only active staff of
 * the child's own kind (a test account for a test-year child, real staff for
 * a real one: the owner's rule, 8 Nov 2026). The office falls back to an
 * admin when nobody holds the office role. Null when it could not be read.
 */
export async function readPeopleToTell(handoff: Handoff, level: number, db: Db = whatsappDb()): Promise<Person[] | null> {
  const rule = peopleFor(handoff.target, level);
  try {
    if (rule.classTeacher) {
      if (!handoff.classTeacherId) return [];
      const { data, error } = await db.from("staff_profiles").select(STAFF_COLUMNS).eq("id", handoff.classTeacherId).maybeSingle<StaffRow>();
      if (error) return null;
      if (!data || !data.is_active || !staffBelongsToSession(data.is_test_account, handoff.sessionLabel)) return [];
      return [personFrom(data, true)];
    }
    const roles = rule.roles.includes("office") ? [...rule.roles, "admin"] : rule.roles;
    const { data, error } = await db
      .from("staff_profiles")
      .select(STAFF_COLUMNS)
      .in("role", roles)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(50)
      .returns<StaffRow[]>();
    if (error || !data) return null;
    const ofKind = data.filter((row) => staffBelongsToSession(row.is_test_account, handoff.sessionLabel));
    const wanted = rule.roles.filter((role) => ofKind.some((row) => row.role === role));
    const pick = wanted.length > 0 ? wanted : rule.roles.includes("office") ? ["admin"] : [];
    const people: Person[] = [];
    for (const role of pick) {
      for (const row of ofKind.filter((candidate) => candidate.role === role)) {
        if (people.length >= MAX_PEOPLE_PER_ALERT) break;
        if (!people.some((person) => person.staffId === row.id)) people.push(personFrom(row, row.id === handoff.classTeacherId));
      }
    }
    return people;
  } catch {
    return null;
  }
}

/** One member of staff, for the person who answered. */
export async function readPerson(staffId: string, classTeacherId: string | null, db: Db = whatsappDb()): Promise<Person | null> {
  try {
    const { data, error } = await db.from("staff_profiles").select(STAFF_COLUMNS).eq("id", staffId).maybeSingle<StaffRow>();
    if (error || !data) return null;
    return personFrom(data, data.id === classTeacherId);
  } catch {
    return null;
  }
}

export type AlertRecord = {
  handoffId: string;
  staffId: string | null;
  toE164: string | null;
  kind: AlertKind;
  via: "text" | "template" | null;
  status: "sent" | "failed" | "skipped";
  reason: string | null;
  messageId: string | null;
};

export async function insertAlert(row: AlertRecord, db: Db = whatsappDb()): Promise<boolean> {
  try {
    const { error } = await db.from("parent_helper_alerts").insert({
      handoff_id: row.handoffId,
      staff_id: row.staffId,
      to_e164: row.toE164,
      kind: row.kind,
      via: row.via,
      status: row.status,
      reason: row.reason ? row.reason.slice(0, 120) : null,
      message_id: row.messageId,
    });
    return !error;
  } catch {
    return false;
  }
}

export type SentAlert = { handoffId: string; staffId: string | null; toE164: string | null };

/** The alert a swiped reply quotes, by the WhatsApp message id it went out with. */
export async function findAlert(messageId: string, db: Db = whatsappDb()): Promise<SentAlert | null> {
  if (!messageId) return null;
  try {
    const { data, error } = await db
      .from("parent_helper_alerts")
      .select("handoff_id, staff_id, to_e164")
      .eq("message_id", messageId)
      .eq("status", "sent")
      .maybeSingle<{ handoff_id: string; staff_id: string | null; to_e164: string | null }>();
    if (error || !data) return null;
    return { handoffId: data.handoff_id, staffId: data.staff_id, toE164: data.to_e164 };
  } catch {
    return null;
  }
}

/** The answer, where every answer from One's Messages goes. Null when it could not be written. */
export async function insertAnswer(row: { replyId: string; body: string; answeredBy: string }, db: Db = whatsappDb()): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("parent_reply_answers")
      .insert({ reply_id: row.replyId, body: row.body.slice(0, 4000), answered_by: row.answeredBy })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return null;
    return data.id;
  } catch {
    return null;
  }
}

/** The message in Messages is answered: marked done by the person who answered. */
export async function markReplyDone(replyId: string, staffId: string, at: string, db: Db = whatsappDb()): Promise<void> {
  try {
    await db.from("parent_replies").update({ status: "done", done_by: staffId, done_at: at }).eq("id", replyId).eq("status", "open");
  } catch {
    // Messages still shows the answer under it; marking it done is a courtesy.
  }
}

export type DeliveryRecord = {
  answerId: string;
  handoffId: string;
  status: "sent" | "waiting" | "failed";
  via: "text" | "template" | null;
  answererKind: "class_teacher" | "accounts" | "principal" | "office";
  answererName: string | null;
  noteMessageId?: string | null;
  messageId?: string | null;
  reason?: string | null;
  sentAt?: string | null;
};

export async function insertDelivery(row: DeliveryRecord, db: Db = whatsappDb()): Promise<boolean> {
  try {
    const { error } = await db.from("parent_helper_deliveries").insert({
      answer_id: row.answerId,
      handoff_id: row.handoffId,
      status: row.status,
      via: row.via,
      answerer_kind: row.answererKind,
      answerer_name: row.answererName ? row.answererName.slice(0, 80) : null,
      note_message_id: row.noteMessageId ?? null,
      message_id: row.messageId ?? null,
      reason: row.reason ? row.reason.slice(0, 120) : null,
      sent_at: row.sentAt ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * A waiting answer, taken by the run that will send it: only one run gets it,
 * so two messages from the parent in a row never send it twice.
 */
export async function takeWaiting(answerId: string, at: string, db: Db = whatsappDb()): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("parent_helper_deliveries")
      .update({ status: "sent", updated_at: at })
      .eq("answer_id", answerId)
      .eq("status", "waiting")
      .select("answer_id");
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** What became of a taken answer: sent, or back to waiting for the parent's next message. */
export async function finishDelivery(
  answerId: string,
  write: { status: "sent" | "waiting"; messageId: string | null; reason: string | null; at: string },
  db: Db = whatsappDb(),
): Promise<void> {
  try {
    await db
      .from("parent_helper_deliveries")
      .update({
        status: write.status,
        via: write.status === "sent" ? "text" : null,
        message_id: write.messageId,
        reason: write.reason ? write.reason.slice(0, 120) : null,
        sent_at: write.status === "sent" ? write.at : null,
        updated_at: write.at,
      })
      .eq("answer_id", answerId);
  } catch {
    // The parent has the answer or will get it next time; the row is the record, not the delivery.
  }
}

export type WaitingAnswer = {
  answerId: string;
  handoffId: string;
  answerBody: string;
  answeredBy: string;
  answererKind: "class_teacher" | "accounts" | "principal" | "office";
  answererName: string | null;
  createdAt: string;
};

/** Answers still waiting for this parent to write again, oldest first. */
export async function readWaitingAnswers(parentE164: string, db: Db = whatsappDb()): Promise<WaitingAnswer[] | null> {
  try {
    const { data, error } = await db
      .from("parent_helper_deliveries")
      .select(
        "answer_id, handoff_id, answerer_kind, answerer_name, created_at, " +
          "parent_helper_handoffs!inner(parent_e164), parent_reply_answers!inner(body, answered_by)",
      )
      .eq("status", "waiting")
      .eq("parent_helper_handoffs.parent_e164", parentE164)
      .order("created_at", { ascending: true })
      .limit(5)
      .returns<
        Array<{
          answer_id: string;
          handoff_id: string;
          answerer_kind: WaitingAnswer["answererKind"];
          answerer_name: string | null;
          created_at: string;
          parent_reply_answers: { body: string; answered_by: string } | null;
        }>
      >();
    if (error || !data) return null;
    return data
      .filter((row) => row.parent_reply_answers?.body)
      .map((row) => ({
        answerId: row.answer_id,
        handoffId: row.handoff_id,
        answerBody: row.parent_reply_answers?.body ?? "",
        answeredBy: row.parent_reply_answers?.answered_by ?? "",
        answererKind: row.answerer_kind,
        answererName: row.answerer_name,
        createdAt: row.created_at,
      }));
  } catch {
    return null;
  }
}
