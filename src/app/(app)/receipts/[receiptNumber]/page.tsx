import { notFound } from "next/navigation";

import { requirePermission } from "@/platform/auth/current-staff";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import { loadReceiptsDesk } from "@/vx/screens/receipts/load";

export const runtime = "nodejs";

/** One receipt beside the day's list: print, share preview, reversal. */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ receiptNumber: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { receiptNumber } = await params;
  const staff = await requirePermission("fees:view", "/receipts");
  const props = await loadReceiptsDesk(staff, await searchParams, decodeURIComponent(receiptNumber));
  if (!props.selected) notFound();
  return <ReceiptsDesk {...props} />;
}
