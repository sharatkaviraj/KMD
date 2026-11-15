import "server-only";

import { chatAccess, type ChatViewer } from "@/modules/chats/domain/access";
import { chatFileName } from "@/modules/chats/domain/files";
import { outgoingBody, type Outgoing } from "@/modules/chats/domain/outgoing";
import { CHAT_TEMPLATE_PARAMS, SCHOOL_MESSAGE_TEMPLATE, schoolMessageParams, templateLanguageOf } from "@/modules/chats/domain/templates";
import type { ChatMedia, ChatMessage, ChatRow, MessageStatus } from "@/modules/chats/domain/types";
import {
  MAX_CHAT_CAPTION,
  MAX_CHAT_TEXT,
  firstChildName,
  needsHead,
  outgoingText,
  previewFor,
  speakerFor,
  speakerFromMeta,
  speakerKey,
  speakerToMeta,
  type Speaker,
} from "@/modules/chats/domain/words";
import { insertAnswer, markReplyDone, readHandoff, updateHandoff, type Handoff, type HandoffPatch } from "@/modules/whatsapp/data/helper-handoffs";
import { readChat as readHelperChat } from "@/modules/whatsapp/data/helper-store";
import { answerReadyParams, windowOpen } from "@/modules/whatsapp/domain/helper-handoff";
import { ANSWER_READY_TEMPLATE, HELPER_TEMPLATE_PARAMS } from "@/modules/whatsapp/domain/helper-hub-templates";
import { logInfo, logWarn } from "@/platform/observability/log";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { templateMessageBody } from "@/platform/whatsapp/payload";
import { checkWhatsAppSend, type TemplateRow, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { providerFor, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readSwitches, readTemplateRow } from "@/platform/whatsapp/store";

import { chatFileLink, checkChatUpload, type CheckedFile } from "./files";
import { readDeskPerson } from "./people";
import {
  appendMessage,
  isUuid,
  markRead,
  readChatById,
  readChatHandoffIds,
  readChatIdForHandoff,
  readChatSettings,
  readChatsForParent,
  readLastOut,
  readMessage,
  readMessageByClientRef,
  readWaitingOut,
  updateChat,
  updateMessage,
  type AppendInput,
  type ChatGuard,
  type ChatRowPatch,
  type ChatSettings,
  type MessagePatch,
} from "./store";

/**
 * A message from school to a parent (D-616): written in One, sent from the
 * school's number through the hub.
 *
 *  - Only someone who may write in the chat (`chatAccess` = `reply`): an
 *    admin takes a teacher's or the accounts chat over first, so two people
 *    never answer one parent at once.
 *  - The parent reads who is writing: the class teacher by name, the
 *    accounts office or the principal's office, at the top of the first
 *    message and again when the writer changes or after a pause.
 *  - WhatsApp's own rules first (`checkWhatsAppSend`): practice mode, the
 *    helper's switch, and while real recipients are off only the owner's
 *    number. A message those stop is not kept; the screen says why.
 *  - Inside the parent's 24 hours it goes now. After them Meta takes no typed
 *    message, so it waits: the parent is told once, by an approved note, that
 *    the school has answered (or written), and everything waiting goes the
 *    moment they reply (`deliverHeldMessages`, from the WhatsApp side).
 *  - The browser's own id for the message (`clientRef`) makes a second tap,
 *    or a retry after a lost answer, change nothing.
 *  - The parent's questions Veer Patta AI passed on to this chat are marked
 *    answered in Messages with the first answer, as an answer typed there is.
 */

/** Everything the send reads and writes, so a test can stand in for each. */
export type ChatSendDeps = {
  now: () => Date;
  readConfig: () => WhatsAppConfig;
  readSwitches: () => Promise<WhatsAppSwitches | null>;
  readTemplateRow: (key: string) => Promise<TemplateRow | null>;
  /** When this number last wrote to the school, as Veer Patta AI remembers it; null when never or unreadable. */
  lastTurnAt: (e164: string) => Promise<string | null>;
  send: (body: Record<string, unknown>) => Promise<ProviderSendResult>;
  readSettings: () => Promise<ChatSettings | null>;
  readChat: (id: string) => Promise<ChatRow | null>;
  readChatsForParent: (e164: string) => Promise<ChatRow[]>;
  readMessage: (id: string) => Promise<ChatMessage | null>;
  readMessageByClientRef: (ref: string) => Promise<ChatMessage | null>;
  readLastOut: (chatId: string) => Promise<ChatMessage | null>;
  readWaitingOut: (chatIds: readonly string[]) => Promise<ChatMessage[]>;
  append: (input: AppendInput) => Promise<{ id: string | null; duplicate: boolean } | null>;
  updateMessage: (id: string, patch: MessagePatch, fromStatus?: MessageStatus) => Promise<boolean>;
  updateChat: (id: string, patch: ChatRowPatch, guard?: ChatGuard) => Promise<boolean>;
  markRead: (chatId: string, staffId: string, at: Date) => Promise<void>;
  readChatHandoffIds: (chatId: string) => Promise<string[]>;
  checkUpload: (input: { chatId: string; path: string; filename: string }) => Promise<CheckedFile | null>;
  fileLink: (path: string, seconds: number) => Promise<string | null>;
  readHandoff: (id: string) => Promise<Handoff | null>;
  updateHandoff: (id: string, patch: HandoffPatch) => Promise<boolean>;
  insertAnswer: (row: { replyId: string; body: string; answeredBy: string }) => Promise<string | null>;
  markReplyDone: (replyId: string, staffId: string, at: string) => Promise<void>;
  /** The chat a hand-off's message went into (`answerHandoffInChat`). */
  readChatIdForHandoff: (handoffId: string) => Promise<string | null>;
  /** A member of staff's name and role, for the head of an answer written in Messages. */
  readStaff: (staffId: string) => Promise<{ name: string; role: string } | null>;
};

/** The real database and the real hub. */
export function liveChatSendDeps(): ChatSendDeps {
  const config = readWhatsAppConfig();
  const provider = config.ok ? providerFor(config) : null;
  return {
    now: () => new Date(),
    readConfig: () => config,
    readSwitches: () => readSwitches(),
    readTemplateRow: (key) => readTemplateRow(key).catch(() => null),
    lastTurnAt: async (e164) => (await readHelperChat(e164)).lastTurnAt,
    send: (body) =>
      provider
        ? provider.send(body)
        : Promise.resolve({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "WhatsApp is not set up here." }),
    readSettings: () => readChatSettings(),
    readChat: (id) => readChatById(id),
    readChatsForParent: (e164) => readChatsForParent(e164),
    readMessage: (id) => readMessage(id),
    readMessageByClientRef: (ref) => readMessageByClientRef(ref),
    readLastOut: (chatId) => readLastOut(chatId),
    readWaitingOut: (chatIds) => readWaitingOut(chatIds),
    append: (input) => appendMessage(input),
    updateMessage: (id, patch, fromStatus) => updateMessage(id, patch, fromStatus),
    updateChat: (id, patch, guard) => updateChat(id, patch, guard),
    markRead: (chatId, staffId, at) => markRead(chatId, staffId, at),
    readChatHandoffIds: (chatId) => readChatHandoffIds(chatId),
    checkUpload: (input) => checkChatUpload(input),
    fileLink: (path, seconds) => chatFileLink(path, seconds),
    readHandoff: (id) => readHandoff(id),
    updateHandoff: (id, patch) => updateHandoff(id, patch),
    insertAnswer: (row) => insertAnswer(row),
    markReplyDone: (replyId, staffId, at) => markReplyDone(replyId, staffId, at),
    readChatIdForHandoff: (handoffId) => readChatIdForHandoff(handoffId),
    readStaff: async (staffId) => {
      const person = await readDeskPerson(staffId);
      return person ? { name: person.name, role: person.role } : null;
    },
  };
}

const MINUTE = 60_000;
/** WhatsApp fetches a photo or a file once, at send time; the link outlives that by a margin and no more. */
const FILE_LINK_SECONDS = 60 * 60;
/** A chat a failed answer puts back to waiting is nudged again this soon, when it had no nudge planned. */
const RENUDGE_MINUTES = 2;

/** The person writing, as the send needs them. The caller has read their permissions (`viewerFor`). */
export type ChatSender = { viewer: ChatViewer; name: string };

export type SendInput = {
  chatId: string;
  /** The browser's own id for this message (a UUID): a second tap or a retry sends nothing twice. */
  clientRef: string;
  text: string;
  /** A photo or a file already uploaded to this chat's shelf (`beginChatUpload`). */
  file: { path: string; filename: string } | null;
};

/**
 * Why nothing was sent:
 *  - `not_found`: no such chat, or not this person's to see;
 *  - `moved`: the chat joined the family's chat at another desk (`code` is that chat's id);
 *  - `take_over`: an admin looking at another desk's chat, who takes it over first;
 *  - `taken`: somebody else has taken it over; `watch`: they may read it only;
 *  - `empty`, `too_long`, `bad_file`: what was typed or attached;
 *  - `blocked`: WhatsApp's rules (`code` says which: practice mode, switched off, testing);
 *  - `not_saved`: the database did not take it. Nothing went.
 */
export type SendRefusal = "not_found" | "moved" | "take_over" | "taken" | "watch" | "empty" | "too_long" | "bad_file" | "blocked" | "not_saved";

/** Where a message stands for the person who wrote it. */
export type Delivery = "sending" | "sent" | "waiting" | "failed";

export type SendOutcome =
  | { ok: true; message: ChatMessage; delivery: Delivery; duplicate: boolean }
  | { ok: false; reason: SendRefusal; code: string | null };

function refuse(reason: SendRefusal, code: string | null = null): SendOutcome {
  return { ok: false, reason, code };
}

export function deliveryOf(message: Pick<ChatMessage, "status">): Delivery {
  switch (message.status) {
    case "sent":
    case "delivered":
    case "read":
      return "sent";
    case "waiting":
      return "waiting";
    case "failed":
      return "failed";
    default:
      return "sending";
  }
}

function sendFailure(result: Exclude<ProviderSendResult, { outcome: "accepted" }>): string {
  return result.outcome === "unknown" ? `send_unknown:${result.errorCode}` : `send_rejected:${result.errorCode ?? result.httpStatus}`;
}

function windowClosed(result: ProviderSendResult): boolean {
  return result.outcome === "rejected" && result.errorCode === "window_closed";
}

const time = (value: string | null | undefined): number => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
};

