import { chatAccess, mayHandBack, mayPass, type ChatAccess, type ChatViewer } from "@/modules/chats/domain/access";
import type { TeacherGroup, ViewCounts } from "@/modules/chats/domain/filters";
import { mapLink } from "@/modules/chats/domain/inbound";
import type { ChatDesk, ChatDirection, ChatKind, ChatLanguage, ChatMessage, ChatRow, ChatStatus } from "@/modules/chats/domain/types";
import { failureWords, heldWords, previewBy, previewWords, speakerFromMeta, topicWords, type Speaker } from "@/modules/chats/domain/words";
import { p, type Pair } from "@/vx/text";

import { T, deskForWords, deskWords } from "./words";

/**
 * What the Chats screens draw (D-616), built on the server from the chats'
 * rows: a row of the list, a line of a chat, a chat's heading. Pure, so the
 * page, the chat's polling route and the actions all hand the browser the
 * same shapes, and the words a line needs travel with it.
 */

/* ---------------------------------------------------------------- list */

export type ChatListItem = {
  id: string;
  /** The parent's WhatsApp name, or their number when WhatsApp gave none. */
  name: string;
  /** "Riya · Class 6, Aarav · Class 2". */
  children: string | null;
  /** The first child, for the face. */
  studentId: string | null;
  initial: string;
  desk: ChatDesk;
  deskLabel: Pair;
  wantsAdmin: boolean;
  complaint: boolean;
  topic: Pair | null;
  status: ChatStatus;
  waitingSince: string | null;
  lastAt: string;
  preview: Pair;
  previewBy: Pair | null;
  unread: number;
  /** Somebody took it over: who, as the row says it. */
  takenBy: Pair | null;
  /** Nobody on the desk answered in a day (an admin's "For you"). */
  passedUp: boolean;
  practice: boolean;
};

/** "+91 98290 12345" for a stored "+919829012345"; anything else as it is. */
export function phoneWords(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match ? `+91 ${match[1]} ${match[2]}` : e164;
}

function firstLetter(text: string | null | undefined): string {
  const letter = (text ?? "").trim().match(/\p{L}|\p{N}/u)?.[0];
  return letter ? letter.toUpperCase() : "?";
}

export function chatListItem(
  chat: ChatRow,
  viewer: Pick<ChatViewer, "staffId">,
  input: { names: ReadonlyMap<string, string>; unread: number },
): ChatListItem {
  const firstChild = (chat.studentLabel ?? "").split(",")[0]?.split("·")[0]?.trim() || null;
  const takenName = chat.takenBy ? input.names.get(chat.takenBy) ?? null : null;
  return {
    id: chat.id,
    name: chat.fromName.trim() || phoneWords(chat.parentE164),
    children: chat.studentLabel,
    studentId: chat.studentIds[0] ?? null,
    initial: firstLetter(firstChild ?? chat.fromName),
    desk: chat.desk,
    deskLabel: deskWords(chat.desk, chat.classTeacherId ? input.names.get(chat.classTeacherId) ?? null : null, chat.wantsAdmin),
    wantsAdmin: chat.wantsAdmin,
    complaint: chat.complaint,
    topic: topicWords(chat.topic),
    status: chat.status,
    waitingSince: chat.waitingSince,
    lastAt: chat.lastMessageAt,
    preview: previewWords(chat.lastPreview),
    previewBy: previewBy(chat.lastDirection),
    unread: input.unread,
    takenBy: chat.takenBy ? (chat.takenBy === viewer.staffId ? T.youAnswering : T.takenBy(takenName ?? "—")) : null,
    passedUp: chat.passedUpAt !== null && chat.status === "waiting",
    practice: chat.practice,
  };
}

/* ------------------------------------------------------------- a line */

export type Tick = "sending" | "sent" | "delivered" | "read" | "waiting" | "failed";

export type ChatFileView = {
  /** Through One, after the reader's own check (`/chats/file/<id>`). */
  url: string;
  name: string;
  mime: string | null;
  bytes: number | null;
  kind: "image" | "video" | "audio" | "document" | "sticker";
  /** A voice note recorded in WhatsApp, not a sent audio file. */
  voice: boolean;
};

export type ChatMessageView = {
  id: string;
  direction: ChatDirection;
  kind: ChatKind;
  body: string | null;
  at: string;
  /** Who wrote it at school (the person's name, or their desk), "Veer Patta AI", or null for the parent. */
  by: Pair | null;
  /** How the parent reads who wrote it, for a message from school. */
  as: Pair | null;
  tick: Tick | null;
  /** Why a message waits or did not go, in words. */
  problem: Pair | null;
  /** A failed message that has been sent again as a new one. */
  resent: boolean;
  file: ChatFileView | null;
  map: string | null;
  contacts: Array<{ name: string | null; phones: string[] }> | null;
  /** A line only staff read: what happened. Its `body` is the note written with it. */
  event: Pair | null;
  /** The sending screen's own id for a message from school: how that screen knows its line again when the polling brings it. */
  ref: string | null;
};

