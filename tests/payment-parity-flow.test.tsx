// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { boot, OTHER_ID, receipt, student, STUDENT_ID } from "./payment-parity.fixture";

const actions = vi.hoisted(() => ({ postDeskPaymentAction: vi.fn(), checkDeskPaymentAction: vi.fn(), loadStudentDeskAction: vi.fn(), loadReceiptAction: vi.fn(), loadDeskPreviewAction: vi.fn(), removePaymentAction: vi.fn(), sendReceiptWhatsappAction: vi.fn() }));
vi.mock("@/app/(app)/payments/actions", () => actions);
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _prefetch, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a href={href} {...p}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => typeof p === "string" ? p : p.en }), Bi: ({ en }: { en: string }) => <span>{en}</span> }));
import { PaymentDesk } from "@/vx/screens/payments/desk";
import { ToastProvider } from "@/vx/ui/overlays";
import { writePaymentAttempt, readPaymentAttempt, paymentAttemptKey } from "@/modules/payments/vx/attempt";

let root: Root; let host: HTMLDivElement;
async function render(props: Partial<React.ComponentProps<typeof PaymentDesk>> = {}) { await act(async () => root.render(<ToastProvider><PaymentDesk boot={{ ...boot, me: { ...boot.me, id: "qa-owner" } }} previewing={false} initialStudentId={STUDENT_ID} initialStudent={{ ok: true, student }} initialReceipt={null} {...props} /></ToastProvider>)); }
async function click(text: string) { const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(text)); expect(b, text).toBeDefined(); await act(async () => b!.click()); }
async function input(selector: string, value: string) { const el = host.querySelector<HTMLInputElement>(selector); expect(el, selector).not.toBeNull(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el!.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); window.history.replaceState({}, "", "/payments");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_key: string, work: () => Promise<unknown>) => work() } });
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  actions.loadStudentDeskAction.mockImplementation(async ({ studentId }) => ({ ok: true, student: { ...student, id: studentId, name: studentId === OTHER_ID ? "TEST Child B" : student.name } }));
  actions.loadDeskPreviewAction.mockResolvedValue({ ok: true, rows: student.rows });
  actions.checkDeskPaymentAction.mockResolvedValue({ status: "unknown", message: "TEST lost response" });
  actions.postDeskPaymentAction.mockResolvedValue({ status: "saved", receipt, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null });
  host = document.createElement("div"); document.body.append(host); const layer = document.createElement("div"); layer.id = "vx-layer"; document.body.append(layer); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });
