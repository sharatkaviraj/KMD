// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `useUrlState` follows the address bar as well as writing it (20 Oct smoke
 * run): a link to the same screen without `?view=` closes the month view,
 * and Back closes a sheet this hook opened.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/app/(app)/preferences/actions", () => ({ saveLanguageAction: vi.fn() }));
vi.mock("@/vx/screens/teach/actions", () => ({ previewLeaveVx: vi.fn(), requestLeaveVx: vi.fn() }));

import { useUrlState } from "@/vx/screens/teach/ui/shared";

let root: Root;
let host: HTMLDivElement;
function Probe() {
  const [value, set] = useUrlState<string>("view", null);
  return (
    <button type="button" onClick={() => set("history")}>
      {value ?? "none"}
    </button>
  );
}
const rerender = () => act(async () => root.render(<Probe />));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/teach/attendance?class=c&day=2026-10-19");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useUrlState", () => {
  it("pushes when it opens, so Back closes it", async () => {
    await rerender();
    const before = window.history.length;
    await act(async () => host.querySelector("button")!.click());
    expect(window.location.search).toContain("view=history");
    expect(window.history.length).toBe(before + 1);
    expect((window.history.state as { vxUrlState?: string }).vxUrlState).toBe("view");
  });

  it("follows the address bar when a link drops the param", async () => {
    window.history.replaceState(null, "", "/teach/attendance?class=c&day=2026-10-19&view=history");
    await rerender();
    expect(host.textContent).toBe("history");
    window.history.replaceState(null, "", "/teach/attendance?class=c&day=2026-10-18");
    await rerender();
    expect(host.textContent).toBe("none");
  });
});
