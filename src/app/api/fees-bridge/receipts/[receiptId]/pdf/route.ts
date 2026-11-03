import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { getBridgeReceiptDetail } from "@/platform/fees-bridge/client";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { BridgeReceiptShapeError, receiptDetailFromBridge } from "@/modules/receipts/vx/bridge-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

/**
 * A Fees receipt as the Fees PDF, downloaded inside One (review F03). The
 * receipt is read live through the Fees connection, pinned to its id and
 * session; nothing is cached, stored or sent. Gated as Fees gates its own PDF:
 * `receipts:print` on top of reading receipts — the PDF is the parent-facing
 * paper, and a role that may look a receipt up may not necessarily issue one.
 */
export async function GET(request: Request, context: { params: Promise<{ receiptId: string }> }) {
  try {
    const staff = await assertPermission("fees:view");
    if (!feePermissionsFor(staff.role).includes("receipts:print")) return new Response(null, { status: 403, headers });
    const { receiptId } = await context.params;
    const session = z.string().regex(/^\d{4}-\d{2}$/).parse(new URL(request.url).searchParams.get("session"));
    const read = await getBridgeReceiptDetail(z.uuid().parse(receiptId), session);
    const receipt = receiptDetailFromBridge(read.detail);
    // Imported here so a font or logo failure is this route's error, not a load-time crash.
    const { renderReceiptPdf, receiptPdfFilename } = await import("@/modules/receipts/domain/receipt-pdf");
    const pdf = await renderReceiptPdf({ receipt });
    return new Response(new Uint8Array(pdf), {
      headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${receiptPdfFilename(receipt)}"` },
    });
  } catch (error) {
    // Refused and missing answer alike, as the receipt page does.
    const status = error instanceof z.ZodError ? 404
      : error instanceof FeesBridgeError ? error.code === "unauthorized" ? 401 : ["forbidden", "not_found", "not_available"].includes(error.code) ? 404 : 503
        : error instanceof BridgeReceiptShapeError ? 502
          : error instanceof Error && error.message === "Not signed in." ? 401 : 403;
    if (status >= 500) console.error("[bridge-receipt-pdf]", error instanceof Error ? error.message : error);
    return new Response(null, { status, headers });
  }
}
