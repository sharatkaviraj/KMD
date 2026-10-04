import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import {
  getRequiredEnvVar,
  getServerSupabaseUrl,
  hasRequiredEnvVars,
} from "@/platform/env";

/**
 * Paths a signed-out visitor may reach. Everything else needs a session.
 *
 * A short allow-list rather than a long protected-list: the fee app guards
 * `/protected/**`, so an unguarded route there is a route somebody forgot to
 * nest. Here the default is "signed in", and forgetting is a 302 to the login
 * page, not an open door.
 *
 * `/auth/confirm` is where a link Supabase minted lands. It has to be reachable
 * without a session for the obvious reason — it is the thing that creates one —
 * and it is not an opening: it does nothing at all without a one-time
 * `token_hash` that only the service role can mint.
 */
const PUBLIC_PATHS = new Set(["/login", "/auth/confirm"]);

/**
 * The token links, which are open by design.
 *
 * `/r/` is a request, `/t/` is one teacher's list of her own, and `/w/` is
 * where a WhatsApp button lands. A teacher opens these from a message on her
 * phone and never signs in — that is the whole point of the Sampark merge, and
 * a redirect to a login page she has no account for would end the round.
 *
 * Open is not unguarded. The token is ~96 bits, every rejection is the same
 * 404, a guess is rate limited in Postgres, and the page can reach exactly one
 * request's roll and nothing else — see `requests-repo.ts`, which is the only
 * place that resolves one.
 */
function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;

  // `/api/jobs/*` is the scheduler's door. It has no session by definition —
  // it is a cron request — and it carries its own secret, checked by the route
  // itself, which refuses everything when neither secret is configured. A 302
  // to a login page here would make every scheduled job a silent success.
  return ["/r", "/t", "/w", "/api/jobs"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Keep the Supabase auth cookies fresh and decide, before anything renders,
 * whether this request has a session.
 *
 * Ported from `schoolfees/src/platform/supabase/middleware.ts`. Two things
 * were dropped: the role-based landing redirect (VPPS One has one dashboard,
 * so there is nothing to choose between) and the `staff_role` JWT claim it
 * read to do it — this app's role lives in `vppsone.staff_profiles` and is
 * read by the page, not guessed from a claim (D-6).
 *
 * What this cannot do is check a *permission*. It has a user id, not a staff
 * profile, and reaching the database from here would put a query in front of
 * every request including the ones for a file. Permissions are checked by
 * `requirePermission()` in the page or the action — which is also the only
 * place that still holds when a Server Action is called on a path the matcher
 * happens to exclude.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // A deploy without Supabase configured should show its own error, not a
  // redirect loop through a login page that cannot work either.
  if (!hasRequiredEnvVars) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    getServerSupabaseUrl(),
    getRequiredEnvVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: claimsData } = await supabase.auth.getClaims();
  const hasUser = Boolean(claimsData?.claims?.sub);
  const pathname = request.nextUrl.pathname;

  if (!hasUser && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  // Sending a signed-in visitor *away* from the login page is deliberately
  // NOT done here, and this is the interesting half of the file.
  //
  // `hasUser` is the JWT and nothing else. Whether somebody is staff is a
  // `vppsone.staff_profiles` row, which this cannot read. The two disagree in
  // exactly one situation — a valid session whose profile is missing or
  // inactive — and there a proxy-level bounce is an infinite loop:
  //
  //     /dashboard  -> requireStaff() finds no usable profile
  //                 -> /login?reason=inactive
  //                 -> proxy sees a valid JWT
  //                 -> /dashboard
  //
  // That is not hypothetical. Deactivating a signed-in staff member (task 1.3)
  // produces it immediately: the browser gives up with a blank error page and
  // every hop runs the page, so it hammers the database while it does.
  //
  // `src/app/login/page.tsx` already redirects a signed-in *staff member* to
  // the dashboard, using the profile rather than a guess. Leaving that as the
  // only such rule costs one render in a case that is rare — somebody opening
  // /login while already signed in — and makes the loop impossible rather than
  // merely handled.
  return supabaseResponse;
}
