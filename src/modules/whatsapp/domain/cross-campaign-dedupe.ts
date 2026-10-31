import { addDays, cadenceGapDays, type ReminderCadence } from "@/modules/whatsapp/domain/reminder-cadence";

/**
 * Has this family already had a reminder today, or inside its cadence window,
 * under ANY campaign name? (VPPS One only — go-live Phase D, critique0 #11.)
 *
 * The claim index (`whatsapp_reminder_sends_reminder_day_idx`) includes
 * `campaign_name`, so it stops a second `_v7` message but not a `_v7` one after
 * the fees app's `_v6` one — two apps, two names, one parent messaged twice.
 * And the audience reads "sent today" only against the names this notice goes
 * out under. So before One sends, it asks the send log about the family's
 * children by student alone.
 *
 * `latestSentOn` is each child's newest `sent_on` with status sent, pending or
 * covered_by_sibling (a failed send reached nobody). A child whose cadence is
 * `every_run` is still held to one message a day; `never` holds for the whole
 * window the caller read. Test sessions skip this check altogether — they have
 * no parents to protect, and the office re-tests on its own number.
 */
export const CROSS_CAMPAIGN_LOOKBACK_DAYS = 31;

export function familyMessagedRecently(args: {
  members: ReadonlyArray<{ studentId: string; cadence: ReminderCadence | null | undefined }>;
  latestSentOn: ReadonlyMap<string, string>;
  today: string;
}): boolean {
  return args.members.some((member) => {
    const last = args.latestSentOn.get(member.studentId);
    if (!last) return false;
    const gap = Math.max(1, cadenceGapDays(member.cadence ?? "every_run"));
    // Blocked while the last send is inside the window: on `today` for a gap
    // of one day, within the last seven days for weekly, and so on.
    if (!Number.isFinite(gap)) return last >= addDays(args.today, -CROSS_CAMPAIGN_LOOKBACK_DAYS);
    return last > addDays(args.today, -gap);
  });
}

/** The earliest `sent_on` the caller needs to read for the check above. */
export function crossCampaignSince(today: string): string {
  return addDays(today, -CROSS_CAMPAIGN_LOOKBACK_DAYS);
}
