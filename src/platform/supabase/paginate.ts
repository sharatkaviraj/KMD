/**
 * Read every row, not the first thousand.
 *
 * PostgREST caps a response at `max-rows`, which Supabase sets to 1000. It is
 * not an error and there is no warning: the request succeeds and the reply is
 * simply short. That is the worst shape a limit can take, because every caller
 * looks correct and the data quietly is not.
 *
 * It bit this app for real. The published timetable is 1038 slots — 768 cells,
 * expanded because a shared block and a parallel elective each become one slot
 * per teacher — so `listSlots()` returned 1000 of them and thirty-eight
 * lessons were missing from the timetable views and invisible to the
 * substitution planner. Thirty-eight periods a coordinator would have been
 * told nobody teaches.
 *
 * So anything that can plausibly exceed a thousand rows is read through here:
 * the slots, a class's marks over a long range, and the enrolment record for a
 * whole school. Anything that cannot — one class's roll, one staff list, a
 * queue with an explicit `.limit()` — is left alone, because pagination it
 * does not need is just a second query.
 *
 * A stable `.order()` on the query is required, not optional: without one,
 * Postgres may return rows in a different order per page and a row can be
 * skipped or read twice.
 */

export const PAGE_SIZE = 1000;

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Could not read ${what}: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...data);

    // A short page is the last page. Asking for one more would cost a round
    // trip to learn nothing.
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}
