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
export const postInputSchema = quoteInputSchema.extend({
  commandId: z.uuid(), quoteHash: z.string().regex(/^[a-f0-9]{32}$/), paymentMode: z.enum(paymentModes),
  referenceNumber: z.string().trim().max(200).nullable(), remarks: z.string().trim().max(1000).nullable(),
  acknowledgeDailyDuplicate:z.boolean().optional(),acknowledgeNearDuplicate:z.boolean().optional(),
});
export type BridgePostInput = z.infer<typeof postInputSchema>;
export const postedPaymentSchema = z.object({
  commandId:z.uuid(), status:z.literal("completed"), receiptId:z.uuid(), receiptNumber:z.string(),
  studentId:z.uuid(),sessionLabel:z.string(),amountReceived:money,remainingBalance:money,feesPending:money,lateFeePending:money,
  paymentDate:z.string(),paymentMode:z.string(),receivedBy:nullableText,quickDiscountApplied:money,lateFeeWaivedApplied:money,printUrl:z.string(),
});
export type BridgePostedPayment = z.infer<typeof postedPaymentSchema>;
export const commandSchema = z.union([postedPaymentSchema,z.object({commandId:z.uuid(),status:z.literal("not_found")})]);

export const receiptSchema = z.object({
  receiptId:z.uuid(),receiptNumber:z.string(),student:bridgeStudentSchema,amountReceived:money,
  paymentDate:z.string(),paymentMode:z.string(),receivedBy:nullableText,referenceNumber:nullableText,notes:nullableText,
  reversed:z.boolean(),allocations:z.array(z.object({installmentId:z.uuid(),amount:money,pendingBefore:money.nullable(),pendingAfter:money.nullable()})),printUrl:z.string(),
});
export type BridgeReceipt = z.infer<typeof receiptSchema>;
export const studentListSchema = z.object({students:z.array(bridgeStudentSchema),nextCursor:z.string().nullable()});
export const studentDetailSchema = z.object({student:bridgeStudentSchema,standing:z.object({feesPending:money,lateFeePending:money,totalPending:money,totalPaid:money,lastPaymentDate:nullableText,asOfDate:z.string()})});
export const sessionsSchema = z.object({sessions:z.array(z.object({id:z.uuid(),sessionLabel:z.string(),status:z.string(),isCurrent:z.boolean()}))});
