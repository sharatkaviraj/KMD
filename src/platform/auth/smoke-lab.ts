import "server-only";

import { ONE_MAIN_PROJECT_REF, supabaseTargetOf } from "@/platform/supabase/target-guard";

/**
 * Is the Smoke Lab on for this deployment?
 *
 * Only while the app points at One's main project (or a local stack). That
 * project is production from go-live (D-338), and the lab is CONFINED there,
 * not banned (D-346): while `vppsone.deployment` says production, `/lab/enter`
 * admits a seat only if its staff profile is a test account
 * (`toolAccountAccess`), and test accounts see only TEST sessions (Phase 3).
 * It does not need `QA_LOGIN_KEY`: a pass is its own 256-bit secret, issued
 * by an admin, expiring within 24 hours.
 */
export function smokeLabEnabled(): boolean {
  const target = supabaseTargetOf(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (target.kind === "local") return true;
  return target.kind === "project" && target.ref === ONE_MAIN_PROJECT_REF;
}
