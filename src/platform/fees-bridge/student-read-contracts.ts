import { z } from "zod";

// Additive /api/one/v1 read DTOs. Parse the fields One displays; never accept
// source storage paths, arbitrary HTML, executable actions or generic table data.
const text = z.string();
const nullableText = text.nullable();
const amount = z.number().finite();
const nullableAmount = amount.nullable();
const count = z.number().int().nonnegative();
const uuid = z.uuid();
const paymentStatus = z.enum(["upcoming", "on_track", "due", "behind", "completed"]);
const pins = {sessionLabel:text, asOf:text, asOfDate:text};
const page = z.object({page:count.positive(), pageSize:count.positive(), totalCount:count, hasMore:z.boolean()});
const historySection=<T extends z.ZodType>(row:T)=>z.object({rows:z.array(row),pagination:page}).nullable();
const messageRecord=z.object({id:uuid,createdAt:text,updatedAt:nullableText,sentOn:nullableText,kind:nullableText,campaign:nullableText,status:nullableText,destination:nullableText,destinationRole:nullableText,language:nullableText,
  deliveryStatus:nullableText,deliveredAt:nullableText,readAt:nullableText,attempts:count.nullable(),lastAttemptAt:nullableText,failureCause:nullableText,resolution:nullableText,resolutionNote:nullableText,resolvedAt:nullableText,receiptId:uuid.nullable(),dueAmount:nullableAmount});
const history=z.object({
  contacts:historySection(z.object({id:uuid,contactedAt:text,channel:nullableText,outcome:nullableText,note:nullableText,snoozeUntil:nullableText,contactedPhone:nullableText,phoneLabel:nullableText,broadcast:z.boolean(),hasVoiceNote:z.boolean()})),
  collectionFlags:z.object({noCall:z.boolean(),reason:nullableText,whatsappCadence:nullableText,whatsappSnoozedUntil:nullableText,whatsappLanguage:nullableText,whatsappProfile:nullableText,profileSetAt:nullableText,updatedAt:nullableText}).nullable(),
  recovery:z.object({stage:nullableText,promiseOutcome:nullableText,promiseResolvedAt:nullableText,keptCount:count,brokenCount:count,updatedAt:nullableText}).nullable(),
  attempts:historySection(z.object({id:uuid,sendId:uuid,createdAt:text,result:nullableText,destination:nullableText,destinationRole:nullableText,source:nullableText,note:nullableText,cause:nullableText})),
  reminders:historySection(messageRecord),notices:historySection(messageRecord),
  documents:historySection(z.object({sendId:uuid,kind:z.enum(["receipt","fee_statement"]).nullable(),receiptId:uuid.nullable(),createdAt:text,updatedAt:nullableText,available:z.boolean()})),
});
const emiBadge = z.object({paymentStatus, monthlyAmount:amount, remainingBalance:amount, catchUpAmount:amount, nextDueDate:nullableText, missedInstallmentCount:count, planReviewNeeded:z.boolean()});
const directoryRow = z.object({
  id:uuid, classId:uuid, fullName:text, admissionNo:text, classLabel:text, status:text, studentStatusLabel:text,
  fatherName:nullableText, motherName:nullableText, fatherPhone:nullableText, motherPhone:nullableText,
  transportRouteLabel:text, overdueAmount:amount, outstandingAmount:amount, pendingLateFeeAmount:amount,
  totalPaid:amount, totalDue:amount, lateFeeTotal:amount, discountClosedAmount:amount,
  duesStatus:text, conventionalDiscountLabels:z.array(text), siblingCount:count, hasPhoto:z.boolean(),
  emiPlan:emiBadge.nullable().optional(),
});
export const bridgeDirectorySchema = z.object({...pins, students:z.array(directoryRow), pagination:page,
  counts:z.object({scopeTotal:count,populationTotal:count,enrolment:z.record(text,count),counts:z.record(text,count)}),
  summary:z.object({studentCount:count,expectedFees:amount,totalPaid:amount,totalOutstanding:amount,oldBalanceOutstanding:amount,lateFeeOutstanding:amount,totalDiscount:amount,transportStudentCount:count}),
});
export type BridgeDirectory = z.infer<typeof bridgeDirectorySchema>;
/** `/directory/lookup`: the same rows for the search palette, without facet counts or totals. */
export const bridgeDirectoryLookupSchema = z.object({...pins, students:z.array(directoryRow).max(10), pagination:page});

