import { sameNumber } from "@/platform/whatsapp/numbers";

import { istHour, type ChildFacts } from "./helper-facts";
import type { HelperMessage } from "./helper-messages";
import {
  cardFor,
  fallbackReply,
  handoffAck,
  mediaReply,
  menuCard,
  officePrompt,
  teacherPrompt,
  thanksReply,
  voiceReply,
  welcomeCard,
  type Family,
  type HandoffTarget,
  type ReplyContext,
} from "./helper-replies";
import { detectLanguage, ruleIntent, type HelperLanguage, type HelperTap, type MessageKind } from "./helper-text";

/**
 * What Veer Patta AI does with one message (D-574), decided without a
 * database or a network: the data layer reads, this decides, the data layer
 * sends. Every rule a parent would notice is here and tested.
 *
 *  - A tap on one of the helper's own buttons is answered at once.
 *  - A short plain ask ("fees", "हाज़िरी", "receipt bhejo") is answered at
 *    once from the card for it.
 *  - After "Message: Rudra" or "Talk to the office", the next thing the
 *    parent types is put in front of the school, for 30 minutes.
 *  - Anything else goes to Claude, or, when Claude cannot be asked (switched
 *    off, over budget, no key), to the menu and the office.
 *  - "stop" is never answered: the hub keeps the school's opt-out list, and a
 *    parent who says stop is not sent a menu.
 */

/** How long the helper waits for the message it asked for. */
export const AWAIT_MINUTES = 30;
/** A hello more than this long after the last one gets the whole welcome again. */
export const GREETING_GAP_HOURS = 12;
/** Teachers and the office are alerted only between these hours, in India (the owner, 12 Nov 2026). */
export const ALERT_HOURS = { from: 6, to: 21 } as const;
/** Answers to one number in one day; past it, the office and the hub's own bot take over. */
export const MAX_TURNS_PER_NUMBER_PER_DAY = 40;
/** A message older than this is not answered: the parent has moved on, or the office has. */
export const MAX_MESSAGE_AGE_MINUTES = 10;

export function isLateHour(now: Date): boolean {
  const hour = istHour(now);
  return hour < ALERT_HOURS.from || hour >= ALERT_HOURS.to;
}

export type ChatState = {
  language: HelperLanguage | null;
  /** "teacher:<child key>" or "office": what the next typed message is for. */
  awaiting: string | null;
  awaitingUntil: string | null;
  greetedAt: string | null;
  lastTurnAt: string | null;
};

export const EMPTY_CHAT: ChatState = { language: null, awaiting: null, awaitingUntil: null, greetedAt: null, lastTurnAt: null };

export type ChatPatch = Partial<Pick<ChatState, "language" | "awaiting" | "awaitingUntil" | "greetedAt">>;

export type HandoffPlan = {
  target: HandoffTarget;
  child: ChildFacts | null;
  /** The parent's own words, for the person who will answer. */
  body: string;
  /** What it is about, in a word: message_teacher, office, complaint, fees, request … */
  topic: string;
};

/** How a reply was decided: a rule, a tap, Claude (quick or careful), or the menu when nothing else could. */
export type TurnRoute = "rule" | "tap" | "ai" | "ai_careful" | "fallback";

export type TurnPlan =
  | { action: "skip"; reason: string }
  | {
      action: "reply";
      intent: string;
      route: TurnRoute;
      language: HelperLanguage;
      message: HelperMessage;
      chat: ChatPatch;
      handoff: HandoffPlan | null;
    }
  | { action: "ask_ai"; language: HelperLanguage; firstContact: boolean; chat: ChatPatch };

export type PlanInput = {
  kind: MessageKind;
  text: string | null;
  tap: HelperTap | null;
  chat: ChatState;
  family: Family;
  helperName: string;
  now: Date;
  aiAvailable: boolean;
};

const CANCEL = /^(cancel|no|nahi|nahin|rehne do|rehne dijiye|chhodo|रहने दें|रहने दो|नहीं|छोड़ो)[\s!.।]*$/i;

function isAwaiting(chat: ChatState, now: Date): boolean {
  if (!chat.awaiting || !chat.awaitingUntil) return false;
  const until = Date.parse(chat.awaitingUntil);
  return Number.isFinite(until) && until > now.getTime();
}

function awaitUntil(now: Date): string {
  return new Date(now.getTime() + AWAIT_MINUTES * 60_000).toISOString();
}

function greetedRecently(chat: ChatState, now: Date): boolean {
  const at = chat.greetedAt ? Date.parse(chat.greetedAt) : Number.NaN;
  return Number.isFinite(at) && now.getTime() - at < GREETING_GAP_HOURS * 3_600_000;
}

/** The child a key names, in this family only. */
export function childByKey(family: Family, key: string | null | undefined): ChildFacts | null {
  if (!key) return null;
  return family.children.find((child) => child.key === key) ?? null;
}

/**
 * Who a hand-off goes to, once the facts are known: a class teacher the
 * child does not have becomes the office.
 */
export function settleHandoff(target: HandoffTarget, child: ChildFacts | null): { target: HandoffTarget; child: ChildFacts | null } {
  if (target === "class_teacher" && !child?.classTeacher) return { target: "office", child };
  return { target, child };
}

/** The plan for a message the helper has decided to put in front of the school. */
export function handoffReply(
  context: ReplyContext,
  wanted: HandoffTarget,
  child: ChildFacts | null,
  body: string,
  topic: string,
  now: Date,
  aiReply?: string | null,
): { message: HelperMessage; handoff: HandoffPlan } {
  const settled = settleHandoff(wanted, child);
  const message = handoffAck(context, settled.target, {
    child: settled.child,
    teacherName: settled.target === "class_teacher" ? settled.child?.classTeacher?.name ?? null : null,
    lateHour: isLateHour(now),
    aiReply: aiReply ?? null,
  });
  return { message, handoff: { target: settled.target, child: settled.child, body, topic } };
}

