// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { boot, OTHER_ID, receipt, student, STUDENT_ID } from "./payment-parity.fixture";

const actions = vi.hoisted(() => ({ postDeskPaymentAction: vi.fn(), checkDeskPaymentAction: vi.fn(), loadStudentDeskAction: vi.fn(), loadReceiptAction: vi.fn(), loadDeskPreviewAction: vi.fn(), removePaymentAction: vi.fn(), sendReceiptWhatsappAction: vi.fn(), settleDeskSaveAction: vi.fn(), deskDayStateAction: vi.fn() }));
vi.mock("@/app/(app)/payments/actions", () => actions);
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ href, children, prefetch: _prefetch, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a href={href} {...p}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => typeof p === "string" ? p : p.en }), Bi: ({ en }: { en: string }) => <span>{en}</span> }));
import { PaymentDesk } from "@/vx/screens/payments/desk";
import { ToastProvider } from "@/vx/ui/overlays";
import { writePaymentAttempt, readPaymentAttempt, paymentAttemptKey } from "@/modules/payments/vx/attempt";
import { rupees } from "@/vx/format";

let root: Root; let host: HTMLDivElement;
async function render(props: Partial<React.ComponentProps<typeof PaymentDesk>> = {}) { await act(async () => root.render(<ToastProvider><PaymentDesk boot={{ ...boot, me: { ...boot.me, id: "qa-owner" } }} previewing={false} initialStudentId={STUDENT_ID} initialStudent={{ ok: true, student }} initialReceipt={null} {...props} /></ToastProvider>)); }
async function click(text: string) { const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(text)); expect(b, text).toBeDefined(); await act(async () => b!.click()); }
async function input(selector: string, value: string) { const el = host.querySelector<HTMLInputElement>(selector); expect(el, selector).not.toBeNull(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el!.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); window.history.replaceState({}, "", "/payments");
  // jsdom has no IDB. These confirmed-empty mirrors model successful earlier
  // recovery checks; a browser without either primary access or a mirror blocks.
  for (const owner of ["qa-owner", "qa-other-owner"]) for (const session of [boot.sessionLabel, "TEST-2025-26"]) localStorage.setItem(paymentAttemptKey(owner, session), JSON.stringify({ deleted: true, updatedAt: 0 }));
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
it("allows received-by edits and keeps them on Back without posting on Review; takes no counter concession", async () => {
  await render(); await input("#pd-amount", "500"); await input("#pd-received-by", "TEST Other Cashier");
  // Accountant B1: the concession never reached the balance, so the desk has
  // no box for it — only a note saying where a discount is set.
  expect(host.querySelector("#pd-concession")).toBeNull();
  expect(host.querySelector("#pd-concession-off")!.textContent).toContain("Concessions are not given here");
  await click("Review"); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
  // The review is the design's confirm sheet, drawn in #vx-layer beside the page.
  const review = document.querySelector("[role=dialog]")!.textContent;
  expect(review).toContain("TEST Other Cashier"); expect(review).not.toContain("Concession");
  await click("Change"); expect(host.querySelector<HTMLInputElement>("#pd-received-by")!.value).toBe("TEST Other Cashier");
  await click("Review"); await click("Save payment");
  expect(actions.postDeskPaymentAction.mock.calls[0][0]).toMatchObject({ amount: 500, quickDiscountAmount: 0, receivedBy: "TEST Other Cashier" });
  expect(actions.sendReceiptWhatsappAction).not.toHaveBeenCalled();
});
it("recovers the original unresolved request after student switch and reload", async () => {
  actions.postDeskPaymentAction.mockRejectedValue(new Error("TEST dropped response"));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  const original = actions.postDeskPaymentAction.mock.calls[0][0];
  await click("TEST Child B"); expect(host.textContent).toContain("unfinished payment");
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(document.body.textContent).toContain("could not confirm whether this payment was saved");
  actions.checkDeskPaymentAction.mockResolvedValue({ status: "not_saved" }); await click("Check whether");
  await click("Save payment"); expect(actions.postDeskPaymentAction.mock.calls[1][0]).toEqual(original);
});
it("does not permit fractional cash or a reference-only review to post", async () => {
  await render(); await input("#pd-amount", "123.50"); await click("Review");
  expect(actions.postDeskPaymentAction).not.toHaveBeenCalled(); expect(document.querySelector("[role=dialog]")).toBeNull();
  expect(host.querySelector<HTMLInputElement>("#pd-amount")!.value).toBe("123.50");
});
it("blocks collection until the selected date's authoritative dues arrive", async () => {
  let resolve!: (value: { ok: true; rows: typeof student.rows }) => void;
  actions.loadDeskPreviewAction.mockReturnValue(new Promise(yes => { resolve = yes; }));
  await render(); await click("Yesterday");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === "Review & save")!.disabled).toBe(true);
  expect(actions.loadDeskPreviewAction).toHaveBeenCalledWith({ studentId: STUDENT_ID, sessionLabel: boot.sessionLabel, paymentDate: "2026-10-10" });
  await act(async () => resolve({ ok: true, rows: student.rows.map(r => ({ ...r, lateFeePending: 0 })) }));
  await input("#pd-amount", "4100"); await click("Review"); expect(document.querySelector("[role=dialog]")).toBeNull();
  await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  expect(actions.postDeskPaymentAction.mock.calls[0][0]).toMatchObject({ paymentDate: "2026-10-10", lateFeeWaiver: 0 });
});
it("does not send money when recovery storage cannot be confirmed", async () => {
  await render(); await input("#pd-amount", "500"); await click("Review");
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Synthetic blocked storage"); });
  await click("Save payment"); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Payment saving is paused because recovery storage");
  spy.mockRestore(); await click("Retry recovery"); await click("Save payment");
  expect(actions.postDeskPaymentAction).toHaveBeenCalledTimes(1);
});

