import "server-only";

import { getOptionalEnvVar, getVppsOneEnvironment } from "@/platform/env";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { sendParentTemplate } from "@/modules/whatsapp/data/parent-send";
import { staffHubKey } from "@/modules/whatsapp/domain/staff-hub-templates";
import type { ParentCategory } from "@/modules/collection/domain/parent-policy";
import {
  nativeParentGate,
  type ParentNoticeKind,
  type ParentSendActor,
} from "@/platform/messaging/parent-send-gate";
import { classifyResponse, type TransportOutcome } from "@/modules/staff-notices/domain/notices";
import { isTeacherTaskCampaign, type MessageSend } from "@/modules/collection/domain/messages";
import {
  mockOutcomeFor,
  mockProviderMessageId,
  outcomeErrors,
  type ProviderOutcome,
} from "@/modules/collection/domain/provider";
import { readWhatsAppConfig } from "@/platform/whatsapp/config";
import { sendTemplate, type SendOutcome } from "@/platform/whatsapp/service";

/**
 * The one seam a message goes out through.
 *
 * PLAN §2 asks for a typed provider adapter with a success/failure/rate-limit
 * mock, and PLAN §1 for the reason: **a test student does not make a recipient
 * phone a test phone.** Every QA run that exercises sending has to be able to
 * get a 429, a timeout and a duplicate on demand, and none of those may involve
 * a real handset or a real invoice.
 *
 * Two implementations, chosen by `MESSAGE_PROVIDER`:
 *
 *  - unset or `whatsapp` — the school's own WhatsApp number, through the one
 *    WhatsApp service (src/platform/whatsapp, D-562). That service refuses
 *    until the deployment is connected and the feature's switch is on, and
 *    while real recipients are off it messages only the owner's test number.
 *    `aisensy`, the old name, is read as `whatsapp`: One no longer talks to
 *    AiSensy at all.
 *  - `mock` — decides from the destination's last digit and touches nothing.
 *
 * There is no third state where the app guesses.
 */

export type DispatchResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; outcome?: "unknown" | "rejected" };

export type MessageProvider = {
  /** Recorded in evidence so a run can say which provider produced it. */
  readonly id: "whatsapp" | "mock";
  send(send: MessageSend, context?: DispatchContext): Promise<DispatchResult>;
};

/** What the dispatcher knows about a parent message that the row does not carry. */
export type DispatchContext = { category?: ParentCategory };

/** A native parent category as the parent-send gate names it (absences share one kind). */
export function parentNoticeKindFor(category: ParentCategory | undefined): ParentNoticeKind {
  return category === "absence_notice" ? "absent_notice" : (category ?? "general");
}

/**
 * A parent message goes through the same choke point as the ported fee
 * senders (go-live Phase D, critique0 #10): `sendParentTemplate`, which asks
 * the parent-send gate first. An absence here is the `native` path, so it goes
 * only when `runtime_flags.absent_notice_owner` says so — never alongside the
 * fees app's "Absent today" notice.
 */
async function sendParentThroughGate(send: MessageSend, context?: DispatchContext): Promise<DispatchResult> {
  const actor: ParentSendActor = await getCurrentStaff()
    .then((staff): ParentSendActor => (staff ? { userId: staff.userId } : "system"))
    .catch((): ParentSendActor => "unknown");
  const result = await sendParentTemplate({
    campaignName: send.templateCode,
    destination: `+91${send.toPhone}`,
    userName: send.toName ?? "",
    templateParams: send.variables,
    link: { table: "message_sends", id: send.id },
    gate: nativeParentGate(send.sessionLabel, parentNoticeKindFor(context?.category), actor),
  });
  if (result.ok) return { ok: true, providerMessageId: result.messageId?.trim() ?? "" };
  return {
    ok: false,
    outcome: result.deliveryUnknown ? "unknown" : "rejected",
    error: result.refused
      ? result.error
      : result.deliveryUnknown
        ? "WhatsApp did not say whether it went. Check Settings → WhatsApp before doing anything else."
        : `WhatsApp refused it: ${result.error}`,
  };
}

/**
 * Whether teacher tasks may go out by themselves.
 *
 * `ready` once this deployment is connected to the school's WhatsApp. The
 * task templates' button must open this site: that is checked against the
 * school's account when an admin presses "Check templates", and a template
 * whose button opens anywhere else is marked disabled and never sent.
 */
export function taskDeliveryAvailability(): "ready" | "test_mode" | "unavailable" {
  const declared = getOptionalEnvVar("MESSAGE_PROVIDER")?.toLowerCase();
  if (declared === "mock") return "test_mode";
  if (declared && declared !== "whatsapp" && declared !== "aisensy") return "unavailable";
  const config = readWhatsAppConfig();
  if (!config.ok) return "unavailable";
  if (config.provider === "mock") return "test_mode";
  if (process.env.NODE_ENV === "test" || Boolean(process.env.VITEST)) return "test_mode";
  return "ready";
}

/** Task sends require a receipt. A 5xx can follow acceptance and is ambiguous. */
export function classifyTaskResponse(status: number, body: unknown): TransportOutcome {
  if (status >= 500) return { outcome: "unknown", status, error: "The provider result requires reconciliation" };
  return classifyResponse(status, body);
}

