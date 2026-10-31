import "server-only";

import { getOptionalEnvVar } from "@/platform/env";
import {
  checkParentSend,
  type ParentSendGate,
  type ParentSendReader,
} from "@/platform/messaging/parent-send-gate";

/**
 * AiSensy Campaign API client.
 *
 * One endpoint, one job: fire a Meta-approved WhatsApp template at one number
 * by naming a Live API Campaign. The template body and its variable slots live
 * in AiSensy and Meta, not here — all this sends is the campaign name and the
 * values that fill the slots.
 *
 * The Basic plan includes this endpoint. The richer "Project API" (contact
 * CRUD, delivery webhooks) is Pro-only, which is why nothing here reads
 * delivery status back: `submitted_message_id` is an acceptance receipt, not
 * proof the parent's phone lit up. The AiSensy dashboard is where that lives.
 */

const AISENSY_ENDPOINT = "https://backend.aisensy.com/campaign/t1/api/v2";

export type AisensySendResult =
  | { ok: true; status: number; messageId: string | null }
  | {
      ok: false;
      status: number;
      error: string;
      /**
       * True when we cannot tell whether AiSensy took the message: the request
       * got no answer, or the answer was a 5xx a gateway may have sent after
       * AiSensy accepted it. Absent on a definite rejection (a 4xx, or no key
       * configured), which is the only kind of failure safe to send again.
       */
      deliveryUnknown?: true;
      /**
       * The parent-send gate refused it before anything reached AiSensy: a
       * definite "not sent", safe to record as an ordinary failure.
       */
      refused?: true;
    };

/**
 * Prefix on `error_message` of a send whose fate is unknown. The same-day
 * retry in `run-sender.ts` skips rows carrying it in a real session, so a
 * parent whose message may already have gone is not messaged twice.
 */
export const DELIVERY_UNKNOWN_PREFIX = "delivery-unknown: ";

/**
 * The document a template's HEADER carries.
 *
 * A header is a separate template component with its own media parameter, so it
 * does NOT consume a body `{{n}}` — `templateParams` stays exactly as long as
 * the body's slot count. Getting that wrong is rejected by AiSensy, which
 * enforces the count exactly.
 */
export type AisensyMedia = {
  /**
   * Must be fetchable by Meta with no headers and no session — AiSensy rejects
   * the request otherwise. A Supabase signed URL qualifies: the credential
   * travels in the query string.
   */
  url: string;
  /** What the parent sees in WhatsApp. Never carries an admission number. */
  filename: string;
};

/**
 * A template BUTTON's parameter — today only the dynamic suffix of a URL
 * button, the `_v6` notices' Pay now.
 *
 * Callers describe it in Meta's `components[].parameters` shape, but that is
 * NOT what goes on the wire. AiSensy numbers a URL button's variable after the
 * body's — Pay now is `{{6}}` on a five-slot body — and reads its value from
 * the END of `templateParams`. A five-param send carrying a Meta-style
 * `buttons` entry is refused with "Template params does not match the
 * campaign"; six params and no `buttons` key was delivered with the link
 * intact (test send to the office number, 2026-10-26).
 * `sendAisensyCampaignMessage` does that folding, so no caller has to know.
 *
 * `index` is the button's position in the template, as a string.
 */
export type AisensyButton = {
  type: "button";
  sub_type: "url";
  index: string;
  parameters: Array<{ type: "text"; text: string }>;
};

/** The Pay now button's parameter: the send's own pay code as the URL suffix. */
export function payNowButton(payCode: string, index = 0): AisensyButton {
  return {
    type: "button",
    sub_type: "url",
    index: String(index),
    parameters: [{ type: "text", text: payCode }],
  };
}

export type AisensySendArgs = {
  campaignName: string;
  /** E.164 with country code, e.g. +919352205884. */
  destination: string;
  /** Contact display name in AiSensy. Not necessarily a template variable. */
  userName: string;
  /** Values for the template BODY's {{1}}, {{2}}, … in order. Never a button's. */
  templateParams: string[];
  source?: string;
  /** Omitted entirely for the 34 body-only templates. */
  media?: AisensyMedia;
  /**
   * Omitted entirely for every template without a dynamic button. Sent as the
   * trailing `templateParams`, never as a `buttons` key — see `AisensyButton`.
   */
  buttons?: AisensyButton[];
  /**
   * What this message is, who is sending it and for which session — the
   * questions the parent-send gate asks (src/platform/messaging/
   * parent-send-gate.ts). Required: a send that cannot say is a send that
   * does not go. One differs from the fees app here, which had no gate.
   */
  gate: ParentSendGate;
};