const profile = z.object({
  id:uuid, admissionNo:text, fullName:text, dateOfBirth:nullableText, joinedOn:nullableText, leftOn:nullableText,
  email:nullableText, fatherName:nullableText, motherName:nullableText, fatherPhone:nullableText, motherPhone:nullableText,
  address:nullableText, classId:uuid, classLabel:text, classSessionLabel:text, transportRouteId:uuid.nullable(), transportRouteLabel:text,
  status:text, notes:nullableText, createdAt:text, updatedAt:text, hasPhoto:z.boolean(),
  gender:nullableText,bloodGroup:nullableText,category:nullableText,religion:nullableText,caste:nullableText,nationality:nullableText,motherTongue:nullableText,
  aadhaarNo:nullableText,janAadhaarNo:nullableText,apaarId:nullableText,house:nullableText,rollNo:nullableText,previousSchool:nullableText,tcNumber:nullableText,boardRegistrationNo:nullableText,
  villageCity:nullableText,tehsil:nullableText,district:nullableText,state:nullableText,pincode:nullableText,
  guardianName:nullableText,guardianRelation:nullableText,guardianPhone:nullableText,emergencyContactName:nullableText,emergencyContactPhone:nullableText,
});
const feeProfile = z.object({
  studentTypeOverride:nullableText,studentStatusLabel:text,tuitionOverride:nullableAmount,transportOverride:nullableAmount,
  discountAmount:amount,lateFeeWaiverAmount:amount,otherAdjustmentHead:nullableText,otherAdjustmentAmount:nullableAmount,
  overrideReason:nullableText,overrideNotes:nullableText,conventionalDiscountPolicyIds:z.array(text),conventionalDiscountLabels:z.array(text),
  conventionalDiscountReason:nullableText,conventionalDiscountNotes:nullableText,conventionalDiscountFamilyGroupLabel:nullableText,
  conventionalDiscountFamilyGroupId:nullableText,conventionalDiscountManualOverrideReason:nullableText,
  tuitionBeforeConventionalDiscount:amount,tuitionAfterConventionalDiscount:amount,
});
const feeHead = z.object({id:text,label:text,amount});
const installment = z.object({
  installmentId:uuid,studentId:uuid,sessionLabel:text,installmentNo:z.number().int(),installmentLabel:text,dueDate:text,
  isCarryForward:z.boolean().optional(),sourceSessionLabel:nullableText.optional(),targetSessionLabel:nullableText.optional(),feeBucket:nullableText.optional(),
  baseCharge:amount,paidAmount:amount,appliedAmount:amount,settledAmount:amount,feeSettledAmount:amount,lateFeeSettledAmount:amount,
  planPriority:z.number().int(),settlementRank:z.number().int(),discountCloseoutAmount:amount,adjustmentAmount:amount,
  rawLateFee:amount,waiverApplied:amount,finalLateFee:amount,totalCharge:amount,pendingAmount:amount,lateFeePending:amount,totalPending:amount,
  balanceStatus:z.enum(["paid","partial","overdue","pending","waived"]),lateFeeStatus:z.enum(["none","pending","waived","paid"]),
});
const financialSummary = z.object({
  studentId:uuid,sessionLabel:text,tuitionFee:amount,transportFee:amount,academicFee:amount,otherAdjustmentHead:nullableText,otherAdjustmentAmount:amount,
  grossBaseBeforeDiscount:amount,discountAmount:amount,conventionalDiscountAmount:amount,studentDiscountAmount:amount,conventionalDiscountLabels:nullableText,
  lateFeeWaiverAmount:amount,baseChargeTotal:amount,lateFeeTotal:amount,discountClosedAmount:amount,totalDue:amount,totalPaid:amount,outstandingAmount:amount,
  baseOutstandingAmount:amount,lateFeeOutstandingAmount:amount,totalOwedAmount:amount,nextDueDate:nullableText,nextDueAmount:nullableAmount,nextDueLabel:nullableText,
  lastPaymentDate:nullableText,inst1Pending:amount,inst2Pending:amount,inst3Pending:amount,inst4Pending:amount,statusLabel:text,overrideReason:nullableText,
  paidInstallmentCount:count,partlyPaidInstallmentCount:count,overdueInstallmentCount:count,
});
const financialSnapshot = z.object({
  resolvedBreakdown:z.object({coreHeads:z.array(feeHead),customHeads:z.array(feeHead),otherAdjustmentHeads:z.array(feeHead),annualTotal:amount,
    calculationModel:text,studentType:text,academicFeeAmount:amount,otherAdjustmentHead:nullableText,otherAdjustmentAmount:amount,grossBaseBeforeDiscount:amount,
    discountApplied:amount,conventionalDiscountApplied:amount,conventionalDiscountLabels:z.array(text),tuitionBeforeConventionalDiscount:amount,lateFeeWaiverAmount:amount,booksExcludedFromWorkbook:z.boolean()}),
  classDefaultTuitionFee:amount,routeDefaultTransportFee:amount,currentOutstanding:amount,creditBalance:amount,refundableAmount:amount,rowsKeptForReview:count,
  openInstallments:count,overdueInstallments:count,nextDueDate:nullableText,nextDueLabel:nullableText,nextDueAmount:nullableAmount,activeOverrideReason:nullableText,
});
const ledgerPayment = z.object({id:uuid,createdAt:text,paymentDate:text,receiptNumber:text,installmentLabel:text,dueDate:text,paymentMode:text,paymentAmount:amount,
  referenceNumber:nullableText,receivedBy:nullableText,notes:nullableText,adjustmentCount:count,adjustmentNetDelta:amount});
