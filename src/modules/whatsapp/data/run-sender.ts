import "server-only";

import { recordActivity } from "@/modules/activity/data/events";
import {
  DELIVERY_UNKNOWN_PREFIX,
  payNowButton,
  sendAisensyCampaignMessage,
} from "@/modules/whatsapp/data/aisensy";
import { closeRun, openRun } from "@/modules/whatsapp/data/campaign-store";
import { approvedV6Campaign, v6HeadlineAmount } from "@/modules/whatsapp/domain/campaign-bodies-v6";
import {
  campaignFor,
  type CampaignDescriptor,
} from "@/modules/whatsapp/domain/campaigns";
import {
  groupIntoFamilies,
  type ReminderFamily,
} from "@/modules/whatsapp/domain/family-grouping";
import {
  chooseFamilyCampaign,
  familyNoticeValuesFor,
} from "@/modules/whatsapp/domain/family-notice";
import {
  noticeValuesFor,
  type ReminderCandidate,
  type ReminderFilters,
} from "@/modules/whatsapp/domain/fee-reminders";
import { randomBytes } from "node:crypto";

import { isTestAcademicSessionLabel } from "@/platform/config/fee-rules";
import { isoFromDdMmYyyy } from "@/platform/helpers/date";
import { isMissingColumn } from "@/platform/supabase/missing-column";
import { fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { crossCampaignSince, familyMessagedRecently } from "@/modules/whatsapp/domain/cross-campaign-dedupe";
import {
  familyHoldsFeesPayCode,
  loadFeesPayCodeHolders,
  type FeesPayCodeHolders,
} from "@/modules/whatsapp/data/fees-pay-codes";

import { classifyFailure } from "@/modules/whatsapp/domain/failure-cause";
import { lateFeePhrase } from "@/modules/whatsapp/domain/late-fee";
import { splitHoldout } from "@/modules/whatsapp/domain/run-measurement";

/**
 * One reminder run, from opening the record to closing it.
 *
 * Extracted from `sendRemindersAction` the moment a second way to start a run
 * appeared — the scheduled cron. The cron is required to apply every guard the
 * manual path applies, and the only way that stays true as both grow is if
 * there is ONE executor and both callers reach it. Two copies would drift
 * exactly the way the filter parser and the notice-values mapping drifted
 * before, and the failure here reaches real parents.
 *
 * The guards themselves are NOT here. They are pure, they live in
 * `domain/send-guards`, and each caller evaluates them before calling this —
 * because the cron reports a refusal to a log and the action reports it to a
 * person, and those are different jobs.
 *
 * Everything about who gets what message is decided upstream: this is handed a
 * finished candidate list and does the sending.
 */

/** How many families are messaged at once. */
const SEND_CONCURRENCY = 6;

export type ReminderRunOutcome = {
  runId: string | null;
  sent: number;
  failed: number;
  alreadySentToday: number;
  moneyQuoted: number;
  failures: Array<{ admissionNo: string; studentName: string; error: string }>;
  /** How many messages were actually billed, including second numbers. */
  messagesAttempted: number;
  /** Families deliberately not messaged, so the run has a control group. */
  heldOut: number;
  /**
   * Families the last-moment ledger check stopped: paid since the list was
   * built, or quoted a figure the ledger no longer agrees with. Zero unless
   * `recheckLedger` was passed (online payments switched on).
   */
  stoppedByLedger: number;
};

/**
 * The ledger's answer for one child's Pay now scope, read immediately before
 * dispatch. Null means it could not be read — and then nothing is sent with a
 * Pay now link, because a stale figure is worse than a late one.
 */
export type LedgerRecheck = (scope: {
  studentId: string;
  installments: number[];
  lastYear: boolean;
  situation: string;
}) => Promise<{ total: number; eligible: boolean; reasons: string[] } | null | "not_applicable">;

export type ExecuteReminderRunArgs = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  candidates: ReminderCandidate[];
  filters: ReminderFilters;
  sessionLabel: string;
  /** IST `YYYY-MM-DD`. */
  today: string;
  /** The notice's date, already validated by the guards. */
  lastDateIso: string | null;
  campaignName: string;
  /** The saved campaign this run came from, or null for an ad-hoc send. */
  campaignId: string | null;
  /** Null for a cron run, which is the honest record rather than a guess. */
  staffId: string | null;
  source: "manual" | "cron";
  /**
   * Hold back a random share of the audience, so the run has a control group.
   *
   * 0 means everybody is messaged, which is the default and the normal case. A
   * holdout means deliberately NOT chasing money the school is owed, in exchange
   * for the only causal number this system can produce — so it is a decision an
   * admin makes on purpose, per run, and never a setting that persists.
   */
  holdoutPercent?: number;
  /** Guard codes an admin agreed to override, and why. Written to the run. */
  overriddenGuards?: string[];
  overrideReason?: string | null;
  /**
   * Write the messaged families into the office's contact history.
   *
   * Injected rather than imported, and that is a layering decision rather than
   * taste: `defaulters/ui` already imports `whatsapp/domain/render`, so this
   * module importing `defaulters/data` closes a module cycle that
   * `npm run quality:architecture` counts and refuses. The APP layer may import
   * both, so both callers pass `insertDefaulterContacts` in.
   *
   * Optional, because a caller that does not want a contact log — a test, or a
   * future path that logs differently — should not have to fake one.
   */
  logContacts?: (
    rows: Array<{
      studentId: string;
      sessionLabel: string;
      channel: "whatsapp";
      outcome: "other";
      bulk: boolean;
      note: string;
    }>,
  ) => Promise<void>;
  /** The schedule slot this run satisfies, or null for an ad-hoc send. */
  scheduledFor: string | null;
  /**
   * Log what WOULD be sent and call nobody.
   *
   * No run is opened, no row is claimed and no provider call is made, so a dry
   * run is free and leaves no trace. It exists so the cron can be pointed at
   * production and read before it is trusted with it.
   */
  dryRun?: boolean;
  /**
   * Fold siblings on one phone into ONE message.
   *
   * On by default; the callers read `app_settings.whatsapp_one_message_per_family`
   * (`data/reminder-settings.ts`) so the office can switch it off without a
   * deploy. On means the family template where one exists
   * (`domain/family-notice.ts`) and the spokesperson's notice otherwise, with
   * `covered_by_sibling` rows for the rest. Off means one message per child,
   * each child's own figure — how every run before 2026-09-05 went.
   */
  oneMessagePerFamily?: boolean;
  /**
   * Re-quote each one-child Pay now message from the ledger just before it is
   * sent. Passed by both callers when online payments are switched on; without
   * it the run behaves exactly as it did before online payments existed.
   */
  recheckLedger?: LedgerRecheck;
};

