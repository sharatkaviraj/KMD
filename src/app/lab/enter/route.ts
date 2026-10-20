import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { isSmokeAccount, isSmokeEmail } from "@/modules/smoke/domain/pool";
import { clockValue } from "@/modules/smoke/domain/smoke";
import { resolvePass, touchPass } from "@/modules/smoke/data/smoke-repo";
import { admitSignedInUser } from "@/platform/auth/admit";
import { QA_CLOCK_COOKIE } from "@/platform/auth/qa-clock";
import { smokeLabEnabled } from "@/platform/auth/smoke-lab";
import { landingFor } from "@/platform/config/start";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/lab/enter?pass=…[&next=/teach]` — a Smoke Lab agent signs in as its seat.
 *
 * The pass is the whole credential: 256 random bits an admin issued on
 * `/smoke`, valid only while it and its run are live (24 hours at most), only
 * for a `smoke.*@qa.vpps.local` account, and only while the app is on the test
 * database. The session is made exactly as `/auth/confirm` makes one — a
 * one-time magic-link token minted and verified on the server, so no link,
 * password or token ever reaches the agent — and admitted by the same check.
 * The middleware then keeps the session only while the pass stays live.
 */
export async function GET(request: NextRequest) {
  if (!smokeLabEnabled()) return new NextResponse("Not found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const ended = (reason: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/lab/ended";
    url.search = "";
    url.searchParams.set("reason", reason);
    return NextResponse.redirect(url);
  };

  const resolved = await resolvePass(params.get("pass"));
  if (!resolved.ok) return ended(resolved.reason);
  const { pass } = resolved;
  if (!isSmokeEmail(pass.email)) return ended("invalid");

  const supabase = await createClient();
  // A browser already signed in as a real member of staff is not quietly
  // switched to a test account: they sign out first. One already signed in
  // as this seat keeps its session; another smoke seat is replaced.
  const { data: current } = await supabase.auth.getClaims();
  const signedIn = current?.claims;
  if (signedIn?.sub && !isSmokeAccount(signedIn)) return ended("signed_in");
  let userId = signedIn?.sub && typeof signedIn.email === "string" && signedIn.email.toLowerCase() === pass.email ? signedIn.sub : null;

  if (!userId) {
    const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: pass.email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) return ended("unavailable");
    const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (verified.error || !verified.data.user || verified.data.user.email?.toLowerCase() !== pass.email) return ended("unavailable");
    userId = verified.data.user.id;
  }

  const admitted = await admitSignedInUser(supabase, userId, { signOutScope: "local", expectedStaffProfileId: pass.staffProfileId });
  if (!admitted.ok) return ended("profile");

  await touchPass(pass.passId).catch(() => undefined);
  revalidatePath("/", "layout");

  const landing = landingFor({ role: admitted.staff.role, preferredStart: admitted.staff.preferredStart, requested: params.get("next") });
  const target = landing.startsWith("/") ? new URL(landing, request.nextUrl.origin) : new URL(landing);
  const response = NextResponse.redirect(target);
  // The run's school day and start time become this browser's pretend "now"
  // (what Today shows; every write still uses the real clock).
  const clock = clockValue(pass.run.schoolDay, pass.run.clockStart);
  if (clock) response.cookies.set(QA_CLOCK_COOKIE, clock, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 12 * 60 * 60 });
  return response;
}
