import { z } from "zod";

// Fees office commands (schoolfees docs/one-bridge/office-commands.md). Strict
// inputs — Fees refuses any other field — and the result fields One shows.
const text = z.string();
const nullableText = text.nullable();
const amount = z.number().finite();
const uuid = z.uuid();
const session = z.string().regex(/^\d{4}-\d{2}$/);

/** The reasons the Fees reversal dialog offers, verbatim. */
export const REVERSAL_REASONS = ["Wrong fee entry", "Wrong student", "Duplicate receipt", "Wrong amount", "Other"] as const;
export type ReversalReason = (typeof REVERSAL_REASONS)[number];

export const reversalInputSchema = z.object({
  commandId: uuid,
  sessionLabel: session,
  receiptId: uuid,
  receiptNumber: z.string().trim().min(1).max(64),
  reasonCode: z.enum(REVERSAL_REASONS),
  reasonNote: z.string().trim().min(1).max(500),
}).strict();
export type ReversalInput = z.infer<typeof reversalInputSchema>;

export const reversalResultSchema = z.object({
  commandId: uuid,
  kind: z.literal("reversal"),
  status: z.literal("completed"),
  receiptId: uuid,
  receiptNumber: text,
  studentId: uuid,
  sessionLabel: text,
  reversedAmount: amount,
  alreadyReversedAmount: amount,
  concessionAmount: amount,
  receiptReversed: z.boolean(),
  reversedBy: nullableText,
  completedAt: text,
});
export type ReversalResult = z.infer<typeof reversalResultSchema>;

export const refundDecisionInputSchema = z.object({
  commandId: uuid,
  sessionLabel: session,
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional(),
}).strict();
export type RefundDecisionInput = z.infer<typeof refundDecisionInputSchema>;

export const refundDecisionResultSchema = z.object({
  commandId: uuid,
  kind: z.literal("refund_decision"),
  status: z.literal("completed"),
  refundRequestId: uuid,
  refundStatus: text,
  amount,
  receiptNumber: text,
});
export type RefundDecisionResult = z.infer<typeof refundDecisionResultSchema>;

export const refundProcessInputSchema = z.object({ commandId: uuid, sessionLabel: session }).strict();
export type RefundProcessInput = z.infer<typeof refundProcessInputSchema>;

export const refundProcessResultSchema = z.object({
  commandId: uuid,
  kind: z.literal("refund_process"),
  status: z.literal("completed"),
  refundRequestId: uuid,
  refundStatus: text,
  amount,
  reversedAmount: amount,
  receiptNumber: text,
});
export type RefundProcessResult = z.infer<typeof refundProcessResultSchema>;

export type OfficeCommandResult = ReversalResult | RefundDecisionResult | RefundProcessResult;

/** `GET /commands/:id` for an office command: its stored outcome, or not found (retry the same id). */
export const officeCommandStatusSchema = z.union([
  reversalResultSchema,
  refundDecisionResultSchema,
  refundProcessResultSchema,
  z.object({ commandId: uuid, status: z.literal("not_found") }),
]);
export type OfficeCommandStatus = z.infer<typeof officeCommandStatusSchema>;
