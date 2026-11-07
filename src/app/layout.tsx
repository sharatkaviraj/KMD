import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { shellMessages } from "@/platform/i18n/shell-messages";
import { KeyboardOffsetProvider } from "@/ui/system/keyboard-offset-provider";
import { ServiceWorkerRegistration } from "@/ui/system/service-worker-registration";
import { schoolBrand } from "@/platform/config/school-brand";

import { LOCALE_COOKIE_NAME, isSupportedLocale, type AppLocale } from "@/platform/i18n/locales";
import { BootSplash } from "@/ui/system/boot-splash";
import {
  LanguageProvider as FeeLanguageProvider,
  type LanguageCatalogs,
} from "@/platform/locale/language-provider";
import { DensityProvider } from "@/ui/design/density-context";
import { ThemeProvider } from "@/ui/system/theme-provider";
import { ToastViewport } from "@/ui/primitives/toast";

import "./globals.css";
import "@/vx/vx.css";
import "@/vx/shell/session-controls.css";

/*
 * Three families, matching School Fees exactly.
 *
 * This repo deliberately shipped none of them — its note read "a webfont that
 * covers Devanagari properly is a payload teachers pay for on 3G", and that is
 * still true; the pinned local assets are 568 KB, cached after the first visit.
 * Janmejay chose it knowingly: the alternative was an accountant's screen and
 * a teacher's screen setting their headings in different typefaces inside one
 * application. Reversing it is this block plus the `--font-sans` line in
 * `globals.css`.
 */
// Pinned assets remove the build-time Google Fonts response dependency.
// Exact sources, licenses and verified glyph hashes are in ./fonts/.
const fontSans = localFont({
  src: "./fonts/Inter-Variable.woff2",
  weight: "100 900",
  variable: "--font-sans",
  display: "swap",
});

const fontDisplay = localFont({
  src: "./fonts/SourceSerif4-Variable.woff2",
  variable: "--font-display",
  display: "swap",
  weight: "500 700",
  adjustFontFallback: "Times New Roman",
});

// Devanagari for Hindi script (हिन्दी), bundled so the first paint in Hindi is
// the same on every device rather than whatever the OS happens to ship.
const fontDevanagari = localFont({
  src: "./fonts/NotoSansDevanagari-Variable.woff2",
  variable: "--font-devanagari",
  display: "swap",
  weight: "400 700",
});

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "VPPS One", statusBarStyle: "default" },
  icons: { icon: "/branding/icon-192.png", apple: "/branding/icon-192.png" },
  title: {
    default: "VPPS One",
    template: "%s",
  },
  description: `${schoolBrand.name} — one workspace for fees, staff, timetable, attendance and assessments.`,
};

export const viewport: Viewport = {
  // Phones first. `maximumScale` is deliberately not set: capping zoom locks
  // out anybody who needs to enlarge the text.
  width: "device-width",
  initialScale: 1,
  // `cover` so the app draws under the home indicator; every fixed bar
  // reserves `env(safe-area-inset-bottom)` itself.
  viewportFit: "cover",
  // Browser chrome follows the school's light paper and dark workspace.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#11131A" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  /*
   * Nothing here waits on the database (boot speed, 6 Nov 2026).
   *
   * The frame below needs the staff profile, the permission matrix, the
   * session and the shell's preferences, and until it had all of them the
   * browser received not one byte: an installed app sat on the system splash
   * for the whole time. Now `<html>`, the stylesheets and the boot splash go
   * out at once, and everything that reads the account streams in behind the
   * Suspense boundary.
   *
   * `lang` is the reader's chosen locale when the cookie says so. Without the
   * cookie it is the default here and `LocaleRoot` corrects it from the
   * account as soon as that is read — before any of the screen's text
   * arrives, so a screen reader is never told the wrong voice for content.
   */
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE_NAME)?.value;
  const htmlLang: AppLocale = isSupportedLocale(cookieLocale) ? cookieLocale : "hi";

  return (
    <html
      lang={htmlLang}
      className={`h-full ${fontSans.variable} ${fontDisplay.variable} ${fontDevanagari.variable}`}
      // next-themes writes `class="dark"` here before React hydrates, which is
      // the point — it is what stops a light flash. React must be told not to
      // treat that as a mismatch.
      suppressHydrationWarning
    >
      {/* No colour utilities here. `globals.css` gives `body` the theme
          tokens, and a `bg-slate-50` utility beat them — so the page was
          painted stock cool grey while every card on it was warm paper. */}
      <body className="min-h-dvh antialiased">
        {/* Outside the boundary, so the theme script runs before the splash
            paints and a dark-mode reader never sees a white flash. */}
        <ThemeProvider>
          <Suspense fallback={<BootSplash />}>
            <LocaleRoot htmlLang={htmlLang}>{children}</LocaleRoot>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}

/**
 * The language the ported fee screens speak, and every provider that needs it.
 *
 * `i18n/request.ts` resolves the locale from the cookie, then the signed-in
 * account's `preferred_language`, so it follows the one setting rather than a
 * second one — which is a database read when the cookie is absent, and why
 * this sits inside the boot boundary rather than above it.
 */
async function LocaleRoot({ htmlLang, children }: { htmlLang: AppLocale; children: React.ReactNode }) {
  const [resolved, messages] = await Promise.all([getLocale(), getMessages()]);
  const locale: AppLocale = isSupportedLocale(resolved) ? resolved : "hi";
  /*
   * Only the active locale's shell namespaces are shipped at the root (the
   * three fee catalogues are 111 KB, 176 KB and 116 KB of JSON); fee routes
   * add their own complete catalogue beneath this provider.
   *
   * They are cut from the catalogue `i18n/request.ts` already built for this
   * request, not from a fresh import of `hi.json`. For a reader of both
   * languages that one is bilingual ("Academic session · शैक्षणिक सत्र",
   * A-23), and the plain import showed them the year picker and the year
   * switch card in Hindi alone while every One screen around them was in
   * both (polish thread, 7 Nov 2026).
   */
  const feeMessages: LanguageCatalogs = { [locale]: shellMessages(messages) };

  return (
    <>
      {locale !== htmlLang ? (
        // Runs while the HTML is parsed, ahead of the screen it introduces.
        <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang=${JSON.stringify(locale)}` }} />
      ) : null}
      {/*
        Two catalogues, deliberately. This provider carries the shared shell keys; fee routes add
        their full catalogue locally. The app's own
        Hindi/English pairs reach components through the other
        `LanguageProvider`, mounted in `(app)/layout.tsx`. See
        `src/platform/i18n/bridge.ts` for why neither was rewritten into the
        other.

        The fee app's provider rather than a bare `NextIntlClientProvider`:
        it wraps one, and adds the `useLang()` context that the shell's own
        locale switcher reads. Mounting only the inner one compiled, built,
        and then failed at request time with "useLang must be used inside
        <LanguageProvider>" — on every signed-in screen.

        Only the active locale's shell catalogue is sent here; the provider
        imports other shell catalogues on the first switch.
      */}
      <FeeLanguageProvider initialLocale={locale} catalogs={feeMessages} shellOnly>
        <DensityProvider>
          {children}
          <ServiceWorkerRegistration />
          <KeyboardOffsetProvider />
          <ToastViewport />
        </DensityProvider>
      </FeeLanguageProvider>
    </>
  );
}
