// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allowedReceiptSheet, canOpenReverse, normalizedReceiptUrl, parseReceiptSheet } from "@/modules/receipts/vx/domain/reverse-sheet";
import { groupReversals, reversalMinuteKey } from "@/modules/receipts/vx/domain/reversal-history";

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
const actions = vi.hoisted(() => ({ reverseReceiptAction: vi.fn(), declineReversalRequestAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/app/(app)/receipts/actions", () => actions);
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _p, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en), sub: () => null }) }));
vi.mock("@/vx/ui/overlays", () => ({
  Sheet: ({ open, title, children, footer }: { open: boolean; title: string; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
  useToast: () => ({ show: vi.fn() }),
}));

import { ReceiptPanel } from "@/vx/screens/receipts/receipt-panel";
import type { DeskProps, SelectedReceipt } from "@/vx/screens/receipts/types";

const OPEN = { isReversed: false, remaining: 500, hasPendingRequest: false };

describe("which receipt sheet the URL may open (B08)", () => {
  it("parses only the two known sheets", () => {
    expect(parseReceiptSheet("reverse")).toBe("reverse");
    expect(parseReceiptSheet("send")).toBe("send");
    expect(parseReceiptSheet("delete")).toBeNull();
    expect(parseReceiptSheet(undefined)).toBeNull();
  });

  it("opens reverse only on a receipt that can still be reversed, by someone who may ask", () => {
    expect(allowedReceiptSheet("reverse", OPEN, true)).toBe("reverse");
    expect(allowedReceiptSheet("reverse", { ...OPEN, isReversed: true, remaining: 0 }, true)).toBeNull();
    expect(allowedReceiptSheet("reverse", { ...OPEN, remaining: 0 }, true)).toBeNull();
    expect(allowedReceiptSheet("reverse", { ...OPEN, hasPendingRequest: true }, true)).toBeNull();
    // The admin who decides a waiting request opens it from Needs you (review finding 1).
    expect(allowedReceiptSheet("reverse", { ...OPEN, hasPendingRequest: true }, true, true)).toBe("reverse");
    expect(allowedReceiptSheet("reverse", { ...OPEN, hasPendingRequest: true, isReversed: true, remaining: 0 }, true, true)).toBeNull();
    expect(allowedReceiptSheet("reverse", OPEN, false)).toBeNull();
    expect(allowedReceiptSheet("reverse", null, true)).toBeNull();
    expect(canOpenReverse({ ...OPEN, isReversed: true }, true)).toBe(false);
  });

  it("keeps the share sheet for a live receipt and drops it on a reversed one", () => {
    expect(allowedReceiptSheet("send", OPEN, false)).toBe("send");
    expect(allowedReceiptSheet("send", { ...OPEN, isReversed: true }, true)).toBeNull();
  });

  it("replaces a URL that asked for a sheet the page will not open, keeping every other parameter", () => {
    expect(normalizedReceiptUrl("/receipts/TEST-0001", { sheet: "reverse", date: "2026-10-18", span: "3d" }, null)).toBe("/receipts/TEST-0001?date=2026-10-18&span=3d");
    expect(normalizedReceiptUrl("/receipts/TEST-0001", { sheet: "reverse" }, null)).toBe("/receipts/TEST-0001");
    expect(normalizedReceiptUrl("/receipts/TEST-0001", { sheet: "reverse" }, "reverse")).toBeNull();
    expect(normalizedReceiptUrl("/receipts/TEST-0001", { date: "2026-10-18" }, null)).toBeNull();
  });
});

describe("reversal history keeps its time (B08)", () => {
  it("shows the full timestamp with its offset, not the UTC wall clock read as local", () => {
    const [event] = groupReversals([{ amount_delta: -300, reason: "Entered twice", created_at: "2026-10-19T08:30:12.345+00:00", created_by: "00000000-0000-4000-8000-0000000000aa" }]);
    expect(event.at).toBe("2026-10-19T08:30:12.345+00:00");
    // 08:30 UTC is 2:00 pm in the school's clock; the old key "2026-10-19T08:30" parsed as local time.
    const ist = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(event.at));
    expect(ist.replace(/\s/g, " ").toLowerCase()).toMatch(/^2:00 pm$/);
    expect(event.by).toBe("00000000-0000-4000-8000-0000000000aa");
  });

  it("groups one reversal's lines by the absolute minute, across offsets, and keeps separate reversals apart", () => {
    const events = groupReversals([
      { amount_delta: -300, reason: "Entered twice", created_at: "2026-10-19T08:30:01+00:00" },
      { amount_delta: -200, reason: null, created_at: "2026-10-19T14:00:40+05:30" },
      { amount_delta: -100, reason: "Wrong student", created_at: "2026-10-20T09:00:00+00:00" },
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ amount: 500, note: "Entered twice", at: "2026-10-19T08:30:01+00:00" });
    expect(events[1]).toMatchObject({ amount: 100, note: "Wrong student" });
    expect(reversalMinuteKey("2026-10-19T14:00:40+05:30")).toBe("2026-10-19T08:30");
  });
});

const RECEIPT: SelectedReceipt = {
  id: "00000000-0000-4000-8000-000000000020",
  receiptNumber: "TEST-0001",
  studentFullName: "TEST Child A",
  admissionNo: "TEST-1",
  classLabel: "Class 7",
  fatherName: "TEST Parent",
  fatherPhone: null,
  paymentDate: "2026-10-19",
  createdAt: "2026-10-19T04:30:00+00:00",
  paymentMode: "cash",
  referenceNumber: null,
  totalAmount: 500,
  reversedAmount: 0,
  isReversed: false,
  receivedBy: "TEST Cashier",
  sessionLabel: "TEST-2026-27",
  heads: [{ label: "Installment 1", amount: 500 }],
  share: { status: "not_sent", at: null },
  history: [{ at: "2026-10-19T04:30:00+00:00", kind: "posted", amount: 500 }],
  pendingRequest: null,
  reversal: null,
};
const PROPS: DeskProps = {
  today: "2026-10-19", anchor: "2026-10-19", span: "today", from: "2026-10-19", to: "2026-10-19", view: "list", sessionLabel: "TEST-2026-27",
  rows: [], truncated: false, lastDate: null, closeEvent: null, lastReopen: null, selected: RECEIPT, sheet: null,
  initial: { mode: "", staff: "", query: "" },
  perms: { collect: true, accounts: true, reverse: true, reopen: true, print: true, dayBook: true },
};

let root: Root;
let host: HTMLDivElement;
async function render(receipt: SelectedReceipt, props: Partial<DeskProps> = {}) {
  await act(async () => root.render(<ReceiptPanel {...PROPS} {...props} receipt={receipt} />));
}
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("the receipt panel's reverse sheet (B08)", () => {
  it("never opens Reverse ₹0 on a reversed receipt, and says when and by whom it was reversed", async () => {
    const reversed = {
      ...RECEIPT,
      isReversed: true,
      reversedAmount: 500,
      reversal: { at: "2026-10-19T08:30:12+00:00", byName: "TEST Admin", note: "Entered twice" },
      history: [...RECEIPT.history, { at: "2026-10-19T08:30:12+00:00", kind: "reversed" as const, amount: 500, note: "Entered twice", byName: "TEST Admin" }],
    };
    await render(reversed, { sheet: "reverse" });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(host.textContent).not.toContain("Reverse ₹0");
    const line = document.getElementById("rc-reversed-on")!.textContent!;
    expect(line).toContain("Reversed on");
    expect(line).toContain("2:00 pm");
    expect(line).toContain("by TEST Admin");
    expect(line).toContain("Entered twice");
    expect(host.textContent).toContain("Reversed by TEST Admin");
  });

  it("opens from the URL on a live receipt and, once reversed, replaces the URL without the sheet", async () => {
    window.history.replaceState({}, "", "/receipts/TEST-0001?sheet=reverse&date=2026-10-18");
    actions.reverseReceiptAction.mockResolvedValue({ ok: true, kind: "reversed" });
    await render(RECEIPT, { sheet: "reverse" });
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog).not.toBeNull();
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("[role=radio]")][0].click());
    const go = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Reverse ₹500"))!;
    expect(go).toBeDefined();
    await act(async () => go.click());
    expect(actions.reverseReceiptAction).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/receipts/TEST-0001?date=2026-10-18", { scroll: false });
    expect(nav.refresh).toHaveBeenCalled();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    // The refreshed props say reversed: the sheet stays shut even though it was the last one open.
    await render({ ...RECEIPT, isReversed: true, reversedAmount: 500 }, { sheet: "reverse" });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("keeps the sheet shut for a viewer who may not ask", async () => {
    await render(RECEIPT, { sheet: "reverse", perms: { ...PROPS.perms, accounts: false } });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});

describe("a reversal asked by the accountant (smoke 20 Oct)", () => {
  const ASKED: SelectedReceipt = {
    ...RECEIPT,
    pendingRequest: { at: "2026-10-19T05:55:00+00:00", by: "TEST Accountant", reasonCode: "wrong_amount", note: "Typed 500 for 50" },
    history: [...RECEIPT.history, { at: "2026-10-19T05:55:00+00:00", kind: "asked", byName: "TEST Accountant", reasonCode: "wrong_amount", note: "Typed 500 for 50" }],
  };

  it("shows who asked and why, with their reason chosen, and lets the admin decline with a reason", async () => {
    window.history.replaceState({}, "", "/receipts/TEST-0001?sheet=reverse");
    actions.declineReversalRequestAction.mockResolvedValue({ ok: true, kind: "declined" });
    await render(ASKED, { sheet: "reverse" });
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.querySelector("#rc-asked")!.textContent).toContain("Asked by TEST Accountant");
    expect(dialog.querySelector("#rc-asked")!.textContent).toContain("Wrong amount typed — Typed 500 for 50");
    const radios = [...dialog.querySelectorAll<HTMLButtonElement>("[role=radio]")];
    expect(radios.find((b) => b.getAttribute("aria-checked") === "true")?.textContent).toContain("Wrong amount typed");
    const decline = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("decline"))!;
    await act(async () => decline.click());
    const box = document.querySelector<HTMLTextAreaElement>("[role=dialog] textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(box, "Amount was right");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((b) => b.textContent === "Decline the request")!;
    await act(async () => confirm.click());
    expect(actions.declineReversalRequestAction).toHaveBeenCalledWith({ receiptNumber: "TEST-0001", note: "Amount was right" });
    expect(actions.reverseReceiptAction).not.toHaveBeenCalled();
  });

  it("puts the request in History, in words, and never prints the stored reason code", async () => {
    await render(ASKED);
    expect(host.textContent).toContain("Reversal asked by TEST Accountant · Wrong amount typed — Typed 500 for 50");
    const reversed = {
      ...RECEIPT,
      isReversed: true,
      reversedAmount: 500,
      reversal: { at: "2026-10-19T08:30:12+00:00", byName: "TEST Admin", note: "wrong_amount — Test: approved" },
      history: [...RECEIPT.history, { at: "2026-10-19T08:30:12+00:00", kind: "reversed" as const, amount: 500, note: "wrong_amount — Test: approved", byName: "TEST Admin" }],
    };
    await render(reversed);
    expect(host.textContent).not.toContain("wrong_amount");
    expect(document.getElementById("rc-reversed-on")!.textContent).toContain("Wrong amount typed — Test: approved");
  });

  it("tells the admin the receipt leaves its own day's total, and warns when that day is closed", async () => {
    await render({ ...RECEIPT, dayClosed: true }, { sheet: "reverse" });
    const text = document.querySelector("[role=dialog]")!.textContent!;
    expect(text).not.toContain("written today");
    expect(text).toContain("taken out of the total for its own day");
    expect(text).toContain("is already closed");
  });

  it("asks the accountant for a note to the admin, not to themself", async () => {
    await render(RECEIPT, { sheet: "reverse", perms: { ...PROPS.perms, reverse: false } });
    expect(document.querySelector<HTMLTextAreaElement>("[role=dialog] textarea")!.placeholder).toBe("Anything the admin should know");
  });
});
