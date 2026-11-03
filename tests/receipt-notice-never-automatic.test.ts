import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendReceiptNotice } from "@/modules/whatsapp/data/receipt-notice";

/**
 * Receipt notices on posting (D-270, superseded at cutover by D-353).
 *
 * One used to refuse the automatic notice outright, because the replica
 * carried the fee app's `whatsapp_receipt_notice_enabled = 'true'` and a save
 * messaged a parent nobody chose to message. It now behaves as the fees app
 * does — the office's switch decides — and every notice, automatic or
 * pressed, passes the parent-send gate, which refuses unless the deployment is
 * live, `parent_dispatch` is on and `receipt` is a named category.
 */
describe("receipt notices", () => {
  it("does not send from the posting path while the office's switch is off", async () => {
    const from = vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (table === "app_settings" ? { data: { value: "false" } } : { data: null }),
        }),
      }),
    }));
    const base = {
      supabase: { from },
      receiptId: "r",
      receiptNumber: "SVP-1",
      studentId: "s",
      sessionLabel: "TEST-2026-27",
      amountPaid: 100,
      paymentDate: "2026-10-11",
      staffId: null,
    };
    await expect(sendReceiptNotice(base)).resolves.toMatchObject({ sent: false });
    await expect(sendReceiptNotice({ ...base, trigger: "auto" })).resolves.toMatchObject({ sent: false });
    expect(from.mock.calls.every(([table]) => table === "app_settings")).toBe(true);
  });

  it("sends every receipt notice through the parent-send gate as a receipt", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/whatsapp/data/receipt-notice.ts"), "utf8");
    expect(source).toContain('const gate = { kind: "receipt" as const');
    // Asked before the claim, so a refusal never writes the permanent row.
    expect(source.indexOf("parentSendRefusal(")).toBeLessThan(source.indexOf('.from("whatsapp_reminder_sends")'));
  });

  it("claims nothing when the gate refuses, so a later send can still claim (fetch never called)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("VPPSONE_ENV", "dev"); // the gate refuses before any database read
    const insert = vi.fn();
    const from = vi.fn((table: string) => {
      if (table === "whatsapp_reminder_sends") return { insert };
      const row =
        table === "app_settings"
          ? { value: "true" }
          : table === "v_workbook_student_financials"
            ? {
                student_id: "s",
                student_name: "TEST CHILD",
                father_name: "TEST PARENT",
                father_phone: "9000000002",
                mother_phone: null,
                class_label: "5",
                inst1_pending: 0,
                inst2_pending: 0,
                inst3_pending: 0,
                inst4_pending: 0,
              }
            : null;
      const chain = { eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
      return { select: () => chain };
    });
    try {
      const result = await sendReceiptNotice({
        supabase: { from },
        receiptId: "r",
        receiptNumber: "TST-1",
        studentId: "s",
        sessionLabel: "TEST-2026-27",
        amountPaid: 100,
        paymentDate: "2026-10-11",
        staffId: null,
        trigger: "auto",
      });
      expect(result).toMatchObject({ sent: false });
      expect((result as { reason: string }).reason).toMatch(/^Not sent:/);
      expect(insert).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
