import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { renderCertificateBundle, renderCertificatePdf } from "@/modules/certificates/ui/certificate-pdf";
import { certificatePreflight, detailRows, maskName, purposeLine, renderCertificateBody, requiredExtras, templateSchema, type CertificateFacts, type CertificateSnapshot } from "@/modules/certificates/domain/certificate";
import { defaultTemplates } from "@/modules/certificates/domain/defaults";
import { dateFigures, dateInWords, dateLong } from "@/modules/certificates/domain/date-words";
import { cleanIdentity, DEFAULT_IDENTITY, stampIdentity } from "@/modules/certificates/domain/identity";

const facts: CertificateFacts = {
  studentId: "00000000-0000-4000-8000-000000000011", enrolmentId: "00000000-0000-4000-8000-000000000012", classId: "00000000-0000-4000-8000-000000000013",
  studentName: "Synthetic Scholar", admissionNo: "00017", classLabel: "8 A", sessionLabel: "2026-27", status: "historical",
  enrolledOn: "2019-04-01", leftOn: "2026-10-30", admittedOn: "2019-04-01", dateOfBirth: "2011-03-14", fatherName: "Example Parent", motherName: "Example Guardian", gender: "Female",
  identityVerified: true, sourceCurrent: true, sourceRevision: "1", checkedAt: "2026-11-03T05:00:00Z",
};
const school = { name: "Synthetic Senior Secondary School", nameHi: "काल्पनिक उच्च माध्यमिक विद्यालय", address: "Example road, Example town, Rajasthan", phone: "0000000000", email: "office@example.test",
  affiliation: "Affiliated to an example board", place: "Example town", udiseCode: "08000000000", recognitionNo: "EX/123", principalName: "Example Principal",
  principalDesignation: "Principal", principalDesignationHi: "प्रधानाचार्य", verifyBase: "https://one.example.test" };
const snap = (kind: keyof typeof defaultTemplates, language: "en" | "hi" | "both", extra: Partial<CertificateSnapshot> = {}): CertificateSnapshot => ({
  serial: `VPPS/${kind.toUpperCase()}/2026-27/0007`, issuedAt: "2026-11-03T05:00:00Z", issuedOn: "2026-11-03", isTest: false, school, facts,
  template: { ...defaultTemplates[kind], language }, kind, verifyCode: "0123456789abcdef", purpose: null,
  extras: { reasonForLeaving: "Parent's request", conduct: "very_good", lastResult: "Passed Class 8" }, ...extra,
});

describe("date in words", () => {
  it("writes English and Hindi deterministically", () => {
    expect(dateInWords("2011-03-14", "en")).toBe("Fourteenth March Two Thousand Eleven");
    expect(dateInWords("2011-03-14", "hi")).toBe("चौदह मार्च दो हज़ार ग्यारह");
    expect(dateInWords("1998-12-31", "en")).toBe("Thirty-First December Nineteen Ninety-Eight");
    expect(dateInWords("1998-12-31", "hi")).toBe("इकतीस दिसंबर उन्नीस सौ अट्ठानवे");
    expect(dateInWords("2020-02-20", "en")).toBe("Twentieth February Two Thousand Twenty");
    expect(dateInWords("2008-01-01", "en")).toBe("First January Two Thousand Eight");
  });
  it("refuses impossible dates instead of guessing", () => {
    expect(dateInWords("2011-02-30", "en")).toBeNull();
    expect(dateInWords("", "hi")).toBeNull();
    expect(dateFigures("2011-03-04")).toBe("04/03/2011");
    expect(dateLong("2026-11-03", "hi")).toBe("3 नवंबर 2026");
  });
});

