import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendReceiptNotice } from "@/modules/whatsapp/data/receipt-notice";

describe("receipt notices (D-270)", () => {
  it("never sends from the posting path, whatever the fee app's setting says", async () => {
    const from = vi.fn(() => {
      throw new Error("the automatic path must not read anything");
    });
    const base = { supabase: { from }, receiptId: "r", receiptNumber: "SVP-1", studentId: "s", sessionLabel: "TEST-2026-27", amountPaid: 100, paymentDate: "2026-10-11", staffId: null };
    await expect(sendReceiptNotice(base)).resolves.toMatchObject({ sent: false });
    await expect(sendReceiptNotice({ ...base, trigger: "auto" })).resolves.toMatchObject({ sent: false });
    expect(from).not.toHaveBeenCalled();
  });
});
