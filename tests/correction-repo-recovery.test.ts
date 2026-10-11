import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/platform/env", () => ({ FEE_SCHEMA: "public" }));
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], matched: true, failNames: false, filters: [] as number[] }));
function query(table: string) {
  const eq = new Map<string, string>(); const neq = new Map<string, string>(); let start = 0, end = 999, cap = Infinity; let ids: string[] = [];
  const result = () => {
    if (table === "students") {
      state.filters.push(ids.length);
      return state.failNames ? { data: null, error: { message: "names unavailable" } }
        : { data: ids.map(id => ({ id, full_name: `QA ${id}` })), error: null };
    }
    return { data: state.rows.filter(row => [...eq].every(([key, value]) => key.includes(".") || row[key] === value) && [...neq].every(([key, value]) => row[key] !== value)).slice(start, Math.min(end + 1, start + cap)), error: null };
  };
  const api = {
    select() { return api; }, eq(key: string, value: string) { eq.set(key, value); return api; },
    neq(key: string, value: string) { neq.set(key, value); return api; },
    in(_key: string, values: string[]) { ids = values; return api; }, order() { return api; },
    limit(n: number) { cap = n; return api; }, range(from: number, to: number) { start = from; end = to; return api; },
    update() { return api; }, returns() { return Promise.resolve(result()); },
    maybeSingle() { return Promise.resolve({ data: state.matched ? row("request", "pending") : null, error: null }); },
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
  };
  return api;
}
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => ({ from: query }) }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: query, schema: () => ({ from: query }) }) }));
import { getCorrection, listCorrections, rejectCorrection } from "@/modules/attendance/data/corrections-repo";

function row(id: string, status = "approved") { return { id, student_id: id, status, register_id: "r", from_status: "absent", to_status: "present",
  requested_at: "2026-10-10", requested_by: "qa", reason: "QA correction", attendance_registers: { day: "2026-10-10", class_id: "c" } }; }
beforeEach(() => { state.rows = []; state.matched = true; state.failNames = false; state.filters = []; });
describe("correction queue and competing decisions", () => {
  it("keeps an old pending request visible after 220 newer decisions", async () => {
    state.rows = [...Array.from({ length: 220 }, (_, n) => row(`done-${n}`)), row("old-pending", "pending")];
    expect((await listCorrections("QA", new Map())).map(r => r.id)).toContain("old-pending");
  });
  it("reads every waiting request across page and ID-filter boundaries", async () => {
    state.rows = Array.from({ length: 411 }, (_, n) => row(`pending-${n}`, "pending"));
    expect((await listCorrections("QA", new Map())).filter(r => r.status === "pending")).toHaveLength(411);
    expect(Math.max(...state.filters)).toBeLessThanOrEqual(200);
  });
  it("surfaces a failed name lookup rather than displaying an anonymous decision queue", async () => {
    state.rows = [row("pending", "pending")]; state.failNames = true;
    await expect(listCorrections("QA", new Map())).rejects.toThrow(/names unavailable/);
  });
  it("rejects a competing rejection that matched no pending row", async () => {
    state.matched = false;
    await expect(rejectCorrection({ correctionId: "request", decisionNote: null, deciderStaffId: "qa" })).rejects.toThrow(/already|waiting|decided/);
  });
  it("accepts a rejection only when its pending row was changed", async () => {
    await expect(rejectCorrection({ correctionId: "request", decisionNote: null, deciderStaffId: "qa" })).resolves.toBeUndefined();
  });
  it("returns the original requested status for stale-mark checks", async () => {
    // The mock single row represents a pending request returned by PostgREST.
    state.matched = true;
    const result = await getCorrection("request");
    expect(result?.fromStatus).toBe("absent");
  });
});
