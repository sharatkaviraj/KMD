"use server";

import type { ChatDesk } from "@/modules/chats/domain/types";
import { isChatDesk } from "@/modules/chats/domain/types";
import { CHAT_FILE_MIMES } from "@/modules/chats/domain/files";
import { beginChatUpload } from "@/modules/chats/data/files";
import {
  handBackChat,
  liveChatManageDeps,
  markChatDone,
  noteChatCall,
  passChatOn,
  reopenChat,
  takeOverChat,
  type ManageOutcome,
} from "@/modules/chats/data/manage";
import { currentChatViewer } from "@/modules/chats/data/people";
import { liveChatSendDeps, resendChatMessage, sendChatMessage, type SendOutcome } from "@/modules/chats/data/send";
import { readChatById, isUuid } from "@/modules/chats/data/store";
import { chatAccess } from "@/modules/chats/domain/access";
import { failureWords } from "@/modules/chats/domain/words";
import { logWarn } from "@/platform/observability/log";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";
import { messageView, type ChatMessageView } from "@/vx/screens/chats/view";
import { T } from "@/vx/screens/chats/words";

/*
 * What a person does in Chats (D-616, D-617): write to a parent, send a
 * photo or a file, send a failed message again, reply to a chat that is
 * another desk's, give it back, pass it on, finish it, note a phone call. Every action reads the
 * person again (their permissions, the session they are looking at) and the
 * chat again; the desk rules decide, never the screen. While an administrator
 * looks at One as somebody else nothing changes (D-544).
 */

export type ChatActionFail = { ok: false; words: Pair; moved?: string };

export type SendResult = { ok: true; message: ChatMessageView; delivery: "sending" | "sent" | "waiting" | "failed" } | ChatActionFail;

const NOT_SIGNED_IN = p("You are signed out. Sign in again, then send.", "आप साइन आउट हो गए हैं। फिर से साइन इन करके भेजें।");
const TOO_LONG = p("That message is too long for WhatsApp. Make it shorter.", "यह संदेश व्हाट्सऐप के लिए बहुत लंबा है। छोटा करें।");
const EMPTY = p("Write something, or add a photo or file.", "कुछ लिखें, या फ़ोटो या फ़ाइल जोड़ें।");
const BAD_FILE = p("That file could not be sent. Choose it again.", "वह फ़ाइल नहीं भेजी जा सकी। फिर से चुनें।");
const NOT_SAVED = p("It did not save. Nothing was sent. Try again.", "सहेजा नहीं गया। कुछ नहीं भेजा गया। फिर कोशिश करें।");

type ChatReader = NonNullable<Awaited<ReturnType<typeof currentChatViewer>>>;

/**
 * The check at the top of every action: who is asking, read in the action's
 * own body (`currentChatViewer()`: signed in, with `chats:reply` or
 * `chats:all`), and nothing while an administrator looks at One as somebody
 * else (D-544).
 */
async function guard(reader: Promise<ChatReader | null>): Promise<{ who: ChatReader } | ChatActionFail> {
  try {
    await assertNotPreviewing();
  } catch {
    return { ok: false, words: T.previewing };
  }
  const who = await reader;
  if (!who) return { ok: false, words: NOT_SIGNED_IN };
  return { who };
}

function sendFailWords(outcome: Extract<SendOutcome, { ok: false }>): ChatActionFail {
  switch (outcome.reason) {
    case "moved":
      return { ok: false, words: T.moved, moved: outcome.code ?? undefined };
    case "not_found":
      return { ok: false, words: T.gone };
    case "take_over":
      return { ok: false, words: p("Tap Reply yourself first.", "पहले खुद जवाब दें दबाएँ।") };
    case "taken":
    case "watch":
      return { ok: false, words: T.notAllowed };
    case "empty":
      return { ok: false, words: EMPTY };
    case "too_long":
      return { ok: false, words: TOO_LONG };
    case "bad_file":
      return { ok: false, words: BAD_FILE };
    case "blocked":
      return { ok: false, words: failureWords(outcome.code) };
    case "not_saved":
      return { ok: false, words: NOT_SAVED };
  }
}

