import { getVppsOneEnvironment } from "@/platform/env";

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
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900 ${className}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
      टेस्ट डेटा · test data
    </span>
  );
}
