import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The failure desk's Fix tab in One (fees 3cc2de4b + 2c0ada0a, ported in go-live
 * Phase F): every action that names a reminder, a student or a session checks
 * the test-session fence first, and a reminder the fees app sent before the
 * cutover line is never re-sent from One. Against a fake client; the Send
 * screen's action is a spy, so nothing is sent.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/fees/platform/session", () => ({
  requireStaffPermission: async () => ({ id: "staff-1" }),
  requireAnyStaffPermission: async () => ({ id: "staff-1" }),
  hasStaffPermission: () => true,
}));
vi.mock("@/platform/migration/cutover-watermark-reader", () => ({
  readCutoverWatermark: async () => ({ state: "at", at: "2026-10-31T00:00:00.000Z", source: "load" }),
}));

const fence = vi.hoisted(() => ({
  students: vi.fn(async (...args: unknown[]) => void args),
  student: vi.fn(async (...args: unknown[]) => void args),
  session: vi.fn(async (...args: unknown[]) => void args),
  notTest: vi.fn(async (...args: unknown[]) => void args),
}));
vi.mock("@/platform/auth/test-session-access", () => ({
  assertStudentsVisible: fence.students,
  assertStudentVisible: fence.student,
  assertSessionWritable: fence.session,
  assertNotTestAccount: fence.notTest,
}));

const send = vi.fn(async (data: FormData) => ({ status: "success", sent: data.getAll("studentId").length ? 1 : 0, failed: 0 }));
vi.mock("@/app/(app)/fees/reminders/actions", () => ({ sendRemindersAction: (_p: unknown, data: FormData) => send(data) }));
const health = vi.fn(async (args: unknown) => void args);
vi.mock("@/modules/whatsapp/data/delivery-store", () => ({
  importDeliveryReport: vi.fn(),
  markNumberHealth: (args: unknown) => health(args),
  resolveFailedSends: vi.fn(async () => 1),
  resolveStuckSends: vi.fn(async () => undefined),
}));
vi.mock("@/modules/system-sync/data/financial-view-refresh", () => ({ drainFinancialViewRefresh: vi.fn() }));
vi.mock("@/modules/fees/platform/supabase/server", () => ({ createClient: vi.fn() }));

let rows: Array<Record<string, unknown>> = [];
vi.mock("@/modules/fees/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const data = table === "whatsapp_campaign_runs"
        ? [{ id: "run-1", situation: "fee_due", language: "hi", last_date: null, filters: { installments: [1] } }]
        : rows;
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "in", "eq", "is", "limit", "neq", "or"]) chain[name] = () => chain;
      chain.maybeSingle = async () => ({
        data: table === "students" ? { id: "s-1", primary_phone: "9000000001", secondary_phone: null } : null,
        error: null,
      });
      chain.then = (done: (value: { data: unknown; error: null }) => unknown) =>
        done({ data: table === "students" ? [] : data, error: null });
      return chain;
    },
  }),
}));

import {
  markHandledAction,
  markNumberAction,
  resendFailuresAction,
  resolveStuckAction,
  saveFamilyNumberAction,
} from "@/app/(app)/fees/reminders/fix/actions";
import { resolveFailedSends, resolveStuckSends } from "@/modules/whatsapp/data/delivery-store";
import { createClient } from "@/modules/fees/platform/supabase/server";

const row = (id: string, student: string, created_at: string, session_label: string) => ({
  id,
  student_id: student,
  run_id: "run-1",
  sent_on: "2026-10-31",
  status: "failed",
  delivery_status: null,
  failure_cause: "network",
  resolution: null,
  pay_scope: null,
  created_at,
  session_label,
});