/** The later of two moments the parent wrote, or null when neither is known. */
function latest(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return time(a) >= time(b) ? a : b;
}

/** The parent wrote after the school last did: whatever the school writes now answers them. */
function answersParent(chat: Pick<ChatRow, "lastParentAt" | "lastStaffAt">): boolean {
  return chat.lastParentAt !== null && time(chat.lastParentAt) > time(chat.lastStaffAt);
}

/** The speaker kept on an earlier message, as a key, for whether the next one needs the head. */
function speakerKeyOf(message: Pick<ChatMessage, "meta">): string | null {
  const speaker = speakerFromMeta(message.meta.speaker);
  return speaker ? speakerKey(speaker) : null;
}

/** One message from school, as it goes out. */
type Pending = {
  id: string;
  kind: "text" | "image" | "document";
  text: string;
  media: ChatMedia | null;
  speaker: Speaker;
  head: boolean;
};

type Context = {
  switches: WhatsAppSwitches | null;
  config: WhatsAppConfig;
  now: Date;
  deps: ChatSendDeps;
};

/** The message as WhatsApp's request, or null when its file cannot be linked. */
async function bodyOf(chat: ChatRow, pending: Pending, deps: ChatSendDeps): Promise<Record<string, unknown> | null> {
  const words = outgoingText({ speaker: pending.speaker, language: chat.language, text: pending.text, head: pending.head });
  if (pending.kind === "text") return outgoingBody(chat.parentE164, { kind: "text", text: words });
  const path = pending.media?.path;
  const link = path ? await deps.fileLink(path, FILE_LINK_SECONDS).catch(() => null) : null;
  if (!link) return null;
  const message: Outgoing =
    pending.kind === "image"
      ? { kind: "image", link, caption: words }
      : { kind: "document", link, filename: pending.media?.filename ?? "document.pdf", caption: words };
  return outgoingBody(chat.parentE164, message);
}

