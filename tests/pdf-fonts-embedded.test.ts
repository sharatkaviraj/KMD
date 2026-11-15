import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderReceiptPdf } from "@/modules/receipts/domain/receipt-pdf";
import { renderCollectionListPdf } from "@/modules/whatsapp/domain/collection-list-pdf";

import { ordinaryReceipt } from "./fixtures/receipt-detail";
import { fontsNotEmbedded, pdfFonts } from "./support/pdf-fonts";

/*
 * Every PDF One makes carries every font it uses (D-640).
 *
 * Report cards and receipts sent on WhatsApp opened as a blank white sheet the
 * first time on the owner's Android phone. Helvetica, Times and Courier were
 * the only part of those files the phone had to supply itself. The report card
 * and certificate tests assert the same thing for their own documents.
 */

describe("the font check itself", () => {
  it("flags a standard-14 font the file only names", () => {
    const named = Buffer.from(
      "%PDF-1.3\n1 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n%%EOF",
      "latin1",
    );
    expect(fontsNotEmbedded(named)).toEqual(["Helvetica"]);
  });
});

describe("One's PDFs embed every font", () => {
  it("a receipt", async () => {
    const pdf = await renderReceiptPdf({ receipt: { ...ordinaryReceipt, isVoided: false, voidReason: null } });
    expect(pdfFonts(pdf).map((font) => font.baseFont).join(" ")).toMatch(/VPPSPDFSans-Bold/);
    expect(fontsNotEmbedded(pdf)).toEqual([]);
  }, 60_000);

  it("a collection list", async () => {
    const pdf = await renderCollectionListPdf({
      groups: [{
        key: "class-6",
        label: "Class 6",
        total: 4500,
        rows: [{
          studentId: "00000000-0000-4000-8000-000000000001", admissionNo: "TEST-1", studentName: "Test Child One",
          studentClass: "Class 6", classSortOrder: 6, transportRoute: null, transportFeeAmount: 0, parentName: "Test Parent",
          phone: null, usedMotherPhone: false, dueAmount: 4500, totalPaid: 0, lateFeeApplied: 0, status: "unreachable", statusDetail: "",
        }],
      }],
      sessionLabel: "TEST-2026-27",
      subtitle: "All classes",
      generatedAt: "2026-11-15T10:00:00Z",
    });
    expect(pdfFonts(pdf).length).toBeGreaterThan(0);
    expect(fontsNotEmbedded(pdf)).toEqual([]);
  }, 60_000);

  it("every renderer registers the embedded fonts before it renders", () => {
    const renderers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.tsx?$/.test(entry.name) && /\brenderTo(Buffer|Stream|File)\(/.test(readFileSync(file, "utf8"))) renderers.push(file);
      }
    };
    walk("src");
    expect(renderers.length).toBeGreaterThanOrEqual(5);
    for (const file of renderers) {
      expect(readFileSync(file, "utf8"), file).toMatch(/\bensurePdfFontsRegistered\(\)/);
    }
  });
});
