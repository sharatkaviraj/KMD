import { describe, expect, it } from "vitest";

import {
  activityCsv,
  areaForTable,
  auditPhrase,
  backupHealth,
  bytesLabel,
  changedFields,
  cleanImage,
  cleanProfile,
  diffRows,
  EMPTY_PROFILE,
  GLOSSARY,
  groupByDay,
  isSettingsState,
  matchesGlossary,
  profileProblems,
} from "@/vx/screens/settings/domain/settings";

describe("school profile", () => {
  it("accepts small images only", () => {
    expect(cleanImage("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(cleanImage("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(cleanImage(`data:image/png;base64,${"A".repeat(300_000)}`)).toBeNull();
  });

  it("bounds fields and reports problems", () => {
    const profile = cleanProfile({ nameEn: "  ", phone: "123", extra: 1 }, { ...EMPTY_PROFILE, nameEn: "Test School" });
    expect(profile.nameEn).toBe("Test School");
    expect(profileProblems(profile)).toEqual(["phone"]);
    expect(changedFields(EMPTY_PROFILE, profile)).toEqual(["nameEn", "phone"]);
    expect(isSettingsState("backups")).toBe(true);
    expect(isSettingsState("nope")).toBe(false);
  });
});

describe("activity", () => {
  it("names areas and phrases", () => {
    expect(areaForTable("receipts")).toBe("money");
    expect(areaForTable("students")).toBe("students");
    expect(auditPhrase("receipts", "insert")).toBe("added a receipt");
    expect(auditPhrase("installments", "update")).toBe("changed an installment");
  });

  it("diffs rows without bookkeeping columns", () => {
    expect(diffRows({ a: 1, updated_at: "x", b: null }, { a: 2, updated_at: "y", b: null })).toEqual([{ field: "a", before: "1", after: "2" }]);
  });

  it("groups by school day and exports csv", () => {
    const events = [
      { id: "1", at: "2026-10-09T20:00:00Z", who: "Test, Admin", area: "money" as const, text: "added a receipt", changes: [] },
      { id: "2", at: "2026-10-09T10:00:00Z", who: "Test", area: "money" as const, text: "x", changes: [] },
    ];
    expect(groupByDay(events).map((g) => g.day)).toEqual(["2026-10-10", "2026-10-09"]);
    expect(activityCsv(events).split("\n")[1]).toContain('"Test, Admin"');
  });
});

describe("backups and glossary", () => {
  it("labels sizes and health", () => {
    expect(bytesLabel(2048)).toBe("2 KB");
    expect(backupHealth([], "2026-10-10")).toBe("none");
    expect(backupHealth([{ day: "2026-10-09", files: 1, bytes: 1 }], "2026-10-10")).toBe("ok");
    expect(backupHealth([{ day: "2026-10-01", files: 1, bytes: 1 }], "2026-10-10")).toBe("late");
  });

  it("searches the glossary", () => {
    expect(GLOSSARY.every((e) => matchesGlossary(e, ""))).toBe(true);
    expect(GLOSSARY.filter((e) => matchesGlossary(e, "zzzz-not-a-term"))).toHaveLength(0);
  });
});
