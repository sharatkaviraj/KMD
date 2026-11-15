import "server-only";

import { chatAccess, mayHandBack, mayPass, type ChatViewer } from "@/modules/chats/domain/access";
import type { ChatDesk, ChatRow } from "@/modules/chats/domain/types";
import { logInfo } from "@/platform/observability/log";

import {
  appendMessage,
  isUuid,
  passChat,
  readChatById,
  readChatClassTeachers,
  updateChat,
  type AppendInput,
  type ChatClassTeacher,
  type ChatGuard,
  type ChatRowPatch,
} from "./store";

/**
 * What a person does to a chat besides writing in it (D-616, D-617): an admin
 * takes a desk's chat over and hands it back; anyone who may answer it passes
 * it to the desk it belongs to, or marks it done; a finished chat opens again.
 *
 * Each change is made only while the chat still reads as it did (`ChatGuard`),
 * so two people never undo each other, and each leaves a line in the chat that
 * only staff read ("Principal's office took this chat over"), so the next
 * person knows what happened. Nothing here reaches the parent.
 */

export type ChatManageDeps = {
  now: () => Date;
  readChat: (id: string) => Promise<ChatRow | null>;
  updateChat: (id: string, patch: ChatRowPatch, guard?: ChatGuard) => Promise<boolean>;
  append: (input: AppendInput) => Promise<{ id: string | null; duplicate: boolean } | null>;
  pass: typeof passChat;
  classTeachers: (chatId: string) => Promise<ChatClassTeacher[]>;
};

export function liveChatManageDeps(): ChatManageDeps {
  return {
    now: () => new Date(),
    readChat: (id) => readChatById(id),
    updateChat: (id, patch, guard) => updateChat(id, patch, guard),
    append: (input) => appendMessage(input),
    pass: (input) => passChat(input),
    classTeachers: (chatId) => readChatClassTeachers(chatId),
  };
}

/** The person doing it, as the desk rules read them (`viewerFor`), and the name the chat's line shows. */
export type ChatActor = { viewer: ChatViewer; name: string };

/**
 * Why nothing changed:
 *  - `not_found`: no such chat, or not this person's to see;
 *  - `not_allowed`: they may see it but not do this (a teacher taking over, a watcher passing it);
 *  - `changed`: somebody else changed it first; the screen reads it again;
 *  - `no_teacher`: no class teacher of the chat's children to pass it to;
 *  - `same_desk`: it is already there.
 */
export type ManageRefusal = "not_found" | "not_allowed" | "changed" | "no_teacher" | "same_desk";

export type ManageOutcome = { ok: true; chatId: string } | { ok: false; reason: ManageRefusal };

const refuse = (reason: ManageRefusal): ManageOutcome => ({ ok: false, reason });

export type ChatEvent = "taken" | "handed_back" | "done" | "reopened";

async function readFor(chatId: string, actor: ChatActor, deps: ChatManageDeps): Promise<ChatRow | null> {
  if (!isUuid(chatId)) return null;
  const chat = await deps.readChat(chatId);
  if (!chat || chat.mergedInto) return null;
  return chatAccess(actor.viewer, chat) === "none" ? null : chat;
}

/** The line only staff read. A line that could not be kept leaves the change standing. */
async function note(chat: ChatRow, event: ChatEvent, actor: ChatActor, deps: ChatManageDeps, extra: Record<string, unknown> = {}): Promise<void> {
  await deps
    .append({
      chatId: chat.id,
      direction: "note",
      kind: "event",
      body: null,
      meta: { event, ...extra },
      staffId: actor.viewer.staffId,
      staffName: actor.name.slice(0, 80) || null,
      status: "received",
      at: deps.now().toISOString(),
    })
    .catch(() => null);
}

/** An admin takes a desk's chat over: from now they write, and the desk reads along until it comes back. */
export async function takeOverChat(chatId: string, actor: ChatActor, deps: ChatManageDeps): Promise<ManageOutcome> {
  const chat = await readFor(chatId, actor, deps);
  if (!chat) return refuse("not_found");
  if (chat.takenBy === actor.viewer.staffId) return { ok: true, chatId: chat.id };
  if (chatAccess(actor.viewer, chat) !== "take_over") return refuse(chat.takenBy ? "changed" : "not_allowed");
  const now = deps.now().toISOString();
  const taken = await deps.updateChat(chat.id, { taken_by: actor.viewer.staffId, taken_at: now }, { taken_by: null });
  if (!taken) return refuse("changed");
  await note(chat, "taken", actor, deps);
  logInfo("chats.taken", { desk: chat.desk, practice: chat.practice });
  return { ok: true, chatId: chat.id };
}

/** The chat goes back to its desk. A parent still waiting is the desk's to answer, and the desk is told. */
export async function handBackChat(chatId: string, actor: ChatActor, deps: ChatManageDeps): Promise<ManageOutcome> {
  const chat = await readFor(chatId, actor, deps);
  if (!chat) return refuse("not_found");
  if (!chat.takenBy) return { ok: true, chatId: chat.id };
  if (!mayHandBack(actor.viewer, chat)) return refuse("not_allowed");
  const now = deps.now().toISOString();
  const patch: ChatRowPatch = { taken_by: null, taken_at: null };
  if (chat.status === "waiting") Object.assign(patch, { nudge_step: "first", next_nudge_at: now, nudged_at: null, reminded_at: null });
  const back = await deps.updateChat(chat.id, patch, { taken_by: chat.takenBy, status: chat.status });
  if (!back) return refuse("changed");
  await note(chat, "handed_back", actor, deps);
  return { ok: true, chatId: chat.id };
}

