import * as React from "react";

import {
  primary,
  secondary,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import { cn } from "@/platform/utils";

/**
 * One localised string, rendered for one reader.
 *
 * A Server Component on purpose: the language comes from the staff profile the
 * page already read, so there is nothing to hydrate. Client components take
 * the same props and pass `language` from `useLanguage()`.
 *
 * `both` renders the English line smaller and beneath, which is the shape the
 * school already reads on paper. A reader who chose one language gets exactly
 * one line and no leftover separator.
 */
export function Text({
  value,
  language,
  className,
  secondaryClassName,
  as: Tag = "span",
}: {
  value: Localized;
  language: Language;
  className?: string;
  secondaryClassName?: string;
  as?: "span" | "p" | "div";
}) {
  const under = secondary(value, language);

  if (!under) {
    return <Tag className={className}>{primary(value, language)}</Tag>;
  }

  return (
    <Tag className={className}>
      {primary(value, language)}
      <span
        className={cn(
          "ml-2 text-[0.85em] font-normal opacity-70",
          secondaryClassName,
        )}
      >
        {under}
      </span>
    </Tag>
  );
}

/**
 * The same pair stacked rather than inline — for a heading or a notice, where
 * the second language wants its own line instead of trailing the first.
 */
export function TextBlock({
  value,
  language,
  className,
  secondaryClassName,
}: {
  value: Localized;
  language: Language;
  className?: string;
  secondaryClassName?: string;
}) {
  const under = secondary(value, language);

  return (
    <>
      <span className={className}>{primary(value, language)}</span>
      {under ? (
        <span className={cn("block text-[0.85em] opacity-75", secondaryClassName)}>
          {under}
        </span>
      ) : null}
    </>
  );
}
