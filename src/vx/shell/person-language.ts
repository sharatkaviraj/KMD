import type { Language } from "@/platform/i18n/language";
import { p, type Pair } from "@/vx/text";

const LANGUAGE_NAME: Record<Language, string> = { en: "English", hi: "हिंदी", both: "English + हिंदी" };

/**
 * The one language button on the "seeing One as" banner (D-544): the screens
 * are drawn in the person's language, so it offers the administrator's own
 * ("Show in English"), and once switched, the way back ("Show as Asha reads
 * it"). Null when all three agree and there is nothing to switch.
 */
export function languageSwitch(shown: Language, own: Language, mine: Language, first: string): { to: Language; label: Pair } | null {
  if (shown !== mine) {
    const name = LANGUAGE_NAME[mine];
    return { to: mine, label: p(`Show in ${name}`, `${name} में दिखाएँ`) };
  }
  if (shown !== own) return { to: own, label: p(`Show as ${first} reads it`, `${first} जैसे पढ़ते हैं वैसे दिखाएँ`) };
  return null;
}
