import "server-only";

import { createClient } from "@/modules/fees/platform/supabase/server";

/*
 * This app's own `vppsone` tables (acc_*, class_teachers, staff_profiles),
 * read from inside a ported tree. Ported files may not import this app's
 * Supabase clients — the port rewrite would silently point them at `public` —
 * so this takes the fee cookie client (the same signed-in session, the same
 * RLS) and names the schema explicitly, as defaulters/data/contacts.ts does.
 * Read-only by use: writes go through the server actions under src/app.
 */
type Reader = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export async function createVppsoneReader(): Promise<Reader> {
  const client = await createClient();
  return (client as unknown as { schema: (name: string) => Reader }).schema("vppsone");
}
