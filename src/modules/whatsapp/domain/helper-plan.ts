import { schoolToday } from "@/platform/dates";
import { sameNumber } from "@/platform/whatsapp/numbers";

import type { AbsenceNote } from "./helper-absence";
import { istHour, receiptByKey, sendableReceipts, type ChildFacts, type ChildReceipt, type ReceiptFact } from "./helper-facts";
import type { HelperMessage } from "./helper-messages";
import {
  cardFor,
  fallbackReply,
  handoffAck,
  mediaReply,
  menuCard,
  officePrompt,
  receiptCaption,
  receiptPickList,
  receiptsCard,
  receiptUnsentReply,
  teacherPrompt,
  thanksReply,
  voiceReply,
  welcomeCard,
  type Family,
  type HandoffTarget,
  type ReplyContext,
} from "./helper-replies";
import { detectLanguage, looksLikeQuestion, ruleIntent, type HelperLanguage, type HelperTap, type MessageKind, type RatingValue } from "./helper-text";
import {
  awaitingVisit,
  canVisitOn,
  dayFromKey,
  readSlotKey,
  readVisitChild,
  visitAwaiting,
  visitBookedReply,
  visitClosedReply,
  visitDays,
  visitDaysReply,
  visitDetailsPrompt,
  visitHandoffBody,
  visitPartReply,
  visitSummary,
  type VisitBooking,
  type VisitCalendar,
} from "./helper-visit";

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
 *  - A tap on "Did this answer help?" (D-584) is a rating: the data layer
 *    finds which of this number's hand-offs it names, and keeps it.
 *  - "admission" books a school visit (D-592): a day, morning or afternoon,
 *    then the child's name and class, typed, and the office is told.
 *  - "receipt bhejo", or "📄 Send receipt" on the receipts card, sends the
 *    receipt itself as a PDF (D-597): at once when there is one, from a list
 *    when there are several, and only ever one of this family's own.
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
  /** "teacher:<child key>", "office", or "visit:<slot>" (D-592): what the next typed message is for. */
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
  /**
   * The child will be away (D-588): the days for the register, kept once the
   * hand-off is, and the reply to send instead when they could not be kept.
   */
  absence?: (AbsenceNote & { unsaved: HelperMessage }) | null;
  /** One English line for Messages' list, when the plan has one; Claude's summary otherwise. */
  summary?: string | null;
  /** A school visit (D-592): kept on the Admissions board once the hand-off is in Messages. */
  visit?: VisitBooking | null;
};

/** How a reply was decided: a rule, a tap, Claude (quick or careful), or the menu when nothing else could. */
export type TurnRoute = "rule" | "tap" | "ai" | "ai_careful" | "fallback";

/**
 * A receipt the parent asked for (D-597). The data layer makes its PDF and
 * sends it with `caption`; the reply's own message, which says the PDF could
 * not be sent, goes instead when it cannot.
 */
export type ReceiptSend = { child: ChildFacts; receipt: ReceiptFact; caption: string };

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
      /** A receipt to send as its PDF (D-597); `message` is what goes when it cannot be. */
      receipt?: ReceiptSend | null;
    }
  | { action: "ask_ai"; language: HelperLanguage; firstContact: boolean; chat: ChatPatch }
  /** A tap on "Did this answer help?": `key` names the hand-off (`ratingKey`), among this number's own only. */
  | { action: "rate"; value: RatingValue; key: string; language: HelperLanguage; chat: ChatPatch };

