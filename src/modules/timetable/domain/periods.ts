/**
 * Period numbers, and the one place the off-by-one lives.
 *
 * The sheet's first lesson is column index 0, and that is what
 * `timetable_slots.period` stores — 0 to 7 for an eight-period day. Nobody in
 * the school calls it Period 0. Every screen therefore has to add one, and for
 * a while every screen did it separately: six `period + 1`s scattered across
 * the timetable grid, the clash list, the cover picker and the substitution
 * board, and one screen that forgot.
 *
 * The one that forgot was the teacher's Today card, which is the screen a
 * teacher opens every morning — so her first lesson read "0" and her last read
 * "7". It survived because the only teacher account in the test data had no
 * periods at all (B-17), so nothing ever rendered the badge. The fixture that
 * gave her a real day is what found it.
 *
 * So: one function, used everywhere, with a test that says no screen prints a
 * raw `period` again.
 */

import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";

/** Stored index (0-based) → the number a person says out loud (1-based). */
export function periodNumber(index: number): number {
  return index + 1;
}

/** The number a person typed (1-based) → the stored index (0-based). */
export function periodIndex(number: number): number {
  return number - 1;
}

/** Whether a stored index is one of the day's periods. */
export function isPeriodIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < PERIOD_COUNT;
}