it("allows received-by and concession edits and keeps them on Back without posting on Review", async () => {
  await render(); await input("#pd-amount", "500"); await input("#pd-received-by", "TEST Other Cashier"); await input("#pd-concession", "200");
  await click("Review"); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
  expect(host.textContent).toContain("TEST Other Cashier"); expect(host.textContent).toContain("Concession");
  await click("Back —"); expect(host.querySelector<HTMLInputElement>("#pd-received-by")!.value).toBe("TEST Other Cashier");
  await click("Review"); await click("Confirm and save");
  expect(actions.postDeskPaymentAction.mock.calls[0][0]).toMatchObject({ amount: 500, quickDiscountAmount: 200, receivedBy: "TEST Other Cashier" });
  expect(actions.sendReceiptWhatsappAction).not.toHaveBeenCalled();
});
it("recovers the original unresolved request after student switch and reload", async () => {
  actions.postDeskPaymentAction.mockRejectedValue(new Error("TEST dropped response"));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Confirm and save");
  const original = actions.postDeskPaymentAction.mock.calls[0][0];
  await click("TEST Child B"); expect(host.textContent).toContain("unfinished payment");
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.textContent).toContain("could not confirm whether this payment was saved");
  actions.checkDeskPaymentAction.mockResolvedValue({ status: "not_saved" }); await click("Check whether");
  await click("Confirm and save"); expect(actions.postDeskPaymentAction.mock.calls[1][0]).toEqual(original);
});
it("does not permit fractional cash or a reference-only review to post", async () => {
  await render(); await input("#pd-amount", "123.50"); await click("Review");
  expect(actions.postDeskPaymentAction).not.toHaveBeenCalled(); expect(host.querySelector("#pd-review-title")).toBeNull();
  expect(host.querySelector<HTMLInputElement>("#pd-amount")!.value).toBe("123.50");
});
it("blocks collection until the selected date's authoritative dues arrive", async () => {
  let resolve!: (value: { ok: true; rows: typeof student.rows }) => void;
  actions.loadDeskPreviewAction.mockReturnValue(new Promise(yes => { resolve = yes; }));
  await render(); await click("Yesterday");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Review payment")!.disabled).toBe(true);
  expect(actions.loadDeskPreviewAction).toHaveBeenCalledWith({ studentId: STUDENT_ID, sessionLabel: boot.sessionLabel, paymentDate: "2026-10-10" });
  await act(async () => resolve({ ok: true, rows: student.rows.map(r => ({ ...r, lateFeePending: 0 })) }));
  await input("#pd-amount", "4100"); await click("Review"); expect(host.querySelector("#pd-review-title")).toBeNull();
  await input("#pd-amount", "500"); await click("Review"); await click("Confirm and save");
  expect(actions.postDeskPaymentAction.mock.calls[0][0]).toMatchObject({ paymentDate: "2026-10-10", lateFeeWaiver: 0 });
});
it("does not send money when recovery storage cannot be confirmed", async () => {
  await render(); await input("#pd-amount", "500"); await click("Review");
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Synthetic blocked storage"); });
  await click("Confirm and save"); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled(); spy.mockRestore();
});
it("keeps preview and closed-session collection read-only", async () => {
  await render({ previewing: true }); await input("#pd-amount", "500"); await click("Review");
  expect(host.querySelector("#pd-review-title")).toBeNull(); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
  await render({ boot: { ...boot, canPost: false } }); await click("Review"); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
});
it("uses the EMI shortcuts and disables concession on an active plan", async () => {
  await render({ initialStudent: { ok: true, student: { ...student, onPlan: true, repaymentPlan: { planId: STUDENT_ID, scope: "old_and_current", paymentStatus: "on_track", monthlyAmount: 1000, remainingBalance: 3000, catchUpAmount: 2000, nextDueDate: "2026-11-01", nextDueAmount: 1000, missedInstallmentCount: 0, planReviewNeeded: false, coveredInstallmentIds: student.rows.map(r => r.id), duesOutsidePlan: null, duesOutsidePlanAmount: 0 } } } });
  expect(host.querySelector<HTMLInputElement>("#pd-concession")!.disabled).toBe(true);
  await click("Monthly EMI"); expect(host.querySelector<HTMLInputElement>("#pd-amount")!.value).toBe("1000");
  await click("Review"); await click("Confirm and save"); expect(actions.postDeskPaymentAction.mock.calls[0][0]).toMatchObject({ amount: 1000, quickDiscountAmount: 0, lateFeeWaiver: 0 });
});

it("uses authoritative collection totals after a restored request is retried", async () => {
  actions.postDeskPaymentAction.mockRejectedValueOnce(new Error("TEST request never reached server"));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Confirm and save");
  await act(async () => root.unmount()); root = createRoot(host); await render();
  actions.checkDeskPaymentAction.mockResolvedValue({ status: "not_saved" }); await click("Check whether");
  actions.postDeskPaymentAction.mockResolvedValue({ status: "saved", receipt, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null, todayCollection: { count: 1, amount: 500 } });
  await click("Confirm and save"); expect(host.textContent).toContain("1 receipt");
});

it("retains a waiver-bearing attempt when opening an unrelated duplicate receipt", async () => {
  const key = paymentAttemptKey("qa-owner", boot.sessionLabel);
  const pending = { input: { clientRequestId: "TEST-original-request", studentId: STUDENT_ID, sessionLabel: boot.sessionLabel, paymentDate: boot.today, mode: "cash" as const, amount: 500, quickDiscountAmount: 0, lateFeeWaiver: 1000, reference: "", remarks: "TEST waiver", receivedBy: boot.me.name, acknowledgeDuplicate: false }, form: { amount: "500", late: "waive", waiveReason: "TEST authorized reason" } };
  await writePaymentAttempt(key, pending); await render();
  actions.checkDeskPaymentAction.mockResolvedValue({ status: "not_saved" }); await click("Check whether");
  actions.postDeskPaymentAction.mockResolvedValue({ status: "duplicate", kind: "daily-amount", receiptId: receipt.id, receiptNumber: receipt.receiptNumber, createdAt: receipt.createdAt, amount: 500, mode: "cash", message: "TEST unrelated duplicate" });
  actions.loadReceiptAction.mockResolvedValue(receipt);
  await click("Confirm and save"); await click("Open that receipt");
  expect(await readPaymentAttempt(key, boot.sessionLabel)).toEqual(pending);
  expect(host.textContent).toContain("could not confirm whether this payment was saved");
});
