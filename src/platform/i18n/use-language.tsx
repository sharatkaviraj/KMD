"use client";

import { createContext, useContext } from "react";

import {
  flat,
  primary,
  secondary,
  SIGNED_OUT_LANGUAGE,
  type Language,
  type Localized,
} from "@/platform/i18n/language";

/**
 * The reader's language, for Client Components.
 *
 * Server Components read it from `getCurrentStaff()` directly; a client
 * component cannot, so the shell puts it in context once and everything below
 * reads it from there. One provider, no prop threading through five layers of
 * form.
 */
const LanguageContext = createContext<Language>(SIGNED_OUT_LANGUAGE);

export function LanguageProvider({
  language,
  children,
}: {
  language: Language;
  children: React.ReactNode;
}) {
  return (
    <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

/**
 * The hook most components actually want: the reader's language already bound
 * to the three ways of using it.
 */
export function useText() {
  const language = useLanguage();

  return {
    language,
    /** The line this reader leads with. */
    lead: (text: Localized) => primary(text, language),
    /** The line beneath it, or null when they asked for one language. */
    under: (text: Localized) => secondary(text, language),
    /** Both on one line, for a title or an aria-label. */
    flat: (text: Localized) => flat(text, language),
  };
}
