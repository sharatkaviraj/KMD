import "server-only";

import type { LedgerRecheck } from "@/modules/whatsapp/data/run-sender";

/**
 * The last look at the ledger before a Pay now reminder goes.
 *
 * A placeholder until online payments are ported (go-live Phase 7). In the
 * fees app this answers `undefined` whenever Razorpay is not configured or the
 * Payment Links switch is off, and the senders then behave exactly as they did
 * before online payments existed — which is the only state One can be in
 * until Phase 7 lands. The reminder senders call it as the fees app does, so
 * Phase 7 replaces this file with fees HEAD's `service.ts` and nothing else.
 */
export async function onlineLedgerRecheck(): Promise<LedgerRecheck | undefined> {
  return undefined;
}
