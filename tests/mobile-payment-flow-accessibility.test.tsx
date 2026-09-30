// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createPortal } from "react-dom";
import { ConfirmReceiptSheet } from "@/modules/payments/ui/confirm-receipt-sheet";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInr } from "@/platform/helpers/currency";
import { MobilePaymentFlowSheet } from "@/modules/payments/ui/mobile-payment-flow-sheet";

import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import hinglish from "@/messages/hi-en.json";
const catalogues = { en, hi, "hi-en": hinglish };
let locale: keyof typeof catalogues = "en";
vi.mock("@/ui/hooks/use-keyboard-offset", () => ({ useKeyboardOffset: () => 0 }));
vi.mock("@/modules/payments/ui/upi-qr-code", () => ({ UpiQrCode: () => null }));

type Props = React.ComponentProps<typeof MobilePaymentFlowSheet>;
const student = { id: "student-1", fullName: "Test student", admissionNo: "123", classId: "class-1", classLabel: "Class 1", studentStatus: "active" };
function makeProps(view: Props["view"]): Props {
  return {
    view, onClose: vi.fn(), onOpenClassPicker: vi.fn(), classOptions: [{ id: "class-1", label: "Class 1" }],
    selectedClassId: "class-1", onSelectClass: vi.fn(), studentSearchQuery: "", onStudentSearchChange: vi.fn(),
    filteredStudents: [student], recentStudents: [student], topVisibleOffset: 0, bottomVisibleOffset: 0,
    visibleStudentOptions: [student], firstVisibleStudentIndex: 0, activeStudentOptionIndex: 0,
    selectedStudentId: student.id, selectedStudentIndexItem: student, onSelectStudent: vi.fn(), onPrefetchStudent: vi.fn(),
    studentListRef: React.createRef(), studentSearchInputRef: React.createRef(), onStudentListScroll: vi.fn(),
    studentComboboxRowHeight: 52, studentListId: "student-options", studentSummaryLoading: false, selectedStudent: null,
    previewTotalPending: 900, previewOverdueAmount: 200, previewNextDue: null, previewBreakdown: [],
    pendingLateFeeAmount: 25, creditOrRefundAmount: 0, paymentAmountInput: "125.50", paymentMode: "cash",
    paymentDate: "2026-09-30", paymentDateIsBackdated: false, waiveFullLateFee: false, canWaiveLateFee: true,
    quickAmounts: [{ key: "full", amount: 900, disabled: false }, { key: "overdue", amount: 200, disabled: false }],
    allocationPreview: [{ installmentId: "inst-1", installmentNo: 1, installmentLabel: "Installment 1", dueDate: "2026-04-01", outstandingBefore: 200, allocatedAmount: 125.5, outstandingAfter: 74.5 }],
    remainingAfterPayment: 774.5, formError: null, isLockedAfterSuccess: false, canPost: true, draftValidationOk: true,
    confirmDisabled: false, latestReceiptToday: { id: "receipt-1", receiptNumber: "TEST-001", totalAmount: 25 },
    dismissedTodayReceiptId: null, onDismissTodayReceipt: vi.fn(), onAmountChange: vi.fn(), onSetPaymentMode: vi.fn(),
    onSetPaymentDate: vi.fn(), onToggleWaiveLateFee: vi.fn(), onQuickAmount: vi.fn(), onOpenConfirm: vi.fn(), onChangeStudent: vi.fn(),
    paymentModeOptions: [{ value: "cash", label: "Cash", Icon: () => null }, { value: "bank", label: "Bank", Icon: () => null }],
    previewLoading: false, getStudentPendingAmount: () => 900,
    getClassStats: () => ({ total: 1, pendingCount: 1, pendingTotal: 900 }), onBackToClassPicker: vi.fn(),
    onBackToStudentPicker: vi.fn(), lastPostedAmount: 125.5, onUseLastAmount: vi.fn(), isLastAmountArmed: false,
  };
}

