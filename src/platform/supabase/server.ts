import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getRequiredEnvVar, getServerSupabaseUrl, VPPSONE_SCHEMA } from "@/platform/env";
import { createProjectionFetch } from "@/platform/fees-bridge/projection-fetch";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

const getCookieStore = cache(() => cookies());

/**
 * Cookie-based client for Server Components, Route Handlers and Server
 * Actions. Ported from the fee app; the only change is the default schema.
 *
 * Reads through this client run as the signed-in user, so RLS applies. Fee
 * tables are reached with `.schema("public")` at the call site and are SELECT
 * only (rule 2).
 */
export async function createClient(cookieStore?: CookieStore) {
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
      db: { schema: VPPSONE_SCHEMA },
      global: { fetch: createProjectionFetch() },
    },
  );
}
