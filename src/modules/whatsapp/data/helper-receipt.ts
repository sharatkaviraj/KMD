import "server-only";

import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { withTestRecordRead } from "@/platform/fees-bridge/test-record-read";
import { logWarn } from "@/platform/observability/log";

/**
 * A receipt a parent asked Veer Patta AI for, as a PDF in the chat (D-597).
 *
 * The PDF is the school's own receipt, the one the counter prints and the
 * receipt notice attaches (`renderAndStoreReceipt` in `receipt-notice.ts`),
 * put on the same private shelf and signed for an hour: Meta fetches it once,
 * at send time, and keeps it in the chat. Nothing else keeps it.
 *
 * Only one of the family's own receipts reaches here. The plan picked it from
 * the family's records, read afresh for this message through the helper's
 * TEST-only read (`parent_helper_child`), and this finds it again by the
 * child AND the number before anything is made: a number that is not this
 * child's makes nothing.
 *
 * Practice only. The children are TEST children, whose receipts are One's
 * own, read as a TEST account's would be (`withTestRecordRead`). A real
 * family's receipts are the Fees app's, and come through its connection once
 * real families are switched on; until then a real year makes nothing.
 *
 * Never throws: null is "could not be made", and the parent is told so.
 */

export type ReceiptRequest = {
  studentId: string;
  sessionLabel: string;
  receiptNumber: string;
  /** The owner's test number standing in for a family (always, while the helper practises). */
  practice: boolean;
};

export type ReceiptDocument = { link: string; filename: string };

type RenderAndStore = typeof import("./receipt-notice").renderAndStoreReceipt;

export type ReceiptDeps = {
  client: () => ReturnType<typeof createAdminClient>;
  render: RenderAndStore;
};

type ReceiptRow = { id: string; student_id: string; payment_mode: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function liveDeps(): ReceiptDeps {
  return {
    client: () => createAdminClient(),
    // Imported when a receipt is asked for, so the posting path's modules load only then.
    render: async (args) => (await import("./receipt-notice")).renderAndStoreReceipt(args),
  };
}

export async function prepareHelperReceipt(request: ReceiptRequest, deps: ReceiptDeps = liveDeps()): Promise<ReceiptDocument | null> {
  const number = request.receiptNumber.trim();
  if (!request.practice || !isTestSessionLabel(request.sessionLabel)) return null;
  if (!UUID.test(request.studentId) || !number) return null;
  try {
    return await withTestRecordRead({ studentId: request.studentId, sessionLabel: request.sessionLabel }, async () => {
      const client = deps.client();
      const { data, error } = await client
        .from("receipts")
        .select("id, student_id, payment_mode")
        .eq("receipt_number", number)
        .eq("student_id", request.studentId)
        .limit(2);
      // Exactly this child's receipt with this number, and never a write-off.
      const rows = (data ?? null) as ReceiptRow[] | null;
      if (error || !rows || rows.length !== 1) return null;
      const row = rows[0];
      if (row.student_id.toLowerCase() !== request.studentId.toLowerCase() || row.payment_mode === "discount") return null;
      const made = await deps.render({ supabase: client, receiptId: row.id, sessionLabel: request.sessionLabel });
      if (!made) return null;
      return { link: made.document.signedUrl, filename: made.filename };
    });
  } catch (caught) {
    logWarn("whatsapp.helper.receipt_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return null;
  }
}
