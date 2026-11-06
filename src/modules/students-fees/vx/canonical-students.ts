import type { MoneyList, StudentFees } from "./admin-students";
import type { BridgeDirectory, BridgeWorkspace } from "@/platform/fees-bridge/student-read-contracts";
import { STUDENT_LIST_FEE_SEGMENTS } from "@/platform/fees-bridge/student-directory";
import { bridgeStudentPhotoHref } from "@/platform/fees-bridge/student-photo";
import { segmentCount } from "@/modules/students-fees/domain/student-segments";
import { isYearCleared } from "@/modules/fees/domain/year-clear";
import { shownTransportLabel } from "@/modules/fees/domain/transport-route-key";
import { getDisplayInstallmentLabel, isCarryForwardInstallment } from "@/modules/prev-year-dues/domain/display";
import { buildFeeBreakupDisplayRows } from "@/modules/fees/domain/display-breakdown";

/** Presentation mapping of source-computed values; no One financial query/fallback. */
export function moneyListFromBridge(source:BridgeDirectory):MoneyList {
  return {
    sessionLabel:source.sessionLabel,total:source.pagination.totalCount,page:source.pagination.page,pageSize:source.pagination.pageSize,
    rows:source.students.map(row=>({id:row.id,fullName:row.fullName,admissionNo:row.admissionNo,classLabel:row.classLabel,routeLabel:row.transportRouteLabel,
      parentName:row.fatherName||row.motherName,phone:row.fatherPhone||row.motherPhone,status:row.status,
      photoUrl:row.hasPhoto?bridgeStudentPhotoHref(row.id,source.sessionLabel,"list"):null,
      overdueAmount:row.overdueAmount,outstandingAmount:row.outstandingAmount,pendingLateFeeAmount:row.pendingLateFeeAmount,totalPaid:row.totalPaid,totalDue:row.totalDue,lateFeeTotal:row.lateFeeTotal,
      siblingCount:row.siblingCount,isNew:row.studentStatusLabel==="New",yearClear:isYearCleared({outstandingAmount:row.outstandingAmount,totalPaid:row.totalPaid,discountClosedAmount:row.discountClosedAmount,hasPreparedDues:row.duesStatus==="generated"}),
      emi:row.emiPlan?{status:row.emiPlan.paymentStatus,monthly:row.emiPlan.monthlyAmount,nextDue:row.emiPlan.nextDueDate}:null,concessions:row.conventionalDiscountLabels,
    })),
    counts:{all:segmentCount(source.counts,"active")??source.counts.scopeTotal,...Object.fromEntries(Object.entries(STUDENT_LIST_FEE_SEGMENTS).map(([key,segment])=>[key,segmentCount(source.counts,segment)]))} as MoneyList["counts"],
  };
}

export function feesFromBridge(source:BridgeWorkspace):StudentFees|null {
  if(!source.permissions.fees || !source.installmentBalances || !source.financialSummary)return null;
  const installments=source.installmentBalances.map(row=>({...row,installmentLabel:getDisplayInstallmentLabel(row),isCarryForward:isCarryForwardInstallment(row)}))
    .sort((a,b)=>Number(b.isCarryForward)-Number(a.isCarryForward)||a.installmentNo-b.installmentNo);
  const sum=(pick:(row:(typeof installments)[number])=>number)=>installments.reduce((n,row)=>n+pick(row),0);
  const first=installments.find(row=>row.pendingAmount>0);
  const snapshot=source.financialSnapshot;
  const breakupRows=snapshot?buildFeeBreakupDisplayRows(snapshot.resolvedBreakdown):[];
  return {
    sessionLabel:source.sessionLabel,installments,
    summary:{outstanding:source.financialSummary.outstandingAmount,overdue:sum(row=>row.balanceStatus==="overdue"?row.pendingAmount:0),lateFeePending:source.financialSummary.lateFeeOutstandingAmount,
      lateFeeWaived:sum(row=>row.waiverApplied),paidThisSession:source.financialSummary.totalPaid,discountClosed:source.financialSummary.discountClosedAmount,sessionFee:source.financialSummary.baseChargeTotal,
      creditBalance:snapshot?.creditBalance??0,installmentsPaid:installments.filter(row=>row.balanceStatus==="paid").length,installmentsTotal:installments.length,installmentsPending:installments.filter(row=>row.pendingAmount>0).length,
      nextDue:first?{label:first.installmentLabel,amount:first.pendingAmount,dueDate:first.dueDate}:null},
    breakup:snapshot?{rows:breakupRows,annualTotal:snapshot.resolvedBreakdown.annualTotal,discountTotal:breakupRows.filter(row=>row.kind==="discount").reduce((sum,row)=>sum+Math.abs(row.amount),0),discountLabels:snapshot.resolvedBreakdown.conventionalDiscountLabels,tuitionOverride:source.feeProfile?.tuitionOverride??null,transportOverride:source.feeProfile?.transportOverride??null}:null,
    receipts:(source.receipts??[]).map(row=>({id:row.id,number:row.receiptNumber,date:row.paymentDate,amount:row.totalAmount,mode:row.paymentMode,reversed:row.isReversed})),
    family:(source.family?.members??[]).map(row=>({...row,outstanding:row.financials?.outstanding??null,totalDue:row.financials?.totalDue??null,totalPaid:row.financials?.totalPaid??null})),
    familyGroupId:source.family?.familyGroupId??null,routeLabel:shownTransportLabel(source.student.transportRouteLabel),dateOfBirth:source.student.dateOfBirth,joinedOn:source.student.joinedOn,address:source.student.address,status:source.student.status,
  };
}
