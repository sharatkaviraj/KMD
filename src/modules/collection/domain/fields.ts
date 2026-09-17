import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * The field registry, and the one validator both sides run.
 *
 * Ported from `sampark/src/lib/fields.ts` and `field-keys.ts`. The same code
 * runs in the browser for instant feedback and on the server because the
 * browser is never trusted — so this module imports no database and no React.
 *
 * The principle it exists for: **a nine-digit phone number must be impossible
 * to submit**, not something the office cleans up afterwards. By the time an
 * answer reaches the review queue it is already the right shape, and the only
 * question left for a person is whether it is the right answer.
 *
 * ## A repeated phone number is not an error, and must never become one
 *
 * Siblings share a parent's phone. In the school Sampark was built for, 134
 * numbers were held by more than one child and 133 of those spanned more than
 * one class. A uniqueness check would reject the correct answer and teach a
 * teacher that the screen is wrong about her own class. The review queue shows
 * the office a neutral "also on N other children" line; the teacher sees
 * nothing at all.
 */

export const fieldInputs = [
  "text",
  "tel",
  "number",
  "date",
  "boolean",
  "select",
] as const;

export type FieldInput = (typeof fieldInputs)[number];

/**
 * `confirm` shows what the school already holds and asks whether it is right.
 * `collect` shows an empty box.
 *
 * The difference is the whole ergonomics of the thing on a phone: confirming
 * forty numbers is forty taps, typing them is forty minutes.
 */
export const fieldModes = ["confirm", "collect"] as const;
export type FieldMode = (typeof fieldModes)[number];

export const fieldInputLabels: Record<FieldInput, Localized> = {
  text: t("पाठ", "Text"),
  tel: t("फ़ोन", "Phone"),
  number: t("संख्या", "Number"),
  date: t("तिथि", "Date"),
  boolean: t("हाँ / नहीं", "Yes / no"),
  select: t("सूची में से", "From a list"),
};

export const fieldModeLabels: Record<FieldMode, Localized> = {
  confirm: t("पुष्टि करें", "Confirm what we hold"),
  collect: t("नया भरें", "Collect a new answer"),
};

export type CollectionField = {
  id: string;
  key: string;
  labelHi: string;
  labelEn: string;
  inputType: FieldInput;
  mode: FieldMode;
  exactLen: number | null;
  pattern: string | null;
  maxValue: number | null;
  options: string[] | null;
  /**
   * Which fee-app column answers the same question, when one does.
   *
   * **Not a destination.** Sampark wrote master fields straight back to its own
   * `students` table; rule 2 forbids that here, because `public` belongs to the
   * fee app. So this is a *comparison*: it lets the form show a teacher what
   * the fee app currently holds, and lets the review queue say the two disagree
   * — which a person then resolves in the fee app, deliberately.
   */
  feeColumn: string | null;
  helpHi: string | null;
  helpEn: string | null;
  isActive: boolean;
  sortOrder: number;
};

export function fieldLabel(field: CollectionField): Localized {
  return t(field.labelHi, field.labelEn);
}

export function fieldHelp(field: CollectionField): Localized | null {
  if (!field.helpHi && !field.helpEn) return null;
  return t(field.helpHi ?? field.helpEn ?? "", field.helpEn ?? field.helpHi ?? "");
}

/* ------------------------------------------------------------ validation */

export type ValidationResult =
  | { ok: true; value: string | null }
  | { ok: false; error: Localized };

const ok = (value: string | null): ValidationResult => ({ ok: true, value });
const fail = (hi: string, en: string): ValidationResult => ({
  ok: false,
  error: t(hi, en),
});

/** Indian mobile numbers are ten digits. The country code is added at send. */
export const PHONE_LENGTH = 10;

/**
 * What this number really is.
 *
 * A phone number arrives in this school as "+91 98765 43210", "098765 43210",
 * "98765-43210" and "9876543210", from a paper register, a WhatsApp forward or
 * a fee-app export, and every one of those is the same number.
 *
 * Only strips a leading 91 or 0 when there are more digits than a number can
 * hold: a bare ten-digit number starting 91 is plausible, and the length is the
 * only thing that says a prefix is a prefix.
 */
export function normalisePhone(raw: string | null | undefined): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length > PHONE_LENGTH && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > PHONE_LENGTH && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, PHONE_LENGTH);
}

/** The age band a school roll can plausibly hold. */
export const MIN_AGE_YEARS = 2;
export const MAX_AGE_YEARS = 22;

/**
 * Validate one raw value against its field definition.
 *
 * **Blank is always allowed, and always means "no change" — never "erase".** A
 * teacher who skips a child has not answered for them, and a form that read a
 * skipped box as a deletion would empty a register on the first pass.
 */