/**
 * The children a number stands for, or null when the helper does not know
 * the number (then it stays out of the chat and the hub's own bot answers).
 * Step 1 knows exactly one number: the owner's test number, standing for the
 * practice children in `parent_helper_settings`.
 */
export function practiceIdsFor(from: string, ownerTestNumber: string | null, practiceIds: readonly string[]): string[] | null {
  if (!ownerTestNumber || practiceIds.length === 0) return null;
  return sameNumber(from, ownerTestNumber) ? [...practiceIds] : null;
}

export function planTurn(input: PlanInput): TurnPlan {
  const { chat, family, now } = input;
  const text = (input.text ?? "").trim();
  const detected = input.kind === "text" ? detectLanguage(text) : null;
  const language: HelperLanguage = detected ?? chat.language ?? "hi";
  const firstContact = chat.greetedAt === null && chat.lastTurnAt === null;
  const context: ReplyContext = { language, helperName: input.helperName, family, firstContact };
  const remember: ChatPatch = detected ? { language: detected } : {};
  const greeted: ChatPatch = firstContact ? { greetedAt: now.toISOString() } : {};
  const reply = (
    intent: string,
    route: TurnRoute,
    message: HelperMessage,
    chatPatch: ChatPatch = {},
    handoff: HandoffPlan | null = null,
  ): TurnPlan => ({ action: "reply", intent, route, language, message, chat: { ...remember, ...chatPatch }, handoff });

  if (family.children.length === 0) return { action: "skip", reason: "no_children" };

  if (input.kind === "voice") return reply("voice", "rule", voiceReply(context));
  if (input.kind === "media") return reply("media", "rule", mediaReply(context));

  const clearAwait: ChatPatch = { awaiting: null, awaitingUntil: null };

  if (input.kind === "tap") {
    const tap = input.tap;
    if (!tap) return { action: "skip", reason: "not_our_tap" };
    const scoped = tap.childKey ? childByKey(family, tap.childKey) : null;
    const children = scoped ? [scoped] : family.children;
    switch (tap.intent) {
      case "stop":
        return { action: "skip", reason: "stop" };
      case "message_teacher": {
        if (!scoped) return reply("menu", "tap", menuCard(context, false), clearAwait);
        if (!scoped.classTeacher) {
          return reply("office", "tap", officePrompt(context), { awaiting: "office", awaitingUntil: awaitUntil(now) });
        }
        return reply("message_teacher", "tap", teacherPrompt(context, scoped), { awaiting: `teacher:${scoped.key}`, awaitingUntil: awaitUntil(now) });
      }
      case "office":
        return reply("office", "tap", officePrompt(context), { awaiting: "office", awaitingUntil: awaitUntil(now) });
      case "greeting":
        return reply("menu", "tap", menuCard(context, true), { ...clearAwait, ...greeted });
      case "thanks":
        return reply("thanks", "tap", thanksReply(context), clearAwait);
      case "menu":
        return reply("menu", "tap", menuCard(context, false), clearAwait);
      case "fees":
      case "receipts":
      case "attendance":
      case "results":
      case "teacher":
        return reply(tap.intent, "tap", cardFor(tap.intent, context, children), { ...clearAwait, ...greeted });
    }
  }

  if (!text) return { action: "skip", reason: "empty" };

  const rule = ruleIntent(text);
  if (rule === "stop") return { action: "skip", reason: "stop" };

  // A one- or two-word ask ("fees", "हाज़िरी") while the helper waits is a
  // change of mind, not the message for the teacher.
  const newAsk = rule === "menu" || rule === "greeting" || rule === "thanks" || (rule !== null && text.split(/\s+/).length <= 2);
  if (isAwaiting(chat, now) && !newAsk && !CANCEL.test(text)) {
    const awaiting = chat.awaiting ?? "";
    const child = awaiting.startsWith("teacher:") ? childByKey(family, awaiting.slice("teacher:".length)) : null;
    const wanted: HandoffTarget = awaiting.startsWith("teacher:") ? "class_teacher" : "office";
    const topic = wanted === "class_teacher" ? "message_teacher" : "office";
    const handed = handoffReply(context, wanted, child, text, topic, now);
    return reply("handoff", "rule", handed.message, clearAwait, handed.handoff);
  }

  if (CANCEL.test(text) && isAwaiting(chat, now)) return reply("menu", "rule", menuCard(context, false), clearAwait);

  switch (rule) {
    case "greeting": {
      const message = firstContact || !greetedRecently(chat, now) ? welcomeCard({ ...context, firstContact: false }) : menuCard(context, true);
      return reply("greeting", "rule", message, { ...clearAwait, greetedAt: now.toISOString() });
    }
    case "menu":
      return reply("menu", "rule", menuCard(context, false), clearAwait);
    case "fees":
    case "receipts":
    case "attendance":
    case "results":
    case "teacher":
      return reply(rule, "rule", cardFor(rule, context), { ...clearAwait, ...greeted });
    case "office":
      return reply("office", "rule", officePrompt(context), { awaiting: "office", awaitingUntil: awaitUntil(now) });
    case "thanks":
      return reply("thanks", "rule", thanksReply(context), clearAwait);
    default:
      break;
  }

  if (input.aiAvailable) return { action: "ask_ai", language, firstContact, chat: { ...remember, ...greeted, ...clearAwait } };
  return reply("fallback", "fallback", fallbackReply(context), { ...clearAwait, ...greeted });
}
