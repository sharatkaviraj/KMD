import {describe,expect,it,vi} from "vitest";
import {runAcceptance} from "../scripts/coexistence/acceptance.mjs";
const id="00000000-0000-4000-8000-000000000001";
const actor="00000000-0000-4000-8000-000000000002";
const denied="00000000-0000-4000-8000-000000000003";
const testActor="00000000-0000-4000-8000-000000000004";
const config={bridgeKey:"synthetic-bridge-secret-".repeat(3),oneAuthKey:"synthetic-public-auth-key-12345",oneAccessToken:"synthetic-existing-session-12345",actorId:actor,sessionLabel:"2026-27",deniedSessionLabel:"TEST-2026-27"};
function fetcher(){
  return vi.fn(async(raw:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(raw));const headers=new Headers(init?.headers);
    const envelope=(data:unknown,status=200)=>Response.json(status===200?{version:1,data}:{version:1,error:{code:data}},{status,headers:{"Cache-Control":"private, no-store"}});
    if(url.origin==="https://wtgxcptmucjerhufzjcf.supabase.co")return Response.json({id:headers.get("authorization")?.includes("unmapped")?denied:headers.get("authorization")?.includes("test-session")?testActor:actor,is_anonymous:false});
    if(url.origin==="https://one.vpps.co.in")return new Response("<h1>Live payment desk</h1>");
    if(!headers.get("X-One-Bridge-Key")||headers.get("authorization")?.includes("invalid.synthetic"))return envelope("unauthorized",401);
    if(headers.get("authorization")?.includes("unmapped"))return envelope("forbidden",403);
    if(url.searchParams.get("session")==="TEST-2026-27"&&!headers.get("authorization")?.includes("test-session"))return envelope("forbidden",403);
    const route=url.pathname.replace("/api/one/v1","");
    if(route==="/sessions")return envelope({sessions:[{sessionLabel:"2026-27"}]});
    if(route==="/classes")return envelope({classes:[{sessionLabel:"2026-27"}]});
    if(route==="/students")return envelope({students:[{id,sessionLabel:"2026-27",name:"Private synthetic name"}],nextCursor:null});
    if(route.startsWith("/students/00000000-0000-0000-0000-000000000000"))return envelope("not_found",404);
    if(route.startsWith("/students/"))return envelope({student:{id,sessionLabel:"2026-27"},standing:{feesPending:100,lateFeePending:0,totalPending:100,totalPaid:0}});
    if(route.startsWith("/commands/"))return envelope({commandId:route.split("/").at(-1),status:"not_found"});
    if(route==="/quote")return envelope({student:{id,sessionLabel:"2026-27"},amount:1,quoteHash:"a".repeat(32)});
    if(route==="/payments")return envelope("commands_disabled",503);
    throw new Error("unexpected_fixture_route");
  });
}
describe("deployed acceptance harness safety",()=>{
  it("defaults to a no-network plan",async()=>{
    const request=fetcher();const result=await runAcceptance(config,{fetcher:request});
    expect(result.mode).toBe("plan");expect(request).not.toHaveBeenCalled();
  });
  it("verifies source reads, auth boundaries and optional authenticated HTML without any command",async()=>{
    const request=fetcher();const result=await runAcceptance({...config,deniedActorAccessToken:"synthetic-unmapped-token",deniedActorId:denied,oneCookieHeader:"synthetic-session=secret"},{execute:true,fetcher:request});
    expect(result.ok).toBe(true);
    const urls=request.mock.calls.map(([url])=>String(url));expect(urls.some(url=>url.endsWith("/payments")&&url.includes("/api/"))).toBe(false);
    for(const [url,options]of request.mock.calls){expect(options?.redirect).toBe("manual");expect(["https://fees.vpps.co.in","https://one.vpps.co.in","https://wtgxcptmucjerhufzjcf.supabase.co"]).toContain(new URL(String(url)).origin);}
    const text=JSON.stringify(result);expect(text).not.toContain(config.oneAccessToken);expect(text).not.toContain(config.bridgeKey);expect(text).not.toContain("Private synthetic name");expect(text).not.toContain("secret");
  });
  it("allows only the absent nil UUID in the explicit TEST disabled-command probe",async()=>{
    const request=fetcher();const result=await runAcceptance({...config,testAccessToken:"synthetic-test-session-token",testActorId:testActor},{execute:true,probeDisabledCommands:true,fetcher:request});
    expect(result.ok).toBe(true);
    const commands=request.mock.calls.filter(([url])=>String(url).endsWith("/api/one/v1/payments"));expect(commands).toHaveLength(1);
    const body=JSON.parse(String(commands[0][1]?.body));expect(body.studentId).toBe("00000000-0000-0000-0000-000000000000");expect(body.sessionLabel).toBe("TEST-2026-27");expect(body.quoteHash).toBe("0".repeat(32));
  });
  it("does not attempt any command without a separate pinned TEST session",async()=>{
    const request=fetcher();const result=await runAcceptance(config,{execute:true,probeDisabledCommands:true,fetcher:request});
    expect(result.ok).toBe(false);expect(request.mock.calls.some(([url])=>String(url).endsWith("/api/one/v1/payments"))).toBe(false);
  });
  it("stops before source reads when the verified One identity differs",async()=>{
    const request=vi.fn(async()=>Response.json({id:denied}));const result=await runAcceptance(config,{execute:true,fetcher:request});
    expect(result.ok).toBe(false);expect(request).toHaveBeenCalledTimes(1);
  });
});