export type PlanInput = {
  kind: MessageKind;
  text: string | null;
  tap: HelperTap | null;
  chat: ChatState;
  family: Family;
  helperName: string;
  now: Date;
  aiAvailable: boolean;
  /**
   * The school's calendar for a visit's days (D-592), read only when
   * `needsVisitCalendar` says this message may need it; null when it was
   * not read or could not be.
   */
  visit?: VisitCalendar | null;
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

/**
 * The plan for a message the helper has decided to put in front of the
 * school. With `absence` (a child the parent says will be away, D-588) and a
 * child to keep it for, the reply says which register shows it; the reply
 * without that line goes instead when the note could not be kept.
 */
export function handoffReply(
  context: ReplyContext,
  wanted: HandoffTarget,
  child: ChildFacts | null,
  body: string,
  topic: string,
  now: Date,
  aiReply?: string | null,
  absence?: AbsenceNote | null,
): { message: HelperMessage; handoff: HandoffPlan } {
  const settled = settleHandoff(wanted, child);
  const detail = {
    child: settled.child,
    teacherName: settled.target === "class_teacher" ? settled.child?.classTeacher?.name ?? null : null,
    lateHour: isLateHour(now),
    aiReply: aiReply ?? null,
  };
  const message = handoffAck(context, settled.target, detail);
  if (!absence || !settled.child) return { message, handoff: { target: settled.target, child: settled.child, body, topic } };
  return {
    message: handoffAck(context, settled.target, { ...detail, absence }),
    handoff: { target: settled.target, child: settled.child, body, topic, absence: { ...absence, unsaved: message } },
  };
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

/**
 * Whether the turn may show the days a visit can be booked for, so the data
 * layer reads the calendar for it and for nothing else (D-592).
 */
export function needsVisitCalendar(input: Pick<PlanInput, "kind" | "text" | "tap">): boolean {
  if (input.kind === "tap") return input.tap?.intent === "visit" || input.tap?.intent === "visit_day" || input.tap?.intent === "visit_part";
  return input.kind === "text" && ruleIntent(input.text) === "visit";
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
    receipt: ReceiptSend | null = null,
  ): TurnPlan => ({ action: "reply", intent, route, language, message, chat: { ...remember, ...chatPatch }, handoff, ...(receipt ? { receipt } : {}) });

  if (family.children.length === 0) return { action: "skip", reason: "no_children" };

  if (input.kind === "voice") return reply("voice", "rule", voiceReply(context));
  if (input.kind === "media") return reply("media", "rule", mediaReply(context));

  const clearAwait: ChatPatch = { awaiting: null, awaitingUntil: null };
  const today = schoolToday(now);
  const route: TurnRoute = input.kind === "tap" ? "tap" : "rule";

  /** One receipt, as its PDF (D-597); the words for when it cannot be sent are the message. */
  const receiptSend = ({ child, receipt }: ChildReceipt): TurnPlan =>
    reply("receipt_send", route, receiptUnsentReply(context, child, receipt), { ...clearAwait, ...greeted }, null, {
      child,
      receipt,
      caption: receiptCaption(context, child, receipt),
    });

  /**
   * "Send receipt", typed or tapped (D-597): the one receipt at once, a list
   * to pick from when there are several, and the receipts card, which says
   * there are none, when there is nothing to send. `gone` is a tap on a
   * receipt no longer there: never another receipt in its place, the list.
   */
  const receiptStart = (children: readonly ChildFacts[], gone = false): TurnPlan => {
    const sendable = sendableReceipts(children);
    if (sendable.length === 0) return reply("receipts", route, receiptsCard(context, children), { ...clearAwait, ...greeted });
    if (sendable.length === 1 && !gone) return receiptSend(sendable[0]);
    return reply("receipt_pick", route, receiptPickList(context, children, gone), { ...clearAwait, ...greeted });
  };

  /** The days to pick from, or why there are none (D-592). */
  const visitStart = (gone = false): TurnPlan => {
    if (!input.visit) return reply("visit_closed", route, visitClosedReply(context, "unreadable"), clearAwait);
    const days = visitDays(input.visit);
    if (days.length === 0) return reply("visit_closed", route, visitClosedReply(context, "closed"), clearAwait);
    return reply("visit", route, visitDaysReply(context, days, today, gone), { ...clearAwait, ...greeted });
  };

  if (input.kind === "tap") {
    const tap = input.tap;
    if (!tap) return { action: "skip", reason: "not_our_tap" };
    const scoped = tap.key ? childByKey(family, tap.key) : null;
    const children = scoped ? [scoped] : family.children;
    switch (tap.intent) {
      case "stop":
        return { action: "skip", reason: "stop" };
      case "helped":
      case "not_helped":
        if (!tap.key) return { action: "skip", reason: "not_our_tap" };
        return { action: "rate", value: tap.intent, key: tap.key, language, chat: { ...remember, ...clearAwait } };
      case "message_teacher": {
        if (!scoped) return reply("menu", "tap", menuCard(context, false), clearAwait);
        if (!scoped.classTeacher) {
          return reply("office", "tap", officePrompt(context), { awaiting: "office", awaitingUntil: awaitUntil(now) });
        }
        return reply("message_teacher", "tap", teacherPrompt(context, scoped), { awaiting: `teacher:${scoped.key}`, awaitingUntil: awaitUntil(now) });
      }
      case "office":
        return reply("office", "tap", officePrompt(context), { awaiting: "office", awaitingUntil: awaitUntil(now) });
      case "visit":
        return visitStart();
      case "visit_day": {
        const day = dayFromKey(tap.key);
        if (!input.visit || !day || !canVisitOn(day, input.visit)) return visitStart(Boolean(input.visit));
        return reply("visit_day", "tap", visitPartReply(context, day, today), clearAwait);
      }
      case "visit_part": {
        const slot = readSlotKey(tap.key);
        if (!input.visit || !slot || !canVisitOn(slot.day, input.visit)) return visitStart(Boolean(input.visit));
        return reply("visit_part", "tap", visitDetailsPrompt(context, slot, today), { awaiting: visitAwaiting(slot), awaitingUntil: awaitUntil(now) });
      }
      case "receipt_send":
        return receiptStart(children);
      case "receipt_pdf": {
        // Only ever one of this family's own receipts, read afresh for this message.
        const found = receiptByKey(family.children, tap.key);
        return found ? receiptSend(found) : receiptStart(family.children, true);
      }
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

  // The child's name and class for a visit (D-592). A change of mind, or a
  // question with no class in it, is answered below instead, and the wait ends.
  const slot = isAwaiting(chat, now) ? awaitingVisit(chat.awaiting) : null;
  if (slot) {
    if (CANCEL.test(text)) return reply("menu", "rule", menuCard(context, false), clearAwait);
    // "ok", "accha", 👍: still waiting for the name and class, so ask once more.
    if (rule === "thanks") return reply("visit_part", "rule", visitDetailsPrompt(context, slot, today), { awaiting: visitAwaiting(slot), awaitingUntil: awaitUntil(now) });
    const child = readVisitChild(text);
    const given = child.childName !== null || child.classLabel !== null;
    // A short ask ("fees", "menu") is a change of mind; a line that names a
    // class is the answer, whatever else it matches ("अंकित 5", "Mark 5th").
    const changeOfMind = rule === "visit" ? !given : newAsk && child.classLabel === null;
    if (!changeOfMind && !(child.classLabel === null && looksLikeQuestion(text))) {
      const booking: VisitBooking = { ...slot, ...child };
      const handoff: HandoffPlan = {
        target: "office",
        child: null,
        body: visitHandoffBody(booking, text, today),
        topic: "visit",
        summary: visitSummary(booking, today),
        visit: booking,
      };
      return reply("visit_booked", "rule", visitBookedReply(context, booking, today, isLateHour(now)), clearAwait, handoff);
    }
  }

  if (isAwaiting(chat, now) && !slot && !newAsk && !CANCEL.test(text)) {
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
    case "receipt_send":
      return receiptStart(family.children);
    case "office":
      return reply("office", "rule", officePrompt(context), { awaiting: "office", awaitingUntil: awaitUntil(now) });
    case "visit":
      return visitStart();
    case "thanks":
      return reply("thanks", "rule", thanksReply(context), clearAwait);
    default:
      break;
  }

  if (input.aiAvailable) return { action: "ask_ai", language, firstContact, chat: { ...remember, ...greeted, ...clearAwait } };
  return reply("fallback", "fallback", fallbackReply(context), { ...clearAwait, ...greeted });
}
