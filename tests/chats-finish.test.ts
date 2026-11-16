import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/whatsapp/data/helper-store", () => ({ saveChat: vi.fn() }));
vi.mock("@/modules/chats/data/send", () => ({ deliverHeldMessages: vi.fn(), liveChatSendDeps: vi.fn() }));
vi.mock("@/modules/chats/data/finish-ai", () => ({ askClosingVerdict: vi.fn() }));
vi.mock("@/modules/chats/data/store", () => ({
  appendMessage: vi.fn(),
  readChatSettings: vi.fn(),
  readChatsForParent: vi.fn(),
  readLastOut: vi.fn(),
  readQuotedChat: vi.fn(),
  readWaitingOut: vi.fn(),
  updateChat: vi.fn(),
}));
vi.mock("@/platform/observability/log", () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));

import type { ClosingAsk } from "@/modules/chats/data/finish-ai";
import type { ChatGuard, ChatRowPatch, ChatSettings } from "@/modules/chats/data/store";
import { routeChatInbound, type ChatInboundDeps } from "@/modules/chats/data/inbound";
import { closingUserText, isClosingWords, mayFinishOnThanks, readClosing } from "@/modules/chats/domain/finish";
import { routeInbound } from "@/modules/chats/domain/routing";
import type { ChatMessage, ChatRow } from "@/modules/chats/domain/types";
import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import { SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";
import type { WhatsAppSwitches } from "@/platform/whatsapp/policy";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";
import { CALL_ASK_MS, callAskOpen } from "@/vx/screens/chats/logic";
import { eventWords } from "@/vx/screens/chats/view";

/*
 * A chat with a parent finishes by itself (D-645): a thank-you after the
 * school's answer, Veer Patta AI's quick read of a few words, the "did the
 * call settle it?" card, and how each reads in the chat. The twelve quiet
 * hours are proved in SQL (tests/sql/parent-chats-finish.mjs). Every name and
 * number is made up (rule 6).
 */

const NOW = "2026-11-16T06:00:00.000Z";
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.parse(NOW) - hours * HOUR).toISOString();

const TEACHER = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARENT = "+919000000010";

const CONFIG: WhatsAppConfig = { ok: true, provider: "mock", senderNumber: SCHOOL_WHATSAPP_NUMBER };
const SWITCHES: WhatsAppSwitches = {
  dryRun: false,
  features: { parent_helper: true },
  realRecipients: false,
  ownerTestNumber: PARENT,
  dailyLimit: 250,
  feeSender: "fees",
};
const SETTINGS: ChatSettings = { enabled: true, nudges: true, liveMinutes: 30, firstNudgeMinutes: 2, finishByItself: true, quietHours: 12 };

/** An answered chat: the class teacher wrote twelve minutes ago, so the parent's next words still come to them (live). */
function makeChat(over: Partial<ChatRow> = {}): ChatRow {
  return {
    id: CHAT_ID,
    parentE164: PARENT,
    desk: "class",
    classTeacherId: TEACHER,
    practice: true,
    sessionLabel: "TEST-2026-27",
    fromName: "Test Parent",
    studentIds: [],
    studentLabel: "Riya · Class 6",
    language: "hi",
    status: "open",
    waitingSince: null,
    topic: null,
    complaint: false,
    wantsAdmin: false,
    takenBy: null,
    takenAt: null,
    liveUntil: ago(-0.3),
    lastParentAt: ago(0.5),
    lastStaffAt: ago(0.2),
    lastMessageAt: ago(0.2),
    lastPreview: "Kal fees jama kar dijiye.",
    lastDirection: "out",
    nudgeStep: null,
    nextNudgeAt: null,
    passedUpAt: null,
    doneAt: null,
    doneBy: null,
    doneReason: null,
    mergedInto: null,
    createdAt: ago(4),
    ...over,
  };
}

function lastOut(body: string | null): ChatMessage {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    chatId: CHAT_ID,
    direction: "out",
    kind: "text",
    body,
    media: null,
    meta: {},
    wamid: "wamid.out",
    status: "sent",
    error: null,
    staffId: TEACHER,
    staffName: "Test Teacher",
    at: ago(0.2),
    clientRef: null,
  };
}

function inbound(over: Partial<WebhookInbound> = {}): WebhookInbound {
  return { providerMessageId: "wamid.in.1", from: PARENT, fromName: "Test Parent", type: "text", text: "Ok sir thank you", replyTo: null, at: NOW, raw: {}, ...over };
}

