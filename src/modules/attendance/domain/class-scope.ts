/**
 * Which classes somebody may open the records of.
 *
 * Pure, so the rule is testable without a session. `classScopeFor()` in
 * `teaching-repo.ts` builds one for the signed-in member of staff, and the
 * database asks the same question in `vppsone.my_class_keys()` — the two have
 * to agree, or a page would show a class whose rows RLS then hides.
 *
 * Two shapes, and nothing in between:
 *
 *  - **every class** — the office, the administrator and the coordinators
 *    (`readsEveryClass`).
 *  - **these classes** — a teacher's own: the ones she holds as class teacher
 *    today, and every one the published timetable has her teaching.
 *
 * A cover duty is not in either. Standing in for a colleague for a period is
 * a reason to be in the room, not to read the class's registers, notes and
 * marks (PLAN P1: "cover alone must not grant pupil history").
 */

export type ClassScope =
  | { everyClass: true }
  | { everyClass: false; classIds: readonly string[] };

export const EVERY_CLASS: ClassScope = { everyClass: true };

export function ownClasses(classIds: Iterable<string>): ClassScope {
  return { everyClass: false, classIds: [...new Set(classIds)] };
}

export function scopeIncludes(scope: ClassScope, classId: string | null | undefined): boolean {
  if (!classId) return false;
  return scope.everyClass || scope.classIds.includes(classId);
}

/** Keep only what belongs to a class in scope. */
export function withinScope<T>(
  scope: ClassScope,
  items: readonly T[],
  classOf: (item: T) => string | null | undefined,
): T[] {
  if (scope.everyClass) return [...items];
  return items.filter((item) => scopeIncludes(scope, classOf(item)));
}

/**
 * Whether a class-teacher assignment holds on a school day.
 *
 * The whole interval, both ends inclusive. The old rule was "`effective_to` is
 * null", which kept a teacher replaced last week in charge of her old class
 * until somebody nulled the column, and gave a teacher handed a class from next
 * Monday its records today.
 */
export function isEffectiveOn(
  row: { effectiveFrom: string | null; effectiveTo: string | null },
  day: string,
): boolean {
  if (row.effectiveFrom && row.effectiveFrom > day) return false;
  if (row.effectiveTo && row.effectiveTo < day) return false;
  return true;
}
