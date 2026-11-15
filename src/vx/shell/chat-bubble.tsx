"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { use, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { cue } from "@/ui/feedback/cue";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import type { Pair } from "@/vx/text";

import {
  AWAY_MS,
  BUBBLE_WORDS as W,
  PLACE_KEY,
  bubbleShown,
  countText,
  isChatsPath,
  liftOver,
  peekFor,
  readPlace,
  settle,
  timeOf,
  type BubblePlace,
  type BubbleState,
  type Dock,
  type PeekKind,
} from "./chat-bubble-logic";
import { setLiveChatCount, useLiveChatCount } from "./chat-live";

import "./chat-bubble.css";

/*
 * The chat bubble (D-641). The owner, 15 Nov 2026: chats "should always be
 * available as a pop-up that can be shown in the bottom right corner or
 * anywhere", and staff "should get notified whenever they open the app".
 *
 * One round green button on every screen, for the people who answer
 * parents, the way a chat head floats over a phone:
 *
 *  - the red number is the parents waiting for this person's reply, and a
 *    soft ring goes round the button when it grows;
 *  - it speaks up in a little card above itself when One opens (or comes
 *    back after half an hour away) with parents waiting, and whenever a
 *    parent writes: who, about which child, the first words, and Reply;
 *  - one tap opens the chats over the screen (`chat-panel.tsx`): the list,
 *    then a chat with its reply box, without leaving the page;
 *  - it can be dragged anywhere up the right or left edge, and it rises by
 *    itself over a bar fixed at the bottom of a screen (Save attendance,
 *    Save note), so it never covers a button somebody needs.
 *
 * It replaces the strip and the card of D-618, which never showed while an
 * administrator looked at One as a teacher, and which sat on top of every
 * screen. The phone's tab bar is unchanged (the owner, 05:27 UTC 15 Nov).
 *
 * It asks `/chats/pulse` a moment after it appears and then every 30 seconds
 * while the screen is in view, never on Chats (which asks for itself). Each
 * fresh number goes to the menu's badges too (`chat-live.ts`) and, on an
 * installed One, to the app icon.
 */

const warmPanel = () => {
  void import("./chat-panel").catch(() => undefined);
};

const PULSE_MS = 30_000;
/** The first look, soon after One opens: a parent waiting is said at once. */
const FIRST_LOOK_MS = 1_200;
/** While chats are switched off: look now and then in case they come on. */
const OFF_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** How long the card stays when nobody touches it. */
const PEEK_MS = 16_000;
/** The card for "parents are waiting" is said once a visit (sessionStorage). */
const PEEKED_KEY = "vx.chats.peeked";
/** The highest the bubble's middle may be dragged: clear of the top bar. */
const TOP_LIMIT = 110;
/** A press that moves less than this is a tap, not a drag. */
const DRAG_SLOP = 8;
const SPRING = "cubic-bezier(.34,1.36,.64,1)";

/** The newest waiting parent, as `/chats/pulse` says it: the preview already in words. */
type Latest = { chatId: string; name: string; children: string | null; preview: Pair | null; at: string };
type PulseBody = { waiting?: number; latest?: Latest | null; enabled?: boolean; failed?: boolean };
type Peek = { kind: PeekKind; latest: Latest; waiting: number; below: boolean };
type Panel = { chat: string | null; at: string };
type Drag = { id: number; x: number; y: number; rect: DOMRect; offset: number; moved: boolean };

/* ------------------------------------------------ where the person left it */

const placeListeners = new Set<() => void>();
/** Kept here too, for a browser that refuses storage (a private window): the bubble still stays where it was put. */
let memoryPlace: string | null = null;

