"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { ArrowRight, ClipboardPaste, Info, KeyRound, MessageCircle, RefreshCw, TriangleAlert } from "lucide-react";

import { requestCodeAction, verifyCodeAction, type CodeActionState, type CodeProblem } from "@/app/login/actions";
import type { Language } from "@/platform/i18n/language";
import { cue, primeFeedback } from "@/ui/feedback/cue";
import { maskSignInPhone, signInCodeIn, signInPhoneKey, SIGN_IN_CODE_LENGTH, SIGN_IN_CODE_MINUTES } from "@/modules/whatsapp/domain/sign-in-code";
import { lead, p, under, type Pair } from "@/vx/text";

/*
 * Sign in with a WhatsApp code (D-585): type your mobile number, get a
 * six-digit code on WhatsApp from the school's number, type it here. Two
 * steps on one card, each with one big button and the next step spelled
 * out, and Password always one tap away. Since D-608 it is what the sign-in
 * page opens on.
 *
 * What the page says after Send code is the same whoever's number it is
 * ("if this number is on your staff record…"): the server gives it nothing
 * else to say (`requestAnswer`). While codes go to the owner's number only,
 * every other number is told so ("not yet"), with Password as the next step.
 *
 * Back from WhatsApp with the code copied, the code goes in by itself where
 * the browser lets the page read what was copied (`useCodeFromClipboard`),
 * and Paste code lights up as the next step where it does not.
 */

export const CODE_TEXT = {
  title: p("Sign in", "साइन इन"),
  welcome: p("Type your mobile number. We'll send a code on WhatsApp.", "अपना मोबाइल नंबर लिखें। हम WhatsApp पर एक कोड भेजेंगे।"),
  phone: p("Mobile number", "मोबाइल नंबर"),
  phoneHint: p("The number the school has for you", "जो नंबर विद्यालय के पास आपका है"),
  send: p("Send code on WhatsApp", "WhatsApp पर कोड भेजें"),
  sending: p("Sending code…", "कोड भेज रहे हैं…"),
  sentTitle: p("Code sent on WhatsApp", "WhatsApp पर कोड भेज दिया"),
  sentTo: p("To", "नंबर"),
  sentBody: p(
    `If this number is on your staff record, the code arrives in a few seconds. In WhatsApp tap Copy code, come back, tap Paste code. It works for ${SIGN_IN_CODE_MINUTES} minutes.`,
    `अगर यह नंबर आपके स्टाफ़ रिकॉर्ड में है, तो कोड कुछ ही सेकंड में आएगा। WhatsApp में 'कोड कॉपी करें' दबाएँ, यहाँ आकर 'कोड चिपकाएँ' दबाएँ। यह ${SIGN_IN_CODE_MINUTES} मिनट तक चलेगा।`,
  ),
  sentBodyAuto: p(
    `If this number is on your staff record, the code arrives in a few seconds. In WhatsApp tap Copy code and come back: the code goes in by itself. It works for ${SIGN_IN_CODE_MINUTES} minutes.`,
    `अगर यह नंबर आपके स्टाफ़ रिकॉर्ड में है, तो कोड कुछ ही सेकंड में आएगा। WhatsApp में 'कोड कॉपी करें' दबाकर यहाँ लौटें: कोड अपने-आप भर जाएगा। यह ${SIGN_IN_CODE_MINUTES} मिनट तक चलेगा।`,
  ),
  found: p("Code found. Signing you in…", "कोड मिल गया। साइन इन कर रहे हैं…"),
  openWhatsApp: p("Open WhatsApp", "WhatsApp खोलें"),
  code: p("The code from WhatsApp", "WhatsApp वाला कोड"),
  paste: p("Paste code", "कोड चिपकाएँ"),
  pasteHint: p("In WhatsApp tap Copy code, then come back and tap Paste code.", "WhatsApp में 'कोड कॉपी करें' दबाएँ, फिर यहाँ आकर 'कोड चिपकाएँ' दबाएँ।"),
  signIn: p("Sign in", "साइन इन करें"),
  checking: p("Checking code…", "कोड जाँच रहे हैं…"),
  again: p("Send a new code", "नया कोड भेजें"),
  againShort: p("New code", "नया कोड"),
  seconds: p("s", "से."),
  change: p("Change number", "नंबर बदलें"),
  changeShort: p("Change", "बदलें"),
  usePassword: p("Use email and password instead", "ईमेल और पासवर्ड से साइन इन करें"),
  usePasswordShort: p("Email and password", "ईमेल और पासवर्ड"),
  remember: p("Remember this phone", "यह फ़ोन याद रखें"),
  rememberSub: p("Keeps your number here for next time.", "अगली बार के लिए आपका नंबर यहाँ रहेगा।"),
  noCode: p(
    "No code yet? The office may not have your number. Use your email and password, or ask the office to add your WhatsApp number.",
    "अभी तक कोड नहीं आया? हो सकता है ऑफ़िस के पास अभी आपका नंबर न हो। ईमेल और पासवर्ड से साइन इन करें, या ऑफ़िस से अपना WhatsApp नंबर जुड़वाएँ।",
  ),
} satisfies Record<string, Pair>;
const T = CODE_TEXT;

