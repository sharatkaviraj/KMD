import { requirePermission } from "@/platform/auth/current-staff";
import { DuesScreen } from "@/vx/screens/dues/screen";
import { loadDues } from "@/vx/screens/dues/load";

export const runtime = "nodejs";

/** Dues & calls (design `Dues`): who to call, promises, left owing, aging. */
export default async function DuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/dues");
  const props = await loadDues(staff, await searchParams);
  return <DuesScreen {...props} />;
}
