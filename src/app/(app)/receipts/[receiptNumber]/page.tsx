import { notFound, redirect, RedirectType } from "next/navigation";

import { normalizedReceiptUrl } from "@/modules/receipts/vx/domain/reverse-sheet";
import { requirePermission } from "@/platform/auth/current-staff";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import { loadReceiptsDesk } from "@/vx/screens/receipts/load";
import { assertReceiptVisible, notFoundUnlessVisible } from "@/platform/auth/test-session-access";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { canAccessSession } from "@/platform/auth/test-session-policy";
import { feesBridgeOfficeReads, feesBridgeWritesEnabled, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { getBridgeReceiptDetail, lookupBridgeReceipt } from "@/platform/fees-bridge/client";
import { RECEIPT_NUMBER } from "@/platform/fees-bridge/office-read-contracts";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { CanonicalReceipt, CanonicalReceiptUnavailable, type ReceiptUnavailableReason } from "@/vx/screens/receipts/canonical-receipt";

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

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
    // Every refusal below explains itself rather than ending in a 404 (F02).
    const number = safeDecode(receiptNumber);
    const receiptId = typeof search.receiptId === "string" ? search.receiptId : "";
    const unavailable = (reason: ReceiptUnavailableReason, id?: string) => (
      <CanonicalReceiptUnavailable language={staff.language} reason={reason} receiptNumber={number} receiptId={id} sessionLabel={requestedSession ?? undefined} />
    );
    const pinned = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receiptId);
    // An older link with only the number: Fees resolves it to the exact receipt, under the detail rule.
    if (!pinned && feesBridgeOfficeReads() && session && /^\d{4}-\d{2}$/.test(session) && canAccessSession(staff, session) && RECEIPT_NUMBER.test(number)) {
      const found = await lookupBridgeReceipt(number, session).catch(() => null);
      if (found) redirect(`/receipts/${encodeURIComponent(found.receiptNumber)}?${new URLSearchParams({ receiptId: found.receiptId, session })}`, RedirectType.replace);
    }
    if (!requestedSession || !/^\d{4}-\d{2}$/.test(requestedSession) || !canAccessSession(staff, requestedSession)) return unavailable(requestedSession ? "access" : "missing_link");
    if (!pinned) return unavailable("missing_link");
    let receipt;
    try { receipt = await getBridgeReceiptDetail(receiptId, requestedSession); }
    catch (error) {
      const code = error instanceof FeesBridgeError ? error.code : "";
      // Refused and missing read alike, so the page never confirms a refused receipt exists.
      return code === "forbidden" || code === "not_found" ? unavailable("unreadable") : code === "unauthorized" ? unavailable("access") : unavailable("error", receiptId);
    }
    // The number in the address must be this receipt's; compared decoded, as the local branch does.
    if (receipt.detail.receiptNumber !== number) return unavailable("unreadable");
    const feeRole = feePermissionsFor(staff.role);
    return <CanonicalReceipt receipt={receipt} language={staff.language} canPrint={feeRole.includes("receipts:print")} canReverse={feesBridgeWritesEnabled() && feeRole.includes("payments:reverse_any")} />;
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
