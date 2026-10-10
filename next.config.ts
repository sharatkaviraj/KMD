import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/platform/i18n/request.ts");

/*
 * Ported from School Fees, minus the parts that belong to that deployment.
 *
 * Every value here is one the fee app measured rather than guessed; its own
 * comments record what was tried and rejected, and those reasons are repeated
 * below so nobody removes one on the grounds that it looks decorative.
 *
 * Deliberately NOT ported: Sentry (`withSentryConfig`) and the bundle
 * analyzer. Both need a second project, a DSN and a source-map token, and in
 * a port this size a Sentry build failure is indistinguishable from a port
 * failure. They get added on purpose, later.
 */
const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,

  // @react-pdf/renderer is Node-only and reads fonts off disk.
  serverExternalPackages: ["@react-pdf/renderer"],

  /*
   * pdfkit (under @react-pdf) loads its standard fonts through the
   * `#standard-fonts/*` subpath import, which file tracing does not follow.
   * Without this every PDF on Vercel failed with MODULE_NOT_FOUND for
   * Helvetica.cjs: the receipt PDF, the WhatsApp receipt attachment, fee
   * statements and collection lists. Every route, because server actions
   * render them too; the folder is 190 KB. `**` because each font file
   * requires its glyph names from `standard-fonts/chunks/`, which `*.cjs`
   * left out (the first fix still failed, on that chunk).
   */
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pdfkit/js/standard-fonts/**/*.cjs"],
  },

  /*
   * Annotation mode, not global. The fee app compiles exactly two files —
   * the Payment Desk and its payment sheet — because a 3,500-line component
   * with ~96 hooks re-rendering on every keystroke of the amount field is
   * what the phone's input lag was made of. Everything else keeps its
   * hand-written memoisation and is compiled by nothing.
   *
   * This is why `build` is `next build --webpack`: the compiler is a Babel
   * pass and Turbopack skips it.
   */
  reactCompiler: { compilationMode: "annotation" },

  images: {
    formats: ["image/avif", "image/webp"],
  },

  async headers() {
    return [
      {
        source: "/branding/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000" }],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
      // A stale service worker decides what every other request does, so it
      // is the one asset that must never be served from cache.
      {
        source: "/service-worker.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/offline.html",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },

  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
      "class-variance-authority",
      "next-intl",
      "next-themes",
    ],
    optimizeCss: true,
    scrollRestoration: true,

    /*
     * Lets a Link opt in (`unstable_dynamicOnHover`) to fetching the whole
     * page — data included — on hover or touchstart, rather than only its
     * loading skeleton. Only the phone's tab bar takes it up: the 50–100ms
     * between a thumb landing and the click firing is spent rendering the
     * destination. A desktop sidebar hovered in passing would be a server
     * render per pass.
     */
    dynamicOnHover: true,

    /*
     * The client Router Cache, and the single biggest lever for "switching
     * tabs feels instant" on a phone. `dynamic` ships as 0, which means a
     * page you were looking at ten seconds ago is refetched in full when you
     * come back to it.
     *
     * Safe only because writes are Server Actions that call
     * `revalidatePath`, which purges this cache outright, and because a
     * colleague's posting reaches every open screen over realtime within a
     * couple of seconds. `static: 300` is Next's own default written out on
     * purpose, so a future change to that default is a visible edit here.
     */
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
};

export default withNextIntl(nextConfig);