const SPEAKER_WORDS: Record<Exclude<Speaker["kind"], "class_teacher">, Pair> = {
  accounts: p("Accounts office", "अकाउंट्स विभाग"),
  principal: p("Principal's office", "प्रधानाचार्य कार्यालय"),
  office: p("School office", "स्कूल ऑफ़िस"),
};

/** Who the parent is told is writing. */
export function speakerWords(speaker: Speaker): Pair {
  if (speaker.kind === "class_teacher") return p(`Class teacher ${speaker.name}`, `कक्षा अध्यापक ${speaker.name}`);
  return SPEAKER_WORDS[speaker.kind];
}

function tickOf(message: ChatMessage): Tick | null {
  if (message.direction !== "out" && message.direction !== "ai") return null;
  switch (message.status) {
    case "sending":
    case "sent":
    case "delivered":
    case "read":
    case "waiting":
    case "failed":
      return message.status;
    default:
      return message.direction === "ai" ? "sent" : null;
  }
}

const FILE_KINDS: ReadonlySet<string> = new Set(["image", "video", "audio", "document", "sticker"]);

function fileOf(message: ChatMessage): ChatFileView | null {
  const media = message.media;
  if (!media || !FILE_KINDS.has(message.kind)) return null;
  if (!media.path && !media.mediaId) return null;
  const kind = message.kind as ChatFileView["kind"];
  const fallback = kind === "image" ? "Photo" : kind === "video" ? "Video" : kind === "audio" ? "Voice note" : kind === "sticker" ? "Sticker" : "Document";
  return {
    url: `/chats/file/${message.id}`,
    name: media.filename?.trim() || fallback,
    mime: media.mime ?? null,
    bytes: typeof media.bytes === "number" ? media.bytes : null,
    kind,
    voice: message.meta.voice === true,
  };
}

function contactsOf(meta: Record<string, unknown>): ChatMessageView["contacts"] {
  if (!Array.isArray(meta.contacts)) return null;
  const people = meta.contacts
    .slice(0, 5)
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const name = typeof record.name === "string" ? record.name : null;
      const phones = Array.isArray(record.phones) ? record.phones.filter((phone): phone is string => typeof phone === "string").slice(0, 3) : [];
      return { name, phones };
    })
    .filter((person) => person.name || person.phones.length > 0);
  return people.length > 0 ? people : null;
}

const someone = p("Someone", "किसी");

/** A staff line ("Principal's office took this chat over") in words. */
export function eventWords(message: Pick<ChatMessage, "meta" | "staffName">, names: ReadonlyMap<string, string>): Pair | null {
  const meta = message.meta;
  const who = message.staffName?.trim() || null;
  const by = who ? { en: who, hi: who } : someone;
  if (meta.note === "not_helped") return p("The parent said the answer did not help", "अभिभावक ने कहा कि जवाब से मदद नहीं मिली");
  switch (meta.event) {
    case "taken":
      return p(`${by.en} took this chat over`, `${by.hi} ने यह बातचीत अपने हाथ में ली`);
    case "handed_back":
      return p(`${by.en} handed it back`, `${by.hi} ने इसे वापस दिया`);
    case "done":
      return p(`${by.en} marked it done`, `${by.hi} ने इसे पूरा किया`);
    case "reopened":
      return p(`${by.en} opened it again`, `${by.hi} ने इसे फिर खोला`);
    case "passed": {
      const desk = typeof meta.to === "string" && (meta.to === "class" || meta.to === "accounts" || meta.to === "admin") ? meta.to : null;
      const teacher = typeof meta.to_teacher === "string" ? names.get(meta.to_teacher) ?? null : null;
      const to = desk ? deskForWords(desk, teacher) : p("another desk", "दूसरी डेस्क");
      const joined = meta.joined === true;
      return p(
        `${by.en} passed it to ${to.en}${joined ? ", where the family already had a chat" : ""}`,
        `${by.hi} ने इसे ${to.hi ?? to.en} को भेजा${joined ? ", जहाँ परिवार की बातचीत पहले से थी" : ""}`,
      );
    }
    default:
      return null;
  }
}

export function messageView(message: ChatMessage, names: ReadonlyMap<string, string>): ChatMessageView {
  const tick = tickOf(message);
  const speaker = message.direction === "out" ? speakerFromMeta(message.meta.speaker) : null;
  const staffName = message.staffName?.trim() || null;
  const by: Pair | null =
    message.direction === "ai" ? T.ai : message.direction === "out" ? (staffName ? { en: staffName } : speaker ? speakerWords(speaker) : T.school) : null;
  return {
    id: message.id,
    direction: message.direction,
    kind: message.kind,
    body: message.body,
    at: message.at,
    by,
    as: speaker ? speakerWords(speaker) : null,
    tick,
    problem: tick === "failed" ? failureWords(message.error) : tick === "waiting" ? heldWords(message.error) : null,
    resent: message.meta.resent === true,
    file: fileOf(message),
    map: message.kind === "location" ? mapLink(message.meta) : null,
    contacts: message.kind === "contacts" ? contactsOf(message.meta) : null,
    event: message.direction === "note" ? eventWords(message, names) : null,
    ref: message.direction === "out" ? message.clientRef ?? null : null,
  };
}

