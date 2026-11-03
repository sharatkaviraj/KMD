import { beforeEach, describe, expect, it, vi } from "vitest";

/* Fees office reads in One (review T02/T03). Synthetic records only. */
const state = vi.hoisted(() => ({ pending: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: vi.fn(async () => ({ role: "admin" })) }));
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgePendingRequests: state.pending }));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/modules/dashboard/data/queries", () => ({ getDashboardPageData: vi.fn() }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: vi.fn() }));
vi.mock("@/modules/fees/platform/session-context/resolver", () => ({ resolveViewSession: vi.fn() }));

import { pendingCanonicalMoneyRequests, pendingFeesRefunds } from "@/modules/dashboard/vx/admin-today";
import { feesBridgeOfficeReads } from "@/platform/fees-bridge/policy";

const item = {
  id: "00000000-0000-4000-8000-0000000000f1", kind: "refund_approval", status: "pending_approval",
  student: { id: "00000000-0000-4000-8000-0000000000f2", name: "Synthetic Child", classLabel: "Class 5", srNo: "TEST-5" },
  amount: 400, reason: "Synthetic reason", receipt: { id: "00000000-0000-4000-8000-0000000000f3", receiptNumber: "SVP-9", paymentDate: "2026-11-02" },
  requestedAt: "2026-11-02T05:00:00Z", requestedBy: "Office", canDecide: false, feesPath: "/protected/finance-controls?date=2026-11-02&session=2026-27",
};

beforeEach(() => {
  state.pending.mockReset();
  state.pending.mockResolvedValue({ sessionLabel: "2026-27", items: [item], totalCount: 1 });
});

describe("Fees refund requests in Needs you", () => {
  it("names them as Fees refunds and links to where Fees decides them", async () => {
    const [row] = await pendingFeesRefunds("2026-27");
    expect(row).toEqual(expect.objectContaining({ id: `fees:${item.id}`, amount: 400, studentName: "Synthetic Child", receiptNumber: "SVP-9" }));
    expect(row.title?.en).toBe("Refund to approve in Fees");
    expect(row.href).toBe("https://fees.vpps.co.in/protected/finance-controls?date=2026-11-02&session=2026-27");
  });

  it("keeps one reader per session, so the page and the badge share one read", () => {
    expect(pendingCanonicalMoneyRequests("2026-27")).toBe(pendingCanonicalMoneyRequests("2026-27"));
    expect(pendingCanonicalMoneyRequests("2026-27")).not.toBe(pendingCanonicalMoneyRequests("2027-28"));
  });
});

describe("feesBridgeOfficeReads", () => {
  it("is off unless the connection and its own switch are both on", () => {
    expect(feesBridgeOfficeReads({ FEES_BRIDGE_ENABLED: "true" })).toBe(false);
    expect(feesBridgeOfficeReads({ FEES_BRIDGE_OFFICE_READS: "true" })).toBe(false);
    expect(feesBridgeOfficeReads({ FEES_BRIDGE_ENABLED: "true", FEES_BRIDGE_OFFICE_READS: "true" })).toBe(true);
  });
});
