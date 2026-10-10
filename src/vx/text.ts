import type { Language } from "@/platform/i18n/language";

/**
 * Words on the vx screens (docs/ui/DECISIONS.md UI-6). Pure, so Server and
 * Client Components share it; the hooks are in `./i18n.tsx`.
 *
 * The design is English-first with Hindi under key labels, and an EN · हि
 * switch. Mapped onto the reader's stored language:
 *
 *   en   → English
 *   both → English, with the Hindi under key labels (the design's default look)
 *   hi   → Hindi first, with the English under key labels
 *
 * A pair without Hindi falls back to English: body copy that has not been
 * translated yet reads in English rather than blank.
 */
export type Pair = { en: string; hi?: string };

export function lead(pair: Pair | string, language: Language): string {
  if (typeof pair === "string") return pair;
  return language === "hi" && pair.hi ? pair.hi : pair.en;
}

export function under(pair: Pair | string, language: Language): string | null {
  if (typeof pair === "string" || !pair.hi || pair.hi === pair.en) return null;
  if (language === "both") return pair.hi;
  if (language === "hi") return pair.en;
  return null;
}

/** Shorthand for writing a pair: `p("Today", "आज")`. */
export function p(en: string, hi?: string): Pair {
  return hi ? { en, hi } : { en };
}
