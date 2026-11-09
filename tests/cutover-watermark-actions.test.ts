import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cutover line, wired into the two run actions (go-live Phase D,
 * critique0 #12): a send the fees app wrote before the line is neither
 * re-sent nor reconciled from One. TEST-session rows are One's own and are
 * never refused. Behaviour, not source text: the actions run against a fake
 * client, and AiSensy is a spy that is never reached for a fees-app row.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/fees/platform/session", () => ({
  requireStaffPermission: async () => ({ id: "staff-1" }),
}));
vi.mock("@/platform/migration/cutover-watermark-reader", () => ({
  readCutoverWatermark: async () => ({ state: "at", at: "2026-10-31T00:00:00.000Z", source: "load" }),
}));
vi.mock("@/modules/payments/data/online/service", () => ({ onlineLedgerRecheck: async () => null }));
vi.mock("@/modules/whatsapp/data/document-store", () => ({ signDocumentUrl: async () => null }));

const send = vi.fn();
vi.mock("@/modules/whatsapp/data/parent-send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/whatsapp/data/parent-send")>()),
  sendParentTemplate: (args: unknown) => send(args),
}));

// Since fees 3cc2de4b (ported in Phase F) the run page's retry hands its
// failed rows to the failure desk's resend; One filters the line first.
const resend = vi.fn();
vi.mock("@/app/(app)/fees/reminders/fix/actions", () => ({
  resendFailuresAction: (_prev: unknown, data: FormData) => resend(data.getAll("sendId")),
}));

const stuck = vi.fn();
const resolve = vi.fn();
vi.mock("@/modules/whatsapp/data/delivery-store", () => ({
  importDeliveryReport: vi.fn(),
  loadStuckSends: (args: unknown) => stuck(args),
  resolveStuckSends: (args: unknown) => resolve(args),
}));

let failedRows: Array<Record<string, unknown>> = [];
const updated: string[] = [];
vi.mock("@/modules/fees/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          or: () => chain,
          is: () => chain,
          limit: () => chain,
          then: (done: (value: { data: unknown[]; error: null }) => unknown) => done({ data: failedRows, error: null }),
        };
        return chain;
      },
      update: () => ({
        eq: async (_column: string, id: string) => {
          updated.push(id);
          return { error: null };
        },
      }),
    }),
  }),
}));

import {
  reconcileStuckSendsAction,
  retryFailedSendsAction,
} from "@/app/(app)/fees/reminders/runs/[runId]/actions";

const BEFORE = "2026-10-30T09:00:00.000Z";
const AFTER = "2026-10-31T09:00:00.000Z";

function failed(id: string, created_at: string, session_label: string) {
  return {
    id,
    campaign_name: "vpps_app_fee_due_hi_v3",
    destination: "+919000000001",
    template_params: ["Test Parent", "1", "2", "3", "4"],
    attempts: 1,
    document_path: null,
    pay_code: null,
    pay_scope: null,
    due_amount: 100,
    sent_on: "2026-10-31",
    session_label,
    created_at,
  };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ ok: true, status: 200, messageId: "m" });
  stuck.mockReset();
  resolve.mockReset();
  resolve.mockImplementation(async (args: { sendIds: string[] }) => args.sendIds.length);
  resend.mockReset();
  resend.mockResolvedValue({ status: "success", message: "2 messages sent" });
  updated.length = 0;
});

describe("retrying a run's failed sends", () => {
  it("never re-sends a real-session row the fees app wrote before the line", async () => {
    failedRows = [failed("fees-row", BEFORE, "2026-27")];
    const result = await retryFailedSendsAction({ status: "idle" }, form({ runId: "run-1" }));

    expect(send).not.toHaveBeenCalled();
    expect(resend).not.toHaveBeenCalled();
    expect(updated).toEqual([]);
    expect(result.message).toMatch(/1 were sent by the fees app/);
  });

  it("re-sends One's own rows, and TEST-session rows from either side of the line", async () => {
    failedRows = [
      failed("fees-row", BEFORE, "2026-27"),
      failed("test-row", BEFORE, "TEST-2026-27"),
      failed("one-row", AFTER, "2026-27"),
    ];
    const result = await retryFailedSendsAction({ status: "idle" }, form({ runId: "run-1" }));

    expect(resend).toHaveBeenCalledTimes(1);
    expect((resend.mock.calls[0]![0] as string[]).sort()).toEqual(["one-row", "test-row"]);
    expect(result.message).toMatch(/1 not re-sent: they were sent by the fees app/);
  });
});

describe("reconciling a run's stuck sends", () => {
  const stuckRow = (id: string, createdAt: string, sessionLabel: string) => ({
    id,
    studentName: "Test Child",
    admissionNo: "TEST-001",
    destination: "+919000000001",
    createdAt,
    sessionLabel,
  });

  it("refuses when every pending row is the fees app's", async () => {
    stuck.mockResolvedValue([stuckRow("fees-row", BEFORE, "2026-27")]);
    const result = await reconcileStuckSendsAction(
      { status: "idle" },
      form({ runId: "run-1", outcome: "sent", reason: "checked the provider log" }),
    );

    expect(result.status).toBe("error");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("decides One's rows and TEST-session rows, never the fees app's", async () => {
    stuck.mockResolvedValue([
      stuckRow("fees-row", BEFORE, "2026-27"),
      stuckRow("test-row", BEFORE, "TEST-2026-27"),
      stuckRow("one-row", AFTER, "2026-27"),
    ]);
    await reconcileStuckSendsAction(
      { status: "idle" },
      form({ runId: "run-1", outcome: "failed", reason: "checked the provider log" }),
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect((resolve.mock.calls[0]![0] as { sendIds: string[] }).sendIds.sort()).toEqual(["one-row", "test-row"]);
  });
});
