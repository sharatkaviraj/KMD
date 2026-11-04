import { failClosed } from "@/modules/mcp/domain/http";
import { handleRegister } from "@/modules/mcp/domain/oauth";
import { oauthDeps } from "@/modules/mcp/data/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 7591 dynamic client registration — unauthenticated by design, as the
 * RFC and Claude's custom connectors expect. It grants nothing: a client id
 * opens no data until a signed-in, eligible member of staff approves it on
 * One's consent page. Redirect URIs must match the allowlist exactly, and
 * registrations are capped per hour (`handleRegister`).
 */
export function POST(request: Request) {
  return failClosed(() => handleRegister(request, oauthDeps()));
}
