import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ mayEdit: false, tables: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ requirePermission: async () => ({ id: "qa-staff" }) }));
vi.mock("@/platform/auth/permissions", () => ({ can: (_: unknown, permission: string) => permission === "timetable:manage" && fixture.mayEdit }));
vi.mock("@/platform/dates", () => ({ addDays: () => "2026-10-05", schoolToday: () => "2026-10-12" }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ classLabelMap: async () => new Map([["qa-class", "QA Class"]]), listSubjects: async () => [], resolveSessionLabel: async () => "TEST-2026-27" }));
vi.mock("@/modules/staff/data/staff-repo", () => ({ listStaff: async () => [] }));
vi.mock("@/modules/timetable/data/timetable-repo", () => ({ getPublishedVersion: async () => ({ id: "qa-version", label: "Published QA" }), listSlots: async () => [] }));
vi.mock("@/modules/substitutions/data/arrange-day", () => ({ candidatesFor: vi.fn(), profilesFor: vi.fn(), readCoverDay: vi.fn() }));
vi.mock("@/modules/substitutions/data/cover-repo", () => ({ coverCountsBetween: vi.fn(), noticesOn: vi.fn() }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  fixture.tables.push(table);
  const chain: Record<string, (...args: unknown[]) => unknown> = { select: () => chain, eq: () => chain, gte: () => chain, in: () => chain, is: () => chain, order: () => chain, limit: () => chain, returns: async () => ({ data: table === "timetable_changes" ? [{ id: "qa-draft", day: "Monday", period: 0, class_id: "qa-class", class_label: "QA Class", subject_id: "qa-subject", subject_code: "SCI", staff_profile_id: "qa-other", teacher_short_name: "QAO", created_by: "qa-editor", created_at: "2026-10-11" }] : [] }) };
  return chain;
} }) }));
import { loadTimetableScreen } from "@/vx/screens/timetable/data";
describe("timetable publication boundary", () => {
  beforeEach(() => { fixture.mayEdit = false; fixture.tables = []; });
  it("does not send unpublished changes to a timetable reader", async () => {
    const data = await loadTimetableScreen(null);
    expect(data.changes).toEqual([]);
    expect(fixture.tables).not.toContain("timetable_changes");
  });
  it("keeps pending edits available for an authorized coordinator preview", async () => {
    fixture.mayEdit = true;
    const data = await loadTimetableScreen(null);
    expect(data.changes).toEqual([expect.objectContaining({ id: "qa-draft", subjectCode: "SCI" })]);
  });
});