export async function executeReminderRun(
  args: ExecuteReminderRunArgs,
): Promise<ReminderRunOutcome> {
  const {
    supabase,
    candidates,
    filters,
    sessionLabel,
    today,
    lastDateIso,
    campaignName,
    campaignId,
    staffId,
    source,
    scheduledFor,
    dryRun = false,
    logContacts,
    holdoutPercent = 0,
    overriddenGuards = [],
    overrideReason = null,
    oneMessagePerFamily = true,
    recheckLedger,
  } = args;

  // Anyone already logged today is counted and never grouped.
  //
  // Since 2026-09-04 one notice logs under TWO campaign names — per-child for a
  // one-child phone, family for siblings — and the unique index that stops a
  // second message only knows one name at a time. A sibling who paid at noon
  // leaves a two-child family as a one-child one, and a second run would claim
  // a fresh per-child row for a parent who read the family message this
  // morning. `sentToday` is read against both names, so this is what sees it.
  // A true same-second race between two staff still lands on the index.
  const fresh = candidates.filter((candidate) => !candidate.sentToday);
  const alreadyLoggedToday = candidates.length - fresh.length;

  // Split BEFORE grouping into families, so a held-out student cannot arrive as
  // a sibling on somebody else's message. Splitting after would mean a "held
  // out" family still got messaged, which is worse than not running the
  // experiment at all.
  const { messaged: toMessage, heldOut } = splitHoldout(fresh, holdoutPercent);

  // One phone, one message. Grouping happens here rather than in the audience
  // so the screen keeps showing, ticking and skipping per child.
  //
  // With `oneMessagePerFamily` off every child is a "family" of one: their own
  // message, their own figure, their own row. The family shape is still used
  // because it is what carries the language rule and the second-number
  // escalation.
  const members = toMessage.map((candidate) => ({
    studentId: candidate.studentId,
    studentName: candidate.studentName,
    studentClass: candidate.studentClass,
    parentName: candidate.parentName,
    destination: candidate.destination,
    dueAmount: candidate.dueAmount,
    preferredLanguage: candidate.preferredLanguage,
    sentCount: candidate.sentCount,
    secondaryDestination: candidate.secondaryDestination,
    familyKey: candidate.familyKey,
  }));
  const families = oneMessagePerFamily
    ? groupIntoFamilies(members, filters.language)
    : members.flatMap((member) => groupIntoFamilies([member], filters.language));

  const messagesAttempted = families.reduce(
    (total, family) => total + family.destinations.length,
    0,
  );

  if (dryRun) {
    return {
      runId: null,
      sent: 0,
      failed: 0,
      alreadySentToday: alreadyLoggedToday,
      moneyQuoted: families.reduce((total, family) => total + family.totalAmount, 0),
      failures: [],
      messagesAttempted,
      heldOut: heldOut.length,
      stoppedByLedger: 0,
    };
  }

  // Opened BEFORE the first message. A crash halfway through then leaves a run
  // that says what was attempted, rather than no record at all — and `run_id` is
  // stamped on each send as it is claimed, so the rows are grouped even if this
  // never reaches its own end.
  const runId = await openRun(supabase, {
    campaignId,
    sessionLabel,
    campaignName,
    situation: filters.situation,
    language: filters.language,
    filters: {
      installments: filters.installments,
      lastYear: filters.lastYear,
      installmentMatch: filters.installmentMatch,
      paid: filters.paid,
      minDueAmount: filters.minDueAmount,
      lateFee: filters.lateFee,
      promise: filters.promise,
      skipOverdue: filters.skipOverdue,
      classId: filters.classId,
      includeRte: filters.includeRte,
    },
    lastDate: lastDateIso,
    // The phrase as it went out, not the amount and basis it came from: the
    // campaign is editable and what a parent read is not.
    lateFeePhrase: lateFeePhrase(filters.lateFeeAmount, filters.lateFeeBasis, filters.language),
    selectedCount: candidates.length,
    startedBy: staffId,
    source,
    scheduledFor,
    overriddenGuards,
    overrideReason,
  });

  // Recorded before the first message, so a crash halfway through still leaves
  // the record of who was deliberately not contacted. Best-effort: a failed
  // holdout write must not stop the run.
  if (heldOut.length > 0) {
    try {
      await supabase.from("whatsapp_run_holdouts").insert(
        heldOut.map((candidate) => ({ run_id: runId, student_id: candidate.studentId })),
      );
    } catch (caught) {
      console.warn("[whatsapp-reminders] holdout record failed", caught);
    }
  }

  let sent = 0;
  let failed = 0;
  let alreadySentToday = alreadyLoggedToday;
  let moneyQuoted = 0;
  let stoppedByLedger = 0;
  const failures: ReminderRunOutcome["failures"] = [];
  const sentStudentIds: string[] = [];

  const byStudentId = new Map(toMessage.map((candidate) => [candidate.studentId, candidate]));

  // One only: every send this family had in the window, whatever its campaign
  // name (critique0 #11). Read once for the run; null means it could not be
  // read, and then nobody in a real session is messaged.
  const latestSentOn = isTestAcademicSessionLabel(sessionLabel)
    ? undefined
    : await loadLatestSends(supabase, toMessage.map((candidate) => candidate.studentId), today);

  // One only (critique0 #4): families who can still pay through a Pay now
  // link the fees app sent get the text-only notice, never a second, One
  // Pay now for the same money. Null (could not tell): nobody gets Pay now.
  // A TEST session has no fees links of its own to collide with.
  const feesPayCodes = isTestAcademicSessionLabel(sessionLabel)
    ? undefined
    : await loadFeesPayCodeHolders(supabase, {
        studentIds: toMessage.map((candidate) => candidate.studentId),
        destinations: toMessage.flatMap((candidate) =>
          [candidate.destination, candidate.secondaryDestination].filter((value): value is string => Boolean(value)),
        ),
        today,
      });
  if (feesPayCodes === null) {
    console.warn("[whatsapp-reminders] could not read the fees app's pay codes; this run sends no Pay now button");
  }

  for (let index = 0; index < families.length; index += SEND_CONCURRENCY) {
    const batch = families.slice(index, index + SEND_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((family) =>
        sendFamily({
          supabase,
          family,
          byStudentId,
          filters,
          sessionLabel,
          today,
          staffId,
          runId,
          recheckLedger,
          latestSentOn,
          feesPayCodes,
        }),
      ),
    );
    for (const outcome of outcomes) {
      sent += outcome.sent;
      failed += outcome.failed;
      alreadySentToday += outcome.already;
      moneyQuoted += outcome.moneyQuoted;
      stoppedByLedger += outcome.stoppedByLedger;
      sentStudentIds.push(...outcome.sentStudentIds);
      failures.push(...outcome.failures);
    }
  }

  await closeRun(supabase, runId, { sent, failed, already: alreadySentToday, moneyQuoted });

  // The office's contact history, so a reminder shows on the student's profile.
  // Best-effort: the message has already gone, and a logging hiccup must not be
  // reported as a failed send. One round trip, not one per family.
  try {
    await logContacts?.(
      sentStudentIds.map((studentId) => ({
        studentId,
        sessionLabel,
        channel: "whatsapp" as const,
        outcome: "other" as const,
        // A broadcast, not a conversation. Without this every messaged family
        // reads as "contacted in the last six hours" and drops out of the
        // collectors' Now bucket — a 171-family run emptied the call list for
        // the rest of the day.
        bulk: true,
        note: `WhatsApp fee reminder sent (${campaignName})`,
      })),
    );
  } catch (caught) {
    console.warn("[whatsapp-reminders] contact log failed", caught);
  }

  try {
    await recordActivity({
      userId: staffId,
      kind: "defaulter_contacted",
      payload: {
        channel: "whatsapp",
        outcome: "other",
        wabulk: true,
        provider: "aisensy",
        campaignName,
        source,
        count: sent,
        failed,
        sessionLabel,
      },
    });
  } catch (caught) {
    console.warn("[whatsapp-reminders] activity log failed", caught);
  }

  return {
    runId,
    sent,
    failed,
    alreadySentToday,
    moneyQuoted,
    failures,
    messagesAttempted,
    heldOut: heldOut.length,
    stoppedByLedger,
  };
}

