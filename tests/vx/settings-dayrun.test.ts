import { describe, expect, it } from "vitest";

import { changesOn, coverPhrase } from "@/vx/screens/settings/domain/settings";

/* School-day run, 14 Oct, admin B17: "Activity log · 0 changes today" after a night's work. */

describe("changes today in the activity log", () => {
  it("counts by the school's day, not the UTC date in the timestamp", () => {
    const events = [
      { at: "2026-10-14T19:05:00Z" }, // Thu 15 Oct 00:35 IST
      { at: "2026-10-14T20:10:00Z" }, // Thu 15 Oct 01:40 IST
      { at: "2026-10-14T10:00:00Z" }, // Wed 14 Oct
    ];
    expect(changesOn(events, "2026-10-15")).toBe(2);
    expect(changesOn(events, "2026-10-14")).toBe(1);
  });
});

describe("cover in the activity log", () => {
  it("says what was done and for which day", () => {
    expect(coverPhrase("absence", "2026-10-15")).toBe("marked a teacher away and arranged cover · 2026-10-15");
    expect(coverPhrase("unknown", "2026-10-15")).toBe("changed cover · 2026-10-15");
  });
});
