import { DEFAULT_QUIET_HOURS } from "@/modules/whatsapp/domain/send-guards";
import { SCHOOL_UTC_OFFSET_MINUTES } from "@/platform/dates";

import { KINDS, isOutboxKind } from "./kinds";

/**
 * Whether a claimed staff notice may go, now, to this person (go-live Phase F,
 * plan §8.3, D-344, D-356). Pure: the claim (`vppsone.claim_staff_notice`)
 * reads the facts in the same transaction that leases the notice, the
 * dispatcher asks this, and the answer is one of four things — send, send as a
 * digest, hold for later, or never. Every branch is in tests/staff-notice-gates.test.ts.
 *
 * In order, and every one fails closed (a fact that is missing or the wrong
 * shape never reads as "allowed"):
 *
 *  1. The facts were read at all.
 *  2. The kind is on, by name, in `runtime_flags.staff_notice_kinds_enabled`.
 *  3. The person consented (`staff_profiles.whatsapp_opt_in_at`, from the form,
 *     from /preferences, or recorded by an admin) and has not opted out since.
 *  4. They have not switched this kind off for themselves (`staff_notice_prefs`).
 *  5. A TEST session, a test account or a confined deployment (anything that is
 *     not Vercel production): the number must be in
 *     `vppsone.message_test_recipients`, the same allowlist the parent gate
 *     uses (Phase D). A test account's number is a test number or nothing.
 *  6. The send window, 07:00–20:00 IST (critique1 C1: the staff "quiet hours"
 *     ARE the send window, in the same shape and with the same end as the fee
 *     reminders' `DEFAULT_QUIET_HOURS`; the start is 07:00 because the school
 *     day starts before the parents' does). Cover is exempt; a day-not-closed
 *     notice may go in the hour the window closes. Outside it: held until 07:00.
 *  7. At most 8 a day per person, cover exempt.
 *  8. The month's cap on AiSensy sends (`staff_whatsapp_month_cap`, 1,000 by
 *     default), for every kind — it is money.
 *  9. More than 3 of one kind for one person within 30 minutes become one
 *     digest. Cover is never folded.
 */

/** The staff send window: same shape and end as `DEFAULT_QUIET_HOURS`, opening at 07:00 (C1). */
export const STAFF_SEND_WINDOW = { start: 7, end: DEFAULT_QUIET_HOURS.end } as const;
/** How long after the window closes an `edgeOfWindow` kind may still go. */
export const EDGE_GRACE_HOURS = 1;
export const STAFF_DAILY_LIMIT = 8;
export const DIGEST_THRESHOLD = 3;
export const DIGEST_WINDOW_MINUTES = 30;
export const DEFAULT_MONTH_CAP = 1000;
/** A fact that could not be read: look again in five minutes rather than send. */
export const RETRY_UNREADABLE_MS = 5 * 60_000;
/** One request a second to AiSensy (plan §8.3). */
export const MIN_SEND_GAP_MS = 1000;

/** What the claim reads about the person, the kind and the month, as it read it. */
export type StaffGateFacts = {
  optInAt: string | null;
  optOutAt: string | null;
  isTestAccount: boolean;
  isTestSession: boolean;
  /** `staff_notice_prefs.enabled` for this person and kind; null when they never chose. */
  prefEnabled: boolean | null;
  /** The JSON value of `staff_notice_kinds_enabled`; null when the switch is off or missing. */
  kindsEnabled: unknown;
  /** Their non-cover sends since midnight IST. */
  sentToday: number;
  /** Sends of this kind to them in the last 30 minutes. */
  recentSameKind: number;
  /** Other notices of this kind for them, due now and not yet sent. */
  pendingSameKind: number;
  /** Whether this notice was already held once to gather a digest. */
  heldForDigest: boolean;
  /** AiSensy sends this IST month, every staff member together. */
  monthSent: number;
  /** The JSON value of `staff_whatsapp_month_cap`; null when the switch is off or missing. */
  monthCap: unknown;
  /** Is the destination in `message_test_recipients`? */
  allowlisted: boolean | null;
};

