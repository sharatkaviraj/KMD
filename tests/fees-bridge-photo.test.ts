import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgePhotoRequest } from "@/platform/fees-bridge/transport";
const id="00000000-0000-4000-8000-000000000001";
const base={studentId:id,sessionLabel:"2026-27",variant:"thumb" as const,token:"synthetic-token",key:"synthetic-key"};
const jpeg=new Uint8Array([255,216,255,224,0,1,255,217]);
describe("source-owned photo transport",()=>{
  it("returns bounded image bytes through a pinned authenticated no-store GET",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(jpeg,{headers:{"Content-Type":"image/jpeg"}}));
    const result=await bridgePhotoRequest({...base,fetcher});expect(new Uint8Array(result.bytes)).toEqual(jpeg);
    expect(fetcher).toHaveBeenCalledWith(`https://fees.vpps.co.in/api/one/v1/students/${id}/photo?session=2026-27&variant=thumb`,expect.objectContaining({method:"GET",redirect:"error",cache:"no-store",headers:expect.objectContaining({Authorization:"Bearer synthetic-token","X-One-Bridge-Key":"synthetic-key"})}));
  });
  it("refuses arbitrary origins, source paths, TEST sessions and variants before credential forwarding",async()=>{
    const fetcher=vi.fn();
    for(const change of [{origin:"https://untrusted.invalid"},{studentId:"../private"},{sessionLabel:"TEST-2026-27"},{variant:"../full"}])await expect(bridgePhotoRequest({...base,...change,fetcher} as Parameters<typeof bridgePhotoRequest>[0])).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects HTML, mislabeled bytes, oversized streams and redirect responses",async()=>{
    for(const response of [new Response("<html>private</html>",{headers:{"Content-Type":"text/html"}}),new Response("not-an-image",{headers:{"Content-Type":"image/jpeg"}}),new Response(new Uint8Array(512*1024+1),{headers:{"Content-Type":"image/jpeg"}}),new Response(null,{status:307,headers:{Location:"https://untrusted.invalid/"}})]){
      const fetcher=vi.fn().mockResolvedValue(response);await expect(bridgePhotoRequest({...base,fetcher})).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});

vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/platform/fees-bridge/client",()=>({getBridgeStudentPhoto:mocks.read}));
import { GET } from "@/app/api/fees-bridge/students/[studentId]/photo/route";
beforeEach(()=>{mocks.read.mockResolvedValue({bytes:jpeg.buffer,contentType:"image/jpeg"});});
afterEach(()=>vi.resetAllMocks());
describe("One private image proxy",()=>{
  it("requires session and valid identity and never permits a public image cache",async()=>{
    const response=await GET(new Request(`https://one.vpps.co.in/api/fees-bridge/students/${id}/photo?session=2026-27`),{params:Promise.resolve({studentId:id})});
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toContain("private, no-store");expect(response.headers.get("vary")).toBe("Cookie");expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");expect(response.headers.has("location")).toBe(false);
    expect(mocks.read).toHaveBeenCalledWith(id,"2026-27","thumb");
    mocks.read.mockClear();expect((await GET(new Request("https://one.vpps.co.in/api/fees-bridge/students/x/photo?session=TEST-2026-27"),{params:Promise.resolve({studentId:id})})).status).toBe(404);expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not expose auth errors, tokens or source response bodies",async()=>{
    mocks.read.mockRejectedValue(new Error("Not signed in."));const r=await GET(new Request(`https://one.vpps.co.in/api/fees-bridge/students/${id}/photo?session=2026-27`),{params:Promise.resolve({studentId:id})});expect(r.status).toBe(401);expect(await r.text()).toBe("");
  });
});
