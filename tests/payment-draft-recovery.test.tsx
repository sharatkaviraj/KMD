// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { PaymentDeskClient, type PaymentDeskMobileProps } from "@/modules/payments/ui/payment-desk-mobile";
import { buildPaymentDraftKey, loadDraft, saveDraft, type PaymentDraftKeyParts } from "@/modules/payments/domain/draft-store";
import { flushDraftWrites } from "@/platform/drafts/store";
import { draftPageData, draftSummary } from "./payment-draft.fixture";
import { m } from "@/messages";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => "/fees/payments" }));
vi.mock("@/platform/locale/language-provider", () => ({ useLang: () => ({ locale: "en" }) }));
const control = vi.hoisted(() => ({ holds: [] as Array<() => void>, delayed: false, fail: false, delayClear: false }));
vi.mock("@/modules/payments/domain/draft-store", async importOriginal => {
  const actual = await importOriginal<typeof import("@/modules/payments/domain/draft-store")>();
  return { ...actual, loadDraft: async (parts: PaymentDraftKeyParts) => {
    if (control.delayed) await new Promise<void>(resolve => control.holds.push(resolve));
    if (control.fail) throw new Error("Storage unavailable");
    return actual.loadDraft(parts);
  }, clearDraft: async (parts: PaymentDraftKeyParts) => {
    await actual.clearDraft(parts);
    if (control.delayClear) await new Promise<void>(resolve => control.holds.push(resolve));
  } };
});

let root: Root;
let host: HTMLDivElement;
let props: PaymentDeskMobileProps;
const today = () => new Date().toISOString().slice(0, 10);
const parts = (studentId = "a", paymentDate = today(), ownerId = "qa-owner", sessionLabel = "QA-2026") => ({ ownerId, sessionLabel, studentId, paymentDate });
async function settle() { await act(async () => { await flushDraftWrites(); }); }
async function render() { await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><PaymentDeskClient {...props} /></NextIntlClientProvider>)); await settle(); }
async function seed(p: PaymentDraftKeyParts, amount = "222", paymentMode = "upi") { await saveDraft({ ...p, draft: { amountInput: amount, paymentMode, referenceNumber: "" } }); }
async function input(selector: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(selector)!;
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  }); await settle();
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.trim() === text);
  expect(button, text).toBeDefined(); await act(async () => button!.click()); await settle();
}
async function student(id: string) {
  const button = host.querySelector<HTMLButtonElement>(`[role="option"]:nth-child(${id.charCodeAt(0) - 96})`)!;
  expect(button).not.toBeNull(); await act(async () => button.click()); await settle();
}
async function reload() { await act(async () => root.unmount()); root = createRoot(host); await render(); }
async function release(index = 0) { await act(async () => control.holds.splice(index, 1)[0]()); await settle(); }
const amount = () => host.querySelector<HTMLInputElement>("#payment-amount")!.value;
const recovery = () => host.textContent?.includes(m.draftRestore.en);

beforeEach(() => {
  control.delayed = control.fail = control.delayClear = false; control.holds = [];
  localStorage.clear(); vi.stubGlobal("indexedDB", undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), addEventListener() {}, removeEventListener() {} }));
  HTMLElement.prototype.scrollIntoView = vi.fn(); HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const p = new URL(url, "http://localhost").searchParams;
    return { ok: true, json: async () => draftSummary(p.get("studentId") ?? "a", p.get("paymentDate") ?? today()) };
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { ownerId: "qa-owner", data: draftPageData, canPost: false, canViewDiagnostics: false, canWaiveLateFee: false,
    classOptions: [{ id: "qa-class", label: "QA class" }], workflowGuard: null,
    initialState: { status: "idle", message: null, receiptNumber: null, receiptId: null, studentId: null }, defaultReceivedBy: "QA clerk",
    submitPaymentEntryAction: vi.fn(), repairPaymentDeskStudentDuesAction: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); await flushDraftWrites(); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Rendering the complete desk exercises storage/effect ordering; give each
