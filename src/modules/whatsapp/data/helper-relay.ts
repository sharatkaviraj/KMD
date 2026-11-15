import "server-only";

import { handoffChildren, liveChatHandoffDeps, openChatForHandoff, type HandoffChatInput } from "@/modules/chats/data/handoff";
import { answerHandoffInChat, liveChatSendDeps, type SendOutcome } from "@/modules/chats/data/send";
import type { ChatInboundMessage } from "@/modules/chats/domain/inbound";
import type { ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import {
  answererFor,
  answerReadyParams,
  canPassUp,
  followUpBody,
  isComplaint,
  nextAlertMoment,
  nextStep,
  parentAnswerText,
  ratingKey,
  staffAlertParams,
  staffAlertText,
  staffConfirmText,
  templateLanguage,
  windowOpen,
  type AlertKind,
  type AlertWords,
  type Answerer,
  type HandoffAction,
  type HandoffState,
  type RelayResult,
} from "@/modules/whatsapp/domain/helper-handoff";
import {
  awayLine,
  awayNoteMessage,
  awayNoteParams,
  inLanguage,
  noteButtonPayloads,
  noteConfirmText,
  readNoteTap,
  type NoteChoice,
  type NoteResult,
  type NoteTap,
} from "@/modules/whatsapp/domain/helper-away-note";
import { ANSWER_READY_TEMPLATE, AWAY_NOTE_TEMPLATE, HELPER_TEMPLATE_PARAMS, STAFF_ALERT_TEMPLATE } from "@/modules/whatsapp/domain/helper-hub-templates";
import { helperMessageBody } from "@/modules/whatsapp/domain/helper-messages";
import { MAX_MESSAGE_AGE_MINUTES, type ChatPatch, type ChatState } from "@/modules/whatsapp/domain/helper-plan";
import { ratingQuestion, type HandoffTarget } from "@/modules/whatsapp/domain/helper-replies";
import { messageKind, type HelperLanguage, type MessageKind, type RatingValue } from "@/modules/whatsapp/domain/helper-text";
import { daysLabel, decidedLabel } from "@/modules/whatsapp/domain/parent-suggestions";
import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { schoolToday } from "@/platform/dates";
import { logInfo, logWarn } from "@/platform/observability/log";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { maskNumber, toE164 } from "@/platform/whatsapp/numbers";
import { templateMessageBody, textMessageBody } from "@/platform/whatsapp/payload";
import { checkWhatsAppSend, type PolicyVerdict, type TemplateRow, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { providerFor, type ClaimResult, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readSwitches, readTemplateRow } from "@/platform/whatsapp/store";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";
import type { Pair } from "@/vx/text";

import {
  claimRatingQuestion,
  createHandoff,
  findAlert,
  insertAlert,
  insertAnswer,
  insertDelivery,
  markReplyDone,
  readHandoff,
  readHandoffForReply,
  readLatestAnswer,
  readPeopleToTell,
  readPerson,
  readRecentHandoffs,
  readWaitingAnswers,
  finishDelivery,
  setRating,
  takeDueHandoffs,
  takeWaiting,
  updateHandoff,
  type AlertRecord,
  type Handoff,
  type Person,
  type SentAnswer,
} from "./helper-handoffs";
import { finishTurn, readChat, readHelperSettings, saveChat, startTurn, type TurnFinish } from "./helper-store";
import { decideParentSuggestions, readHandoffNote, type DecideResult, type HandoffNote } from "./parent-suggestions";

/**
 * Veer Patta AI, step 2: a hand-off reaches a person, and their answer
 * reaches the parent (D-578). The rules and the words are in
 * `domain/helper-handoff.ts`; this does the sending and the writing.
 *
 *  - `openHandoff`: the helper passed a parent's message on. The person it
 *    is for is told on WhatsApp now, or at 6 am when it came at night.
 *  - `runHandoffStep`: the alert, the reminder, or passing a complaint up to
 *    an admin, whichever is due (`/api/jobs/parent-helper` every five minutes).
 *  - `handleStaffAnswer`: a swiped reply to that alert. The answer is saved in
 *    One's Messages, sent to the parent, and the person who answered is told.
 *  - `deliverWaitingAnswers`: answers that waited for a quiet parent to write
 *    again, sent the moment they do.
 *  - `relayFromMessages`: an answer typed in One's Messages to a message the
 *    helper passed on goes back the same way.
 *  - After an answer reaches the parent, they are asked once "Did this answer
 *    help?" (D-584). `rateAnswer` keeps their tap; a "no" goes to the school
 *    office as a hand-off of its own, with what they asked and what they were
 *    told, and the office's answer comes back the same way.
 *  - A parent's message that says a child will be away (D-602): the class
 *    teacher's alert carries Mark Leave, Mark Absent and Not now, and a tap
 *    decides that note as them, exactly as the same button in One does. Swiping
 *    right still answers the parent.
 *
 * Every message still passes `checkWhatsAppSend`: practice mode, the helper's
 * switch, and the owner-only rule while real recipients are off. A member of
 * staff is told only when they said yes to WhatsApp from the school app and
 * have not stopped it (`reachOf`, D-583). A practice
 * hand-off (the owner's test number standing for test children) tells only the
 * owner's number, in place of the test account it is for.
 */

/** Everything the relay reads and writes, so a test can stand in for each. */
export type RelayDeps = {
  now: () => Date;
  readConfig: () => WhatsAppConfig;
  readSwitches: () => Promise<WhatsAppSwitches | null>;
  readHelperName: () => Promise<string>;
  readTemplateRow: (key: string) => Promise<TemplateRow | null>;
  readChat: (from: string) => Promise<ChatState>;
  saveChat: (from: string, patch: ChatPatch, at: Date) => Promise<void>;
  send: (body: Record<string, unknown>) => Promise<ProviderSendResult>;
  /** Null when the provider cannot claim a message (only the hub can). */
  claim: ((wamid: string) => Promise<ClaimResult>) | null;
  startTurn: typeof startTurn;
  finishTurn: (providerMessageId: string, finish: TurnFinish) => Promise<void>;
  createHandoff: typeof createHandoff;
  readHandoff: (id: string) => Promise<Handoff | null>;
  readHandoffForReply: (parentReplyId: string) => Promise<Handoff | null>;
  updateHandoff: typeof updateHandoff;
  readPeopleToTell: (handoff: Handoff, level: number) => Promise<Person[] | null>;
  readPerson: (staffId: string, classTeacherId: string | null) => Promise<Person | null>;
  insertAlert: (row: AlertRecord) => Promise<boolean>;
  findAlert: typeof findAlert;
  insertAnswer: typeof insertAnswer;
  markReplyDone: typeof markReplyDone;
  insertDelivery: typeof insertDelivery;
  takeWaiting: typeof takeWaiting;
  finishDelivery: typeof finishDelivery;
  readWaitingAnswers: typeof readWaitingAnswers;
  takeDueHandoffs: typeof takeDueHandoffs;
  /** "Did this answer help?" (D-584). */
  readRecentHandoffs: (parentE164: string) => Promise<Handoff[] | null>;
  setRating: (id: string, value: RatingValue, at: string) => ReturnType<typeof setRating>;
  claimRatingQuestion: (id: string, at: string) => Promise<boolean>;
  readLatestAnswer: (handoffId: string) => Promise<SentAnswer | null>;
  /** The child's absence a hand-off came with (D-602); null when it came with none. Throws when it could not be read. */
  readHandoffNote: (parentReplyId: string) => Promise<HandoffNote | null>;
  /** A tap under a class teacher's alert, decided as them, as the same button in One decides it (D-602). */
  decideNote: (input: { actorStaffId: string; id: string; choice: NoteChoice }) => Promise<DecideResult>;
  /**
   * Parent chats (D-616): the hand-off's message waits in the family's chat
   * at its desk, and the desk hears from the chats' own nudge, a link to
   * their whole Chats section, instead of an alert to swipe on. The chat's
   * id, or null when chats are off or it could not be written: the hand-off
   * then alerts as before.
   */
  openChat?: (input: HandoffChatInput) => Promise<string | null>;
  /** An answer to a hand-off whose message is in a chat, sent the chat's way; null when it is in none. */
  answerInChat?: (input: { handoffId: string; staffId: string; text: string }) => Promise<SendOutcome | null>;
};

/** The real database and the real hub. */
export function liveRelayDeps(): RelayDeps {
  const config = readWhatsAppConfig();
  const provider = config.ok ? providerFor(config) : null;
  const claimMessage = provider?.claimMessage;
  return {
    now: () => new Date(),
    readConfig: () => config,
    readSwitches: () => readSwitches(),
    readHelperName: async () => (await readHelperSettings())?.helperName ?? "Veer Patta AI",
    readTemplateRow: (key) => readTemplateRow(key).catch(() => null),
    readChat: (from) => readChat(from),
    saveChat: (from, patch, at) => saveChat(from, patch, at),
    send: (body) =>
      provider
        ? provider.send(body)
        : Promise.resolve({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "WhatsApp is not set up here." }),
    claim: claimMessage ? (wamid) => claimMessage(wamid) : null,
    startTurn: (row) => startTurn(row),
    finishTurn: (id, finish) => finishTurn(id, finish),
    createHandoff: (row) => createHandoff(row),
    readHandoff: (id) => readHandoff(id),
    readHandoffForReply: (id) => readHandoffForReply(id),
    updateHandoff: (id, patch) => updateHandoff(id, patch),
    readPeopleToTell: (handoff, level) => readPeopleToTell(handoff, level),
    readPerson: (staffId, classTeacherId) => readPerson(staffId, classTeacherId),
    insertAlert: (row) => insertAlert(row),
    findAlert: (messageId) => findAlert(messageId),
    insertAnswer: (row) => insertAnswer(row),
    markReplyDone: (replyId, staffId, at) => markReplyDone(replyId, staffId, at),
    insertDelivery: (row) => insertDelivery(row),
    takeWaiting: (answerId, at) => takeWaiting(answerId, at),
    finishDelivery: (answerId, write) => finishDelivery(answerId, write),
    readWaitingAnswers: (parentE164) => readWaitingAnswers(parentE164),
    takeDueHandoffs: (limit) => takeDueHandoffs(limit),
    readRecentHandoffs: (parentE164) => readRecentHandoffs(parentE164),
    setRating: (id, value, at) => setRating(id, value, at),
    claimRatingQuestion: (id, at) => claimRatingQuestion(id, at),
    readLatestAnswer: (handoffId) => readLatestAnswer(handoffId),
    readHandoffNote: (parentReplyId) => readHandoffNote(parentReplyId),
    decideNote: ({ actorStaffId, id, choice }) =>
      decideParentSuggestions(
        choice === "dismiss"
          ? { actorStaffId, ids: [id], decision: "dismiss", via: "whatsapp" }
          : { actorStaffId, ids: [id], decision: "apply", mark: choice, via: "whatsapp" },
      ),
    openChat: (input) => openChatForHandoff(input, liveChatHandoffDeps()),
    answerInChat: (input) => answerHandoffInChat(input, liveChatSendDeps()),
  };
}

const MINUTE = 60_000;
/** How long a step is held while it runs, matching `parent_helper_take_due`. */
const LEASE_MINUTES = 10;
/** A step that could not read what it needs is tried again this much later. */
const RETRY_MINUTES = 15;

/** What became of one person's alert. `off`: the helper or practice mode stopped it, not the person. */
type AlertOutcome = "sent" | "off" | "not_sent";

const OFF_CODES: ReadonlySet<string> = new Set(["feature_off", "not_configured", "sending_off"]);

function verdictOutcome(verdict: PolicyVerdict): { outcome: AlertOutcome; reason: string } | null {
  if (verdict.decision === "send") return null;
  if (verdict.decision === "dry_run") return { outcome: "off", reason: "practice_mode" };
  return { outcome: OFF_CODES.has(verdict.code) ? "off" : "not_sent", reason: verdict.code };
}

function sendFailure(result: Exclude<ProviderSendResult, { outcome: "accepted" }>): string {
  return result.outcome === "unknown" ? `send_unknown:${result.errorCode}` : `send_rejected:${result.errorCode ?? result.httpStatus}`;
}

function windowClosed(result: ProviderSendResult): boolean {
  return result.outcome === "rejected" && result.errorCode === "window_closed";
}

type Shared = { switches: WhatsAppSwitches | null; config: WhatsAppConfig; now: Date };

async function shared(deps: RelayDeps): Promise<Shared> {
  return { switches: await deps.readSwitches().catch(() => null), config: deps.readConfig(), now: deps.now() };
}

/** Where a practice hand-off's messages go: the owner's number, standing in for every test account. */
function practiceNumber(switches: WhatsAppSwitches | null): string | null {
  return toE164(switches?.ownerTestNumber ?? "");
}

/** Where one person's alert goes, or why it cannot go. */
export type Reach = { to: string; why: null } | { to: null; why: "no_number" | "no_consent" };

/**
 * Practice: the owner's number, standing in for the test account. Otherwise
 * the person's own WhatsApp, and only with their yes (D-583): a number on file
 * is not a consent. They give it by linking their WhatsApp from their phone
 * (D-582), on Preferences, or on the form the office records.
 */
export function reachOf(person: Person, practice: boolean, owner: string | null): Reach {
  if (practice) return owner ? { to: owner, why: null } : { to: null, why: "no_number" };
  if (!person.e164) return { to: null, why: "no_number" };
  if (!person.consented) return { to: null, why: "no_consent" };
  return { to: person.e164, why: null };
}

type AlertWrite = Omit<AlertRecord, "handoffId" | "staffId" | "toE164" | "kind">;

/**
 * One person told about a hand-off: typed while their chat with the school is
 * open, the approved staff template otherwise. The alert is written down with
 * its message id either way, because a swiped reply quotes that id, and so
 * does a tap on one of its buttons.
 *
 * A class teacher's alert about a child the parent says will be away carries
 * Mark Leave, Mark Absent and Not now (D-602): reply buttons when typed, the
 * approved away note's quick replies otherwise. When those cannot go, the
 * ordinary alert does, and the note waits for them in One.
 */
async function alertPerson(input: {
  handoff: Handoff;
  person: Person;
  reach: Reach;
  kind: AlertKind;
  helperName: string;
  /** The child's absence the hand-off came with, while it still waits (D-602). */
  note: HandoffNote | null;
  ctx: Shared;
  deps: RelayDeps;
}): Promise<AlertOutcome> {
  const { handoff, person, reach, kind, helperName, ctx, deps } = input;
  const to = reach.to;
  const record = (outcome: AlertOutcome, write: AlertWrite) =>
    deps
      .insertAlert({ handoffId: handoff.id, staffId: person.staffId, toE164: to, kind, ...write })
      .then(() => outcome)
      .catch(() => outcome);

  if (!to) return record("not_sent", { via: null, status: "skipped", reason: reach.why ?? "no_number", messageId: null });

  const words: AlertWords = {
    kind,
    language: person.language,
    staffName: person.name,
    studentLabel: handoff.studentLabel ?? `${handoff.fromName} (${person.language === "hi" ? "अभिभावक" : "parent"})`,
    topic: handoff.topic,
    complaint: handoff.complaint,
    words: handoff.body,
    helperName,
    practice: handoff.practice,
  };
  // Only the class teacher's alert carries the buttons: the decision is theirs.
  const note = input.note && person.isClassTeacher ? input.note : null;
  const away = note ? awayLine(note, person.language, schoolToday(ctx.now)) : null;

  const chat = await deps.readChat(to).catch(() => null);
  if (chat && windowOpen(chat.lastTurnAt, ctx.now)) {
    const verdict = checkWhatsAppSend({
      feature: "parent_helper",
      to,
      switches: ctx.switches,
      config: ctx.config,
      kind: "text",
      wroteInLast24h: true,
    });
    const stopped = verdictOutcome(verdict);
    if (stopped) return record(stopped.outcome, { via: "text", status: "skipped", reason: stopped.reason, messageId: null });
    let sent = await deps.send(
      note && away ? helperMessageBody(to, awayNoteMessage({ ...words, away }, note.id)) : textMessageBody(to, staffAlertText(words)),
    );
    // Meta would not take the buttons: the alert without them, and the note waits in One.
    if (note && sent.outcome === "rejected" && !windowClosed(sent)) sent = await deps.send(textMessageBody(to, staffAlertText(words)));
    if (sent.outcome === "accepted") return record("sent", { via: "text", status: "sent", reason: null, messageId: sent.messageId });
    if (!windowClosed(sent)) return record("not_sent", { via: "text", status: "failed", reason: sendFailure(sent), messageId: null });
    // Meta says the chat closed after all: the approved template instead.
  }

  if (note && away) {
    const noted = await sendAwayNote({ to, words: { ...words, away }, note, language: person.language, ctx, deps });
    if (noted) return record(noted.outcome, noted.write);
  }

  const row = await deps.readTemplateRow(STAFF_ALERT_TEMPLATE[person.language]);
  const verdict = checkWhatsAppSend({
    feature: "parent_helper",
    to,
    switches: ctx.switches,
    config: ctx.config,
    kind: "template",
    template: row,
    language: person.language,
    bodyParamCount: HELPER_TEMPLATE_PARAMS.staffAlert,
    hasDocument: false,
    hasUrlButton: false,
  });
  const stopped = verdictOutcome(verdict);
  if (stopped || !row) {
    return record(stopped?.outcome ?? "not_sent", { via: "template", status: "skipped", reason: stopped?.reason ?? "no_template", messageId: null });
  }
  const sent = await deps.send(
    templateMessageBody({ to, name: row.provider_name, languageCode: row.language_code, bodyParams: staffAlertParams(words) }),
  );
  if (sent.outcome === "accepted") return record("sent", { via: "template", status: "sent", reason: null, messageId: sent.messageId });
  return record("not_sent", { via: "template", status: "failed", reason: sendFailure(sent), messageId: null });
}

/**
 * The approved away note with its three quick replies, each carrying the
 * note's own payload (D-602). Null when it cannot go (not approved yet,
 * switched off, refused by Meta): then the ordinary approved alert goes
 * instead. A send whose fate is unknown is not followed by a second one.
 */
async function sendAwayNote(input: {
  to: string;
  words: AlertWords & { away: string };
  note: HandoffNote;
  language: Person["language"];
  ctx: Shared;
  deps: RelayDeps;
}): Promise<{ outcome: AlertOutcome; write: AlertWrite } | null> {
  const { to, words, note, language, ctx, deps } = input;
  const row = await deps.readTemplateRow(AWAY_NOTE_TEMPLATE[language]);
  const verdict = checkWhatsAppSend({
    feature: "parent_helper",
    to,
    switches: ctx.switches,
    config: ctx.config,
    kind: "template",
    template: row,
    language,
    bodyParamCount: HELPER_TEMPLATE_PARAMS.awayNote,
    hasDocument: false,
    hasUrlButton: false,
  });
  if (verdict.decision !== "send" || !row) return null;
  const sent = await deps.send(
    templateMessageBody({
      to,
      name: row.provider_name,
      languageCode: row.language_code,
      bodyParams: awayNoteParams(words),
      quickReplies: noteButtonPayloads(note.id),
    }),
  );
  if (sent.outcome === "accepted") return { outcome: "sent", write: { via: "template", status: "sent", reason: null, messageId: sent.messageId } };
  if (sent.outcome === "unknown") return { outcome: "not_sent", write: { via: "template", status: "failed", reason: sendFailure(sent), messageId: null } };
  return null;
}

export type StepOutcome = {
  outcome: "done" | "closed" | "gone" | "waiting" | "retry";
  told: number;
  next: HandoffAction | null;
};

const ALERT_KIND: Record<HandoffAction, AlertKind> = { alert: "alert", remind: "reminder", pass_up: "passed_up" };

/**
 * The child's absence a hand-off came with, while a tap could still decide
 * it (D-602): waiting, not past its time, of the hand-off's own kind. Null
 * otherwise, or when it could not be read; the alert then goes without
 * buttons and the note waits in One.
 */
async function waitingNote(handoff: Handoff, now: Date, deps: RelayDeps): Promise<HandoffNote | null> {
  const note = await deps.readHandoffNote(handoff.parentReplyId).catch(() => null);
  if (!note || note.status !== "pending" || note.days.length === 0 || note.practice !== handoff.practice) return null;
  return Date.parse(note.expiresAt) > now.getTime() ? note : null;
}

/**
 * The hand-off's due step: tell the people it is for, remind them, or pass a
 * complaint up to an admin. Then the next step is set from the rules
 * (`nextStep`), or none: answered, marked done in Messages, nobody left to
 * tell, or the helper switched off.
 */
export async function runHandoffStep(id: string, deps: RelayDeps): Promise<StepOutcome> {
  const handoff = await deps.readHandoff(id);
  if (!handoff) return { outcome: "gone", told: 0, next: null };
  const ctx = await shared(deps);
  const nowIso = ctx.now.toISOString();

  if (handoff.answeredAt || handoff.closedAt || handoff.replyDone) {
    await deps.updateHandoff(id, { nextAction: null, closedAt: handoff.closedAt ?? (handoff.answeredAt ? null : nowIso) });
    return { outcome: "closed", told: 0, next: null };
  }
  const action = handoff.nextAction;
  if (!action) return { outcome: "closed", told: 0, next: null };

  // Never at night, whatever the clock said when this was planned.
  const allowed = nextAlertMoment(ctx.now);
  if (allowed.getTime() > ctx.now.getTime()) {
    await deps.updateHandoff(id, { nextAction: action, nextActionAt: allowed.toISOString() });
    return { outcome: "waiting", told: 0, next: action };
  }

  const level = action === "pass_up" ? 1 : handoff.level;
  const people = ctx.switches ? await deps.readPeopleToTell(handoff, level) : null;
  if (!people) {
    await deps.updateHandoff(id, { nextAction: action, nextActionAt: new Date(ctx.now.getTime() + RETRY_MINUTES * MINUTE).toISOString() });
    return { outcome: "retry", told: 0, next: action };
  }

  // Practice: one person, on the owner's own number.
  const owner = practiceNumber(ctx.switches);
  const tellable = handoff.practice ? people.slice(0, 1) : people;
  const helperName = await deps.readHelperName().catch(() => "Veer Patta AI");
  // A child's absence it came with, still waiting: the class teacher's alert carries its buttons (D-602).
  const note = handoff.target === "class_teacher" && action !== "pass_up" ? await waitingNote(handoff, ctx.now, deps) : null;
  const outcomes: AlertOutcome[] = [];
  let reachable = 0;
  for (const person of tellable) {
    const reach = reachOf(person, handoff.practice, owner);
    if (reach.to) reachable += 1;
    outcomes.push(await alertPerson({ handoff, person, reach, kind: ALERT_KIND[action], helperName, note, ctx, deps }));
  }
  const told = outcomes.filter((outcome) => outcome === "sent").length;

  const after: HandoffState = {
    target: handoff.target,
    complaint: handoff.complaint,
    level,
    reminders: action === "remind" ? handoff.reminders + 1 : action === "pass_up" ? 0 : handoff.reminders,
    levelAlertedAt: action === "pass_up" ? nowIso : (handoff.levelAlertedAt ?? nowIso),
    answeredAt: null,
    closedAt: null,
  };
  const write = { level: after.level, reminders: after.reminders, levelAlertedAt: after.levelAlertedAt };

  let next: { action: HandoffAction; at: Date } | null;
  if (told === 0 && outcomes.includes("off")) {
    // Switched off or in practice mode: the message stays in Messages, and nothing more is sent about it.
    next = null;
  } else if (reachable === 0) {
    // Nobody to tell here (no number, or no yes). A complaint goes straight up; anything else stays with the office in Messages.
    next = level === 0 && canPassUp(handoff.target, handoff.complaint) ? { action: "pass_up", at: ctx.now } : null;
  } else {
    next = nextStep(after, action, ctx.now);
  }
  await deps.updateHandoff(id, { ...write, nextAction: next?.action ?? null, nextActionAt: next?.at.toISOString() ?? null });
  logInfo("whatsapp.helper.handoff_step", { action, told, people: tellable.length, next: next?.action ?? null, practice: handoff.practice });
  return { outcome: "done", told, next: next?.action ?? null };
}

export type OpenHandoffInput = {
  parentReplyId: string;
  parentE164: string;
  language: HelperLanguage;
  target: HandoffTarget;
  topic: string;
  child: ChildFacts | null;
  sessionLabel: string;
  fromName: string;
  practice: boolean;
  /** Who it is about, when not the child's first name: the earlier hand-off's, for a "no" (D-584). */
  aboutName?: string;
  /** A "no" to an answer (D-584): the hand-off whose answer did not help. */
  followUpOf?: string | null;
  /** For the family's chat (D-616): all the family's children, the one it is about when not `child`. */
  family?: readonly ChildFacts[];
  aboutStudentId?: string | null;
  /** What the parent sent, as a chat line; `body` is what Messages keeps, for when it cannot be one. */
  said?: ChatInboundMessage | null;
  body?: string;
  /** The helper's reply, as the parent read it. */
  ai?: { text: string; wamid: string | null; at: string } | null;
  /** A line only staff read: for a "no", what the parent asked and what they were told. */
  staffNote?: string | null;
};

/** The hand-off as its chat needs it (D-616). */
function chatInputOf(input: OpenHandoffInput, handoffId: string, classTeacherId: string | null): HandoffChatInput {
  const family = input.family ?? (input.child ? [input.child] : []);
  return {
    handoffId,
    parentReplyId: input.parentReplyId,
    parentE164: input.parentE164,
    language: input.language,
    target: input.target,
    classTeacherId,
    topic: input.topic,
    complaint: isComplaint(input.target, input.topic),
    practice: input.practice,
    sessionLabel: input.sessionLabel,
    fromName: input.fromName,
    children: handoffChildren(family, input.sessionLabel),
    aboutStudentId: input.aboutStudentId ?? input.child?.studentId ?? null,
    said: input.said ?? null,
    body: input.body ?? "",
    ai: input.ai ?? null,
    staffNote: input.staffNote ?? null,
  };
}

/**
 * The helper passed a parent's message on (it is already in Messages, and the
 * parent has been told). Written down, and the person it is for told now, or
 * at 6 am when it came at night. While chats are on (D-616) the message waits
 * in the family's chat at that desk instead, and the chats' own nudge tells
 * the desk; the alert stays planned until the chat is written, so a crash in
 * between still tells somebody. Never throws.
 */
export async function openHandoff(
  input: OpenHandoffInput,
  deps: RelayDeps,
): Promise<{ handoffId: string | null; step: StepOutcome | null; chatId: string | null }> {
  try {
    const now = deps.now();
    const first = nextAlertMoment(now);
    const alertNow = first.getTime() <= now.getTime();
    const teacher = input.child?.classTeacher ?? null;
    const classTeacherId = teacher && staffBelongsToSession(teacher.isTest, input.sessionLabel) ? teacher.staffId : null;
    const id = await deps.createHandoff({
      parentReplyId: input.parentReplyId,
      parentE164: input.parentE164,
      language: input.language,
      target: input.target,
      topic: input.topic,
      complaint: isComplaint(input.target, input.topic),
      practice: input.practice,
      classTeacherId,
      aboutName: input.aboutName ?? input.child?.firstName ?? input.fromName,
      followUpOf: input.followUpOf ?? null,
      nextAction: "alert",
      // Told right away is held like a job's step, so the job leaves it alone meanwhile.
      nextActionAt: (alertNow ? new Date(now.getTime() + LEASE_MINUTES * MINUTE) : first).toISOString(),
    });
    if (!id) return { handoffId: null, step: null, chatId: null };
    const chatId = deps.openChat ? await deps.openChat(chatInputOf(input, id, classTeacherId)).catch(() => null) : null;
    if (chatId) {
      // The chat's nudge tells the desk; the hand-off's own alert never goes.
      await deps.updateHandoff(id, { nextAction: null });
      return { handoffId: id, step: null, chatId };
    }
    const step = alertNow ? await runHandoffStep(id, deps) : null;
    return { handoffId: id, step, chatId: null };
  } catch (caught) {
    logWarn("whatsapp.helper.handoff_open_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return { handoffId: null, step: null, chatId: null };
  }
}

/** The due steps, one after another, inside the job's time. */
export async function runDueHandoffs(deps: RelayDeps, options: { limit?: number; budgetMs?: number } = {}): Promise<Record<string, number>> {
  const started = Date.now();
  const ids = await deps.takeDueHandoffs(options.limit ?? 10);
  const counts: Record<string, number> = { taken: ids.length, told: 0 };
  for (const id of ids) {
    // What is left keeps its ten-minute hold and is picked up by a later run.
    if (Date.now() - started > (options.budgetMs ?? 40_000)) break;
    try {
      const step = await runHandoffStep(id, deps);
      counts[step.outcome] = (counts[step.outcome] ?? 0) + 1;
      counts.told += step.told;
    } catch (caught) {
      counts.crashed = (counts.crashed ?? 0) + 1;
      logWarn("whatsapp.helper.handoff_step_crashed", { error: caught instanceof Error ? caught.message : "unknown" });
    }
  }
  return counts;
}

function answererFromRecord(kind: "class_teacher" | "accounts" | "principal" | "office", name: string | null): Answerer {
  if (kind === "class_teacher" && name) return { kind, name };
  return kind === "class_teacher" ? { kind: "office" } : { kind };
}

function childName(handoff: Handoff): string | null {
  return handoff.studentLabel ? handoff.aboutName : null;
}

/**
 * The parent's own words, quoted above an answer. On the office's answer to a
 * "no" (D-584) that is what they first asked, not the note the office was
 * given about it.
 */
async function quoteOf(handoff: Handoff, deps: RelayDeps): Promise<string> {
  if (!handoff.followUpOf) return handoff.body;
  const first = await deps.readHandoff(handoff.followUpOf).catch(() => null);
  return first?.body ?? handoff.body;
}

/**
 * "Did this answer help?", once per hand-off, right after its answer reached
 * the parent (D-584). Not on the office's answer to a "no": the parent is
 * asked about each message once, and a second "no" would only go round again.
 * Sent only where the answer just went, so the parent's chat is open and the
 * send rules have already said yes.
 */
async function askRating(handoff: Handoff, ctx: Shared, deps: RelayDeps): Promise<boolean> {
  if (handoff.followUpOf || handoff.ratingAskedAt || handoff.rating) return false;
  if (!(await deps.claimRatingQuestion(handoff.id, ctx.now.toISOString()).catch(() => false))) return false;
  const helperName = await deps.readHelperName().catch(() => "Veer Patta AI");
  const question = ratingQuestion(
    { language: handoff.language, helperName, family: { children: [], practice: handoff.practice } },
    ratingKey(handoff.id),
  );
  const sent = await deps.send(helperMessageBody(handoff.parentE164, question)).catch(() => null);
  const asked = sent?.outcome === "accepted";
  logInfo("whatsapp.helper.rating_asked", { asked, practice: handoff.practice });
  return asked;
}

/**
 * An answer on its way to the parent: typed while their chat is open, else the
 * approved "your answer is ready" note, the answer waiting for their reply.
 */
async function relayAnswer(
  input: { handoff: Handoff; answerId: string; who: Answerer; answer: string },
  ctx: Shared,
  deps: RelayDeps,
): Promise<RelayResult> {
  const { handoff, answerId, who, answer } = input;
  const to = handoff.parentE164;
  const answerer = {
    answererKind: who.kind,
    answererName: who.kind === "class_teacher" ? who.name : null,
  } as const;
  const deliver = (row: Omit<Parameters<RelayDeps["insertDelivery"]>[0], "answerId" | "handoffId" | "answererKind" | "answererName">) =>
    deps.insertDelivery({ answerId, handoffId: handoff.id, ...answerer, ...row }).catch(() => false);

  const chat = await deps.readChat(to).catch(() => null);
  if (chat && windowOpen(chat.lastTurnAt, ctx.now)) {
    const verdict = checkWhatsAppSend({ feature: "parent_helper", to, switches: ctx.switches, config: ctx.config, kind: "text", wroteInLast24h: true });
    const stopped = verdictOutcome(verdict);
    if (stopped) {
      await deliver({ status: "failed", via: null, reason: stopped.reason });
      return "failed";
    }
    const text = parentAnswerText({ language: handoff.language, who, aboutName: childName(handoff), quote: await quoteOf(handoff, deps), answer });
    const sent = await deps.send(textMessageBody(to, text));
    if (sent.outcome === "accepted") {
      await deliver({ status: "sent", via: "text", messageId: sent.messageId, sentAt: ctx.now.toISOString() });
      await askRating(handoff, ctx, deps);
      return "sent";
    }
    if (!windowClosed(sent)) {
      await deliver({ status: "failed", via: "text", reason: sendFailure(sent) });
      return "failed";
    }
  }

  // The parent has gone quiet: the approved note now, the answer when they reply.
  const language = templateLanguage(handoff.language);
  const row = await deps.readTemplateRow(ANSWER_READY_TEMPLATE[language]);
  const verdict = checkWhatsAppSend({
    feature: "parent_helper",
    to,
    switches: ctx.switches,
    config: ctx.config,
    kind: "template",
    template: row,
    language,
    bodyParamCount: HELPER_TEMPLATE_PARAMS.answerReady,
    hasDocument: false,
    hasUrlButton: false,
  });
  const stopped = verdictOutcome(verdict);
  if (stopped || !row) {
    // Still delivered the next time they write; the office is told it has not reached them yet.
    await deliver({ status: "waiting", via: null, reason: `note_not_sent:${stopped?.reason ?? "no_template"}` });
    return "failed";
  }
  const sent = await deps.send(
    templateMessageBody({
      to,
      name: row.provider_name,
      languageCode: row.language_code,
      bodyParams: answerReadyParams(who, { childName: childName(handoff), topic: handoff.topic }, handoff.language),
    }),
  );
  if (sent.outcome !== "accepted") {
    await deliver({ status: "waiting", via: null, reason: `note_not_sent:${sendFailure(sent)}` });
    return "failed";
  }
  await deliver({ status: "waiting", via: "template", noteMessageId: sent.messageId });
  return "waiting";
}

/** Where an answer sent the chat's way stands, as the person who wrote it is told. */
function chatResult(outcome: Extract<SendOutcome, { ok: true }>): RelayResult {
  if (outcome.delivery === "waiting") return "waiting";
  return outcome.delivery === "failed" ? "failed" : "sent";
}

/**
 * An answer to a hand-off, from WhatsApp or from Messages: saved, the
 * hand-off closed, and sent on. When the parent's message is in a chat
 * (D-616) it goes the chat's way, so the chat shows it and nothing reaches
 * the parent twice; anything the chat would not take goes the old way.
 */
async function answerHandoff(
  input: { handoff: Handoff; staffId: string; person: Person | null; answer: string },
  ctx: Shared,
  deps: RelayDeps,
): Promise<RelayResult | "not_saved"> {
  const { handoff, staffId, person, answer } = input;
  if (deps.answerInChat) {
    const inChat = await deps.answerInChat({ handoffId: handoff.id, staffId, text: answer }).catch(() => null);
    if (inChat?.ok) return chatResult(inChat);
  }
  const answerId = await deps.insertAnswer({ replyId: handoff.parentReplyId, body: answer, answeredBy: staffId });
  if (!answerId) return "not_saved";
  const nowIso = ctx.now.toISOString();
  await deps.updateHandoff(handoff.id, { answeredAt: handoff.answeredAt ?? nowIso, nextAction: null });
  const who = answererFor(person?.role, person?.isClassTeacher === true, person?.name ?? "");
  const result = await relayAnswer({ handoff, answerId, who, answer }, ctx, deps);
  // Done in Messages once it is on its way; left open for the office when it is not.
  if (result !== "failed") await deps.markReplyDone(handoff.parentReplyId, staffId, nowIso).catch(() => undefined);
  return result;
}

export type StaffAnswerOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "answered"; route: "rule" | "tap"; intent: string; handoff: HandoffTarget | null }
  | { outcome: "failed"; reason: string };

/** "Leave · Test Teacher": how a decided note was decided, and by whom. Null while it is not decided. */
function decidedPair(note: HandoffNote): Pair | null {
  if (note.status !== "applied" && note.status !== "dismissed") return null;
  return decidedLabel({ status: note.status, kind: "absence", mark: note.mark, by: note.decidedByName });
}

/**
 * A tap under a class teacher's alert (D-602): the note that alert's hand-off
 * came with, decided as the person the alert went to. A tap that names
 * another note changes nothing, so no tap reaches another family's child, and
 * the database checks again that they may decide it and that it still waits.
 */
async function decideTap(
  input: { tap: NoteTap; handoff: Handoff | null; staffId: string | null },
  deps: RelayDeps,
): Promise<{ result: NoteResult; note: HandoffNote | null }> {
  const { tap, handoff, staffId } = input;
  if (!handoff || !staffId) return { result: { outcome: "gone" }, note: null };
  let note: HandoffNote | null;
  try {
    note = await deps.readHandoffNote(handoff.parentReplyId);
  } catch {
    return { result: { outcome: "failed" }, note: null };
  }
  if (!note || note.practice !== handoff.practice || (tap.suggestionId !== null && tap.suggestionId !== note.id)) {
    return { result: { outcome: "gone" }, note: null };
  }
  if (note.status !== "pending") return { result: { outcome: "already", decided: decidedPair(note) }, note };
  const decided = await deps.decideNote({ actorStaffId: staffId, id: note.id, choice: tap.choice }).catch(() => null);
  if (!decided || !decided.ok) return { result: { outcome: decided?.reason === "not_permitted" ? "not_permitted" : "failed" }, note };
  const outcome = decided.results.find((row) => row.id === note.id)?.outcome;
  switch (outcome) {
    case "applied":
      return { result: { outcome: "applied", mark: tap.choice === "absent" ? "absent" : "leave" }, note };
    case "dismissed":
      return { result: { outcome: "dismissed" }, note };
    case "already": {
      // Decided a moment ago, in One or on another alert: say how.
      const now = await deps.readHandoffNote(handoff.parentReplyId).catch(() => null);
      return { result: { outcome: "already", decided: now ? decidedPair(now) : null }, note };
    }
    case "expired":
    case "not_permitted":
      return { result: { outcome }, note };
    case "not_found":
      return { result: { outcome: "gone" }, note };
    default:
      return { result: { outcome: "failed" }, note };
  }
}

/**
 * A message that quotes one of the helper's alerts, from the number the alert
 * went to, is that person's answer, or their tap on one of its buttons
 * (D-602). Null when the message is not one: then it is an ordinary message,
 * and the helper (or the hub's bot) answers it.
 */
export async function handleStaffAnswer(message: WebhookInbound, deps: RelayDeps): Promise<StaffAnswerOutcome | null> {
  if (!message.replyTo) return null;
  const alert = await deps.findAlert(message.replyTo);
  const from = toE164(message.from);
  if (!alert || !from || alert.toE164 !== from) return null;

  // Mark Leave, Mark Absent or Not now: a decision, never words for the parent.
  const tap = readNoteTap(message.raw);
  const kind: MessageKind = tap ? "tap" : messageKind(message.type, message.raw);
  if (kind === "ignore") return { outcome: "skipped", reason: "not_readable" };
  const ctx = await shared(deps);
  const sentAt = Date.parse(message.at);
  if (!Number.isFinite(sentAt) || ctx.now.getTime() - sentAt > MAX_MESSAGE_AGE_MINUTES * MINUTE) {
    return { outcome: "skipped", reason: "too_old" };
  }
  const verdict = checkWhatsAppSend({ feature: "parent_helper", to: from, switches: ctx.switches, config: ctx.config, kind: "text", wroteInLast24h: true });
  if (verdict.decision === "dry_run") return { outcome: "skipped", reason: "practice_mode" };
  if (verdict.decision === "refuse") return { outcome: "skipped", reason: verdict.code };

  const ledger = await deps.startTurn({ providerMessageId: message.providerMessageId, from, receivedAt: new Date(sentAt).toISOString(), kind });
  if (ledger === "duplicate") return { outcome: "skipped", reason: "duplicate" };
  if (ledger === "failed") return { outcome: "skipped", reason: "ledger_failed" };
  // The hub's bot must not answer it too. The answer is passed on whatever the hub says.
  const claim = deps.claim ? await deps.claim(message.providerMessageId).catch(() => null) : null;
  const claimNote = claim?.ok && claim.claimed ? null : "not_claimed";

  const handoff = await deps.readHandoff(alert.handoffId);
  const person = alert.staffId ? await deps.readPerson(alert.staffId, handoff?.classTeacherId ?? null) : null;
  const language = person?.language ?? "hi";
  if (tap) return finishTap({ message, tap, from, sentAt, claimNote, handoff, staffId: alert.staffId, person, language, ctx }, deps);
  const answer = (message.text ?? "").trim();

  let result: RelayResult | "not_saved" | "not_text";
  if (!handoff || !alert.staffId) result = "not_saved";
  else if (kind !== "text" || !answer) result = "not_text";
  else result = await answerHandoff({ handoff, staffId: alert.staffId, person, answer }, ctx, deps);

  const confirm = await deps.send(textMessageBody(from, staffConfirmText(result, language, handoff?.studentLabel ?? handoff?.aboutName ?? "-")));
  const finished = deps.now();
  const intent = result === "not_text" ? "staff_not_text" : "staff_answer";
  await deps.finishTurn(message.providerMessageId, {
    status: result === "not_saved" ? "failed" : "answered",
    reason: result === "not_saved" ? "answer_not_saved" : result === "failed" ? "relay_failed" : claimNote,
    intent,
    route: "rule",
    handoff: handoff?.target ?? null,
    parentReplyId: handoff?.parentReplyId ?? null,
    replyMessageId: confirm.outcome === "accepted" ? confirm.messageId : null,
    latencyMs: finished.getTime() - sentAt,
  });
  // Their chat with the school is open now, so the next alert can be typed.
  await deps.saveChat(from, {}, finished).catch(() => undefined);
  logInfo("whatsapp.helper.staff_answer", { result, from: maskNumber(from), practice: handoff?.practice ?? null });
  if (result === "not_saved") return { outcome: "failed", reason: "answer_not_saved" };
  return { outcome: "answered", route: "rule", intent, handoff: handoff?.target ?? null };
}

/** The tap decided, the person who tapped told what became of it, and the turn written down. */
async function finishTap(
  input: {
    message: WebhookInbound;
    tap: NoteTap;
    from: string;
    sentAt: number;
    claimNote: string | null;
    handoff: Handoff | null;
    staffId: string | null;
    person: Person | null;
    language: Person["language"];
    ctx: Shared;
  },
  deps: RelayDeps,
): Promise<StaffAnswerOutcome> {
  const { message, tap, from, sentAt, claimNote, handoff, person, language, ctx } = input;
  const { result, note } = await decideTap({ tap, handoff, staffId: input.staffId }, deps);
  const decided = result.outcome === "applied" || result.outcome === "dismissed";
  const text = noteConfirmText({
    result,
    language,
    studentLabel: handoff?.studentLabel ?? handoff?.aboutName ?? "-",
    days: note && note.days.length > 0 ? inLanguage(daysLabel(note.days, schoolToday(ctx.now)), language) : null,
    // Practice: the owner's number stands in for a test account, and is told which.
    practiceFor: decided && handoff?.practice && person ? person.name : null,
  });
  const confirm = await deps.send(textMessageBody(from, text));
  const finished = deps.now();
  await deps.finishTurn(message.providerMessageId, {
    status: result.outcome === "failed" ? "failed" : "answered",
    reason: decided ? claimNote : `note_${result.outcome}`,
    intent: "staff_note",
    route: "tap",
    handoff: handoff?.target ?? null,
    parentReplyId: handoff?.parentReplyId ?? null,
    replyMessageId: confirm.outcome === "accepted" ? confirm.messageId : null,
    latencyMs: finished.getTime() - sentAt,
  });
  // Their chat with the school is open now, so the next alert can be typed.
  await deps.saveChat(from, {}, finished).catch(() => undefined);
  logInfo("whatsapp.helper.staff_note", { outcome: result.outcome, choice: tap.choice, from: maskNumber(from), practice: handoff?.practice ?? null });
  if (result.outcome === "failed") return { outcome: "failed", reason: "note_not_decided" };
  return { outcome: "answered", route: "tap", intent: "staff_note", handoff: handoff?.target ?? null };
}

/**
 * Answers that waited for this parent to write again, sent now that they have
 * (their chat is open). Each is taken before it is sent, so two messages in a
 * row never send one answer twice. How many went.
 */
export async function deliverWaitingAnswers(parentE164: string, deps: RelayDeps): Promise<number> {
  const waiting = await deps.readWaitingAnswers(parentE164);
  if (!waiting || waiting.length === 0) return 0;
  const ctx = await shared(deps);
  let delivered = 0;
  for (const item of waiting) {
    const handoff = await deps.readHandoff(item.handoffId);
    if (!handoff) continue;
    const verdict = checkWhatsAppSend({ feature: "parent_helper", to: parentE164, switches: ctx.switches, config: ctx.config, kind: "text", wroteInLast24h: true });
    if (verdict.decision !== "send") break;
    if (!(await deps.takeWaiting(item.answerId, ctx.now.toISOString()))) continue;
    const who = answererFromRecord(item.answererKind, item.answererName);
    const quote = await quoteOf(handoff, deps);
    const text = parentAnswerText({ language: handoff.language, who, aboutName: childName(handoff), quote, answer: item.answerBody });
    const sent = await deps.send(textMessageBody(parentE164, text));
    if (sent.outcome === "accepted") {
      delivered += 1;
      await deps.finishDelivery(item.answerId, { status: "sent", messageId: sent.messageId, reason: null, at: ctx.now.toISOString() });
      if (item.answeredBy) await deps.markReplyDone(handoff.parentReplyId, item.answeredBy, ctx.now.toISOString()).catch(() => undefined);
      await askRating(handoff, ctx, deps);
    } else {
      await deps.finishDelivery(item.answerId, { status: "waiting", messageId: null, reason: sendFailure(sent), at: ctx.now.toISOString() });
    }
  }
  return delivered;
}

export type MessagesRelay = { result: RelayResult | "not_saved" };

/**
 * An answer typed in One's Messages to a message the helper passed on: it goes
 * back the way the helper's answers do. Null when the helper did not pass this
 * message on, or may not message this parent now (switched off, practice mode,
 * real recipients off): Messages then queues it as it always has, so an answer
 * is never left with no way out.
 */
export async function relayFromMessages(
  input: { replyId: string; body: string; staffId: string },
  deps: RelayDeps,
): Promise<MessagesRelay | null> {
  const handoff = await deps.readHandoffForReply(input.replyId);
  if (!handoff) return null;
  const ctx = await shared(deps);
  const may = checkWhatsAppSend({
    feature: "parent_helper",
    to: handoff.parentE164,
    switches: ctx.switches,
    config: ctx.config,
    kind: "text",
    wroteInLast24h: true,
  });
  if (may.decision !== "send") return null;
  const person = await deps.readPerson(input.staffId, handoff.classTeacherId);
  const result = await answerHandoff({ handoff, staffId: input.staffId, person, answer: input.body.trim() }, ctx, deps);
  return { result };
}

/**
 * What became of a tap on "Did this answer help?" (D-584):
 *  - `unknown`: none of this number's hand-offs has that key (or they could not be read). Nothing changes.
 *  - `helped` / `already`: a yes kept, or an earlier tap stands.
 *  - `already_passed_on`: a no the office already has.
 *  - `not_saved`: a no that could not be written down.
 *  - `pass_on`: a no, kept. The turn writes it into Messages for the office (`body`) and opens the hand-off.
 */
export type RateResult =
  | { outcome: "unknown" }
  | { outcome: "helped" | "already" | "already_passed_on" | "not_saved"; handoff: Handoff }
  | { outcome: "pass_on"; handoff: Handoff; body: string };

/**
 * A parent's tap on "Did this answer help?". The button names one of the
 * tapping number's own hand-offs and nothing else: a key none of them carries
 * is thanked and changes nothing, so no tap can reach another family's
 * message. The office's own hand-off for a "no" is never rated.
 */
export async function rateAnswer(input: { from: string; key: string; value: RatingValue }, deps: RelayDeps): Promise<RateResult> {
  const recent = await deps.readRecentHandoffs(input.from).catch(() => null);
  const handoff = recent?.find((row) => !row.followUpOf && ratingKey(row.id) === input.key) ?? null;
  if (!recent || !handoff) return { outcome: "unknown" };
  const kept = await deps.setRating(handoff.id, input.value, deps.now().toISOString()).catch(() => "failed" as const);
  logInfo("whatsapp.helper.rated", { value: input.value, kept, practice: handoff.practice });
  if (input.value === "helped") return { outcome: kept === "already" ? "already" : "helped", handoff };
  if (recent.some((row) => row.followUpOf === handoff.id)) return { outcome: "already_passed_on", handoff };
  if (kept === "failed") return { outcome: "not_saved", handoff };
  // "already" here is a no kept earlier whose hand-off to the office was never written: it is written now.
  const answer = await deps.readLatestAnswer(handoff.id).catch(() => null);
  const who = answer ? answererFromRecord(answer.answererKind, answer.answererName) : null;
  return { outcome: "pass_on", handoff, body: followUpBody({ parentWords: handoff.body, answer: answer?.body ?? null, who }) };
}
