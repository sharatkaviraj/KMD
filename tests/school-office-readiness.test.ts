import { describe, expect, it } from "vitest";
import { manualReferenceAdapter, preflightReturn, type GovernmentAdapter, type GovernmentBatch, type ReturnStudent } from "@/modules/government-records/domain/exchange";
import { askTeachersHref, cellStudents, DEFAULT_MODULE, destinationKey, readinessCounts, readinessGrid, readinessState, returnDestinations } from "@/modules/government-records/domain/readiness";
import { copilotAfterMark, copilotKey, copilotProgress, copilotResume, copilotRowText, copilotSheet, copilotStep } from "@/modules/government-records/domain/copilot";
import { portals } from "@/modules/government-records/domain/exchange";

const session = "TEST-2026-27";
const child = (n: number, classId: string, extra: Partial<ReturnStudent> = {}): ReturnStudent => ({
  studentId: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, admissionNo: `SYN-${n}`, studentName: `Synthetic ${n}`, classLabel: classId.toUpperCase(), classId,
  sessionLabel: session, schoolCode: "", externalId: "", registrationStatus: "", sourceRevision: "rev", externalRevision: 0, identityVerified: true, ...extra,
});
const manual = manualReferenceAdapter("udise", DEFAULT_MODULE, session);
const verified: GovernmentAdapter = { ...manualReferenceAdapter("psp", "Student records", session, "00042"), mode: "verified_upload", specimenSha256: "a".repeat(64), verifiedOn: "2026-11-01", sourceReference: "Current blank official specimen checked by school operator" };
const batch = (portal: string, module: string): Pick<GovernmentBatch, "portal" | "module" | "adapter"> => ({ portal, module, adapter: manualReferenceAdapter(portal as GovernmentAdapter["portal"], module, session) });

describe("destinations on the readiness board", () => {
  it("keys the default sheet by portal and a named module by a stable short hash", () => {
    expect(destinationKey("udise", DEFAULT_MODULE)).toBe("udise");
    expect(destinationKey("udise", "Enrolment")).toMatch(/^udise-[0-9a-f]{8}$/);
    expect(destinationKey("udise", "Enrolment")).toBe(destinationKey("udise", "Enrolment"));
    expect(destinationKey("udise", "Enrolment")).not.toBe(destinationKey("udise", "Enrolment 2"));
  });
  it("shows a card for every portal even with nothing configured, none of them set up", () => {
    const cards = returnDestinations([], []);
    expect(cards.map((c) => c.portal)).toEqual([...portals]);
    expect(cards.every((c) => !c.configured && c.mode === "manual_reference" && c.module === DEFAULT_MODULE)).toBe(true);
  });
  it("prefers the latest verified format and keeps a module a manual batch already used", () => {
    const cards = returnDestinations([{ id: "v1", adapter: verified, version: 1 }, { id: "v2", adapter: { ...verified, version: 2 }, version: 2 }], [batch("udise", "Enrolment"), batch("psp", "Student records")]);
    const psp = cards.filter((c) => c.portal === "psp");
    expect(psp).toHaveLength(1);
    expect(psp[0]).toMatchObject({ key: "psp", adapterId: "v2", version: 2, configured: true, mode: "verified_upload", schoolCode: "00042" });
    expect(cards.filter((c) => c.portal === "udise").map((c) => c.module)).toEqual(["Enrolment"]);
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
  });
});

describe("readiness counts and the class × issue grid", () => {
  const rows = [child(1, "c8"), child(2, "c8", { admissionNo: "" }), child(3, "c9", { identityVerified: false }), child(4, "c9", { admissionNo: "", identityVerified: false }), child(5, "c10")];
  const preflight = preflightReturn(rows, manual);
  it("splits blocked rows into needs-details and office-only conflicts", () => {
    expect(readinessCounts(preflight)).toEqual({ total: 5, ready: 2, needsDetails: 1, conflict: 2 });
    expect(readinessState({ state: "blocked", reasons: ["missing:admissionNo", "identity_unverified"] })).toBe("conflict");
    expect(readinessState({ state: "blocked", reasons: ["too_long:studentName"] })).toBe("needs_details");
  });
  it("counts one child in every column that blocks it, drops clean classes, details before conflicts", () => {
    const grid = readinessGrid(rows, preflight);
    expect(grid.classes).toEqual([{ id: "c8", label: "C8" }, { id: "c9", label: "C9" }]);
    expect(grid.issues).toEqual(["missing:admissionNo", "identity_unverified"]);
    expect(grid.counts).toEqual({ c8: { "missing:admissionNo": 1 }, c9: { identity_unverified: 2, "missing:admissionNo": 1 } });
  });
  it("lists exactly the children behind a cell, a row or a column", () => {
    expect(cellStudents(rows, preflight, "c9", "missing:admissionNo").map((s) => s.studentName)).toEqual(["Synthetic 4"]);
    expect(cellStudents(rows, preflight, "c9", null)).toHaveLength(2);
    expect(cellStudents(rows, preflight, null, "missing:admissionNo").map((s) => s.studentName)).toEqual(["Synthetic 2", "Synthetic 4"]);
  });
  it("asks teachers only for classes with missing details, and only for gaps a round can collect", () => {
    const grid = readinessGrid(rows, preflight);
    expect(askTeachersHref(grid)).toBe("/collection/rounds/new?class=c8&class=c9");
    expect(askTeachersHref(grid, { admissionNo: "admission_no" })).toBe("/collection/rounds/new?class=c8&class=c9&gap=admission_no");
    const conflictsOnly = readinessGrid([child(6, "c7", { identityVerified: false })], preflightReturn([child(6, "c7", { identityVerified: false })], manual));
    expect(askTeachersHref(conflictsOnly)).toBeNull();
  });
});

