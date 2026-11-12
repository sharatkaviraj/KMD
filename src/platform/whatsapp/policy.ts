import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import { FEES_AISENSY_NUMBER, SCHOOL_WHATSAPP_NUMBER, toE164 } from "@/platform/whatsapp/numbers";

/**
 * Whether one WhatsApp message may go out of One, and if not, why (D-562).
 *
 * This sits UNDER the parent-send gate (platform/messaging/parent-send-gate.ts)
 * and the staff gates, never instead of them: those decide whether this person
 * should hear about this; this decides whether the school's number may send
 * this message now. In order, and every check fails closed:
 *
 *  1. The number is a mobile number, is not the fees app's AiSensy number and
 *     is not the school's own.
 *  2. Every switch could be read.
 *  2a. This kind of message is One's to send, not the Fees app's
 *     (`FEES_APP_FEATURES`, `whatsapp_fee_sender`).
 *  3. This feature is switched on (`whatsapp_features`).
 *  4. A template message names a registry row that is APPROVED, with the same
 *     number of blanks, the same PDF header and the same button. A typed
 *     message goes only inside the 24 hours after the person last wrote.
 *  5. While `whatsapp_real_recipients` is off — and it is off until the owner
 *     writes that it may go on — the ONLY number One may message is the
 *     owner's own (`whatsapp_owner_test_number`), whoever the message is for.
 *  6. Practice mode (`whatsapp_dry_run`): logged, never sent.
 *  7. The deployment is connected to the school's server, from the school's
 *     number.
 *
 * The day's limit is the last check and lives in Postgres
 * (`whatsapp_claim_send`), because two senders at once must not both take the
 * last place. Pure: the switches, the template row and the config come in.
 */

export const WHATSAPP_FEATURES = [
  "fee_reminder",
  "receipt",
  "reversal",
  "fee_statement",
  "school_notice",
  "absent_notice",
  "collection_request",
  "report_delivery",
  "general",
  "staff_notice",
  "teacher_task",
  // Veer Patta AI, the school's helper, answering a parent who wrote to the
  // school's number (D-574). Typed replies inside the 24 hours, no templates.
  "parent_helper",
] as const;
export type WhatsAppFeature = (typeof WHATSAPP_FEATURES)[number];

/**
 * The messages the Fees app sends to parents from its own number (AiSensy,
 * +91 80 4713 6289): fee reminders, receipts, reversal notices and fee
 * statements. The owner, 11 Nov 2026: "keep both the apps separate", each on
 * its own number, sending different messages. So while the Fees app sends
 * these, One refuses them, whatever its own switches say, and a parent never
 * gets the same message from two numbers.
 *
 * `whatsapp_fee_sender` in `runtime_flags` says who sends them: `fees` (and a
 * missing or unreadable row) means the Fees app; only `one`, written on the
 * owner's word once the Fees app has stopped sending them, lets One. The Fees
 * app's number is temporary: when it is retired, the Fees app joins the
 * school's hub with its own key, or One takes these over by that one row.
 */
export const FEES_APP_FEATURES: ReadonlySet<WhatsAppFeature> = new Set<WhatsAppFeature>(["fee_reminder", "receipt", "reversal", "fee_statement"]);

export type FeeSender = "fees" | "one";

/** Is this kind of message the Fees app's to send while `sender` says so? */
export function sentByFeesApp(feature: WhatsAppFeature, sender: FeeSender | undefined): boolean {
  return FEES_APP_FEATURES.has(feature) && sender !== "one";
}

export function isWhatsAppFeature(value: unknown): value is WhatsAppFeature {
  return typeof value === "string" && (WHATSAPP_FEATURES as readonly string[]).includes(value);
}

export type WhatsAppSwitches = {
  dryRun: boolean;
  features: Partial<Record<WhatsAppFeature, boolean>>;
  realRecipients: boolean;
  ownerTestNumber: string | null;
  dailyLimit: number;
  /** Who sends the fee messages (`FEES_APP_FEATURES`). Missing means the Fees app. */
  feeSender?: FeeSender;
};

export type TemplateRow = {
  key: string;
  provider_name: string;
  language_code: string;
  feature: string;
  body_params: number;
  header: string;
  url_button: boolean;
  status: string;
};

export type WhatsAppRefusal =
  | "bad_destination"
  | "fees_number"
  | "fees_app_sends"
  | "own_number"
  | "read_failed"
  | "feature_off"
  | "template_not_approved"
  | "template_mismatch"
  | "outside_24h"
  | "not_owner_test_number"
  | "not_configured"
  | "daily_limit";

export type PolicyInput = {
  feature: WhatsAppFeature;
  to: string;
  /** null when the switches could not be read. */
  switches: WhatsAppSwitches | null;
  config: WhatsAppConfig;
} & (
  | {
      kind: "template";
      /** The registry row, or null when there is none. */
      template: TemplateRow | null;
      language: string | null;
      bodyParamCount: number;
      hasDocument: boolean;
      hasUrlButton: boolean;
    }
  | {
      kind: "text";
      /** Did this number write to the school in the last 24 hours? null: unknown. */
      wroteInLast24h: boolean | null;
    }
);

