import { describe, expect, it } from "vitest";
import { certificatePreflight, certificateSerial, defaultStudyTemplate, renderCertificateBody, signatureLabel, templateSchema, type CertificateFacts, type CertificateSnapshot } from "@/modules/certificates/domain/certificate";

const facts: CertificateFacts = {
  studentId: "00000000-0000-4000-8000-000000000011", enrolmentId: "00000000-0000-4000-8000-000000000012",
  classId: "00000000-0000-4000-8000-000000000013", studentName: "Synthetic Scholar", admissionNo: "00017", classLabel: "8 A",
  sessionLabel: "2026-27", status: "current", enrolledOn: null, leftOn: null, dateOfBirth: null, fatherName: null, motherName: null,
  identityVerified: true, sourceCurrent: true, sourceRevision: "317", checkedAt: "2026-11-01T18:40:00.000Z",
};
const snapshot: CertificateSnapshot = {
  serial: "VPPS/STUDY/2026-27/0001", issuedAt: "2026-11-01T18:40:00.000Z", issuedOn: "2026-11-02", isTest: false,
  school: { name: "Synthetic School", address: "Example campus", phone: "", email: "" }, facts, template: defaultStudyTemplate,
};

describe("study certificate requirements", () => {
  it("requires only template facts, not a phone, guardian, DOB or fee clearance", () => {
    expect(certificatePreflight(facts, defaultStudyTemplate)).toEqual([]);
  });
  it("reports a missing admission number without inventing it", () => {
    expect(certificatePreflight({ ...facts, admissionNo: "" }, defaultStudyTemplate)).toContainEqual({ field: "admissionNo", reason: "missing_field" });
  });
  it("refuses unverified or stale identity even when the visible fields are filled", () => {
    expect(certificatePreflight({ ...facts, identityVerified: false }, defaultStudyTemplate)).toContainEqual({ field: "identity", reason: "identity_unverified" });
    expect(certificatePreflight({ ...facts, sourceCurrent: false }, defaultStudyTemplate)).toContainEqual({ field: "source", reason: "source_unavailable" });
  });
  it("uses historical wording for a former student and preserves leading zeros", () => {
    const body = renderCertificateBody({ ...snapshot, facts: { ...facts, status: "historical" } }, "en");
    expect(body).toContain("was enrolled");
    expect(body).not.toContain("is enrolled");
    expect(body).toContain("00017");
  });
  it("uses the frozen school and student details without external reads", () => {
    expect(renderCertificateBody(snapshot, "en")).toContain("Synthetic Scholar");
    expect(renderCertificateBody(snapshot, "en")).toContain("Synthetic School");
  });
  it("checks placeholders even if a template author omitted them from required fields", () => {
    expect(certificatePreflight(facts, { ...defaultStudyTemplate, bodyEn: "Born on {dateOfBirth}" })).toContainEqual({ field: "dateOfBirth", reason: "missing_field" });
  });
  it("rejects unknown placeholders and HTML-like prefix input", () => {
    expect(templateSchema.safeParse({ ...defaultStudyTemplate, bodyEn: "{balance}" }).success).toBe(false);
    expect(templateSchema.safeParse({ ...defaultStudyTemplate, prefix: "<script>" }).success).toBe(false);
  });
  it("does not activate an unapproved or empty template", () => {
    expect(certificatePreflight(facts, { ...defaultStudyTemplate, active: false })).toContainEqual({ field: "template", reason: "template_inactive" });
    expect(templateSchema.safeParse({ ...defaultStudyTemplate, bodyEn: "" }).success).toBe(false);
  });
  it("does not change manual-signature labeling after handover", () => {
    expect(signatureLabel("manual", "issued")).toBe("signature_required");
    expect(signatureLabel("manual", "prepared")).toBe("signature_required");
  });
  it("allocates the approved series and separates synthetic numbers", () => {
    expect(certificateSerial("VPPS/STUDY", "2026-27", 1, false)).toBe("VPPS/STUDY/2026-27/0001");
    expect(certificateSerial("VPPS/STUDY", "TEST-2026-27", 1, true)).toBe("TEST/VPPS/STUDY/TEST-2026-27/0001");
    expect(() => certificateSerial("VPPS/STUDY", "../2026", 1, false)).toThrow();
    expect(() => certificateSerial("VPPS/STUDY", "2026-27", 0, false)).toThrow();
  });
  it("renders Hindi and requires explicit purpose only when the template uses it", () => {
    expect(renderCertificateBody(snapshot, "hi")).toContain("Synthetic Scholar");
    expect(renderCertificateBody(snapshot, "hi")).toContain("प्रमाणित");
    expect(templateSchema.safeParse({ ...defaultStudyTemplate, signaturePolicy: "facsimile" }).success).toBe(false);
  });
});