const PROBLEM: Record<Exclude<CodeProblem, "admission">, Pair> = {
  bad_number: p("That is not a 10-digit mobile number. Check it and try again.", "यह 10 अंकों का मोबाइल नंबर नहीं है। जाँचकर फिर से लिखें।"),
  not_yet: p("WhatsApp codes are not on for this number yet. Use your email and password.", "इस नंबर पर WhatsApp कोड अभी चालू नहीं है। ईमेल और पासवर्ड से साइन इन करें।"),
  off: p("Sign-in by WhatsApp code is off right now. Use your email and password.", "WhatsApp कोड से साइन इन अभी बंद है। ईमेल और पासवर्ड से साइन इन करें।"),
  limited: p("Too many codes for this number. Wait a little, or use your email and password.", "इस नंबर पर बहुत कोड भेजे जा चुके हैं। थोड़ी देर रुकें, या ईमेल और पासवर्ड से साइन इन करें।"),
  busy: p("WhatsApp sign-in is busy. Try again in a few minutes, or use your email and password.", "WhatsApp साइन इन अभी व्यस्त है। कुछ मिनट बाद फिर कोशिश करें, या ईमेल और पासवर्ड से साइन इन करें।"),
  unavailable: p("WhatsApp sign-in is not working right now. Use your email and password.", "WhatsApp साइन इन अभी काम नहीं कर रहा। ईमेल और पासवर्ड से साइन इन करें।"),
  type_code: p(`Type the ${SIGN_IN_CODE_LENGTH} digits from WhatsApp.`, `WhatsApp वाले ${SIGN_IN_CODE_LENGTH} अंक लिखें।`),
  wrong: p("That code is not right. Check it and type it again.", "यह कोड सही नहीं है। जाँचकर फिर से लिखें।"),
  start_again: p("This code no longer works. Send a new code.", "यह कोड अब नहीं चलेगा। नया कोड भेजें।"),
  not_staff: p("This number cannot sign in to VPPS One. Use your email and password, or ask the office.", "इस नंबर से VPPS One में साइन इन नहीं हो सकता। ईमेल और पासवर्ड से साइन इन करें, या ऑफ़िस से पूछें।"),
};

/** Refusals after which the code on screen can never work: the card goes back to the number. */
const ENDS_CODE: ReadonlySet<CodeProblem> = new Set<CodeProblem>(["start_again", "not_staff", "off", "admission"]);
/** Refusals where the next step is email and password, so that is the big button. */
const PASSWORD_NEXT: ReadonlySet<CodeProblem> = new Set<CodeProblem>(["not_yet", "off", "unavailable", "not_staff"]);

const triesPair = (left: number) => p(`${left} ${left === 1 ? "try" : "tries"} left.`, `${left} बार और कोशिश कर सकते हैं।`);
const waitPair = (minutes: number) => p(`Wait about ${minutes} minute${minutes === 1 ? "" : "s"}.`, `लगभग ${minutes} मिनट रुकें।`);

