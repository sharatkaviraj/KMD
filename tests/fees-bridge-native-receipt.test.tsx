import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ canonical: true, get: vi.fn(), local: vi.fn(), visible: vi.fn(), notFound: vi.fn(), cookie: "2026-27" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { state.notFound(); throw new Error("synthetic_not_found"); }, redirect: vi.fn(), RedirectType: { replace: "replace" } }));
vi.mock("@/platform/auth/current-staff", () => ({ requirePermission: async () => ({ role: "admin", isTestAccount: false, isActive: true, language: "en" }) }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: async () => state.cookie }));
vi.mock("@/platform/fees-bridge/policy", () => ({ usesCanonicalFees: () => state.canonical }));
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgeReceiptDetail: state.get }));
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
beforeEach(() => { vi.clearAllMocks(); state.canonical = true; state.get.mockResolvedValue({ receiptId: id, detail: { receiptNumber: number } }); state.local.mockResolvedValue({ selected: { receiptNumber: "TST20261101-0001" } }); });
it("renders only the pinned canonical receipt and never reads the local ledger", async () => {
  const result = await page();
  expect(result.type).toBe(CanonicalReceipt); expect(state.get).toHaveBeenCalledWith(id, "2026-27"); expect(state.local).not.toHaveBeenCalled();
});
it.each([{}, { receiptId: id }, { receiptId: "foreign", session: "2026-27" }, { receiptId: id, session: ["2026-27", "TEST-2026-27"] }, { receiptId: id, session: "TEST-2026-27" }])("rejects missing or malformed receipt pins %j before any financial read", async search => {
  await expect(page(search)).rejects.toThrow("synthetic_not_found"); expect(state.get).not.toHaveBeenCalled(); expect(state.local).not.toHaveBeenCalled();
});
it("rejects a mismatched receipt number even when a valid source UUID was supplied", async () => {
  await expect(page(undefined, "SVP-OTHER")).rejects.toThrow("synthetic_not_found"); expect(state.local).not.toHaveBeenCalled();
});
it("shows an unavailable state rather than old local financial values after a source failure", async () => {
  state.get.mockRejectedValue(new FeesBridgeError("unavailable", "Synthetic failure"));
  expect((await page()).type).toBe(CanonicalReceiptUnavailable); expect(state.local).not.toHaveBeenCalled();
});
it("does not reveal whether an unauthorized receipt exists", async () => {
  state.get.mockRejectedValue(new FeesBridgeError("forbidden", "Synthetic refusal"));
  await expect(page()).rejects.toThrow("synthetic_not_found"); expect(state.local).not.toHaveBeenCalled();
});
it("retains local receipt visibility checks for isolated TEST mode", async () => {
  state.canonical = false;
  await page({ session: "TEST-2026-27" }, "TST20261101-0001");
  expect(state.get).not.toHaveBeenCalled(); expect(state.local).toHaveBeenCalledOnce(); expect(state.visible).toHaveBeenCalledOnce();
});
