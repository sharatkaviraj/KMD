import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";

vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({staff:vi.fn(),session:vi.fn(),state:vi.fn()}));
vi.mock("@/platform/auth/current-staff",()=>({getCurrentStaff:mocks.staff}));
vi.mock("@/modules/fees/platform/session-context/cookie",()=>({getViewSessionCookie:mocks.session}));
vi.mock("@/platform/fees-bridge/state",()=>({readFeesBridgeState:mocks.state}));
vi.mock("@/platform/env",()=>({getServerSupabaseUrl:()=>"https://one.supabase.co"}));
import {createProjectionFetch} from "@/platform/fees-bridge/projection-fetch";
import {mintVerifiedActor} from "@/platform/auth/verified-actor";
import {withVerifiedActor} from "@/platform/auth/verified-actor-context";

describe("One public read containment",()=>{
  beforeEach(()=>{
    vi.stubEnv("FEES_BRIDGE_ENABLED","true");vi.stubEnv("VERCEL_ENV","production");
    mocks.staff.mockResolvedValue({isActive:true,role:"admin",isTestAccount:false,confined:false});
    mocks.session.mockResolvedValue("2026-27");
    mocks.state.mockResolvedValue({active_session_label:"2026-27"});
  });
  afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
  it("routes approved identities only after readiness proof",async()=>{
    const underlying=vi.fn().mockResolvedValue(Response.json([{id:"synthetic"}]));
    const response=await createProjectionFetch(underlying,{privileged:true})("https://one.supabase.co/rest/v1/students?select=id&id=in.(class-scoped-id)",{headers:{"Accept-Profile":"public"}});
    expect(response.status).toBe(200);
    expect(mocks.state).toHaveBeenCalled();
    const request=underlying.mock.calls[0][0] as Request;
    const url=new URL(request.url);
    expect(url.pathname).toBe("/rest/v1/fees_bridge_students");
    expect(url.searchParams.get("id")).toBe("in.(class-scoped-id)");
    expect(url.searchParams.get("and")).toContain("session_label.not.ilike.TEST-*");
    expect(request.headers.get("Accept-Profile")).toBe("vppsone");
    expect(request.cache).toBe("no-store");
  });
  it("refuses real raw finance reads, RPCs and writes without falling back",async()=>{
    const underlying=vi.fn();
    const guarded=createProjectionFetch(underlying,{privileged:true});
    for(const [table,method] of [["receipts","GET"],["rpc/current_dues","POST"],["students","PATCH"]]){
      const response=await guarded(`https://one.supabase.co/rest/v1/${table}`,{method,headers:{"Accept-Profile":"public"}});
      expect(response.status).toBe(409);
    }
    expect(underlying).not.toHaveBeenCalled();
  });
  it("refuses unpublished or missing viewer state",async()=>{
    const underlying=vi.fn();
    const guarded=createProjectionFetch(underlying,{privileged:true});
    mocks.state.mockRejectedValueOnce(new Error("not ready"));
    expect((await guarded("https://one.supabase.co/rest/v1/classes",{headers:{"Accept-Profile":"public"}})).status).toBe(409);
    mocks.staff.mockResolvedValueOnce(null);
    expect((await guarded("https://one.supabase.co/rest/v1/students",{headers:{"Accept-Profile":"public"}})).status).toBe(409);
    expect(underlying).not.toHaveBeenCalled();
  });
  it("preserves the isolated TEST engine without reading real projections",async()=>{
    const underlying=vi.fn().mockResolvedValue(Response.json([]));
    mocks.staff.mockResolvedValue({isActive:true,role:"teacher",isTestAccount:true,confined:false});
    mocks.session.mockResolvedValue("TEST-2026-27");
    const url="https://one.supabase.co/rest/v1/students";
    await createProjectionFetch(underlying)(url,{headers:{"Accept-Profile":"public"}});
    expect(underlying.mock.calls[0][0]).toBe(url);
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("leaves own schema/Auth untouched, avoiding authentication recursion",async()=>{
    const underlying=vi.fn().mockResolvedValue(Response.json([]));
    await createProjectionFetch(underlying)("https://one.supabase.co/rest/v1/staff_profiles",{headers:{"Accept-Profile":"vppsone"}});
    expect(underlying).toHaveBeenCalledTimes(1);expect(mocks.staff).not.toHaveBeenCalled();
  });
  it("does not upgrade cookie permissions or send credentials to another origin",async()=>{
    const underlying=vi.fn();
    const init={headers:{"Accept-Profile":"public",Authorization:"Bearer synthetic-one-token"}};
    expect((await createProjectionFetch(underlying)("https://one.supabase.co/rest/v1/students",init)).status).toBe(409);
    expect((await createProjectionFetch(underlying,{privileged:true})("https://evil.test/rest/v1/students",init)).status).toBe(409);
    expect(underlying).not.toHaveBeenCalled();
  });
  it("inside an AI-connection read uses the verified actor and ignores cookies entirely",async()=>{
    // The token holder controls the Cookie header on /api/mcp: a cookie for a
    // TEST account and a TEST session pill must not steer the actor's read.
    mocks.staff.mockResolvedValue({isActive:true,role:"teacher",isTestAccount:true,confined:false});
    mocks.session.mockResolvedValue("TEST-2026-27");
    const actor=mintVerifiedActor({id:"s",userId:"u",email:null,displayName:"Synthetic Admin",shortName:"SA",role:"admin",isTeaching:false,isActive:true,language:"en",preferredStart:null,permissions:[],isTestAccount:false,confined:false});
    const underlying=vi.fn().mockResolvedValue(Response.json([]));
    await withVerifiedActor(actor,()=>createProjectionFetch(underlying,{privileged:true})("https://one.supabase.co/rest/v1/students?id=eq.synthetic",{headers:{"Accept-Profile":"public"}}));
    expect(mocks.staff).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(new URL((underlying.mock.calls[0][0] as Request).url).pathname).toBe("/rest/v1/fees_bridge_students");
  });
  it("does not take a look-alike actor object as verified",async()=>{
    const fake={id:"s",userId:"u",email:null,displayName:"Fake",shortName:"F",role:"admin",isTeaching:false,isActive:true,language:"en",preferredStart:null,permissions:[]};
    expect(()=>withVerifiedActor(fake as never,async()=>null)).toThrow(/verified/);
  });
  it("does not let a real non-admin select local TEST identities by forging a cookie",async()=>{
    mocks.staff.mockResolvedValue({isActive:true,role:"teacher",isTestAccount:false,confined:false});
    mocks.session.mockResolvedValue("TEST-2026-27");
    const underlying=vi.fn().mockResolvedValue(Response.json([]));
    await createProjectionFetch(underlying,{privileged:true})("https://one.supabase.co/rest/v1/students?id=eq.synthetic",{headers:{"Accept-Profile":"public"}});
    expect(new URL((underlying.mock.calls[0][0] as Request).url).pathname).toBe("/rest/v1/fees_bridge_students");
  });
});
