import { describe, expect, it } from "vitest";

import * as m from "@/messages/pairs";
import {
  feeSummary,
  overviewRows,
  type OverviewFacts,
} from "@/modules/home/domain/overview";

/**
 * The administrator's overview, and the one wrong answer it can give.
 *
 * Every assertion here is a variation on the same rule: **a count that could
 * not be read is not nought**. A home that reports "30 / 30 registers in"
 * because a query failed tells an administrator the morning is finished, and
 * that is the mistake D-93 records and the reason the facts are nullable.
 *
 * The fee row is the same rule applied to a source this app does not read at
 * all yet: the handoff document asks for "unavailable with a valid next step,
 * never ₹0".
 */

const complete: OverviewFacts = {
  registersIn: 28,
  classesTotal: 30,
  staffPresent: 38,
  staffTotal: 40,
  coverArranged: 4,
  coverNeeded: 6,
  coverPublished: true,
  examsOpen: 2,
  round: null,
  roundUnavailable: false,
};

const rowFor = (facts: OverviewFacts, key: string) => {
  const found = overviewRows(facts).find((row) => row.key === key);
  if (!found) throw new Error(`no ${key} row`);
  return found;
};

describe("the day's figures", () => {
  it("reads as a fraction", () => {
    expect(rowFor(complete, "registers").figure).toBe("28 / 30");
    expect(rowFor(complete, "staff").figure).toBe("38 / 40");
    expect(rowFor(complete, "cover").figure).toBe("4 / 6");
    expect(rowFor(complete, "exams").figure).toBe("2");
  });

  it("warns only where something is outstanding", () => {
    expect(rowFor(complete, "registers").tone).toBe("warning");
    expect(rowFor(complete, "staff").tone).toBe("warning");
    expect(rowFor(complete, "cover").tone).toBe("warning");

    const settled: OverviewFacts = {
      ...complete,
      registersIn: 30,
      staffPresent: 40,
      coverArranged: 6,
    };

    expect(rowFor(settled, "registers").tone).toBe("neutral");
    expect(rowFor(settled, "staff").tone).toBe("neutral");
    expect(rowFor(settled, "cover").tone).toBe("neutral");
  });

  it("says a count could not be read rather than calling it nought", () => {
    const unread: OverviewFacts = {
      ...complete,
      registersIn: null,
      staffPresent: null,
      coverArranged: null,
      examsOpen: null,
    };

    for (const key of ["registers", "staff", "cover", "exams"]) {
      const row = rowFor(unread, key);
      expect(row.figure, `${key} drew a number`).toBe("—");
      expect(row.note, `${key} did not say why`).toBe(m.homeUnavailable);
      // No bar either: a full track drawn at 0% reads as "nothing done".
      expect(row.value, `${key} drew a bar`).toBeNull();
      expect(row.tone, `${key} raised an alarm about a number it does not have`).toBe(
        "neutral",
      );
    }
  });

  it("tells no published plan apart from an empty one", () => {
    const nothingPublished = rowFor({ ...complete, coverPublished: false }, "cover");

    expect(nothingPublished.figure).toBe("—");
    expect(nothingPublished.note).toBe(m.overviewCoverNoPlan);
    expect(nothingPublished.value).toBeNull();

    // A published plan with nothing on it is a real answer and says so.
    const emptyPlan = rowFor(
      { ...complete, coverArranged: 0, coverNeeded: 0, coverPublished: true },
      "cover",
    );

    expect(emptyPlan.figure).toBe("0 / 0");
    expect(emptyPlan.note).toBeNull();
    expect(emptyPlan.tone).toBe("neutral");
  });

  it("draws no bar for a count with no denominator", () => {
    // "2 exams out of what?" is not a question the school asks.
    expect(rowFor(complete, "exams").value).toBeNull();
    expect(rowFor(complete, "exams").total).toBeNull();
  });
  it("distinguishes a failed cover read from no published plan", () => {
    const failed = rowFor({ ...complete, coverPublished: false, coverUnavailable: true, coverArranged: null, coverNeeded: null }, "cover");
    expect(failed.note).toBe(m.homeUnavailable);
    expect(failed.figure).toBe("—");
    expect(failed.value).toBeNull();
  });
  it("does not describe absence-derived teaching counts as confirmed presence", () => {
    const staff = rowFor(complete, "staff");
    expect(staff.label).toBe(m.overviewTeachingNotAway);
    expect(staff.note).toBe(m.overviewTeachingBasis);
  });

  it("keeps the same rows in the same order", () => {
    expect(overviewRows(complete).map((row) => row.key)).toEqual([
      "registers",
      "staff",
      "cover",
      "exams",
    ]);
  });
});

describe("the fee line", () => {
  it("is unavailable rather than zero", () => {
    const summary = feeSummary();

    expect(summary.kind).toBe("unavailable");
    // The specific thing this test exists to prevent: a currency figure
    // appearing on the administrator's home before R6 connects a real source.
    expect(JSON.stringify(summary)).not.toMatch(/₹|\brs\b|0\.00/i);
  });
});
