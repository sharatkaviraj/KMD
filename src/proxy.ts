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
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|map)$).*)",
  ],
};
