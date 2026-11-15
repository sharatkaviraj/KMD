import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUBBLE_WORDS,
  DEFAULT_PLACE,
  bubbleShown,
  countText,
  isChatsPath,
  liftOver,
  peekedList,
  peekFor,
  readPlace,
  settle,
  timeOf,
  withPeeked,
} from "@/vx/shell/chat-bubble-logic";

/*
 * The chat bubble's rules (D-641): when it is drawn, where a dragged bubble
 * settles, how far it rises over a bar at the bottom of a screen, and when it
 * speaks up. Test data only (rule 6).
 */

const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("where the person left the bubble", () => {
  it("starts bottom right", () => {
    expect(readPlace(null)).toEqual(DEFAULT_PLACE);
    expect(readPlace(undefined)).toEqual(DEFAULT_PLACE);
    expect(readPlace("")).toEqual({ side: "right", up: 0 });
  });

  it("reads a stored side and height", () => {
    expect(readPlace('{"side":"left","up":120}')).toEqual({ side: "left", up: 120 });
    expect(readPlace('{"side":"right","up":12.6}')).toEqual({ side: "right", up: 13 });
  });

  it("never trusts what is stored", () => {
    expect(readPlace("not json")).toEqual(DEFAULT_PLACE);
    expect(readPlace("null")).toEqual({ side: "right", up: 0 });
    expect(readPlace('{"side":"middle","up":-40}')).toEqual({ side: "right", up: 0 });
    expect(readPlace('{"up":"300"}')).toEqual({ side: "right", up: 0 });
    expect(readPlace('{"side":"left","up":99999}')).toEqual({ side: "left", up: 2000 });
  });
});

describe("when the bubble is drawn", () => {
  const base = { enabled: true, hasDesk: true, waiting: 0, inChats: false, panelOpen: false };

  it("stays for a person with a desk of their own, even with nobody waiting", () => {
    expect(bubbleShown(base)).toBe(true);
  });

  it("comes for a person without a desk only while a parent waits", () => {
    expect(bubbleShown({ ...base, hasDesk: false })).toBe(false);
    expect(bubbleShown({ ...base, hasDesk: false, waiting: 1 })).toBe(true);
  });

  it("stands aside on Chats, while its panel is open, and while chats are off", () => {
    expect(bubbleShown({ ...base, waiting: 3, inChats: true })).toBe(false);
    expect(bubbleShown({ ...base, waiting: 3, panelOpen: true })).toBe(false);
    expect(bubbleShown({ ...base, waiting: 3, enabled: false })).toBe(false);
  });

  it("knows Chats by its address", () => {
    expect(isChatsPath("/chats")).toBe(true);
    expect(isChatsPath("/chats/panel")).toBe(true);
    expect(isChatsPath("/chatsroom")).toBe(false);
    expect(isChatsPath("/teach/attendance")).toBe(false);
  });
});

describe("where a dragged bubble settles", () => {
  const screen = { width: 400, restCenterY: 700, topLimit: 110 };

  it("goes to the nearer side on a phone, always the right on a computer", () => {
    expect(settle({ ...screen, x: 120, y: 700, allowLeft: true }).side).toBe("left");
    expect(settle({ ...screen, x: 280, y: 700, allowLeft: true }).side).toBe("right");
    expect(settle({ ...screen, x: 120, y: 700, allowLeft: false }).side).toBe("right");
  });

  it("stays at the height it was let go", () => {
    expect(settle({ ...screen, x: 380, y: 450.4, allowLeft: true })).toEqual({ side: "right", up: 250 });
  });

  it("never goes below its resting place or up into the top bar", () => {
    expect(settle({ ...screen, x: 380, y: 760, allowLeft: true }).up).toBe(0);
    expect(settle({ ...screen, x: 380, y: 20, allowLeft: true }).up).toBe(590);
  });
});

describe("rising over a bar at the bottom of a screen", () => {
  const viewport = 800;

  it("stays down with nothing under it", () => {
    expect(liftOver([], 690, viewport)).toBe(0);
  });

  it("rises just clear of a save bar", () => {
    expect(liftOver([{ top: 660, height: 72 }], 690, viewport)).toBe(42);
  });

  it("does not rise for a bar that is below it anyway", () => {
    expect(liftOver([{ top: 720, height: 60 }], 690, viewport)).toBe(0);
  });

  it("ignores what sits high up and tall sticky columns", () => {
    expect(liftOver([{ top: 200, height: 60 }], 690, viewport)).toBe(0);
    expect(liftOver([{ top: 400, height: 500 }], 690, viewport)).toBe(0);
  });

  it("rises over the tallest of several, and never past half the window", () => {
    expect(liftOver([{ top: 660, height: 72 }, { top: 600, height: 56 }], 690, viewport)).toBe(102);
    expect(liftOver([{ top: 368, height: 100 }], 790, viewport)).toBe(400);
  });
});

describe("when the bubble speaks up", () => {
  const at = timeOf("2026-11-15T10:00:00.000Z");

  it("says nothing while nobody waits", () => {
    expect(peekFor({ waiting: 0, latestAt: at, announcedAt: 0, openDue: true })).toBeNull();
    expect(peekFor({ waiting: 2, latestAt: null, announcedAt: 0, openDue: true })).toBeNull();
  });

  it("says a new message as soon as a parent writes", () => {
    expect(peekFor({ waiting: 1, latestAt: at + 1, announcedAt: at, openDue: false })).toBe("new");
    expect(peekFor({ waiting: 1, latestAt: at + 1, announcedAt: at, openDue: true })).toBe("new");
  });

  it("says parents are waiting once when One opens", () => {
    expect(peekFor({ waiting: 3, latestAt: at, announcedAt: at + 5_000, openDue: true })).toBe("open");
    expect(peekFor({ waiting: 3, latestAt: at, announcedAt: at + 5_000, openDue: false })).toBeNull();
  });

  it("reads times safely", () => {
    expect(timeOf("2026-11-15T10:00:00.000Z")).toBe(Date.UTC(2026, 10, 15, 10));
    expect(timeOf("")).toBe(0);
    expect(timeOf(null)).toBe(0);
    expect(timeOf("yesterday")).toBe(0);
  });
});

