"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";

import { loginAction, type LoginActionState } from "@/app/login/actions";
import { m } from "@/messages";
import {
  primary,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import { Button } from "@/ui/primitives/button";
import { Field, Input, Notice } from "@/ui/primitives";

// Defined here rather than in actions.ts: a "use server" module may only
// export async functions.
const initialLoginState: LoginActionState = { status: "idle", message: null };

/**
 * Why a signed-out visitor is looking at this page, when it was not simply
 * "you are not signed in". `requireStaff()` sets `?reason=`.
 */
const REASONS: Record<string, Localized> = {
  "no-profile": m.noProfile,
  inactive: m.accountInactive,
};

export function LoginForm({ language }: { language: Language }) {
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
        <Notice tone="warning" text={reason} language={language} />
      ) : null}

      <Field label={m.email} htmlFor="email" language={language}>
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

      <Field label={m.password} htmlFor="password" language={language}>
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
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={isPending}
        loadingText={primary(m.signingIn, language)}
      >
        {primary(m.signIn, language)}
      </Button>

      <Notice tone="neutral" text={m.noSignup} language={language} className="border-0 bg-transparent text-center" />
    </form>
  );
}
