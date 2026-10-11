import { NextResponse, type NextRequest } from "next/server";

import { parseQaClock, QA_CLOCK_COOKIE } from "@/platform/auth/qa-clock";
import { testSignInEnabled } from "@/platform/auth/test-accounts";

export const runtime = "nodejs";

/**
 * `/login/test/clock?key=…&at=2026-10-12T10:15` sets the QA accounts' pretend
 * school time; `at=` empty clears it (D-269). Behind the same key as the test
 * sign-in, and a 404 wherever that is off.
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (!testSignInEnabled(params.get("key"))) return new NextResponse("Not found", { status: 404 });
  const at = params.get("at") ?? "";
  const response = NextResponse.redirect(new URL("/", request.url));
  if (at && parseQaClock(at)) {
    response.cookies.set(QA_CLOCK_COOKIE, at, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 6 * 60 * 60 });
  } else {
    response.cookies.delete(QA_CLOCK_COOKIE);
  }
  return response;
}
