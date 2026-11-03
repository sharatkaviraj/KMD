import { failClosed } from "@/modules/mcp/domain/http";
import { handleRevoke } from "@/modules/mcp/domain/oauth";
import { oauthDeps } from "@/modules/mcp/data/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 7009 revocation: the token itself is the credential; `handleRevoke` acts only for the client it was issued to. */
export function POST(request: Request) {
  return failClosed(() => handleRevoke(request, oauthDeps()));
}
