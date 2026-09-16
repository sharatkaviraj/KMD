import { createBrowserClient } from "@supabase/ssr";

import { getRequiredEnvVar, VPPSONE_SCHEMA } from "@/platform/env";

/** Browser client for Client Components and event handlers. */
export function createClient() {
  return createBrowserClient(
    getRequiredEnvVar("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnvVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      db: { schema: VPPSONE_SCHEMA },
    },
  );
}
