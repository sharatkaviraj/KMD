import { savedAudienceParams, type SavedAudience } from "@/modules/whatsapp/domain/audience";
import { formatDdMmYyyy } from "@/platform/helpers/date";

/**
 * The send screen, opened on exactly a saved campaign's rule.
 *
 * ONE builder for every link that loads a campaign — the campaigns list, the
 * due-to-run card and the reminder plan. The due card used to build its own
 * `?campaignId=&situation=&language=`, which loaded the campaign's WORDING and
 * none of its audience: "Open" on a Standard-and-Chronic waiver step showed
 * every family on the calendar's default tiles instead.
 *
 * Browser-safe: the campaign manager is a client component and calls this too.
 */

export type LinkableCampaign = {
  id: string;
  situation: string;
  language: string;
  filters: SavedAudience;
  /** ISO, as stored. */
  lastDate: string | null;
  lateFeeAmount: number;
  lateFeeBasis: string;
  lateFeeSource: string | null;
};

export function savedCampaignHref(
  campaign: LinkableCampaign,
  /**
   * The date the message should print, ISO, when the campaign's schedule moves
   * it — a waiver window measured from its installment, an every-morning
   * promise notice. Absent keeps the saved date.
   */
  messageDateIso?: string | null,
): string {
  // Every audience key, explicitly — `installments` as `last_year` for a
  // Last-year campaign — so the send screen opens on exactly the saved rule.
  const params = new URLSearchParams(savedAudienceParams(campaign.filters));
  params.set("situation", campaign.situation);
  params.set("language", campaign.language);
  const lastDate = messageDateIso ?? campaign.lastDate;
  if (lastDate) params.set("lastDate", formatDdMmYyyy(lastDate));
  params.set("lateFeeAmount", String(campaign.lateFeeAmount));
  params.set("lateFeeBasis", campaign.lateFeeBasis);
  // Absent on a campaign saved before the two modes, which is how it keeps the
  // behaviour its template had then.
  if (campaign.lateFeeSource) params.set("lateFeeSource", campaign.lateFeeSource);
  // Carried so the run records which campaign it came from.
  params.set("campaignId", campaign.id);
  return `/fees/reminders?${params.toString()}`;
}