it("blocks an unsupported browser persistently, then retries when support is restored", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  await render(); expect(host.textContent).toContain("Payment saving is paused because this browser");
  await click("Review"); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_key: string, work: () => Promise<unknown>) => work() } });
  await click("Retry recovery"); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  expect(actions.postDeskPaymentAction).toHaveBeenCalledTimes(1);
});

it("does not keep a previous collector's attempt on an in-place identity change", async () => {
  actions.postDeskPaymentAction.mockRejectedValue(new Error("TEST dropped response"));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  const original = actions.postDeskPaymentAction.mock.calls[0][0];
  await render({ boot: { ...boot, me: { ...boot.me, id: "qa-other-owner" } } });
  expect(host.textContent).not.toContain("could not confirm whether this payment was saved");
  expect(host.querySelector<HTMLInputElement>("#pd-amount")!.value).not.toBe("500");
  expect(actions.postDeskPaymentAction).toHaveBeenCalledTimes(1);
  await render(); expect(document.body.textContent).toContain("could not confirm whether this payment was saved");
  expect((await readPaymentAttempt(paymentAttemptKey("qa-owner", boot.sessionLabel), boot.sessionLabel))?.input).toEqual(original);
});

it("preserves an existing receipt when initial recovery support is unavailable", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  await render({ initialReceipt: receipt });
  expect(host.textContent).toContain(receipt.receiptNumber);
  expect(host.textContent).toContain("Payment saving is paused because this browser");
  expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
});

it("invalidates an in-flight write before posting when the collector changes and restoration is blocked", async () => {
  await render(); await input("#pd-amount", "500"); await click("Review");
  let release!: () => Promise<unknown>;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (key: string, work: () => Promise<unknown>) => key.includes("qa-owner") ? new Promise(resolve => { release = async () => resolve(await work()); }) : new Promise(() => undefined) } });
  await click("Save payment");
  await render({ boot: { ...boot, me: { ...boot.me, id: "qa-other-owner" } } });
  await act(async () => { await release(); });
  expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
  expect((await readPaymentAttempt(paymentAttemptKey("qa-owner", boot.sessionLabel), boot.sessionLabel))?.input.amount).toBe(500);
});

