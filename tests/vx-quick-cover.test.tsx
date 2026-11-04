// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void }) =>
    <a href={href} onClick={(e) => { e.preventDefault(); onClick?.(); }} {...rest}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ prefetch: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/ai/ui/lazy-quick-cover", () => ({ LazyQuickCover: () => null }));

import { QuickActions } from "@/vx/shell/bottom-bar";

let root: Root;
let host: HTMLDivElement;
let layer: HTMLDivElement;

beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  layer = document.createElement("div");
  layer.id = "vx-layer";
  document.body.append(layer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  layer.remove();
});

const keys = ["collect", "notice", "cover", "note"];
const buttonNamed = (text: string) =>
  Array.from(layer.querySelectorAll<HTMLElement>("button, a")).find((el) => el.textContent?.trim() === text) ?? null;

describe("the + sheet's Quick substitute", () => {
  it("is offered only with built-in AI cover, and replaces the plain Assign substitute tile", () => {
    act(() => root.render(<QuickActions open onClose={() => {}} keys={keys} />));
    expect(layer.textContent).toContain("Assign substitute");
    expect(layer.textContent).not.toContain("Quick substitute");

    act(() => root.render(<QuickActions open onClose={() => {}} keys={keys} onCover={() => {}} />));
    expect(layer.textContent).toContain("Quick substitute");
    expect(layer.textContent).not.toContain("Assign substitute");
    expect(buttonNamed("Arrange")?.getAttribute("href")).toBe("/substitutions/arrange");

    // Without the cover permission (no "cover" key) the row stays hidden even with AI on.
    act(() => root.render(<QuickActions open onClose={() => {}} keys={["collect"]} onCover={() => {}} />));
    expect(layer.textContent).not.toContain("Quick substitute");
  });

  it("opens the camera on the same tap and hands the photo over; Speak opens Bolo", () => {
    const onCover = vi.fn();
    const onClose = vi.fn();
    act(() => root.render(<QuickActions open onClose={onClose} keys={keys} onCover={onCover} />));
    const input = layer.querySelector<HTMLInputElement>('input[type="file"][capture="environment"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    act(() => buttonNamed("Photo")!.click());
    expect(click).toHaveBeenCalledOnce();
    expect(onCover).not.toHaveBeenCalled();

    const photo = new File(["register"], "register.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { configurable: true, value: [photo] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCover).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "photo", files: [photo] }));

    act(() => buttonNamed("Speak")!.click());
    expect(onCover).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "voice" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
