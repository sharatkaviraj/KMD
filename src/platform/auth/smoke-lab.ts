import "server-only";

import { currentTargetContext, DEV_PROJECT_REFS, supabaseTargetOf } from "@/platform/supabase/target-guard";

/**
 * Is the Smoke Lab on for this deployment?
 *
 * Only while the app points at the test database (or a local stack) and is not
 * declared live. At the cutover (VPPSONE_ENV=live, the live fee project) this
 * is false: `/smoke` 404s, passes are refused and smoke accounts are signed
 * out, with no code change. It does not need `QA_LOGIN_KEY`: a pass is its own
 * 256-bit secret, issued by an admin, expiring within 24 hours.
 */
export function smokeLabEnabled(): boolean {
  if (currentTargetContext().environment === "live") return false;
  const target = supabaseTargetOf(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (target.kind === "local") return true;
  return target.kind === "project" && (DEV_PROJECT_REFS as readonly string[]).includes(target.ref);
}
