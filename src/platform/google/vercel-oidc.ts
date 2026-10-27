import "server-only";

import { headers } from "next/headers";

/**
 * This deployment's Vercel OIDC token: the identity Google trusts instead of
 * a stored key (D-333).
 *
 * Vercel puts it on every function request as `x-vercel-oidc-token`; a route
 * handler passes its request, anything else (a server action) reads the
 * current request's headers. `VERCEL_OIDC_TOKEN` is the build-time and
 * `vercel env pull` copy — it names a different environment, and the
 * Workload Identity provider accepts production only, so a laptop holding it
 * still gets no Drive token.
 */
export async function vercelOidcToken(request?: Request): Promise<string | null> {
  const fromRequest = request?.headers.get("x-vercel-oidc-token");
  if (fromRequest) return fromRequest;
  try {
    const fromContext = (await headers()).get("x-vercel-oidc-token");
    if (fromContext) return fromContext;
  } catch {
    // Outside a request (a script): only the environment can answer.
  }
  return process.env.VERCEL_OIDC_TOKEN?.trim() || null;
}
