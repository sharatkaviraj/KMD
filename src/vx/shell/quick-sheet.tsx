"use client";

import { useRouter } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { LazyQuickCover, LazyQuickCoverRow, type QuickCoverTool } from "@/lib/ai/ui/lazy-quick-cover";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { QuickItem, QuickSet } from "@/vx/quick";
import { IntentLink } from "@/vx/ui/intent-link";
import { ListenButton } from "@/vx/ui/listen";
import { Sheet } from "@/vx/ui/overlays";

import { lastAction, registerLine, type QuickRegister } from "./quick-logic";
import { closeQuick, useQuickOpen, useQuickSeq } from "./quick-state";
import type { Badges } from "./sidebar";

import "./quick-sheet.css";

const QS = {
  title: { en: "Quick actions", hi: "झटपट काम" },
  sub: { en: "Tap what you want to do", hi: "जो करना है, उस पर टैप करें" },
  close: { en: "Close", hi: "बंद करें" },
  find: { en: "Find a student", hi: "विद्यार्थी ढूँढें" },
  findSub: { en: "Name, class or admission number", hi: "नाम, कक्षा या प्रवेश संख्या" },
  checking: { en: "Checking today's register…", hi: "आज की हाज़िरी देख रहे हैं…" },
  opening: { en: "Opening…", hi: "खुल रहा है…" },
  last: { en: "Last time", hi: "पिछली बार" },
};

/** Our own history entry while the sheet is open: Back closes it, and a tile's page takes its place. */
const MARK = "__vxQuick";
let markSeq = 0;

/** If a page never arrives, the sheet does not wait for it forever. */
const GIVE_UP_MS = 12000;
/** The sheet's closing animation and its focus hand-back, before the search opens over it. */
const AFTER_CLOSE_MS = 260;

/** The last quick action tapped on this phone, for "Last time" (a per-device convenience). */
const LAST_KEY = "vx.quick.last";
/** The "Last time" row's data-key prefix, so a tap there lights the row and not its tile as well. */
const AGAIN = "again:";
const LAST_EVENT = "vx:quick-last";

