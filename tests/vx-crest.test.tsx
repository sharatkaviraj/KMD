// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/* Review T01: the crest's accessible name and its fallback. */
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: { en: string }) => v.en }) }));
// Next's optimizer is not in a unit test; a plain image keeps the error event.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a stand-in for next/image in jsdom
  default: ({ src, alt, onError, style }: { src: string; alt: string; onError?: () => void; style?: React.CSSProperties }) => <img src={src} alt={alt} onError={onError} style={style} />,
}));

import { schoolBrand } from "@/platform/config/school-brand";
import { Crest } from "@/vx/screens/system/brand";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("is decorative beside a visible school name: no name of its own, an empty alt", async () => {
  await act(async () => root.render(<Crest size={42} radius={12} still />));
  const crest = host.firstElementChild as HTMLElement;
  expect(crest.getAttribute("role")).toBeNull();
  expect(crest.getAttribute("aria-label")).toBeNull();
  const img = host.querySelector("img")!;
  expect(img.getAttribute("alt")).toBe("");
  expect(img.getAttribute("src")).toBe(schoolBrand.logo);
});

it("is named for the school where it is the only identity on screen", async () => {
  await act(async () => root.render(<Crest size={38} radius={12} named />));
  const crest = host.firstElementChild as HTMLElement;
  expect(crest.getAttribute("role")).toBe("img");
  expect(crest.getAttribute("aria-label")).toBe("Shri Veer Patta Senior Secondary School");
});

it.each([false, true])("falls back to the design's VP monogram when the logo fails to load (named: %s)", async (named) => {
  await act(async () => root.render(<Crest size={40} radius={11} still named={named} />));
  await act(async () => { host.querySelector("img")!.dispatchEvent(new Event("error")); });
  const crest = host.firstElementChild as HTMLElement;
  expect(host.querySelector("img")).toBeNull();
  expect(crest.dataset.crest).toBe("monogram");
  expect(crest.textContent).toBe("VP");
  // The letters are drawn, not read out: the crest keeps its name (or its silence).
  expect(crest.querySelector('[aria-hidden="true"]')?.textContent).toBe("VP");
  expect(crest.getAttribute("aria-label")).toBe(named ? "Shri Veer Patta Senior Secondary School" : null);
  // The same tile: size and shape do not change.
  expect(crest.style.width).toBe("40px");
  expect(crest.style.borderRadius).toBe("11px");
});
