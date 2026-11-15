"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useEffect, useRef, useState, type MouseEvent } from "react";

import { cue } from "@/ui/feedback/cue";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { BottomTab } from "@/vx/nav";
import type { QuickSet } from "@/vx/quick";
import { IntentLink } from "@/vx/ui/intent-link";

import { inMarkingWindow } from "./prefetch-window";

import { useLiveChatCount } from "./chat-live";
import { closeQuick, openQuick, useQuickOpen } from "./quick-state";
import type { Badges } from "./sidebar";

const under = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

/**
 * Which tab is lit for a path (XNav and every role's frames). The longest
 * matching tab wins, and "/" only matches itself. The screens the "+" stands
 * for (`own`: the register, the Payment Desk …) light nothing — the big
 * button is their mark (M-AcadAttendance, M-TchAttend) — even though a
 * shorter tab such as Today is their prefix. A screen with no tab of its own
 * was reached from the Menu, and the design lights Menu there (AC-*, MAD-*,
 * M-Fees …, UI-78).
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
  const own = tabs.find((t) => t.center)?.own?.find((href) => under(pathname, href)) ?? null;
  if (own && (!best || own.length > best.href.length)) return null;
  if (best) return best.href;
  return menu?.href ?? null;
}

type RouterPrefetchOptions = NonNullable<Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]>;

/** How long a tapped tab stays lit if its page never arrives. */
const TAP_HOLD_MS = 8000;

/** Mark attendance, the big card at the top of a class teacher's "+". */
const REGISTER = "/teach/attendance";

/**
 * Warm the register while a teacher sits on Today in the morning (perf fix 9):
 * throttled tab navigation took 2.4 s to Attendance, and the "+"'s first card
 * is the next thing she taps. A full prefetch once the page is idle; with
 * `staleTimes.dynamic` it then opens from the router cache.
 */
function useRegisterWarmup(hasRegister: boolean, pathname: string) {
  const router = useRouter();
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

/** The "+" sheet's code, fetched when the phone is idle so the first "+" opens at once. */
const loadQuickSheet = () => import("./quick-sheet").then((m) => m.QuickSheet);
const LazyQuickSheet = dynamic(loadQuickSheet, { ssr: false });

/**
 * Mounts the "+" sheet from its first opening on, and fetches its code once
 * the page has settled. It lives with the bar, but the desk side menu's Quick
 * actions opens it too (the bar is hidden there, not gone).
 */
function QuickMount({ quick, badges }: { quick: QuickSet; badges: Promise<Badges> }) {
  const open = useQuickOpen();
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  useEffect(() => {
    const warm = () => void loadQuickSheet().catch(() => undefined);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 8000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 4000);
    return () => window.clearTimeout(id);
  }, []);
  return wanted ? <LazyQuickSheet quick={quick} badges={badges} /> : null;
}

/**
 * The phone bottom bar (`XNav.dc.html`): four tabs and the "+" in the middle
 * (D-643), which opens the person's own quick actions and turns into a "×"
 * while they are open. The bar stays on top of the sheet then, its other tabs
 * stepped back: a tap anywhere on it closes the sheet.
 *
 * Tabs are intent links (perf fix 9): a finger landing on one starts the full
 * server render, so most of the next screen is ready when the tap completes.
 */
export function VxBottomBar({ tabs, badges, quick = null }: {
  tabs: BottomTab[];
  badges: Promise<Badges>;
  /** What this person's "+" holds (`quickFor`, worked out on the server). */
  quick?: QuickSet | null;
}) {
  const pathname = (usePathname() ?? "/").split(/[?#]/)[0] || "/";
  const { tx } = useVx();
  const open = useQuickOpen();
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
  useRegisterWarmup(quick?.live === "register", pathname);
  // While the sheet is open the tabs step back: a tap anywhere else on the bar closes it.
  const closeFromBar = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target as Element).closest(".vx-center")) closeQuick();
  };
  const toggle = () => {
    cue("tap");
    if (open) closeQuick();
    else openQuick();
  };
  // The classic receipt detail supplies its own fixed phone action bar and
  // return link. A second bar covers its Print A4 control. Keep list routes
  // and the redesigned /receipts desk on their normal tab navigation.
  const hidden = pathname.startsWith("/fees/receipts/");
  // A bar drawn without its "+" list (a test frame) leaves the "+" out rather than showing one that opens nothing.
  const shown = quick ? tabs : tabs.filter((t) => !t.center);
  return (
    <>
      {hidden ? null : (
        <nav
          className="vxt glass vx-bottom"
          aria-label="Primary navigation"
          data-quick={open ? "" : undefined}
          onClick={open ? closeFromBar : undefined}
          style={{ height: "calc(76px + env(safe-area-inset-bottom))", padding: "6px 6px calc(16px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--bd)", background: "var(--glass2)", display: "grid", gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, boxSizing: "border-box" }}
        >
          {shown.map((n) =>
            n.center ? (
              <button key={n.key} type="button" className="tap vx-center" aria-label={tx(open ? CLOSE : n.label)} aria-haspopup="dialog" aria-expanded={open} onClick={toggle} style={CENTER_STYLE}>
                <CenterBlob icon={n.icon} />
                <span className="clip vx-tab-label" aria-hidden="true" style={CENTER_LABEL}>{tx(open ? CLOSE : (n.short ?? n.label))}</span>
              </button>
            ) : (
              <IntentLink
                feedback
                key={n.key}
                href={n.href}
                className="tap vx-tab"
                tabIndex={open ? -1 : undefined}
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
      )}
      {quick ? <QuickMount quick={quick} badges={badges} /> : null}
    </>
  );
}

const CLOSE = { en: "Close", hi: "बंद करें" };

/**
 * The "+" lifts above the bar so its word fits under it, like the other tabs.
 * A label-less "+" meant nothing to staff who judge a screen by what is
 * written on it (UX review, 6 Nov 2026), so it says "Quick", and "Close"
 * while its sheet is open.
 */
const CENTER_STYLE = { border: 0, background: "transparent", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 3 } as const;
/**
 * The centre word may run a little into its neighbours' columns, whose own
 * words are short and centred ("Class", "Notes"): "Attendance" needed about
 * 76 px and a column on a 360 px phone has 70, so it read "Attendan…"
 * (second pass, 7 Nov). Centred in a column flexbox, it grows on both sides.
 */
const CENTER_LABEL = { maxWidth: "calc(100% + 24px)", color: "var(--pri)", fontWeight: 700 } as const;

function CenterBlob({ icon }: { icon: IconName }) {
  return (
    <span className="vx-blob" style={{ marginTop: -22, width: 50, height: 50, borderRadius: 18, background: "var(--pri)", color: "var(--prifg)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 22px -10px rgba(11,79,121,.75)" }}>
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
