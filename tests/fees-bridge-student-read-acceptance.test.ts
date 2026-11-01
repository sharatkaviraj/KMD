import { describe, expect, it } from "vitest";
import { runStudentReadAcceptance } from "../scripts/coexistence/student-read-acceptance.mjs";

const actorId = "00000000-0000-4000-8000-000000000001";
const studentId = "00000000-0000-4000-8000-000000000002";
const classId = "00000000-0000-4000-8000-000000000003";
const config = { actorId, bridgeKey: "synthetic_private_bridge_key_of_at_least_32_characters", oneAuthKey: "synthetic_public_auth_key_long_enough", oneAccessToken: "synthetic_existing_access_token_long_enough", oneCookieHeader: "synthetic_cookie=private_value", sessionLabel: "2026-27", deniedSessionLabel: "TEST-2026-27", expectedStudentCount: 1, expectedPhotoCount: 1, samples: [{ studentId, hasPhoto: true, expected: { student: { fullName: "Synthetic Child" } } }] };
const json = (data: unknown, status=200) => Response.json({ version: 1, ...(status === 200 ? { data } : { error: { code: "forbidden" } }) }, { status, headers: { "Cache-Control": "private, no-store" } });
const workspace = { studentId, sessionLabel: "2026-27", student: { id: studentId, fullName: "Synthetic Child", classSessionLabel: "2026-27", hasPhoto: true }, financialSummary: { studentId, sessionLabel: "2026-27" }, installmentBalances: [], receipts: [], ledger: { payments: [] }, pagination: { receipts: { page:1,pageSize:40,totalCount: 0,hasMore:false }, ledgerPayments: { page:1,pageSize:40,totalCount: 0,hasMore:false } } };
type RedirectFixture={location:(url:URL)=>string;status?:number;body?:string;contentType?:string};
const loginLocation=(url:URL)=>`https://one.vpps.co.in/login?${new URLSearchParams({next:`${url.pathname}${url.search}`})}`;
function harness(options: { sourceFailed?: boolean; leak?: boolean; badImage?: boolean; document?:boolean; denialRedirect?:RedirectFixture; authenticatedRedirect?:"one_photo"|"source_photo"|"one_page" } = {}) {
  const requests: { origin: string; method: string; pathname:string; redirect:RequestRedirect|undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push({ origin: url.origin, method: init?.method ?? "GET",pathname:url.pathname,redirect:init?.redirect });
    const headers = new Headers(init?.headers);
    if(url.origin.includes("supabase")) return Response.json({ id: actorId, is_anonymous: false });
    if(url.pathname.includes("/photo")||url.pathname.includes("/documents/")) {
      if(url.origin.includes("one.vpps") && !headers.has("cookie")) return options.denialRedirect?new Response(options.denialRedirect.body??null,{status:options.denialRedirect.status??307,headers:{Location:options.denialRedirect.location(url),...(options.denialRedirect.contentType?{"Content-Type":options.denialRedirect.contentType}:{})}}):new Response(null,{status:401});
      if((options.authenticatedRedirect==="one_photo"&&url.origin.includes("one.vpps"))||(options.authenticatedRedirect==="source_photo"&&url.origin.includes("fees.vpps")))return new Response(null,{status:307,headers:{Location:loginLocation(url)}});
      if(url.pathname.includes("/documents/"))return new Response("%PDF-1.7 synthetic stored document",{headers:{"Content-Type":"application/pdf","Cache-Control":"private, no-store"}});
      return new Response(new Uint8Array([255,216,255,options.badImage && url.origin.includes("one.vpps") ? 2 : 1]), { headers: { "Content-Type":"image/jpeg", "Cache-Control":"private, no-store", Vary:"Cookie" } });
    }
    if(url.origin.includes("fees.vpps")) {
      if(!headers.has("x-one-bridge-key")) return json(null,401);
      if(url.searchParams.get("session") !== "2026-27") return json(null,403);
      if(url.pathname.endsWith("/directory")) return json({ sessionLabel:"2026-27", students:[{id:studentId,classId,admissionNo:"SYNTHETIC",hasPhoto:true}], pagination:{page:1,totalCount:1,hasMore:false},summary:{studentCount:1} });
      return options.sourceFailed ? json(null,503) : json(options.document?{...workspace,history:{documents:{rows:[{sendId:classId,available:true}],pagination:{page:1,pageSize:40,totalCount:1,hasMore:false}}}}:workspace);
    }
    if(options.authenticatedRedirect==="one_page")return new Response(null,{status:307,headers:{Location:loginLocation(url)}});
    return new Response(`Synthetic Child <div data-student-source-section="profile"></div><div data-student-source-section="fees"></div><div data-student-source-section="household"></div> /api/fees-bridge/students/${studentId}/photo${options.leak ? config.bridgeKey : ""}`);
  };
  return { fetcher, requests };
}
describe("read-only deployed student acceptance", () => {
  it("defaults to zero network requests", async () => {
    const { fetcher, requests } = harness();
    const result = await runStudentReadAcceptance(config,{fetcher});
    expect(result.mode).toBe("plan"); expect(requests).toEqual([]); expect(result.mutations).toBe(0);
  });
  it("checks real read parity and anonymous empty-body refusals using only GETs to fixed origins", async () => {
    const { fetcher, requests } = harness();
    const result = await runStudentReadAcceptance(config,{execute:true,fetcher});
    expect(result.ok).toBe(true); expect(requests.length).toBeGreaterThan(10);
    expect(requests.every(r=>r.method==="GET"&&["https://one.vpps.co.in","https://fees.vpps.co.in","https://wtgxcptmucjerhufzjcf.supabase.co"].includes(r.origin))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Synthetic Child"); expect(JSON.stringify(result)).not.toContain(studentId); expect(JSON.stringify(result)).not.toContain(config.bridgeKey);
  });
  it("reports an unavailable workspace without claiming native-page verification", async () => {
    const { fetcher } = harness({sourceFailed:true}); const result = await runStudentReadAcceptance(config,{execute:true,fetcher});
    expect(result.ok).toBe(false); expect(result.checks.some(c=>c.name==="workspace_1"&&c.status==="failed")).toBe(true);
    expect(result.checks.some(c=>c.name==="native_one_profile")).toBe(false);
  });
  it("fails if One photo bytes differ from the source representation", async () => {
    const { fetcher } = harness({badImage:true}); const result = await runStudentReadAcceptance(config,{execute:true,fetcher});
    expect(result.ok).toBe(false); expect(result.checks.some(c=>c.code==="photo_bytes_differ")).toBe(true);
  });
  it("fails closed and never logs an accidentally reflected private token", async () => {
    const { fetcher } = harness({leak:true}); const result = await runStudentReadAcceptance(config,{execute:true,fetcher});
    expect(result.ok).toBe(false); expect(result.checks.some(c=>c.code==="private_token_in_response")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(config.bridgeKey);
  });
  it.each([
    ["empty body",{location:loginLocation}],
    ["exact Vercel text marker",{location:loginLocation,body:"Redirecting...\n",contentType:"text/plain; charset=utf-8"}],
  ] satisfies [string,RedirectFixture][])("accepts the exact anonymous One login redirect with %s without following",async(_label,denialRedirect)=>{
    const {fetcher,requests}=harness({document:true,denialRedirect});
    const result=await runStudentReadAcceptance(config,{execute:true,fetcher});expect(result.ok).toBe(true);
    for(const name of ["anonymous_photo_denied","stored_document_1"])expect(result.checks.find(row=>row.name===name)).toMatchObject({status:"passed",denialMechanism:"login_redirect"});
    expect(requests.every(row=>row.redirect==="manual")).toBe(true);expect(requests.some(row=>row.pathname==="/login")).toBe(false);
    const printed=JSON.stringify(result);for(const privateValue of [studentId,config.bridgeKey,config.oneAccessToken,config.oneCookieHeader,"/login?next="])expect(printed).not.toContain(privateValue);
  });
  it.each([
    ["off origin",{location:()=>"https://untrusted.invalid/login?next=x"}],
    ["wrong next",{location:()=>"https://one.vpps.co.in/login?next=%2Fdashboard"}],
    ["duplicate next",{location:(url:URL)=>`${loginLocation(url)}&next=${encodeURIComponent(`${url.pathname}${url.search}`)}`}],
    ["extra query",{location:(url:URL)=>`${loginLocation(url)}&reason=expired`}],
    ["fragment",{location:(url:URL)=>`${loginLocation(url)}#extra`}],
    ["wrong login path",{location:(url:URL)=>loginLocation(url).replace("/login?","/login/other?")}],
    ["wrong status",{location:loginLocation,status:302}],
    ["nonempty response",{location:loginLocation,body:"unexpected bytes"}],
    ["marker without newline",{location:loginLocation,body:"Redirecting...",contentType:"text/plain"}],
    ["marker with CRLF",{location:loginLocation,body:"Redirecting...\r\n",contentType:"text/plain"}],
    ["marker with leading space",{location:loginLocation,body:" Redirecting...\n",contentType:"text/plain"}],
    ["marker with extra data",{location:loginLocation,body:"Redirecting...\nprivate record",contentType:"text/plain"}],
    ["marker as HTML",{location:loginLocation,body:"Redirecting...\n",contentType:"text/html"}],
    ["marker as image",{location:loginLocation,body:"Redirecting...\n",contentType:"image/jpeg"}],
    ["401 body",{location:loginLocation,status:401,body:"Redirecting...\n",contentType:"text/plain"}],
    ["403 body",{location:loginLocation,status:403,body:"Redirecting...\n",contentType:"text/plain"}],
    ["404 body",{location:loginLocation,status:404,body:"Redirecting...\n",contentType:"text/plain"}],
    ["reflected private token",{location:(url:URL)=>`${loginLocation(url)}&secret=${config.bridgeKey}`}],
  ] satisfies [string,RedirectFixture][])("rejects an anonymous denial redirect with %s",async(_label,denialRedirect)=>{
    const {fetcher,requests}=harness({document:true,denialRedirect});const result=await runStudentReadAcceptance(config,{execute:true,fetcher});expect(result.ok).toBe(false);
    for(const name of ["anonymous_photo_denied","stored_document_1"])expect(result.checks.find(row=>row.name===name)?.status).toBe("failed");
    expect(requests.some(row=>row.pathname==="/login"||row.origin==="https://untrusted.invalid")).toBe(false);expect(JSON.stringify(result)).not.toContain(config.bridgeKey);
  });
  it.each(["one_photo","source_photo","one_page"] as const)("still rejects an authenticated %s redirect",async authenticatedRedirect=>{
    const {fetcher,requests}=harness({authenticatedRedirect});const result=await runStudentReadAcceptance(config,{execute:true,fetcher});expect(result.ok).toBe(false);
    expect(result.checks.some(row=>row.code==="unexpected_redirect")).toBe(true);expect(requests.some(row=>row.pathname==="/login")).toBe(false);
  });
});
