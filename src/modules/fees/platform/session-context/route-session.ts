import "server-only";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { assertSessionVisible, refusalResponse } from "@/platform/auth/test-session-access";

/**
 * The session an export or data route works in (Phase 3, plan §3.4 point 4).
 *
 * Export routes take `?session=` straight from the URL, and with none they
 * used to fall through to the active session — real 2026-27 for a test
 * account. Here a named session must be one the viewer may open (404
 * otherwise: a route is not a place to silently swap the year a download
 * covers), and no session means the viewer's own: the pill's cookie, else
 * their default (TEST-2026-27 for a test account).
 */
export async function visibleSessionForRoute(
  requested: string | null | undefined,
): Promise<{ ok: true; sessionLabel: string } | { ok: false; response: Response }> {
  const wanted = requested?.trim() || null;
  if (wanted) {
    const refused = await refusalResponse(() => assertSessionVisible(null, wanted));
    if (refused) return { ok: false, response: refused };
  }
  const resolved = await resolveViewSession({
    searchParamSession: wanted,
    cookieSession: await getViewSessionCookie(),
  });
  return { ok: true, sessionLabel: resolved.sessionLabel };
}
