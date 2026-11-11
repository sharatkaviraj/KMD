import {
  campaignFor,
  campaignNameFor,
  type NoticeLanguage,
  type NoticeSituation,
} from "@/modules/whatsapp/domain/campaigns";

/**
 * Which template GENERATION a notice goes out under today — by name only.
 *
 * Kept apart from `campaign-bodies-v6.ts`, which holds the bodies, so that
 * code that only needs a NAME (the scheduled runner, the guards, "already
 * messaged today") never pulls a template body along with it. The bodies stay
 * where only the server that renders or sends them can reach them.
 */

/** `vpps_app_fee_due_hi_v6` — the template and AiSensy campaign name, one string. */
export function v6CampaignName(situation: NoticeSituation, language: NoticeLanguage): string {
  return `vpps_app_${situation}_${language}_v6`;
}

/**
 * The `_v6` templates Meta has approved AND whose AiSensy API campaign is Live.
 *
 * A template is listed only once both are true. Flipped here, in code, and
 * deployed — exactly as every generation before it. Nothing on a screen or in a
 * settings row can switch a parent onto a template Meta has not approved.
 *
 * All 24 were approved by Meta as UTILITY and given a Live API campaign of the
 * same name on 2026-10-26. `fee_due_hi` (Pay now, six params) and
 * `late_fee_applied_en` (no Pay now, five) were test-sent to the office number
 * and delivered.
 */
export const APPROVED_V6: ReadonlySet<string> = new Set<string>([
  "vpps_app_fee_due_hi_v6",
  "vpps_app_fee_due_en_v6",
  "vpps_app_balance_hi_v6",
  "vpps_app_balance_en_v6",
  "vpps_app_prevyear_hi_v6",
  "vpps_app_prevyear_en_v6",
  "vpps_app_upcoming_hi_v6",
  "vpps_app_upcoming_en_v6",
  "vpps_app_upcoming_final_hi_v6",
  "vpps_app_upcoming_final_en_v6",
  "vpps_app_exam_clearance_hi_v6",
  "vpps_app_exam_clearance_en_v6",
  "vpps_app_late_fee_applied_hi_v6",
  "vpps_app_late_fee_applied_en_v6",
  "vpps_app_late_fee_waiver_hi_v6",
  "vpps_app_late_fee_waiver_en_v6",
  "vpps_app_waiver_last_call_hi_v6",
  "vpps_app_waiver_last_call_en_v6",
  "vpps_app_overdue_final_hi_v6",
  "vpps_app_overdue_final_en_v6",
  "vpps_app_promise_lapsed_hi_v6",
  "vpps_app_promise_lapsed_en_v6",
  "vpps_app_promise_due_hi_v6",
  "vpps_app_promise_due_en_v6",
]);

/**
 * Approved in the FEES APP's AiSensy account — VPPS One never sends one.
 *
 * Kept so One can recognise the fees app's own `_v6` sends in the shared send
 * log ("already messaged today"). The parent-send gate refuses any `_v6` name
 * outright (src/platform/messaging/parent-send-gate.ts).
 */
export function isV6Approved(situation: NoticeSituation, language: NoticeLanguage): boolean {
  return APPROVED_V6.has(v6CampaignName(situation, language));
}

/* ------------------------------------------------------------------ _v7 */

/**
 * The `_v7` notices: VPPS One's Pay now generation (go-live Phase D, plan §6.2).
 *
 * Meta fixes a URL button's host when it approves the template, and every
 * `_v6` Pay now button points at the fees app's host. So One cannot send
 * `_v6`: a parent tapping Pay now would land in the old app. `_v7` is the
 * same eleven notices, word for word and slot for slot — the body's five
 * params, then the Pay now suffix as the sixth — with only the button's host
 * changed to `https://one.vpps.co.in/pay/`. `late_fee_applied` has no Pay now
 * button and so no `_v7`; it goes out under the earlier text-only generation.
 *
 * Submitted by the owner from docs/cutover/AISENSY-TEMPLATES.md.
 */
export const V7_SITUATIONS: readonly NoticeSituation[] = [
  "upcoming",
  "upcoming_final",
  "fee_due",
  "balance",
  "overdue_final",
  "late_fee_waiver",
  "waiver_last_call",
  "promise_due",
  "promise_lapsed",
  "exam_clearance",
  "prevyear",
];

/** `vpps_app_fee_due_hi_v7` — the template and AiSensy campaign name, one string. */
export function v7CampaignName(situation: NoticeSituation, language: NoticeLanguage): string {
  return `vpps_app_${situation}_${language}_v7`;
}

/**
 * The `_v7` templates Meta has approved AND whose AiSensy API campaign is Live.
 *
 * Empty until the owner reports both, name by name. Until a notice is listed
 * here it goes out under the earlier text-only generation (`_v2`–`_v4`), with
 * no Pay now button — never under `_v6`. Flipped in code and deployed, like
 * every generation before it.
 */
