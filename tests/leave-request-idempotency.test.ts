import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A retried leave request files once (MCP feasibility §10).
 *
 * `requestLeaveVx` used to insert with no key, so a send whose answer was
 * lost and was tapped again filed the leave twice — and queued the office
 * notice twice. The fake table below enforces the new partial unique index
 * `teacher_leave_request_once` (staff, request id, first day) the way
 * Postgres would, so a test that slipped a second row past the server logic
 * would still meet the database's answer.
 */

type LeaveRow = {
  id: string;
  session_label: string;
  staff_profile_id: string;
  from_day: string;
  to_day: string;
  span: string;
  note: string | null;
  status: string;
  requested_by: string;
  client_request_id?: string | null;
};

const state = vi.hoisted(() => ({
  rows: [] as LeaveRow[],
  inserts: 0,
  failReads: false,
  // Simulates a concurrent twin: rows appear just before this insert lands.
  beforeInsert: null as null | (() => void),
}));

function fakeClient() {
  return {
    from(table: string) {
      if (table !== "teacher_leave") throw new Error(`Unexpected table ${table}`);
      const filters: [keyof LeaveRow, unknown][] = [];
      let toInsert: Omit<LeaveRow, "id">[] | null = null;
      const builder = {
        select(columns: string) {
          expect(columns).toBe("id");
          return builder;
        },
        eq(column: keyof LeaveRow, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        order(column: string) {
          expect(column).toBe("from_day");
          return builder;
        },
        insert(rows: Omit<LeaveRow, "id">[]) {
          toInsert = rows;
          return builder;
        },
        then<T>(resolve: (value: unknown) => T) {
          if (toInsert) {
            state.inserts += 1;
            state.beforeInsert?.();
            state.beforeInsert = null;
            const key = (row: Omit<LeaveRow, "id">) =>
              row.client_request_id ? `${row.staff_profile_id}|${row.client_request_id}|${row.from_day}` : null;
            const taken = new Set(state.rows.map(key).filter(Boolean));
            for (const row of toInsert) {
              const k = key(row);
              if (k && taken.has(k)) {
                return Promise.resolve(resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"teacher_leave_request_once\"" } }));
              }
              if (k) taken.add(k);
            }
            const added = toInsert.map((row, i) => ({ ...row, id: `leave-${state.rows.length + i + 1}` }));
            state.rows.push(...added);
            return Promise.resolve(resolve({ data: added.map((row) => ({ id: row.id })), error: null }));
          }
          if (state.failReads) return Promise.resolve(resolve({ data: null, error: { message: "read failed" } }));
          const found = state.rows
            .filter((row) => filters.every(([column, value]) => row[column] === value))
            .sort((a, b) => a.from_day.localeCompare(b.from_day))
            .map((row) => ({ id: row.id }));
          return Promise.resolve(resolve({ data: found, error: null }));
        },
      };
      return builder;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({
  assertPermission: async () => ({ id: "qa-teacher", role: "teacher", permissions: ["attendance:view"] }),
  assertStaff: async () => ({ id: "qa-teacher", role: "teacher", permissions: ["attendance:view"] }),
}));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => undefined }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "TEST-2026-27", classLabelMap: async () => new Map() }));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({ attendanceCalendar: async () => new Map(), listMarks: vi.fn() }));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({ heldClassIds: vi.fn(), dayHeaders: vi.fn() }));
vi.mock("@/modules/students/data/student-repo", () => ({ enrolmentForStudent: vi.fn() }));
vi.mock("@/modules/timetable/data/timetable-repo", () => ({ getPublishedVersion: vi.fn(), listSlots: vi.fn() }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: fakeClient }));
vi.mock("@/platform/auth/test-session-access", () => ({
  assertSessionWritable: async () => undefined,
  assertStudentVisible: async () => undefined,
}));
vi.mock("@/app/(app)/duty/[id]/actions", () => ({ acknowledgeDutyAction: vi.fn(), cannotCoverAction: vi.fn() }));
vi.mock("@/app/(app)/teach/actions", () => ({ checkAttendanceSaveAction: vi.fn(), saveAttendanceAction: vi.fn() }));
vi.mock("@/vx/screens/teach/students", () => ({ childBasics: vi.fn() }));

import { requestLeaveVx } from "@/vx/screens/teach/actions";
import { leaveSubmissionFor } from "@/vx/screens/teach/domain/teach";
import { m } from "@/messages";

const FIRST = "00000000-0000-4000-8000-0000000000a1";
const SECOND = "00000000-0000-4000-8000-0000000000a2";
// Thursday and Friday, then Monday: two runs, so one request is two rows.
const request = (requestId?: string, over: Partial<{ days: string[]; note: string }> = {}) => ({
  days: ["2026-11-05", "2026-11-06", "2026-11-09"],
  span: "full" as const,
  reason: "Unwell",
  note: "",
  ...over,
  ...(requestId ? { requestId } : {}),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T04:00:00Z"));
  state.rows = [];
  state.inserts = 0;
  state.failReads = false;
  state.beforeInsert = null;
});
afterEach(() => vi.useRealTimers());

