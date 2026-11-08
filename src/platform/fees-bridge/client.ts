import "server-only";

import { z } from "zod";
import { assertPermission, assertStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import { createClient } from "@/platform/supabase/server";
import { assertNotPreviewing } from "@/vx/view-as";
import { bridgeDirectoryLookupSchema, bridgeDirectorySchema, bridgeReceiptDetailSchema, bridgeWorkspaceSchema } from "./student-read-contracts";
import {
  bridgeStudentFeesSchema, bridgeStudentFinanceHistorySchema, bridgeStudentHistorySchema, bridgeStudentHouseholdSchema,
  bridgeStudentLedgerSchema, bridgeStudentReceiptsSchema, type BridgeWorkspace,
} from "./student-read-contracts";
import { composeStudentView } from "./student-view";
import { bridgeAiPhotosSchema, bridgeDuesFamilySchema, bridgeDuesPeopleSchema, bridgeDuesSchema, bridgeFamiliesSchema, bridgeFeeSetupSchema,
  bridgeReportBalancesSchema, bridgeReportDaybookSchema, bridgeReportReceiptsSchema } from "./screen-read-contracts";
import { bridgePendingRequestsSchema, bridgeReceiptListSchema, bridgeReceiptLookupSchema, bridgeTodaySummarySchema, RECEIPT_NUMBER } from "./office-read-contracts";
import {
  officeCommandStatusSchema, refundDecisionInputSchema, refundDecisionResultSchema, refundProcessInputSchema, refundProcessResultSchema,
  reversalInputSchema, reversalResultSchema, type RefundDecisionInput, type RefundProcessInput, type ReversalInput,
} from "./office-command-contracts";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { oneStudentReadPermissions, permittedFinanceKinds, restrictStudentWorkspace } from "./read-permissions";
import { assertBridgeSession, feesBridgeOrigin, feesBridgeWritesEnabled, usesCanonicalFees } from "./policy";
import { bridgeDocumentRequest, bridgePhotoRequest, bridgeRequest, bridgeWorkbookRequest, FeesBridgeError } from "./transport";
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
  // The token is always the signed-in person's own. While an administrator
  // sees One as somebody else (D-544) that is the administrator, and Fees
  // answers their reads; One then shows only what the chosen person may see.
  const signedIn = staff.viewedBy?.userId ?? staff.userId;
  if (error || !token || data.session?.user.id !== signedIn) {
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

// ── Single-purpose student reads (review P02) ─────────────────────────────
// Fees serves each section of the student record on its own, under the
// workspace's grant. One asks only for what a screen shows: the palette two
// receipts, Student 360 the sections this reader may see. Never cached.

type StudentSection="fees"|"receipts"|"ledger"|"finance-history"|"household"|"history";
async function readStudentSection<T extends {studentId:string;sessionLabel:string}>(auth:Awaited<ReturnType<typeof credentials>>,studentId:string,sessionLabel:string,section:StudentSection,query:Record<string,string|undefined>,schema:z.ZodType<T>):Promise<T> {
  const params=new URLSearchParams({session:sessionLabel});
  for(const [key,value] of Object.entries(query))if(value!==undefined)params.set(key,value);
  const result=await bridgeRequest({...auth,path:`/students/${studentId}/${section}?${params}`,schema});
  if(result.studentId!==studentId||result.sessionLabel!==sessionLabel)throw new FeesBridgeError("invalid_response","The Fees record did not match this student and session.");
  return result;
}
const positive=(value:number|undefined)=>value===undefined?undefined:String(z.number().int().min(1).max(10_000).parse(value));

/** One page of a child's receipts for this session, newest first (the palette asks for two). */
export async function getBridgeStudentReceipts(studentId:string,sessionLabel:string,options:{page?:number;pageSize?:number}={}) {
  const staff=await assertPermission("fees:view");
  if(!oneStudentReadPermissions(staff).receipts)throw new FeesBridgeError("forbidden","Your account cannot view receipts.");
  z.uuid().parse(studentId);
  const pageSize=z.number().int().min(1).max(100).parse(options.pageSize??40);
  const result=await readStudentSection(await credentials(staff,sessionLabel),studentId,sessionLabel,"receipts",{page:positive(options.page),pageSize:String(pageSize)},bridgeStudentReceiptsSchema);
  if((result.receipts?.length??0)>pageSize)throw new FeesBridgeError("invalid_response","The Fees receipts did not match this request.");
  // Fees' own refusal stands: no receipts without its receipt and fee permissions.
  return result.permissions.receipts&&result.permissions.fees?result:{...result,receipts:null,pagination:null};
}

export type StudentViewSection="receipts"|"ledger"|"financeHistory"|"household"|"history";
const EVERY_SECTION:readonly StudentViewSection[]=["receipts","ledger","financeHistory","household","history"];
/**
 * Student 360's record from the single-purpose reads, in parallel, in the
 * workspace's shape. Only sections `want` names and One's own permissions
 * allow are asked for; the rest are null, as `restrictStudentWorkspace` would
 * have made them. The money band is always read.
 */
export async function getBridgeStudentView(studentId:string,sessionLabel:string,pages:WorkspacePages={},want:readonly StudentViewSection[]=EVERY_SECTION):Promise<BridgeWorkspace> {
  const staff=await assertPermission("students:view");
  const one=oneStudentReadPermissions(staff);
  z.uuid().parse(studentId);
  for(const value of Object.values(pages))if(value!==undefined)z.number().int().positive().parse(value);
  const kinds=permittedFinanceKinds(one);
  const historySections=[...(one.contacts?["contacts"]:[]),...(one.communications?["attempts","reminders","notices"]:[]),...(one.documents?["documents"]:[])];
  const auth=await credentials(staff,sessionLabel);
  const read=<T extends {studentId:string;sessionLabel:string}>(asked:boolean,section:StudentSection,query:Record<string,string|undefined>,schema:z.ZodType<T>)=>
    asked?readStudentSection(auth,studentId,sessionLabel,section,query,schema):Promise.resolve(null);
  const [fees,receipts,ledger,financeHistory,household,history]=await Promise.all([
    readStudentSection(auth,studentId,sessionLabel,"fees",{},bridgeStudentFeesSchema),
    read(one.receipts&&want.includes("receipts"),"receipts",{page:positive(pages.receiptsPage)},bridgeStudentReceiptsSchema),
    read(one.ledger&&want.includes("ledger"),"ledger",{page:positive(pages.ledgerPage)},bridgeStudentLedgerSchema),
    read(one.fees&&kinds.length>0&&want.includes("financeHistory"),"finance-history",{kinds:kinds.join(","),page:positive(pages.financePage)},bridgeStudentFinanceHistorySchema),
    read(one.household&&want.includes("household"),"household",{},bridgeStudentHouseholdSchema),
    read(historySections.length>0&&want.includes("history"),"history",{sections:historySections.join(","),contactsPage:positive(pages.contactsPage),attemptsPage:positive(pages.attemptsPage),
      remindersPage:positive(pages.remindersPage),noticesPage:positive(pages.noticesPage),documentsPage:positive(pages.documentsPage)},bridgeStudentHistorySchema),
  ]);
  let view:BridgeWorkspace;
  try{view=composeStudentView({fees,receipts,ledger,financeHistory,household,history});}
  catch{throw new FeesBridgeError("read_changed","Fees changed while this record was loading. Refresh to load a consistent record.");}
  if(view.student.id!==studentId||view.student.classSessionLabel!==sessionLabel||
    view.installmentBalances?.some(row=>row.studentId!==studentId||(row.sessionLabel!==sessionLabel&&!(row.isCarryForward&&row.targetSessionLabel===sessionLabel)))||
    (view.financialSummary&&(view.financialSummary.studentId!==studentId||view.financialSummary.sessionLabel!==sessionLabel))) {
    throw new FeesBridgeError("invalid_response","The Fees record did not match this student and session.");
  }
  try{return restrictStudentWorkspace(view,one);}catch{throw new FeesBridgeError("invalid_response","The Fees record did not match this account's read permissions.");}
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

/*
 * Screen reads (6 Nov 2026): the data behind One's own Dues & calls and Fee
 * setup, so neither sends staff to the Fees app. Fees checks defaulters:view /
 * fees:view for the mapped Fees user; One checks its own permission first.
 */
const sessionMatches = <T extends { sessionLabel: string }>(result: T, sessionLabel: string, what: string): T => {
  if (result.sessionLabel !== sessionLabel) throw new FeesBridgeError("invalid_response", `The Fees ${what} did not match this session.`);
  return result;
};
const studentIds = (ids: readonly string[], max: number) => z.array(z.uuid()).min(1).max(max).parse([...new Set(ids)]);

/** Fees' Defaulters page and what Dues & calls adds to it, for one session. */
export async function getBridgeDues(sessionLabel: string) {
  const staff = await assertPermission("fees:view");
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),
    path:`/screens/dues?${new URLSearchParams({session:sessionLabel})}`,schema:bridgeDuesSchema}),sessionLabel,"dues");
}

