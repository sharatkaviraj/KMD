"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { QUICK_ACTIONS, type BottomTab } from "@/vx/nav";
import { Sheet } from "@/vx/ui/overlays";

import type { Badges } from "./sidebar";

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

const TONE: Record<(typeof QUICK_ACTIONS)[number]["tone"], { bg: string; fg: string }> = {
  pri: { bg: "var(--pri)", fg: "var(--prifg)" },
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  plain: { bg: "var(--s3)", fg: "var(--fg)" },
};

/** The admin's centre "+" sheet: the six things done most (F03). */
export function QuickActions({ open, onClose, keys }: { open: boolean; onClose: () => void; keys: readonly string[] }) {
  const { tx } = useVx();
  return (
    <Sheet open={open} onClose={onClose} title="Quick actions" sub="The things you do most">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, paddingBottom: 8 }}>
        {QUICK_ACTIONS.filter((a) => keys.includes(a.key)).map((a, i) => (
          <Link
            key={a.key}
            href={a.href}
            onClick={onClose}
            className="tap"
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 6px", borderRadius: 20, border: "1px solid var(--bd)", background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, textAlign: "center", animation: `xRise .42s var(--ease) ${60 + i * 40}ms both` }}
          >
            <span style={{ width: 50, height: 50, borderRadius: 17, background: TONE[a.tone].bg, color: TONE[a.tone].fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ic n={a.icon} size={23} />
            </span>
            {tx(a.label)}
          </Link>
        ))}
      </div>
    </Sheet>
  );
}
