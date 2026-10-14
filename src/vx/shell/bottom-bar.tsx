"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState, useSyncExternalStore } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { QUICK_ACTIONS, type BottomTab } from "@/vx/nav";
import { Sheet } from "@/vx/ui/overlays";

import type { Badges } from "./sidebar";
import { TONE } from "./top-actions";

/** The phone bottom bar (`XNav.dc.html`): four tabs and a centre action. */
export function VxBottomBar({ tabs, badges }: { tabs: BottomTab[]; badges: Promise<Badges> }) {
  const pathname = usePathname() ?? "/";
  const { tx } = useVx();
  const [quick, setQuick] = useState(false);
  // Longest matching tab wins; "/" only matches itself.
  const matched =
    tabs
      .filter((t) => !t.center && (t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(`${t.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  // A screen with no tab of its own was reached from the Menu, and the design
  // lights Menu there (AC-*, MAD-*, M-Fees …), not nothing.
  const active = matched ?? tabs.find((t) => t.key === "menu")?.href ?? null;
  // The classic receipt detail supplies its own fixed phone action bar and
  // return link. A second bar covers its Print A4 control. Keep list routes
  // and the redesigned /receipts desk on their normal tab navigation.
  if (pathname.startsWith("/fees/receipts/")) return null;
  return (
    <>
      <nav className="vxt glass vx-bottom" aria-label="Primary navigation" style={{ height: "var(--vx-bottom-h)", padding: "6px 6px calc(16px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--bd)", background: "var(--glass2)", display: "grid", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, boxSizing: "border-box" }}>
        {tabs.map((n) =>
          n.center ? (
            n.href === "#quick" ? (
              <button key={n.key} type="button" className="tap" aria-label={tx(n.label)} onClick={() => setQuick(true)} style={{ border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CenterBlob icon={n.icon} />
              </button>
            ) : (
              <Link key={n.key} href={n.href} className="tap" aria-label={tx(n.label)} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CenterBlob icon={n.icon} />
              </Link>
            )
          ) : (
            <Link
              key={n.key}
              href={n.href}
              className="tap"
              aria-current={active === n.href ? "page" : undefined}
              style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: active === n.href ? "var(--pri)" : "var(--mut)", fontSize: 11, fontWeight: active === n.href ? 700 : 500 }}
            >
              <span style={{ position: "relative", width: 56, height: 30, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", background: active === n.href ? "var(--accs)" : "transparent", transition: "background-color .2s ease" }}>
                <Ic n={n.icon} size={22} />
                {n.badge ? (
                  <Suspense fallback={null}>
                    <TabBadge badges={badges} k={n.badge} />
                  </Suspense>
                ) : null}
              </span>
              <span className="clip" style={{ maxWidth: "100%" }}>{tx(n.label)}</span>
            </Link>
          ),
        )}
      </nav>
      <QuickActions open={quick} onClose={() => setQuick(false)} keys={tabs.find((t) => t.center)?.quick ?? []} />
    </>
  );
}

function CenterBlob({ icon }: { icon: IconName }) {
  return (
    <span style={{ width: 50, height: 50, borderRadius: 18, background: "var(--pri)", color: "var(--prifg)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 22px -10px rgba(11,79,121,.75)" }}>
      <Ic n={icon} size={26} stroke={2.4} />
    </span>
  );
}

function TabBadge({ badges, k }: { badges: Promise<Badges>; k: keyof Badges }) {
  const n = use(badges)[k] ?? 0;
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
export function QuickActions({ open, onClose, keys }: { open: boolean; onClose: () => void; keys: readonly string[] }) {
  const { tx } = useVx();
  const actions = QUICK_ACTIONS.filter((a) => keys.includes(a.key));
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
