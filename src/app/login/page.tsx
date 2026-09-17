import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { m } from "@/messages";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { homeFor } from "@/platform/config/navigation";
import { flat, primary } from "@/platform/i18n/language";
import { readLanguageCookie } from "@/platform/i18n/language-cookie";
import { getSchoolName, hasRequiredEnvVars } from "@/platform/env";
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
  const language = await readLanguageCookie();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 space-y-3">
        <EnvironmentBadgeOnPaper language={language} />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          VPPS One
        </h1>
        <p className="text-[15px] leading-6 text-muted-foreground">{getSchoolName()}</p>
      </div>

      {/* useSearchParams() needs a boundary; without one the whole route is
          forced dynamic at build time. */}
      <Suspense fallback={<div className="h-72" aria-label={flat(m.loading, language)} />}>
        <LoginForm language={language} />
      </Suspense>
    </main>
  );
}
