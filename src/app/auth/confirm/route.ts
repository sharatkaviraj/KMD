import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { admitSignedInUser } from "@/platform/auth/admit";
import { sanitizeRedirectPath } from "@/platform/env";
import { landingFor } from "@/platform/config/start";
import { createClient } from "@/platform/supabase/server";

export const runtime = "nodejs";

/**
 * Where a link Supabase minted lands — a magic link, an invite, a recovery.
 *
 * **This is how somebody signs in without a password.** The school has forty
 * staff and four accounts (D-68); the reason for that is not secrecy, it is
 * that asking thirty-six people to remember a password is asking them not to
 * use the thing. A link in a message is the door they will actually walk
 * through, and it is the door Supabase already builds.
 *
 * It cannot be used to *request* anything. There is no "send me a link" form
 * anywhere in this app, and a `token_hash` can only be minted by the admin API
 * — so the endpoint is inert until somebody with the service role deliberately
 * issues a link. What arrives here is a one-time token Supabase itself checks;
 * we never see a password, and neither does the school.
 *
 * Refusals go to `/login` rather than rendering here, so an expired link is a
 * screen somebody can act on rather than a dead end. Every refusal reads the
 * same from outside — an expired token and a made-up one are one message, and
 * neither says whether the address exists.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const requested = params.get("next") ?? undefined;
  // A refusal happens before there is a profile to ask, so the fallback here
  // is the generic one; the success path below resolves the role own Home.
  const next = sanitizeRedirectPath(requested);

  const refuse = (reason: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("error", reason);
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };

  if (!tokenHash || !type) return refuse("link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error || !data.user) return refuse("link");

  // The same two checks the password door runs, from the same function, so
  // the two entrances cannot drift apart.
  const admitted = await admitSignedInUser(supabase, data.user.id);
  if (!admitted.ok) return refuse("profile");

  revalidatePath("/", "layout");

  // A link that named a destination goes there; one that did not goes to this
  // account's start screen, which for a teacher is her day rather than a
  // profile card and for accounts staff who chose it is School Fees.
  const landing = landingFor({
    role: admitted.staff.role,
    preferredStart: admitted.staff.preferredStart,
    requested,
  });

  // A start screen in another app is an absolute URL and goes as it is.
  if (!landing.startsWith("/")) {
    return NextResponse.redirect(new URL(landing));
  }

  // **Path and query set separately.** This used to be one
  // `url.pathname = sanitizeRedirectPath(...)`, and `URL.pathname`
  // percent-encodes a `?` — so a link that named `/teach/attendance?class=…`
  // landed on a path containing a literal `%3F` and 404ed. Every issued link
  // with a query string was affected.
  //
  // Still `request.nextUrl.clone()` rather than a URL built from an origin:
  // the framework decides what this deployment's origin is, and a redirect
  // that changed host would drop the session cookie it has just set.
  const url = request.nextUrl.clone();
  const split = landing.indexOf("?");
  url.pathname = split === -1 ? landing : landing.slice(0, split);
  url.search = split === -1 ? "" : landing.slice(split);

  return NextResponse.redirect(url);
}
