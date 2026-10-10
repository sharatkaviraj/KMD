"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { BottomTab } from "@/vx/nav";
import { Sheet } from "@/vx/ui/overlays";

import type { Badges } from "./sidebar";

/** The phone bottom bar (`XNav.dc.html`): four tabs and a centre action. */
export function VxBottomBar({ tabs, badges }: { tabs: BottomTab[]; badges: Promise<Badges> }) {
  const pathname = usePathname() ?? "/";
  const { tx } = useVx();
  const [quick, setQuick] = useState(false);
  // Longest matching tab wins; "/" only matches itself.
  const active =
    tabs
      .filter((t) => !t.center && (t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(`${t.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  return (
    <>
      <nav className="vxt glass vx-bottom" aria-label="Primary navigation" style={{ height: 76, padding: "6px 6px 16px", borderTop: "1px solid var(--bd)", background: "var(--glass2)", display: "grid", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, boxSizing: "content-box" }}>
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
      <QuickActions open={quick} onClose={() => setQuick(false)} />
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

const QUICK: { label: string; hi: string; icon: IconName; bg: string; fg: string; href: string }[] = [
  { label: "Collect fee", hi: "फीस जमा", icon: "rupee", bg: "var(--pri)", fg: "var(--prifg)", href: "/payments" },
  { label: "Mark attendance", hi: "हाज़िरी", icon: "calCheck", bg: "var(--accs)", fg: "var(--accfg)", href: "/attendance" },
  { label: "Send notice", hi: "सूचना भेजें", icon: "megaphone", bg: "var(--infos)", fg: "var(--info)", href: "/messages?compose=1" },
  { label: "Add student", hi: "नया विद्यार्थी", icon: "userPlus", bg: "var(--oks)", fg: "var(--ok)", href: "/admissions/new" },
  { label: "Assign substitute", hi: "सब्स्टिट्यूट", icon: "swap", bg: "var(--warns)", fg: "var(--warnfg)", href: "/timetable?view=subs" },
  { label: "Add a note", hi: "नोट लिखें", icon: "edit", bg: "var(--s3)", fg: "var(--fg)", href: "/notes?add=1" },
];

/** The admin's centre "+" sheet: the six things done most (F03). */
export function QuickActions({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tx } = useVx();
  return (
    <Sheet open={open} onClose={onClose} title="Quick actions" sub="The six things you do most">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, paddingBottom: 8 }}>
        {QUICK.map((a, i) => (
          <Link
            key={a.label}
            href={a.href}
            onClick={onClose}
            className="tap"
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 6px", borderRadius: 20, border: "1px solid var(--bd)", background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, textAlign: "center", animation: `xRise .42s var(--ease) ${60 + i * 40}ms both` }}
          >
            <span style={{ width: 50, height: 50, borderRadius: 17, background: a.bg, color: a.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ic n={a.icon} size={23} />
            </span>
            {tx({ en: a.label, hi: a.hi })}
          </Link>
        ))}
      </div>
    </Sheet>
  );
}
