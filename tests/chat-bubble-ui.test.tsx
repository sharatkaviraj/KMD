// @vitest-environment jsdom
import * as React from "react";
import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { ChatListItem, ChatThreadData } from "@/vx/screens/chats/view";
import type { BubbleState } from "@/vx/shell/chat-bubble-logic";

/*
 * The chat bubble and its panel in a browser (D-641): when the bubble speaks
 * up and what its card opens, that it stands aside on Chats and for a person
 * with no desk, that a drag leaves it where it was put, and that the panel's
 * phone Back, links and Escape behave; and that seeing One as somebody else
 * starts it afresh with their number and their card (D-642). Test data only
 * (rule 6); the network is mocked and nothing leaves the test.
 */

const scene = vi.hoisted(() => ({ path: "/teach", push: vi.fn(), cue: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => scene.path,
  useRouter: () => ({ push: scene.push, replace() {}, refresh() {}, back() {}, prefetch() {} }),
}));
// The panel's code through React.lazy, so a test waits for it the way a phone does.
vi.mock("next/dynamic", async () => {
  const { lazy, Suspense: Wait, createElement } = await import("react");
  return {
    default: (load: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
      const Lazy = lazy(async () => ({ default: await load() }));
      return (props: Record<string, unknown>) => createElement(Wait, { fallback: null }, createElement(Lazy, props));
    },
  };
});
vi.mock("@/ui/feedback/cue", () => ({ cue: scene.cue }));
vi.mock("@/ui/link", () => ({
  default: ({ href, children, className, onClick }: { href: string; children: React.ReactNode; className?: string; onClick?: () => void }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/ui/child-avatar", () => ({ ChildAvatar: () => null }));
vi.mock("@/vx/screens/chats/row", () => ({ ChatRowBody: ({ item }: { item: { name: string } }) => <span className="row-name">{item.name}</span> }));
vi.mock("@/vx/screens/chats/thread", () => ({
  ChatThread: ({ data, onBack, onChanged }: { data: { id: string; title: string }; onBack: () => void; onChanged: () => void }) => (
    <section data-thread={data.id}>
      <h2>{data.title}</h2>
      <button type="button" onClick={onBack}>
        Back to the list
      </button>
      <button type="button" onClick={onChanged}>
        Send reply
      </button>
      {/* Chats' child link is a Next Link: a plain anchor once drawn. */}
      {React.createElement("a", { href: "/students/test-child" }, "Open the child")}
    </section>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realTimeout = globalThis.setTimeout.bind(globalThis);
const realWait = (ms: number) =>
  new Promise<void>((resolve) => {
    realTimeout(resolve, ms);
  });

type Reply = { status?: number; body: unknown };
let routes: Record<string, Reply> = {};
let root: Root;
let host: HTMLDivElement;
let layer: HTMLDivElement;
let phone = true;
let go: Mock<(delta?: number) => void>;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  scene.path = "/teach";
  scene.push.mockReset();
  scene.cue.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  phone = true;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  routes = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: string) => {
    const url = String(input);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    const reply = key ? routes[key] : { status: 404, body: null };
    const status = reply.status ?? 200;
    return { ok: status < 400, status, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  // History is the browser's: a test plays the phone's Back with a popstate of its own.
  go = vi.fn<(delta?: number) => void>();
  vi.spyOn(window.history, "go").mockImplementation(go);
  vi.spyOn(window.history, "back").mockImplementation(() => go(-1));
  window.history.replaceState(null, "");
  layer = document.createElement("div");
  layer.id = "vx-layer";
  document.body.appendChild(layer);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  layer.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------- helpers */

const me = { name: "Test Teacher", previewing: false, canOpenChild: true, seesAll: false };
const item = (id: string, name: string, status: "waiting" | "open" | "done" = "waiting") =>
  ({ id, name, status, children: null, studentId: null, initial: "T", deskLabel: { en: "Class desk", hi: "कक्षा डेस्क" } }) as unknown as ChatListItem;
const listBody = (items: ChatListItem[], over: Record<string, unknown> = {}) => ({
  kind: "list",
  enabled: true,
  items,
  waiting: items.filter((row) => row.status === "waiting").length,
  more: 0,
  viewingTest: true,
  me,
  ...over,
});
const threadBody = (id: string, title: string) => ({ kind: "chat", data: { id, title } as unknown as ChatThreadData, me });
const latest = (over: Record<string, unknown> = {}) => ({
  chatId: "chat-1",
  name: "Test Parent One",
  children: "Test Child · Class 6",
  preview: { en: "Is there school tomorrow?", hi: "क्या कल स्कूल है?" },
  at: "2026-11-15T09:30:00.000Z",
  ...over,
});

const fetched = (url: string) => fetchMock.mock.calls.some(([asked]) => String(asked) === url);
const peeked = () => JSON.parse(window.sessionStorage.getItem("vx.chats.peeked") ?? "null") as unknown;
const bubble = () => document.querySelector<HTMLDivElement>(".vx-cb");
const card = () => document.querySelector<HTMLDivElement>(".vx-cb-peek");
const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".vx-cp button.chat-row")];

/** Waits for the screen to catch up, moving a faked clock along a little too. */
async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(5);
      await realWait(4);
    });
  }
  throw new Error(`never saw ${what}:\n${document.body.innerHTML.slice(0, 3000)}`);
}

async function later(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function tap(element: Element | null | undefined, what: string) {
  if (!(element instanceof HTMLElement)) throw new Error(`no ${what} in:\n${document.body.innerHTML.slice(0, 3000)}`);
  await act(async () => element.click());
}

const byText = (selector: string, text: string) => [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.includes(text));

async function popTo(state: unknown) {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
}

async function mountBubble(state: BubbleState, options: { since?: string; lookOnly?: boolean } = {}) {
  const { ChatBubble } = await import("@/vx/shell/chat-bubble");
  const served = Promise.resolve(state);
  await act(async () => {
    root.render(
      <Suspense fallback={null}>
        <ChatBubble state={served} since={options.since ?? "2026-11-15T10:00:00.000Z"} lookOnly={options.lookOnly ?? false} />
      </Suspense>,
    );
  });
}

/** What the menu's badges read: the live number for the shell's person and year. */
function Probe({ useCount }: { useCount: () => number | null }) {
  const n = useCount();
  return <span className="probe">{n === null ? "none" : String(n)}</span>;
}
const probe = () => document.querySelector(".probe")?.textContent;

/** The bubble as the shell draws it for one person and year (D-642): a new shell for each. */
async function mountAs(who: string, state: BubbleState, options: { since?: string; lookOnly?: boolean } = {}) {
  const { ChatBubble } = await import("@/vx/shell/chat-bubble");
  const { LiveChatScope, useLiveChatCount } = await import("@/vx/shell/chat-live");
  const served = Promise.resolve(state);
  await act(async () => {
    root.render(
      <LiveChatScope who={who}>
        <Probe useCount={useLiveChatCount} />
        <Suspense fallback={null}>
          <ChatBubble key={who} state={served} since={options.since ?? "2026-11-15T10:00:00.000Z"} lookOnly={options.lookOnly ?? false} />
        </Suspense>
      </LiveChatScope>,
    );
  });
}

async function mountPanel(options: { start?: string | null; lookOnly?: boolean } = {}) {
  const { ChatPanel } = await import("@/vx/shell/chat-panel");
  const onClose = vi.fn();
  const onActivity = vi.fn();
  await act(async () => {
    root.render(
      <ChatPanel start={options.start ?? null} since="2026-11-15T10:00:00.000Z" lookOnly={options.lookOnly ?? false} onClose={onClose} onActivity={onActivity} />,
    );
  });
  return { onClose, onActivity };
}

function fakeClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-15T10:00:05.000Z"));
}

function appBadge() {
  const set = vi.fn(async () => undefined);
  const clear = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "setAppBadge", { value: set, configurable: true });
  Object.defineProperty(navigator, "clearAppBadge", { value: clear, configurable: true });
  return { set, clear };
}

/* ------------------------------------------------------------- the bubble */

describe("the bubble speaks up", () => {
  it("says who is waiting a moment after One opens, and Reply opens that chat over the screen", async () => {
    fakeClock();
    const badge = appBadge();
    routes = {
      "/chats/pulse": { body: { waiting: 1, enabled: true, latest: latest() } },
      "/chats/panel": { body: listBody([item("chat-1", "Test Parent One")]) },
      "/chats/thread": { body: threadBody("chat-1", "Test Parent One") },
    };
    await mountBubble({ waiting: 1, enabled: true, hasDesk: true });
    await waitFor(() => bubble() !== null, "the bubble");
    expect(document.querySelector(".vx-cb-n")?.textContent).toBe("1");
    expect(document.querySelector(".vx-cb-btn")?.getAttribute("aria-label")).toContain("1 parent waiting");
    expect(badge.set).toHaveBeenCalledWith(1);
    expect(card()).toBeNull();

    await later(1_300);
    await waitFor(() => card() !== null, "the card");
    expect(fetched("/chats/pulse")).toBe(true);
    expect(card()?.textContent).toContain("1 parent is waiting for your reply");
    expect(card()?.textContent).toContain("Test Parent One");
    expect(card()?.textContent).toContain("Test Child · Class 6");
    expect(card()?.textContent).toContain("Is there school tomorrow?");
    // Never moved yet: the card says it can be.
    expect(card()?.textContent).toContain("press and drag");
    // Said once a visit (outside a shell, to nobody in particular).
    expect(peeked()).toEqual([""]);

    await tap(byText(".vx-cb-peek button", "Reply"), "Reply");
    await waitFor(() => document.querySelector("[data-thread='chat-1']") !== null, "the chat in the panel");
    expect(fetched("/chats/thread?c=chat-1&open=1")).toBe(true);
    expect(card()).toBeNull();
    // The bubble steps aside while its panel is open.
    expect(bubble()?.hasAttribute("data-away")).toBe(true);
    expect(document.querySelector(".vx-cb-btn")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("with many waiting, the card opens the list, and a big number stays short", async () => {
    fakeClock();
    routes = {
      "/chats/pulse": { body: { waiting: 120, enabled: true, latest: latest() } },
      "/chats/panel": { body: listBody([item("chat-1", "Test Parent One"), item("chat-2", "Test Parent Two")], { waiting: 120, more: 118 }) },
      "/chats/thread": { body: threadBody("chat-2", "Test Parent Two") },
    };
    await mountBubble({ waiting: 120, enabled: true, hasDesk: true });
    await waitFor(() => bubble() !== null, "the bubble");
    expect(document.querySelector(".vx-cb-n")?.textContent).toBe("99+");
    await later(1_300);
    await waitFor(() => card() !== null, "the card");
    expect(card()?.textContent).toContain("120 parents are waiting for your reply");

    await tap(byText(".vx-cb-peek button", "Open chats"), "Open chats");
    await waitFor(() => rows().length === 2, "the list");
    expect(document.querySelector(".vx-cp-sub")?.textContent).toBe("120 parents waiting for your reply");
    expect(document.querySelector(".vx-cp-more")?.textContent).toBe("118 more");
    expect(fetched("/chats/thread?c=chat-1&open=1")).toBe(false);

    // A chat, then the phone's Back to the list, then Back again closes it all.
    const mark = (window.history.state as { __vxChats: { id: number; at: string } }).__vxChats;
    expect(mark.at).toBe("list");
    await tap(rows()[1], "the second row");
    expect((window.history.state as { __vxChats: { at: string } }).__vxChats.at).toBe("chat");
    await waitFor(() => document.querySelector("[data-thread='chat-2']") !== null, "the chat");
    await popTo({ __vxChats: { id: mark.id, at: "list" } });
    await waitFor(() => rows().length === 2, "the list again");
    await popTo(null);
    await waitFor(() => document.querySelector(".vx-cp") === null, "the panel closed");
    expect(bubble()?.hasAttribute("data-away")).toBe(false);
    // Back took the panel's own entries already: nothing more to undo.
    expect(go).not.toHaveBeenCalled();
  });

  it("comes for a person without a desk only when a parent writes, and says it is new", async () => {
    fakeClock();
    routes = {
      "/chats/pulse": { body: { waiting: 1, enabled: true, latest: latest({ at: "2026-11-15T10:00:03.000Z" }) } },
    };
    await mountBubble({ waiting: 0, enabled: true, hasDesk: false });
    await waitFor(() => true, "a moment");
    expect(bubble()).toBeNull();

    await later(1_300);
    await waitFor(() => card() !== null, "the card");
    expect(card()?.textContent).toContain("New message from a parent");
    expect(document.querySelector(".vx-cb-n")?.textContent).toBe("1");
  });

  it("stands aside on Chats, and asks nothing there", async () => {
    fakeClock();
    scene.path = "/chats";
    routes = { "/chats/pulse": { body: { waiting: 3, enabled: true, latest: latest() } } };
    await mountBubble({ waiting: 3, enabled: true, hasDesk: true });
    await later(31_000);
    await waitFor(() => true, "a moment");
    expect(bubble()).toBeNull();
    expect(fetched("/chats/pulse")).toBe(false);
    // The person is looking at the chats already: the "waiting" card is not owed later.
    expect(peeked()).toEqual([""]);
  });

  it("for an administrator looking as a teacher: Open, not Reply, and never the app icon's number", async () => {
    fakeClock();
    const badge = appBadge();
    routes = {
      "/chats/pulse": { body: { waiting: 1, enabled: true, latest: latest() } },
      "/chats/panel": { body: listBody([item("chat-1", "Test Parent One")]) },
      "/chats/thread": { body: threadBody("chat-1", "Test Parent One") },
    };
    await mountBubble({ waiting: 1, enabled: true, hasDesk: true }, { lookOnly: true });
    await later(1_300);
    await waitFor(() => card() !== null, "the card");
    expect(byText(".vx-cb-peek button", "Reply")).toBeUndefined();
    await tap(byText(".vx-cb-peek button", "Open"), "Open");
    await waitFor(() => document.querySelector("[data-thread='chat-1']") !== null, "the chat");
    expect(badge.set).not.toHaveBeenCalled();
    expect(badge.clear).not.toHaveBeenCalled();
  });

  it("seeing One as a teacher starts afresh: the teacher's number at once and the teacher's card, then one's own again (D-642)", async () => {
    fakeClock();
    routes = { "/chats/pulse": { body: { waiting: 1, enabled: true, latest: latest({ chatId: "chat-a", name: "Test Parent Office" }) } } };
    await mountAs("admin-1|2026-27|", { waiting: 1, enabled: true, hasDesk: true });
    await later(1_300);
    await waitFor(() => card() !== null, "the administrator's card");
    expect(card()?.textContent).toContain("Test Parent Office");
    expect(probe()).toBe("1");

    // The administrator chooses a class teacher: a new shell, without loading the page again.
    routes = { "/chats/pulse": { body: { waiting: 2, enabled: true, latest: latest({ chatId: "chat-t", name: "Test Parent Class" }) } } };
    await mountAs("teacher-1|TEST-2026-27|", { waiting: 2, enabled: true, hasDesk: true }, { lookOnly: true, since: "2026-11-15T10:00:06.000Z" });
    await waitFor(() => bubble() !== null, "the teacher's bubble");
    // The teacher's number from the first paint: never the administrator's 1 until the next look.
    expect(document.querySelector(".vx-cb-n")?.textContent).toBe("2");
    expect(probe()).toBe("none");
    expect(card()).toBeNull();
    await later(1_300);
    await waitFor(() => card() !== null, "the teacher's card");
    // The administrator saw their own card this visit; the teacher's is still said.
    expect(card()?.textContent).toContain("2 parents are waiting for your reply");
    expect(byText(".vx-cb-peek button", "Open chats")).toBeDefined();
    expect(probe()).toBe("2");
    expect(peeked()).toEqual(["admin-1|2026-27|", "teacher-1|TEST-2026-27|"]);

    // Back to the administrator's own view: their number again, and their card is not said twice.
    routes = { "/chats/pulse": { body: { waiting: 1, enabled: true, latest: latest({ chatId: "chat-a", name: "Test Parent Office" }) } } };
    await mountAs("admin-1|2026-27|", { waiting: 1, enabled: true, hasDesk: true }, { since: "2026-11-15T10:00:09.000Z" });
    await waitFor(() => bubble() !== null, "the administrator's bubble");
    expect(document.querySelector(".vx-cb-n")?.textContent).toBe("1");
    expect(card()).toBeNull();
    await later(1_300);
    await waitFor(() => probe() === "1", "the administrator's fresh number");
    expect(card()).toBeNull();
  });

  it("a mouse holds the button from the press, so even a quick drag starts; a finger is left to the browser", async () => {
    const capture = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { value: capture, configurable: true, writable: true });
    try {
      routes = { "/chats/pulse": { body: { waiting: 0, enabled: true, latest: null } } };
      await mountBubble({ waiting: 0, enabled: true, hasDesk: true });
      await waitFor(() => bubble() !== null, "the bubble");
      const button = document.querySelector<HTMLButtonElement>(".vx-cb-btn")!;
      const press = (pointerType: string, pointerId: number) =>
        act(async () => {
          const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 354, clientY: 730, button: 0 });
          Object.defineProperty(event, "pointerType", { value: pointerType });
          Object.defineProperty(event, "pointerId", { value: pointerId });
          button.dispatchEvent(event);
        });
      await press("mouse", 7);
      expect(capture).toHaveBeenCalledWith(7);
      capture.mockClear();
      await press("touch", 8);
      expect(capture).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
    }
  });

  it("stays where it was dragged: the left edge of a phone, higher up", async () => {
    vi.stubGlobal("innerWidth", 400);
    const rect = { left: 324, top: 700, right: 384, bottom: 760, width: 60, height: 60, x: 324, y: 700, toJSON: () => ({}) } as DOMRect;
    const zero = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("vx-cb") ? rect : zero;
    });
    routes = { "/chats/pulse": { body: { waiting: 0, enabled: true, latest: null } } };
    await mountBubble({ waiting: 0, enabled: true, hasDesk: true });
    await waitFor(() => bubble() !== null, "the bubble");
    const button = document.querySelector<HTMLButtonElement>(".vx-cb-btn")!;
    const pointer = (type: string, x: number, y: number) =>
      act(async () => {
        button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      });
    await pointer("pointerdown", 354, 730);
    await pointer("pointermove", 300, 600);
    expect(bubble()?.hasAttribute("data-drag")).toBe(true);
    await pointer("pointermove", 104, 430);
    await pointer("pointerup", 104, 430);
    // The tap that ends a drag opens nothing.
    await act(async () => button.click());

    expect(JSON.parse(window.localStorage.getItem("vx.chats.bubble") ?? "null")).toEqual({ side: "left", up: 300 });
    expect(bubble()?.getAttribute("data-side")).toBe("left");
    expect(bubble()?.style.getPropertyValue("--cb-up")).toBe("300px");
    expect(bubble()?.hasAttribute("data-drag")).toBe(false);
    expect(document.querySelector(".vx-cp")).toBeNull();
    expect(scene.cue).toHaveBeenCalledWith("select");

    // A plain tap still opens the chats.
    await act(async () => button.click());
    await waitFor(() => document.querySelector(".vx-cp") !== null, "the panel");
  });
});

