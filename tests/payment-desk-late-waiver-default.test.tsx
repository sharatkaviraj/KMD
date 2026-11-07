// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, receipt, student, STUDENT_ID } from "./payment-parity.fixture";

/**
 * Plan Q20, answered by the owner on 31 Oct: One's own vx Payment Desk waives
 * the late fee by default, like the office's call of 27 Oct (fees 1b932785)
 * that the two ported desk screens already follow. The waiver is on screen
 * before anything is saved, "Take with fees" is one tap away, and the default
 * saves without typing because the standard reason is filled in.
 */

const actions = vi.hoisted(() => ({ postDeskPaymentAction: vi.fn(), checkDeskPaymentAction: vi.fn(), loadStudentDeskAction: vi.fn(), loadReceiptAction: vi.fn(), loadDeskPreviewAction: vi.fn(), removePaymentAction: vi.fn(), sendReceiptWhatsappAction: vi.fn(), settleDeskSaveAction: vi.fn(), deskDayStateAction: vi.fn() }));
vi.mock("@/app/(app)/payments/actions", () => actions);
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ href, children, prefetch: _prefetch, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a href={href} {...p}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => typeof p === "string" ? p : p.en }), Bi: ({ en }: { en: string }) => <span>{en}</span> }));
import { PaymentDesk } from "@/vx/screens/payments/desk";
import { W } from "@/vx/screens/payments/words";
import { ToastProvider } from "@/vx/ui/overlays";
import { paymentAttemptKey } from "@/modules/payments/vx/attempt";
import { composeRemarks, DESK_DEFAULT_WAIVE_REASON, deskLateDefault, deskProblems, deskWaivesLate } from "@/modules/payments/vx/domain/desk";

let root: Root;
let host: HTMLDivElement;
async function render(canWaive = true) {
  await act(async () =>
    root.render(
      <ToastProvider>
        <PaymentDesk boot={{ ...boot, me: { ...boot.me, id: "qa-owner", canWaive, isAdmin: canWaive } }} previewing={false} initialStudentId={STUDENT_ID} initialStudent={{ ok: true, student }} initialReceipt={null} />
      </ToastProvider>,
    ),
  );
}
async function click(text: string) {
  const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent?.trim() === text) ?? [...document.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent?.includes(text));
  expect(b, text).toBeDefined();
  await act(async () => b!.click());
}
async function input(selector: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(selector);
  expect(el, selector).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const waivedLine = () => host.querySelector('[data-testid="late-waived-now"]')?.textContent ?? null;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/payments");
  localStorage.setItem(paymentAttemptKey("qa-owner", boot.sessionLabel), JSON.stringify({ deleted: true, updatedAt: 0 }));
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_key: string, work: () => Promise<unknown>) => work() } });
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  actions.loadStudentDeskAction.mockResolvedValue({ ok: true, student });
  actions.loadDeskPreviewAction.mockResolvedValue({ ok: true, rows: student.rows });
  actions.postDeskPaymentAction.mockResolvedValue({ status: "saved", receipt, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null });
  host = document.createElement("div");
  document.body.append(host);
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  document.body.append(layer);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("the vx desk waives the late fee by default (Q20)", () => {
  it("shows the waiver and its amount before saving, and saves it with the standard reason", async () => {
    await render();
    // The fixture student owes a ₹1,000 late fee on Installment 1.
    expect(waivedLine()).toContain("Late fee ₹1,000 is waived");
    expect(waivedLine()).toContain("will not be collected");
    const waive = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === "Waive");
    expect(waive?.getAttribute("aria-checked")).toBe("true");
    await input("#pd-amount", "500");
    await click("Review & save");
    const review = document.querySelector("[role=dialog]")?.textContent ?? "";
    // The confirm sheet repeats it: the amount, that it is waived, and why.
    expect(review).toContain(`Late fee ₹1,000Waived · ${DESK_DEFAULT_WAIVE_REASON}`);
    await click("Save payment");
    const posted = actions.postDeskPaymentAction.mock.calls[0][0];
    expect(posted).toMatchObject({ amount: 500, lateFeeWaiver: 1000 });
    expect(posted.remarks).toContain(`Late fee waived: ${DESK_DEFAULT_WAIVE_REASON}.`);
  });

  it("lets staff take the late fee instead, in one tap", async () => {
    await render();
    await click("Take with fees");
    expect(waivedLine()).toBeNull();
    await input("#pd-amount", "500");
    await click("Review & save");
    await click("Save payment");
    const posted = actions.postDeskPaymentAction.mock.calls[0][0];
    expect(posted).toMatchObject({ lateFeeWaiver: 0 });
    expect(posted.remarks).not.toContain("Late fee waived");
  });

  it("still asks for a reason when the standard one is cleared", async () => {
    await render();
    await click(W.waiveReasons[0].en);
    await input("#pd-amount", "500");
    await click("Review & save");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(host.textContent).toContain("Pick a reason for the waiver");
    expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
  });

  it("never waives for a cashier who may not", async () => {
    await render(false);
    expect(waivedLine()).toBeNull();
    expect([...host.querySelectorAll('[role="radio"]')].some((b) => b.textContent === "Waive")).toBe(false);
    await input("#pd-amount", "500");
    await click("Review & save");
    await click("Save payment");
    expect(actions.postDeskPaymentAction.mock.calls[0][0]).toMatchObject({ lateFeeWaiver: 0 });
  });
});