/** The school's number on WhatsApp: the chat the code arrives in. */
const SCHOOL_CHAT = "https://wa.me/918302207823";

const PHONE_KEY = "vx:login:phone";
const PHONE_OFF_KEY = "vx:login:phone-off";
/**
 * "1": codes went to the owner only, this phone's number got none, and its
 * person signed in with a password instead. The page then opens on Password
 * here (`LoginForm`); a code sent to this phone clears it (D-608).
 */
export const NO_CODE_KEY = "vx:login:no-code";

/** Six digits standing on their own in what was copied: the code, not part of a longer number. */
const CODE_IN_TEXT = new RegExp(`(?<!\\d)\\d{${SIGN_IN_CODE_LENGTH}}(?!\\d)`);

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
    // Private windows and blocked storage: nothing is remembered.
  }
}

const noSubscribe = () => () => undefined;

const initialCodeState: CodeActionState = { status: "idle", problem: null, message: null, masked: null, resendAt: null, waitMinutes: null, triesLeft: null, sends: 0 };

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

/** Seconds until `at`, ticking once a second; 0 once it has passed. */
function useCountdown(at: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [at]);
  return at ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

function Problem({ state, language, id }: { state: CodeActionState; language: Language; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = state.problem;
  useEffect(() => {
    if (shown) ref.current?.focus();
  }, [shown, state]);
  if (!shown) return null;
  const pair: Pair | null = shown === "admission" ? (state.message ? { en: state.message.en, hi: state.message.hi } : null) : PROBLEM[shown];
  if (!pair) return null;
  const extra = shown === "wrong" && state.triesLeft !== null ? triesPair(state.triesLeft) : shown === "limited" && state.waitMinutes ? waitPair(state.waitMinutes) : null;
  return (
    <div id={id} ref={ref} tabIndex={-1} role="alert" className="fadein" style={{ ...noteStyle, background: "var(--bads)", color: "var(--bad)", outline: "none" }}>
      <TriangleAlert size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{lead(pair, language)}</span>
        {extra ? <span style={{ fontSize: 13 }}>{lead(extra, language)}</span> : null}
        {under(pair, language) ? <span style={{ fontSize: 12 }}>{under(pair, language)}</span> : null}
        {extra && under(extra, language) ? <span style={{ fontSize: 12 }}>{under(extra, language)}</span> : null}
      </span>
    </div>
  );
}

/**
 * With the phone's keyboard up, keep the step's big button in sight above it
 * (12 Nov: on a Galaxy M32 the keyboard covered Send code and Sign in, and the
 * page gave no sign there was anything below the box). The keyboard only
 * shrinks the visual viewport, so this listens there, and only while a box in
 * this card has focus.
 */
function useButtonAboveKeyboard(area: RefObject<HTMLElement | null>, button: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let last = viewport.height;
    let timer = 0;
    const reveal = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement) || !area.current?.contains(active)) return;
      button.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    const later = (wait: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reveal, wait);
    };
    const onResize = () => {
      if (viewport.height < last - 80) later(120);
      last = viewport.height;
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLInputElement && area.current?.contains(event.target)) later(320);
    };
    viewport.addEventListener("resize", onResize);
    document.addEventListener("focusin", onFocus);
    return () => {
      viewport.removeEventListener("resize", onResize);
      document.removeEventListener("focusin", onFocus);
      window.clearTimeout(timer);
    };
  }, [area, button]);
}

/**
 * A finger on a button while the keyboard is up must not close the keyboard
 * first. On a Galaxy M32 (BrowserStack, 12 Nov) the first tap on Send code,
 * and on Change, only closed the keyboard: the tap moved focus off the box,
 * the keyboard went, the page dropped back by about 200px and the button was
 * no longer under the finger, so nothing was sent until a second tap. Keeping
 * the box focused through the tap keeps the page still; the step that follows
 * moves focus itself. The password eye does the same (login-form.tsx). Every
 * kind of pointer, not only a finger: BrowserStack's taps arrive as a mouse
 * press and a separate release, and the page moved between the two.
 */
