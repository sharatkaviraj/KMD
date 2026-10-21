import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentStaff } from "@/platform/auth/current-staff";

/*
 * The admin reads behind Today, Needs you and the shell's badge (perf 1, 2;
 * admin B6). Every repository is a stub: these tests are about which reads a
 * reader gets and whether the badge agrees with the list, not about SQL.
 */

const calls = vi.hoisted(() => ({
  registersForDay: vi.fn(),
  attendanceCalendar: vi.fn(),
  schoolCalendar: vi.fn(),
  readCoverDay: vi.fn(),
}));

/** A query builder whose every method chains and which resolves to no rows. */
function emptyQuery(): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
      return () => proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => {} }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => emptyQuery() }));
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => emptyQuery() }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ classLabelMap: async () => new Map([["c1", "Class 1"], ["c2", "Class 2"]]) }));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({
  registersForDay: calls.registersForDay,
  attendanceCalendar: calls.attendanceCalendar,
  schoolCalendar: calls.schoolCalendar,
  attendanceRules: async () => ({ halfDayCredit: 0.5 }),
}));
vi.mock("@/modules/enrolments/data/enrolments-repo", () => ({ listEnrolments: async () => [] }));
vi.mock("@/modules/staff/data/staff-repo", () => ({ listStaff: async () => [] }));
vi.mock("@/modules/substitutions/data/absences-repo", () => ({ absencesOn: async () => [] }));
vi.mock("@/modules/timetable/data/timetable-repo", () => ({ getPublishedVersion: async () => null }));
vi.mock("@/modules/substitutions/data/cover-repo", () => ({
  currentBells: async () => ({ id: null, label: "Default", revision: 0, periods: [{ index: 0, starts: "08:30", ends: "09:10" }, { index: 1, starts: "09:10", ends: "09:50" }] }),
  dutiesOn: async () => [
    { id: "d1", needKey: "n1", period: 1, classLabels: ["Class 2"], subjectCode: "HIN", absentStaffIds: ["t1"], createdAt: "2026-10-15T02:00:00Z", status: "needs_help", coveringStaffId: null, revision: 1 },
    { id: "d2", needKey: "n2", period: 0, classLabels: ["Class 1"], subjectCode: "ENG", absentStaffIds: ["t1"], createdAt: "2026-10-15T02:00:00Z", status: "assigned", coveringStaffId: "t2", revision: 1 },
  ],
  liveOnly: (duties: { status: string }[]) => duties.filter((d) => d.status === "assigned" || d.status === "needs_help"),
}));
vi.mock("@/modules/substitutions/data/arrange-day", () => ({
  readCoverDay: calls.readCoverDay,
  profilesFor: async () => ({ everyone: {}, history: {} }),
  candidatesFor: () => [],
}));
vi.mock("@/modules/collection/data/submissions-repo", () => ({
  listSubmissions: async () => [
    { id: "s1", value: "9876500001", previousValue: "9876500000", submittedAt: "2026-10-15T03:00:00Z", studentName: "Test Child A", fieldLabelEn: "Phone", fieldLabelHi: "फ़ोन", classLabel: "Class 1", submittedByName: "QA" },
    { id: "s2", value: "Ward 4", previousValue: "Ward 3", submittedAt: "2026-10-15T03:01:00Z", studentName: "Test Child B", fieldLabelEn: "Address", fieldLabelHi: "पता", classLabel: "Class 1", submittedByName: "QA" },
    { id: "s3", value: "same", previousValue: "same", submittedAt: "2026-10-15T03:02:00Z", studentName: "Test Child C", fieldLabelEn: "Address", fieldLabelHi: "पता", classLabel: "Class 2", submittedByName: "QA" },
  ],
}));
vi.mock("@/modules/jobs/data/jobs-repo", () => ({
  jobsBoard: async () => ({ latest: new Map([["nightly", { id: "j1", job: "nightly", status: "failed", error: "boom", startedAt: "2026-10-15T00:00:00Z", finishedAt: "2026-10-15T00:01:00Z" }]]) }),
}));

import { inboxCount, loadInbox, loadToday } from "@/vx/screens/admin/data";

function person(role: CurrentStaff["role"]): CurrentStaff {
  return { id: `${role}-id`, userId: `${role}-user`, email: null, displayName: "QA Person", shortName: "QA", role, isTeaching: false, isActive: true, language: "both", preferredStart: null };
}

beforeEach(() => {
  calls.registersForDay.mockReset().mockResolvedValue([]);
  calls.attendanceCalendar.mockReset().mockResolvedValue(new Map());
  calls.schoolCalendar.mockReset().mockResolvedValue(new Map());
  calls.readCoverDay.mockReset().mockImplementation(async () => ({
    live: [{ id: "d1", needKey: "n1", period: 1, classLabels: ["Class 2"], subjectCode: "HIN", absentStaffIds: ["t1"], createdAt: "2026-10-15T02:00:00Z", status: "needs_help", coveringStaffId: null }],
    staff: [],
    slots: [],
    absences: [],
    bells: { periods: [{ index: 1, starts: "09:10", ends: "09:50" }] },
    dayRevision: 3,
  }));
});

describe("view-only Today (admin B6)", () => {
  it("reads no register board, so it neither fails the calendar nor calls every class unmarked", async () => {
    const facts = await loadToday(person("view_only"), "2026-27", "2026-10-15", 9 * 60);
    expect(calls.registersForDay).not.toHaveBeenCalled();
    expect(calls.attendanceCalendar).not.toHaveBeenCalled();
    expect(facts.board).toBeNull();
    expect(facts.unavailable).toEqual([]);
    expect(facts.exceptions.notMarked).toBeNull();
    // The bells still frame the day, without the attendance line.
    expect(facts.timeline.map((item) => item.title.en)).not.toContain("Attendance closes");
    expect(facts.timeline.length).toBeGreaterThan(0);
  });

  it("still gives a reader with attendance:view the board", async () => {
    const facts = await loadToday(person("admin"), "2026-27", "2026-10-15", 9 * 60);
    expect(calls.registersForDay).toHaveBeenCalled();
    expect(facts.board?.rows).toHaveLength(2);
    expect(facts.exceptions.notMarked).toEqual(["Class 1", "Class 2"]);
    expect(facts.timeline.map((item) => item.title.en)).toContain("Attendance closes");
  });
});

describe("the badge and the list agree (perf 1, 2)", () => {
  it("counts exactly the items Needs you shows", async () => {
    const refunds = async () => [{ id: "r1", studentId: "x", studentName: "Test Child D", amount: 500, reason: null, requestedAt: "2026-10-15T04:00:00Z" }];
    const admin = person("admin");
    const [list, count] = await Promise.all([
      // 9:20, after the first period ends: a register is late (none is raised at midnight).
      loadInbox(admin, "2026-27", "2026-10-15", { refunds, nowMinutes: 560 }),
      inboxCount(admin, "2026-27", "2026-10-15", refunds, 560),
    ]);
    // not marked · 1 cover · 2 changes · confirmations · refund · failed job
    expect(list.items.map((item) => item.kind)).toEqual(["not_marked", "cover", "submission", "submission", "confirmations", "refund", "job"]);
    expect(count).toBe(list.items.length);
  });

  it("reads the whole cover day only when a duty actually needs somebody", async () => {
    await inboxCount(person("admin"), "2026-27", "2026-10-15");
    expect(calls.readCoverDay).not.toHaveBeenCalled();
  });
});
