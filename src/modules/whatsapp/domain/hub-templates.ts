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

const HUB_NAMES: ReadonlySet<string> = new Set(HUB_TEMPLATE_SUBMISSIONS.map((submission) => submission.name));

/**
 * The templates a feature's "N of M approved" is counted against. One sends
 * only through the hub, and the hub carries only the names it was given, so
 * once a feature has hub templates its older generations (AiSensy-era names
 * that will never be on the hub) are history, not "still to approve". A
 * feature with no hub templates yet is counted against all of its rows.
 *
 * 9 Nov 2026: on the day 20 of the 22 sent were approved, Settings ->
 * WhatsApp said "Fee reminders: 20 of 76 approved".
 */
export function templatesThatCount<T extends { key: string }>(rows: readonly T[]): T[] {
  const onHub = rows.filter((row) => HUB_NAMES.has(row.key));
  return onHub.length > 0 ? onHub : [...rows];
}

/** Registry key → the exact approved wording One expects, for the sync's byte check. */
export function hubExpectedBodies(): ReadonlyMap<string, string> {
  return new Map(V8_CAMPAIGNS.map((entry) => [entry.campaignName, entry.body]));
}
