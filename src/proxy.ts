import { type NextRequest } from "next/server";

import { updateSession } from "@/platform/supabase/middleware";

/**
 * `proxy.ts`, not `middleware.ts`: Next.js 16 renamed the convention and
 * `middleware.ts` is deprecated (see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
 * Same file, same signature, same behaviour — and the fee app is already on
 * the new name, so this matches what is running in production (D-12).
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except the things that never need a session:
     * Next's own static output, the favicon, and static asset extensions.
     *
     * Without a matcher this runs for every image and stylesheet, which puts
     * an auth check in front of the page's own CSS.
     *
     * **The PWA files are named explicitly**, and they were missed when the
     * fee app's `public/` came across. `service-worker.js` happened to be
     * covered by the `.js` extension rule, but `manifest.webmanifest` and
     * `offline.html` match neither — so production answered both with a 307 to
     * `/login`. An installed app fetches the manifest on every launch and the
     * offline page precisely when there is no network to sign in over, so an
     * auth redirect is the one answer neither can use. `branding/` goes with
     * them: it is the logo on the sign-in screen, wanted before there is a
     * session to check.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|offline.html|service-worker.js|branding/|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|map)$).*)",
  ],
};
