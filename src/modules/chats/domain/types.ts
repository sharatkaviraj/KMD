/**
 * Parent chats (D-616): the shapes the screens, the WhatsApp side and the
 * nudges share. One chat per parent's number per desk; the rows live in
 * `vppsone.parent_chats` and `vppsone.parent_chat_messages`
 * (`20261115034215_parent_chats.sql`).
 *
 * Pure: no database, no request.
 */

/** Who answers a chat: the child's class teacher, the accounts office, or the school office and the principal. */
export const CHAT_DESKS = ["class", "accounts", "admin"] as const;
export type ChatDesk = (typeof CHAT_DESKS)[number];

/** `waiting`: the parent wrote last and nobody has answered. `open`: answered, still going. `done`: closed by a person. */
export type ChatStatus = "waiting" | "open" | "done";

/** `in` the parent, `out` a person at school, `ai` Veer Patta AI, `note` a line only staff see. */
export type ChatDirection = "in" | "out" | "ai" | "note";

export const CHAT_KINDS = [
  "text",
  "image",
  "document",
  "audio",
  "video",
  "sticker",
  "location",
  "contacts",
  "tap",
  "other",
  "suggestion",
  "event",
] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** The parent's language as Veer Patta AI reads it: Hindi, Hinglish or English. */
export type ChatLanguage = "hi" | "hx" | "en";

/**
 * A staff message's way to the parent. `waiting`: the parent's 24 hours had
 * closed, so they were told an answer is ready and it goes the moment they
 * write. `failed`: it did not go, and the chat says why.
 */
export type MessageStatus = "received" | "sending" | "sent" | "delivered" | "read" | "failed" | "waiting";

export type NudgeStep = "first" | "remind" | "pass_up";

export type ChatMedia = {
  /** A parent's file: WhatsApp's media id, fetched through the school's hub only when a person opens it. */
  mediaId?: string | null;
  /** A file somebody at school sent: its place on the private chat-files shelf. */
  path?: string | null;
  mime?: string | null;
  filename?: string | null;
  bytes?: number | null;
};

export type ChatRow = {
  id: string;
  parentE164: string;
  desk: ChatDesk;
  classTeacherId: string | null;
  practice: boolean;
  sessionLabel: string;
  fromName: string;
  studentIds: string[];
  /** "Riya · Class 6, Aarav · Class 2": the children as the chat was opened about them. */
  studentLabel: string | null;
  language: ChatLanguage;
  status: ChatStatus;
  waitingSince: string | null;
  topic: string | null;
  complaint: boolean;
  /** The parent asked for the principal. */
  wantsAdmin: boolean;
  /** Somebody took the chat over from its desk (an admin); nobody else writes until they hand it back. */
  takenBy: string | null;
  takenAt: string | null;
  /** While a person is answering, the parent's next messages come straight here instead of to Veer Patta AI. */
  liveUntil: string | null;
  lastParentAt: string | null;
  lastStaffAt: string | null;
  lastMessageAt: string;
  lastPreview: string | null;
  lastDirection: ChatDirection | null;
  nudgeStep: NudgeStep | null;
  nextNudgeAt: string | null;
  /** Nobody on the desk answered in a day: the chat is in front of the admins too. */
  passedUpAt: string | null;
  doneAt: string | null;
  /** Who closed it, while it is closed. */
  doneBy: string | null;
  /** The chat this one joined when it was passed to a desk where the family already had one (D-617). */
  mergedInto: string | null;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  direction: ChatDirection;
  kind: ChatKind;
  body: string | null;
  media: ChatMedia | null;
  meta: Record<string, unknown>;
  wamid: string | null;
  status: MessageStatus;
  error: string | null;
  staffId: string | null;
  staffName: string | null;
  at: string;
};

export function isChatDesk(value: unknown): value is ChatDesk {
  return typeof value === "string" && (CHAT_DESKS as readonly string[]).includes(value);
}

export function isChatKind(value: unknown): value is ChatKind {
  return typeof value === "string" && (CHAT_KINDS as readonly string[]).includes(value);
}

export function isChatLanguage(value: unknown): value is ChatLanguage {
  return value === "hi" || value === "hx" || value === "en";
}
