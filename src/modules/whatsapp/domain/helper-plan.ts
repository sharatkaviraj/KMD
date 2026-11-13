import { schoolToday } from "@/platform/dates";
import { sameNumber } from "@/platform/whatsapp/numbers";

import type { AbsenceNote } from "./helper-absence";
import { istHour, receiptByKey, sendableReceipts, type ChildFacts, type ChildReceipt, type ReceiptFact } from "./helper-facts";
import type { HelperMessage } from "./helper-messages";
import type { ChangeRequest } from "./parent-suggestions";
import {
  aiAnswer,
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
 *    receipt itself as a PDF (D-597), only ever one of this family's own.
 *    Asked in words, it goes at once: the latest day's, or the one Claude
 *    read from the parent's words (D-606). A tap on the card's button with
 *    several to send offers them to pick from, one tap each.
 */

/** How long the helper waits for the message it asked for. */
export const AWAIT_MINUTES = 30;
/** A hello more than this long after the last one gets the whole welcome again. */
export const GREETING_GAP_HOURS = 12;
/** Teachers and the office are alerted only between these hours, in India (the owner, 12 Nov 2026). */
export const ALERT_HOURS = { from: 6, to: 21 } as const;
/** Answers to one number in one day; past it, the office and the hub's own bot take over. */
export const MAX_TURNS_PER_NUMBER_PER_DAY = 40;
/**
 * The owner's test number tries every side of the helper, as a parent and
 * as each role (D-607), so it has more answers a day before the cap.
 */
export const OWNER_TURNS_PER_DAY = 200;

/** Today's cap for a number: the owner's test number's, or everybody's. */
export function dailyTurnCap(owner: boolean): number {
  return owner ? OWNER_TURNS_PER_DAY : MAX_TURNS_PER_NUMBER_PER_DAY;
}
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
   * The child will be away (D-588): the days, put in front of the class
   * teacher once the hand-off is (D-598), and the reply to send instead when
   * they could not be.
   */
  absence?: (AbsenceNote & { unsaved: HelperMessage }) | null;
  /** One English line for Messages' list, when the plan has one; Claude's summary otherwise. */
  summary?: string | null;
  /** A school visit (D-592): put in front of the office for the Admissions board once the hand-off is in Messages (D-598). */
  visit?: VisitBooking | null;
  /**
   * A detail the parent asks the school to change (D-598): put in front of
   * the office to check, and the reply to send instead when it could not be.
   */
  change?: (ChangeRequest & { unsaved: HelperMessage }) | null;
};

/** How a reply was decided: a rule, a tap, Claude (quick or careful), or the menu when nothing else could. */
export type TurnRoute = "rule" | "tap" | "ai" | "ai_careful" | "fallback";

/**
 * A receipt the parent asked for (D-597). The data layer makes its PDF and
 * sends it with `caption`; `unsent`, which says the PDF could not be sent and
 * offers to try again, goes in its place when it cannot be.
 */
export type ReceiptSend = { child: ChildFacts; receipt: ReceiptFact; caption: string; unsent: HelperMessage };

/** The most receipts one ask sends (D-606): one family's payment on one day is rarely more. */
export const MAX_RECEIPTS_PER_ASK = 3;

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
      /**
       * Receipts to send as their PDFs (D-597), one after another (D-606).
       * `message` is the first one's `unsent`, for when its PDF cannot be made.
       */
      receipts?: ReceiptSend[] | null;
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
 * school. With `absence` (a child the parent says will be away, D-588) or
 * `change` (a detail to change, D-598) and a child to keep it for, the reply
 * says what happens once a person has checked it; the reply without that
 * line goes instead when it could not be kept.
 */
