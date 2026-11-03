import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ canonical: true, officeReads: false, get: vi.fn(), lookup: vi.fn(), redirect: vi.fn(), local: vi.fn(), visible: vi.fn(), notFound: vi.fn(), cookie: "2026-27" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { state.notFound(); throw new Error("synthetic_not_found"); }, redirect: (to: string) => { state.redirect(to); throw new Error("synthetic_redirect"); }, RedirectType: { replace: "replace" } }));
vi.mock("@/platform/auth/current-staff", () => ({ requirePermission: async () => ({ role: "admin", isTestAccount: false, isActive: true, language: "en" }) }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: async () => state.cookie }));
vi.mock("@/platform/fees-bridge/policy", () => ({ usesCanonicalFees: () => state.canonical, feesBridgeOfficeReads: () => state.officeReads, feesBridgeWritesEnabled: () => false }));
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgeReceiptDetail: state.get, lookupBridgeReceipt: state.lookup }));
vi.mock("@/vx/screens/receipts/load", () => ({ loadReceiptsDesk: state.local }));
vi.mock("@/vx/screens/receipts/desk", () => ({ ReceiptsDesk: () => null }));
vi.mock("@/vx/screens/receipts/canonical-receipt", () => ({ CanonicalReceipt: () => null, CanonicalReceiptUnavailable: () => null }));
vi.mock("@/platform/auth/test-session-access", () => ({ assertReceiptVisible: state.visible, notFoundUnlessVisible: async (fn: () => unknown) => fn() }));
vi.mock("@/modules/receipts/vx/domain/reverse-sheet", () => ({ normalizedReceiptUrl: () => null }));
import Page from "@/app/(app)/receipts/[receiptNumber]/page";
import { CanonicalReceipt, CanonicalReceiptUnavailable } from "@/vx/screens/receipts/canonical-receipt";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
const id = "00000000-0000-4000-8000-000000000001";
const number = "SVP20261101-0001";
const page = (search: Record<string, string | string[] | undefined> = { receiptId: id, session: "2026-27" }, receiptNumber = number) => Page({ params: Promise.resolve({ receiptNumber }), searchParams: Promise.resolve(search) });
beforeEach(() => { vi.clearAllMocks(); state.canonical = true; state.officeReads = false; state.get.mockResolvedValue({ receiptId: id, detail: { receiptNumber: number } }); state.local.mockResolvedValue({ selected: { receiptNumber: "TST20261101-0001" } }); });
it("renders only the pinned canonical receipt and never reads the local ledger", async () => {
  const result = await page();
  expect(result.type).toBe(CanonicalReceipt); expect(state.get).toHaveBeenCalledWith(id, "2026-27"); expect(state.local).not.toHaveBeenCalled();
});
// F02: a refusal explains itself instead of ending in "Page not found".
it.each([
  [{}, "missing_link"], [{ receiptId: id }, "missing_link"], [{ receiptId: "foreign", session: "2026-27" }, "missing_link"],
  [{ receiptId: id, session: ["2026-27", "TEST-2026-27"] }, "missing_link"], [{ receiptId: id, session: "TEST-2026-27" }, "access"],
] as [Record<string, string | string[]>, string][])("explains missing or malformed receipt pins %j before any financial read", async (search, reason) => {
  const result = await page(search);
  expect(result.type).toBe(CanonicalReceiptUnavailable); expect(result.props.reason).toBe(reason);
  expect(state.get).not.toHaveBeenCalled(); expect(state.local).not.toHaveBeenCalled(); expect(state.notFound).not.toHaveBeenCalled();
});
it("refuses a mismatched receipt number even when a valid source UUID was supplied", async () => {
  const result = await page(undefined, "SVP-OTHER");
  expect(result.type).toBe(CanonicalReceiptUnavailable); expect(result.props.reason).toBe("unreadable"); expect(state.local).not.toHaveBeenCalled();
});
it("compares an encoded receipt number decoded, so a valid link is not refused", async () => {
  state.get.mockResolvedValue({ receiptId: id, detail: { receiptNumber: "SVP 2026/1" } });
  expect((await page(undefined, encodeURIComponent("SVP 2026/1"))).type).toBe(CanonicalReceipt);
});
it("shows an unavailable state rather than old local financial values after a source failure", async () => {
  state.get.mockRejectedValue(new FeesBridgeError("unavailable", "Synthetic failure"));
  const result = await page();
  expect(result.type).toBe(CanonicalReceiptUnavailable); expect(result.props.reason).toBe("error"); expect(state.local).not.toHaveBeenCalled();
});
it("does not reveal whether an unauthorized receipt exists: refused and missing look the same", async () => {
  state.get.mockRejectedValueOnce(new FeesBridgeError("forbidden", "Synthetic refusal"));
  const refused = await page();
  state.get.mockRejectedValueOnce(new FeesBridgeError("not_found", "Synthetic absence"));
  const missing = await page();
  expect(refused.props).toEqual(missing.props);
  expect(refused.props.reason).toBe("unreadable"); expect(refused.props.receiptId).toBeUndefined(); expect(state.local).not.toHaveBeenCalled();
});
it("resolves a number-only link to the exact receipt once Fees' lookup is on", async () => {
  state.officeReads = true;
  state.lookup.mockResolvedValue({ receiptId: id, receiptNumber: number, studentId: id, sessionLabel: "2026-27" });
  await expect(page({})).rejects.toThrow("synthetic_redirect");
  expect(state.lookup).toHaveBeenCalledWith(number, "2026-27");
  expect(state.redirect).toHaveBeenCalledWith(`/receipts/${number}?receiptId=${id}&session=2026-27`);
});
it("keeps explaining a number-only link when the lookup finds nothing", async () => {
  state.officeReads = true;
  state.lookup.mockRejectedValue(new FeesBridgeError("not_found", "Synthetic"));
  const result = await page({});
  expect(result.type).toBe(CanonicalReceiptUnavailable); expect(result.props.reason).toBe("missing_link"); expect(state.get).not.toHaveBeenCalled();
});
it("retains local receipt visibility checks for isolated TEST mode", async () => {
  state.canonical = false;
  await page({ session: "TEST-2026-27" }, "TST20261101-0001");
  expect(state.get).not.toHaveBeenCalled(); expect(state.local).toHaveBeenCalledOnce(); expect(state.visible).toHaveBeenCalledOnce();
});
