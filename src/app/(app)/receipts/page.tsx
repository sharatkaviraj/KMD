import { requirePermission } from "@/platform/auth/current-staff";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import { loadReceiptsDesk } from "@/vx/screens/receipts/load";

export const runtime = "nodejs";

/** Receipts and the day close (design `Fees`): list, filters, count and close. */
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/receipts");
  const props = await loadReceiptsDesk(staff, await searchParams);
  return <ReceiptsDesk {...props} />;
}