type WorldOptions = {
  chat?: Partial<ChatRow>;
  settings?: Partial<ChatSettings>;
  verdict?: ClosingAsk["verdict"];
  waitingOut?: number;
  updateTakes?: boolean;
};

/** The stand-in database: the parent's one chat, what was kept, what changed, and what the quick read was asked. */
function world(options: WorldOptions = {}) {
  const chat = makeChat(options.chat);
  const appended: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; patch: ChatRowPatch; guard?: ChatGuard }> = [];
  const asked: Array<{ schoolAnswer: string | null; parentMessage: string }> = [];
  const held: ChatMessage[] = Array.from({ length: options.waitingOut ?? 0 }, (_, index) => ({
    ...lastOut(`Held ${index}`),
    id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`,
    status: "waiting",
  }));
  const deps: ChatInboundDeps = {
    now: () => new Date(NOW),
    readConfig: () => CONFIG,
    readSettings: async () => ({ ...SETTINGS, ...options.settings }),
    readChatsForParent: async (e164) => (e164 === PARENT ? [chat] : []),
    readQuotedChat: async () => null,
    readWaitingOut: async () => held,
    claim: null,
    append: async (input) => {
      appended.push(input as unknown as Record<string, unknown>);
      return { id: `dddddddd-dddd-4ddd-8ddd-${String(appended.length).padStart(12, "0")}`, duplicate: false };
    },
    updateChat: async (id, patch, guard) => {
      updates.push({ id, patch, guard });
      return options.updateTakes ?? true;
    },
    readLastOut: async () => lastOut("Kal fees jama kar dijiye."),
    askClosing: async (input) => {
      asked.push(input);
      return { verdict: options.verdict ?? null, costUsd: 0.0001, problem: options.verdict ? null : "no_key" };
    },
    saveTurn: async () => undefined,
    deliverHeld: async () => ({ sent: held.length, failed: 0, held: 0 }),
  };
  return { deps, chat, appended, updates, asked };
}

const notes = (w: ReturnType<typeof world>) => w.appended.filter((input) => input.direction === "note");

describe("which words only close a chat", () => {
  it("reads thanks in English, Hinglish and Hindi, and an emoji, as closing", () => {
    for (const text of [
      "Ok sir thank you for informing",
      "Thank you so much ma'am 🙏",
      "ok",
      "👍",
      "Thik hai sir, dhanyawad",
      "Ji samajh gaye, batane ke liye dhanyavad",
      "ठीक है सर, जानकारी देने के लिए धन्यवाद",
      "Noted, thanks",
    ]) {
      expect(isClosingWords(text), text).toBe(true);
    }
  });

  it("never reads a question, a number or news as closing", () => {
    for (const text of [
      "Ok sir, kab tak?",
      "ok sir 5000 jama kar diye",
      "Thank you, kal Riya nahi aayegi",
      "Please send the receipt",
      "",
      "   ",
    ]) {
      expect(isClosingWords(text), text).toBe(false);
    }
  });

  it("keeps a closing message short", () => {
    expect(isClosingWords(Array.from({ length: 13 }, () => "thanks").join(" "))).toBe(false);
    expect(isClosingWords(Array.from({ length: 12 }, () => "thanks").join(" "))).toBe(true);
  });

  it("sorts a message into closing, ask the quick read, or a reply is owed", () => {
    expect(readClosing({ kind: "text", body: "Ok sir thank you for informing" })).toBe("closing");
    expect(readClosing({ kind: "sticker", body: null })).toBe("closing");
    expect(readClosing({ kind: "text", body: "Thik hai sir, kal bhej denge" })).toBe("ask");
    expect(readClosing({ kind: "text", body: "Fees kab tak jama karni hai?" })).toBe("reply");
    expect(readClosing({ kind: "text", body: "word ".repeat(30) })).toBe("reply");
    expect(readClosing({ kind: "image", body: null })).toBe("reply");
    expect(readClosing({ kind: "audio", body: null })).toBe("reply");
    expect(readClosing({ kind: "text", body: "  " })).toBe("reply");
  });

  it("finishes only a chat the school answered and that was not already waiting", () => {
    expect(mayFinishOnThanks({ status: "open", lastStaffAt: ago(1) })).toBe(true);
    expect(mayFinishOnThanks({ status: "done", lastStaffAt: ago(1) })).toBe(true);
    expect(mayFinishOnThanks({ status: "waiting", lastStaffAt: ago(1) })).toBe(false);
    expect(mayFinishOnThanks({ status: "open", lastStaffAt: null })).toBe(false);
  });

  it("gives the quick read the two messages in tags, clipped, and nothing else", () => {
    const text = closingUserText({ schoolAnswer: "a".repeat(400), parentMessage: "Thik hai sir" });
    expect(text).toBe(`<school_answer>\n${"a".repeat(299)}…\n</school_answer>\n<parent_message>\nThik hai sir\n</parent_message>`);
    expect(text).not.toMatch(/\+91/);
    expect(closingUserText({ schoolAnswer: null, parentMessage: "ok" })).toMatch(/a file or a message without words/);
  });
});

describe("a finished chat and the parent's next words", () => {
  const candidate = (over: Partial<Parameters<typeof routeInbound>[0]["candidates"][number]>) => ({
    id: CHAT_ID,
    status: "done" as const,
    liveUntil: ago(-0.2),
    lastStaffAt: ago(0.1),
    doneReason: null,
    waitingOut: 0,
    ...over,
  });
  const now = new Date(NOW);

  it("keeps a chat that finished on thanks live, so more words reach the same person", () => {
    expect(routeInbound({ quotedChatId: null, candidates: [candidate({ doneReason: "thanks" })], now })).toEqual({ chatId: CHAT_ID, why: "live" });
  });

  it("does not keep a chat a person finished, or one closed for being quiet, live", () => {
    expect(routeInbound({ quotedChatId: null, candidates: [candidate({ doneReason: null })], now })).toBeNull();
    expect(routeInbound({ quotedChatId: null, candidates: [candidate({ doneReason: "quiet" })], now })).toBeNull();
  });

  it("leaves a thanks-finished chat to Veer Patta AI once its live minutes pass", () => {
    expect(routeInbound({ quotedChatId: null, candidates: [candidate({ doneReason: "thanks", liveUntil: ago(0.1) })], now })).toBeNull();
  });
});

describe("a thank-you after the school's answer", () => {
  it("finishes the chat by its words: nobody is nudged, and a line says why", async () => {
    const w = world();
    const outcome = await routeChatInbound(inbound({ text: "Ok sir thank you for informing" }), SWITCHES, w.deps);
    expect(outcome).toMatchObject({ chatId: CHAT_ID, why: "live", finished: "words" });
    expect(w.asked).toHaveLength(0);
    const finish = w.updates.at(-1);
    expect(finish?.patch).toMatchObject({ status: "done", done_by: null, done_reason: "thanks", waiting_since: null, nudge_step: null, next_nudge_at: null });
    expect(finish?.patch.done_at).toBe(NOW);
    expect(finish?.guard).toEqual({ status: "waiting", waiting_since: NOW, last_direction: "in" });
    expect(notes(w)).toEqual([expect.objectContaining({ meta: { event: "finished_itself", reason: "thanks", by: "words" }, kind: "event" })]);
  });

  it("finishes on a sticker the same way", async () => {
    const w = world();
    const outcome = await routeChatInbound(inbound({ type: "sticker", text: null, raw: { sticker: { id: "1", mime_type: "image/webp" } } }), SWITCHES, w.deps);
    expect(outcome?.finished).toBe("words");
  });

  it("asks the quick read about a few words that are not a question, and finishes on its no", async () => {
    const w = world({ verdict: "not_needed" });
    const outcome = await routeChatInbound(inbound({ text: "Thik hai sir, kal bhej denge" }), SWITCHES, w.deps);
    expect(w.asked).toEqual([{ schoolAnswer: "Kal fees jama kar dijiye.", parentMessage: "Thik hai sir, kal bhej denge" }]);
    expect(outcome?.finished).toBe("ai");
    expect(notes(w)[0]?.meta).toEqual({ event: "finished_itself", reason: "thanks", by: "ai" });
  });

  it.each(["needed", "unsure", null] as const)("leaves the chat waiting for the school when the quick read says %s", async (verdict) => {
    const w = world({ verdict });
    const outcome = await routeChatInbound(inbound({ text: "Thik hai sir, kal bhej denge" }), SWITCHES, w.deps);
    expect(outcome?.finished).toBeNull();
    expect(w.updates).toHaveLength(0);
    expect(notes(w)).toHaveLength(0);
  });

  it("never asks about a question: it waits for the school", async () => {
    const w = world({ verdict: "not_needed" });
    const outcome = await routeChatInbound(inbound({ text: "Ok sir, fees kab tak?" }), SWITCHES, w.deps);
    expect(outcome?.finished).toBeNull();
    expect(w.asked).toHaveLength(0);
    expect(w.updates).toHaveLength(0);
  });

  it("does not finish a chat that was already waiting for the school", async () => {
    const w = world({ chat: { status: "waiting", waitingSince: ago(1), lastDirection: "in" } });
    expect((await routeChatInbound(inbound(), SWITCHES, { ...w.deps, readQuotedChat: async () => CHAT_ID }))?.finished).toBeNull();
    expect(w.updates).toHaveLength(0);
  });

  it("only reads, not finishes, an ok while an answer waits to reach the parent", async () => {
    const w = world({ waitingOut: 1 });
    const outcome = await routeChatInbound(inbound({ text: "ok" }), SWITCHES, w.deps);
    expect(outcome).toMatchObject({ why: "waiting", finished: null, delivered: 1 });
    expect(w.updates.at(-1)?.patch).toMatchObject({ status: "open", waiting_since: null });
    expect(w.updates.at(-1)?.patch).not.toHaveProperty("done_reason");
  });

  it("with the switch off, goes back to how it was, as before", async () => {
    const w = world({ settings: { finishByItself: false } });
    const outcome = await routeChatInbound(inbound({ text: "Thank you sir" }), SWITCHES, w.deps);
    expect(outcome?.finished).toBeNull();
    expect(w.updates.at(-1)?.patch).toMatchObject({ status: "open", done_by: null });
    expect(notes(w)).toHaveLength(0);
  });

  it("keeps a chat a person finished exactly as they left it", async () => {
    const w = world({ chat: { status: "done", doneAt: ago(1), doneBy: TEACHER, doneReason: null } });
    const outcome = await routeChatInbound(inbound({ text: "thank you", replyTo: "wamid.out" }), SWITCHES, { ...w.deps, readQuotedChat: async () => CHAT_ID });
    expect(outcome).toMatchObject({ why: "reply", finished: "words" });
    expect(w.updates.at(-1)?.patch).toMatchObject({ status: "done", done_at: ago(1), done_by: TEACHER, done_reason: null });
    expect(notes(w)).toHaveLength(0);
  });

  it("keeps a take-over for its own twelve quiet hours", async () => {
    const w = world({ chat: { takenBy: "33333333-3333-4333-8333-333333333333" } });
    await routeChatInbound(inbound(), SWITCHES, w.deps);
    expect(w.updates.at(-1)?.patch).not.toHaveProperty("taken_by");
  });

  it("writes no line when a reply from school came in between", async () => {
    const w = world({ updateTakes: false });
    const outcome = await routeChatInbound(inbound(), SWITCHES, w.deps);
    expect(outcome?.finished).toBeNull();
    expect(notes(w)).toHaveLength(0);
  });
});

describe("after a call", () => {
  it("asks whether the call settled it for two hours after Call was tapped", () => {
    expect(callAskOpen(ago(0.5), NOW)).toBe(true);
    expect(callAskOpen(new Date(Date.parse(NOW) - CALL_ASK_MS + 1000).toISOString(), NOW)).toBe(true);
    expect(callAskOpen(new Date(Date.parse(NOW) - CALL_ASK_MS).toISOString(), NOW)).toBe(false);
    expect(callAskOpen(null, NOW)).toBe(false);
    expect(callAskOpen("not a time", NOW)).toBe(false);
    expect(callAskOpen(ago(-1), NOW)).toBe(false);
  });
});

describe("how a chat that finished by itself reads", () => {
  const names = new Map<string, string>();
  const say = (meta: Record<string, unknown>, staffName: string | null = null) => eventWords({ meta, staffName }, names);

  it("says why, in both languages", () => {
    expect(say({ event: "finished_itself", reason: "thanks", by: "words" })?.en).toBe("Finished by itself: the parent only said thanks");
    expect(say({ event: "finished_itself", reason: "thanks", by: "ai" })?.en).toMatch(/Veer Patta AI read the parent's message as needing no reply/);
    expect(say({ event: "finished_itself", reason: "quiet", hours: 12, handed_back: false })?.en).toBe("Finished by itself: nobody wrote for 12 hours");
    expect(say({ event: "finished_itself", reason: "quiet", hours: 12, handed_back: true })?.en).toBe("Finished by itself: nobody wrote for 12 hours. It is back with its desk");
    expect(say({ event: "finished_itself", reason: "quiet", hours: "x" })?.en).toMatch(/12 hours/);
    expect(say({ event: "handed_back_itself", hours: 12 })?.en).toBe("Back with its desk by itself after 12 quiet hours");
    expect(say({ event: "called" }, "Test Teacher")?.en).toBe("Test Teacher called the parent");
    for (const meta of [{ event: "finished_itself", reason: "thanks" }, { event: "handed_back_itself" }, { event: "called" }]) {
      expect(say(meta)?.hi).toBeTruthy();
    }
  });
});
