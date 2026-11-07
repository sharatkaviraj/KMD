import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  getOptionalEnvVar,
  getServerSupabaseUrl,
  VPPSONE_SCHEMA,
} from "@/platform/env";
import { createGuardedFetch } from "@/platform/supabase/guarded-fetch";
import { createProjectionFetch } from "@/platform/fees-bridge/projection-fetch";
import { createViewAsGuardedFetch } from "@/platform/supabase/view-as-guard";

/**
 * The service-role client. It bypasses RLS, so every call site must already
 * have checked the permission itself — `requirePermission()` at the top of the
 * action, then this.
 *
 * Two guards, because "don't ship this to the browser" is too important to
 * rest on a convention:
 *
 *  - `import "server-only"` fails the **build** if any Client Component pulls
 *    this module in, directly or through a chain of imports.
 *  - the `window` check below fails at **runtime**, which catches the cases
 *    the build cannot see: a test importing it into jsdom, or a bundler
 *    configuration that stops honouring the marker.
 *
 * The second is not redundant. It is the one that still holds when somebody
 * changes the build.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createAdminClient() was called in a browser context. The service-role key must never reach the client.",
    );
  }

  const serviceRoleKey = getOptionalEnvVar("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceRoleKey) {
    throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }

  return createSupabaseClient(
    getServerSupabaseUrl(),
    serviceRoleKey,
    {
      db: { schema: VPPSONE_SCHEMA },
      // Refuses an over-long PostgREST URL at once instead of stalling eight
      // seconds and failing opaquely. See guarded-fetch.ts. Outermost, no
      // save while an administrator sees One as somebody else (D-544,
      // view-as-guard.ts).
      global: { fetch: createViewAsGuardedFetch(createProjectionFetch(createGuardedFetch(), { privileged: true })) },
      auth: {
        // No session to persist and nothing to refresh: this client is one
        // request long and is never a user.
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
