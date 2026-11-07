"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useSessionSwitching } from "@/modules/fees/platform/session-context/switching-context";
import { NAV_EVENT, type NavPendingDetail } from "@/ui/shell/nav-link";
import { useVx } from "@/vx/i18n";

/** A page that arrives within this never shows the note, so quick taps stay quiet. */
export const OPENING_AFTER_MS = 450;
/** Backstop: a navigation that never reports back cannot pin the note on. */
const OPENING_MAX_MS = 15_000;

const WORDS = { en: "Opening…", hi: "खुल रहा है…" };

/**
 * "Opening…", with a small spinner, while a tapped page is slow to arrive
 * (owner's smoke, 7 Nov 2026: "lag", a tap that seemed to do nothing for up to
 * three seconds on a phone). The two-pixel bar at the top is easy to miss;
 * this sits where the eye already is, above the bottom tabs on a phone. It
 * listens to the same signal as the bar, so it shows for every screen link,
 * the tabs and the side menu. It belongs to the address it was shown on, so
 * it is gone the moment the new page has arrived, and a year switch has its
 * own card, so the note stays out of that one's way.
 */
export function OpeningNote() {
  const { tx } = useVx();
  const { isSwitching } = useSessionSwitching();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const here = `${pathname}?${searchParams?.toString() ?? ""}`;
  const where = useRef(here);
  const [slowAt, setSlowAt] = useState<string | null>(null);

  useEffect(() => {
    where.current = here;
  }, [here]);

  useEffect(() => {
    let show: number | null = null;
    let max: number | null = null;
    const clear = () => {
      if (show !== null) window.clearTimeout(show);
      if (max !== null) window.clearTimeout(max);
      show = max = null;
    };
    const onNav = (event: Event) => {
      const { pending } = (event as CustomEvent<NavPendingDetail>).detail;
      if (!pending) {
        clear();
        setSlowAt(null);
        return;
      }
      if (show === null) show = window.setTimeout(() => { show = null; setSlowAt(where.current); }, OPENING_AFTER_MS);
      if (max === null) max = window.setTimeout(() => { clear(); setSlowAt(null); }, OPENING_MAX_MS);
    };
    window.addEventListener(NAV_EVENT, onNav);
    return () => {
      window.removeEventListener(NAV_EVENT, onNav);
      clear();
    };
  }, []);

  if (slowAt !== here || isSwitching) return null;
  return (
    <div className="vx-opening" role="status" aria-live="polite">
      <span className="vx-opening-spin" aria-hidden="true" />
      {tx(WORDS)}
    </div>
  );
}
