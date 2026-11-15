"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";

import { LazyQuickCover, LazyQuickCoverRow, type QuickCoverTool } from "@/lib/ai/ui/lazy-quick-cover";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { QUICK_ACTIONS, type BottomTab } from "@/vx/nav";
import { IntentLink } from "@/vx/ui/intent-link";
import { Sheet } from "@/vx/ui/overlays";

import { inMarkingWindow } from "./prefetch-window";

import { useLiveChatCount } from "./chat-live";
import type { Badges } from "./sidebar";
import { TONE } from "./top-actions";

const under = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

/**
 * Which tab is lit for a path (XNav and every role's frames). The longest
 * matching tab wins, and "/" only matches itself. The centre action's own
 * screen lights nothing — the big button is its mark (M-AcadAttendance,
 * M-TchAttend) — even though a shorter tab such as Today is its prefix. A
 * screen with no tab of its own was reached from the Menu, and the design
 * lights Menu there (AC-*, MAD-*, M-Fees …, UI-78).
 */
export function activeTab(tabs: readonly BottomTab[], pathname: string): string | null {
  // A teacher's bar has no Menu; More (notices, links, leave) is her catch-all,
  // so Marks and remarks light More rather than Today (smoke 20 Oct).
  const menu = tabs.find((t) => t.key === "menu") ?? tabs.find((t) => t.key === "more") ?? null;
  // The role's home lights only on itself where there is a Menu to light instead:
  // Cheques, UPI & refunds (/accounts/books) is reached from Menu, and lit
  // Today (smoke 20 Oct). A role without a Menu tab keeps its home lit.
  const isHome = (t: BottomTab) => (t.key === "home" || t.key === "today") && menu !== null && pathname !== t.href;
  const best = tabs.filter((t) => !t.center && under(pathname, t.href) && !isHome(t)).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
  const center = tabs.find((t) => t.center && t.href.startsWith("/") && under(pathname, t.href.split("?")[0]));
  if (center && (!best || center.href.length > best.href.length)) return null;
  if (best) return best.href;
  return menu?.href ?? null;
}

type RouterPrefetchOptions = NonNullable<Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]>;

/** How long a tapped tab stays lit if its page never arrives. */
const TAP_HOLD_MS = 8000;

/** Mark attendance, from a teacher's Today during the marking hours. */
const REGISTER = "/teach/attendance";

/**
 * Warm the register while a teacher sits on Today in the morning (perf fix 9):
 * throttled tab navigation took 2.4 s to Attendance, and Today's own centre
 * button is the next thing she taps. A full prefetch once the page is idle;
 * with `staleTimes.dynamic` it then opens from the router cache.
 */
function useRegisterWarmup(tabs: readonly BottomTab[], pathname: string) {
  const router = useRouter();
  const hasRegister = tabs.some((t) => t.center && t.href === REGISTER);
  useEffect(() => {
    if (!hasRegister || pathname !== "/teach" || !inMarkingWindow(new Date())) return;
    const warm = () => router.prefetch(REGISTER, { kind: "full" } as unknown as RouterPrefetchOptions);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(id);
  }, [hasRegister, pathname, router]);
}

/**
 * The phone bottom bar (`XNav.dc.html`): four tabs and a centre action.
 *
 * Tabs are intent links (perf fix 9): a finger landing on one starts the full
 * server render, so most of the next screen is ready when the tap completes.
 */
