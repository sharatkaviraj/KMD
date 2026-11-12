import "server-only";

import { getAssistSettings } from "@/modules/assist/data/settings";
import type { ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { handoffRegarding, planFromAnswer } from "@/modules/whatsapp/domain/helper-ai";
import { familyWords, lessonNoteFor, NO_KNOWLEDGE, type LessonNote, type SchoolKnowledge } from "@/modules/whatsapp/domain/helper-lessons";
import { helperMessageBody, plainVersion, type HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import {
  MAX_MESSAGE_AGE_MINUTES,
  MAX_TURNS_PER_NUMBER_PER_DAY,
  isLateHour,
  needsVisitCalendar,
  planTurn,
  practiceIdsFor,
  type ChatPatch,
  type ChatState,
  type HandoffPlan,
  type ReceiptSend,
  type TurnPlan,
  type TurnRoute,
} from "@/modules/whatsapp/domain/helper-plan";
import {
  fallbackReply,
  handoffFailedReply,
  ratingReply,
  type Family,
  type HandoffTarget,
  type RatingOutcome,
  type ReplyContext,
} from "@/modules/whatsapp/domain/helper-replies";
import { NOT_HELPED_TOPIC, isAcknowledgement } from "@/modules/whatsapp/domain/helper-handoff";
import { messageKind, readTap, type MessageKind, type RatingValue } from "@/modules/whatsapp/domain/helper-text";
import type { VisitCalendar } from "@/modules/whatsapp/domain/helper-visit";
import { schoolToday } from "@/platform/dates";
import { logInfo, logWarn } from "@/platform/observability/log";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { maskNumber } from "@/platform/whatsapp/numbers";
import { checkWhatsAppSend, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { HUB_CODES, providerFor, type ClaimResult, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readSwitches } from "@/platform/whatsapp/store";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

import { askHelperClaude, hasClaudeKey, type ClaudeTurn } from "./helper-claude";
import { noteLesson, readSchoolKnowledge } from "./helper-lessons";
import {
  deliverWaitingAnswers,
  handleStaffAnswer,
  liveRelayDeps,
  openHandoff,
  rateAnswer,
  type OpenHandoffInput,
  type RateResult,
} from "./helper-relay";
import { handleStaffCommand, liveStaffHelperDeps } from "./staff-helper";
import { prepareHelperReceipt, type ReceiptDocument, type ReceiptRequest } from "./helper-receipt";
import { readVisitCalendar, saveVisitEnquiry, type VisitRow } from "./helper-visit";
import { handleStaffLink, liveStaffLinkDeps } from "./staff-link";
import {
  finishTurn,
  insertHandoff,
  pickHandoffStaff,
  readBudget,
  readChat,
  readChildFacts,
  readHelperSettings,
  saveAbsenceNotes,
  saveChat,
  startTurn,
  type AbsenceRow,
  type HelperSettings,
  type TurnFinish,
} from "./helper-store";

/**
 * One message to the school's number, answered by Veer Patta AI (D-574).
 *
 * The hub forwards every message parents write; this decides, for each,
 * whether One answers it or leaves it to the hub's own bot. One answers only
 * when ALL of these hold, checked in this order, and stays quiet otherwise:
 *
 *  1. It is something the helper can read (text, a tap, a voice note, a
 *     photo), and it arrived in the last ten minutes.
 *     (Before the rest: a member of staff answering a hand-off by swiping on
 *     its alert, D-578, one linking their WhatsApp with a code, D-582, and
 *     one asking for their own day, questions or class with one word, D-591.
 *     None is a parent's message.)
 *  2. The number is one the helper knows. Step 1 knows exactly one: the
 *     owner's test number, standing for the practice children.
 *  3. The school's number may send this number a typed message right now
 *     (`checkWhatsAppSend`: the `parent_helper` switch, practice mode, the
 *     owner-only rule while real recipients are off).
 *  4. The family's records could be read, and there is a child in them.
 *  5. The number has had fewer than 40 answers today.
 *  6. The message is not already being answered (the ledger row's unique
 *     message id), and the hub gives it to One (`POST /v1/typing`). The hub
 *     says no when a person in the office is handling the chat, when the
 *     message is too old, or when its bot got there first.
 *
 * Only then is Claude asked (when the message needs it) and the reply sent.
 * Claude also reads the answers the school has written for every family, and
 * a general question nothing answers goes onto the list in One that an admin
 * answers once (D-589). A receipt the parent asks for goes as its PDF
 * (D-597), or, when it cannot be made or Meta refuses it, as the words that
 * say so.
 * Every step before the claim is free to give up: the hub's bot answers a few
 * seconds later as it always has. After the claim One must answer, so
 * everything after it ends in a message: Claude's, the card, or the menu.
 *
 * What the parent wrote is never stored here, except a hand-off, which is the
 * parent's message put in front of the school on purpose. The hub keeps the
 * conversation (`messages` in its own database), as it keeps every other.
 */

export type HelperOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "not_claimed"; reason: string }
  | { outcome: "answered"; route: TurnRoute; intent: string; handoff: HandoffTarget | null }
  | { outcome: "failed"; reason: string };

/** Everything the turn reads and writes, so a test can stand in for each. */
export type HelperDeps = {
  now: () => Date;
  readConfig: () => WhatsAppConfig;
  readSwitches: () => Promise<WhatsAppSwitches | null>;
  readSettings: () => Promise<HelperSettings | null>;
  readChildFacts: (studentIds: readonly string[]) => Promise<ChildFacts[] | null>;
  readChat: (from: string) => Promise<ChatState>;
  saveChat: (from: string, patch: ChatPatch, at: Date) => Promise<void>;
  readBudget: (from: string, now: Date) => Promise<{ spentUsd: number; turnsToday: number } | null>;
  /** The AI helper's switch and the school's monthly AI budget, or null when unreadable. */
  readAiSettings: () => Promise<{ enabled: boolean; monthlyBudgetUsd: number } | null>;
  hasClaudeKey: () => boolean;
  askClaude: typeof askHelperClaude;
  startTurn: typeof startTurn;
  finishTurn: (providerMessageId: string, finish: TurnFinish) => Promise<void>;
  /** Null when the provider cannot claim a message (only the hub can). */
  claim: ((wamid: string) => Promise<ClaimResult>) | null;
  send: (body: Record<string, unknown>) => Promise<ProviderSendResult>;
  pickHandoffStaff: (target: HandoffTarget, child: ChildFacts | null, sessionLabel: string) => Promise<string | null>;
  insertHandoff: typeof insertHandoff;
  /** Step 2 (D-578): a swiped reply to one of the helper's alerts, handled; null when the message is not one. */
  staffAnswer?: (message: WebhookInbound) => Promise<HelperOutcome | null>;
  /** Step 2: answers that waited for this parent to write again, sent now; how many went. */
  deliverWaiting?: (from: string) => Promise<number>;
  /** Step 2: the person a hand-off is for is told, now or at 6 am. */
  openHandoff?: (input: OpenHandoffInput) => Promise<unknown>;
  /** A member of staff linking their WhatsApp with the code One gave them (D-582); null when the message carries none. */
  staffLink?: (message: WebhookInbound) => Promise<HelperOutcome | null>;
  /** A linked member of staff asking for their day, their questions or their class (D-591); null when it is not that. */
  staffCommand?: (message: WebhookInbound) => Promise<HelperOutcome | null>;
  /** A tap on "Did this answer help?", kept against this number's own hand-offs (D-584). */
  rateAnswer?: (input: { from: string; key: string; value: RatingValue }) => Promise<RateResult>;
  /** A child the parent says will be away, kept for the register (D-588); true when kept. */
  saveAbsence?: (row: AbsenceRow) => Promise<boolean>;
  /** The school's answers and the questions it leaves to people, for this kind of chat (D-589); null when unreadable. */
  readKnowledge?: (practice: boolean) => Promise<SchoolKnowledge | null>;
  /** An answer's note on the "teach it once" list; the lesson it landed on, or null. */
  noteLesson?: (note: LessonNote, practice: boolean, topic: string | null) => Promise<string | null>;
  /** The calendar a school visit's days come from (D-592); null when unreadable. */
  readVisitCalendar?: (sessionLabel: string, today: string) => Promise<VisitCalendar | null>;
  /** A school visit, kept as an enquiry on the Admissions board (D-592); true when kept. */
  saveVisit?: (row: VisitRow) => Promise<boolean>;
  /** A receipt the parent asked for, as a PDF Meta fetches once (D-597); null when it could not be made. */
  prepareReceipt?: (request: ReceiptRequest) => Promise<ReceiptDocument | null>;
};

/** The real database, the real hub and the real Claude. */
export function liveHelperDeps(): HelperDeps {
  const config = readWhatsAppConfig();
  const provider = config.ok ? providerFor(config) : null;
  const claimMessage = provider?.claimMessage;
  const relay = liveRelayDeps();
  const link = liveStaffLinkDeps(config);
  const staff = liveStaffHelperDeps(config);
  return {
    now: () => new Date(),
    readConfig: () => config,
    readSwitches: () => readSwitches(),
    readSettings: () => readHelperSettings(),
    readChildFacts: (ids) => readChildFacts(ids),
    readChat: (from) => readChat(from),
    saveChat: (from, patch, at) => saveChat(from, patch, at),
    readBudget: (from, now) => readBudget(from, now),
    readAiSettings: async () => {
      try {
        const settings = await getAssistSettings();
        return { enabled: settings.enabled, monthlyBudgetUsd: settings.monthlyBudgetUsd };
      } catch {
        return null;
      }
    },
    hasClaudeKey,
    askClaude: askHelperClaude,
    startTurn: (row) => startTurn(row),
    finishTurn: (id, finish) => finishTurn(id, finish),
    claim: claimMessage ? (wamid) => claimMessage(wamid) : null,
    send: (body) =>
      provider
        ? provider.send(body)
        : Promise.resolve({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "WhatsApp is not set up here." }),
    pickHandoffStaff: (target, child, sessionLabel) => pickHandoffStaff(target, child, sessionLabel),
    insertHandoff: (row) => insertHandoff(row),
    staffAnswer: (message) => handleStaffAnswer(message, relay),
    deliverWaiting: (from) => deliverWaitingAnswers(from, relay),
    openHandoff: (input) => openHandoff(input, relay),
    staffLink: (message) => handleStaffLink(message, link),
    staffCommand: (message) => handleStaffCommand(message, staff),
    rateAnswer: (input) => rateAnswer(input, relay),
    saveAbsence: (row) => saveAbsenceNotes(row),
    readKnowledge: (practice) => readSchoolKnowledge(practice),
    noteLesson: (note, practice, topic) => noteLesson(note, practice, topic),
    readVisitCalendar: (sessionLabel, today) => readVisitCalendar(sessionLabel, today),
    saveVisit: (row) => saveVisitEnquiry(row),
    prepareReceipt: (request) => prepareHelperReceipt(request),
  };
}

const skip = (reason: string): HelperOutcome => ({ outcome: "skipped", reason });

/** Why the hub kept the message, in a word or two, for the ledger. */
function claimRefusal(claim: ClaimResult): string {
  if (!claim.ok) return `claim_failed:${claim.httpStatus ?? "network"}`;
  if (claim.staff) return "staff_handling";
  if (claim.stale) return "stale";
  return `taken_by:${claim.takenBy ?? "other"}`;
}

/** Meta may refuse an interactive message it would take as plain words; the hub's own refusals stand. */
function worthPlainRetry(result: ProviderSendResult, message: HelperMessage): boolean {
  if (result.outcome !== "rejected" || message.kind === "text") return false;
  const code = result.errorCode ?? "";
  return !(HUB_CODES as readonly string[]).includes(code) && code !== "bad_api_key";
}

type Reply = {
  message: HelperMessage;
  intent: string;
  route: TurnRoute;
  chat: ChatPatch;
  handoff: HandoffPlan | null;
  /** A receipt to send as its PDF (D-597). */
  receipt?: ReceiptSend | null;
};

type Composed = {
  reply: Reply;
  claude: ClaudeTurn | null;
  parentReplyId: string | null;
  handedTo: HandoffTarget | null;
  note: string | null;
  /** A "no" to an answer, written into Messages: the office's hand-off to open once the parent has been told (D-584). */
  followUp: OpenHandoffInput | null;
  /** What this answer adds to the "teach it once" list, written once the reply has gone (D-589). */
  lesson: LessonNote | null;
  /** When the message is a receipt's PDF (D-597): the words that say it could not be sent, for a refusal. */
  fallback: HelperMessage | null;
};

/** The reply, once the message is One's: Claude's answer or the planned card, and any hand-off written first. */
async function compose(input: {
  message: WebhookInbound;
  plan: Exclude<TurnPlan, { action: "skip" } | { action: "rate" }>;
  settings: HelperSettings;
  family: Family;
  children: ChildFacts[];
  context: ReplyContext;
  deps: HelperDeps;
  now: Date;
  sentAt: number;
  /** Read beside the family's records; awaited only when Claude is asked. */
  knowledge: Promise<SchoolKnowledge | null>;
}): Promise<Composed> {
  const { message, plan, settings, family, children, context, deps, now } = input;
  const text = (message.text ?? "").trim();
  let reply: Reply;
  let claude: ClaudeTurn | null = null;
  let note: string | null = null;
  let lesson: LessonNote | null = null;

  if (plan.action === "ask_ai") {
    const school = await input.knowledge;
    claude = await deps.askClaude({
      helperName: settings.helperName,
      family,
      text,
      language: plan.language,
      firstContact: plan.firstContact,
      now,
      knowledge: school ?? NO_KNOWLEDGE,
    });
    if (claude.answer) {
      // Nothing goes on the list when the school's answers could not be read: Claude did not see them.
      lesson = school ? lessonNoteFor(claude.answer, school, familyWords(children, message.fromName)) : null;
      const answered = planFromAnswer(claude.answer, { family, helperName: settings.helperName, text, now });
      reply = {
        message: answered.message,
        intent: answered.intent,
        route: claude.careful ? "ai_careful" : "ai",
        chat: { ...plan.chat, ...answered.chat },
        handoff: answered.handoff,
      };
    } else {
      reply = { message: fallbackReply(context), intent: "fallback", route: "fallback", chat: plan.chat, handoff: null };
      note = `ai_${claude.problem ?? "no_answer"}`;
    }
  } else {
    reply = { message: plan.message, intent: plan.intent, route: plan.route, chat: plan.chat, handoff: plan.handoff, receipt: plan.receipt ?? null };
  }

  // A hand-off goes into One's Messages inbox before the parent is told it has.
  let parentReplyId: string | null = null;
  let handedTo: HandoffTarget | null = null;
  if (reply.handoff) {
    const handoff = reply.handoff;
    const anchor = handoff.child ?? children[0];
    const staffId = await deps.pickHandoffStaff(handoff.target, handoff.child, anchor.sessionLabel).catch(() => null);
    parentReplyId = await deps.insertHandoff({
      sessionLabel: anchor.sessionLabel,
      fromName: message.fromName ?? "Parent",
      fromPhone: message.from,
      studentId: handoff.child?.studentId ?? null,
      studentLabel: handoff.child ? [handoff.child.firstName, handoff.child.className].filter(Boolean).join(" · ") : null,
      regarding: handoffRegarding(settings.helperName, handoff.topic, claude?.answer?.summary ?? handoff.summary ?? null, handoff.body),
      body: handoff.body,
      receivedAt: new Date(input.sentAt).toISOString(),
      assignedStaffId: staffId,
    });
    if (parentReplyId) handedTo = handoff.target;
    else {
      reply = { ...reply, message: handoffFailedReply({ ...context, firstContact: false }) };
      note = "handoff_not_saved";
    }
    // A child who will be away: the register shows it once the hand-off is in Messages (D-588).
    // The parent is told about the register only when the days were kept.
    const away = handoff.absence;
    if (parentReplyId && away && handoff.child) {
      const kept = deps.saveAbsence
        ? await deps
            .saveAbsence({
              studentId: handoff.child.studentId,
              sessionLabel: handoff.child.sessionLabel,
              days: away.days,
              reason: away.reason,
              parentReplyId,
              practice: family.practice,
            })
            .catch(() => false)
        : false;
      if (!kept) {
        reply = { ...reply, message: away.unsaved };
        note = "absence_not_saved";
      }
    }
    // A school visit: on the Admissions board once the office has it in Messages (D-592).
    // The parent was told the office has it, which stays true when the board could not take it.
    const visit = handoff.visit;
    if (parentReplyId && visit) {
      const kept = deps.saveVisit
        ? await deps
            .saveVisit({ sessionLabel: anchor.sessionLabel, booking: visit, parentName: message.fromName ?? null, fromE164: message.from, parentReplyId })
            .catch(() => false)
        : false;
      if (!kept) note = "visit_not_saved";
    }
  }

  // A receipt the parent asked for goes as its PDF; the planned words, which
  // say it could not be sent, go when it cannot be made (D-597).
  let fallback: HelperMessage | null = null;
  const asked = reply.receipt;
  if (asked) {
    const document = deps.prepareReceipt
      ? await deps
          .prepareReceipt({
            studentId: asked.child.studentId,
            sessionLabel: asked.child.sessionLabel,
            receiptNumber: asked.receipt.number,
            practice: family.practice,
          })
          .catch(() => null)
      : null;
    if (document) {
      fallback = reply.message;
      reply = { ...reply, message: { kind: "document", link: document.link, filename: document.filename, caption: asked.caption } };
    } else {
      note = "receipt_not_made";
    }
  }
  return { reply, claude, parentReplyId, handedTo, note, followUp: null, lesson, fallback };
}

/**
 * A tap on "Did this answer help?" (D-584). The tap is kept against the
 * number's own hand-off; a "no" is written into Messages for the school
 * office before the parent is told it has been passed on, with what they
 * asked and the answer that did not help, and the office is told once the
 * reply has gone. A tap that names none of this number's hand-offs changes
 * nothing: a yes is thanked, a no is shown the way to the office.
 */
async function composeRating(input: {
  message: WebhookInbound;
  plan: Extract<TurnPlan, { action: "rate" }>;
  settings: HelperSettings;
  context: ReplyContext;
  deps: HelperDeps;
  now: Date;
  sentAt: number;
}): Promise<Composed> {
  const { message, plan, settings, deps, now } = input;
  const unknown: RateResult = { outcome: "unknown" };
  const rated = deps.rateAnswer ? await deps.rateAnswer({ from: message.from, key: plan.key, value: plan.value }).catch(() => unknown) : unknown;
  // The reply in the language the question was asked in.
  const context: ReplyContext = rated.outcome === "unknown" ? input.context : { ...input.context, language: rated.handoff.language, firstContact: false };
  const reply = (outcome: RatingOutcome, intent: string): Reply => ({
    message: ratingReply(context, outcome, isLateHour(now)),
    intent,
    route: "tap",
    chat: plan.chat,
    handoff: null,
  });
  const none = { claude: null, parentReplyId: null, handedTo: null, note: null, followUp: null, lesson: null, fallback: null };
  switch (rated.outcome) {
    case "unknown":
      return { ...none, reply: reply(plan.value === "helped" ? "helped" : "ask_office", "rating_unknown") };
    case "helped":
      return { ...none, reply: reply("helped", "rated_helped") };
    case "already":
      return { ...none, reply: reply("already", "rating_already") };
    case "already_passed_on":
      return { ...none, reply: reply("already_passed_on", "rating_passed_already") };
    case "not_saved":
      return { ...none, reply: reply("not_passed_on", "rating_not_saved"), note: "rating_not_saved" };
    case "pass_on": {
      const first = rated.handoff;
      const staffId = await deps.pickHandoffStaff("office", null, first.sessionLabel).catch(() => null);
      const parentReplyId = await deps
        .insertHandoff({
          sessionLabel: first.sessionLabel,
          fromName: first.fromName,
          fromPhone: message.from,
          studentId: first.studentId,
          studentLabel: first.studentLabel,
          regarding: handoffRegarding(settings.helperName, "👎 answer did not help", first.body, rated.body),
          body: rated.body,
          receivedAt: new Date(input.sentAt).toISOString(),
          assignedStaffId: staffId,
        })
        .catch(() => null);
      if (!parentReplyId) return { ...none, reply: reply("not_passed_on", "rating_not_saved"), note: "handoff_not_saved" };
      return {
        ...none,
        reply: reply("passed_on", "rated_not_helped"),
        parentReplyId,
        handedTo: "office",
        followUp: {
          parentReplyId,
          parentE164: message.from,
          language: first.language,
          target: "office",
          topic: NOT_HELPED_TOPIC,
          child: null,
          aboutName: first.aboutName,
          followUpOf: first.id,
          sessionLabel: first.sessionLabel,
          fromName: first.fromName,
          practice: first.practice,
        },
      };
    }
  }
}

export async function runHelperTurn(message: WebhookInbound, deps: HelperDeps = liveHelperDeps()): Promise<HelperOutcome> {
  const started = deps.now();

  // 1. Something the helper can read, and still fresh.
  const kind: MessageKind = messageKind(message.type, message.raw);
  if (kind === "ignore") return skip("not_readable");
  const sentAt = Date.parse(message.at);
  if (!Number.isFinite(sentAt) || started.getTime() - sentAt > MAX_MESSAGE_AGE_MINUTES * 60_000) return skip("too_old");

  // 1a. A member of staff answering a hand-off, by swiping on the helper's alert (D-578).
  if (message.replyTo && deps.staffAnswer) {
    const answered = await deps.staffAnswer(message).catch(() => null);
    if (answered) return answered;
  }

  // 1b. A member of staff linking their WhatsApp with the code One gave them (D-582).
  if (deps.staffLink) {
    const linked = await deps.staffLink(message).catch(() => null);
    if (linked) return linked;
  }

  // 1c. A member of staff asking for their own day, questions or class, in one word (D-591).
  if (deps.staffCommand) {
    const handled = await deps.staffCommand(message).catch(() => null);
    if (handled) return handled;
  }

  // 2. A number the helper knows.
  const [switches, settings] = await Promise.all([deps.readSwitches(), deps.readSettings()]);
  if (!settings) return skip("settings_unreadable");
  const studentIds = practiceIdsFor(message.from, switches?.ownerTestNumber ?? null, settings.practiceStudentIds);
  if (!studentIds) return skip("unknown_number");

  // 3. The school's number may answer this number now. The parent wrote
  //    seconds ago, so the 24 hours are open; everything else is the policy's.
  const config = deps.readConfig();
  const verdict = checkWhatsAppSend({ feature: "parent_helper", to: message.from, switches, config, kind: "text", wroteInLast24h: true });
  if (verdict.decision === "dry_run") return skip("practice_mode");
  if (verdict.decision === "refuse") return skip(verdict.code);
  if (!deps.claim) return skip("cannot_claim");

  // Step 1 knows only the practice family: the owner's number standing for TEST children.
  const practice = true;
  // The school's answers, read beside the family and waited for only if Claude is asked (D-589).
  const knowledge = deps.readKnowledge ? deps.readKnowledge(practice).catch(() => null) : Promise.resolve(null);

  // 4 and 5. The family, the chat so far, today's answers and the AI budget.
  const [children, chat, budget, ai] = await Promise.all([
    deps.readChildFacts(studentIds),
    deps.readChat(message.from),
    deps.readBudget(message.from, started),
    deps.readAiSettings(),
  ]);
  if (!children) return skip("facts_unreadable");
  if (children.length === 0) return skip("no_children");
  if (!budget) return skip("budget_unreadable");
  if (budget.turnsToday >= MAX_TURNS_PER_NUMBER_PER_DAY) return skip("daily_cap");

  const family: Family = { children, practice };
  const aiAvailable = deps.hasClaudeKey() && ai !== null && ai.enabled && budget.spentUsd < ai.monthlyBudgetUsd;
  const tap = kind === "tap" ? readTap(message.raw) : null;
  // A school visit's days come from the family's own session's calendar (D-592), read only when they may be shown.
  const visit =
    needsVisitCalendar({ kind, text: message.text, tap }) && deps.readVisitCalendar
      ? await deps.readVisitCalendar(children[0].sessionLabel, schoolToday(started)).catch(() => null)
      : null;
  const plan = planTurn({ kind, text: message.text, tap, chat, family, helperName: settings.helperName, now: started, aiAvailable, visit });
  if (plan.action === "skip") return skip(plan.reason);

  // 6. Not answered already, and the hub gives it to One.
  const ledger = await deps.startTurn({
    providerMessageId: message.providerMessageId,
    from: message.from,
    receivedAt: new Date(sentAt).toISOString(),
    kind: kind as Exclude<MessageKind, "ignore">,
    practice: family.practice,
  });
  if (ledger === "duplicate") return skip("duplicate");
  if (ledger === "failed") return skip("ledger_failed");

  const claim = await deps.claim(message.providerMessageId);
  if (!claim.ok || !claim.claimed) {
    const reason = claimRefusal(claim);
    await deps.finishTurn(message.providerMessageId, { status: "not_claimed", reason });
    return { outcome: "not_claimed", reason };
  }

  // One answers from here on, whatever happens: Claude's words, a card or the menu.
  // Answers that waited for this parent to write again go first; a bare "ok" needs nothing more (D-578).
  const delivered = deps.deliverWaiting ? await deps.deliverWaiting(message.from).catch(() => 0) : 0;
  if (delivered > 0 && kind === "text" && isAcknowledgement(message.text)) {
    const finished = deps.now();
    await deps.finishTurn(message.providerMessageId, {
      status: "answered",
      intent: "answer_delivered",
      route: "rule",
      latencyMs: finished.getTime() - sentAt,
    });
    await deps.saveChat(message.from, {}, finished).catch(() => undefined);
    return { outcome: "answered", route: "rule", intent: "answer_delivered", handoff: null };
  }

  const firstContact = plan.action === "ask_ai" ? plan.firstContact : false;
  const context: ReplyContext = { language: plan.language, helperName: settings.helperName, family, firstContact };
  let composed: Composed;
  try {
    composed =
      plan.action === "rate"
        ? await composeRating({ message, plan, settings, context, deps, now: started, sentAt })
        : await compose({ message, plan, settings, family, children, context, deps, now: started, sentAt, knowledge });
  } catch (caught) {
    logWarn("whatsapp.helper.compose_crashed", { error: caught instanceof Error ? caught.message : "unknown" });
    composed = {
      reply: { message: fallbackReply(context), intent: "fallback", route: "fallback", chat: plan.chat, handoff: null },
      claude: null,
      parentReplyId: null,
      handedTo: null,
      note: "compose_crashed",
      followUp: null,
      lesson: null,
      fallback: null,
    };
  }
  const { reply, claude, parentReplyId, handedTo } = composed;
  let note = composed.note;

  let sent = await deps.send(helperMessageBody(message.from, reply.message));
  if (worthPlainRetry(sent, reply.message)) {
    // A refused PDF goes as the words that say it could not be sent (D-597), never as a caption promising a file.
    const document = reply.message.kind === "document";
    const retry = document && composed.fallback ? composed.fallback : plainVersion(reply.message);
    sent = await deps.send(helperMessageBody(message.from, retry));
    if (document && worthPlainRetry(sent, retry)) sent = await deps.send(helperMessageBody(message.from, plainVersion(retry)));
    note = note ?? (document ? "receipt_refused" : "sent_as_plain_text");
  }

  const finished = deps.now();
  const latencyMs = finished.getTime() - sentAt;
  const common: TurnFinish = {
    status: "answered",
    intent: reply.intent,
    route: reply.route,
    model: claude?.model ?? null,
    costUsd: claude?.costUsd ?? 0,
    handoff: handedTo,
    parentReplyId,
    latencyMs,
  };

  if (sent.outcome !== "accepted") {
    const reason = sent.outcome === "unknown" ? `send_unknown:${sent.errorCode}` : `send_rejected:${sent.errorCode ?? sent.httpStatus}`;
    await deps.finishTurn(message.providerMessageId, { ...common, status: "failed", reason });
    return { outcome: "failed", reason };
  }

  // The list learns from an answer that reached the parent: a school answer used, or a question it could not answer (D-589).
  const lesson = composed.lesson;
  const lessonId = lesson && deps.noteLesson ? await deps.noteLesson(lesson, family.practice, claude?.answer?.topic ?? null).catch(() => null) : null;
  await deps.finishTurn(message.providerMessageId, {
    ...common,
    reason: note,
    replyMessageId: sent.messageId,
    ...(lessonId && lesson ? { lessonId, lessonRole: lesson.role } : {}),
  });
  await deps.saveChat(message.from, reply.chat, finished).catch(() => undefined);

  // The parent knows it was passed on; now the person it is for is told (D-578).
  if (parentReplyId && handedTo && reply.handoff && deps.openHandoff) {
    const anchor = reply.handoff.child ?? children[0];
    await deps
      .openHandoff({
        parentReplyId,
        parentE164: message.from,
        language: plan.language,
        target: handedTo,
        topic: reply.handoff.topic,
        child: reply.handoff.child,
        sessionLabel: anchor.sessionLabel,
        fromName: message.fromName ?? "Parent",
        practice: family.practice,
      })
      .catch(() => undefined);
  }
  // A "no" to an answer: the office is told the same way (D-584).
  if (composed.followUp && deps.openHandoff) await deps.openHandoff(composed.followUp).catch(() => undefined);
  return { outcome: "answered", route: reply.route, intent: reply.intent, handoff: handedTo };
}

/**
 * Every message in one webhook delivery, side by side: each has only a few
 * seconds to be claimed before the hub's bot answers it. A failure in one
 * never stops another, and nothing about a parent's words reaches the logs.
 */
export async function runHelperTurns(messages: readonly WebhookInbound[], deps?: HelperDeps): Promise<HelperOutcome[]> {
  if (messages.length === 0) return [];
  const shared = deps ?? liveHelperDeps();
  return Promise.all(
    messages.map(async (message) => {
      try {
        const outcome = await runHelperTurn(message, shared);
        if (outcome.outcome === "failed") logWarn("whatsapp.helper.turn_failed", { ...outcome, from: maskNumber(message.from) });
        else if (outcome.outcome !== "skipped" || outcome.reason !== "unknown_number") {
          logInfo("whatsapp.helper.turn", { ...outcome, from: maskNumber(message.from) });
        }
        return outcome;
      } catch (caught) {
        logWarn("whatsapp.helper.turn_crashed", { error: caught instanceof Error ? caught.message : "unknown", from: maskNumber(message.from) });
        return { outcome: "failed" as const, reason: "crashed" };
      }
    }),
  );
}
