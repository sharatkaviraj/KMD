import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getFeeSchema, getOptionalEnvVar, getRequiredEnvVar } from "@/platform/env";

/**
 * The service-role client for fee data. **This is where the money is written.**
 *
 * It bypasses RLS, which is the whole reason it exists here: fee policies key
 * on `public.users.role`, and 24 of this app's 28 staff profiles have no
 * `public.users` row, so RLS would refuse nearly every write. The alternative
 * — creating those rows — means writing to `public` and keeping a person's
 * role in two places that can disagree. Janmejay chose this one.
 *
 * So the permission check at the call site is not belt-and-braces. It is the
 * only thing standing between a request and the school's money, and
 * `tests/architecture.test.ts` asserts that every file importing this also
 * checks one.
 *
 * Both guards from the `vppsone` admin client are kept. The `window` check is
 * not redundant with `server-only`: it is the one that still holds when
 * somebody changes the build.
 */
export function createFeeAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createFeeAdminClient() was called in a browser context. The service-role key must never reach the client.",
    );
  }

  const serviceRoleKey = getOptionalEnvVar("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceRoleKey) {
    throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }

  return createSupabaseClient(
    getRequiredEnvVar("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey,
    {
      db: { schema: getFeeSchema() },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

export { createFeeAdminClient as createAdminClient };
