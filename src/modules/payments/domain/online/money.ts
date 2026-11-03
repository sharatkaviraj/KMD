/**
 * Rupees and paise at the provider boundary.
 *
 * The ledger is whole rupees, everywhere. Razorpay speaks paise. Those two
 * facts meet in exactly these two functions, and neither rounds: a figure that
 * does not convert exactly is refused, so a fractional rupee arriving from the
 * provider is quarantined for a person rather than silently becoming a
 * different number on a receipt.
 */

export function rupeesToPaise(rupees: number): number {
  if (!Number.isSafeInteger(rupees) || rupees <= 0) {
    throw new Error(`Not a whole, positive rupee amount: ${rupees}`);
  }
  const paise = rupees * 100;
  if (!Number.isSafeInteger(paise)) throw new Error("Amount is too large.");
  return paise;
}

/** Whole rupees, or null when the paise do not divide exactly. */
export function paiseToWholeRupees(paise: number): number | null {
  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  if (paise % 100 !== 0) return null;
  return paise / 100;
}
