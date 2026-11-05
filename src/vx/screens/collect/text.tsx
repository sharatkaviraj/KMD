"use client";

import { flat, primary, secondary, type Language, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { dayMonthP, rupees, weekdayP } from "@/vx/format";

/** A pair with its `{a}`/`{n}`/`{d}`/`{name}` holes filled in, in both halves. */
export function fill(pair: Localized, vars: Partial<Record<"a" | "n" | "d" | "name", string | number | Localized>>): Localized {
  const put = (text: string, half: "hi" | "en") =>
    text.replace(/\{(a|n|d|name)\}/g, (_, key: "a" | "n" | "d" | "name") => {
      const v = vars[key];
      if (v === undefined) return "";
      return typeof v === "object" ? v[half] : String(v);
    });
  return { hi: put(pair.hi, "hi"), en: put(pair.en, "en") };
}

export const money = (n: number) => rupees(Math.round(n));

/** "5 Nov" / "5 नव". */
export const dayMonth = (iso: string): Localized => {
  const p = dayMonthP(iso);
  return { hi: p.hi, en: p.en };
};
export const weekday = (iso: string): Localized => {
  const p = weekdayP(iso);
  return { hi: p.hi, en: p.en };
};

export function useCx() {
  const language = useLanguage();
  return {
    language,
    /** The reader's main line. */
    p: (pair: Localized) => primary(pair, language),
    /** The second line for a bilingual reader, else null. */
    s: (pair: Localized) => secondary(pair, language),
    /** One line, for attributes. */
    f: (pair: Localized) => flat(pair, language),
  };
}

/** A label in the reader's language; a bilingual reader gets the second language small underneath. */
export function Bi({ text, inline = false }: { text: Localized; inline?: boolean }) {
  const language = useLanguage();
  const second = secondary(text, language);
  return (
    <>
      {primary(text, language)}
      {second ? <span className={inline ? "cx-hin" : "cx-hi"}>{second}</span> : null}
    </>
  );
}

export function flatIn(pair: Localized, language: Language) {
  return flat(pair, language);
}