it("does not apply an old collector's save response while the new scope restoration is blocked", async () => {
  let release!: (value: unknown) => void;
  actions.postDeskPaymentAction.mockReturnValue(new Promise(resolve => { release = resolve; }));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: () => new Promise(() => undefined) } });
  await render({ boot: { ...boot, me: { ...boot.me, id: "qa-other-owner" } } });
  await act(async () => release({ status: "saved", receipt, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null }));
  expect(host.textContent).not.toContain(receipt.receiptNumber);
  expect(actions.postDeskPaymentAction).toHaveBeenCalledTimes(1);
});

it("does not apply an old collector's check response while the new scope restoration is blocked", async () => {
  actions.postDeskPaymentAction.mockRejectedValue(new Error("TEST dropped response"));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  let release!: (value: unknown) => void;
  actions.checkDeskPaymentAction.mockReturnValue(new Promise(resolve => { release = resolve; }));
  await click("Check whether");
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: () => new Promise(() => undefined) } });
  await render({ boot: { ...boot, me: { ...boot.me, id: "qa-other-owner" } } });
  await act(async () => release({ status: "saved", receipt, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null }));
  expect(host.textContent).not.toContain(receipt.receiptNumber);
  expect(host.textContent).toContain("Checking payment recovery for this collector");
});

it("refreshes daily collection totals when the session changes in place", async () => {
  await render();
  await render({ boot: { ...boot, sessionLabel: "TEST-2025-26", todayCollection: { count: 3, amount: 1700 }, me: { ...boot.me, id: "qa-owner" } } });
  expect(host.querySelector<HTMLAnchorElement>('a[href="/receipts"]')!.textContent).toContain("3 receipts");
});
it("keeps preview and closed-session collection read-only", async () => {
  await render({ previewing: true }); await input("#pd-amount", "500"); await click("Review");
  expect(document.querySelector("[role=dialog]")).toBeNull(); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
  await render({ boot: { ...boot, canPost: false } }); await click("Review"); expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
});
it("uses the EMI shortcuts and takes no concession on an active plan", async () => {
  await render({ initialStudent: { ok: true, student: { ...student, onPlan: true, repaymentPlan: { planId: STUDENT_ID, scope: "old_and_current", paymentStatus: "on_track", monthlyAmount: 1000, remainingBalance: 3000, catchUpAmount: 2000, nextDueDate: "2026-11-01", nextDueAmount: 1000, missedInstallmentCount: 0, planReviewNeeded: false, coveredInstallmentIds: student.rows.map(r => r.id), duesOutsidePlan: null, duesOutsidePlanAmount: 0 } } } });
  expect(host.querySelector("#pd-concession")).toBeNull();
  await click("Monthly EMI"); expect(host.querySelector<HTMLInputElement>("#pd-amount")!.value).toBe("1,000");
  await click("Review"); await click("Save payment"); expect(actions.postDeskPaymentAction.mock.calls[0][0]).toMatchObject({ amount: 1000, quickDiscountAmount: 0, lateFeeWaiver: 0 });
});

it("uses authoritative collection totals after a restored request is retried", async () => {
  actions.postDeskPaymentAction.mockRejectedValueOnce(new Error("TEST request never reached server"));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  await act(async () => root.unmount()); root = createRoot(host); await render();
  actions.checkDeskPaymentAction.mockResolvedValue({ status: "not_saved" }); await click("Check whether");
  actions.postDeskPaymentAction.mockResolvedValue({ status: "saved", receipt, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null, todayCollection: { count: 1, amount: 500 } });
  await click("Save payment"); expect(host.textContent).toContain("1 receipt");
});

