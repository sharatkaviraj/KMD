import "server-only";

import { z } from "zod";
import { assertPermission, assertStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import { createClient } from "@/platform/supabase/server";
import { assertNotPreviewing } from "@/vx/view-as";
import { bridgeDirectoryLookupSchema, bridgeDirectorySchema, bridgeReceiptDetailSchema, bridgeWorkspaceSchema } from "./student-read-contracts";
import { bridgePendingRequestsSchema, bridgeReceiptListSchema, bridgeReceiptLookupSchema, bridgeTodaySummarySchema, RECEIPT_NUMBER } from "./office-read-contracts";
import {
  officeCommandStatusSchema, refundDecisionInputSchema, refundDecisionResultSchema, refundProcessInputSchema, refundProcessResultSchema,
  reversalInputSchema, reversalResultSchema, type RefundDecisionInput, type RefundProcessInput, type ReversalInput,
} from "./office-command-contracts";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { oneStudentReadPermissions, permittedFinanceKinds, restrictStudentWorkspace } from "./read-permissions";
import { assertBridgeSession, feesBridgeOrigin, feesBridgeWritesEnabled, usesCanonicalFees } from "./policy";
import { bridgeDocumentRequest, bridgePhotoRequest, bridgeRequest, FeesBridgeError } from "./transport";
import {
  commandSchema, postedPaymentSchema, postInputSchema, quoteInputSchema, studentDetailSchema,
  quoteSchema, receiptSchema, sessionsSchema, studentListSchema,
  type BridgePostInput, type BridgeQuoteInput,
} from "./contracts";

async function credentials(staff: CurrentStaff, sessionLabel?: string) {
  if (!usesCanonicalFees(staff, sessionLabel)) {
    throw new FeesBridgeError("not_available", "The live Fees connection is not available for this account or session.");
  }
  if (sessionLabel !== undefined) assertBridgeSession(sessionLabel);
  const client = await createClient();
  // getSession supplies the token only after assertStaff/getClaims verified the user.
  // The source independently validates this exact token and its explicit actor grant.
  const {data,error} = await client.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token || data.session?.user.id !== staff.userId) {
    throw new FeesBridgeError("unauthorized", "Sign in again to use the live Fees connection.");
  }
  return {token,key:process.env.FEES_BRIDGE_KEY?.trim() ?? "",origin:feesBridgeOrigin()};
}

export async function getBridgeStudentPhoto(studentId: string, sessionLabel: string, variant: "thumb" | "full" = "thumb") {
  const staff = await assertPermission("students:view");
  z.uuid().parse(studentId);
  z.enum(["thumb", "full"]).parse(variant);
  return bridgePhotoRequest({...(await credentials(staff, sessionLabel)), studentId, sessionLabel, variant});
}
export async function getBridgeStudentDocument(studentId:string,sendId:string,sessionLabel:string) {
  const staff=await assertPermission("fees:view");
  if(!oneStudentReadPermissions(staff).documents)throw new FeesBridgeError("forbidden","Your account cannot open saved financial documents.");
  z.uuid().parse(studentId);z.uuid().parse(sendId);
  return bridgeDocumentRequest({...(await credentials(staff,sessionLabel)),studentId,sendId,sessionLabel});
}

export async function getBridgeDirectory(input: {sessionLabel:string; query:string; classId:string; segments:readonly string[]; sort:"name"|"class"; page:number; pageSize:number;status?:"active"|"inactive"|"left"|"graduated"|"all"}) {
  const staff = await assertPermission("fees:view");
  if (input.classId) z.uuid().parse(input.classId);
  const query = z.string().trim().max(100).parse(input.query);
  const params = new URLSearchParams({session:input.sessionLabel,query,sort:input.sort,page:String(z.number().int().positive().parse(input.page)),pageSize:String(z.number().int().min(1).max(100).parse(input.pageSize))});
  params.set("status",z.enum(["active","inactive","left","graduated","all"]).parse(input.status??"active"));
  if (input.classId) params.set("classId",input.classId);
  if (input.segments.length) params.set("seg",input.segments.join(","));
  const result = await bridgeRequest({...(await credentials(staff,input.sessionLabel)),path:`/directory?${params}`,schema:bridgeDirectorySchema});
  if (result.sessionLabel !== input.sessionLabel || (input.classId && result.students.some(row=>row.classId!==input.classId))) throw new FeesBridgeError("invalid_response","The Fees directory did not match this request.");
  return result;
}

