import { describe, expect, it } from "vitest";
import { chequeDetailsDraft, chequeReceiptSuggestion } from "@/modules/finance-controls/vx/domain/cheque-receipt";

const notes = "Cheque: OPS Synthetic Bank, dated 2026-04-01; subject to clearing. Receipt memo";
const empty = { chequeNo: null, bank: null, chequeDate: null, reference: "004518", paymentDate: "2026-04-03", receiptNotes: notes };

describe("read-only receipt cheque draft suggestions", () => {
  it("preserves a different actual cheque date and leading-zero reference", () => {
    expect(chequeDetailsDraft(empty)).toEqual({ chequeNo: "004518", bank: "OPS Synthetic Bank", chequeDate: "2026-04-01", suggested: true });
    expect(empty.receiptNotes).toBe(notes);
  });
  it("keeps confirmed metadata ahead of conflicting receipt text", () => {
    expect(chequeDetailsDraft({ ...empty, chequeNo: "777777", bank: "Reviewed Bank", chequeDate: "2026-03-30" })).toEqual({ chequeNo: "777777", bank: "Reviewed Bank", chequeDate: "2026-03-30", suggested: false });
  });
  it("recognizes a bank with a comma and a leap-day date", () => {
    expect(chequeReceiptSuggestion("Cheque: OPS Bank, Amet branch, dated 2024-02-29; subject to clearing. Memo")).toEqual({ bank: "OPS Bank, Amet branch", chequeDate: "2024-02-29" });
  });
  it("handles composer optional date and unknown bank without inventing values", () => {
    expect(chequeReceiptSuggestion("Cheque: OPS Bank; subject to clearing.")).toEqual({ bank: "OPS Bank", chequeDate: null });
    expect(chequeReceiptSuggestion("Cheque: bank not given, dated 2026-04-01; subject to clearing.")).toEqual({ bank: null, chequeDate: "2026-04-01" });
    expect(chequeDetailsDraft({ ...empty, receiptNotes: "Cheque: bank not given; subject to clearing." })).toEqual({ chequeNo: "004518", bank: "", chequeDate: "2026-04-03", suggested: false });
  });
  it.each([
    null,
    "",
    "Legacy cheque details in person",
    "Memo Cheque: OPS Bank, dated 2026-04-01; subject to clearing.",
    "Cheque: OPS Bank, dated 2026-04-31; subject to clearing.",
    "Cheque: OPS Bank, dated 2023-02-29; subject to clearing.",
    "Cheque: OPS Bank, dated 2026-04-01; subject to clear",
    "Cheque: OPS Bank\nbranch, dated 2026-04-01; subject to clearing.",
    "Cheque: OPS Bank, dated tomorrow; subject to clearing.",
    "Cheque: OPS Bank, dated 2026-04-01; subject to clearing. Cheque: Second Bank; subject to clearing.",
    "Cheque: OPS Bank, dated 2026-03-30, dated 2026-04-01; subject to clearing.",
    `Cheque: OPS Bank, dated 2026-04-01; subject to clearing. ${"x".repeat(1000)}`,
  ])("declines legacy, malformed, ambiguous or truncated notes %s", note => {
    expect(chequeReceiptSuggestion(note)).toBeNull();
    expect(chequeDetailsDraft({ ...empty, receiptNotes: note })).toEqual({ chequeNo: "004518", bank: "", chequeDate: "2026-04-03", suggested: false });
  });
  it("respects intentionally present canonical empty fields", () => {
    expect(chequeDetailsDraft({ ...empty, bank: "", chequeDate: "" })).toEqual({ chequeNo: "004518", bank: "", chequeDate: "", suggested: false });
  });
});