export function handoffReply(
  context: ReplyContext,
  wanted: HandoffTarget,
  child: ChildFacts | null,
  body: string,
  topic: string,
  now: Date,
  aiReply?: string | null,
  extra: { absence?: AbsenceNote | null; change?: ChangeRequest | null } = {},
): { message: HelperMessage; handoff: HandoffPlan } {
  const settled = settleHandoff(wanted, child);
  const detail = {
    child: settled.child,
    teacherName: settled.target === "class_teacher" ? settled.child?.classTeacher?.name ?? null : null,
    lateHour: isLateHour(now),
    aiReply: aiReply ?? null,
  };
  const message = handoffAck(context, settled.target, detail);
  const plan: HandoffPlan = { target: settled.target, child: settled.child, body, topic };
  if (!settled.child) return { message, handoff: plan };
  if (extra.absence) {
    return {
      message: handoffAck(context, settled.target, { ...detail, absence: extra.absence }),
      handoff: { ...plan, absence: { ...extra.absence, unsaved: message } },
    };
  }
  if (extra.change) {
    return {
      message: handoffAck(context, settled.target, { ...detail, change: extra.change }),
      handoff: { ...plan, change: { ...extra.change, unsaved: message } },
    };
  }
  return { message, handoff: plan };
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

/**
 * Why there is nothing to answer in this message, whoever the family is, or
 * null when there is something (D-605). It reads the message alone, so the
 * turn asks it BEFORE the hub is asked for the message: from the claim on,
 * One must answer, and a STOP, an empty message or a tap that is not the
 * helper's must still go to the hub's bot as before. These are exactly
 * `planTurn`'s own skips apart from a family with no child, which needs the
 * records; `planTurn` asks this first, so the two cannot drift apart.
 */
export function messageSkip(input: Pick<PlanInput, "kind" | "text" | "tap">): string | null {
  if (input.kind === "tap") {
    const tap = input.tap;
    if (!tap) return "not_our_tap";
    if (tap.intent === "stop") return "stop";
    if ((tap.intent === "helped" || tap.intent === "not_helped") && !tap.key) return "not_our_tap";
    return null;
  }
  if (input.kind !== "text") return null;
  const text = (input.text ?? "").trim();
  if (!text) return "empty";
  return ruleIntent(text) === "stop" ? "stop" : null;
}

/**
 * One receipt as it goes (D-597): its caption, and the words that go in its
 * place when its PDF cannot be. Only the first of several says who the
 * helper is.
 */
export function receiptToSend(
  context: ReplyContext,
  { child, receipt }: ChildReceipt,
  extra: { words?: string | null; another?: ChildReceipt | null; first?: boolean } = {},
): ReceiptSend {
  const own = extra.first === false ? { ...context, firstContact: false } : context;
  return {
    child,
    receipt,
    caption: receiptCaption(own, child, receipt, { words: extra.words, another: extra.another }),
    unsent: receiptUnsentReply(own, child, receipt),
  };
}

function receiptNumberKey(number: string): string {
  return number.replace(/\s+/g, "").toUpperCase();
}

/**
 * A receipt asked for in words (D-606), sent at once as its PDF, never a
 * button to press first. `wanted` are the receipt numbers Claude read from
 * the parent's words ("the July one", "₹6,000 wali"), found among this
 * family's own receipts only. With none, the latest day's among `children`:
 * what "receipt bhejo" means, and two children paid for together are two
 * receipts of that day. At most three either way. A reversed receipt is
 * never sent. The last caption says how to ask for another, when there is
 * one. `words` are Claude's, put above the first.
 *
 * With nothing to send, the receipts card, which says there is none; with a
 * receipt named that is not there (reversed since, or never this family's),
 * the receipts to pick from, saying so.
 */
export function receiptAsk(
  context: ReplyContext,
  children: readonly ChildFacts[] = context.family.children,
  wanted: readonly string[] = [],
  words: string | null = null,
): { intent: "receipt_send" | "receipt_pick" | "receipts"; message: HelperMessage; receipts: ReceiptSend[] } {
  const sendable = sendableReceipts(children);
  const own = sendableReceipts(context.family.children);
  const asked = new Set(wanted.map(receiptNumberKey).filter(Boolean));
  if (own.length === 0 || (asked.size === 0 && sendable.length === 0)) {
    const card = receiptsCard(context, children);
    return { intent: "receipts", message: words ? aiAnswer(context, words, card) : card, receipts: [] };
  }
  let picked: ChildReceipt[];
  if (asked.size > 0) {
    picked = own.filter(({ receipt }) => asked.has(receiptNumberKey(receipt.number))).slice(0, MAX_RECEIPTS_PER_ASK);
    if (picked.length === 0) return { intent: "receipt_pick", message: receiptPickList(context, context.family.children, true), receipts: [] };
  } else {
    const latest = sendable[0].receipt.date;
    picked = sendable.filter(({ receipt }) => receipt.date === latest).slice(0, MAX_RECEIPTS_PER_ASK);
  }
  const another = asked.size === 0 ? (sendable.find((item) => !picked.includes(item)) ?? null) : null;
  const receipts = picked.map((item, index) =>
    receiptToSend(context, item, {
      words: index === 0 ? words : null,
      another: index === picked.length - 1 ? another : null,
      first: index === 0,
    }),
  );
  return { intent: "receipt_send", message: receipts[0].unsent, receipts };
}

export function planTurn(input: PlanInput): TurnPlan {
  const { chat, family, now } = input;
  const nothing = family.children.length > 0 ? messageSkip(input) : null;
  if (nothing) return { action: "skip", reason: nothing };
  const text = (input.text ?? "").trim();
  // A message that does not show its language keeps the chat's (D-606).
  const detected = input.kind === "text" ? detectLanguage(text, chat.language) : null;
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
    receipts: ReceiptSend[] = [],
  ): TurnPlan => ({ action: "reply", intent, route, language, message, chat: { ...remember, ...chatPatch }, handoff, ...(receipts.length > 0 ? { receipts } : {}) });

  if (family.children.length === 0) return { action: "skip", reason: "no_children" };

  if (input.kind === "voice") return reply("voice", "rule", voiceReply(context));
  if (input.kind === "media") return reply("media", "rule", mediaReply(context));

  const clearAwait: ChatPatch = { awaiting: null, awaitingUntil: null };
  const today = schoolToday(now);
  const route: TurnRoute = input.kind === "tap" ? "tap" : "rule";

  /** One receipt, as its PDF (D-597); the words for when it cannot be sent are the message. */
  const receiptSend = (item: ChildReceipt): TurnPlan => {
    const sending = receiptToSend(context, item);
    return reply("receipt_send", route, sending.unsent, { ...clearAwait, ...greeted }, null, [sending]);
  };

  /**
   * "📄 Send receipt" tapped on the receipts card (D-597): the one receipt at
   * once, the receipts to pick from when there are several, and the receipts
   * card, which says there are none, when there is nothing to send. `gone` is
   * a tap on a receipt no longer there: never another receipt in its place,
   * the list. Typed, the ask is `receiptAsk`'s (D-606).
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
    case "receipt_send": {
      // Asked in words, the receipt comes at once: no button to press first (D-606).
      const asked = receiptAsk(context);
      return reply(asked.intent, route, asked.message, { ...clearAwait, ...greeted }, null, asked.receipts);
    }
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
  // Without Claude, a receipt asked for by its date, month or amount ("26 Jul
  // wali receipt") gets the receipts card to pick it from, not the menu (D-606).
  const unaided = ruleIntent(text, { claude: false });
  if (unaided === "receipts" || unaided === "receipt_send") return reply("receipts", "rule", cardFor("receipts", context), { ...clearAwait, ...greeted });
  return reply("fallback", "fallback", fallbackReply(context), { ...clearAwait, ...greeted });
}
