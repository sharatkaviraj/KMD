import { notFound, redirect, RedirectType } from "next/navigation";

import { normalizedReceiptUrl } from "@/modules/receipts/vx/domain/reverse-sheet";
import { requirePermission } from "@/platform/auth/current-staff";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import { ReceiptDocument } from "@/modules/receipts/ui/receipt-document";
import { createBilingualReceiptTranslator } from "@/platform/i18n/bilingual-receipt";
import { loadReceiptsDesk } from "@/vx/screens/receipts/load";
import { assertReceiptVisible, notFoundUnlessVisible } from "@/platform/auth/test-session-access";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { canAccessSession } from "@/platform/auth/test-session-policy";
import { feesBridgeOfficeReads, feesBridgeWritesEnabled, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { getBridgeReceiptDetail, lookupBridgeReceipt } from "@/platform/fees-bridge/client";
import { RECEIPT_NUMBER } from "@/platform/fees-bridge/office-read-contracts";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { readBridgeSwitcherRows } from "@/platform/fees-bridge/sessions";
import { CanonicalReceipt, CanonicalReceiptUnavailable, type ReceiptUnavailableReason } from "@/vx/screens/receipts/canonical-receipt";
import { askYears, receiptSessionOrder, sourceReceiptHref } from "@/vx/screens/receipts/source-receipt";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REAL_SESSION = /^\d{4}-\d{2}$/;

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Why the asking stopped: a failure another school year would only repeat. */
class StopAsking extends Error {
  constructor(readonly reason: ReceiptUnavailableReason) { super(reason); }
}

/** Refused or missing in this school year: ask the next. Anything else stops the asking. */
function askNextYear(error: unknown): null {
  if (error instanceof FeesBridgeError && (error.code === "forbidden" || error.code === "not_found")) return null;
  throw new StopAsking(error instanceof FeesBridgeError && error.code === "unauthorized" ? "access" : "error");
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
  const cookieSession = await getViewSessionCookie();
  const session = requestedSession ?? cookieSession;
  // `?print=1` (Print from Collect or the desk): the page opens the print
  // dialog itself once the receipt is ready, and a redirect keeps asking for it.
  const autoPrint = search.print === "1";
  const keepPrint = (href: string) => (autoPrint ? `${href}${href.includes("?") ? "&" : "?"}print=1` : href);
  if (usesCanonicalFees(staff, session)) {
    // A display number alone must never choose an unrelated local receipt.
    // Every refusal below explains itself rather than ending in a 404 (F02).
    const number = safeDecode(receiptNumber);
    const receiptId = typeof search.receiptId === "string" ? search.receiptId : "";
    const unavailable = (reason: ReceiptUnavailableReason, id?: string) => (
      <CanonicalReceiptUnavailable language={staff.language} reason={reason} receiptNumber={number} receiptId={id} sessionLabel={requestedSession ?? undefined} />
    );
    const pinned = UUID.test(receiptId);
    // A repeated or empty `session` is a malformed link: refused before any read.
    if (search.session !== undefined && !requestedSession) return unavailable("missing_link");
    if (requestedSession && (!REAL_SESSION.test(requestedSession) || !canAccessSession(staff, requestedSession))) return unavailable("access");

    // The school year the link names first; only when it does not answer, the
    // others this person may open (the chosen one, the active one, the rest),
    // read only then (F02). A receipt from an earlier year, or a link that
    // never said its year, opens here instead of being sent to Fees.
    const otherYears = async () => {
      const rows = await readBridgeSwitcherRows().catch(() => null);
      return receiptSessionOrder({
        first: [requestedSession, cookieSession], active: rows?.activeSessionLabel,
        available: rows?.availableSessions.map((row) => row.session_label) ?? [], may: (label) => canAccessSession(staff, label),
      });
    };
    const ask = <T,>(attempt: (sessionLabel: string) => Promise<T | null>) => askYears(requestedSession, otherYears, attempt);

    if (!pinned) {
      // An older link with only the number: Fees resolves it to the exact receipt, under the detail rule.
      if (!feesBridgeOfficeReads() || !RECEIPT_NUMBER.test(number)) return unavailable("missing_link");
      let found;
      try { found = await ask((sessionLabel) => lookupBridgeReceipt(number, sessionLabel).catch(askNextYear)); }
      catch (error) { return unavailable(error instanceof StopAsking ? error.reason : "error"); }
      if (found) redirect(keepPrint(sourceReceiptHref(found.value.receiptNumber, found.value.receiptId, found.sessionLabel)), RedirectType.replace);
      return unavailable("missing_link");
    }

    let read;
    try {
      read = await ask(async (sessionLabel) => {
        const receipt = await getBridgeReceiptDetail(receiptId, sessionLabel).catch(askNextYear);
        // The number in the address must be this receipt's; compared decoded, as the local branch does.
        if (receipt && receipt.detail.receiptNumber !== number) throw new StopAsking("unreadable");
        return receipt;
      });
    } catch (error) {
      const reason = error instanceof StopAsking ? error.reason : "error";
      return unavailable(reason, reason === "error" ? receiptId : undefined);
    }
    // Refused and missing read alike, so the page never confirms a refused receipt exists.
    if (!read) return unavailable("unreadable");
    // Found under another year (or the link named none): the address says which, so it can be shared.
    if (read.sessionLabel !== requestedSession) redirect(keepPrint(sourceReceiptHref(number, receiptId, read.sessionLabel)), RedirectType.replace);
    const feeRole = feePermissionsFor(staff.role);
    const mayReverse = feeRole.includes("payments:reverse_any");
    return <CanonicalReceipt receipt={read.value} language={staff.language} canPrint={feeRole.includes("receipts:print")} canReverse={feesBridgeWritesEnabled() && mayReverse} mayReverse={mayReverse} autoPrint={autoPrint} />;
  }
  const { paperDetail, ...props } = await loadReceiptsDesk(staff, search, decodeURIComponent(receiptNumber));
  if (!props.selected) notFound();
  // A receipt number is global; its student decides who may open it (Phase 3).
  const selectedNumber = props.selected.receiptNumber;
  await notFoundUnlessVisible(() => assertReceiptVisible(staff, { receiptNumber: selectedNumber }));
  // `?sheet=reverse` on a receipt already reversed (a stale link, or the URL
  // the reversal itself was made from): replace it with the plain receipt URL
  // so a reload or a shared link shows the Reversed state, not the sheet (B08).
  const normalized = normalizedReceiptUrl(`/receipts/${encodeURIComponent(props.selected.receiptNumber)}`, search, props.sheet);
  if (normalized) redirect(normalized, RedirectType.replace);
  // The receipt itself, as Fees prints it, beside the list (owner, 7 Nov 2026).
  // Drawn here on the server, so the receipt template never ships to the browser.
  const paper = paperDetail ? (
    <ReceiptDocument receipt={paperDetail} t={createBilingualReceiptTranslator()} autoPrint={autoPrint && props.perms.print} />
  ) : null;
  return <ReceiptsDesk {...props} paper={paper} />;
}
