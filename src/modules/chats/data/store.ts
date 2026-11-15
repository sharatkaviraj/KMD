import "server-only";

import {
  isChatDesk,
  isChatKind,
  isChatLanguage,
  type ChatDirection,
  type ChatMedia,
  type ChatMessage,
  type ChatRow,
  type ChatStatus,
  type MessageStatus,
  type NudgeStep,
} from "@/modules/chats/domain/types";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * Chats with parents in One's database (D-616): `vppsone.parent_chats` and
 * the tables beside it, through the service role. Every caller has already
 * checked the reader's permission and desk (`domain/access.ts`); nothing
 * here decides who may see what.
 *
 * A read that fails throws, so a screen shows "could not load" rather than a
 * plausible empty list. The WhatsApp side catches it and leaves the message
 * to Veer Patta AI.
 */

type Db = ReturnType<typeof whatsappDb>;

export class ChatStoreError extends Error {
  constructor(what: string) {
    super(`Chats: could not ${what}.`);
    this.name = "ChatStoreError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/* ---------------------------------------------------------------- rows */

const CHAT_COLUMNS =
  "id, parent_e164, desk, class_teacher_id, practice, session_label, from_name, student_ids, student_label, language, status, " +
  "waiting_since, topic, complaint, wants_admin, taken_by, taken_at, live_until, last_parent_at, last_staff_at, last_message_at, " +
  "last_preview, last_direction, nudge_step, next_nudge_at, passed_up_at, done_at, done_by, merged_into, created_at";

type DbChat = {
  id: string;
  parent_e164: string;
  desk: string;
  class_teacher_id: string | null;
  practice: boolean;
  session_label: string;
  from_name: string;
  student_ids: string[] | null;
  student_label: string | null;
  language: string;
  status: string;
  waiting_since: string | null;
  topic: string | null;
  complaint: boolean;
  wants_admin: boolean;
  taken_by: string | null;
  taken_at: string | null;
  live_until: string | null;
  last_parent_at: string | null;
  last_staff_at: string | null;
  last_message_at: string;
  last_preview: string | null;
  last_direction: string | null;
  nudge_step: string | null;
  next_nudge_at: string | null;
  passed_up_at: string | null;
  done_at: string | null;
  done_by: string | null;
  merged_into: string | null;
  created_at: string;
};

const STATUSES: readonly ChatStatus[] = ["waiting", "open", "done"];
const DIRECTIONS: readonly ChatDirection[] = ["in", "out", "ai", "note"];
const STEPS: readonly NudgeStep[] = ["first", "remind", "pass_up"];
const MESSAGE_STATUSES: readonly MessageStatus[] = ["received", "sending", "sent", "delivered", "read", "failed", "waiting"];

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : null;

export function chatFromRow(row: DbChat): ChatRow | null {
  const status = oneOf(STATUSES, row.status);
  if (!isChatDesk(row.desk) || !status) return null;
  const step = oneOf(STEPS, row.nudge_step);
  return {
    id: row.id,
    parentE164: row.parent_e164,
    desk: row.desk,
    classTeacherId: row.class_teacher_id,
    practice: row.practice === true,
    sessionLabel: row.session_label,
    fromName: row.from_name,
    studentIds: Array.isArray(row.student_ids) ? row.student_ids.filter(isUuid) : [],
    studentLabel: row.student_label,
    language: isChatLanguage(row.language) ? row.language : "hi",
    status,
    waitingSince: status === "waiting" ? row.waiting_since : null,
    topic: row.topic,
    complaint: row.complaint === true,
    wantsAdmin: row.wants_admin === true,
    takenBy: row.taken_by,
    takenAt: row.taken_at,
    liveUntil: row.live_until,
    lastParentAt: row.last_parent_at,
    lastStaffAt: row.last_staff_at,
    lastMessageAt: row.last_message_at,
    lastPreview: row.last_preview,
    lastDirection: oneOf(DIRECTIONS, row.last_direction),
    nudgeStep: step,
    nextNudgeAt: step ? row.next_nudge_at : null,
    passedUpAt: row.passed_up_at,
    doneAt: row.done_at,
    doneBy: status === "done" && isUuid(row.done_by) ? row.done_by : null,
    mergedInto: isUuid(row.merged_into) ? row.merged_into : null,
    createdAt: row.created_at,
  };
}

const MESSAGE_COLUMNS = "id, chat_id, direction, kind, body, media, meta, wamid, status, error, staff_id, staff_name, at, status_at, client_ref";

type DbMessage = {
  id: string;
  chat_id: string;
  direction: string;
  kind: string;
  body: string | null;
  media: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  wamid: string | null;
  status: string;
  error: string | null;
  staff_id: string | null;
  staff_name: string | null;
  at: string;
  status_at: string | null;
  client_ref?: string | null;
};

function mediaFrom(value: Record<string, unknown> | null): ChatMedia | null {
  if (!value || typeof value !== "object") return null;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const bytes = typeof value.bytes === "number" && Number.isFinite(value.bytes) ? value.bytes : null;
  return { mediaId: text("media_id"), path: text("path"), mime: text("mime"), filename: text("filename"), bytes };
}

/** A chat file as the row keeps it: snake_case, nothing empty. */
export function mediaToRow(media: ChatMedia | null | undefined): Record<string, unknown> | null {
  if (!media) return null;
  const row: Record<string, unknown> = {};
  if (media.mediaId) row.media_id = media.mediaId;
  if (media.path) row.path = media.path;
  if (media.mime) row.mime = media.mime;
  if (media.filename) row.filename = media.filename;
  if (typeof media.bytes === "number") row.bytes = media.bytes;
  return Object.keys(row).length > 0 ? row : null;
}

export function messageFromRow(row: DbMessage): ChatMessage | null {
  const direction = oneOf(DIRECTIONS, row.direction);
  const status = oneOf(MESSAGE_STATUSES, row.status);
  if (!direction || !status || !isChatKind(row.kind)) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    direction,
    kind: row.kind,
    body: row.body,
    media: mediaFrom(row.media),
    meta: row.meta && typeof row.meta === "object" ? row.meta : {},
    wamid: row.wamid,
    status,
    error: row.error,
    staffId: row.staff_id,
    staffName: row.staff_name,
    at: row.at,
    clientRef: row.client_ref ?? null,
  };
}

/* ---------------------------------------------------------- chat reads */

export async function readChatById(id: string, db: Db = whatsappDb()): Promise<ChatRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db.from("parent_chats").select(CHAT_COLUMNS).eq("id", id).maybeSingle<DbChat>();
  if (error) throw new ChatStoreError("read the chat");
  return data ? chatFromRow(data) : null;
}