function keepTypingThroughTap(event: ReactPointerEvent<HTMLElement>) {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || !event.currentTarget.contains(active)) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest("input, textarea, select") || !target.closest("button, a")) return;
  event.preventDefault();
}

/**
 * The code goes in by itself (D-608, the owner's ask 14 Nov). WhatsApp's own
 * one-tap and zero-tap fill only reach an Android *app*, and the browser's
 * code fill (WebOTP, iPhone's "From Messages") only reads SMS, so for a web
 * page the code's way in is the clipboard: WhatsApp's Copy code button, then
 * this page reading what was copied as the person comes back to it.
 *
 * A page may read the clipboard unasked only where the browser already
 * allows it (Chrome and Edge, once the person has said Allow; the first Paste
 * code tap asks). There it reads on coming back — when the page is shown
 * again or the window takes focus — and a fresh six-digit code is typed in,
 * which signs in. It never asks unprompted: where reading would mean a
 * prompt, or is not offered at all (Safari, Firefox), it only says the person
 * is back, and Paste code lights up as the next step.
 *
 * What was on the clipboard when the code step opened is never used: that is
 * an old code, never this one. Nor is a code it already tried.
 */
function useCodeFromClipboard(active: boolean, round: number, fill: (code: string) => void): { auto: boolean; back: boolean } {
  const [auto, setAuto] = useState(false);
  const [back, setBack] = useState(false);
  const fillRef = useRef(fill);
  useEffect(() => {
    fillRef.current = fill;
  });
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let status: PermissionStatus | null = null;
    let baseline: string | null = null;
    const tried = new Set<string>();
    const timers: number[] = [];
    const allowed = () => status?.state === "granted";
    const copiedCode = async (): Promise<string | null> => {
      try {
        return (await navigator.clipboard.readText()).match(CODE_IN_TEXT)?.[0] ?? null;
      } catch {
        return null;
      }
    };
    const look = async () => {
      if (stopped || !allowed() || !document.hasFocus()) return;
      const found = await copiedCode();
      if (stopped || !found || found === baseline || tried.has(found)) return;
      tried.add(found);
      fillRef.current(found);
    };
    const onBack = () => {
      if (stopped || document.visibilityState !== "visible") return;
      setBack(true);
      // Coming back from another app the page is shown before it has focus,
      // and a read before focus is refused: look again a moment later.
      for (const wait of [0, 400, 1200]) timers.push(window.setTimeout(() => void look(), wait));
    };
    const onChange = () => {
      if (!stopped) setAuto(allowed());
    };
    void (async () => {
      try {
        status = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
      } catch {
        status = null;
      }
      if (stopped) return;
      status?.addEventListener("change", onChange);
      setAuto(allowed());
      if (allowed() && document.hasFocus()) baseline = await copiedCode();
    })();
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      stopped = true;
      status?.removeEventListener("change", onChange);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [active, round]);
  return { auto, back };
}

/** A tick that draws itself: the code has gone. */
function SentTick() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden style={{ flex: "none" }}>
      <circle cx="22" cy="22" r="20" style={{ fill: "var(--oks)", stroke: "var(--ok)", strokeWidth: 2, animation: "xFade .3s var(--ease) both" }} />
      <path d="M13 22.5l6 6 12-13" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 3.2, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: 30, ["--len" as string]: "30", animation: "xDraw .5s .15s var(--ease) both" }} />
    </svg>
  );
}

