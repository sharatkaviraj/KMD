import { requirePermission } from "@/platform/auth/current-staff";
import { FamiliesScreen } from "@/vx/screens/families/families-screen";
import { FamiliesFeesUnavailable, loadFamilies } from "@/vx/screens/families/load";
import { W } from "@/vx/screens/families/words";
import { FeesScreenUnavailable } from "@/vx/ui/live-fees";

export const runtime = "nodejs";

export const metadata = { title: "Families" };

/**
 * Families (owner, 8 Nov 2026): brothers and sisters in the school with their
 * fees together, searchable by child, parent, phone or SR. Real staff on a
 * real year read Fees itself; test accounts and TEST years read One's copy.
 */
export default async function FamiliesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/families");
  const data = await loadFamilies(staff, await searchParams).catch((error: unknown) => {
    if (error instanceof FamiliesFeesUnavailable) return error;
    throw error;
  });
  if (data instanceof FamiliesFeesUnavailable) return <FeesScreenUnavailable title={W.title} crumb={data.sessionLabel} />;
  return <FamiliesScreen {...data} />;
}