/**
 * The parent told once that a message waits for them: "your answer is ready"
 * for an answer, "the school has sent you a message" otherwise. Null when the
 * note went; the reason when it could not (not approved yet, switched off).
 */
async function tellParent(chat: ChatRow, speaker: Speaker, isAnswer: boolean, ctx: Context): Promise<{ noteId: string | null; problem: string | null }> {
  const language = templateLanguageOf(chat.language);
  const key = isAnswer ? ANSWER_READY_TEMPLATE[language] : SCHOOL_MESSAGE_TEMPLATE[language];
  const params = isAnswer
    ? answerReadyParams(speaker, { childName: firstChildName(chat.studentLabel), topic: chat.topic ?? "" }, chat.language)
    : schoolMessageParams(speaker, firstChildName(chat.studentLabel), chat.language);
  const row = await ctx.deps.readTemplateRow(key);
  const verdict = checkWhatsAppSend({
    feature: "parent_helper",
    to: chat.parentE164,
    switches: ctx.switches,
    config: ctx.config,
    kind: "template",
    template: row,
    language,
    bodyParamCount: isAnswer ? HELPER_TEMPLATE_PARAMS.answerReady : CHAT_TEMPLATE_PARAMS.schoolMessage,
    hasDocument: false,
    hasUrlButton: false,
  });
  if (verdict.decision !== "send" || !row) {
    const code = verdict.decision === "refuse" ? verdict.code : verdict.decision === "dry_run" ? "practice_mode" : "no_template";
    return { noteId: null, problem: code === "template_not_approved" && !isAnswer ? "needs_template" : code };
  }
  const sent = await ctx.deps.send(templateMessageBody({ to: chat.parentE164, name: row.provider_name, languageCode: row.language_code, bodyParams: params }));
  if (sent.outcome === "accepted") return { noteId: sent.messageId, problem: null };
  return { noteId: null, problem: sendFailure(sent) };
}