/** One parent's chats, newest first: where their next message may belong. */
export async function readChatsForParent(parentE164: string, db: Db = whatsappDb()): Promise<ChatRow[]> {
  const { data, error } = await db
    .from("parent_chats")
    .select(CHAT_COLUMNS)
    .eq("parent_e164", parentE164)
    .is("merged_into", null)
    .order("last_message_at", { ascending: false })
    .limit(20)
    .returns<DbChat[]>();
  if (error || !data) throw new ChatStoreError("read the parent's chats");
  return data.map(chatFromRow).filter((chat): chat is ChatRow => chat !== null);
}

/** Which chats a reader's list starts from, before the desk rules narrow it: theirs, or (admin) all of one kind. */
export type ChatScope =
  | { all: true }
  | { all: false; staffId: string; feesDesk: boolean; office: boolean };

const LIST_LIMIT = { active: 400, done: 150 } as const;

/**
 * The chats a list may show, newest first. Active ones (waiting and open) in
 * full; closed ones only the latest, since nobody scrolls back through a
 * term's worth. The desk rules (`chatVisible`) still run on every row after.
 */
export async function listChats(input: { practice: boolean; done: boolean; scope: ChatScope }, db: Db = whatsappDb()): Promise<ChatRow[]> {
  let query = db.from("parent_chats").select(CHAT_COLUMNS).eq("practice", input.practice).is("merged_into", null);
  query = input.done ? query.eq("status", "done") : query.in("status", ["waiting", "open"]);
  if (!input.scope.all) {
    const { staffId, feesDesk, office } = input.scope;
    if (!isUuid(staffId)) return [];
    const ors = [`and(desk.eq.class,class_teacher_id.eq.${staffId})`, `taken_by.eq.${staffId}`];
    if (feesDesk) ors.push("desk.eq.accounts");
    if (office) ors.push("and(desk.eq.admin,wants_admin.eq.false)");
    query = query.or(ors.join(","));
  }
  const { data, error } = await query
    .order("last_message_at", { ascending: false })
    .limit(input.done ? LIST_LIMIT.done : LIST_LIMIT.active)
    .returns<DbChat[]>();
  if (error || !data) throw new ChatStoreError("read the chats");
  return data.map(chatFromRow).filter((chat): chat is ChatRow => chat !== null);
}

