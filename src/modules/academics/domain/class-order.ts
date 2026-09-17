/**
 * School order, which is not alphabetical order.
 *
 * `"Class 10".localeCompare("Class 2")` is negative, so every screen that
 * sorted class labels as text listed Nursery, JKG, SKG, Class 1, Class 10,
 * Class 11, Class 12, Class 2, Class 3 … — and four of them did (B-06). A
 * teacher looking for Class 2 found it ninth.
 *
 * The right order already exists and was being ignored: `public.classes` has a
 * `sort_order` the fee app maintains, and `vppsone.class_aliases` has one of
 * its own for the label the school chose to see. Nothing here invents an
 * ordering — it reads the one the school already agreed on.
 */

export type ClassChoice = {
  id: string;
  label: string;
  /** The fee app's `sort_order`, or the alias's when the school set one. */
  sortOrder: number;
};

/**
 * School order, ties broken by label.
 *
 * The tiebreak matters for the two sections of one class, which share a
 * `sort_order` in the fee app: "Class 6 A" before "Class 6 B" is the order the
 * register is printed in, and leaving it to chance means the list moves about
 * between page loads.
 */
export function bySchoolOrder(a: ClassChoice, b: ClassChoice): number {
  return a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "en");
}

/** The same list, in the order the school says its classes come in. */
export function inSchoolOrder(choices: readonly ClassChoice[]): ClassChoice[] {
  return [...choices].sort(bySchoolOrder);
}

/**
 * Position in an already-ordered label map, by class id.
 *
 * `classLabelMap()` is built in school order and a Map keeps its insertion
 * order, so the map itself is the ranking — this just makes it a lookup
 * instead of an `indexOf` inside a comparator. A screen holding a *subset* of
 * classes (a teacher's own, say) sorts by this and gets the school's order
 * without a second read.
 */
export function rankOf(labels: ReadonlyMap<string, string>): Map<string, number> {
  return new Map([...labels.keys()].map((id, index) => [id, index]));
}
