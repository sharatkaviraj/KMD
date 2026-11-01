import { notFound, redirect, RedirectType } from "next/navigation";

import { normalizedReceiptUrl } from "@/modules/receipts/vx/domain/reverse-sheet";
import { requirePermission } from "@/platform/auth/current-staff";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import { loadReceiptsDesk } from "@/vx/screens/receipts/load";
import { assertReceiptVisible, notFoundUnlessVisible } from "@/platform/auth/test-session-access";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { canAccessSession } from "@/platform/auth/test-session-policy";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { getBridgeReceiptDetail } from "@/platform/fees-bridge/client";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { CanonicalReceipt, CanonicalReceiptUnavailable } from "@/vx/screens/receipts/canonical-receipt";

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
  const search = await searchParams;
  const requestedSession = typeof search.session === "string" ? search.session : null;
  const session = requestedSession ?? await getViewSessionCookie();
  if (usesCanonicalFees(staff, session)) {
    // A display number alone must never choose an unrelated local receipt.
    const receiptId = typeof search.receiptId === "string" ? search.receiptId : "";
    if (!requestedSession || !/^\d{4}-\d{2}$/.test(requestedSession) || !canAccessSession(staff, requestedSession)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receiptId)) notFound();
    let receipt;
    try { receipt = await getBridgeReceiptDetail(receiptId, requestedSession); }
    catch (error) {
      if (error instanceof FeesBridgeError && ["not_found", "forbidden", "unauthorized"].includes(error.code)) notFound();
      return <CanonicalReceiptUnavailable language={staff.language} />;
    }
    if (receipt.detail.receiptNumber !== receiptNumber) notFound();
    return <CanonicalReceipt receipt={receipt} language={staff.language} />;
  }
  const props = await loadReceiptsDesk(staff, search, decodeURIComponent(receiptNumber));
  if (!props.selected) notFound();
  // A receipt number is global; its student decides who may open it (Phase 3).
  const selectedNumber = props.selected.receiptNumber;
  await notFoundUnlessVisible(() => assertReceiptVisible(staff, { receiptNumber: selectedNumber }));
  // `?sheet=reverse` on a receipt already reversed (a stale link, or the URL
  // the reversal itself was made from): replace it with the plain receipt URL
  // so a reload or a shared link shows the Reversed state, not the sheet (B08).
  const normalized = normalizedReceiptUrl(`/receipts/${encodeURIComponent(props.selected.receiptNumber)}`, search, props.sheet);
  if (normalized) redirect(normalized, RedirectType.replace);
  return <ReceiptsDesk {...props} />;
}
