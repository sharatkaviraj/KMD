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
  it("permits the Fees office reads and commands, and only those shapes",async()=>{
    const ok=()=>vi.fn().mockResolvedValue(Response.json({version:1,data:{ok:true}}));
    const id="00000000-0000-4000-8000-000000000001";
    for(const path of ["/summary/today?session=2026-27","/requests/pending?session=2026-27","/receipts/lookup?session=2026-27&number=SVP-1",
      "/receipts?session=2026-27&from=2026-11-01&to=2026-11-03&page=1&pageSize=40",`/receipts/${id}/detail?session=2026-27`,
      "/directory/lookup?session=2026-27&query=ab&status=active&pageSize=5"]){
      const fetcher=ok();
      expect(await bridgeRequest({...base,path,fetcher})).toEqual({ok:true});
      expect(fetcher.mock.calls[0][0]).toBe(`https://fees.vpps.co.in/api/one/v1${path}`);
    }
    for(const path of ["/reversals",`/refunds/${id}/decision`,`/refunds/${id}/process`]){
      const fetcher=ok();
      expect(await bridgeRequest({...base,path,body:{commandId:id},fetcher})).toEqual({ok:true});
    }
    for(const path of ["/summary","/requests","/refunds","/refunds/x/approve",`/refunds/${id}`,"/receipts/lookup/../sync","/directory/lookup/all","/directory/export"]){
      await expect(bridgeRequest({...base,path,fetcher:ok()})).rejects.toMatchObject({code:"invalid_route"});
    }
  });
  it("treats a lost answer to a reversal or refund command as uncertain, never to a read",async()=>{
    const lost=()=>vi.fn().mockRejectedValue(new TypeError("network"));
    for(const path of ["/reversals","/refunds/00000000-0000-4000-8000-000000000001/process"]){
      await expect(bridgeRequest({...base,path,body:{},fetcher:lost()})).rejects.toMatchObject({uncertain:true});
    }
    await expect(bridgeRequest({...base,path:"/summary/today?session=2026-27",fetcher:lost()})).rejects.toMatchObject({uncertain:false});
  });
  it("does not claim a source quote refusal committed",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({version:1,error:{code:"quote_changed",message:"Review again"}},{status:409}));
    await expect(bridgeRequest({...base,path:"/payments",body:{},fetcher})).rejects.toMatchObject({code:"quote_changed",uncertain:false});
  });
});