/** One family's installments and contact log (up to eight children). */
export async function getBridgeDuesFamily(sessionLabel: string, ids: readonly string[]) {
  const staff = await assertPermission("fees:view");
  const params = new URLSearchParams({session:sessionLabel});
  for (const id of studentIds(ids.slice(0, 8), 8)) params.append("student", id);
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/screens/dues/family?${params}`,schema:bridgeDuesFamilySchema}),sessionLabel,"family");
}

/** Names and receipts since a date, for judging promises (up to 200 children). */
export async function getBridgeDuesPeople(sessionLabel: string, ids: readonly string[], since: string) {
  const staff = await assertPermission("fees:view");
  const params = new URLSearchParams({session:sessionLabel,since:z.iso.date().parse(since)});
  for (const id of studentIds(ids, 200)) params.append("student", id);
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/screens/dues/people?${params}`,schema:bridgeDuesPeopleSchema}),sessionLabel,"promise families");
}

/** Every confirmed family of the session, or one (`groupId`), for One's Families screen. */
export async function getBridgeFamilies(sessionLabel: string, groupId: string | null = null) {
  const staff = await assertPermission("fees:view");
  const params = new URLSearchParams({session:sessionLabel});
  if (groupId !== null) params.set("group", z.uuid().parse(groupId));
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),path:`/screens/families?${params}`,schema:bridgeFamiliesSchema}),sessionLabel,"families");
}

