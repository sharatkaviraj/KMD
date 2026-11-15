import { p, type Pair } from "@/vx/text";

/*
 * The chat bubble's rules (D-641), kept pure so they can be tested: when it
 * is drawn, where it settles after a drag, how far it rises over a bar fixed
 * at the bottom of a screen, and when it speaks up.
 *
 * The owner, 15 Nov 2026: chats "should always be available as a pop-up that
 * can be shown in the bottom right corner or anywhere", and staff "should get
 * notified whenever they open the app". So every screen carries one round
 * chat bubble for the people who answer parents, with the number waiting on
 * it; it says who wrote when One opens with parents waiting and when a parent
 * writes; one tap opens the chats over the screen; and it can be dragged out
 * of the way.
 */

/** What the server knew when it drew the screen. */
export type BubbleState = {
  /** Parents waiting for this person's reply. */
  waiting: number;
  /** Chats are switched on for the school (and this person has a "for you" at all). */
  enabled: boolean;
  /** A chat can land on this person's own desk: admin, fee desk, office or a class teacher. */
  hasDesk: boolean;
};

export type BubbleSide = "left" | "right";

/** Where the person left the bubble: a side, and how far above its resting place, in px. */
export type BubblePlace = { side: BubbleSide; up: number };

export const DEFAULT_PLACE: BubblePlace = { side: "right", up: 0 };

/** Per device, like the other conveniences in One (sounds, large text). */
export const PLACE_KEY = "vx.chats.bubble";

/** The highest a stored place may say, whatever was written there. */
const MAX_STORED_UP = 2000;

export function readPlace(raw: string | null | undefined): BubblePlace {
  if (!raw) return DEFAULT_PLACE;
  try {
    const value = JSON.parse(raw) as { side?: unknown; up?: unknown } | null;
    const side = value?.side === "left" ? "left" : "right";
    const up = typeof value?.up === "number" && Number.isFinite(value.up) ? Math.round(Math.min(MAX_STORED_UP, Math.max(0, value.up))) : 0;
    return { side, up };
  } catch {
    return DEFAULT_PLACE;
  }
}

/**
 * Whether the bubble is drawn: chats on, not on Chats itself (the whole
 * screen is chats there), not while its panel is open, and either a desk of
 * one's own or a parent actually waiting. A subject teacher with no class
 * never carries an empty bubble round every screen.
 */
export function bubbleShown(input: { enabled: boolean; hasDesk: boolean; waiting: number; inChats: boolean; panelOpen: boolean }): boolean {
  return input.enabled && !input.inChats && !input.panelOpen && (input.hasDesk || input.waiting > 0);
}

/**
 * Where a dragged bubble settles: on the side of the screen it was let go
 * nearer (a computer keeps it on the right, clear of the sidebar), at the
 * height it was let go, never below its resting place and never up into the
 * top of the screen.
 *
 * `restCenterY`: the middle of the bubble at its resting place, in the
 * window. `topLimit`: the highest its middle may go.
 */
export function settle(input: { x: number; y: number; width: number; restCenterY: number; topLimit: number; allowLeft: boolean }): BubblePlace {
  const side: BubbleSide = input.allowLeft && input.x < input.width / 2 ? "left" : "right";
  const maxUp = Math.max(0, input.restCenterY - input.topLimit);
  const up = Math.round(Math.min(maxUp, Math.max(0, input.restCenterY - input.y)));
  return { side, up };
}

/** A bar or button that stays at the bottom of a screen, as the bubble found it under itself. */
export type Dock = { top: number; height: number };

/**
 * How far the bubble rises so it never covers a bar that stays at the bottom
 * of a screen: Save attendance, Save note, the New note button. Only a short
 * thing in the lower part of the window counts; a tall sticky column is not
 * a bar to climb over, and the bubble never climbs past half the window.
 *
 * `restBottom`: the bubble's lower edge at its resting place, in the window.
 */
