import * as m from "@/messages/pairs";
import { getVppsOneEnvironment } from "@/platform/env";
import { primary, type Language } from "@/platform/i18n/language";
import { cn } from "@/platform/utils";

/**
 * Which database you are looking at.
 *
 * Until the cutover (PLAN §7) every deployment — including the one at
 * vppsone.vercel.app — runs on schoolfees-dev against test-session data. The
 * whole point of building that way is that a mistake is cheap, and that only
 * holds if nobody mistakes a test student for a real one. So the badge is
 * loud while it says `dev` and disappears when it says `live`: a permanent
 * "LIVE" label is decoration, and decoration stops being read.
 *
 * One word, in the reader's own language: the badge is 60px wide and a second
 * line would not fit, so `both` leads rather than stacking.
 */
export function EnvironmentBadge({
  language,
  className = "",
}: {
  language: Language;
  className?: string;
}) {
  if (getVppsOneEnvironment() === "live") {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-nav-accent/40 bg-nav-accent/15",
        "px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-nav-accent",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-nav-accent" />
      {primary(m.testData, language)}
    </span>
  );
}

/** The paper-surface variant, for screens drawn outside the ink top bar. */
export function EnvironmentBadgeOnPaper({
  language,
  className = "",
}: {
  language: Language;
  className?: string;
}) {
  if (getVppsOneEnvironment() === "live") {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft",
        "px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-warning-soft-foreground",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-warning" />
      {primary(m.testDataLong, language)}
    </span>
  );
}
