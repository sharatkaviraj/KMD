"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { loginAction, type LoginActionState } from "@/app/login/actions";
import type { Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";
import { lead, p, under, type Pair } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";

// Defined here rather than in actions.ts: a "use server" module may only
// export async functions.
const initialLoginState: LoginActionState = { status: "idle", message: null };

/*
 * The sign-in form, redesigned onto the vx kit (P11 · states signin, error,
 * signing, forgot, expired). Everything it did before it still does: the
 * same `loginAction`, `next` carried through, the `?reason=` notices, the
 * email kept across a failed attempt, the password cleared, focus moved to
 * the error.
 */

const T = {
  email: p("Email", "ईमेल"),
  password: p("Password", "पासवर्ड"),
  signIn: p("Sign in", "साइन इन करें"),
  signingIn: p("Signing in…", "साइन इन हो रहा है…"),
  noSignup: p("Accounts are created by the school admin — there is no sign-up here.", "खाता विद्यालय प्रशासक बनाते हैं। यहाँ नया खाता नहीं बनता।"),
  show: p("Show password", "पासवर्ड दिखाएँ"),
  hide: p("Hide password", "पासवर्ड छिपाएँ"),
  forgot: p("Forgot password?", "पासवर्ड भूल गए?"),
  forgotTitle: p("Forgot your password?", "पासवर्ड भूल गए?"),
  forgotBody: p(
    "Passwords are reset by the school administrator. Ask in the office; they will give you a new one, and you can change it after you sign in (Preferences → Password).",
    "पासवर्ड विद्यालय प्रशासक बदलते हैं। ऑफ़िस में पूछें; वे नया पासवर्ड देंगे, जिसे आप साइन इन के बाद बदल सकते हैं (पसंद → पासवर्ड)।",
  ),
  ok: p("OK", "ठीक है"),
} satisfies Record<string, Pair>;

/**
 * Why a signed-out visitor is looking at this page, when it was not simply
 * "you are not signed in". `requireStaff()` sets `?reason=`; `expired` is
 * where the session-expired prompt sends people.
 */
const REASONS: Record<string, Pair> = {
  "no-profile": p("This account has no VPPS One staff profile yet.", "इस खाते का VPPS One में कोई स्टाफ़ प्रोफ़ाइल नहीं है।"),
  inactive: p("This staff account is inactive.", "यह स्टाफ़ खाता निष्क्रिय है।"),
  expired: p("You were signed out because the session ended. Sign in again — nothing you saved is lost.", "सत्र ख़त्म होने से आप साइन आउट हो गए। फिर से साइन इन करें — सहेजा हुआ कुछ नहीं खोया।"),
};

/** The lead line, and the other language underneath when the reader reads both. */
function Two({ pair, language, small }: { pair: Pair; language: Language; small?: boolean }) {
  const second = under(pair, language);
  return (
    <>
      <span lang={language === "hi" ? "hi" : "en"}>{lead(pair, language)}</span>
      {second ? (
        <span lang={language === "hi" ? "en" : "hi"} style={{ display: "block", fontSize: small ? 12 : 13, color: "var(--mut)", fontWeight: 400 }}>
          {second}
        </span>
      ) : null}
    </>
  );
}

function Note({ tone, pair, language, id, focusRef }: { tone: "warn" | "bad" | "mut"; pair: Pair; language: Language; id?: string; focusRef?: React.Ref<HTMLDivElement> }) {
  const colors = tone === "bad" ? { bg: "var(--bads)", fg: "var(--bad)" } : tone === "warn" ? { bg: "var(--warns)", fg: "var(--warnfg)" } : { bg: "transparent", fg: "var(--mut)" };
  return (
    <div
      id={id}
      ref={focusRef}
      tabIndex={focusRef ? -1 : undefined}
      role={tone === "bad" ? "alert" : tone === "warn" ? "status" : undefined}
      style={{ display: "flex", gap: 10, padding: tone === "mut" ? 0 : "12px 14px", borderRadius: 12, background: colors.bg, color: colors.fg, fontSize: 14, lineHeight: 1.45, textAlign: tone === "mut" ? "center" : undefined }}
    >
      {tone !== "mut" ? <Ic n={tone === "bad" ? "alert" : "info"} size={18} /> : null}
      <span style={{ minWidth: 0 }}>
        <Two pair={pair} language={language} />
      </span>
    </div>
  );
}

export function LoginForm({ language }: { language: Language }) {
  const searchParams = useSearchParams();
  const [state, formAction, isPending] = useActionState<LoginActionState, FormData>(loginAction, initialLoginState);

  // React resets the form once the action returns, which on a wrong password
  // clears the email as well. Holding the email in state survives that reset;
  // the password is deliberately left uncontrolled so a failure clears it.
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgot, setForgot] = useState(false);

  const next = searchParams.get("next") ?? "/dashboard";
  const reason = REASONS[searchParams.get("reason") ?? ""];
  const failed = state.status === "error";
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failed) errorRef.current?.focus();
  }, [failed, state.message]);

  const describedBy = failed ? "login-error" : undefined;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-busy={isPending || undefined}>
      <input type="hidden" name="next" value={next} />

      {reason && !failed ? <Note tone="warn" pair={reason} language={language} /> : null}

      <label htmlFor="email" style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 600, fontSize: 14 }}>
        <span><Two pair={T.email} language={language} small /></span>
        <input
          id="email"
          name="email"
          type="email"
          className={`inp${failed ? " err" : ""}`}
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
          aria-describedby={describedBy}
          style={{ fontSize: 16 }}
        />
      </label>

      <label htmlFor="password" style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 600, fontSize: 14 }}>
        <span><Two pair={T.password} language={language} small /></span>
        <span style={{ position: "relative", display: "flex" }}>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            className={`inp${failed ? " err" : ""}`}
            required
            autoComplete="current-password"
            aria-invalid={failed || undefined}
            aria-describedby={describedBy}
            style={{ fontSize: 16, paddingRight: 52 }}
          />
          <button
            type="button"
            className="tap icon-btn"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={lead(showPassword ? T.hide : T.show, language)}
            aria-pressed={showPassword}
            style={{ position: "absolute", right: 2, top: 0, width: 44, height: 44, border: 0, background: "none", color: "var(--mut)", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Ic n={showPassword ? "eyeOff" : "eye"} size={20} />
          </button>
        </span>
      </label>

      <button type="button" className="tap" onClick={() => setForgot(true)} style={{ alignSelf: "flex-end", border: 0, background: "none", color: "var(--acc)", fontWeight: 600, fontSize: 14, padding: "4px 0", minHeight: 44 }}>
        {lead(T.forgot, language)}
      </button>

      {failed && state.message ? <Note tone="bad" pair={state.message} language={language} id="login-error" focusRef={errorRef} /> : null}

      <button type="submit" className="tap btn pri big" disabled={isPending} style={{ width: "100%" }}>
        {isPending ? <Ic n="refresh" size={18} className="spin" /> : null}
        {lead(isPending ? T.signingIn : T.signIn, language)}
      </button>

      <Note tone="mut" pair={T.noSignup} language={language} />

      <Sheet
        open={forgot}
        onClose={() => setForgot(false)}
        icon="key"
        title={lead(T.forgotTitle, language)}
        footer={
          <button type="button" className="tap btn pri" style={{ flex: 1 }} onClick={() => setForgot(false)}>
            {lead(T.ok, language)}
          </button>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          <Two pair={T.forgotBody} language={language} />
        </p>
      </Sheet>
    </form>
  );
}
