/**
 * Which sheet a receipt's URL may open (B08). Pure.
 *
 * `/receipts/<no>?sheet=reverse` is a link the admin's Today hands out, and a
 * page that kept it after the reversal reopened "Reverse ₹0" on a receipt
 * already reversed. The server refuses a second reversal either way; this is
 * the screen agreeing with it: the reverse sheet opens only on a receipt that
 * can still be reversed, by someone who may ask.
 */

export type ReceiptSheet = "reverse" | "send" | null;

export function parseReceiptSheet(value: string | null | undefined): ReceiptSheet {
  return value === "reverse" ? "reverse" : value === "send" ? "send" : null;
}

export type SheetReceiptState = {
  isReversed: boolean;
  /** Nothing left to reverse (total minus what was already reversed). */
  remaining: number;
  /** A reversal request is already waiting for an admin. */
  hasPendingRequest: boolean;
};

/** May this viewer open the reverse sheet on this receipt? (`canAsk`: fees:accounts.) */
export function canOpenReverse(receipt: SheetReceiptState | null, canAsk: boolean): boolean {
  return Boolean(receipt && canAsk && !receipt.isReversed && receipt.remaining > 0 && !receipt.hasPendingRequest);
}

/** The sheet the page may actually open for what the URL asked. */
export function allowedReceiptSheet(requested: ReceiptSheet, receipt: SheetReceiptState | null, canAsk: boolean): ReceiptSheet {
  if (!receipt) return null;
  if (requested === "reverse") return canOpenReverse(receipt, canAsk) ? "reverse" : null;
  if (requested === "send") return receipt.isReversed ? null : "send";
  return null;
}

/**
 * The URL to replace the current one with when it asked for a sheet the page
 * will not open, or null when it can stay. Every other parameter is kept.
 */
export function normalizedReceiptUrl(path: string, search: Record<string, string | string[] | undefined>, allowed: ReceiptSheet): string | null {
  const raw = search.sheet;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  if (requested === undefined || requested === "" || requested === allowed) return null;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (k === "sheet" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