/** Every waiting chat of one kind, for the nudges: who has how many parents waiting. */
export async function readWaitingChats(practice: boolean | null, db: Db = whatsappDb()): Promise<ChatRow[]> {
  let query = db.from("parent_chats").select(CHAT_COLUMNS).eq("status", "waiting");
  if (practice !== null) query = query.eq("practice", practice);
  const { data, error } = await query.order("waiting_since", { ascending: true }).limit(500).returns<DbChat[]>();
  if (error || !data) throw new ChatStoreError("read the waiting chats");
  return data.map(chatFromRow).filter((chat): chat is ChatRow => chat !== null);
}

export async function readChatsByIds(ids: readonly string[], db: Db = whatsappDb()): Promise<ChatRow[]> {
  const wanted = [...new Set(ids)].filter(isUuid);
  if (wanted.length === 0) return [];
  const { data, error } = await fetchInChunks<DbChat>(wanted, IN_FILTER_CHUNK_SIZE, (chunk) =>
    db.from("parent_chats").select(CHAT_COLUMNS).in("id", chunk).returns<DbChat[]>(),
  );
  if (error) throw new ChatStoreError("read the chats");
  return data.map(chatFromRow).filter((chat): chat is ChatRow => chat !== null);
}

/* ------------------------------------------------------ message reads */

/** The latest messages of a chat, oldest first, and whether older ones exist. */
export async function readMessages(
  chatId: string,
  options: { limit?: number; before?: string | null } = {},
  db: Db = whatsappDb(),
): Promise<{ messages: ChatMessage[]; more: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  let query = db.from("parent_chat_messages").select(MESSAGE_COLUMNS).eq("chat_id", chatId);
  if (options.before) query = query.lt("at", options.before);
  const { data, error } = await query
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1)
    .returns<DbMessage[]>();
  if (error || !data) throw new ChatStoreError("read the messages");
  const more = data.length > limit;
  const messages = data
    .slice(0, limit)
    .map(messageFromRow)
    .filter((message): message is ChatMessage => message !== null)
    .reverse();
  return { messages, more };
}

/** Messages new or changed (a tick, a failure) since a moment, for a chat that is open on a screen. */
export async function readMessagesSince(chatId: string, since: string, db: Db = whatsappDb()): Promise<ChatMessage[]> {
  if (!Number.isFinite(Date.parse(since))) return [];
  since = new Date(Date.parse(since)).toISOString();
  const { data, error } = await db
    .from("parent_chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("chat_id", chatId)
    .or(`at.gt."${since}",status_at.gt."${since}",created_at.gt."${since}"`)
    .order("at", { ascending: true })
    .limit(200)
    .returns<DbMessage[]>();
  if (error || !data) throw new ChatStoreError("read the new messages");
  return data.map(messageFromRow).filter((message): message is ChatMessage => message !== null);
}

export async function readMessage(id: string, db: Db = whatsappDb()): Promise<ChatMessage | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db.from("parent_chat_messages").select(MESSAGE_COLUMNS).eq("id", id).maybeSingle<DbMessage>();
  if (error) throw new ChatStoreError("read the message");
  return data ? messageFromRow(data) : null;
}

export async function readMessageByClientRef(clientRef: string, db: Db = whatsappDb()): Promise<ChatMessage | null> {
  if (!isUuid(clientRef)) return null;
  const { data, error } = await db.from("parent_chat_messages").select(MESSAGE_COLUMNS).eq("client_ref", clientRef).maybeSingle<DbMessage>();
  if (error) throw new ChatStoreError("read the message");
  return data ? messageFromRow(data) : null;
}

