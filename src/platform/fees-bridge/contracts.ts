import { z } from "zod";

const money = z.number().int().nonnegative();
const nullableText = z.string().nullable();
export const bridgeStudentSchema = z.object({
  id: z.uuid(), name: z.string(), srNo: z.string(), className: z.string(), classId: z.uuid(), sessionLabel: z.string(), status:z.string(),
});
export type BridgeStudent = z.infer<typeof bridgeStudentSchema>;

export const quoteInputSchema = z.object({
  studentId: z.uuid(), sessionLabel: z.string().regex(/^\d{4}-\d{2}$/),
  paymentDate: z.iso.date(),
  amount: money.positive().max(10_000_000), quickDiscountAmount: money.max(10_000_000), lateFeeWaiverAmount: money.max(10_000_000),
}).strict();
export type BridgeQuoteInput = z.infer<typeof quoteInputSchema>;
export const paymentModes = ["cash", "upi", "bank_transfer", "cheque"] as const;
export const quoteSchema = z.object({
  quoteHash: z.string().min(1), student: bridgeStudentSchema, paymentDate: z.string(),
  amount: money, quickDiscountAmount: money, lateFeeWaiverAmount: money,
  feesPending: money, lateFeePending: money, totalPending: money, payableAfterAdjustments: money, remainingBalance: money,
  installments: z.array(z.object({id:z.uuid(),installmentNo:z.number(),dueDate:nullableText,feesPending:money,lateFeePending:money,totalPending:money})),
  acceptedPaymentModes: z.array(z.enum(paymentModes)), asOf: z.string(),
});
export type BridgeQuote = z.infer<typeof quoteSchema>;
/**
 * One line of a split payment: Cash + UPI on one receipt (owner decision D7,
 * 5 Nov 2026). Mirrors Fees' `tenderLine` (schoolfees PR #141,
 * `one-bridge/domain/contracts.ts`); Fees checks each mode against the
 * quote's `acceptedPaymentModes`.
 */
export const tenderLineSchema = z.object({ mode: z.enum(paymentModes), amount: money.positive().max(10_000_000) }).strict();
export type BridgeTenderLine = z.infer<typeof tenderLineSchema>;
/**
 * Exactly one of `paymentMode` and `tenders` (2–4 distinct lines adding up to
 * `amount`), as Fees refuses anything else. A split payment carries no
 * reference number; neither do UPI and bank transfer from Collect (D9).
 */
export const postInputSchema = quoteInputSchema.extend({
  commandId: z.uuid(), quoteHash: z.string().regex(/^[a-f0-9]{32}$/),
  paymentMode: z.enum(paymentModes).optional(),
  tenders: z.array(tenderLineSchema).min(2).max(4).optional(),
  referenceNumber: z.string().trim().max(200).nullable(), remarks: z.string().trim().max(1000).nullable(),
  acknowledgeDailyDuplicate:z.boolean().optional(),acknowledgeNearDuplicate:z.boolean().optional(),
}).superRefine((input, ctx) => {
  if ((input.paymentMode === undefined) === (input.tenders === undefined)) {
    ctx.addIssue({ code: "custom", message: "Send paymentMode or tenders, not both and not neither.", path: ["tenders"] });
    return;
  }
  if (!input.tenders) return;
  if (new Set(input.tenders.map((line) => line.mode)).size !== input.tenders.length) {
    ctx.addIssue({ code: "custom", message: "Each mode may appear only once.", path: ["tenders"] });
  }
  if (input.tenders.reduce((sum, line) => sum + line.amount, 0) !== input.amount) {
    ctx.addIssue({ code: "custom", message: "Tender lines must add up to amount.", path: ["tenders"] });
  }
  if (input.referenceNumber) {
    ctx.addIssue({ code: "custom", message: "A split payment carries no reference number.", path: ["referenceNumber"] });
  }
});
export type BridgePostInput = z.infer<typeof postInputSchema>;
export const postedPaymentSchema = z.object({
  commandId:z.uuid(), status:z.literal("completed"), receiptId:z.uuid(), receiptNumber:z.string(),
  studentId:z.uuid(),sessionLabel:z.string(),amountReceived:money,remainingBalance:money,feesPending:money,lateFeePending:money,
  /** "split" for a payment posted with tenders. */
  paymentDate:z.string(),paymentMode:z.string(),receivedBy:nullableText,quickDiscountApplied:money,lateFeeWaivedApplied:money,printUrl:z.string(),
  /** Present only on a split payment: its lines, in order. */
  tenders:z.array(z.object({mode:z.string(),amount:money})).optional(),
});
export type BridgePostedPayment = z.infer<typeof postedPaymentSchema>;
export const commandSchema = z.union([postedPaymentSchema,z.object({commandId:z.uuid(),status:z.literal("not_found")})]);

export const receiptSchema = z.object({
  receiptId:z.uuid(),receiptNumber:z.string(),student:bridgeStudentSchema,amountReceived:money,
  paymentDate:z.string(),paymentMode:z.string(),receivedBy:nullableText,referenceNumber:nullableText,notes:nullableText,
  reversed:z.boolean(),allocations:z.array(z.object({installmentId:z.uuid(),amount:money,pendingBefore:money.nullable(),pendingAfter:money.nullable()})),printUrl:z.string(),
  /** Present only on a split receipt (paymentMode "split"): the lines, in order. */
  tenders:z.array(z.object({mode:z.string(),amount:money})).optional(),
});
export type BridgeReceipt = z.infer<typeof receiptSchema>;
export const studentListSchema = z.object({students:z.array(bridgeStudentSchema),nextCursor:z.string().nullable()});
export const studentDetailSchema = z.object({student:bridgeStudentSchema,standing:z.object({feesPending:money,lateFeePending:money,totalPending:money,totalPaid:money,lastPaymentDate:nullableText,asOfDate:z.string()})});
export const sessionsSchema = z.object({sessions:z.array(z.object({id:z.uuid(),sessionLabel:z.string(),status:z.string(),isCurrent:z.boolean()}))});