export function CodeSignInForm({
  language,
  next,
  notice = null,
  switcher = null,
  onUsePassword,
}: {
  language: Language;
  next: string;
  /** Why the visitor is here (`?reason=`), as the password form shows it. */
  notice?: Pair | null;
  /** WhatsApp code | Password, under the title of the number step. */
  switcher?: ReactNode;
  /** `noCode`: the server said codes are not on for this number yet. */
  onUsePassword: (noCode: boolean) => void;
}) {
  const [code, setCode] = useState("");
  // The code went in by itself (`useCodeFromClipboard`), so Sign in says it found it.
  const [filled, setFilled] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const verifyForm = useRef<HTMLFormElement>(null);
  // Whichever step is showing: its card, and the one button that finishes it.
  const stepRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<HTMLButtonElement>(null);
  useButtonAboveKeyboard(stepRef, finishRef);

  // A new code went: a short "done" buzz and chime, the box cleared and ready.
  // A refusal: the error cue, and a wrong code cleared for the next try.
  const [sent, requestAction, requesting] = useActionState<CodeActionState, FormData>(async (previous, data) => {
    const answer = await requestCodeAction(previous, data);
    if (answer.status === "sent" && answer.sends !== previous.sends) {
      setCode("");
      writeStore(NO_CODE_KEY, null);
      cue("success");
      window.setTimeout(() => codeRef.current?.focus(), 350);
    } else if (answer.problem) {
      cue("error");
    }
    return answer;
  }, initialCodeState);
  const [checked, verifyAction, verifying] = useActionState<CodeActionState, FormData>(async (previous, data) => {
    const answer = await verifyCodeAction(previous, data);
    if (answer.problem) {
      setFilled(false);
      cue(answer.problem === "type_code" ? "warn" : "error");
      if (answer.problem === "wrong") setCode("");
    }
    return answer;
  }, initialCodeState);
  useEffect(() => primeFeedback(), []);

  const storedPhone = useSyncExternalStore(noSubscribe, () => readStore(PHONE_KEY), () => "");
  const storedOff = useSyncExternalStore(noSubscribe, () => readStore(PHONE_OFF_KEY) === "1", () => false);
  const [typedPhone, setTypedPhone] = useState<string | null>(null);
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
  const phone = typedPhone ?? storedPhone;
  const remember = rememberChoice ?? !storedOff;
  const phoneKey = signInPhoneKey(phone);

  // Which step the card is on. The code step once a code has gone (a "wait"
  // for a second code keeps it: the first one still works), until the person
  // changes the number or the server says this code is finished with.
  const [changing, setChanging] = useState<number>(-1);
  const finished = checked.problem !== null && ENDS_CODE.has(checked.problem) ? checked.sends : -1;
  const onCodeStep =
    sent.sends > 0 &&
    changing !== sent.sends &&
    finished !== sent.sends &&
    (sent.status === "sent" || sent.problem === "limited" || sent.problem === "busy");

  const countdown = useCountdown(onCodeStep ? sent.resendAt : null);

  const keepPhone = () => {
    writeStore(PHONE_OFF_KEY, remember ? null : "1");
    writeStore(PHONE_KEY, remember && phoneKey ? phoneKey : null);
  };

  const typeCode = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH);
    setCode(digits);
    // Six digits is the whole code: sign in without another tap.
    if (signInCodeIn(digits) && digits !== code && !verifying) window.setTimeout(() => verifyForm.current?.requestSubmit(), 120);
  };

  // Back from WhatsApp with the code copied: in it goes, and sign-in starts.
  const { auto, back } = useCodeFromClipboard(onCodeStep, sent.sends, (found) => {
    if (code !== "" || verifying) return;
    setFilled(true);
    cue("tap");
    typeCode(found);
  });

  const pasteCode = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const found = text.match(CODE_IN_TEXT)?.[0];
      if (found) {
        cue("tap");
        typeCode(found);
        return;
      }
    } catch {
      // The browser said no to reading the clipboard: the box is the way.
    }
    codeRef.current?.focus();
  };

  if (!onCodeStep) {
    const shown = finished === sent.sends && sent.sends > 0 && sent.status === "sent" ? checked : sent;
    const passwordNext = shown.problem !== null && PASSWORD_NEXT.has(shown.problem);
    return (
      <div ref={stepRef} onPointerDown={keepTypingThroughTap} className="fadein lg-code" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form action={requestAction} onSubmit={keepPhone} style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-busy={requesting || undefined}>
        <input type="hidden" name="language" value={language === "en" ? "en" : "hi"} />
        <h1 id="login-heading" className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.15 }}>{lead(T.title, language)}</h1>
        {switcher}
        <span style={{ fontSize: 13, color: "var(--mut)", marginTop: switcher ? -4 : -12 }}><Two pair={T.welcome} language={language} small /></span>

        {notice && !sent.problem ? (
          <div role="status" style={{ ...noteStyle, background: "var(--warns)", color: "var(--warnfg)" }}>
            <Info size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} />
            <span style={{ minWidth: 0 }}><Two pair={notice} language={language} /></span>
          </div>
        ) : null}

        <label htmlFor="phone" className="field">
          <span><Two pair={T.phone} language={language} small /></span>
          <span style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
            <span aria-hidden className="inp" style={{ flex: "none", width: "auto", display: "flex", alignItems: "center", padding: "0 12px", fontSize: 16, fontWeight: 600, color: "var(--mut)" }}>+91</span>
            <input
              id="phone"
              name="phone"
              type="tel"
              className={`inp${sent.problem === "bad_number" ? " err" : ""}`}
              value={phone}
              onChange={(event) => setTypedPhone(event.target.value)}
              required
              autoComplete="tel-national"
              inputMode="numeric"
              maxLength={16}
              placeholder="98765 43210"
              aria-describedby={sent.problem ? "code-request-error" : "phone-hint"}
              aria-invalid={sent.problem === "bad_number" || undefined}
              style={{ fontSize: 20, letterSpacing: "0.04em", flex: 1, minWidth: 0 }}
            />
          </span>
          <span id="phone-hint" style={{ fontSize: 12, color: "var(--mut)" }}>
            <Two pair={T.phoneHint} language={language} small />
          </span>
        </label>

        <Problem state={shown} language={language} id="code-request-error" />

        {passwordNext ? (
          <button type="button" className="tap btn pri fadein" onClick={() => onUsePassword(shown.problem === "not_yet")} style={{ height: 56, fontSize: 17, borderRadius: 14 }}>
            <KeyRound size={20} aria-hidden />
            {lead(T.usePassword, language)}
          </button>
        ) : null}

        <button ref={finishRef} type="submit" className={`tap btn ${passwordNext ? "sec" : "pri"}`} disabled={requesting} style={{ height: passwordNext ? 48 : 56, fontSize: passwordNext ? 15 : 17, borderRadius: 14 }}>
          {requesting ? <RefreshCw size={20} className="spin" aria-hidden /> : <MessageCircle size={22} aria-hidden />}
          {lead(requesting ? T.sending : T.send, language)}
        </button>
      </form>

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
      </div>
    );
  }

  const masked = sent.masked ?? (phoneKey ? maskSignInPhone(phoneKey) : "");
  // Back from WhatsApp, the box still empty, and the page may not read the
  // clipboard by itself: Paste code becomes the big next step.
  const nudge = back && code === "" && !verifying;
  // One screen on a phone, keyboard up (12 Nov): what happened and to which
  // number, what to do, the two buttons that do it, the box, Sign in. The
  // rest waits below, and "no code?" only once a new code could be asked for.
  return (
    <div ref={stepRef} onPointerDown={keepTypingThroughTap} style={{ display: "flex", flexDirection: "column", gap: 14 }} className="rise lg-code">
      <div role="status" style={{ ...noteStyle, alignItems: "center", gap: 12, padding: "10px 6px 10px 12px", background: "var(--oks)", color: "var(--fg)" }}>
        <SentTick key={sent.sends} />
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 1, flex: 1 }}>
          <h1 id="login-heading" style={{ margin: 0, fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>{lead(T.sentTitle, language)}</h1>
          <span style={{ fontSize: 14 }}>
            {lead(T.sentTo, language)} <span style={{ fontWeight: 650, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{masked}</span>
          </span>
        </span>
        <button type="button" className="tap btn ghost" onClick={() => setChanging(sent.sends)} aria-label={lead(T.change, language)} style={{ flex: "none", height: 44, padding: "0 10px", fontSize: 14, color: "var(--accfg)" }}>
          {lead(T.changeShort, language)}
        </button>
      </div>

      <span id="code-paste-hint" style={{ fontSize: 13, color: "var(--mut)", lineHeight: 1.45 }}>
        <Two pair={auto ? T.sentBodyAuto : T.sentBody} language={language} small />
      </span>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <a href={SCHOOL_CHAT} target="_blank" rel="noopener noreferrer" className="tap btn sec wrap" style={{ height: 52, fontSize: 15, borderRadius: 14, textDecoration: "none", padding: "0 10px", lineHeight: 1.2 }}>
          <MessageCircle size={20} style={{ flexShrink: 0 }} aria-hidden />
          {lead(T.openWhatsApp, language)}
        </a>
        <button
          type="button"
          className={`tap btn ${nudge ? "pri" : "sec"} wrap`}
          onClick={pasteCode}
          disabled={verifying}
          style={{ height: 52, fontSize: 15, borderRadius: 14, padding: "0 10px", lineHeight: 1.2, color: nudge ? undefined : "var(--accfg)", animation: nudge ? "xTick .45s var(--spring) both" : undefined }}
        >
          <ClipboardPaste size={20} style={{ flexShrink: 0 }} aria-hidden />
          {lead(T.paste, language)}
        </button>
      </div>

      <form ref={verifyForm} action={verifyAction} style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-busy={verifying || undefined}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="round" value={sent.sends} />
        <label htmlFor="code" className="field">
          <span><Two pair={T.code} language={language} small /></span>
          <input
            id="code"
            ref={codeRef}
            name="code"
            className={`inp${checked.problem === "wrong" || checked.problem === "type_code" ? " err" : ""}`}
            value={code}
            onChange={(event) => typeCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern={`\\d{${SIGN_IN_CODE_LENGTH}}`}
            maxLength={SIGN_IN_CODE_LENGTH + 2}
            placeholder={"•".repeat(SIGN_IN_CODE_LENGTH)}
            aria-describedby={checked.problem ? "code-verify-error" : "code-paste-hint"}
            aria-invalid={checked.problem === "wrong" || undefined}
            readOnly={verifying}
            style={{ fontSize: 28, fontWeight: 650, letterSpacing: "0.5em", textAlign: "center", fontVariantNumeric: "tabular-nums", height: 64 }}
          />
        </label>

        <Problem state={checked} language={language} id="code-verify-error" />

        <button ref={finishRef} type="submit" className="tap btn pri" disabled={verifying} style={{ height: 56, fontSize: 17, borderRadius: 14 }}>
          {verifying ? <RefreshCw size={20} className="spin" aria-hidden /> : <ArrowRight size={22} aria-hidden />}
          {lead(verifying ? (filled ? T.found : T.checking) : T.signIn, language)}
        </button>
      </form>

      <Problem state={sent} language={language} id="code-resend-error" />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <form action={requestAction} style={{ display: "contents" }}>
          <input type="hidden" name="phone" value={phoneKey ?? ""} />
          <input type="hidden" name="language" value={language === "en" ? "en" : "hi"} />
          <button type="submit" className="tap btn sec wrap" disabled={countdown > 0 || requesting} aria-label={lead(T.again, language)} style={{ height: 48, fontSize: 14, borderRadius: 14, padding: "0 8px", lineHeight: 1.2 }}>
            <RefreshCw size={18} className={requesting ? "spin" : undefined} style={{ flexShrink: 0 }} aria-hidden />
            {countdown > 0 ? `${lead(T.againShort, language)} (${countdown}${lead(T.seconds, language)})` : lead(T.againShort, language)}
          </button>
        </form>
        <button type="button" className="tap btn sec wrap" onClick={() => onUsePassword(false)} style={{ height: 48, fontSize: 14, borderRadius: 14, padding: "0 8px", lineHeight: 1.2 }}>
          <KeyRound size={18} style={{ flexShrink: 0 }} aria-hidden />
          {lead(T.usePasswordShort, language)}
        </button>
      </div>

      {countdown === 0 ? (
        <div className="fadein" style={{ ...noteStyle, background: "var(--infos)", color: "var(--info)", fontSize: 13 }}>
          <span><Two pair={T.noCode} language={language} small /></span>
        </div>
      ) : null}
    </div>
  );
}
