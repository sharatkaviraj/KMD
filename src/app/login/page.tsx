import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { getSchoolName, hasRequiredEnvVars } from "@/platform/env";
import { EnvironmentBadge } from "@/ui/environment-badge";

export const runtime = "nodejs";

export const metadata = {
  title: "साइन इन · VPPS One",
};

export default async function LoginPage() {
  if (!hasRequiredEnvVars) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-900">
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
  if (await getCurrentStaff()) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 space-y-3">
        <EnvironmentBadge />
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          VPPS One
        </h1>
        <p className="text-[15px] leading-6 text-slate-600">{getSchoolName()}</p>
      </div>

      {/* useSearchParams() needs a boundary; without one the whole route is
          forced dynamic at build time. */}
      <Suspense fallback={<div className="h-72" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
