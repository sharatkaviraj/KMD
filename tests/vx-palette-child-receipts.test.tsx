// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiptHit, SearchResult } from "@/vx/shell/search-actions";

/*
 * S01: the phone's receipt cards under a name search arrive after the names,
 * from a second request, and never land under words that have since changed.
 * Synthetic records only.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => (typeof v === "string" ? v : v.en), lang: "en" }) }));
vi.mock("@/vx/icons", () => ({ Ic: () => null }));
vi.mock("@/vx/assist/ask-assist", () => ({ AskHint: () => null, AskRow: () => null }));
vi.mock("@/vx/shell/search-actions", () => ({ searchEverythingAction: vi.fn(), searchChildReceiptsAction: vi.fn() }));

import { SearchPalette } from "@/vx/shell/palette";

const child = "00000000-0000-4000-8000-0000000000c1";
const found = (q: string): SearchResult => ({
  students: [{ id: child, name: `Synthetic ${q}`, classLabel: "Class 7", sr: "0001", parent: null, href: `/students/${child}`, money: null }],
  receipts: [],
  actions: [],
  childReceiptsFor: child,
});
const receipt: ReceiptHit = { id: "qa-r1", number: "QA-0001", amount: 2400, student: "", date: "2026-10-02", mode: "upi", reversed: false, byChild: true, href: "/receipts/QA-0001" };

let root: Root;
let host: HTMLDivElement;
let layer: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  layer = document.createElement("div");
  layer.id = "vx-layer";
  document.body.append(layer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  layer.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function type(value: string) {
  const input = layer.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

describe("phone search receipts (S01)", () => {
  it("shows the names first, then the child's receipts from a second request", async () => {
    let deliver!: (value: { receipts: ReceiptHit[]; failed: boolean }) => void;
    const childReceipts = vi.fn(() => new Promise<{ receipts: ReceiptHit[]; failed: boolean }>((resolve) => { deliver = resolve; }));
    const search = vi.fn(async (q: string) => found(q));
    await act(async () => root.render(<SearchPalette items={[]} initialOpen search={search} childReceipts={childReceipts} />));
    await type("synthetic");
    expect(layer.textContent).toContain("Synthetic synthetic");
    expect(layer.querySelector(".vxp-rc")).toBeNull();
    expect(childReceipts).toHaveBeenCalledWith(child);
    await act(async () => deliver({ receipts: [receipt], failed: false }));
    expect(layer.querySelectorAll(".vxp-rc")).toHaveLength(1);
    expect(layer.textContent).toContain("QA-0001");
  });

  it("drops receipts that arrive after the words changed", async () => {
    const deliveries: ((value: { receipts: ReceiptHit[]; failed: boolean }) => void)[] = [];
    const childReceipts = vi.fn(() => new Promise<{ receipts: ReceiptHit[]; failed: boolean }>((resolve) => { deliveries.push(resolve); }));
    const search = vi.fn(async (q: string) => (q === "synthetic" ? found(q) : { students: [], receipts: [], actions: [] }));
    await act(async () => root.render(<SearchPalette items={[]} initialOpen search={search} childReceipts={childReceipts} />));
    await type("synthetic");
    await type("synthetix");
    await act(async () => deliveries[0]({ receipts: [receipt], failed: false }));
    expect(layer.querySelector(".vxp-rc")).toBeNull();
    expect(layer.textContent).not.toContain("QA-0001");
  });
});
