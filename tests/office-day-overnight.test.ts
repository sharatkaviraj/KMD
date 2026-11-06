import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canPrepareMissingDues } from "@/modules/system-sync/domain/health-fallback";
import { sessionText } from "@/platform/helpers/session-text";
import { allocText, slipInstallmentName } from "@/vx/screens/collect/parts";
import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";

// The rest of the accountant day run (6 Nov 2026), fixed overnight.

const row = (over: Partial<DeskLedgerRow>): DeskLedgerRow => ({
  id: "r",
  installmentNo: 1,
  label: "Installment 1 (20-04-2026)",
  isCarryForward: false,
  dueDate: "2026-04-20",
  charge: 0,
  feesPaid: 0,
  feesPending: 0,
  lateFeePending: 0,
  lateFeeRaw: 0,
  lateFeeWaived: 0,
  lateFeeStatus: "none",
  planPriority: 1,
  ...over,
});

describe("installment names on Collect", () => {
  it("names an EMI plan row by the ledger's own label, not its number", () => {
    expect(slipInstallmentName(row({ installmentNo: 101, label: "EMI 2 late fee (30-07-2026)" }))).toEqual({ hi: "EMI 2 late fee", en: "EMI 2 late fee" });
    expect(slipInstallmentName(row({ installmentNo: 2, label: "Installment 2 (20-07-2026)" }))).toEqual({ hi: "किस्त 2", en: "Installment 2" });
  });

  it("the 'goes to' line reads Inst 1 ✓, and never Inst 101", () => {
    const rows = [
      row({ id: "a", installmentNo: 1, charge: 1000, feesPending: 1000 }),
      row({ id: "b", installmentNo: 101, label: "EMI 2 late fee (30-07-2026)", dueDate: "2026-07-30", charge: 500, feesPending: 500 }),
    ];
    const text = allocText(rows, 1500, false, "2026-11-06").en;
    expect(text).toContain("Inst 1 ✓");
    expect(text).toContain("EMI 2 late fee ✓");
    expect(text).not.toContain("101");
  });
});

describe("session labels", () => {
  it("dashes only the year range", () => {
    expect(sessionText("2026-27")).toBe("2026–27");
    expect(sessionText("TEST-2026-27")).toBe("TEST-2026–27");
  });

  it("no screen dashes the first hyphen any more", () => {
    for (const f of ["src/vx/shell/shell.tsx", "src/vx/screens/accounts/accounts-home.tsx", "src/vx/screens/receipts/desk.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toContain('.replace("-", "–")');
    }
  });
});

describe("preparing missing dues", () => {
  const health = (missing: number, noFee: number, errors: string[] = []) => ({ studentsMissingInstallmentRows: missing, studentsWithNoFeeSetting: noFee, errors });

  it("is offered when children in classes with fees have no installments, even if a QA class has no fees", () => {
    expect(canPrepareMissingDues(health(444, 4))).toBe(true);
  });

  it("is not offered when the only children missing dues are in classes without fees, or on errors", () => {
    expect(canPrepareMissingDues(health(1, 1))).toBe(false);
    expect(canPrepareMissingDues(health(0, 0))).toBe(false);
    expect(canPrepareMissingDues(health(10, 0, ["boom"]))).toBe(false);
  });
});

describe("receipts say owed, not pending, for a figure that holds the late fee", () => {
  it("the PDF and the receipt page", () => {
    const pdf = readFileSync("src/modules/receipts/domain/receipt-pdf.tsx", "utf8");
    expect(pdf).toContain('pendingBefore: { en: "Owed before"');
    expect(pdf).toContain("owedNote");
    expect(readFileSync("src/vx/screens/receipts/canonical-receipt.tsx", "utf8")).toContain("Owed before, with any late fee");
  });
});

describe("Collect waits for every ticked child", () => {
  it("holds the amount until a loading sibling is in", () => {
    const src = readFileSync("src/vx/screens/collect/collect.tsx", "utf8");
    expect(src).toContain("const famLoading = famShown.some(");
    expect(src).toContain("const amountOk = !famLoading &&");
    expect(src).toContain('if (card === "dues" && famLoading) return;');
  });
});
