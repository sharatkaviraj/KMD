import { describe, expect, it } from "vitest";
import { runStudentReadAcceptance } from "../scripts/coexistence/student-read-acceptance.mjs";

const actorId = "00000000-0000-4000-8000-000000000001";
const studentId = "00000000-0000-4000-8000-000000000002";
const classId = "00000000-0000-4000-8000-000000000003";
const config = { actorId, bridgeKey: "synthetic_private_bridge_key_of_at_least_32_characters", oneAuthKey: "synthetic_public_auth_key_long_enough", oneAccessToken: "synthetic_existing_access_token_long_enough", oneCookieHeader: "synthetic_cookie=private_value", sessionLabel: "2026-27", deniedSessionLabel: "TEST-2026-27", expectedStudentCount: 1, expectedPhotoCount: 1, samples: [{ studentId, hasPhoto: true, expected: { student: { fullName: "Synthetic Child" } } }] };
const json = (data: unknown, status=200) => Response.json({ version: 1, ...(status === 200 ? { data } : { error: { code: "forbidden" } }) }, { status, headers: { "Cache-Control": "private, no-store" } });
const workspace = { studentId, sessionLabel: "2026-27", student: { id: studentId, fullName: "Synthetic Child", classSessionLabel: "2026-27", hasPhoto: true }, financialSummary: { studentId, sessionLabel: "2026-27" }, installmentBalances: [], receipts: [], ledger: { payments: [] }, pagination: { receipts: { page:1,pageSize:40,totalCount: 0,hasMore:false }, ledgerPayments: { page:1,pageSize:40,totalCount: 0,hasMore:false } } };
function harness(options: { sourceFailed?: boolean; leak?: boolean; badImage?: boolean } = {}) {
  const requests: { origin: string; method: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push({ origin: url.origin, method: init?.method ?? "GET" });
    const headers = new Headers(init?.headers);
    if(url.origin.includes("supabase")) return Response.json({ id: actorId, is_anonymous: false });
    if(url.pathname.includes("/photo")) {
      if(url.origin.includes("one.vpps") && !headers.has("cookie")) return new Response(null,{status:401});
      return new Response(new Uint8Array([255,216,255,options.badImage && url.origin.includes("one.vpps") ? 2 : 1]), { headers: { "Content-Type":"image/jpeg", "Cache-Control":"private, no-store", Vary:"Cookie" } });
    }
    if(url.origin.includes("fees.vpps")) {
      if(!headers.has("x-one-bridge-key")) return json(null,401);
      if(url.searchParams.get("session") !== "2026-27") return json(null,403);
      if(url.pathname.endsWith("/directory")) return json({ sessionLabel:"2026-27", students:[{id:studentId,classId,admissionNo:"SYNTHETIC",hasPhoto:true}], pagination:{page:1,totalCount:1,hasMore:false},summary:{studentCount:1} });
      return options.sourceFailed ? json(null,503) : json(workspace);
    }
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
});