/** Whether this person may close or reopen the chat: anyone who may write in it, and an admin always. */
function mayFinish(viewer: ChatViewer, chat: ChatRow): boolean {
  return viewer.seesAll || chatAccess(viewer, chat) === "reply";
}

/**
 * Done: nothing more to say, or it was settled another way (a call, at the
 * gate). The parent's next words go to Veer Patta AI again, which brings the
 * chat back if a person is needed.
 */
export async function markChatDone(chatId: string, actor: ChatActor, deps: ChatManageDeps): Promise<ManageOutcome> {
  const chat = await readFor(chatId, actor, deps);
  if (!chat) return refuse("not_found");
  if (chat.status === "done") return { ok: true, chatId: chat.id };
  if (!mayFinish(actor.viewer, chat)) return refuse("not_allowed");
  const now = deps.now().toISOString();
  const done = await deps.updateChat(
    chat.id,
    { status: "done", waiting_since: null, nudge_step: null, next_nudge_at: null, live_until: null, done_at: now, done_by: actor.viewer.staffId },
    { status: chat.status },
  );
  if (!done) return refuse("changed");
  await note(chat, "done", actor, deps);
  return { ok: true, chatId: chat.id };
}

/** A finished chat opens again, answered: nobody is waiting until the parent writes. */
export async function reopenChat(chatId: string, actor: ChatActor, deps: ChatManageDeps): Promise<ManageOutcome> {
  const chat = await readFor(chatId, actor, deps);
  if (!chat) return refuse("not_found");
  if (chat.status !== "done") return { ok: true, chatId: chat.id };
  if (!mayFinish(actor.viewer, chat)) return refuse("not_allowed");
  const opened = await deps.updateChat(chat.id, { status: "open", done_at: null, done_by: null }, { status: "done" });
  if (!opened) return refuse("changed");
  await note(chat, "reopened", actor, deps);
  return { ok: true, chatId: chat.id };
}

/* ------------------------------------------------------------- passing */

/** Where a chat can go: a class teacher of one of its children, the accounts office, the office, or the principal. */
export type PassTarget =
  | { desk: "class"; teacherId: string; name: string; children: string[] }
  | { desk: "accounts" }
  | { desk: "admin"; principal: boolean };

export function passTargetKey(target: PassTarget): string {
  if (target.desk === "class") return `class:${target.teacherId}`;
  if (target.desk === "admin") return target.principal ? "principal" : "office";
  return "accounts";
}

/**
 * The places this chat can be passed to, from where it is now: each child's
 * class teacher (one entry per teacher, with the children they teach), the
 * accounts office and the office; the principal unless they were already
 * asked for. `firstNames` gives each child's first name by id.
 */
export function passTargets(chat: Pick<ChatRow, "desk" | "classTeacherId" | "wantsAdmin">, teachers: readonly ChatClassTeacher[], firstNames: ReadonlyMap<string, string>): PassTarget[] {
  const targets: PassTarget[] = [];
  const byTeacher = new Map<string, { name: string; children: string[] }>();
  for (const teacher of teachers) {
    if (chat.desk === "class" && chat.classTeacherId === teacher.staffId) continue;
    const entry = byTeacher.get(teacher.staffId) ?? { name: teacher.name, children: [] };
    const child = firstNames.get(teacher.studentId);
    if (child && !entry.children.includes(child)) entry.children.push(child);
    byTeacher.set(teacher.staffId, entry);
  }
  for (const [teacherId, entry] of byTeacher) targets.push({ desk: "class", teacherId, name: entry.name, children: entry.children });
  if (chat.desk !== "accounts") targets.push({ desk: "accounts" });
  if (chat.desk !== "admin") targets.push({ desk: "admin", principal: false });
  if (!(chat.desk === "admin" && chat.wantsAdmin)) targets.push({ desk: "admin", principal: true });
  return targets;
}

export type PassRequest = { desk: ChatDesk; teacherId: string | null; principal: boolean; note: string | null };

/**
 * Pass the chat on (D-617): it waits at its new desk, which is told at once;
 * if the family already has a chat there, this one joins it. Anyone who may
 * write in the chat may pass it, and an admin any chat they see. A class
 * teacher is only ever one of the chat's own children's.
 */
export async function passChatOn(chatId: string, request: PassRequest, actor: ChatActor, deps: ChatManageDeps): Promise<ManageOutcome> {
  const chat = await readFor(chatId, actor, deps);
  if (!chat) return refuse("not_found");
  if (!mayPass(actor.viewer, chat) && !actor.viewer.seesAll) return refuse("not_allowed");

  let teacherId: string | null = null;
  if (request.desk === "class") {
    if (!request.teacherId || !isUuid(request.teacherId)) return refuse("no_teacher");
    const teachers = await deps.classTeachers(chat.id);
    if (!teachers.some((teacher) => teacher.staffId === request.teacherId)) return refuse("no_teacher");
    teacherId = request.teacherId;
  }
  const principal = request.desk === "admin" && request.principal;
  const sameDesk = chat.desk === request.desk && (request.desk !== "class" || chat.classTeacherId === teacherId);
  if (sameDesk && !(principal && !chat.wantsAdmin)) return refuse("same_desk");

  const into = await deps.pass({
    chatId: chat.id,
    desk: request.desk,
    classTeacherId: teacherId,
    wantsAdmin: principal,
    byId: actor.viewer.staffId,
    byName: actor.name,
    note: request.note,
  });
  if (!into) return refuse("changed");
  logInfo("chats.passed", { from: chat.desk, to: request.desk, joined: into !== chat.id, practice: chat.practice });
  return { ok: true, chatId: into };
}
