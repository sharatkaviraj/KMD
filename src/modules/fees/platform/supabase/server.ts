import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getFeeSchema, getRequiredEnvVar, getServerSupabaseUrl } from "@/platform/env";

import { createFeeWriteGuardedFetch } from "./write-guard";
import { createProjectionFetch } from "@/platform/fees-bridge/projection-fetch";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

const getCookieStore = cache(() => cookies());

/**
 * The cookie client, addressing the fee schema.
 *
 * Runs as the signed-in user, so fee RLS applies — which for most VPPS One
 * accounts means it reads nothing, because the policies key on a
 * `public.users` row those accounts do not have. Reads that must work for
 * every staff member go through `createFeeAdminClient()` after a permission
 * check, exactly as this app's existing fee reads already did.
 */
export async function createFeeClient(cookieStore?: CookieStore) {
  const resolvedCookieStore = cookieStore ?? (await getCookieStore());

  return createServerClient(
    getServerSupabaseUrl(),
    getRequiredEnvVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll() {
          return resolvedCookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              resolvedCookieStore.set(name, value, options),
            );
          } catch {
            // A Server Component cannot persist cookie updates. The proxy
            // refreshed the session already, so this is expected, not a fault.
          }
        },
      },
      db: { schema: getFeeSchema() },
      // The fee writes switch (D-345, D-346): the same one check as the admin
      // client, so a write as the signed-in user cannot go round it.
      global: { fetch: createFeeWriteGuardedFetch(createProjectionFetch()) },
    },
  );
}

/** The name the ported fee code imports. */
export { createFeeClient as createClient };