/**
 * A message ready to go: which campaign, the values in slot order, and the
 * figure it quotes. Built once per family by `sendFamily`, so a second handset
 * gets the same message and the send log records exactly what went.
 */
type PreparedMessage = {
  campaignName: string;
  templateParams: string[];
  dueAmount: number;
  /**
   * True for a template carrying the Pay now URL button (`_v6`). `sendOne`
   * fills its suffix with the pay code it mints for this very send, so the link
   * opens on exactly the figure this message quoted.
   */
  payButton?: boolean;
  /**
   * What the Pay now link covers, from the numbers that built the message.
   * Written to the send row; the pay page re-quotes it from the ledger.
   */
  payScope?: {
    studentIds: string[];
    installments: number[];
    lastYear: boolean;
    situation: string;
    amount: number;
  };
};

type SendOutcome =
  // The provider id travels back so the siblings' `covered_by_sibling` rows can
  // carry the id of the message that actually reached their family.
  | { kind: "sent"; providerMessageId: string | null }
  | { kind: "already" }
  | { kind: "failed"; error: string };

type FamilyOutcome = {
  sent: number;
  failed: number;
  already: number;
  moneyQuoted: number;
  stoppedByLedger: number;
  sentStudentIds: string[];
  failures: ReminderRunOutcome["failures"];
};

