import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({staff:vi.fn(),session:vi.fn(),preview:vi.fn(),request:vi.fn()}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:mock.staff,assertStaff:mock.staff}));
vi.mock("@/platform/supabase/server",()=>({createClient:async()=>({auth:{getSession:mock.session}})}));
vi.mock("@/vx/view-as",()=>({assertNotPreviewing:mock.preview}));
vi.mock("@/platform/fees-bridge/transport",async importOriginal=>({...await importOriginal<typeof import("@/platform/fees-bridge/transport")>(),bridgeRequest:mock.request}));
import {postBridgePayment,getBridgeCommand,quoteBridgePayment} from "@/platform/fees-bridge/client";
const input={studentId:"00000000-0000-4000-8000-000000000001",sessionLabel:"2026-27",paymentDate:"2026-11-01",amount:500,quickDiscountAmount:0,lateFeeWaiverAmount:0,commandId:"00000000-0000-4000-8000-000000000002",quoteHash:"a".repeat(32),paymentMode:"cash" as const,referenceNumber:null,remarks:null};
beforeEach(()=>{
  vi.stubEnv("VERCEL_ENV","production");vi.stubEnv("FEES_BRIDGE_ENABLED","true");vi.stubEnv("FEES_BRIDGE_WRITES_ENABLED","true");vi.stubEnv("FEES_BRIDGE_KEY","synthetic-key");
  mock.staff.mockResolvedValue({userId:"synthetic-user",isActive:true,role:"accountant",isTestAccount:false,confined:false});
  mock.session.mockResolvedValue({data:{session:{access_token:"synthetic-token",user:{id:"synthetic-user"}}},error:null});mock.preview.mockResolvedValue(undefined);
});
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks();});
describe("native bridge authority",()=>{
  it("never forwards credentials for TEST, inactive or preview-deployment identities",async()=>{
    for(const flags of [{isTestAccount:true},{isActive:false},{confined:true}]){
      mock.staff.mockResolvedValueOnce({userId:"synthetic-user",isActive:true,role:"accountant",...flags});
      await expect(postBridgePayment(input)).rejects.toThrow();
    }
    vi.stubEnv("VERCEL_ENV","preview");await expect(postBridgePayment(input)).rejects.toThrow();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it("keeps source writes closed if either One pilot or role preview blocks them",async()=>{
    vi.stubEnv("FEES_BRIDGE_WRITES_ENABLED","false");await expect(postBridgePayment(input)).rejects.toMatchObject({code:"read_only"});
    vi.stubEnv("FEES_BRIDGE_WRITES_ENABLED","true");mock.preview.mockRejectedValue(new Error("preview"));await expect(postBridgePayment(input)).rejects.toThrow("preview");expect(mock.request).not.toHaveBeenCalled();
  });
  it("rejects a session token for another One identity",async()=>{
    mock.session.mockResolvedValue({data:{session:{access_token:"synthetic-token",user:{id:"another-user"}}},error:null});
    await expect(postBridgePayment(input)).rejects.toMatchObject({code:"unauthorized"});expect(mock.request).not.toHaveBeenCalled();
  });
  it("holds an unmatched committed response as uncertain and never invents another command",async()=>{
    mock.request.mockResolvedValue({commandId:"wrong-id",studentId:input.studentId,sessionLabel:input.sessionLabel,amountReceived:input.amount});
    await expect(postBridgePayment(input)).rejects.toMatchObject({code:"invalid_response",uncertain:true});
    expect(mock.request.mock.calls[0][0]).toMatchObject({path:"/payments",token:"synthetic-token",key:"synthetic-key",body:input});
    expect(mock.request).toHaveBeenCalledTimes(1);
    await expect(getBridgeCommand(input.commandId)).rejects.toMatchObject({code:"invalid_response",uncertain:true});
  });
  it("rejects a quote for a different student before the operator can confirm it",async()=>{
    mock.request.mockResolvedValue({student:{id:"wrong",sessionLabel:input.sessionLabel},amount:input.amount,paymentDate:input.paymentDate,quickDiscountAmount:0,lateFeeWaiverAmount:0});
    await expect(quoteBridgePayment({studentId:input.studentId,sessionLabel:input.sessionLabel,paymentDate:input.paymentDate,amount:500,quickDiscountAmount:0,lateFeeWaiverAmount:0})).rejects.toMatchObject({code:"invalid_response"});
  });
});