/**
 * The `templateParams` AiSensy expects: the body's slots, then each dynamic
 * button's suffix in button order. Without buttons it is the body's array,
 * unchanged — every template without one sends exactly what it always did.
 */
export function aisensyTemplateParams(
  args: Pick<AisensySendArgs, "templateParams" | "buttons">,
): string[] {
  const suffixes = [...(args.buttons ?? [])]
    .sort((a, b) => Number(a.index) - Number(b.index))
    .flatMap((button) => button.parameters.map((parameter) => parameter.text));
  return suffixes.length > 0 ? [...args.templateParams, ...suffixes] : args.templateParams;
}

export function isAisensyConfigured(): boolean {
  return Boolean(getOptionalEnvVar("AISENSY_API_KEY")?.trim());
}

/**
 * The reads the gate makes. Loaded lazily so a unit test that stubs `fetch`
 * can hand in its own reader instead of a database.
 */
async function defaultReader(): Promise<ParentSendReader> {
  return (await import("@/platform/messaging/parent-send-reader")).parentSendReader;
}

/**
 * The gate's answer on its own, without sending: `null` when the send may go,
 * otherwise the sentence to record. A sender whose claim row is permanent (the
 * receipt notice, whose `(receipt_id, notice_kind)` index also covers failed
 * rows) asks this BEFORE claiming, so a refusal leaves nothing behind and a
 * later send can still claim. `sendAisensyCampaignMessage` asks it again.
 */
export async function parentSendRefusal(
  args: Pick<AisensySendArgs, "campaignName" | "destination" | "gate">,
  reader?: ParentSendReader,
): Promise<string | null> {
  const verdict = await (async () =>
    checkParentSend(
      { ...args.gate, campaignName: args.campaignName, destination: args.destination },
      reader ?? (await defaultReader()),
    ))().catch(() => ({ ok: false as const, code: "read_failed" as const, reason: "The send gate could not be checked. Not sent." }));
  return verdict.ok ? null : `Not sent: ${verdict.reason}`;
}

/**
 * Every WhatsApp message to a parent goes through here — the ported fee
 * senders and One's own parent messages alike — and the gate is asked first.
 * `tests/architecture.test.ts` holds that no other file names AiSensy's
 * endpoint except the two staff transports.
 */
export async function sendAisensyCampaignMessage(
  args: AisensySendArgs,
  reader?: ParentSendReader,
): Promise<AisensySendResult> {
  const refusal = await parentSendRefusal(args, reader);
  if (refusal) {
    return { ok: false, status: 0, error: refusal, refused: true };
  }

  const apiKey = getOptionalEnvVar("AISENSY_API_KEY")?.trim();
  if (!apiKey) {
    return { ok: false, status: 0, error: "AISENSY_API_KEY is not configured." };
  }

  let response: Response;
  try {
    response = await fetch(AISENSY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName: args.campaignName,
        destination: args.destination,
        userName: args.userName,
        // `vppsone/…`, so AiSensy's reports tell One's sends from the fees app's.
        source: args.source ?? "vppsone",
        // Conditional spread, never `media: undefined`. JSON.stringify drops an
        // undefined value either way, so the two are byte-identical on the
        // wire — but the spread STATES that a body-only send is unchanged,
        // which is the property a reviewer should be able to see and a test can
        // pin. All 34 existing templates send exactly the six keys they always
        // did.
        ...(args.media
          ? { media: { url: args.media.url, filename: args.media.filename } }
          : {}),
        // A dynamic button rides at the end of templateParams, not in a
        // `buttons` key, which AiSensy refuses — see AisensyButton.
        templateParams: aisensyTemplateParams(args),
      }),
    });
  } catch (caught) {
    // A network failure is not a delivery failure — we do not know whether
    // AiSensy accepted it. The caller records this as failed and leaves the day
    // claimed, which is the safe direction: one parent missed beats one parent
    // messaged twice.
    return {
      ok: false,
      status: 0,
      error: caught instanceof Error ? caught.message : "Network error calling AiSensy.",
      deliveryUnknown: true,
    };
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : text.slice(0, 300);
    return {
      ok: false,
      status: response.status,
      error: message,
      ...(response.status >= 500 ? { deliveryUnknown: true as const } : {}),
    };
  }

  const messageId =
    typeof body === "object" && body !== null && "submitted_message_id" in body
      ? String((body as { submitted_message_id: unknown }).submitted_message_id)
      : null;

  return { ok: true, status: response.status, messageId };
}