const form = (fields: Array<[string, string]>) => {
  const data = new FormData();
  for (const [key, value] of fields) data.append(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resend", () => {
  it("checks every reminder's student against the fence, and skips the fees app's rows from before the line", async () => {
    rows = [
      row("fees-row", "s-fees", "2026-10-30T09:00:00.000Z", "2026-27"),
      row("one-row", "s-one", "2026-10-31T09:00:00.000Z", "2026-27"),
      row("test-row", "s-test", "2026-10-30T09:00:00.000Z", "TEST-2026-27"),
    ];
    const result = await resendFailuresAction({ status: "idle" }, form([["sendId", "fees-row"], ["sendId", "one-row"], ["sendId", "test-row"]]));

    expect(fence.students).toHaveBeenCalledWith(null, ["s-fees", "s-one", "s-test"]);
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0].getAll("studentId");
    expect(sent.sort()).toEqual(["s-one", "s-test"]);
    expect(result.message).toMatch(/1 not re-sent: they were sent by the fees app/);
  });

  it("refuses when a reminder's student is outside this viewer's sessions", async () => {
    rows = [row("one-row", "s-one", "2026-10-31T09:00:00.000Z", "2026-27")];
    fence.students.mockRejectedValueOnce(new Error("That is the test session."));
    const result = await resendFailuresAction({ status: "idle" }, form([["sendId", "one-row"]]));
    expect(result.status).toBe("error");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the other actions", () => {
  it("saving a family's number checks the student and the siblings first", async () => {
    fence.student.mockRejectedValueOnce(new Error("nope"));
    const result = await saveFamilyNumberAction(
      { status: "idle" },
      form([["studentId", "s-1"], ["fatherPhone", "9000000001"], ["siblingId", "s-2"]]),
    );
    expect(result).toEqual({ status: "error", message: "Could not find that student." });
  });

  it("a test account may not mark a number working or dead for the whole school", async () => {
    fence.notTest.mockRejectedValueOnce(new Error("test account"));
    const result = await markNumberAction({ status: "idle" }, form([["phone", "9000000001"], ["working", "0"]]));
    expect(result.status).toBe("error");
    expect(health).not.toHaveBeenCalled();
  });
});

describe("review of PR #148: the fence checks exactly what the write touches", () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => ["sendId", `send-${i}`] as [string, string]);

  it("refuses to close more reminders than one fence check covers, writing nothing", async () => {
    rows = [];
    const result = await markHandledAction({ status: "idle" }, form([["resolution", "called"], ...many(201)]));
    expect(result.status).toBe("error");
    expect(resolveFailedSends).not.toHaveBeenCalled();
  });

  it("writes to the same list it fenced, de-duplicated", async () => {
    rows = [];
    await markHandledAction({ status: "idle" }, form([["resolution", "called"], ["sendId", "a"], ["sendId", "a"], ["sendId", "b"]]));
    expect(vi.mocked(resolveFailedSends).mock.calls[0]![0]).toMatchObject({ sendIds: ["a", "b"] });
  });

  it("refuses a stuck-row answer naming more than one fence check covers", async () => {
    rows = [];
    const result = await resolveStuckAction({ status: "idle" }, form([["outcome", "sent"], ...many(201)]));
    expect(result).toEqual({ status: "error", message: "Those reminders could not be found." });
    expect(resolveStuckSends).not.toHaveBeenCalled();
  });

  it("checks the siblings it will write: this student left out first, then capped at ten", async () => {
    const siblings = Array.from({ length: 11 }, (_, i) => ["siblingId", `sib-${i}`] as [string, string]);
    fence.student.mockRejectedValueOnce(new Error("stop after the fence"));
    await saveFamilyNumberAction(
      { status: "idle" },
      form([["studentId", "s-1"], ["fatherPhone", "9000000001"], ["siblingId", "s-1"], ...siblings]),
    );
    // The fence on the student refused; nothing past it ran. Now let it pass.
    fence.students.mockClear();
    await saveFamilyNumberAction(
      { status: "idle" },
      form([["studentId", "s-1"], ["fatherPhone", "abc"], ["siblingId", "s-1"], ...siblings]),
    );
    const checked = fence.students.mock.calls[0]![1] as string[];
    expect(checked).toHaveLength(10);
    expect(checked).not.toContain("s-1");
    expect(checked).toEqual(siblings.slice(0, 10).map(([, id]) => id));
  });

  it("a test account saving a number leaves the number's shared health alone", async () => {
    const update = { eq: () => update, select: () => update, single: async () => ({ data: { id: "s-1" }, error: null }) };
    vi.mocked(createClient).mockResolvedValueOnce({ from: () => ({ update: () => update }) } as never);
    fence.notTest.mockRejectedValueOnce(new Error("test account"));
    const result = await saveFamilyNumberAction(
      { status: "idle" },
      form([["studentId", "s-1"], ["fatherPhone", "9000000002"], ["retryFather", "1"]]),
    );
    expect(result.status).toBe("success");
    expect(result.message).toMatch(/test account cannot clear/);
    expect(health).not.toHaveBeenCalled();
  });

  it("a real account's retry clears the number's failures", async () => {
    const update = { eq: () => update, select: () => update, single: async () => ({ data: { id: "s-1" }, error: null }) };
    vi.mocked(createClient).mockResolvedValueOnce({ from: () => ({ update: () => update }) } as never);
    const result = await saveFamilyNumberAction(
      { status: "idle" },
      form([["studentId", "s-1"], ["fatherPhone", "9000000002"], ["retryFather", "1"]]),
    );
    expect(result.status).toBe("success");
    expect(health).toHaveBeenCalledWith(expect.objectContaining({ phoneKey: "9000000002", working: true }));
  });
});
