import "server-only";

import { chatVisible } from "@/modules/chats/domain/access";
import { isForYou } from "@/modules/chats/domain/filters";
import {
  digestParams,
  mayNudgeAgain,
  NUDGE_GAP_MINUTES,
  nudgeAfter,
  nudgeAudience,
  nudgeText,
  openOneParams,
  type NudgeLanguage,
} from "@/modules/chats/domain/nudges";
import { CHAT_TEMPLATE_PARAMS, OPEN_ONE_TEMPLATE } from "@/modules/chats/domain/templates";
import type { ChatRow, NudgeStep } from "@/modules/chats/domain/types";
import { readChat as readHelperChat } from "@/modules/whatsapp/data/helper-store";
import { nextAlertMoment, windowOpen } from "@/modules/whatsapp/domain/helper-handoff";
import { staffHubName } from "@/modules/whatsapp/domain/staff-hub-templates";
import { logInfo, logWarn } from "@/platform/observability/log";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { toE164 } from "@/platform/whatsapp/numbers";
import { templateMessageBody, textMessageBody } from "@/platform/whatsapp/payload";
import { checkWhatsAppSend, type PolicyVerdict, type TemplateRow, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { providerFor, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readSwitches, readTemplateRow } from "@/platform/whatsapp/store";

import { createGoLink, type GoLink } from "./go-links";
import { readDeskPeople, readDeskPerson, readRolePermissions, viewerOfPerson, type DeskPerson } from "./people";
import {
  lastNudges,
  nudgeKey,
  readChatSettings,
  readChatsByIds,
  readReads,
  readWaitingChats,
  recordNudge,
  takeDueChats,
  updateChat,
  type ChatGuard,
  type ChatRowPatch,
  type ChatSettings,
  type NudgeRecord,
} from "./store";

/**
 * The WhatsApp nudge that brings people to their chats (D-616), run by the
 * job every two minutes (`/api/jobs/parent-chats`). The timing and the words
 * are in `domain/nudges.ts`; this decides who, and sends.
 *
 *  - Each waiting chat whose step is due is told to the people on its desk
 *    (its taker's alone when an admin took it over), or, passed up, to the
 *    admins. A person who has read the parent's newest message in One is
 *    not nudged for it the first time: they are on it already.
 *  - One message per person, whatever the number of chats: it counts every
 *    parent waiting for them, as their own Chats list shows it, and links to
 *    that list in one tap (`/go/<code>`). Never more than one in half an
 *    hour: a chat due sooner waits for the half hour to pass.
 *  - Typed while the person's own chat with the school is open; otherwise
 *    the chats' approved message with its "Open chats" button, and until
 *    Meta approves that, the approved "Your staff alerts" with the link in
 *    its words.
 *  - Never at night (6 am to 9 pm in India), only to staff who said yes to
 *    WhatsApp from the school app (D-583), and only through the same send
 *    rules as every other message: practice mode, the helper's switch, the
 *    owner-only rule while real recipients are off.
 *  - Practice: a practice chat's nudge for its first person goes to the
 *    owner's number, in place of the test account it is for, as the
 *    hand-off alerts do.
 */

export type ChatNudgeDeps = {
  now: () => Date;
  readConfig: () => WhatsAppConfig;
  readSwitches: () => Promise<WhatsAppSwitches | null>;
  readSettings: () => Promise<ChatSettings | null>;
  readTemplateRow: (key: string) => Promise<TemplateRow | null>;
  takeDue: (limit: number) => Promise<string[]>;
  readChats: (ids: readonly string[]) => Promise<ChatRow[]>;
  readWaiting: (practice: boolean) => Promise<ChatRow[]>;
  readDeskPeople: typeof readDeskPeople;
  readPerson: (staffId: string) => Promise<DeskPerson | null>;
  readRolePermissions: (roles: readonly string[]) => Promise<Map<string, string[]>>;
  readReads: (chatIds: readonly string[]) => Promise<Array<{ chatId: string; staffId: string; readAt: string }>>;
  lastNudges: (numbers: readonly string[]) => Promise<Map<string, string>>;
  /** When this number last wrote to the school (its own 24 hours), as Veer Patta AI remembers it. */
  lastTurnAt: (e164: string) => Promise<string | null>;
  send: (body: Record<string, unknown>) => Promise<ProviderSendResult>;
  createGoLink: (input: { path: string; staffId: string | null; sessionLabel: string | null }) => Promise<GoLink | null>;
  recordNudge: (row: NudgeRecord) => Promise<void>;
  updateChat: (id: string, patch: ChatRowPatch, guard?: ChatGuard) => Promise<boolean>;
};

export function liveChatNudgeDeps(): ChatNudgeDeps {
  const config = readWhatsAppConfig();
  const provider = config.ok ? providerFor(config) : null;
  return {
    now: () => new Date(),
    readConfig: () => config,
    readSwitches: () => readSwitches(),
    readSettings: () => readChatSettings(),
    readTemplateRow: (key) => readTemplateRow(key).catch(() => null),
    takeDue: (limit) => takeDueChats(limit),
    readChats: (ids) => readChatsByIds(ids),
    readWaiting: (practice) => readWaitingChats(practice),
    readDeskPeople: (input) => readDeskPeople(input),
    readPerson: (staffId) => readDeskPerson(staffId),
    readRolePermissions: (roles) => readRolePermissions(roles),
    readReads: (chatIds) => readReads(chatIds),
    lastNudges: (numbers) => lastNudges(numbers),
    lastTurnAt: async (e164) => (await readHelperChat(e164)).lastTurnAt,
    send: (body) =>
      provider
        ? provider.send(body)
        : Promise.resolve({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "WhatsApp is not set up here." }),
    createGoLink: (input) => createGoLink({ ...input, purpose: "chats" }),
    recordNudge: (row) => recordNudge(row),
    updateChat: (id, patch, guard) => updateChat(id, patch, guard),
  };
}

const MINUTE = 60_000;
/** Where a nudge's link opens: the person's whole Chats section, waiting chats first. */
const CHATS_PATH = "/chats";
const OFF_CODES: ReadonlySet<string> = new Set(["feature_off", "not_configured", "sending_off"]);

export type NudgeCounts = Record<string, number>;

type Group = {
  person: DeskPerson;
  practice: boolean;
  /** The chats due now that this person is told about. */
  due: ChatRow[];
  passedUp: boolean;
  /** The year a practice chat lives in, for the link. */
  sessionLabel: string;
};

type Sent = { status: NudgeRecord["status"]; via: NudgeRecord["via"]; reason: string | null; messageId: string | null; off: boolean };

function stopped(verdict: PolicyVerdict): { reason: string; off: boolean } | null {
  if (verdict.decision === "send") return null;
  if (verdict.decision === "dry_run") return { reason: "practice_mode", off: true };
  return { reason: verdict.code, off: OFF_CODES.has(verdict.code) };
}

function sendFailure(result: Exclude<ProviderSendResult, { outcome: "accepted" }>): string {
  return result.outcome === "unknown" ? `send_unknown:${result.errorCode}` : `send_rejected:${result.errorCode ?? result.httpStatus}`;
}

/** "Riya · Class 6": what each waiting chat is about, for the nudge's list. */
function aboutOf(chat: ChatRow): string {
  return (chat.studentLabel?.split(",")[0]?.trim() || chat.fromName || "-").slice(0, 60);
}

const time = (value: string | null): number => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
};

