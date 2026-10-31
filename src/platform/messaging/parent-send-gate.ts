/**
 * The one gate every WhatsApp message to a parent passes (go-live Phase D,
 * plan §6.3, critique0 #10 and #30, D-353).
 *
 * The ported fee senders called AiSensy directly: `parent_dispatch` was read in
 * one place only, and a manual receipt resend skipped even its own switch. So a
 * staff member with the right permission could message real parents from a
 * Preview deployment, or before the school had switched One on. Now
 * `sendAisensyCampaignMessage` (src/modules/whatsapp/data/aisensy.ts) asks this
 * first, and so does One's own parent-message provider. In order:
 *
 *  0. One never sends a `_v6` template. Their Pay now buttons are fixed by Meta
 *     to the fees app's host; One's are `_v7` (campaign-generation.ts).
 *  1. The deployment says `VPPSONE_ENV=live`.
 *  2. `runtime_flags.parent_dispatch` is on.
 *  3. `runtime_flags.parent_dispatch_categories` lists this notice's kind.
 *     An absence notice also needs `runtime_flags.absent_notice_owner` to name
 *     the path asking, so a family never hears about one absence twice.
 *  4. When the session is a test session, the person sending is a test
 *     account, the send is a test send, or the deployment is not Vercel
 *     production, the number must be in `vppsone.message_test_recipients`.
 *
 * Every check fails closed: a read that errors, a row that is missing, a value
 * of the wrong shape — each refuses. A refusal is definite (nothing reached
 * AiSensy), so the caller may record it as an ordinary failed send.
 *
 * No database import here. The reads come in as `ParentSendReader`, so each
 * branch is unit-tested (tests/parent-send-gate.test.ts); the real reader is
 * `parent-send-reader.ts`.
 */

import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";

/**
 * What a message is about. `parent_dispatch_categories` lists these. The first
 * five are the ported fee senders; the rest are One's own parent messages,
 * named by `ParentCategory` (collection/domain/parent-policy.ts), with
 * `absence_notice` folded into `absent_notice` so both absence paths share one
 * category.
 */
export const PARENT_NOTICE_KINDS = [
  "fee_reminder",
  "receipt",
  "reversal",
  "fee_statement",
  "school_notice",
  "absent_notice",
  "collection_request",
  "report_delivery",
  "general",
] as const;
export type ParentNoticeKind = (typeof PARENT_NOTICE_KINDS)[number];

/** Which path may tell a parent their child is absent (runtime_flags.absent_notice_owner). */
export type AbsentNoticeOwner = "fees_notice" | "native";

/**
 * Who pressed Send. `system` is a cron with no person behind it; `unknown`
 * is a request whose staff member could not be read, which refuses.
 */
export type ParentSendActor = { userId: string } | "system" | "unknown";

/** What a caller states about a send. The gate reads everything else itself. */
export type ParentSendGate = {
  kind: ParentNoticeKind;
  /** The academic session the message is about; null when it is about none. */
  sessionLabel: string | null;
  actor: ParentSendActor;
  /** Required with `kind: "absent_notice"`: the path asking. */
  absentPath?: AbsentNoticeOwner;
  /** A test send typed in by staff: always the allowlist, wherever it runs. */
  testSend?: boolean;
};

/** Each read answers a value, or `null` when it could not be read. */
export type ParentSendReader = {
  parentDispatchOn(): Promise<boolean | null>;
  /** The JSON value of `parent_dispatch_categories`, unparsed. */
  dispatchCategories(): Promise<unknown | null>;
  /** The JSON value of `absent_notice_owner`, unparsed. */
  absentNoticeOwner(): Promise<unknown | null>;
  /** `staff_profiles.is_test_account` for this auth user; null when unreadable or absent. */
  isTestAccount(userId: string): Promise<boolean | null>;
  /** Is this E.164 number in `message_test_recipients`? null when unreadable. */
  isTestRecipient(phoneE164: string): Promise<boolean | null>;
};

export type ParentSendEnv = { readonly [name: string]: string | undefined };

export type ParentSendVerdict =
  | { ok: true; allowlistRequired: boolean }
  | { ok: false; code: ParentSendRefusal; reason: string };

export type ParentSendRefusal =
  | "v6_never"
  | "not_live"
  | "dispatch_off"
  | "category_off"
  | "absent_owner"
  | "actor_unknown"
  | "bad_destination"
  | "not_test_recipient"
  | "read_failed";