/**
 * The search palette's few names (S01): the directory's rows without its
 * facet counts and whole-set money totals, which Fees builds by walking every
 * matching student and which the palette never shows.
 */
export async function lookupBridgeDirectory(input: {sessionLabel:string; query:string; status:"active"|"all"; pageSize:number}) {
  const staff = await assertPermission("fees:view");
  const params = new URLSearchParams({session:input.sessionLabel,query:z.string().trim().min(2).max(100).parse(input.query),
    status:input.status,pageSize:String(z.number().int().min(1).max(10).parse(input.pageSize))});
  const result = await bridgeRequest({...(await credentials(staff,input.sessionLabel)),path:`/directory/lookup?${params}`,schema:bridgeDirectoryLookupSchema});
  if (result.sessionLabel !== input.sessionLabel) throw new FeesBridgeError("invalid_response","The Fees directory did not match this request.");
  return result;
}

export type WorkspacePages = {receiptsPage?:number;ledgerPage?:number;financePage?:number;contactsPage?:number;attemptsPage?:number;remindersPage?:number;noticesPage?:number;documentsPage?:number};
export async function getBridgeWorkspace(studentId:string,sessionLabel:string,pages:WorkspacePages={}) {
  const staff = await assertPermission("students:view");
  const capabilities=oneStudentReadPermissions(staff);
  z.uuid().parse(studentId);
  const params = new URLSearchParams({session:sessionLabel});
  params.set("financeKinds",permittedFinanceKinds(capabilities).join(","));
  for (const key of ["receiptsPage","ledgerPage","financePage","contactsPage","attemptsPage","remindersPage","noticesPage","documentsPage"] as const) if(pages[key]!==undefined) params.set(key,String(z.number().int().positive().parse(pages[key])));
  const result = await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/students/${studentId}/workspace?${params}`,schema:bridgeWorkspaceSchema});
  if(result.studentId!==studentId || result.student.id!==studentId || result.sessionLabel!==sessionLabel || result.student.classSessionLabel!==sessionLabel ||
    result.installmentBalances?.some(row=>row.studentId!==studentId || (row.sessionLabel!==sessionLabel && !(row.isCarryForward&&row.targetSessionLabel===sessionLabel))) ||
    (result.financialSummary && (result.financialSummary.studentId!==studentId || result.financialSummary.sessionLabel!==sessionLabel))) {
    throw new FeesBridgeError("invalid_response","The Fees record did not match this student and session.");
  }
  try{return restrictStudentWorkspace(result,capabilities);}catch{throw new FeesBridgeError("invalid_response","The Fees record did not match this account's read permissions.");}
}

export async function getBridgeReceiptDetail(receiptId:string,sessionLabel:string) {
  const staff = await assertPermission("fees:view");
  if(!oneStudentReadPermissions(staff).receipts)throw new FeesBridgeError("forbidden","Your account cannot view receipts.");
  z.uuid().parse(receiptId);
  const result=await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/receipts/${receiptId}/detail?${new URLSearchParams({session:sessionLabel})}`,schema:bridgeReceiptDetailSchema});
  // A receipt belongs to a session when any allocation does (Fees 20261103170000); its own label
  // names the first allocation's session, which for a receipt across two granted years may be the other.
  const inSession=result.detail.sessionLabel===sessionLabel || result.detail.breakdown.some(row=>row.sessionLabel===sessionLabel);
  if(result.receiptId!==receiptId || result.detail.id!==receiptId || result.studentId!==result.detail.studentId || result.sessionLabel!==sessionLabel || !inSession) {
    throw new FeesBridgeError("invalid_response","The Fees receipt did not match this request.");
  }
  return result;
}

/** Fees' Dashboard "Today": collected, receipts and by mode, uncached. */
export async function getBridgeTodaySummary(sessionLabel:string) {
  const staff=await assertPermission("fees:view");
  const result=await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/summary/today?${new URLSearchParams({session:sessionLabel})}`,schema:bridgeTodaySummarySchema});
  if(result.sessionLabel!==sessionLabel)throw new FeesBridgeError("invalid_response","The Fees summary did not match this session.");
  return result;
}

/** Fees' refund requests waiting on someone, as Finance controls lists them. */
export async function getBridgePendingRequests(sessionLabel:string) {
  const staff=await assertPermission("fees:view");
  const result=await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/requests/pending?${new URLSearchParams({session:sessionLabel})}`,schema:bridgePendingRequestsSchema});
  if(result.sessionLabel!==sessionLabel)throw new FeesBridgeError("invalid_response","The Fees requests did not match this session.");
  return result;
}

