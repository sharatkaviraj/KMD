"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

import { loginAction, type LoginActionState } from "@/app/login/actions";
import type { Language } from "@/platform/i18n/language";
import { ArrowRight, Eye, EyeOff, Info, KeyRound, RefreshCw, TriangleAlert } from "lucide-react";

import { lead, p, under, type Pair } from "@/vx/text";

// Defined here rather than in actions.ts: a "use server" module may only
// export async functions.
const initialLoginState: LoginActionState = { status: "idle", message: null };

/*
 * The sign-in form, drawn as the design's `Auth` (states signin, error,
 * signing, forgot, expired). Everything it did before it still does: the
 * same `loginAction`, `next` carried through, the `?reason=` notices, the
 * email kept across a failed attempt, the password cleared, focus moved to
 * the error. Sign-in stays by email (UI-51), so the design's "mobile number
 * or username" field asks for the email.
 *
 * "Remember this phone" keeps the email (never the password) in this
 * browser's storage, as the design's switch says.
 */

export const LOGIN_TEXT = {
  title: p("Sign in", "साइन इन"),
  welcome: p("Welcome back. Use the email the office gave you.", "फिर से स्वागत है। ऑफ़िस से मिला ईमेल लिखें।"),
  email: p("Email", "ईमेल"),
  emailPlaceholder: p("Your email", "आपका ईमेल"),
  password: p("Password", "पासवर्ड"),
  passwordPlaceholder: p("Your password", "आपका पासवर्ड"),
  signIn: p("Sign in", "साइन इन करें"),
  signingIn: p("Signing in…", "साइन इन हो रहा है…"),
  remember: p("Remember this phone", "यह फ़ोन याद रखें"),
  rememberSub: p("Keeps your email here. Never your password.", "आपका ईमेल यहाँ रहेगा। पासवर्ड कभी नहीं।"),
  newHere: p("VPPS One · new here? Ask the admin", "VPPS One · नए हैं? प्रशासक से पूछें"),
  show: p("Show password", "पासवर्ड दिखाएँ"),
  hide: p("Hide password", "पासवर्ड छिपाएँ"),
  forgot: p("Forgot password?", "पासवर्ड भूल गए?"),
  forgotTitle: p("Forgot your password?", "पासवर्ड भूल गए?"),
  forgotBody: p(
    "There is no reset by SMS or email. Only the school administrator can give a new password, so nobody can get into the records with a lost or stolen phone. Ask in the office; you can change it after you sign in (Preferences → Password).",
    "SMS या ईमेल से पासवर्ड नहीं बदलता। नया पासवर्ड सिर्फ़ विद्यालय प्रशासक दे सकते हैं, ताकि खोए या चोरी हुए फ़ोन से कोई रिकॉर्ड न खोल सके। ऑफ़िस में पूछें; साइन इन के बाद आप इसे बदल सकते हैं (पसंद → पासवर्ड)।",
  ),
  ok: p("OK", "ठीक है"),
  badHelp: p("Try again or ask the admin to reset it. Check that Caps Lock is off.", "फिर से कोशिश करें या प्रशासक से पासवर्ड बदलवाएँ। देखें कि Caps Lock बंद है।"),
} satisfies Record<string, Pair>;
const T = LOGIN_TEXT;

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

/** The fee app's "wrong email or password" sentence, in English, as the action returns it. */
const BAD_CREDENTIALS_EN = "That email and password do not match an account.";

const REMEMBER_KEY = "vx:login:email";
const REMEMBER_OFF_KEY = "vx:login:remember-off";

function readStore(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStore(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the switch simply does nothing.
  }
}

const noSubscribe = () => () => undefined;

/** The lead line, and the other language underneath when the reader reads both. */
function Two({ pair, language, small }: { pair: Pair; language: Language; small?: boolean }) {
  const second = under(pair, language);
  return (
    <>
      <span lang={language === "hi" ? "hi" : "en"}>{lead(pair, language)}</span>
      {second ? (
        <span lang={language === "hi" ? "en" : "hi"} style={{ display: "block", fontSize: small ? 11 : 12, color: "var(--mut)", fontWeight: 500 }}>
          {second}
        </span>
      ) : null}
    </>
  );
}

const noteStyle = { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.5 } as const;

const eyeStyle = { position: "absolute", right: 4, bottom: 2, width: 40, height: 40, padding: 0, border: 0, borderRadius: 10, background: "transparent", color: "var(--mut)", display: "flex", alignItems: "center", justifyContent: "center" } as const;