const EMPTY_FAMILY_OUTCOME = (): FamilyOutcome => ({
  sent: 0,
  failed: 0,
  already: 0,
  moneyQuoted: 0,
  stoppedByLedger: 0,
  sentStudentIds: [],
  failures: [],
});

/**
 * One family, one message — and one send-log row per child regardless.
 *
 * The row per child is not bookkeeping for its own sake. The unique index is
 * keyed on `student_id`, the cadence gap is measured from it, and
 * `v_whatsapp_run_outcomes` joins payments to it. A family messaged once but
 * logged once would leave the siblings looking un-contacted tomorrow and get
 * them messaged again.
 *
 * So the siblings get `covered_by_sibling` rows carrying the SAME
 * `provider_message_id` as the message that actually went. No provider call is
 * made for them, they cost nothing, and the screen can say why they were not
 * messaged separately.
 *
 * Which message goes is decided by `chooseFamilyCampaign`: the family template
 * (`vpps_app_family_*`, Live since 2026-09-04) for a phone with two or more
 * children on a notice it can be filled for, otherwise the spokesperson's
 * ordinary per-child notice — the largest debt on the phone. Either way the
 * rows below carry the name of the message that actually went, so the bill can
 * be reconciled per campaign and "already messaged today" reads true.
 *
 * With `oneMessagePerFamily` switched off every family arriving here has
 * exactly one member, so this is simply "one child, one message".
 */
