import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The cross-request caches added for perf fixes 4, 5 and 10. What matters is
 * not the cache (sharedCache is the bare function under vitest) but the two
 * lines around it: the permission check stays outside, before any read, and
 * every write that changes a cached answer expires its tag at once.
 */

const state = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  from: vi.fn(),
  staff: { id: "s1" } as unknown,
  assertPermission: vi.fn(),
}));

function query(result: { data: unknown; error: null }): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
      return () => proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: state.revalidateTag, unstable_cache: (fn: unknown) => fn, revalidatePath: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({
  assertPermission: state.assertPermission,
  assertStaff: async () => state.staff,
  getCurrentStaff: async () => state.staff,
}));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.from(table);
      return query({ data: table === "timetable_versions" ? null : [], error: null });
    },
    schema: () => ({ from: () => query({ data: [], error: null }) }),
  }),
}));
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => ({ from: () => query({ data: [], error: null }) }) }));

import { createSubject, listSubjects, setSubjectActive, updateSubject } from "@/modules/academics/data/academics-repo";
import { deleteCalendarDay, upsertCalendarDays } from "@/modules/academics/data/class-teachers-repo";
import { attendanceCalendar } from "@/modules/attendance/data/attendance-repo";
import { dayHeaders } from "@/modules/attendance/data/teaching-repo";
import { saveBells } from "@/modules/substitutions/data/school-rules-repo";
import { getPublishedVersion, publishVersion } from "@/modules/timetable/data/timetable-repo";

const expired = () => state.revalidateTag.mock.calls.map(([tag, profile]) => ({ tag, profile }));

beforeEach(() => {
  state.revalidateTag.mockReset();
  state.from.mockReset();
  state.staff = { id: "s1" };
  state.assertPermission.mockReset().mockResolvedValue({ id: "s1" });
});

describe("the check stays outside the cache", () => {
  it("refuses the calendar before reading it", async () => {
    state.assertPermission.mockRejectedValue(new Error("Permission denied: attendance:view"));
    await expect(attendanceCalendar("2026-27")).rejects.toThrow("Permission denied");
    expect(state.from).not.toHaveBeenCalled();
  });

  it("gives a non-staff request no timetable, day headers or subjects, without reading", async () => {
    state.staff = null;
    expect(await getPublishedVersion("2026-27")).toBeNull();
    expect(await dayHeaders("v1")).toEqual([]);
    expect(await listSubjects()).toEqual([]);
    expect(state.from).not.toHaveBeenCalled();
  });

  it("reads them for staff", async () => {
    await getPublishedVersion("2026-27");
    await dayHeaders("v1");
    expect(state.from).toHaveBeenCalledWith("timetable_versions");
    expect(state.from).toHaveBeenCalledWith("timetable_slots");
  });
});

describe("every write expires what it changed, at once", () => {
  it("bells", async () => {
    await saveBells("2026-27", [{ index: 0, starts: "08:30", ends: "09:10" }] as never, "s1");
    expect(expired()).toContainEqual({ tag: "vx-bells", profile: { expire: 0 } });
  });

  it("the published timetable", async () => {
    await publishVersion("v2", "2026-27", "u1");
    expect(expired()).toContainEqual({ tag: "vx-timetable", profile: { expire: 0 } });
  });

  it("subjects", async () => {
    await createSubject({ code: "SKT", nameHi: "संस्कृत", nameEn: "Sanskrit", sortOrder: 9 } as never, "u1");
    await updateSubject("sub1", { nameHi: "संस्कृत", nameEn: "Sanskrit", sortOrder: 9 } as never);
    await setSubjectActive("sub1", false);
    expect(expired().filter((call) => call.tag === "vx-subjects")).toHaveLength(3);
  });

  it("calendar days", async () => {
    await upsertCalendarDays({ day: "2026-10-20", until: null, kind: "holiday", labelHi: "अवकाश", labelEn: "Holiday" } as never, "2026-27", "u1");
    await deleteCalendarDay("day1");
    expect(expired().filter((call) => call.tag === "vx-calendar")).toHaveLength(2);
  });
});