describe("requestLeaveVx with a request id", () => {
  it("files a request once and hands the original rows back on a retry", async () => {
    const first = await requestLeaveVx(request(FIRST));
    expect(first).toEqual({ ok: true, leaveIds: ["leave-1", "leave-2"], repeated: false });
    expect(state.rows.map((row) => [row.from_day, row.to_day, row.client_request_id])).toEqual([
      ["2026-11-05", "2026-11-06", FIRST],
      ["2026-11-09", "2026-11-09", FIRST],
    ]);

    const retry = await requestLeaveVx(request(FIRST));
    expect(retry).toEqual({ ok: true, leaveIds: ["leave-1", "leave-2"], repeated: true });
    expect(state.rows).toHaveLength(2);
    expect(state.inserts).toBe(1);
  });

  it("answers a retry that lands after the days have passed with the original, not a refusal", async () => {
    await requestLeaveVx(request(FIRST, { days: ["2026-11-04"] }));
    vi.setSystemTime(new Date("2026-11-05T04:00:00Z"));

    expect(await requestLeaveVx(request(FIRST, { days: ["2026-11-04"] }))).toEqual({ ok: true, leaveIds: ["leave-1"], repeated: true });
    expect(state.rows).toHaveLength(1);
  });

  it("files two distinct submissions, even for the same days", async () => {
    expect(await requestLeaveVx(request(FIRST))).toMatchObject({ ok: true, repeated: false });
    expect(await requestLeaveVx(request(SECOND))).toMatchObject({ ok: true, repeated: false });
    expect(state.rows).toHaveLength(4);
    expect(new Set(state.rows.map((row) => row.client_request_id))).toEqual(new Set([FIRST, SECOND]));
  });

  it("hands back the twin's rows when two tries of one submission race", async () => {
    // Both tries found nothing filed; the other one's insert commits first.
    state.beforeInsert = () => {
      state.rows.push(
        { id: "twin-1", session_label: "TEST-2026-27", staff_profile_id: "qa-teacher", from_day: "2026-11-05", to_day: "2026-11-06", span: "full", note: "Unwell", status: "asked", requested_by: "qa-teacher", client_request_id: FIRST },
        { id: "twin-2", session_label: "TEST-2026-27", staff_profile_id: "qa-teacher", from_day: "2026-11-09", to_day: "2026-11-09", span: "full", note: "Unwell", status: "asked", requested_by: "qa-teacher", client_request_id: FIRST },
      );
    };

    expect(await requestLeaveVx(request(FIRST))).toEqual({ ok: true, leaveIds: ["twin-1", "twin-2"], repeated: true });
    expect(state.rows).toHaveLength(2);
  });

  it("matches an id only against the same person's own requests", async () => {
    state.rows.push({ id: "other-1", session_label: "TEST-2026-27", staff_profile_id: "qa-other", from_day: "2026-11-05", to_day: "2026-11-06", span: "full", note: null, status: "asked", requested_by: "qa-other", client_request_id: FIRST });

    expect(await requestLeaveVx(request(FIRST))).toMatchObject({ ok: true, repeated: false });
    expect(state.rows.filter((row) => row.staff_profile_id === "qa-teacher")).toHaveLength(2);
  });

  it("does not file when it cannot tell whether the id was already filed", async () => {
    state.failReads = true;
    expect(await requestLeaveVx(request(FIRST))).toEqual({ ok: false, error: m.leaveNotSentRetry });
    expect(state.inserts).toBe(0);
  });

  it("refuses an id that is not a uuid", async () => {
    expect(await requestLeaveVx(request("not-a-uuid"))).toMatchObject({ ok: false });
    expect(state.inserts).toBe(0);
  });

  it("still files a request from a sheet that sends no id, without the key", async () => {
    expect(await requestLeaveVx(request())).toMatchObject({ ok: true, repeated: false });
    expect(state.rows.every((row) => !("client_request_id" in row))).toBe(true);
  });
});

describe("the sheet's request id", () => {
  let n = 0;
  const newId = () => `id-${++n}`;
  const input = { days: ["2026-11-05"], span: "full", reason: "Unwell", note: "" };

  it("stays the same across tries of the same request", () => {
    const first = leaveSubmissionFor(null, input, newId);
    expect(leaveSubmissionFor(first, { ...input, days: [...input.days] }, newId)).toBe(first);
  });

  it("changes as soon as the request does", () => {
    const first = leaveSubmissionFor(null, input, newId);
    for (const changed of [
      { ...input, days: ["2026-11-06"] },
      { ...input, span: "first_half" },
      { ...input, reason: "Family function" },
      { ...input, note: "Back by noon" },
    ]) {
      expect(leaveSubmissionFor(first, changed, newId).id).not.toBe(first.id);
    }
  });
});

describe("the migration", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261103192446_teacher_leave_request_id.sql"),
    "utf8",
  ).replace(/--[^\n]*/g, "");

  it("adds a nullable column and a partial unique index, in vppsone only", () => {
    expect(sql).toMatch(/alter table vppsone\.teacher_leave\s+add column if not exists client_request_id uuid;/);
    expect(sql).not.toMatch(/client_request_id uuid not null/);
    expect(sql).toMatch(
      /create unique index if not exists teacher_leave_request_once\s+on vppsone\.teacher_leave \(staff_profile_id, client_request_id, from_day\)\s+where client_request_id is not null;/,
    );
    expect(sql).not.toMatch(/\bpublic\./);
    expect(sql).not.toMatch(/\bupdate\b|\bdelete\b|\binsert\b/i);
  });
});
