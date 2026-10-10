"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useTheme } from "next-themes";

import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { activeKey, type BadgeKey, type NavGroup } from "@/vx/nav";
import type { Pair } from "@/vx/text";
import { Avatar } from "@/vx/ui/primitives";

import { setViewAsAction } from "./view-as-actions";

export type Me = { initials: string; name: string; sub: string; href: string; color: string };

export type Badges = Partial<Record<BadgeKey, number>>;

const COLLAPSE_KEY = "vx.sidebar.collapsed";
const COLLAPSE_EVENT = "vx:sidebar";
let memo: boolean | null = null;

/** Stored choice, else collapsed to icons on narrow desktops (≤1150px). */
function readCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    if (memo !== null) return memo;
  }
  return window.matchMedia("(max-width: 1150px)").matches;
}

function subscribeCollapse(cb: () => void) {
  const mq = window.matchMedia("(max-width: 1150px)");
  window.addEventListener(COLLAPSE_EVENT, cb);
  window.addEventListener("storage", cb);
  mq.addEventListener("change", cb);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, cb);
    window.removeEventListener("storage", cb);
    mq.removeEventListener("change", cb);
  };
}

const noSubscribe = () => () => {};

/**
 * The desktop sidebar (`XSide.dc.html`): brand, grouped nav with Hindi group
 * labels, red badges, "See the app as" for the admin, and the footer with
 * theme, language, collapse and the signed-in person.
 */
