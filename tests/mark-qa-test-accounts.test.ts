import { describe, expect, it } from "vitest";

import { countByRole, selectQaProfiles } from "../scripts/mark-qa-test-accounts.mjs";

/** Phase 3, plan §3.6 (a): which profiles the QA conversion flags. Synthetic ids. */
describe("selectQaProfiles", () => {
  const emailByUserId = new Map([
    ["u-qa-1", "qa.teacher@qa.vpps.local"],
    ["u-qa-2", "QA.Admin@QA.VPPS.LOCAL"],
    ["u-real", "owner@example.test"],
  ]);
  const profiles = [
    { id: "p1", userId: "u-qa-1", role: "teacher", isActive: true, isTestAccount: false },
    { id: "p2", userId: "u-qa-2", role: "admin", isActive: true, isTestAccount: true },
    { id: "p3", userId: "u-real", role: "admin", isActive: true, isTestAccount: false },
    { id: "p4", userId: null, role: "teacher", isActive: true, isTestAccount: false },
  ];

  it("flags QA-domain accounts only, case-insensitively, and never the real admin", () => {
    const out = selectQaProfiles({ profiles, emailByUserId, dayrun: [], smoke: [] });
    expect(out.toFlag.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    expect(out.alreadyFlagged).toBe(1);
    expect(out.nonQaSeats).toBe(0);
  });

  it("refuses when a seat table points at an account outside the QA domain", () => {
    const out = selectQaProfiles({
      profiles,
      emailByUserId,
      dayrun: [{ userId: "u-real", staffProfileId: null }],
      smoke: [{ userId: null, staffProfileId: "p4" }],
    });
    expect(out.nonQaSeats).toBe(2);
    expect(out.toFlag.map((p: { id: string }) => p.id)).toEqual(["p1"]);
  });

  it("counts by role, no names", () => {
    expect(countByRole(profiles)).toEqual({ teacher: 2, admin: 2 });
  });
});
