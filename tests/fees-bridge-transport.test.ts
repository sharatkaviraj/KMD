import { readFileSync } from "node:fs";
import { describe,it,expect,vi } from "vitest";
import { z } from "zod";
import { bridgeRequest, bridgeTimingLine } from "@/platform/fees-bridge/transport";

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
  it("permits the six single-purpose student reads (review P02), and only those shapes",async()=>{
    const ok=()=>vi.fn().mockResolvedValue(Response.json({version:1,data:{ok:true}}));
    const id="00000000-0000-4000-8000-000000000001";
    for(const section of ["fees","receipts","ledger","finance-history","household","history","workspace"]){
      const path=`/students/${id}/${section}?session=2026-27&page=1&pageSize=2`;const fetcher=ok();
      expect(await bridgeRequest({...base,path,fetcher})).toEqual({ok:true});
      expect(fetcher.mock.calls[0][0]).toBe(`https://fees.vpps.co.in/api/one/v1${path}`);
      expect(fetcher.mock.calls[0][1]).toMatchObject({method:"GET",cache:"no-store"});
    }
    for(const path of [`/students/${id}/finance_history`,`/students/${id}/notes`,`/students/${id}/fees/extra`,`/students/${id}/receipts/${id}`,
      `/students/${id}/history/../payments`,`/students/fees`,`/students//fees`,`/students/${id}/feesx`,`/students/${id}/Fees/../../sync`]){
      await expect(bridgeRequest({...base,path,fetcher:ok()}),path).rejects.toMatchObject({code:"invalid_route"});
    }
  });
  it("permits the four screen reads (6 Nov 2026), and only those shapes",async()=>{
    const ok=()=>vi.fn().mockResolvedValue(Response.json({version:1,data:{ok:true}}));
    const id="00000000-0000-4000-8000-000000000001";
    for(const path of ["/screens/dues?session=2026-27",`/screens/dues/family?session=2026-27&student=${id}`,
      `/screens/dues/people?session=2026-27&since=2026-10-16&student=${id}`,"/screens/fee-setup?session=2026-27",
      "/screens/reports/balances?session=2026-27","/screens/reports/receipts?session=2026-27&from=2026-11-01&to=2026-11-07",
      "/screens/reports/daybook?session=2026-27&date=2026-11-06","/screens/families?session=2026-27",`/screens/families?session=2026-27&group=${id}`]){
      const fetcher=ok();
      expect(await bridgeRequest({...base,path,fetcher})).toEqual({ok:true});
      expect(fetcher.mock.calls[0][0]).toBe(`https://fees.vpps.co.in/api/one/v1${path}`);
      expect(fetcher.mock.calls[0][1]).toMatchObject({method:"GET",cache:"no-store"});
    }
    for(const path of ["/screens","/screens/reports","/screens/reports/ledger","/screens/reports/../payments","/screens/dues/ledger","/screens/fee-setup/publish","/screens/dues/../payments","/screens/duesx","/screens/families/link","/screens/familiesx"]){
      await expect(bridgeRequest({...base,path,fetcher:ok()}),path).rejects.toMatchObject({code:"invalid_route"});
    }
  });
  it("lets through every route the client asks for (Families was missing for a day)",async()=>{
    const source=readFileSync("src/platform/fees-bridge/client.ts","utf8");
    const id="00000000-0000-4000-8000-000000000001";
    const paths=[...source.matchAll(/path:`(\/[^`]*)`/g)].map((m)=>m[1]
      .replace(/\$\{new URLSearchParams\(\{[^}]*\}\)\}/g,"session=2026-27").replace(/\$\{section\}/g,"fees")
      .replace(/\$\{(?:params|queryParams)\}/g,"session=2026-27").replace(/\$\{[^}]*\}/g,id));
    expect(paths.length).toBeGreaterThan(15);
    for(const path of paths){
      const fetcher=vi.fn().mockResolvedValue(Response.json({version:1,data:{ok:true}}));
      await expect(bridgeRequest({...base,path,fetcher}),path).resolves.toEqual({ok:true});
    }
  });
  it("treats a lost answer to a reversal or refund command as uncertain, never to a read",async()=>{
    const lost=()=>vi.fn().mockRejectedValue(new TypeError("network"));
    for(const path of ["/reversals","/refunds/00000000-0000-4000-8000-000000000001/process"]){
      await expect(bridgeRequest({...base,path,body:{},fetcher:lost()})).rejects.toMatchObject({uncertain:true});
    }
    await expect(bridgeRequest({...base,path:"/summary/today?session=2026-27",fetcher:lost()})).rejects.toMatchObject({uncertain:false});
  });
  it("permits the family preview, link and unlink (Fees 20261108190000), and only those shapes",async()=>{
    const ok=()=>vi.fn().mockResolvedValue(Response.json({version:1,data:{ok:true}}));
    for(const path of ["/families/preview","/families/link","/families/unlink"]){
      const fetcher=ok();
      expect(await bridgeRequest({...base,path,body:{},fetcher})).toEqual({ok:true});
      expect(fetcher.mock.calls[0][0]).toBe(`https://fees.vpps.co.in/api/one/v1${path}`);
      expect(fetcher.mock.calls[0][1]).toMatchObject({method:"POST",cache:"no-store"});
    }
    for(const path of ["/families","/families/merge","/families/link/extra","/families/../payments","/families/linkx"]){
      await expect(bridgeRequest({...base,path,body:{},fetcher:ok()}),path).rejects.toMatchObject({code:"invalid_route"});
    }
    const source=readFileSync("src/platform/fees-bridge/client.ts","utf8");
    for(const path of ["/families/preview","/families/link","/families/unlink"]) expect(source).toContain(`"${path}"`);
  });
  it("treats a lost answer to a link or unlink as uncertain, never to a preview",async()=>{
    const lost=()=>vi.fn().mockRejectedValue(new TypeError("network"));
    for(const path of ["/families/link","/families/unlink"]){
      await expect(bridgeRequest({...base,path,body:{},fetcher:lost()})).rejects.toMatchObject({uncertain:true});
    }
    await expect(bridgeRequest({...base,path:"/families/preview",body:{},fetcher:lost()})).rejects.toMatchObject({uncertain:false});
    const refused=vi.fn().mockResolvedValue(Response.json({version:1,error:{code:"family_changed",message:"Preview again"}},{status:409}));
    await expect(bridgeRequest({...base,path:"/families/link",body:{},fetcher:refused})).rejects.toMatchObject({code:"family_changed",uncertain:false});
  });
  it("does not claim a source quote refusal committed",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({version:1,error:{code:"quote_changed",message:"Review again"}},{status:409}));
    await expect(bridgeRequest({...base,path:"/payments",body:{},fetcher})).rejects.toMatchObject({code:"quote_changed",uncertain:false});
  });
  it("logs a call as its route shape only: no ids, no search words",()=>{
    const line=bridgeTimingLine("GET","/students/00000000-0000-4000-8000-000000000001/workspace?session=2026-27&query=Synthetic%20Child",200,812);
    expect(line).toBe("[fees-bridge] GET /students/:id/workspace 200 812ms");
    expect(bridgeTimingLine("POST","/reversals",0,15000)).toBe("[fees-bridge] POST /reversals no-answer 15000ms");
  });
});
