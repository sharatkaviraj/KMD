import {describe,expect,it,vi} from "vitest";
import {createServerClient} from "@supabase/ssr";
import {mintAcceptanceSessions,revokeAcceptanceSessions,safeSessionFailureCode} from "../scripts/coexistence/auth-sessions.mjs";
const owner="00000000-0000-4000-8000-000000000001",test="00000000-0000-4000-8000-000000000002";
const ownerProfile="00000000-0000-4000-8000-000000000003",testProfile="00000000-0000-4000-8000-000000000004";
const config={purpose:"approved-coexistence-api-acceptance",owner:{userId:owner,profileId:ownerProfile,role:"admin",isTestAccount:false},test:{userId:test,profileId:testProfile,role:"admin",isTestAccount:true}};
const env={NEXT_PUBLIC_SUPABASE_URL:"https://wtgxcptmucjerhufzjcf.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-key",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-public-key"};
const user=(id:string)=>({id,email:`${id}@synthetic.invalid`,is_anonymous:false,aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-01-01T00:00:00Z"});
const token=(id:string)=>[Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url"),Buffer.from(JSON.stringify({sub:id,role:"authenticated",aud:"authenticated",exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString("base64url"),"synthetic-signature"].join(".");
function setup({wrongProfile=false,unknownUser=false,postMintFailure=""}={}){
  const saved:Record<string,unknown>[]=[];
  let minted=false;
  const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(input instanceof Request?input.url:String(input));const headers=new Headers(init?.headers);
    if(url.pathname==="/rest/v1/staff_profiles"){
      const id=url.searchParams.get("id")?.slice(3);const pin=id===ownerProfile?config.owner:config.test;
      return Response.json({id,user_id:pin.userId,role:pin.role,is_active:!(minted&&postMintFailure==="profile"),is_test_account:wrongProfile?false:pin.isTestAccount});
    }
    if(url.pathname.startsWith("/auth/v1/admin/users/"))return unknownUser?Response.json({msg:"missing"},{status:404}):Response.json(user(url.pathname.split("/").at(-1)!));
    if(url.pathname==="/auth/v1/admin/generate_link"){
      const body=JSON.parse(String(init?.body));expect(Object.keys(body).sort()).toEqual(["email","type"]);expect(body.type).toBe("magiclink");
      const id=body.email.split("@")[0];return Response.json({...user(id),action_link:"https://synthetic.invalid/never-visited",email_otp:"000000",hashed_token:`hashed-${id}`,redirect_to:"https://one.vpps.co.in",verification_type:"magiclink"});
    }
    if(url.pathname==="/auth/v1/verify"){
      const body=JSON.parse(String(init?.body));expect(body.type).toBe("magiclink");const id=body.token_hash.slice(7);
      minted=true;
      return Response.json({access_token:token(id),refresh_token:`synthetic-refresh-${id}`,token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:user(id)});
    }
    if(url.pathname==="/auth/v1/user"){
      const jwt=headers.get("authorization")!.slice(7);const id=JSON.parse(Buffer.from(jwt.split(".")[1],"base64url").toString()).sub;return Response.json(user(postMintFailure==="user"?test:id));
    }
    if(url.pathname==="/auth/v1/logout"){expect(url.searchParams.get("scope")).toBe("local");return new Response(null,{status:204});}
    throw new Error("unexpected_auth_operation");
  });
  return {fetcher,saved,persistSessions:async(value:Record<string,unknown>)=>{saved.push(structuredClone(value));}};
}
describe("one-off acceptance session launcher",()=>{
  it("reports only explicit diagnostic codes, never provider bodies or secrets",()=>{expect(safeSessionFailureCode(new Error("profile_pin_changed"))).toBe("profile_pin_changed");expect(safeSessionFailureCode(new Error("synthetic_secret_from_provider"))).toBe("session_operation_failed");});
  it("defaults to no network",async()=>{const f=setup();expect(await mintAcceptanceSessions(config,{fetcher:f.fetcher})).toHaveProperty("mode","plan");expect(f.fetcher).not.toHaveBeenCalled();});
  it("mints only pinned existing profiles and records cookies privately without sending email or changing passwords",async()=>{
    const f=setup();const result=await mintAcceptanceSessions(config,{execute:true,env,fetcher:f.fetcher,persistSessions:f.persistSessions});
    expect(result).toHaveProperty("projectRef","wtgxcptmucjerhufzjcf");expect(f.saved).toHaveLength(2);
    const accounts=result.accounts as Record<string,{oneCookieHeader:string;oneAccessToken:string}>;
    expect(accounts.owner.oneCookieHeader).toContain("sb-wtgxcptmucjerhufzjcf-auth-token");expect(accounts.test.oneAccessToken).not.toBe(accounts.owner.oneAccessToken);
    const posts=f.fetcher.mock.calls.filter(([,init])=>init?.method==="POST").map(([input])=>new URL(input instanceof Request?input.url:String(input)).pathname);
    expect(posts).toEqual(["/auth/v1/admin/generate_link","/auth/v1/verify","/auth/v1/admin/generate_link","/auth/v1/verify"]);
    const cleanup=await revokeAcceptanceSessions(config,result as Record<string,unknown>,{env,fetcher:f.fetcher});expect(cleanup.revokedAcceptanceSessions).toBe(2);
    expect(f.fetcher.mock.calls.every(([input])=>new URL(input instanceof Request?input.url:String(input)).origin===env.NEXT_PUBLIC_SUPABASE_URL)).toBe(true);
  });
  it.each([{wrongProfile:true},{unknownUser:true}])("refuses identity drift before generating any link",async options=>{
    const f=setup(options);await expect(mintAcceptanceSessions(config,{execute:true,env,fetcher:f.fetcher,persistSessions:f.persistSessions})).rejects.toThrow();expect(f.fetcher.mock.calls.some(([input])=>String(input).includes("generate_link"))).toBe(false);
  });
  it("revokes only the just-created local session when private persistence fails",async()=>{
    const f=setup();await expect(mintAcceptanceSessions(config,{execute:true,env,fetcher:f.fetcher,persistSessions:async()=>{throw new Error("synthetic_disk_failure");}})).rejects.toThrow("session_persist_failed");
    const links=f.fetcher.mock.calls.filter(([input])=>String(input).includes("generate_link"));const logouts=f.fetcher.mock.calls.filter(([input])=>String(input).includes("logout"));
    expect(links).toHaveLength(1);expect(logouts).toHaveLength(1);expect(String(logouts[0][0])).toContain("scope=local");
  });
  it.each([{postMintFailure:"user",code:"session_verification_failed"},{postMintFailure:"profile",code:"profile_pin_changed"},{postMintFailure:"cookie",code:"session_cookie_missing"}])("revokes only the minted session after a failed $postMintFailure check",async({postMintFailure,code})=>{
    const f=setup({postMintFailure});
    await expect(mintAcceptanceSessions(config,{execute:true,env,fetcher:f.fetcher,persistSessions:f.persistSessions,
      ...(postMintFailure==="cookie"?{userFactory:(url,key,options)=>createServerClient(url,key,{...options,cookies:{getAll:()=>[],setAll:()=>{}}})}:{})
    })).rejects.toThrow(code);
    expect(f.saved).toHaveLength(0);
    const links=f.fetcher.mock.calls.filter(([input])=>String(input).includes("generate_link"));const logouts=f.fetcher.mock.calls.filter(([input])=>String(input).includes("logout"));
    expect(links).toHaveLength(1);expect(logouts).toHaveLength(1);expect(String(logouts[0][0])).toContain("scope=local");
    const revoked=new Headers(logouts[0][1]?.headers).get("authorization")!.slice(7);
    expect(JSON.parse(Buffer.from(revoked.split(".")[1],"base64url").toString()).sub).toBe(owner);
  });
  it("refuses the source project and does not offer an arbitrary REAL non-owner login",async()=>{
    const f=setup();await expect(mintAcceptanceSessions(config,{execute:true,env:{...env,NEXT_PUBLIC_SUPABASE_URL:"https://vgqyilgstjvgohrsiwkb.supabase.co"},fetcher:f.fetcher,persistSessions:f.persistSessions})).rejects.toThrow("wrong_auth_project");
    await expect(mintAcceptanceSessions({...config,test:{...config.test,isTestAccount:false}},{fetcher:f.fetcher})).rejects.toThrow("test_identity_required");expect(f.fetcher).not.toHaveBeenCalled();
  });
});