export function validateField(
  field: Pick<
    CollectionField,
    "labelHi" | "labelEn" | "inputType" | "exactLen" | "pattern" | "maxValue" | "options"
  >,
  raw: string | null | undefined,
  now: Date = new Date(),
): ValidationResult {
  const value = (raw ?? "").trim();
  if (value === "") return ok(null);

  const label = field.labelEn;

  switch (field.inputType) {
    case "tel": {
      const digits = normalisePhone(value);
      const want = field.exactLen ?? PHONE_LENGTH;

      if (digits.length !== want) {
        return fail(`${want} अंक होने चाहिए`, `${label} must be exactly ${want} digits`);
      }
      // Indian mobile numbers start 6–9. A landline or a typo fails here
      // rather than being sent to a number nobody answers.
      if (want === PHONE_LENGTH && !/^[6-9]/.test(digits)) {
        return fail(
          "मोबाइल नंबर 6 से 9 के बीच से शुरू होता है",
          `${label} does not look like a mobile number`,
        );
      }
      return ok(digits);
    }

    case "number": {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return fail("केवल अंक भरें", `${label} must be a number`);
      }
      if (num < 0) {
        return fail("ऋणात्मक नहीं हो सकता", `${label} cannot be negative`);
      }
      if (field.maxValue !== null && num > field.maxValue) {
        return fail(
          `अधिकतम ${field.maxValue}`,
          `${label} cannot be more than ${field.maxValue}`,
        );
      }
      return ok(String(num));
    }

    case "date": {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return fail("तिथि सही नहीं है", `${label} is not a date`);
      }
      if (parsed.getTime() > now.getTime()) {
        return fail("भविष्य की तिथि नहीं हो सकती", `${label} cannot be in the future`);
      }

      const years =
        (now.getTime() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

      if (years < MIN_AGE_YEARS || years > MAX_AGE_YEARS) {
        return fail(
          `आयु ${MIN_AGE_YEARS} से ${MAX_AGE_YEARS} वर्ष के बीच होनी चाहिए`,
          `${label} gives an age outside ${MIN_AGE_YEARS}–${MAX_AGE_YEARS} years`,
        );
      }
      return ok(parsed.toISOString().slice(0, 10));
    }

    case "boolean": {
      // Stored canonically whatever was tapped, so a later count does not have
      // to know Hindi.
      const yes = ["yes", "y", "true", "1", "हाँ", "हां", "हा"];
      const no = ["no", "n", "false", "0", "नहीं", "नही"];
      const lower = value.toLowerCase();
      if (yes.includes(lower)) return ok("yes");
      if (no.includes(lower)) return ok("no");
      return fail("हाँ या नहीं चुनें", `${label} must be yes or no`);
    }

    case "select": {
      const allowed = field.options ?? [];
      if (allowed.length > 0 && !allowed.includes(value)) {
        return fail("सूची में से चुनें", `${label} must be one of: ${allowed.join(", ")}`);
      }
      return ok(value);
    }

    case "text":
    default: {
      if (field.exactLen && value.length !== field.exactLen) {
        return fail(
          `${field.exactLen} अक्षर होने चाहिए`,
          `${label} must be exactly ${field.exactLen} characters`,
        );
      }
      if (field.pattern) {
        let expression: RegExp;
        try {
          expression = new RegExp(field.pattern);
        } catch {
          // A pattern somebody mistyped in the registry must not lock a
          // teacher out of answering. It is a registry problem, not hers.
          return ok(value);
        }
        if (!expression.test(value)) {
          return fail("प्रारूप सही नहीं है", `${label} is not in the expected format`);
        }
      }
      return ok(value);
    }
  }
}

/* ------------------------------------------------------------- the keys */

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

export function isFieldKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/**
 * Turn "T-shirt size" into a field key.
 *
 * The key is a database identifier: submissions and student records point at
 * it and it is never renamed once anything does. So the office types a label
 * and this derives the key, rather than asking them to invent one and refusing
 * what they type.
 */
export function slugFieldKey(label: string, taken: Set<string> = new Set()): string | null {
  const body = label
    .trim()
    .toLowerCase()
    // Devanagari cannot go in a key, so a Hindi-only label produces nothing
    // here and the English one is what the key is built from.
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (body === "") return null;

  // A key has to start with a letter; a label beginning with a digit would
  // otherwise produce one that the pattern refuses.
  const base = (/^[a-z]/.test(body) ? body : `f_${body}`).slice(0, 40);
  if (!KEY_PATTERN.test(base)) return null;
  if (!taken.has(base)) return base;

  // A second "T-shirt size" is a different question — last year's and this
  // year's — so it gets its own key rather than quietly overwriting the first.
  for (let n = 2; n < 100; n += 1) {
    const suffix = `_${n}`;
    const candidate = base.slice(0, 40 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }

  return null;
}

/* ----------------------------------------------------------- the schema */

const label = (hi: string, en: string) =>
  z
    .string()
    .trim()
    .min(1, { message: encodeMessage(t(hi, en)) })
    .max(80, {
      message: encodeMessage(t("बहुत लंबा है", "That is too long")),
    });

export const fieldSchema = z.object({
  key: z
    .string()
    .trim()
    .refine(isFieldKey, {
      message: encodeMessage(
        t(
          "कुंजी में केवल छोटे अक्षर, अंक और _ चलेंगे",
          "A key is lowercase letters, digits and underscores, starting with a letter",
        ),
      ),
    }),
  labelHi: label("हिन्दी नाम भरें", "Give it a Hindi label"),
  labelEn: label("अंग्रेज़ी नाम भरें", "Give it an English label"),
  inputType: z.enum(fieldInputs),
  mode: z.enum(fieldModes),
  exactLen: z.coerce.number().int().min(1).max(200).nullable(),
  maxValue: z.coerce.number().nullable(),
  options: z.array(z.string().trim().min(1)).nullable(),
  feeColumn: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  helpHi: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  helpEn: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export type FieldInputValue = z.infer<typeof fieldSchema>;

/** Active first, in the school's own order, then by label. */
export function orderFields(fields: CollectionField[]): CollectionField[] {
  return [...fields].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.labelEn.localeCompare(b.labelEn, "en"),
  );
}

export function activeFields(fields: CollectionField[]): CollectionField[] {
  return orderFields(fields.filter((field) => field.isActive));
}