function readLast(): string | null {
  try {
    return window.localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function subscribeLast(cb: () => void) {
  window.addEventListener(LAST_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(LAST_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function rememberLast(key: string) {
  try {
    window.localStorage.setItem(LAST_KEY, key);
    window.dispatchEvent(new Event(LAST_EVENT));
  } catch {
    // Private mode: nothing to offer again next time.
  }
}

/** Runs `fn` once the closing sheet has given its history entry back (or soon after, if it had none). */
function afterPop(fn: () => void) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener("popstate", finish);
    window.clearTimeout(timer);
    fn();
  };
  window.addEventListener("popstate", finish);
  const timer = window.setTimeout(finish, 600);
}

/**
 * The "+" sheet (D-643): the person's first job of the day as one big card,
 * the rest of their day as large labelled tiles, and "Find a student" on top.
 * Loaded on the first "+" (or earlier, when the phone is idle), so no screen
 * pays for it at first paint.
 *
 * A tapped tile answers at once: it shows "Opening…" with a spinner and the
 * sheet stays up until the page has arrived, then slides away over it. The
 * sheet's own history entry becomes that page's, so Back from the page comes
 * straight back to where the "+" was tapped.
 */
export function QuickSheet({ quick, badges }: { quick: QuickSet; badges: Promise<Badges> }) {
  const { tx, sub } = useVx();
  const open = useQuickOpen();
  const seq = useQuickSeq();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [going, setGoing] = useState<{ key: string; seq: number } | null>(null);
  const [tool, setTool] = useState<QuickCoverTool | null>(null);
  const goingNow = going && going.seq === seq && open ? going.key : null;
  const marker = useRef<number | null>(null);

  // Back closes the sheet; closing it any other way gives the entry back.
  useEffect(() => {
    if (!open) return undefined;
    markSeq += 1;
    const id = markSeq;
    window.history.pushState({ ...(window.history.state ?? {}), [MARK]: id }, "");
    marker.current = id;
    const onPop = (e: PopStateEvent) => {
      if ((e.state as Record<string, unknown> | null)?.[MARK] === id) return;
      marker.current = null;
      closeQuick();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (marker.current === id) {
        marker.current = null;
        window.history.back();
      }
    };
  }, [open]);

  // The page has arrived (or never will): the sheet slides away over it.
  useEffect(() => {
    if (!goingNow || pending) return;
    closeQuick();
  }, [goingNow, pending]);
  useEffect(() => {
    if (!goingNow) return undefined;
    const t = window.setTimeout(closeQuick, GIVE_UP_MS);
    return () => window.clearTimeout(t);
  }, [goingNow]);

  const go = (key: string, href: string) => {
    if (goingNow) return;
    cue("select");
    rememberLast(key.startsWith(AGAIN) ? key.slice(AGAIN.length) : key);
    setGoing({ key, seq });
    // The sheet's history entry becomes the page's own.
    marker.current = null;
    start(() => router.replace(href));
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  // Every link inside the sheet (tiles, the hero, Quick substitute's Arrange)
  // goes through `go`, before Next's own handler can push a second entry.
  const intercept = useCallback((el: HTMLDivElement | null) => {
    if (!el) return undefined;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || !el.contains(a) || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      goRef.current(a.dataset.key ?? url.pathname, `${url.pathname}${url.search}${url.hash}`);
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, []);

  const find = () => {
    cue("select");
    closeQuick();
    window.setTimeout(() => window.dispatchEvent(new Event("vx:search")), AFTER_CLOSE_MS);
  };

  const register = useRegister(quick.live === "register" && open, seq);
  const line = quick.live === "register" ? registerLine(register) : null;
  const checking = quick.live === "register" && register === undefined;

  // The row offers what was tapped before this opening: a tap now must not add or change it mid-way.
  const storedLast = useSyncExternalStore(subscribeLast, readLast, () => null);
  const [lastAt, setLastAt] = useState({ seq, key: storedLast });
  if (lastAt.seq !== seq) setLastAt({ seq, key: storedLast });
  const lastKey = lastAt.seq === seq ? lastAt.key : storedLast;
  const last = quick.layout === "compact" ? lastAction(quick.tiles, lastKey, quick.hero?.href ?? null) : null;

  const hero = quick.hero;
  const listen = [
    tx(QS.title),
    hero ? `${tx(hero.label)}. ${line ? tx(line.line) : tx(hero.hint)}` : null,
    ...quick.tiles.map((t) => `${tx(t.label)}. ${tx(t.hint)}`),
  ].filter((l): l is string => Boolean(l));

  return (
    <>
      <Sheet open={open} onClose={closeQuick} label={tx(QS.title)} className="vx-qs-sheet">
        <div ref={intercept} className="vx-qs" data-layout={quick.layout} data-going={goingNow ? "" : undefined}>
          <div className="vx-qs-head" data-drag-zone="">
            <div className="vx-qs-titles">
              <h2 className="serif vx-qs-title">{tx(QS.title)}</h2>
              <span className="vx-qs-sub">{goingNow ? tx(QS.opening) : tx(QS.sub)}</span>
            </div>
            <ListenButton lines={listen} className="tap btn sec vx-qs-listen" />
            <button type="button" data-close className="tap vx-qs-x" aria-label={tx(QS.close)} onClick={closeQuick}>
              <Ic n="x" />
            </button>
          </div>

          {quick.search ? (
            <button type="button" className="tap vx-qs-find" onClick={find}>
              <Ic n="search" size={20} />
              <span className="vx-qs-find-txt">
                <span className="vx-qs-find-l">{tx(QS.find)}</span>
                <span className="vx-qs-find-s">{tx(QS.findSub)}</span>
              </span>
            </button>
          ) : null}

          {quick.coverAi ? (
            <LazyQuickCoverRow onClose={closeQuick} onPick={(t) => afterPop(() => setTool(t))} />
          ) : null}

          {hero ? (
            <IntentLink href={hero.href} data-key={hero.key} className="tap vx-qs-hero" data-on={goingNow === hero.key ? "" : undefined}>
              <span className="vx-qs-hero-ic" aria-hidden="true">
                <Ic n={hero.icon} size={28} />
              </span>
              <span className="vx-qs-hero-txt">
                <span className="vx-qs-hero-l">{tx(hero.label)}</span>
                {sub(hero.label) ? <span className="vx-qs-hero-o">{sub(hero.label)}</span> : null}
                {checking ? (
                  <span className="vx-qs-line" data-tone="wait">
                    <span className="vx-qs-dots" aria-hidden="true"><i /><i /><i /></span>
                    {tx(QS.checking)}
                  </span>
                ) : line ? (
                  <span className="vx-qs-line" data-tone={line.tone}>
                    {line.tone === "ok" ? <Ic n="check" size={15} stroke={2.6} /> : <span className="vx-qs-dot" aria-hidden="true" />}
                    {tx(line.line)}
                  </span>
                ) : (
                  <span className="vx-qs-hero-h">{tx(hero.hint)}</span>
                )}
              </span>
              <span className="vx-qs-hero-go" aria-hidden="true">
                {goingNow === hero.key ? <span className="vx-qs-spin" /> : <Ic n="arrowRight" size={22} />}
              </span>
            </IntentLink>
          ) : null}

          {quick.tiles.length ? (
            <div className="vx-qs-grid">
              {quick.tiles.map((t, i) => (
                <Tile key={t.key} item={t} index={i} badges={badges} going={goingNow === t.key} roomy={quick.layout === "roomy"} />
              ))}
            </div>
          ) : null}

          {last ? (
            <IntentLink href={last.href} data-key={AGAIN + last.key} className="tap vx-qs-row" data-on={goingNow === AGAIN + last.key ? "" : undefined}>
              <Ic n="clock" style={{ color: "var(--mut)" }} />
              <span className="vx-qs-row-txt">
                <span className="vx-qs-row-s">{tx(QS.last)}</span>
                <span className="vx-qs-row-l">{tx(last.label)}</span>
              </span>
              {goingNow === AGAIN + last.key ? <span className="vx-qs-spin" aria-hidden="true" /> : <Ic n="chevRight" style={{ color: "var(--mut)" }} />}
            </IntentLink>
          ) : null}

          {quick.help ? (
            <IntentLink href={quick.help.href} data-key={quick.help.key} className="tap vx-qs-row vx-qs-help" data-on={goingNow === quick.help.key ? "" : undefined}>
              <Ic n={quick.help.icon} style={{ color: "var(--acc)" }} />
              <span className="vx-qs-row-txt">
                <span className="vx-qs-row-l">{tx(quick.help.label)}</span>
                <span className="vx-qs-row-s">{tx(quick.help.hint)}</span>
              </span>
              {goingNow === quick.help.key ? <span className="vx-qs-spin" aria-hidden="true" /> : <Ic n="chevRight" style={{ color: "var(--mut)" }} />}
            </IntentLink>
          ) : null}
        </div>
      </Sheet>
      {tool ? <LazyQuickCover key={tool.key} tool={tool} onClose={() => setTool(null)} /> : null}
    </>
  );
}

function Tile({ item, index, badges, going, roomy }: { item: QuickItem; index: number; badges: Promise<Badges>; going: boolean; roomy: boolean }) {
  const { tx, sub } = useVx();
  const other = sub(item.label);
  return (
    <IntentLink href={item.href} data-key={item.key} className="tap vx-qs-tile" data-on={going ? "" : undefined} style={{ animationDelay: `${60 + index * 35}ms` }}>
      <span className="vx-qs-ic" data-tone={item.tone} aria-hidden="true">
        {going ? <span className="vx-qs-spin" /> : <Ic n={item.icon} size={roomy ? 24 : 23} />}
        {item.badge ? (
          <Suspense fallback={null}>
            <TileBadge badges={badges} k={item.badge} />
          </Suspense>
        ) : null}
      </span>
      <span className="vx-qs-tl">{tx(item.label)}</span>
      {roomy ? <span className="vx-qs-th">{other ?? tx(item.hint)}</span> : null}
    </IntentLink>
  );
}

function TileBadge({ badges, k }: { badges: Promise<Badges>; k: keyof Badges }) {
  const n = use(badges)[k] ?? 0;
  if (!n) return null;
  return (
    <span className="num vx-qs-badge" aria-label={`${n} waiting`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * A class teacher's register for today, asked for each time the sheet opens
 * (`undefined` until the answer is in for this opening, null when the read
 * failed). Never shown from an earlier opening: the answer may have changed
 * since, and the card must not say "Not marked yet" over a saved register.
 */
function useRegister(ask: boolean, seq: number): QuickRegister | null | undefined {
  const [answer, setAnswer] = useState<{ seq: number; value: QuickRegister | null } | null>(null);
  useEffect(() => {
    if (!ask) return undefined;
    let alive = true;
    // Fetched with the first register card, so the sheet's own code (preloaded
    // for everyone) carries no server action that most people never ask.
    import("./quick-register")
      .then((m) => m.quickRegisterAction())
      .catch(() => null)
      .then((value) => {
        if (alive) setAnswer({ seq, value });
      });
    return () => {
      alive = false;
    };
  }, [ask, seq]);
  return answer && answer.seq === seq ? answer.value : undefined;
}
