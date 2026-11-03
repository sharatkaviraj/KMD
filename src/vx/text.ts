import type { Language } from "@/platform/i18n/language";

/**
 * Words on the vx screens (docs/ui/DECISIONS.md UI-6). Pure, so Server and
 * Client Components share it; the hooks are in `./i18n.tsx`.
 *
 * The design is English-first with Hindi under key labels, and a language
 * switch with three choices (English · हिंदी · दोनों). Mapped onto the
 * reader's stored language:
 *
 *   en   → English
 *   both → English, with the Hindi under key labels (the design's default look)
 *   hi   → Hindi only. No English line underneath: a Hindi-only teacher said
 *          she could not read half the screen (smoke 20 Oct, dev.groups[10]).
 *
 * A pair without Hindi falls back to English: body copy that has not been
 * translated yet reads in English rather than blank.
 */
export type Pair = { en: string; hi?: string };

export function lead(pair: Pair | string, language: Language): string {
  if (typeof pair === "string") return pair;
  return language === "hi" && pair.hi ? pair.hi : pair.en;
}

/** The second line under a key label: the Hindi, for a reader of both. */
export function under(pair: Pair | string, language: Language): string | null {
  if (typeof pair === "string" || !pair.hi || pair.hi === pair.en) return null;
  return language === "both" ? pair.hi : null;
}

/** Shorthand for writing a pair: `p("Today", "आज")`. */
export function p(en: string, hi?: string): Pair {
  return hi ? { en, hi } : { en };
}

/**
 * "12 of 27" as a pair. Hindi puts the whole first, "27 में से 12", so a
 * sentence must never be built as `${part} ${of} ${whole}` with a translated
 * connector. `unit` names what is counted, its Hindi in the oblique form that
 * goes before में से: `outOf(12, 27, p("children", "बच्चों"))` gives
 * "12 of 27 children" / "27 बच्चों में से 12".
 */
export function outOf(part: number | string, whole: number | string, unit?: Pair): Pair {
  if (!unit) return { en: `${part} of ${whole}`, hi: `${whole} में से ${part}` };
  return { en: `${part} of ${whole} ${unit.en}`, hi: `${whole} ${unit.hi ?? unit.en} में से ${part}` };
}

/**
 * The reader's language, with all three of its stored values (PLAN §3a). The
 * old EN | हि switch wrote only "en" or "hi", so a teacher who tried it lost
 * "both" for good (smoke 20 Oct). Drawn by `@/vx/ui/language`.
 */
export const LANGUAGE_CHOICES: readonly { value: Language; name: string; lang: "en" | "hi"; short: string; hint: Pair }[] = [
  { value: "en", name: "English", lang: "en", short: "EN", hint: p("Everything in English", "सब कुछ अंग्रेज़ी में") },
  { value: "hi", name: "हिंदी", lang: "hi", short: "हि", hint: p("Everything in Hindi", "सब कुछ हिंदी में") },
  { value: "both", name: "दोनों · Both", lang: "hi", short: "EN+हि", hint: p("English, with Hindi under the main words", "अंग्रेज़ी, और मुख्य शब्दों के नीचे हिंदी") },
];
