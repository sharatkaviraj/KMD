import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatPaymentModeLabel as dashboardModeLabel } from "@/modules/dashboard/domain/payment-mode-label";
import { deskModeOf, summarizeReceipts } from "@/modules/receipts/vx/domain/day-close";
import { bucketCollection, collectionModeOf } from "@/modules/reports/vx/domain/reports";
import { PAYMENT_MODE_LABELS } from "@/platform/config/fee-rules";
import { receiptModeWord } from "@/vx/screens/receipts/words";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * Money a parent paid through Razorpay is never "Cash".
 *
 * `online` arrived in `20261028140000` and every hand-written mode switch that
 * ended in a `Cash` default printed it as cash: the receipt a parent opens from
 * the QR code, the student workspace, the transactions export, and Finance
 * Controls, which re-read a day close's `online` total as Cash — the one figure
 * the office reconciles against the drawer. The same fall-through once reported
 * write-offs as cash (`src/platform/money/write-off.ts`).
 */
describe("an online receipt is never labelled Cash", () => {
  it("has its own label in the shared and dashboard vocabularies", () => {
    expect(PAYMENT_MODE_LABELS.online).toBe("Online (Razorpay)");
    expect(dashboardModeLabel("online")).toBe("Online (Razorpay)");
  });

  const switches: Array<[string, string]> = [
    ["receipt document V2", "src/modules/receipts/ui/receipt-document-v2.tsx"],
    ["receipt document V3", "src/modules/receipts/ui/receipt-document-v3.tsx"],
    ["receipt PDF", "src/modules/receipts/domain/receipt-pdf.tsx"],
    ["student workspace receipts", "src/modules/students-fees/data/workspace.ts"],
    ["student page receipts", "src/app/(app)/fees/students/[studentId]/page.tsx"],
    ["transactions day groups", "src/modules/transactions/data/dues.ts"],
    ["transactions export", "src/app/(app)/fees/transactions/export/route.ts"],
    ["Finance Controls day close", "src/modules/finance-controls/data/queries.ts"],
    // Missed until 2026-10-30: the Transactions list badged every online receipt CASH.
    ["Transactions list badge", "src/modules/transactions/ui/transactions-client-shell.tsx"],
    ["Transactions day strip totals", "src/modules/fees/data/queries.ts"],
  ];

  it.each(switches)("%s handles `online` before its Cash default", (_name, path) => {
    const source = read(path);
    expect(source).toMatch(/["']online["']|\bonline:/);
  });

  it("prints UPI on a receipt the capture says was paid by UPI", () => {
    for (const path of [
      "src/modules/receipts/ui/receipt-document-v2.tsx",
      "src/modules/receipts/ui/receipt-document-v3.tsx",
    ]) {
      expect(read(path)).toContain('onlineMethod === "upi" ? "paymentModeOnlineUpi"');
    }
    expect(read("src/modules/receipts/domain/receipt-pdf.tsx")).toContain('"UPI (Razorpay)"');

    const catalogue = JSON.parse(read("src/messages/receipts-bilingual.json")) as Record<string, Record<string, string>>;
    expect(catalogue.en.paymentModeOnlineUpi).toBe("UPI (Razorpay)");
    expect(catalogue.hi.paymentModeOnlineUpi).toBeTruthy();
  });

  it("badges an online receipt UPI in the Transactions list, and counts it as UPI in the day strip", () => {
    const shell = read("src/modules/transactions/ui/transactions-client-shell.tsx");
    expect(shell).toContain('if (value === "online") return t("paymentModeOnline")');
    for (const file of ["en.json", "hi.json", "hi-en.json"]) {
      const messages = JSON.parse(read(`src/messages/${file}`)) as { Transactions: Record<string, string> };
      // The list's badge is the label's first four letters: "UPI ".
      expect(messages.Transactions.paymentModeOnline.slice(0, 3)).toBe("UPI");
    }
    expect(read("src/modules/fees/data/queries.ts")).toMatch(/case "upi":[\s\S]{0,400}case "online":\s*totals\.upiTotal \+= amount;/);
  });
});

/**
 * One's own screens, which the fees app does not have (src/vx). Ported with
 * the fees rule, not from a fees commit: the redesigned Receipts desk filed an
 * `online` receipt under "other" — the bucket it drops from the day's total
 * like a discount close-out — and every mode map fell back to the raw word.
 */
describe("One's vx screens: an online receipt is UPI money, never Cash", () => {
  it("files `online` under UPI on the Receipts desk, so it is counted and never Cash", () => {
    expect(deskModeOf("online")).toBe("upi");
    const day = summarizeReceipts([
      { id: "r1", receiptNumber: "TST-1", paymentDate: "2026-10-30", createdAt: "2026-10-30T05:00:00Z", paymentMode: "online", totalAmount: 500, isReversed: false, receivedBy: null },
      { id: "r2", receiptNumber: "TST-2", paymentDate: "2026-10-30", createdAt: "2026-10-30T06:00:00Z", paymentMode: "cash", totalAmount: 300, isReversed: false, receivedBy: null },
    ]);
    expect(day.net).toBe(800);
    expect(day.byMode.upi.amount).toBe(500);
    expect(day.byMode.cash.amount).toBe(300);
  });

  it("names the receipt Online (Razorpay), not plain UPI or Cash", () => {
    expect(receiptModeWord("online").en).toBe("Online (Razorpay)");
    expect(receiptModeWord("upi").en).toBe("UPI");
  });

  it("puts `online` in the UPI column of the collection report", () => {
    expect(collectionModeOf("online")).toBe("upi");
    const [bucket] = bucketCollection(
      [{ paymentDate: "2026-10-30", paymentMode: "online", amount: 700, classId: null, reversed: false }],
      "2026-10-30",
      "2026-10-30",
    );
    expect(bucket.byMode.upi).toBe(700);
    expect(bucket.byMode.cash).toBe(0);
  });

  it.each([
    "src/vx/screens/payments/receipt-card.tsx",
    "src/vx/screens/payments/desk.tsx",
    "src/vx/screens/payments/bulk.tsx",
    "src/vx/screens/admin/student360.tsx",
    "src/vx/screens/admin/today-text.ts",
    "src/vx/screens/reports/reports.tsx",
    "src/vx/screens/accounts/accounts-home.tsx",
    "src/vx/shell/palette.tsx",
  ])("%s has a word for `online`", (path) => {
    expect(read(path)).toMatch(/\bonline:|"online"/);
  });

  it("the auto day close accepts the `online` mode", () => {
    expect(read("src/app/api/fees/cron/auto-day-close/route.ts")).toContain('"cheque" | "online"');
  });
});
