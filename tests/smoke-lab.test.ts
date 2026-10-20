import { describe, expect, it } from "vitest";

import { isSmokeAccount, isSmokeEmail, SMOKE_SEATS } from "@/modules/smoke/domain/pool";
import { can, SMOKE_LAB_DENIED } from "@/platform/auth/permissions";
import { clockValue, findingInput, findingKey, findingsMarkdown, passState, ROLE_FOCUS, runHours, SCHOOL_DAY, sortFindings, type FindingRow } from "@/modules/smoke/domain/smoke";

/* Smoke Lab, pure parts. Synthetic values only. */

const NOW = new Date("2026-10-20T06:00:00Z");
const later = "2026-10-20T10:00:00Z";
const earlier = "2026-10-20T05:00:00Z";

describe("smoke accounts", () => {
  it("only ever names smoke addresses in the QA domain", () => {
    for (const seat of SMOKE_SEATS) expect(isSmokeEmail(seat.email)).toBe(true);
    expect(new Set(SMOKE_SEATS.map((s) => s.email)).size).toBe(SMOKE_SEATS.length);
  });

  it("refuses everything else, including real-looking and QA (non-smoke) addresses", () => {
    for (const email of ["raj@vpps.co.in", "qa.teacher@qa.vpps.local", "smoke.teacher1@qa.vpps.local.evil.test", "smoke.x@vpps.co.in", "Smoke.Admin@QA.VPPS.LOCAL ", null, undefined, ""]) {
      expect(isSmokeEmail(email as string)).toBe(false);
    }
    expect(isSmokeEmail("Smoke.Admin@QA.VPPS.LOCAL")).toBe(true);
  });

  it("covers every role, with several teachers", () => {
    const roles = new Set(SMOKE_SEATS.map((s) => s.role));
    for (const role of Object.keys(ROLE_FOCUS)) expect(roles.has(role as never)).toBe(true);
    expect(SMOKE_SEATS.filter((s) => s.role === "teacher").length).toBeGreaterThanOrEqual(4);
  });
});

describe("passes", () => {
  const run = { status: "open" as const, expiresAt: later };
  it("is live only while unrevoked, unexpired and in an open, unexpired run", () => {
    expect(passState({ revokedAt: null, expiresAt: later }, run, NOW)).toBe("live");
    expect(passState({ revokedAt: earlier, expiresAt: later }, run, NOW)).toBe("revoked");
    expect(passState({ revokedAt: null, expiresAt: earlier }, run, NOW)).toBe("expired");
    expect(passState({ revokedAt: null, expiresAt: later }, { status: "open", expiresAt: earlier }, NOW)).toBe("expired");
    expect(passState({ revokedAt: null, expiresAt: later }, { status: "closed", expiresAt: later }, NOW)).toBe("run_closed");
    expect(passState({ revokedAt: null, expiresAt: later }, { status: "revoked", expiresAt: later }, NOW)).toBe("run_closed");
  });

  it("keeps a run between 1 and 24 whole hours", () => {
    expect(runHours(0)).toBe(1);
    expect(runHours(99)).toBe(24);
    expect(runHours("6")).toBe(6);
    expect(runHours("x")).toBe(8);
  });

  it("builds the QA clock value only from a valid day and time", () => {
    expect(clockValue("2026-10-21", "07:30")).toBe("2026-10-21T07:30");
    expect(clockValue("2026-10-21", "7:30")).toBeNull();
    expect(clockValue(null, "07:30")).toBeNull();
    expect(clockValue("21-10-2026", "07:30")).toBeNull();
  });
});

