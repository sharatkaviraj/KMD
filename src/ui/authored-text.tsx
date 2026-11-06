import * as m from "@/messages/pairs";
import { readAuthored, type Authored } from "@/platform/i18n/authored";
import { flat, t, type Language, type Localized } from "@/platform/i18n/language";
import { cn } from "@/platform/utils";

/**
 * Text a member of staff typed, rendered for whoever is reading it.
 *
 * Every one of the four screens that showed a request's title did
 * `language === "en" ? titleEn : titleHi` — which renders **nothing** when the
 * office typed only the other half. That was harmless while both halves were
 * required and became a blank title the moment they stopped being (B-05,
 * B-14).
 *
 * So there is one component. It falls back, and it says that it did: a Hindi
 * reader shown an English title is not looking at a bug, but they should be
 * able to tell at a glance rather than wonder why the app switched languages.
 */

export function AuthoredText({
  value,
  language,
  className,
  fallback,
}: {
  value: Authored;
  language: Language;
  className?: string;
  /** Shown when nothing was typed at all. Defaults to an em dash. */
  fallback?: Localized;
}) {
  const read = readAuthored(value, language);

  if (!read) {
    return (
      <span className={cn("text-subtle-foreground", className)}>
        {fallback ? flat(fallback, language) : "—"}
      </span>
    );
  }

  return (
    <span className={className} lang={read.language === "both" ? undefined : read.language}>
      {read.text}
      {read.fellBack ? (
        <span className="ml-1.5 text-[0.85em] font-normal text-subtle-foreground">
          {flat(read.language === "en" ? m.authoredInEnglish : m.authoredInHindi, language)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The same value as a `Localized`, for the places that take one — a page
 * title, a `<title>` tag, an aria-label.
 *
 * Both halves are filled with the fallback where one is missing, so
 * `primary()` can never produce an empty string. `secondary()` returns null
 * when the two are identical, which is what should happen when only one half
 * was typed: a bilingual reader sees it once rather than twice.
 */
export function authoredTitle(
  value: Authored,
  fallback: Localized,
): Localized {
  const hi = value.hi?.trim() ?? "";
  const en = value.en?.trim() ?? "";

  if (!hi && !en) return fallback;
  return t(hi || en, en || hi);
}

/** The plain string for a message body, in the sender's own language. */
export function authoredPlain(value: Authored, language: Language): string {
  return readAuthored(value, language)?.text ?? "";
}