it("retains a waiver-bearing attempt when opening an unrelated duplicate receipt", async () => {
  const key = paymentAttemptKey("qa-owner", boot.sessionLabel);
  const pending = { input: { clientRequestId: "TEST-original-request", studentId: STUDENT_ID, sessionLabel: boot.sessionLabel, paymentDate: boot.today, mode: "cash" as const, amount: 500, quickDiscountAmount: 0, lateFeeWaiver: 1000, reference: "", remarks: "TEST waiver", receivedBy: boot.me.name, acknowledgeDuplicate: false }, form: { amount: "500", late: "waive", waiveReason: "TEST authorized reason" } };
  await writePaymentAttempt(key, pending); await render();
  actions.checkDeskPaymentAction.mockResolvedValue({ status: "not_saved" }); await click("Check whether");
  actions.postDeskPaymentAction.mockResolvedValue({ status: "duplicate", kind: "daily-amount", receiptId: receipt.id, receiptNumber: receipt.receiptNumber, createdAt: receipt.createdAt, amount: 500, mode: "cash", message: "TEST unrelated duplicate" });
  actions.loadReceiptAction.mockResolvedValue(receipt);
  await click("Save payment"); await click("Open that receipt");
  expect(await readPaymentAttempt(key, boot.sessionLabel)).toEqual(pending);
  expect(document.body.textContent).toContain("could not confirm whether this payment was saved");
});

it("shows the receipt number as soon as the payment posts and fills the receipt in afterwards (accountant B2)", async () => {
  let release: (v: unknown) => void = () => undefined;
  actions.postDeskPaymentAction.mockResolvedValue({ status: "saved", receipt: null, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null, settling: true });
  actions.settleDeskSaveAction.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  expect(document.body.textContent).toContain("Payment recorded. Updating balance…");
  expect(document.body.textContent).toContain(receipt.receiptNumber);
  expect(document.body.textContent).not.toContain("could not refresh");
  expect(actions.settleDeskSaveAction).toHaveBeenCalledWith(expect.objectContaining({ receiptId: receipt.id, studentId: STUDENT_ID }));
  await act(async () => release({ status: "saved", receipt, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: { pendingToday: 4500, dueToday: 0, notDueYet: 0, lateFee: 0 }, balanceSource: "live", balanceReadAt: "2026-10-11T10:00:05Z" }));
  expect(document.body.textContent).not.toContain("Updating balance");
  expect(document.body.textContent).toContain("Installment 1");
});

// B07: the balance after a save is the live ledger's, and the desk says so.
const LIVE_STUDENT = { ...student, rows: student.rows.map((r, i) => (i === 0 ? { ...r, feesPaid: 500, feesPending: 1500 } : r)), balanceSource: "live" as const, readAt: "2026-10-11T10:00:05Z" };
const LIVE_SETTLED = { status: "saved", receipt, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: LIVE_STUDENT, balanceAfter: { pendingToday: 1500, dueToday: 0, notDueYet: 2000, lateFee: 1000 }, balanceSource: "live", balanceReadAt: "2026-10-11T10:00:05Z", todayCollection: { count: 1, amount: 500 } };

it("says Updating balance while the live balance is read, then shows it as Balance now beside what the receipt recorded (B07)", async () => {
  let release: (v: unknown) => void = () => undefined;
  actions.postDeskPaymentAction.mockResolvedValue({ status: "saved", receipt: null, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null, settling: true });
  actions.settleDeskSaveAction.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  expect(document.getElementById("pd-balance-state")?.textContent).toContain("Payment recorded. Updating balance…");
  expect(document.getElementById("pd-balance-now")).toBeNull();
  await act(async () => release(LIVE_SETTLED));
  expect(document.getElementById("pd-balance-state")).toBeNull();
  const now = document.getElementById("pd-balance-now")!.textContent!;
  expect(now).toContain("Balance now");
  expect(now).toContain(rupees(1500));
  expect(now).toContain(rupees(1000));
  // The receipt's own figure stays the receipt's, labelled as such.
  const at = document.getElementById("pd-at-receipt")!.textContent!;
  expect(at).toContain("After this receipt");
  expect(at).toContain(rupees(receipt.outstandingAfter));
  expect(actions.postDeskPaymentAction).toHaveBeenCalledTimes(1);
});

