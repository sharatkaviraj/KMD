/**
 * What leaves the school, and what does not (D-324).
 *
 * The helper sends Claude the words it needs to write a draft and nothing
 * that identifies a family: phone numbers, Aadhaar-like numbers and email
 * addresses become placeholders, and so does every name the screen knows is
 * in the text (the child a note is about, the people on a form). The model is
 * told to keep the placeholders exactly as written, and they are put back on
 * the way in — so the teacher sees "Aarav was quiet today", Claude saw
 * "[[N1]] was quiet today".
 *
 * Names the screen does not know about (a sibling mentioned in passing) are
 * not caught. That is why the strongest rule is upstream: the features that
 * write about many children at once (remarks, results) send no names at all,
 * only `C1`, `C2` and numbers.
 */

export type Masked = {
  text: string;
  /** Put the originals back into a string the model returned. */
  restore: (value: string) => string;
};

const PHONE = /(?:\+?91[\s-]?)?(?<![\d])[6-9]\d{4}[\s-]?\d{5}(?![\d])/g;
const AADHAAR = /(?<![\d])\d{4}[\s-]?\d{4}[\s-]?\d{4}(?![\d])/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Letters and combining marks, so a Devanagari name is a whole word too. */
const LETTER = "[\\p{L}\\p{M}]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The whole name first, then each part of three letters or more, longest
 * first — so "Aarav Sharma" is one placeholder rather than two, and "Ram"
 * never eats the start of "Ramesh".
 */
function nameVariants(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (name.length < 3) continue;
    out.add(name);
    for (const part of name.split(" ")) if ([...part].length >= 3) out.add(part);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function maskPersonal(text: string, names: readonly string[] = []): Masked {
  const tokens = new Map<string, string>();
  let n = 0;
  let id = 0;
  let masked = text;

  const swap = (pattern: RegExp, prefix: string) => {
    const seen = new Map<string, string>();
    masked = masked.replace(pattern, (match) => {
      const key = match.toLowerCase();
      const existing = seen.get(key);
      if (existing) return existing;
      const token = `[[${prefix}${prefix === "N" ? ++n : ++id}]]`;
      seen.set(key, token);
      tokens.set(token, match);
      return token;
    });
  };

  swap(EMAIL, "E");
  swap(PHONE, "P");
  swap(AADHAAR, "A");
  for (const variant of nameVariants(names)) {
    swap(new RegExp(`(?<!${LETTER})${escapeRegExp(variant)}(?!${LETTER})`, "giu"), "N");
  }

  const restore = (value: string) =>
    tokens.size === 0 ? value : value.replace(/\[\[[A-Z]\d+\]\]/g, (token) => tokens.get(token) ?? token);

  return { text: masked, restore };
}

/** Every string inside a parsed answer, restored; numbers and booleans untouched. */
export function restoreDeep<T>(value: T, restore: (value: string) => string): T {
  if (typeof value === "string") return restore(value) as T;
  if (Array.isArray(value)) return value.map((item) => restoreDeep(item, restore)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, restoreDeep(item, restore)]),
    ) as T;
  }
  return value;
}

/** A placeholder the model invented or mangled, left in a draft, is not shown to a parent. */
export function hasStrayToken(value: string): boolean {
  return /\[\[[A-Z]\d+\]\]/.test(value);
}
