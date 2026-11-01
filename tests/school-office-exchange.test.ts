import { describe, expect, it } from "vitest";
import { adapterSchema, manualReferenceAdapter, preflightReturn, returnTable, previewReturnImport, safeSpreadsheetText, type ReturnStudent } from "@/modules/government-records/domain/exchange";
const session = "TEST-2026-27";
const student: ReturnStudent = { studentId: "00000000-0000-4000-8000-000000000011", studentName: "काल्पनिक विद्यार्थी", admissionNo: "00017", classLabel: "8 A", classId: "class-8", sessionLabel: session, schoolCode: "00042", externalId: "", registrationStatus: "", sourceRevision: "317", externalRevision: 0, identityVerified: true };
const reference = manualReferenceAdapter("psp", "student_records", session, "00042");
const verified = { ...reference, mode: "verified_upload" as const, sourceReference: "Current blank official specimen checked by school operator", specimenSha256: "a".repeat(64), verifiedOn: "2026-11-01", columns: [...reference.columns, { header: "External ID", field: "externalId" as const, required: false }, { header: "Registration status", field: "registrationStatus" as const, required: false }] };
const importRow = (changes = {}) => ({ "One student UUID": student.studentId, "Admission / SR number": "00017", "Student name": student.studentName, "Class": "8 A", "Academic session": session, "School code": "00042", "External ID": "00009", "Registration status": "registered", ...changes });

describe("versioned government exchange", () => {
  it("an unverified destination produces a clearly labeled manual reference adapter", () => {
    expect(reference.mode).toBe("manual_reference");
    expect(reference.sourceReference).toContain("manual");
    expect(returnTable([student], reference)[1]).toContain("00017");
    expect(returnTable([student], reference)[1]).toContain(student.studentName);
  });
  it("cannot activate upload-ready output without evidence, school/session and an identity column", () => {
    expect(adapterSchema.safeParse({ ...reference, mode: "verified_upload" }).success).toBe(false);
    expect(adapterSchema.safeParse(verified).success).toBe(true);
    expect(adapterSchema.safeParse({ ...verified, columns: verified.columns.filter(c => c.field !== "schoolCode") }).success).toBe(false);
  });
  it("preflight refuses quarantined identities and duplicate match keys", () => {
    expect(preflightReturn([{ ...student, identityVerified: false }], reference)[0].reasons).toContain("identity_unverified");
    expect(preflightReturn([student, { ...student, studentId: "other" }], { ...reference, matchField: "admissionNo" })[0].reasons).toContain("duplicate_identity");
  });
  it("keeps empty and zero different and neutralizes formula-like manual text", () => {
    expect(safeSpreadsheetText("0")).toBe("0");
    expect(safeSpreadsheetText("")).toBe("");
    expect(safeSpreadsheetText("=HYPERLINK(\"bad\")")).toMatch(/^'/);
    expect(preflightReturn([{ ...student, studentName: "=unsafe" }], verified)[0].reasons).toContain("unsafe_cell");
  });
  it("requires exact confirmed headers and order", () => {
    expect(() => previewReturnImport([importRow()], { ...verified, columns: [...verified.columns].reverse() }, [student])).toThrow("headers");
  });
  it("blocks the wrong school or session before matching", () => {
    expect(previewReturnImport([importRow({ "School code": "different" })], verified, [student])[0].state).toBe("conflict");
    expect(previewReturnImport([importRow({ "Academic session": "2025-26" })], verified, [student])[0].reasons).toContain("wrong_session");
  });
  it("only proposes external identifiers and registration status", () => {
    const row = previewReturnImport([importRow()], verified, [student])[0];
    expect(row.state).toBe("ready");
    expect(row.changes).toEqual({ externalId: "00009", registrationStatus: "registered" });
    expect(row.expectedRevision).toBe(0);
    expect(row.sourceRevision).toBe("317");
  });
  it("does not merge by name or remove a value because its cell is blank", () => {
    expect(previewReturnImport([importRow({ "One student UUID": "unknown" })], verified, [student])[0].state).toBe("unmatched");
    const old = { ...student, externalId: "00009", registrationStatus: "registered" };
    expect(previewReturnImport([importRow({ "External ID": "", "Registration status": "" })], verified, [old])[0].state).toBe("unchanged");
  });
  it("treats changed names and admission facts as protected conflicts", () => {
    const row = previewReturnImport([importRow({ "Student name": "Someone else" })], verified, [student])[0];
    expect(row.state).toBe("conflict");
    expect(row.reasons).toContain("protected_field:studentName");
    expect(row.changes).toEqual({});
  });
  it("blocks all duplicate file identities and colliding external IDs", () => {
    expect(previewReturnImport([importRow(), importRow()], verified, [student]).every(r => r.state === "conflict")).toBe(true);
    const other = { ...student, studentId: "00000000-0000-4000-8000-000000000099", admissionNo: "0099", externalId: "00009" };
    expect(previewReturnImport([importRow()], verified, [student, other])[0].reasons).toContain("external_id_collision");
  });
  it("never mistakes leading-zero identifiers for another student", () => {
    const bySr = { ...verified, matchField: "admissionNo" as const };
    expect(previewReturnImport([importRow({ "Admission / SR number": "17" })], bySr, [student])[0].state).toBe("unmatched");
  });
});
