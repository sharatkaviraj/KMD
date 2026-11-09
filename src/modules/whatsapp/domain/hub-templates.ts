import type { TemplateSubmission } from "@/platform/whatsapp/providers";

import {
  OFFICE_PHONE,
  PAY_URL_PREFIX,
  V6_BUTTON_LABELS,
  V8_CAMPAIGNS,
  type V6Descriptor,
} from "@/modules/whatsapp/domain/campaign-bodies-v6";

/**
 * The `_v8` set as the school's WhatsApp hub takes it (`POST /v1/templates`,
 * the hub's API doc, 9 Nov 2026) — D-566.
 *
 * Everything comes from the same descriptors `_v7` was submitted from, so the
 * two cannot drift: the body exactly (bold title, blank lines and all), the
 * five samples in slot order, category UTILITY, and the two buttons in the
 * order Meta shows them — Pay now opening `https://one.vpps.co.in/pay/{{1}}`
 * and Call office. No footer: `_v7` has none, and the school's name is the
 * body's second line.
 *
 * Server and script only, like template-catalog.ts: it carries every body.
 */

export function hubTemplateSubmission(entry: V6Descriptor): TemplateSubmission {
  const labels = V6_BUTTON_LABELS[entry.language];
  return {
    name: entry.campaignName,
    language: entry.language,
    category: "UTILITY",
    body: entry.body,
    examples: [...entry.metaSamples],
    buttons: entry.buttons.map((button) =>
      button === "pay_url"
        ? { type: "URL" as const, text: labels.pay_url, url: `${PAY_URL_PREFIX}{{1}}` }
        : { type: "PHONE_NUMBER" as const, text: labels.call_office, phone_number: OFFICE_PHONE },
    ),
  };
}

/** The 22 `_v8` templates, Hindi and English, ready for the hub. */
export const HUB_TEMPLATE_SUBMISSIONS: readonly TemplateSubmission[] = V8_CAMPAIGNS.map(hubTemplateSubmission);

/** Registry key → the exact approved wording One expects, for the sync's byte check. */
export function hubExpectedBodies(): ReadonlyMap<string, string> {
  return new Map(V8_CAMPAIGNS.map((entry) => [entry.campaignName, entry.body]));
}
