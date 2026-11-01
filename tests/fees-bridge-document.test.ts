import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {bridgeDocumentRequest} from "@/platform/fees-bridge/transport";
const studentId="00000000-0000-4000-8000-000000000001",sendId="00000000-0000-4000-8000-000000000002";
const base={studentId,sendId,sessionLabel:"2026-27",token:"synthetic-token",key:"synthetic-key"};
const pdf=new TextEncoder().encode("%PDF-1.7\nsynthetic fixture");
describe("existing stored PDF transport",()=>{
  it("uses only scoped, pinned source GET and returns bounded PDF bytes",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(pdf,{headers:{"Content-Type":"application/pdf"}}));
    expect(new Uint8Array(await bridgeDocumentRequest({...base,fetcher}))).toEqual(pdf);
    expect(fetcher).toHaveBeenCalledWith(`https://fees.vpps.co.in/api/one/v1/students/${studentId}/documents/${sendId}?session=2026-27`,expect.objectContaining({method:"GET",redirect:"error",cache:"no-store"}));
  });
  it("refuses wrong origins, identifiers and TEST sessions before forwarding credentials",async()=>{
    const fetcher=vi.fn();for(const change of [{origin:"https://untrusted.invalid"},{studentId:"../other"},{sendId:"https://untrusted.invalid"},{sessionLabel:"TEST-2026-27"}])await expect(bridgeDocumentRequest({...base,...change,fetcher})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects wrong bytes, HTML, redirects and oversized PDF responses without following",async()=>{
    const oversized=new Uint8Array(2*1024*1024+1);oversized.set(pdf);
    for(const response of [new Response("not-pdf",{headers:{"Content-Type":"application/pdf"}}),new Response("private error",{headers:{"Content-Type":"text/html"}}),new Response(null,{status:302,headers:{Location:"https://untrusted.invalid"}}),new Response(oversized,{headers:{"Content-Type":"application/pdf"}})]){
      const fetcher=vi.fn().mockResolvedValue(response);await expect(bridgeDocumentRequest({...base,fetcher})).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/platform/fees-bridge/client",()=>({getBridgeStudentDocument:mocks.read}));
import {GET} from "@/app/api/fees-bridge/students/[studentId]/documents/[sendId]/route";
beforeEach(()=>{mocks.read.mockResolvedValue(pdf.buffer);});afterEach(()=>{vi.resetAllMocks();});
describe("private stored PDF proxy",()=>{
  it("keeps sensitive documents uncached and sandboxed with no source storage URL",async()=>{
    const response=await GET(new Request(`https://one.vpps.co.in/api/fees-bridge/students/${studentId}/documents/${sendId}?session=2026-27`),{params:Promise.resolve({studentId,sendId})});
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toContain("private, no-store");expect(response.headers.get("vary")).toBe("Cookie");expect(response.headers.get("content-security-policy")).toBe("sandbox");expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");expect(response.headers.has("location")).toBe(false);
  });
  it("refuses omitted or TEST session without a source request",async()=>{
    for(const query of ["","?session=TEST-2026-27"])expect((await GET(new Request(`https://one.vpps.co.in/api/fees-bridge/students/${studentId}/documents/${sendId}${query}`),{params:Promise.resolve({studentId,sendId})})).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