describe("certificate kinds", () => {
  it("fills gendered words from the record and leaves them neutral when unknown", () => {
    expect(renderCertificateBody(snap("character", "en"), "en")).toContain("daughter of Example Parent");
    expect(renderCertificateBody(snap("character", "en"), "en")).toContain("she bears a very good moral character");
    const neutral = snap("character", "en", { facts: { ...facts, gender: null } });
    expect(renderCertificateBody(neutral, "en")).toContain("child of Example Parent");
    expect(renderCertificateBody(snap("character", "hi"), "hi")).toContain("पुत्री श्री Example Parent");
    expect(renderCertificateBody(snap("character", "hi"), "hi")).toContain("चरित्र बहुत अच्छा है");
  });
  it("prints the date of birth in figures and words", () => {
    expect(renderCertificateBody(snap("dob", "en"), "en")).toContain("14/03/2011 (Fourteenth March Two Thousand Eleven)");
  });
  it("needs a left student, a reason and conduct for a TC", () => {
    const tc = defaultTemplates.tc;
    expect(requiredExtras(tc)).toEqual(["reasonForLeaving", "conduct"]);
    expect(certificatePreflight({ ...facts, status: "current" }, tc, { reasonForLeaving: "x", conduct: "good" })).toContainEqual({ field: "status", reason: "not_left" });
    expect(certificatePreflight(facts, tc, {})).toEqual(expect.arrayContaining([{ field: "reasonForLeaving", reason: "missing_field" }, { field: "conduct", reason: "missing_field" }]));
    expect(certificatePreflight(facts, tc, { reasonForLeaving: "x", conduct: "good" })).toEqual([]);
  });
  it("leaves blank optional TC rows out rather than printing them empty", () => {
    const rows = detailRows(snap("tc", "en", { extras: { reasonForLeaving: "Moved", conduct: "good" } }), "en").map((row) => row.key);
    expect(rows).not.toContain("remarks");
    expect(rows).not.toContain("lastResult");
    expect(rows).toContain("dateOfBirthWords");
  });
  it("adds the purpose sentence only when the office gives one", () => {
    expect(purposeLine(snap("study", "en"), "en")).toBeNull();
    expect(purposeLine(snap("study", "en", { purpose: "a scholarship application" }), "en")).toBe("This certificate is issued on request for the purpose of a scholarship application.");
  });
  it("still reads templates saved before kinds existed", () => {
    const { kind: _kind, purposeEn: _p, purposeHi: _h, detailRows: _d, ...old } = defaultTemplates.study;
    const parsed = templateSchema.parse(old);
    expect(parsed.kind).toBe("study");
    expect(parsed.detailRows).toEqual([]);
  });
  it("masks the name on the public check", () => {
    expect(maskName("Synthetic Scholar")).toBe("S******** S******");
    expect(maskName("Al")).toBe("A**");
  });
});

describe("certificate identity", () => {
  it("defaults to the printed signature and seal, and stamps who turned them back on (D-541)", () => {
    const before = cleanIdentity(null);
    expect(before.signaturePolicy).toBe("facsimile");
    // The school's own default: nobody switched it on.
    expect(before.facsimileEnabledBy).toBeNull();
    const off = stampIdentity(before, { ...before, signaturePolicy: "manual" }, "staff-1", "2026-11-03T05:00:00Z");
    expect(off.facsimileEnabledBy).toBeNull();
    const on = stampIdentity(off, { ...off, signaturePolicy: "facsimile" }, "staff-1", "2026-11-03T05:00:00Z");
    expect(on.facsimileEnabledBy).toBe("staff-1");
    const kept = stampIdentity(on, { ...on, place: "Town", facsimileEnabledBy: "someone-else" }, "staff-2", "later");
    expect(kept.facsimileEnabledBy).toBe("staff-1");
    expect(stampIdentity(on, { ...on, signaturePolicy: "manual" }, "staff-2", "later").facsimileEnabledBy).toBeNull();
  });
  it("refuses unsafe school codes, falling back to the official letterhead", () => {
    const cleaned = cleanIdentity({ udiseCode: "<script>" });
    expect(cleaned.udiseCode).not.toContain("<");
    expect(cleaned).toEqual(DEFAULT_IDENTITY);
  });
});

describe("certificate PDFs", () => {
  const out = process.env.SCHOOL_OFFICE_VISUAL_OUTPUT;
  it.each([["study", "en"], ["study", "both"], ["character", "en"], ["character", "hi"], ["dob", "both"], ["tc", "en"], ["tc", "both"]] as const)("renders %s in %s", async (kind, language) => {
    const bytes = await renderCertificatePdf(snap(kind, language, kind === "study" ? { purpose: "a scholarship application" } : {}));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
    if (out) { await mkdir(out, { recursive: true }); await writeFile(path.join(out, `${kind}-${language}.pdf`), bytes); }
  }, 30000);
  it("renders a signing-tray bundle, one page per certificate", async () => {
    const bytes = await renderCertificateBundle([snap("study", "en"), snap("tc", "en"), snap("dob", "hi", { isTest: true })], "Tray");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    if (out) await writeFile(path.join(out, "tray.pdf"), bytes);
  }, 30000);
});
