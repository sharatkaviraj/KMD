// @vitest-environment jsdom
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/receipts", useRouter: () => ({ back: () => {}, push: () => {}, refresh: () => {} }) }));

import type { BridgeReceiptList } from "@/platform/fees-bridge/office-read-contracts";
import { DayBook } from "@/vx/screens/receipts/day-book";
import { LiveFinanceHub } from "@/vx/screens/accounts/live-finance-hub";

/* Review F01: Fees has no manual day close (its nightly auto-day-close job closes
   each day, Finance controls shows it read-only), so One offers none either.
   Synthetic receipts only. */
const id = "00000000-0000-4000-8000-000000000001";
const data: BridgeReceiptList = {
  sessionLabel: "2026-27", asOf: "2026-11-03T10:00:00Z", asOfDate: "2026-11-03", from: "2026-11-02", to: "2026-11-03", query: "",
  receipts: [{ receiptId: id, receiptNumber: "SYN-001", paymentDate: "2026-11-03", createdAt: "2026-11-03T09:00:00Z",
    student: { id, name: "Synthetic Student", classLabel: "QA Class", srNo: "QA-001" }, amount: 500, paymentMode: "cash", paymentModeLabel: "Cash",
    referenceNumber: null, status: "active", collectedBy: "Synthetic Staff" }],
  pagination: { page: 1, pageSize: 40, totalCount: 1, hasMore: false },
  totals: { receiptCount: 1, totalAmount: 500, averageAmount: 500, truncated: false },
  days: [
    { date: "2026-11-02", receiptCount: 0, totalAmount: 0, dayClose: { status: "closed", closedAt: "2026-11-02T18:30:00Z", closedBy: null } },
    { date: "2026-11-03", receiptCount: 1, totalAmount: 500, dayClose: null },
  ],
  dayCloseVisible: true,
};

function render(element: React.ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

describe("day book parity with Fees", () => {
  it("offers no way to close a day, here or in Fees, and says the close is automatic", () => {
    const host = render(<DayBook data={data} language="en" canSeeClose />);
    expect(host.textContent).not.toMatch(/close a day/i);
    expect([...host.querySelectorAll("a")].some((a) => a.getAttribute("href")?.startsWith("https://"))).toBe(false);
    expect(host.textContent).toContain("Fees closes each day by itself at midnight");
    expect(host.textContent).toContain("Day closed");
    expect(host.textContent).toContain("Waiting for the overnight close");
  });
  it("opens each receipt in One by id and year", () => {
    const host = render(<DayBook data={data} language="hi" canSeeClose={false} />);
    expect(host.querySelector(`a[href="/receipts/SYN-001?receiptId=${id}&session=2026-27"]`)).not.toBeNull();
    // Without Finance controls in Fees, nothing about the close is shown.
    expect(host.textContent).not.toContain("आधी रात");
  });
});

describe("finance hub", () => {
  it("keeps Receipts in One once Fees' office reads are on, and never links to the Fees app", () => {
    const here = render(<LiveFinanceHub language="en" receiptsHere />);
    expect(here.querySelector('a[href="/receipts"]')).not.toBeNull();
    expect(here.querySelector('a[href="https://fees.vpps.co.in/protected/receipts"]')).toBeNull();
    const there = render(<LiveFinanceHub language="en" receiptsHere={false} />);
    expect(there.querySelector('a[href="/not-in-one?from=%2Freceipts"]')).not.toBeNull();
    for (const hub of [here, there]) {
      expect(hub.querySelector('a[href^="https://fees.vpps.co.in"]')).toBeNull();
      expect(hub.querySelector('a[href="/dues"]')).not.toBeNull();
      expect(hub.querySelector('a[href="/fee-setup"]')).not.toBeNull();
      expect(hub.querySelector('a[href="/reports"]')).not.toBeNull();
    }
  });
});
