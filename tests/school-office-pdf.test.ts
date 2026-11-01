import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { renderStudyCertificatePdf } from "@/modules/certificates/ui/certificate-pdf";
import { defaultStudyTemplate, type CertificateSnapshot } from "@/modules/certificates/domain/certificate";

it.each(["en", "hi", "both"] as const)("renders a complete %s certificate with long mixed-script identity", async (language) => {
  const snapshot: CertificateSnapshot = {
    serial: "TEST/VPPS/STUDY/TEST-2026-27/0001", issuedAt: "2026-11-01T18:45:00Z", issuedOn: "2026-11-02", isTest: true,
    school: { name: "Synthetic School for Certificate Layout Checks", address: "Example campus, Rajasthan - synthetic fixture", phone: "", email: "" },
    template: { ...defaultStudyTemplate, language },
    facts: { studentId: "00000000-0000-4000-8000-000000000011", enrolmentId: "00000000-0000-4000-8000-000000000012", classId: "00000000-0000-4000-8000-000000000013", studentName: "Synthetic Longname Scholar / काल्पनिक विद्यार्थी विस्तृत नाम", admissionNo: "000000017", classLabel: "12 Science A", sessionLabel: "TEST-2026-27", status: "current", enrolledOn: null, leftOn: null, dateOfBirth: null, fatherName: null, motherName: null, identityVerified: true, sourceCurrent: true, sourceRevision: "sample", checkedAt: "2026-11-01T18:45:00Z" },
  };
  const result = await renderStudyCertificatePdf(snapshot);
  expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  expect(result.byteLength).toBeLessThan(2 * 1024 * 1024);
  expect(result.subarray(-20).toString()).toContain("%%EOF");
  if (process.env.SCHOOL_OFFICE_VISUAL_OUTPUT) {
    const directory = process.env.SCHOOL_OFFICE_VISUAL_OUTPUT;
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `study-certificate-${language}.pdf`), result);
  }
}, 20000);
