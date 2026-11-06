import { requirePermission } from "@/platform/auth/current-staff";
import { DuesScreen } from "@/vx/screens/dues/screen";
import { DuesFeesUnavailable, loadDues } from "@/vx/screens/dues/load";
import { W } from "@/vx/screens/dues/words";
import { FeesScreenUnavailable } from "@/vx/ui/live-fees";

export const runtime = "nodejs";

/** Dues & calls (design `Dues`): who to call, promises, left owing, aging. */
export default async function DuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/dues");
  // Live from Fees and Fees did not answer: say so, never draw One's copy instead.
  const props = await loadDues(staff, await searchParams).catch((error: unknown) => {
    if (error instanceof DuesFeesUnavailable) return error;
    throw error;
  });
  if (props instanceof DuesFeesUnavailable) return <FeesScreenUnavailable title={W.title} crumb={props.sessionLabel} />;
  return <DuesScreen {...props} />;
}