async function sendFamily(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  family: ReminderFamily;
  byStudentId: Map<string, ReminderCandidate>;
  filters: ReminderFilters;
  sessionLabel: string;
  today: string;
  staffId: string | null;
  runId: string | null;
  recheckLedger?: LedgerRecheck;
  /** Newest send per child under any campaign; undefined in a test session, null when unreadable. */
  latestSentOn?: ReadonlyMap<string, string> | null;
  /** Fees pay codes still payable; undefined in a test session, null when unreadable. */
  feesPayCodes?: FeesPayCodeHolders | null;
}): Promise<FamilyOutcome> {
  const { supabase, family, byStudentId, filters, sessionLabel, today, staffId, runId } = args;
  const outcome = EMPTY_FAMILY_OUTCOME();

  const spokesperson = byStudentId.get(family.spokesperson.studentId);
  if (!spokesperson) return outcome;

  // One only (critique0 #11): a family already messaged today, or inside its
  // cadence window, under ANY campaign — the fees app's `_v6` included — is
  // not messaged again. Counted as already sent, which is what it was.
  if (args.latestSentOn === null) {
    outcome.failed += 1;
    outcome.failures.push({
      admissionNo: spokesperson.admissionNo,
      studentName: spokesperson.studentName,
      error: "Could not read this family's earlier messages. Not sent.",
    });
    return outcome;
  }
  if (
    args.latestSentOn &&
    familyMessagedRecently({
      members: family.members.map((member) => ({
        studentId: member.studentId,
        cadence: byStudentId.get(member.studentId)?.cadence,
      })),
      latestSentOn: args.latestSentOn,
      today,
    })
  ) {
    outcome.already += 1;
    return outcome;
  }

  // Resolved per FAMILY, not per run: a family who reads English gets the
  // English campaign out of a Hindi run. The run's language is the default that
  // applies to everyone who has never said.
  let campaign: CampaignDescriptor;
  try {
    campaign = campaignFor(filters.situation, family.language);
  } catch (caught) {
    outcome.failed += 1;
    outcome.failures.push({
      admissionNo: spokesperson.admissionNo,
      studentName: spokesperson.studentName,
      error: caught instanceof Error ? caught.message : "No campaign for that notice.",
    });
    return outcome;
  }

  // The family's own language decides the phrase too, or an English family would
  // read a Hindi late-fee line inside an English message.
  const familyFilters: ReminderFilters = { ...filters, language: family.language };

  // Built ONCE per family, before any number is dialled: both handsets get the
  // same message, and the send log's `template_params` is what went, not what
  // would have gone had the amounts moved between the two.
  const familyCampaign = chooseFamilyCampaign(family, filters.situation);
  // `_v6` first, once Meta has approved it: ONE template for one child or
  // several, quoting the phone's total, with a Pay now button. Every member's
  // values come from the same `noticeValuesFor` the per-child path uses, so
  // the figures cannot mean something different in the family message.
  //
  // One only (critique0 #4): not for a family that can still pay through a
  // fees app link — they get the earlier text-only notice instead.
  const holdsFeesPayCode =
    args.feesPayCodes !== undefined &&
    familyHoldsFeesPayCode(args.feesPayCodes, {
      studentIds: family.members.map((member) => member.studentId),
      destinations: family.destinations.map((target) => target.destination),
    });
  const v6 = holdsFeesPayCode ? null : approvedV6Campaign(filters.situation, family.language);
  const memberValues = v6
    ? family.members
        .map((member) => byStudentId.get(member.studentId))
        .filter((candidate): candidate is ReminderCandidate => Boolean(candidate))
        .map((candidate) => noticeValuesFor(candidate, familyFilters))
    : [];
  const v6Params = v6
    ? v6.buildFamilyParams(memberValues, {
        lateFeeSource: familyFilters.lateFeeSource,
        policyLateFeeAmount: familyFilters.policyLateFeeAmount,
        lateFeeAmount: familyFilters.lateFeeAmount,
        lateFeeBasis: familyFilters.lateFeeBasis,
        lastYear: familyFilters.lastYear,
      })
    : [];
  // The figure slot 1 prints, as the number it was formatted from — never
  // parsed back out of the text. It was the selected tiles' fees once, so a
  // Balance notice said "Rs. 23,250" and Pay now opened on ₹14,125.
  const v6Amount = v6 ? v6HeadlineAmount(filters.situation, memberValues) : 0;
  const message: PreparedMessage = v6
    ? {
        campaignName: v6.campaignName,
        templateParams: v6Params,
        dueAmount: v6Amount,
        payButton: v6.buttons.includes("pay_url"),
        payScope: {
          studentIds: family.members.map((member) => member.studentId),
          // The installments the message names for this phone, and last
          // session's balance when the run includes it and a child owes it.
          installments:
            filters.situation === "prevyear"
              ? []
              : [...new Set(memberValues.flatMap((values) => values.owedInstallments ?? []))].sort(
                  (a, b) => a - b,
                ),
          lastYear:
            filters.situation === "prevyear" ||
            (filters.lastYear === true &&
              memberValues.some((values) => Number(values.prevYearBalance ?? 0) > 0)),
          situation: filters.situation,
          amount: v6Amount,
        },
      }
    : familyCampaign
    ? {
        campaignName: familyCampaign.campaignName,
        templateParams: familyCampaign.buildParams(
          familyNoticeValuesFor(family, {
            lastDate: filters.lastDate,
            lateFeeAmount: filters.lateFeeAmount,
            lateFeeBasis: filters.lateFeeBasis,
          }),
        ),
        // The figure the message quotes: everyone on the phone, summed.
        dueAmount: family.totalAmount,
      }
    : {
        campaignName: campaign.campaignName,
        templateParams: campaign.buildParams(noticeValuesFor(spokesperson, familyFilters)),
        dueAmount: spokesperson.dueAmount,
      };

  // The last look at the ledger before a Pay now message goes, for the one-child
  // messages the pay page can take online. A family who paid since the list was
  // built is not chased; a figure the ledger no longer agrees with is not sent
  // — the office presses Send again and the list is rebuilt from the ledger.
  if (args.recheckLedger && message.payButton && message.payScope?.studentIds.length === 1) {
    const scope = message.payScope;
    const quote = await args.recheckLedger({
      studentId: scope.studentIds[0],
      installments: scope.installments,
      lastYear: scope.lastYear,
      situation: scope.situation,
    });
    const stop =
      quote === "not_applicable"
        ? null
        : quote === null
        ? "Could not re-check the ledger just before sending. Not sent."
        : quote.reasons.includes("nothing_due")
        ? "Paid since the list was built. Not sent."
        : quote.eligible && quote.total !== message.dueAmount
        ? "The amount changed since the list was built. Not sent — refresh and send again."
        : null;
    if (stop) {
      outcome.stoppedByLedger += 1;
      outcome.failures.push({
        admissionNo: spokesperson.admissionNo,
        studentName: spokesperson.studentName,
        error: stop,
      });
      return outcome;
    }
  }

  // Siblings are covered once, by the first number the message reached.
  let siblingsCovered = false;
  for (const target of family.destinations) {
    const result = await sendOne({
      supabase,
      candidate: spokesperson,
      message,
      filters: familyFilters,
      sessionLabel,
      today,
      staffId,
      runId,
      destination: target.destination,
      destinationRole: target.role,
      language: family.language,
    });

    if (result.kind === "sent") {
      outcome.sent += 1;
      // Counted ONCE per family, on the first number reached. A second number
      // reaching the same family is a second message, not a second debt.
      if (!siblingsCovered) {
        outcome.moneyQuoted += family.totalAmount;
        outcome.sentStudentIds.push(...family.members.map((member) => member.studentId));
      }
    } else if (result.kind === "already") {
      outcome.already += 1;
    } else {
      outcome.failed += 1;
      outcome.failures.push({
        admissionNo: spokesperson.admissionNo,
        studentName: spokesperson.studentName,
        error: result.error,
      });
    }

    // Siblings are recorded against the FIRST message that went — the primary
    // normally. When the primary failed and the second parent's number got it,
    // the siblings were still reached; recording them only on a primary success
    // left them selectable, and the retry messaged just them.
    if (result.kind === "sent" && !siblingsCovered) {
      siblingsCovered = true;
      await recordSiblingCoverage({
        supabase,
        family,
        byStudentId,
        campaignName: message.campaignName,
        providerMessageId: result.providerMessageId,
        sessionLabel,
        today,
        staffId,
        runId,
      });
    }
  }

  return outcome;
}

