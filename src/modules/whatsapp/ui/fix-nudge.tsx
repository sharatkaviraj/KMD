import "server-only";

import Link from "next/link";

import { loadFixDesk } from "@/modules/whatsapp/data/fix-desk";
import { addDays } from "@/modules/whatsapp/domain/reminder-cadence";
import { formatInr } from "@/platform/helpers/currency";

/**
 * One line on the Send screen when recent reminders did not reach families.
 *
 * Only the last two days: an older failure is the Fix tab's business, and a
 * line that is always there is a line nobody reads. A server component inside
 * `<Suspense>`, so the send screen — under a gzip ceiling that only ratchets
 * down — ships no JavaScript for it and does not wait for it.
 */
export async function FixNudge({ sessionLabel }: { sessionLabel: string }) {
  const desk = await loadFixDesk(sessionLabel).catch(() => null);
  if (!desk) return null;
  const since = addDays(desk.today, -1);
  const recent = desk.families.filter((family) => family.latest.sentOn >= since);
  if (recent.length === 0) return null;
  const owed = recent.reduce((total, family) => total + family.latest.dueAmount, 0);
  return (
    <Link
      href="/fees/reminders/fix"
      className="tap focus-ring flex min-h-11 items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-2.5 text-sm"
    >
      <span>
        <strong className="tabular-nums">{recent.length}</strong>{" "}
        {recent.length === 1 ? "family" : "families"} did not get a reminder since yesterday ·{" "}
        {formatInr(owed)} asked for
      </span>
      <span className="shrink-0 font-semibold text-destructive">Fix →</span>
    </Link>
  );
}
