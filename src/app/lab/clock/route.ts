import { type NextRequest, NextResponse } from "next/server";

import { resolvePass } from "@/modules/smoke/data/smoke-repo";
import { parseQaClock, QA_CLOCK_COOKIE } from "@/platform/auth/qa-clock";
import { smokeLabEnabled } from "@/platform/auth/smoke-lab";
import { sanitizeRedirectPath } from "@/platform/env";
import { schoolToday } from "@/platform/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/lab/clock?pass=…&at=10:30[&next=/teach]` moves a Smoke Lab agent's pretend
 * school time as its day goes on (`at` may also be a full `2026-10-21T10:30`;
 * empty clears it). Changes only what Today shows — never what is saved.
 */
export async function GET(request: NextRequest) {
  if (!smokeLabEnabled()) return new NextResponse("Not found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const resolved = await resolvePass(params.get("pass"));
  if (!resolved.ok) return new NextResponse("Not found", { status: 404 });

  const at = (params.get("at") ?? "").trim();
  const value = /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? `${resolved.pass.run.schoolDay ?? schoolToday()}T${at}` : at;
  const response = NextResponse.redirect(new URL(sanitizeRedirectPath(params.get("next") ?? "/"), request.nextUrl.origin));
  if (value && parseQaClock(value)) {
    response.cookies.set(QA_CLOCK_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 12 * 60 * 60 });
  } else {
    response.cookies.delete(QA_CLOCK_COOKIE);
  }
  return response;
}
