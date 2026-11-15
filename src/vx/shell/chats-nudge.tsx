"use client";

import { usePathname } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";

import { cue } from "@/ui/feedback/cue";
import Link from "@/ui/link";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";

import { setLiveChatCount, useLiveChatCount } from "./chat-live";
import type { Badges } from "./sidebar";

import "./chats-nudge.css";

/*
 * Parents waiting, on every screen (D-618). Two things, both for people who
 * may never think to open a menu:
 *
 *  - a strip across the top of the content while any parent waits for this
 *    person's reply, with one big "Open chats" button. "Later" hides it until
 *    another parent is waiting;
 *  - a card that drops in when a parent writes while One is open: who, about
 *    which child, the first words, and "Open chat". It goes by itself.
 *
 * It asks `/chats/pulse` every 30 seconds while the screen is in view, and
 * not at all on Chats, which asks for itself. Each fresh number also goes to
 * the menu's badge (`chat-live.ts`).
 */

const PULSE_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** How long the new-message card stays when nobody touches it. */
const CARD_MS = 20_000;

/** The newest waiting parent, as `/chats/pulse` says it: the preview already in words. */
type Latest = { chatId: string; name: string; children: string | null; preview: Pair | null; at: string };
type PulseBody = { waiting?: number; latest?: Latest | null; failed?: boolean };

const T = {
  waiting: (n: number) =>
    n === 1
      ? p("1 parent is waiting for your reply", "1 अभिभावक आपके जवाब की राह देख रहे हैं")
      : p(`${n} parents are waiting for your reply`, `${n} अभिभावक आपके जवाब की राह देख रहे हैं`),
  open: p("Open chats", "चैट खोलें"),
  later: p("Later", "बाद में"),
  title: p("New message from a parent", "अभिभावक का नया संदेश"),
  openChat: p("Open chat", "चैट खोलें"),
  close: p("Close", "बंद करें"),
};

const isChats = (path: string) => path === "/chats" || path.startsWith("/chats/");

/** Milliseconds for an ISO time; 0 for anything unreadable, so it is never "newer". */
function timeOf(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * `badges`: the shell's counts, for the number before the first look.
 * `since`: when the server drew the shell; only a parent who writes after it
 * brings up the card.
 */
export function ChatsNudge({ badges, since }: { badges: Promise<Badges>; since: string }) {
  const { tx, sub } = useVx();
  const served = use(badges).chats ?? 0;
  const live = useLiveChatCount();
  const waiting = live ?? served;
  const pathname = usePathname() ?? "";
  const inChats = isChats(pathname);
  const [laterAt, setLaterAt] = useState<number | null>(null);
  const [card, setCard] = useState<Latest | null>(null);
  const announced = useRef(timeOf(since));
  const inChatsNow = useRef(inChats);

  useEffect(() => {
    inChatsNow.current = inChats;
  }, [inChats]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let delay = PULSE_MS;
    let lastLook = Date.now();
    const look = async () => {
      window.clearTimeout(timer);
      if (!alive) return;
      if (document.visibilityState === "visible" && !inChatsNow.current) {
        lastLook = Date.now();
        try {
          const response = await fetch("/chats/pulse", { cache: "no-store", headers: { accept: "application/json" } });
          const body = response.ok ? ((await response.json().catch(() => null)) as PulseBody | null) : null;
          if (!alive) return;
          if (body && !body.failed && typeof body.waiting === "number") {
            delay = PULSE_MS;
            setLiveChatCount(body.waiting);
            const latest = body.latest ?? null;
            if (latest && timeOf(latest.at) > announced.current) {
              announced.current = timeOf(latest.at);
              if (!inChatsNow.current) {
                setCard(latest);
                cue("ready");
              }
            }
          } else {
            delay = Math.min(delay * 2, MAX_BACKOFF_MS);
          }
        } catch {
          // Offline for a moment: look again later, less often.
          delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        }
      }
      if (alive) timer = window.setTimeout(() => void look(), delay);
    };
    const wake = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLook > 10_000) void look();
    };
    timer = window.setTimeout(() => void look(), PULSE_MS);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, []);

  // The card goes by itself; a new one restarts the wait.
  useEffect(() => {
    if (!card) return;
    const timer = window.setTimeout(() => setCard(null), CARD_MS);
    return () => window.clearTimeout(timer);
  }, [card]);

  const strip = waiting > 0 && !inChats && (laterAt === null || waiting > laterAt);
  const shownCard = card && !inChats ? card : null;
  const text = T.waiting(waiting);

  return (
    <>
      {strip ? (
        <div className="vx-chatstrip" role="status">
          <span className="vx-chatstrip-ic" aria-hidden="true">
            <Ic n="message" size={20} />
          </span>
          <span className="vx-chatstrip-t">
            {tx(text)}
            {sub(text) ? <span className="vx-chatstrip-s">{sub(text)}</span> : null}
          </span>
          <Link href="/chats" className="tap btn pri vx-chatstrip-go" onClick={() => cue("tap")}>
            {tx(T.open)}
            <Ic n="chevRight" size={18} />
          </Link>
          <button type="button" className="tap btn ghost vx-chatstrip-later" onClick={() => setLaterAt(waiting)}>
            {tx(T.later)}
          </button>
        </div>
      ) : null}
      {shownCard ? (
        <div key={`${shownCard.chatId}:${shownCard.at}`} className="vx-chatpop" role="status" aria-live="polite">
          <div className="vx-chatpop-top">
            <span className="vx-chatpop-ic" aria-hidden="true">
              <Ic n="message" size={18} />
            </span>
            <span className="vx-chatpop-title">{tx(T.title)}</span>
            <button type="button" className="tap vx-chatpop-x" aria-label={tx(T.close)} onClick={() => setCard(null)}>
              <Ic n="x" size={18} />
            </button>
          </div>
          <span className="vx-chatpop-name">{shownCard.name}</span>
          {shownCard.children ? <span className="vx-chatpop-kids">{shownCard.children}</span> : null}
          {shownCard.preview ? <span className="vx-chatpop-text">{tx(shownCard.preview)}</span> : null}
          <div className="vx-chatpop-acts">
            <Link
              href={`/chats?c=${encodeURIComponent(shownCard.chatId)}`}
              className="tap btn pri vx-chatpop-go"
              onClick={() => {
                cue("tap");
                setCard(null);
              }}
            >
              <Ic n="message" size={18} />
              {tx(T.openChat)}
            </Link>
            <button type="button" className="tap btn sec vx-chatpop-later" onClick={() => setCard(null)}>
              {tx(T.later)}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
