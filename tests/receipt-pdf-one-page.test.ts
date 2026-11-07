import { writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { pdfPageCount, renderReceiptPdf } from "@/modules/receipts/domain/receipt-pdf";

import { heavyReceipt as heavy, ordinaryReceipt as ordinary } from "./fixtures/receipt-detail";

/*
 * One receipt, one sheet of A4 (owner, 7 Nov 2026: "printed in single sheet
 * only"). The downloaded PDF used to put the signature and the tear-off stub on
 * a second page for an ordinary receipt with two discount policies. Synthetic
 * receipts only: the ordinary one is shaped like that receipt, the heavy one is
 * the longest the office could plausibly post.
 */

/** Counted independently of `pdfPageCount`, so the test does not grade its own homework. */
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

describe("the receipt PDF is one sheet of A4", () => {
  it.each([
    ["an ordinary receipt", ordinary, false],
    ["an ordinary reversed receipt", ordinary, true],
    ["the heaviest receipt the office could post", heavy, false],
  ])("%s", async (name, receipt, isVoided) => {
    const pdf = await renderReceiptPdf({ receipt: { ...receipt, isVoided, voidReason: isVoided ? "QA reversal" : null } });
    // RECEIPT_PDF_OUT=dir writes them out to look at.
    const out = process.env.RECEIPT_PDF_OUT;
    if (out) writeFileSync(`${out}/${name.replace(/\W+/g, "-")}.pdf`, pdf);
    expect(pages(pdf)).toBe(1);
    expect(pdfPageCount(pdf)).toBe(1);
  }, 60_000);
});