export type StaffGateInput = {
  kind: string;
  facts: StaffGateFacts | null | undefined;
  transport: "mock" | "aisensy";
  /** `isConfinedDeployment()` — anything that is not Vercel production. */
  confined: boolean;
  now: Date;
};

export type StaffGateReason =
  | "gate_unreadable"
  | "kind_unknown"
  | "kind_off"
  | "no_consent"
  | "opted_out"
  | "pref_off"
  | "not_test_recipient"
  | "outside_window"
  | "daily_cap"
  | "month_cap"
  | "digest_hold";

export type StaffGateVerdict =
  | { action: "send"; allowlistRequired: boolean; digestCount: number | null }
  | { action: "suppress"; reason: StaffGateReason }
  | { action: "defer"; reason: StaffGateReason; until: Date };

const suppress = (reason: StaffGateReason): StaffGateVerdict => ({ action: "suppress", reason });
const defer = (reason: StaffGateReason, until: Date): StaffGateVerdict => ({ action: "defer", reason, until });

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** The hour on the school's clock (IST), fractional. */
export function schoolHour(now: Date): number {
  const minutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + SCHOOL_UTC_OFFSET_MINUTES) % (24 * 60);
  return minutes / 60;
}

/** The next time the window opens: 07:00 IST today if it is earlier than that, else tomorrow. */
export function nextWindowOpen(now: Date): Date {
  const shifted = new Date(now.getTime() + SCHOOL_UTC_OFFSET_MINUTES * 60_000);
  const opens = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), STAFF_SEND_WINDOW.start);
  const day = schoolHour(now) < STAFF_SEND_WINDOW.start ? opens : opens + 24 * 3_600_000;
  return new Date(day - SCHOOL_UTC_OFFSET_MINUTES * 60_000);
}

/** Inside the send window? `edgeOfWindow` kinds get one more hour after it closes. */
export function inSendWindow(now: Date, edgeOfWindow = false): boolean {
  const hour = schoolHour(now);
  const end = STAFF_SEND_WINDOW.end + (edgeOfWindow ? EDGE_GRACE_HOURS : 0);
  return hour >= STAFF_SEND_WINDOW.start && hour < end;
}

/** Has this person consented, and not opted out since? */
export function hasConsent(facts: Pick<StaffGateFacts, "optInAt" | "optOutAt">): "yes" | "no_consent" | "opted_out" {
  const optIn = facts.optInAt ? Date.parse(facts.optInAt) : Number.NaN;
  if (!Number.isFinite(optIn)) return facts.optOutAt ? "opted_out" : "no_consent";
  const optOut = facts.optOutAt ? Date.parse(facts.optOutAt) : Number.NaN;
  // An unreadable opt-out is an opt-out: the direction that must not fail.
  if (facts.optOutAt && (!Number.isFinite(optOut) || optOut >= optIn)) return "opted_out";
  return "yes";
}