/** A printed receipt number to its source id, under the receipt detail rule. */
export async function lookupBridgeReceipt(receiptNumber:string,sessionLabel:string) {
  const staff=await assertPermission("fees:view");
  if(!oneStudentReadPermissions(staff).receipts)throw new FeesBridgeError("forbidden","Your account cannot view receipts.");
  const number=z.string().regex(RECEIPT_NUMBER).parse(receiptNumber);
  const result=await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/receipts/lookup?${new URLSearchParams({session:sessionLabel,number})}`,schema:bridgeReceiptLookupSchema});
  if(result.sessionLabel!==sessionLabel || result.receiptNumber!==number)throw new FeesBridgeError("invalid_response","The Fees receipt did not match this number.");
  return result;
}

/** Fees' Receipts page for a date range: receipts, totals by day and each day's close. */
export async function getBridgeReceipts(input:{sessionLabel:string;from:string;to:string;query:string;page:number;pageSize:number}) {
  const staff=await assertPermission("fees:view");
  if(!oneStudentReadPermissions(staff).receipts)throw new FeesBridgeError("forbidden","Your account cannot view receipts.");
  const day=z.iso.date();
  const params=new URLSearchParams({session:input.sessionLabel,from:day.parse(input.from),to:day.parse(input.to),
    query:z.string().trim().max(100).regex(/^[\p{L}\p{N} /_.-]*$/u).parse(input.query),
    page:String(z.number().int().min(1).max(10000).parse(input.page)),pageSize:String(z.number().int().min(1).max(100).parse(input.pageSize))});
  const result=await bridgeRequest({...(await credentials(staff,input.sessionLabel)),path:`/receipts?${params}`,schema:bridgeReceiptListSchema});
  if(result.sessionLabel!==input.sessionLabel)throw new FeesBridgeError("invalid_response","The Fees receipts did not match this session.");
  return result;
}

export async function listBridgeStudents(sessionLabel: string, query = "", cursor: string | null = null) {
  const staff = await assertPermission("fees:view");
  const queryParams = new URLSearchParams({session:sessionLabel,limit:"50",q:query.trim().slice(0,100)});
  if (cursor) queryParams.set("cursor",cursor);
  return bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/students?${queryParams}`,schema:studentListSchema});
}

