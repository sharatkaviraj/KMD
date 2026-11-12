import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LoginForm, type CodeSignInOffer } from "@/app/login/login-form";
import { LoginInstallHint } from "@/app/login/install-hint";
import { LoginScreen } from "@/app/login/login-screen";
import * as m from "@/messages/pairs";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { homeForRole as homeFor } from "@/vx/nav";
import { flat, primary } from "@/platform/i18n/language";
import { readLanguageCookie } from "@/platform/i18n/language-cookie";
import { hasRequiredEnvVars } from "@/platform/env";
import { EnvironmentBadgeOnPaper } from "@/ui/environment-badge";

export const runtime = "nodejs";

export async function generateMetadata() {
  // Signed out there is no profile, so the device's remembered choice decides
  // what the tab says.
  const language = await readLanguageCookie();
  return { title: `${primary(m.signInTitle, language)} · ${m.appName.hi}` };
}

export default async function LoginPage() {
  if (!hasRequiredEnvVars) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
        <div className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-destructive-soft-foreground">
          <p className="text-[15px] font-medium">Supabase is not configured.</p>
          <p className="mt-1 text-[13px] leading-5">
            Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            in .env.local or in the Vercel project settings.
          </p>
        </div>
      </main>
    );
  }

  // The proxy redirects a signed-in visitor away from here already. This
  // repeats the check because the proxy only runs on navigation: a Server
  // Action posting back to /login is not covered by it.
  const signedIn = await getCurrentStaff();
  if (signedIn) {
    redirect(homeFor(signedIn.role));
  }

  // Signed out there is no profile, so the device remembers instead (D-36).
  const [language, codeSignIn] = await Promise.all([readLanguageCookie(), readCodeSignInOffer()]);

  return (
    <LoginScreen language={language} badge={<EnvironmentBadgeOnPaper language={language} className="self-start" />}>
      <section lang={language === "en" ? "en" : "hi"} aria-labelledby="login-heading" style={{ display: "contents" }}>
        {/* useSearchParams() needs a boundary; without one the whole route is
          forced dynamic at build time. */}
        <Suspense fallback={<div style={{ height: 420 }} aria-label={flat(m.loading, language)} />}>
          <LoginForm language={language} codeSignIn={codeSignIn} />
        </Suspense>
        <LoginInstallHint />
      </section>
    </LoginScreen>
  );
}

/**
 * Sign in with a WhatsApp code (D-585): the page opens on it once Settings →
 * WhatsApp says all staff; for the owner's number only it waits behind
 * `?with=code`; off, or unreadable, the page is email and password only.
 */
async function readCodeSignInOffer(): Promise<CodeSignInOffer> {
  try {
    const { readSignInModeForPage } = await import("@/modules/whatsapp/data/sign-in-codes");
    const mode = await readSignInModeForPage();
    return mode === "all_staff" ? "default" : mode === "owner_only" ? "offered" : "none";
  } catch {
    return "none";
  }
}