// multi-switch journey a bounded budget when the full suite shares the CPU.
describe("payment desk draft recovery", { timeout: 20_000 }, () => {
  it("preserves a switched student's durable draft under the prompt and after reload", async () => {
    await seed(parts("b")); await render(); await input("#payment-amount", "111"); await student("b");
    expect(recovery()).toBe(true); expect(await loadDraft(parts("b"))).toMatchObject({ amountInput: "222" });
    props = { ...props, data: { ...draftPageData, initialStudentId: "b", initialStudentSummary: draftSummary("b").student } };
    await reload(); expect(recovery()).toBe(true); await click(m.draftRestore.en); expect(amount()).toBe("222");
    expect(host.querySelector<HTMLSelectElement>("#payment-mode")!.value).toBe("upi");
    expect(await loadDraft(parts("a"))).toMatchObject({ amountInput: "111" });
  });
  it("preserves a date draft rather than overwriting it with the previous date's amount", async () => {
    await seed(parts("a", "2026-09-29"), "333"); await render(); await input("#payment-amount", "111");
    await input("#payment-date", "2026-09-29"); expect(recovery()).toBe(true);
    expect(await loadDraft(parts("a", "2026-09-29"))).toMatchObject({ amountInput: "333" });
    await input("#payment-date", today()); await input("#payment-date", "2026-09-29");
    expect(recovery()).toBe(true); await click(m.draftRestore.en); expect(amount()).toBe("333");
  });
  it("shows a neutral recovery message because payment drafts have no school-record baseline", async () => {
    await seed(parts()); await render(); expect(host.textContent).toContain(m.draftFound.en);
    expect(host.textContent).not.toContain(m.draftChanged.en);
  });
  it("discard clears the date draft without re-saving the previous amount, including reload", async () => {
    await seed(parts("a", "2026-09-29")); await render(); await input("#payment-amount", "111");
    await input("#payment-date", "2026-09-29"); await click(m.draftDiscard.en);
    expect(amount()).toBe(""); expect(await loadDraft(parts("a", "2026-09-29"))).toBeNull();
    await input("#payment-date", today()); await input("#payment-date", "2026-09-29"); expect(recovery()).toBe(false);
    await reload(); await input("#payment-date", "2026-09-29"); expect(recovery()).toBe(false);
  });
  it("ignores out-of-order loads across rapid A/B/C/A switches, including repeated keys", async () => {
    for (const [id, value] of [["a", "111"], ["b", "222"], ["c", "333"]]) await seed(parts(id), value);
    await render(); control.delayed = true;
    await student("b"); await student("c"); await student("a");
    expect(recovery()).toBe(false); expect(control.holds).toHaveLength(3);
    await release(2); expect(recovery()).toBe(true);
    await release(0); await release(0); control.delayed = false;
    await click(m.draftRestore.en); expect(amount()).toBe("111");
    expect(await loadDraft(parts("b"))).toMatchObject({ amountInput: "222" });
    expect(await loadDraft(parts("c"))).toMatchObject({ amountInput: "333" });
  });
  it("does not clear a draft while its read is delayed, even on visibility/unload", async () => {
    await seed(parts("b")); await render(); control.delayed = true; await student("b");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("beforeunload")); });
    await flushDraftWrites(); expect(JSON.parse(localStorage.getItem(buildPaymentDraftKey(parts("b")))!)).toMatchObject({ value: { amountInput: "222" } });
    await release(); control.delayed = false; expect(recovery()).toBe(true);
  });
  it.each(["owner", "session"])("isolates the %s boundary while loading and never carries the old amount", async boundary => {
    const target = boundary === "owner" ? parts("a", today(), "qa-other") : parts("a", today(), "qa-owner", "QA-2027");
    await seed(target, "444"); await render(); await input("#payment-amount", "111"); control.delayed = true;
    props = { ...props, ownerId: target.ownerId, data: { ...draftPageData, sessionLabel: target.sessionLabel } }; await render();
    expect(amount()).toBe(""); expect(recovery()).toBe(false); await release(); control.delayed = false;
    expect(await loadDraft(target)).toMatchObject({ amountInput: "444" }); await click(m.draftRestore.en); expect(amount()).toBe("444");
    props = { ...props, ownerId: "qa-owner", data: draftPageData }; await render(); await click(m.draftRestore.en); expect(amount()).toBe("111");
  });
  it("keeps a newer amount edit when a delayed read resolves", async () => {
    await seed(parts("b")); await render(); control.delayed = true; await student("b"); await input("#payment-amount", "555");
    await release(); control.delayed = false; expect(recovery()).toBe(false); expect(amount()).toBe("555");
    expect(await loadDraft(parts("b"))).toMatchObject({ amountInput: "555" });
  });
  it("does not authorize draft deletion after a failed read", async () => {
    await seed(parts("b")); await render(); control.fail = true; await student("b");
    expect(host.querySelector('[data-draft-storage-error="true"]')).not.toBeNull();
    control.fail = false; expect(await loadDraft(parts("b"))).toMatchObject({ amountInput: "222" });
  });
  it("ignores a late discard completion after switching to another recovery prompt", async () => {
    await seed(parts("a"), "111"); await seed(parts("b")); await render(); control.delayClear = true;
    await click(m.draftDiscard.en); await student("b"); expect(recovery()).toBe(true);
    control.delayClear = false; await release(); expect(recovery()).toBe(true);
    await click(m.draftRestore.en); expect(amount()).toBe("222");
  });
  it("does not erase a newer edit when discard completion arrives late", async () => {
    await seed(parts()); await render(); control.delayClear = true; await click(m.draftDiscard.en);
    await input("#payment-amount", "555"); control.delayClear = false; await release();
    expect(amount()).toBe("555"); expect(await loadDraft(parts())).toMatchObject({ amountInput: "555" });
  });
  it("leaves the previous amount behind at an empty owner boundary", async () => {
    await render(); await input("#payment-amount", "111"); props = { ...props, ownerId: "qa-other" }; await render();
    expect(amount()).toBe(""); expect(recovery()).toBe(false);
    expect(await loadDraft(parts("a", today(), "qa-other"))).toBeNull();
    expect(await loadDraft(parts())).toMatchObject({ amountInput: "111" });
  });
  it("retains a deselected student's saved amount for reload", async () => {
    await render(); await input("#payment-amount", "111"); await click("Change");
    expect(recovery()).toBe(false); expect(await loadDraft(parts())).toMatchObject({ amountInput: "111" });
    await reload(); expect(recovery()).toBe(true); await click(m.draftRestore.en); expect(amount()).toBe("111");
  });
});
