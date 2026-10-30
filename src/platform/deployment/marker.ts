import "server-only";

import { getOptionalEnvVar, getServerSupabaseUrl } from "@/platform/env";

import { environmentFromMarkerRows, type DeploymentEnvironment } from "./decisions";

/**
 * What `vppsone.deployment` says this database is: 'dev' or 'production'
 * (D-346). Read with the service role — the table is granted to nobody else —
 * over plain REST, so no Supabase client (and no client-level guard) is
 * involved in answering "which guards apply".
 *
 * Fail closed: no service key, a network error, an error status or an
 * unexpected body all read as 'production'.
 *
 * Cached for a short while per server instance: the marker changes once, at
 * go-live, and every QA sign-in and fee write asks it.
 */
const TTL_MS = 15_000;
let cached: { value: DeploymentEnvironment; at: number } | null = null;

export async function readDeploymentEnvironment(): Promise<DeploymentEnvironment> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const value = await readUncached();
  cached = { value, at: Date.now() };
  return value;
}

async function readUncached(): Promise<DeploymentEnvironment> {
  const serviceRoleKey = getOptionalEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return "production";

  try {
    const response = await globalThis.fetch(
      `${getServerSupabaseUrl()}/rest/v1/deployment?select=environment&id=eq.1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Accept-Profile": "vppsone",
        },
        cache: "no-store",
      },
    );
    if (!response.ok) return "production";
    return environmentFromMarkerRows(await response.json());
  } catch {
    return "production";
  }
}

/** For tests: forget the cached answer. */
export function forgetDeploymentEnvironment() {
  cached = null;
}