export function liftOver(docks: readonly Dock[], restBottom: number, viewport: number, gap = 12): number {
  let lift = 0;
  for (const dock of docks) {
    if (dock.top < viewport * 0.45 || dock.height > viewport * 0.45) continue;
    lift = Math.max(lift, restBottom - dock.top + gap);
  }
  return Math.round(Math.min(Math.max(0, lift), viewport * 0.5));
}

export type PeekKind = "open" | "new";

/**
 * Whether the bubble speaks up after a look at who is waiting:
 *  - "new": a parent wrote after the last thing it said;
 *  - "open": One has just opened (or come back after a long while away) and
 *    parents are still waiting, once.
 * Nothing when nobody waits.
 */
export function peekFor(input: { waiting: number; latestAt: number | null; announcedAt: number; openDue: boolean }): PeekKind | null {
  if (input.waiting <= 0 || input.latestAt === null) return null;
  if (input.latestAt > input.announcedAt) return "new";
  return input.openDue ? "open" : null;
}

/** Back after this long away counts as opening One again. */
export const AWAY_MS = 30 * 60_000;

/**
 * The "parents are waiting" card is said once a visit to each person in each
 * year (D-642): an administrator who opens One, then looks at it as a class
 * teacher, sees the card the teacher would see on opening it. Kept in
 * sessionStorage as a short list of whose it was said to.
 */
export const PEEKED_KEY = "vx.chats.peeked";

const PEEKED_KEPT = 8;

/** Whose the card was said to this visit; anything unreadable (an older visit wrote a time) is nobody's. */
export function peekedList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((who): who is string => typeof who === "string").slice(-PEEKED_KEPT) : [];
  } catch {
    return [];
  }
}

/** The list once the card has been said to `who`: newest last, the oldest let go. */
export function withPeeked(raw: string | null | undefined, who: string): string {
  const list = peekedList(raw).filter((one) => one !== who);
  list.push(who);
  return JSON.stringify(list.slice(-PEEKED_KEPT));
}

/** The number on the bubble. */
export function countText(waiting: number): string {
  return waiting > 99 ? "99+" : String(Math.max(0, Math.floor(waiting)));
}

export const BUBBLE_WORDS = {
  chats: p("Chats", "चैट"),
  label: (waiting: number): Pair =>
    waiting <= 0
      ? p("Chats with parents", "अभिभावकों से चैट")
      : waiting === 1
        ? p("Chats with parents: 1 parent waiting for your reply", "अभिभावकों से चैट: 1 अभिभावक आपके जवाब की राह देख रहे हैं")
        : p(`Chats with parents: ${waiting} parents waiting for your reply`, `अभिभावकों से चैट: ${waiting} अभिभावक आपके जवाब की राह देख रहे हैं`),
  waiting: (waiting: number): Pair =>
    waiting === 1
      ? p("1 parent is waiting for your reply", "1 अभिभावक आपके जवाब की राह देख रहे हैं")
      : p(`${waiting} parents are waiting for your reply`, `${waiting} अभिभावक आपके जवाब की राह देख रहे हैं`),
  newMessage: p("New message from a parent", "अभिभावक का नया संदेश"),
  reply: p("Reply", "जवाब दें"),
  open: p("Open", "खोलें"),
  openChats: p("Open chats", "चैट खोलें"),
  later: p("Later", "बाद में"),
  close: p("Close", "बंद करें"),
  tip: p("Tip: press and drag the green chat button to move it anywhere.", "सुझाव: हरे चैट बटन को दबाकर खींचें और कहीं भी रख दें।"),
  opening: p("Opening chats…", "चैट खुल रही हैं…"),
};

/** Chats itself, where the whole screen is chats and the bubble stands aside. */
export function isChatsPath(path: string): boolean {
  return path === "/chats" || path.startsWith("/chats/") || path.startsWith("/chats?");
}

/** Milliseconds for an ISO time; 0 for anything unreadable, so it is never "newer". */
export function timeOf(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}