describe("manual entry assistant", () => {
  const rows = [child(1, "c8"), child(2, "c8", { studentName: "=HYPERLINK(\"x\")" }), child(3, "c8", { studentName: "Tab\tName\nLine" })].map((row) => ({ ...row, schoolCode: "00042" }));
  const sheet = copilotSheet(rows, manualReferenceAdapter("udise", DEFAULT_MODULE, session, "00042"));
  const keys = sheet.rows.map((r) => r.key);
  it("keeps the batch column order without One's internal UUID, formatted as the reference sheet", () => {
    expect(sheet.headers).toEqual(["Admission / SR number", "Student name", "Class", "Academic session", "School code"]);
    expect(sheet.rows[0].values).toEqual(["SYN-1", "Synthetic 1", "C8", session, "00042"]);
    expect(sheet.rows[1].values[1]).toBe("'=HYPERLINK(\"x\")");
  });
  it("builds a tab-separated row that cannot split or run a formula", () => {
    expect(copilotRowText(["a", "b"])).toBe("a\tb");
    expect(copilotRowText(sheet.rows[2].values).split("\t")).toHaveLength(5);
    expect(copilotRowText(["\t=1+1", "@x", "0", ""])).toBe("' =1+1\t'@x\t0\t");
    expect(copilotRowText(sheet.rows[1].values)).toContain("'=HYPERLINK");
    expect(copilotRowText(sheet.rows[1].values)).not.toContain("''=");
  });
  it("resumes at the first untouched row, then a waiting mismatch, then the last row", () => {
    expect(copilotResume(keys, {})).toBe(0);
    expect(copilotResume(keys, { [keys[0]]: { state: "entered" } })).toBe(1);
    expect(copilotResume(keys, { [keys[0]]: { state: "entered" }, [keys[1]]: { state: "mismatch" } })).toBe(2);
    expect(copilotResume(keys, { [keys[0]]: { state: "entered" }, [keys[1]]: { state: "mismatch" }, [keys[2]]: { state: "entered" } })).toBe(1);
    expect(copilotResume(keys, Object.fromEntries(keys.map((k) => [k, { state: "entered" as const }])))).toBe(2);
    expect(copilotResume([], {})).toBe(0);
  });
  it("steps without wrapping and, after a mark, skips rows already handled", () => {
    expect(copilotStep(0, 3, -1)).toBe(0);
    expect(copilotStep(2, 3, 1)).toBe(2);
    expect(copilotStep(1, 3, 1)).toBe(2);
    expect(copilotAfterMark(0, keys, { [keys[0]]: { state: "entered" }, [keys[1]]: { state: "entered" } })).toBe(2);
    expect(copilotAfterMark(2, keys, Object.fromEntries(keys.map((k) => [k, { state: "entered" as const }])))).toBe(2);
    expect(copilotProgress(keys, { [keys[0]]: { state: "entered" }, [keys[1]]: { state: "mismatch" } })).toEqual({ total: 3, entered: 1, mismatch: 1, remaining: 1 });
  });
  it("maps J/K, arrows and 1–9, never while typing or with a modifier", () => {
    expect(copilotKey({ key: "j" }, 5)).toEqual({ kind: "next" });
    expect(copilotKey({ key: "ArrowLeft" }, 5)).toEqual({ kind: "prev" });
    expect(copilotKey({ key: "3" }, 5)).toEqual({ kind: "copy", index: 2 });
    expect(copilotKey({ key: "7" }, 5)).toBeNull();
    expect(copilotKey({ key: "0" }, 5)).toBeNull();
    expect(copilotKey({ key: "j", inField: true }, 5)).toBeNull();
    expect(copilotKey({ key: "1", ctrlKey: true }, 5)).toBeNull();
  });
});
