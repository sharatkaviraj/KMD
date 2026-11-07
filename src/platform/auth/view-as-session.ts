import "server-only";

import { cookies } from "next/headers";

import { VIEW_AS_LANGUAGE_COOKIE, VIEW_AS_PERSON_COOKIE } from "@/platform/auth/view-as-cookie";
import { createClient } from "@/platform/supabase/server";

export type ViewAsEndReason = "back" | "switched" | "signed_out";

/**
 * End this browser's "see One as a person" view (D-544): the cookie, and the
 * administrator's open grant in `vppsone.view_as_log`, which also records how
 * it ended. Only from a server action or a route handler, where cookies can
 * be changed. Closing the grant is best effort: the cookie alone is never
 * enough to see anybody, and an unclosed grant lapses after two hours.
 */
export async function endViewAsPerson(reason: ViewAsEndReason): Promise<void> {
  const jar = await cookies();
  if (jar.get(VIEW_AS_LANGUAGE_COOKIE)) jar.delete(VIEW_AS_LANGUAGE_COOKIE);
  if (!jar.get(VIEW_AS_PERSON_COOKIE)) return;
  jar.delete(VIEW_AS_PERSON_COOKIE);
  try {
    await (await createClient(jar)).rpc("view_as_end", { p_reason: reason });
  } catch {
    // Lapses on its own; see above.
  }
}