/** The session's published fee setup, in the shape One's Fee setup draws. */
export async function getBridgeFeeSetup(sessionLabel: string) {
  const staff = await assertPermission("fees:view");
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),
    path:`/screens/fee-setup?${new URLSearchParams({session:sessionLabel})}`,schema:bridgeFeeSetupSchema}),sessionLabel,"fee setup");
}

/** Reports: every installment balance of the session, its classes and who has left (reports:view in Fees). */
export async function getBridgeReportBalances(sessionLabel: string) {
  const staff = await assertPermission("fees:view");
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),
    path:`/screens/reports/balances?${new URLSearchParams({session:sessionLabel})}`,schema:bridgeReportBalancesSchema}),sessionLabel,"report balances");
}

/** Reports: receipts dated in a window (at most 400 days), write-offs excluded, with the session's classes. */
export async function getBridgeReportReceipts(sessionLabel: string, from: string, to: string) {
  const staff = await assertPermission("fees:view");
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),
    path:`/screens/reports/receipts?${new URLSearchParams({session:sessionLabel,from,to})}`,schema:bridgeReportReceiptsSchema}),sessionLabel,"report receipts");
}

/** Reports: one day of the Fees day book (also needs finance:view in Fees). */
export async function getBridgeReportDaybook(sessionLabel: string, date: string) {
  const staff = await assertPermission("fees:view");
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),
    path:`/screens/reports/daybook?${new URLSearchParams({session:sessionLabel,date})}`,schema:bridgeReportDaybookSchema}),sessionLabel,"day book");
}