export function VxBottomBar({ tabs, badges, coverAi = false }: {
  tabs: BottomTab[];
  badges: Promise<Badges>;
  /** Built-in AI may arrange cover for this person in this session (`coverPhotoEnabled`). */
  coverAi?: boolean;
}) {
  const pathname = (usePathname() ?? "/").split(/[?#]/)[0] || "/";
  const { tx } = useVx();
  const [quick, setQuick] = useState(false);
  const [tool, setTool] = useState<QuickCoverTool | null>(null);
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const tapTimer = useRef<number | null>(null);
  useEffect(() => () => { if (tapTimer.current !== null) window.clearTimeout(tapTimer.current); }, []);
  // The tapped tab lights at once, not when its page arrives a second or two
  // later (owner's smoke, 7 Nov 2026: "the tab moves late"). The address
  // catching up hands the highlight back to the route, and so does a tap that
  // went nowhere, after a few seconds.
  const active = tapped && tapped.from === pathname ? tapped.href : activeTab(tabs, pathname);
  // Once the page has moved on, the tap is spent: Back to where it was tapped
  // must not light it again.
  useEffect(() => {
    if (!tapped || tapped.from === pathname) return;
    const spent = window.setTimeout(() => setTapped(null), 0);
    return () => window.clearTimeout(spent);
  }, [tapped, pathname]);
  const lightNow = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    // A tap that opens a new tab, or that something else took, goes nowhere here.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (href === active) return;
    setTapped({ href, from: pathname });
    if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => setTapped(null), TAP_HOLD_MS);
  };
  useRegisterWarmup(tabs, pathname);
  // The classic receipt detail supplies its own fixed phone action bar and
  // return link. A second bar covers its Print A4 control. Keep list routes
  // and the redesigned /receipts desk on their normal tab navigation.
  if (pathname.startsWith("/fees/receipts/")) return null;
  return (
    <>
      <nav className="vxt glass vx-bottom" aria-label="Primary navigation" style={{ height: "calc(76px + env(safe-area-inset-bottom))", padding: "6px 6px calc(16px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--bd)", background: "var(--glass2)", display: "grid", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, boxSizing: "border-box" }}>
        {tabs.map((n) =>
          n.center ? (
            n.href === "#quick" ? (
              <button key={n.key} type="button" className="tap vx-center" aria-label={tx(n.label)} onClick={() => setQuick(true)} style={CENTER_STYLE}>
                <CenterBlob icon={n.icon} />
                <span className="clip vx-tab-label" aria-hidden="true" style={CENTER_LABEL}>{tx(n.short ?? n.label)}</span>
              </button>
            ) : (
              <IntentLink feedback key={n.key} href={n.href} className="tap vx-center" aria-label={tx(n.label)} style={CENTER_STYLE}>
                <CenterBlob icon={n.icon} />
                <span className="clip vx-tab-label" aria-hidden="true" style={CENTER_LABEL}>{tx(n.short ?? n.label)}</span>
              </IntentLink>
            )
          ) : (
            <IntentLink
              feedback
              key={n.key}
              href={n.href}
              className="tap"
              onClick={(event) => lightNow(event, n.href)}
              aria-current={active === n.href ? "page" : undefined}
              style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: active === n.href ? "var(--pri)" : "var(--mut)", fontWeight: active === n.href ? 700 : 500 }}
            >
              <span style={{ position: "relative", width: 56, height: 30, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", background: active === n.href ? "var(--accs)" : "transparent", transition: "background-color .2s ease" }}>
                <Ic n={n.icon} size={22} />
                {n.badge ? (
                  <Suspense fallback={null}>
                    <TabBadge badges={badges} k={n.badge} />
                  </Suspense>
                ) : null}
              </span>
              <span className="clip vx-tab-label" style={{ maxWidth: "100%" }}>{tx(n.label)}</span>
            </IntentLink>
          ),
        )}
      </nav>
      <QuickActions open={quick} onClose={() => setQuick(false)} keys={tabs.find((t) => t.center)?.quick ?? []}
        onCover={coverAi ? setTool : undefined} />
      {tool ? <LazyQuickCover key={tool.key} tool={tool} onClose={() => setTool(null)} /> : null}
    </>
  );
}

/**
 * The centre action lifts above the bar so its word fits under it, like the
 * other tabs. A label-less "+" meant nothing to staff who judge a screen by
 * what is written on it (UX review, 6 Nov 2026).
 */
const CENTER_STYLE = { border: 0, background: "transparent", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 3 } as const;
/**
 * The centre word may run a little into its neighbours' columns, whose own
 * words are short and centred ("Class", "Notes"): "Attendance" needs about
 * 76 px and a column on a 360 px phone has 70, so it read "Attendan…"
 * (second pass, 7 Nov). Centred in a column flexbox, it grows on both sides.
 */
const CENTER_LABEL = { maxWidth: "calc(100% + 24px)", color: "var(--pri)", fontWeight: 700 } as const;

function CenterBlob({ icon }: { icon: IconName }) {
  return (
    <span style={{ marginTop: -22, width: 50, height: 50, borderRadius: 18, background: "var(--pri)", color: "var(--prifg)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 22px -10px rgba(11,79,121,.75)" }}>
      <Ic n={icon} size={26} stroke={2.4} />
    </span>
  );
}

