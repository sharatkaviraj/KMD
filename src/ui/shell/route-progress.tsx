"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NAV_EVENT, type NavPendingDetail } from "@/ui/shell/nav-link";
import { useSessionSwitching } from "@/modules/fees/platform/session-context/switching-context";

/**
 * Thin top-of-page progress bar, shown while a navigation is actually in
 * flight.
 *
 * It used to key off `usePathname()` + `useSearchParams()`, which only change
 * AFTER the navigation commits, and then hide on a fixed 380ms timer. So a slow
 * route showed nothing during the wait — the whole point — and then flashed a
 * bar once the destination was already on screen. It was decoration, not
 * feedback.
 *
 * Now driven by `useLinkStatus` via NavLink. The pathname effect is retained
 * deliberately as the HIDE trigger and as the fallback for navigations that do
 * not go through a NavLink (`router.push`, form redirects, `router.refresh`),
 * so a regression degrades to the old behaviour rather than to nothing.
 *
 * Hidden under `prefers-reduced-motion` via the global block in globals.css.
 */

/** An instant navigation must not flash a bar. */
const SHOW_DELAY_MS = 120;
/** ...and a 140ms one must not strobe. */
const MIN_VISIBLE_MS = 300;
/** Backstop: a pending event that never resolves cannot pin the bar on. */
const MAX_VISIBLE_MS = 15_000;

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const { isSwitching } = useSessionSwitching();

  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const maxTimer = useRef<number | null>(null);
  const shownAt = useRef<number | null>(null);
  const navPending = useRef(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    function clearTimers() {
      for (const timer of [showTimer, hideTimer, maxTimer]) {
        if (timer.current !== null) {
          window.clearTimeout(timer.current);
          timer.current = null;
        }
      }
    }

    function hide() {
      clearTimers();
      shownAt.current = null;
      setVisible(false);
    }

    function scheduleHide() {
      if (showTimer.current !== null) {
        // Never became visible — cancel before it ever appears.
        window.clearTimeout(showTimer.current);
        showTimer.current = null;
        return;
      }

      if (shownAt.current === null) {
        hide();
        return;
      }

      const shownFor = Date.now() - shownAt.current;
      const owed = Math.max(0, MIN_VISIBLE_MS - shownFor);

      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(hide, owed);
    }

    function handleNav(event: Event) {
      const { pending } = (event as CustomEvent<NavPendingDetail>).detail;
      navPending.current = pending;

      if (!pending) {
        scheduleHide();
        return;
      }

      // A second navigation can begin while the first bar is settling. Its
      // completion timer must not hide feedback for the new request.
      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      if (showTimer.current !== null || shownAt.current !== null) {
        return;
      }

      showTimer.current = window.setTimeout(() => {
        showTimer.current = null;
        shownAt.current = Date.now();
        setVisible(true);
        maxTimer.current = window.setTimeout(hide, MAX_VISIBLE_MS);
      }, SHOW_DELAY_MS);
    }

    window.addEventListener(NAV_EVENT, handleNav);
    return () => {
      window.removeEventListener(NAV_EVENT, handleNav);
      clearTimers();
    };
  }, []);

  // A URL can commit while another link still has work in flight. Let those
  // links finish; the URL fallback only settles untracked navigations.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (navPending.current) return;

    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }

    if (shownAt.current === null) {
      return;
    }

    const owed = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt.current));
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      shownAt.current = null;
      setVisible(false);
    }, owed);
  }, [pathname, searchParams]);

  const showProgress = visible || isSwitching;

  return (
    <div
      aria-hidden={!showProgress}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] print:hidden"
    >
      <div
        className={[
          "h-full origin-left bg-accent transition-opacity duration-150",
          showProgress ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={{
          width: "100%",
          transform: "translate3d(0, 0, 0)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, hsl(var(--accent)) 35%, hsl(var(--accent)) 65%, transparent 100%)",
        }}
      >
        <div className={`h-full w-full bg-accent${showProgress ? " anim-route-progress" : ""}`} />
      </div>
    </div>
  );
}
