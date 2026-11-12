/**
 * Sign in with a WhatsApp code (D-585): the rules both the sign-in page and
 * the server keep. Pure and browser-safe: the page checks a number as it is
 * typed with the same function the server decides with.
 *
 * The rest lives in:
 *  - `supabase/migrations/*_staff_sign_in_codes.sql`: who gets a code, the
 *    limits, and the one-time check (`request_staff_sign_in_code`,
 *    `verify_staff_sign_in_code`);
 *  - `data/sign-in-codes.ts`: the code, its hash, the send through the hub;
 *  - `src/app/login/actions.ts` and `code-form.tsx`: the page.
 */

/** Six digits. Meta's copy-code button takes up to 15 characters. */
export const SIGN_IN_CODE_LENGTH = 6;

/** How long a code works, and what the template's footer says. */
export const SIGN_IN_CODE_MINUTES = 10;

/** Wrong tries before a code stops working (the SQL's `attempts < 5`). */
export const SIGN_IN_CODE_TRIES = 5;

/** Seconds between two codes to one number (the SQL's 30-second rule). */
export const SIGN_IN_RESEND_SECONDS = 30;

/** Who can get a code (`vppsone.staff_sign_in_settings.mode`). */
export type SignInMode = "off" | "owner_only" | "all_staff";

export const SIGN_IN_MODES: readonly SignInMode[] = ["off", "owner_only", "all_staff"];

export function isSignInMode(value: unknown): value is SignInMode {
  return typeof value === "string" && (SIGN_IN_MODES as readonly string[]).includes(value);
}

/** The two Meta "authentication" templates, one per language. Meta writes the words. */
export const SIGN_IN_TEMPLATE = { hi: "vpps_sign_in_code_hi_v1", en: "vpps_sign_in_code_en_v1" } as const;

export type SignInLanguage = keyof typeof SIGN_IN_TEMPLATE;

/**
 * An Indian mobile number as staff type it — `96803 83124`, `+91 96803 83124`,
 * `096803 83124`, `919680383124` — as its ten digits, or null. Anything else
 * (a landline, a foreign number, too few digits) is not a number a code can
 * go to. The SQL repeats this rule (`^(0|91)?[6-9][0-9]{9}$`).
 */
export function signInPhoneKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  return /^(0|91)?[6-9]\d{9}$/.test(digits) ? digits.slice(-10) : null;
}

/** `+91 ••••• •3124`, for the "code sent to" line. */
export function maskSignInPhone(key: string): string {
  return `+91 ••••• •${key.slice(-4)}`;
}

/** Six digits typed, pasted or read from WhatsApp, with any spaces or dashes in between. */
export function signInCodeIn(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[\s\-–—.]/g, "");
  return new RegExp(`^\\d{${SIGN_IN_CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** A fresh code from a source of random integers (`crypto.randomInt` on the server). */
export function newSignInCode(randomBelow: (max: number) => number): string {
  return String(randomBelow(10 ** SIGN_IN_CODE_LENGTH)).padStart(SIGN_IN_CODE_LENGTH, "0");
}

/** What `request_staff_sign_in_code` can answer. */
export type RequestOutcome = "bad_number" | "off" | "limited" | "busy" | "no_match" | "shared_number" | "not_allowed" | "send";

/**
 * What the page is told. Every outcome that writes a row — a code went, or
 * the number is on no record, on two, or not allowed yet — reads "sent", so
 * nobody can use the page to find out whose number is on file.
 */
export type RequestAnswer = "sent" | "bad_number" | "off" | "limited" | "busy" | "unavailable";

export function requestAnswer(outcome: string | null | undefined): RequestAnswer {
  switch (outcome) {
    case "send":
    case "no_match":
    case "shared_number":
    case "not_allowed":
      return "sent";
    case "bad_number":
    case "off":
    case "limited":
    case "busy":
      return outcome;
    default:
      return "unavailable";
  }
}

/** What `verify_staff_sign_in_code` can answer. */
export type VerifyOutcome = "ok" | "wrong" | "locked" | "expired" | "used" | "no_code" | "not_staff" | "off";

/** What the page is told after a code. "ok" signs in; the rest are an error with what to do next. */
export type VerifyAnswer = "ok" | "wrong" | "start_again" | "not_staff" | "off" | "unavailable";

export function verifyAnswer(outcome: string | null | undefined): VerifyAnswer {
  switch (outcome) {
    case "ok":
    case "wrong":
    case "not_staff":
    case "off":
      return outcome;
    case "locked":
    case "expired":
    case "used":
    case "no_code":
      return "start_again";
    default:
      return "unavailable";
  }
}

/** The template a code goes in: the page's own language; Hindi for a both-languages reader. */
export function signInTemplateLanguage(pageLanguage: string | null | undefined): SignInLanguage {
  return pageLanguage === "en" ? "en" : "hi";
}
