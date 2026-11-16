import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Payment Desk while One's real year is the night's copy of the Fees app
 * (D-648): fee writes are test-only, so the desk says "take this year's
 * payments in the Fees app" before anyone types an amount, instead of letting
 * a cashier fill a payment the write guard then refuses (VPP01).
 */

const state = vi.hoisted(() => ({ mode: "test-only" as "open" | "test-only" | Error, policyError: null as Error | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/write-guard", () => ({
  currentFeeWritesMode: async () => {
    if (state.mode instanceof Error) throw state.mode;
    return state.mode;
  },
}));
vi.mock("@/modules/fees/domain/queries", () => ({
  getFeePolicyForSession: async (sessionLabel: string) => {
    if (state.policyError) throw state.policyError;
    return { id: "policy-1", academicSessionLabel: sessionLabel };
  },
  getFeePolicySummary: async () => null,
}));
vi.mock("@/modules/fees/platform/supabase/cache-safe", () => ({
  cacheSafeUnstableCache: (fn: () => Promise<unknown>) => fn,
  getCacheSafeClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: "class-1" }], error: null }) }) }) }) }),
  }),
}));
vi.mock("@/platform/observability/log", () => ({ describeError: () => "", logError: () => undefined, logWarn: () => undefined }));

const { getPaymentDeskReadiness } = await import("@/modules/payments/data/queries");

const accountant = { staffAppRole: "accountant" as const, canWritePayments: true };
const admin = { staffAppRole: "admin" as const, canWritePayments: true };

describe("the Payment Desk while the real year is a copy of the Fees app", () => {
  beforeEach(() => {
    state.mode = "test-only";
    state.policyError = null;
  });

  it("cannot post in the real year, and says the Fees app takes this year's payments, with no link to it", async () => {
    const readiness = await getPaymentDeskReadiness({ sessionLabel: "2026-27", ...admin });
    expect(readiness.canPostPayments).toBe(false);
    expect(readiness.canRepairOrPrepareDues).toBe(false);
    expect(readiness.blockingReason).toMatchObject({ key: "fees_app_takes_payments", actionLabel: null, actionHref: null });
    expect(readiness.blockingReason?.title).toMatch(/Fees app/);
  });

  it("still posts in the TEST year, whatever the switch says", async () => {
    const readiness = await getPaymentDeskReadiness({ sessionLabel: "TEST-2026-27", ...accountant });
    expect(readiness.canPostPayments).toBe(true);
    expect(readiness.blockingReason).toBeNull();
  });

  it("posts in the real year once fee writes are open (takeover day)", async () => {
    state.mode = "open";
    const readiness = await getPaymentDeskReadiness({ sessionLabel: "2026-27", ...admin });
    expect(readiness.canPostPayments).toBe(true);
    expect(readiness.canRepairOrPrepareDues).toBe(true);
    expect(readiness.blockingReason).toBeNull();
  });

  it("reads an unanswerable switch as closed", async () => {
    state.mode = new Error("app_settings unreadable");
    const readiness = await getPaymentDeskReadiness({ sessionLabel: "2026-27", ...accountant });
    expect(readiness.canPostPayments).toBe(false);
    expect(readiness.blockingReason?.key).toBe("fees_app_takes_payments");
  });

  it("a read-only account is told it is read-only first", async () => {
    const readiness = await getPaymentDeskReadiness({ sessionLabel: "2026-27", staffAppRole: "view_only", canWritePayments: false });
    expect(readiness.blockingReason?.key).toBe("read_only");
  });

  it("a failed check never offers the admin a repair the switch would refuse", async () => {
    state.policyError = new Error("timeout");
    const readiness = await getPaymentDeskReadiness({ sessionLabel: "2026-27", ...admin });
    expect(readiness.canPostPayments).toBe(false);
    expect(readiness.canRepairOrPrepareDues).toBe(false);
  });
});
