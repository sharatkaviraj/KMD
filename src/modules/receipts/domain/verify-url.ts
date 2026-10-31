/**
 * Where a parent checks a fee receipt is genuine.
 *
 * The fees app served this at `/r/{receiptNumber}`. In One `/r/` is SamPark's
 * request-token route (`src/app/r/[token]`), so the same link would land on a
 * token page and 404 — critique A2 of the go-live plan. The page is ported to
 * `/rv/[code]` instead, and every receipt notice and receipt document builds
 * its link through this one function so they cannot drift apart again.
 */
export const RECEIPT_VERIFY_PREFIX = "/rv";

export function receiptVerifyPath(receiptNumber: string): string {
  return `${RECEIPT_VERIFY_PREFIX}/${encodeURIComponent(receiptNumber)}`;
}

/** Receipt numbers are short prefixed identifiers (`SVP-…`, `TST-…`). */
export function isPlausibleReceiptNumber(value: string): boolean {
  return Boolean(value) && value.length <= 64 && !/[^\w\-/]/.test(value);
}
