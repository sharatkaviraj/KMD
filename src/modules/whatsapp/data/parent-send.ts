import "server-only";

import {
  checkParentSend,
  type ParentSendGate,
  type ParentSendReader,
  type ParentSendRefusal,
} from "@/platform/messaging/parent-send-gate";
import type { TemplateDocument } from "@/platform/whatsapp/payload";
import type { WhatsAppRefusal } from "@/platform/whatsapp/policy";
import { isWhatsAppConfigured, sendTemplate } from "@/platform/whatsapp/service";

/**
 * Every WhatsApp message to a parent leaves One through here (D-562).
 *
 * This used to be the AiSensy client. One no longer talks to AiSensy: it
 * sends from the school's own number, +91 83022 07823, through the one
 * WhatsApp service (src/platform/whatsapp). The fees app keeps its own
 * AiSensy setup and nothing here touches it.
 *
 * Two gates, in order, and both must say yes:
 *
 *  1. The parent-send gate (platform/messaging/parent-send-gate.ts): should
 *     this parent hear about this, from this deployment, sent by this person?
 *  2. The WhatsApp service's policy (platform/whatsapp/policy.ts): may the
 *     school's number send this message now — the feature's switch, the
 *     template's approval, the owner's test number while real parents are
 *     off, practice mode, the day's limit.
 *
 * `tests/architecture.test.ts` holds that nothing else in One posts to a
 * WhatsApp provider.
 */

export type SendRefusalCode = ParentSendRefusal | WhatsAppRefusal | "dry_run";

export type ParentSendResult =
  | { ok: true; status: number; messageId: string | null; logId: string | null }
  | {
      ok: false;
      status: number;
      error: string;
      /**
       * True when we cannot tell whether the message reached WhatsApp (no
       * answer, a 5xx, an answer without a message id), or when the queue
       * will try it again by itself. Either way the caller must NOT send it
       * again: one parent missed beats one parent messaged twice.
       */
      deliveryUnknown?: true;
      /** With `deliveryUnknown`: the WhatsApp queue owns the next try. */
      queued?: true;
      /** Refused before anything reached WhatsApp: a definite "not sent". */
      refused?: true;
      /** With `refused`: why, so a caller can tell a rule from a failed read. */
      refusalCode?: SendRefusalCode;
      /** WhatsApp's own error code on a definite rejection (131026 …). */
      errorCode?: string;
      logId?: string | null;
    };

/**
 * Prefix on `error_message` of a send whose fate is unknown. The same-day
 * retry in `run-sender.ts` skips rows carrying it in a real session, so a
 * parent whose message may already have gone is not messaged twice.
 */
export const DELIVERY_UNKNOWN_PREFIX = "delivery-unknown: ";

export type { TemplateDocument };

/**
 * A template button's dynamic parameter: today the `_v7` notices' Pay now,
 * whose link is `https://one.vpps.co.in/pay/{{1}}` and whose `{{1}}` is the
 * send's own pay code. It is its own component in Meta's format, never one
 * of the body's `{{n}}`. `index` is the button's position, as a string.
 */
export type TemplateUrlButton = {
  type: "button";
  sub_type: "url";
  index: string;
  parameters: Array<{ type: "text"; text: string }>;
};

/** The Pay now button's parameter: the send's own pay code as the URL suffix. */
export function payNowButton(payCode: string, index = 0): TemplateUrlButton {
  return {
    type: "button",
    sub_type: "url",
    index: String(index),
    parameters: [{ type: "text", text: payCode }],
  };
}

export type ParentSendArgs = {
  /** The template's key in `vppsone.whatsapp_templates` (the descriptors' campaign name). */
  campaignName: string;
  /** E.164 with country code, e.g. +919352205884. */
  destination: string;
  /** The parent's name, for the log. Not necessarily a template variable. */
  userName: string;
  /** Values for the template BODY's {{1}}, {{2}}, … in order. Never a button's. */
  templateParams: string[];
  /** The PDF a template's header carries (receipts, statements). */
  media?: TemplateDocument;
  /** The template's URL button; only the first one is used. */
  buttons?: TemplateUrlButton[];
  /** The Pay now code this message carries, so a Razorpay payment marks it paid. */
  payCode?: string | null;
  /** The sending module's own row, so the webhook and the queue can update it. */
  link?: { table: string; id: string } | null;
  /** How many tries in all a busy-server failure gets from the queue (default 1: none). */
  maxAttempts?: number;
  /** What this message is, who is sending it and for which session — the parent-send gate's questions. */
  gate: ParentSendGate;
};

