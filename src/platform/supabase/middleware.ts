import { DAYRUN, accountForAlias } from "@/platform/auth/dayrun-policy";
import { isSmokeAccount } from "@/modules/smoke/domain/pool";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { feesBridgeEnabled, feesDestination, nativeReadOnlyFeesPath, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { cleanFromPath } from "@/platform/fees-bridge/not-in-one";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { HOME_HINT_COOKIE, followsHomeHint, readHomeHint } from "@/platform/auth/home-hint";
import { VIEW_AS_PERSON_COOKIE } from "@/platform/auth/view-as-cookie";
import { refusedWhileViewingAs, VIEW_AS_READ_ONLY, VIEW_AS_REFUSAL_CODE } from "@/platform/auth/view-as-requests";
import { flat } from "@/platform/i18n/language";

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
// `/login/test` is the keyed QA sign-in (UI-63): it 404s without the secret
// key and on the live database, and can only sign in as a QA-domain account.
// `/lab/*` and `/api/lab/*` are the Smoke Lab's pass-carrying doors: each
// checks its own 256-bit pass and 404s off the test database.
const PUBLIC_PATHS = new Set(["/login", "/login/test", "/auth/confirm", "/login/dayrun", "/login/dayrun/request", "/login/dayrun/redeem", "/login/dayrun/end", "/lab/enter", "/lab/clock", "/lab/ended"]);

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
  //
  // `/rv/*` is the fee receipt check a parent reaches from a receipt notice
  // (the fees app's `/r/{receiptNumber}`, moved because `/r/` is a request
  // token here). It shows a receipt number, date, amount and reversal state,
  // nothing about the child — see `src/app/rv/[code]/page.tsx`.
  //
  // `/cv/*` is the QR on a school certificate: status, number, kind, date and
  // a masked name for one random code — see `src/app/cv/[code]/page.tsx`.
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The prefixes a signed-out request may reach. Each route under them carries
 * its own credential and checks it itself (go-live Phase E, plan §7.2,
 * critique0 #1, critique1 A1):
 *
 *  - `/pay/*`             a parent's Pay now page and its status poll — the
 *                         random pay code is the only input;
 *  - `/api/webhooks/*`    Razorpay's webhook — its HMAC signature, and a 404
 *    `/api/fees/webhooks/*` until `RAZORPAY_WEBHOOK_SECRET` is set — and the
 *                         school WhatsApp's, by `x-hub-signature-256` (D-562);
 *  - `/api/fees/cron/*`   pg_cron and Vercel cron — `CRON_SECRET` or the
 *                         route's own secret, refused without one.
 *
 *  - `/api/mcp/*`        the AI connection (plan 2026-11-03-mcp-feasibility
 *                         §5.3): the MCP endpoint checks a One-issued bearer
 *                         token and answers its own 401 with a
 *                         `WWW-Authenticate` challenge, which Claude needs to
 *                         start sign-in; the OAuth token, registration and
 *                         revocation endpoints take their credential in the
 *                         body. The consent page `/mcp/authorize` is NOT here:
 *                         it stays behind the normal sign-in;
 *  - `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`
 *                         public metadata documents (RFC 9728, RFC 8414).
 *
 * Without these a Razorpay delivery is a 307 to /login, which Razorpay counts
 * as a failure and eventually disables the webhook; a cron "succeeds" while
 * doing nothing; a parent tapping Pay now lands on the staff sign-in page.
 * `tests/public-routes.test.ts` lists every route that authenticates by a
 * secret, signature or token and holds it to being under one of these.
 */
export const PUBLIC_PREFIXES = [
  "/r",
  "/rv",
  "/cv",
  "/t",
  "/w",
  "/pay",
  "/api/jobs",
  "/api/lab",
  "/api/webhooks",
  "/api/fees/webhooks",
  "/api/fees/cron",
  "/api/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
] as const;

export { isPublicPath };

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

  // Private QA leases are an application-layer boundary only. The existing
  // database policies and unrelated QA sessions retain their original rules.
  const userId = claimsData?.claims?.sub;
  if (hasUser && !isPublicPath(pathname) && DAYRUN.aliases.some(alias => accountForAlias(alias)?.userId === userId)) {
    const { data: allowed, error } = await supabase.schema("vppsone").rpc("qa_dayrun_access_allowed");
    if (error || allowed !== true) {
      const url = request.nextUrl.clone();
      url.pathname = "/login/dayrun";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // A Smoke Lab account is honoured only while one of its passes and its run
  // are live (`vppsone.smoke_access_allowed`): revoking a run, or its expiry,
  // ends every agent's session on its next request. Only smoke accounts are
  // asked (the `smoke_lab` flag or a `smoke.*@qa.vpps.local` email); anybody
  // else is untouched. A "no" signs out every session the account holds; an
  // error refuses this request without signing out, and the next one asks
  // again. The database also bans the account and deletes its sessions.
  if (hasUser && isSmokeAccount(claimsData?.claims) && !isPublicPath(pathname)) {
    const { data: allowed, error } = await supabase.schema("vppsone").rpc("smoke_access_allowed");
    if (error || allowed !== true) {
      if (!error) await supabase.auth.signOut({ scope: "global" }).catch(() => undefined);
      const url = request.nextUrl.clone();
      url.pathname = "/lab/ended";
      url.search = "";
      url.searchParams.set("reason", error ? "unavailable" : "expired");
      const ended = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => ended.cookies.set(cookie));
      return ended;
    }
  }

  if (!hasUser && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  // An administrator seeing One as a chosen person (D-544) can look, not act.
  // See `refusedWhileViewingAs` for what stops here and what refuses itself.
  if (hasUser && refusedWhileViewingAs({
    method: request.method,
    pathname,
    serverAction: request.headers.has("next-action"),
    cookie: request.cookies.get(VIEW_AS_PERSON_COOKIE)?.value,
    userId,
  })) {
    return NextResponse.json(
      { error: flat(VIEW_AS_READ_ONLY, "both"), code: VIEW_AS_REFUSAL_CODE },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Opening the app on `/`: a person whose `/` only redirects goes straight
  // to their home, without first rendering the frame once for the redirect
  // (boot speed, 6 Nov 2026). See `home-hint.ts` for why this is safe.
  if (hasUser && followsHomeHint(request)) {
    const home = readHomeHint(request.cookies.get(HOME_HINT_COOKIE)?.value, userId);
    if (home) {
      const url = request.nextUrl.clone();
      const [path, query = ""] = home.split("?", 2);
      url.pathname = path;
      url.search = query ? `?${query}` : "";
      const response = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
      return response;
    }
  }

  // Financial features without a One screen stay in their existing Fees
  // workflow, and are named on One's "not in One yet" page rather than
  // redirected to Fees. Never redirect/replay a POST or a provider callback. The data
  // clients independently refuse local real reads/writes and forged actions.
  if (feesBridgeEnabled() && (feesDestination(pathname) || nativeReadOnlyFeesPath(pathname) || pathname.startsWith("/api/fees/"))) {
    const {data:profile,error} = hasUser
      ? await supabase.schema("vppsone").from("staff_profiles").select("is_active,is_test_account,role").eq("user_id",userId!).maybeSingle<{is_active:boolean;is_test_account:boolean;role:string}>()
      : {data:null,error:null};
    const askedSession=request.nextUrl.searchParams.get("session") ?? request.cookies.get("vpps_view_session")?.value ?? null;
    const testContext=profile && !error && profile.is_active &&
      (profile.is_test_account || isConfinedDeployment() || (profile.role==="admin" && isTestSessionLabel(askedSession)));
    if (!testContext && pathname.startsWith("/api/fees/")) {
      return NextResponse.json({error:"Use the existing Fees service for this financial operation.",code:"ONE_CANONICAL_FEES_REQUIRED"},{status:409,headers:{"Cache-Control":"no-store"}});
    }
    if(profile && !error && usesCanonicalFees({isActive:profile.is_active,role:profile.role,isTestAccount:profile.is_test_account,confined:isConfinedDeployment()},testContext?askedSession:null)) {
      if(request.method!=="GET" && request.method!=="HEAD") return NextResponse.json({error:"Use the live Fees connection for this operation.",code:"ONE_CANONICAL_FEES_REQUIRED"},{status:409});
      // Never the Fees app (owner, 6 Nov 2026): a screen One does not have yet
      // lands on One's own page that says so. The work is still done in Fees.
      if(feesDestination(pathname,askedSession)){
        const url=request.nextUrl.clone();
        url.pathname="/not-in-one";
        url.search=`?${new URLSearchParams({from:cleanFromPath(pathname)})}`;
        const response=NextResponse.redirect(url);
        supabaseResponse.cookies.getAll().forEach(cookie=>response.cookies.set(cookie));
        return response;
      }
    }
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
