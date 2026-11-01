import { describe,it,expect,vi } from "vitest";
import { z } from "zod";
import { bridgeRequest } from "@/platform/fees-bridge/transport";

const base={token:"synthetic-token",key:"synthetic-key",schema:z.object({ok:z.boolean()})};
describe("canonical Fees transport",()=>{
  it("uses the pinned API, no-store, no redirects and server credentials",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({version:1,data:{ok:true}}));
    expect(await bridgeRequest({...base,path:"/quote",body:{studentId:"synthetic"},fetcher})).toEqual({ok:true});
    const [url,init]=fetcher.mock.calls[0];
    expect(url).toBe("https://fees.vpps.co.in/api/one/v1/quote");
    expect(init).toMatchObject({method:"POST",cache:"no-store",redirect:"error",headers:{Authorization:"Bearer synthetic-token","X-One-Bridge-Key":"synthetic-key"}});
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("does not fetch arbitrary paths or hosts",async()=>{
    const fetcher=vi.fn();
    for(const path of ["//evil.test","/rpc/post_payment","/sync","/students/../../payments"]){await expect(bridgeRequest({...base,path,fetcher})).rejects.toMatchObject({code:"invalid_route"});}
    await expect(bridgeRequest({...base,path:"/sessions",origin:"https://evil.test",fetcher})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("treats a lost or malformed payment response as uncertain",async()=>{
    for(const fetcher of [vi.fn().mockRejectedValue(new TypeError("network")),vi.fn().mockResolvedValue(new Response("bad")),vi.fn().mockResolvedValue(Response.json({version:1,data:{wrong:true}})),vi.fn().mockResolvedValue(Response.json({version:1,error:{code:"source_unavailable",message:"Unavailable"}},{status:503}))]){
      await expect(bridgeRequest({...base,path:"/payments",body:{commandId:"same-id"},fetcher})).rejects.toMatchObject({uncertain:true});
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("does not claim a source quote refusal committed",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({version:1,error:{code:"quote_changed",message:"Review again"}},{status:409}));
    await expect(bridgeRequest({...base,path:"/payments",body:{},fetcher})).rejects.toMatchObject({code:"quote_changed",uncertain:false});
  });
});