/** One person's nudge: typed when their chat is open, else the approved message with the button, else the approved digest. */
async function sendNudge(
  input: { to: string; person: DeskPerson; waiting: number; about: string[]; link: GoLink; passedUp: boolean; practice: boolean },
  ctx: { switches: WhatsAppSwitches | null; config: WhatsAppConfig; now: Date; deps: ChatNudgeDeps },
): Promise<Sent> {
  const { to, person, link, deps } = { ...input, deps: ctx.deps };
  const language: NudgeLanguage = person.language;
  const lastTurn = await deps.lastTurnAt(to).catch(() => null);
  if (windowOpen(lastTurn, ctx.now)) {
    const verdict = checkWhatsAppSend({ feature: "parent_helper", to, switches: ctx.switches, config: ctx.config, kind: "text", wroteInLast24h: true });
    const no = stopped(verdict);
    if (no) return { status: "skipped", via: "text", reason: no.reason, messageId: null, off: no.off };
    const text = nudgeText({
      language,
      name: person.name,
      waiting: input.waiting,
      about: input.about,
      link: link.url,
      passedUp: input.passedUp,
      practice: input.practice,
    });
    const sent = await deps.send(textMessageBody(to, text)).catch(
      (): ProviderSendResult => ({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "The send did not finish." }),
    );
    if (sent.outcome === "accepted") return { status: "sent", via: "text", reason: null, messageId: sent.messageId, off: false };
    if (!(sent.outcome === "rejected" && sent.errorCode === "window_closed")) {
      return { status: "failed", via: "text", reason: sendFailure(sent), messageId: null, off: false };
    }
    // Meta says their chat closed after all: an approved message instead.
  }

  // The chats' own message, with its "Open chats" button, once Meta has approved it.
  const open = await deps.readTemplateRow(OPEN_ONE_TEMPLATE[language]);
  const openVerdict = checkWhatsAppSend({
    feature: "parent_helper",
    to,
    switches: ctx.switches,
    config: ctx.config,
    kind: "template",
    template: open,
    language,
    bodyParamCount: CHAT_TEMPLATE_PARAMS.openOne,
    hasDocument: false,
    hasUrlButton: true,
  });
  let body: Record<string, unknown> | null = null;
  if (openVerdict.decision === "send" && open) {
    body = templateMessageBody({
      to,
      name: open.provider_name,
      languageCode: open.language_code,
      bodyParams: openOneParams({ language, name: person.name, waiting: input.waiting }),
      urlButtonSuffix: link.code,
    });
  } else {
    // Until then: the approved "Your staff alerts", the link in its words.
    const digest = await deps.readTemplateRow(staffHubName("digest", language, 2));
    const verdict = checkWhatsAppSend({
      feature: "parent_helper",
      to,
      switches: ctx.switches,
      config: ctx.config,
      kind: "template",
      template: digest,
      language,
      bodyParamCount: 4,
      hasDocument: false,
      hasUrlButton: false,
    });
    const no = stopped(verdict);
    if (no || !digest) return { status: "skipped", via: "template", reason: no?.reason ?? "no_template", messageId: null, off: no?.off ?? false };
    body = templateMessageBody({
      to,
      name: digest.provider_name,
      languageCode: digest.language_code,
      bodyParams: digestParams({ language, name: person.name, waiting: input.waiting, link: link.url, passedUp: input.passedUp }),
    });
  }
  const sent = await deps.send(body).catch(
    (): ProviderSendResult => ({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "The send did not finish." }),
  );
  if (sent.outcome === "accepted") return { status: "sent", via: "template", reason: null, messageId: sent.messageId, off: false };
  return { status: "failed", via: "template", reason: sendFailure(sent), messageId: null, off: false };
}

