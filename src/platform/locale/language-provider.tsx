"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { NextIntlClientProvider } from "next-intl";

import { toast } from "@/ui/primitives/toast";
import { type AppLocale, supportedLocales } from "@/platform/i18n/locales";
import { setLocaleAction } from "@/platform/locale/actions";
import { shellMessages } from "@/platform/i18n/shell-messages";

type MessageCatalog = Record<string, unknown>;

export type LanguageCatalogs = Partial<Record<AppLocale, MessageCatalog>>;

interface LanguageContextValue {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
  isSwitching: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLang must be used inside <LanguageProvider>");
  }
  return ctx;
}

interface LanguageProviderProps {
  initialLocale: AppLocale;
  // Only the active locale's catalog is required up front. Other catalogs
  // are dynamic-imported on demand the first time the user switches to them
  // (then memoized in component state). This keeps the initial JS payload
  // ~2/3 smaller per page load.
  catalogs: LanguageCatalogs;
  children: React.ReactNode;
  shellOnly?: boolean;
}

async function importCatalog(locale: AppLocale): Promise<MessageCatalog> {
  switch (locale) {
    case "en":
      return (await import("@/messages/en.json")).default as MessageCatalog;
    case "hi":
      return (await import("@/messages/hi.json")).default as MessageCatalog;
    case "hi-en":
      return (await import("@/messages/hi-en.json")).default as MessageCatalog;
  }
}

export function LanguageProvider({
  initialLocale,
  catalogs,
  children,
  shellOnly = false,
}: LanguageProviderProps) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);
  const [isSwitching, startTransition] = useTransition();
  const [loadedCatalogs, setLoadedCatalogs] =
    useState<LanguageCatalogs>(catalogs);

  /*
   * The server's language wins whenever the server says it again.
   *
   * This provider lives in the root layout, which a soft navigation never
   * remounts: it only hands it new props. Signing in (a server action that
   * redirects) and the EN | हि switch (`router.refresh()`) both do exactly
   * that, with the account's language, and state seeded from the first props
   * ignored them. So the year picker, the session card and every other shell
   * label kept the signed-out English until a reload, while the One screens
   * around them were already bilingual (BrowserStack, 7 Nov 2026).
   *
   * `catalogs` gets a new identity only when the root layout is rendered
   * again on the server, so an ordinary navigation does not reset a choice
   * made on this page.
   */
  const [fromServer, setFromServer] = useState(catalogs);
  if (fromServer !== catalogs) {
    setFromServer(catalogs);
    setLocaleState(initialLocale);
    setLoadedCatalogs(catalogs);
  }

  // `<html lang>` follows too. The root layout sets it while the page is
  // parsed, and after that nothing did: React leaves an attribute alone when
  // its prop is unchanged, and the inline script only ever runs once.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: AppLocale) => {
      if (next === locale) return;
      if (!(supportedLocales as readonly string[]).includes(next)) return;
      const previous = locale;
      setLocaleState(next);
      startTransition(async () => {
        try {
          await setLocaleAction(next);
        } catch {
          // The language flipped locally but never persisted, so it would
          // silently revert on the next page load. Put it back and say so
          // rather than let the user discover it later.
          setLocaleState(previous);
          toast({
            title: "Language not saved",
            description: "The app language could not be changed. Please try again.",
            tone: "danger",
          });
        }
      });
    },
    [locale],
  );

  useEffect(() => {
    if (loadedCatalogs[locale]) return;
    let cancelled = false;
    void importCatalog(locale).then((catalog) => {
      if (cancelled) return;
      setLoadedCatalogs((prev) => ({ ...prev, [locale]: shellOnly ? shellMessages(catalog) : catalog }));
    });
    return () => {
      cancelled = true;
    };
  }, [locale, loadedCatalogs, shellOnly]);

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, isSwitching }),
    [locale, setLocale, isSwitching],
  );

  const activeMessages =
    loadedCatalogs[locale] ?? loadedCatalogs[initialLocale] ?? {};

  return (
    <LanguageContext.Provider value={value}>
      <NextIntlClientProvider
        locale={locale}
        messages={activeMessages}
        timeZone="Asia/Kolkata"
      >
        {children}
      </NextIntlClientProvider>
    </LanguageContext.Provider>
  );
}
