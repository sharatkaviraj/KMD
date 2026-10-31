/**
 * Live Razorpay keys move real money, so only a live deployment may hold them
 * (go-live Phase E, plan §7.6).
 *
 * One has one database and it is production; Preview deployments and a local
 * `next dev` point at it too. A `rzp_live_…` key copied into one of those, or
 * into a production deployment that does not yet declare `VPPSONE_ENV=live`,
 * would open real orders against real parents from a place nobody is watching.
 * So a live key counts only where the deployment says `VPPSONE_ENV=live` AND is
 * Vercel production (not confined). Anywhere else the key is treated as absent:
 * no new link, order or checkout, and the webhook records events without
 * acting on them. Test keys (`rzp_test_…`) are allowed everywhere.
 *
 * Pure: it reads the environment it is handed.
 */

import { isConfinedDeployment } from "@/platform/deployment/confinement";

import type { RazorpayMode } from "./capture-check";

export type KeyRefusal = "live_key_outside_live";

export function razorpayKeyRefusal(
  mode: RazorpayMode,
  env: { readonly [name: string]: string | undefined },
): KeyRefusal | null {
  if (mode !== "live") return null;
  const live = env.VPPSONE_ENV?.trim().toLowerCase() === "live";
  return live && !isConfinedDeployment(env) ? null : "live_key_outside_live";
}
