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
  // The Dashboard's session figures from the same call (schoolfees #150, 7 Nov 2026).
  // Optional: a Fees deployment from before it sends none, and Today then leaves the cards out.
  session: z.object({
    expected: amount,
    collected: amount,
    dueSoFar: amount,
    followUps: count,
    recentDays: z.array(z.object({ date: text, amount })),
  }).nullable().optional(),
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

export const bridgeReceiptListSchema = z.object({
  ...pins,
  from: text,
  to: text,
  query: text,
  receipts: z.array(z.object({
    receiptId: uuid,
    receiptNumber: text,
    paymentDate: text,
    createdAt: text,
    student: z.object({ id: uuid.nullable(), name: text, classLabel: text, srNo: text }),
    amount,
    paymentMode: text,
    paymentModeLabel: text,
    referenceNumber: nullableText,
    status: z.enum(["active", "reversed"]),
    collectedBy: nullableText,
  })),
  pagination: z.object({ page: count, pageSize: count, totalCount: count, hasMore: z.boolean() }),
  totals: z.object({ receiptCount: count, totalAmount: amount, averageAmount: amount, truncated: z.boolean() }),
  days: z.array(z.object({
    date: text,
    receiptCount: count,
    totalAmount: amount,
    dayClose: z.object({ status: text, closedAt: nullableText, closedBy: nullableText }).nullable(),
  })),
  dayCloseVisible: z.boolean(),
});
export type BridgeReceiptList = z.infer<typeof bridgeReceiptListSchema>;