/** The month cap as a number, or null when it is not a positive whole number. */
export function readMonthCap(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

function factsReadable(facts: StaffGateFacts | null | undefined): facts is StaffGateFacts {
  if (!facts || typeof facts !== "object") return false;
  return (
    typeof facts.isTestAccount === "boolean" &&
    typeof facts.isTestSession === "boolean" &&
    isCount(facts.sentToday) &&
    isCount(facts.recentSameKind) &&
    isCount(facts.pendingSameKind) &&
    isCount(facts.monthSent) &&
    typeof facts.heldForDigest === "boolean"
  );
}

export function evaluateStaffSend(input: StaffGateInput): StaffGateVerdict {
  const { kind, facts, now } = input;
  const retry = new Date(now.getTime() + RETRY_UNREADABLE_MS);

  // 1. Facts read, or nothing goes.
  if (!factsReadable(facts)) return defer("gate_unreadable", retry);

  // 2. The kind, by name.
  if (!isOutboxKind(kind)) return suppress("kind_unknown");
  const definition = KINDS[kind];
  const map = facts.kindsEnabled;
  if (!map || typeof map !== "object" || Array.isArray(map) || (map as Record<string, unknown>)[kind] !== true) {
    return suppress("kind_off");
  }

  // 3. Consent.
  const consent = hasConsent(facts);
  if (consent !== "yes") return suppress(consent);

  // 4. Their own switch for this kind. No row is "not chosen": consent covers it.
  if (facts.prefEnabled === false) return suppress("pref_off");

  // 5. Test session, test account, confined deployment: the allowlist only.
  const allowlistRequired = facts.isTestSession || facts.isTestAccount || input.confined;
  if (allowlistRequired && facts.allowlisted !== true) return suppress("not_test_recipient");

  // 6. The send window.
  if (!definition.urgent && !inSendWindow(now, definition.edgeOfWindow)) {
    return defer("outside_window", nextWindowOpen(now));
  }

  // 7. Eight a day, cover exempt.
  if (!definition.urgent && facts.sentToday >= STAFF_DAILY_LIMIT) return suppress("daily_cap");

  // 8. The month's AiSensy budget. The mock costs nothing and is not counted.
  if (input.transport === "aisensy") {
    const cap = facts.monthCap === null || facts.monthCap === undefined ? null : readMonthCap(facts.monthCap);
    if (cap === null) return defer("gate_unreadable", retry);
    if (facts.monthSent >= cap) return suppress("month_cap");
  }

  // 9. The digest.
  if (!definition.urgent) {
    const burst = facts.pendingSameKind + 1;
    if (burst > DIGEST_THRESHOLD || (facts.heldForDigest && burst > 1)) {
      return { action: "send", allowlistRequired, digestCount: burst };
    }
    if (facts.recentSameKind + burst > DIGEST_THRESHOLD && !facts.heldForDigest) {
      return defer("digest_hold", new Date(now.getTime() + DIGEST_WINDOW_MINUTES * 60_000));
    }
  }

  return { action: "send", allowlistRequired, digestCount: null };
}

/**
 * The teacher-task link's API send (its own reviewed delivery, pressed by a
 * person, so neither the window nor the caps apply): the same consent, the
 * `teacher_task` switch, the person's own switch and the test allowlist. Any
 * fact missing refuses.
 */
export function evaluateTeacherTaskSend(input: {
  facts: Pick<StaffGateFacts, "optInAt" | "optOutAt" | "isTestAccount" | "isTestSession" | "prefEnabled" | "kindsEnabled" | "allowlisted"> | null;
  confined: boolean;
}): { ok: true } | { ok: false; reason: StaffGateReason } {
  const facts = input.facts;
  if (!facts || typeof facts.isTestAccount !== "boolean" || typeof facts.isTestSession !== "boolean") {
    return { ok: false, reason: "gate_unreadable" };
  }
  const map = facts.kindsEnabled;
  if (!map || typeof map !== "object" || Array.isArray(map) || (map as Record<string, unknown>).teacher_task !== true) {
    return { ok: false, reason: "kind_off" };
  }
  const consent = hasConsent(facts);
  if (consent !== "yes") return { ok: false, reason: consent };
  if (facts.prefEnabled === false) return { ok: false, reason: "pref_off" };
  if ((facts.isTestSession || facts.isTestAccount || input.confined) && facts.allowlisted !== true) {
    return { ok: false, reason: "not_test_recipient" };
  }
  return { ok: true };
}

/** How long to wait before the next AiSensy request so they are at least a second apart. */
export function paceDelay(lastSentAt: number | null, now: number, gapMs = MIN_SEND_GAP_MS): number {
  if (lastSentAt === null) return 0;
  return Math.max(0, lastSentAt + gapMs - now);
}

/** A verdict's reason in words for the staff log (English; the log is an admin's). */
export const GATE_REASON_TEXT: Record<StaffGateReason, string> = {
  gate_unreadable: "Could not read the staff send rules; tried again later",
  kind_unknown: "Not a staff message kind",
  kind_off: "This kind of message is switched off",
  no_consent: "No WhatsApp consent recorded",
  opted_out: "Opted out of WhatsApp",
  pref_off: "Switched off by the person",
  not_test_recipient: "Test session, test account or test deployment: number not on the test list",
  outside_window: "Outside 07:00–20:00; held until the morning",
  daily_cap: "Already 8 messages today",
  month_cap: "The month's WhatsApp cap is reached",
  digest_hold: "Several at once; held to send as one",
};
