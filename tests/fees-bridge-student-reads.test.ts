import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {CurrentStaff} from "@/platform/auth/current-staff";
import {bridgeWorkspaceSchema} from "@/platform/fees-bridge/student-read-contracts";
import {oneStudentReadPermissions,permittedFinanceKinds,restrictStudentWorkspace} from "@/platform/fees-bridge/read-permissions";
import {feesFromBridge} from "@/modules/students-fees/vx/canonical-students";
import {bridgeWorkspaceFixture,sourceStudentId,sourceReceiptId} from "./fixtures/bridge-student-workspace";

const staff=(role:CurrentStaff["role"],permissions=["students:view","fees:view"]):CurrentStaff=>({id:sourceStudentId,userId:sourceStudentId,role,permissions,isActive:true,isTestAccount:false,confined:false,email:"synthetic@example.invalid",displayName:"Synthetic Staff",shortName:"Synthetic",isTeaching:false,language:"en",preferredStart:null});
describe("One and Fees read permission intersection",()=>{
  it("does not let a broad source admin mapping give an Office viewer ledger, refunds or PDF access",()=>{
    const one=oneStudentReadPermissions(staff("office"));
    expect(one).toEqual({fees:true,receipts:true,ledger:false,finance:false,household:true,contacts:true,communications:true,documents:false});
    expect(permittedFinanceKinds(one)).toEqual(["receipt_adjustment","receipt_finance_adjustment","waiver"]);
    const read=restrictStudentWorkspace(bridgeWorkspaceFixture(),one);
    expect(read.financialSummary?.totalPaid).toBe(1000);expect(read.receipts).toHaveLength(1);expect(read.financeHistory).toHaveLength(1);
    expect(read.ledger).toBeNull();expect(read.pagination.ledgerPayments).toBeNull();expect(read.pagination.ledgerAdjustments).toBeNull();expect(read.history.documents).toBeNull();
    expect(read.history.contacts?.rows).toHaveLength(1);
  });
  it("rejects forbidden history rather than exposing hidden-row counts or incomplete pagination",()=>{
    const read=bridgeWorkspaceFixture();read.financeHistory!.push({...read.financeHistory![0],kind:"refund",reason:"Private refund"});read.pagination.financeHistory!.totalCount=70;
    expect(()=>restrictStudentWorkspace(read,oneStudentReadPermissions(staff("office")))).toThrow("unpermitted_finance_history");
  });
  it("removes financial data and its metadata when One revoked core fees access",()=>{
    const read=bridgeWorkspaceFixture();read.financeHistory=[];read.pagination.financeHistory={page:1,pageSize:40,totalCount:0,hasMore:false};
    const result=restrictStudentWorkspace(read,oneStudentReadPermissions(staff("office",["students:view"])));
    expect(Object.values(result.permissions).every(value=>value===false)).toBe(true);
    for(const field of ["feeProfile","financialSummary","financialSnapshot","installmentBalances","ledger","receipts","family","household","repaymentPlan","repaymentPlanHistory","financeHistory"] as const)expect(result[field]).toBeNull();
    expect(Object.values(result.pagination)).toEqual([null,null,null,null]);expect(Object.values(result.history).every(value=>value===null)).toBe(true);
    expect(result.student.fullName).toBe("Synthetic Student");expect(result.documents.receiptDetails).toBe(false);
  });
  it("honors stricter source flags even for a One admin",()=>{
    const read=bridgeWorkspaceFixture();read.permissions.ledger=false;read.permissions.documents=false;read.permissions.contacts=false;
    const result=restrictStudentWorkspace(read,oneStudentReadPermissions(staff("admin")));
    expect(result.ledger).toBeNull();expect(result.history.documents).toBeNull();expect(result.history.contacts).toBeNull();expect(result.history.collectionFlags).toBeNull();expect(result.history.recovery).toBeNull();
  });
  it("requires effective source receipt and communication access for dependent sections",()=>{
    const read=bridgeWorkspaceFixture();read.permissions.receipts=false;
    const result=restrictStudentWorkspace(read,oneStudentReadPermissions(staff("admin")));
    expect(result.permissions.documents).toBe(false);expect(result.permissions.ledger).toBe(false);expect(result.history.documents).toBeNull();expect(result.ledger).toBeNull();
    read.permissions.receipts=true;read.permissions.communications=false;
    expect(restrictStudentWorkspace(read,oneStudentReadPermissions(staff("admin"))).history.documents).toBeNull();
  });
  it("validates actual displayed fields, strips storage paths, and keeps source money authoritative",()=>{
    const value=bridgeWorkspaceFixture();const result=bridgeWorkspaceSchema.parse({...value,student:{...value.student,photoPath:"private/never-emit.jpg"}});
    expect(result.student).not.toHaveProperty("photoPath");expect(result.student.apaarId).toBe("SYN-APAAR");
    const fees=feesFromBridge(result);expect(fees?.summary.paidThisSession).toBe(1000);expect(fees?.installments[0].baseCharge).toBe(9000);
    expect(()=>bridgeWorkspaceSchema.parse({...value,student:{...value.student,apaarId:17}})).toThrow();
  });
});

vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({staff:vi.fn(),session:vi.fn(),request:vi.fn(),document:vi.fn()}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:mocks.staff,assertStaff:mocks.staff}));
vi.mock("@/platform/supabase/server",()=>({createClient:async()=>({auth:{getSession:mocks.session}})}));
vi.mock("@/vx/view-as",()=>({assertNotPreviewing:vi.fn()}));
vi.mock("@/platform/fees-bridge/transport",async original=>({...await original<typeof import("@/platform/fees-bridge/transport")>(),bridgeRequest:mocks.request,bridgeDocumentRequest:mocks.document}));
import {getBridgeWorkspace,getBridgeStudentDocument,getBridgeReceiptDetail} from "@/platform/fees-bridge/client";
beforeEach(()=>{
  vi.stubEnv("VERCEL_ENV","production");vi.stubEnv("FEES_BRIDGE_ENABLED","true");vi.stubEnv("FEES_BRIDGE_KEY","synthetic-key");
  mocks.staff.mockResolvedValue(staff("office"));mocks.session.mockResolvedValue({data:{session:{access_token:"synthetic-token",user:{id:sourceStudentId}}},error:null});mocks.request.mockResolvedValue(bridgeWorkspaceFixture());
});
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks();});
describe("authenticated student read client",()=>{
  it("narrows financial kinds before server paging and strips denied source sections",async()=>{
    const result=await getBridgeWorkspace(sourceStudentId,"2026-27",{financePage:2,documentsPage:3});
    const params=new URL(`https://example.invalid${mocks.request.mock.calls[0][0].path}`).searchParams;
    expect(params.get("financeKinds")).toBe("receipt_adjustment,receipt_finance_adjustment,waiver");expect(params.get("financePage")).toBe("2");expect(params.get("documentsPage")).toBe("3");
    expect(result.permissions.finance).toBe(false);expect(result.history.documents).toBeNull();
  });
  it("denies Office PDF reads and revoked receipt access before obtaining tokens or sending a request",async()=>{
    await expect(getBridgeStudentDocument(sourceStudentId,sourceReceiptId,"2026-27")).rejects.toMatchObject({code:"forbidden"});
    mocks.staff.mockResolvedValue(staff("office",["students:view"]));await expect(getBridgeReceiptDetail(sourceReceiptId,"2026-27")).rejects.toMatchObject({code:"forbidden"});
    expect(mocks.session).not.toHaveBeenCalled();expect(mocks.document).not.toHaveBeenCalled();expect(mocks.request).not.toHaveBeenCalled();
  });
  it("requests no history kinds for a profile-only viewer and rejects wrong student or session data",async()=>{
    mocks.staff.mockResolvedValue(staff("teacher",["students:view"]));
    const source=bridgeWorkspaceFixture();source.financeHistory=[];mocks.request.mockResolvedValue(source);
    expect((await getBridgeWorkspace(sourceStudentId,"2026-27")).financialSummary).toBeNull();
    const params=new URL(`https://example.invalid${mocks.request.mock.calls[0][0].path}`).searchParams;expect(params.has("financeKinds")).toBe(true);expect(params.get("financeKinds")).toBe("");
    mocks.request.mockResolvedValue({...source,student:{...source.student,classSessionLabel:"TEST-2026-27"}});
    await expect(getBridgeWorkspace(sourceStudentId,"2026-27")).rejects.toMatchObject({code:"invalid_response"});
  });
});
