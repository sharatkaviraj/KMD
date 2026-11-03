import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { baselineOf, comparePostCutover, differing, ledgerFromRows } from "../scripts/migrate/lib/reconcile-post.mjs";
import { istDate } from "../scripts/migrate/reconcile-post.mjs";

/**
 * The parallel run's money check (plan §12.1; PARALLEL-RUN.md check 5): the
 * pure arithmetic of "frozen baseline + One's postings + tail = One's
 * totals", real sessions only. No database.
 */

const REAL = "2026-27";
const TEST = "TEST-2026-27";

/** One's ledger at C3: two cash receipts, one UPI, allocations, one EMI late fee; TEST beside it. */
const AT_LINE = {
  receipts: [
    { session_label: REAL, mode: "cash", frozen: true, count: 2, sum: "15000" },
    { session_label: REAL, mode: "upi", frozen: true, count: 1, sum: "4000" },
    { session_label: TEST, mode: "cash", frozen: true, count: 3, sum: "300" },
  ],
  allocations: [{ session_label: REAL, frozen: true, count: 4, sum: "19000" }],
  emi: [{ session_label: REAL, frozen: true, count: 1, sum: "200" }],
  postings: [],
};
const CLEAN = { floor: 5000, duplicateNumbers: 0, atOrUnderFloor: 0, tailMissing: 0, tailAmountDiffers: 0, tailBeforeLine: 0 };

/** A JSON round trip, as the baseline row is stored and read back. */
const stored = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("reconcile-post: frozen baseline + postings + tail = One's totals", () => {
  const baseline = stored(baselineOf(ledgerFromRows(AT_LINE)));

  it("the baseline keeps real sessions, TEST apart", () => {
    expect(baseline.receipts).toEqual({ "2026-27|cash": { count: 2, sum: 15000 }, "2026-27|upi": { count: 1, sum: 4000 } });
    expect(baseline.test.receipts).toEqual({ "TEST-2026-27|cash": { count: 3, sum: 300 } });
    expect(baseline.allocations).toEqual({ "2026-27": { count: 4, sum: 19000 } });
  });

  it("a day of desk postings and a posted tail receipt adds up", () => {
    const ledger = ledgerFromRows({
      ...AT_LINE,
      receipts: [
        ...AT_LINE.receipts,
        { session_label: REAL, mode: "cash", frozen: false, count: 3, sum: "9000" },
        { session_label: TEST, mode: "upi", frozen: false, count: 5, sum: "500" },
      ],
      emi: [...AT_LINE.emi, { session_label: REAL, frozen: false, count: 2, sum: "400" }],
      postings: [
        { session_label: REAL, mode: "cash", tail: false, count: 2, sum: "6000" },
        { session_label: REAL, mode: "cash", tail: true, count: 1, sum: "3000" },
        { session_label: TEST, mode: "upi", tail: false, count: 5, sum: "500" },
      ],
    });
    const verdict = comparePostCutover({ baseline, ledger, integrity: CLEAN });
    expect(verdict.ok).toBe(true);
    expect(verdict.sessions).toEqual([
      {
        session: REAL,
        baseline: { count: 3, sum: 19000 },
        desk: { count: 2, sum: 6000 },
        tail: { count: 1, sum: 3000 },
        now: { count: 6, sum: 28000 },
        // EMI late fees charged in One after the line: their own line, never in the money sum.
        emiAfter: { count: 2, sum: 400 },
      },
    ]);
  });

  it("a pre-cutover receipt edited or deleted is a difference, whatever was posted since", () => {
    const edited = ledgerFromRows({
      ...AT_LINE,
      receipts: [{ session_label: REAL, mode: "cash", frozen: true, count: 2, sum: "14000" }, AT_LINE.receipts[1], AT_LINE.receipts[2]],
    });
    const verdict = comparePostCutover({ baseline, ledger: edited, integrity: CLEAN });
    expect(verdict.ok).toBe(false);
    const failed = verdict.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toContain("frozen receipts (per session and mode)");
    expect(failed).toContain("baseline + desk postings + tail postings = One's receipts now");
    expect(verdict.checks[0].detail).toEqual([{ key: "2026-27|cash", baseline: { count: 2, sum: 15000 }, now: { count: 2, sum: 14000 } }]);
  });

  it("a changed allocation or EMI late fee from before the line is a difference", () => {
    const moved = ledgerFromRows({ ...AT_LINE, allocations: [{ session_label: REAL, frozen: true, count: 4, sum: "18000" }] });
    expect(comparePostCutover({ baseline, ledger: moved, integrity: CLEAN }).ok).toBe(false);
    const emi = ledgerFromRows({ ...AT_LINE, emi: [{ session_label: REAL, frozen: true, count: 1, sum: "250" }] });
    expect(comparePostCutover({ baseline, ledger: emi, integrity: CLEAN }).ok).toBe(false);
  });

  it("TEST-session activity never fails the run", () => {
    const ledger = ledgerFromRows({
      ...AT_LINE,
      receipts: [AT_LINE.receipts[0], AT_LINE.receipts[1], { session_label: TEST, mode: "cash", frozen: true, count: 9, sum: "1" }],
    });
    expect(comparePostCutover({ baseline, ledger, integrity: CLEAN }).ok).toBe(true);
  });

  it("collisions, a missing floor and a bad tail posting fail; open items are notes", () => {
    const ledger = ledgerFromRows(AT_LINE);
    const fails = (integrity: Record<string, unknown>) =>
      comparePostCutover({ baseline, ledger, integrity: { ...CLEAN, ...integrity } }).checks.filter((c) => !c.ok).map((c) => c.name);
    expect(fails({ duplicateNumbers: 1 })).toEqual(["no receipt number used twice"]);
    expect(fails({ atOrUnderFloor: 2 })).toEqual(["no posting at or under receipt_suffix_floor"]);
    expect(fails({ floor: null })).toEqual(["no posting at or under receipt_suffix_floor"]);
    for (const key of ["tailMissing", "tailAmountDiffers", "tailBeforeLine"]) {
      expect(fails({ [key]: 1 }), key).toEqual(["every posted tail row has its receipt, after the line, for its amount"]);
    }
    const noted = comparePostCutover({ baseline, ledger, integrity: { ...CLEAN, allocationDiffers: 1, tailPending: 2 } });
    expect(noted.ok).toBe(true);
    expect(noted.notes).toHaveLength(2);
  });

  it("compares figures key by key, both ways", () => {
    expect(differing({ a: { count: 1, sum: 5 } }, { a: { count: 1, sum: 5 } })).toEqual([]);
    expect(differing({ a: { count: 1, sum: 5 } }, {})).toEqual([{ key: "a", baseline: { count: 1, sum: 5 }, now: { count: 0, sum: 0 } }]);
    expect(differing({}, { b: { count: 1, sum: 0 } })).toHaveLength(1);
  });

  it("reads One only, never the fees database, and refuses another day", () => {
    expect(istDate(new Date("2026-12-13T19:00:00Z"))).toBe("2026-12-14");
    const source = readFileSync(path.join(process.cwd(), "scripts/migrate/reconcile-post.mjs"), "utf8");
    expect(source).toContain('import { openOneDb } from "./lib/one-db.mjs"');
    expect(source).not.toMatch(/fees-readonly|openFeesReadOnly|vgqyilgstjvgohrsiwkb/);
    expect(source).toContain('sql.begin("isolation level repeatable read read only"');
    expect(source).toContain("is not today");
  });
});
