import { failClosed } from "@/modules/mcp/domain/http";
import { handleToken } from "@/modules/mcp/domain/oauth";
import { oauthDeps } from "@/modules/mcp/data/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token endpoint: an authorization code with its PKCE verifier, or a refresh
 * token, each single-use and checked by `handleToken` against One's
 * Postgres. No session, by design: the credential is in the body.
 */
export function POST(request: Request) {
  return failClosed(() => handleToken(request, oauthDeps()));
}
