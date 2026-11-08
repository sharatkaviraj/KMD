import { requirePermission } from "@/platform/auth/current-staff";
import { FamilyScreen } from "@/vx/screens/families/family-screen";
import { FamiliesFeesUnavailable, loadFamilies } from "@/vx/screens/families/load";
import { W } from "@/vx/screens/families/words";
import { FeesScreenUnavailable } from "@/vx/ui/live-fees";

export const runtime = "nodejs";

export const metadata = { title: "Family" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One family (owner, 8 Nov 2026): the parents with Call and WhatsApp, the
 * year's fees for every child together, and each child with Open child and
 * Collect fee. An id that is not a family id draws "not found", never an error.
 */
export default async function FamilyPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requirePermission("fees:view", "/families");
  const { groupId } = await params;
  const id = UUID.test(groupId) ? groupId.toLowerCase() : null;
  const data = id
    ? await loadFamilies(staff, await searchParams, id).catch((error: unknown) => {
        if (error instanceof FamiliesFeesUnavailable) return error;
        throw error;
      })
    : null;
  if (data instanceof FamiliesFeesUnavailable) return <FeesScreenUnavailable title={W.title} crumb={data.sessionLabel} />;
  if (!data || !id) return <FamilyScreen sessionLabel="" asOf={null} test={false} families={[]} canCollect={false} canOpenChildren={false} canChange={false} groupId="" />;
  return <FamilyScreen {...data} groupId={id} />;
}