export function LoginForm({ language, initial = initialLoginState }: { language: Language; /** The design fixture draws the error state with this. */ initial?: LoginActionState }) {
  const searchParams = useSearchParams();
  const [state, formAction, isPending] = useActionState<LoginActionState, FormData>(loginAction, initial);

  // React resets the form once the action returns, which on a wrong password
  // clears the email as well. Holding the email in state survives that reset;
  // the password is deliberately left uncontrolled so a failure clears it.
  // Until somebody types, the email is the one this phone remembers.
  const storedEmail = useSyncExternalStore(noSubscribe, () => readStore(REMEMBER_KEY), () => "");
  const storedOff = useSyncExternalStore(noSubscribe, () => readStore(REMEMBER_OFF_KEY) === "1", () => false);
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
  const email = typedEmail ?? storedEmail;
  const remember = rememberChoice ?? !storedOff;
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
  const badCredentials = failed && state.message?.en === BAD_CREDENTIALS_EN;

  const keepChoice = () => {
    writeStore(REMEMBER_OFF_KEY, remember ? null : "1");
    writeStore(REMEMBER_KEY, remember && email.trim() ? email.trim() : null);
  };

  return (
    <form action={formAction} onSubmit={keepChoice} style={{ display: "flex", flexDirection: "column", gap: 18 }} aria-busy={isPending || undefined}>
      <input type="hidden" name="next" value={next} />

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 id="login-heading" className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.15 }}>{lead(T.title, language)}</h1>
        <span style={{ fontSize: 13, color: "var(--mut)" }}><Two pair={T.welcome} language={language} small /></span>
      </div>

      {reason && !failed ? (
        <div role="status" style={{ ...noteStyle, background: "var(--warns)", color: "var(--warnfg)" }}>
          <Info size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} />
          <span style={{ minWidth: 0 }}><Two pair={reason} language={language} /></span>
        </div>
      ) : null}

      <label htmlFor="email" className="field">
        <span><Two pair={T.email} language={language} small /></span>
        <input
          id="email"
          name="email"
          type="email"
          className="inp"
          value={email}
          onChange={(event) => setTypedEmail(event.target.value)}
          required
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          placeholder={lead(T.emailPlaceholder, language)}
          aria-describedby={describedBy}
          style={{ fontSize: 16 }}
        />
      </label>

      <label htmlFor="password" className="field" style={{ position: "relative" }}>
        <span><Two pair={T.password} language={language} small /></span>
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          className={`inp${failed ? " err" : ""}`}
          required
          autoComplete="current-password"
          placeholder={lead(T.passwordPlaceholder, language)}
          aria-invalid={failed || undefined}
          aria-describedby={describedBy}
          style={{ fontSize: 16, paddingRight: 52 }}
        />
        <button
          type="button"
          className="tap"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={lead(showPassword ? T.hide : T.show, language)}
          aria-pressed={showPassword}
          style={eyeStyle}
        >
          {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      </label>

      {failed && state.message ? (
        <div id="login-error" ref={errorRef} tabIndex={-1} role="alert" className="fadein" style={{ ...noteStyle, background: "var(--bads)", color: "var(--bad)", outline: "none" }}>
          <TriangleAlert size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{lead(state.message, language)}</span>
            {badCredentials ? <span style={{ fontSize: 12 }}>{lead(T.badHelp, language)}</span> : null}
            {under(state.message, language) ? <span style={{ fontSize: 12 }}>{under(state.message, language)}</span> : null}
          </span>
        </div>
      ) : null}

      <button
        type="button"
        role="switch"
        aria-checked={remember}
        className="tap"
        onClick={() => setRememberChoice(!remember)}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0", width: "100%", border: 0, background: "transparent", color: "var(--fg)", textAlign: "left" }}
      >
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{lead(T.remember, language)}</span>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{lead(T.rememberSub, language)}</span>
        </span>
        <span className={`sw${remember ? " on" : ""}`}><span /></span>
      </button>

      <button type="submit" className="tap btn pri" disabled={isPending} style={{ height: 52, fontSize: 16, borderRadius: 14 }}>
        {isPending ? <RefreshCw size={20} className="spin" aria-hidden /> : <ArrowRight size={20} aria-hidden />}
        {lead(isPending ? T.signingIn : T.signIn, language)}
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="tap btn ghost" onClick={() => setForgot((v) => !v)} aria-expanded={forgot} aria-controls="login-forgot" style={{ padding: "0 8px", marginLeft: -8, color: "var(--accfg)" }}>
          {lead(T.forgot, language)}
        </button>
        <span style={{ fontSize: 12, color: "var(--mut)" }}><Two pair={T.newHere} language={language} small /></span>
      </div>

      {/* State `forgot`: inline rather than a sheet, so the sign-in page does
        not load the overlay kit (the /login bundle budget, check:bundles). */}
      {forgot ? (
        <div id="login-forgot" role="region" aria-label={lead(T.forgotTitle, language)} className="fadein" style={{ ...noteStyle, flexDirection: "column", gap: 10, background: "var(--infos)", color: "var(--info)" }}>
          <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <KeyRound size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <strong><Two pair={T.forgotTitle} language={language} small /></strong>
              <span><Two pair={T.forgotBody} language={language} /></span>
            </span>
          </span>
          <button type="button" className="tap btn sec" style={{ alignSelf: "flex-start" }} onClick={() => setForgot(false)}>{lead(T.ok, language)}</button>
        </div>
      ) : null}
    </form>
  );
}