/** `+919876543210` from `9876543210`, `919876543210` or `+91 98765 43210`; null if it is none of those. */
export function toE164(destination: string | null | undefined): string | null {
  const raw = String(destination ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

/**
 * The gate for One's own parent messages (`vppsone.message_sends`). The row's
 * own session goes in, so a TEST-session message is held to the test-recipient
 * allowlist even when a real admin or a cron sends it: TEST rows were copied
 * from live and carry real parents' numbers. A row whose session cannot be
 * read is held to the allowlist too. An absence here is the `native` path.
 */
export function nativeParentGate(
  sessionLabel: string | null | undefined,
  kind: ParentNoticeKind,
  actor: ParentSendActor,
): ParentSendGate {
  const label = sessionLabel?.trim() || null;
  return {
    kind,
    ...(kind === "absent_notice" ? { absentPath: "native" as const } : {}),
    sessionLabel: label,
    ...(label ? {} : { testSend: true }),
    actor,
  };
}

/** One never sends a `_v6` template (plan §6.2). */
export function isRefusedGeneration(campaignName: string): boolean {
  return /_v6$/i.test(campaignName.trim());
}

function refuse(code: ParentSendRefusal, reason: string): ParentSendVerdict {
  return { ok: false, code, reason };
}

export async function checkParentSend(
  input: ParentSendGate & { campaignName: string; destination: string },
  reader: ParentSendReader,
  env: ParentSendEnv = process.env,
): Promise<ParentSendVerdict> {
  if (isRefusedGeneration(input.campaignName)) {
    return refuse("v6_never", "VPPS One never sends a _v6 template; its Pay now link belongs to the fees app.");
  }

  // 1. A live deployment, said in so many words. Anything else — unset,
  // `dev`, a typo — refuses.
  if (env.VPPSONE_ENV?.trim().toLowerCase() !== "live") {
    return refuse("not_live", "Parent messages are off on this deployment (VPPSONE_ENV is not live).");
  }

  try {
    // 2. The school's switch.
    const dispatch = await reader.parentDispatchOn();
    if (dispatch === null) return refuse("read_failed", "Could not read the parent-message switch. Not sent.");
    if (!dispatch) return refuse("dispatch_off", "Parent messages are switched off (parent_dispatch).");

    // 3. This kind of message, by name.
    const categories = await reader.dispatchCategories();
    if (categories === null) return refuse("read_failed", "Could not read which parent messages are on. Not sent.");
    if (!Array.isArray(categories) || !categories.includes(input.kind)) {
      return refuse("category_off", `Parent messages of the kind "${input.kind}" are not switched on.`);
    }
    if (input.kind === "absent_notice") {
      const owner = await reader.absentNoticeOwner();
      if (owner === null) return refuse("read_failed", "Could not read who sends absence messages. Not sent.");
      if (!input.absentPath || owner !== input.absentPath) {
        return refuse(
          "absent_owner",
          "Absence messages are sent from the other path (runtime_flags.absent_notice_owner), so a family is never told twice.",
        );
      }
    }

    // 4. Test session, test account, test send or a confined deployment: the
    // allowlist, and nothing but the allowlist.
    let actorIsTest = false;
    if (input.actor === "unknown") {
      return refuse("actor_unknown", "Could not tell who is sending. Not sent.");
    }
    if (input.actor !== "system") {
      const flagged = await reader.isTestAccount(input.actor.userId);
      if (flagged === null) return refuse("actor_unknown", "Could not read the sender's account. Not sent.");
      actorIsTest = flagged;
    }
    const allowlistRequired =
      input.testSend === true ||
      isTestSessionLabel(input.sessionLabel) ||
      // A label that only looks like a rehearsal one (a malformed TEST-…) is
      // treated as one: the policy parser calls it "not test", and that is
      // the direction that must not fail.
      /^\s*(test|uat|demo)\b/i.test(input.sessionLabel ?? "") ||
      actorIsTest ||
      isConfinedDeployment(env);
    if (allowlistRequired) {
      const phone = toE164(input.destination);
      if (!phone) return refuse("bad_destination", "The number is not a phone number. Not sent.");
      const listed = await reader.isTestRecipient(phone);
      if (listed === null) return refuse("read_failed", "Could not read the test-recipient list. Not sent.");
      if (!listed) {
        return refuse(
          "not_test_recipient",
          "Test sessions, test accounts and test deployments may only message the numbers in message_test_recipients.",
        );
      }
    }
    return { ok: true, allowlistRequired };
  } catch {
    return refuse("read_failed", "The send gate could not be checked. Not sent.");
  }
}