/**
 * The siblings who were reached without being messaged.
 *
 * Best-effort and deliberately after the send: the parent already has the
 * message, and a bookkeeping hiccup must not be reported as a failed send. A
 * unique violation here is the normal "already logged today" case, not an error.
 */
async function recordSiblingCoverage(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  family: ReminderFamily;
  byStudentId: Map<string, ReminderCandidate>;
  campaignName: string;
  providerMessageId: string | null;
  sessionLabel: string;
  today: string;
  staffId: string | null;
  runId: string | null;
}): Promise<void> {
  const rows = args.family.covered
    .map((member) => args.byStudentId.get(member.studentId))
    .filter((candidate): candidate is ReminderCandidate => Boolean(candidate))
    .map((candidate) => ({
      student_id: candidate.studentId,
      session_label: args.sessionLabel,
      sent_on: args.today,
      campaign_name: args.campaignName,
      destination: args.family.destination,
      due_amount: candidate.dueAmount,
      template_params: [],
      status: "covered_by_sibling",
      // The same id as the message that actually went, which is what ties the
      // family back together on the run page.
      provider_message_id: args.providerMessageId,
      language: args.family.language,
      destination_role: "primary",
      sent_by: args.staffId,
      run_id: args.runId,
    }));

  if (rows.length === 0) return;

  try {
    await args.supabase.from("whatsapp_reminder_sends").insert(rows);
  } catch (caught) {
    console.warn("[whatsapp-reminders] sibling coverage log failed", caught);
  }
}


