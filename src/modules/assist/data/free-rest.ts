import "server-only";

import type { AssistProvider } from "../domain/routes";

/**
 * Free providers that are being skipped after a failure (D-496), for how
 * long `restAfter()` says. Held in memory on each server instance: an
 * instance learns for itself, so the worst case is one slow request per
 * instance per rest. Nothing here is a key or anybody's data.
 *
 * A rest is for a whole provider, or for one of its models (`"apinex-free:free/glm-5.3"`,
 * D-567): when one of APInex's models is busy or gone, its others still answer.
 */
export type RestKey = AssistProvider | `${AssistProvider}:${string}`;

const resting = new Map<RestKey, number>();

export function isResting(provider: RestKey, now = Date.now()): boolean {
  const until = resting.get(provider);
  if (until === undefined) return false;
  if (until > now) return true;
  resting.delete(provider);
  return false;
}

export function rest(provider: RestKey, ms: number, now = Date.now()): void {
  if (ms > 0) resting.set(provider, Math.max(resting.get(provider) ?? 0, now + ms));
}

/** For tests: every provider awake again. */
export function clearRests(): void {
  resting.clear();
}
