import {describe,expect,it,vi} from "vitest";
import {runTestPaymentAcceptance} from "../scripts/coexistence/test-payment-acceptance.mjs";
const student="00000000-0000-4000-8000-000000000001",real="00000000-0000-4000-8000-000000000002",actor="00000000-0000-4000-8000-000000000003",denied="00000000-0000-4000-8000-000000000004",receipt="00000000-0000-4000-8000-000000000005";
const config={purpose:"approved-test-only-payment-acceptance",fixtureApproved:true,sessionLabel:"TEST-2026-27",sourceTestStudentId:student,sourceRealStudentId:real,actorId:actor,deniedActorId:denied,oneAccessToken:"synthetic-test-session-token",deniedActorAccessToken:"synthetic-denied-session-token",oneAuthKey:"synthetic-public-auth-key-12345",bridgeKey:"synthetic-bridge-secret-".repeat(3)};
function fixture({loseFirst=false,wrongFixture=false,prefix="TST",receiptPrefix="TST"}={}){
  let command:Record<string,unknown>|null=null,commits=0,lost=false;
  const writes:Record<string,unknown>[]=[],snapshots:Record<string,unknown>[]=[];
  const persist=vi.fn(async(value:Record<string,unknown>)=>{snapshots.push(structuredClone(value));});
  const result=(id:unknown)=>({status:"completed",commandId:id,studentId:student,sessionLabel:"TEST-2026-27",amountReceived:1,receiptId:receipt,receiptNumber:`${receiptPrefix}-SYN-001`});
  const request=vi.fn(async(raw:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(raw));const token=new Headers(init?.headers).get("authorization");
    const response=(data:unknown,status=200)=>Response.json(status===200?{version:1,data}:{version:1,error:{code:data}},{status,headers:{"Cache-Control":"no-store"}});
    if(url.hostname==="wtgxcptmucjerhufzjcf.supabase.co")return Response.json({id:token?.includes("denied")?denied:actor});
    const route=url.pathname.replace("/api/one/v1","");
    if(token?.includes("denied"))return response("forbidden",403);
    if(route==="/sessions")return response({sessions:[{sessionLabel:"TEST-2026-27"}]});
    if(route.startsWith("/students/"))return response({student:{id:student,sessionLabel:wrongFixture?"2026-27":"TEST-2026-27",status:"active"},standing:{totalPending:100-commits,totalPaid:commits,asOfDate:"2026-11-01"}});
    const input=init?.body?JSON.parse(String(init.body)):{};
    if(route==="/quote"){
      if(input.sessionLabel==="2026-27")return response("forbidden",403);
      if(input.studentId===real)return response("student_session_mismatch",400);
      return response({...input,student:{id:student,sessionLabel:"TEST-2026-27"},quoteHash:"a".repeat(32),receiptPrefix:prefix,acceptedPaymentModes:["cash"]});
    }
    if(route.startsWith("/commands/")){const id=route.split("/").at(-1);return response(command?result(id):{commandId:id,status:"not_found"});}
    if(route==="/payments"){
      if(input.quoteHash==="invalid-quote")return response("invalid_request",400);
      expect(snapshots.at(-1)?.payload).toEqual(input);writes.push(input);
      if(loseFirst&&!lost){lost=true;throw new Error("simulated transport loss before commit");}
      if(!command){command=input;commits++;}else expect(input).toEqual(command);
      return response(result(input.commandId));
    }
    if(route.startsWith("/receipts/"))return response({receiptId:receipt,receiptNumber:`${receiptPrefix}-SYN-001`,student:{id:student,sessionLabel:"TEST-2026-27"},amountReceived:1,reversed:false,printUrl:`https://fees.vpps.co.in/protected/receipts/${receipt}`});
    throw new Error("unexpected_route");
  });
  return {request,persist,writes,snapshots,count:()=>commits};
}
describe("positive TEST API acceptance",()=>{
  it("defaults to no network and refuses broad or unpinned fixtures",async()=>{
    const f=fixture();expect((await runTestPaymentAcceptance(config,{fetcher:f.request})).mode).toBe("plan");expect(f.request).not.toHaveBeenCalled();
    await expect(runTestPaymentAcceptance({...config,sessionLabel:"2026-27"},{fetcher:f.request})).rejects.toThrow("exact_test_identity");
  });
  it("proves fixture/session and persists before Rs1 post, then replays one exact command",async()=>{
    const f=fixture();const result=await runTestPaymentAcceptance(config,{execute:true,persistCheckpoint:f.persist,fetcher:f.request});
    expect(result.ok).toBe(true);expect(f.count()).toBe(1);expect(f.writes).toHaveLength(2);expect(f.writes[1]).toEqual(f.writes[0]);expect(f.snapshots.at(-1)?.stage).toBe("verified");
    for(const [url,init]of f.request.mock.calls.filter(([url])=>String(url).endsWith("/payments"))){expect(String(url)).toContain("fees.vpps.co.in/api/one/v1/");const body=JSON.parse(String(init?.body));expect(body.studentId).toBe(student);expect(body.sessionLabel).toBe("TEST-2026-27");expect(body.amount).toBe(1);}
    expect(JSON.stringify(result)).not.toContain(student);expect(JSON.stringify(result)).not.toContain(config.oneAccessToken);
  });
  it("resumes an unknown outcome with the stored ID and payload after status says absent",async()=>{
    const f=fixture({loseFirst:true});const first=await runTestPaymentAcceptance(config,{execute:true,persistCheckpoint:f.persist,fetcher:f.request});
    expect(first.ok).toBe(false);expect(f.count()).toBe(0);const original=f.writes[0];
    const next=await runTestPaymentAcceptance(config,{execute:true,checkpoint:f.snapshots.at(-1),persistCheckpoint:f.persist,fetcher:f.request});
    expect(next.ok).toBe(true);expect(f.count()).toBe(1);expect(f.writes.every(row=>JSON.stringify(row)===JSON.stringify(original))).toBe(true);
  });
  it("never reaches any payment route if the source reports a real fixture",async()=>{
    const f=fixture({wrongFixture:true});const result=await runTestPaymentAcceptance(config,{execute:true,persistCheckpoint:f.persist,fetcher:f.request});
    expect(result.ok).toBe(false);expect(f.request.mock.calls.some(([url])=>String(url).endsWith("/payments"))).toBe(false);
  });
  it("never dispatches when checkpoint persistence fails",async()=>{
    const f=fixture();await expect(runTestPaymentAcceptance(config,{execute:true,persistCheckpoint:async()=>{throw new Error("disk_failed");},fetcher:f.request})).rejects.toThrow("disk_failed");expect(f.writes).toHaveLength(0);
  });
  it("refuses the real receipt prefix before any positive payment",async()=>{
    const f=fixture({prefix:"SVP"});const result=await runTestPaymentAcceptance(config,{execute:true,persistCheckpoint:f.persist,fetcher:f.request});
    expect(result.ok).toBe(false);expect(result).toHaveProperty("code","test_receipt_prefix_required");expect(f.writes).toHaveLength(0);expect(f.request.mock.calls.some(([url])=>String(url).endsWith("/payments"))).toBe(false);
  });
  it("rechecks the TEST prefix before resuming a stored command",async()=>{
    const first=fixture({loseFirst:true});await runTestPaymentAcceptance(config,{execute:true,persistCheckpoint:first.persist,fetcher:first.request});
    const second=fixture({prefix:"SVP"});const result=await runTestPaymentAcceptance(config,{execute:true,checkpoint:first.snapshots.at(-1),persistCheckpoint:second.persist,fetcher:second.request});
    expect(result.ok).toBe(false);expect(result).toHaveProperty("code","test_receipt_prefix_required");expect(second.request.mock.calls.some(([url])=>String(url).endsWith("/payments"))).toBe(false);
  });
  it("does not accept a returned real receipt or replay it",async()=>{
    const f=fixture({receiptPrefix:"SVP"});const result=await runTestPaymentAcceptance(config,{execute:true,persistCheckpoint:f.persist,fetcher:f.request});
    expect(result.ok).toBe(false);expect(result).toHaveProperty("code","payment_result_mismatch");expect(f.writes).toHaveLength(1);expect(f.snapshots.at(-1)?.payload).toEqual(f.writes[0]);
  });
});
