import { createBrowserClient } from "@supabase/ssr";

import { FEE_SCHEMA, getRequiredEnvVar } from "@/platform/env";
import { viewAsBrowserFetch } from "@/platform/supabase/view-as-browser";

/**
 * The browser client, addressing the fee schema.
 *
 * `FEE_SCHEMA` rather than `getFeeSchema()`: this runs in the browser, where
 * `VPPSONE_ENV` and `APP_MODE` are not readable, so the agreement check cannot
 * run. Nothing here writes — the browser client is used for realtime
 * subscriptions, which is a read — so the worst a mismatch costs is a channel
 * on the wrong schema, not a payment in the wrong database.
 */
export function createFeeBrowserClient() {
  return createBrowserClient(
    getRequiredEnvVar("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnvVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    // Look-only while an administrator sees One as somebody (D-544): the
    // browser's direct uploads (voice notes, photos) are refused then.
    { db: { schema: FEE_SCHEMA }, global: { fetch: viewAsBrowserFetch } },
  );
}

export { createFeeBrowserClient as createClient };
