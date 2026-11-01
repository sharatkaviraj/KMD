import { unstable_cache } from "next/cache";
import { getOptionalEnvVar } from "@/platform/env";
import { createAdminClient } from "./admin";
import { createClient } from "./server";
import { feesBridgeEnabled } from "@/platform/fees-bridge/policy";

export function cacheSafeUnstableCache<Args extends unknown[], Return>(
  fn: (...args: Args) => Promise<Return>,
  keyParts: string[],
  options?: { tags?: string[]; revalidate?: number }
): (...args: Args) => Promise<Return> {
  const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;
  if (isTest || feesBridgeEnabled()) {
    return fn;
  }
  return unstable_cache(fn, keyParts, options);
}

export async function getCacheSafeClient() {
  const serviceRoleKey = getOptionalEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey) {
    return createAdminClient();
  }
  return createClient();
}
