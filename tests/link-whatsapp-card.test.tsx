// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StartedLink, WhatsappLinkCard } from "@/modules/whatsapp/data/staff-link";

/**
 * The Link my WhatsApp card (D-582) as a person meets it: one green button,
 * the three steps, the wait, then "linked" by itself. The server actions are
 * stand-ins; every number here is made up (rule 6).
 */

const actions = vi.hoisted(() => ({
  startWhatsappLinkAction: vi.fn(),
  whatsappLinkStatusAction: vi.fn(),
  cancelWhatsappLinkAction: vi.fn(),
  stopWhatsappAction: vi.fn(),
  resumeWhatsappAction: vi.fn(),
}));
const show = vi.hoisted(() => vi.fn());

vi.mock("@/app/(app)/preferences/whatsapp-link-actions", () => actions);
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show }) }));
vi.mock("@/ui/feedback/cue", () => ({ cue: vi.fn() }));

import { LinkWhatsapp } from "@/vx/ui/link-whatsapp";

const NOW = new Date("2026-11-12T06:30:00Z");
const LINK: StartedLink = {
  code: "ABCD2345",
  shown: "ABCD-2345",
  message: "Hello! Please link my WhatsApp to VPPS One.\nCode: ABCD-2345",
  url: "https://wa.me/918302207823?text=Hello",
  qr: "data:image/svg+xml;base64,PHN2Zy8+",
  expiresAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
  to: "+91 83022 07823",
};
const NONE: WhatsappLinkCard = { state: "none", number: null, since: null, source: null };
const LINKED: WhatsappLinkCard = { state: "linked", number: "+91 ••••• •0002", since: "2026-11-12T06:31:00Z", source: "whatsapp" };

let root: Root;
let host: HTMLDivElement;

