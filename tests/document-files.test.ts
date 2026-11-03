import { describe, expect, it } from "vitest";

import {
  UPLOAD_CHUNK_BYTES,
  checkChunk,
  checkUploadRequest,
  displayFileName,
  documentResponseHeaders,
  driveFileName,
  drivesUploadsFor,
  sniffDocumentType,
} from "@/modules/collection/domain/document-files";
import { inlineDisposition } from "@/platform/helpers/content-disposition";

import { syntheticFile } from "./fake-drive.fixture";

const id = "00000000-0000-4000-8000-000000000001";
const student = "00000000-0000-4000-8000-000000000002";

describe("what a file is", () => {
  it("is decided by its first bytes", () => {
    expect(sniffDocumentType(syntheticFile("pdf", 32))).toBe("application/pdf");
    expect(sniffDocumentType(syntheticFile("jpeg", 32))).toBe("image/jpeg");
    expect(sniffDocumentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffDocumentType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });

  it("is never HTML, SVG or a script, whatever it is called", () => {
    expect(sniffDocumentType(syntheticFile("html", 32))).toBeNull();
    expect(sniffDocumentType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffDocumentType(new TextEncoder().encode("MZ\x90\0"))).toBeNull();
    expect(sniffDocumentType(new Uint8Array(0))).toBeNull();
  });
});

describe("file names", () => {
  it("lose browser folders, control and direction-override characters", () => {
    expect(displayFileName("C:\\fakepath\\aadhaar.pdf")).toBe("aadhaar.pdf");
    expect(displayFileName("report\u202Efdp.exe")).toBe("reportfdp.exe");
    expect(displayFileName("a\r\nb.pdf")).toBe("ab.pdf");
    expect(displayFileName("..")).toBe("document");
    expect(displayFileName("   ")).toBe("document");
  });

  it("keep the extension when shortened", () => {
    const name = displayFileName(`${"x".repeat(300)}.pdf`);
    expect(name.length).toBe(120);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("in Drive carry ids only", () => {
    expect(driveFileName({ kind: "aadhaar", studentId: student, documentId: id, contentType: "image/jpeg" })).toBe(
      `aadhaar__${student}__${id}.jpg`,
    );
  });

  it("cannot inject a header", () => {
    const header = inlineDisposition('evil"\r\nset-cookie: x.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith("inline;")).toBe(true);
  });
});

describe("an upload request", () => {
  const good = {
    clientRequestId: id,
    studentId: student,
    kind: "birth_certificate",
    fileName: "bc.pdf",
    contentType: "application/pdf",
    byteSize: 1000,
    sha256: "a".repeat(64),
    note: "  synthetic  ",
  };

  it("accepts what the form sends", () => {
    const result = checkUploadRequest(good);
    expect(result.ok && result.value).toMatchObject({ documentId: id, note: "synthetic", byteSize: 1000 });
  });

  it.each([
    ["a forged id", { clientRequestId: "../../etc" }],
    ["an unknown kind", { kind: "passport_scan" }],
    ["a type outside the list", { contentType: "text/html" }],
    ["a file over 10 MB", { byteSize: 10 * 1024 * 1024 + 1 }],
    ["an empty file", { byteSize: 0 }],
    ["a malformed checksum", { sha256: "zz" }],
  ])("refuses %s", (_label, change) => {
    expect(checkUploadRequest({ ...good, ...change }).ok).toBe(false);
  });
});

describe("a chunk", () => {
  it("must start exactly where the last one ended", () => {
    expect(checkChunk({ offset: 0, length: UPLOAD_CHUNK_BYTES, received: 0, declared: UPLOAD_CHUNK_BYTES * 2 }).ok).toBe(true);
    expect(checkChunk({ offset: 10, length: 10, received: 0, declared: 100 })).toEqual({ ok: false, why: "offset" });
  });

  it("must fit Vercel's request limit and Drive's 256 KiB rule", () => {
    expect(UPLOAD_CHUNK_BYTES).toBeLessThan(4_500_000);
    expect(UPLOAD_CHUNK_BYTES % (256 * 1024)).toBe(0);
    expect(checkChunk({ offset: 0, length: UPLOAD_CHUNK_BYTES + 1, received: 0, declared: 9e6 })).toEqual({ ok: false, why: "size" });
    expect(checkChunk({ offset: 0, length: 1000, received: 0, declared: 9e6 })).toEqual({ ok: false, why: "size" });
    expect(checkChunk({ offset: 0, length: 1000, received: 0, declared: 1000 }).ok).toBe(true);
    expect(checkChunk({ offset: 0, length: 2000, received: 0, declared: 1000 })).toEqual({ ok: false, why: "size" });
  });
});

describe("who uploads to Drive", () => {
  const settings = { documentsProvider: "supabase" as const, drivePilotStaffIds: ["pilot"], driveConfigured: true };

  it("is nobody until Drive is configured", () => {
    expect(drivesUploadsFor({ ...settings, documentsProvider: "gdrive", driveConfigured: false }, "pilot")).toBe(false);
  });

  it("is the pilot list, then everybody once switched over", () => {
    expect(drivesUploadsFor(settings, "pilot")).toBe(true);
    expect(drivesUploadsFor(settings, "someone")).toBe(false);
    expect(drivesUploadsFor({ ...settings, documentsProvider: "gdrive" }, "someone")).toBe(true);
  });
});

it("serves a document private and uncached", () => {
  const headers = documentResponseHeaders({ contentType: "application/pdf", disposition: "inline", contentLength: "10" });
  expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(headers.get("x-content-type-options")).toBe("nosniff");
  expect(headers.get("referrer-policy")).toBe("no-referrer");
  expect(headers.get("content-type")).toBe("application/pdf");
});
