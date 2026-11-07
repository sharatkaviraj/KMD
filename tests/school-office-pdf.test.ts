import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { pdfPageCount, renderCertificateBundle, renderCertificatePdf, renderStudyCertificatePdf, startingLevel } from "@/modules/certificates/ui/certificate-pdf";
import { defaultStudyTemplate, type CertificateSchool, type CertificateSnapshot } from "@/modules/certificates/domain/certificate";
import { defaultTemplates } from "@/modules/certificates/domain/defaults";
import { DEFAULT_IDENTITY } from "@/modules/certificates/domain/identity";

/** Synthetic children only: nothing here is a real student. */
const facts: CertificateSnapshot["facts"] = {
  studentId: "00000000-0000-4000-8000-000000000011", enrolmentId: "00000000-0000-4000-8000-000000000012", classId: "00000000-0000-4000-8000-000000000013",
  studentName: "Synthetic Longname Scholar / काल्पनिक विद्यार्थी विस्तृत नाम", admissionNo: "000000017", classLabel: "12 Science A", sessionLabel: "TEST-2026-27", status: "current",
  enrolledOn: null, leftOn: null, dateOfBirth: null, fatherName: null, motherName: null, identityVerified: true, sourceCurrent: true, sourceRevision: "sample", checkedAt: "2026-11-01T18:45:00Z",
};

/** The letterhead a new issue freezes under the school's defaults (D-540, D-541). */
const signedSchool: CertificateSchool = {
  name: "Shri Veer Patta Senior Secondary School", nameHi: DEFAULT_IDENTITY.nameHi, address: DEFAULT_IDENTITY.address, phone: DEFAULT_IDENTITY.phone,
  email: DEFAULT_IDENTITY.email, website: DEFAULT_IDENTITY.website, trust: DEFAULT_IDENTITY.trust, registrationNo: DEFAULT_IDENTITY.registrationNo,
  recognisedBy: DEFAULT_IDENTITY.recognisedBy, recognitionNo: DEFAULT_IDENTITY.recognitionNo, udiseCode: DEFAULT_IDENTITY.udiseCode, pspCode: DEFAULT_IDENTITY.pspCode,
  place: DEFAULT_IDENTITY.place, principalDesignation: "Principal", principalDesignationHi: "प्रधानाचार्य",
  signaturePolicy: "facsimile", signature: null, signatureAsset: "principal-2026", seal: "school-seal-2026", layout: "classic", verifyBase: "https://one.example.test",
};

async function keep(name: string, bytes: Buffer) {
  const directory = process.env.SCHOOL_OFFICE_VISUAL_OUTPUT;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), bytes);
}