const ledgerAdjustment = z.object({id:uuid,createdAt:text,paymentId:uuid,receiptNumber:text,paymentDate:text,installmentLabel:text,dueDate:text,paymentAmount:amount,
  adjustmentType:text,amountDelta:amount,reason:text,notes:nullableText,createdBy:nullableText,createdByName:nullableText});
const planSummary = z.object({planId:uuid,studentId:uuid,sessionLabel:text,scope:text,lifecycle:text,paymentStatus,
  openingBalance:amount,monthlyAmount:amount,firstDueDate:text,termMonths:count,finalInstallmentAmount:amount,endDate:nullableText,waivedLateFeeTotal:amount,itemCount:count,
  remainingBalance:amount,paidToDate:amount,expectedToDate:amount,catchUpAmount:amount,missedInstallmentCount:count,paidInstallmentCount:count,
  nextDueSequenceNo:count.nullable(),nextDueDate:nullableText,nextDueAmount:nullableAmount,reason:text,activatedAt:text,activatedByLabel:nullableText,
  cancelledAt:nullableText,cancellationReason:nullableText,supersedesPlanId:nullableText,supersededByPlanId:nullableText,planReviewNeeded:z.boolean()});
// Sections of the student record. Fees serves each on its own (review P02) and
// the workspace as all of them; both schemas are built from these pieces.
const studentRead = {...pins,studentId:uuid,
  permissions:z.object({fees:z.boolean(),receipts:z.boolean(),ledger:z.boolean(),finance:z.boolean(),household:z.boolean(),contacts:z.boolean(),communications:z.boolean(),documents:z.boolean()})};
const receiptRow = z.object({id:uuid,receiptNumber:text,paymentDate:text,totalAmount:amount,paymentMode:text,paymentModeLabel:text,referenceNumber:nullableText,receivedBy:nullableText,
  createdAt:text,isReversed:z.boolean(),appliedTo:nullableText,appliedToInstallments:z.array(z.object({label:text,dueDate:nullableText,amount}))});
const ledger = z.object({id:uuid,fullName:text,admissionNo:text,classLabel:text,payments:z.array(ledgerPayment),adjustments:z.array(ledgerAdjustment),totalPayments:amount,totalAdjustmentNet:amount,totalCreditAdjustments:amount,totalDebitAdjustments:amount});
const financeRow = z.object({id:uuid,kind:z.enum(["receipt_adjustment","receipt_finance_adjustment","refund","waiver"]),receiptId:uuid.nullable(),createdAt:text,status:nullableText,amount:nullableAmount,reason:nullableText,notes:nullableText,details:z.record(text,z.union([text,amount,z.null()]))});
const family = z.object({familyGroupId:nullableText,members:z.array(z.object({id:uuid,fullName:text,admissionNo:text,classLabel:text,statusLabel:text,isSelf:z.boolean(),
  financials:z.object({totalDue:amount,totalPaid:amount,outstanding:amount,discountCloseouts:amount,lateFeeWaiver:amount}).nullable().optional()}))}).nullable();