const card = () => host.querySelector<HTMLElement>('[data-testid="link-whatsapp"]');
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) ?? null;

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
}
/** Let the clock pass, and every promise it started settle. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  for (const fn of Object.values(actions)) fn.mockReset();
  show.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Link my WhatsApp", () => {
  it("starts with the three steps and one green button, then shows the code and opens WhatsApp as a real link", async () => {
    actions.startWhatsappLinkAction.mockResolvedValue({ ok: true, link: LINK });
    actions.whatsappLinkStatusAction.mockResolvedValue({ ok: true, status: { state: "waiting", expiresAt: LINK.expiresAt }, card: null });
    await render(<LinkWhatsapp card={NONE} pending={null} live={false} />);

    expect(card()?.dataset.state).toBe("none");
    expect(host.textContent).toContain("Tap the green button");
    expect(host.textContent).toContain("Press Send. That is all.");
    expect(host.textContent).toContain("Nothing is sent until you press Send");

    await click(host.querySelector('[data-testid="link-whatsapp-start"]'));
    expect(actions.startWhatsappLinkAction).toHaveBeenCalledTimes(1);
    expect(card()?.dataset.state).toBe("waiting");
    expect(host.textContent).toContain("ABCD-2345");
    const open = host.querySelector<HTMLAnchorElement>('[data-testid="link-whatsapp-open"]');
    expect(open?.getAttribute("href")).toBe(LINK.url);
    expect(open?.getAttribute("target")).toBe("_blank");
    expect(host.querySelector("pre")?.textContent).toBe(LINK.message);
    // The number is held together by no-break spaces, so it never wraps across two lines.
    expect(host.textContent).toContain("Send this message to +91\u00a083022\u00a007823");
    expect(host.querySelector<HTMLImageElement>(".lw-qr img")?.getAttribute("src")).toBe(LINK.qr);
  });

  it("asks every few seconds while it waits, and turns into Linked by itself", async () => {
    actions.whatsappLinkStatusAction
      .mockResolvedValueOnce({ ok: true, status: { state: "waiting", expiresAt: LINK.expiresAt }, card: null })
      .mockResolvedValueOnce({ ok: true, status: { state: "linked", number: "+91 ••••• •0002" }, card: LINKED });
    await render(<LinkWhatsapp card={NONE} pending={LINK} live={false} />);
    expect(card()?.dataset.state).toBe("waiting");
    expect(host.textContent).toContain("Waiting for your message");

    await wait(3000);
    expect(actions.whatsappLinkStatusAction).toHaveBeenCalledWith("ABCD2345");
    expect(card()?.dataset.state).toBe("waiting");

    await wait(3000);
    expect(card()?.dataset.state).toBe("linked");
    expect(host.textContent).toContain("WhatsApp linked");
    expect(host.textContent).toContain("+91 ••••• •0002");
    expect(host.textContent).toContain("linked from your phone");
    // Nothing reaches staff yet, and the card says so rather than promising messages.
    expect(host.textContent).toContain("has not switched these messages on yet");
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ text: "Your WhatsApp is linked", cue: "done" }));

    // Linked: it stops asking.
    const calls = actions.whatsappLinkStatusAction.mock.calls.length;
    await wait(9000);
    expect(actions.whatsappLinkStatusAction.mock.calls.length).toBe(calls);
  });

  it("checks at once when the person comes back from WhatsApp", async () => {
    actions.whatsappLinkStatusAction.mockResolvedValue({ ok: true, status: { state: "linked", number: "+91 ••••• •0002" }, card: LINKED });
    await render(<LinkWhatsapp card={NONE} pending={LINK} live />);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(card()?.dataset.state).toBe("linked");
    expect(host.textContent).toContain("Parents' questions meant for you come here between 6 am and 9 pm");
  });

  it("says the code ran out after 30 minutes and offers a new one", async () => {
    actions.whatsappLinkStatusAction.mockResolvedValue({ ok: true, status: { state: "waiting", expiresAt: LINK.expiresAt }, card: null });
    await render(<LinkWhatsapp card={NONE} pending={LINK} live={false} />);
    await wait(31 * 60_000);
    expect(card()?.dataset.state).toBe("expired");
    expect(button("Make a new code")).not.toBeNull();
  });

  it("cancel takes the code away and goes back to the start", async () => {
    actions.cancelWhatsappLinkAction.mockResolvedValue({ ok: true });
    actions.whatsappLinkStatusAction.mockResolvedValue({ ok: true, status: { state: "waiting", expiresAt: LINK.expiresAt }, card: null });
    await render(<LinkWhatsapp card={NONE} pending={LINK} live={false} />);
    await click(button("Cancel"));
    expect(actions.cancelWhatsappLinkAction).toHaveBeenCalledTimes(1);
    expect(card()?.dataset.state).toBe("none");
  });

  it("asks once before stopping, then says it stopped", async () => {
    actions.stopWhatsappAction.mockResolvedValue({ ok: true, card: { ...LINKED, state: "stopped", since: "2026-11-13T06:00:00Z" } });
    await render(<LinkWhatsapp card={LINKED} pending={null} live={false} />);
    await click(button("Stop WhatsApp"));
    expect(actions.stopWhatsappAction).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Stop all WhatsApp from the school app?");
    await click(button("Yes, stop"));
    expect(actions.stopWhatsappAction).toHaveBeenCalledTimes(1);
    expect(card()?.dataset.state).toBe("stopped");
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ text: "WhatsApp turned off" }));
    expect(button("Turn on again")).not.toBeNull();
  });

  it("seeing One as somebody else: no code from their screen, and nothing to press", async () => {
    await render(<LinkWhatsapp card={NONE} pending={LINK} live={false} lookOnly />);
    expect(card()?.dataset.state).toBe("none");
    expect(host.textContent).not.toContain("ABCD-2345");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="link-whatsapp-start"]')?.disabled).toBe(true);
    expect(host.textContent).toContain("You are seeing One as this person");
    await wait(6000);
    expect(actions.whatsappLinkStatusAction).not.toHaveBeenCalled();
  });

  it("a code that could not be made says so and offers to try again", async () => {
    actions.startWhatsappLinkAction.mockResolvedValue({ ok: false, why: "failed" });
    await render(<LinkWhatsapp card={NONE} pending={null} live={false} />);
    await click(host.querySelector('[data-testid="link-whatsapp-start"]'));
    expect(card()?.dataset.state).toBe("failed");
    expect(button("Try again")).not.toBeNull();
  });
});