it("says the balance could not refresh when the read fails, and Retry re-reads without posting again (B07)", async () => {
  actions.postDeskPaymentAction.mockResolvedValue({ status: "saved", receipt: null, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null, settling: true });
  let release: (v: unknown) => void = () => undefined;
  actions.settleDeskSaveAction
    .mockResolvedValueOnce(null)
    .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  expect(document.getElementById("pd-balance-state")?.textContent).toContain("Receipt saved. Balance could not refresh.");
  expect(document.getElementById("pd-balance-now")).toBeNull();
  // Two quick presses: one read, and never a post.
  const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Retry")!;
  expect(retry).toBeDefined();
  await act(async () => { retry.click(); retry.click(); });
  expect(actions.settleDeskSaveAction).toHaveBeenCalledTimes(2);
  expect(actions.settleDeskSaveAction).toHaveBeenLastCalledWith({ receiptId: receipt.id, receiptNumber: receipt.receiptNumber, studentId: STUDENT_ID, sessionLabel: boot.sessionLabel });
  expect(document.getElementById("pd-balance-state")?.textContent).toContain("Updating balance");
  await act(async () => release(LIVE_SETTLED));
  expect(document.body.textContent).not.toContain("could not refresh");
  expect(document.getElementById("pd-balance-now")!.textContent).toContain(rupees(1500));
  expect(actions.postDeskPaymentAction).toHaveBeenCalledTimes(1);
  expect(actions.checkDeskPaymentAction).not.toHaveBeenCalled();
});

it("does not show a snapshot balance as the balance now (B07)", async () => {
  actions.postDeskPaymentAction.mockResolvedValue({ status: "saved", receipt: null, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null, settling: true });
  actions.settleDeskSaveAction.mockResolvedValue({ ...LIVE_SETTLED, balanceSource: "snapshot" });
  await render(); await input("#pd-amount", "500"); await click("Review"); await click("Save payment");
  expect(document.getElementById("pd-balance-now")).toBeNull();
  expect(document.getElementById("pd-balance-state")?.textContent).toContain("Balance could not refresh.");
  expect(document.getElementById("pd-at-receipt")!.textContent).toContain(rupees(receipt.outstandingAfter));
});

it("posts once when Save payment is pressed twice", async () => {
  let release: (v: unknown) => void = () => undefined;
  actions.postDeskPaymentAction.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  actions.settleDeskSaveAction.mockResolvedValue(LIVE_SETTLED);
  await render(); await input("#pd-amount", "500"); await click("Review");
  const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Save payment"))!;
  await act(async () => { save.click(); save.click(); });
  await act(async () => { save.click(); });
  expect(actions.postDeskPaymentAction).toHaveBeenCalledTimes(1);
  await act(async () => release({ status: "saved", receipt: null, receiptId: receipt.id, receiptNumber: receipt.receiptNumber, student: null, balanceAfter: null, settling: true }));
  expect(actions.postDeskPaymentAction).toHaveBeenCalledTimes(1);
  expect(document.getElementById("pd-balance-now")!.textContent).toContain(rupees(1500));
});

it("warns on the review sheet before posting into a day already closed (accountant B17)", async () => {
  actions.deskDayStateAction.mockImplementation(async ({ date }: { date: string }) => ({ closed: date !== boot.today, closedAt: date !== boot.today ? "2026-10-10T19:03:00Z" : null }));
  await render(); await input("#pd-amount", "500"); await click("Review");
  expect(document.getElementById("pd-day-closed")).toBeNull();
  await click("Change"); await click("Yesterday"); await click("Review");
  expect(document.getElementById("pd-day-closed")?.textContent).toContain("is already closed");
  expect(actions.postDeskPaymentAction).not.toHaveBeenCalled();
});