/** The last message from school in a chat: who wrote it and when, for whether the next one carries the name. */
export async function readLastOut(chatId: string, db: Db = whatsappDb()): Promise<ChatMessage | null> {
  const { data, error } = await db
    .from("parent_chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("chat_id", chatId)
    .eq("direction", "out")
    .in("status", ["sending", "sent", "delivered", "read", "waiting"])
    .order("at", { ascending: false })
    .limit(1)
    .returns<DbMessage[]>();
  if (error || !data) throw new ChatStoreError("read the last message");
  const row = data[0];
  return row ? messageFromRow(row) : null;
}

/** Which of these chats a quoted WhatsApp message belongs to: one sent from school, Veer Patta AI's, or a note about a waiting answer. */
export async function readQuotedChat(chatIds: readonly string[], wamid: string, db: Db = whatsappDb()): Promise<string | null> {
  const ids = chatIds.filter(isUuid);
  if (ids.length === 0 || !wamid || wamid.length > 256) return null;
  const [byId, byNote] = await Promise.all([
    db.from("parent_chat_messages").select("chat_id").eq("wamid", wamid).in("chat_id", ids).limit(1).returns<Array<{ chat_id: string }>>(),
    db.from("parent_chat_messages").select("chat_id").eq("note_wamid", wamid).in("chat_id", ids).limit(1).returns<Array<{ chat_id: string }>>(),
  ]);
  if (byId.error || byNote.error) throw new ChatStoreError("read the quoted message");
  return byId.data?.[0]?.chat_id ?? byNote.data?.[0]?.chat_id ?? null;
}

/** Messages from school still waiting for the parent to write, oldest first. */
export async function readWaitingOut(chatIds: readonly string[], db: Db = whatsappDb()): Promise<ChatMessage[]> {
  const ids = chatIds.filter(isUuid);
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("parent_chat_messages")
    .select(MESSAGE_COLUMNS)
    .in("chat_id", ids)
    .eq("direction", "out")
    .eq("status", "waiting")
    .order("at", { ascending: true })
    .limit(30)
    .returns<DbMessage[]>();
  if (error || !data) throw new ChatStoreError("read the waiting messages");
  return data.map(messageFromRow).filter((message): message is ChatMessage => message !== null);
}

/** The hand-offs behind a chat's messages: closed in Messages once the chat is answered. */
export async function readChatHandoffIds(chatId: string, db: Db = whatsappDb()): Promise<string[]> {
  const { data, error } = await db
    .from("parent_chat_messages")
    .select("handoff_id")
    .eq("chat_id", chatId)
    .not("handoff_id", "is", null)
    .order("at", { ascending: false })
    .limit(20)
    .returns<Array<{ handoff_id: string | null }>>();
  if (error || !data) return [];
  return [...new Set(data.map((row) => row.handoff_id).filter(isUuid))];
}

/** The chat a hand-off's messages went into, if any (newest first, should there be more). */
export async function readChatIdForHandoff(handoffId: string, db: Db = whatsappDb()): Promise<string | null> {
  if (!isUuid(handoffId)) return null;
  const { data, error } = await db
    .from("parent_chat_messages")
    .select("chat_id")
    .eq("handoff_id", handoffId)
    .order("at", { ascending: false })
    .limit(1)
    .returns<Array<{ chat_id: string }>>();
  if (error) throw new ChatStoreError("read the hand-off's chat");
  return data?.[0]?.chat_id ?? null;
}

/** The chats these Messages rows went into, by row: for an "Open in Chats" link beside each. */
export async function readChatIdsForReplies(replyIds: readonly string[], db: Db = whatsappDb()): Promise<Map<string, string>> {
  const wanted = [...new Set(replyIds)].filter(isUuid);
  const chats = new Map<string, string>();
  if (wanted.length === 0) return chats;
  const { data, error } = await fetchInChunks<{ parent_reply_id: string | null; chat_id: string }>(wanted, IN_FILTER_CHUNK_SIZE, (chunk) =>
    db.from("parent_chat_messages").select("parent_reply_id, chat_id").in("parent_reply_id", chunk),
  );
  if (error) throw new ChatStoreError("read the chats of these messages");
  for (const row of data) if (row.parent_reply_id && !chats.has(row.parent_reply_id)) chats.set(row.parent_reply_id, row.chat_id);
  return chats;
}

/* -------------------------------------------------------------- writes */

/** The family's chat at one desk, started when it is new. */
export async function openChat(
  input: {
    parentE164: string;
    desk: ChatRow["desk"];
    classTeacherId: string | null;
    practice: boolean;
    sessionLabel: string;
    fromName: string;
    studentIds: readonly string[];
    studentLabel: string | null;
    language: ChatRow["language"];
  },
  db: Db = whatsappDb(),
): Promise<string | null> {
  const { data, error } = await db.rpc("parent_chat_open", {
    p_parent: input.parentE164,
    p_desk: input.desk,
    p_class_teacher: input.desk === "class" ? input.classTeacherId : null,
    p_practice: input.practice,
    p_session: input.sessionLabel,
    p_from_name: input.fromName,
    p_student_ids: input.studentIds.filter(isUuid).slice(0, 8),
    p_student_label: input.studentLabel,
    p_language: input.language,
  });
  if (error) return null;
  return isUuid(data) ? data : null;
}

export type AppendInput = {
  chatId: string;
  direction: ChatDirection;
  kind: ChatMessage["kind"];
  body: string | null;
  media?: ChatMedia | null;
  meta?: Record<string, unknown> | null;
  wamid?: string | null;
  noteWamid?: string | null;
  replyToWamid?: string | null;
  clientRef?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  status?: MessageStatus | null;
  error?: string | null;
  handoffId?: string | null;
  parentReplyId?: string | null;
  at?: string | null;
  preview?: string | null;
  /** When the parent's message plans the first nudge for: a moment other than the setting's two minutes. */
  nudgeAt?: string | null;
};

/** One message added, and the chat moved with it. `duplicate`: this WhatsApp id or client reference was added before. Null when it failed. */
export async function appendMessage(input: AppendInput, db: Db = whatsappDb()): Promise<{ id: string | null; duplicate: boolean } | null> {
  const p: Record<string, unknown> = { chat_id: input.chatId, direction: input.direction, kind: input.kind };
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") p[key] = value;
  };
  put("body", input.body);
  put("media", mediaToRow(input.media));
  put("meta", input.meta && Object.keys(input.meta).length > 0 ? input.meta : null);
  put("wamid", input.wamid);
  put("note_wamid", input.noteWamid);
  put("reply_to_wamid", input.replyToWamid);
  put("client_ref", input.clientRef);
  put("staff_id", input.staffId);
  put("staff_name", input.staffName);
  put("status", input.status);
  put("error", input.error);
  put("handoff_id", input.handoffId);
  put("parent_reply_id", input.parentReplyId);
  put("at", input.at);
  put("preview", input.preview);
  put("nudge_at", input.nudgeAt);
  const { data, error } = await db.rpc("parent_chat_append", { p });
  if (error || !data || typeof data !== "object") return null;
  const answer = data as { id?: unknown; duplicate?: unknown };
  return { id: isUuid(answer.id) ? answer.id : null, duplicate: answer.duplicate === true };
}

