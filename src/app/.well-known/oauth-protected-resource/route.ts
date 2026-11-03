import { handleProtectedResourceMetadata } from "@/modules/mcp/domain/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 9728 protected-resource metadata for the AI connection's MCP endpoint.
 * Public by design: it names the resource and its authorization server and
 * nothing else. The core is `src/modules/mcp/domain/oauth.ts`.
 */
export function GET(request: Request) {
  return handleProtectedResourceMetadata(request, { env: process.env });
}