export async function sendChatAction(input: { chatId: string; clientRef: string; text: string; file: { path: string; filename: string } | null }): Promise<SendResult> {
  const checked = await guard(currentChatViewer().catch(() => null));
  if ("ok" in checked) return checked;
  const { staff, viewer } = checked.who;
  if (!isUuid(input.chatId) || !isUuid(input.clientRef)) return { ok: false, words: T.gone };
  const file = input.file && typeof input.file.path === "string" ? { path: input.file.path.slice(0, 300), filename: String(input.file.filename ?? "").slice(0, 200) } : null;
  try {
    const outcome = await sendChatMessage(
      { chatId: input.chatId, clientRef: input.clientRef, text: typeof input.text === "string" ? input.text : "", file },
      { viewer, name: staff.displayName },
      liveChatSendDeps(),
    );
    if (!outcome.ok) return sendFailWords(outcome);
    return { ok: true, message: messageView(outcome.message, new Map()), delivery: outcome.delivery };
  } catch (caught) {
    logWarn("chats.send_action_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return { ok: false, words: NOT_SAVED };
  }
}

export async function resendChatAction(input: { messageId: string; clientRef: string }): Promise<SendResult> {
  const checked = await guard(currentChatViewer().catch(() => null));
  if ("ok" in checked) return checked;
  const { staff, viewer } = checked.who;
  if (!isUuid(input.messageId) || !isUuid(input.clientRef)) return { ok: false, words: T.gone };
  try {
    const outcome = await resendChatMessage({ messageId: input.messageId, clientRef: input.clientRef }, { viewer, name: staff.displayName }, liveChatSendDeps());
    if (!outcome.ok) return sendFailWords(outcome);
    return { ok: true, message: messageView(outcome.message, new Map()), delivery: outcome.delivery };
  } catch (caught) {
    logWarn("chats.resend_action_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return { ok: false, words: NOT_SAVED };
  }
}

export type UploadResult = { ok: true; path: string; token: string } | ChatActionFail;

/** A signed link to put one photo or file on this chat's shelf, for someone who may write in it. */
export async function beginUploadAction(input: { chatId: string; mime: string; bytes: number; kind: "image" | "document" }): Promise<UploadResult> {
  const checked = await guard(currentChatViewer().catch(() => null));
  if ("ok" in checked) return checked;
  const { viewer } = checked.who;
  if (!isUuid(input.chatId)) return { ok: false, words: T.gone };
  if (!CHAT_FILE_MIMES.includes(input.mime)) return { ok: false, words: T.fileWrongType };
  const chat = await readChatById(input.chatId).catch(() => null);
  if (!chat) return { ok: false, words: T.gone };
  if (chat.mergedInto) return { ok: false, words: T.moved, moved: chat.mergedInto };
  if (chatAccess(viewer, chat) !== "reply") return { ok: false, words: T.notAllowed };
  const started = await beginChatUpload({ chatId: chat.id, mime: input.mime, bytes: Number(input.bytes), kind: input.kind === "image" ? "image" : "document" }).catch(() => null);
  if (!started) return { ok: false, words: T.uploadFailed };
  if (!started.ok) return { ok: false, words: started.reason === "size" ? T.fileTooBig : started.reason === "type" ? T.fileWrongType : T.uploadFailed };
  return { ok: true, path: started.path, token: started.token };
}

export type ManageResult = { ok: true; chatId: string } | ChatActionFail;

function manageWords(outcome: ManageOutcome): ManageResult {
  if (outcome.ok) return outcome;
  switch (outcome.reason) {
    case "not_found":
      return { ok: false, words: T.gone };
    case "not_allowed":
      return { ok: false, words: T.notAllowed };
    case "changed":
      return { ok: false, words: T.changedFirst };
    case "no_teacher":
      return { ok: false, words: T.noTeacher };
    case "same_desk":
      return { ok: false, words: T.sameDesk };
  }
}

/** `called`: the person tapped Call in the chat, so the chat says so (D-645). */
type Manage = "take" | "give_back" | "finish" | "reopen" | "called";

export async function manageChatAction(input: { chatId: string; step: Manage }): Promise<ManageResult> {
  const checked = await guard(currentChatViewer().catch(() => null));
  if ("ok" in checked) return checked;
  const { staff, viewer } = checked.who;
  if (!isUuid(input.chatId)) return { ok: false, words: T.gone };
  const actor = { viewer, name: staff.displayName };
  const deps = liveChatManageDeps();
  try {
    switch (input.step) {
      case "take":
        return manageWords(await takeOverChat(input.chatId, actor, deps));
      case "give_back":
        return manageWords(await handBackChat(input.chatId, actor, deps));
      case "finish":
        return manageWords(await markChatDone(input.chatId, actor, deps));
      case "reopen":
        return manageWords(await reopenChat(input.chatId, actor, deps));
      case "called":
        return manageWords(await noteChatCall(input.chatId, actor, deps));
      default:
        return { ok: false, words: T.failed };
    }
  } catch (caught) {
    logWarn("chats.manage_failed", { step: input.step, error: caught instanceof Error ? caught.message : "unknown" });
    return { ok: false, words: T.failed };
  }
}

/** Pass the chat to the person chosen in the sheet (`PassTargetView.key`): a class teacher, accounts, the office or the principal. */
export async function passChatAction(input: { chatId: string; desk: ChatDesk; teacherId: string | null; principal: boolean; note: string }): Promise<ManageResult> {
  const checked = await guard(currentChatViewer().catch(() => null));
  if ("ok" in checked) return checked;
  const { staff, viewer } = checked.who;
  if (!isUuid(input.chatId) || !isChatDesk(input.desk)) return { ok: false, words: T.failed };
  const note = typeof input.note === "string" ? input.note.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  try {
    const outcome = await passChatOn(
      input.chatId,
      { desk: input.desk, teacherId: input.desk === "class" && isUuid(input.teacherId) ? input.teacherId : null, principal: input.desk === "admin" && input.principal === true, note: note || null },
      { viewer, name: staff.displayName },
      liveChatManageDeps(),
    );
    return manageWords(outcome);
  } catch (caught) {
    logWarn("chats.pass_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return { ok: false, words: T.failed };
  }
}
