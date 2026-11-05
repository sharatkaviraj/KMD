import { describe, expect, it } from "vitest";

import { classDigestTitle, coverPlanTitle, endOfSchoolDay, readDraft } from "@/modules/assist/domain/drafts";

/* D-418: prepared drafts. Test data only. */

const row = {
  id: "33333333-3333-4333-8333-333333333333",
  ref: "44444444-4444-4444-8444-444444444444",
  title_en: "Plan for P4 · 7 B",
  title_hi: "P4 की योजना · 7 B",
  href: "/teach?sheet=subs&cover=44444444-4444-4444-8444-444444444444",
  log_id: null,
  created_at: "2026-11-05T02:10:00Z",
};

describe("readDraft", () => {
  it("reads a cover plan back", () => {
    const d = readDraft({ ...row, kind: "cover_plan", payload: { title: "Revision", steps: [{ minutes: 10, text: "Recap" }], tip: "Stay calm" } });
    expect(d).toMatchObject({ kind: "cover_plan", title: { en: "Plan for P4 · 7 B" }, payload: { steps: [{ minutes: 10 }] } });
  });

  it("drops a row that no longer fits its kind, or an unknown kind", () => {
    expect(readDraft({ ...row, kind: "cover_plan", payload: { steps: [] } })).toBeNull();
    expect(readDraft({ ...row, kind: "worksheet", payload: {} })).toBeNull();
  });

  it("reads a class digest with child ids for the class teacher", () => {
    const d = readDraft({ ...row, kind: "class_digest", payload: { classLabel: "7 B", themes: ["Homework"], attention: [{ ref: "C1", line: "Missed work", studentId: "s1" }], praise: [], notes: 5 } });
    expect(d?.kind).toBe("class_digest");
  });
});

describe("titles and expiry", () => {
  it("names the period and the class", () => {
    expect(coverPlanTitle("7 B", 4)).toEqual({ en: "Plan for P4 · 7 B", hi: "P4 की योजना · 7 B" });
    expect(classDigestTitle("9 A").en).toBe("This week in 9 A");
  });

  it("ends at midnight in India", () => {
    expect(endOfSchoolDay("2026-11-05").toISOString()).toBe("2026-11-05T18:30:00.000Z");
    expect(endOfSchoolDay("2026-11-07", 6).toISOString()).toBe("2026-11-13T18:30:00.000Z");
  });
});