export function VxSidebar({
  groups,
  me,
  roleLine,
  home,
  badges,
  teacherSized,
  previewMenus,
  previewing,
  sessionPill,
}: {
  groups: NavGroup[];
  me: Me;
  roleLine: string;
  home: string;
  badges: Promise<Badges>;
  teacherSized: boolean;
  previewMenus: { key: string; label: Pair; icon: "grad" | "rupee" | "trend" | "award" }[];
  previewing: string | null;
  /** The fee session switcher, for people who see money. */
  sessionPill?: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const { tx, sub, language } = useVx();
  const collapsed = useSyncExternalStore(subscribeCollapse, readCollapsed, () => false);
  const active = activeKey(groups, pathname);

  const toggle = () => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
    } catch {
      // Private mode: the choice lasts until the page reloads.
    }
    memo = !collapsed;
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  };

  const width = collapsed ? 76 : 248;

  return (
    <aside
      className="vxt vx-side"
      aria-label="Main navigation"
      style={{ width, display: "flex", flexDirection: "column", background: "var(--nav)", color: "var(--navfg)", padding: "14px 0 12px", fontSize: 14, lineHeight: 1.4, transition: "width .3s var(--ease)" }}
    >
      <Link href={home} style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, height: 48, padding: collapsed ? "0 20px" : "0 20px", marginBottom: 6, color: "var(--navfg)" }}>
        <span className="serif" style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: "#F7F6F3", color: "#082F49", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>VP</span>
        {collapsed ? null : (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>VPPS One</span>
            <span className="clip" style={{ fontSize: 12, color: "var(--navm)" }}>{roleLine}</span>
          </span>
        )}
      </Link>

      <nav className="scroll" style={{ flex: 1, minHeight: 0, padding: "2px 12px 8px", scrollbarWidth: "none" }}>
        {groups.map((g, gi) => (
          <div key={g.title?.en ?? `g${gi}`}>
            {g.title ? (
              collapsed ? (
                <div aria-hidden="true" style={{ height: 1, margin: "10px 8px", background: "var(--navb)" }} />
              ) : (
                <div style={{ height: 28, padding: "10px 12px 0", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--navm)" }}>
                  {tx(g.title)}
                  {sub(g.title) ? ` · ${sub(g.title)}` : language === "en" ? "" : ""}
                </div>
              )
            ) : null}
            {g.items.map((n) => {
              const on = n.key === active;
              const hi = teacherSized ? sub(n.label) : null;
              return (
                <Link
                  key={n.key}
                  href={n.href}
                  className={`tap sidei${on ? " on" : ""}`}
                  aria-current={on ? "page" : undefined}
                  title={collapsed ? tx(n.label) : undefined}
                  style={{ position: "relative", height: teacherSized ? 48 : 38, marginBottom: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 12px", borderRadius: 11, fontSize: teacherSized ? 15 : 14, justifyContent: collapsed ? "center" : undefined }}
                >
                  <Ic n={n.icon} size={19} />
                  {collapsed ? null : (
                    <span style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span className="clip">{tx(n.label)}</span>
                      {hi ? <span style={{ fontSize: 11, color: "var(--navm)", fontWeight: 500 }}>{hi}</span> : null}
                    </span>
                  )}
                  {n.badge ? (
                    <Suspense fallback={null}>
                      <NavBadge badges={badges} k={n.badge} dot={collapsed} />
                    </Suspense>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
        {previewMenus.length ? (
          <div>
            {collapsed ? (
              <div aria-hidden="true" style={{ height: 1, margin: "10px 8px", background: "var(--navb)" }} />
            ) : (
              <div style={{ height: 28, padding: "10px 12px 0", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--navm)" }}>
                See the app as
              </div>
            )}
            {previewMenus.map((m) => (
              <PreviewLink key={m.key} menu={m.key} label={tx(m.label)} icon={m.icon} collapsed={collapsed} on={previewing === m.key} />
            ))}
          </div>
        ) : null}
      </nav>

      <div style={{ flex: "none", padding: "10px 12px 0", borderTop: "1px solid var(--navb)", display: "flex", flexDirection: "column", gap: 8 }}>
        {sessionPill && !collapsed ? <div style={{ display: "flex" }}>{sessionPill}</div> : null}
        <div style={{ display: "flex", gap: 6, justifyContent: collapsed ? "center" : "flex-start", flexWrap: "wrap" }}>
          <ThemeButton />
          {collapsed ? null : <LangButton />}
          <button type="button" className="tap sidei" aria-label={collapsed ? "Expand menu" : "Collapse menu"} onClick={toggle} style={{ width: 40, height: 40, borderRadius: 12, border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: collapsed ? 0 : "auto" }}>
            <Ic n={collapsed ? "chevsRight" : "chevsLeft"} size={18} />
          </button>
        </div>
        <Link href={me.href} className="tap sidei" style={{ display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 6px", borderRadius: 12, justifyContent: collapsed ? "center" : undefined }}>
          <Avatar text={me.initials} bg={me.color} size={38} />
          {collapsed ? null : (
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span className="clip" style={{ fontSize: 14, fontWeight: 600, color: "var(--navfg)" }}>{me.name}</span>
              <span className="clip" style={{ fontSize: 12, color: "var(--navm)" }}>{me.sub}</span>
            </span>
          )}
        </Link>
      </div>
    </aside>
  );
}

function NavBadge({ badges, k, dot }: { badges: Promise<Badges>; k: BadgeKey; dot: boolean }) {
  const all = use(badges);
  const n = all[k] ?? 0;
  if (!n) return null;
  if (dot) {
    return <span aria-label={`${n} waiting`} style={{ position: "absolute", top: 6, right: 10, width: 9, height: 9, borderRadius: 5, background: "#E05252" }} />;
  }
  return (
    <span className="pill num" aria-label={`${n} waiting`} style={{ minWidth: 22, justifyContent: "center", background: "#E05252", color: "#FFFFFF", animation: "xPopIn .45s var(--spring) both" }}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function PreviewLink({ menu, label, icon, collapsed, on }: { menu: string; label: string; icon: "grad" | "rupee" | "trend" | "award"; collapsed: boolean; on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`tap sidei${on ? " on" : ""}`}
      title={collapsed ? label : undefined}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const href = await setViewAsAction(menu);
          router.push(href);
          router.refresh();
        })
      }
      style={{ width: "100%", height: 38, marginBottom: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 12px", borderRadius: 11, border: 0, background: on ? undefined : "transparent", fontSize: 14, justifyContent: collapsed ? "center" : undefined, textAlign: "left" }}
    >
      <Ic n={pending ? "refresh" : icon} size={19} className={pending ? "spin" : undefined} />
      {collapsed ? null : <span className="clip" style={{ flex: 1 }}>{label}</span>}
      {collapsed ? null : <Ic n="eye" size={15} style={{ opacity: 0.6 }} />}
    </button>
  );
}

export function ThemeButton({ tone = "nav" }: { tone?: "nav" | "page" }) {
  const { resolvedTheme, setTheme } = useTheme();
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  const dark = ready && resolvedTheme === "dark";
  return (
    <button
      type="button"
      className={`tap ${tone === "nav" ? "sidei" : "icon-btn"}`}
      aria-label={dark ? "Use light mode" : "Use dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      style={{ width: 40, height: 40, borderRadius: 12, border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "inherit" }}
    >
      <Ic n={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}

/** EN | हि — writes the reader's stored language (UI-6). */
export function LangButton({ tone = "nav" }: { tone?: "nav" | "page" }) {
  const { language } = useVx();
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (lang: "en" | "both" | "hi") =>
    start(async () => {
      const fd = new FormData();
      fd.set("language", lang);
      await saveLanguageAction({ status: "idle", message: null }, fd);
      router.refresh();
    });
  const isHi = language === "hi";
  return (
    <span role="group" aria-label="Language" style={{ display: "inline-flex", height: 40, borderRadius: 12, padding: 3, gap: 2, background: tone === "nav" ? "rgba(255,255,255,.07)" : "var(--s3)", opacity: pending ? 0.6 : 1 }}>
      <button type="button" aria-pressed={!isHi} onClick={() => set("both")} style={{ border: 0, borderRadius: 9, padding: "0 10px", fontSize: 13, fontWeight: 700, background: !isHi ? (tone === "nav" ? "var(--navs)" : "var(--card)") : "transparent", color: "inherit" }}>EN</button>
      <button type="button" aria-pressed={isHi} onClick={() => set("hi")} lang="hi" style={{ border: 0, borderRadius: 9, padding: "0 10px", fontSize: 13, fontWeight: 700, background: isHi ? (tone === "nav" ? "var(--navs)" : "var(--card)") : "transparent", color: "inherit" }}>हि</button>
    </span>
  );
}
