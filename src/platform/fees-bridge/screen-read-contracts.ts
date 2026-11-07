import { z } from "zod";

// Fees screen reads (schoolfees docs/one-bridge/screen-reads.md): the data
// behind One's own Dues & calls and Fee setup screens. Parse what One shows;
// money is whole rupees, as in every other bridge contract.
const text = z.string();
const nullableText = text.nullable();
const amount = z.number().finite();
const count = z.number().int().nonnegative();
const pins = { sessionLabel: text, asOf: text, asOfDate: text };

export const bridgeDuesSchema = z.object({
  ...pins,
  defaulters: z.array(z.object({
    studentId: text, fullName: text, fatherName: nullableText, fatherPhone: nullableText, motherPhone: nullableText,
    classLabel: text, transportRouteId: nullableText, overdueAmount: amount, totalPending: amount, lateFee: amount,
    daysOverdue: z.number().finite(), familyGroupId: nullableText, lastPaymentDate: nullableText,
  })),
  contacts: z.array(z.object({ studentId: text, lastContactedAt: nullableText, lastOutcome: nullableText, lastChannel: nullableText, snoozeUntil: nullableText })),
  overdueRows: z.array(z.object({ studentId: text, classLabel: text, installmentNo: z.number().int(), isCarryForward: z.boolean(), pendingAmount: amount })),
  notDueYet: z.array(z.object({ studentId: text, amount })),
  recovery: z.array(z.object({
    studentId: text, fullName: text, fatherName: nullableText, phone: nullableText, status: text, classLabel: nullableText,
    lastPaymentDate: nullableText, dues: z.array(z.object({ sessionLabel: text, remainingAmount: amount })),
  })),
  calledToday: z.array(text),
  collectedWeek: amount,
});
export type BridgeDues = z.infer<typeof bridgeDuesSchema>;

export const bridgeDuesFamilySchema = z.object({
  ...pins,
  installments: z.array(z.object({
    studentId: text, admissionNo: nullableText, route: nullableText, installmentNo: z.number().int(), isCarryForward: z.boolean(),
    label: text, dueDate: text, pendingAmount: amount, lateFeePending: amount, balanceStatus: text, baseCharge: amount,
  })),
  contacts: z.array(z.object({ studentId: text, contactedAt: text, channel: nullableText, outcome: nullableText, note: nullableText })),
});
export type BridgeDuesFamily = z.infer<typeof bridgeDuesFamilySchema>;

export const bridgeDuesPeopleSchema = z.object({
  ...pins,
  briefs: z.array(z.object({ studentId: text, fullName: text, fatherName: nullableText, phone: nullableText })),
  payments: z.array(z.object({ studentId: text, paymentDate: text, amount, receiptNumber: text })),
});
export type BridgeDuesPeople = z.infer<typeof bridgeDuesPeopleSchema>;

const feeHead = z.object({
  id: text, label: text, amount, applicationType: text, isRefundable: z.boolean(), chargeFrequency: text,
  isMandatory: z.boolean(), includeInWorkbookCalculation: z.boolean(), isActive: z.boolean(), notes: nullableText,
});
export const bridgeFeeSetupSchema = z.object({
  ...pins,
  draft: z.object({
    academicSessionLabel: text,
    installmentDates: z.array(text),
    lateFeeFlatAmount: amount,
    newStudentAcademicFeeAmount: amount,
    oldStudentAcademicFeeAmount: amount,
    academicFeeDistribution: z.enum(["first_only", "equal"]),
    customFeeHeads: z.array(feeHead),
    discounts: z.array(z.object({
      key: text, id: nullableText, code: text, displayName: text,
      calculationType: z.enum(["tuition_zero", "tuition_percentage", "tuition_fixed_amount"]),
      fixedTuitionAmount: amount.nullable(), percentage: amount.nullable(), isActive: z.boolean(), isBuiltin: z.boolean(),
    })),
    classRows: z.array(z.object({ label: text, annualTuition: amount })),
    routeRows: z.array(z.object({ routeName: text, annualFee: amount })),
  }),
  studentsByClass: z.record(text, count),
  studentsByRoute: z.record(text, count),
  activeStudents: count,
  paidInstallments: z.array(z.number().int()),
  ruleStudents: z.record(text, count),
  ruleStudentNames: z.record(text, z.array(text)),
  // Fees' RecentConfigChangeLogItem, the type One's ported change log shares.
  history: z.array(z.object({ id: text, createdAt: text }).passthrough()),
  updatedAt: nullableText,
});
export type BridgeFeeSetup = z.infer<typeof bridgeFeeSetupSchema>;

// Fees report reads (schoolfees docs/one-bridge/report-reads.md): the rows
// behind One's own Reports screen. One does the arranging.
const reportClass = z.object({ id: text, className: text, section: nullableText, streamName: nullableText, sortOrder: z.number().finite() });

export const bridgeReportBalancesSchema = z.object({
  ...pins,
  classes: z.array(reportClass),
  balances: z.array(z.object({
    studentId: text, studentName: text, admissionNo: nullableText, fatherName: nullableText, fatherPhone: nullableText,
    classId: nullableText, classLabel: text, installmentNo: z.number().int(), dueDate: text,
    pendingAmount: amount, lateFeePending: amount, studentStatus: text, isCarryForward: z.boolean(),
  })),
});
export type BridgeReportBalances = z.infer<typeof bridgeReportBalancesSchema>;

export const bridgeReportReceiptsSchema = z.object({
  ...pins,
  from: text,
  to: text,
  classes: z.array(reportClass),
  receipts: z.array(z.object({ paymentDate: text, paymentMode: text, amount, classId: nullableText, reversed: z.boolean() })),
});
export type BridgeReportReceipts = z.infer<typeof bridgeReportReceiptsSchema>;

export const bridgeReportDaybookSchema = z.object({
  ...pins,
  date: text,
  closure: z.object({ status: text, closedAt: nullableText, closedByName: nullableText }).nullable(),
  collected: amount,
  paidOut: amount,
  receiptCount: count,
  reversedCount: count,
  rows: z.array(z.object({
    id: text, type: z.enum(["collection", "refund", "correction"]), postedAt: text, studentId: nullableText, studentName: text,
    classLabel: nullableText, receiptNumber: nullableText, mode: nullableText, cashIn: amount, cashOut: amount,
    status: text, tone: z.enum(["good", "warning", "neutral", "accent"]), note: nullableText,
  })),
});
export type BridgeReportDaybook = z.infer<typeof bridgeReportDaybookSchema>;

// The AI report (7 Nov 2026): one page of student photographs, at most 40 and
// about 2 MB of image bytes, with the children whose photograph could not be
// read. Base64 because the page is JSON; One passes it to the browser as is.
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const bridgeAiPhotosSchema = z.object({
  ...pins,
  photos: z.array(z.object({
    studentId: z.uuid(), admissionNo: nullableText, fullName: text, classLabel: text, status: text,
    contentType: z.enum(PHOTO_TYPES),
    // 512 KiB is Fees' cap on a stored photograph; as base64 that is 699,052 characters.
    data: z.string().min(4).max(700_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })).max(40),
  skipped: z.array(z.object({ studentId: z.uuid(), admissionNo: nullableText, fullName: text, reason: z.enum(["missing", "unreadable"]) })).max(41),
  next: z.uuid().nullable(),
  total: count.nullable(),
});
export type BridgeAiPhotos = z.infer<typeof bridgeAiPhotosSchema>;
