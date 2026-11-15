import type { ChatStatus } from "./types";

/**
 * Where a parent's new WhatsApp message goes (D-616): into a chat a person
 * is answering, or to Veer Patta AI as before. Pure.
 *
 * In order:
 *  1. A swiped reply to a message from one of the parent's chats goes to that
 *     chat, even a closed one: the parent is answering it.
 *  2. A chat holding a message from school that waits for the parent to write
 *     (their 24 hours had closed, so they were told an answer is ready): the
 *     parent writing back is the moment it goes, and their words belong there.
 *  3. A chat a person is answering right now (`live_until`, extended by every
 *     message from school): the conversation carries on with that person.
 *  4. Anything else is Veer Patta AI's, which answers or hands it on again,
 *     into the same desk's chat.
 */

export type RouteCandidate = {
  id: string;
  status: ChatStatus;
  liveUntil: string | null;
  lastStaffAt: string | null;
  /** Messages from school in this chat still waiting for the parent to write. */
  waitingOut: number;
};

export type ChatRoute = { chatId: string; why: "reply" | "waiting" | "live" } | null;

const time = (value: string | null): number => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
};

export function routeInbound(input: { quotedChatId: string | null; candidates: readonly RouteCandidate[]; now: Date }): ChatRoute {
  if (input.quotedChatId) return { chatId: input.quotedChatId, why: "reply" };
  const byStaff = [...input.candidates].sort((a, b) => time(b.lastStaffAt) - time(a.lastStaffAt));
  const waiting = byStaff.find((chat) => chat.waitingOut > 0);
  if (waiting) return { chatId: waiting.id, why: "waiting" };
  const live = byStaff.find((chat) => chat.status !== "done" && time(chat.liveUntil) > input.now.getTime());
  return live ? { chatId: live.id, why: "live" } : null;
}
