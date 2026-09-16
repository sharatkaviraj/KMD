import { getVppsOneEnvironment } from "@/platform/env";
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
 */
export function EnvironmentBadge({ className = "" }: { className?: string }) {
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
      टेस्ट · test
    </span>
  );
}

/** The paper-surface variant, for screens drawn outside the ink top bar. */
export function EnvironmentBadgeOnPaper({ className = "" }: { className?: string }) {
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
      टेस्ट डेटा · test data
    </span>
  );
}
