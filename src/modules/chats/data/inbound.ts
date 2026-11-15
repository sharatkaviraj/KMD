import "server-only";

import { inboundContent } from "@/modules/chats/domain/inbound";
import { routeInbound, type ChatRoute } from "@/modules/chats/domain/routing";
import type { ChatMessage, ChatRow } from "@/modules/chats/domain/types";
import { previewFor } from "@/modules/chats/domain/words";
import { saveChat } from "@/modules/whatsapp/data/helper-store";
import { isAcknowledgement } from "@/modules/whatsapp/domain/helper-handoff";
import { MAX_MESSAGE_AGE_MINUTES } from "@/modules/whatsapp/domain/helper-plan";
import { logInfo, logWarn } from "@/platform/observability/log";
import { maskNumber } from "@/platform/whatsapp/numbers";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { checkWhatsAppSend, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import type { ClaimResult } from "@/platform/whatsapp/providers";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

import { deliverHeldMessages, liveChatSendDeps, type HeldResult } from "./send";
import {
  appendMessage,
  readChatSettings,
  readChatsForParent,
  readQuotedChat,
  readWaitingOut,
  updateChat,
  type AppendInput,
  type ChatGuard,
  type ChatRowPatch,
  type ChatSettings,
} from "./store";

/**
 * A parent's WhatsApp message that belongs in a chat with a person at school
 * (D-616), rather than with Veer Patta AI (`routeInbound`): a swiped reply
 * to a message from the chat, the parent writing back to an answer that
 * waited for them, or more words while a person is answering.
 *
 * Asked by the helper's turn (`helper-turn.ts`) before the helper answers,
 * after the staff steps, so the owner's number in a staff role is never
 * taken for a parent. The message is claimed from the hub (so the hub's own
 * bot leaves it alone), kept in the chat (which then waits for the school,
 * and the desk is nudged), and everything from school that waited for the
 * parent goes now. A "thank you" to an answer is kept without making the
 * desk answer it again.
 *
 * Null leaves the message to the helper: chats switched off, no chat to
 * route it to, WhatsApp's rules, the hub saying a person in its own inbox is
 * handling the chat, or a database that did not take it.
 */

export type ChatInboundDeps = {
  now: () => Date;
  readConfig: () => WhatsAppConfig;
  readSettings: () => Promise<ChatSettings | null>;
  readChatsForParent: (e164: string) => Promise<ChatRow[]>;
  readQuotedChat: (chatIds: readonly string[], wamid: string) => Promise<string | null>;
  readWaitingOut: (chatIds: readonly string[]) => Promise<ChatMessage[]>;
  /** Null when the provider cannot claim a message (only the hub can). */
  claim: ((wamid: string) => Promise<ClaimResult>) | null;
  append: (input: AppendInput) => Promise<{ id: string | null; duplicate: boolean } | null>;
  updateChat: (id: string, patch: ChatRowPatch, guard?: ChatGuard) => Promise<boolean>;
  /** The parent wrote now: Veer Patta AI's memory of the number, which also says whether their 24 hours are open. */
  saveTurn: (from: string, at: Date) => Promise<void>;
  deliverHeld: (input: { parentE164: string; chats: readonly ChatRow[] }) => Promise<HeldResult>;
};

export function liveChatInboundDeps(claim: ((wamid: string) => Promise<ClaimResult>) | null): ChatInboundDeps {
  const send = liveChatSendDeps();
  return {
    now: () => new Date(),
    readConfig: () => readWhatsAppConfig(),
    readSettings: () => readChatSettings(),
    readChatsForParent: (e164) => readChatsForParent(e164),
    readQuotedChat: (chatIds, wamid) => readQuotedChat(chatIds, wamid),
    readWaitingOut: (chatIds) => readWaitingOut(chatIds),
    claim,
    append: (input) => appendMessage(input),
    updateChat: (id, patch, guard) => updateChat(id, patch, guard),
    saveTurn: (from, at) => saveChat(from, {}, at),
    deliverHeld: (input) => deliverHeldMessages(input, send),
  };
}

export type ChatInboundOutcome = {
  chatId: string;
  why: NonNullable<ChatRoute>["why"];
  duplicate: boolean;
  /** The hub gave the message to One (its bot leaves it alone). */
  claimed: boolean;
  /** Messages from school that waited for the parent and went now. */
  delivered: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Inside the parent's 24 hours, with an hour to spare. */
const HELD_WITHIN_HOURS = 23;

/** The moment a message was sent, as WhatsApp said, or now when that is unreadable or in the future. */
function sentAt(at: string, now: Date): string {
  const time = Date.parse(at);
  return Number.isFinite(time) && time <= now.getTime() + 60_000 ? new Date(time).toISOString() : now.toISOString();
}

export async function routeChatInbound(
  message: WebhookInbound,
  switches: WhatsAppSwitches | null,
  deps: ChatInboundDeps,
): Promise<ChatInboundOutcome | null> {
  try {
    const content = inboundContent({ type: message.type, text: message.text, raw: message.raw });
    if (!content) return null;
    const settings = await deps.readSettings();
    if (!settings?.enabled) return null;
    const chats = await deps.readChatsForParent(message.from);
    if (chats.length === 0) return null;

    // The same gate as the helper's: the school's number may answer this number now.
    const verdict = checkWhatsAppSend({
      feature: "parent_helper",
      to: message.from,
      switches,
      config: deps.readConfig(),
      kind: "text",
      wroteInLast24h: true,
    });
    if (verdict.decision !== "send") return null;

    const now = deps.now();
    const ids = chats.map((chat) => chat.id);
    const [quoted, waiting] = await Promise.all([
      message.replyTo ? deps.readQuotedChat(ids, message.replyTo) : Promise.resolve(null),
      deps.readWaitingOut(ids),
    ]);
    const held = new Map<string, number>();
    for (const out of waiting) held.set(out.chatId, (held.get(out.chatId) ?? 0) + 1);
    const route = routeInbound({
      quotedChatId: quoted,
      candidates: chats.map((chat) => ({
        id: chat.id,
        status: chat.status,
        liveUntil: chat.liveUntil,
        lastStaffAt: chat.lastStaffAt,
        waitingOut: held.get(chat.id) ?? 0,
      })),
      now,
    });
    const chat = route ? chats.find((candidate) => candidate.id === route.chatId) : undefined;
    if (!route || !chat) return null;

    // The hub's bot leaves a claimed message alone. A person answering in the hub's own inbox keeps it.
    const claim = deps.claim ? await deps.claim(message.providerMessageId).catch(() => null) : null;
    if (claim?.ok && claim.staff) return null;
    const claimed = claim?.ok === true && claim.claimed;

    const at = sentAt(message.at, now);
    const added = await deps.append({
      chatId: chat.id,
      direction: "in",
      kind: content.kind,
      body: content.body,
      media: content.media,
      meta: { ...content.meta, ...(claimed ? {} : { claimed: false }) },
      wamid: message.providerMessageId,
      replyToWamid: message.replyTo,
      at,
      preview: previewFor(content.kind, content.body, content.media),
    });
    if (!added) return null;
    if (added.duplicate) return { chatId: chat.id, why: route.why, duplicate: true, claimed, delivered: 0 };

    // "Thank you" to an answer is read, not answered: the chat does not wait on the desk for it.
    if (chat.status !== "waiting" && content.kind === "text" && isAcknowledgement(content.body)) {
      const done = chat.status === "done";
      await deps
        .updateChat(
          chat.id,
          {
            status: done ? "done" : "open",
            waiting_since: null,
            nudge_step: null,
            next_nudge_at: null,
            done_at: done ? chat.doneAt : null,
            done_by: done ? chat.doneBy : null,
          },
          { status: "waiting", waiting_since: at, last_direction: "in" },
        )
        .catch(() => false);
    }

    // A message WhatsApp delivered late says little about the parent's 24
    // hours: what waited for them goes only while those can still be open,
    // and only a fresh message moves the helper's memory of when they wrote.
    const age = now.getTime() - Date.parse(at);
    const delivered =
      age < HELD_WITHIN_HOURS * HOUR
        ? await deps.deliverHeld({ parentE164: message.from, chats }).catch(() => ({ sent: 0, failed: 0, held: 0 }))
        : { sent: 0, failed: 0, held: 0 };
    if (age < MAX_MESSAGE_AGE_MINUTES * MINUTE) await deps.saveTurn(message.from, now).catch(() => undefined);
    logInfo("chats.inbound", { why: route.why, kind: content.kind, claimed, delivered: delivered.sent, from: maskNumber(message.from) });
    return { chatId: chat.id, why: route.why, duplicate: false, claimed, delivered: delivered.sent };
  } catch (caught) {
    logWarn("chats.inbound_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return null;
  }
}
