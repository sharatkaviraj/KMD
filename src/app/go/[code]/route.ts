import { NextResponse, type NextRequest } from "next/server";

import { openGoLink } from "@/modules/chats/data/go-links";
import { isGoCode } from "@/modules/chats/domain/go-links";
import { VIEW_SESSION_COOKIE_NAME } from "@/modules/fees/platform/session-context/cookie";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { currentSessionViewer } from "@/platform/auth/test-session-access";
import { canAccessSession, canSwitchSessions } from "@/platform/auth/test-session-policy";
import { parseAcademicSessionLabel } from "@/platform/config/fee-rules";

/**
 * A one-tap link from a WhatsApp message (D-616): `/go/<code>` opens the
 * place in One the code names, in the year it names, after the normal
 * sign-in. The proxy sends a signed-out tap to /login with this path as
 * `next`, so the link still lands after signing in.
 *
 * A link is a shortcut, never a key: the page it opens checks the person's
 * own permissions as always, so a forwarded link takes someone only where
 * they could go anyway. The year is switched only for somebody who may
 * switch to it (an admin opening a practice chat lands in the test session);
 * a teacher stays in the school's year. An unknown or expired code opens the
 * person's Chats when they have them, and their home otherwise.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

function go(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const staff = await getCurrentStaff().catch(() => null);
  if (!staff) return go(request, `/login?next=${encodeURIComponent(`/go/${isGoCode(code) ? code : ""}`)}`);

  const link = isGoCode(code) ? await openGoLink(code).catch(() => null) : null;
  if (!link) {
    const hasChats = can(staff, "chats:reply") || can(staff, "chats:all");
    return go(request, hasChats ? "/chats?link=old" : "/");
  }

  const response = go(request, link.path);
  const label = sessionLabelOf(link.sessionLabel);
  if (label) {
    const viewer = await currentSessionViewer().catch(() => null);
    if (viewer && canSwitchSessions(viewer) && canAccessSession(viewer, label)) {
      response.cookies.set(VIEW_SESSION_COOKIE_NAME, label, { httpOnly: false, maxAge: THIRTY_DAYS_SECONDS, path: "/", sameSite: "lax" });
    }
  }
  return response;
}

/** The year a link names, as the session pill writes it; null when it names none, or none that parses. */
function sessionLabelOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return parseAcademicSessionLabel(value).normalizedLabel;
  } catch {
    return null;
  }
}