/**
 * One message on its way. Typed while the parent's 24 hours are open; when
 * they are not (or Meta says so), it waits for the parent, who is told once
 * per run of waiting messages. `hold: false` (delivering what waited, the
 * parent having just written): a closed chat puts it straight back to wait.
 */
async function deliverOne(
  chat: ChatRow,
  pending: Pending,
  options: { open: boolean; hold: boolean; isAnswer: boolean },
  ctx: Context,
): Promise<Exclude<Delivery, "sending">> {
  const { deps, now } = ctx;
  const stamp = now.toISOString();
  if (options.open) {
    const body = await bodyOf(chat, pending, deps);
    if (!body) {
      await deps.updateMessage(pending.id, { status: "failed", status_at: stamp, error: "file_link" }, "sending");
      return "failed";
    }
    const sent = await deps.send(body).catch(
      (): ProviderSendResult => ({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "The send did not finish." }),
    );
    if (sent.outcome === "accepted") {
      await deps.updateMessage(pending.id, { status: "sent", status_at: stamp, wamid: sent.messageId, error: null }, "sending");
      return "sent";
    }
    if (!windowClosed(sent)) {
      await deps.updateMessage(pending.id, { status: "failed", status_at: stamp, error: sendFailure(sent) }, "sending");
      return "failed";
    }
    // Meta says the parent's 24 hours closed after all: it waits instead.
  }

  if (!options.hold) {
    await deps.updateMessage(pending.id, { status: "waiting", status_at: stamp }, "sending");
    return "waiting";
  }

  // One note per run of waiting messages: when one already told the parent, this one waits beside it.
  const waiting = await deps.readWaitingOut([chat.id]).catch(() => [] as ChatMessage[]);
  const told = waiting.some((message) => message.id !== pending.id && message.error === null && time(message.at) > now.getTime() - 24 * 60 * MINUTE);
  if (told) {
    await deps.updateMessage(pending.id, { status: "waiting", status_at: stamp, error: null }, "sending");
    return "waiting";
  }
  const note = await tellParent(chat, pending.speaker, options.isAnswer, ctx);
  await deps.updateMessage(
    pending.id,
    note.noteId
      ? { status: "waiting", status_at: stamp, note_wamid: note.noteId, error: null }
      : { status: "waiting", status_at: stamp, error: `note_not_sent:${note.problem ?? "unknown"}` },
    "sending",
  );
  return "waiting";
}

/**
 * The parent's questions this chat came with, answered: each hand-off Veer
 * Patta AI made into it is closed, and its message in Messages marked done
 * with this answer, so nobody answers it there a second time.
 */
