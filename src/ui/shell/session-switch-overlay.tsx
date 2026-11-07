"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useSessionSwitching } from "@/modules/fees/platform/session-context/switching-context";
import { cue } from "@/ui/feedback/cue";
import { cn } from "@/platform/utils";

/** How long "Now showing 2026-27" stays once the new year has arrived. */
export const SESSION_LANDED_MS = 1800;

type SessionSwitchOverlayProps = {
  isVisible: boolean;
  /** The year being opened, when the pill said which. */
  target?: string | null;
  /** The year that just opened: named for a moment, then the card goes. */
  landed?: string | null;
};

/**
 * Changing the year, made visible (owner's smoke, 7 Nov 2026: "when I was
 * switching the session pills, there was no animation"). While the new year
 * loads the screen dims and a card says "Opening 2026-27…" over a calendar
 * turning its page; when the year has arrived the card says "Now showing
 * 2026-27" with a tick, for under two seconds. The card never takes a tap,
 * and with reduced motion it simply appears and goes.
 */
export function SessionSwitchOverlay({ isVisible, target = null, landed = null }: SessionSwitchOverlayProps) {
  const t = useTranslations("MobileApp");

  return (
    <>
      <div
        aria-hidden={!isVisible}
        data-session-switching={isVisible ? "true" : undefined}
        className={cn(
          "pointer-events-none fixed inset-0 z-20 transition-opacity duration-200 motion-reduce:transition-none",
          // Must match the sidebar width in components/admin/dashboard-shell.tsx,
          // or a strip of content stays un-dimmed during the switch.
          "lg:left-[232px]",
          isVisible
            ? "opacity-100 motion-safe:anim-fade-in"
            : "opacity-0",
        )}
      >
        <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px]" />
      </div>
      {isVisible ? (
        <div className="vx-switch-card" role="status" aria-live="polite" data-session-switch-card="opening">
          <span className="vx-switch-cal" aria-hidden="true"><i /><i /></span>
          <span className="vx-switch-text">
            <b>{target ? t("sessionOpening", { label: target }) : t("sessionOpeningAny")}</b>
            <small>{t("sessionOpeningHint")}</small>
          </span>
        </div>
      ) : landed ? (
        <div className="vx-switch-card" role="status" aria-live="polite" data-session-switch-card="landed" data-landed="">
          <span className="vx-switch-done" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 12.5l4 4 8-9" /></svg>
          </span>
          <span className="vx-switch-text"><b>{t("sessionNowShowing", { label: landed })}</b></span>
        </div>
      ) : null}
    </>
  );
}

export function SessionSwitchOverlayMount() {
  const { isSwitching, target = null, setTarget } = useSessionSwitching();
  const [landed, setLanded] = useState<string | null>(null);
  const was = useRef({ isSwitching, target });

  useEffect(() => {
    const before = was.current;
    was.current = { isSwitching, target };
    // Landed: the switch ended and the pill still names the year it opened.
    // A pill clears the name when the switch fails, so a failure never says
    // "Now showing".
    if (!before.isSwitching || isSwitching || !target) return;
    setLanded(target);
    setTarget?.(null);
    cue("success");
  }, [isSwitching, target, setTarget]);

  useEffect(() => {
    if (!landed) return;
    const timer = window.setTimeout(() => setLanded(null), SESSION_LANDED_MS);
    return () => window.clearTimeout(timer);
  }, [landed]);

  return <SessionSwitchOverlay isVisible={isSwitching} target={target} landed={isSwitching ? null : landed} />;
}
