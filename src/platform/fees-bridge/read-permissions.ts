import { can } from "@/platform/auth/permissions";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import type { BridgeWorkspace } from "./student-read-contracts";

type ReadPermissions=BridgeWorkspace["permissions"];
/** One's own permission matrix and its existing fine-grained fee-role limits. */
export function oneStudentReadPermissions(staff:CurrentStaff):ReadPermissions {
  const fee=new Set(feePermissionsFor(staff.role)),fees=can(staff,"fees:view");
  const receipts=fees&&fee.has("receipts:view"),communications=fees&&fee.has("students:view");
  return {fees,receipts,ledger:receipts&&fee.has("ledger:view"),finance:fees&&fee.has("finance:view"),household:communications,
    contacts:fees&&fee.has("defaulters:view"),communications,documents:receipts&&communications&&fee.has("receipts:print")};
}
export function permittedFinanceKinds(permissions:ReadPermissions) {
  return [
    ...(permissions.receipts?["receipt_adjustment","receipt_finance_adjustment"] as const:[]),
    ...(permissions.finance?["refund"] as const:[]),...(permissions.fees?["waiver"] as const:[]),
  ];
}
/** Mask data and metadata together; a broader source mapping never grants a One capability. */
export function restrictStudentWorkspace(source:BridgeWorkspace,one:ReadPermissions):BridgeWorkspace {
  const permissions=Object.fromEntries(Object.keys(one).map(key=>[key,one[key as keyof ReadPermissions]&&source.permissions[key as keyof ReadPermissions]])) as ReadPermissions;
  if(!permissions.fees)for(const key of Object.keys(permissions) as (keyof ReadPermissions)[])permissions[key]=false;
  permissions.ledger=permissions.ledger&&permissions.receipts;
  permissions.documents=permissions.documents&&permissions.receipts&&permissions.communications;
  const kinds=permittedFinanceKinds(permissions);
  // The server narrows kinds before counting/paging. Refuse inconsistent data
  // instead of retaining a total that includes a forbidden refund/correction.
  if(source.financeHistory?.some(row=>!kinds.includes(row.kind)))throw new Error("unpermitted_finance_history");
  return {...source,permissions,
    feeProfile:permissions.fees?source.feeProfile:null,financialSummary:permissions.fees?source.financialSummary:null,financialSnapshot:permissions.fees?source.financialSnapshot:null,
    installmentBalances:permissions.fees?source.installmentBalances:null,repaymentPlan:permissions.fees?source.repaymentPlan:null,repaymentPlanHistory:permissions.fees?source.repaymentPlanHistory:null,
    ledger:permissions.ledger?source.ledger:null,receipts:permissions.receipts?source.receipts:null,family:permissions.household?source.family:null,household:permissions.household?source.household:null,
    financeHistory:permissions.fees?source.financeHistory:null,
    pagination:{receipts:permissions.receipts?source.pagination.receipts:null,ledgerPayments:permissions.ledger?source.pagination.ledgerPayments:null,ledgerAdjustments:permissions.ledger?source.pagination.ledgerAdjustments:null,financeHistory:permissions.fees?source.pagination.financeHistory:null},
    documents:{...source.documents,receiptDetails:permissions.fees&&permissions.receipts&&source.documents.receiptDetails},
    history:{contacts:permissions.contacts?source.history.contacts:null,collectionFlags:permissions.contacts?source.history.collectionFlags:null,recovery:permissions.contacts?source.history.recovery:null,
      attempts:permissions.communications?source.history.attempts:null,reminders:permissions.communications?source.history.reminders:null,notices:permissions.communications?source.history.notices:null,documents:permissions.documents?source.history.documents:null},
  };
}