export type ChatRowPatch = Partial<{
  status: ChatStatus;
  waiting_since: string | null;
  topic: string | null;
  complaint: boolean;
  wants_admin: boolean;
  taken_by: string | null;
  taken_at: string | null;
  live_until: string | null;
  last_staff_at: string | null;
  last_message_at: string;
  last_preview: string | null;
  last_direction: ChatDirection | null;
  nudge_step: NudgeStep | null;
  next_nudge_at: string | null;
  nudged_at: string | null;
  reminded_at: string | null;
  passed_up_at: string | null;
  done_at: string | null;
  done_by: string | null;
}>;

/** The columns a change may insist on: the chat is changed only while each still reads as given. */
export type ChatGuard = Partial<Record<"status" | "taken_by" | "waiting_since" | "last_staff_at" | "last_direction" | "next_nudge_at", string | null>>;

/**
 * A change to a chat, made only while the chat is still as it was read
 * (`guard`), so two people, or a person and the WhatsApp side, never undo
 * each other. True when it changed.
 */
export async function updateChat(id: string, patch: ChatRowPatch, guard: ChatGuard = {}, db: Db = whatsappDb()): Promise<boolean> {
  let query = db.from("parent_chats").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  for (const [column, value] of Object.entries(guard)) {
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const { data, error } = await query.select("id").returns<Array<{ id: string }>>();
  if (error) throw new ChatStoreError("change the chat");
  return (data ?? []).length > 0;
}

export type MessagePatch = Partial<{
  status: MessageStatus;
  status_at: string | null;
  wamid: string | null;
  note_wamid: string | null;
  error: string | null;
  meta: Record<string, unknown>;
}>;

/** A change to one message, only while it is still in `fromStatus` when that is given. True when it changed. */
export async function updateMessage(id: string, patch: MessagePatch, fromStatus?: MessageStatus, db: Db = whatsappDb()): Promise<boolean> {
  let query = db.from("parent_chat_messages").update(patch).eq("id", id);
  if (fromStatus) query = query.eq("status", fromStatus);
  const { data, error } = await query.select("id").returns<Array<{ id: string }>>();
  if (error) return false;
  return (data ?? []).length > 0;
}

/** WhatsApp's tick on a message from school, forward only. True when it moved. */
export async function recordChatStatus(wamid: string, status: string, at: string | null, error: string | null, db: Db = whatsappDb()): Promise<boolean> {
  const { data, error: failed } = await db.rpc("parent_chat_status", { p_wamid: wamid, p_status: status, p_at: at, p_error: error });
  if (failed) return false;
  return data === true;
}

/** This person has read the chat up to now. */
export async function markRead(chatId: string, staffId: string, at: Date, db: Db = whatsappDb()): Promise<void> {
  if (!isUuid(chatId) || !isUuid(staffId)) return;
  await db.from("parent_chat_reads").upsert({ chat_id: chatId, staff_id: staffId, read_at: at.toISOString() }, { onConflict: "chat_id,staff_id" });
}

/** How many of the parent's messages in each chat this person has not read. */
export async function readUnread(staffId: string, chatIds: readonly string[], db: Db = whatsappDb()): Promise<Map<string, number>> {
  const ids = chatIds.filter(isUuid);
  const unread = new Map<string, number>();
  if (ids.length === 0 || !isUuid(staffId)) return unread;
  for (let start = 0; start < ids.length; start += IN_FILTER_CHUNK_SIZE) {
    const { data, error } = await db.rpc("parent_chat_unread", { p_staff: staffId, p_chats: ids.slice(start, start + IN_FILTER_CHUNK_SIZE) });
    if (error || !Array.isArray(data)) throw new ChatStoreError("count the unread messages");
    for (const row of data as Array<{ chat_id: string; unread: number }>) {
      if (row.unread > 0) unread.set(row.chat_id, row.unread);
    }
  }
  return unread;
}

/** When each of these people last read each chat. */
export async function readReads(chatIds: readonly string[], db: Db = whatsappDb()): Promise<Array<{ chatId: string; staffId: string; readAt: string }>> {
  const ids = chatIds.filter(isUuid);
  if (ids.length === 0) return [];
  const { data, error } = await fetchInChunks<{ chat_id: string; staff_id: string; read_at: string }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    db.from("parent_chat_reads").select("chat_id, staff_id, read_at").in("chat_id", chunk),
  );
  if (error) throw new ChatStoreError("read who has read the chats");
  return data.map((row) => ({ chatId: row.chat_id, staffId: row.staff_id, readAt: row.read_at }));
}

