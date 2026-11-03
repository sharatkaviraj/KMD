import { describe, expect, it } from "vitest";

import { familyMessagedRecently } from "@/modules/whatsapp/domain/cross-campaign-dedupe";

/**
 * VPPS One refuses a family already messaged today, or inside its cadence
 * window, under ANY campaign name (go-live Phase D, critique0 #11). The claim
 * index includes `campaign_name`, so without this a fees `_v6` message and a
 * One `_v7` one would both reach the same parent the same day.
 */
const TODAY = "2026-12-14";
const recent = (pairs: Array<[string, string]>) => new Map(pairs);

describe("familyMessagedRecently", () => {
  it("holds an every-run family to one message a day, whatever the campaign", () => {
    const members = [{ studentId: "a", cadence: "every_run" as const }];
    expect(familyMessagedRecently({ members, latestSentOn: recent([["a", TODAY]]), today: TODAY })).toBe(true);
    expect(familyMessagedRecently({ members, latestSentOn: recent([["a", "2026-12-13"]]), today: TODAY })).toBe(false);
  });

  it("holds a weekly family for seven days", () => {
    const members = [{ studentId: "a", cadence: "weekly" as const }];
    expect(familyMessagedRecently({ members, latestSentOn: recent([["a", "2026-12-08"]]), today: TODAY })).toBe(true);
    expect(familyMessagedRecently({ members, latestSentOn: recent([["a", "2026-12-07"]]), today: TODAY })).toBe(false);
  });

  it("blocks the whole family when any child on the phone was messaged", () => {
    const members = [
      { studentId: "a", cadence: "every_run" as const },
      { studentId: "b", cadence: "every_run" as const },
    ];
    expect(familyMessagedRecently({ members, latestSentOn: recent([["b", TODAY]]), today: TODAY })).toBe(true);
  });

  it("holds a never family for the whole window read", () => {
    const members = [{ studentId: "a", cadence: "never" as const }];
    expect(familyMessagedRecently({ members, latestSentOn: recent([["a", "2026-11-20"]]), today: TODAY })).toBe(true);
  });

  it("lets a family nobody messaged through", () => {
    const members = [{ studentId: "a", cadence: null }];
    expect(familyMessagedRecently({ members, latestSentOn: recent([]), today: TODAY })).toBe(false);
  });
});
