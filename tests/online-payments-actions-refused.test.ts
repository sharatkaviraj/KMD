import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A refused write is reported as refused (go-live Phase E review). While fee
 * writes are test-only the fee write guard answers the switch upsert with
 * 403 VPP01: nothing moved, so the screen must not say "Switch changed." and
 * the audit trail must not record a change that never happened. The same for
 * closing a review.
 */

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/platform/auth/current-staff", () => ({
  assertPermission: async () => ({ id: "staff-1", role: "admin", isTestAccount: false }),
}));
vi.mock("@/modules/fees/platform/session", () => ({
  requireStaffPermission: async () => ({ id: "staff-1" }),
}));
vi.mock("@/platform/auth/test-session-access", () => ({
  assertNotTestAccount: async () => undefined,
  assertStudentsVisible: async () => undefined,
  passesFence: async (check: () => Promise<void>) => {
    await check();
    return true;
  },
}));
vi.mock("@/modules/payments/data/online/after-posting", () => ({ afterOnlinePosting: vi.fn() }));
vi.mock("@/modules/payments/data/online/service", () => ({ applyCapture: vi.fn() }));

const writes: Array<{ table: string; op: string }> = [];
let refuse = true;
const guardError = { code: "VPP01", message: "Fee writes are switched off." };

vi.mock("@/modules/fees/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const respond = (op: string) => {
        writes.push({ table, op });
        return Promise.resolve({ data: null, error: refuse && table === "app_settings" ? guardError : null });
      };
      return {
        upsert: () => respond("upsert"),
        insert: () => respond("insert"),
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { online_payment_intents: { student_id: "stu-1" } },
              error: null,
            }),
          }),
        }),
      };
    },
    async rpc(name: string) {
      writes.push({ table: name, op: "rpc" });
      return { data: null, error: refuse ? guardError : null };
    },
  }),
}));

import { resolveOnlineReviewAction, setOnlineSwitchAction } from "@/app/(app)/fees/payments/online/actions";

async function redirectOf(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
  throw new Error("expected a redirect");
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  writes.length = 0;
});

describe("a switch the fee write guard refuses", () => {
  it("is reported as not changed, and nothing is audited", async () => {
    refuse = true;
    const to = await redirectOf(() => setOnlineSwitchAction(form({ key: "online_payment_links_enabled", value: "true" })));
    expect(to).toBe("/fees/payments/online?notice=switch_refused");
    expect(writes).toEqual([{ table: "app_settings", op: "upsert" }]);
  });

  it("when it is written, the change is audited and reported", async () => {
    refuse = false;
    const to = await redirectOf(() => setOnlineSwitchAction(form({ key: "online_payment_links_enabled", value: "true" })));
    expect(to).toBe("/fees/payments/online?notice=switched");
    expect(writes).toEqual([
      { table: "app_settings", op: "upsert" },
      { table: "online_payment_audit", op: "insert" },
    ]);
  });
});

describe("a review close the database refuses", () => {
  const captureId = "00000000-0000-4000-8000-000000000001";

  it("is reported as not resolved", async () => {
    refuse = true;
    const to = await redirectOf(() => resolveOnlineReviewAction(form({ captureId, note: "refunded in Razorpay" })));
    expect(to).toBe("/fees/payments/online?notice=not_resolved");
  });

  it("is reported as resolved when it went", async () => {
    refuse = false;
    const to = await redirectOf(() => resolveOnlineReviewAction(form({ captureId, note: "refunded in Razorpay" })));
    expect(to).toBe("/fees/payments/online?notice=resolved");
  });
});
