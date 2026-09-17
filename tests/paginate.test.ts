import { describe, expect, it, vi } from "vitest";

import { fetchAllRows, PAGE_SIZE } from "@/platform/supabase/paginate";

/**
 * The bug this exists to prevent: PostgREST answers at most `max-rows` (1000
 * on Supabase) with **no error and no warning**. The published timetable is
 * 1038 slots, so `listSlots()` returned 1000 of them and thirty-eight lessons
 * were missing from every timetable view and invisible to the substitution
 * planner — periods a coordinator would have been told nobody teaches.
 */

const rows = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, index) => ({ id: offset + index }));

describe("fetchAllRows()", () => {
  it("reads past the first page", async () => {
    const page = vi.fn(async (from: number) =>
      from === 0
        ? { data: rows(PAGE_SIZE), error: null }
        : { data: rows(38, PAGE_SIZE), error: null },
    );

    const all = await fetchAllRows(page, "the timetable");

    expect(all).toHaveLength(PAGE_SIZE + 38);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("asks for the right window each time", async () => {
    const page = vi.fn(async (from: number) =>
      from === 0
        ? { data: rows(PAGE_SIZE), error: null }
        : { data: rows(1, PAGE_SIZE), error: null },
    );

    await fetchAllRows(page, "the timetable");

    expect(page).toHaveBeenNthCalledWith(1, 0, PAGE_SIZE - 1);
    expect(page).toHaveBeenNthCalledWith(2, PAGE_SIZE, 2 * PAGE_SIZE - 1);
  });

  it("stops on a short page rather than asking for one more", async () => {
    // A full page means "there may be more"; anything less is the end, and a
    // further round trip would learn nothing.
    const page = vi.fn(async () => ({ data: rows(12), error: null }));

    expect(await fetchAllRows(page, "x")).toHaveLength(12);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("stops on an empty page", async () => {
    // The exact-multiple case: 1000 rows means a second request, and that one
    // comes back empty.
    const page = vi.fn(async (from: number) =>
      from === 0 ? { data: rows(PAGE_SIZE), error: null } : { data: [], error: null },
    );

    expect(await fetchAllRows(page, "x")).toHaveLength(PAGE_SIZE);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("handles nothing at all", async () => {
    expect(await fetchAllRows(async () => ({ data: [], error: null }), "x")).toEqual([]);
  });

  it("throws with the caller's own words, so the message names the screen", async () => {
    await expect(
      fetchAllRows(async () => ({ data: null, error: { message: "boom" } }), "the roll"),
    ).rejects.toThrow("Could not read the roll: boom");
  });

  it("stops asking once a page fails", async () => {
    const page = vi.fn(async () => ({ data: null, error: { message: "boom" } }));

    await expect(fetchAllRows(page, "x")).rejects.toThrow();
    expect(page).toHaveBeenCalledTimes(1);
  });
});