export async function getBridgeStudent(studentId: string, sessionLabel: string) {
  const staff = await assertPermission("fees:view");
  z.uuid().parse(studentId);
  return bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/students/${studentId}?${new URLSearchParams({session:sessionLabel})}`,schema:studentDetailSchema});
}

export async function getBridgeSessions() {
  const staff = await assertStaff();
  const result=await bridgeRequest({...(await credentials(staff)),path:"/sessions",schema:sessionsSchema});
  return {sessions:result.sessions.filter(row=>/^\d{4}-\d{2}$/.test(row.sessionLabel))};
}

export async function quoteBridgePayment(input: BridgeQuoteInput) {
  const staff = await assertPermission("fees:collect");
  const body = quoteInputSchema.parse(input);
  const quote=await bridgeRequest({...(await credentials(staff,body.sessionLabel)),path:"/quote",body,schema:quoteSchema});
  if(quote.student.id!==body.studentId || quote.student.sessionLabel!==body.sessionLabel || quote.amount!==body.amount || quote.paymentDate!==body.paymentDate || quote.quickDiscountAmount!==body.quickDiscountAmount || quote.lateFeeWaiverAmount!==body.lateFeeWaiverAmount)throw new FeesBridgeError("invalid_response","The Fees quote did not match this request.");
  return quote;
}

export async function postBridgePayment(input: BridgePostInput) {
  const staff = await assertPermission("fees:collect");
  await assertNotPreviewing();
  if (!feesBridgeWritesEnabled()) throw new FeesBridgeError("read_only", "Collect in the Fees app while One's payment desk is read-only.");
  const body = postInputSchema.parse(input);
  const receipt = await bridgeRequest({...(await credentials(staff,body.sessionLabel)),path:"/payments",body,schema:postedPaymentSchema});
  if (receipt.commandId !== body.commandId || receipt.studentId !== body.studentId || receipt.sessionLabel !== body.sessionLabel || receipt.amountReceived !== body.amount) {
    throw new FeesBridgeError("invalid_response", "The Fees response did not match this payment. Check its status.", true);
  }
  return receipt;
}

export async function getBridgeCommand(commandId: string) {
  const staff = await assertPermission("fees:collect");
  z.uuid().parse(commandId);
  const result = await bridgeRequest({...(await credentials(staff)),path:`/commands/${commandId}`,schema:commandSchema});
  if(result.commandId !== commandId) throw new FeesBridgeError("invalid_response","The Fees response did not match this payment. Check its status.",true);
  return result;
}

/**
 * One office command (review F01, Fees 20261103190000): the One role must hold
 * the Fees permission the command needs, writes must be open, and Fees then
 * checks the person's own grant flag. The answer must be about this command.
 */
async function officeCommand<T extends { commandId: string }>(permission: "payments:reverse_any" | "finance:approve" | "finance:write", sessionLabel: string, commandId: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const staff = await assertPermission("fees:view");
  await assertNotPreviewing();
  if (!feesBridgeWritesEnabled()) throw new FeesBridgeError("read_only", "Use the Fees app while One's fee desk is read-only.");
  if (!feePermissionsFor(staff.role).includes(permission)) throw new FeesBridgeError("forbidden", "Your account cannot do this.");
  const result = await bridgeRequest({...(await credentials(staff, sessionLabel)), path, body, schema});
  if (result.commandId !== commandId) throw new FeesBridgeError("invalid_response", "The Fees answer was about another request. Check its status.", true);
  return result;
}

export async function postBridgeReversal(input: ReversalInput) {
  const body = reversalInputSchema.parse(input);
  const result = await officeCommand("payments:reverse_any", body.sessionLabel, body.commandId, "/reversals", body, reversalResultSchema);
  if (result.receiptId !== body.receiptId) throw new FeesBridgeError("invalid_response", "The Fees answer was about another receipt. Check its status.", true);
  return result;
}

export async function postBridgeRefundDecision(refundRequestId: string, input: RefundDecisionInput) {
  const id = z.uuid().parse(refundRequestId);
  const body = refundDecisionInputSchema.parse(input);
  const result = await officeCommand("finance:approve", body.sessionLabel, body.commandId, `/refunds/${id}/decision`, body, refundDecisionResultSchema);
  if (result.refundRequestId !== id) throw new FeesBridgeError("invalid_response", "The Fees answer was about another refund. Check its status.", true);
  return result;
}

export async function postBridgeRefundProcess(refundRequestId: string, input: RefundProcessInput) {
  const id = z.uuid().parse(refundRequestId);
  const body = refundProcessInputSchema.parse(input);
  const result = await officeCommand("finance:write", body.sessionLabel, body.commandId, `/refunds/${id}/process`, body, refundProcessResultSchema);
  if (result.refundRequestId !== id) throw new FeesBridgeError("invalid_response", "The Fees answer was about another refund. Check its status.", true);
  return result;
}

/** A lost answer: Fees' stored outcome for this command id, or not found (send the same id again). */
export async function getBridgeOfficeCommand(commandId: string) {
  const staff = await assertPermission("fees:view");
  z.uuid().parse(commandId);
  const result = await bridgeRequest({...(await credentials(staff)), path: `/commands/${commandId}`, schema: officeCommandStatusSchema});
  if (result.commandId !== commandId) throw new FeesBridgeError("invalid_response", "The Fees answer was about another request.", true);
  return result;
}

export async function getBridgeReceipt(receiptId: string, sessionLabel: string) {
  const staff = await assertPermission("fees:view");
  z.uuid().parse(receiptId);
  const receipt=await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/receipts/${receiptId}?${new URLSearchParams({session:sessionLabel})}`,schema:receiptSchema});
  if(receipt.receiptId!==receiptId || receipt.student.sessionLabel!==sessionLabel)throw new FeesBridgeError("invalid_response","The Fees receipt did not match this request.");
  return receipt;
}
