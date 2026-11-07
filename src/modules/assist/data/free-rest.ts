import "server-only";

import type { AssistProvider } from "../domain/routes";

/**
 * Free providers that are being skipped after a failure (D-496), for how
 * long `restAfter()` says. Held in memory on each server instance: an
 * instance learns for itself, so the worst case is one slow request per
 * instance per rest. Nothing here is a key or anybody's data.
 */
const resting = new Map<AssistProvider, number>();

export function isResting(provider: AssistProvider, now = Date.now()): boolean {
  const until = resting.get(provider);
  if (until === undefined) return false;
  if (until > now) return true;
  resting.delete(provider);
  return false;
}

export function rest(provider: AssistProvider, ms: number, now = Date.now()): void {
  if (ms > 0) resting.set(provider, Math.max(resting.get(provider) ?? 0, now + ms));
}

/** For tests: every provider awake again. */
export function clearRests(): void {
  resting.clear();
}