async function closeHandoffs(chatId: string, staffId: string, answer: string, at: string, deps: ChatSendDeps): Promise<void> {
  const ids = await deps.readChatHandoffIds(chatId).catch(() => [] as string[]);
  for (const id of ids) {
    const handoff = await deps.readHandoff(id).catch(() => null);
    if (!handoff || handoff.answeredAt || handoff.closedAt) continue;
    await deps.insertAnswer({ replyId: handoff.parentReplyId, body: answer, answeredBy: staffId }).catch(() => null);
    await deps.updateHandoff(id, { answeredAt: at, nextAction: null }).catch(() => false);
    await deps.markReplyDone(handoff.parentReplyId, staffId, at).catch(() => undefined);
  }
}

/**
 * The chat as it was, when the answer that moved it did not go: still waiting
 * for the school, and nudged again. Only while nothing else has happened in
 * the chat since (the guard), so a parent's new message is never undone.
 */
async function restoreWaiting(chat: ChatRow, at: string, deps: ChatSendDeps, now: Date): Promise<void> {
  if (chat.status !== "waiting") return;
  const patch: ChatRowPatch = {
    status: "waiting",
    waiting_since: chat.waitingSince ?? at,
    nudge_step: chat.nudgeStep ?? "first",
    next_nudge_at: chat.nudgeStep && chat.nextNudgeAt ? chat.nextNudgeAt : new Date(now.getTime() + RENUDGE_MINUTES * MINUTE).toISOString(),
    last_staff_at: chat.lastStaffAt,
  };
  await deps.updateChat(chat.id, patch, { last_direction: "out", last_staff_at: at }).catch(() => false);
}

/** What the answer reads as in Messages: the words, or the file's sign. */
function answerWords(pending: Pick<Pending, "kind" | "text" | "media">): string {
  const sign = pending.kind === "text" ? "" : previewFor(pending.kind, null, pending.media);
  return [sign, pending.text].filter(Boolean).join("\n") || sign || "—";
}

/** A message from school to the parent: kept, sent or waiting, never twice. */
export async function sendChatMessage(input: SendInput, sender: ChatSender, deps: ChatSendDeps): Promise<SendOutcome> {
  if (!isUuid(input.chatId) || !isUuid(input.clientRef)) return refuse("not_found");
  const chat = await deps.readChat(input.chatId);
  if (!chat) return refuse("not_found");
  const access = chatAccess(sender.viewer, chat);
  if (access === "none") return refuse("not_found");
  // Passed to a desk where the family had a chat: everything, this message too, belongs there now.
  if (chat.mergedInto) return refuse("moved", chat.mergedInto);

  // A repeat of a message already on its way is answered with that one.
  const earlier = await deps.readMessageByClientRef(input.clientRef);
  if (earlier) {
    if (earlier.chatId !== chat.id) return refuse("not_found");
    return { ok: true, message: earlier, delivery: deliveryOf(earlier), duplicate: true };
  }

  if (access === "take_over") return refuse("take_over");
  if (access === "watch") return refuse(chat.takenBy ? "taken" : "watch");
  return sendInChat(chat, input, sender, deps);
}