/** Whether the school's WhatsApp server is connected on this deployment. */
export function isParentWhatsAppConfigured(): boolean {
  return isWhatsAppConfigured();
}

async function defaultReader(): Promise<ParentSendReader> {
  return (await import("@/platform/messaging/parent-send-reader")).parentSendReader;
}

/**
 * The parent-send gate's answer on its own, without sending: `null` when the
 * send may go, otherwise the sentence to record. A sender whose claim row is
 * permanent (the receipt notice) asks this BEFORE claiming, so a refusal
 * leaves nothing behind. `sendParentTemplate` asks it again.
 */
export async function parentSendRefusal(
  args: Pick<ParentSendArgs, "campaignName" | "destination" | "gate">,
  reader?: ParentSendReader,
): Promise<string | null> {
  return (await parentSendRefusalWithCode(args, reader))?.sentence ?? null;
}

/** The same answer with the gate's code beside the sentence. Branch on the code, never the text. */
export async function parentSendRefusalWithCode(
  args: Pick<ParentSendArgs, "campaignName" | "destination" | "gate">,
  reader?: ParentSendReader,
): Promise<{ code: ParentSendRefusal; sentence: string } | null> {
  const verdict = await (async () =>
    checkParentSend(
      { ...args.gate, campaignName: args.campaignName, destination: args.destination },
      reader ?? (await defaultReader()),
    ))().catch(() => ({ ok: false as const, code: "read_failed" as const, reason: "The send gate could not be checked. Not sent." }));
  return verdict.ok ? null : { code: verdict.code, sentence: `Not sent: ${verdict.reason}` };
}

/** Refusals that are a failed read or a full day, not a rule: worth trying again later. */
export function isTransientParentRefusal(code: SendRefusalCode | undefined | null): boolean {
  return code === "read_failed" || code === "actor_unknown" || code === "daily_limit";
}

/** Send one approved template to a parent, through both gates. */
export async function sendParentTemplate(args: ParentSendArgs, reader?: ParentSendReader): Promise<ParentSendResult> {
  const refusal = await parentSendRefusalWithCode(args, reader);
  if (refusal) {
    return { ok: false, status: 0, error: refusal.sentence, refused: true, refusalCode: refusal.code };
  }

  const button = [...(args.buttons ?? [])].sort((a, b) => Number(a.index) - Number(b.index))[0];
  const outcome = await sendTemplate(args.destination, args.campaignName, null, args.templateParams, {
    feature: args.gate.kind,
    toName: args.userName,
    document: args.media ?? null,
    urlButton: button?.parameters[0]?.text ?? null,
    payCode: args.payCode ?? null,
    link: args.link ?? null,
    sessionLabel: args.gate.sessionLabel,
    requestedBy: typeof args.gate.actor === "object" ? args.gate.actor.userId : null,
    maxAttempts: args.maxAttempts ?? 1,
  });

  switch (outcome.outcome) {
    case "accepted":
      return { ok: true, status: 200, messageId: outcome.providerMessageId, logId: outcome.logId };
    case "duplicate":
      return outcome.providerMessageId
        ? { ok: true, status: 200, messageId: outcome.providerMessageId, logId: outcome.logId }
        : { ok: false, status: 0, error: "This message was already handed to WhatsApp once.", deliveryUnknown: true, logId: outcome.logId };
    case "dry_run":
      return { ok: false, status: 0, error: `Not sent: ${outcome.reason}`, refused: true, refusalCode: "dry_run", logId: outcome.logId };
    case "refused":
      return { ok: false, status: 0, error: `Not sent: ${outcome.reason}`, refused: true, refusalCode: outcome.code, logId: outcome.logId };
    case "queued":
      return { ok: false, status: 0, error: outcome.reason, deliveryUnknown: true, queued: true, logId: outcome.logId };
    case "unknown":
      return { ok: false, status: 0, error: outcome.reason, deliveryUnknown: true, logId: outcome.logId };
    case "rejected":
      return {
        ok: false,
        status: 400,
        error: outcome.code ? `${outcome.reason} (WhatsApp ${outcome.code})` : outcome.reason,
        ...(outcome.code ? { errorCode: outcome.code } : {}),
        logId: outcome.logId,
      };
  }
}
