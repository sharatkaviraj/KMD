import "server-only";

import { mayFinishOnThanks, readClosing, type ClosingRead } from "@/modules/chats/domain/finish";
import { inboundContent } from "@/modules/chats/domain/inbound";
import { routeInbound, type ChatRoute } from "@/modules/chats/domain/routing";
import type { ChatKind, ChatMessage, ChatRow } from "@/modules/chats/domain/types";
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

import { askClosingVerdict, type ClosingAsk } from "./finish-ai";
import { deliverHeldMessages, liveChatSendDeps, type HeldResult } from "./send";
import {
  appendMessage,
  readChatSettings,
  readChatsForParent,
  readLastOut,
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
 * parent goes now. A "thank you" to an answer is kept and finishes the chat
 * by itself (D-645): nobody is nudged for it, and nobody has to tap Finished.
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
  /** The school's last message in a chat, for the quick read of a parent's few words. */
  readLastOut: (chatId: string) => Promise<ChatMessage | null>;
  /** Veer Patta AI's quick read: does the school still owe the parent anything? */
  askClosing: (input: { schoolAnswer: string | null; parentMessage: string }) => Promise<ClosingAsk>;
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
    readLastOut: (chatId) => readLastOut(chatId),
    askClosing: (input) => askClosingVerdict(input),
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
  /** The chat finished by itself on the parent's thank-you (D-645): by its words, or by the quick read. */
  finished: "words" | "ai" | null;
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
        doneReason: chat.doneReason,
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
    if (added.duplicate) return { chatId: chat.id, why: route.why, duplicate: true, claimed, delivered: 0, finished: null };

    // "Thank you" to an answer is read, not answered: the chat does not wait on the desk for it.
    const finished = await settleThanks({ chat, content, at, settings, holdsAnswer: (held.get(chat.id) ?? 0) > 0, deps });

    // A message WhatsApp delivered late says little about the parent's 24
    // hours: what waited for them goes only while those can still be open,
    // and only a fresh message moves the helper's memory of when they wrote.
    const age = now.getTime() - Date.parse(at);
    const delivered =
      age < HELD_WITHIN_HOURS * HOUR
        ? await deps.deliverHeld({ parentE164: message.from, chats }).catch(() => ({ sent: 0, failed: 0, held: 0 }))
        : { sent: 0, failed: 0, held: 0 };
    if (age < MAX_MESSAGE_AGE_MINUTES * MINUTE) await deps.saveTurn(message.from, now).catch(() => undefined);
    logInfo("chats.inbound", { why: route.why, kind: content.kind, claimed, delivered: delivered.sent, finished, from: maskNumber(message.from) });
    return { chatId: chat.id, why: route.why, duplicate: false, claimed, delivered: delivered.sent, finished };
  } catch (caught) {
    logWarn("chats.inbound_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return null;
  }
}

/**
 * A parent's message after the school's answer that only closes the chat
 * (D-645). The message was just kept, so the chat reads as waiting; when the
 * message is only thanks (its words, an emoji, a sticker), or Veer Patta AI's
 * quick read says nothing more is owed, the chat finishes by itself instead:
 * nobody is nudged, the bubble and the badge leave it, and a line only staff
 * read says why. A chat a person had finished stays as they left it.
 *
 * Every change is guarded on the chat still waiting from this very message,
 * so a reply from school, or another message from the parent, in between is
 * never undone. With the switch off, or while an answer from school waits to
 * reach the parent, a plain thank-you is still read, not answered: the chat
 * goes back to how it was, as before D-645.
 */
async function settleThanks(input: {
  chat: ChatRow;
  content: { kind: ChatKind; body: string | null };
  at: string;
  settings: ChatSettings;
  /** An answer from school is waiting for this parent and goes now: their "ok" was to the note that it is ready, not to the answer. */
  holdsAnswer: boolean;
  deps: ChatInboundDeps;
}): Promise<"words" | "ai" | null> {
  const { chat, content, at, settings, holdsAnswer, deps } = input;
  if (!mayFinishOnThanks(chat)) return null;
  const read: ClosingRead = readClosing(content);
  if (read === "reply") return null;
  const guard: ChatGuard = { status: "waiting", waiting_since: at, last_direction: "in" };
  const wasDone = chat.status === "done";
  const unchanged: ChatRowPatch = {
    status: wasDone ? "done" : "open",
    waiting_since: null,
    nudge_step: null,
    next_nudge_at: null,
    done_at: wasDone ? chat.doneAt : null,
    done_by: wasDone ? chat.doneBy : null,
    ...(wasDone ? { done_reason: chat.doneReason } : {}),
  };

  if (!settings.finishByItself || holdsAnswer) {
    if (content.kind === "text" && isAcknowledgement(content.body)) await deps.updateChat(chat.id, unchanged, guard).catch(() => false);
    return null;
  }

  let by: "words" | "ai" = "words";
  if (read === "ask") {
    const last = await deps.readLastOut(chat.id).catch(() => null);
    const asked = await deps
      .askClosing({ schoolAnswer: last?.body ?? null, parentMessage: content.body ?? "" })
      .catch((): ClosingAsk => ({ verdict: null, costUsd: 0, problem: "call_failed" }));
    logInfo("chats.closing_read", { verdict: asked.verdict, problem: asked.problem, costUsd: asked.costUsd, practice: chat.practice });
    if (asked.verdict !== "not_needed") return null;
    by = "ai";
  }

  // A chat somebody had already finished goes back to just that; an answered one finishes by itself.
  const patch: ChatRowPatch = wasDone
    ? unchanged
    : { ...unchanged, status: "done", done_at: deps.now().toISOString(), done_by: null, done_reason: "thanks" };
  const changed = await deps.updateChat(chat.id, patch, guard).catch(() => false);
  if (!changed) return null;
  if (!wasDone) {
    await deps
      .append({
        chatId: chat.id,
        direction: "note",
        kind: "event",
        body: null,
        meta: { event: "finished_itself", reason: "thanks", by },
        status: "received",
        at: new Date(Math.max(Date.parse(at) + 1, deps.now().getTime())).toISOString(),
      })
      .catch(() => null);
  }
  return by;
}
