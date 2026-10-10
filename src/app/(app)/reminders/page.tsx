import { requirePermission } from "@/platform/auth/current-staff";
import { loadReminders } from "@/vx/screens/reminders/load";
import { RemindersScreen } from "@/vx/screens/reminders/screen";

export const runtime = "nodejs";

/** Fee reminders (design `Reminders`): Hindi-first preview, count and cost before anything is queued. */
export default async function RemindersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/reminders");
  const props = await loadReminders(staff, await searchParams);
  return <RemindersScreen {...props} />;
}