const household = z.object({familyGroupId:nullableText,familyLabel:nullableText,contacts:z.array(z.object({destination:text,labels:z.array(text),telephoneEligible:z.boolean(),whatsappEligible:z.boolean(),unavailableCause:nullableText})),noContact:z.boolean(),pausedUntil:nullableText,reviewRequired:z.boolean()}).nullable();
/** The money band: profile, fee profile, canonical totals, installments and EMI. */
const feesSection = {
  student:profile,feeProfile:feeProfile.nullable(),financialSummary:financialSummary.nullable(),financialSnapshot:financialSnapshot.nullable(),installmentBalances:z.array(installment).nullable(),
  repaymentPlan:z.object({summary:planSummary,schedule:z.array(z.object({sequenceNo:count,dueDate:text,amount,paidAmount:amount,status:text,
    lateFee:z.object({installmentId:uuid,amount,waivedAmount:amount,paidAmount:amount,outstandingAmount:amount}).nullable()})),
    items:z.array(z.object({installmentId:uuid,installmentNo:z.number().nullable(),installmentLabel:nullableText,dueDate:text,isCarryForward:z.boolean(),snapshotBaseCharge:amount,includedBaseBalance:amount,waivedLateFee:amount}))}).nullable(),
  repaymentPlanHistory:z.array(planSummary).nullable(),
  documents:z.object({photo:z.boolean(),receiptDetails:z.boolean(),storedStudentAttachments:z.literal(false)}),
};
export const bridgeWorkspaceSchema = z.object({...studentRead,...feesSection,
  ledger:ledger.nullable(),receipts:z.array(receiptRow).nullable(),family,household,financeHistory:z.array(financeRow).nullable(),
  pagination:z.object({receipts:page.nullable(),ledgerPayments:page.nullable(),ledgerAdjustments:page.nullable(),financeHistory:page.nullable()}),
  history,
});
export type BridgeWorkspace = z.infer<typeof bridgeWorkspaceSchema>;
/** GET /students/:id/fees */
export const bridgeStudentFeesSchema = z.object({...studentRead,...feesSection});
/** GET /students/:id/receipts — one page, at most 100. */
export const bridgeStudentReceiptsSchema = z.object({...studentRead,receipts:z.array(receiptRow).max(100).nullable(),pagination:page.nullable()});
/** GET /students/:id/ledger */
export const bridgeStudentLedgerSchema = z.object({...studentRead,ledger:ledger.nullable(),pagination:z.object({payments:page.nullable(),adjustments:page.nullable()})});
/** GET /students/:id/finance-history — null when no asked-for kind is permitted. */
export const bridgeStudentFinanceHistorySchema = z.object({...studentRead,financeHistory:z.array(financeRow).max(100).nullable(),pagination:page.nullable()});
/** GET /students/:id/household */
export const bridgeStudentHouseholdSchema = z.object({...studentRead,family,household});
/** GET /students/:id/history */
export const bridgeStudentHistorySchema = z.object({...studentRead,history});
export type BridgeStudentFees = z.infer<typeof bridgeStudentFeesSchema>;
export type BridgeStudentReceipts = z.infer<typeof bridgeStudentReceiptsSchema>;
export type BridgeStudentLedger = z.infer<typeof bridgeStudentLedgerSchema>;
export type BridgeStudentFinanceHistory = z.infer<typeof bridgeStudentFinanceHistorySchema>;
export type BridgeStudentHousehold = z.infer<typeof bridgeStudentHouseholdSchema>;
export type BridgeStudentHistory = z.infer<typeof bridgeStudentHistorySchema>;

export const bridgeReceiptDetailSchema = z.object({...pins,receiptId:uuid,studentId:uuid,detail:z.object({
  id:uuid,studentId:uuid,receiptNumber:text,paymentDate:text,paymentMode:text,onlineMethod:nullableText.optional(),totalAmount:amount,referenceNumber:nullableText,notes:nullableText,receivedBy:nullableText,
  createdAt:text,createdByName:nullableText,studentFullName:text,admissionNo:text,fatherName:nullableText,fatherPhone:nullableText,motherPhone:nullableText,familyGroupId:nullableText,parentEmail:nullableText,
  classLabel:text,sessionLabel:text,transportRouteLabel:text,studentStatusLabel:text,feeSummary:z.array(z.object({label:text,amount})),totalDue:amount,totalPaidBeforeReceipt:amount,totalPaidToDate:amount,
  outstandingAfterReceipt:amount,currentOutstanding:amount,discountAmount:amount,lateFeeAmount:amount,lateFeeWaived:amount,
  breakdown:z.array(z.object({paymentId:uuid,installmentNo:z.number(),installmentLabel:text,sessionLabel:nullableText,dueDate:text,amount,originalAmount:amount,adjustmentAmount:amount,effectiveAmount:amount,notes:nullableText,
    discountAppliedAtPosting:nullableAmount,waiverAppliedAtPosting:nullableAmount,pendingBeforePosting:nullableAmount,pendingAfterPosting:nullableAmount})),
  installmentStatus:z.array(z.object({installmentNo:z.number(),label:text,dueDate:text,expected:amount,paid:amount,pending:amount,lateFee:amount,status:text})),
  previousReceipts:z.array(z.object({id:uuid,receiptNumber:text,paymentDate:text,totalAmount:amount,isReversed:z.boolean().optional()})),
  conventionalDiscountAssignments:z.array(z.object({assignmentId:uuid,policyCode:text,policyDisplayName:text,beforeTuitionAmount:amount,resultingTuitionAmount:amount,isWinningPolicy:z.boolean()})),
  reversedAmount:amount.optional(),isVoided:z.boolean().optional(),voidReason:nullableText.optional(),
})});
export type BridgeReceiptDetail = z.infer<typeof bridgeReceiptDetailSchema>;
