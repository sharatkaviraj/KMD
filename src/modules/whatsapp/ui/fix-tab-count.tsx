import "server-only";

import { countFixFamilies } from "@/modules/whatsapp/data/fix-desk";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import { cn } from "@/platform/utils";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

/**
 * The red count on the Fix tab: families a reminder did not reach, still open.
 *
 * The SAME number as the cards on the Fix page — both read `loadFixDesk`, and
 * `cache()` makes them one read on that page. Renders nothing at zero, so a
 * clean day shows a plain tab rather than a "0" badge nobody needs.
 *
 * A server component inside `<Suspense>`: it costs the send screen's client
 * bundle nothing, and no Reminders page waits for it.
 */
export async function FixTabCount({ onAccent }: { onAccent: boolean }) {
  const supabase = createAdminClient();
  const sessionLabel = await resolveReminderSessionLabel(supabase).catch(() => null);
  if (!sessionLabel) return null;
  const count = await countFixFamilies(sessionLabel);
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} to fix`}
      className={cn(
        "inline-grid min-w-[1.15rem] place-items-center rounded-full px-1 text-[10.5px] font-bold leading-[1.15rem] tabular-nums",
        onAccent ? "bg-accent-foreground text-accent" : "bg-destructive text-destructive-foreground",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
