import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  permission: vi.fn(), rolls: [] as Record<string, unknown>[], students: [] as Record<string, unknown>[],
  requests: [] as { table: string; columns: string; ids: string[]; eq: Record<string, string>; or: string; from: number; to: number; orders: string[] }[],
  fail: "",
}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/platform/env", () => ({ FEE_SCHEMA: "public" }));

function query(table: string) {
  const request = { table, columns: "", ids: [] as string[], eq: {} as Record<string, string>, or: "", from: 0, to: 999, orders: [] as string[] };
  const api = {
    select(columns: string) { request.columns = columns; return api; },
    eq(key: string, value: string) { request.eq[key] = value; return api; },
    in(_key: string, ids: string[]) { request.ids = ids; return api; },
    or(filter: string) { request.or = filter; return api; },
    order(key: string) { request.orders.push(key); return api; },
    range(from: number, to: number) { request.from = from; request.to = to; return api; },
    returns() {
      state.requests.push(request);
      if (state.fail === table || (state.fail === "detail" && request.columns.includes("guardian_phone"))) {
        return Promise.resolve({ data: null, error: { message: "fixture error" } });
      }
      let data = (table === "enrolments" ? state.rolls : state.students)
        .filter(row => Object.entries(request.eq).every(([key, value]) => row[key] === value));
      if (table === "students") {
        data = data.filter(row => request.ids.includes(row.id as string));
        if (request.or) {
          data = data.filter(row => request.or.split(",").some(part => {
            const [key, op, ...value] = part.split(".");
            const wanted = value.join(".");
            const actual = String(row[key] ?? "");
            return op === "eq" ? actual === wanted : actual.toLowerCase().includes(wanted.replace(/%/g, "").toLowerCase());
          }));
        }
        // Deliberately opposite order: repo must restore global page ID order.
        data = data.slice().reverse();
      }
      return Promise.resolve({ data: data.slice(request.from, request.to + 1), error: null });
    },
  };
  return api;
}
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => ({ from: query }) }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ schema: () => ({ from: query }) }) }));
import { searchStudents } from "@/modules/students/data/directory-repo";

function fixture(size: number) {
  for (let n = 0; n < size; n++) {
    const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    state.rolls.push({ student_id: id, session_label: "TEST", status: "enrolled", class_id: n % 2 ? "c1" : "c2", roll_no: String(n + 1) });
    state.students.push({ id, full_name: `Child ${String(size - n).padStart(4, "0")}`, admission_no: String(n), father_name: n % 2 ? "Sharma" : "Other", guardian_phone: "9999999999", primary_phone: "8888888888" });
  }
  state.students.push({ id: "outside-scope", full_name: "A first", admission_no: "0" });
}
beforeEach(() => { state.permission.mockReset(); state.rolls = []; state.students = []; state.requests = []; state.fail = ""; });
const defaults = { text: "", classId: null, page: 1 };
describe("bounded student directory reads", () => {
  it.each([511, 1105])("keeps all %s scoped rows and globally slices page 2", async size => {
    fixture(size);
    const result = await searchStudents({ ...defaults, page: 2 }, "TEST");
    expect(result.total).toBe(size);
    expect(result.rows).toHaveLength(50);
    expect(result.rows[0].fullName).toBe("Child 0051");
    expect(result.rows.at(-1)?.fullName).toBe("Child 0100");
    expect(result.rows[0].rollNo).toBe(String(size - 50));
    expect(state.requests.filter(r => r.table === "students").every(r => r.ids.length <= 100)).toBe(true);
    expect(state.requests.at(-1)?.ids).toHaveLength(50);
    expect(state.requests.filter(r => r.table === "enrolments").every(r => r.to - r.from === 199)).toBe(true);
    expect(state.requests.filter(r => r.table === "enrolments").every(r => r.orders.join(",") === "student_id")).toBe(true);
    expect(state.permission).toHaveBeenCalledWith("students:view");
  });
  it("retains historical session/class/enrolled scope", async () => {
    fixture(511);
    state.rolls.push({ student_id: "outside-scope", session_label: "OTHER", status: "enrolled", class_id: "c1" });
    state.rolls[1].status = "left";
    const result = await searchStudents({ ...defaults, classId: "c1" }, "TEST");
    expect(result.total).toBe(254);
    expect(result.rows.every(row => row.classId === "c1")).toBe(true);
    expect(state.requests.filter(r => r.table === "enrolments").every(r => r.eq.session_label === "TEST" && r.eq.status === "enrolled" && r.eq.class_id === "c1")).toBe(true);
  });
  it.each([["12", 1], ["8888888888", 511], ["Sharma", 255], ["Child 0001", 1], ["missing", 0]] as const)("keeps %s search/count and clamps page", async (text, count) => {
    fixture(511);
    const result = await searchStudents({ ...defaults, text, page: 999 }, "TEST");
    expect(result.total).toBe(count);
    expect(result.window.page).toBe(Math.max(1, Math.ceil(count / 50)));
    expect(result.rows.length).toBe(count ? count % 50 || 50 : 0);
  });
  it("keeps duplicate names stable across chunk boundaries", async () => {
    fixture(220);
    for (const row of state.students) row.full_name = "Same child";
    const result = await searchStudents({ ...defaults, page: 3 }, "TEST");
    expect(result.rows.map(row => row.studentId)).toEqual(state.students.slice(100, 150).map(row => row.id));
  });
  it("never creates fee reads for empty scope", async () => {
    expect((await searchStudents(defaults, "TEST")).total).toBe(0);
    expect(state.requests.every(r => r.table === "enrolments")).toBe(true);
  });
  it("denies before any client query", async () => {
    state.permission.mockRejectedValue(new Error("denied"));
    await expect(searchStudents(defaults, "TEST")).rejects.toThrow("denied");
    expect(state.requests).toHaveLength(0);
  });
  it.each(["enrolments", "students", "detail"])("surfaces %s failure instead of partial results", async table => {
    fixture(511); state.fail = table;
    await expect(searchStudents(defaults, "TEST")).rejects.toThrow("fixture error");
  });
});