async function sendOne(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  candidate: ReminderCandidate;
  /** Already built by `sendFamily`: the campaign that is going, and its params. */
  message: PreparedMessage;
  filters: ReminderFilters;
  sessionLabel: string;
  today: string;
  staffId: string | null;
  /** Null when the run record could not be opened; the send still happens. */
  runId: string | null;
  /**
   * The number this copy goes to. Defaults to the candidate's own, and differs
   * only when a family is being reached on the second parent's handset.
   */
  destination?: string;
  destinationRole?: "primary" | "secondary";
  /** The family's language, which the run's default only sometimes matches. */
  language?: string;
}): Promise<SendOutcome> {
  const { supabase, candidate, message, filters, sessionLabel, today, staffId, runId } = args;
  const destination = args.destination ?? candidate.destination;
  const destinationRole = args.destinationRole ?? "primary";
  // Seven slots on a per-child notice, five on a family one. A count that does
  // not match is refused by AiSensy with "Template params does not match the
  // campaign", which is why the registry owns both the count and the order and
  // `sendFamily` built these before this was called.
  const { campaignName, templateParams } = message;

  // The opaque code behind this message's pay link.
  //
  // 160 bits from the platform CSPRNG, per send. Never derived from the student
  // or the receipt: a code that could be computed from an admission number would
  // let anyone enumerate what every family owes. It expires with the notice,
  // because the amount it quotes is the amount that was owed when the message
  // went out.
  const payCode = randomBytes(20).toString("base64url");

  // Claim the day BEFORE calling the provider. Two staff members working the
  // same list at the same time collide on the unique index here, and the loser
  // never reaches AiSensy — rather than both passing a check-then-send.
  const claimRow = {
    student_id: candidate.studentId,
    session_label: sessionLabel,
    sent_on: today,
    campaign_name: campaignName,
    destination,
    // What the MESSAGE quotes: one child's figure, or the family's total.
    due_amount: message.dueAmount,
    template_params: templateParams,
    status: "pending",
    // What actually went out, not the run default. Answering "which language
    // did this parent get" from the run record would be a guess.
    language: args.language ?? filters.language,
    destination_role: destinationRole,
    pay_code: payCode,
    pay_code_expires_on: lastDateIsoFor(filters, candidate),
    pay_scope: message.payScope ?? null,
    sent_by: staffId,
    // Stamped on the claim, so the grouping survives even if this action dies
    // before it can close the run. NOT part of the unique index — that index
    // is what stops a family being messaged the same notice twice in one day,
    // and including run_id would let a second run that day repeat all of them.
    run_id: runId,
  };
  const claimWith = (row: Record<string, unknown>) =>
    supabase.from("whatsapp_reminder_sends").insert(row).select("id").single();
  let { data: claim, error: claimError } = await claimWith(claimRow);
  // A deployment that landed before `20261028140100` has no `pay_scope`
  // column. The reminder still goes; the pay page offers UPI as it always did.
  if (isMissingColumn(claimError, "pay_scope")) {
    const { pay_scope: _payScope, ...withoutScope } = claimRow;
    void _payScope;
    ({ data: claim, error: claimError } = await claimWith(withoutScope));
  }

  let claimId: string | null = claim?.id ?? null;
  if (claimError) {
    if (claimError.code !== "23505") {
      return { kind: "failed", error: `Could not claim send slot: ${claimError.message}` };
    }
    // Today's slot is taken. If what took it is a FAILED send, this is the
    // retry it needs: take the row back to pending with today's message and a
    // fresh pay code. Guarded on `status = 'failed'`, so two retries racing
    // each other still send once — the loser updates nothing and reads
    // "already". A failed row used to block the family for the rest of the
    // day, reported as "already had today's reminder" when nothing went.
    //
    // A SENT row WhatsApp later reported undelivered (`delivery_status =
    // 'failed'`, from the report or the webhook) is taken back too: it reached
    // nobody, exactly like a refusal. Nothing else that is `sent` ever is — an
    // acceptance with no report yet may well have arrived.
    //
    // In a TEST / UAT / DEMO session a SENT row is taken back too: once a day
    // protects parents, and a test session has none, while testing the pay
    // link needed a second message to the office's own number the same day.
    // A `pending` row is never taken — that is a send still in flight.
    //
    // In a real session a failure whose fate is unknown is NOT taken back: a
    // timeout or a 5xx can come after AiSensy accepted the message, and one
    // parent missed beats one parent messaged twice. Only a definite rejection
    // (or a sent row WhatsApp later reported undelivered) is retried. The fees
    // app retries every failed row; One differs here (D-352 (4)).
    //
    // The attempt counter, and clearing the previous message's delivery result,
    // are the database's job (`whatsapp_send_before_update`), and the earlier
    // attempt survives in `whatsapp_send_attempts`.
    const testSession = isTestAcademicSessionLabel(sessionLabel);
    const reclaimRow: Record<string, unknown> = {
      status: "pending",
      destination,
      due_amount: message.dueAmount,
      template_params: templateParams,
      language: args.language ?? filters.language,
      pay_code: payCode,
      pay_code_expires_on: lastDateIsoFor(filters, candidate),
      pay_scope: message.payScope ?? null,
      sent_by: staffId,
      run_id: runId,
      error_message: null,
      updated_at: new Date().toISOString(),
    };
    const reclaimWith = (values: Record<string, unknown>) => {
      const query = supabase
        .from("whatsapp_reminder_sends")
        .update(values)
        .eq("student_id", candidate.studentId)
        .eq("session_label", sessionLabel)
        .eq("sent_on", today)
        .eq("campaign_name", campaignName)
        .eq("destination_role", destinationRole);
      return (
        testSession
          ? query.in("status", ["failed", "sent"])
          : query.or(
              `and(status.eq.failed,or(error_message.is.null,error_message.not.like.${DELIVERY_UNKNOWN_PREFIX.trim()}*)),and(status.eq.sent,delivery_status.eq.failed)`,
            )
      ).select("id");
    };
    let { data: reclaimed, error: reclaimError } = await reclaimWith(reclaimRow);
    if (isMissingColumn(reclaimError, "pay_scope")) {
      const { pay_scope: _payScope, ...withoutScope } = reclaimRow;
      void _payScope;
      ({ data: reclaimed, error: reclaimError } = await reclaimWith(withoutScope));
    }
    const row = ((reclaimed ?? []) as Array<{ id: string }>)[0];
    if (!row) return { kind: "already" };
    claimId = row.id;
  }

  const result = await sendAisensyCampaignMessage({
    campaignName,
    destination,
    userName: candidate.parentName,
    templateParams,
    source: "vppsone/reminders",
    // A cron run has nobody behind it; a pressed Send has the staff member.
    gate: { kind: "fee_reminder", sessionLabel, actor: staffId ? { userId: staffId } : "system" },
    // The pay code just minted and claimed above, as the Pay now button's URL
    // suffix — so the page a parent opens is this send's own row.
    ...(message.payButton ? { buttons: [payNowButton(payCode)] } : {}),
  });

  // The cause is written WITH the status, in one update, because the database
  // trigger that records the attempt and marks a dead number reads both from
  // the same row change. A failure whose fate is unknown keeps One's
  // `delivery-unknown:` prefix, so it is never retried by the machine.
  const failureText = result.ok
    ? null
    : result.deliveryUnknown
      ? `${DELIVERY_UNKNOWN_PREFIX}${result.error}`
      : result.error;
  const outcomeRow: Record<string, unknown> = {
    status: result.ok ? "sent" : "failed",
    provider_message_id: result.ok ? result.messageId : null,
    error_message: failureText,
    last_error: failureText,
    failure_cause: result.ok
      ? null
      : classifyFailure({ text: result.error, httpStatus: result.status }),
    updated_at: new Date().toISOString(),
  };
  const writeOutcome = (values: Record<string, unknown>) =>
    supabase.from("whatsapp_reminder_sends").update(values).eq("id", claimId);
  const { error: outcomeError } = await writeOutcome(outcomeRow);
  // Before `20261030190000` there is no `failure_cause`: record the outcome as before.
  if (isMissingColumn(outcomeError, "failure_cause")) {
    const { failure_cause: _cause, ...withoutCause } = outcomeRow;
    void _cause;
    await writeOutcome(withoutCause);
  }

  return result.ok
    ? { kind: "sent", providerMessageId: result.messageId ?? null }
    : { kind: "failed", error: result.error };
}