export type PolicyVerdict =
  | { decision: "send"; to: string }
  | { decision: "dry_run"; to: string }
  | { decision: "refuse"; code: WhatsAppRefusal; reason: string; to: string | null };

function refuse(code: WhatsAppRefusal, reason: string, to: string | null): PolicyVerdict {
  return { decision: "refuse", code, reason, to };
}

export function checkWhatsAppSend(input: PolicyInput): PolicyVerdict {
  const to = toE164(input.to);
  if (!to) return refuse("bad_destination", "The number is not a mobile number.", null);
  if (to === FEES_AISENSY_NUMBER) return refuse("fees_number", "That is the fees app's AiSensy number. One never messages it.", to);
  if (to === SCHOOL_WHATSAPP_NUMBER) return refuse("own_number", "That is the school's own WhatsApp number.", to);

  const switches = input.switches;
  if (!switches) return refuse("read_failed", "Could not read the WhatsApp switches. Not sent.", to);

  if (sentByFeesApp(input.feature, switches.feeSender)) {
    return refuse("fees_app_sends", "The Fees app sends this message from its own number. One does not send it too.", to);
  }

  if (switches.features[input.feature] !== true) {
    return refuse("feature_off", `WhatsApp for "${input.feature}" is switched off in Settings.`, to);
  }

  if (input.kind === "template") {
    const row = input.template;
    if (!row || row.status !== "approved") {
      return refuse("template_not_approved", "This template is not approved on the school's WhatsApp yet.", to);
    }
    if (/_v6$/i.test(row.key) || /_v6$/i.test(row.provider_name)) {
      return refuse("template_mismatch", "One never sends a _v6 template: its Pay now link belongs to the fees app.", to);
    }
    if (input.language && input.language !== row.language_code) {
      return refuse("template_mismatch", `The approved template is in "${row.language_code}", not "${input.language}".`, to);
    }
    if (row.body_params !== input.bodyParamCount) {
      return refuse("template_mismatch", `The approved template has ${row.body_params} blanks; this message filled ${input.bodyParamCount}.`, to);
    }
    if ((row.header === "document") !== input.hasDocument) {
      return refuse("template_mismatch", row.header === "document" ? "The approved template needs the PDF attached." : "The approved template has no PDF.", to);
    }
    if (row.url_button !== input.hasUrlButton) {
      return refuse("template_mismatch", row.url_button ? "The approved template needs its button link." : "The approved template has no button.", to);
    }
  } else if (input.wroteInLast24h !== true) {
    return refuse("outside_24h", "A typed message can go only within 24 hours of the person's last message.", to);
  }

  if (!switches.realRecipients) {
    const owner = toE164(switches.ownerTestNumber ?? "");
    if (!owner || owner !== to) {
      return refuse(
        "not_owner_test_number",
        "While testing, One may message only the owner's own number. Messages to anybody else are switched off.",
        to,
      );
    }
  }

  if (switches.dryRun) return { decision: "dry_run", to };

  if (!input.config.ok) return refuse("not_configured", input.config.reason, to);

  return { decision: "send", to };
}

/** `runtime_flags` rows as the switches, or null when any one is missing or the wrong shape. */
export function switchesFromFlags(
  rows: ReadonlyArray<{ key: string; enabled: boolean | null; value: unknown }>,
): WhatsAppSwitches | null {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const dryRun = byKey.get("whatsapp_dry_run");
  const features = byKey.get("whatsapp_features");
  const real = byKey.get("whatsapp_real_recipients");
  const owner = byKey.get("whatsapp_owner_test_number");
  const limit = byKey.get("whatsapp_daily_limit");
  const feeSender = byKey.get("whatsapp_fee_sender");
  if (!dryRun || !features || !real || !owner || !limit) return null;

  const featureValue = features.value;
  if (!featureValue || typeof featureValue !== "object" || Array.isArray(featureValue)) return null;
  const featureMap: Partial<Record<WhatsAppFeature, boolean>> = {};
  for (const feature of WHATSAPP_FEATURES) {
    // A switched-off row lists nothing, whatever its value says.
    featureMap[feature] = features.enabled === true && (featureValue as Record<string, unknown>)[feature] === true;
  }

  const limitValue = Number(limit.value);
  return {
    // Practice mode is ON unless the row says, in so many words, that it is off.
    dryRun: dryRun.enabled !== false,
    features: featureMap,
    realRecipients: real.enabled === true,
    ownerTestNumber: owner.enabled === true && typeof owner.value === "string" ? owner.value : null,
    dailyLimit: limit.enabled === true && Number.isInteger(limitValue) && limitValue >= 0 ? limitValue : 0,
    // The Fees app's unless the row says, in so many words, that One sends them.
    feeSender: feeSender?.enabled === true && feeSender.value === "one" ? "one" : "fees",
  };
}