describe("the default, as pure rules", () => {
  it("starts waived with the standard reason only for staff allowed to waive", () => {
    expect(deskLateDefault(true)).toEqual({ late: "waive", waiveReason: DESK_DEFAULT_WAIVE_REASON });
    expect(deskLateDefault(false)).toEqual({ late: "take", waiveReason: "" });
  });

  it("the standard reason needs no typing and is the ported desk's own text", () => {
    const draft = { amount: 500, paymentDate: "2026-10-11", mode: "cash" as const, chequeNo: "", chequeBank: "", waiveLate: true, waiveReason: DESK_DEFAULT_WAIVE_REASON };
    const problems = deskProblems(draft, { maxAmount: 3000, overMax: false }, { today: "2026-10-11", sessionStart: "2026-04-01", lateFeeOwed: 1000 });
    expect(problems).toEqual([]);
    expect(composeRemarks({ ...draft, chequeDate: "", waiveNote: "", notes: "" })).toBe(`Late fee waived: ${DESK_DEFAULT_WAIVE_REASON}.`);
    // The chip that is picked by default is the first, and it is this text.
    expect(W.waiveReasons[0].en).toBe(DESK_DEFAULT_WAIVE_REASON);
    expect(W.waiveReasons[0].hi).toBeTruthy();
    // post_student_payment_core writes the same words on its quick waiver.
    expect(DESK_DEFAULT_WAIVE_REASON).toBe("Payment Desk late fee waiver");
  });

  it("the default waiver never covers a late fee the payment date avoids; a tapped waiver always counts", () => {
    const base = { waiveAllowed: true, late: "waive" as const, lateChosen: false, lateFeeOwed: 1000 };
    const row = {};
    // A late fee owed on the payment date: waived by default.
    expect(deskWaivesLate({ ...base, lateOn: { due: [row], avoidable: [] } })).toBe(true);
    expect(deskWaivesLate({ ...base, lateOn: { due: [row], avoidable: [row] } })).toBe(true);
    // Every pending late fee still avoidable on that date (a payment dated on
    // or before each due date): no default waiver record; the desk shows "no
    // late fee on <date>" as it did before Q20.
    expect(deskWaivesLate({ ...base, lateOn: { due: [], avoidable: [row] } })).toBe(false);
    // The cashier tapped Waive: honoured.
    expect(deskWaivesLate({ ...base, lateChosen: true, lateOn: { due: [], avoidable: [row] } })).toBe(true);
    // Take, not allowed, or nothing owed: never.
    expect(deskWaivesLate({ ...base, late: "take", lateOn: { due: [row], avoidable: [] } })).toBe(false);
    expect(deskWaivesLate({ ...base, waiveAllowed: false, lateOn: { due: [row], avoidable: [] } })).toBe(false);
    expect(deskWaivesLate({ ...base, lateFeeOwed: 0, lateOn: { due: [], avoidable: [] } })).toBe(false);
    const desk = readFileSync(join(process.cwd(), "src/vx/screens/payments/desk.tsx"), "utf8");
    expect(desk).toContain("set({ late: v, lateChosen: \"yes\" })");
    expect(desk).toContain("const waiveLate = deskWaivesLate(");
  });

  it("the on-screen waiver line is bilingual and names the amount", () => {
    const line = W.lateWaivedNow("₹1,000");
    expect(line.en).toContain("₹1,000");
    expect(line.hi).toContain("₹1,000");
  });

  it("the form starts from the default, and resets to it for each student", () => {
    const desk = readFileSync(join(process.cwd(), "src/vx/screens/payments/desk.tsx"), "utf8");
    expect(desk).toContain("...deskLateDefault(boot.me.canWaive)");
    expect(desk).not.toMatch(/late: "take",/);
  });
});