function subscribePlace(listener: () => void): () => void {
  placeListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PLACE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    placeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function placeSnapshot(): string | null {
  try {
    return window.localStorage.getItem(PLACE_KEY) ?? memoryPlace;
  } catch {
    return memoryPlace;
  }
}

const noPlace = () => null;

function savePlace(place: BubblePlace): void {
  memoryPlace = JSON.stringify(place);
  try {
    window.localStorage.setItem(PLACE_KEY, memoryPlace);
  } catch {
    // Storage refused: the place lasts until One is closed.
  }
  for (const listener of placeListeners) listener();
}

function peekedThisVisit(): boolean {
  try {
    return window.sessionStorage.getItem(PEEKED_KEY) !== null;
  } catch {
    return false;
  }
}

function notePeeked(): void {
  try {
    window.sessionStorage.setItem(PEEKED_KEY, String(Date.now()));
  } catch {
    // Without storage the card may come again on the next opening of One.
  }
}

/* ------------------------------------------- staying clear of bottom bars */

/**
 * What stays put under the bubble's chosen place: a bar or button fixed or
 * stuck at the bottom of the screen. Looks at a few points over the place
 * (`anchor`, which never lifts) and walks up from whatever is drawn there to
 * the first fixed or sticky box. Returns how far to rise (`liftOver`).
 */
function probeLift(button: HTMLElement, anchor: HTMLElement, own: HTMLElement): number {
  if (typeof document.elementsFromPoint !== "function") return 0;
  const b = button.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  if (b.width === 0 || a.height === 0) return 0;
  const left = b.left + 8;
  const right = b.right - 8;
  const mid = (b.left + b.right) / 2;
  const points: Array<[number, number]> = [
    [mid, a.top + 6],
    [left, a.top + 10],
    [right, a.top + 10],
    [left, a.bottom - 8],
    [right, a.bottom - 8],
    [mid, a.bottom + 8],
  ];
  const docks: Dock[] = [];
  const seen = new Set<Element>();
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
    const hit = document.elementsFromPoint(x, y).find((el) => !own.contains(el) && !el.closest("#vx-layer, .vx-bottom, .vx-cb, .vx-cb-anchor"));
    let el: Element | null = hit ?? null;
    for (let depth = 0; el && depth < 14 && el !== document.body && el !== document.documentElement; depth += 1, el = el.parentElement) {
      const position = window.getComputedStyle(el).position;
      if (position === "fixed" || position === "sticky") {
        if (!seen.has(el)) {
          seen.add(el);
          const r = el.getBoundingClientRect();
          docks.push({ top: r.top, height: r.height });
        }
        break;
      }
      if (el.id === "vx-main") break;
    }
  }
  return liftOver(docks, a.bottom, window.innerHeight);
}

/* ------------------------------------------------------------- the bubble */

/** While the panel's code is on its way (it is fetched ahead, so this is rare). */
function PanelWait() {
  const { tx } = useVx();
  return (
    <div className="vx-cp-wait" role="status">
      <Ic n="refresh" size={24} className="spin" />
      <span>{tx(W.opening)}</span>
    </div>
  );
}

const ChatPanel = dynamic(() => import("./chat-panel").then((m) => m.ChatPanel), { ssr: false, loading: PanelWait });

/**
 * `state`: what the server knew when it drew the screen (the number waiting
 * is there at first paint). `since`: when it drew it; only a parent who
 * writes after that brings up the "new message" card. `lookOnly`: an
 * administrator seeing One as somebody else (D-544), who reads their chats
 * and changes nothing.
 */