/* -------------------------------------------------------------- the panel */

describe("the chat panel", () => {
  it("on a phone, the X takes its history entries back and closes", async () => {
    routes = {
      "/chats/panel": { body: listBody([item("chat-1", "Test Parent One")]) },
      "/chats/thread": { body: threadBody("chat-1", "Test Parent One") },
    };
    const { onClose, onActivity } = await mountPanel({ start: "chat-1" });
    await waitFor(() => document.querySelector("[data-thread='chat-1']") !== null, "the chat");
    expect(document.querySelector(".vx-cp")?.getAttribute("aria-modal")).toBe("true");
    // Opening it read the parent's lines: the bubble's number is asked again.
    expect(onActivity).toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("hidden");

    await tap(document.querySelector("[aria-label='Close chats']"), "the X");
    expect(go).toHaveBeenCalledWith(-2);
    await waitFor(() => onClose.mock.calls.length === 1, "closed");
  });

  it("on a phone, a link inside takes the panel's entries off first, then opens the page", async () => {
    routes = {
      "/chats/panel": { body: listBody([item("chat-1", "Test Parent One")]) },
      "/chats/thread": { body: threadBody("chat-1", "Test Parent One") },
    };
    const { onClose } = await mountPanel({ start: "chat-1" });
    await waitFor(() => document.querySelector("[data-thread='chat-1']") !== null, "the chat");
    await tap(byText(".vx-cp a", "Open the child"), "the child's link");
    expect(go).toHaveBeenCalledWith(-2);
    expect(onClose).toHaveBeenCalled();
    expect(scene.push).not.toHaveBeenCalled();
    await popTo(null);
    expect(scene.push).toHaveBeenCalledWith("/students/test-child");
  });

  it("on a computer it is a window beside the page: no history entries, and Escape closes it", async () => {
    phone = false;
    const push = vi.spyOn(window.history, "pushState");
    routes = { "/chats/panel": { body: listBody([item("chat-1", "Test Parent One"), item("chat-2", "Test Parent Two", "done")]) } };
    const { onClose } = await mountPanel();
    await waitFor(() => rows().length === 2, "the list");
    expect(push).not.toHaveBeenCalled();
    expect(document.querySelector(".vx-cp")?.hasAttribute("aria-modal")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.querySelector(".chat-sec.wait")?.textContent).toContain("Waiting for a reply");

    await tap(rows()[0], "the first row");
    await waitFor(() => document.querySelector("[data-thread='chat-1']") === null && document.querySelector(".vx-cp-chat") !== null, "the chat opening");
    await tap(document.querySelector(".vx-cp .chat-back"), "the back arrow");
    await waitFor(() => rows().length === 2, "the list again");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await waitFor(() => onClose.mock.calls.length === 1, "closed");
    expect(go).not.toHaveBeenCalled();
  });

  it("tells an administrator looking as somebody else that nothing is marked read or sent", async () => {
    routes = { "/chats/panel": { body: listBody([item("chat-1", "Test Parent One")]) } };
    await mountPanel({ lookOnly: true });
    await waitFor(() => rows().length === 1, "the list");
    expect(document.querySelector(".vx-cp-look")?.textContent).toContain("Nothing is marked read");
  });

  it("asks to sign in again when the session has ended", async () => {
    routes = { "/chats/panel": { status: 401, body: { kind: "signed_out" } } };
    await mountPanel();
    await waitFor(() => document.querySelector(".vx-cp a.btn.pri") !== null, "the sign-in button");
    expect(document.querySelector(".vx-cp a.btn.pri")?.getAttribute("href")).toBe("/login?reason=expired&next=%2Fchats");
  });
});
