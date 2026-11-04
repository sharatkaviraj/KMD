// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLAUDE_CONNECTORS_URL, ConnectClaude, type ConnectClaudeWords } from "@/modules/mcp/ui/connect-claude";

/* The owner's "one tap" (4 Nov): copy One's address, open Claude's Connectors page, say what is left. */
const ADDRESS = "https://one.vpps.co.in/api/mcp";
const words: ConnectClaudeWords = {
  button: "Connect Claude",
  opened: "Claude opened in a new tab and the address is copied. There:",
  openedNoCopy: "Claude opened in a new tab. The address could not be copied for you — copy it below. There:",
  steps: ["Tap Add custom connector.", "Name it VPPS One and paste the address.", "Tap Add, then Connect, then tap Allow in VPPS One."],
  openAgain: "Open Claude again",
  once: "Do this once on a computer or in your phone's browser.",
};

let root: Root;
let host: HTMLDivElement;
const writeText = vi.fn();
const open = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeText.mockReset().mockResolvedValue(undefined);
  open.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.stubGlobal("open", open);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tap = () => act(async () => host.querySelector("button")!.click());

describe("ConnectClaude", () => {
  it("copies the address, opens Claude's Connectors page in a new tab, and says the three steps left", async () => {
    await act(async () => root.render(<ConnectClaude address={ADDRESS} words={words} />));
    expect(host.querySelector('[role="status"]')).toBeNull();
    await tap();
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(open).toHaveBeenCalledWith(CLAUDE_CONNECTORS_URL, "_blank", "noopener,noreferrer");
    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("the address is copied");
    expect(status.querySelectorAll("li")).toHaveLength(3);
    expect(status.querySelector("a")!.getAttribute("href")).toBe(CLAUDE_CONNECTORS_URL);
  });

  it("opens the tab even when the copy is refused, and says to copy by hand", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await act(async () => root.render(<ConnectClaude address={ADDRESS} words={words} />));
    await tap();
    expect(open).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')!.textContent).toContain("could not be copied");
  });

  it("never claims the connection is made — that comes from One's records", async () => {
    await act(async () => root.render(<ConnectClaude address={ADDRESS} words={words} />));
    await tap();
    expect(host.textContent).not.toMatch(/connected|allowed/i);
  });
});
