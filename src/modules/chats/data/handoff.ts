import "server-only";

import { deskForHandoff, type HandoffTargetName } from "@/modules/chats/domain/access";
import type { ChatInboundMessage } from "@/modules/chats/domain/inbound";
import type { ChatDesk, ChatLanguage, ChatRow } from "@/modules/chats/domain/types";
import { childrenLabel, previewFor } from "@/modules/chats/domain/words";
import type { ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { logInfo, logWarn } from "@/platform/observability/log";

import {
  appendMessage,
  isUuid,
  openChat,
  readChatById,
  readChatSettings,
  updateChat,
  type AppendInput,
  type ChatGuard,
  type ChatRowPatch,
  type ChatSettings,
} from "./store";

/**
 * Veer Patta AI passed a parent's message on (D-578) while chats are on
 * (D-616): it lands in the family's chat at the desk it is for, with what
 * Veer Patta AI told them, and the chat waits for that desk. The people on
 * the desk hear about it from the chats' own WhatsApp nudge, a link to their
 * whole Chats section, instead of an alert to swipe on (the owner, 15 Nov
 * 2026: back-to-back alerts confused staff about whom to answer).
 *
 * Null when chats are off, or the chat could not be written: the hand-off
 * then alerts exactly as it did before, so a parent's message is never left
 * with nobody told.
 */

/** A child of the family as the chat keeps it. `classTeacherId` is already checked against the session (D-560). */
export type HandoffChild = { studentId: string; firstName: string; className: string; classTeacherId: string | null };

export type HandoffChatInput = {
  handoffId: string;
  parentReplyId: string;
  parentE164: string;
  language: ChatLanguage;
  target: HandoffTargetName;
  /** The class teacher of the child it is about, of the session's own kind; null when none. */
  classTeacherId: string | null;
  topic: string;
  complaint: boolean;
  practice: boolean;
  sessionLabel: string;
  fromName: string;
  /** The family's children; the one the message is about is put first. */
  children: readonly HandoffChild[];
  aboutStudentId: string | null;
  /** What the parent sent, as a chat line; null when it cannot be one (then `body`, the words Messages keeps). */
  said: ChatInboundMessage | null;
  body: string;
  /** Veer Patta AI's reply to it, as the parent read it. */
  ai: { text: string; wamid: string | null; at: string } | null;
  /** A line only staff read: for a "no" to an answer (D-584), what the parent asked and what they were told. */
  staffNote: string | null;
};

export type ChatHandoffDeps = {
  now: () => Date;
  readSettings: () => Promise<ChatSettings | null>;
  openChat: typeof openChat;
  readChat: (id: string) => Promise<ChatRow | null>;
  append: (input: AppendInput) => Promise<{ id: string | null; duplicate: boolean } | null>;
  updateChat: (id: string, patch: ChatRowPatch, guard?: ChatGuard) => Promise<boolean>;
};

export function liveChatHandoffDeps(): ChatHandoffDeps {
  return {
    now: () => new Date(),
    readSettings: () => readChatSettings(),
    openChat: (input) => openChat(input),
    readChat: (id) => readChatById(id),
    append: (input) => appendMessage(input),
    updateChat: (id, patch, guard) => updateChat(id, patch, guard),
  };
}

/** The family's children as a chat keeps them, each class teacher of the session's own kind (test accounts only in the test year). */
export function handoffChildren(children: readonly ChildFacts[], sessionLabel: string): HandoffChild[] {
  return children.map((child) => ({
    studentId: child.studentId,
    firstName: child.firstName,
    className: child.className,
    classTeacherId: child.classTeacher && staffBelongsToSession(child.classTeacher.isTest, sessionLabel) ? child.classTeacher.staffId : null,
  }));
}

/**
 * The children a desk's chat is about: on a class teacher's, only the ones
 * they teach (a sibling in another class has their own teacher and their own
 * chat); on the accounts or the office desk, the whole family. The one the
 * message is about comes first. At most eight, as the chat keeps.
 */
export function chatChildren(
  children: readonly HandoffChild[],
  desk: ChatDesk,
  classTeacherId: string | null,
  aboutStudentId: string | null,
): HandoffChild[] {
  const mine = desk === "class" ? children.filter((child) => child.classTeacherId !== null && child.classTeacherId === classTeacherId) : [...children];
  const about = mine.find((child) => child.studentId === aboutStudentId);
  const ordered = about ? [about, ...mine.filter((child) => child !== about)] : mine;
  const seen = new Set<string>();
  return ordered.filter((child) => isUuid(child.studentId) && !seen.has(child.studentId) && seen.add(child.studentId)).slice(0, 8);
}

/** A moment WhatsApp gave, or `fallback` when it is unreadable or in the future. */
function momentOr(at: string | null | undefined, fallback: Date, now: Date): string {
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(time) && time <= now.getTime() + 60_000 ? new Date(time).toISOString() : fallback.toISOString();
}

export async function openChatForHandoff(input: HandoffChatInput, deps: ChatHandoffDeps): Promise<string | null> {
  try {
    const settings = await deps.readSettings();
    if (!settings?.enabled) return null;
    const now = deps.now();
    const { desk, wantsAdmin, classTeacherId } = deskForHandoff(input.target, input.classTeacherId);
    const children = chatChildren(input.children, desk, classTeacherId, input.aboutStudentId);
    const chatId = await deps.openChat({
      parentE164: input.parentE164,
      desk,
      classTeacherId,
      practice: input.practice,
      sessionLabel: input.sessionLabel,
      fromName: input.fromName,
      studentIds: children.map((child) => child.studentId),
      studentLabel: childrenLabel(children),
      language: input.language,
    });
    if (!chatId) return null;
    const before = await deps.readChat(chatId);
    if (!before) return null;

    const links = { handoffId: input.handoffId, parentReplyId: input.parentReplyId };
    const parentAt = momentOr(input.said?.at, now, now);
    // Veer Patta AI's reply and a staff line first, the parent's own words last:
    // the list then shows what the parent said, and each line's moment keeps
    // the thread in the order it happened.
    if (input.ai?.text.trim()) {
      const text = input.ai.text.trim();
      await deps.append({
        ...links,
        chatId,
        direction: "ai",
        kind: "text",
        body: text,
        wamid: input.ai.wamid,
        at: momentOr(input.ai.at, now, now),
        preview: previewFor("text", text, null),
      });
    }
    if (input.staffNote?.trim()) {
      const note = input.staffNote.trim().slice(0, 4000);
      const aiAt = Date.parse(momentOr(input.ai?.at, now, now));
      await deps.append({ ...links, chatId, direction: "note", kind: "event", body: note, meta: { note: "not_helped" }, at: new Date(aiAt + 1).toISOString() });
    }
    const said = input.said;
    const added = said
      ? await deps.append({
          ...links,
          chatId,
          direction: "in",
          kind: said.kind,
          body: said.body,
          media: said.media,
          meta: said.meta,
          wamid: said.wamid,
          replyToWamid: said.replyTo,
          at: parentAt,
          preview: previewFor(said.kind, said.body, said.media),
          // The desk hears about a passed-on message at once (the job's next run), not after the usual pause.
          nudgeAt: now.toISOString(),
        })
      : await deps.append({
          ...links,
          chatId,
          direction: "in",
          kind: "text",
          body: input.body.trim().slice(0, 4096) || null,
          at: parentAt,
          preview: previewFor("text", input.body, null),
          nudgeAt: now.toISOString(),
        });
    if (!added) return null;

    // What the chat is about: while it was already waiting, a complaint or a
    // wish for the principal stays flagged until somebody answers.
    const waiting = before.status === "waiting";
    const flags: ChatRowPatch = {
      topic: input.topic || before.topic,
      complaint: input.complaint || (waiting && before.complaint),
      wants_admin: wantsAdmin || (waiting && before.wantsAdmin),
    };
    await deps.updateChat(chatId, flags).catch(() => false);
    logInfo("chats.handoff", { desk, practice: input.practice, waiting, duplicate: added.duplicate });
    return chatId;
  } catch (caught) {
    logWarn("chats.handoff_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return null;
  }
}