/**
 * The AI report's Fees half: Fees' whole-session AI context workbook (in Fees
 * the person needs reports:view, students:view and finance:view). One asks
 * for "See fee reports" first; the caller has already asked for reports:ai.
 */
export async function getBridgeAiContextWorkbook(sessionLabel: string) {
  const staff = await assertPermission("fees:reports");
  return bridgeWorkbookRequest({...(await credentials(staff,sessionLabel)),sessionLabel});
}

/** The AI report's photographs, one page at a time (students:view here and in Fees). */
export async function getBridgeAiPhotos(sessionLabel: string, after: string | null) {
  const staff = await assertPermission("students:view");
  const params = new URLSearchParams({session:sessionLabel});
  if (after) params.set("after", z.uuid().parse(after));
  return sessionMatches(await bridgeRequest({...(await credentials(staff,sessionLabel)),
    path:`/screens/reports/ai-photos?${params}`,schema:bridgeAiPhotosSchema,timeoutMs:55_000}),sessionLabel,"photographs");
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
  // A split payment's answer must be a split receipt carrying the same lines, in order.
  const tendersMatch = body.tenders
    ? receipt.paymentMode === "split" && receipt.tenders?.length === body.tenders.length && body.tenders.every((line,i)=>receipt.tenders?.[i]?.mode===line.mode && receipt.tenders?.[i]?.amount===line.amount)
    : receipt.paymentMode !== "split";
  if (receipt.commandId !== body.commandId || receipt.studentId !== body.studentId || receipt.sessionLabel !== body.sessionLabel || receipt.amountReceived !== body.amount || !tendersMatch) {
    throw new FeesBridgeError("invalid_response", "The Fees response did not match this payment. Check its status.", true);
  }
  return receipt;
}

/**
 * Collect's dues card for one child (plan §3.3 card 2): the money band, the
 * newest receipts and — when this reader may see it — the household, read in
 * parallel through the single-purpose student reads. Never cached.
 */
export async function getBridgeCollectDues(studentId:string,sessionLabel:string,receiptsShown=8) {
  const staff=await assertPermission("fees:collect");
  const one=oneStudentReadPermissions(staff);
  z.uuid().parse(studentId);
  const pageSize=z.number().int().min(1).max(20).parse(receiptsShown);
  const auth=await credentials(staff,sessionLabel);
  const [fees,receipts,household]=await Promise.all([
    readStudentSection(auth,studentId,sessionLabel,"fees",{},bridgeStudentFeesSchema),
    one.receipts?readStudentSection(auth,studentId,sessionLabel,"receipts",{pageSize:String(pageSize)},bridgeStudentReceiptsSchema):Promise.resolve(null),
    one.household?readStudentSection(auth,studentId,sessionLabel,"household",{},bridgeStudentHouseholdSchema):Promise.resolve(null),
  ]);
  if(fees.student.id!==studentId||fees.student.classSessionLabel!==sessionLabel)throw new FeesBridgeError("invalid_response","The Fees record did not match this student and session.");
  if((receipts?.receipts?.length??0)>pageSize)throw new FeesBridgeError("invalid_response","The Fees receipts did not match this request.");
  // Fees' own refusals stand: no money band, receipts or household without its permissions.
  if(!fees.permissions.fees)throw new FeesBridgeError("forbidden","Your account cannot view this child's fees.");
  return {
    fees,
    receipts:receipts&&receipts.permissions.receipts&&receipts.permissions.fees?receipts:null,
    household:household&&household.permissions.household?household:null,
  };
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
