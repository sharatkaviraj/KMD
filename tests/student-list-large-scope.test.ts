import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * D-292: a fee-list filter that matches more children than one `.in()` can
 * carry (~300 ids in a URL, rule 3b) is paged in code. These run the real
 * `getStudentsIdentityPage` over a fake PostgREST builder that records every
 * `.in()` it is asked for, so the test fails the day a whole scope rides in
 * one URL again.
 */

type Row = { id: string; admission_no: string; full_name: string; date_of_birth: null; status: string; primary_phone: null; secondary_phone: null; updated_at: string; photo_path: null; class_ref: { id: string; session_label: string; status: string; class_name: string; section: null; stream_name: null; sort_order: number }; route_ref: null; fee_override: null };

const mocks = vi.hoisted(() => ({ ids: [] as string[], rows: [] as unknown[], inSizes: [] as number[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/students-fees/data/directory", () => ({ getStudentDirectoryIds: async () => ({ studentIds: mocks.ids, totalCount: mocks.ids.length }) }));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/modules/fees/platform/supabase/cache-safe", () => ({ getCacheSafeClient: async () => ({}), cacheSafeUnstableCache: <T>(fn: T) => fn }));
vi.mock("@/modules/fees/platform/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let ids: string[] | null = null;
      let range: [number, number] | null = null;
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        returns: () => query,
        in: (_column: string, values: string[]) => {
          mocks.inSizes.push(values.length);
          ids = values;
          return query;
        },
        range: (from: number, to: number) => {
          range = [from, to];
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          // The database orders by name; the fake does too, with a different
          // comparison, so the test cannot pass on matching orders by luck.
          let rows = (mocks.rows as Row[]).filter((row) => !ids || ids.includes(row.id)).sort((a, b) => (a.full_name < b.full_name ? -1 : 1));
          const count = rows.length;
          if (range) rows = rows.slice(range[0], range[1] + 1);
          return Promise.resolve({ data: rows, error: null, count }).then(resolve, reject);
        },
      };
      return query;
    },
  }),
}));

import { getStudentsIdentityPage } from "@/modules/students-fees/data/queries";
import { EMPTY_STUDENT_FILTERS } from "@/modules/students-fees/domain/types";

function child(n: number): Row {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id, admission_no: `QA-${n}`, full_name: `QA Child ${String(1000 - n).padStart(4, "0")}`, date_of_birth: null, status: "active",
    primary_phone: null, secondary_phone: null, updated_at: "2026-10-16T00:00:00Z", photo_path: null,
    class_ref: { id: "qa-class", session_label: "QA", status: "active", class_name: "Class 7", section: null, stream_name: null, sort_order: 7 },
    route_ref: null, fee_override: null,
  };
}

beforeEach(() => {
  mocks.inSizes = [];
});

describe("a fee list scope too long for one .in() (D-292)", () => {
  it("never sends more than 200 ids at once, and pages the whole scope in name order with its exact count", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => child(i + 1));
    mocks.rows = rows;
    mocks.ids = rows.map((row) => row.id);
    const page = await getStudentsIdentityPage({ ...EMPTY_STUDENT_FILTERS, sessionLabel: "QA", segments: ["partlyPaid"] }, { page: 2, pageSize: 50 });
    expect(Math.max(...mocks.inSizes)).toBeLessThanOrEqual(200);
    expect(page.totalCount).toBe(450);
    const byName = [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name, "en")).map((row) => row.id);
    expect(page.students.map((s) => s.id)).toEqual(byName.slice(50, 100));
  });

  it("keeps a small scope in one .in() and lets the database page it", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => child(i + 1));
    mocks.rows = rows;
    mocks.ids = rows.map((row) => row.id);
    const page = await getStudentsIdentityPage({ ...EMPTY_STUDENT_FILTERS, sessionLabel: "QA", segments: ["overdue"] }, { page: 3, pageSize: 50 });
    expect(mocks.inSizes).toEqual([120]);
    expect(page.totalCount).toBe(120);
    expect(page.students).toHaveLength(20);
  });
});