describe("findings", () => {
  it("validates what an agent sends and trims empty fields to null", () => {
    const ok = findingInput.parse({ kind: "bug", severity: "P2", title: "  Marks count wrong  ", screen: "", steps: "1. open" });
    expect(ok).toMatchObject({ title: "Marks count wrong", screen: null, steps: "1. open", expected: null });
    expect(findingInput.safeParse({ kind: "crash", severity: "P2", title: "x y z" }).success).toBe(false);
    expect(findingInput.safeParse({ kind: "bug", severity: "P0", title: "x y z" }).success).toBe(false);
    expect(findingInput.safeParse({ kind: "bug", severity: "P1", title: "ab" }).success).toBe(false);
    expect(findingInput.safeParse({ kind: "bug", severity: "P1", title: "x".repeat(161) }).success).toBe(false);
  });

  it("treats the same problem on another record, or with other numbers, as one finding", () => {
    const a = findingKey("teacher", { title: "Marks show 19 of 39", screen: "/teach/marks?paper=00000000-0000-4000-8000-000000000001" });
    const b = findingKey("teacher", { title: "marks  show 20 of 40", screen: "/teach/marks?paper=00000000-0000-4000-8000-000000000002" });
    expect(a).toBe(b);
    expect(findingKey("office", { title: "Marks show 19 of 39", screen: "/teach/marks" })).not.toBe(a);
    expect(findingKey("teacher", { title: "x", screen: "/students/00000000-0000-4000-8000-000000000001" })).toBe(findingKey("teacher", { title: "x", screen: "/students/00000000-0000-4000-8000-000000000009" }));
  });

  const row = (over: Partial<FindingRow>): FindingRow => ({ id: "f", kind: "bug", severity: "P2", status: "new", title: "t", role: "teacher", reporter: null, screen: null, steps: null, expected: null, actual: null, evidence: null, repeats: 1, createdAt: "2026-10-20T06:00:00Z", ...over });

  it("orders by severity, then repeats, then age", () => {
    const sorted = sortFindings([row({ id: "a", severity: "P3" }), row({ id: "b", severity: "P1" }), row({ id: "c", severity: "P2", repeats: 3 }), row({ id: "d", severity: "P2" })]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "d", "a"]);
  });

  it("exports open findings as Markdown and leaves out duplicates, not-a-bug and verified", () => {
    const md = findingsMarkdown({ id: "run-1", title: "QA day", schoolDay: "2026-10-21" }, [
      row({ id: "1", title: "Totals disagree", severity: "P1", screen: "/exams", steps: "1. open\n2. compare", repeats: 2 }),
      row({ id: "2", title: "Same as above", status: "duplicate" }),
      row({ id: "3", title: "Fixed already", status: "verified" }),
    ]);
    expect(md).toContain("# Smoke run: QA day");
    expect(md).toContain("## [P1] Totals disagree");
    expect(md).toContain("seen 2×");
    expect(md).toContain("    2. compare");
    expect(md).not.toContain("Same as above");
    expect(md).not.toContain("Fixed already");
  });
});

describe("the school day", () => {
  it("runs in time order and gives every role something to do", () => {
    const times = SCHOOL_DAY.map((s) => s.at);
    expect([...times].sort()).toEqual(times);
    for (const role of Object.keys(ROLE_FOCUS)) expect(SCHOOL_DAY.some((s) => s.role === role || s.role === "all")).toBe(true);
  });
});

describe("what a smoke account may never do (D-314)", () => {
  it("knows a smoke account by its flag or its email, and nobody else", () => {
    expect(isSmokeAccount({ email: "smoke.admin@qa.vpps.local" })).toBe(true);
    expect(isSmokeAccount({ email: "changed@example.test", app_metadata: { smoke_lab: true } })).toBe(true);
    expect(isSmokeAccount({ email: "qa.admin@qa.vpps.local", app_metadata: { smoke_lab: "true" } })).toBe(false);
    expect(isSmokeAccount({ email: "office@example.test", app_metadata: {} })).toBe(false);
    expect(isSmokeAccount(null)).toBe(false);
  });

  it("withholds staff and settings management from every smoke role, admin included", () => {
    for (const role of ["admin", "office"] as const) {
      for (const permission of SMOKE_LAB_DENIED) expect(can({ role, smokeLab: true }, permission)).toBe(false);
    }
    // Everything else the role has, it keeps.
    expect(can({ role: "admin", smokeLab: true }, "students:view")).toBe(true);
    expect(can({ role: "admin" }, "staff:manage")).toBe(true);
  });
});
