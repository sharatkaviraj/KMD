import "server-only";

import { getOptionalEnvVar, getSiteUrl, getVppsOneEnvironment } from "@/platform/env";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { sendAisensyCampaignMessage } from "@/modules/whatsapp/data/aisensy";
import type { ParentCategory } from "@/modules/collection/domain/parent-policy";
import type { ParentNoticeKind, ParentSendActor } from "@/platform/messaging/parent-send-gate";
import { classifyResponse, type TransportOutcome } from "@/modules/staff-notices/domain/notices";
import { isTeacherTaskCampaign, type MessageSend } from "@/modules/collection/domain/messages";
import {
  mockOutcomeFor,
  mockProviderMessageId,
  outcomeErrors,
  type ProviderOutcome,
} from "@/modules/collection/domain/provider";

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
 *  - unset or `aisensy` — the real one, which still refuses without an API key
 *    this repository deliberately does not carry (rule 8: sending costs money).
 *  - `mock` — decides from the destination's last digit and touches nothing.
 *
 * There is no third state where the app guesses. A deploy that has not been
 * told which provider it has behaves exactly as it did before this file
 * existed.
 */

export type DispatchResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; outcome?: "unknown" | "rejected" };

export type MessageProvider = {
  /** Recorded in evidence so a run can say which provider produced it. */
  readonly id: "aisensy" | "mock";
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
 * senders (go-live Phase D, critique0 #10): `sendAisensyCampaignMessage`,
 * which asks the parent-send gate first. An absence here is the `native`
 * path, so it goes only when `runtime_flags.absent_notice_owner` says so —
 * never alongside the fees app's "Absent today" notice.
 */
async function sendParentThroughGate(send: MessageSend, context?: DispatchContext): Promise<DispatchResult> {
  const actor: ParentSendActor = await getCurrentStaff()
    .then((staff): ParentSendActor => (staff ? { userId: staff.userId } : "system"))
    .catch((): ParentSendActor => "unknown");
  const kind = parentNoticeKindFor(context?.category);
  const result = await sendAisensyCampaignMessage({
    campaignName: send.templateCode,
    destination: `+91${send.toPhone}`,
    userName: send.toName ?? "",
    templateParams: send.variables,
    source: "vppsone/messages",
    gate: {
      kind,
      ...(kind === "absent_notice" ? { absentPath: "native" as const } : {}),
      sessionLabel: null,
      actor,
    },
  });
  if (result.ok) return { ok: true, providerMessageId: result.messageId?.trim() ?? "" };
  return {
    ok: false,
    outcome: result.deliveryUnknown ? "unknown" : "rejected",
    error: result.refused ? result.error : result.deliveryUnknown
      ? "The provider result is unknown. Check its delivery log before doing anything else."
      : `The provider refused it (${result.status}).`,
  };
}

/** Explicit deployment contract; dev database mode never enables a task mock. */
export function taskDeliveryAvailability(): "ready" | "test_mode" | "unavailable" {
  const declared = getOptionalEnvVar("MESSAGE_PROVIDER");
  if (declared === "mock") return "test_mode";
  if (declared !== "aisensy" || !getOptionalEnvVar("AISENSY_API_KEY")
    || getOptionalEnvVar("AISENSY_TASK_CONTRACT") !== "v1"
    || getOptionalEnvVar("AISENSY_TASK_CAMPAIGN_ORIGIN") !== getSiteUrl().replace(/\/$/, "")) return "unavailable";
  const prefix = getOptionalEnvVar("AISENSY_CAMPAIGN_PREFIX");
  if (prefix && !/^[A-Za-z0-9_-]+$/.test(prefix)) return "unavailable";
  if (process.env.NODE_ENV === "test" || Boolean(process.env.VITEST)) return "test_mode";
  return "ready";
}

/** Task sends require a receipt. A 5xx can follow acceptance and is ambiguous. */
export function classifyTaskResponse(status: number, body: unknown): TransportOutcome {
  if (status >= 500) return { outcome: "unknown", status, error: "The provider result requires reconciliation" };
  return classifyResponse(status, body);
}

/* ------------------------------------------------------------- the real one */

const aisensyProvider: MessageProvider = {
  id: "aisensy",

  async send(send, context) {
    if (send.audience === "parent" && !send.taskId) return sendParentThroughGate(send, context);
    if (isTeacherTaskCampaign(send.templateCode) && (!send.taskId || !send.buttonSuffix || !Array.isArray(send.variables) || send.variables.length !== 3)) return { ok: false, outcome: "rejected", error: "Task campaigns require reviewed task delivery." };
    if (send.taskId && !isTeacherTaskCampaign(send.templateCode)) return { ok: false, outcome: "rejected", error: "Invalid task campaign." };
    if (send.taskId && taskDeliveryAvailability() !== "ready") return { ok: false, outcome: "rejected", error: "Task delivery is unavailable or in test mode." };
    const apiKey = getOptionalEnvVar("AISENSY_API_KEY");

    if (!apiKey) {
      return {
        ok: false,
        outcome: "rejected",
        error:
          "No AISENSY_API_KEY is configured, so nothing was sent. Open it in WhatsApp and press send.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey,
          campaignName: send.taskId && getOptionalEnvVar("AISENSY_CAMPAIGN_PREFIX")
            ? send.templateCode.replace(/^vppsone/, getOptionalEnvVar("AISENSY_CAMPAIGN_PREFIX")!) : send.templateCode,
          destination: `91${send.toPhone}`,
          userName: send.toName ?? "",
          templateParams: send.variables,
          ...(send.taskId && send.buttonSuffix ? { buttons: [{ type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: send.buttonSuffix }] }] } : {}),
        }),
        signal: controller.signal,
      });

      if (send.taskId) {
        const outcome = classifyTaskResponse(response.status, await response.json().catch(() => null));
        return outcome.outcome === "accepted" ? { ok: true, providerMessageId: outcome.providerMessageId }
          : { ok: false, outcome: outcome.outcome === "unknown" ? "unknown" : "rejected", error: outcome.error };
      }

      if (!response.ok) {
        const rejected = [400, 401, 403, 404, 422, 429].includes(response.status);
        return { ok: false, outcome: rejected ? "rejected" : "unknown", error: rejected
          ? `The provider refused it (${response.status}).`
          : "The provider result is unknown. Check its delivery log before doing anything else." };
      }

      const body: unknown = await response.json().catch(() => null);
      const id =
        body && typeof body === "object" && "messageId" in body && typeof body.messageId === "string"
          ? body.messageId.trim()
          : "";

      // HTTP acceptance may carry no id. Preserve the existing empty marker:
      // null is reserved for manual sends and would make Undo queue this again.

      return { ok: true, providerMessageId: id };
    } catch (thrown) {
      return {
        ok: false,
        outcome: "unknown",
        error:
          thrown instanceof Error ? `Provider result unknown: ${thrown.message}` : "The provider result is unknown. Check its delivery log.",
      };
    } finally {
      clearTimeout(timeout);
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

  if (!configured || configured === "aisensy") return aisensyProvider;

  if (configured === "mock") {
    if (getVppsOneEnvironment() === "live") {
      throw new ProviderMisconfigured(
        "MESSAGE_PROVIDER=mock is refused on a live deployment: it would record messages as sent that nobody received.",
      );
    }
    return mockProvider;
  }

  throw new ProviderMisconfigured(
    `Unknown MESSAGE_PROVIDER: ${configured}. Expected "aisensy" or "mock".`,
  );
}

/** Exported for tests; production code goes through `selectProvider()`. */
export const providers = { aisensyProvider, mockProvider };
