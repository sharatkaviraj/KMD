import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { m } from "@/messages";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { homeForRole as homeFor } from "@/vx/nav";
import { flat, primary } from "@/platform/i18n/language";
import { readLanguageCookie } from "@/platform/i18n/language-cookie";
import { hasRequiredEnvVars } from "@/platform/env";
import { SchoolWelcome } from "@/ui/branding/school-welcome";
import { SchoolBrand } from "@/ui/branding/school-brand";
import { PwaInstallCard } from "@/ui/pwa-install-card";
import { EnvironmentBadgeOnPaper } from "@/ui/environment-badge";

export const runtime = "nodejs";

/* One tree for both sizes: brand above the card on a phone, beside it from 900px. */
const LOGIN_CSS = `
.vx-login{min-height:100dvh;background:var(--bg);color:var(--fg)}
.vx-login .lg-wrap{min-height:100dvh;width:100%;max-width:1040px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:center;gap:32px;padding:48px 28px}
.vx-login .lg-brand{display:flex;flex-direction:column;gap:16px;min-width:0}
.vx-login .lg-card{padding:28px;border-radius:24px;min-width:0}
@container vx (max-width:899px){.vx-login .lg-wrap{grid-template-columns:minmax(0,1fr);align-content:center;gap:20px;padding:24px 16px}.vx-login .lg-card{padding:20px}}
`;

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
    <div className="vx vx-login">
      <style>{LOGIN_CSS}</style>
      <main className="lg-wrap">
        <div className="lg-brand">
          <SchoolBrand variant="hero" preload />
          <SchoolWelcome language={language} />
        </div>
        <section lang={language === "en" ? "en" : "hi"} aria-labelledby="login-heading" className="card lg-card">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <EnvironmentBadgeOnPaper language={language} />
            <h1 id="login-heading" className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600, lineHeight: 1.2 }}>
              {primary(m.signInTitle, language)}
            </h1>
          </div>

          {/* useSearchParams() needs a boundary; without one the whole route is
            forced dynamic at build time. */}
          <Suspense fallback={<div style={{ height: 288 }} aria-label={flat(m.loading, language)} />}>
            <LoginForm language={language} />
          </Suspense>
          <PwaInstallCard />
        </section>
      </main>
    </div>
  );
}
