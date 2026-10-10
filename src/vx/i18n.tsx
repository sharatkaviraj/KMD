"use client";

import { useLanguage } from "@/platform/i18n/use-language";

import { lead, under, type Pair } from "@/vx/text";

export type { Pair };

export function useVx() {
  const language = useLanguage();
  return {
    language,
    tx: (pair: Pair | string) => lead(pair, language),
    sub: (pair: Pair | string) => under(pair, language),
  };
}

/** One line in the reader's language. */
export function Tx({ en, hi }: Pair) {
  const language = useLanguage();
  return <>{lead({ en, hi }, language)}</>;
}

/** A key label: the lead line, and the other language small underneath. */
export function Bi({
  en,
  hi,
  subStyle,
  block = true,
}: Pair & { subStyle?: React.CSSProperties; block?: boolean }) {
  const language = useLanguage();
  const second = under({ en, hi }, language);
  return (
    <span style={{ display: block ? "flex" : "inline-flex", flexDirection: "column", minWidth: 0 }}>
      <span>{lead({ en, hi }, language)}</span>
      {second ? (
        <span lang={language === "hi" ? "en" : "hi"} style={{ fontSize: "0.78em", fontWeight: 500, color: "var(--mut)", ...subStyle }}>
          {second}
        </span>
      ) : null}
    </span>
  );
}
