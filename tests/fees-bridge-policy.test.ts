import { describe,it,expect } from "vitest";
import { assertBridgeSession,feesBridgeEnabled,feesBridgeOrigin,feesBridgeWritesEnabled,feesDestination,usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { projectionUrl } from "@/platform/fees-bridge/projection-policy";

const production={FEES_BRIDGE_ENABLED:"true",VERCEL_ENV:"production"};
describe("one authoritative financial backend",()=>{
  it("requires explicit production and a verified real staff account",()=>{
    expect(usesCanonicalFees({isActive:true},"2026-27",production)).toBe(true);
    for(const viewer of [{isActive:false},{isActive:true,isTestAccount:true},{isActive:true,confined:true}])expect(usesCanonicalFees(viewer,"2026-27",production)).toBe(false);
    expect(usesCanonicalFees({isActive:true},"TEST-2026-27",production)).toBe(false);
    expect(usesCanonicalFees({isActive:true,role:"accountant"},"TEST-2026-27",production)).toBe(true);
    expect(usesCanonicalFees({isActive:true,role:"admin"},"TEST-2026-27",production)).toBe(false);
    expect(usesCanonicalFees({isActive:true},"2026-27",{...production,VERCEL_ENV:"preview"})).toBe(false);
    expect(usesCanonicalFees({isActive:true},"2026-27",{FEES_BRIDGE_ENABLED:"true"})).toBe(false);
  });
  it("keeps the native posting pilot closed unless explicitly enabled",()=>{
    expect(feesBridgeWritesEnabled(production)).toBe(false);
    expect(feesBridgeWritesEnabled({...production,FEES_BRIDGE_WRITES_ENABLED:"true"})).toBe(true);
    expect(feesBridgeWritesEnabled({...production,FEES_BRIDGE_WRITES_ENABLED:"true",VERCEL_ENV:"preview"})).toBe(false);
    expect(()=>feesBridgeEnabled({FEES_BRIDGE_ENABLED:"tru"})).toThrow();
  });
  it("refuses ambiguous or TEST canonical sessions",()=>{
    for(const value of ["","TEST-2026-27","UAT-2026-27","2026","2026-27?a=1"])expect(()=>assertBridgeSession(value)).toThrow();
    expect(()=>assertBridgeSession("2026-27")).not.toThrow();
  });
  it("cannot send bearer tokens to an arbitrary configured host",()=>{
    for(const url of ["http://fees.vpps.co.in","https://fees.vpps.co.in.evil.test","https://fees.vpps.co.in/redirect","https://evil.test"])expect(()=>feesBridgeOrigin({FEES_BRIDGE_ORIGIN:url})).toThrow();
  });
  it("delegates whole unsupported financial paths without forwarding input queries",()=>{
    expect(feesDestination("/fees/receipts/abc","2026-27")).toBe("https://fees.vpps.co.in/protected/receipts/abc?session=2026-27");
    expect(feesDestination("/reports","2026-27")).toBe("https://fees.vpps.co.in/protected/reports?session=2026-27");
    expect(feesDestination("/fees-other")).toBeNull();
    expect(feesDestination("/payments")).toBeNull();
    expect(feesDestination("/students")).toBeNull();
  });
});

describe("identity projection contract",()=>{
  it("keeps aliases and constrained joins for current academic selectors",()=>{
    const input=new URL("https://one.supabase.co/rest/v1/students");
    input.searchParams.set("select","id,class:classes!students_class_id_fkey(session_label),class_ref:classes(id,class_name)");
    input.searchParams.set("id","eq.test-student");
    const output=projectionUrl(input)!;
    expect(output.pathname).toBe("/rest/v1/fees_bridge_students");
    expect(output.searchParams.get("select")).toBe("id,class:fees_bridge_classes!fees_bridge_students_class_id_fkey(session_label),class_ref:fees_bridge_classes!fees_bridge_students_class_id_fkey(id,class_name)");
    expect(output.searchParams.get("id")).toBe("eq.test-student");
    expect(input.pathname).toBe("/rest/v1/students");
  });
  it("never translates ledger tables or an RPC",()=>{
    for(const table of ["receipts","payments","student_fee_ledger","rpc/post_student_payment","v_student_directory"])expect(projectionUrl(new URL(`https://one.supabase.co/rest/v1/${table}`))).toBeNull();
  });
});