describe("the card at open, once a visit for each person and year (D-642)", () => {
  it("starts with nobody, and reads an older visit's mark as nobody", () => {
    expect(peekedList(null)).toEqual([]);
    expect(peekedList("")).toEqual([]);
    expect(peekedList("1731700000000")).toEqual([]);
    expect(peekedList("{oops")).toEqual([]);
    expect(peekedList(JSON.stringify(["a", 3, null, "b"]))).toEqual(["a", "b"]);
  });

  it("remembers each person it was said to, the newest last, and lets the oldest go", () => {
    const admin = withPeeked(null, "admin|2026-27|");
    const both = withPeeked(admin, "teacher|TEST-2026-27|");
    expect(peekedList(both)).toEqual(["admin|2026-27|", "teacher|TEST-2026-27|"]);
    // Said again to the administrator: still once in the list, now the newest.
    expect(peekedList(withPeeked(both, "admin|2026-27|"))).toEqual(["teacher|TEST-2026-27|", "admin|2026-27|"]);
    let many: string | null = null;
    for (let i = 0; i < 12; i += 1) many = withPeeked(many, `person-${i}`);
    expect(peekedList(many)).toHaveLength(8);
    expect(peekedList(many)[0]).toBe("person-4");
  });
});

describe("the bubble's words", () => {
  it("puts a short number on the bubble", () => {
    expect(countText(0)).toBe("0");
    expect(countText(7)).toBe("7");
    expect(countText(99)).toBe("99");
    expect(countText(120)).toBe("99+");
    expect(countText(-2)).toBe("0");
  });

  it("names how many wait, in both languages", () => {
    expect(BUBBLE_WORDS.label(0).en).toBe("Chats with parents");
    expect(BUBBLE_WORDS.label(1).en).toContain("1 parent waiting");
    expect(BUBBLE_WORDS.label(4).hi).toContain("4 अभिभावक");
    expect(BUBBLE_WORDS.waiting(1).en).toBe("1 parent is waiting for your reply");
    expect(BUBBLE_WORDS.waiting(3).en).toBe("3 parents are waiting for your reply");
  });
});

describe("how the bubble is wired", () => {
  it("is drawn while an administrator sees One as a teacher, look-only, and never in a role preview", () => {
    const shell = source("src/vx/shell/shell.tsx");
    expect(shell).toContain('const chatsBubble = !rolePreview && (can(staff, "chats:reply") || can(staff, "chats:all"));');
    expect(shell).toContain("lookOnly={viewer.person !== null}");
    expect(shell).not.toContain("LazyChatsNudge");
  });

  it("is drawn on the server with its number, and its panel's code comes only when it is wanted", () => {
    expect(source("src/vx/shell/lazy.tsx")).toMatch(/LazyChatBubble = dynamic\(\(\) => import\("\.\/chat-bubble"\)\.then\(\(m\) => m\.ChatBubble\)\);/);
    expect(source("src/vx/shell/chat-bubble.tsx")).toMatch(/dynamic\(\(\) => import\("\.\/chat-panel"\)[^\n]*ssr: false/);
  });

  it("starts afresh for each person and year: its own number, its own card (D-642)", () => {
    const shell = source("src/vx/shell/shell.tsx");
    expect(shell).toContain("const chatScope = `${staff.id}|${sessionLabel}|${rolePreview ?? \"\"}`;");
    expect(shell).toContain("<LiveChatScope who={chatScope}>");
    expect(shell).toContain("<LazyChatBubble key={chatScope} ");
    // The badges, the bubble and Chats all keep the number for the shell's person and year.
    const live = source("src/vx/shell/chat-live.ts");
    expect(live).toContain("() => (owner === who ? count : null)");
    expect(source("src/vx/shell/chat-bubble.tsx")).toContain("setLiveChatCount(body.waiting, who);");
    expect(source("src/vx/screens/chats/chats-screen.tsx")).toContain("setLiveChatCount(body.waiting ?? 0, liveWho);");
    for (const file of ["src/vx/shell/sidebar.tsx", "src/vx/shell/bottom-bar.tsx"]) expect(source(file)).toContain("useLiveChatCount()");
  });

  it("counts in its panel only the parents waiting for this person, as the bubble does", () => {
    expect(source("src/app/(app)/chats/panel/route.ts")).toContain("waiting: list.waitingForYou,");
    expect(source("src/vx/screens/chats/load.ts")).toContain("waitingForYou: badgeCount(viewer, open),");
  });

  it("never marks a chat read for the person an administrator is looking as", () => {
    const thread = source("src/app/(app)/chats/thread/route.ts");
    expect(thread).toContain("loadChatThread(reader.viewer, chatId, { markRead: !looking })");
    expect(thread).toContain('markRead: params.get("seen") === "1" && !looking');
    expect(source("src/app/(app)/chats/page.tsx")).toContain("markRead: !staff.viewedBy");
  });
});
