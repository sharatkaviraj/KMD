import type { HubTemplateSubmission, SignInTemplateSubmission, TemplateSubmission } from "@/platform/whatsapp/providers";

import {
  OFFICE_PHONE,
  PAY_URL_PREFIX,
  V6_BUTTON_LABELS,
  V8_CAMPAIGNS,
  type V6Descriptor,
} from "@/modules/whatsapp/domain/campaign-bodies-v6";
import { AWAY_NOTE_HUB_SUBMISSIONS, HELPER_HUB_SUBMISSIONS } from "@/modules/whatsapp/domain/helper-hub-templates";
import { SCHOOL_NOTICE_TEMPLATES } from "@/modules/whatsapp/domain/school-notice-bodies";
import { SIGN_IN_CODE_MINUTES, SIGN_IN_TEMPLATE } from "@/modules/whatsapp/domain/sign-in-code";
import { STAFF_HUB_SUBMISSIONS } from "@/modules/whatsapp/domain/staff-hub-templates";

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
export const V8_HUB_SUBMISSIONS: readonly TemplateSubmission[] = V8_CAMPAIGNS.map(hubTemplateSubmission);

/**
 * The parents' school notices — absent today, school closed, exam schedule,
 * PTM — as they are, Hindi and English (D-573). They were written for Meta
 * from the start (a bold title, the school's name, a labelled line per value,
 * Call office), and their registry rows already carry these names.
 */
export const SCHOOL_NOTICE_HUB_SUBMISSIONS: readonly TemplateSubmission[] = SCHOOL_NOTICE_TEMPLATES.map((entry) => ({
  name: entry.campaignName,
  language: entry.language,
  category: "UTILITY" as const,
  body: entry.body,
  examples: [...entry.metaSamples],
  buttons: [{ type: "PHONE_NUMBER" as const, text: V6_BUTTON_LABELS[entry.language].call_office, phone_number: OFFICE_PHONE }],
}));

/**
 * Everything One asks the hub to carry: the `_v8` fee set, the parents'
 * school notices, the staff and teacher-task set (`staff-hub-templates.ts`),
 * and Veer Patta AI's (`helper-hub-templates.ts`: the alert and the answer
 * note, D-578, and the away note with its three buttons, D-602). "Send for
 * approval" and the hourly check both work from this list.
 */
export const HUB_TEMPLATE_SUBMISSIONS: readonly TemplateSubmission[] = [
  ...V8_HUB_SUBMISSIONS,
  ...SCHOOL_NOTICE_HUB_SUBMISSIONS,
  ...STAFF_HUB_SUBMISSIONS,
  ...HELPER_HUB_SUBMISSIONS,
  ...AWAY_NOTE_HUB_SUBMISSIONS,
];

/**
 * The sign-in code, Hindi and English (D-585): Meta's AUTHENTICATION kind.
 * Meta writes the words and the Copy code button; One says only how long a
 * code works. The message is dropped if WhatsApp cannot deliver it within
 * those same ten minutes, because a code that arrives late is no use. No
 * body, so there is no wording to hold an approval to (`hubExpectedBodies`
 * leaves them out).
 */
export const SIGN_IN_HUB_SUBMISSIONS: readonly SignInTemplateSubmission[] = (["hi", "en"] as const).map((language) => ({
  name: SIGN_IN_TEMPLATE[language],
  language,
  category: "AUTHENTICATION" as const,
  code_expiration_minutes: SIGN_IN_CODE_MINUTES,
  message_send_ttl_seconds: SIGN_IN_CODE_MINUTES * 60,
  button_text: language === "hi" ? "कोड कॉपी करें" : "Copy code",
}));

/** Everything "Send for approval" and the hourly check send: the list above and the two sign-in codes. */
export const ALL_HUB_SUBMISSIONS: readonly HubTemplateSubmission[] = [...HUB_TEMPLATE_SUBMISSIONS, ...SIGN_IN_HUB_SUBMISSIONS];

/**
 * How many one press of "Send for approval" sends, and how many the hourly
 * check sends by itself. Each takes the hub about five seconds, three at a
 * time; the hourly job shares its minute with the template check and pg_net
 * gives up after 55 seconds.
 */
export const HUB_SUBMIT_PER_PRESS = 24;
export const HUB_SUBMIT_PER_HOUR = 15;

const HUB_NAMES: ReadonlySet<string> = new Set(ALL_HUB_SUBMISSIONS.map((submission) => submission.name));

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
  return new Map(HUB_TEMPLATE_SUBMISSIONS.map((submission) => [submission.name, submission.body]));
}
