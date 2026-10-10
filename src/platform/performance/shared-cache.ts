import "server-only";

import { unstable_cache } from "next/cache";

/**
 * A cross-request cache for reads that change a few times a term — class
 * names, the active session, the attendance rules — and that every signed-in
 * page used to fetch again on every navigation.
 *
 * Only for service-role reads: `unstable_cache` may not touch cookies, and a
 * cached answer is shared by every reader, so the permission check stays with
 * the caller, outside the cache, on every request.
 *
 * Under vitest it is the bare function, as the fee app's
 * `cacheSafeUnstableCache` is: there is no incremental cache outside Next, and
 * a test must see the query it mocked.
 */
export function sharedCache<Args extends unknown[], Return>(
  fn: (...args: Args) => Promise<Return>,
  keyParts: string[],
  options: { tags: string[]; revalidate: number },
): (...args: Args) => Promise<Return> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return fn;
  return unstable_cache(fn, keyParts, options);
}

/** Tags, so a write can say exactly what it made stale. */
export const CACHE_TAGS = {
  /** Class names, aliases and order. Busted by every alias write. */
  classes: "vx-classes",
  /** The fee app's own tag for `app_settings`; switching the session busts it. */
  appSettings: "app-settings",
} as const;