export const APPROVED_V7: ReadonlySet<string> = new Set<string>([]);

export function isV7Approved(situation: NoticeSituation, language: NoticeLanguage): boolean {
  return V7_SITUATIONS.includes(situation) && APPROVED_V7.has(v7CampaignName(situation, language));
}

/* ------------------------------------------------------------------ _v8 */

/**
 * The `_v8` notices: the `_v7` set on the school's WhatsApp hub (D-566).
 *
 * Templates are approved per WhatsApp Business Account. `_v7` was submitted
 * on the fees app's AiSensy account (the +91 80 4713 6289 number), which One
 * never sends from, so the hub's account (+91 83022 07823) needs its own
 * copy. `_v8` is `_v7` byte for byte — the body, the five slots, the samples,
 * the Pay now and Call office buttons — under a new name, submitted through
 * the hub's `POST /v1/templates` (Settings → WhatsApp).
 */
export const V8_SITUATIONS: readonly NoticeSituation[] = V7_SITUATIONS;

/** `vpps_app_fee_due_hi_v8` — the template's name on the hub's account. */
export function v8CampaignName(situation: NoticeSituation, language: NoticeLanguage): string {
  return `vpps_app_${situation}_${language}_v8`;
}

/**
 * The `_v8` templates the hub's own list (`GET /v1/templates`, shown in
 * Settings → WhatsApp) reads as APPROVED. Kept apart from `APPROVED_V7`, which
 * is the AiSensy account's, and filled only from an APPROVED status there —
 * never PENDING, never a template approved somewhere else. Flipped in code
 * and deployed, like every generation before it; the registry row must ALSO
 * read approved before anything goes (platform/whatsapp/policy.ts).
 *
 * Filled 9 Nov 2026 (09:16 UTC) from the hub's list: these 20 read APPROVED
 * there AND passed One's own check (button opens one.vpps.co.in, five blanks,
 * the `_v7` wording to the byte), so their registry rows read approved too.
 * The last two, `vpps_app_upcoming_hi_v8` and `vpps_app_promise_lapsed_hi_v8`,
 * read approved at 08:05 UTC on 10 Nov: Meta's status reached the hub, the hub
 * forwarded it, and One's own check passed them. All 22 are in.
 */
export const APPROVED_HUB: ReadonlySet<string> = new Set<string>([
  "vpps_app_balance_en_v8",
  "vpps_app_balance_hi_v8",
  "vpps_app_exam_clearance_en_v8",
  "vpps_app_exam_clearance_hi_v8",
  "vpps_app_fee_due_en_v8",
  "vpps_app_fee_due_hi_v8",
  "vpps_app_late_fee_waiver_en_v8",
  "vpps_app_late_fee_waiver_hi_v8",
  "vpps_app_overdue_final_en_v8",
  "vpps_app_overdue_final_hi_v8",
  "vpps_app_prevyear_en_v8",
  "vpps_app_prevyear_hi_v8",
  "vpps_app_promise_due_en_v8",
  "vpps_app_promise_due_hi_v8",
  "vpps_app_promise_lapsed_en_v8",
  "vpps_app_promise_lapsed_hi_v8",
  "vpps_app_upcoming_en_v8",
  "vpps_app_upcoming_final_en_v8",
  "vpps_app_upcoming_final_hi_v8",
  "vpps_app_upcoming_hi_v8",
  "vpps_app_waiver_last_call_en_v8",
  "vpps_app_waiver_last_call_hi_v8",
]);

export function isHubApproved(situation: NoticeSituation, language: NoticeLanguage): boolean {
  return V8_SITUATIONS.includes(situation) && APPROVED_HUB.has(v8CampaignName(situation, language));
}

/**
 * The campaign NAME a notice goes out under today in VPPS One: the hub's
 * `_v8` one once it is approved there, then `_v7` (never while One has no
 * AiSensy: `APPROVED_V7` stays empty), then the earlier text-only generation.
 * Never `_v6`. Throws, like `campaignFor`, when none is sendable.
 */
export function activeCampaignName(situation: NoticeSituation, language: NoticeLanguage): string {
  if (isHubApproved(situation, language)) return v8CampaignName(situation, language);
  return isV7Approved(situation, language)
    ? v7CampaignName(situation, language)
    : campaignFor(situation, language).campaignName;
}

/** Like `activeCampaignName`, but never throws — for a screen that must render an unapproved notice. */
export function activeCampaignNameOrNull(
  situation: NoticeSituation,
  language: NoticeLanguage,
): string | null {
  if (isHubApproved(situation, language)) return v8CampaignName(situation, language);
  return isV7Approved(situation, language)
    ? v7CampaignName(situation, language)
    : campaignNameFor(situation, language);
}
