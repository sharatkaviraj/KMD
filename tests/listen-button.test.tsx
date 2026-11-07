// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/*
 * The Listen button on help sheets (D-497). A phone that cannot read the
 * words says so instead of sitting on Stop, and a late answer from an
 * earlier tap never flips a newer reading back to Listen.
 */
type Options = { onLine?: (i: number) => void; onEnd?: () => void; onFail?: () => void };
const state = vi.hoisted(() => ({ runs: [] as Options[], result: true as boolean }));
vi.mock("@/ui/feedback/cue", () => ({ cue: vi.fn() }));
vi.mock("@/ui/feedback/speak", () => ({
  canSpeak: () => true,
  stopSpeaking: vi.fn(),
  speakLines: async (_lines: string[], options: Options) => {
    state.runs.push(options);
    return state.result;
  },
}));
vi.mock("@/vx/icons", () => ({ Ic: () => null }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en) }) }));

import { ListenButton } from "@/vx/ui/listen";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  state.runs = [];
  state.result = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = () => host.querySelector("button") as HTMLButtonElement;
const tap = async () => {
  await act(async () => {
    button().click();
  });
};

it("says the device could not read it when speaking fails, and goes back to Listen", async () => {
  const onLine = vi.fn();
  act(() => root.render(<ListenButton lines={["Step one"]} onLine={onLine} />));
  await tap();
  expect(button().textContent).toContain("Stop");
  act(() => state.runs[0].onFail?.());
  expect(button().textContent).toContain("Listen");
  expect(host.querySelector("[role=status]")?.textContent).toMatch(/could not read these words aloud/);
  expect(onLine).toHaveBeenLastCalledWith(null);
});

it("shows the same note when the loaded voices have none for the words", async () => {
  state.result = false;
  act(() => root.render(<ListenButton lines={["Step one"]} />));
  await tap();
  expect(button().textContent).toContain("Listen");
  expect(host.querySelector("[role=status]")).not.toBeNull();
});

it("ignores a late end from an earlier tap", async () => {
  act(() => root.render(<ListenButton lines={["Step one"]} />));
  await tap();
  await tap();
  await tap();
  expect(state.runs).toHaveLength(2);
  expect(button().textContent).toContain("Stop");
  act(() => state.runs[0].onEnd?.());
  expect(button().textContent).toContain("Stop");
  act(() => state.runs[1].onEnd?.());
  expect(button().textContent).toContain("Listen");
  expect(host.querySelector("[role=status]")).toBeNull();
});
