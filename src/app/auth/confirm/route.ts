import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { admitSignedInUser } from "@/platform/auth/admit";
import { sanitizeRedirectPath } from "@/platform/env";
import { homeFor } from "@/platform/config/navigation";
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

  const url = request.nextUrl.clone();
  // A link that named a destination goes there; one that did not goes to this
  // role own Home, which for a teacher is her day rather than a profile card.
  url.pathname = sanitizeRedirectPath(requested, homeFor(admitted.staff.role));
  url.search = "";
  return NextResponse.redirect(url);
}
