import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Review F03: the Fees receipt template and PDF inside One, from the bridge
 * read. Synthetic receipt only.
 */
const state = vi.hoisted(() => ({ role: "admin", feePerms: ["receipts:view", "receipts:print"], read: vi.fn(), render: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: vi.fn(async () => ({ role: state.role })) }));
vi.mock("@/platform/auth/fee-roles", () => ({ feePermissionsFor: () => state.feePerms }));
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgeReceiptDetail: state.read }));
vi.mock("@/modules/receipts/domain/receipt-pdf", () => ({ renderReceiptPdf: state.render, receiptPdfFilename: () => "Receipt-SVP-1.pdf" }));

import { GET } from "@/app/api/fees-bridge/receipts/[receiptId]/pdf/route";
import { BridgeReceiptShapeError, receiptDetailFromBridge, type BridgeReceiptInput } from "@/modules/receipts/vx/bridge-receipt";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";

const id = "00000000-0000-4000-8000-0000000000aa";
const detail = {
  id, studentId: "00000000-0000-4000-8000-0000000000bb", receiptNumber: "SVP-1", paymentDate: "2026-11-03", paymentMode: "upi", totalAmount: 2400,
  referenceNumber: null, notes: null, receivedBy: "Office", createdAt: "2026-11-03T05:00:00Z", createdByName: "Office", studentFullName: "Synthetic Child",
  admissionNo: "TEST-1", fatherName: null, fatherPhone: null, motherPhone: null, familyGroupId: null, parentEmail: null, classLabel: "Class 7",
  sessionLabel: "2026-27", transportRouteLabel: "No transport", studentStatusLabel: "Old", feeSummary: [], totalDue: 18000, totalPaidBeforeReceipt: 0,
  totalPaidToDate: 2400, outstandingAfterReceipt: 15600, currentOutstanding: 15600, discountAmount: 0, lateFeeAmount: 0, lateFeeWaived: 0,
  breakdown: [], installmentStatus: [{ installmentNo: 1, label: "Oct", dueDate: "2026-10-01", expected: 6000, paid: 2400, pending: 3600, lateFee: 0, status: "partial" }],
  previousReceipts: [], conventionalDiscountAssignments: [],
} satisfies BridgeReceiptInput;
const call = (session: string | null = "2026-27", receiptId = id) =>
  GET(new Request(`https://one.test/api/fees-bridge/receipts/${receiptId}/pdf${session ? `?session=${session}` : ""}`), { params: Promise.resolve({ receiptId }) });

beforeEach(() => {
  vi.clearAllMocks();
  state.feePerms = ["receipts:view", "receipts:print"];
  state.read.mockResolvedValue({ receiptId: id, sessionLabel: "2026-27", detail });
  state.render.mockResolvedValue(Buffer.from("%PDF-1.7 synthetic"));
});

describe("receiptDetailFromBridge", () => {
  it("keeps every figure and narrows the three wire strings", () => {
    const receipt = receiptDetailFromBridge(detail);
    expect(receipt.paymentMode).toBe("upi");
    expect(receipt.totalAmount).toBe(2400);
    expect(receipt.installmentStatus[0].status).toBe("partial");
  });

  it("refuses a value the template does not know instead of printing a neighbour", () => {
    expect(() => receiptDetailFromBridge({ ...detail, paymentMode: "crypto" })).toThrow(BridgeReceiptShapeError);
    expect(() => receiptDetailFromBridge({ ...detail, studentStatusLabel: "Staff" })).toThrow(BridgeReceiptShapeError);
  });
});

describe("GET /api/fees-bridge/receipts/:id/pdf", () => {
  it("returns the Fees PDF, inline and never cached", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(state.read).toHaveBeenCalledWith(id, "2026-27");
    expect(state.render).toHaveBeenCalledWith({ receipt: expect.objectContaining({ receiptNumber: "SVP-1", totalAmount: 2400 }) });
  });

  it("is refused without receipts:print, before anything is read", async () => {
    state.feePerms = ["receipts:view"];
    expect((await call()).status).toBe(403);
    expect(state.read).not.toHaveBeenCalled();
  });

  it("answers a refused receipt and a missing one alike", async () => {
    state.read.mockRejectedValueOnce(new FeesBridgeError("forbidden", "Synthetic"));
    const refused = await call();
    state.read.mockRejectedValueOnce(new FeesBridgeError("not_found", "Synthetic"));
    expect(refused.status).toBe((await call()).status);
    expect(refused.status).toBe(404);
  });

  it("refuses a missing session or a malformed id without reading", async () => {
    expect((await call(null)).status).toBe(404);
    expect((await call("TEST-2026-27")).status).toBe(404);
    expect((await call("2026-27", "not-a-uuid")).status).toBe(404);
    expect(state.read).not.toHaveBeenCalled();
  });
});
