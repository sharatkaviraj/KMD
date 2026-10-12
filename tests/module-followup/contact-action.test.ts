import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactCommand } from "@/vx/screens/family-contact/domain";
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ allowed: true, tables: [] as string[], rows: new Map<string, Row>(), inserted: [] as Row[], readError: false, loseInsert: false, race: false, raceDate: null as string | null, insertMode: "normal", today: "2026-10-11", permission: vi.fn(), preview: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({})); vi.mock("next/cache", () => ({ revalidatePath: state.refresh }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission })); vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: state.preview }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "OPS-FOLLOWUP-2026-27" })); vi.mock("@/vx/format", () => ({ schoolToday: () => state.today }));
vi.mock("@/vx/screens/family-contact/data", () => ({ familyContactAccess: async () => state.allowed }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from(table: string) {
  state.tables.push(table);
  if (table === "enrolments") { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { class_id: "OPS-class" }, error: null }) }; return query; }
  if (table !== "student_followups") throw Error(`Unexpected table ${table}`);
  let id = ""; const query = { select: () => query, eq: (_column: string, value: string) => { id = value; return query; }, maybeSingle: async () => ({ data: state.rows.get(id) ?? null, error: state.readError ? { code: "NETWORK" } : null }),
    insert: async (row: Row) => {
      state.inserted.push(structuredClone(row)); const key = row.id as string;
      // Independent atomic PK oracle, including a winner arriving after SELECT.
      if (state.race) { state.race = false; state.rows.set(key, { ...structuredClone(row), ...(state.raceDate ? { agreed_on: state.raceDate } : {}) }); return { error: { code: "23505" } }; }
      if (state.rows.has(key)) return { error: { code: "23505" } };
      state.rows.set(key, structuredClone(row)); if (state.insertMode === "missing") state.rows.delete(key); if (state.insertMode === "read_error") state.readError = true; if (state.loseInsert) throw Error("Committed insert response lost"); return { error: null };
    } }; return query;
} }) }));
import { checkFamilyContactAction, logFamilyContactAction } from "@/vx/screens/family-contact/actions";
const command: ContactCommand = { owner: "00000000-0000-4000-8000-000000000002", sessionLabel: "OPS-FOLLOWUP-2026-27", studentId: "00000000-0000-4000-8000-000000000001", attemptId: "00000000-0000-4000-8000-000000000003", outcome: "spoke", note: "OPS completed conversation", agreedOn: null, noteId: null };
describe("durable contact actual action independent PK boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); state.allowed = true; state.tables = []; state.rows.clear(); state.inserted = []; state.readError = false; state.loseInsert = false; state.race = false; state.raceDate = null; state.insertMode = "normal"; state.today = "2026-10-11"; state.permission.mockResolvedValue({ id: command.owner }); state.preview.mockResolvedValue(undefined); });
  it("denied class access causes zero inserts and revalidation", async () => { state.allowed = false; expect(await logFamilyContactAction(command)).toMatchObject({ ok: false, status: "refused" }); expect(state.tables).toEqual(["enrolments"]); expect(state.inserted).toEqual([]); expect(state.refresh).not.toHaveBeenCalled(); });
  it("missing legacy identity or mismatched current owner/session fails closed", async () => {
    for (const input of [{ studentId: command.studentId, outcome: "spoke" }, { ...command, owner: command.studentId }, { ...command, sessionLabel: "OTHER" }]) expect(await logFamilyContactAction(input as ContactCommand)).toMatchObject({ ok: false, status: "refused" });
    expect(state.tables).toEqual([]); expect(state.inserted).toEqual([]);
  });
  it("invalid calendar dates stop before any DB read or append", async () => { for (const agreedOn of ["2026-11-31", "2027-02-29"]) expect(await logFamilyContactAction({ ...command, outcome: "follow_up_agreed", agreedOn })).toMatchObject({ ok: false, status: "refused" }); expect(state.tables).toEqual([]); });
  it("exact replay appends once, while fresh IDs permit separate identical contacts", async () => { expect(await logFamilyContactAction(command)).toMatchObject({ ok: true, attemptId: command.attemptId }); await logFamilyContactAction(command); expect(state.rows.size).toBe(1); expect(state.inserted).toHaveLength(1); await logFamilyContactAction({ ...command, attemptId: "00000000-0000-4000-8000-000000000004" }); expect(state.rows.size).toBe(2); expect(new Set(state.tables)).toEqual(new Set(["enrolments", "student_followups"])); });
  it.each(["note", "outcome", "noteId", "studentId"] as const)("same ID with changed %s is refused", async field => { await logFamilyContactAction(command); const changed = { ...command, [field]: field === "outcome" ? "attempted" : field === "note" ? "OTHER" : "00000000-0000-4000-8000-000000000005" }; expect(await logFamilyContactAction(changed)).toMatchObject({ ok: false, status: "refused" }); expect(state.rows.size).toBe(1); expect(state.inserted).toHaveLength(1); });
  it("existing row with changed persisted owner/session/kind never returns another entry", async () => { await logFamilyContactAction(command); for (const field of ["created_by", "session_label", "kind"]) { const original = state.rows.get(command.attemptId)!; const before = original[field]; original[field] = "OTHER"; expect(await checkFamilyContactAction(command)).toMatchObject({ ok: false, status: "refused" }); original[field] = before; } });
  it("23505 concurrent winner is accepted only through exact row readback", async () => { state.race = true; expect(await logFamilyContactAction(command)).toMatchObject({ ok: true, status: "saved" }); expect(state.rows.size).toBe(1); });
  it("concurrent actual-action calls see independent PK conflict and one persisted row", async () => { const results = await Promise.all([logFamilyContactAction(command), logFamilyContactAction(command)]); expect(results.every(result => result.ok)).toBe(true); expect(state.inserted).toHaveLength(2); expect(state.rows.size).toBe(1); expect(state.rows.get(command.attemptId)).toMatchObject({ id: command.attemptId, created_by: command.owner, student_id: command.studentId }); });
  it("permission and preview are rechecked even for an already committed original", async () => { await logFamilyContactAction(command); state.allowed = false; expect(await checkFamilyContactAction(command)).toMatchObject({ status: "refused" }); state.allowed = true; state.preview.mockRejectedValue(Error("Preview writes refused")); await expect(logFamilyContactAction(command)).rejects.toThrow("Preview writes refused"); expect(state.rows.size).toBe(1); expect(state.inserted).toHaveLength(1); });
  it("lost committed insert response is uncertain, check confirms same ID without another insert", async () => { state.loseInsert = true; expect(await logFamilyContactAction(command)).toMatchObject({ ok: false, status: "uncertain" }); expect(state.rows.size).toBe(1); expect(await checkFamilyContactAction(command)).toMatchObject({ ok: true, attemptId: command.attemptId }); expect(state.inserted).toHaveLength(1); });
  it.each(["missing", "read_error"])("INSERT success with %s readback never claims saved", async mode => { state.insertMode = mode; expect(await logFamilyContactAction(command)).toMatchObject({ ok: false, status: "uncertain" }); expect(state.inserted).toHaveLength(1); expect(state.refresh).not.toHaveBeenCalled(); expect(state.rows.size).toBe(mode === "missing" ? 0 : 1); });
  it("read failures are uncertain, missing read retains retry identity, neither inserts", async () => { expect(await checkFamilyContactAction(command)).toMatchObject({ status: "not_found" }); state.readError = true; expect(await checkFamilyContactAction(command)).toMatchObject({ status: "uncertain" }); expect(await logFamilyContactAction(command)).toMatchObject({ status: "uncertain" }); expect(state.inserted).toEqual([]); });
  it("committed agreed-date replay works after date becomes past; new past attempt requests correction", async () => { const original = { ...command, outcome: "follow_up_agreed" as const, agreedOn: "2026-10-12" }; await logFamilyContactAction(original); state.today = "2026-10-13"; expect(await logFamilyContactAction(original)).toMatchObject({ ok: true }); expect(await checkFamilyContactAction(original)).toMatchObject({ ok: true }); expect(await logFamilyContactAction({ ...original, attemptId: "00000000-0000-4000-8000-000000000009" })).toMatchObject({ status: "expired" }); expect(state.rows.size).toBe(1); });
  it("an absent expired agreed-date attempt offers correction without abandoning its ID", async () => {
    state.today = "2026-10-12";
    const original = { ...command, outcome: "follow_up_agreed" as const, agreedOn: "2026-10-11" };
    expect(await logFamilyContactAction(original)).toMatchObject({ ok: false, status: "expired", today: "2026-10-12" });
    expect(state.inserted).toEqual([]);
  });
  it("date correction inserts once with the original UUID, keeping other fields unchanged", async () => {
    const original = { ...command, outcome: "follow_up_agreed" as const, agreedOn: "2026-10-11" };
    state.today = "2026-10-12";
    const corrected = { ...original, dateCorrections: ["2026-10-12"] };
    expect(await logFamilyContactAction(corrected)).toMatchObject({ ok: true, attemptId: original.attemptId, agreedOn: "2026-10-12" });
    expect(await checkFamilyContactAction(corrected)).toMatchObject({ ok: true, agreedOn: "2026-10-12" });
    expect(state.inserted).toEqual([{ id: original.attemptId, created_by: original.owner, student_id: original.studentId, session_label: original.sessionLabel, kind: "contact", outcome: original.outcome, note: original.note, agreed_on: "2026-10-12", note_id: null }]);
    expect(original.agreedOn).toBe("2026-10-11"); expect(state.rows.size).toBe(1);
  });
  it.each(["2026-10-11", "2026-10-12"])("a concurrent original/prior-correction winner %s is reported truthfully", async winner => {
    state.today = "2026-10-13"; state.race = true; state.raceDate = winner;
    const request = { ...command, outcome: "follow_up_agreed" as const, agreedOn: "2026-10-11", dateCorrections: ["2026-10-12", "2026-10-13"] };
    expect(await logFamilyContactAction(request)).toMatchObject({ ok: true, agreedOn: winner });
    expect(await checkFamilyContactAction(request)).toMatchObject({ ok: true, agreedOn: winner });
    expect(state.rows.size).toBe(1); expect(state.inserted).toHaveLength(1);
  });
  it("existing original wins without updating its history or inserting a corrected row", async () => {
    const original = { ...command, outcome: "follow_up_agreed" as const, agreedOn: "2026-10-11" };
    await logFamilyContactAction(original); state.today = "2026-10-12";
    expect(await logFamilyContactAction({ ...original, dateCorrections: ["2026-10-12"] })).toMatchObject({ ok: true, agreedOn: original.agreedOn });
    expect(state.inserted).toHaveLength(1); expect(state.rows.size).toBe(1);
  });
  it("malformed, duplicate, unrelated and oversized date correction requests fail closed", async () => {
    const original = { ...command, outcome: "follow_up_agreed" as const, agreedOn: "2026-10-11" };
    for (const dateCorrections of [["2026-11-31"], ["2026-10-11"], ["2026-10-12", "2026-10-12"], Array.from({ length: 33 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`)]) expect(await logFamilyContactAction({ ...original, dateCorrections })).toMatchObject({ status: "refused" });
    expect(await logFamilyContactAction({ ...command, dateCorrections: ["2026-10-12"] })).toMatchObject({ status: "refused" });
    expect(state.inserted).toEqual([]); expect(state.tables).toEqual([]);
  });
  it("an expired correction remains recoverable, while failed readback remains uncertain", async () => {
    const request = { ...command, outcome: "follow_up_agreed" as const, agreedOn: "2026-10-11", dateCorrections: ["2026-10-12"] };
    state.today = "2026-10-13"; expect(await logFamilyContactAction(request)).toMatchObject({ status: "expired", today: "2026-10-13" }); expect(state.inserted).toEqual([]);
    state.today = "2026-10-12"; state.insertMode = "read_error";
    expect(await logFamilyContactAction(request)).toMatchObject({ status: "uncertain" }); expect(state.rows.size).toBe(1); expect(state.refresh).not.toHaveBeenCalled();
  });
});
