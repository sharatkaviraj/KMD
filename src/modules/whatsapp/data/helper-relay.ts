import "server-only";

import type { ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import {
  answererFor,
  answerReadyParams,
  canPassUp,
  isComplaint,
  nextAlertMoment,
  nextStep,
  parentAnswerText,
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
import { ANSWER_READY_TEMPLATE, HELPER_TEMPLATE_PARAMS, STAFF_ALERT_TEMPLATE } from "@/modules/whatsapp/domain/helper-hub-templates";
import { MAX_MESSAGE_AGE_MINUTES, type ChatPatch, type ChatState } from "@/modules/whatsapp/domain/helper-plan";
import type { HandoffTarget } from "@/modules/whatsapp/domain/helper-replies";
import { messageKind, type HelperLanguage, type MessageKind } from "@/modules/whatsapp/domain/helper-text";
import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { logInfo, logWarn } from "@/platform/observability/log";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { maskNumber, toE164 } from "@/platform/whatsapp/numbers";
import { templateMessageBody, textMessageBody } from "@/platform/whatsapp/payload";
import { checkWhatsAppSend, type PolicyVerdict, type TemplateRow, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { providerFor, type ClaimResult, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readSwitches, readTemplateRow } from "@/platform/whatsapp/store";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

import {
  createHandoff,
  findAlert,
  insertAlert,
  insertAnswer,
  insertDelivery,
  markReplyDone,
  readHandoff,
  readHandoffForReply,
  readPeopleToTell,
  readPerson,
  readWaitingAnswers,
  finishDelivery,
  takeDueHandoffs,
  takeWaiting,
  updateHandoff,
  type AlertRecord,
  type Handoff,
  type Person,
} from "./helper-handoffs";
import { finishTurn, readChat, readHelperSettings, saveChat, startTurn, type TurnFinish } from "./helper-store";

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
 *
 * Every message still passes `checkWhatsAppSend`: practice mode, the helper's
 * switch, and the owner-only rule while real recipients are off. A member of
 * staff is told only when they said yes to WhatsApp from the school app and
 * have not stopped it (`reachOf`, D-582). A practice
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
 * the person's own WhatsApp, and only with their yes (D-582): a number on file
 * is not a consent. They give it by linking their WhatsApp from their phone
 * (D-581), on Preferences, or on the form the office records.
 */
export function reachOf(person: Person, practice: boolean, owner: string | null): Reach {
  if (practice) return owner ? { to: owner, why: null } : { to: null, why: "no_number" };
  if (!person.e164) return { to: null, why: "no_number" };
  if (!person.consented) return { to: null, why: "no_consent" };
  return { to: person.e164, why: null };
}

/**
 * One person told about a hand-off: typed while their chat with the school is
 * open, the approved staff template otherwise. The alert is written down with
 * its message id either way, because a swiped reply quotes that id.
 */
async function alertPerson(input: {
  handoff: Handoff;
  person: Person;
  reach: Reach;
  kind: AlertKind;
  helperName: string;
  ctx: Shared;
  deps: RelayDeps;
}): Promise<AlertOutcome> {
  const { handoff, person, reach, kind, helperName, ctx, deps } = input;
  const to = reach.to;
  const record = (outcome: AlertOutcome, write: Omit<AlertRecord, "handoffId" | "staffId" | "toE164" | "kind">) =>
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
    const sent = await deps.send(textMessageBody(to, staffAlertText(words)));
    if (sent.outcome === "accepted") return record("sent", { via: "text", status: "sent", reason: null, messageId: sent.messageId });
    if (!windowClosed(sent)) return record("not_sent", { via: "text", status: "failed", reason: sendFailure(sent), messageId: null });
    // Meta says the chat closed after all: the approved template instead.
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

export type StepOutcome = {
  outcome: "done" | "closed" | "gone" | "waiting" | "retry";
  told: number;
  next: HandoffAction | null;
};

const ALERT_KIND: Record<HandoffAction, AlertKind> = { alert: "alert", remind: "reminder", pass_up: "passed_up" };

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
  const outcomes: AlertOutcome[] = [];
  let reachable = 0;
  for (const person of tellable) {
    const reach = reachOf(person, handoff.practice, owner);
    if (reach.to) reachable += 1;
    outcomes.push(await alertPerson({ handoff, person, reach, kind: ALERT_KIND[action], helperName, ctx, deps }));
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
};

/**
 * The helper passed a parent's message on (it is already in Messages, and the
 * parent has been told). Written down, and the person it is for told now, or
 * at 6 am when it came at night. Never throws.
 */
export async function openHandoff(input: OpenHandoffInput, deps: RelayDeps): Promise<{ handoffId: string | null; step: StepOutcome | null }> {
  try {
    const now = deps.now();
    const first = nextAlertMoment(now);
    const alertNow = first.getTime() <= now.getTime();
    const teacher = input.child?.classTeacher ?? null;
    const id = await deps.createHandoff({
      parentReplyId: input.parentReplyId,
      parentE164: input.parentE164,
      language: input.language,
      target: input.target,
      topic: input.topic,
      complaint: isComplaint(input.target, input.topic),
      practice: input.practice,
      classTeacherId: teacher && staffBelongsToSession(teacher.isTest, input.sessionLabel) ? teacher.staffId : null,
      aboutName: input.child?.firstName ?? input.fromName,
      nextAction: "alert",
      // Told right away is held like a job's step, so the job leaves it alone meanwhile.
      nextActionAt: (alertNow ? new Date(now.getTime() + LEASE_MINUTES * MINUTE) : first).toISOString(),
    });
    if (!id) return { handoffId: null, step: null };
    const step = alertNow ? await runHandoffStep(id, deps) : null;
    return { handoffId: id, step };
  } catch (caught) {
    logWarn("whatsapp.helper.handoff_open_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return { handoffId: null, step: null };
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
    const text = parentAnswerText({ language: handoff.language, who, aboutName: childName(handoff), quote: handoff.body, answer });
    const sent = await deps.send(textMessageBody(to, text));
    if (sent.outcome === "accepted") {
      await deliver({ status: "sent", via: "text", messageId: sent.messageId, sentAt: ctx.now.toISOString() });
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

/** An answer to a hand-off, from WhatsApp or from Messages: saved, the hand-off closed, and sent on. */
async function answerHandoff(
  input: { handoff: Handoff; staffId: string; person: Person | null; answer: string },
  ctx: Shared,
  deps: RelayDeps,
): Promise<RelayResult | "not_saved"> {
  const { handoff, staffId, person, answer } = input;
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
  | { outcome: "answered"; route: "rule"; intent: string; handoff: HandoffTarget | null }
  | { outcome: "failed"; reason: string };

/**
 * A message that quotes one of the helper's alerts, from the number the alert
 * went to, is that person's answer. Null when the message is not one: then it
 * is an ordinary message, and the helper (or the hub's bot) answers it.
 */
export async function handleStaffAnswer(message: WebhookInbound, deps: RelayDeps): Promise<StaffAnswerOutcome | null> {
  if (!message.replyTo) return null;
  const alert = await deps.findAlert(message.replyTo);
  const from = toE164(message.from);
  if (!alert || !from || alert.toE164 !== from) return null;

  const kind: MessageKind = messageKind(message.type, message.raw);
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
    const text = parentAnswerText({ language: handoff.language, who, aboutName: childName(handoff), quote: handoff.body, answer: item.answerBody });
    const sent = await deps.send(textMessageBody(parentE164, text));
    if (sent.outcome === "accepted") {
      delivered += 1;
      await deps.finishDelivery(item.answerId, { status: "sent", messageId: sent.messageId, reason: null, at: ctx.now.toISOString() });
      if (item.answeredBy) await deps.markReplyDone(handoff.parentReplyId, item.answeredBy, ctx.now.toISOString()).catch(() => undefined);
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