/** The message kept, sent or waiting: everything after the question of who may write. */
async function sendInChat(chat: ChatRow, input: SendInput, sender: ChatSender, deps: ChatSendDeps): Promise<SendOutcome> {
  const text = input.text.replace(/\u0000/g, "").trim();
  if (!text && !input.file) return refuse("empty");
  if (text.length > (input.file ? MAX_CHAT_CAPTION : MAX_CHAT_TEXT)) return refuse("too_long");

  let file: CheckedFile | null = null;
  if (input.file) {
    file = await deps.checkUpload({ chatId: chat.id, path: input.file.path, filename: input.file.filename }).catch(() => null);
    if (!file) return refuse("bad_file");
  }

  const now = deps.now();
  const [switches, lastTurnAt, lastOut] = await Promise.all([
    deps.readSwitches().catch(() => null),
    deps.lastTurnAt(chat.parentE164).catch(() => null),
    deps.readLastOut(chat.id).catch(() => null),
  ]);
  const config = deps.readConfig();

  // WhatsApp's rules come first. A message they stop is not kept: the screen says why, and the words stay in the box.
  const verdict = checkWhatsAppSend({ feature: "parent_helper", to: chat.parentE164, switches, config, kind: "text", wroteInLast24h: true });
  if (verdict.decision !== "send") return refuse("blocked", verdict.decision === "dry_run" ? "practice_mode" : verdict.code);

  const speaker = speakerFor({
    desk: chat.desk,
    role: sender.viewer.role,
    isClassTeacher: chat.desk === "class" && chat.classTeacherId === sender.viewer.staffId,
    name: sender.name,
  });
  const head = needsHead(lastOut ? { speaker: speakerKeyOf(lastOut), at: lastOut.at } : null, speaker, now);
  const kind = file ? file.type.kind : "text";
  const media: ChatMedia | null = file
    ? { path: file.path, mime: file.type.mime, filename: chatFileName(input.file?.filename ?? "", file.type.ext), bytes: file.bytes }
    : null;
  const at = now.toISOString();

  const added = await deps
    .append({
      chatId: chat.id,
      direction: "out",
      kind,
      body: text || null,
      media,
      meta: { speaker: speakerToMeta(speaker), head },
      clientRef: input.clientRef,
      staffId: sender.viewer.staffId,
      staffName: sender.name.trim().slice(0, 80) || null,
      status: "sending",
      at,
      preview: previewFor(kind, text, media),
    })
    .catch(() => null);
  if (!added) return refuse("not_saved");
  if (added.duplicate || !added.id) {
    // The same tap, twice at once: the other one is sending it.
    const same = await deps.readMessageByClientRef(input.clientRef).catch(() => null);
    return same ? { ok: true, message: same, delivery: deliveryOf(same), duplicate: true } : refuse("not_saved");
  }

  const pending: Pending = { id: added.id, kind, text, media, speaker, head };
  const ctx: Context = { switches, config, now, deps };
  const open = windowOpen(latest(chat.lastParentAt, lastTurnAt), now);
  let delivery: Exclude<Delivery, "sending">;
  try {
    delivery = await deliverOne(chat, pending, { open, hold: true, isAnswer: answersParent(chat) }, ctx);
  } catch (caught) {
    logWarn("chats.send_crashed", { error: caught instanceof Error ? caught.message : "unknown" });
    await deps.updateMessage(added.id, { status: "failed", status_at: at, error: "send_crashed" }, "sending").catch(() => false);
    delivery = "failed";
  }

  if (delivery === "failed") {
    await restoreWaiting(chat, at, deps, now);
  } else {
    await closeHandoffs(chat.id, sender.viewer.staffId, answerWords(pending), at, deps);
  }
  await deps.markRead(chat.id, sender.viewer.staffId, now).catch(() => undefined);
  logInfo("chats.sent", { delivery, kind, desk: chat.desk, practice: chat.practice, open });

  const message = await deps.readMessage(added.id).catch(() => null);
  return {
    ok: true,
    delivery,
    duplicate: false,
    message: message ?? {
      id: added.id,
      chatId: chat.id,
      direction: "out",
      kind,
      body: text || null,
      media,
      meta: { speaker: speakerToMeta(speaker), head },
      wamid: null,
      status: delivery,
      error: null,
      staffId: sender.viewer.staffId,
      staffName: sender.name,
      at,
      clientRef: input.clientRef,
    },
  };
}

/**
 * A message that did not go, sent again as a new one (the failed one stays,
 * marked, so the chat shows what happened). Its file is checked again.
 */
export async function resendChatMessage(
  input: { messageId: string; clientRef: string },
  sender: ChatSender,
  deps: ChatSendDeps,
): Promise<SendOutcome> {
  const failed = await deps.readMessage(input.messageId).catch(() => null);
  if (!failed || failed.direction !== "out" || failed.status !== "failed") return refuse("not_found");
  if (failed.meta.resent === true) return refuse("not_found");
  const outcome = await sendChatMessage(
    {
      chatId: failed.chatId,
      clientRef: input.clientRef,
      text: failed.body ?? "",
      file: failed.media?.path ? { path: failed.media.path, filename: failed.media.filename ?? "" } : null,
    },
    sender,
    deps,
  );
  if (outcome.ok && !outcome.duplicate) {
    await deps.updateMessage(failed.id, { meta: { ...failed.meta, resent: true }, status_at: deps.now().toISOString() }).catch(() => false);
  }
  return outcome;
}

/**
 * An answer to one of Veer Patta AI's hand-offs written in Messages, or
 * swiped on an alert that went before chats were on (D-578): when the
 * parent's message is in a chat, the answer goes the chat's way, as the
 * person who wrote it, so the chat shows it and nothing reaches the parent
 * twice. Messages decides who may answer there, as it always has. Null when
 * chats are off or the message is in no chat: the answer goes the old way.
 */
