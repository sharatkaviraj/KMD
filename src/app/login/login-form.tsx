"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";

import { loginAction, type LoginActionState } from "@/app/login/actions";
import { Button } from "@/ui/primitives/button";
import { Field, Input, Notice } from "@/ui/primitives";

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
  const failed = state.status === "error";

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      {reason && !failed ? (
        <Notice tone="warning" hi={reason.hi} en={reason.en} />
      ) : null}

      <Field label="ईमेल" hint="Email" htmlFor="email">
        <Input
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
          aria-invalid={failed || undefined}
        />
      </Field>

      <Field label="पासवर्ड" hint="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          aria-invalid={failed || undefined}
        />
      </Field>

      {failed && state.message ? (
        <Notice tone="danger" hi={state.message} en={state.messageEn ?? undefined} />
      ) : null}

      <Button type="submit" size="lg" fullWidth loading={isPending} loadingText="साइन इन हो रहा है…">
        साइन इन करें
      </Button>

      <p className="text-center text-[13px] leading-5 text-muted-foreground">
        खाता विद्यालय प्रशासक बनाते हैं। यहाँ नया खाता नहीं बनता।
        <br />
        <span className="opacity-80">
          Accounts are created by the school admin — there is no sign-up here.
        </span>
      </p>
    </form>
  );
}
