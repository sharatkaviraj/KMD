import { z } from "zod";

// Fees office reads (schoolfees docs/one-bridge/office-reads.md). Parse what
// One shows; money is whole rupees, as in every other bridge contract.
const text = z.string();
const nullableText = text.nullable();
const amount = z.number().finite();
const count = z.number().int().nonnegative();
const uuid = z.uuid();
const pins = { sessionLabel: text, asOf: text, asOfDate: text };

export const bridgeTodaySummarySchema = z.object({
  ...pins,
  date: text,
  totalCollected: amount,
  receiptCount: count,
  byMode: z.array(z.object({ paymentMode: text, paymentModeLabel: text, amount, receiptCount: count })),
});
export type BridgeTodaySummary = z.infer<typeof bridgeTodaySummarySchema>;

export const bridgePendingRequestsSchema = z.object({
  ...pins,
  totalCount: count,
  items: z.array(z.object({
    id: uuid,
    kind: z.enum(["refund_approval", "refund_processing"]),
    status: text,
    student: z.object({ id: uuid, name: text, classLabel: text, srNo: text }),
    amount,
    reason: nullableText,
    receipt: z.object({ id: uuid, receiptNumber: text, paymentDate: text }),
    requestedAt: text,
    requestedBy: nullableText,
    canDecide: z.boolean(),
    feesPath: text.regex(/^\/protected\//),
  })),
});
export type BridgePendingRequests = z.infer<typeof bridgePendingRequestsSchema>;

export const bridgeReceiptLookupSchema = z.object({ ...pins, receiptId: uuid, receiptNumber: text, studentId: uuid });
export type BridgeReceiptLookup = z.infer<typeof bridgeReceiptLookupSchema>;

/** The receipt-number shape Fees accepts for a lookup; anything else is never sent. */
export const RECEIPT_NUMBER = /^[A-Za-z0-9/_.-]{1,64}$/;
