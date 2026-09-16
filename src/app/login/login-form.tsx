"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";

import { loginAction, type LoginActionState } from "@/app/login/actions";

// Defined here rather than in actions.ts: a "use server" module may only
// export async functions.
const initialLoginState: LoginActionState = {
  status: "idle",
  message: null,
  messageEn: null,
};

/**
 * Why a signed-out visitor is looking at this page, when it was not simply
 * "you are not signed in". `requireStaff()` sets `?reason=`.
 */
const REASONS: Record<string, { hi: string; en: string }> = {
  "no-profile": {
    hi: "इस खाते का VPPS One में कोई स्टाफ़ प्रोफ़ाइल नहीं है।",
    en: "This account has no VPPS One staff profile yet.",
  },
  inactive: {
    hi: "यह स्टाफ़ खाता निष्क्रिय है।",
    en: "This staff account is inactive.",
  },
};

function Notice({
  hi,
  en,
  tone,
}: {
  hi: string;
  en: string;
  tone: "error" | "info";
}) {
  const toneClasses =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 ${toneClasses}`}
    >
      <p className="text-[15px] font-medium leading-6">{hi}</p>
      <p className="mt-0.5 text-[13px] leading-5 opacity-80">{en}</p>
    </div>
  );
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction, isPending] = useActionState<LoginActionState, FormData>(
    loginAction,
    initialLoginState,
  );

  // React resets the form once the action returns, which on a wrong password
  // clears the email as well — so the staff member retypes their address on a
  // phone to fix a typo they made in the other field. Holding the email in
  // component state survives that reset. The password is deliberately left
  // uncontrolled: clearing it after a failure is the right behaviour.
  const [email, setEmail] = useState("");

  const next = searchParams.get("next") ?? "/dashboard";
  const reason = REASONS[searchParams.get("reason") ?? ""];

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      {reason && state.status === "idle" ? (
        <Notice hi={reason.hi} en={reason.en} tone="info" />
      ) : null}

      <div className="space-y-2">
        <label htmlFor="email" className="block text-[15px] font-medium text-slate-900">
          ईमेल
          <span className="ml-2 text-[13px] font-normal text-slate-500">Email</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          placeholder="name@vpps.co.in"
          // h-12 and text-base: anything smaller than 16px makes iOS Safari
          // zoom the page on focus, and these are phones first.
          className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-[15px] font-medium text-slate-900">
          पासवर्ड
          <span className="ml-2 text-[13px] font-normal text-slate-500">Password</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {state.status === "error" && state.message ? (
        <Notice hi={state.message} en={state.messageEn ?? ""} tone="error" />
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="h-12 w-full rounded-xl bg-slate-900 text-base font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
      >
        {isPending ? "साइन इन हो रहा है…" : "साइन इन करें"}
      </button>

      <p className="text-center text-[13px] leading-5 text-slate-500">
        खाता विद्यालय प्रशासक बनाते हैं। यहाँ नया खाता नहीं बनता।
        <br />
        <span className="opacity-80">
          Accounts are created by the school admin — there is no sign-up here.
        </span>
      </p>
    </form>
  );
}
