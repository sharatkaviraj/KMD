import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ placement: { data: null, error: null } as { data: unknown; error: unknown }, fieldsError: null as unknown, actorsError: null as unknown, marks:vi.fn() }));
vi.mock("@/modules/assessments/data/assessments-repo",()=>({marksForPapers:state.marks,listAssessments:async()=>[{id:"exam",term:"T1",weight:1}],papersForClass:async()=>[{id:"paper",assessmentId:"exam",maxMarks:100,subjectId:"subject",subjectCode:"QA",sortOrder:0}]}));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => {} }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q, in: () => q, maybeSingle: async () => state.placement,
    returns: async () => ({ data: [], error: table === "collection_fields" ? state.fieldsError : state.actorsError }) };
  return q;
} }) }));
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
    returns: async () => ({ data: [{ id: 1, field_id: "synthetic-field", actor_staff_id: "synthetic-actor" }], error: null }) };
  return q;
} }) }));
import { termSummaries } from "@/modules/assessments/data/reports-repo";
import { historyForStudent } from "@/modules/collection/data/documents-repo";
beforeEach(() => { state.placement = { data: null, error: null }; state.fieldsError = null; state.actorsError = null; state.marks.mockReset().mockResolvedValue(new Map()); });
it("requests only the opened student's marks for Student 360",async()=>{
  state.placement={data:{class_id:"qa"},error:null};await termSummaries("synthetic","QA");
  expect(state.marks).toHaveBeenCalledWith(["paper"],"synthetic");
});
it("distinguishes a missing placement from an unavailable assessment lookup", async () => {
  expect(await termSummaries("synthetic", "QA")).toEqual([]);
  state.placement.error = { message: "Synthetic failure" }; await expect(termSummaries("synthetic", "QA")).rejects.toThrow("assessment placement");
});
it("keeps deleted metadata fallbacks only after a successful history metadata read", async () => {
  const rows = await historyForStudent("synthetic"); expect(rows[0].actorName).toBeNull();
  state.fieldsError = { message: "Synthetic failure" }; await expect(historyForStudent("synthetic")).rejects.toThrow("history's labels");
  state.fieldsError = null; state.actorsError = { message: "Synthetic failure" }; await expect(historyForStudent("synthetic")).rejects.toThrow("history's labels");
});