export function ChatBubble({ state, since, lookOnly }: { state: Promise<BubbleState>; since: string; lookOnly: boolean }) {
  const served = use(state);
  const { tx } = useVx();
  const pathname = usePathname() ?? "";
  const inChats = isChatsPath(pathname);
  const live = useLiveChatCount();
  const waiting = live ?? served.waiting;
  const [liveEnabled, setLiveEnabled] = useState<boolean | null>(null);
  const enabled = liveEnabled ?? served.enabled;
  const raw = useSyncExternalStore(subscribePlace, placeSnapshot, noPlace);
  const place = readPlace(raw);
  const [lift, setLift] = useState(0);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [hold, setHold] = useState(false);
  const [dragging, setDragging] = useState(false);

  // The ring goes round again whenever the number grows.
  const [seenWaiting, setSeenWaiting] = useState(waiting);
  const [ring, setRing] = useState(waiting > 0 ? 1 : 0);
  if (waiting !== seenWaiting) {
    setSeenWaiting(waiting);
    if (waiting > seenWaiting) setRing(ring + 1);
  }

  // Chats itself has everything: the panel closes there.
  if (inChats && panel) setPanel(null);

  const panelOpen = panel !== null;
  const drawn = bubbleShown({ enabled, hasDesk: served.hasDesk, waiting, inChats, panelOpen: false });

  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const announced = useRef(timeOf(since));
  const openDue = useRef<boolean | null>(null);
  const view = useRef({ inChats, panelOpen });
  const lookSoon = useRef<() => void>(() => {});
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  const flip = useRef<DOMRect | null>(null);

  useEffect(() => {
    view.current = { inChats, panelOpen };
  });

  // Who is waiting: a first look a moment after One opens, then every 30 seconds.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let delay = PULSE_MS;
    let lastLook = 0;
    let hiddenAt: number | null = null;
    if (openDue.current === null) openDue.current = !peekedThisVisit();

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (alive) timer = window.setTimeout(() => void look(), ms);
    };

    const look = async () => {
      window.clearTimeout(timer);
      if (!alive) return;
      if (view.current.inChats) {
        // Chats asks for itself, and the person is looking at the chats already.
        if (openDue.current) {
          openDue.current = false;
          notePeeked();
        }
        schedule(delay);
        return;
      }
      if (document.visibilityState !== "visible") {
        schedule(delay);
        return;
      }
      lastLook = Date.now();
      try {
        const response = await fetch("/chats/pulse", { cache: "no-store", headers: { accept: "application/json" } });
        const body = response.ok ? ((await response.json().catch(() => null)) as PulseBody | null) : null;
        if (!alive) return;
        if (body && !body.failed && typeof body.waiting === "number") {
          const on = body.enabled !== false;
          delay = on ? PULSE_MS : OFF_MS;
          setLiveChatCount(body.waiting);
          setLiveEnabled(on);
          const latest = body.latest ?? null;
          const latestAt = latest ? timeOf(latest.at) : null;
          const kind = on ? peekFor({ waiting: body.waiting, latestAt, announcedAt: announced.current, openDue: openDue.current === true }) : null;
          if (latestAt !== null && latestAt > announced.current) announced.current = latestAt;
          if (kind === "open") {
            openDue.current = false;
            notePeeked();
          }
          const now = view.current;
          if (kind && latest && !now.inChats && !now.panelOpen) {
            const box = wrap.current?.getBoundingClientRect();
            setPeek({ kind, latest, waiting: body.waiting, below: box ? box.top < 250 : false });
            cue("ready");
          }
        } else {
          delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        }
      } catch {
        // Offline for a moment: look again later, less often.
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      schedule(delay);
    };

    const wake = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      // Back after a long while counts as opening One again.
      if (hiddenAt !== null && Date.now() - hiddenAt > AWAY_MS) openDue.current = true;
      hiddenAt = null;
      if (Date.now() - lastLook > 10_000) schedule(0);
    };
    const online = () => schedule(0);
    lookSoon.current = () => schedule(800);
    schedule(FIRST_LOOK_MS);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", online);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      lookSoon.current = () => {};
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", online);
    };
  }, []);

  // The card goes by itself, unless a finger or the mouse rests on it.
  useEffect(() => {
    if (!peek || hold) return undefined;
    const timer = window.setTimeout(() => setPeek(null), PEEK_MS);
    return () => window.clearTimeout(timer);
  }, [peek, hold]);

  // The number on One's icon, where the phone or computer shows one.
  useEffect(() => {
    if (lookOnly) return;
    const nav = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (waiting > 0) void nav.setAppBadge?.(waiting).catch(() => undefined);
      else void nav.clearAppBadge?.().catch(() => undefined);
    } catch {
      // Not offered here.
    }
  }, [waiting, lookOnly]);

  // With a parent waiting, the panel's code comes ahead of the tap.
  const anyWaiting = waiting > 0;
  useEffect(() => {
    if (!anyWaiting || !drawn) return undefined;
    const timer = window.setTimeout(warmPanel, 3_000);
    return () => window.clearTimeout(timer);
  }, [anyWaiting, drawn]);

  // Rise over a bar at the bottom of the screen: looked at when the screen
  // changes, scrolls, resizes or redraws.
  const side = place.side;
  const up = place.up;
  useEffect(() => {
    if (!drawn || panelOpen) return undefined;
    let frame = 0;
    let trailing: number | undefined;
    let last = 0;
    const run = () => {
      frame = 0;
      last = Date.now();
      const b = button.current;
      const a = anchor.current;
      const w = wrap.current;
      if (!b || !a || !w || w.hasAttribute("data-drag")) return;
      const next = probeLift(b, a, w);
      setLift((current) => (Math.abs(current - next) >= 2 ? next : current));
    };
    const soon = () => {
      if (!frame) frame = window.requestAnimationFrame(run);
    };
    const calm = () => {
      const wait = 160 - (Date.now() - last);
      window.clearTimeout(trailing);
      if (wait <= 0) soon();
      else trailing = window.setTimeout(soon, wait);
    };
    const timers = [60, 300, 900, 2_000].map((ms) => window.setTimeout(soon, ms));
    window.addEventListener("resize", soon);
    window.addEventListener("scroll", calm, { capture: true, passive: true });
    const main = document.getElementById("vx-main");
    const watch = main ? new MutationObserver(calm) : null;
    if (main && watch) watch.observe(main, { childList: true, subtree: true });
    return () => {
      for (const t of timers) window.clearTimeout(t);
      window.clearTimeout(trailing);
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", soon);
      window.removeEventListener("scroll", calm, { capture: true });
      watch?.disconnect();
    };
  }, [drawn, panelOpen, pathname, side, up]);

  // A dropped bubble glides from where the finger let go to where it settles.
  useLayoutEffect(() => {
    const from = flip.current;
    const el = wrap.current;
    flip.current = null;
    if (!from || !el) return;
    const to = el.getBoundingClientRect();
    el.removeAttribute("data-drop");
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (typeof el.animate === "function") el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 380, easing: SPRING });
  }, [side, up]);

  const openPanel = (chat: string | null) => {
    setPeek(null);
    setHold(false);
    if (openDue.current) {
      openDue.current = false;
      notePeeked();
    }
    setPanel({ chat, at: new Date().toISOString() });
    cue("tap");
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    swallowClick.current = false;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const el = wrap.current;
    if (!el) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect: el.getBoundingClientRect(), offset: up + lift, moved: false };
    warmPanel();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone.
      }
      setDragging(true);
      setPeek(null);
    }
    const el = wrap.current;
    if (el) el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>, dropped: boolean) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    swallowClick.current = true;
    setDragging(false);
    const el = wrap.current;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    const back = () => {
      if (!el) return;
      el.style.transform = "";
      if (typeof el.animate === "function") el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 320, easing: SPRING });
    };
    if (!dropped) {
      back();
      return;
    }
    const centreY = d.rect.top + d.rect.height / 2;
    const next = settle({
      x: d.rect.left + d.rect.width / 2 + dx,
      y: centreY + dy,
      width: window.innerWidth,
      restCenterY: centreY + d.offset,
      topLimit: TOP_LIMIT,
      allowLeft: window.innerWidth < 900,
    });
    cue("select");
    if (next.side === side && next.up === up) {
      back();
      return;
    }
    if (el) {
      flip.current = el.getBoundingClientRect();
      el.setAttribute("data-drop", "");
      el.style.transform = "";
    }
    setLift(0);
    savePlace(next);
  };

  const onClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    openPanel(null);
  };

  const style = { "--cb-y": `${up + lift}px`, "--cb-up": `${up}px` } as CSSProperties;
  const many = peek ? peek.kind === "open" && peek.waiting > 1 : false;
  const go = many ? W.openChats : lookOnly ? W.open : W.reply;
  const shownPeek = peek && drawn && !panelOpen && !dragging ? peek : null;

  return (
    <>
      {drawn ? (
        <>
          <div ref={anchor} className="vx-cb-anchor" data-side={side} style={style} aria-hidden="true" />
          <div
            ref={wrap}
            className="vx-cb"
            data-side={side}
            data-wait={waiting > 0 ? "" : undefined}
            data-drag={dragging ? "" : undefined}
            data-away={panelOpen ? "" : undefined}
            style={style}
          >
            {shownPeek ? (
              <div
                key={`${shownPeek.kind}:${shownPeek.latest.chatId}:${shownPeek.latest.at}`}
                className="vx-cb-peek"
                data-below={shownPeek.below ? "" : undefined}
                role="status"
                aria-live="polite"
                onPointerEnter={() => setHold(true)}
                onPointerLeave={() => setHold(false)}
                onFocus={() => setHold(true)}
                onBlur={() => setHold(false)}
              >
                <span className="vx-cb-peek-top">
                  <span className="vx-cb-peek-dot" aria-hidden="true" />
                  <span className="vx-cb-peek-title">{tx(shownPeek.kind === "new" ? W.newMessage : W.waiting(shownPeek.waiting))}</span>
                  <button type="button" className="vx-cb-peek-x tap" aria-label={tx(W.close)} onClick={() => setPeek(null)}>
                    <Ic n="x" size={18} />
                  </button>
                </span>
                <span className="vx-cb-peek-name">{shownPeek.latest.name}</span>
                {shownPeek.latest.children ? <span className="vx-cb-peek-kids">{shownPeek.latest.children}</span> : null}
                {shownPeek.latest.preview ? <span className="vx-cb-peek-text">{tx(shownPeek.latest.preview)}</span> : null}
                <span className="vx-cb-peek-acts">
                  <button type="button" className="vx-cb-peek-go tap" onClick={() => openPanel(many ? null : shownPeek.latest.chatId)}>
                    <Ic n={lookOnly ? "eye" : "message"} size={19} />
                    {tx(go)}
                  </button>
                  <button type="button" className="vx-cb-peek-later tap" onClick={() => setPeek(null)}>
                    {tx(W.later)}
                  </button>
                </span>
                {raw === null && shownPeek.kind === "open" ? <span className="vx-cb-peek-tip">{tx(W.tip)}</span> : null}
              </div>
            ) : null}
            <button
              ref={button}
              type="button"
              className="vx-cb-btn"
              aria-label={tx(W.label(waiting))}
              aria-haspopup="dialog"
              aria-expanded={panelOpen}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(event) => endDrag(event, true)}
              onPointerCancel={(event) => endDrag(event, false)}
              onPointerEnter={warmPanel}
              onFocus={warmPanel}
              onClick={onClick}
              onContextMenu={(event) => event.preventDefault()}
            >
              {waiting > 0 && ring > 0 ? <span key={ring} className="vx-cb-ring" aria-hidden="true" /> : null}
              <Ic n="message" size={28} aria-hidden="true" />
              <span className="vx-cb-w" aria-hidden="true">
                {tx(W.chats)}
              </span>
              {waiting > 0 ? (
                <span key={waiting} className="vx-cb-n" aria-hidden="true">
                  {countText(waiting)}
                </span>
              ) : null}
            </button>
          </div>
        </>
      ) : null}
      {panel ? (
        <ChatPanel
          start={panel.chat}
          since={panel.at}
          lookOnly={lookOnly}
          onClose={() => setPanel(null)}
          onActivity={() => lookSoon.current()}
        />
      ) : null}
    </>
  );
}