/** The patch that moves a chat past the step that just ran, and the guard that keeps it from undoing a newer change. */
function advance(chat: ChatRow, step: NudgeStep, now: Date): { patch: ChatRowPatch; guard: ChatGuard } {
  const next = nudgeAfter(step, { at: now, desk: chat.desk, waitingSince: chat.waitingSince ? new Date(chat.waitingSince) : null });
  const stamp = now.toISOString();
  const patch: ChatRowPatch = { nudge_step: next?.step ?? null, next_nudge_at: next?.at.toISOString() ?? null };
  if (step === "first") patch.nudged_at = stamp;
  if (step === "remind") patch.reminded_at = stamp;
  if (step === "pass_up") patch.passed_up_at = stamp;
  return { patch, guard: { status: "waiting", next_nudge_at: chat.nextNudgeAt } };
}

/** The due nudges, inside the job's time. Never throws. */
export async function runChatNudges(deps: ChatNudgeDeps, options: { limit?: number } = {}): Promise<NudgeCounts> {
  const counts: NudgeCounts = { taken: 0, sent: 0, skipped: 0, failed: 0, later: 0 };
  try {
    const ids = await deps.takeDue(options.limit ?? 40);
    counts.taken = ids.length;
    if (ids.length === 0) return counts;
    const now = deps.now();
    const chats = (await deps.readChats(ids)).filter((chat) => chat.status === "waiting" && chat.nudgeStep !== null);
    const settings = await deps.readSettings().catch(() => null);

    // Chats, or their nudges, switched off: nothing more is planned for these.
    if (!settings?.enabled || !settings.nudges) {
      for (const chat of chats) {
        await deps.updateChat(chat.id, { nudge_step: null, next_nudge_at: null }, { status: "waiting", next_nudge_at: chat.nextNudgeAt }).catch(() => false);
      }
      counts.off = chats.length;
      return counts;
    }

    // Never at night: each waits for the morning, its step unchanged.
    const morning = nextAlertMoment(now);
    if (morning.getTime() > now.getTime()) {
      for (const chat of chats) {
        await deps.updateChat(chat.id, { next_nudge_at: morning.toISOString() }, { status: "waiting", next_nudge_at: chat.nextNudgeAt }).catch(() => false);
      }
      counts.later = chats.length;
      return counts;
    }

    const switches = await deps.readSwitches().catch(() => null);
    const config = deps.readConfig();
    const owner = toE164(switches?.ownerTestNumber ?? "");
    const reads = await deps.readReads(chats.map((chat) => chat.id)).catch(() => []);

    // Who hears about each chat, gathered into one message per person.
    const groups = new Map<string, Group>();
    const audience = new Map<string, string[]>();
    for (const chat of chats) {
      const step = chat.nudgeStep as NudgeStep;
      let people: DeskPerson[];
      try {
        if (nudgeAudience(step) === "admins") {
          people = await deps.readDeskPeople({ desk: chat.desk, classTeacherId: chat.classTeacherId, wantsAdmin: chat.wantsAdmin, sessionLabel: chat.sessionLabel, admins: true });
        } else if (chat.takenBy) {
          const taker = await deps.readPerson(chat.takenBy);
          people = taker ? [taker] : [];
        } else {
          people = await deps.readDeskPeople({ desk: chat.desk, classTeacherId: chat.classTeacherId, wantsAdmin: chat.wantsAdmin, sessionLabel: chat.sessionLabel, admins: false });
        }
      } catch {
        people = [];
      }
      // Practice: one person, told on the owner's own number.
      if (chat.practice) people = people.slice(0, 1);
      // Someone who has read the parent's newest message in One is on it already: no first nudge for them.
      if (step === "first") {
        people = people.filter(
          (person) => !reads.some((read) => read.chatId === chat.id && read.staffId === person.staffId && time(read.readAt) >= time(chat.lastParentAt)),
        );
      }
      audience.set(chat.id, people.map((person) => person.staffId));
      for (const person of people) {
        const key = `${chat.practice ? "p" : "r"}:${person.staffId}`;
        const group = groups.get(key) ?? { person, practice: chat.practice, due: [], passedUp: false, sessionLabel: chat.sessionLabel };
        group.due.push(chat);
        group.passedUp = group.passedUp || step === "pass_up";
        groups.set(key, group);
      }
    }

    // What each person's own Chats list shows waiting, so the count is the one they will see.
    const waitingBy = new Map<boolean, ChatRow[]>();
    for (const practice of new Set([...groups.values()].map((group) => group.practice))) {
      waitingBy.set(practice, await deps.readWaiting(practice).catch(() => []));
    }
    const permissions = await deps.readRolePermissions([...new Set([...groups.values()].map((group) => group.person.role))]).catch(() => new Map<string, string[]>());
    const numbers = [...groups.values()].map((group) => (group.practice ? owner : group.person.e164)).filter((n): n is string => Boolean(n));
    const last = await deps.lastNudges(numbers).catch(() => new Map<string, string>());

    const told = new Set<string>();
    const tooSoon = new Map<string, number>();
    const ctx = { switches, config, now, deps };
    for (const group of groups.values()) {
      const { person, practice } = group;
      const to = practice ? owner : person.consented ? person.e164 : null;
      const record = (sent: Omit<NudgeRecord, "staffId" | "toE164" | "kind" | "chatIds" | "practice" | "waiting">, waiting: number) =>
        to
          ? deps
              .recordNudge({
                ...sent,
                staffId: person.staffId,
                toE164: to,
                kind: group.passedUp ? "pass_up" : group.due.some((chat) => chat.nudgeStep === "remind") ? "remind" : "first",
                chatIds: group.due.map((chat) => chat.id),
                practice,
                waiting,
              })
              .catch(() => undefined)
          : Promise.resolve();
      if (!to) {
        counts.skipped += 1;
        // A number on file without their yes is written down; no number at all cannot be.
        if (person.e164 && !practice) await deps.recordNudge({ staffId: person.staffId, toE164: person.e164, kind: "first", chatIds: group.due.map((chat) => chat.id), waiting: group.due.length, via: "none", status: "skipped", reason: "no_consent", messageId: null, practice }).catch(() => undefined);
        continue;
      }
      // Half an hour between two nudges to one person: what is due waits for it.
      const lastAt = last.get(nudgeKey(to, person.staffId)) ?? null;
      if (!mayNudgeAgain(lastAt, now)) {
        const free = time(lastAt) + NUDGE_GAP_MINUTES * MINUTE;
        for (const chat of group.due) tooSoon.set(chat.id, Math.min(tooSoon.get(chat.id) ?? Number.POSITIVE_INFINITY, free));
        counts.later += 1;
        continue;
      }

      const viewer = viewerOfPerson(person, permissions, practice);
      const theirs = (waitingBy.get(practice) ?? []).filter(
        (chat) => chat.status === "waiting" && chatVisible(viewer, chat) && isForYou(viewer, chat),
      );
      const all = [...group.due, ...theirs.filter((chat) => !group.due.some((due) => due.id === chat.id))];
      const link = await deps.createGoLink({ path: CHATS_PATH, staffId: person.staffId, sessionLabel: group.sessionLabel }).catch(() => null);
      if (!link) {
        counts.failed += 1;
        await record({ via: "none", status: "failed", reason: "no_link", messageId: null }, all.length);
        continue;
      }
      const sent = await sendNudge({ to, person, waiting: all.length, about: all.map(aboutOf), link, passedUp: group.passedUp, practice }, ctx).catch(
        (): Sent => ({ status: "failed", via: "none", reason: "send_crashed", messageId: null, off: false }),
      );
      await record({ via: sent.via, status: sent.status, reason: sent.reason, messageId: sent.messageId }, all.length);
      counts[sent.status] = (counts[sent.status] ?? 0) + 1;
      if (sent.status === "sent") for (const chat of group.due) told.add(chat.id);
    }

    // Each chat moves on: past its step when anyone was told or nobody could be, or to the end of the half hour when everyone was told too recently.
    for (const chat of chats) {
      const step = chat.nudgeStep as NudgeStep;
      const people = audience.get(chat.id) ?? [];
      const wait = tooSoon.get(chat.id);
      if (!told.has(chat.id) && wait !== undefined && people.length > 0) {
        await deps.updateChat(chat.id, { next_nudge_at: new Date(Math.max(wait, now.getTime() + MINUTE)).toISOString() }, { status: "waiting", next_nudge_at: chat.nextNudgeAt }).catch(() => false);
        continue;
      }
      const { patch, guard } = advance(chat, step, now);
      await deps.updateChat(chat.id, patch, guard).catch(() => false);
    }
    logInfo("chats.nudges", counts);
    return counts;
  } catch (caught) {
    logWarn("chats.nudges_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    counts.crashed = 1;
    return counts;
  }
}
