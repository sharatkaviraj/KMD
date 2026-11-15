"use client";

import Image from "next/image";
import { schoolBrand } from "@/platform/config/school-brand";
import Link from "next/link";
import ScreenLink from "@/ui/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useLayoutEffect, useRef, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useTheme } from "next-themes";

import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { activeKey, type BadgeKey, type NavGroup } from "@/vx/nav";
import { Avatar } from "@/vx/ui/primitives";

import { useLiveChatCount } from "./chat-live";
import { openQuick } from "./quick-state";

import "./shell.css";

const QUICK = { en: "Quick actions", hi: "झटपट काम" };

export type Me = { photo?: string | null; initials: string; name: string; sub: string; href: string; color: string };

export type Badges = Partial<Record<BadgeKey, number>>;

const COLLAPSE_KEY = "vx.sidebar.collapsed";
const COLLAPSE_EVENT = "vx:sidebar";
/** The design collapses the sidebar to icons at and below this window width (D09-Laptop, 1180px). */
const NARROW = "(max-width: 1200px)";
let memo: boolean | null = null;

/** Stored choice, else collapsed to icons on narrow desktops (≤1200px). */
function readCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    if (memo !== null) return memo;
  }
  return window.matchMedia(NARROW).matches;
}

function subscribeCollapse(cb: () => void) {
  const mq = window.matchMedia(NARROW);
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

/** Whether the desktop sidebar is drawn as icons only (the window's width, or the person's choice). */
export function useSideCollapsed(): boolean {
  return useSyncExternalStore(subscribeCollapse, readCollapsed, () => false);
}

/**
 * The desktop sidebar, as the design's shared `XSide.dc.html` draws it for
 * every role: brand, grouped nav (Hindi beside a group's name when the reader
 * reads both), red badges, "See the app as" for the admin (`preview`, which
 * the shell loads only for an administrator: `./preview-links.tsx`), and the
 * signed-in person at the foot. Nothing else sits in the footer: theme and
 * language are on Settings, the teacher's More and the Menu page, where the
 * design puts them.
 *
 * Collapsing to icons follows the window (≤1200px, D09-Laptop). The manual
 * collapse is a small edge button that shows on hover or keyboard focus, so it
 * stays reachable without drawing anything the frames do not have.
 */
export function VxSidebar({
  groups,
  me,
  roleLine,
  sessionHref,
  home,
  badges,
  teacherSized,
  preview,
  previewing,
  quick = false,
}: {
  groups: NavGroup[];
  me: Me;
  /** "Admin · 2026–27". */
  roleLine: string;
  /** Where the role line leads: the session picker, for readers who switch the fee session. */
  sessionHref?: string;
  home: string;
  badges: Promise<Badges>;
  teacherSized: boolean;
  /** "See the app as", the admin's only (`PreviewLinks`). */
  preview?: ReactNode;
  previewing: string | null;
  /** This person has a "+" (D-643): Quick actions opens the same sheet at the top of the menu. */
  quick?: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const { tx, sub } = useVx();
  const collapsed = useSideCollapsed();
  const search = useSearchParams();
  const active = activeKey(groups, pathname, search);
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);

  // The highlight slides from the last page's item to this one. Until it has
  // been placed once, the active item draws its own highlight (`.sidei.on`).
  useLayoutEffect(() => {
    const host = nav.current;
    const mark = pill.current;
    if (!host || !mark) return;
    const on = host.querySelector<HTMLElement>(".sidei.on");
    if (!on) {
      mark.style.opacity = "0";
      return;
    }
    const first = !host.dataset.pill;
    if (first) mark.style.transition = "none";
    mark.style.transform = `translateY(${on.offsetTop}px)`;
    mark.style.height = `${on.offsetHeight}px`;
    mark.style.opacity = "1";
    host.dataset.pill = "1";
    if (first) {
      void mark.offsetHeight;
      mark.style.transition = "";
    }
    // The open page's item stays in view: Settings, Staff or Timetable sat below a laptop's fold
    // with nothing showing where the reader was (desk check, 7 Nov). Only the menu scrolls, never
    // the page, and only when the item is out of sight (40px kept clear for the "More" hint).
    const top = on.offsetTop;
    const bottom = top + on.offsetHeight;
    if (top < host.scrollTop || bottom > host.scrollTop + host.clientHeight - 40) {
      // "auto" follows the menu's CSS: smooth, or instant under reduced motion (shell.css).
      host.scrollTo({ top: Math.max(0, top - (host.clientHeight - on.offsetHeight) / 2), behavior: first ? "instant" : "auto" });
    }
  }, [active, collapsed, previewing, groups, teacherSized]);

  const moreLabel = tx({ en: "More below", hi: "नीचे और भी" });

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
  const itemH = teacherSized ? 48 : 38;


  return (
    <aside
      className={`vxt vx-side${collapsed ? " mini" : ""}`}
      aria-label="Main navigation"
      style={{ width, display: "flex", flexDirection: "column", background: "var(--nav)", color: "var(--navfg)", padding: "14px 0 12px", fontSize: 14, lineHeight: 1.4, transition: "width .34s var(--ease)" }}
    >
      <div style={{ position: "relative", flex: "none", display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 20px", marginBottom: 6 }}>
        <Link href={home} tabIndex={collapsed ? undefined : -1} aria-label={collapsed ? "VPPS One" : undefined} aria-hidden={collapsed ? undefined : true} className="serif" style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: "#F7F6F3", color: "#082F49", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
          <Image src={schoolBrand.logo} alt="" width={32} height={32} style={{objectFit:"contain"}} />
        </Link>
        {collapsed ? null : (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <Link href={home} style={{ fontWeight: 700, fontSize: 15, color: "var(--navfg)" }}>VPPS One</Link>
            {/* For fee readers the role line opens the session picker; it reads exactly as the design's line. */}
            {sessionHref ? (
              <Link href={sessionHref} className="clip" title="Change session" style={{ fontSize: 12, color: "var(--navm)" }}>{roleLine}</Link>
            ) : (
              <span className="clip" style={{ fontSize: 12, color: "var(--navm)" }}>{roleLine}</span>
            )}
          </span>
        )}
        <button type="button" className="tap vx-collapse" aria-label={collapsed ? "Expand menu" : "Collapse menu"} aria-expanded={!collapsed} onClick={toggle}>
          <Ic n={collapsed ? "chevsRight" : "chevsLeft"} size={14} />
        </button>
      </div>

      {quick ? (
        <div style={{ flex: "none", padding: collapsed ? "0 15px 8px" : "0 14px 8px" }}>
          <button type="button" className="tap vx-side-quick" aria-haspopup="dialog" aria-label={collapsed ? tx(QUICK) : undefined} title={collapsed ? tx(QUICK) : undefined} onClick={() => { cue("tap"); openQuick(); }}>
            <span className="vx-side-quick-ic" aria-hidden="true"><Ic n="plus" size={18} stroke={2.4} /></span>
            {collapsed ? null : <span className="clip">{tx(QUICK)}</span>}
          </button>
        </div>
      ) : null}

      {/* Whether the list runs on past either edge is drawn by CSS from the menu's own scroll (shell.css). */}
      <div className="vx-side-navwrap">
      <nav ref={nav} className="scroll" style={{ position: "relative", flex: 1, minHeight: 0, padding: "2px 12px 8px", scrollbarWidth: "none" }}>
        <span ref={pill} aria-hidden="true" className="vx-side-pill" style={{ height: itemH }} />
        {groups.map((g, gi) => (
          <div key={g.title?.en ?? `g${gi}`}>
            {g.title ? (
              collapsed ? (
                // The icon-only sidebar keeps a group's room and drops its name (D09-Laptop).
                <div aria-hidden="true" style={{ height: 28 }} />
              ) : (
                <div style={{ height: 28, padding: "10px 12px 0", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--navm)" }}>
                  {tx(g.title)}
                  {sub(g.title) ? ` · ${sub(g.title)}` : ""}
                </div>
              )
            ) : null}
            {g.items.map((n) => {
              const on = n.key === active && !previewing;
              const hi = teacherSized ? sub(n.label) : null;
              return (
                // A desk's menu waits for intent like every screen link (D-439): it fetches a page when the
                // pointer rests on its item or the keyboard reaches it, not all thirty-odd on every load.
                <ScreenLink
                  key={n.key}
                  href={n.href}
                  className={`tap sidei${on ? " on" : ""}`}
                  aria-current={on ? "page" : undefined}
                  title={collapsed ? tx(n.label) : undefined}
                  style={{ position: "relative", minHeight: itemH, marginBottom: 2, display: "flex", alignItems: "center", gap: 12, padding: collapsed ? "0 12px" : "4px 12px", borderRadius: 11, fontSize: teacherSized ? 15 : 14, justifyContent: collapsed ? "center" : undefined }}
                >
                  <Ic n={n.icon} size={19} />
                  {collapsed ? null : (
                    <span style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                      {/* A long name ("Cover for absent teachers") takes a second line rather than losing its end. */}
                      <span className="vx-side-label">{tx(n.label)}</span>
                      {hi ? <span style={{ fontSize: 11, color: "var(--navm)", fontWeight: 500 }}>{hi}</span> : null}
                    </span>
                  )}
                  {n.badge ? (
                    <Suspense fallback={null}>
                      <NavBadge badges={badges} k={n.badge} dot={collapsed} />
                    </Suspense>
                  ) : null}
                </ScreenLink>
              );
            })}
          </div>
        ))}
        {preview}
      </nav>
        {/* For the mouse: the keyboard brings each item into view by itself. */}
        <button type="button" className="tap vx-side-more" tabIndex={-1} aria-hidden="true" title={moreLabel} onClick={() => nav.current?.scrollBy({ top: nav.current.clientHeight * 0.7 })}>
          {collapsed ? null : <span>{moreLabel}</span>}
          <Ic n="chevDown" size={14} />
        </button>
      </div>

      <div style={{ flex: "none", padding: "10px 12px 0", borderTop: "1px solid var(--navb)" }}>
        <Link href={me.href} className="tap sidei" title={collapsed ? me.name : undefined} style={{ display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 6px", borderRadius: 12, justifyContent: collapsed ? "center" : undefined }}>
          <Avatar photo={me.photo} text={me.initials} bg={me.color} size={38} />
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
  // Parents waiting (D-618) is kept fresh while the shell stays put.
  const live = useLiveChatCount();
  const n = k === "chats" && live !== null ? live : (all[k] ?? 0);
  if (!n) return null;
  if (dot) {
    return (
      <span className="pill num" aria-label={`${n} waiting`} style={{ position: "absolute", top: 1, left: 30, minWidth: 22, justifyContent: "center", background: "#E05252", color: "#FFFFFF", animation: "xPopIn .45s var(--spring) both" }}>
        {n > 99 ? "99+" : n}
      </span>
    );
  }
  return (
    <span className="pill num" aria-label={`${n} waiting`} style={{ minWidth: 22, justifyContent: "center", background: "#E05252", color: "#FFFFFF", animation: "xPopIn .45s var(--spring) both" }}>
      {n > 99 ? "99+" : n}
    </span>
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
      {/* EN means English: it used to save "both", which reads Hindi-first, so a reader who tapped हि could not get English back here (day-run 6 Nov 2026, E45). "Both" stays in Preferences. */}
      <button type="button" aria-pressed={language === "en"} onClick={() => set("en")} style={{ border: 0, borderRadius: 9, padding: "0 10px", fontSize: 13, fontWeight: 700, background: language === "en" ? (tone === "nav" ? "var(--navs)" : "var(--card)") : "transparent", color: "inherit" }}>EN</button>
      <button type="button" aria-pressed={isHi} onClick={() => set("hi")} lang="hi" style={{ border: 0, borderRadius: 9, padding: "0 10px", fontSize: 13, fontWeight: 700, background: isHi ? (tone === "nav" ? "var(--navs)" : "var(--card)") : "transparent", color: "inherit" }}>हि</button>
    </span>
  );
}
