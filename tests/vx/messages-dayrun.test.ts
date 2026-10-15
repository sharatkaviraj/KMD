import { describe, expect, it } from "vitest";

import { campaignStatus, logBucket, staffReach } from "@/vx/screens/messages/domain/messages";

/* School-day run, 14 Oct: admin B10, coordinators B13. */

describe("sent log status", () => {
  const counts = (total: number, sent: number, queued = 0, failed = 0) => ({ total, sent, queued, failed });

  it("says a notice with nobody to send to reached nobody, never \"All sent\"", () => {
    expect(campaignStatus({ status: "done", counts: counts(0, 0) })).toMatchObject({ kind: "nobody", text: { en: "Reached nobody" } });
  });

  it("keeps the other states", () => {
    expect(campaignStatus({ status: "cancelled", counts: counts(0, 0) }).kind).toBe("stopped");
    expect(campaignStatus({ status: "done", counts: counts(3, 1, 0, 2) }).kind).toBe("failed");
    expect(campaignStatus({ status: "done", counts: counts(3, 1, 2) }).kind).toBe("queued");
    expect(campaignStatus({ status: "done", counts: counts(3, 3) }).kind).toBe("sent");
  });
});

describe("staff notice reach", () => {
  it("says how many staff a notice misses", () => {
    const r = staffReach(3, 30);
    expect(r.reach.en).toBe("3 of 30 have WhatsApp");
    expect(r.missed?.en).toMatch(/^27 staff have no WhatsApp number/);
  });

  it("says nothing extra when everybody has a number", () => {
    expect(staffReach(30, 30)).toEqual({ reach: { en: "30 people", hi: "30 लोग" }, missed: null });
  });
});

describe("this week in the sent log", () => {
  // Thursday 15 Oct 2026, 00:40 IST.
  const now = new Date("2026-10-14T19:10:00Z");

  it("is Monday onwards on the school clock, not the last seven days", () => {
    expect(logBucket("2026-10-12T03:00:00Z", now)).toBe("week"); // Mon 12 Oct
    expect(logBucket("2026-10-11T19:00:00Z", now)).toBe("week"); // Mon 12 Oct 00:30 IST
    expect(logBucket("2026-10-10T05:00:00Z", now)).toBe("earlier"); // Sat 10 Oct
    expect(logBucket("2026-10-09T05:00:00Z", now)).toBe("earlier"); // Fri 9 Oct, inside seven days
  });
});
