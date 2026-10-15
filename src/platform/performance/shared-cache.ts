import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

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
  /** `academic_calendar_days`: holidays, vacations, exam days. Busted by every calendar-day write. */
  calendar: "vx-calendar",
  /** Which timetable version is published, and a version's day headers. Busted by publish. */
  timetable: "vx-timetable",
  /** The current bell schedule. Busted by `saveBells`. */
  bells: "vx-bells",
  /** The subject list. Busted by every subject write. */
  subjects: "vx-subjects",
  /** `staff_ui_preferences` ("large text"). Busted by both preference writes. */
  uiPrefs: "vx-ui-prefs",
} as const;

/**
 * Expire a tag now, after a committed write.
 *
 * `{ expire: 0 }` rather than "max": "max" serves the stale entry once more
 * while it refetches, and the person who just moved a bell or published a
 * timetable would see the old one on the very next screen.
 *
 * It never throws. The write has already committed, and failing the action
 * afterwards would tell the office the opposite of what happened; every one
 * of these caches also expires on its own within five minutes.
 */
export function expireTag(tag: string): void {
  try {
    revalidateTag(tag, { expire: 0 });
  } catch (error) {
    if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
    console.error(`[shared-cache] could not expire "${tag}" after a committed write`, error);
  }
}