/** The staff whose names a run of lines needs: the class teachers a chat was passed to. */
export function namesWanted(messages: readonly ChatMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.direction === "note" && typeof message.meta.to_teacher === "string") ids.push(message.meta.to_teacher);
  }
  return ids;
}

/* ------------------------------------------------------------- heading */

export type ChatChildView = { id: string; name: string; admissionNo: string | null };

export type PassTargetView = {
  key: string;
  desk: ChatDesk;
  teacherId: string | null;
  principal: boolean;
  label: Pair;
};

export type ChatHeadView = {
  id: string;
  name: string;
  phone: string;
  phoneLabel: string;
  children: ChatChildView[];
  childrenLabel: string | null;
  desk: ChatDesk;
  deskLabel: Pair;
  deskFor: Pair;
  status: ChatStatus;
  waitingSince: string | null;
  topic: Pair | null;
  complaint: boolean;
  wantsAdmin: boolean;
  practice: boolean;
  language: ChatLanguage;
  access: ChatAccess;
  takenByName: string | null;
  takenByMe: boolean;
  doneByName: string | null;
  mayPass: boolean;
  mayHandBack: boolean;
  /** Mark done or open again: anyone who may write in it, and an admin always. */
  mayFinish: boolean;
  /**
   * Until when a message reaches the parent at once (their last message plus
   * WhatsApp's 24 hours, less a margin); after it, a message waits for them.
   * Null when they never wrote. The screen compares it with its own clock.
   */
  windowUntil: string | null;
  /** Where "Pass to…" can send it: none once it is done. */
  passTargets: PassTargetView[];
};

export function chatHeadView(
  chat: ChatRow,
  viewer: ChatViewer,
  input: {
    names: ReadonlyMap<string, string>;
    children: readonly ChatChildView[];
    windowUntil: string | null;
    passTargets: readonly PassTargetView[];
  },
): ChatHeadView {
  const access = chatAccess(viewer, chat);
  const teacher = chat.classTeacherId ? input.names.get(chat.classTeacherId) ?? null : null;
  const mayWrite = access === "reply";
  return {
    id: chat.id,
    name: chat.fromName.trim() || phoneWords(chat.parentE164),
    phone: chat.parentE164,
    phoneLabel: phoneWords(chat.parentE164),
    children: [...input.children],
    childrenLabel: chat.studentLabel,
    desk: chat.desk,
    deskLabel: deskWords(chat.desk, teacher, chat.wantsAdmin),
    deskFor: deskForWords(chat.desk, teacher),
    status: chat.status,
    waitingSince: chat.waitingSince,
    topic: topicWords(chat.topic),
    complaint: chat.complaint,
    wantsAdmin: chat.wantsAdmin,
    practice: chat.practice,
    language: chat.language,
    access,
    takenByName: chat.takenBy ? input.names.get(chat.takenBy) ?? "—" : null,
    takenByMe: chat.takenBy !== null && chat.takenBy === viewer.staffId,
    doneByName: chat.doneBy ? input.names.get(chat.doneBy) ?? null : null,
    mayPass: (mayPass(viewer, chat) || viewer.seesAll) && chat.status !== "done",
    mayHandBack: mayHandBack(viewer, chat),
    mayFinish: viewer.seesAll || mayWrite,
    windowUntil: input.windowUntil,
    passTargets: chat.status === "done" ? [] : [...input.passTargets],
  };
}

/* ---------------------------------------------------------- the screens */

/** The list as the page hands it to the screen (`load.ts#loadChatList`). */
export type ChatListData = {
  enabled: boolean;
  items: ChatListItem[];
  /** Chats that matched but are not drawn (past the list's limit). */
  hidden: number;
  /** An admin's tabs: how many chats (and how many waiting) each holds. */
  counts: ViewCounts | null;
  /** An admin's class-teacher chips. */
  teachers: TeacherGroup[];
  /** Each drawn chat's overdue fees, only while "Fees due" is on. */
  dues: Record<string, number>;
  duesFailed: boolean;
  seesAll: boolean;
  feesDesk: boolean;
  viewingTest: boolean;
  /** Everything this person may see (open ones), before the tab, search and dues narrowed it: decides whether search is offered. */
  total: number;
  /**
   * Parents waiting for this person's own reply, whatever the tab: the
   * number on the menu and the chat bubble (D-642). A chat an admin took over
   * stays in a class teacher's list but is not waiting for them.
   */
  waitingForYou: number;
};

/** One chat as the page hands it to the screen (`load.ts#loadChatThread`). */
export type ChatThreadData = {
  head: ChatHeadView;
  messages: ChatMessageView[];
  /** Earlier lines are there to show. */
  more: boolean;
  /** Changes when anything the heading draws changes; the screen's polling sends it back. */
  stamp: string;
  /** Where the next poll starts. */
  cursor: string;
};
