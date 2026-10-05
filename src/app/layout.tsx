import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari, Source_Serif_4 } from "next/font/google";
import { getLocale } from "next-intl/server";
import { shellMessages } from "@/platform/i18n/shell-messages";
import { KeyboardOffsetProvider } from "@/ui/system/keyboard-offset-provider";
import { ServiceWorkerRegistration } from "@/ui/system/service-worker-registration";
import { schoolBrand } from "@/platform/config/school-brand";

import { isSupportedLocale, type AppLocale } from "@/platform/i18n/locales";
import {
  LanguageProvider as FeeLanguageProvider,
  type LanguageCatalogs,
} from "@/platform/locale/language-provider";
import { DensityProvider } from "@/ui/design/density-context";
import { ThemeProvider } from "@/ui/system/theme-provider";
import { ToastViewport } from "@/ui/primitives/toast";

import "./globals.css";

/*
 * Three families, matching School Fees exactly.
 *
 * This repo deliberately shipped none of them — its note read "a webfont that
 * covers Devanagari properly is a payload teachers pay for on 3G", and that is
 * still true; this is roughly 250–400 KB, cached after the first visit.
 * Janmejay chose it knowingly: the alternative was an accountant's screen and
 * a teacher's screen setting their headings in different typefaces inside one
 * application. Reversing it is this block plus the `--font-sans` line in
 * `globals.css`.
 */
const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fontDisplay = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"],
});

// Devanagari for Hindi script (हिन्दी), bundled so the first paint in Hindi is
// the same on every device rather than whatever the OS happens to ship.
const fontDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

/**
 * Only the active locale's shell namespaces are shipped at the root. Fee routes
 * add their own complete catalogue beneath this provider.
 *
 * The three fee catalogues are 111 KB, 176 KB and 116 KB of JSON. Sending all
 * three to every reader was the fee app's biggest first-load win when it
 * stopped; a `switch` rather than a template literal is what lets the bundler
 * see that only one of the three is reachable per branch.
 */
async function loadFeeMessages(locale: AppLocale): Promise<LanguageCatalogs> {
  switch (locale) {
    case "en":
      return { en: shellMessages((await import("@/messages/en.json")).default) };
    case "hi":
      return { hi: shellMessages((await import("@/messages/hi.json")).default) };
    case "hi-en":
      return { "hi-en": shellMessages((await import("@/messages/hi-en.json")).default) };
  }
}

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
   * The locale the ported fee screens will speak. `i18n/request.ts` resolves
   * it from the signed-in account's `preferred_language`, so it follows the
   * one setting rather than a second one.
   *
   * `lang` on <html> stays this value rather than the hard-coded "hi" it was:
   * a screen reader should be told which voice to read the page in, and for an
   * English reader that answer is not Hindi.
   */
  const resolved = await getLocale();
  const locale: AppLocale = isSupportedLocale(resolved) ? resolved : "hi";
  const feeMessages = await loadFeeMessages(locale);

  return (
    <html
      lang={locale}
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
          <ThemeProvider>
            <DensityProvider>
              {children}
              <ServiceWorkerRegistration />
              <KeyboardOffsetProvider />
              <ToastViewport />
            </DensityProvider>
          </ThemeProvider>
        </FeeLanguageProvider>
      </body>
    </html>
  );
}
