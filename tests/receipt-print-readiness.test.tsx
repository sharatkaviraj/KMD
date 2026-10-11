// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
import { ReceiptPrintActions } from "@/modules/receipts/ui/receipt-print-actions";

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/fees/receipts/original?print=1");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));
  vi.spyOn(window, "print").mockImplementation(() => undefined);
  const mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function lazyImage(decode: () => Promise<void>) {
  const image = document.createElement("img");
  image.loading = "lazy";
  Object.defineProperty(image, "complete", { configurable: true, get: () => false });
  image.decode = decode;
  document.body.append(image);
  return image;
}

describe("receipt auto-print image readiness", () => {
  it("starts lazy assets and still prints when a hidden or offline image never decodes", async () => {
    const image = lazyImage(() => new Promise<void>(() => undefined));
    await act(async () => root.render(<ReceiptPrintActions autoPrint />));
    expect(image.loading).toBe("eager");
    expect(window.print).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(3200));
    expect(window.print).toHaveBeenCalledExactlyOnceWith();
  });
  it("prints after ready images and two layout frames without waiting for the fallback", async () => {
    const decode = vi.fn(async () => undefined);
    lazyImage(decode);
    await act(async () => root.render(<ReceiptPrintActions autoPrint />));
    expect(decode).toHaveBeenCalledExactlyOnceWith();
    expect(window.print).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(40));
    expect(window.print).toHaveBeenCalledExactlyOnceWith();
  });
  it("does not print after the user leaves while an image is still loading", async () => {
    let finish!: () => void;
    lazyImage(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => root.render(<ReceiptPrintActions autoPrint />));
    await act(async () => root.unmount());
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(3200); });
    expect(window.print).not.toHaveBeenCalled();
  });
  it("cancels queued layout frames when auto-print is disabled", async () => {
    await act(async () => root.render(<ReceiptPrintActions autoPrint />));
    await act(async () => root.render(<ReceiptPrintActions autoPrint={false} />));
    await act(async () => vi.advanceTimersByTimeAsync(3200));
    expect(window.print).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not print the new location when an old receipt image settles late", async () => {
    let finish!: () => void;
    lazyImage(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => root.render(<ReceiptPrintActions autoPrint />));
    window.history.replaceState(null, "", "/fees/receipts/other?print=1");
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(3200); });
    expect(window.print).not.toHaveBeenCalled();
  });
  it("does not print twice when an image settles after the readiness timeout", async () => {
    let finish!: () => void;
    lazyImage(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => root.render(<ReceiptPrintActions autoPrint />));
    await act(async () => vi.advanceTimersByTimeAsync(3200));
    expect(window.print).toHaveBeenCalledExactlyOnceWith();
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(3200); });
    expect(window.print).toHaveBeenCalledExactlyOnceWith();
  });
  it("continues to print when decoding a receipt asset rejects", async () => {
    lazyImage(async () => { throw new Error("synthetic offline image"); });
    await act(async () => root.render(<ReceiptPrintActions autoPrint />));
    await act(async () => vi.advanceTimersByTimeAsync(40));
    expect(window.print).toHaveBeenCalledExactlyOnceWith();
  });
});