/**
 * Each child's newest reminder `sent_on` in the cross-campaign window, by
 * student alone — not by campaign, not by session. Null when the read fails.
 *
 * - **Reminders only** (`notice_kind = 'reminder'`), as the fees app's
 *   `loadLastSentOn` reads it: a receipt notice to a family that just paid is
 *   not a reminder, and counting it would silence them for a whole cadence.
 * - **A delivery-unknown failure counts as sent.** A timeout or a 5xx may
 *   follow AiSensy's acceptance; the same-day retry refuses those rows for
 *   that reason, and so does this.
 * - **Paged, newest first.** PostgREST stops at 1,000 rows without saying so,
 *   and an unordered cut could drop exactly today's send.
 */
export async function loadLatestSends(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  studentIds: readonly string[],
  today: string,
): Promise<Map<string, string> | null> {
  if (studentIds.length === 0) return new Map();
  const since = crossCampaignSince(today);
  type Row = { student_id: string; sent_on: string; status: string; error_message: string | null };
  try {
    const { data, error } = await fetchInChunks<Row>(
      studentIds,
      IN_FILTER_CHUNK_SIZE,
      (chunk) =>
        fetchAllPages<Row>((from, to) =>
          supabase
            .from("whatsapp_reminder_sends")
            .select("id, student_id, sent_on, status, error_message")
            .in("student_id", chunk)
            .eq("notice_kind", "reminder")
            .gte("sent_on", since)
            .in("status", ["sent", "pending", "covered_by_sibling", "failed"])
            .order("sent_on", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to),
        ),
    );
    if (error) return null;
    const latest = new Map<string, string>();
    for (const row of data) {
      if (row.status === "failed" && !String(row.error_message ?? "").startsWith(DELIVERY_UNKNOWN_PREFIX)) continue;
      const seen = latest.get(row.student_id);
      if (!seen || row.sent_on > seen) latest.set(row.student_id, row.sent_on);
    }
    return latest;
  } catch {
    return null;
  }
}

/**
 * The date a pay link stops resolving: the notice's own date.
 *
 * On `promise_due` that is the FAMILY's promised date — the message prints no
 * run date, so the run's `lastDate` would be a date the parent never saw.
 *
 * Null on a notice that prints no date at all — `late_fee_applied` — where
 * there is nothing to expire against, and the link simply stays live until the
 * family pays and the next run stops including them.
 */
function lastDateIsoFor(
  filters: ReminderFilters,
  candidate: Pick<ReminderCandidate, "promisedOn">,
): string | null {
  if (filters.situation === "promise_due") return candidate.promisedOn ?? null;
  if (filters.situation === "late_fee_applied") return null;
  return isoFromDdMmYyyy(filters.lastDate);
}
