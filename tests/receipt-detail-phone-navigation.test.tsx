// @vitest-environment jsdom
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BottomTab } from "@/vx/nav";

const route = vi.hoisted(() => ({ pathname: "/fees/receipts/7821379e-cabc-4cf3-9bfb-8fc1617b4f93" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  notFound: () => { throw new Error("not found"); },
}));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (pair: { en: string }) => pair.en }) }));
vi.mock("@/vx/ui/overlays", () => ({ Sheet: () => null }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/modules/receipts/data/queries", () => ({ getReceiptDetail: async () => ({
  id: "7821379e-cabc-4cf3-9bfb-8fc1617b4f93", receiptNumber: "OPS-RECEIPT",
  studentId: "48af9254-132d-428d-b40a-4332caf9a510", studentFullName: "Synthetic student",
  createdAt: "2026-04-14T10:00:00Z", isVoided: false,
}) }));
vi.mock("@/modules/fees/platform/session", () => ({
  requireStaffPermission: async () => ({ role: "fee_collector" }),
  hasStaffPermission: (_staff: unknown, permission: string) => permission === "receipts:print",
}));
vi.mock("@/app/(app)/fees/receipts/actions", () => ({ sendReceiptOnWhatsappAction: vi.fn(), sendReversalNoticeAction: vi.fn() }));
vi.mock("@/platform/i18n/bilingual-receipt", () => ({ createBilingualReceiptTranslator: () => (key: string) => key }));
vi.mock("@/modules/payments/ui/mobile-printed-receipt", () => ({ MobilePrintedReceipt: () => null }));
vi.mock("@/modules/receipts/ui/receipt-document", () => ({ ReceiptDocument: () => null }));
vi.mock("@/modules/receipts/ui/send-receipt-button", () => ({ SendReceiptButton: () => null }));
vi.mock("@/modules/receipts/ui/receipt-admin-reversal-action", () => ({ ReceiptAdminReversalAction: () => null }));
vi.mock("@/modules/receipts/ui/receipt-undo-action", () => ({ ReceiptUndoAction: () => null }));

import { VxBottomBar } from "@/vx/shell/bottom-bar";
import ReceiptDetailPage from "@/app/(app)/fees/receipts/[receiptId]/page";

const tabs: BottomTab[] = [{ key: "receipts", href: "/receipts", label: { en: "Receipts" }, icon: "receipt" }];
function documentOf(markup: string) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = markup;
  return doc;
}
function nav(pathname: string) {
  route.pathname = pathname;
  return documentOf(renderToStaticMarkup(<VxBottomBar tabs={tabs} badges={Promise.resolve({})} />));
}
async function detail(returnTo: string) {
  const page = await ReceiptDetailPage({ params: Promise.resolve({ receiptId: "7821379e-cabc-4cf3-9bfb-8fc1617b4f93" }), searchParams: Promise.resolve({ returnTo }) });
  return documentOf(renderToStaticMarkup(page));
}

describe("classic receipt phone takeover", () => {
  it("leaves the detail's fixed Print A4 bar without overlapping primary navigation", () => {
    expect(nav("/fees/receipts/7821379e-cabc-4cf3-9bfb-8fc1617b4f93").querySelector('nav[aria-label="Primary navigation"]')).toBeNull();
  });
  it.each(["/fees/receipts", "/receipts", "/receipts/OPS-RECEIPT", "/payments", "/fees/receipts-export"])("preserves primary navigation on %s", (pathname) => {
    expect(nav(pathname).querySelector('nav[aria-label="Primary navigation"] a[href="/receipts"]')).not.toBeNull();
  });
  it("gives the phone a Back link retaining a validated filtered list and its session", async () => {
    const returnTo = "/fees/receipts?query=OPS-SYNTHETIC&session=2026-27&page=2";
    const doc = await detail(returnTo);
    const phoneBack = [...doc.querySelectorAll('a[aria-label="backToTransactions"]')].find(link => !link.closest('[class~="hidden"]'));
    expect(phoneBack?.getAttribute("href")).toBe(returnTo);
    expect(doc.querySelector('[data-mobile-receipt-actions] a[href*="print=1"]')).not.toBeNull();
  });
  it("keeps unsafe return targets on the existing workspace fallback", async () => {
    const doc = await detail("//outside.invalid/path");
    expect(doc.querySelector('a[aria-label="backToTransactions"]')?.getAttribute("href")).toBe("/fees/transactions?view=receipts");
  });
  it("mounts one auto-print control instead of duplicate hidden header actions", async () => {
    const doc = await detail("/fees/receipts");
    expect([...doc.querySelectorAll("button")].filter(button => button.textContent === "printActionsPrintReceipt")).toHaveLength(1);
  });
});