/* ------------------------------------------------------------ settings */

export type ChatSettings = { enabled: boolean; nudges: boolean; liveMinutes: number; firstNudgeMinutes: number };

/** The chats' switches; null when they could not be read (the WhatsApp side then leaves chats alone). */
export async function readChatSettings(db: Db = whatsappDb()): Promise<ChatSettings | null> {
  try {
    const { data, error } = await db
      .from("parent_chat_settings")
      .select("enabled, nudges, live_minutes, first_nudge_minutes")
      .eq("id", 1)
      .maybeSingle<{ enabled: boolean; nudges: boolean; live_minutes: number; first_nudge_minutes: number }>();
    if (error || !data) return null;
    return { enabled: data.enabled === true, nudges: data.nudges === true, liveMinutes: data.live_minutes, firstNudgeMinutes: data.first_nudge_minutes };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- nudges */

/** The waiting chats whose nudge is due, each held for ten minutes. */
export async function takeDueChats(limit: number, db: Db = whatsappDb()): Promise<string[]> {
  const { data, error } = await db.rpc("parent_chat_take_due", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return data
    .map((value: unknown) => (typeof value === "string" ? value : (value as { parent_chat_take_due?: string })?.parent_chat_take_due))
    .filter(isUuid);
}

export type NudgeRecord = {
  staffId: string | null;
  toE164: string;
  kind: NudgeStep;
  chatIds: readonly string[];
  waiting: number;
  via: "text" | "template" | "none";
  status: "sent" | "failed" | "skipped";
  reason: string | null;
  messageId: string | null;
  practice: boolean;
};

export async function recordNudge(row: NudgeRecord, db: Db = whatsappDb()): Promise<void> {
  await db.from("parent_chat_nudges").insert({
    staff_id: row.staffId,
    to_e164: row.toE164,
    kind: row.kind,
    chat_ids: row.chatIds.filter(isUuid),
    waiting: Math.max(0, Math.round(row.waiting)),
    via: row.via,
    status: row.status,
    reason: row.reason ? row.reason.slice(0, 120) : null,
    message_id: row.messageId,
    practice: row.practice,
  });
}

/** The key `lastNudges` files a nudge under: the number, and the person it was for (practice sends several people's to one number). */
export const nudgeKey = (toE164: string, staffId: string | null) => `${toE164}|${staffId ?? ""}`;

/** When each of these numbers was last sent a nudge, for each person (`nudgeKey`), in the last six hours. */
export async function lastNudges(numbers: readonly string[], db: Db = whatsappDb()): Promise<Map<string, string>> {
  const wanted = [...new Set(numbers)].filter((number) => /^\+[1-9][0-9]{7,14}$/.test(number));
  const last = new Map<string, string>();
  if (wanted.length === 0) return last;
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("parent_chat_nudges")
    .select("to_e164, staff_id, created_at")
    .in("to_e164", wanted)
    .eq("status", "sent")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(400)
    .returns<Array<{ to_e164: string; staff_id: string | null; created_at: string }>>();
  if (error || !data) throw new ChatStoreError("read the last nudges");
  for (const row of data) {
    const key = nudgeKey(row.to_e164, row.staff_id);
    if (!last.has(key)) last.set(key, row.created_at);
  }
  return last;
}

/* ------------------------------------------------------------- passing */

/**
 * Pass a chat to another desk (D-617): it moves there, or joins the family's
 * chat already at that desk. The chat it now lives in; null when it had
 * already joined another or is gone.
 */
export async function passChat(
  input: { chatId: string; desk: ChatRow["desk"]; classTeacherId: string | null; wantsAdmin: boolean; byId: string; byName: string; note: string | null },
  db: Db = whatsappDb(),
): Promise<string | null> {
  const { data, error } = await db.rpc("parent_chat_pass", {
    p_chat: input.chatId,
    p_desk: input.desk,
    p_class_teacher: input.desk === "class" ? input.classTeacherId : null,
    p_wants_admin: input.wantsAdmin,
    p_by: input.byId,
    p_by_name: input.byName.slice(0, 80) || null,
    p_note: input.note?.trim().slice(0, 500) || null,
  });
  if (error) throw new ChatStoreError("pass the chat on");
  return isUuid(data) ? data : null;
}

export type ChatClassTeacher = { studentId: string; staffId: string; name: string };

/** Each child's class teacher today, of the chat's own kind, in the chat's order (D-617). */
export async function readChatClassTeachers(chatId: string, db: Db = whatsappDb()): Promise<ChatClassTeacher[]> {
  if (!isUuid(chatId)) return [];
  const { data, error } = await db.rpc("parent_chat_class_teachers", { p_chat: chatId });
  if (error || !Array.isArray(data)) throw new ChatStoreError("read the class teachers");
  return (data as Array<{ student_id: unknown; staff_id: unknown; staff_name: unknown }>).flatMap((row) =>
    isUuid(row.student_id) && isUuid(row.staff_id)
      ? [{ studentId: row.student_id, staffId: row.staff_id, name: typeof row.staff_name === "string" && row.staff_name.trim() ? row.staff_name.trim() : "—" }]
      : [],
  );
}

/* ------------------------------------------------------------ children */

export type ChildBrief = { id: string; fullName: string; admissionNo: string | null };

/** Children's names and admission numbers, for search and a chat's heading. */
export async function readChildBriefs(ids: readonly string[], db: Db = whatsappDb()): Promise<Map<string, ChildBrief>> {
  const wanted = [...new Set(ids)].filter(isUuid);
  const briefs = new Map<string, ChildBrief>();
  if (wanted.length === 0) return briefs;
  const fees = db.schema(FEE_SCHEMA);
  const { data, error } = await fetchInChunks<{ id: string; full_name: string; admission_no: string | null }>(wanted, IN_FILTER_CHUNK_SIZE, (chunk) =>
    fees.from("students").select("id, full_name, admission_no").in("id", chunk),
  );
  if (error) throw new ChatStoreError("read the children");
  for (const row of data) briefs.set(row.id, { id: row.id, fullName: row.full_name, admissionNo: row.admission_no });
  return briefs;
}
