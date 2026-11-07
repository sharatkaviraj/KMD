import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marks the reads that work out who a request is for (`current-staff.ts`):
 * the signed-in person's own profile and permissions, and — while an
 * administrator sees One as somebody (D-544) — that person's profile and
 * their open view-as grant.
 *
 * The view-as write lock (`platform/supabase/view-as-guard.ts`) has to ask
 * "who is this request for?" before it lets a save through. Those reads are
 * how that question is answered, so they must pass the lock untouched: asking
 * the question again from inside its own answer would wait on itself forever.
 * They also must not be drawn as the chosen person, or the administrator's own
 * profile would read as invisible. Nothing outside `current-staff.ts` runs
 * inside this.
 */
const context = new AsyncLocalStorage<true>();

export function resolvingStaff<T>(work: () => Promise<T>): Promise<T> {
  return context.run(true, work);
}

export function insideStaffResolution(): boolean {
  return context.getStore() === true;
}