export async function answerHandoffInChat(
  input: { handoffId: string; staffId: string; text: string },
  deps: ChatSendDeps,
): Promise<SendOutcome | null> {
  const settings = await deps.readSettings().catch(() => null);
  if (!settings?.enabled) return null;
  const chatId = await deps.readChatIdForHandoff(input.handoffId).catch(() => null);
  const chat = chatId ? await deps.readChat(chatId).catch(() => null) : null;
  if (!chat) return null;
  const staff = await deps.readStaff(input.staffId).catch(() => null);
  const sender: ChatSender = {
    viewer: { staffId: input.staffId, role: staff?.role ?? "office", replies: true, seesAll: false, feesDesk: false, viewingTest: chat.practice },
    name: staff?.name ?? "",
  };
  return sendInChat(chat, { chatId: chat.id, clientRef: crypto.randomUUID(), text: input.text, file: null }, sender, deps);
}

export type HeldResult = { sent: number; failed: number; held: number };

/**
 * The parent has just written: everything from school that waited for them
 * goes now, oldest first, each chat's first one headed by its writer. A chat
 * whose waiting answer went stays live for the next while, so the parent's
 * reply to it comes back to the same chat. Never throws.
 */
export async function deliverHeldMessages(input: { parentE164: string; chats?: readonly ChatRow[] }, deps: ChatSendDeps): Promise<HeldResult> {
  const result: HeldResult = { sent: 0, failed: 0, held: 0 };
  try {
    const chats = input.chats ?? (await deps.readChatsForParent(input.parentE164));
    if (chats.length === 0) return result;
    const waiting = await deps.readWaitingOut(chats.map((chat) => chat.id));
    if (waiting.length === 0) return result;

    const now = deps.now();
    const switches = await deps.readSwitches().catch(() => null);
    const config = deps.readConfig();
    const verdict = checkWhatsAppSend({ feature: "parent_helper", to: input.parentE164, switches, config, kind: "text", wroteInLast24h: true });
    // Switched off or practice: they keep waiting, and go once it is on again and the parent writes.
    if (verdict.decision !== "send") return { ...result, held: waiting.length };

    const settings = await deps.readSettings().catch(() => null);
    const liveUntil = new Date(now.getTime() + (settings?.liveMinutes ?? 30) * MINUTE).toISOString();
    const ctx: Context = { switches, config, now, deps };
    const byId = new Map(chats.map((chat) => [chat.id, chat]));
    const lastSpeaker = new Map<string, string>();
    const delivered = new Set<string>();

    for (const message of waiting) {
      const chat = byId.get(message.chatId);
      if (!chat) continue;
      if (!(await deps.updateMessage(message.id, { status: "sending", status_at: now.toISOString() }, "waiting"))) continue;
      const speaker = speakerFromMeta(message.meta.speaker) ?? { kind: "office" };
      const previous = lastSpeaker.get(chat.id);
      const kind = message.kind === "image" || message.kind === "document" ? message.kind : "text";
      const pending: Pending = {
        id: message.id,
        kind,
        text: message.body ?? "",
        media: message.media,
        speaker,
        // Time has passed since it was written: the first of each chat says who it is from.
        head: previous === undefined || previous !== speakerKey(speaker),
      };
      const delivery = await deliverOne(chat, pending, { open: true, hold: false, isAnswer: false }, ctx).catch(async () => {
        await deps.updateMessage(message.id, { status: "failed", status_at: now.toISOString(), error: "send_crashed" }, "sending").catch(() => false);
        return "failed" as const;
      });
      lastSpeaker.set(chat.id, speakerKey(speaker));
      if (delivery === "sent") {
        result.sent += 1;
        delivered.add(chat.id);
      } else if (delivery === "failed") result.failed += 1;
      else result.held += 1;
    }

    for (const chatId of delivered) {
      const chat = byId.get(chatId);
      if (chat && time(chat.liveUntil) < time(liveUntil)) await deps.updateChat(chatId, { live_until: liveUntil }).catch(() => false);
    }
    logInfo("chats.held_delivered", { ...result });
    return result;
  } catch (caught) {
    logWarn("chats.held_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return result;
  }
}