/** The words a PDF shows, read from its compressed content streams (react-pdf writes text as hex runs). */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const runs: string[] = [];
  for (const start of raw.matchAll(/stream\r?\n/g)) {
    const from = (start.index ?? 0) + start[0].length;
    const to = raw.indexOf("endstream", from);
    if (to < 0) break;
    let body: string;
    try { body = inflateSync(pdf.subarray(from, to)).toString("latin1"); } catch { continue; }
    for (const shown of body.matchAll(/\[(.*?)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const parts = shown[1] !== undefined ? [...shown[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((part) => part[1]) : [shown[2]];
      runs.push(parts.map((hex) => hex.replace(/../g, (pair) => String.fromCharCode(parseInt(pair, 16)))).join(""));
    }
  }
  return runs.join(" ");
}

function expectPdf(result: Buffer) {
  expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  expect(result.byteLength).toBeLessThan(2 * 1024 * 1024);
  expect(result.subarray(-20).toString()).toContain("%%EOF");
}

it.each(["en", "hi", "both"] as const)("renders a complete %s certificate with long mixed-script identity", async (language) => {
  const snapshot: CertificateSnapshot = {
    serial: "TEST/VPPS/STUDY/TEST-2026-27/0001", issuedAt: "2026-11-01T18:45:00Z", issuedOn: "2026-11-02", isTest: true,
    school: { name: "Synthetic School for Certificate Layout Checks", address: "Example campus, Rajasthan - synthetic fixture", phone: "", email: "" },
    template: { ...defaultStudyTemplate, language }, facts,
  };
  const result = await renderStudyCertificatePdf(snapshot);
  expectPdf(result);
  expect(pdfPageCount(result)).toBe(1);
  await keep(`study-certificate-${language}.pdf`, result);
}, 20000);

describe("the signed letterhead (D-540, D-541)", () => {
  it("prints the signature and seal on a document prepared under the school's default", async () => {
    const snapshot: CertificateSnapshot = {
      serial: "VPPS/STUDY/2026-27/0007", issuedAt: "2026-11-07T06:00:00Z", issuedOn: "2026-11-07", isTest: false, verifyCode: "0123456789abcdef",
      school: signedSchool, template: defaultStudyTemplate, kind: "study", purpose: "a scholarship application", facts: { ...facts, studentName: "Synthetic Scholar", sessionLabel: "2026-27" },
    };
    const result = await renderCertificatePdf(snapshot);
    expectPdf(result);
    expect(pdfPageCount(result)).toBe(1);
    // Two raster images beyond the crest: the signature and the seal.
    expect((result.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(4);
    await keep("signed-study-en.pdf", result);
  }, 20000);

  it("keeps an older hand-signed snapshot unsigned and unsealed", async () => {
    const manual: CertificateSnapshot = {
      serial: "VPPS/STUDY/2026-27/0001", issuedAt: "2026-11-02T06:00:00Z", issuedOn: "2026-11-02", isTest: false,
      school: { name: "Shri Veer Patta Senior Secondary School", address: "", phone: "", email: "", signaturePolicy: "manual", signature: null },
      template: defaultStudyTemplate, facts: { ...facts, studentName: "Synthetic Scholar", sessionLabel: "2026-27" },
    };
    const result = await renderCertificatePdf(manual);
    expectPdf(result);
    // The crest twice (heading and watermark) and nothing signed.
    expect((result.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length).toBeLessThanOrEqual(2);
    await keep("manual-study-en.pdf", result);
  }, 20000);

  it("asks the reader to scan a code only when one is printed", async () => {
    const base: CertificateSnapshot = {
      serial: "VPPS/STUDY/2026-27/0008", issuedAt: "2026-11-07T06:00:00Z", issuedOn: "2026-11-07", isTest: false, verifyCode: "0123456789abcdef",
      school: signedSchool, template: defaultStudyTemplate, kind: "study", facts: { ...facts, studentName: "Synthetic Scholar", sessionLabel: "2026-27" },
    };
    const real = pdfText(await renderCertificatePdf(base));
    expect(real).toContain("Scan to verify");
    expect(real).toContain("scan the code to confirm it is genuine");
    // A TEST copy carries a verification code but never a QR, so its footer must not promise one.
    const test = pdfText(await renderCertificatePdf({ ...base, serial: "TEST/VPPS/STUDY/TEST-2026-27/0002", isTest: true, facts: { ...base.facts, sessionLabel: "TEST-2026-27" } }));
    expect(test).toContain("Issued from the school's records");
    expect(test).not.toContain("Scan to verify");
    expect(test).not.toContain("scan the code");
  }, 30000);

  it("prints the receipts' address on the letterhead, as the owner chose", async () => {
    const text = pdfText(await renderCertificatePdf({
      serial: "TEST/VPPS/STUDY/TEST-2026-27/0003", issuedAt: "2026-11-07T06:00:00Z", issuedOn: "2026-11-07", isTest: true,
      school: signedSchool, template: defaultStudyTemplate, kind: "study", facts: { ...facts, studentName: "Synthetic Scholar" },
    }));
    // A receipt says "Amet-Kelwa Road, Amet, 313332"; the letterhead adds the district.
    expect(text).toContain("Amet-Kelwa Road, Amet, District Rajsamand (Raj.)");
    expect(text).toContain("313332");
    expect(text).not.toContain("Mela Ground");
    expect(text).not.toContain("313330");
  }, 30000);
});

describe("one A4 sheet, always (D-543)", () => {
  const longest = "Synthetic Extraordinarily Longnamed Scholar Of The Fixture Family / काल्पनिक अत्यंत लंबे नाम वाला विद्यार्थी";
  const tcFacts: CertificateSnapshot["facts"] = {
    ...facts, studentName: longest, status: "historical", enrolledOn: "2014-04-01", leftOn: "2026-10-30", admittedOn: "2014-04-01", dateOfBirth: "2009-12-31",
    fatherName: "Synthetic Father With A Remarkably Long Name / काल्पनिक पिता का लंबा नाम", motherName: "Synthetic Mother With A Long Name / काल्पनिक माता का नाम", gender: "Female",
  };
  const remarks = "Synthetic remark that runs to the full two hundred characters allowed, so the table is as long as a real certificate's ever can be, and still fits on a single sheet of A4 paper.";

  it.each(["en", "hi", "both"] as const)("fits the longest %s transfer certificate on one page", async (language) => {
    const snapshot: CertificateSnapshot = {
      serial: "TEST/VPPS/TC/TEST-2026-27/0001", issuedAt: "2026-11-07T06:00:00Z", issuedOn: "2026-11-07", isTest: true, kind: "tc",
      extras: { reasonForLeaving: "Transfer of parent's job / अभिभावक के स्थानांतरण के कारण", conduct: "very_good", lastResult: "Passed with first division / प्रथम श्रेणी में उत्तीर्ण", remarks },
      school: signedSchool, template: { ...defaultTemplates.tc, language }, facts: tcFacts,
    };
    expect(startingLevel(snapshot)).toBe(1);
    const result = await renderCertificatePdf(snapshot);
    expectPdf(result);
    expect(pdfPageCount(result)).toBe(1);
    await keep(`tc-${language}.pdf`, result);
  }, 30000);

  it("fits a two-language character certificate with a purpose on one page", async () => {
    const snapshot: CertificateSnapshot = {
      serial: "TEST/VPPS/CC/TEST-2026-27/0001", issuedAt: "2026-11-07T06:00:00Z", issuedOn: "2026-11-07", isTest: true, kind: "character", purpose: "a scholarship application",
      extras: { conduct: "excellent" }, school: signedSchool, template: { ...defaultTemplates.character, language: "both" }, facts: { ...tcFacts, status: "current", leftOn: null },
    };
    const result = await renderCertificatePdf(snapshot);
    expect(pdfPageCount(result)).toBe(1);
    await keep("character-both.pdf", result);
  }, 30000);

  it("sets every page of a tray bundle on its own sheet", async () => {
    const snapshots: CertificateSnapshot[] = (["study", "dob", "tc"] as const).map((kind, index) => ({
      serial: `TEST/VPPS/${kind.toUpperCase()}/TEST-2026-27/000${index + 1}`, issuedAt: "2026-11-07T06:00:00Z", issuedOn: "2026-11-07", isTest: true, kind,
      extras: kind === "tc" ? { reasonForLeaving: "Parent's request", conduct: "good" } : {}, school: signedSchool,
      template: { ...defaultTemplates[kind], language: "both" }, facts: kind === "study" ? facts : tcFacts,
    }));
    const result = await renderCertificateBundle(snapshots, "Tray");
    expect(pdfPageCount(result)).toBe(3);
    await keep("bundle.pdf", result);
  }, 60000);
});