function TabBadge({ badges, k }: { badges: Promise<Badges>; k: keyof Badges }) {
  const served = use(badges)[k] ?? 0;
  // Parents waiting (D-618) is kept fresh while the shell stays put.
  const live = useLiveChatCount();
  const n = k === "chats" && live !== null ? live : served;
  if (!n) return null;
  return (
    <span className="num" aria-label={`${n} waiting`} style={{ position: "absolute", top: -3, right: 8, minWidth: 19, height: 19, padding: "0 5px", borderRadius: 10, background: "var(--bad)", color: "var(--onsolid)", border: "2px solid var(--card)", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .45s var(--spring) both" }}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** The last quick action tapped on this phone, for "Repeat last" (a per-device convenience, like the sidebar's collapse). */
const LAST_KEY = "vx.quick.last";
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
    // Private mode: nothing to repeat next time.
  }
}

const QW = {
  title: { en: "Quick actions", hi: "जल्दी के काम" },
  six: { en: "The six things you do most", hi: "छह काम जो आप सबसे ज़्यादा करते हैं" },
  some: { en: "The things you do most", hi: "काम जो आप सबसे ज़्यादा करते हैं" },
  close: { en: "Close", hi: "बंद करें" },
  repeat: { en: "Repeat last", hi: "पिछला दोहराएँ" },
};

/**
 * The admin's centre "+" sheet (F03): the six things done most, each shown
 * only to a reader whose permission opens its screen, and "Repeat last" for
 * the action last tapped on this phone. The design's line also names the
 * child; the app does not keep that, so the row names the action alone.
 */
export function QuickActions({ open, onClose, keys, onCover }: {
  open: boolean;
  onClose: () => void;
  keys: readonly string[];
  /** Set when this person may arrange cover with built-in AI: shows Quick substitute. */
  onCover?: (tool: QuickCoverTool) => void;
}) {
  const { tx } = useVx();
  const quickCover = Boolean(onCover && keys.includes("cover"));
  // Quick substitute replaces the plain "Assign substitute" tile, which it links to as Arrange.
  const actions = QUICK_ACTIONS.filter((a) => keys.includes(a.key) && !(quickCover && a.key === "cover"));
  const lastKey = useSyncExternalStore(subscribeLast, readLast, () => null);
  const last = actions.find((a) => a.key === lastKey) ?? null;
  const pick = (key: string) => {
    rememberLast(key);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} label={tx(QW.title)}>
      <div className="vx-quick">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h2 className="serif" style={{ margin: 0, fontSize: 25, fontWeight: 600, lineHeight: 1.2 }}>{tx(QW.title)}</h2>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(actions.length === 6 ? QW.six : QW.some)}</span>
          </div>
          <button type="button" data-close className="tap" aria-label={tx(QW.close)} onClick={onClose} style={{ flex: "none", width: 44, height: 44, borderRadius: 22, border: 0, background: "var(--s2)", color: "var(--fg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="x" />
          </button>
        </div>
        {quickCover && onCover ? <LazyQuickCoverRow onPick={onCover} onClose={onClose} /> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {actions.map((a, i) => (
            <Link
              key={a.key}
              href={a.href}
              onClick={() => pick(a.key)}
              className="tap"
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 6px", borderRadius: 20, border: "1px solid var(--bd)", background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, textAlign: "center", lineHeight: 1.25, animation: `xRise .42s var(--ease) ${i * 40}ms both` }}
            >
              <span style={{ width: 50, height: 50, borderRadius: 17, background: TONE[a.tone].bg, color: TONE[a.tone].fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={a.icon} size={23} />
              </span>
              {tx(a.label)}
            </Link>
          ))}
        </div>
        {last ? (
          <Link href={last.href} onClick={() => pick(last.key)} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 14px", borderRadius: 18, background: "var(--s2)", color: "var(--fg)", textAlign: "left", animation: "xRise .42s .22s var(--ease) both" }}>
            <Ic n="clock" style={{ color: "var(--mut)" }} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(QW.repeat)}</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{`${tx(last.label)} · ${tx(last.sub)}`}</span>
            </span>
            <Ic n="chevRight" style={{ color: "var(--mut)" }} />
          </Link>
        ) : null}
      </div>
    </Sheet>
  );
}
