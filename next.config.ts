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
    "/api/ai/**": ["./src/lib/ai/prompts/*.md"],
    "/**": [
      "./node_modules/pdfkit/js/standard-fonts/**/*.cjs",
      // document-kit.tsx reads these off disk with process.cwd(). On Vercel
      // public/ is served by the CDN and is not in the function unless traced:
      // the Devanagari faces for every PDF, the crest, the signature and the seal.
      "./public/fonts/*.ttf",
      "./public/branding/icon-192.png",
      "./public/branding/authorised-signature.png",
      // Certificates: the crest at the head of the page and the school seal.
      "./public/branding/veer-patta-emblem.png",
      "./public/branding/school-seal.png",
    ],
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

  /*
   * No type check inside the Vercel build. CI's `types` job is the gate
   * (`tsc --noEmit`, 6 GB heap), and nothing reaches main without it.
   *
   * Inside the build the check does not fit. Next runs it in a worker that
   * inherits NODE_OPTIONS, while webpack's process is still holding memory,
   * all on one 8 GB machine. With Node's default heap the worker
   * (about 2 GB) sat in "Running TypeScript" until the build timed out
   * (preview, 6 Nov 2026). With a 6 GB heap, the worker and webpack's
   * process together filled the machine, and the build was SIGKILLed
   * (production a01a427, same night). CI and local builds still type-check.
   */
  typescript: { ignoreBuildErrors: process.env.VERCEL === "1" },

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
      // The AI connection's consent page: never framed (an "Allow" a hidden
      // frame could be clicked through), never cached, and the request
      // (client, state, challenge) never sent on as a referrer.
      {
        source: "/mcp/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
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
     *
     * `dynamic` went from 60 to 300 on 10 Oct 2026 (docs/ui/PERFORMANCE.md):
     * a minute was shorter than a typical look at one child, so coming back
     * to the list after reading a Student 360 refetched it every time. The
     * two safety nets above are unchanged, and the realtime listener's
     * `router.refresh()` empties this cache whenever money moves.
     */
    staleTimes: {
      dynamic: 300,
      static: 300,
    },
  },
};

export default withNextIntl(nextConfig);
