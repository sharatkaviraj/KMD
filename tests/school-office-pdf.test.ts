import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { pdfPageCount, renderCertificateBundle, renderCertificatePdf, renderStudyCertificatePdf, startingLevel } from "@/modules/certificates/ui/certificate-pdf";
import { defaultStudyTemplate, type CertificateSchool, type CertificateSnapshot } from "@/modules/certificates/domain/certificate";
import { defaultTemplates } from "@/modules/certificates/domain/defaults";
import { DEFAULT_IDENTITY } from "@/modules/certificates/domain/identity";

import { fontsNotEmbedded } from "./support/pdf-fonts";

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

/** UTF-16BE hex, as a ToUnicode CMap writes it, to a JS string. */
function utf16(hex: string, offset = 0): string {
  const units = (hex.match(/.{4}/g) ?? []).map((unit) => parseInt(unit, 16));
  if (offset && units.length) units[units.length - 1] += offset;
  return String.fromCharCode(...units);
}

/** Glyph code -> text, from a font's ToUnicode CMap (bfchar and bfrange, both forms). */
function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]*>)/g)) {
      const low = parseInt(range[1], 16);
      const high = parseInt(range[2], 16);
      if (range[3].startsWith("[")) {
        [...range[3].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((item, index) => map.set(low + index, utf16(item[1])));
      } else {
        for (let code = low; code <= high; code += 1) map.set(code, utf16(range[3].slice(1, -1), code - low));
      }
    }
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(pair[1], 16), utf16(pair[2]));
  }
  return map;
}

/**
 * The words a PDF shows, read from its compressed content streams.
 *
 * Since D-640 every font is embedded, so react-pdf writes glyph ids rather
 * than letters; each run is decoded through its font's ToUnicode map, which is
 * also what a phone's "find in document" reads. A font without one (none
 * today) falls back to one byte per letter.
 */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const objects = new Map<string, { dict: string; stream: string | null }>();
  for (const head of raw.matchAll(/(\d+) 0 obj\b/g)) {
    const start = (head.index ?? 0) + head[0].length;
    const endObj = raw.indexOf("endobj", start);
    const streamAt = raw.indexOf("stream", start);
    if (streamAt < 0 || streamAt > endObj) {
      objects.set(head[1], { dict: raw.slice(start, endObj), stream: null });
      continue;
    }
    const from = streamAt + (raw.slice(streamAt, streamAt + 8).match(/stream\r?\n/)?.[0].length ?? 7);
    const bytes = pdf.subarray(from, raw.indexOf("endstream", from));
    let stream: string;
    try { stream = inflateSync(bytes).toString("latin1"); } catch { stream = bytes.toString("latin1"); }
    objects.set(head[1], { dict: raw.slice(start, streamAt), stream });
  }
  const fontMaps = new Map<string, Map<number, string> | null>();
  for (const { dict } of objects.values()) {
    for (const fonts of dict.matchAll(/\/Font\s*<<([^>]*)>>/g)) {
      for (const entry of fonts[1].matchAll(/\/(\S+?)\s+(\d+) 0 R/g)) {
        const ref = objects.get(entry[2])?.dict.match(/\/ToUnicode (\d+) 0 R/)?.[1];
        const cmap = ref ? objects.get(ref)?.stream : null;
        fontMaps.set(entry[1], cmap ? toUnicode(cmap) : null);
      }
    }
  }
  const runs: string[] = [];
  for (const { stream } of objects.values()) {
    if (!stream || !/\bBT\b/.test(stream)) continue;
    let font: Map<number, string> | null = null;
    for (const op of stream.matchAll(/\/(\S+?)\s+[\d.]+\s+Tf|\[(.*?)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      if (op[1] !== undefined) { font = fontMaps.get(op[1]) ?? null; continue; }
      const parts = op[2] !== undefined ? [...op[2].matchAll(/<([0-9a-fA-F]*)>/g)].map((part) => part[1]) : [op[3]];
      const map = font;
      runs.push(parts.map((hex) => map
        ? (hex.match(/.{4}/g) ?? []).map((code) => map.get(parseInt(code, 16)) ?? "").join("")
        : hex.replace(/../g, (pair) => String.fromCharCode(parseInt(pair, 16)))).join(""));
    }
  }
  return runs.join(" ");
}

function expectPdf(result: Buffer) {
  expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  // D-640: a certificate carries every font it uses.
  expect(fontsNotEmbedded(result)).toEqual([]);
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