let root: Root;
let host: HTMLDivElement;
let trigger: HTMLButtonElement;
let mobile = true;
let mediaListeners: Set<() => void>;
const confirmationBack = vi.fn();
function render(props: Props, confirmation = false) {
  act(() => root.render(<NextIntlClientProvider locale={locale} messages={catalogues[locale]} timeZone="Asia/Kolkata"><main className="mobile-app-main"><button id="background">Background</button></main><MobilePaymentFlowSheet {...props} />{confirmation ? createPortal(
    <ConfirmReceiptSheet open onBack={confirmationBack} isSubmitting={false} isDisabled={false} sessionLabel="2026-27" receiptPreviewAllocation={[]} confirmationSummary={{ studentName: student.fullName, admissionNo: student.admissionNo, classLabel: student.classLabel, amount: 125.5, pendingBeforeDiscount: 900, quickDiscountApplied: 0, lateFeeWaivedApplied: 0, revisedPendingBeforePayment: 900, paymentDate: props.paymentDate, paymentModeLabel: "Cash", referenceNumber: "", receivedBy: "Test clerk", remainingBalance: 774.5 }} />,
    document.body,
  ) : null}</NextIntlClientProvider>));
  act(() => vi.runOnlyPendingTimers());
}
function press(key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => document.dispatchEvent(event));
  return event;
}
function clickText(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === text);
  expect(button).toBeDefined();
  act(() => button!.click());
}
function setInput(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  locale = "en";
  confirmationBack.mockClear();
  mobile = true;
  mediaListeners = new Set();
  vi.stubGlobal("matchMedia", () => ({ matches: mobile, addEventListener: (_: string, callback: () => void) => mediaListeners.add(callback), removeEventListener: (_: string, callback: () => void) => mediaListeners.delete(callback) }));
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(HTMLElement.prototype, "inert", { configurable: true, get() { return this.hasAttribute("inert"); }, set(value: boolean) { this.toggleAttribute("inert", value); } });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) { return (this.hidden ? [] : [{}]) as unknown as DOMRectList; });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.hidden ? null : this.parentElement; } });
  host = document.createElement("div");
  trigger = document.createElement("button");
  trigger.textContent = "Collect payment";
  document.body.append(trigger, host);
  trigger.focus();
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); trigger.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("payment flow modal accessibility", () => {
  it.each([
    ["class-picker", "Collect Payment: choose class"],
    ["student-picker", "Collect Payment: choose student"],
    ["payment-entry", "Collect Payment: payment details"],
  ] as const)("names %s, contains keyboard focus and restores the opener", (view, name) => {
    const props = makeProps(view);
    render(props);
    const modal = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(modal).not.toBeNull();
    expect(modal.getAttribute("aria-label")).toBe(name);
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(host.inert).toBe(true);
    expect(modal.contains(document.activeElement)).toBe(true);
    const controls = Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]'));
    const close = modal.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    expect(close).not.toBeNull();
    expect(controls).toContain(close);
    controls.at(-1)!.focus();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls[0]);
    expect(press("Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls.at(-1));
    press("Escape");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    render({ ...props, view: null });
    expect(document.activeElement).toBe(trigger);
    expect(host.inert).toBe(false);
    expect(document.querySelector<HTMLElement>("main")!.style.overflow).toBe("");
  });

  it.each(["class-picker", "student-picker", "payment-entry"] as const)("provides an operable close button in %s", view => {
    const props = makeProps(view);
    render(props);
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("suspends behind confirmation without trapping or closing it, preserving the draft on resume", () => {
    const props = makeProps("payment-entry");
    render(props);
    const amount = document.querySelector<HTMLInputElement>('[aria-label="Amount received"]')!;
    render({ ...props, suspended: true }, true);
    const confirmation = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(confirmation.getAttribute("aria-label")).toBe("Confirm and save payment");
    expect(confirmation.closest("[inert]")).toBeNull();
    expect(amount.closest("[inert]")).not.toBeNull();
    const back = Array.from(confirmation.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Back / Edit"))!;
    back.focus();
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(back);
    // Actual confirmation listens on window, as a user key event would bubble.
    act(() => back.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(confirmationBack).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
    render(props);
    expect(document.querySelector('[aria-label="Amount received"]')).toBe(amount);
    expect(amount.value).toBe("125.50");
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === "Cash")!.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe("2026-09-30");
    expect(document.querySelector('[data-allocation-strip]')?.textContent).toContain(formatInr(774.5));
    expect(host.inert).toBe(true);
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
    press("Escape");
    expect(props.onClose).toHaveBeenCalledOnce();
    render({ ...props, view: null });
    expect(document.activeElement).toBe(trigger);
  });

  it("releases modal ownership at tablet width and safely resumes the phone draft", () => {
    const props = makeProps("payment-entry");
    render(props);
    act(() => { mobile = false; for (const notify of mediaListeners) notify(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.inert).toBe(false);
    expect(document.querySelector<HTMLElement>("main")!.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
    press("Escape");
    expect(props.onClose).not.toHaveBeenCalled();
    act(() => { mobile = true; for (const notify of mediaListeners) notify(); });
    act(() => vi.runOnlyPendingTimers());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[aria-label="Amount received"]')!.value).toBe("125.50");
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe("2026-09-30");
    expect(host.inert).toBe(true);
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
  });

  it("includes visible fixed-position payment controls in the focus loop", () => {
    render(makeProps("payment-entry"));
    const modal = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const collect = Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes(`Collect ${formatInr(125.5)}`))!;
    collect.style.position = "fixed";
    Object.defineProperty(collect, "offsetParent", { configurable: true, get: () => null });
    collect.focus();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
    expect(press("Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(collect);
  });

  it("retains class and student selection, search, recent amount and back callbacks", () => {
    const props = makeProps("class-picker");
    render(props);
    const classButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.startsWith("Class 1"))!;
    act(() => classButton.click());
    expect(props.onSelectClass).toHaveBeenCalledWith("class-1");
    setInput(document.querySelector<HTMLInputElement>('[aria-label="Search students directly"]')!, "Test");
    expect(props.onStudentSearchChange).toHaveBeenCalledWith("Test");
    render({ ...props, view: "student-picker" });
    clickText("Change class");
    expect(props.onOpenClassPicker).toHaveBeenCalledOnce();
    act(() => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(props.onSelectStudent).toHaveBeenCalledWith("student-1");
    const reuse = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.startsWith("Use ₹"))!;
    act(() => reuse.click());
    expect(props.onUseLastAmount).toHaveBeenCalledOnce();
  });

  it("preserves controlled payment fields, allocation and all payment callbacks", () => {
    const props = makeProps("payment-entry");
    render(props);
    const amount = document.querySelector<HTMLInputElement>('[aria-label="Amount received"]')!;
    expect(amount.value).toBe("125.50");
    setInput(amount, "321.75");
    expect(props.onAmountChange).toHaveBeenCalledWith("321.75");
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(date.value).toBe("2026-09-30");
    setInput(date, "2026-09-29");
    expect(props.onSetPaymentDate).toHaveBeenCalledWith("2026-09-29");
    clickText("Bank");
    expect(props.onSetPaymentMode).toHaveBeenCalledWith("bank");
    clickText("Waive (admin)");
    expect(props.onToggleWaiveLateFee).toHaveBeenCalledOnce();
    clickText("Dismiss");
    expect(props.onDismissTodayReceipt).toHaveBeenCalledWith("receipt-1");
    clickText("Change");
    expect(props.onChangeStudent).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-allocation-strip]")?.textContent).toContain("Inst 1 (part)");
    expect(document.querySelector("[data-allocation-strip]")?.textContent).toContain(formatInr(774.5));
    const quick = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("₹900"))!;
    act(() => quick.click());
    expect(props.onQuickAmount).toHaveBeenCalledWith(900);
    const collect = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes(`Collect ${formatInr(125.5)}`))!;
    act(() => collect.click());
    expect(props.onOpenConfirm).toHaveBeenCalledOnce();
    expect(props.onAmountChange).toHaveBeenCalledTimes(1);
    expect(props.onSetPaymentMode).toHaveBeenCalledTimes(1);
  });

  it.each(["class-picker", "student-picker", "payment-entry"] as const)("blocks close, Escape and backdrop during posting in %s", view => {
    const props = { ...makeProps(view), isPosting: true };
    render(props);
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
    expect(close.disabled).toBe(true);
    act(() => close.click());
    press("Escape");
    act(() => document.querySelector<HTMLElement>("[data-payment-flow-backdrop]")?.click());
    expect(props.onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("allows dismissal after the payment has finished and is locked", () => {
    const props = { ...makeProps("payment-entry"), isLockedAfterSuccess: true, isPosting: false };
    render(props);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.disabled).toBe(false);
    press("Escape");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it.each(["en", "hi", "hi-en"] as const)("localizes modal titles and input/close names in %s", language => {
    locale = language;
    const messages = catalogues[language];
    const props = makeProps("class-picker");
    render(props);
    expect(document.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe(messages.MobileApp.paymentFlowClassDialog);
    expect(document.querySelector("h2")!.textContent).toBe(messages.MobileApp.paymentFlowTitle);
    expect(document.querySelector('input')!.getAttribute("aria-label")).toBe(messages.MobileApp.paymentFlowSearchDirect);
    expect(document.querySelector('button[aria-label]')!.getAttribute("aria-label")).toBe(messages.Common.close);
    render({ ...props, view: "student-picker" });
    expect(document.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe(messages.MobileApp.paymentFlowStudentDialog);
    expect(document.querySelector("h2")!.textContent).toBe(messages.MobileApp.paymentFlowStudentTitle);
    expect(document.querySelector('[role="combobox"]')!.getAttribute("aria-label")).toBe(messages.MobileApp.paymentFlowSearchClass);
    render({ ...props, view: "payment-entry" });
    expect(document.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe(messages.MobileApp.paymentFlowEntryDialog);
    expect(document.querySelector("h2")!.textContent).toBe(messages.MobileApp.paymentFlowEntryTitle);
    expect(document.querySelector('input[type="date"]')!.getAttribute("aria-label")).toBe(messages.MobileApp.paymentFlowDateLabel);
    expect(document.querySelector('input[inputmode="decimal"]')!.getAttribute("aria-label")).toBe(messages.MobileApp.paymentFlowAmountLabel);
  });

  it.each([{ isPosting: true }, { confirmDisabled: true }, { draftValidationOk: false }, { isLockedAfterSuccess: true }, { studentSummaryLoading: true }])("retains disabled Collect guard %j", guard => {
    const props = { ...makeProps("payment-entry"), ...guard };
    render(props);
    const collect = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Collect ₹") || button.textContent?.includes("Saving payment"))!;
    expect(collect.disabled).toBe(true);
    act(() => collect.click());
    expect(props.onOpenConfirm).not.toHaveBeenCalled();
  });
});