/** The WhatsApp service's answer as a dispatch result. Only a definite "not sent" may be retried. */
export function dispatchResultFrom(outcome: SendOutcome): DispatchResult {
  switch (outcome.outcome) {
    case "accepted":
      return { ok: true, providerMessageId: outcome.providerMessageId };
    case "duplicate":
      return outcome.providerMessageId
        ? { ok: true, providerMessageId: outcome.providerMessageId }
        : { ok: false, outcome: "unknown", error: "This message was already handed to WhatsApp once. Check Settings → WhatsApp; do not resend." };
    case "dry_run":
    case "refused":
      return { ok: false, outcome: "rejected", error: `Not sent: ${outcome.reason}` };
    case "rejected":
      return { ok: false, outcome: "rejected", error: outcome.code ? `${outcome.reason} (WhatsApp ${outcome.code})` : outcome.reason };
    case "queued":
    case "unknown":
      return { ok: false, outcome: "unknown", error: `${outcome.reason} Check Settings → WhatsApp; do not resend.` };
  }
}

/* ------------------------------------------------------------- the real one */

const whatsappProvider: MessageProvider = {
  id: "whatsapp",

  async send(send, context) {
    if (send.audience === "parent" && !send.taskId) return sendParentThroughGate(send, context);
    if (isTeacherTaskCampaign(send.templateCode) && (!send.taskId || !send.buttonSuffix || !Array.isArray(send.variables) || send.variables.length !== 3)) return { ok: false, outcome: "rejected", error: "Task campaigns require reviewed task delivery." };
    if (send.taskId && !isTeacherTaskCampaign(send.templateCode)) return { ok: false, outcome: "rejected", error: "Invalid task campaign." };
    if (send.taskId && taskDeliveryAvailability() !== "ready") return { ok: false, outcome: "rejected", error: "Task delivery is unavailable or in test mode." };

    const requestedBy = await getCurrentStaff()
      .then((staff) => staff?.userId ?? null)
      .catch(() => null);
    try {
      // A teacher task or a staff notice goes under the hub's own name for it
      // (D-573): same blanks, a body Meta accepts, in the reader's language.
      const name = staffHubKey(send.templateCode, null, send.variables ?? []) ?? send.templateCode;
      const outcome = await sendTemplate(`+91${send.toPhone}`, name, null, send.variables ?? [], {
        feature: send.taskId ? "teacher_task" : "staff_notice",
        toName: send.toName ?? null,
        // A task's button opens that task; nothing else here carries one.
        urlButton: send.taskId ? (send.buttonSuffix ?? null) : null,
        link: { table: "message_sends", id: send.id },
        sessionLabel: send.sessionLabel ?? null,
        requestedBy,
      });
      return dispatchResultFrom(outcome);
    } catch (thrown) {
      return {
        ok: false,
        outcome: "unknown",
        error: thrown instanceof Error ? `WhatsApp result unknown: ${thrown.message}` : "WhatsApp result unknown. Check Settings → WhatsApp.",
      };
    }
  },
};

/* ----------------------------------------------------------------- the mock */

/**
 * How long "slow" takes.
 *
 * Long enough that a screen without a pending state looks broken, short enough
 * that a suite of them does not become the reason nobody runs the suite. Not
 * configurable: a timing fixture somebody can turn down is a timing fixture
 * that gets turned down until it stops catching anything.
 */
const SLOW_MS = 1_200;

const mockProvider: MessageProvider = {
  id: "mock",

  async send(send) {
    const outcome: ProviderOutcome = mockOutcomeFor(send.toPhone);

    if (outcome === "slow") {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    }

    switch (outcome) {
      case "sent":
      case "slow":
      case "duplicate":
        // `duplicate` succeeds, and succeeds *identically* every time — the id
        // is derived from the send, so a second dispatch is indistinguishable
        // from a replayed callback. What must not happen next is a second
        // `sent_at`: the durable claim and exact attempt check stop it.
        return { ok: true, providerMessageId: mockProviderMessageId(send.id) };

      case "timeout":
      case "rate_limited":
      case "server_error":
        return { ok: false, outcome: outcome === "rate_limited" ? "rejected" : "unknown", error: outcomeErrors[outcome].en };
    }
  },
};

/* ------------------------------------------------------------- the choice */

export class ProviderMisconfigured extends Error {}

/**
 * Which provider this deployment has.
 *
 * The `live` guard is the one worth reading twice. A live deployment running
 * the mock would write `sent` rows and `mock:` ids for messages nobody ever
 * received, and the office would find out when a parent said they had not been
 * told. Refusing to start is the cheaper failure.
 */
export function selectProvider(): MessageProvider {
  const configured = getOptionalEnvVar("MESSAGE_PROVIDER")?.toLowerCase();

  // `aisensy` is the old name for the same choice: One sends from the school's own number now.
  if (!configured || configured === "whatsapp" || configured === "aisensy") return whatsappProvider;

  if (configured === "mock") {
    if (getVppsOneEnvironment() === "live") {
      throw new ProviderMisconfigured(
        "MESSAGE_PROVIDER=mock is refused on a live deployment: it would record messages as sent that nobody received.",
      );
    }
    return mockProvider;
  }

  throw new ProviderMisconfigured(
    `Unknown MESSAGE_PROVIDER: ${configured}. Expected "whatsapp" or "mock".`,
  );
}

/** Exported for tests; production code goes through `selectProvider()`. */
export const providers = { whatsappProvider, mockProvider };
